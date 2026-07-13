// @ts-nocheck
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import PageHeader from "@workbench/components/common/PageHeader";
import { apiGet } from "@workbench/lib/api";
import { useLanguage } from "@workbench/lib/LanguageContext";
import {
  buildGalleryQuery,
  normalizeGalleryCategories,
  type GalleryCategory,
} from "@workbench/lib/gallery-browser";
import { getTagLabel } from "@workbench/lib/tag-display";

const API_BASE = "/api/workbench";

interface FinalImage {
  id: number;
  image_url: string;
  task_id: number | null;
  source_type: string;
  sub_category: string | null;
  style_tag: string | null;
  created_at: string;
}

interface GalleryTagOption {
  name: string;
  name_en?: string | null;
  name_zh?: string | null;
}

function toImageUrl(url: string) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${API_BASE}${url}`;
}

function normalizeFinalImages(input: unknown): FinalImage[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const id = Number(record.id);
      const imageUrl = typeof record.image_url === "string" ? record.image_url : "";
      const sourceType = typeof record.source_type === "string" ? record.source_type : "";
      const createdAt = typeof record.created_at === "string" ? record.created_at : "";
      if (!Number.isFinite(id) || !imageUrl || !sourceType || !createdAt) return null;

      return {
        id,
        image_url: imageUrl,
        task_id: record.task_id == null ? null : Number(record.task_id),
        source_type: sourceType,
        sub_category: typeof record.sub_category === "string" ? record.sub_category : null,
        style_tag: typeof record.style_tag === "string" ? record.style_tag : null,
        created_at: createdAt,
      };
    })
    .filter((item): item is FinalImage => item !== null);
}

function normalizeGalleryTagOptions(input: unknown): GalleryTagOption[] {
  if (!Array.isArray(input)) return [];

  return input
    .map<GalleryTagOption | null>((item) => {
      if (typeof item === "string") {
        const name = item.trim();
        return name ? { name } : null;
      }
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name.trim() : "";
      if (!name) return null;
      return {
        name,
        name_en: typeof record.name_en === "string" ? record.name_en.trim() : null,
        name_zh: typeof record.name_zh === "string" ? record.name_zh.trim() : null,
      };
    })
    .filter((item): item is GalleryTagOption => item !== null);
}

export default function GalleryPage() {
  const { t, lang } = useLanguage();
  const [categories, setCategories] = useState<GalleryCategory[]>([]);
  const [tags, setTags] = useState<GalleryTagOption[]>([]);
  const [images, setImages] = useState<FinalImage[]>([]);
  const [selectedSourceType, setSelectedSourceType] = useState<string | null>(null);
  const [selectedSubCategory, setSelectedSubCategory] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    apiGet("/api/gallery/categories")
      .then((res) => {
        if (cancelled) return;
        setCategories(normalizeGalleryCategories(res.data));
      })
      .catch(() => {
        if (cancelled) return;
        setError(t("目录结构加载失败"));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const query = buildGalleryQuery({
      selectedSourceType,
      selectedSubCategory,
      selectedTag,
    });
    const finalsPath = query ? `/api/gallery/finals?${query}` : "/api/gallery/finals";
    const tagsPath = selectedSourceType
      ? `/api/gallery/tags?source_type=${encodeURIComponent(selectedSourceType)}`
      : "/api/gallery/tags";

    setLoading(true);
    setError("");

    Promise.all([apiGet(finalsPath), apiGet(tagsPath)])
      .then(([imageRes, tagRes]) => {
        if (cancelled) return;
        setImages(normalizeFinalImages(imageRes.data));
        setTags(normalizeGalleryTagOptions(tagRes.data));
      })
      .catch(() => {
        if (cancelled) return;
        setError(t("成品图库加载失败"));
        setImages([]);
        setTags([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSourceType, selectedSubCategory, selectedTag]);

  const selectedCategoryLabel = useMemo(() => {
    if (!selectedSourceType) return t("全部成品图");
    const category = categories.find((item) => item.code === selectedSourceType);
    if (!category) return t("成品图库");
    if (!selectedSubCategory) return lang === "zh" ? category.label : (category.label_en || category.label);
    const subCategory = category.sub_categories.find((item) => item.code === selectedSubCategory);
    return lang === "zh"
      ? (subCategory?.label || category.label)
      : (subCategory?.label_en || subCategory?.label || category.label_en || category.label);
  }, [categories, lang, selectedSourceType, selectedSubCategory, t]);
  const tagByName = useMemo(() => new Map(tags.map((tag) => [tag.name, tag] as const)), [tags]);
  const selectedTagLabel = selectedTag ? getTagLabel(tagByName.get(selectedTag) || selectedTag, lang) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("成品图库")}
        description={t("按大类、子目录和风格标签快速筛选已归档的最终图片")}
        action={
          <div className="flex items-center gap-2">
            <Link
              href="/workbench/gallery"
              className="rounded-full border border-emerald-500 bg-emerald-50 px-3 py-1.5 text-sm text-emerald-700"
            >
              {lang === "zh" ? "图片成品库" : "Image Gallery"}
            </Link>
            <Link
              href="/workbench/gallery/video"
              className="rounded-full border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition hover:border-blue-300 hover:text-blue-600"
            >
              {lang === "zh" ? "视频成品库" : "Video Gallery"}
            </Link>
          </div>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-6 lg:flex-row">
        <nav className="w-full shrink-0 rounded-xl border border-gray-200 bg-white p-3 lg:w-52">
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => {
                setSelectedSourceType(null);
                setSelectedSubCategory(null);
                setSelectedTag(null);
              }}
              className={`rounded-md px-3 py-2 text-left text-sm transition ${
                !selectedSourceType
                  ? "bg-emerald-50 font-medium text-emerald-700"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
                {t("全部成品图")}
            </button>

            {categories.map((category) => (
              <div key={category.code}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSourceType(category.code);
                    setSelectedSubCategory(null);
                    setSelectedTag(null);
                    setExpandedTypes((current) => {
                      const next = new Set(current);
                      if (next.has(category.code)) {
                        next.delete(category.code);
                      } else {
                        next.add(category.code);
                      }
                      return next;
                    });
                  }}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition ${
                    selectedSourceType === category.code && !selectedSubCategory
                      ? "bg-emerald-50 font-medium text-emerald-700"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
              <span>{lang === "zh" ? category.label : (category.label_en || category.label)}</span>
                  <span className="text-xs text-gray-400">{category.count > 0 ? category.count : ""}</span>
                </button>

                {expandedTypes.has(category.code) && category.sub_categories.length > 0 && (
                  <div className="mt-0.5 ml-3 flex flex-col gap-0.5">
                    {category.sub_categories.map((subCategory) => (
                      <button
                        key={subCategory.code}
                        type="button"
                        onClick={() => {
                          setSelectedSourceType(category.code);
                          setSelectedSubCategory(subCategory.code);
                          setSelectedTag(null);
                        }}
                        className={`rounded-md px-3 py-1.5 text-left text-xs transition ${
                          selectedSubCategory === subCategory.code
                            ? "bg-emerald-50 font-medium text-emerald-700"
                            : "text-gray-500 hover:bg-gray-100"
                        }`}
                      >
                        {lang === "zh" ? subCategory.label : (subCategory.label_en || subCategory.label)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </nav>

        <section className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
          <div className="mb-4 flex flex-col gap-2 border-b border-gray-100 pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900">{selectedCategoryLabel}</h2>
              <p className="mt-1 text-sm text-gray-500">
                {selectedTagLabel ? `${t("当前风格标签")}：${selectedTagLabel}` : t("可按风格标签进一步缩小范围")}
              </p>
            </div>
            <div className="text-sm text-gray-400">
              {images.length} {t("张图片")}
            </div>
          </div>

          {tags.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedTag(null)}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  !selectedTag
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                    : "border-gray-200 text-gray-500 hover:border-emerald-400"
                }`}
              >
                {t("全部")}
              </button>
              {tags.map((tag) => (
                <button
                  key={tag.name}
                  type="button"
                  onClick={() => setSelectedTag(tag.name === selectedTag ? null : tag.name)}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    selectedTag === tag.name
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                      : "border-gray-200 text-gray-500 hover:border-emerald-400"
                  }`}
                >
                  {getTagLabel(tag, lang)}
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-sm text-gray-400">{t("加载中")}</div>
          ) : images.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">{t("暂无图片")}</div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {images.map((image) => {
                const imageUrl = toImageUrl(image.image_url);

                return (
                  <div
                    key={image.id}
                    className="overflow-hidden rounded-lg border border-gray-200 bg-white"
                  >
                    <img
                      src={imageUrl}
                      alt={`Final image ${image.id}`}
                      className="aspect-square w-full cursor-pointer object-cover"
                      onClick={() => window.open(imageUrl, "_blank", "noopener,noreferrer")}
                    />
                    <div className="flex flex-col gap-1 p-2">
                      {image.style_tag && (
                        <span className="w-fit rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-600">
                          {image.style_tag}
                        </span>
                      )}
                      <span className="text-xs text-gray-500">
                        {new Date(image.created_at).toLocaleDateString("zh-CN")}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
