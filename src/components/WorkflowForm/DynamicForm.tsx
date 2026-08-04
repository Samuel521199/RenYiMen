"use client";

import { createContext, useContext, useEffect, useId, type FormEventHandler, type ReactNode } from "react";
import { FormErrorBoundary } from "@/components/WorkflowForm/FormErrorBoundary";
import type { MediaUploadFieldKind, WorkflowField, WorkflowFormSchema } from "@/types/workflow";
import { isGroupField, isMediaUploadField } from "@/types/workflow";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { ImageUploadControl } from "@/components/WorkflowForm/controls/ImageUploadControl";
import { VideoUploadControl } from "@/components/WorkflowForm/controls/VideoUploadControl";
import { AudioUploadControl } from "@/components/WorkflowForm/controls/AudioUploadControl";
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

type UploadField = Extract<WorkflowField, { kind: "imageUpload" | "videoUpload" | "audioUpload" | "multiImageUpload" }>;

function isUploadField(field: WorkflowField): field is UploadField {
  return !isGroupField(field) && (
    field.kind === "imageUpload" ||
    field.kind === "videoUpload" ||
    field.kind === "audioUpload" ||
    field.kind === "multiImageUpload"
  );
}

const MIME_LABELS: Record<string, string> = {
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WebP",
  "image/bmp": "BMP",
  "video/mp4": "MP4",
  "video/webm": "WebM",
  "video/quicktime": "MOV",
  "video/x-msvideo": "AVI",
  "audio/mpeg": "MP3",
  "audio/mp3": "MP3",
  "audio/wav": "WAV",
  "audio/x-wav": "WAV",
};

/** Build any upload constraints that are present in validation but missing from authored help copy. */
function uploadConstraintHelp(field: WorkflowField, locale: "zh" | "en", existingHelp: string): string | null {
  if (!isUploadField(field)) return null;
  const validation = field.validation;
  if (!validation) return null;

  const normalized = existingHelp.toLowerCase().replace(/\s+/g, "");
  const parts: string[] = [];
  const formats = [...new Set((validation.accept ?? []).map((mime) => MIME_LABELS[mime]).filter(Boolean))];
  if (formats.length > 0 && !formats.every((format) => normalized.includes(format.toLowerCase()))) {
    parts.push(locale === "en" ? `Formats: ${formats.join(", ")}` : `格式：${formats.join("、")}`);
  }
  if (validation.maxSizeMB && !new RegExp(`${validation.maxSizeMB}(?:\\.0+)?mb`, "i").test(normalized)) {
    parts.push(locale === "en" ? `Max ${validation.maxSizeMB} MB` : `文件不超过 ${validation.maxSizeMB}MB`);
  }
  if (validation.minDimension && !new RegExp(`${validation.minDimension}(?:px|像素)`, "i").test(normalized)) {
    parts.push(locale === "en" ? `Width and height at least ${validation.minDimension}px` : `宽高均不小于 ${validation.minDimension}px`);
  }
  if (validation.minDurationSec && !new RegExp(`${validation.minDurationSec}(?:s|sec|seconds?|秒)`, "i").test(normalized)) {
    parts.push(locale === "en" ? `At least ${validation.minDurationSec}s` : `时长不少于 ${validation.minDurationSec} 秒`);
  }
  if (validation.maxDurationSec && !new RegExp(`${validation.maxDurationSec}(?:s|sec|seconds?|秒)`, "i").test(normalized)) {
    parts.push(locale === "en" ? `Up to ${validation.maxDurationSec}s` : `时长不超过 ${validation.maxDurationSec} 秒`);
  }
  if (field.kind === "multiImageUpload" && field.maxItems && !new RegExp(`${field.maxItems}(?:images?|files?|张)`, "i").test(normalized)) {
    parts.push(locale === "en" ? `Up to ${field.maxItems} images` : `最多 ${field.maxItems} 张`);
  }
  if (parts.length === 0) return null;
  return locale === "en"
    ? `Upload requirements: ${parts.join("; ")}.`
    : `上传要求：${parts.join("；")}。`;
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
        <div className="relative flex items-start justify-between gap-4 border-b border-white/[0.07] pb-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {schema.title && (
                <h2 className="truncate text-xl font-semibold tracking-[-0.02em] text-slate-50">
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
                className="pointer-events-none invisible absolute left-0 top-full z-30 mt-2 w-full max-w-[28rem] rounded-xl border border-white/10 bg-[#091221]/95 px-3.5 py-3 text-left text-xs font-normal leading-relaxed text-slate-300 opacity-0 shadow-2xl shadow-black/50 backdrop-blur-xl transition-all duration-200 peer-hover:visible peer-hover:translate-y-0 peer-hover:opacity-100 peer-focus:visible peer-focus:opacity-100"
              >
                {description}
              </span>
            </>
          )}
            </div>
          </div>
          <div className="shrink-0 pt-1">{headerAction}</div>
        </div>
      )}
      <div className="grid min-w-0 max-w-full grid-cols-1 gap-5 overflow-visible xl:grid-cols-2 [&>fieldset]:col-span-full">
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
          <form onSubmit={onSubmit} className={formClassName ?? "min-w-0 max-w-full space-y-5 overflow-hidden p-5 lg:p-6"}>
            {inner}
          </form>
        </LocaleContext.Provider>
      </FormErrorBoundary>
    );
  }

  return (
    <FormErrorBoundary>
      <LocaleContext.Provider value={locale}>
        <div className="min-w-0 max-w-full space-y-5 overflow-hidden p-5 lg:p-6">{inner}</div>
      </LocaleContext.Provider>
    </FormErrorBoundary>
  );
}

function FieldBranch({
  field,
  schema,
  errors,
  inheritedDescription,
}: {
  field: WorkflowField;
  schema: WorkflowFormSchema;
  errors: Record<string, string>;
  inheritedDescription?: string;
}) {
  const locale = useContext(LocaleContext);
  const fieldHelpId = useId();

  if (isGroupField(field)) {
    const groupDescription = field.description
      ? loc(field.description, field.descriptionEn, locale)
      : null;
    const movesDescriptionToUploads = Boolean(groupDescription && field.children.some(isUploadField));
    return (
      <fieldset className="group/section min-w-0 max-w-full overflow-visible rounded-2xl border border-white/[0.07] bg-gradient-to-br from-white/[0.045] to-white/[0.018] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] transition-colors duration-300 hover:border-white/[0.11] lg:p-5 xl:col-span-2">
        {loc(field.label, field.labelEn, locale) && (
          <legend className="px-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            {loc(field.label, field.labelEn, locale)}
          </legend>
        )}
        {groupDescription && !movesDescriptionToUploads && (
          <p className="mb-5 max-w-2xl px-1 text-xs leading-relaxed text-slate-500">
            {groupDescription}
          </p>
        )}
        <div className="grid min-w-0 max-w-full grid-cols-1 gap-x-5 gap-y-5 overflow-visible pt-2 xl:grid-cols-2 [&>*:last-child:nth-child(odd)]:xl:col-span-2 [&>fieldset]:col-span-full">
          {field.children.map((child) => (
            <FieldBranch
              key={child.id}
              field={child}
              schema={schema}
              errors={errors}
              inheritedDescription={movesDescriptionToUploads && isUploadField(child) ? groupDescription ?? undefined : undefined}
            />
          ))}
        </div>
      </fieldset>
    );
  }

  const err = errors[field.id];
  const useSpanLabel = isMediaUploadField(field);
  const displayLabel = loc(field.label, field.labelEn, locale);
  const authoredDescription = field.description
    ? loc(field.description, field.descriptionEn, locale)
    : null;
  const authoredHelp = [inheritedDescription, authoredDescription].filter(Boolean).join(" ");
  const constraintHelp = uploadConstraintHelp(field, locale, authoredHelp);
  const fieldDescription = [authoredHelp, constraintHelp].filter(Boolean).join(" ") || null;

  const fullWidthClass = field.kind === "multiImageUpload" ? "xl:col-span-2" : "";

  return (
    <div className={`min-w-0 max-w-full space-y-2.5 overflow-visible ${fullWidthClass}`}>
      {(displayLabel || fieldDescription) && (
        <div className="relative flex items-center gap-2">
          {displayLabel && (
            useSpanLabel ? (
              <span className="block text-[13px] font-medium text-slate-300">{displayLabel}</span>
            ) : (
              <label htmlFor={field.id} className="block text-[13px] font-medium text-slate-300">
                {displayLabel}
              </label>
            )
          )}
          {fieldDescription && (
            <div className="group/help relative inline-flex shrink-0">
              <button
                type="button"
                aria-label={locale === "en" ? `${displayLabel || "Field"} help` : `${displayLabel || "字段"}说明`}
                aria-describedby={fieldHelpId}
                className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border border-slate-500/80 text-[10px] font-semibold leading-none text-slate-400 transition-all duration-200 hover:border-emerald-400/70 hover:bg-emerald-400/10 hover:text-emerald-300 focus:outline-none focus-visible:border-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-400/25"
              >
                ?
              </button>
              <span
                id={fieldHelpId}
                role="tooltip"
                className="pointer-events-none invisible absolute left-0 top-full z-40 mt-2 w-max max-w-[min(22rem,70vw)] translate-y-1 rounded-xl border border-white/10 bg-[#07111f]/95 px-3.5 py-2.5 text-left text-xs font-normal leading-relaxed text-slate-300 opacity-0 shadow-2xl shadow-black/50 backdrop-blur-xl transition-all duration-200 group-hover/help:visible group-hover/help:translate-y-0 group-hover/help:opacity-100 group-focus-within/help:visible group-focus-within/help:translate-y-0 group-focus-within/help:opacity-100"
              >
                {fieldDescription}
              </span>
            </div>
          )}
        </div>
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
  audioUpload: (field: WorkflowField, error?: string, locale?: "zh" | "en") => {
    if (isGroupField(field) || field.kind !== "audioUpload") return null;
    return <AudioUploadControl field={field} error={error} locale={locale} />;
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

/** 新增媒体字段 kind 时，TypeScript 会要求在此注册一个拖拽上传控件。 */
const mediaUploadWidgetByFieldKind = {
  imageUpload: "imageUpload",
  videoUpload: "videoUpload",
  audioUpload: "audioUpload",
  multiImageUpload: "multiImageUploader",
} as const satisfies Record<MediaUploadFieldKind, WidgetKey>;

function resolveLeafWidgetKey(field: WorkflowField, uiSchema?: Record<string, unknown>): WidgetKey | null {
  if (isGroupField(field)) return null;
  const entry = uiSchema?.[field.id];
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const w = (entry as Record<string, unknown>)["ui:widget"];
    if (w === "multiImageUploader") return "multiImageUploader";
  }
  if (isMediaUploadField(field)) return mediaUploadWidgetByFieldKind[field.kind];
  if (field.kind in widgets) return field.kind as WidgetKey;
  return null;
}

function renderLeaf(field: WorkflowField, schema: WorkflowFormSchema, error?: string, locale?: "zh" | "en") {
  if (isGroupField(field)) return null;
  const key = resolveLeafWidgetKey(field, schema.uiSchema);
  if (!key) return null;
  return widgets[key](field, error, locale);
}
