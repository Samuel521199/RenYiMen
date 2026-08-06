"use client";

import type { SelectField } from "@/types/workflow";
import { getAtPath } from "@/lib/workflow-utils";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { loc } from "@/components/WorkflowForm/DynamicForm";
import { iterateLeafFields } from "@/lib/workflow-utils";

export interface SelectControlProps {
  field: SelectField;
  error?: string;
  locale?: "zh" | "en";
}

export function SelectControl({ field, error, locale = "zh" }: SelectControlProps) {
  const path = useWorkflowStore((s) => s.fieldPaths[field.id]);
  const raw = useWorkflowStore((s) => (path ? getAtPath(s.parameters, path) : undefined));
  const setFieldValue = useWorkflowStore((s) => s.setFieldValue);
  const clearImageField = useWorkflowStore((s) => s.clearImageField);
  const schema = useWorkflowStore((s) => s.schema);
  const value = typeof raw === "string" ? raw : field.options[0]?.value ?? "";
  const selectValue = (nextValue: string) => {
    for (const fieldId of field.clearFieldsByValue?.[nextValue] ?? []) {
      const target = schema
        ? [...iterateLeafFields(schema.fields)].find((candidate) => candidate.id === fieldId)
        : undefined;
      if (target?.kind === "imageUpload" || target?.kind === "videoUpload" || target?.kind === "audioUpload") {
        clearImageField(fieldId);
      } else {
        setFieldValue(fieldId, "");
      }
    }
    setFieldValue(field.id, nextValue);
  };

  if (field.display === "segmented") {
    return (
      <div className="space-y-2">
        <div className={`grid grid-cols-1 gap-2 rounded-lg border border-white/[0.1] bg-[#07111f]/80 p-1.5 ${field.options.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          {field.options.map((opt) => {
            const selected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={selected}
                onClick={() => selectValue(opt.value)}
                className={`min-h-11 rounded-md border px-3 py-2.5 text-sm font-medium transition-colors ${selected
                  ? "border-emerald-400/45 bg-emerald-400/15 text-emerald-100"
                  : "border-transparent text-slate-400 hover:border-white/[0.1] hover:bg-white/[0.045] hover:text-slate-200"
                }`}
              >
                {loc(opt.label, opt.labelEn, locale)}
              </button>
            );
          })}
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <select
        id={field.id}
        value={value}
        onChange={(e) => selectValue(e.target.value)}
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
