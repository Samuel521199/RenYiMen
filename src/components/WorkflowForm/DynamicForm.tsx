"use client";

import { useEffect, type FormEventHandler, type ReactNode } from "react";
import type { WorkflowField, WorkflowFormSchema } from "@/types/workflow";
import { isGroupField } from "@/types/workflow";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { ImageUploadControl } from "@/components/WorkflowForm/controls/ImageUploadControl";
import { MultiImageUploadWidget } from "@/components/WorkflowForm/controls/MultiImageUploadWidget";
import { TextInputControl } from "@/components/WorkflowForm/controls/TextInputControl";
import { NumberSliderControl } from "@/components/WorkflowForm/controls/NumberSliderControl";
import { SelectControl } from "@/components/WorkflowForm/controls/SelectControl";

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
  /** 传给 `<form>` 的 className */
  formClassName?: string;
}

/**
 * 根据 `WorkflowFormSchema` 动态挂载控件，并与 `useWorkflowStore` 同步。
 * 适合作为页面级「工作流参数」容器；若需多实例可后续扩展为 Context + 独立 store factory。
 *
 * 叶子控件通过 `widgets` 映射解析：`field.kind` 为主键；`uiSchema[fieldId]["ui:widget"]` 可覆盖为
 * `multiImageUploader`（须配合 `kind: "multiImageUpload"` 与 store 中的数组形态值）。
 */
export function DynamicForm({ schema, errors = {}, onSubmit, formFooter, formClassName }: DynamicFormProps) {
  const hydrateSchema = useWorkflowStore((s) => s.hydrateSchema);

  /** 与父级 `applySku` / 首屏拉目录后的 `hydrateSchema` 对齐，避免相同 schema 引用下二次 hydrate 清空已上传预览 */
  useEffect(() => {
    if (!schema) return;
    if (useWorkflowStore.getState().schema === schema) return;
    hydrateSchema(schema);
  }, [schema, hydrateSchema]);

  const inner = (
    <>
      {schema.title && <h2 className="text-base font-semibold tracking-tight text-slate-100">{schema.title}</h2>}
      {schema.description && <p className="text-sm leading-relaxed text-slate-400">{schema.description}</p>}
      <div className="space-y-8">
        {schema.fields.map((field) => (
          <FieldBranch key={field.id} field={field} schema={schema} errors={errors} />
        ))}
      </div>
      {formFooter}
    </>
  );

  if (onSubmit) {
    return (
      <form onSubmit={onSubmit} className={formClassName ?? "space-y-5 p-5"}>
        {inner}
      </form>
    );
  }

  return <div className="space-y-5 p-5">{inner}</div>;
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
  if (isGroupField(field)) {
    return (
      <fieldset className="rounded-xl border border-[#1e2d4a] bg-[#1a2840]/50 p-4">
        <legend className="px-1 text-sm font-semibold text-slate-300">{field.label}</legend>
        {field.description && <p className="mb-4 text-xs text-slate-500">{field.description}</p>}
        <div className="space-y-6 pt-1">
          {field.children.map((child) => (
            <FieldBranch key={child.id} field={child} schema={schema} errors={errors} />
          ))}
        </div>
      </fieldset>
    );
  }

  const err = errors[field.id];
  const useSpanLabel = field.kind === "imageUpload" || field.kind === "multiImageUpload";

  return (
    <div className="space-y-2">
      {useSpanLabel ? (
        <span className="block text-sm font-medium text-slate-300">{field.label}</span>
      ) : (
        <label htmlFor={field.id} className="block text-sm font-medium text-slate-300">
          {field.label}
        </label>
      )}
      {renderLeaf(field, schema, err)}
    </div>
  );
}

/** 与 RJSF `ui:widget` 命名对齐的叶子控件注册表 */
const widgets = {
  imageUpload: (field: WorkflowField, error?: string) => {
    if (isGroupField(field) || field.kind !== "imageUpload") return null;
    return <ImageUploadControl field={field} error={error} />;
  },
  multiImageUploader: (field: WorkflowField, error?: string) => {
    if (isGroupField(field)) return null;
    if (field.kind === "multiImageUpload") {
      return <MultiImageUploadWidget field={field} error={error} />;
    }
    if (field.kind === "imageUpload") {
      return <ImageUploadControl field={field} error={error} />;
    }
    return null;
  },
  textInput: (field: WorkflowField, error?: string) => {
    if (isGroupField(field) || field.kind !== "textInput") return null;
    return <TextInputControl field={field} error={error} />;
  },
  numberSlider: (field: WorkflowField, error?: string) => {
    if (isGroupField(field) || field.kind !== "numberSlider") return null;
    return <NumberSliderControl field={field} error={error} />;
  },
  select: (field: WorkflowField, error?: string) => {
    if (isGroupField(field) || field.kind !== "select") return null;
    return <SelectControl field={field} error={error} />;
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
  if (field.kind in widgets) return field.kind as WidgetKey;
  return null;
}

function renderLeaf(field: WorkflowField, schema: WorkflowFormSchema, error?: string) {
  if (isGroupField(field)) return null;
  const key = resolveLeafWidgetKey(field, schema.uiSchema);
  if (!key) return null;
  return widgets[key](field, error);
}
