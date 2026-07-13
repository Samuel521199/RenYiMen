"use client";

import { useCallback, useEffect, useState } from "react";

import { apiGet } from "@/lib/api";
import { useLanguage } from "@/lib/LanguageContext";

export interface PickedFrame {
  asset_id: number;
  url: string;
  source_type: "gallery" | "asset" | "frame";
  width?: number;
  height?: number;
}

interface Props {
  token: string;
  onSelect: (frame: PickedFrame) => void;
  onClose: () => void;
}

type TabKey = "gallery" | "asset" | "frame";

interface AssetTag {
  name: string;
  name_en?: string;
}

interface AssetItem {
  id: number;
  url: string;
  thumbnail_url?: string;
  tags?: AssetTag[];
  source_type: TabKey;
}

const TABS: { key: TabKey; zh: string; en: string }[] = [
  { key: "gallery", zh: "成品图库", en: "Gallery" },
  { key: "asset", zh: "素材库", en: "Assets" },
  { key: "frame", zh: "截帧库", en: "Frames" },
];

const TAB_API: Record<TabKey, string> = {
  gallery: "/api/gallery/finals?page=1&page_size=40",
  asset: "/api/assets?page=1&page_size=40",
  frame: "/api/assets?category=video_first_frame&page=1&page_size=40",
};

const BACKEND_BASE_URL = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

function resolveAssetUrl(rawUrl: unknown): string {
  const value = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `${BACKEND_BASE_URL}${value.startsWith("/") ? value : `/${value}`}`;
}

function normalizeItems(tab: TabKey, data: unknown): AssetItem[] {
  // gallery/finals returns a plain array directly
  // assets returns a plain array directly
  // Both are under res.data which apiGet unwraps from {code, data}
  const list: unknown[] = Array.isArray(data) ? data : [];
  return list.map((item) => {
    const r = item as Record<string, unknown>;
    const url = resolveAssetUrl(r.image_url ?? r.url);
    const thumbnailUrl = resolveAssetUrl(r.thumbnail_url ?? r.image_url ?? r.url);
    return {
      id: r.id as number,
      // gallery uses image_url, assets uses url
      url,
      thumbnail_url: thumbnailUrl,
      tags: (r.tags as AssetItem["tags"]) ?? [],
      source_type: tab,
    };
  });
}

export default function FirstFramePicker({ token, onSelect, onClose }: Props) {
  void token;

  const { t, lang } = useLanguage();
  const [tab, setTab] = useState<TabKey>("gallery");
  const [items, setItems] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AssetItem | null>(null);

  const load = useCallback(async (nextTab: TabKey) => {
    setLoading(true);
    setItems([]);
    try {
      const res = await apiGet(TAB_API[nextTab]);
      if (res?.code === 0) {
        setItems(normalizeItems(nextTab, res.data));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(tab);
  }, [load, tab]);

  const filtered = items.filter((item) => {
    if (!search) return true;
    const tagStr =
      item.tags
        ?.map((tag) => `${tag.name} ${tag.name_en ?? ""}`.trim())
        .join(" ")
        .toLowerCase() ?? "";
    return tagStr.includes(search.toLowerCase());
  });

  const handleConfirm = () => {
    if (!selected) return;
    console.log("[FirstFramePicker] confirm:", selected);
    onSelect({
      asset_id: selected.id,
      url: selected.url,
      source_type: selected.source_type,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="relative flex h-[80vh] w-[860px] max-w-[95vw] flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">{t("选择首帧")}</h2>
          <button onClick={onClose} className="text-xl leading-none text-gray-400 hover:text-gray-600">
            ×
          </button>
        </div>

        <div className="flex items-center gap-4 border-b border-gray-100 px-6 py-3">
          <div className="flex gap-1">
            {TABS.map((item) => (
              <button
                key={item.key}
                onClick={() => {
                  setTab(item.key);
                  setSelected(null);
                }}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                  tab === item.key ? "bg-blue-600 text-white" : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                {lang === "zh" ? item.zh : item.en}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("搜索标签...")}
            className="ml-auto w-48 rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-blue-400"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">{t("加载中...")}</div>
          ) : filtered.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">{t("暂无图片")}</div>
          ) : (
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-5">
              {filtered.map((item) => {
                const isSelected = selected?.id === item.id && selected?.source_type === item.source_type;
                return (
                  <button
                    key={`${item.source_type}-${item.id}`}
                    onClick={() => setSelected(isSelected ? null : item)}
                    className={`group relative aspect-square overflow-hidden rounded-xl border-2 transition-all ${
                      isSelected ? "border-blue-500 shadow-md" : "border-transparent hover:border-blue-200"
                    }`}
                  >
                    <img
                      src={item.thumbnail_url || item.url}
                      alt=""
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

        <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
          <div className="text-sm text-gray-500">
            {selected ? `${t("已选择")} · ${selected.source_type} #${selected.id}` : t("点击图片选择首帧")}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              {t("取消")}
            </button>
            <button
              onClick={handleConfirm}
              disabled={!selected}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {t("确认选择")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
