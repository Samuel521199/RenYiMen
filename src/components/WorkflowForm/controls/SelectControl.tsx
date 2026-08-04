"use client";

import type { SelectField } from "@/types/workflow";
import { getAtPath } from "@/lib/workflow-utils";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { loc } from "@/components/WorkflowForm/DynamicForm";

export interface SelectControlProps {
  field: SelectField;
  error?: string;
  locale?: "zh" | "en";
}

export function SelectControl({ field, error, locale = "zh" }: SelectControlProps) {
  const path = useWorkflowStore((s) => s.fieldPaths[field.id]);
  const raw = useWorkflowStore((s) => (path ? getAtPath(s.parameters, path) : undefined));
  const setFieldValue = useWorkflowStore((s) => s.setFieldValue);
  const value = typeof raw === "string" ? raw : field.options[0]?.value ?? "";

  return (
    <div className="space-y-2">
      <select
        id={field.id}
        value={value}
        onChange={(e) => setFieldValue(field.id, e.target.value)}
        className={`h-11 w-full rounded-xl border bg-[#091526]/90 px-3.5 text-sm text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] outline-none transition-all duration-200 focus:border-emerald-400/55 focus:ring-4 focus:ring-emerald-500/10 ${
          error ? "border-red-500/50" : "border-white/[0.1] hover:border-white/[0.16]"
        }`}
      >
        {field.options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-[#1a2840] text-slate-200">
            {loc(opt.label, opt.labelEn, locale)}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
