export interface GallerySubCategory {
  code: string;
  label: string;
  label_en?: string;
}

export interface GalleryCategory {
  code: string;
  label: string;
  label_en?: string;
  count: number;
  sub_categories: GallerySubCategory[];
}

export interface GalleryFilterState {
  selectedSourceType: string | null;
  selectedSubCategory: string | null;
  selectedTag: string | null;
}

export function buildGalleryQuery({
  selectedSourceType,
  selectedSubCategory,
  selectedTag,
}: GalleryFilterState): string {
  const params = new URLSearchParams();
  if (selectedSourceType) params.set("source_type", selectedSourceType);
  if (selectedSubCategory) params.set("sub_category", selectedSubCategory);
  if (selectedTag) params.set("style_tag", selectedTag);
  return params.toString();
}

export function normalizeGalleryCategories(input: unknown): GalleryCategory[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const code = typeof record.code === "string" ? record.code.trim() : "";
      const label = typeof record.label === "string" ? record.label.trim() : "";
      const label_en = typeof record.label_en === "string" ? record.label_en.trim() : undefined;
      if (!code || !label) return null;

      const subCategories = Array.isArray(record.sub_categories)
        ? record.sub_categories
            .map<GallerySubCategory | null>((subItem) => {
              if (!subItem || typeof subItem !== "object") return null;
              const subRecord = subItem as Record<string, unknown>;
              const subCode = typeof subRecord.code === "string" ? subRecord.code.trim() : "";
              const subLabel = typeof subRecord.label === "string" ? subRecord.label.trim() : "";
              if (!subCode || !subLabel) return null;
              return { code: subCode, label: subLabel, label_en: subLabel };
            })
            .filter((subItem): subItem is GallerySubCategory => subItem !== null)
        : [];

      const category: GalleryCategory = {
        code,
        label,
        count: typeof record.count === "number" ? record.count : Number(record.count || 0),
        sub_categories: subCategories,
      };
      if (label_en) category.label_en = label_en;
      return category;
    })
    .filter((item): item is GalleryCategory => item !== null);
}

export function normalizeGalleryTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}
