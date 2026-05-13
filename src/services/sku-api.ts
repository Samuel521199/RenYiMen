import { ApiError } from "@/services/api-client";
import type { SkuCatalogResponse } from "@/types/sku-catalog";

export interface FetchSkusOptions {
  timeoutMs?: number;
}

/**
 * 拉取工作流目录（同域 Next Route `GET /api/skus`，响应内仍为 `skus` 字段）。
 */
export async function fetchSkus(options?: FetchSkusOptions): Promise<SkuCatalogResponse> {
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch("/api/skus", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = text;
    }

    if (!res.ok) {
      throw new ApiError(typeof data === "object" && data && "error" in data ? String((data as { error?: string }).error) : res.statusText, res.status, data);
    }

    if (!data || typeof data !== "object" || !("skus" in data) || !Array.isArray((data as SkuCatalogResponse).skus)) {
      throw new ApiError("工作流目录格式异常", res.status, data);
    }

    return data as SkuCatalogResponse;
  } finally {
    clearTimeout(id);
  }
}
