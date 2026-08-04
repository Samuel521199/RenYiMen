"use client";

import { createContext, useContext, useEffect, useId, type FormEventHandler, type ReactNode } from "react";
import { FormErrorBoundary } from "@/components/WorkflowForm/FormErrorBoundary";
import type { WorkflowField, WorkflowFormSchema } from "@/types/workflow";
import { isGroupField } from "@/types/workflow";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { ImageUploadControl } from "@/components/WorkflowForm/controls/ImageUploadControl";
import { VideoUploadControl } from "@/components/WorkflowForm/controls/VideoUploadControl";
import { MultiImageUploadWidget } from "@/components/WorkflowForm/controls/MultiImageUploadWidget";
import { TextInputControl } from "@/components/WorkflowForm/controls/TextInputControl";
import { NumberSliderControl } from "@/components/WorkflowForm/controls/NumberSliderControl";
import { SelectControl } from "@/components/WorkflowForm/controls/SelectControl";

/** Locale context shared across all nested field renderers */
const LocaleContext = createContext<"zh" | "en">("zh");

/** Pick the localised string: use `en` when locale is "en" and `en` is provided, otherwise fall back to `zh`. */
export function loc(zh: string, en: string | undefined, locale: "zh" | "en"): string {
  return locale === "en" && en ? en : zh;
}

export interface DynamicFormProps {
  schema: WorkflowFormSchema;
  /** 由父组件在「校验」后传入的字段级错误信息 */
  errors?: Record<string, string>;
  /**
   * 若提供：用原生 `<form>` 包裹字段区，便于「回车提交」与统一 `onSubmit`（父组件内再调 Zustand `buildPayload` 等）。
   */
  onSubmit?: FormEventHandler<HTMLFormElement>;
  /** 与 `onSubmit` 配套：放在 `</form>` 内的操作区（如提交 / 清空按钮） */
  formFooter?: ReactNode;
  /** 标题右侧的可选操作（如价格明细按钮） */
  headerAction?: ReactNode;
  /** 传给 `<form>` 的 className */
  formClassName?: string;
  /** Current locale — controls which *En fields are displayed */
  locale?: "zh" | "en";
}

/**
 * 根据 `WorkflowFormSchema` 动态挂载控件，并与 `useWorkflowStore` 同步。
 * 适合作为页面级「工作流参数」容器；若需多实例可后续扩展为 Context + 独立 store factory。
 *
 * 叶子控件通过 `widgets` 映射解析：`field.kind` 为主键；`uiSchema[fieldId]["ui:widget"]` 可覆盖为
 * `multiImageUploader`（须配合 `kind: "multiImageUpload"` 与 store 中的数组形态值）。
 */
export function DynamicForm({ schema, errors = {}, onSubmit, formFooter, headerAction, formClassName, locale = "zh" }: DynamicFormProps) {
  const hydrateSchema = useWorkflowStore((s) => s.hydrateSchema);
  const descriptionTooltipId = useId();
  const description = schema.description
    ? loc(schema.description, schema.descriptionEn, locale)
    : null;

  /** 与父级 `applySku` / 首屏拉目录后的 `hydrateSchema` 对齐，避免相同 schema 引用下二次 hydrate 清空已上传预览 */
  useEffect(() => {
    if (!schema) return;
    if (useWorkflowStore.getState().schema === schema) return;
    hydrateSchema(schema);
  }, [schema, hydrateSchema]);

  const inner = (
    <>
      {(schema.title || description) && (
        <div className="relative flex items-center gap-2">
          {schema.title && (
            <h2 className="text-base font-semibold tracking-tight text-slate-100">
              {loc(schema.title, schema.titleEn, locale)}
            </h2>
          )}
          {description && (
            <>
              <button
                type="button"
                aria-label={locale === "en" ? "Workflow description" : "工作流说明"}
                aria-describedby={descriptionTooltipId}
                className="peer inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-500 text-xs font-semibold leading-none text-slate-400 transition-colors hover:border-sky-400 hover:text-sky-300 focus:outline-none focus-visible:border-sky-400 focus-visible:text-sky-300 focus-visible:ring-2 focus-visible:ring-sky-400/30"
              >
                ?
              </button>
              <span
                id={descriptionTooltipId}
                role="tooltip"
                className="pointer-events-none invisible absolute left-0 top-full z-30 mt-2 w-full max-w-[26rem] rounded-lg border border-[#345071] bg-[#0b1424] px-3 py-2 text-left text-xs font-normal leading-relaxed text-slate-300 opacity-0 shadow-xl shadow-black/40 transition-opacity peer-hover:visible peer-hover:opacity-100 peer-focus:visible peer-focus:opacity-100"
              >
                {description}
              </span>
            </>
          )}
          {headerAction}
        </div>
      )}
      <div className="min-w-0 max-w-full space-y-8 overflow-hidden">
        {schema.fields.map((field) => (
          <FieldBranch key={field.id} field={field} schema={schema} errors={errors} />
        ))}
      </div>
      {formFooter}
    </>
  );

  if (onSubmit) {
    return (
      <FormErrorBoundary>
        <LocaleContext.Provider value={locale}>
          <form onSubmit={onSubmit} className={formClassName ?? "min-w-0 max-w-full space-y-5 overflow-hidden p-5"}>
            {inner}
          </form>
        </LocaleContext.Provider>
      </FormErrorBoundary>
    );
  }

  return (
    <FormErrorBoundary>
      <LocaleContext.Provider value={locale}>
        <div className="min-w-0 max-w-full space-y-5 overflow-hidden p-5">{inner}</div>
      </LocaleContext.Provider>
    </FormErrorBoundary>
  );
}

function FieldBranch({
  field,
  schema,
  errors,
}: {
  field: WorkflowField;
  schema: WorkflowFormSchema;
  errors: Record<string, string>;
}) {
  const locale = useContext(LocaleContext);

  if (isGroupField(field)) {
    return (
      <fieldset className="min-w-0 max-w-full overflow-hidden rounded-xl border border-[#1e2d4a] bg-[#1a2840]/50 p-4">
        {loc(field.label, field.labelEn, locale) && (
          <legend className="px-1 text-sm font-semibold text-slate-300">
            {loc(field.label, field.labelEn, locale)}
          </legend>
        )}
        {field.description && (
          <p className="mb-4 text-xs text-slate-500">
            {loc(field.description, field.descriptionEn, locale)}
          </p>
        )}
        <div className="min-w-0 max-w-full space-y-6 overflow-hidden pt-1">
          {field.children.map((child) => (
            <FieldBranch key={child.id} field={child} schema={schema} errors={errors} />
          ))}
        </div>
      </fieldset>
    );
  }

  const err = errors[field.id];
  const useSpanLabel = field.kind === "imageUpload" || field.kind === "videoUpload" || field.kind === "multiImageUpload";
  const displayLabel = loc(field.label, field.labelEn, locale);

  return (
    <div className="min-w-0 max-w-full space-y-2 overflow-hidden">
      {displayLabel && (
        useSpanLabel ? (
          <span className="block text-sm font-medium text-slate-300">{displayLabel}</span>
        ) : (
          <label htmlFor={field.id} className="block text-sm font-medium text-slate-300">
            {displayLabel}
          </label>
        )
      )}
      {renderLeaf(field, schema, err, locale)}
    </div>
  );
}

/** 与 RJSF `ui:widget` 命名对齐的叶子控件注册表 */
const widgets = {
  imageUpload: (field: WorkflowField, error?: string, locale?: "zh" | "en") => {
    if (isGroupField(field) || field.kind !== "imageUpload") return null;
    return <ImageUploadControl field={field} error={error} locale={locale} />;
  },
  videoUpload: (field: WorkflowField, error?: string, locale?: "zh" | "en") => {
    if (isGroupField(field) || field.kind !== "videoUpload") return null;
    return <VideoUploadControl field={field} error={error} locale={locale} />;
  },
  multiImageUploader: (field: WorkflowField, error?: string, locale?: "zh" | "en") => {
    if (isGroupField(field)) return null;
    if (field.kind === "multiImageUpload") {
      return <MultiImageUploadWidget field={field} error={error} locale={locale} />;
    }
    if (field.kind === "imageUpload") {
      return <ImageUploadControl field={field} error={error} locale={locale} />;
    }
    return null;
  },
  textInput: (field: WorkflowField, error?: string, locale?: "zh" | "en") => {
    if (isGroupField(field) || field.kind !== "textInput") return null;
    return <TextInputControl field={field} error={error} locale={locale} />;
  },
  numberSlider: (field: WorkflowField, error?: string, locale?: "zh" | "en") => {
    if (isGroupField(field) || field.kind !== "numberSlider") return null;
    return <NumberSliderControl field={field} error={error} locale={locale} />;
  },
  select: (field: WorkflowField, error?: string, locale?: "zh" | "en") => {
    if (isGroupField(field) || field.kind !== "select") return null;
    return <SelectControl field={field} error={error} locale={locale} />;
  },
} as const;

type WidgetKey = keyof typeof widgets;

function resolveLeafWidgetKey(field: WorkflowField, uiSchema?: Record<string, unknown>): WidgetKey | null {
  if (isGroupField(field)) return null;
  const entry = uiSchema?.[field.id];
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const w = (entry as Record<string, unknown>)["ui:widget"];
    if (w === "multiImageUploader") return "multiImageUploader";
  }
  if (field.kind === "multiImageUpload") return "multiImageUploader";
  if (field.kind === "videoUpload") return "videoUpload";
  if (field.kind in widgets) return field.kind as WidgetKey;
  return null;
}

function renderLeaf(field: WorkflowField, schema: WorkflowFormSchema, error?: string, locale?: "zh" | "en") {
  if (isGroupField(field)) return null;
  const key = resolveLeafWidgetKey(field, schema.uiSchema);
  if (!key) return null;
  return widgets[key](field, error, locale);
}
