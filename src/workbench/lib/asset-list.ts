import type { Asset } from "@workbench/lib/types";

export interface AssetListPage {
  items: Asset[];
  total: number;
  page: number;
  page_size: number;
}

export function parseAssetListResponse(data: unknown): Asset[] {
  if (Array.isArray(data)) {
    return data as Asset[];
  }
  if (data && typeof data === "object" && Array.isArray((data as AssetListPage).items)) {
    return (data as AssetListPage).items;
  }
  return [];
}

export function parseAssetListPageResponse(
  data: unknown,
  fallbackPageSize = 48,
  requestedPage = 1,
): AssetListPage {
  if (data && typeof data === "object" && Array.isArray((data as AssetListPage).items)) {
    const payload = data as AssetListPage;
    const page_size = Number(payload.page_size ?? fallbackPageSize);
    const page = Number(payload.page ?? requestedPage);
    let items = payload.items;
    // 后端未正确 limit 时，前端仍只渲染当前页，避免一次展示全部素材
    if (items.length > page_size) {
      const start = (page - 1) * page_size;
      items = items.slice(start, start + page_size);
    }
    return {
      items,
      total: Number(payload.total ?? payload.items.length),
      page,
      page_size,
    };
  }
  if (Array.isArray(data)) {
    const total = data.length;
    const page_size = fallbackPageSize;
    const maxPage = Math.max(Math.ceil(total / page_size), 1);
    const page = Math.min(Math.max(requestedPage, 1), maxPage);
    const start = (page - 1) * page_size;
    return {
      items: data.slice(start, start + page_size),
      total,
      page,
      page_size,
    };
  }
  return {
    items: [],
    total: 0,
    page: 1,
    page_size: fallbackPageSize,
  };
}
