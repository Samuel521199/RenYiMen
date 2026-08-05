"use client";

import type { GenerationHistory } from "@prisma/client";
import { Box, Film, Trash2 } from "lucide-react";
import { inferMediaTypeFromResultUrl } from "@/lib/task-status-view";
import { cn } from "@/lib/utils";
import { useWorkflowStore } from "@/store/useWorkflowStore";

export interface HistoryFilmstripProps {
  history: GenerationHistory[];
  /** 当前主舞台正在回看的记录 ID（与 `taskId` 对齐） */
  activeId: string | null;
  /** 点击缩略图时切换选中项（通常传入 `setViewingHistoryId`） */
  onSelect: (taskId: string) => void;
}

/**
 * 云端生成历史的横向底片带：点击缩略图劫持主舞台；悬停可乐观删除单条。
 */
export function HistoryFilmstrip({ history, activeId, onSelect }: HistoryFilmstripProps) {
  const deleteCloudHistoryItem = useWorkflowStore((s) => s.deleteCloudHistoryItem);

  if (history.length === 0) return null;

  return (
    <div
      className={cn(
        "flex w-full shrink-0 gap-2.5 overflow-x-auto py-3",
        "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      )}
      role="list"
      aria-label="云端生成历史"
    >
      {history.map((item) => {
        const selected = item.taskId === activeId;
        const url = item.resultUrl?.trim() ?? "";
        const resolvedMedia =
          item.mediaType === "image" || item.mediaType === "video" || item.mediaType === "model"
            ? item.mediaType
            : url
              ? inferMediaTypeFromResultUrl(url)
              : "image";
        return (
          <div key={item.taskId} className="group relative shrink-0" role="listitem">
            <button
              type="button"
              onClick={() => onSelect(item.taskId)}
              className={cn(
                "relative flex h-[72px] w-[72px] overflow-hidden rounded-xl border border-white/[0.1] bg-[#0b1626] text-left shadow-lg shadow-black/20 outline-none transition-all duration-200 hover:-translate-y-0.5 hover:border-white/25 focus-visible:ring-2 focus-visible:ring-emerald-400/50",
                selected && "border-emerald-400/70 ring-2 ring-emerald-400/25"
              )}
              aria-pressed={selected}
              aria-label={`查看任务 ${item.taskId}`}
            >
              {!url ? (
                <div className="flex h-full w-full items-center justify-center text-[10px] text-neutral-400">
                  无预览
                </div>
              ) : resolvedMedia === "video" ? (
                <div className="relative h-full w-full">
                  <video
                    className="h-full w-full object-cover"
                    src={url}
                    muted
                    playsInline
                    preload="metadata"
                    tabIndex={-1}
                    aria-hidden
                  />
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35">
                    <Film className="h-6 w-6 text-white/95 drop-shadow" strokeWidth={1.5} aria-hidden />
                  </div>
                </div>
              ) : resolvedMedia === "model" ? (
                <div className="flex h-full w-full items-center justify-center bg-violet-950/40">
                  <Box className="h-8 w-8 text-violet-300" strokeWidth={1.25} aria-hidden />
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- 历史外链缩略图
                <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
              )}
            </button>
            <button
              type="button"
              className={cn(
                "absolute right-1 top-1 z-10 rounded-full bg-black/60 p-1 text-white opacity-0 shadow-sm transition-opacity",
                "hover:bg-red-500/80 focus-visible:opacity-100",
                "group-hover:opacity-100 group-focus-within:opacity-100"
              )}
              aria-label={`删除历史 ${item.taskId}`}
              onClick={(e) => {
                e.stopPropagation();
                void deleteCloudHistoryItem(item.taskId);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
