"use client";

import type { NumberSliderField } from "@/types/workflow";
import { getAtPath } from "@/lib/workflow-utils";
import { useWorkflowStore } from "@/store/useWorkflowStore";

export interface NumberSliderControlProps {
  field: NumberSliderField;
  error?: string;
}

export function NumberSliderControl({ field, error }: NumberSliderControlProps) {
  const path = useWorkflowStore((s) => s.fieldPaths[field.id]);
  const raw = useWorkflowStore((s) => (path ? getAtPath(s.parameters, path) : undefined));
  const setFieldValue = useWorkflowStore((s) => s.setFieldValue);
  const { min, max, step = 1 } = field.validation;
  const value = typeof raw === "number" && !Number.isNaN(raw) ? raw : min;

  return (
    <div className="space-y-2">
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
          className="h-2 w-full max-w-md cursor-pointer accent-neutral-900"
        />
        <output
          className="min-w-[3rem] rounded-md bg-neutral-100 px-2 py-1 text-center text-sm font-medium tabular-nums text-neutral-900"
          htmlFor={field.id}
        >
          {value}
        </output>
      </div>
      <div className="flex justify-between text-xs text-neutral-400">
        <span>{min}</span>
        <span>{max}</span>
      </div>
      {field.description && <p className="text-xs text-neutral-500">{field.description}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
