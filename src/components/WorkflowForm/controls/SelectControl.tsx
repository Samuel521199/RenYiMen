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
  const description = field.description ? loc(field.description, field.descriptionEn, locale) : undefined;

  return (
    <div className="space-y-1">
      <select
        id={field.id}
        value={value}
        onChange={(e) => setFieldValue(field.id, e.target.value)}
        className={`w-full max-w-md rounded-lg border bg-[#1a2840] px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-emerald-500/40 ${
          error ? "border-red-500/50" : "border-[#2a3d5e]"
        }`}
      >
        {field.options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-[#1a2840] text-slate-200">
            {loc(opt.label, opt.labelEn, locale)}
          </option>
        ))}
      </select>
      {description && <p className="text-xs text-slate-500">{description}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
