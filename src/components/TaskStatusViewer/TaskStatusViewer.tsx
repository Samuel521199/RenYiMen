"use client";

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LightboxModal } from "@/components/WorkflowForm/LightboxModal";
import { downloadResultImageAsPng } from "@/lib/download-result-image-png";
import { downloadResultVideoAsFile } from "@/lib/download-result-video";
import { computePseudoProgressPercent } from "@/lib/task-status-view";
import { cn } from "@/lib/utils";
import type { TaskStatusViewModel } from "@/types/task-status";
import { StoryboardResultGrid } from "./StoryboardResultGrid";
import { TextResultDisplay } from "./TextResultDisplay";

/** 与成功态画板一致的 20px 正交细线网格（#060a10 底） */
const ARTBOARD_GRID_STYLE: CSSProperties = {
  backgroundImage: `
    linear-gradient(rgba(148, 163, 184, 0.11) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.11) 1px, transparent 1px)
  `,
  backgroundSize: "20px 20px",
};

export interface TaskStatusViewerProps {
  /** 未提单、无任务时为 `null`，展示空闲画板 */
  model?: TaskStatusViewModel | null;
  /**
   * loading 时覆盖「预计总耗时」（毫秒），用于未写入 `model` 或临时调试。
   * 不传则使用 `model.expectedDurationMs`，再回退 150s。
   */
  expectedDurationMs?: number;
  /** 失败态下展示用户刚才的输入摘要，便于一键重试 */
  preservedParamsSlot?: ReactNode;
  onDownload?: () => void;
  onRegenerate?: () => void;
  /** 下载时建议文件名（图片经 Canvas 另存；视频经同源代理拉流后以 Blob 触发保存） */
  downloadFileName?: string;
  className?: string;
}

/**
 * 生成阶段画板式状态机：空闲占位、排队/生成中、成功播放、失败重试。
 * 主相使用透明度过渡切换。
 */
export function TaskStatusViewer({
  model = null,
  expectedDurationMs: expectedDurationMsProp,
  preservedParamsSlot,
  onDownload,
  onRegenerate,
  downloadFileName = "generated-video.mp4",
  className = "",
}: TaskStatusViewerProps) {
  if (model == null) {
    return (
      <section
        className={cn(
          "relative isolate min-h-[600px] overflow-hidden rounded-2xl border border-zinc-700/45 shadow-md lg:min-h-[calc(100vh-10rem)]",
          className
        )}
        aria-live="polite"
        aria-label="任务画板"
      >
        <IdleArtboard />
      </section>
    );
  }

  const loadingActive = model.phase === "loading";
  const successActive = model.phase === "success";
  const failureActive = model.phase === "failure";

  return (
    <section
      className={cn(
        "relative isolate flex min-h-[600px] flex-1 flex-col overflow-hidden rounded-2xl border border-[#1e2d4a] bg-[#0d1a2e] shadow-sm lg:min-h-[calc(100vh-10rem)]",
        className
      )}
      aria-live="polite"
    >
      {/*
        子层均为 absolute：若此处 min-height 过小，画板会被压成一条带并被 section 的 overflow-hidden 裁切。
        使用与视口相关的 min-height，保证成功态图片有足够纵向空间做 object-contain 预览。
      */}
      <div className="relative min-h-[min(64vh,640px)] w-full flex-1 p-6 lg:min-h-[calc(100vh-11rem)]">
        <LoadingLayer
          active={loadingActive}
          model={model}
          expectedDurationMs={expectedDurationMsProp}
        />
        <SuccessLayer
          active={successActive}
          model={model}
          onDownload={onDownload}
          onRegenerate={onRegenerate}
          downloadFileName={downloadFileName}
        />
        <FailureLayer
          active={failureActive}
          errorMessage={model.errorMessage}
          preservedParamsSlot={preservedParamsSlot}
          onRegenerate={onRegenerate}
        />
      </div>
    </section>
  );
}

function IdleArtboard() {
  return (
    <div className="relative flex min-h-[600px] flex-1 flex-col lg:min-h-[calc(100vh-10rem)]">
      <div className="pointer-events-none absolute inset-0 bg-[#060a10]" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.42]"
        style={ARTBOARD_GRID_STYLE}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_75%_55%_at_50%_42%,transparent_0%,rgba(0,0,0,0.55)_100%)]"
        aria-hidden
      />
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-5 px-6 py-16 text-center">
        <Sparkles
          className="h-20 w-20 text-sky-400/30 drop-shadow-[0_0_28px_rgba(56,189,248,0.2)]"
          strokeWidth={1}
          aria-hidden
        />
        <p className="max-w-sm text-sm font-medium tracking-wide text-slate-400/90">
          等待生成任务…
        </p>
        <p className="max-w-xs text-xs leading-relaxed text-slate-600">
          在左侧配置参数并点击「生成」，任务进度与结果将显示于此画板。
        </p>
      </div>
    </div>
  );
}

function layerClass(active: boolean) {
  return cn(
    "absolute inset-0 flex flex-col p-6 transition-all duration-300 ease-out",
    active ? "z-10 opacity-100" : "pointer-events-none z-0 opacity-0"
  );
}

/** 将毫秒格式化为 mm:ss；≥1h 时为 hh:mm:ss */
function formatClockMmSs(totalMs: number): string {
  const sec = Math.max(0, Math.floor(totalMs / 1000));
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (mm >= 60) {
    const hh = Math.floor(mm / 60);
    const m2 = mm % 60;
    return `${pad(hh)}:${pad(m2)}:${pad(ss)}`;
  }
  return `${pad(mm)}:${pad(ss)}`;
}

function LoadingLayer({
  active,
  model,
  expectedDurationMs: expectedProp,
}: {
  active: boolean;
  model: TaskStatusViewModel;
  expectedDurationMs?: number;
}) {
  const hints = model.hints?.length ? model.hints : ["正在处理…"];
  const [hintIndex, setHintIndex] = useState(0);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      setHintIndex((i) => (i + 1) % hints.length);
    }, 3800);
    return () => clearInterval(t);
  }, [active, hints.length]);

  const title = model.subPhase === "queued" ? "排队中" : "生成中";
  const subtitle =
    model.subPhase === "queued"
      ? "任务已进入队列，即将分配算力…"
      : "上游未提供细粒度进度，下方进度为根据预计耗时的平滑估算。";

  const elapsed = model.elapsedMs ?? 0;
  const expected = expectedProp ?? model.expectedDurationMs ?? 150_000;
  const barPct = computePseudoProgressPercent(elapsed, expected);

  return (
    <div className={layerClass(active)} aria-hidden={!active}>
      <div className="flex flex-1 flex-col gap-5">
        <header>
          <p className="text-xs font-medium uppercase tracking-widest text-slate-500">{title}</p>
          <h3 className="mt-1 text-base font-semibold text-slate-300">{subtitle}</h3>
        </header>

        {model.transportMessage && (
          <p className="rounded-lg border border-amber-500/25 bg-amber-900/20 px-3 py-2 text-xs text-amber-400">
            {model.transportMessage}
          </p>
        )}

        <div className="relative aspect-video w-full max-w-xl overflow-hidden rounded-xl bg-[#1a2840]">
          <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-[#1a2840] via-[#1e3050]/80 to-[#1a2840]" />
          <div className="absolute inset-4 flex flex-col justify-end gap-3">
            <div className="space-y-2">
              <div className="h-3 w-4/5 rounded bg-[#2a3d5e]/90" />
              <div className="h-3 w-3/5 rounded bg-[#2a3d5e]/70" />
              <div className="h-3 w-2/5 rounded bg-[#2a3d5e]/50" />
            </div>
          </div>
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="wf-shimmer-bar absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/5 to-transparent" />
          </div>
        </div>

        <div className="max-w-xl space-y-2">
          <p className="text-sm tabular-nums tracking-tight text-slate-400">
            已耗时: {formatClockMmSs(elapsed)} / 预计: {formatClockMmSs(expected)}
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1e2d4a]">
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-300 ease-out"
              style={{ width: `${barPct}%` }}
            />
          </div>
          <p className="text-right text-xs tabular-nums text-slate-500">
            约 {Math.round(barPct)}%（预估，完成后将显示 100%）
          </p>
        </div>

        <p
          key={hintIndex}
          className="max-w-xl text-sm leading-relaxed text-slate-500 transition-opacity duration-500"
        >
          {hints[hintIndex]}
        </p>
      </div>
    </div>
  );
}

function SuccessLayer({
  active,
  model,
  onDownload,
  onRegenerate,
  downloadFileName,
}: {
  active: boolean;
  model: TaskStatusViewModel;
  onDownload?: () => void;
  onRegenerate?: () => void;
  downloadFileName: string;
}) {
  // ── 所有 hooks 必须无条件置顶，不可在任何 return 之后 ──
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [imageDownloadBusy, setImageDownloadBusy] = useState(false);
  const [videoDownloadBusy, setVideoDownloadBusy] = useState(false);

  const mediaUrl = model.videoUrl;
  const mediaType: "image" | "video" | "text" | undefined =
    model.mediaType ?? (mediaUrl ? "video" : undefined);

  const isTextResult = mediaType === "text" || (typeof model.resultText === "string" && model.resultText.trim().length > 0);
  const isMultiImage = !isTextResult && Array.isArray(model.resultUrls) && model.resultUrls.length > 1;
  const showBilling =
    typeof model.sellPrice === "number" && Number.isFinite(model.sellPrice) && model.sellPrice >= 0;

  const resolvedDownloadName =
    model.mediaType === "image" && /\.mp4$/i.test(downloadFileName)
      ? "generated-image.png"
      : downloadFileName;

  const handleDownload = useCallback(async () => {
    if (onDownload) {
      onDownload();
      return;
    }
    if (!mediaUrl) return;

    if (mediaType === "image") {
      setImageDownloadBusy(true);
      try {
        await downloadResultImageAsPng(mediaUrl, resolvedDownloadName);
      } catch (e) {
        console.error("[TaskStatusViewer] 图片下载失败", e);
        window.alert(
          e instanceof Error ? e.message : "图片下载失败，请稍后重试或在预览图上右键另存为。"
        );
      } finally {
        setImageDownloadBusy(false);
      }
      return;
    }

    setVideoDownloadBusy(true);
    try {
      await downloadResultVideoAsFile(mediaUrl, resolvedDownloadName);
    } catch (e) {
      console.error("[TaskStatusViewer] 视频下载失败", e);
      window.alert(
        e instanceof Error ? e.message : "视频下载失败，请稍后重试或复制链接用下载工具获取。"
      );
    } finally {
      setVideoDownloadBusy(false);
    }
  }, [onDownload, mediaUrl, resolvedDownloadName, mediaType]);

  const resultHeadline =
    mediaType === "text" ? "提示词已生成" :
    !mediaUrl ? "预览地址缺失" :
    mediaType === "image" ? "图片已就绪" : "视频已就绪";

  const openImageLightbox = useCallback(() => {
    if (mediaType === "image" && mediaUrl) setLightboxOpen(true);
  }, [mediaType, mediaUrl]);

  useEffect(() => {
    if (!active) setLightboxOpen(false);
  }, [active]);

  // 纯文本输出模式（如提示词反推）：渲染文本区域（必须在所有 hooks 之后）
  if (isTextResult && model.resultText) {
    return (
      <div className={layerClass(active)} aria-hidden={!active}>
        <div className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-2">
          <TextResultDisplay text={model.resultText} />
          {showBilling && (
            <div className="shrink-0 rounded-lg border border-emerald-500/25 bg-emerald-900/20 px-3 py-2 text-xs text-emerald-400">
              ✅ 任务完成，实扣 {model.sellPrice} 积分
            </div>
          )}
          {onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              className="w-fit shrink-0 rounded-lg border border-[#2a3d5e] bg-[#1a2840] px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-[#3a5070] hover:text-slate-100"
            >
              重新生成
            </button>
          )}
        </div>
      </div>
    );
  }

  // 多图模式（分镜等）：渲染图片网格（必须在所有 hooks 之后）
  if (isMultiImage) {
    return (
      <div className={layerClass(active)} aria-hidden={!active}>
        <div className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          <StoryboardResultGrid imageUrls={model.resultUrls!} />
          {showBilling && (
            <div className="shrink-0 rounded-lg border border-emerald-500/25 bg-emerald-900/20 px-3 py-2 text-xs text-emerald-400">
              ✅ 任务完成，实扣 {model.sellPrice} 积分
            </div>
          )}
          {onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              className="w-fit shrink-0 rounded-lg border border-[#2a3d5e] bg-[#1a2840] px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-[#3a5070] hover:text-slate-100"
            >
              重新生成
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={layerClass(active)} aria-hidden={!active}>
      <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
        <header className="shrink-0">
          <p className="text-xs font-medium uppercase tracking-widest text-emerald-400">生成成功</p>
          <h3 className="mt-1 text-base font-semibold text-slate-200">{resultHeadline}</h3>
        </header>

        <div
          className={cn(
            "relative isolate min-h-0 overflow-hidden rounded-xl border border-zinc-700/50 shadow-inner ring-1 ring-white/[0.06]",
            mediaType === "image"
              ? "flex w-full flex-1 flex-col"
              : "max-w-2xl shrink-0"
          )}
        >
          <div className="pointer-events-none absolute inset-0 bg-[#060a10]" aria-hidden />
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.42]"
            style={ARTBOARD_GRID_STYLE}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_40%,transparent_0%,rgba(0,0,0,0.5)_100%)]"
            aria-hidden
          />
          <div
            className={cn(
              "relative z-10",
              mediaType === "image"
                ? "flex min-h-[min(52vh,520px)] flex-1 items-center justify-center p-3 sm:p-5 lg:min-h-[min(58vh,620px)]"
                : "p-2 sm:p-3"
            )}
          >
            {mediaUrl ? (
              mediaType === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element -- 任务结果外链，运行时 URL
                <img
                  src={mediaUrl}
                  alt="生成结果"
                  role="button"
                  tabIndex={0}
                  onClick={openImageLightbox}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openImageLightbox();
                    }
                  }}
                  className="mx-auto block max-h-[min(78vh,920px)] w-full max-w-full cursor-zoom-in rounded-lg object-contain shadow-lg ring-1 ring-white/10 transition-opacity hover:opacity-95"
                />
              ) : (
                <video
                  className="aspect-video w-full rounded-lg object-contain shadow-lg ring-1 ring-white/10"
                  src={mediaUrl}
                  controls
                  playsInline
                  autoPlay
                  muted
                  loop
                  preload="metadata"
                >
                  您的浏览器不支持视频播放。
                </video>
              )
            ) : (
              <div className="flex aspect-video items-center justify-center rounded-lg bg-black/20 text-sm text-slate-400">
                未提供预览地址
              </div>
            )}
          </div>
        </div>

        <div className="flex max-w-2xl shrink-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleDownload()}
              disabled={imageDownloadBusy || videoDownloadBusy}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-emerald-900/30 transition-all hover:from-emerald-400 hover:to-teal-400 disabled:cursor-wait disabled:opacity-60"
            >
              {imageDownloadBusy || videoDownloadBusy ? "正在准备下载…" : "下载"}
            </button>
            {onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                className="rounded-xl border border-[#2a3d5e] bg-[#1a2840] px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-[#3a5070] hover:text-slate-100"
              >
                重新生成
              </button>
            )}
          </div>
          {showBilling && (
            <Badge
              variant="secondary"
              className="h-auto w-full max-w-full whitespace-normal rounded-lg border border-emerald-500/25 bg-emerald-900/20 px-3 py-2 text-left text-xs font-normal leading-snug text-emerald-400 sm:w-auto sm:self-start"
            >
              ✅ 任务完成，实扣 {model.sellPrice} 积分
            </Badge>
          )}
        </div>
      </div>

      {mediaType === "image" && mediaUrl && (
        <LightboxModal
          open={lightboxOpen}
          imageUrl={mediaUrl}
          onClose={() => setLightboxOpen(false)}
          imageClassName="max-h-[95vh] max-w-[95vw] object-contain shadow-2xl"
        />
      )}
    </div>
  );
}

function FailureLayer({
  active,
  errorMessage,
  preservedParamsSlot,
  onRegenerate,
}: {
  active: boolean;
  errorMessage?: string;
  preservedParamsSlot?: ReactNode;
  onRegenerate?: () => void;
}) {
  return (
    <div className={layerClass(active)} aria-hidden={!active}>
      <div className="flex h-full min-h-[280px] flex-1 flex-col gap-4">
        <header>
          <p className="text-xs font-medium uppercase tracking-widest text-red-400">生成失败</p>
          <h3 className="mt-1 text-base font-semibold text-slate-300">未能完成本次任务</h3>
        </header>
        <div className="max-w-2xl rounded-xl border border-red-500/25 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          {errorMessage ?? "发生未知错误，请稍后重试。"}
        </div>
        {preservedParamsSlot && (
          <div className="max-w-2xl space-y-2">
            <p className="text-xs font-medium text-slate-500">您刚才提交的参数（可对照修改后重试）</p>
            <div className="rounded-lg border border-[#1e2d4a] bg-[#1a2840] p-3 text-xs text-slate-400">
              {preservedParamsSlot}
            </div>
          </div>
        )}
        {onRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            className="w-fit rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-emerald-900/30 transition-all hover:from-emerald-400 hover:to-teal-400"
          >
            使用相同参数重试
          </button>
        )}
      </div>
    </div>
  );
}
