export type AssetGridSize = "large" | "medium" | "small";

export interface AssetGridDisplayConfig {
  value: AssetGridSize;
  label: string;
  columns: number;
  gridClassName: string;
  imageClassName: string;
}

export const ASSET_GRID_SIZE_OPTIONS: AssetGridDisplayConfig[] = [
  {
    value: "small",
    label: "小",
    columns: 10,
    gridClassName: "grid gap-2 grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10",
    imageClassName: "aspect-square w-full object-contain",
  },
  {
    value: "medium",
    label: "中",
    columns: 8,
    gridClassName: "grid gap-3 grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8",
    imageClassName: "aspect-square w-full object-contain",
  },
  {
    value: "large",
    label: "大",
    columns: 5,
    gridClassName: "grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
    imageClassName: "aspect-square w-full object-contain",
  },
];

export function getAssetGridDisplayConfig(size: string): AssetGridDisplayConfig {
  return ASSET_GRID_SIZE_OPTIONS.find((option) => option.value === size)
    || ASSET_GRID_SIZE_OPTIONS.find((option) => option.value === "large")
    || ASSET_GRID_SIZE_OPTIONS[0];
}

export function buildAssetCardMetaText(category: string, tags: string[]) {
  return [category, ...(Array.isArray(tags) ? tags : [])]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(" · ");
}

export function buildAssetCategoryButtonLabel(label: string, count?: number) {
  const safeCount = Number.isFinite(count) ? Number(count) : 0;
  return `${label} (${safeCount})`;
}

export function getAllAssetIds<T extends { id: number }>(assets: T[]) {
  const seen = new Set<number>();
  return (Array.isArray(assets) ? assets : []).reduce<number[]>((ids, asset) => {
    if (seen.has(asset.id)) return ids;
    seen.add(asset.id);
    ids.push(asset.id);
    return ids;
  }, []);
}

export function toggleAssetSelection(selectedIds: number[], assetId: number) {
  const safeSelectedIds = Array.isArray(selectedIds) ? selectedIds : [];
  return safeSelectedIds.includes(assetId)
    ? safeSelectedIds.filter((id) => id !== assetId)
    : [...safeSelectedIds, assetId];
}
