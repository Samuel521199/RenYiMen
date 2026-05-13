import { NextResponse } from "next/server";
import { GenerationHistoryStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HISTORY_LIMIT = 50;

/**
 * GET `/api/user/history` — 当前用户最近成功且已有结果地址的生成记录（JSON 数组，供云端相册）。
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const rows = await prisma.generationHistory.findMany({
    where: {
      userId: session.user.id,
      status: GenerationHistoryStatus.SUCCESS,
      resultUrl: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
  });

  const withUrl = rows.filter((r) => (r.resultUrl ?? "").trim().length > 0);

  return NextResponse.json(withUrl);
}
