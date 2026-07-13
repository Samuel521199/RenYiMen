import type { UserRole } from "@workbench/lib/types";

const TOKEN_KEY = "workbench_token";
const tokenListeners = new Set<() => void>();

export interface CurrentUser {
  id?: number | string;
  username?: string;
  role?: UserRole | string;
  exp?: number;
}

export function getToken(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(TOKEN_KEY) || "";
}

export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
  tokenListeners.forEach((listener) => listener());
}

export function removeToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  tokenListeners.forEach((listener) => listener());
}

export function onAuthTokenChange(listener: () => void): () => void {
  tokenListeners.add(listener);
  return () => tokenListeners.delete(listener);
}

export function isLoggedIn(): boolean {
  return Boolean(getToken());
}

export function getCurrentUser(): CurrentUser | null {
  const token = getToken();
  if (!token) return null;

  const [, payload] = token.split(".");
  if (!payload) return null;

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const decoded = JSON.parse(window.atob(padded)) as CurrentUser;
    return decoded;
  } catch {
    return null;
  }
}

export interface SSOResult {
  ok: boolean;
  /** 人类可读的失败原因，ok=true 时为空 */
  reason?: string;
}

/** Exchange NextAuth session for a workbench JWT via platform SSO. */
export async function syncWorkbenchTokenFromSession(): Promise<SSOResult> {
  try {
    const res = await fetch("/api/workbench/auth/sso", { method: "POST" });
    let body: Record<string, unknown> = {};
    try { body = (await res.json()) as Record<string, unknown>; } catch { /* ignore */ }

    if (!res.ok) {
      removeToken();
      const serverMsg =
        typeof body.error === "string" ? body.error :
        typeof body.detail === "string" ? body.detail : "";
      const reason = serverMsg
        ? `SSO 失败（HTTP ${res.status}）：${serverMsg}`
        : `SSO 请求失败，HTTP ${res.status}${res.status === 403 ? "（Secret 不匹配或用户被禁用）" : ""}`;
      return { ok: false, reason };
    }

    const token =
      (body.access_token as string | undefined) ||
      (body.token as string | undefined);
    if (!token) {
      removeToken();
      return { ok: false, reason: "SSO 响应中未包含 token，请检查后端日志" };
    }
    setToken(token);
    return { ok: true };
  } catch (e) {
    removeToken();
    const reason = e instanceof Error
      ? `SSO 网络异常：${e.message}`
      : "SSO 网络异常，无法连接到后端";
    return { ok: false, reason };
  }
}
