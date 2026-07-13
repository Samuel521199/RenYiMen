import { useEffect, useState } from "react";

import { apiPost } from "@workbench/lib/api";

export type Language = "en" | "zh";

export interface TagOption {
  name: string;
  name_en?: string | null;
  name_zh?: string | null;
  group?: string | null;
  tag_group?: string | null;
}

function looksEnglish(value: string) {
  return /^[A-Za-z0-9 _-]+$/.test(value.trim());
}

export function getTagLabel(tag: TagOption | string, lang: Language = "zh"): string {
  const name = typeof tag === "string" ? tag : tag.name;

  if (typeof tag !== "string") {
    if (lang === "en" && tag.name_en) return tag.name_en;
    if (lang === "zh" && tag.name_zh) return tag.name_zh;
  }

  if (lang === "en" && looksEnglish(name)) return name;
  return name;
}

export function getTagHint(tag: TagOption, lang: Language = "zh"): string | null {
  if (lang === "en") {
    return tag.name_zh || null;
  }
  return tag.name_en || null;
}

export function resolveTagLabels(
  tags: TagOption[],
  lang: Language = "zh",
): Array<TagOption & { label: string; hint: string | null }> {
  return tags.map((tag) => ({
    ...tag,
    label: getTagLabel(tag, lang),
    hint: getTagHint(tag, lang),
  }));
}

export async function triggerMissingTranslations(
  tags: TagOption[],
  tagType: "asset" | "gallery" = "asset",
): Promise<Record<string, string>> {
  const missing = tags
    .filter((tag) => !tag.name_en && !looksEnglish(tag.name))
    .map((tag) => tag.name);

  if (missing.length === 0) return {};

  try {
    const res = await apiPost<{ translations?: Record<string, string> }>("/api/translate/tags", {
      names: missing,
      tag_type: tagType,
    });
    return res.data?.translations ?? {};
  } catch {
    return {};
  }
}

export function useTagsWithTranslation(
  rawTags: TagOption[],
  lang: Language = "zh",
  tagType: "asset" | "gallery" = "asset",
) {
  const [tags, setTags] = useState<Array<TagOption & { label: string; hint: string | null }>>(
    resolveTagLabels(rawTags, lang),
  );

  useEffect(() => {
    setTags(resolveTagLabels(rawTags, lang));

    if (lang !== "en") return;

    triggerMissingTranslations(rawTags, tagType).then((newMap) => {
      if (Object.keys(newMap).length === 0) return;
      setTags(
        rawTags.map((tag) => {
          const patched: TagOption = {
            ...tag,
            name_en: tag.name_en ?? newMap[tag.name] ?? null,
          };
          return {
            ...patched,
            label: getTagLabel(patched, lang),
            hint: getTagHint(patched, lang),
          };
        }),
      );
    });
  }, [rawTags, lang, tagType]);

  return { tags };
}
