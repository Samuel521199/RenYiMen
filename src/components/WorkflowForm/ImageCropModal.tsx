"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Crop, Loader2, X } from "lucide-react";
import { getCropOutputSize, resolveCropImageSource } from "@/lib/image-crop";

type CropRect = { x: number; y: number; width: number; height: number };
type DragAction = "move" | "nw" | "ne" | "sw" | "se";

interface ImageCropModalProps {
  open: boolean;
  imageUrl: string | null;
  fileName?: string;
  minDimension?: number;
  maxDimension?: number;
  maxSizeMB?: number;
  onClose: () => void;
  onConfirm: (file: File) => Promise<void> | void;
}

const INITIAL_CROP: CropRect = { x: 0.04, y: 0.04, width: 0.92, height: 0.92 };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function ImageCropModal({
  open,
  imageUrl,
  fileName,
  minDimension,
  maxDimension,
  maxSizeMB,
  onClose,
  onConfirm,
}: ImageCropModalProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    action: DragAction;
    pointerX: number;
    pointerY: number;
    crop: CropRect;
  } | null>(null);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [cropRect, setCropRect] = useState<CropRect>(INITIAL_CROP);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setCropRect(INITIAL_CROP);
    setNaturalSize({ width: 0, height: 0 });
    setError("");
  }, [imageUrl, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, open, saving]);

  const cropPixels = useMemo(() => ({
    x: Math.round(naturalSize.width * cropRect.x),
    y: Math.round(naturalSize.height * cropRect.y),
    width: Math.max(1, Math.round(naturalSize.width * cropRect.width)),
    height: Math.max(1, Math.round(naturalSize.height * cropRect.height)),
  }), [cropRect, naturalSize]);

  const outputSize = useMemo(() => {
    if (!naturalSize.width || !naturalSize.height) return null;
    try {
      return getCropOutputSize(cropPixels, minDimension, maxDimension);
    } catch {
      return null;
    }
  }, [cropPixels, maxDimension, minDimension, naturalSize]);

  const startDrag = useCallback((event: React.PointerEvent, action: DragAction) => {
    event.preventDefault();
    event.stopPropagation();
    stageRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = {
      action,
      pointerX: event.clientX,
      pointerY: event.clientY,
      crop: cropRect,
    };
  }, [cropRect]);

  const handlePointerMove = useCallback((event: React.PointerEvent) => {
    const drag = dragRef.current;
    const stage = stageRef.current;
    if (!drag || !stage) return;
    const bounds = stage.getBoundingClientRect();
    const dx = (event.clientX - drag.pointerX) / bounds.width;
    const dy = (event.clientY - drag.pointerY) / bounds.height;
    const minWidth = Math.min(0.35, 48 / bounds.width);
    const minHeight = Math.min(0.35, 48 / bounds.height);
    const start = drag.crop;

    if (drag.action === "move") {
      setCropRect({
        ...start,
        x: clamp(start.x + dx, 0, 1 - start.width),
        y: clamp(start.y + dy, 0, 1 - start.height),
      });
      return;
    }

    const left = drag.action.includes("w")
      ? clamp(start.x + dx, 0, start.x + start.width - minWidth)
      : start.x;
    const right = drag.action.includes("e")
      ? clamp(start.x + start.width + dx, start.x + minWidth, 1)
      : start.x + start.width;
    const top = drag.action.includes("n")
      ? clamp(start.y + dy, 0, start.y + start.height - minHeight)
      : start.y;
    const bottom = drag.action.includes("s")
      ? clamp(start.y + start.height + dy, start.y + minHeight, 1)
      : start.y + start.height;
    setCropRect({ x: left, y: top, width: right - left, height: bottom - top });
  }, []);

  const finishDrag = useCallback((event: React.PointerEvent) => {
    if (dragRef.current) {
      stageRef.current?.releasePointerCapture(event.pointerId);
      dragRef.current = null;
    }
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!imageUrl || !outputSize) {
      setError("当前裁剪区域无法满足模型尺寸要求，请扩大裁剪框。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("无法读取图片，请重新选择本地图片后再裁剪。"));
        element.src = resolveCropImageSource(imageUrl, window.location.origin);
      });
      const canvas = document.createElement("canvas");
      canvas.width = outputSize.width;
      canvas.height = outputSize.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("浏览器无法创建裁剪画布");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(
        image,
        cropPixels.x,
        cropPixels.y,
        cropPixels.width,
        cropPixels.height,
        0,
        0,
        outputSize.width,
        outputSize.height,
      );

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) => value ? resolve(value) : reject(new Error("裁剪图片导出失败")),
          "image/jpeg",
          0.92,
        );
      });
      if (maxSizeMB && blob.size > maxSizeMB * 1024 * 1024) {
        throw new Error(`裁剪结果超过 ${maxSizeMB}MB，请缩小裁剪区域后重试。`);
      }
      const baseName = (fileName || "image").replace(/\.[^.]+$/, "");
      await onConfirm(new File([blob], `${baseName}-cropped.jpg`, { type: "image/jpeg" }));
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "裁剪失败，请重试");
    } finally {
      setSaving(false);
    }
  }, [cropPixels, fileName, imageUrl, maxSizeMB, onClose, onConfirm, outputSize]);

  if (!open || !imageUrl) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#020711]/85 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="裁剪图片">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-white/[0.12] bg-[#0d192b] shadow-[0_32px_100px_rgba(0,0,0,0.55)]">
        <header className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300"><Crop className="h-4 w-4" /></span>
            <div>
              <h2 className="text-sm font-semibold text-white">裁剪人物图片</h2>
              <p className="mt-0.5 text-xs text-slate-400">拖动裁剪框调整位置，拖动四角调整范围</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border border-white/[0.08] p-2 text-slate-400 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-40" aria-label="关闭"><X className="h-4 w-4" /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto bg-[#050b14] p-4 sm:p-6">
          <div className="flex min-h-[300px] items-center justify-center">
            <div
              ref={stageRef}
              className="relative inline-block max-w-full touch-none select-none overflow-hidden rounded-xl shadow-2xl"
              onPointerMove={handlePointerMove}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt="待裁剪图片"
                draggable={false}
                className="block max-h-[58vh] max-w-full object-contain"
                onLoad={(event) => setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
              />
              <div className="pointer-events-none absolute inset-0 bg-black/55" />
              <div
                className="absolute cursor-move border-2 border-emerald-300 shadow-[0_0_0_9999px_rgba(0,0,0,0.01),0_0_26px_rgba(52,211,153,0.22)]"
                style={{ left: `${cropRect.x * 100}%`, top: `${cropRect.y * 100}%`, width: `${cropRect.width * 100}%`, height: `${cropRect.height * 100}%` }}
                onPointerDown={(event) => startDrag(event, "move")}
              >
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,transparent_33%,rgba(255,255,255,.22)_33%,rgba(255,255,255,.22)_33.4%,transparent_33.4%,transparent_66%,rgba(255,255,255,.22)_66%,rgba(255,255,255,.22)_66.4%,transparent_66.4%),linear-gradient(to_bottom,transparent_33%,rgba(255,255,255,.22)_33%,rgba(255,255,255,.22)_33.4%,transparent_33.4%,transparent_66%,rgba(255,255,255,.22)_66%,rgba(255,255,255,.22)_66.4%,transparent_66.4%)]" />
                {(["nw", "ne", "sw", "se"] as const).map((corner) => (
                  <button
                    key={corner}
                    type="button"
                    aria-label={`调整${corner}角`}
                    className={`absolute h-5 w-5 rounded-full border-2 border-[#06111f] bg-emerald-300 shadow-lg ${corner.includes("n") ? "-top-2.5" : "-bottom-2.5"} ${corner.includes("w") ? "-left-2.5" : "-right-2.5"}`}
                    style={{ cursor: `${corner}-resize` }}
                    onPointerDown={(event) => startDrag(event, corner)}
                  />
                ))}
                {outputSize && (
                  <span className="pointer-events-none absolute bottom-2 left-2 rounded-lg bg-black/65 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
                    输出 {outputSize.width} × {outputSize.height}px
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <footer className="flex flex-col gap-3 border-t border-white/[0.08] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-slate-400">
            尺寸范围：<span className="font-medium text-slate-200">{minDimension ?? 1}–{maxDimension ?? "不限"}px</span>
            {naturalSize.width > 0 && <span className="ml-3">原图：{naturalSize.width} × {naturalSize.height}px</span>}
            {error && <p className="mt-1 text-rose-400">{error}</p>}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border border-white/[0.1] px-4 py-2.5 text-xs font-medium text-slate-300 transition hover:bg-white/[0.05] disabled:opacity-40">取消</button>
            <button type="button" onClick={handleConfirm} disabled={saving || !outputSize} className="inline-flex min-w-28 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-emerald-950/40 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {saving ? "处理中..." : "应用裁剪"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
