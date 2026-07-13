// Workbench API client — proxied through Next.js /api/workbench

const API_BASE = "/api/workbench";

function getToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("workbench_token") || "";
}

/** 统一解析响应，非 2xx 时抛出包含 HTTP status 和 code 的错误 */
async function parseResponse<T>(res: Response, path: string): Promise<{ code: number; msg: string; data: T }> {
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error(`[${res.status}] ${path} 响应解析失败（非 JSON）`);
  }

  if (!res.ok) {
    const body = json as Record<string, unknown> | null;
    const serverMsg =
      typeof body?.detail === "string" ? body.detail :
      typeof body?.msg === "string" ? body.msg :
      typeof body?.message === "string" ? body.message : "";
    const code = typeof body?.code === "string" || typeof body?.code === "number" ? String(body.code) : "";
    const suffix = [code && `code=${code}`, serverMsg].filter(Boolean).join(" ").trim();
    throw new Error(`[HTTP ${res.status}] ${path}${suffix ? `：${suffix}` : ""}`);
  }

  return json as { code: number; msg: string; data: T };
}

export async function apiGet<T = unknown>(
  path: string,
): Promise<{ code: number; msg: string; data: T }> {
  const res = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${getToken()}`,
    },
  });
  return parseResponse<T>(res, path);
}

export async function apiPost<T = unknown>(
  path: string,
  body: unknown,
  timeoutMs = 30000,
): Promise<{ code: number; msg: string; data: T }> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`请求超时（>${Math.round(timeoutMs / 1000)}s），请稍后重试`)),
    timeoutMs,
  );

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getToken()}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return parseResponse<T>(res, path);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      const reason = controller.signal.reason;
      throw reason instanceof Error ? reason : new Error(`请求超时（>${Math.round(timeoutMs / 1000)}s），请稍后重试`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function apiPut<T = unknown>(
  path: string,
  body: unknown,
): Promise<{ code: number; msg: string; data: T }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(body),
  });
  return parseResponse<T>(res, path);
}

export async function apiPatch<T = unknown>(
  path: string,
  body: unknown,
): Promise<{ code: number; msg: string; data: T }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(body),
  });
  return parseResponse<T>(res, path);
}

export async function apiDelete<T = unknown>(
  path: string,
  body?: unknown,
): Promise<{ code: number; msg: string; data: T }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      Authorization: `Bearer ${getToken()}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parseResponse<T>(res, path);
}

export async function apiUpload<T = unknown>(
  path: string,
  formData: FormData,
  timeoutMs = 120000,
): Promise<{ code: number; msg: string; data: T }> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`上传超时（>${Math.round(timeoutMs / 1000)}s），请稍后重试`)),
    timeoutMs,
  );

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getToken()}`,
      },
      body: formData,
      signal: controller.signal,
    });
    return res.json();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      const reason = controller.signal.reason;
      throw reason instanceof Error ? reason : new Error(`上传超时（>${Math.round(timeoutMs / 1000)}s），请稍后重试`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve workbench static asset URLs through the proxy. */
export function workbenchStaticUrl(path: string): string {
  if (!path) return path;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const staticPath = normalized.startsWith("/static/")
    ? normalized
    : normalized.startsWith("static/")
      ? `/${normalized}`
      : normalized;
  const directBase =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_WORKBENCH_STATIC_BASE?.replace(/\/$/, "")
      : "";
  if (directBase && staticPath.startsWith("/static/")) {
    return `${directBase}${staticPath}`;
  }
  if (staticPath.startsWith("/static/")) return `/api/workbench${staticPath}`;
  return path;
}

export const WORKBENCH_API_BASE = API_BASE;

/** Prefix `/api/...` paths with the Next.js workbench proxy base. */
export function resolveWorkbenchApiUrl(path: string): string {
  if (!path) return path;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  if (path.startsWith("/api/workbench")) return path;
  if (path.startsWith("/api/")) return `${API_BASE}${path}`;
  if (path.startsWith("/static/")) return `${API_BASE}${path}`;
  return path;
}

/** Raw fetch through `/api/workbench` with auth header. */
export function workbenchFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = getToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(resolveWorkbenchApiUrl(path), {
    cache: "no-store",
    ...init,
    headers,
  });
}
