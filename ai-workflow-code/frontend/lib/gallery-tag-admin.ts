export const GALLERY_SOURCE_TYPES = [
  { code: "activity", label: "活动图" },
  { code: "share", label: "转发图" },
  { code: "daily", label: "日常互动图" },
  { code: "trending", label: "热点借势" },
  { code: "brand", label: "品牌故事" },
  { code: "game", label: "游戏感知" },
];

export interface ManagedGalleryTag {
  id: number;
  name: string;
  source_type: string;
  image_count: number;
  created_at?: string | null;
}

export function sourceTypeLabel(value: string) {
  return GALLERY_SOURCE_TYPES.find((item) => item.code === value)?.label || value;
}

export function normalizeManagedGalleryTags(input: unknown): ManagedGalleryTag[] {
  if (!Array.isArray(input)) return [];

  return input.reduce<ManagedGalleryTag[]>((result, item) => {
    if (!item || typeof item !== "object") return result;
    const record = item as Record<string, unknown>;
    const id = Number(record.id);
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const sourceType = typeof record.source_type === "string" ? record.source_type.trim() : "";
    if (!Number.isFinite(id) || !name || !sourceType) return result;

    result.push({
      id,
      name,
      source_type: sourceType,
      image_count:
        typeof record.image_count === "number"
          ? record.image_count
          : Number(record.image_count || 0),
      created_at: typeof record.created_at === "string" ? record.created_at : null,
    });
    return result;
  }, []);
}
