"use client";

import { ACTIVITY_PRIMARY_BUTTON_CLASS } from "@workbench/lib/activity-workflow-theme";

interface GenerateButtonProps {
  onClick: () => void;
  loading: boolean;
  disabled?: boolean;
  label?: string;
  loadingLabel?: string;
  className?: string;
}

export default function GenerateButton({
  onClick,
  loading,
  disabled = false,
  label = "开始生成",
  loadingLabel = "生成中...",
  className = "",
}: GenerateButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={`${ACTIVITY_PRIMARY_BUTTON_CLASS} ${className}`.trim()}
    >
      {loading ? loadingLabel : label}
    </button>
  );
}
