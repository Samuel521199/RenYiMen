import { createHmac, timingSafeEqual } from "node:crypto";

/** HttpOnly Cookie；path 须为 `/`，否则不会随 `/api/admin/*` 请求发送 */
export const ADMIN_PANEL_COOKIE = "wf_admin_panel";

const PANEL_TOKEN_VERSION = 1;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type AdminPanelTokenPayload = {
  v: number;
  exp: number;
  /** 登录用户名（展示用） */
  sub: string;
};

export function getAdminPanelSessionSecret(): string {
  return (
    process.env.ADMIN_PANEL_SESSION_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    "wf-admin-panel-dev-only-change-me"
  );
}

/**
 * 管理端 Cookie 是否带 `Secure`。
 * - 生产默认 true（仅 HTTPS 会下发 Cookie）。
 * - 若暂时用 HTTP（如仅 IP:端口访问），请在环境变量设置：`ADMIN_PANEL_COOKIE_SECURE=false`
 */
export function getAdminPanelCookieSecure(): boolean {
  const raw = process.env.ADMIN_PANEL_COOKIE_SECURE?.trim().toLowerCase();
  if (raw === "false" || raw === "0") return false;
  if (raw === "true" || raw === "1") return true;
  return process.env.NODE_ENV === "production";
}

/** 默认 admin / admin；生产务必改 `ADMIN_PANEL_USERNAME` / `ADMIN_PANEL_PASSWORD` */
export function getAdminPanelCredentials(): { username: string; password: string } {
  return {
    username: process.env.ADMIN_PANEL_USERNAME?.trim() || "admin",
    password: process.env.ADMIN_PANEL_PASSWORD?.trim() || "admin",
  };
}

export function signAdminPanelToken(sub: string): string {
  const payload: AdminPanelTokenPayload = {
    v: PANEL_TOKEN_VERSION,
    exp: Date.now() + MAX_AGE_MS,
    sub,
  };
  const body = JSON.stringify(payload);
  const sig = createHmac("sha256", getAdminPanelSessionSecret()).update(body).digest("hex");
  return `${Buffer.from(body, "utf8").toString("base64url")}.${sig}`;
}

export function verifyAdminPanelToken(raw: string | undefined): AdminPanelTokenPayload | null {
  if (!raw || typeof raw !== "string" || !raw.includes(".")) return null;
  const i = raw.lastIndexOf(".");
  const bodyB64 = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  let body: string;
  try {
    body = Buffer.from(bodyB64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = createHmac("sha256", getAdminPanelSessionSecret()).update(body).digest("hex");
  try {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  let parsed: AdminPanelTokenPayload;
  try {
    parsed = JSON.parse(body) as AdminPanelTokenPayload;
  } catch {
    return null;
  }
  if (parsed.v !== PANEL_TOKEN_VERSION || typeof parsed.exp !== "number" || typeof parsed.sub !== "string") {
    return null;
  }
  if (parsed.exp <= Date.now()) return null;
  return parsed;
}
