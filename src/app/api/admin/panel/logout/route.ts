import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_PANEL_COOKIE, getAdminPanelCookieSecure } from "@/lib/admin-panel-session";

export const runtime = "nodejs";

/**
 * POST `/api/admin/panel/logout` — 清除管理端独立登录 Cookie。
 */
export async function POST(req: Request) {
  const jar = await cookies();
  jar.set(ADMIN_PANEL_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: getAdminPanelCookieSecure(),
    path: "/",
    maxAge: 0,
  });
  const url = new URL("/admin/login", req.url);
  return NextResponse.redirect(url);
}
