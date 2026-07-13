"use client";

import type { TextInputField } from "@/types/workflow";
import { getAtPath } from "@/lib/workflow-utils";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { loc } from "@/components/WorkflowForm/DynamicForm";

export interface TextInputControlProps {
  field: TextInputField;
  error?: string;
  locale?: "zh" | "en";
}

export function TextInputControl({ field, error, locale = "zh" }: TextInputControlProps) {
  const path = useWorkflowStore((s) => s.fieldPaths[field.id]);
  const raw = useWorkflowStore((s) => (path ? getAtPath(s.parameters, path) : undefined));
  const setFieldValue = useWorkflowStore((s) => s.setFieldValue);
  const value = typeof raw === "string" ? raw : "";
  const placeholder = loc(field.placeholder ?? "", field.placeholderEn, locale) || undefined;
  const description = field.description ? loc(field.description, field.descriptionEn, locale) : undefined;

  const className = `w-full rounded-lg border bg-[#1a2840] px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 outline-none focus:ring-2 focus:ring-emerald-500/40 ${
    error ? "border-red-500/50" : "border-[#2a3d5e]"
  }`;

  return (
    <div className="space-y-1">
      {field.multiline ? (
        <textarea
          id={field.id}
          rows={5}
          placeholder={placeholder}
          value={value}
          onChange={(e) => setFieldValue(field.id, e.target.value)}
          className={className}
        />
      ) : (
        <input
          id={field.id}
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setFieldValue(field.id, e.target.value)}
          className={className}
        />
      )}
      {description && <p className="text-xs text-slate-500">{description}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
