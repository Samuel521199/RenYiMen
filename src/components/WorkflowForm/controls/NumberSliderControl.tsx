"use client";

import type { NumberSliderField } from "@/types/workflow";
import { getAtPath } from "@/lib/workflow-utils";
import { useWorkflowStore } from "@/store/useWorkflowStore";

export interface NumberSliderControlProps {
  field: NumberSliderField;
  error?: string;
  locale?: "zh" | "en";
}

export function NumberSliderControl({ field, error }: NumberSliderControlProps) {
  const path = useWorkflowStore((s) => s.fieldPaths[field.id]);
  const raw = useWorkflowStore((s) => (path ? getAtPath(s.parameters, path) : undefined));
  const setFieldValue = useWorkflowStore((s) => s.setFieldValue);
  const { min, max, step = 1 } = field.validation;
  const value = typeof raw === "number" && !Number.isNaN(raw) ? raw : min;

  return (
    <div className="space-y-3 rounded-xl border border-white/[0.07] bg-[#091526]/55 p-3.5">
      <div className="flex flex-wrap items-center gap-4">
        <input
          id={field.id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            setFieldValue(field.id, field.validation.integer ? Math.round(n) : n);
          }}
          className="h-1.5 min-w-[12rem] flex-1 cursor-pointer accent-emerald-400"
        />
        <output
          className="min-w-[3.5rem] rounded-lg border border-emerald-400/15 bg-emerald-400/[0.07] px-2.5 py-1.5 text-center text-sm font-semibold tabular-nums text-emerald-300"
          htmlFor={field.id}
        >
          {value}
        </output>
      </div>
      <div className="flex justify-between text-xs text-slate-600">
        <span>{field.showMinLabel === false ? null : min}</span>
        <span>{field.showMaxLabel === false ? null : max}</span>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
