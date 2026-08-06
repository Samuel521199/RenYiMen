"use client";

import { Box, Download, Film, History, ImageIcon, LoaderCircle, Music2, PackageOpen } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { inferMediaTypeFromResultUrl } from "@/lib/task-status-view";
import { useLanguage } from "@/i18n";

type MediaType = "image" | "video" | "audio" | "model";
type FilterType = "all" | MediaType;

type HistoryAsset = {
  id: string;
  taskId: string;
  skuId: string;
  mediaType: string;
  resultUrl: string | null;
  createdAt: string;
};

const FILTERS: Array<{ value: FilterType; label: string; labelEn: string }> = [
  { value: "all", label: "全部资产", labelEn: "All assets" },
  { value: "image", label: "图片", labelEn: "Images" },
  { value: "video", label: "视频", labelEn: "Videos" },
  { value: "audio", label: "音频", labelEn: "Audio" },
  { value: "model", label: "3D 模型", labelEn: "3D models" },
];

function resolveMediaType(asset: HistoryAsset): MediaType {
  if (["image", "video", "audio", "model"].includes(asset.mediaType)) {
    return asset.mediaType as MediaType;
  }
  return inferMediaTypeFromResultUrl(asset.resultUrl ?? "");
}

function AssetPreview({ asset, mediaType }: { asset: HistoryAsset; mediaType: MediaType }) {
  const url = asset.resultUrl ?? "";
  if (mediaType === "video") {
    return <video src={url} className="h-full w-full object-cover" muted playsInline preload="metadata" />;
  }
  if (mediaType === "audio") {
    return <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_50%_35%,rgba(52,211,153,.2),transparent_48%),#081019]"><Music2 className="h-12 w-12 text-emerald-300" strokeWidth={1.25} /></div>;
  }
  if (mediaType === "model") {
    return <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_50%_35%,rgba(167,139,250,.22),transparent_50%),#090d17]"><Box className="h-14 w-14 text-violet-300" strokeWidth={1.15} /></div>;
  }
  // eslint-disable-next-line @next/next/no-img-element -- generated media can be an external persisted URL
  return <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />;
}

export default function GenerationHistoryLibraryPage() {
  const { locale } = useLanguage();
  const isEn = locale === "en";
  const searchParams = useSearchParams();
  const requestedType = searchParams.get("type");
  const initialFilter = FILTERS.some((filter) => filter.value === requestedType) ? requestedType as FilterType : "all";
  const [activeFilter, setActiveFilter] = useState<FilterType>(initialFilter);
  const [assets, setAssets] = useState<HistoryAsset[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setActiveFilter(initialFilter), [initialFilter]);

  const loadAssets = useCallback(async (cursor?: string) => {
    cursor ? setLoadingMore(true) : setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ limit: "48" });
      if (cursor) query.set("cursor", cursor);
      const response = await fetch(`/api/user/history/library?${query.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("history request failed");
      const payload = await response.json() as { items?: HistoryAsset[]; nextCursor?: string | null };
      const items = Array.isArray(payload.items) ? payload.items : [];
      setAssets((current) => cursor ? [...current, ...items] : items);
      setNextCursor(payload.nextCursor ?? null);
    } catch {
      setError(isEn ? "Failed to load your generation history." : "生成历史加载失败，请稍后重试");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [isEn]);

  useEffect(() => { void loadAssets(); }, [loadAssets]);

  const visibleAssets = useMemo(() => assets.filter((asset) => activeFilter === "all" || resolveMediaType(asset) === activeFilter), [activeFilter, assets]);

  return (
    <div className="min-h-full bg-[#05080d] px-5 py-10 text-white sm:px-8 lg:px-12 lg:py-14">
      <div className="mx-auto max-w-[1500px]">
        <div className="flex flex-col gap-7 border-b border-white/[0.09] pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.26em] text-[#9ef5d8]"><History className="h-4 w-4" />HERONHUB / {isEn ? "ASSET LIBRARY" : "个人资产库"}</div>
            <h1 className="text-[clamp(2.4rem,4.6vw,5rem)] font-black leading-none tracking-[-0.055em]">{isEn ? "Generation history" : "生成历史"}</h1>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-white/45">{isEn ? "Every successful image, video, audio, and 3D generation is kept here and loaded chronologically." : "所有成功生成的图片、视频、音频和 3D 资产都会按时间保存在这里，可继续翻阅更早的记录。"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((filter) => (
              <button key={filter.value} type="button" onClick={() => setActiveFilter(filter.value)} className={`rounded-full border px-4 py-2 text-xs transition ${activeFilter === filter.value ? "border-[#9ef5d8]/45 bg-[#9ef5d8]/10 text-[#b8ffe8]" : "border-white/[0.1] bg-white/[0.025] text-white/45 hover:border-white/25 hover:text-white/75"}`}>{isEn ? filter.labelEn : filter.label}</button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-[420px] items-center justify-center text-sm text-white/40"><LoaderCircle className="mr-3 h-5 w-5 animate-spin" />{isEn ? "Loading assets…" : "正在加载资产…"}</div>
        ) : error ? (
          <div className="flex min-h-[420px] flex-col items-center justify-center gap-5 text-center"><PackageOpen className="h-12 w-12 text-white/20" /><p className="text-sm text-rose-300/80">{error}</p><button type="button" onClick={() => void loadAssets()} className="rounded-full border border-white/15 px-5 py-2 text-sm text-white/70 hover:bg-white/5">{isEn ? "Try again" : "重新加载"}</button></div>
        ) : visibleAssets.length === 0 ? (
          <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 text-center"><PackageOpen className="h-14 w-14 text-white/15" /><p className="text-sm text-white/35">{isEn ? "No assets in this category yet." : "这个分类下还没有生成资产"}</p></div>
        ) : (
          <>
            <div className="grid gap-4 py-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visibleAssets.map((asset) => {
                const mediaType = resolveMediaType(asset);
                const TypeIcon = mediaType === "video" ? Film : mediaType === "audio" ? Music2 : mediaType === "model" ? Box : ImageIcon;
                return (
                  <article key={asset.id} className="group overflow-hidden rounded-2xl border border-white/[0.1] bg-[#09111a] transition hover:-translate-y-0.5 hover:border-white/20">
                    <a href={asset.resultUrl ?? "#"} target="_blank" rel="noreferrer" className="relative block aspect-[4/3] overflow-hidden bg-black/30">
                      <AssetPreview asset={asset} mediaType={mediaType} />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent opacity-70" />
                      <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full border border-white/15 bg-black/35 px-2.5 py-1 text-[9px] uppercase tracking-[0.13em] text-white/75 backdrop-blur"><TypeIcon className="h-3 w-3" />{mediaType}</span>
                      <span className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white/80 opacity-0 backdrop-blur transition group-hover:opacity-100"><Download className="h-4 w-4" /></span>
                    </a>
                    <div className="p-4">
                      <div className="truncate text-sm font-medium text-white/85">{asset.skuId}</div>
                      <div className="mt-2 text-[11px] text-white/35">{new Intl.DateTimeFormat(isEn ? "en" : "zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(asset.createdAt))}</div>
                    </div>
                  </article>
                );
              })}
            </div>
            {nextCursor ? <div className="flex justify-center pb-8"><button type="button" disabled={loadingMore} onClick={() => void loadAssets(nextCursor)} className="inline-flex min-w-36 items-center justify-center rounded-full border border-white/15 bg-white/[0.025] px-6 py-3 text-sm text-white/65 transition hover:bg-white/[0.06] disabled:opacity-50">{loadingMore ? <LoaderCircle className="h-4 w-4 animate-spin" /> : isEn ? "Load earlier" : "加载更早记录"}</button></div> : null}
          </>
        )}
      </div>
    </div>
  );
}
