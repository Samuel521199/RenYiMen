import type { UserRole } from "@/lib/types";

const TOKEN_KEY = "token";
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
