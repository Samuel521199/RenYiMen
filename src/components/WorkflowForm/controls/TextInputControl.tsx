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
  const placeholder = loc(
    field.defaultValue || field.placeholder || "",
    field.placeholderEn,
    locale,
  ) || undefined;

  const className = `w-full rounded-xl border bg-[#091526]/90 px-3.5 py-3 text-sm leading-relaxed text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] placeholder:text-slate-500 placeholder:opacity-80 outline-none transition-all duration-200 focus:border-emerald-400/55 focus:ring-4 focus:ring-emerald-500/10 ${
    error ? "border-red-500/50" : "border-white/[0.1] hover:border-white/[0.16]"
  }`;

  return (
    <div className="space-y-1">
      {field.multiline ? (
        <textarea
          id={field.id}
          rows={4}
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
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
