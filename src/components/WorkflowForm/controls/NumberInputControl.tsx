"use client";

import type { NumberInputField } from "@/types/workflow";
import { getAtPath, resolveNumberInputMax } from "@/lib/workflow-utils";
import { useWorkflowStore } from "@/store/useWorkflowStore";

export interface NumberInputControlProps {
  field: NumberInputField;
  error?: string;
  locale?: "zh" | "en";
}

function formatNumber(value: number, locale: "zh" | "en"): string {
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "zh-CN").format(value);
}

export function NumberInputControl({ field, error, locale = "zh" }: NumberInputControlProps) {
  const path = useWorkflowStore((state) => state.fieldPaths[field.id]);
  const parameters = useWorkflowStore((state) => state.parameters);
  const fieldPaths = useWorkflowStore((state) => state.fieldPaths);
  const raw = path ? getAtPath(parameters, path) : undefined;
  const setFieldValue = useWorkflowStore((state) => state.setFieldValue);
  const { min, step = 1 } = field.validation;
  const max = resolveNumberInputMax(field, parameters, fieldPaths);
  const value = typeof raw === "number" && Number.isFinite(raw) ? raw : "";
  const errorId = `${field.id}-number-error`;

  return (
    <div className="space-y-3 rounded-xl border border-white/[0.07] bg-[#091526]/55 p-3.5">
      <div className="relative">
        <input
          id={field.id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={step}
          value={value}
          placeholder={locale === "en" ? field.placeholderEn ?? field.placeholder : field.placeholder}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => {
            if (event.target.value === "") {
              setFieldValue(field.id, undefined);
              return;
            }
            const next = Number(event.target.value);
            setFieldValue(field.id, Number.isFinite(next) ? next : undefined);
          }}
          className="h-11 w-full rounded-lg border border-white/10 bg-[#07111f]/80 px-3.5 pr-20 text-sm font-semibold tabular-nums text-slate-100 outline-none transition placeholder:text-slate-600 hover:border-white/20 focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/15"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-xs text-slate-500">
          {locale === "en" ? "faces" : "面"}
        </span>
      </div>

      {field.presets && field.presets.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label={locale === "en" ? "Face count presets" : "面数快捷选项"}>
          {field.presets.map((preset) => {
            const disabled = preset.value > max;
            const selected = value === preset.value;
            return (
              <button
                key={preset.value}
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                title={disabled ? (locale === "en" ? `Current model supports up to ${formatNumber(max, locale)} faces` : `当前模型最高支持 ${formatNumber(max, locale)} 面`) : undefined}
                onClick={() => setFieldValue(field.id, preset.value)}
                className={`h-11 rounded-lg border px-2 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/30 ${
                  selected
                    ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-300"
                    : "border-white/[0.08] bg-white/[0.025] text-slate-400 hover:border-emerald-400/25 hover:text-slate-200 disabled:cursor-not-allowed disabled:border-white/[0.04] disabled:text-slate-700 disabled:hover:border-white/[0.04]"
                }`}
              >
                {locale === "en" ? preset.labelEn ?? preset.label : preset.label}
              </button>
            );
          })}
        </div>
      )}

      <p className="text-xs leading-relaxed text-slate-500">
        {locale === "en"
          ? `Allowed range: ${formatNumber(min, locale)}–${formatNumber(max, locale)} faces`
          : `可填写范围：${formatNumber(min, locale)}–${formatNumber(max, locale)} 面`}
      </p>
      {error && <p id={errorId} className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
