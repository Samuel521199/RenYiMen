"use client";

import { useCallback, useRef } from "react";
import { Loader2, Upload, Video } from "lucide-react";
import type { ImageFieldValue } from "@/types/workflow";
import type { VideoUploadField } from "@/types/workflow";
import { getAtPath } from "@/lib/workflow-utils";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { useT } from "@/i18n";
import { uploadPickerButtonClass } from "@/components/WorkflowForm/controls/upload-control-styles";

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

  const accept = field.validation?.accept?.join(",") ?? "video/mp4,video/webm,video/quicktime,video/*";
  const v = value ?? ({ status: "empty" } satisfies ImageFieldValue);

  const triggerFilePick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const dashedFrameClass = [
    "relative flex h-[176px] w-full min-w-0 max-w-full items-center justify-center overflow-hidden rounded-2xl border border-dashed bg-[#091526]/75 transition-all duration-300 hover:bg-[#0b1a2d]",
    error ? "border-red-500/50" : "border-white/[0.14] hover:border-emerald-400/45",
  ].join(" ");

  return (
    <div className="min-w-0 max-w-full space-y-3 overflow-hidden">
      {/* Preview / drop zone */}
      <div className={dashedFrameClass}>
        {v.status === "uploading" ? (
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
            if (file) void applyImageFile(field.id, file);
          }}
        />
        <button
          type="button"
          disabled={v.status === "uploading"}
          onClick={triggerFilePick}
          className={uploadPickerButtonClass}
        >
          {v.status === "ready"
            ? locale === "en" ? "Change video" : "更换视频"
            : locale === "en" ? "Select video" : "选择视频"}
        </button>
        {v.fileName && v.status !== "ready" && (
          <span className="min-w-0 max-w-full self-center truncate text-xs text-slate-500">{t.uploadFileName(v.fileName)}</span>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
