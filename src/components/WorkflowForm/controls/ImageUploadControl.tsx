"use client";

import { useCallback, useRef, useState } from "react";
import { Loader2, Upload, ZoomIn } from "lucide-react";
import type { ImageFieldValue, ImageUploadField } from "@/types/workflow";
import { getAtPath } from "@/lib/workflow-utils";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { LightboxModal } from "@/components/WorkflowForm/LightboxModal";
import { AssetLibraryPicker, type PickedAsset } from "@/components/AssetLibraryPicker";
import { useT } from "@/i18n";
import { useFileDrop } from "@/components/WorkflowForm/controls/useFileDrop";

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

export function ImageUploadControl({ field, error }: ImageUploadControlProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const path = useWorkflowStore((s) => s.fieldPaths[field.id]);
  const value = useWorkflowStore((s) =>
    path ? (getAtPath(s.parameters, path) as ImageFieldValue | undefined) : undefined
  );
  const applyImageFile = useWorkflowStore((s) => s.applyImageFile);
  const applyImageFromAsset = useWorkflowStore((s) => s.applyImageFromAsset);

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);

  const accept = field.validation?.accept?.join(",") ?? "image/*";
  const v = value ?? ({ status: "empty" } satisfies ImageFieldValue);

  const triggerFilePick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleFiles = useCallback((files: File[]) => {
    const file = files[0];
    if (file) void applyImageFile(field.id, file);
  }, [applyImageFile, field.id]);
  const { isDragging, dropZoneProps } = useFileDrop({
    disabled: v.status === "uploading",
    onFiles: handleFiles,
  });

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

  const dashedFrameClass = `relative flex h-[176px] w-full max-w-full shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-dashed bg-[#091526]/75 transition-all duration-300 ${
    isDragging ? "border-emerald-400 bg-emerald-400/10" : error ? "border-red-500/50" : "border-white/[0.14] hover:border-emerald-400/45 hover:bg-[#0b1a2d] hover:shadow-[0_0_0_1px_rgba(52,211,153,0.05),0_18px_45px_-30px_rgba(16,185,129,0.65)]"
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
    <div className="min-w-0 max-w-full space-y-2 overflow-hidden">
      <div className="min-w-0 max-w-full space-y-3 overflow-hidden">
        {/* 始终渲染 div，仅切换内容，避免 React 协调时 div↔button 类型切换引发 insertBefore 崩溃 */}
        <div
          className={[
            dashedFrameClass,
            v.status !== "uploading" ? "cursor-pointer" : "cursor-wait",
          ].join(" ")}
          onClick={handleFrameClick}
          onKeyDown={handleFrameKeyDown}
          {...dropZoneProps}
          role="button"
          tabIndex={v.status !== "uploading" ? 0 : -1}
          aria-label={
            isDragging
              ? t.uploadDropActive
              : v.status === "uploading"
              ? t.uploadUploading
              : displayUrl && v.status !== "error"
              ? t.uploadZoomHint
              : t.uploadSelectBtn
          }
        >
          {isDragging ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-emerald-400/10 px-3 text-emerald-300">
              <Upload className="h-9 w-9" strokeWidth={1.5} aria-hidden />
              <span className="text-center text-sm font-medium">{t.uploadDropActive}</span>
            </div>
          ) : displayUrl && v.status === "uploading" ? (
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
            <div className="flex flex-col items-center justify-center gap-3 px-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.045] shadow-inner">
                <Upload className="h-5 w-5 text-slate-400" strokeWidth={1.5} aria-hidden />
              </span>
              <span className="text-center text-xs font-medium text-slate-500">{t.uploadDropHint}</span>
            </div>
          )}
        </div>

        <div className="min-w-0 max-w-full space-y-2 overflow-hidden">
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
          <div className="flex min-w-0 max-w-full flex-wrap gap-2">
            <button
              type="button"
              disabled={v.status === "uploading"}
              onClick={triggerFilePick}
              className="rounded-xl bg-emerald-500/90 px-3.5 py-2 text-xs font-semibold text-white shadow-[0_8px_22px_-12px_rgba(16,185,129,0.8)] transition-all hover:-translate-y-0.5 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {v.status === "ready" ? t.uploadChangeBtn : t.uploadSelectBtn}
            </button>
            <button
              type="button"
              disabled={v.status === "uploading"}
              onClick={() => setAssetPickerOpen(true)}
              className="rounded-xl border border-white/[0.1] bg-white/[0.025] px-3.5 py-2 text-xs font-medium text-slate-300 transition-all hover:border-white/[0.18] hover:bg-white/[0.055] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t.uploadFromAssetLibraryBtn}
            </button>
          </div>
          {v.status === "error" && (
            <p className="text-xs text-red-600">{v.errorMessage ?? t.uploadFailedRetry}</p>
          )}
        </div>
      </div>
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
