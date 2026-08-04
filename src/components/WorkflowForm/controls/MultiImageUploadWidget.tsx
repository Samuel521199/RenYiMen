"use client";

import { useCallback, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import type { MultiImageFieldValue, MultiImageItemValue, MultiImageUploadField } from "@/types/workflow";
import { getAtPath } from "@/lib/workflow-utils";
import { isPresignPayload } from "@/services/oss-upload";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { AssetLibraryPicker, type PickedAsset } from "@/components/AssetLibraryPicker";
import { useT } from "@/i18n";
import { useFileDrop } from "@/components/WorkflowForm/controls/useFileDrop";

const HARD_MAX_IMAGES = 9;

/** 在浏览器端校验图片尺寸，解析失败时放行（让上游报错）。 */
function checkImageDimension(
  file: File,
  minDimension: number
): Promise<{ ok: boolean; width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({
        ok: img.naturalWidth >= minDimension && img.naturalHeight >= minDimension,
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ ok: true, width: 0, height: 0 });
    };
    img.src = url;
  });
}

function newSlotId(): string {
  return typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto
    ? globalThis.crypto.randomUUID()
    : `slot_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export interface MultiImageUploadWidgetProps {
  field: MultiImageUploadField;
  error?: string;
  /** 受控：已有 URL 列表；未传则从 store 中 `ready` 项推导 */
  value?: string[];
  /** 可选：在 Zustand 更新后额外通知父级（如独立 RJSF 集成） */
  onChange?: (urls: string[]) => void;
  locale?: "zh" | "en";
}

function thumbUrl(item: MultiImageItemValue): string | null {
  if (item.previewUrl && (item.status === "uploading" || item.status === "ready" || item.status === "error")) {
    return item.previewUrl;
  }
  if (item.status === "ready" && item.remoteUrl) return item.remoteUrl;
  return null;
}

const addTileBase =
  "flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/[0.14] bg-[#091526]/75 text-slate-500 transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-400/45 hover:bg-[#0b1a2d] hover:text-slate-300";

/**
 * 多图参考上传：原生嵌套 `<label>` + `hidden` 的 `type=file"`；
 * 上传与 `uploadImageToOSS` 同源：`POST /api/upload/presign` + `PUT` 直传（本组件内联以便显式 `return publicUrl`）。
 */
export function MultiImageUploadWidget({ field, error, value, onChange }: MultiImageUploadWidgetProps) {
  const [localUploading, setLocalUploading] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const t = useT();

  const multiBlock = useWorkflowStore((s) => {
    const p = s.fieldPaths[field.id];
    return p ? (getAtPath(s.parameters, p) as MultiImageFieldValue | undefined) : undefined;
  });
  const removeMultiImageSlot = useWorkflowStore((s) => s.removeMultiImageSlot);
  const appendMultiImageFromAsset = useWorkflowStore((s) => s.appendMultiImageFromAsset);

  const maxItems = Math.min(HARD_MAX_IMAGES, Math.max(1, field.maxItems ?? HARD_MAX_IMAGES));
  const items = Array.isArray(multiBlock?.items) ? multiBlock.items : [];
  const canAddMore = items.length < maxItems;
  const accept = field.validation?.accept?.join(",") ?? "image/*";
  const isBusy = localUploading;
  const visibleTileCount = items.length + (canAddMore ? 1 : 0);
  const desktopGridColumns = visibleTileCount <= 1
    ? "sm:grid-cols-[repeat(1,minmax(0,10.5rem))]"
    : visibleTileCount === 2
      ? "sm:grid-cols-[repeat(2,minmax(0,10.5rem))]"
      : visibleTileCount === 3
        ? "sm:grid-cols-[repeat(3,minmax(0,10.5rem))]"
        : "sm:grid-cols-[repeat(3,minmax(0,10.5rem))] lg:grid-cols-[repeat(4,minmax(0,10.5rem))]";

  const handleFiles = useCallback(
    async (selectedFiles: FileList | File[]) => {
      console.log("[MultiUpload] 获取到的文件:", selectedFiles);
      if (!selectedFiles.length) return;

      const filesArray = Array.from(selectedFiles);

      const { parameters, fieldPaths, setFieldValue } = useWorkflowStore.getState();
      const path = fieldPaths[field.id];
      const block = path ? (getAtPath(parameters, path) as MultiImageFieldValue | undefined) : undefined;
      const curItems = Array.isArray(block?.items) ? block.items : [];

      const room = maxItems - curItems.length;
      if (room <= 0) return;

      let list = filesArray;
      if (list.length > room) {
        window.alert(`最多只能再添加 ${room} 张，已自动仅处理前 ${room} 张。`);
        list = list.slice(0, room);
      }

      const maxMb = field.validation?.maxSizeMB;
      const minDim = field.validation?.minDimension;
      for (const file of list) {
        if (maxMb != null && file.size > maxMb * 1024 * 1024) {
          alert(`「${file.name}」超过 ${maxMb}MB，已中止本次上传。`);
          return;
        }
        if (minDim != null) {
          const dim = await checkImageDimension(file, minDim);
          if (!dim.ok) {
            alert(
              `「${file.name}」尺寸过小（${dim.width}×${dim.height} px），\n` +
              `要求宽和高均不小于 ${minDim} px，请替换为更高分辨率的图片后重试。`
            );
            return;
          }
        }
      }

      setLocalUploading(true);
      try {
        const existingReady = curItems.filter(
          (it) => it.status === "ready" && typeof it.remoteUrl === "string" && it.remoteUrl.length > 0
        );

        const newUrls = await Promise.all(
          list.map(async (file) => {
            try {
              const presignRes = await fetch("/api/upload/presign", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  filename: file.name,
                  contentType: file.type,
                }),
              });

              if (!presignRes.ok) {
                throw new Error(`Presign 失败: ${presignRes.status}`);
              }

              let presignJson: unknown;
              try {
                presignJson = await presignRes.json();
              } catch {
                throw new Error("Presign 响应解析失败");
              }

              if (!isPresignPayload(presignJson)) {
                throw new Error("Presign 响应无效");
              }

              const { uploadUrl, publicUrl } = presignJson;

              const putRes = await fetch(uploadUrl, {
                method: "PUT",
                body: file,
                headers: { "Content-Type": file.type },
              });

              if (!putRes.ok) {
                const detail = await putRes.text().catch(() => "");
                console.warn("[MultiUpload] PUT 未成功", {
                  name: file.name,
                  status: putRes.status,
                  bodySnippet: detail.slice(0, 300),
                });
                throw new Error(`OSS 上传失败: ${putRes.status}`);
              }

              console.log("[MultiUpload] 单文件真正上传成功:", publicUrl);
              return publicUrl;
            } catch (err) {
              console.error("[MultiUpload] 单文件上传失败:", file.name, err);
              return undefined;
            }
          })
        );

        const validNewUrls = newUrls.filter((u): u is string => typeof u === "string" && u.length > 0);

        const urlsFromReadyItems = existingReady.map((it) => it.remoteUrl as string);
        const currentUrls = Array.isArray(value) ? value : urlsFromReadyItems;

        const finalUrls = [...currentUrls, ...validNewUrls];
        console.log("[MultiUpload] 真正合并后的 URLs:", finalUrls);

        const newItems: MultiImageItemValue[] = list
          .map((file, i): MultiImageItemValue | null => {
            const url = newUrls[i];
            if (typeof url !== "string" || url.length === 0) return null;
            return {
              id: newSlotId(),
              status: "ready",
              remoteUrl: url,
              fileName: file.name,
            };
          })
          .filter((it): it is MultiImageItemValue => it !== null);

        const mergedItems: MultiImageItemValue[] = [
          ...existingReady.map((it) => ({ ...it })),
          ...newItems,
        ];

        setFieldValue(field.id, { items: mergedItems } satisfies MultiImageFieldValue);

        console.log("[MultiUpload] 全部上传成功，回传给表单的完整 URL 数组:", finalUrls);
        onChange?.(finalUrls);
      } catch (error) {
        console.error("[MultiUpload] 上传过程中发生致命异常:", error);
        alert("上传失败，请查看控制台日志");
      } finally {
        setLocalUploading(false);
      }
    },
    [field.id, field.validation?.maxSizeMB, field.validation?.minDimension, maxItems, onChange, value]
  );

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    event.target.value = "";
    if (files?.length) void handleFiles(files);
  }, [handleFiles]);
  const { isDragging, dropZoneProps } = useFileDrop({
    disabled: isBusy || !canAddMore,
    multiple: true,
    onFiles: handleFiles,
  });

  const handleAssetSelect = useCallback(
    (asset: PickedAsset) => {
      void appendMultiImageFromAsset(field.id, asset.url, asset.fileName);
    },
    [appendMultiImageFromAsset, field.id],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
        <div
          className={[
            "grid w-full shrink-0 grid-cols-2 gap-2 [grid-auto-rows:minmax(5.5rem,auto)] sm:w-fit",
            desktopGridColumns,
          ].join(" ")}
        >
          {items.map((it) => {
            const url = thumbUrl(it);
            const frameClass = `relative aspect-square w-full overflow-hidden rounded-xl border bg-[#091526] shadow-lg shadow-black/20 transition-transform duration-200 hover:-translate-y-0.5 ${
              error ? "border-red-500/40" : "border-white/[0.1]"
            }`;
            return (
              <div key={it.id} className={frameClass}>
                {url && it.status === "uploading" ? (
                  <div className="relative flex h-full w-full items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="h-full w-full object-cover opacity-50" draggable={false} />
                    <div
                      className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-[#07111d]/70 backdrop-blur-sm"
                      aria-busy="true"
                    >
                      <Loader2 className="h-6 w-6 animate-spin text-emerald-300" strokeWidth={2} />
                      <span className="text-[10px] font-medium text-slate-200">上传中</span>
                    </div>
                  </div>
                ) : url && it.status === "error" ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="h-full w-full object-cover opacity-70" draggable={false} />
                    <div className="absolute inset-x-0 bottom-0 bg-red-950/80 px-1 py-0.5 text-center text-[10px] text-white">
                      失败
                    </div>
                  </>
                ) : url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
                ) : (
                  <div className="flex h-full items-center justify-center text-[10px] text-slate-500">无预览</div>
                )}

                <button
                  type="button"
                  aria-label="移除此图"
                  disabled={it.status === "uploading"}
                  onClick={() => removeMultiImageSlot(field.id, it.id)}
                  className="absolute right-1 top-1 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white shadow-sm backdrop-blur-sm transition hover:bg-black/70 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <X className="h-4 w-4" strokeWidth={2} aria-hidden />
                </button>
              </div>
            );
          })}

          {canAddMore && (
            <label
              className={[
                addTileBase,
                isDragging
                  ? "cursor-copy border-emerald-400 bg-emerald-50 text-emerald-700"
                  : isBusy
                    ? "cursor-wait opacity-70 pointer-events-none"
                    : "cursor-pointer",
              ].join(" ")}
              aria-busy={isBusy}
              {...dropZoneProps}
            >
              {/* 始终保留 input，避免元素类型切换引发 React insertBefore 错误 */}
              <input
                type="file"
                multiple
                accept={accept}
                className="hidden"
                onChange={handleFileChange}
                disabled={isBusy}
              />
              {isDragging ? (
                <div className="flex flex-col items-center justify-center gap-1 px-1">
                  <Upload className="h-6 w-6 shrink-0" strokeWidth={1.5} aria-hidden />
                  <span className="text-center text-[10px] font-medium">{t.uploadDropActive}</span>
                </div>
              ) : isBusy ? (
                <div className="flex flex-col items-center justify-center gap-1 px-1">
                  <Loader2 className="h-6 w-6 shrink-0 animate-spin text-neutral-700" strokeWidth={2} aria-hidden />
                  <span className="text-center text-[10px] font-medium text-neutral-800">上传中…</span>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-1 px-1">
                  <Upload className="h-6 w-6 shrink-0" strokeWidth={1.5} aria-hidden />
                  <span className="text-center text-[10px] font-medium">{t.uploadDropHint}</span>
                  <span className="text-[9px] text-neutral-400">
                    {items.length}/{maxItems}
                  </span>
                </div>
              )}
            </label>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2 sm:min-w-[120px]">
          {canAddMore && !isBusy && (
            <button
              type="button"
              onClick={() => setAssetPickerOpen(true)}
              className="rounded-xl border border-white/[0.1] bg-white/[0.025] px-3.5 py-2 text-xs font-medium text-slate-300 transition-all hover:border-white/[0.18] hover:bg-white/[0.055] hover:text-white"
            >
              {t.uploadFromAssetLibraryBtn}
            </button>
          )}
          {!canAddMore && (
            <p className="text-xs text-slate-500">已达上限（{maxItems} 张），请删除后再添加。</p>
          )}
          {items.some((it) => it.status === "error") && (
            <p className="text-xs text-amber-400">部分图片上传失败，可删除后重新添加。</p>
          )}
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      <AssetLibraryPicker
        open={assetPickerOpen}
        onClose={() => setAssetPickerOpen(false)}
        onSelect={handleAssetSelect}
      />
    </div>
  );
}
