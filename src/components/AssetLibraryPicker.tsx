"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { ASSET_CATEGORIES } from "@workbench/lib/constants";
import { parseAssetListResponse } from "@workbench/lib/asset-list";
import { useLanguage } from "@workbench/lib/LanguageContext";

export interface PickedAsset {
  id: number;
  url: string;
  fileName: string;
  category?: string;
}

interface AssetRecord {
  id: number;
  url: string;
  filename?: string;
  category?: string;
  tags?: Array<{ name?: string; name_en?: string; name_zh?: string }>;
}

interface Props {
  open: boolean;
  onSelect: (asset: PickedAsset) => void;
  onClose: () => void;
}

const CATEGORY_OPTIONS = [
  { value: "", label: "全部" },
  ...ASSET_CATEGORIES.map((item) => ({ value: item.value, label: item.label })),
];

function resolveAssetUrl(rawUrl: unknown): string {
  const value = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/api/workbench")) return value;
  if (value.startsWith("/static/")) return `/api/workbench${value}`;
  return value;
}

function resolvePreviewUrl(rawUrl: unknown): string {
  const value = resolveAssetUrl(rawUrl);
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (typeof window !== "undefined" && value.startsWith("/api/workbench")) {
    return `${window.location.origin}${value}`;
  }
  return value;
}

export function AssetLibraryPicker({ open, onSelect, onClose }: Props) {
  const { t } = useLanguage();
  const [mounted, setMounted] = useState(false);
  const [items, setItems] = useState<AssetRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AssetRecord | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const load = useCallback(async (nextCategory: string) => {
    setLoading(true);
    try {
      const token = localStorage.getItem("workbench_token") ?? "";
      const query = nextCategory
        ? `?category=${encodeURIComponent(nextCategory)}&page=1&page_size=48`
        : "?page=1&page_size=48";
      const response = await fetch(`/api/workbench/api/assets${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data?.code === 0) {
        setItems(parseAssetListResponse(data.data) as AssetRecord[]);
      } else {
        setItems([]);
      }
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load(category);
  }, [open, category, load]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) => {
      const tagText =
        item.tags
          ?.map((tag) => `${tag.name ?? ""} ${tag.name_en ?? ""} ${tag.name_zh ?? ""}`.trim())
          .join(" ")
          .toLowerCase() ?? "";
      return (
        (item.filename ?? "").toLowerCase().includes(keyword) ||
        (item.category ?? "").toLowerCase().includes(keyword) ||
        tagText.includes(keyword)
      );
    });
  }, [items, search]);

  const confirmSelection = (item: AssetRecord) => {
    onSelect({
      id: item.id,
      url: resolveAssetUrl(item.url),
      fileName: item.filename || `asset-${item.id}.png`,
      category: item.category,
    });
    onClose();
  };

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="relative flex w-[920px] max-w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        style={{ height: "min(82vh, calc(100vh - 2rem))" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{t("从素材库选择")}</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {t("支持全部素材分类，选中后自动导入当前工作流")}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-xl leading-none text-gray-400 hover:text-gray-600">
            ×
          </button>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-gray-100 px-6 py-3">
          <select
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setSelected(null);
            }}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-400"
          >
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("搜索文件名或标签...")}
            className="ml-auto w-56 rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-400"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">{t("加载中")}...</div>
          ) : filtered.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">{t("暂无素材")}</div>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
              {filtered.map((item) => {
                const isSelected = selected?.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (isSelected) {
                        confirmSelection(item);
                        return;
                      }
                      setSelected(item);
                    }}
                    className={`group relative aspect-square overflow-hidden rounded-xl border-2 transition-all ${
                      isSelected ? "border-blue-500 shadow-md" : "border-transparent hover:border-blue-200"
                    }`}
                  >
                    <img
                      src={resolvePreviewUrl(item.url)}
                      alt={item.filename || ""}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                    {isSelected && (
                      <div className="absolute inset-0 flex items-center justify-center bg-blue-500/20">
                        <div className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-medium text-white">✓</div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-gray-100 bg-white px-6 py-4">
          <div className="min-w-0 pr-4 text-sm text-gray-500">
            {selected
              ? `${t("已选择")} #${selected.id} · ${t("再次点击或点确认")}`
              : `${t("共")} ${filtered.length} ${t("项")} · ${t("点击图片选择")}`}
          </div>
          <div className="flex shrink-0 gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              {t("取消")}
            </button>
            <button
              type="button"
              disabled={!selected}
              onClick={() => selected && confirmSelection(selected)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {t("确认选择")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
