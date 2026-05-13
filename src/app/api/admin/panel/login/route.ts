import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  ADMIN_PANEL_COOKIE,
  getAdminPanelCookieSecure,
  getAdminPanelCredentials,
  signAdminPanelToken,
} from "@/lib/admin-panel-session";

export const runtime = "nodejs";

/**
 * POST `/api/admin/panel/login` — 管理端独立账号（默认 admin/admin，见环境变量）。
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "请求体须为 JSON" }, { status: 400 });
  }
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const username = typeof o?.username === "string" ? o.username : "";
  const password = typeof o?.password === "string" ? o.password : "";
  const cred = getAdminPanelCredentials();
  if (username !== cred.username || password !== cred.password) {
    return NextResponse.json({ ok: false, error: "账号或密码错误" }, { status: 401 });
  }

  const token = signAdminPanelToken(username);
  const jar = await cookies();
  jar.set(ADMIN_PANEL_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: getAdminPanelCookieSecure(),
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });

  return NextResponse.json({ ok: true });
}
