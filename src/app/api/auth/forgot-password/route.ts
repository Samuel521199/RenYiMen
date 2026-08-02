import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  PASSWORD_RESET_MAX_PASSWORD,
  PASSWORD_RESET_MIN_MASTER_KEY,
  PASSWORD_RESET_MIN_PASSWORD,
  consumePasswordResetAttempt,
  isValidResetPassword,
  normalizePasswordResetEmail,
  passwordResetSecretMatches,
} from "@/lib/password-reset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function json(
  body: { ok: boolean; error?: string; message?: string },
  status = 200,
  headers?: Record<string, string>
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { ...NO_STORE_HEADERS, ...headers },
  });
}

function requestSource(req: NextRequest): string {
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/**
 * POST `/api/auth/forgot-password` — reset a credentials password with the server-side master key.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const configuredKey = process.env.PASSWORD_RESET_MASTER_KEY ?? "";
  if (configuredKey.length < PASSWORD_RESET_MIN_MASTER_KEY) {
    console.error("[forgot-password] PASSWORD_RESET_MASTER_KEY is missing or too short");
    return json({ ok: false, error: "密码重置服务尚未配置，请联系管理员" }, 503);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "请求体须为 JSON" }, 400);
  }

  const input = body && typeof body === "object" ? body as Record<string, unknown> : null;
  const email = normalizePasswordResetEmail(input?.email);
  const resetKey = typeof input?.reset_key === "string" ? input.reset_key : "";
  const newPassword = input?.new_password;

  if (!email) {
    return json({ ok: false, error: "请输入有效邮箱" }, 400);
  }
  if (!resetKey || resetKey.length > 512) {
    return json({ ok: false, error: "请输入有效的重置密钥" }, 400);
  }
  if (!isValidResetPassword(newPassword)) {
    return json(
      { ok: false, error: `新密码长度需在 ${PASSWORD_RESET_MIN_PASSWORD}～${PASSWORD_RESET_MAX_PASSWORD} 个字符之间` },
      400
    );
  }

  const source = requestSource(req);
  const rateLimit = consumePasswordResetAttempt([`ip:${source}`, `email:${email}`]);
  if (!rateLimit.allowed) {
    return json(
      { ok: false, error: "尝试次数过多，请稍后再试" },
      429,
      { "Retry-After": String(rateLimit.retryAfterSeconds) }
    );
  }

  if (!passwordResetSecretMatches(resetKey, configuredKey)) {
    return json({ ok: false, error: "重置密钥不正确" }, 401);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (!user) {
    return json({ ok: false, error: "该邮箱尚未注册" }, 404);
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  return json({
    ok: true,
    message: "重置成功",
  });
}
