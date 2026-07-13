"use client";

import { useCallback, useRef } from "react";
import { Loader2, Upload, Video } from "lucide-react";
import type { ImageFieldValue } from "@/types/workflow";
import type { VideoUploadField } from "@/types/workflow";
import { getAtPath } from "@/lib/workflow-utils";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { useT } from "@/i18n";
import { loc } from "@/components/WorkflowForm/DynamicForm";

export interface VideoUploadControlProps {
  field: VideoUploadField;
  error?: string;
  locale?: "zh" | "en";
}

export function VideoUploadControl({ field, error, locale = "zh" }: VideoUploadControlProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const path = useWorkflowStore((s) => s.fieldPaths[field.id]);
  const value = useWorkflowStore((s) =>
    path ? (getAtPath(s.parameters, path) as ImageFieldValue | undefined) : undefined
  );
  /** 视频文件复用图片上传通道（OSS presign → PUT）*/
  const applyImageFile = useWorkflowStore((s) => s.applyImageFile);
  const clearImageField = useWorkflowStore((s) => s.clearImageField);

  const accept = field.validation?.accept?.join(",") ?? "video/mp4,video/webm,video/quicktime,video/*";
  const v = value ?? ({ status: "empty" } satisfies ImageFieldValue);

  const triggerFilePick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const dashedFrameClass = [
    "relative flex h-[120px] w-full items-center justify-center overflow-hidden rounded-lg border-2 border-dashed bg-[#1a2840]",
    error ? "border-red-500/50" : "border-[#2a3d5e]",
  ].join(" ");

  return (
    <div className="space-y-2">
      {/* Preview / drop zone */}
      <div className={dashedFrameClass}>
        {v.status === "uploading" ? (
          <div className="flex flex-col items-center gap-2 px-4">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-400" strokeWidth={2} />
            <span className="text-sm font-medium text-slate-300">{t.uploadUploading}</span>
            <span className="text-xs text-slate-500">{t.uploadWait}</span>
          </div>
        ) : v.status === "ready" ? (
          <div className="flex w-full flex-col items-center gap-2 px-4">
            <Video className="h-8 w-8 text-emerald-400" strokeWidth={1.5} />
            <p className="max-w-full truncate text-center text-xs font-medium text-slate-300">
              {v.fileName ?? "video"}
            </p>
            {v.remoteUrl && (
              <p className="max-w-full truncate text-center text-[10px] text-emerald-500/70">
                {t.uploadRemoteUrl(v.remoteUrl)}
              </p>
            )}
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
            <Video className="h-9 w-9 text-slate-600" strokeWidth={1.25} />
            <span className="text-center text-xs text-slate-500">{t.uploadNoPreview}</span>
          </button>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void applyImageFile(field.id, file);
          }}
        />
        <button
          type="button"
          disabled={v.status === "uploading"}
          onClick={triggerFilePick}
          className="rounded-lg bg-emerald-600/90 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {v.status === "ready" ? t.uploadChangeBtn : t.uploadSelectBtn}
        </button>
        {(v.status === "ready" || v.status === "error" || v.status === "uploading") && (
          <button
            type="button"
            disabled={v.status === "uploading"}
            onClick={() => clearImageField(field.id)}
            className="rounded-lg border border-[#2a3d5e] px-3 py-1.5 text-sm text-slate-400 transition-colors hover:border-[#3a5070] hover:text-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t.uploadClearBtn}
          </button>
        )}
        {v.fileName && v.status !== "ready" && (
          <span className="self-center truncate text-xs text-slate-500">{t.uploadFileName(v.fileName)}</span>
        )}
      </div>

      {field.description && (
        <p className="text-xs text-slate-500">{loc(field.description, field.descriptionEn, locale)}</p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
