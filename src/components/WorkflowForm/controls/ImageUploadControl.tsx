"use client";

import { useCallback, useRef, useState } from "react";
import { Loader2, Upload, ZoomIn } from "lucide-react";
import type { ImageFieldValue, ImageUploadField } from "@/types/workflow";
import { getAtPath } from "@/lib/workflow-utils";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { LightboxModal } from "@/components/WorkflowForm/LightboxModal";
import { AssetLibraryPicker, type PickedAsset } from "@/components/AssetLibraryPicker";
import { useT } from "@/i18n";
import { loc } from "@/components/WorkflowForm/DynamicForm";

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
  locale?: "zh" | "en";
}

export function ImageUploadControl({ field, error, locale = "zh" }: ImageUploadControlProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const path = useWorkflowStore((s) => s.fieldPaths[field.id]);
  const value = useWorkflowStore((s) =>
    path ? (getAtPath(s.parameters, path) as ImageFieldValue | undefined) : undefined
  );
  const applyImageFile = useWorkflowStore((s) => s.applyImageFile);
  const applyImageFromAsset = useWorkflowStore((s) => s.applyImageFromAsset);
  const clearImageField = useWorkflowStore((s) => s.clearImageField);

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);

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

  const handleAssetSelect = useCallback(
    (asset: PickedAsset) => {
      void applyImageFromAsset(field.id, asset.url, asset.fileName);
    },
    [applyImageFromAsset, field.id],
  );

  const dashedFrameClass = `relative flex h-[180px] w-[250px] shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed bg-[#1a2840] ${
    error ? "border-red-500/50" : "border-[#2a3d5e]"
  }`;

  /** 虚线框的点击行为随状态而变，但元素本身始终是 div，避免 div↔button 切换引发 insertBefore */
  const handleFrameClick = useCallback(() => {
    if (v.status === "uploading") return;
    if (displayUrl && v.status !== "error") {
      handleOpenLightbox();
    } else {
      triggerFilePick();
    }
  }, [v.status, displayUrl, handleOpenLightbox, triggerFilePick]);

  const handleFrameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleFrameClick();
    }
  }, [handleFrameClick]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start gap-3">
        {/* 始终渲染 div，仅切换内容，避免 React 协调时 div↔button 类型切换引发 insertBefore 崩溃 */}
        <div
          className={[
            dashedFrameClass,
            v.status !== "uploading" ? "cursor-pointer" : "cursor-wait",
          ].join(" ")}
          onClick={handleFrameClick}
          onKeyDown={handleFrameKeyDown}
          role="button"
          tabIndex={v.status !== "uploading" ? 0 : -1}
          aria-label={
            v.status === "uploading"
              ? t.uploadUploading
              : displayUrl && v.status !== "error"
              ? t.uploadZoomHint
              : t.uploadSelectBtn
          }
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
                <span className="text-sm font-medium text-neutral-900">{t.uploadUploading}</span>
                <span className="text-xs text-neutral-600">{t.uploadWait}</span>
              </div>
            </div>
          ) : displayUrl && v.status === "error" ? (
            <div className="group relative flex h-full w-full items-center justify-center">
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
                  {t.uploadFailed}
                </span>
              </div>
            </div>
          ) : displayUrl ? (
            <div className="group relative flex h-full w-full items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={displayUrl} alt="" className="h-full w-full object-contain" />
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/50 opacity-0 backdrop-blur-[2px] transition-opacity duration-200 group-hover:opacity-100">
                <ZoomIn className="h-8 w-8 text-white drop-shadow" strokeWidth={1.5} />
                <span className="px-2 text-center text-xs font-medium text-white drop-shadow">
                  {t.uploadZoomHint}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 px-3">
              <Upload className="h-9 w-9 text-slate-600" strokeWidth={1.25} aria-hidden />
              <span className="text-center text-xs text-slate-600">{t.uploadNoPreview}</span>
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
              className="rounded-lg bg-emerald-600/90 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {v.status === "ready" ? t.uploadChangeBtn : t.uploadSelectBtn}
            </button>
            <button
              type="button"
              disabled={v.status === "uploading"}
              onClick={() => setAssetPickerOpen(true)}
              className="rounded-lg border border-[#2a3d5e] px-3 py-1.5 text-sm text-slate-300 transition-colors hover:border-[#3a5070] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t.uploadFromAssetLibraryBtn}
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
          </div>
          {v.fileName && <p className="truncate text-xs text-slate-500">{t.uploadFileName(v.fileName)}</p>}
          {v.status === "ready" && v.remoteUrl && (
            <p className="break-all text-xs text-emerald-500/80">{t.uploadRemoteUrl(v.remoteUrl)}</p>
          )}
          {v.status === "error" && (
            <p className="text-xs text-red-600">{v.errorMessage ?? t.uploadFailedRetry}</p>
          )}
        </div>
      </div>
      {field.description && (
        <p className="text-xs text-slate-500">{loc(field.description, field.descriptionEn, locale)}</p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}

      <LightboxModal open={lightboxOpen} imageUrl={lightboxUrl} onClose={closeLightbox} />
      <AssetLibraryPicker
        open={assetPickerOpen}
        onClose={() => setAssetPickerOpen(false)}
        onSelect={handleAssetSelect}
      />
    </div>
  );
}
