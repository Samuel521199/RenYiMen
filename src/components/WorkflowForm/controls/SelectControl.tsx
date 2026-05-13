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
        className={`w-full max-w-md rounded-md border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-800 ${
          error ? "border-red-300" : "border-neutral-300"
        }`}
      >
        {field.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {field.description && <p className="text-xs text-neutral-500">{field.description}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
