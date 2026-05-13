"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * 全屏图片灯箱（Portal 挂到 document.body）。
 *
 * 文生图工作流（RunningHub 短剧六件套）侧参考配置（与图片上传无直接耦合，便于对照）：
 * - 环境变量：`RUNNINGHUB_TXT2IMG_REMOTE_WORKFLOW_ID`（控制台数字 workflowId，用于 `/openapi/v2/run/workflow/{id}`）
 * - 可选：`RUNNINGHUB_TXT2IMG_WORKFLOW_JSON` / `RUNNINGHUB_TXT2IMG_WORKFLOW_FILE` 覆盖 Comfy 骨架 JSON
 * - 模板 / SKU：`workflowId: rh-txt2img-shortdrama`，`skuId: RH_TXT2IMG_SHORTDRAMA`，`providerCode: RUNNINGHUB_TXT2IMG`
 * - 表单字段示例见 `src/mocks/text-to-image-workflow.ts`（如节点 58 画幅、节点 82 提示词等）
 */
const DEFAULT_IMAGE_CLASS = "max-h-[90vh] max-w-[90vw] object-contain shadow-2xl";

export interface LightboxModalProps {
  open: boolean;
  imageUrl: string | null;
  onClose: () => void;
  /** 大图 `<img>` 的 Tailwind 类，默认 90vw / 90vh */
  imageClassName?: string;
}

export function LightboxModal({
  open,
  imageUrl,
  onClose,
  imageClassName = DEFAULT_IMAGE_CLASS,
}: LightboxModalProps) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !imageUrl || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex animate-in fade-in-0 duration-200 items-center justify-center bg-black/90 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="图片放大预览"
      onClick={onClose}
    >
      <button
        type="button"
        className="absolute right-4 top-4 z-[1001] rounded-full bg-white/10 p-2 text-white backdrop-blur-sm transition hover:bg-white/20"
        aria-label="关闭"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <X className="h-6 w-6" strokeWidth={2} />
      </button>
      <div
        className="relative flex animate-in fade-in-0 zoom-in-95 duration-200 items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="" className={imageClassName} />
      </div>
    </div>,
    document.body
  );
}
