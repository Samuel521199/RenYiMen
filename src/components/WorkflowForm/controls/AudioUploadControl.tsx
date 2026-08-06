"use client";

import { useCallback, useRef } from "react";
import { AudioLines, CircleAlert, Clock3, Loader2, Upload } from "lucide-react";
import type { AudioUploadField, ImageFieldValue } from "@/types/workflow";
import {
  getAtPath,
  mediaDurationRangeText,
  resolveMediaDurationRange,
  validateMediaDuration,
} from "@/lib/workflow-utils";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { useT } from "@/i18n";
import { useFileDrop } from "@/components/WorkflowForm/controls/useFileDrop";

export interface AudioUploadControlProps {
  field: AudioUploadField;
  error?: string;
  locale?: "zh" | "en";
}

export function AudioUploadControl({ field, error, locale = "zh" }: AudioUploadControlProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const path = useWorkflowStore((s) => s.fieldPaths[field.id]);
  const value = useWorkflowStore((s) =>
    path ? (getAtPath(s.parameters, path) as ImageFieldValue | undefined) : undefined
  );
  const parameters = useWorkflowStore((s) => s.parameters);
  const fieldPaths = useWorkflowStore((s) => s.fieldPaths);
  const applyImageFile = useWorkflowStore((s) => s.applyImageFile);
  const accept = field.validation?.accept?.join(",") ?? "audio/mpeg,audio/wav,.mp3,.wav";
  const v = value ?? ({ status: "empty" } satisfies ImageFieldValue);
  const durationRange = resolveMediaDurationRange(field, parameters, fieldPaths);
  const rangeText = mediaDurationRangeText(durationRange, locale);
  const dynamicDurationError = v.status === "ready"
    ? validateMediaDuration(field, v.durationSec, parameters, fieldPaths, locale)
    : null;
  const displayError = error ?? dynamicDurationError ?? (v.status === "error" ? v.errorMessage : undefined);
  const triggerFilePick = useCallback(() => inputRef.current?.click(), []);
  const handleFiles = useCallback((files: File[]) => {
    const file = files[0];
    if (file) void applyImageFile(field.id, file);
  }, [applyImageFile, field.id]);
  const { isDragging, dropZoneProps } = useFileDrop({
    disabled: v.status === "uploading",
    onFiles: handleFiles,
  });

  return (
    <div className="min-w-0 max-w-full space-y-2 overflow-hidden">
      <div
        className={`relative flex h-[160px] w-full min-w-0 max-w-full items-center justify-center overflow-hidden rounded-2xl border border-dashed bg-[#091526]/75 transition-all duration-300 hover:bg-[#0b1a2d] ${isDragging ? "border-emerald-400 bg-emerald-400/10" : displayError ? "border-red-500/50" : "border-white/[0.14] hover:border-emerald-400/45"}`}
        {...dropZoneProps}
      >
        {isDragging ? (
          <div className="flex flex-col items-center gap-2 px-4 text-emerald-300">
            <Upload className="h-9 w-9" strokeWidth={1.5} aria-hidden />
            <span className="text-sm font-medium">{t.uploadDropActive}</span>
          </div>
        ) : v.status === "uploading" ? (
          <div className="flex flex-col items-center gap-2 px-4">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
            <span className="text-sm font-medium text-slate-300">{t.uploadUploading}</span>
          </div>
        ) : v.status === "ready" ? (
          <div className="flex w-full min-w-0 flex-col items-center gap-2 overflow-hidden px-4">
            <AudioLines className="h-8 w-8 text-emerald-400" strokeWidth={1.5} />
            <p className="block w-full truncate text-center text-xs font-medium text-slate-300">
              {v.fileName ?? "audio"}
            </p>
          </div>
        ) : v.status === "error" ? (
          <button type="button" onClick={triggerFilePick} className="flex flex-col items-center gap-2 px-4">
            <Upload className="h-8 w-8 text-red-400" />
            <span className="text-xs font-medium text-red-400">{t.uploadFailed}</span>
          </button>
        ) : (
          <button type="button" onClick={triggerFilePick} className="flex flex-col items-center gap-2 px-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.045]">
              <AudioLines className="h-5 w-5 text-slate-400" strokeWidth={1.5} />
            </span>
            <span className="text-center text-xs text-slate-500">
              {locale === "en" ? "No audio selected" : "暂未选择音频"}
            </span>
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

      <div className="flex min-w-0 max-w-full flex-wrap gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) handleFiles([file]);
          }}
        />
        <button
          type="button"
          disabled={v.status === "uploading"}
          onClick={triggerFilePick}
          className="rounded-xl bg-emerald-500/90 px-3.5 py-2 text-xs font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {v.status === "ready" ? t.uploadChangeBtn : locale === "en" ? "Select audio" : "选择音频"}
        </button>
      </div>

      {displayError && <p className="text-xs text-red-400">{displayError}</p>}
    </div>
  );
}
