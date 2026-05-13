"use client";

import { useCallback, useRef, useState } from "react";
import { Loader2, Upload, ZoomIn } from "lucide-react";
import type { ImageFieldValue, ImageUploadField } from "@/types/workflow";
import { getAtPath } from "@/lib/workflow-utils";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { LightboxModal } from "@/components/WorkflowForm/LightboxModal";

/**
 * 首帧 / 尾帧等「图片上传」控件（原虚线预览 + 选择图片区域，语义上即 ImageUploadPreview）。
 *
 * 文生图工作流参考（图生视频 SKU 中的图片字段另见对应 mock）：
 * - `RUNNINGHUB_TXT2IMG_REMOTE_WORKFLOW_ID`、`RUNNINGHUB_TXT2IMG_WORKFLOW_FILE` / `_JSON`
 * - `rh-txt2img-shortdrama` / `RH_TXT2IMG_SHORTDRAMA` / `RUNNINGHUB_TXT2IMG`
 * - 字段与节点映射：`src/mocks/text-to-image-workflow.ts`
 */
export interface ImageUploadControlProps {
  field: ImageUploadField;
  error?: string;
}

export function ImageUploadControl({ field, error }: ImageUploadControlProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const path = useWorkflowStore((s) => s.fieldPaths[field.id]);
  const value = useWorkflowStore((s) =>
    path ? (getAtPath(s.parameters, path) as ImageFieldValue | undefined) : undefined
  );
  const applyImageFile = useWorkflowStore((s) => s.applyImageFile);
  const clearImageField = useWorkflowStore((s) => s.clearImageField);

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const accept = field.validation?.accept?.join(",") ?? "image/*";
  const v = value ?? ({ status: "empty" } satisfies ImageFieldValue);

  const triggerFilePick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  /** 优先使用本地 blob（`previewUrl`），不把下游用的 `remoteUrl` 当作缩略图，避免与所选文件不一致。 */
  const displayUrl =
    v.previewUrl && (v.status === "uploading" || v.status === "ready" || v.status === "error")
      ? v.previewUrl
      : v.status === "ready" && v.remoteUrl
        ? v.remoteUrl
        : null;

  const handleOpenLightbox = useCallback(() => {
    if (v.status !== "ready") return;
    const url = v.previewUrl ?? v.remoteUrl;
    if (!url) return;
    setLightboxUrl(url);
    setLightboxOpen(true);
  }, [v.previewUrl, v.remoteUrl, v.status]);

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
    setLightboxUrl(null);
  }, []);

  const dashedFrameClass = `relative flex h-[180px] w-[250px] shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed bg-neutral-50 ${
    error ? "border-red-300" : "border-neutral-200"
  }`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start gap-3">
        <div
          className={[
            dashedFrameClass,
            v.status === "error" && !displayUrl ? "cursor-pointer" : "",
          ].join(" ")}
          onClick={
            v.status === "error" && !displayUrl
              ? () => {
                  triggerFilePick();
                }
              : undefined
          }
          onKeyDown={
            v.status === "error" && !displayUrl
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    triggerFilePick();
                  }
                }
              : undefined
          }
          role={v.status === "error" && !displayUrl ? "button" : undefined}
          tabIndex={v.status === "error" && !displayUrl ? 0 : undefined}
        >
          {displayUrl && v.status === "uploading" ? (
            <div className="relative flex h-full w-full items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={displayUrl}
                alt=""
                className="h-full w-full object-contain opacity-50 saturate-75"
                draggable={false}
              />
              <div
                className="absolute inset-0 flex cursor-wait flex-col items-center justify-center gap-2 bg-white/35 px-3 text-center backdrop-blur-md"
                aria-busy="true"
                aria-live="polite"
              >
                <Loader2 className="h-9 w-9 shrink-0 animate-spin text-neutral-800" strokeWidth={2} aria-hidden />
                <span className="text-sm font-medium text-neutral-900">正在上传至云端...</span>
                <span className="text-xs text-neutral-600">请稍候，上传完成前无法提交生成</span>
              </div>
            </div>
          ) : displayUrl && v.status === "error" ? (
            <button
              type="button"
              className="group relative flex h-full w-full cursor-pointer items-center justify-center p-0 text-left"
              onClick={triggerFilePick}
              aria-label="上传失败，点击重新选择图片"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={displayUrl}
                alt=""
                className="h-full w-full object-contain opacity-75 saturate-90"
                draggable={false}
              />
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-red-950/25 px-3 backdrop-blur-[6px] transition-opacity group-hover:bg-red-950/35">
                <Upload className="h-7 w-7 text-white drop-shadow" strokeWidth={1.5} aria-hidden />
                <span className="text-center text-xs font-semibold text-white drop-shadow">
                  上传失败，点击重新上传
                </span>
              </div>
            </button>
          ) : displayUrl ? (
            <button
              type="button"
              className="group relative flex h-full w-full cursor-pointer items-center justify-center p-0 text-left"
              onClick={handleOpenLightbox}
              aria-label="点击放大观看"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={displayUrl} alt="" className="h-full w-full object-contain" />
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/50 opacity-0 backdrop-blur-[2px] transition-opacity duration-200 group-hover:opacity-100">
                <ZoomIn className="h-8 w-8 text-white drop-shadow" strokeWidth={1.5} />
                <span className="px-2 text-center text-xs font-medium text-white drop-shadow">
                  点击放大观看
                </span>
              </div>
            </button>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 px-3">
              <Upload className="h-9 w-9 text-neutral-300" strokeWidth={1.25} aria-hidden />
              <span className="text-center text-xs text-neutral-400">暂无预览</span>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
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
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={v.status === "uploading"}
              onClick={triggerFilePick}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {v.status === "ready" ? "更换图片" : "选择图片"}
            </button>
            {(v.status === "ready" || v.status === "error" || v.status === "uploading") && (
              <button
                type="button"
                disabled={v.status === "uploading"}
                onClick={() => clearImageField(field.id)}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                清除
              </button>
            )}
          </div>
          {v.fileName && <p className="truncate text-xs text-neutral-500">已选：{v.fileName}</p>}
          {v.status === "ready" && v.remoteUrl && (
            <p className="break-all text-xs text-emerald-700">远端：{v.remoteUrl}</p>
          )}
          {v.status === "error" && (
            <p className="text-xs text-red-600">{v.errorMessage ?? "上传失败"}</p>
          )}
        </div>
      </div>
      {field.description && <p className="text-xs text-neutral-500">{field.description}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}

      <LightboxModal open={lightboxOpen} imageUrl={lightboxUrl} onClose={closeLightbox} />
    </div>
  );
}
