import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "请求体须为 JSON" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const oldPassword = typeof b.old_password === "string" ? b.old_password : "";
  const newPassword = typeof b.new_password === "string" ? b.new_password : "";

  if (!oldPassword || !newPassword) {
    return NextResponse.json({ ok: false, error: "请填写旧密码和新密码" }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ ok: false, error: "新密码至少 8 位" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, passwordHash: true },
  });

  if (!user?.passwordHash) {
    return NextResponse.json({ ok: false, error: "该账号未设置密码（可能是 OAuth 账号）" }, { status: 400 });
  }

  const match = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!match) {
    return NextResponse.json({ ok: false, error: "旧密码不正确" }, { status: 400 });
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });

  return NextResponse.json({ ok: true });
}
