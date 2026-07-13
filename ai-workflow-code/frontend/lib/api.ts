// frontend/lib/api.ts
// 统一 API 请求封装

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

function getToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("token") || "";
}

export async function apiGet<T = any>(path: string): Promise<{ code: number; msg: string; data: T }> {
  const res = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${getToken()}`,
    },
  });
  return res.json();
}

export async function apiPost<T = any>(
  path: string,
  body: any,
  timeoutMs: number = 30000
): Promise<{ code: number; msg: string; data: T }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function apiPut<T = any>(
  path: string,
  body: any
): Promise<{ code: number; msg: string; data: T }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function apiPatch<T = any>(
  path: string,
  body: any
): Promise<{ code: number; msg: string; data: T }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function apiDelete<T = any>(
  path: string,
  body?: any
): Promise<{ code: number; msg: string; data: T }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      Authorization: `Bearer ${getToken()}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

export async function apiUpload<T = any>(
  path: string,
  formData: FormData,
  timeoutMs: number = 120000
): Promise<{ code: number; msg: string; data: T }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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
  } finally {
    clearTimeout(timer);
  }
}
