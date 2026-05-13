import { NextResponse } from "next/server";
import { getAdminAccess } from "@/lib/admin-access";
import { BillingBalanceError, deductUserBalance } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

/**
 * POST `/api/admin/recharge` — 管理员为指定用户增加积分（RECHARGE 流水）。
 */
export async function POST(req: Request) {
  const access = await getAdminAccess();
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: "未授权" }, { status: 401 });
  }
  const operatorRef =
    access.via === "nextauth" ? `用户 ${access.userId}` : `管理端账号 ${access.label}`;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "请求体须为 JSON" }, { status: 400 });
  }

  if (!isRecord(body)) {
    return NextResponse.json({ ok: false, error: "无效请求体" }, { status: 400 });
  }

  const targetUserId = typeof body.targetUserId === "string" ? body.targetUserId.trim() : "";
  const amountRaw = body.amount;
  const amount =
    typeof amountRaw === "number"
      ? amountRaw
      : typeof amountRaw === "string"
        ? Number(amountRaw.trim())
        : NaN;

  if (!targetUserId) {
    return NextResponse.json({ ok: false, error: "缺少 targetUserId" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ ok: false, error: "amount 须为正数" }, { status: 400 });
  }

  const exists = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true },
  });
  if (!exists) {
    return NextResponse.json({ ok: false, error: "目标用户不存在" }, { status: 404 });
  }

  try {
    const result = await deductUserBalance(
      targetUserId,
      amount,
      "RECHARGE",
      `管理员后台充值（操作者 ${operatorRef}）`,
      undefined
    );
    return NextResponse.json({
      ok: true,
      transactionId: result.transactionId,
      balanceAfter: result.balanceAfter,
    });
  } catch (e) {
    if (e instanceof BillingBalanceError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: 400 });
    }
    console.error("[admin/recharge] 未处理异常", e);
    return NextResponse.json({ ok: false, error: "充值失败" }, { status: 500 });
  }
}
