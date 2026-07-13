import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminAccess } from "@/lib/admin-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const WORKBENCH_BACKEND_URL =
  process.env.WORKBENCH_BACKEND_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

/** 用 workbench JWT 验证是否为工作台管理员 */
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 接受主平台管理员（NextAuth ADMIN / 管理端 Cookie）或工作台管理员（workbench JWT）
  const access = await getAdminAccess();
  const authHeader = req.headers.get("authorization");
  const wbAdmin = access.ok ? true : await isWorkbenchAdmin(authHeader);
  if (!wbAdmin) {
    return NextResponse.json({ ok: false, error: "未授权" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "请求体须为 JSON" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const email = (typeof b.email === "string" ? b.email.trim().toLowerCase() : "");
  const password = typeof b.password === "string" ? b.password : "";
  const name = typeof b.name === "string" ? b.name.trim() : "";

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "请输入有效邮箱" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ ok: false, error: "密码至少 8 位" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return NextResponse.json({ ok: false, error: "该邮箱已注册" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { email, name: name || null, passwordHash, balance: 0 },
    select: { id: true, email: true, name: true, balance: true },
  });

  return NextResponse.json({ ok: true, user });
}

/**
 * PATCH /api/admin/users
 * 管理员重置任意用户的登录密码（按邮箱查找主平台账号）。
 * 认证方式与 POST 相同：主平台 ADMIN session 或 Workbench 管理员 JWT。
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const access = await getAdminAccess();
  const authHeader = req.headers.get("authorization");
  const wbAdmin = access.ok ? true : await isWorkbenchAdmin(authHeader);
  if (!wbAdmin) {
    return NextResponse.json({ ok: false, error: "未授权" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "请求体须为 JSON" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  const newPassword = typeof b.new_password === "string" ? b.new_password : "";

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "请输入有效邮箱" }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ ok: false, error: "新密码至少 8 位" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
  if (!user) {
    return NextResponse.json({ ok: false, error: "该邮箱未注册" }, { status: 404 });
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });

  return NextResponse.json({ ok: true });
}
