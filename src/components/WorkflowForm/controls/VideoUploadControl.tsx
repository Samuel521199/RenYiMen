"use client";

import { useCallback, useRef } from "react";
import { AudioLines, CircleAlert, Clock3, Loader2, RotateCcw, Upload, Video } from "lucide-react";
import type { ImageFieldValue } from "@/types/workflow";
import type { VideoUploadField } from "@/types/workflow";
import {
  getAtPath,
  mediaDurationRangeText,
  resolveMediaDurationRange,
  validateMediaDuration,
} from "@/lib/workflow-utils";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { useT } from "@/i18n";
import { useFileDrop } from "@/components/WorkflowForm/controls/useFileDrop";
import { AudioPlayer } from "@/components/media/AudioPlayer";

export interface VideoUploadControlProps {
  field: VideoUploadField;
  error?: string;
  locale?: "zh" | "en";
}

function extractedMp3Name(fileName: string | undefined): string {
  const base = (fileName || "video").replace(/\.[^.]+$/, "");
  return `${base}.mp3`;
}

export function VideoUploadControl({ field, error, locale = "zh" }: VideoUploadControlProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const path = useWorkflowStore((s) => s.fieldPaths[field.id]);
  const value = useWorkflowStore((s) =>
    path ? (getAtPath(s.parameters, path) as ImageFieldValue | undefined) : undefined
  );
  const parameters = useWorkflowStore((s) => s.parameters);
  const fieldPaths = useWorkflowStore((s) => s.fieldPaths);
  /** 视频文件复用图片上传通道（OSS presign → PUT）*/
  const applyImageFile = useWorkflowStore((s) => s.applyImageFile);
  const setFieldValue = useWorkflowStore((s) => s.setFieldValue);

  const accept = field.validation?.accept?.join(",") ?? "video/mp4,video/webm,video/quicktime,video/*";
  const v = value ?? ({ status: "empty" } satisfies ImageFieldValue);
  const hasDynamicDuration = field.validation?.durationRangeByFieldValue != null;
  const durationRange = resolveMediaDurationRange(field, parameters, fieldPaths);
  const rangeText = hasDynamicDuration ? mediaDurationRangeText(durationRange, locale) : "";
  const dynamicDurationError = hasDynamicDuration && v.status === "ready"
    ? validateMediaDuration(field, v.durationSec, parameters, fieldPaths, locale)
    : null;
  const displayError = error ?? dynamicDurationError ?? (v.status === "error" ? v.errorMessage : undefined);

  const triggerFilePick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const extractAudio = useCallback(async (sourceUrl: string, sourceFileName?: string) => {
    const before = useWorkflowStore.getState();
    const currentPath = before.fieldPaths[field.id];
    const current = currentPath
      ? getAtPath(before.parameters, currentPath) as ImageFieldValue | undefined
      : undefined;
    if (current?.status !== "ready" || current.remoteUrl !== sourceUrl) return;
    setFieldValue(field.id, {
      ...current,
      extractedAudio: { status: "extracting", fileName: extractedMp3Name(sourceFileName) },
    } satisfies ImageFieldValue);

    try {
      const response = await fetch("/api/media/extract-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ sourceUrl }),
      });
      const raw: unknown = await response.json().catch(() => null);
      const audio = raw && typeof raw === "object" && "audio" in raw
        ? (raw as { audio?: unknown }).audio
        : null;
      const remoteUrl = audio && typeof audio === "object" && "url" in audio
        ? (audio as { url?: unknown }).url
        : undefined;
      const durationSeconds = audio && typeof audio === "object" && "durationSeconds" in audio
        ? (audio as { durationSeconds?: unknown }).durationSeconds
        : undefined;
      if (!response.ok || typeof remoteUrl !== "string" || !/^https?:\/\//i.test(remoteUrl)) {
        const message = raw && typeof raw === "object" && "error" in raw
          ? (raw as { error?: unknown }).error
          : undefined;
        throw new Error(typeof message === "string" ? message : "MP4 声音提取失败");
      }

      const latest = useWorkflowStore.getState();
      const latestPath = latest.fieldPaths[field.id];
      const latestValue = latestPath
        ? getAtPath(latest.parameters, latestPath) as ImageFieldValue | undefined
        : undefined;
      if (latestValue?.remoteUrl !== sourceUrl) return;
      setFieldValue(field.id, {
        ...latestValue,
        extractedAudio: {
          status: "ready",
          remoteUrl,
          fileName: extractedMp3Name(sourceFileName),
          ...(typeof durationSeconds === "number" && Number.isFinite(durationSeconds)
            ? { durationSec: durationSeconds }
            : typeof latestValue.durationSec === "number"
              ? { durationSec: latestValue.durationSec }
              : {}),
        },
      } satisfies ImageFieldValue);
    } catch (extractionError) {
      const latest = useWorkflowStore.getState();
      const latestPath = latest.fieldPaths[field.id];
      const latestValue = latestPath
        ? getAtPath(latest.parameters, latestPath) as ImageFieldValue | undefined
        : undefined;
      if (latestValue?.remoteUrl !== sourceUrl) return;
      setFieldValue(field.id, {
        ...latestValue,
        extractedAudio: {
          status: "error",
          fileName: extractedMp3Name(sourceFileName),
          errorMessage: extractionError instanceof Error ? extractionError.message : "MP4 声音提取失败",
        },
      } satisfies ImageFieldValue);
    }
  }, [field.id, setFieldValue]);

  const handleFiles = useCallback((files: File[]) => {
    const file = files[0];
    if (!file) return;
    void (async () => {
      await applyImageFile(field.id, file);
      if (!field.audioExtraction) return;
      const latest = useWorkflowStore.getState();
      const latestPath = latest.fieldPaths[field.id];
      const latestValue = latestPath
        ? getAtPath(latest.parameters, latestPath) as ImageFieldValue | undefined
        : undefined;
      if (latestValue?.status === "ready" && latestValue.remoteUrl) {
        await extractAudio(latestValue.remoteUrl, latestValue.fileName);
      }
    })();
  }, [applyImageFile, extractAudio, field.audioExtraction, field.id]);
  const { isDragging, dropZoneProps } = useFileDrop({
    disabled: v.status === "uploading",
    onFiles: handleFiles,
  });

  const dashedFrameClass = [
    "relative flex h-[176px] w-full min-w-0 max-w-full items-center justify-center overflow-hidden rounded-2xl border border-dashed bg-[#091526]/75 transition-all duration-300 hover:bg-[#0b1a2d]",
    isDragging ? "border-emerald-400 bg-emerald-400/10" : displayError ? "border-red-500/50" : "border-white/[0.14] hover:border-emerald-400/45",
  ].join(" ");

  return (
    <div className="min-w-0 max-w-full space-y-3 overflow-hidden">
      {/* Preview / drop zone */}
      <div className={dashedFrameClass} {...dropZoneProps}>
        {isDragging ? (
          <div className="flex flex-col items-center gap-2 px-4 text-emerald-300">
            <Upload className="h-9 w-9" strokeWidth={1.5} aria-hidden />
            <span className="text-sm font-medium">{t.uploadDropActive}</span>
          </div>
        ) : v.status === "uploading" ? (
          <div className="flex flex-col items-center gap-2 px-4">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-400" strokeWidth={2} />
            <span className="text-sm font-medium text-slate-300">{t.uploadUploading}</span>
            <span className="text-xs text-slate-500">{t.uploadWait}</span>
          </div>
        ) : v.status === "ready" ? (
          <div className="flex w-full min-w-0 max-w-full flex-col items-center gap-2 overflow-hidden px-4">
            <Video className="h-8 w-8 text-emerald-400" strokeWidth={1.5} />
            <p className="block w-full min-w-0 truncate text-center text-xs font-medium text-slate-300">
              {v.fileName ?? "video"}
            </p>
          </div>
        ) : v.status === "error" ? (
          <button
            type="button"
            onClick={triggerFilePick}
            className="flex flex-col items-center gap-2 px-4"
          >
            <Upload className="h-8 w-8 text-red-400" strokeWidth={1.5} />
            <span className="text-xs font-medium text-red-400">{t.uploadFailed}</span>
            {v.errorMessage && (
              <span className="text-xs text-red-400/70">{v.errorMessage}</span>
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={triggerFilePick}
            className="flex flex-col items-center gap-2 px-4"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.045]">
              <Video className="h-5 w-5 text-slate-400" strokeWidth={1.5} />
            </span>
            <span className="text-center text-xs font-medium text-slate-500">{t.uploadNoPreview}</span>
          </button>
        )}
      </div>

      {rangeText && (
        <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${dynamicDurationError
          ? "border-red-400/25 bg-red-400/10 text-red-300"
          : "border-sky-400/20 bg-sky-400/[0.07] text-sky-200"
        }`}>
          {dynamicDurationError
            ? <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            : <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
          <span>
            {locale === "en" ? "Duration for current motion mode: " : "当前动作模式时长："}
            {rangeText}
            {v.status === "ready" && typeof v.durationSec === "number"
              ? (locale === "en" ? `; uploaded ${v.durationSec.toFixed(1)}s` : `；已上传 ${v.durationSec.toFixed(1)} 秒`)
              : null}
          </span>
        </div>
      )}

      {field.audioExtraction && v.extractedAudio?.status === "extracting" && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.07] px-3 py-2.5 text-xs text-emerald-200">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          <span>{locale === "en" ? "Extracting and converting audio to MP3…" : "正在提取音轨并转换为 MP3…"}</span>
        </div>
      )}

      {field.audioExtraction && v.extractedAudio?.status === "ready" && v.extractedAudio.remoteUrl && (
        <div className="space-y-2.5 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.07] p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-200">
            <AudioLines className="h-4 w-4" aria-hidden />
            <span>
              {locale === "en" ? "Extracted MP3" : "已提取 MP3"}
              {typeof v.extractedAudio.durationSec === "number"
                ? (locale === "en" ? ` · ${v.extractedAudio.durationSec.toFixed(1)}s` : ` · ${v.extractedAudio.durationSec.toFixed(1)} 秒`)
                : null}
            </span>
          </div>
          <AudioPlayer src={v.extractedAudio.remoteUrl} />
        </div>
      )}

      {field.audioExtraction && v.extractedAudio?.status === "error" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-400/25 bg-red-400/10 px-3 py-2.5 text-xs text-red-300">
          <span>{v.extractedAudio.errorMessage || (locale === "en" ? "Audio extraction failed" : "MP4 声音提取失败")}</span>
          {v.remoteUrl && (
            <button
              type="button"
              onClick={() => void extractAudio(v.remoteUrl!, v.fileName)}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-300/25 px-2.5 py-1.5 font-medium hover:bg-red-300/10"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {locale === "en" ? "Retry" : "重新提取"}
            </button>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex min-w-0 max-w-full flex-wrap gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) handleFiles([file]);
          }}
        />
        <button
          type="button"
          disabled={v.status === "uploading"}
          onClick={triggerFilePick}
          className="rounded-xl bg-emerald-500/90 px-3.5 py-2 text-xs font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {v.status === "ready"
            ? locale === "en" ? "Change video" : "更换视频"
            : locale === "en" ? "Select video" : "选择视频"}
        </button>
        {v.fileName && v.status !== "ready" && (
          <span className="min-w-0 max-w-full self-center truncate text-xs text-slate-500">{t.uploadFileName(v.fileName)}</span>
        )}
      </div>

      {displayError && <p className="text-xs text-red-400">{displayError}</p>}
    </div>
  );
}
