"use client";

import type { BooleanToggleField } from "@/types/workflow";
import { getAtPath } from "@/lib/workflow-utils";
import { useWorkflowStore } from "@/store/useWorkflowStore";

export interface BooleanToggleControlProps {
  field: BooleanToggleField;
  error?: string;
  locale?: "zh" | "en";
}

export function BooleanToggleControl({ field, error, locale = "zh" }: BooleanToggleControlProps) {
  const path = useWorkflowStore((state) => state.fieldPaths[field.id]);
  const raw = useWorkflowStore((state) => (path ? getAtPath(state.parameters, path) : undefined));
  const setFieldValue = useWorkflowStore((state) => state.setFieldValue);
  const enabled = typeof raw === "boolean" ? raw : field.defaultValue ?? false;

  return (
    <div className="space-y-2">
      <button
        id={field.id}
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => setFieldValue(field.id, !enabled)}
        className="flex h-11 w-full items-center justify-between rounded-xl border border-white/[0.1] bg-[#091526]/90 px-3.5 text-sm text-slate-200 transition-all duration-200 hover:border-white/[0.16] focus:outline-none focus-visible:border-emerald-400/55 focus-visible:ring-4 focus-visible:ring-emerald-500/10"
      >
        <span>{enabled ? (locale === "en" ? "Enabled" : "已开启") : (locale === "en" ? "Disabled" : "已关闭")}</span>
        <span
          aria-hidden
          className={`relative h-6 w-11 rounded-full transition-colors ${enabled ? "bg-emerald-500" : "bg-slate-700"}`}
        >
          <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${enabled ? "translate-x-6" : "translate-x-1"}`} />
        </span>
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
