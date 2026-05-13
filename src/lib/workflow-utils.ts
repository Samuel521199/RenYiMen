import type {
  ImageFieldValue,
  ImageUploadField,
  MultiImageFieldValue,
  NumberSliderField,
  SelectField,
  TextInputField,
  WorkflowField,
  WorkflowFormSchema,
} from "@/types/workflow";
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
      return emptyImageValue((f as ImageUploadField).defaultValue);
    case "multiImageUpload":
      return emptyMultiImageValue();
    case "textInput":
      return (f as TextInputField).defaultValue ?? "";
    case "numberSlider": {
      const s = f as NumberSliderField;
      return s.defaultValue ?? s.validation.min;
    }
    case "select":
      return (f as SelectField).defaultValue ?? (f as SelectField).options[0]?.value ?? "";
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
