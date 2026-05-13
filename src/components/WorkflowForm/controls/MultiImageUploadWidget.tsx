"use client";

import { useCallback, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import type { MultiImageFieldValue, MultiImageItemValue, MultiImageUploadField } from "@/types/workflow";
import { getAtPath } from "@/lib/workflow-utils";
import { isPresignPayload } from "@/services/oss-upload";
import { useWorkflowStore } from "@/store/useWorkflowStore";

const HARD_MAX_IMAGES = 9;

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
}

function thumbUrl(item: MultiImageItemValue): string | null {
  if (item.previewUrl && (item.status === "uploading" || item.status === "ready" || item.status === "error")) {
    return item.previewUrl;
  }
  if (item.status === "ready" && item.remoteUrl) return item.remoteUrl;
  return null;
}

const addTileBase =
  "flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-neutral-200 bg-neutral-50 text-neutral-500 transition hover:border-neutral-300 hover:bg-neutral-100";

/**
 * 多图参考上传：原生嵌套 `<label>` + `hidden` 的 `type=file"`；
 * 上传与 `uploadImageToOSS` 同源：`POST /api/upload/presign` + `PUT` 直传（本组件内联以便显式 `return publicUrl`）。
 */
export function MultiImageUploadWidget({ field, error, value, onChange }: MultiImageUploadWidgetProps) {
  const [localUploading, setLocalUploading] = useState(false);

  const multiBlock = useWorkflowStore((s) => {
    const p = s.fieldPaths[field.id];
    return p ? (getAtPath(s.parameters, p) as MultiImageFieldValue | undefined) : undefined;
  });
  const removeMultiImageSlot = useWorkflowStore((s) => s.removeMultiImageSlot);

  const maxItems = Math.min(HARD_MAX_IMAGES, Math.max(1, field.maxItems ?? HARD_MAX_IMAGES));
  const items = Array.isArray(multiBlock?.items) ? multiBlock.items : [];
  const canAddMore = items.length < maxItems;
  const accept = field.validation?.accept?.join(",") ?? "image/*";
  const isBusy = localUploading;

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      console.log("[MultiUpload] 触发文件选择，获取到的文件:", e.target.files);
      if (!e.target.files?.length) return;

      const filesArray = Array.from(e.target.files);
      e.target.value = "";

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
      for (const file of list) {
        if (maxMb != null && file.size > maxMb * 1024 * 1024) {
          alert(`「${file.name}」超过 ${maxMb}MB，已中止本次上传。`);
          return;
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
    [field.id, field.validation?.maxSizeMB, maxItems, onChange, value]
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
        <div
          className={[
            "grid shrink-0 gap-2 [grid-auto-rows:minmax(5.5rem,auto)]",
            "w-full min-w-[200px] max-w-[520px] sm:w-[min(100%,520px)]",
            items.length <= 3 ? "grid-cols-3" : "grid-cols-3 sm:grid-cols-4",
          ].join(" ")}
        >
          {items.map((it) => {
            const url = thumbUrl(it);
            const frameClass = `relative aspect-square w-full overflow-hidden rounded-lg border bg-neutral-50 ${
              error ? "border-red-200" : "border-neutral-200"
            }`;
            return (
              <div key={it.id} className={frameClass}>
                {url && it.status === "uploading" ? (
                  <div className="relative flex h-full w-full items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="h-full w-full object-cover opacity-50" draggable={false} />
                    <div
                      className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-white/40 backdrop-blur-sm"
                      aria-busy="true"
                    >
                      <Loader2 className="h-6 w-6 animate-spin text-neutral-800" strokeWidth={2} />
                      <span className="text-[10px] font-medium text-neutral-900">上传中</span>
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
                  <div className="flex h-full items-center justify-center text-[10px] text-neutral-400">无预览</div>
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

          {canAddMore && !isBusy && (
            <label className={`${addTileBase} cursor-pointer`}>
              <input type="file" multiple accept={accept} className="hidden" onChange={handleFileChange} />
              <div className="flex flex-col items-center justify-center gap-1 px-1">
                <Upload className="h-6 w-6 shrink-0" strokeWidth={1.5} aria-hidden />
                <span className="text-center text-[10px] font-medium">添加图片</span>
                <span className="text-[9px] text-neutral-400">
                  {items.length}/{maxItems}
                </span>
              </div>
            </label>
          )}

          {canAddMore && isBusy && (
            <div
              className={`${addTileBase} cursor-wait opacity-70 pointer-events-none`}
              aria-busy="true"
            >
              <div className="flex flex-col items-center justify-center gap-1 px-1">
                <Loader2 className="h-6 w-6 shrink-0 animate-spin text-neutral-700" strokeWidth={2} aria-hidden />
                <span className="text-center text-[10px] font-medium text-neutral-800">上传中…</span>
              </div>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2 sm:min-w-[120px]">
          {!canAddMore && (
            <p className="text-xs text-neutral-500">已达上限（{maxItems} 张），请删除后再添加。</p>
          )}
          {items.some((it) => it.status === "error") && (
            <p className="text-xs text-amber-700">部分图片上传失败，可删除后重新添加。</p>
          )}
        </div>
      </div>

      {field.description && <p className="text-xs text-neutral-500">{field.description}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
