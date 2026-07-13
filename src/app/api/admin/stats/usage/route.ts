import { NextRequest, NextResponse } from "next/server";
import { GenerationHistoryStatus } from "@prisma/client";
import { getAdminAccess } from "@/lib/admin-access";
import { prisma } from "@/lib/prisma";

const WORKBENCH_BACKEND_URL =
  process.env.WORKBENCH_BACKEND_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

async function isWorkbenchAdmin(authHeader: string | null): Promise<boolean> {
  if (!authHeader?.startsWith("Bearer ")) return false;
  try {
    const res = await fetch(`${WORKBENCH_BACKEND_URL}/api/users/me`, {
      headers: { Authorization: authHeader },
      cache: "no-store",
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { data?: { is_admin?: boolean; role?: string } };
    const user = data?.data;
    return Boolean(user?.is_admin || user?.role === "admin");
  } catch {
    return false;
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** SKU ID → 中文显示名映射（同步自 /api/skus/route.ts 的 CATALOG） */
const SKU_DISPLAY_NAMES: Record<string, string> = {
  RH_PROMPT_REVERSE: "提示词反推",
  RH_BG_REPLACE: "背景替换",
  RH_MATTING: "人像抠图",
  RH_HD_UPSCALE: "高清放大",
  RH_FACE_SWAP: "换头换脸",
  RH_TXT2IMG_SHORTDRAMA: "文字生成图片",
  RH_STORYBOARD: "分镜生成出图",
  RH_VIDEO_ENHANCE: "视频模糊修复",
  KLING_CINEMA_PRO: "单图生成短视频",
  BAILIAN_WANX_I2V: "多模态图生视频",
  RH_IMG2VIDEO_FIRSTLAST: "首尾帧生成视频",
  BAILIAN_MULTI_REF: "多参考图融合",
  RH_TEXT_TO_IMAGE: "文生图",
};

export type SkuStat = {
  skuId: string;
  displayName: string;
  total: number;
  success: number;
  failed: number;
  pending: number;
  totalCost: number;
};

export type UserSkuBreakdown = {
  skuId: string;
  displayName: string;
  count: number;
  success: number;
  failed: number;
  cost: number;
};

export type UserStat = {
  userId: string;
  email: string;
  name: string | null;
  total: number;
  success: number;
  failed: number;
  totalCost: number;
  skuBreakdown: UserSkuBreakdown[];
};

export type UsageStatsResponse = {
  skuStats: SkuStat[];
  userStats: UserStat[];
};

/**
 * GET `/api/admin/stats/usage`
 * 按 SKU（模型/工作流）和用户维度聚合调用次数与积分消耗，仅管理员可访问。
 * 支持两种认证：NextAuth ADMIN session 或 workbench admin JWT。
 */
export async function GET(req: NextRequest) {
  const access = await getAdminAccess();
  const authHeader = req.headers.get("authorization");
  const allowed = access.ok || (await isWorkbenchAdmin(authHeader));
  if (!allowed) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  // 按 skuId + status 分组 → 每个模型各状态下的调用次数与积分
  const skuStatusRows = await prisma.generationHistory.groupBy({
    by: ["skuId", "status"],
    _count: { id: true },
    _sum: { cost: true },
  });

  // 按 userId + skuId + status 分组 → 用户粒度 × 模型粒度
  const userSkuStatusRows = await prisma.generationHistory.groupBy({
    by: ["userId", "skuId", "status"],
    _count: { id: true },
    _sum: { cost: true },
  });

  // ──── 构建 SKU 统计 ────
  const skuMap = new Map<string, SkuStat>();

  for (const row of skuStatusRows) {
    let entry = skuMap.get(row.skuId);
    if (!entry) {
      entry = {
        skuId: row.skuId,
        displayName: SKU_DISPLAY_NAMES[row.skuId] ?? row.skuId,
        total: 0,
        success: 0,
        failed: 0,
        pending: 0,
        totalCost: 0,
      };
      skuMap.set(row.skuId, entry);
    }
    const cnt = row._count.id;
    const cost = Number(row._sum.cost ?? 0);
    entry.total += cnt;
    entry.totalCost += cost;
    if (row.status === GenerationHistoryStatus.SUCCESS) entry.success += cnt;
    else if (row.status === GenerationHistoryStatus.FAILED) entry.failed += cnt;
    else entry.pending += cnt;
  }

  // ──── 构建用户统计 ────
  const userIds = [...new Set(userSkuStatusRows.map((r) => r.userId))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true, name: true },
  });
  const userInfoMap = new Map(users.map((u) => [u.id, u]));

  const userMap = new Map<string, UserStat & { _breakdown: Map<string, UserSkuBreakdown> }>();

  for (const row of userSkuStatusRows) {
    let entry = userMap.get(row.userId);
    if (!entry) {
      const info = userInfoMap.get(row.userId);
      entry = {
        userId: row.userId,
        email: info?.email ?? row.userId,
        name: info?.name ?? null,
        total: 0,
        success: 0,
        failed: 0,
        totalCost: 0,
        skuBreakdown: [],
        _breakdown: new Map(),
      };
      userMap.set(row.userId, entry);
    }

    const cnt = row._count.id;
    const cost = Number(row._sum.cost ?? 0);
    entry.total += cnt;
    entry.totalCost += cost;
    if (row.status === GenerationHistoryStatus.SUCCESS) entry.success += cnt;
    else if (row.status === GenerationHistoryStatus.FAILED) entry.failed += cnt;

    let bd = entry._breakdown.get(row.skuId);
    if (!bd) {
      bd = {
        skuId: row.skuId,
        displayName: SKU_DISPLAY_NAMES[row.skuId] ?? row.skuId,
        count: 0,
        success: 0,
        failed: 0,
        cost: 0,
      };
      entry._breakdown.set(row.skuId, bd);
    }
    bd.count += cnt;
    bd.cost += cost;
    if (row.status === GenerationHistoryStatus.SUCCESS) bd.success += cnt;
    else if (row.status === GenerationHistoryStatus.FAILED) bd.failed += cnt;
  }

  const skuStats: SkuStat[] = [...skuMap.values()].sort((a, b) => b.total - a.total);

  const userStats: UserStat[] = [...userMap.values()]
    .map(({ _breakdown, ...rest }) => ({
      ...rest,
      skuBreakdown: [..._breakdown.values()].sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.total - a.total);

  return NextResponse.json({ skuStats, userStats } satisfies UsageStatsResponse);
}
