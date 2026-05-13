import { appConfig } from "@/lib/config";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RequestOptions extends Omit<RequestInit, "signal"> {
  /** Abort after N ms (important for long-running AI jobs + polling). */
  timeoutMs?: number;
}

/**
 * Thin fetch wrapper: base URL, JSON helpers, timeout via AbortSignal.
 * All feature services should call through here (or extend this pattern).
 */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { timeoutMs = 60_000, headers, ...rest } = options;
  const url = `${appConfig.apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    });

    const text = await res.text();
    const data = text ? safeJsonParse(text) : undefined;

    if (!res.ok) {
      throw new ApiError(res.statusText || "Request failed", res.status, data);
    }

    return data as T;
  } finally {
    clearTimeout(id);
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export { fetchSkus, type FetchSkusOptions } from "@/services/sku-api";
