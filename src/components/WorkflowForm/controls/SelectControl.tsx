"use client";

import type { SelectField } from "@/types/workflow";
import { getAtPath } from "@/lib/workflow-utils";
import { useWorkflowStore } from "@/store/useWorkflowStore";

export interface SelectControlProps {
  field: SelectField;
  error?: string;
}

export function SelectControl({ field, error }: SelectControlProps) {
  const path = useWorkflowStore((s) => s.fieldPaths[field.id]);
  const raw = useWorkflowStore((s) => (path ? getAtPath(s.parameters, path) : undefined));
  const setFieldValue = useWorkflowStore((s) => s.setFieldValue);
  const value = typeof raw === "string" ? raw : field.options[0]?.value ?? "";

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
            {opt.label}
          </option>
        ))}
      </select>
      {field.description && <p className="text-xs text-slate-500">{field.description}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
