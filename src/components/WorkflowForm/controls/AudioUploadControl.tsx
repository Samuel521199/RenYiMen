"use client";

import { useCallback, useRef } from "react";
import { AudioLines, Loader2, Upload } from "lucide-react";
import type { AudioUploadField, ImageFieldValue } from "@/types/workflow";
import { getAtPath } from "@/lib/workflow-utils";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { useT } from "@/i18n";

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
  const applyImageFile = useWorkflowStore((s) => s.applyImageFile);
  const accept = field.validation?.accept?.join(",") ?? "audio/mpeg,audio/wav,.mp3,.wav";
  const v = value ?? ({ status: "empty" } satisfies ImageFieldValue);
  const triggerFilePick = useCallback(() => inputRef.current?.click(), []);

  return (
    <div className="min-w-0 max-w-full space-y-2 overflow-hidden">
      <div className={`relative flex h-[160px] w-full min-w-0 max-w-full items-center justify-center overflow-hidden rounded-2xl border border-dashed bg-[#091526]/75 transition-all duration-300 hover:bg-[#0b1a2d] ${error ? "border-red-500/50" : "border-white/[0.14] hover:border-emerald-400/45"}`}>
        {v.status === "uploading" ? (
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

      <div className="flex min-w-0 max-w-full flex-wrap gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void applyImageFile(field.id, file);
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

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
