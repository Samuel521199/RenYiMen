import type {
  AudioUploadField,
  ImageFieldValue,
  ImageUploadField,
  BooleanToggleField,
  MultiImageFieldValue,
  NumberInputField,
  NumberSliderField,
  SelectField,
  VideoUploadField,
  WorkflowField,
  WorkflowFormSchema,
} from "@/types/workflow";
import { exceedsMediaDurationMaximum } from "@/lib/media-duration-boundary";
import { isGroupField } from "@/types/workflow";

export type ValuePath = (string | number)[];

/** 自根对象 `parameters` 起的路径，用于 Immer 深层读写 */
export type FieldPathMap = Record<string, ValuePath>;

/**
 * 深度优先遍历所有带 `mapping` 的叶子字段（不含 `group`）。
 */
export function* iterateLeafFields(fields: WorkflowField[]): Generator<WorkflowField> {
  for (const f of fields) {
    if (isGroupField(f)) {
      yield* iterateLeafFields(f.children);
    } else {
      yield f;
    }
  }
}

/**
 * 为每个叶子字段计算其在 `parameters` 树中的路径：`[...groupIds, fieldId]`。
 */
export function buildFieldPathMap(fields: WorkflowField[], prefix: ValuePath = []): FieldPathMap {
  const map: FieldPathMap = {};
  for (const f of fields) {
    if (isGroupField(f)) {
      Object.assign(map, buildFieldPathMap(f.children, [...prefix, f.id]));
    } else {
      map[f.id] = [...prefix, f.id];
    }
  }
  return map;
}

/**
 * 根据 Schema 写入各字段默认值，得到初始 `parameters` 嵌套对象。
 */
export function buildInitialParameters(schema: WorkflowFormSchema): Record<string, unknown> {
  const root: Record<string, unknown> = {};

  function walk(fields: WorkflowField[], prefix: ValuePath) {
    for (const f of fields) {
      if (isGroupField(f)) {
        const path = [...prefix, f.id];
        setAtPath(root, path, {});
        walk(f.children, path);
      } else {
        const path = [...prefix, f.id];
        setAtPath(root, path, defaultValueForField(f));
      }
    }
  }

  walk(schema.fields, []);
  return root;
}

function defaultValueForField(f: WorkflowField): unknown {
  switch (f.kind) {
    case "imageUpload":
    case "videoUpload":
    case "audioUpload":
      return emptyImageValue((f as ImageUploadField).defaultValue);
    case "multiImageUpload":
      return emptyMultiImageValue();
    case "textInput":
      // Text defaults are presentation examples, not submitted user input.
      // TextInputControl renders a legacy defaultValue as placeholder copy.
      return "";
    case "numberSlider": {
      const s = f as NumberSliderField;
      return s.defaultValue ?? s.validation.min;
    }
    case "numberInput": {
      const n = f as NumberInputField;
      return n.defaultValue ?? n.validation.min;
    }
    case "select":
      return (f as SelectField).defaultValue ?? (f as SelectField).options[0]?.value ?? "";
    case "booleanToggle":
      return (f as BooleanToggleField).defaultValue ?? false;
    default:
      return null;
  }
}

export function emptyImageValue(partial?: Partial<ImageFieldValue>): ImageFieldValue {
  return {
    status: "empty",
    ...partial,
  };
}

export function emptyMultiImageValue(partial?: Partial<MultiImageFieldValue>): MultiImageFieldValue {
  return {
    items: partial?.items ?? [],
  };
}

/**
 * 按路径读取嵌套值（纯函数，不依赖 Immer）。
 */
export function getAtPath(root: unknown, path: ValuePath): unknown {
  let cur: unknown = root;
  for (const seg of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[String(seg)];
  }
  return cur;
}

/** 条件字段统一判定：隐藏字段不渲染、不校验，也不会进入网关 payload。 */
export function isWorkflowFieldVisible(
  field: WorkflowField,
  parameters: Record<string, unknown>,
  fieldPaths: FieldPathMap,
): boolean {
  if (isGroupField(field) || !field.visibleWhen) return true;
  const dependencyPath = fieldPaths[field.visibleWhen.fieldId];
  if (!dependencyPath) return false;
  return getAtPath(parameters, dependencyPath) === field.visibleWhen.equals;
}

/** Resolve a numeric input's current maximum, including model-dependent limits. */
export function resolveNumberInputMax(
  field: NumberInputField,
  parameters: Record<string, unknown>,
  fieldPaths: FieldPathMap,
): number {
  const dynamic = field.maxByFieldValue;
  if (!dynamic) return field.validation.max;
  const dependencyPath = fieldPaths[dynamic.fieldId];
  if (!dependencyPath) return field.validation.max;
  const dependencyValue = getAtPath(parameters, dependencyPath);
  const dynamicMax = dynamic.values[String(dependencyValue)];
  return typeof dynamicMax === "number" && Number.isFinite(dynamicMax)
    ? Math.min(field.validation.max, dynamicMax)
    : field.validation.max;
}

export interface ResolvedMediaDurationRange {
  minDurationSec?: number;
  maxDurationSec?: number;
  minExclusive: boolean;
  maxExclusive: boolean;
  label?: string;
  labelEn?: string;
}

type DurationMediaField = AudioUploadField | VideoUploadField;

/** Resolve upload duration limits, including limits selected by another form field. */
export function resolveMediaDurationRange(
  field: DurationMediaField,
  parameters: Record<string, unknown>,
  fieldPaths: FieldPathMap,
): ResolvedMediaDurationRange {
  const validation = field.validation;
  const base: ResolvedMediaDurationRange = {
    minDurationSec: validation?.minDurationSec,
    maxDurationSec: validation?.maxDurationSec,
    minExclusive: false,
    // Preserve existing audio behavior: its static upper bound is exclusive.
    maxExclusive: field.kind === "audioUpload",
  };
  const dynamic = validation?.durationRangeByFieldValue;
  if (!dynamic) return base;
  const dependencyPath = fieldPaths[dynamic.fieldId];
  if (!dependencyPath) return base;
  const selected = dynamic.values[String(getAtPath(parameters, dependencyPath))];
  return selected
    ? {
        minDurationSec: selected.minDurationSec ?? base.minDurationSec,
        maxDurationSec: selected.maxDurationSec ?? base.maxDurationSec,
        minExclusive: selected.minExclusive ?? base.minExclusive,
        maxExclusive: selected.maxExclusive ?? base.maxExclusive,
        label: selected.label,
        labelEn: selected.labelEn,
      }
    : base;
}

export function mediaDurationRangeText(
  range: ResolvedMediaDurationRange,
  locale: "zh" | "en" = "zh",
): string {
  const min = range.minDurationSec;
  const max = range.maxDurationSec;
  if (locale === "en") {
    const bounds = [
      min == null ? "" : `${range.minExclusive ? "more than" : "at least"} ${min}s`,
      max == null ? "" : `${range.maxExclusive ? "less than" : "up to"} ${max}s`,
    ].filter(Boolean).join(" and ");
    return `${range.labelEn ? `${range.labelEn}: ` : ""}${bounds}`;
  }
  const bounds = [
    min == null ? "" : `${range.minExclusive ? "大于" : "不少于"} ${min} 秒`,
    max == null ? "" : `${range.maxExclusive ? "小于" : "不超过"} ${max} 秒`,
  ].filter(Boolean).join("且");
  return `${range.label ? `${range.label}：` : ""}${bounds}`;
}

export function validateMediaDuration(
  field: DurationMediaField,
  durationSec: number | undefined,
  parameters: Record<string, unknown>,
  fieldPaths: FieldPathMap,
  locale: "zh" | "en" = "zh",
  mediaKind: "audio" | "video" = field.kind === "audioUpload" ? "audio" : "video",
): string | null {
  if (durationSec == null || !Number.isFinite(durationSec)) return null;
  const range = resolveMediaDurationRange(field, parameters, fieldPaths);
  const belowMinimum = range.minDurationSec != null && (
    range.minExclusive ? durationSec <= range.minDurationSec : durationSec < range.minDurationSec
  );
  const aboveMaximum = range.maxDurationSec != null && (
    exceedsMediaDurationMaximum(durationSec, range.maxDurationSec, range.maxExclusive)
  );
  if (!belowMinimum && !aboveMaximum) return null;
  const current = durationSec.toFixed(1);
  return locale === "en"
    ? `Current ${mediaKind} is ${current}s. Required: ${mediaDurationRangeText(range, "en")}.`
    : `当前${mediaKind === "audio" ? "音频" : "视频"}为 ${current} 秒；要求${mediaDurationRangeText(range, "zh")}。`;
}

/**
 * 可变写入：用于 Immer draft 或普通对象初始化。
 */
export function setAtPath(root: Record<string, unknown>, path: ValuePath, value: unknown): void {
  if (path.length === 0) return;
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < path.length - 1; i++) {
    const k = String(path[i]);
    const next = cur[k];
    if (next == null || typeof next !== "object" || Array.isArray(next)) {
      cur[k] = {};
    }
    cur = cur[k] as Record<string, unknown>;
  }
  cur[String(path[path.length - 1])] = value as unknown;
}
