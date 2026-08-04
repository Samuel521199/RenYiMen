"use client";

import { useCallback, useRef } from "react";
import { AudioLines, Loader2, Upload } from "lucide-react";
import type { AudioUploadField, ImageFieldValue } from "@/types/workflow";
import { getAtPath } from "@/lib/workflow-utils";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { useT } from "@/i18n";
import { loc } from "@/components/WorkflowForm/DynamicForm";

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
      <div className={`relative flex h-[120px] w-full min-w-0 max-w-full items-center justify-center overflow-hidden rounded-lg border-2 border-dashed bg-[#1a2840] ${error ? "border-red-500/50" : "border-[#2a3d5e]"}`}>
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
            <AudioLines className="h-9 w-9 text-slate-600" strokeWidth={1.25} />
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
          className="rounded-lg bg-emerald-600/90 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {v.status === "ready" ? t.uploadChangeBtn : locale === "en" ? "Select audio" : "选择音频"}
        </button>
      </div>

      {field.description && (
        <p className="break-words text-xs text-slate-500">{loc(field.description, field.descriptionEn, locale)}</p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
