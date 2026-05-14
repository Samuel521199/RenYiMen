"use client";

import { useCallback, useState } from "react";
import { Download, ZoomIn } from "lucide-react";
import { LightboxModal } from "@/components/WorkflowForm/LightboxModal";
import { downloadResultImageAsPng } from "@/lib/download-result-image-png";
import { cn } from "@/lib/utils";

export interface StoryboardResultGridProps {
  /** 所有分镜图片 URL */
  imageUrls: string[];
  className?: string;
}

/**
 * 分镜多图网格：3 列响应式布局，每张图可放大预览并单独下载。
 */
export function StoryboardResultGrid({ imageUrls, className }: StoryboardResultGridProps) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [downloadingIndex, setDownloadingIndex] = useState<number | null>(null);

  const handleDownload = useCallback(async (url: string, index: number) => {
    setDownloadingIndex(index);
    try {
      await downloadResultImageAsPng(url, `storyboard-${String(index + 1).padStart(2, "0")}.png`);
    } catch (e) {
      console.error("[StoryboardResultGrid] 下载失败", e);
      window.alert(
        e instanceof Error ? e.message : "图片下载失败，请稍后重试或在预览图上右键另存为。"
      );
    } finally {
      setDownloadingIndex(null);
    }
  }, []);

  return (
    <div className={cn("w-full", className)}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-600">生成成功</p>
        <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-600">
          共 {imageUrls.length} 张分镜
        </span>
      </div>
      <h3 className="mb-4 text-lg font-semibold text-neutral-900">分镜已就绪，点击放大或逐张下载</h3>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4">
        {imageUrls.map((url, index) => (
          <StoryboardImageCard
            key={url}
            url={url}
            index={index}
            isDownloading={downloadingIndex === index}
            onZoom={() => setLightboxUrl(url)}
            onDownload={() => void handleDownload(url, index)}
          />
        ))}
      </div>

      {lightboxUrl && (
        <LightboxModal
          open
          imageUrl={lightboxUrl}
          onClose={() => setLightboxUrl(null)}
          imageClassName="max-h-[95vh] max-w-[95vw] object-contain shadow-2xl"
        />
      )}
    </div>
  );
}

function StoryboardImageCard({
  url,
  index,
  isDownloading,
  onZoom,
  onDownload,
}: {
  url: string;
  index: number;
  isDownloading: boolean;
  onZoom: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100 shadow-sm transition-shadow hover:shadow-md">
      {/* 序号角标 */}
      <span className="absolute left-2 top-2 z-10 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
        {String(index + 1).padStart(2, "0")}
      </span>

      {/* 图片区域 */}
      <div
        className="aspect-[9/16] w-full cursor-zoom-in overflow-hidden bg-neutral-200"
        onClick={onZoom}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onZoom();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={`分镜 ${index + 1}，点击放大`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={`分镜 ${index + 1}`}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          loading="lazy"
        />
      </div>

      {/* 操作栏（hover 显示） */}
      <div className="absolute inset-x-0 bottom-0 flex translate-y-full items-center justify-between gap-1.5 bg-gradient-to-t from-black/80 to-transparent px-2 pb-2 pt-6 transition-transform duration-200 group-hover:translate-y-0">
        <button
          type="button"
          onClick={onZoom}
          className="flex flex-1 items-center justify-center gap-1 rounded-md bg-white/20 px-2 py-1.5 text-xs font-medium text-white backdrop-blur-sm hover:bg-white/30"
          aria-label="放大查看"
        >
          <ZoomIn className="h-3.5 w-3.5" />
          放大
        </button>
        <button
          type="button"
          onClick={onDownload}
          disabled={isDownloading}
          className="flex flex-1 items-center justify-center gap-1 rounded-md bg-white/20 px-2 py-1.5 text-xs font-medium text-white backdrop-blur-sm hover:bg-white/30 disabled:cursor-wait disabled:opacity-60"
          aria-label={`下载第 ${index + 1} 张`}
        >
          <Download className="h-3.5 w-3.5" />
          {isDownloading ? "…" : "下载"}
        </button>
      </div>
    </div>
  );
}
