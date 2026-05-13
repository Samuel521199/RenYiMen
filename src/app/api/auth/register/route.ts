import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

function parseWelcomeCredits(): number {
  const raw = process.env.REGISTER_WELCOME_CREDITS?.trim();
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return 0;
  return Math.floor(n);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

/**
 * POST `/api/auth/register` — 邮箱密码注册；初始积分见 `REGISTER_WELCOME_CREDITS`（写入 `User.balance`）。
 */
export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "请求体须为 JSON" }, { status: 400 });
  }

  if (!isRecord(body)) {
    return NextResponse.json({ ok: false, error: "无效请求体" }, { status: 400 });
  }

  const emailRaw = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";

  const email = emailRaw.toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "请输入有效邮箱" }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    return NextResponse.json(
      { ok: false, error: `密码长度需在 ${MIN_PASSWORD}～${MAX_PASSWORD} 个字符之间` },
      { status: 400 }
    );
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true },
  });
  if (existing) {
    if (!existing.passwordHash) {
      return NextResponse.json(
        { ok: false, error: "该邮箱已存在（可能通过第三方登录），请改用对应方式登录。" },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: false, error: "该邮箱已注册，请直接登录。" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const welcome = parseWelcomeCredits();

  try {
    await prisma.user.create({
      data: {
        email,
        name: name || null,
        passwordHash,
        balance: welcome,
      },
    });
  } catch (e) {
    console.error("[register] 写入失败", e);
    return NextResponse.json({ ok: false, error: "注册失败，请稍后重试" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
