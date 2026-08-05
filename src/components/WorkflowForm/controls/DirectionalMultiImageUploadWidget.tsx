"use client";

import { useCallback, useMemo, useState } from "react";
import { ImagePlus, Loader2, Upload, X } from "lucide-react";
import { AssetLibraryPicker, type PickedAsset } from "@/components/AssetLibraryPicker";
import { useFileDrop } from "@/components/WorkflowForm/controls/useFileDrop";
import { fetchWorkbenchAssetAsFile } from "@/lib/workbench-asset-import";
import { getAtPath } from "@/lib/workflow-utils";
import { isPresignPayload } from "@/services/oss-upload";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import type {
  MultiImageFieldValue,
  MultiImageItemValue,
  MultiImageSlotDefinition,
  MultiImageUploadField,
} from "@/types/workflow";

interface Props {
  field: MultiImageUploadField;
  error?: string;
  locale?: "zh" | "en";
}

interface SlotCardProps {
  field: MultiImageUploadField;
  slot: MultiImageSlotDefinition;
  index: number;
  item?: MultiImageItemValue;
  locale: "zh" | "en";
  onFile: (slotId: string, file: File) => void;
  onClear: (slotId: string) => void;
  onOpenAssetLibrary: (slotId: string) => void;
}

const EMPTY_ITEMS: MultiImageItemValue[] = [];

function localized(zh: string, en: string | undefined, locale: "zh" | "en"): string {
  return locale === "en" && en ? en : zh;
}

function readItems(fieldId: string): MultiImageItemValue[] {
  const state = useWorkflowStore.getState();
  const path = state.fieldPaths[fieldId];
  const block = path ? getAtPath(state.parameters, path) as MultiImageFieldValue | undefined : undefined;
  return Array.isArray(block?.items) ? block.items : [];
}

function writeSlotItem(fieldId: string, slotId: string, next?: MultiImageItemValue): void {
  const state = useWorkflowStore.getState();
  const items = readItems(fieldId).filter((item) => item.slotId !== slotId);
  state.setFieldValue(fieldId, {
    items: next ? [...items, next] : items,
  } satisfies MultiImageFieldValue);
}

async function validateImageFile(file: File, field: MultiImageUploadField): Promise<void> {
  const validation = field.validation;
  if (validation?.accept?.length && !validation.accept.includes(file.type)) {
    throw new Error("图片格式不受支持");
  }
  if (validation?.maxSizeMB != null && file.size > validation.maxSizeMB * 1024 * 1024) {
    throw new Error(`图片不能超过 ${validation.maxSizeMB}MB`);
  }
  if (validation?.minDimension == null && validation?.maxDimension == null) return;

  const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取图片尺寸"));
    };
    image.src = url;
  });
  const min = validation.minDimension;
  const max = validation.maxDimension;
  if ((min != null && (dimensions.width < min || dimensions.height < min))
    || (max != null && (dimensions.width > max || dimensions.height > max))) {
    throw new Error(`图片尺寸 ${dimensions.width}×${dimensions.height}px 不符合要求（${min ?? 1}–${max ?? "不限"}px）`);
  }
}

async function uploadImageFile(file: File): Promise<string> {
  const presignResponse = await fetch("/api/upload/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType: file.type }),
  });
  if (!presignResponse.ok) throw new Error(`获取上传地址失败（HTTP ${presignResponse.status}）`);
  const presignPayload: unknown = await presignResponse.json().catch(() => null);
  if (!isPresignPayload(presignPayload)) throw new Error("上传地址响应无效");

  const uploadResponse = await fetch(presignPayload.uploadUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  });
  if (!uploadResponse.ok) throw new Error(`图片上传失败（HTTP ${uploadResponse.status}）`);
  return presignPayload.publicUrl;
}

function DirectionalSlotCard({
  field,
  slot,
  index,
  item,
  locale,
  onFile,
  onClear,
  onOpenAssetLibrary,
}: SlotCardProps) {
  const label = localized(slot.label, slot.labelEn, locale);
  const description = localized(slot.description ?? "", slot.descriptionEn, locale);
  const uploading = item?.status === "uploading";
  const previewUrl = item?.previewUrl || item?.remoteUrl;
  const handleFiles = useCallback((files: File[]) => {
    const first = files[0];
    if (first) onFile(slot.id, first);
  }, [onFile, slot.id]);
  const { isDragging, dropZoneProps } = useFileDrop({
    disabled: uploading,
    multiple: false,
    onFiles: handleFiles,
  });

  return (
    <section className="min-w-0 rounded-xl border border-white/[0.08] bg-[#091526]/70 p-2.5" aria-labelledby={`${field.id}-${slot.id}-label`}>
      <div className="mb-2 flex min-h-11 items-center gap-2">
        <span className="flex h-7 min-w-7 items-center justify-center rounded-md border border-emerald-400/20 bg-emerald-400/[0.07] text-[11px] font-semibold tabular-nums text-emerald-300">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="min-w-0">
          <p id={`${field.id}-${slot.id}-label`} className="text-sm font-semibold text-slate-200">{label}</p>
          {description && <p className="truncate text-[11px] text-slate-500" title={description}>{description}</p>}
        </div>
      </div>

      <div className="relative">
        <label
          className={`group relative flex aspect-[4/5] w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed outline-none transition duration-200 focus-within:ring-2 focus-within:ring-emerald-400/35 ${
            isDragging
              ? "border-emerald-400 bg-emerald-400/10"
              : item?.status === "error"
                ? "border-red-400/50 bg-red-950/10"
                : previewUrl
                  ? "border-white/[0.12] bg-[#050b14]"
                  : "border-white/[0.14] bg-[#07111f]/75 hover:border-emerald-400/45 hover:bg-[#0b1a2d]"
          } ${uploading ? "cursor-wait" : ""}`}
          aria-busy={uploading}
          {...dropZoneProps}
        >
          <input
            type="file"
            accept={field.validation?.accept?.join(",") ?? "image/*"}
            className="sr-only"
            disabled={uploading}
            aria-label={locale === "en" ? `Choose ${label} image` : `选择${label}图片`}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onFile(slot.id, file);
            }}
          />
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt={label} className={`h-full w-full object-contain ${uploading ? "opacity-45" : ""}`} draggable={false} />
          ) : (
            <div className="flex flex-col items-center gap-2 px-3 text-center text-slate-500">
              <Upload className={`h-7 w-7 ${isDragging ? "text-emerald-300" : ""}`} strokeWidth={1.5} aria-hidden />
              <span className="text-xs leading-relaxed">
                {isDragging
                  ? locale === "en" ? "Drop into this view" : `释放到${label}`
                  : locale === "en" ? "Click or drag image" : "点击或拖拽图片"}
              </span>
            </div>
          )}
          {uploading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#07111f]/65 text-slate-200 backdrop-blur-sm">
              <Loader2 className="h-7 w-7 animate-spin text-emerald-300" strokeWidth={2} aria-hidden />
              <span className="text-xs">{locale === "en" ? "Uploading…" : "上传中…"}</span>
            </div>
          )}
        </label>
        {item && !uploading && (
          <button
            type="button"
            onClick={() => onClear(slot.id)}
            aria-label={locale === "en" ? `Remove ${label}` : `移除${label}`}
            className="absolute right-1.5 top-1.5 flex h-11 w-11 items-center justify-center rounded-full bg-black/65 text-white shadow-lg backdrop-blur-sm transition hover:bg-red-500/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300/60"
          >
            <X className="h-4 w-4" strokeWidth={2} aria-hidden />
          </button>
        )}
      </div>

      <button
        type="button"
        disabled={uploading}
        onClick={() => onOpenAssetLibrary(slot.id)}
        className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.025] px-3 text-xs font-medium text-slate-400 transition hover:border-white/[0.16] hover:bg-white/[0.055] hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/30 disabled:cursor-wait disabled:opacity-45"
      >
        <ImagePlus className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        {locale === "en" ? "Choose from assets" : "从素材库选择"}
      </button>
      {item?.status === "error" && item.errorMessage && (
        <p className="mt-2 text-xs leading-relaxed text-red-400" role="alert">{item.errorMessage}</p>
      )}
    </section>
  );
}

export function DirectionalMultiImageUploadWidget({ field, error, locale = "zh" }: Props) {
  const [activeAssetSlotId, setActiveAssetSlotId] = useState<string | null>(null);
  const items = useWorkflowStore((state) => {
    const path = state.fieldPaths[field.id];
    const block = path ? getAtPath(state.parameters, path) as MultiImageFieldValue | undefined : undefined;
    return Array.isArray(block?.items) ? block.items : EMPTY_ITEMS;
  });
  const itemBySlot = useMemo(
    () => new Map(items.filter((item) => item.slotId).map((item) => [item.slotId as string, item])),
    [items],
  );

  const uploadToSlot = useCallback(async (slotId: string, file: File) => {
    let previewUrl: string | undefined;
    try {
      await validateImageFile(file, field);
      previewUrl = URL.createObjectURL(file);
      writeSlotItem(field.id, slotId, {
        id: `${slotId}-${Date.now()}`,
        slotId,
        status: "uploading",
        previewUrl,
        fileName: file.name,
      });
      const remoteUrl = await uploadImageFile(file);
      URL.revokeObjectURL(previewUrl);
      previewUrl = undefined;
      writeSlotItem(field.id, slotId, {
        id: `${slotId}-${Date.now()}`,
        slotId,
        status: "ready",
        remoteUrl,
        fileName: file.name,
      });
    } catch (uploadError) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      writeSlotItem(field.id, slotId, {
        id: `${slotId}-${Date.now()}`,
        slotId,
        status: "error",
        fileName: file.name,
        errorMessage: uploadError instanceof Error ? uploadError.message : "图片上传失败",
      });
    }
  }, [field]);

  const handleAssetSelect = useCallback((asset: PickedAsset) => {
    const slotId = activeAssetSlotId;
    setActiveAssetSlotId(null);
    if (!slotId) return;
    void fetchWorkbenchAssetAsFile(asset.url, asset.fileName)
      .then((file) => uploadToSlot(slotId, file))
      .catch((assetError) => {
        writeSlotItem(field.id, slotId, {
          id: `${slotId}-${Date.now()}`,
          slotId,
          status: "error",
          fileName: asset.fileName,
          errorMessage: assetError instanceof Error ? assetError.message : "素材导入失败",
        });
      });
  }, [activeAssetSlotId, field.id, uploadToSlot]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(field.slots ?? []).map((slot, index) => (
          <DirectionalSlotCard
            key={slot.id}
            field={field}
            slot={slot}
            index={index}
            item={itemBySlot.get(slot.id)}
            locale={locale}
            onFile={(slotId, file) => void uploadToSlot(slotId, file)}
            onClear={(slotId) => writeSlotItem(field.id, slotId)}
            onOpenAssetLibrary={setActiveAssetSlotId}
          />
        ))}
      </div>
      <p className="text-xs leading-relaxed text-slate-500">
        {locale === "en"
          ? `Provide at least ${field.minItems ?? 1} views. Empty directions remain empty in the request.`
          : `至少上传 ${field.minItems ?? 1} 个方向；未填写的方向会在请求中保持为空。`}
      </p>
      {error && <p className="text-xs text-red-400" role="alert">{error}</p>}
      <AssetLibraryPicker
        open={activeAssetSlotId != null}
        onClose={() => setActiveAssetSlotId(null)}
        onSelect={handleAssetSelect}
      />
    </div>
  );
}
