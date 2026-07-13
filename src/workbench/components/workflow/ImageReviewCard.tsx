"use client";

import type React from "react";

type ImageReviewStatus = "pending" | "approved" | "rejected" | "refine";

interface ImageReviewCardProps {
  imageUrl: string;
  status: ImageReviewStatus;
  imageId: number;
  onApprove?: () => void;
  onReject?: () => void;
  onRegenerate?: () => void;
  onRefine?: () => void;
  onRevoke?: () => void;
  loading?: boolean;
  disabled?: boolean;
  extra?: React.ReactNode;
}

function reviewStatusLabel(status: ImageReviewStatus) {
  if (status === "approved") return "通过";
  if (status === "rejected") return "已废弃";
  if (status === "refine") return "待精修";
  return "待筛选";
}

function reviewStatusClass(status: ImageReviewStatus) {
  if (status === "approved") return "bg-emerald-50 text-emerald-700";
  if (status === "rejected") return "bg-red-50 text-red-700";
  if (status === "refine") return "bg-violet-50 text-violet-700";
  return "bg-amber-50 text-amber-700";
}

export default function ImageReviewCard({
  imageUrl,
  status,
  imageId,
  onApprove,
  onReject,
  onRegenerate,
  onRefine,
  onRevoke,
  loading = false,
  disabled = false,
  extra,
}: ImageReviewCardProps) {
  const actions = [
    onApprove
      ? {
          label: "通过",
          className: "bg-emerald-500 text-white hover:bg-emerald-600",
          onClick: onApprove,
        }
      : null,
    onReject
      ? {
          label: "废弃",
          className: "border border-red-200 text-red-700 hover:bg-red-50",
          onClick: onReject,
        }
      : null,
    onRegenerate
      ? {
          label: "重生成",
          className: "border border-gray-200 text-gray-700 hover:bg-gray-50",
          onClick: onRegenerate,
        }
      : null,
    onRefine
      ? {
          label: "精修",
          className: "border border-violet-200 text-violet-700 hover:bg-violet-50",
          onClick: onRefine,
        }
      : null,
    onRevoke
      ? {
          label: "撤回",
          className: "border border-gray-200 text-gray-700 hover:bg-gray-50",
          onClick: onRevoke,
        }
      : null,
  ].filter(Boolean) as Array<{ label: string; className: string; onClick: () => void }>;

  return (
    <article className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="bg-gray-100">
        <img src={imageUrl} alt={`workflow-image-${imageId}`} className="aspect-[4/3] w-full object-cover" />
      </div>
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${reviewStatusClass(status)}`}>
            {reviewStatusLabel(status)}
          </span>
          <span className="text-xs text-gray-400">ID #{imageId}</span>
        </div>

        {actions.length > 0 && (
          <div className={`grid gap-2 ${actions.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                disabled={loading || disabled}
                className={`rounded-md px-3 py-2 text-xs font-medium disabled:opacity-60 ${action.className}`}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}

        {extra}
      </div>
    </article>
  );
}
