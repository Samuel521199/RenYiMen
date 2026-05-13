import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { GenerationHistory } from "@prisma/client";
import { GenerationHistoryStatus } from "@prisma/client";
import type {
  ImageFieldValue,
  MultiImageFieldValue,
  MultiImageItemValue,
  WorkflowApiPayload,
  WorkflowFormSchema,
  WorkflowField,
} from "@/types/workflow";
import { isGroupField } from "@/types/workflow";
import {
  buildFieldPathMap,
  buildInitialParameters,
  emptyImageValue,
  getAtPath,
  iterateLeafFields,
  type ValuePath,
} from "@/lib/workflow-utils";
import { uploadImageToOSS } from "@/services/oss-upload";

export interface WorkflowStoreState {
  schema: WorkflowFormSchema | null;
  /** 叶子字段 id → 在 `parameters` 中的嵌套路径 */
  fieldPaths: Record<string, ValuePath>;
  /** 与 Schema 分组结构一致的嵌套参数树 */
  parameters: Record<string, unknown>;

  /** 当前大厅 SKU（写入 buildPayload，供网关路由） */
  gatewaySkuId: string | null;
  gatewayProviderCode: string | null;

  /** 从 `/api/user/history` 拉取的 `GenerationHistory`（成功且含 `resultUrl`） */
  cloudHistory: GenerationHistory[];
  /** 主舞台正在回看的历史任务 `taskId`；`null` 表示跟当前轮询中的新任务 */
  viewingHistoryId: string | null;

  /** 用 Schema 重置路径映射与默认值 */
  hydrateSchema: (schema: WorkflowFormSchema) => void;
  /** 切换 SKU 时写入 skuId / providerCode（应在 hydrateSchema 前或后立刻调用） */
  setGatewaySelection: (skuId: string, providerCode: string) => void;
  /** 任意深度写入（Immer） */
  setAtPath: (path: ValuePath, value: unknown) => void;
  /** 按叶子字段 id 写入 */
  setFieldValue: (fieldId: string, value: unknown) => void;
  /** 图片：选择文件后走本地预览 + OSS 直传 */
  applyImageFile: (fieldId: string, file: File) => Promise<void>;
  /** 多图：追加若干文件（受 `maxItems` 与剩余槽位限制），各槽位独立上传 */
  appendMultiImageFiles: (fieldId: string, files: File[]) => Promise<void>;
  /** 多图：按槽位移除并 revoke 本地预览 */
  removeMultiImageSlot: (fieldId: string, slotId: string) => void;
  /** 清空图片并 revoke 预览 */
  clearImageField: (fieldId: string) => void;
  reset: () => void;
  validate: () => Record<string, string>;
  buildPayload: () => WorkflowApiPayload | null;

  setViewingHistoryId: (id: string | null) => void;
  /** 拉取 `/api/user/history` 并写入 `cloudHistory` */
  fetchCloudHistory: () => Promise<void>;
  /** 乐观删除一条云端历史并异步请求 DELETE */
  deleteCloudHistoryItem: (taskId: string) => Promise<void>;
}

function setAtPathDraft(draft: Record<string, unknown>, path: ValuePath, value: unknown) {
  if (path.length === 0) return;
  let cur: Record<string, unknown> = draft;
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

/**
 * 将 RunningHub 风格的 `inputPath` 合并进节点的 inputs 对象（支持多层 key）。
 */
function deepAssignInput(
  nodeRoot: Record<string, unknown>,
  inputPath: string[],
  value: unknown
): void {
  if (inputPath.length === 0) return;
  if (inputPath.length === 1) {
    nodeRoot[inputPath[0]] = value;
    return;
  }
  const [head, ...rest] = inputPath;
  const next = nodeRoot[head];
  if (next == null || typeof next !== "object" || Array.isArray(next)) {
    nodeRoot[head] = {};
  }
  deepAssignInput(nodeRoot[head] as Record<string, unknown>, rest, value);
}

function mapLeafToApiValue(field: WorkflowField, raw: unknown): unknown {
  if (isGroupField(field)) return undefined;
  switch (field.kind) {
    case "imageUpload": {
      const v = raw as ImageFieldValue;
      if (v?.status === "ready" && v.remoteUrl) return v.remoteUrl;
      return undefined;
    }
    case "multiImageUpload": {
      const v = raw as MultiImageFieldValue | undefined;
      const urls =
        v?.items
          ?.filter((it) => it.status === "ready" && typeof it.remoteUrl === "string" && it.remoteUrl.length > 0)
          .map((it) => it.remoteUrl as string) ?? [];
      return urls.length > 0 ? urls : undefined;
    }
    case "textInput":
      return typeof raw === "string" ? raw : "";
    case "numberSlider":
      return typeof raw === "number" ? raw : field.validation.min;
    case "select":
      return typeof raw === "string" ? raw : "";
    default:
      return raw;
  }
}

export const useWorkflowStore = create<WorkflowStoreState>()(
  immer((set, get) => ({
    schema: null,
    fieldPaths: {},
    parameters: {},

    gatewaySkuId: null,
    gatewayProviderCode: null,

    cloudHistory: [],
    viewingHistoryId: null,

    hydrateSchema: (schema) =>
      set((draft) => {
        revokeAllPreviewUrls(draft.parameters);
        draft.schema = schema;
        draft.fieldPaths = buildFieldPathMap(schema.fields);
        draft.parameters = buildInitialParameters(schema);
      }),

    setGatewaySelection: (skuId, providerCode) =>
      set((draft) => {
        draft.gatewaySkuId = skuId;
        draft.gatewayProviderCode = providerCode;
      }),

    setAtPath: (path, value) =>
      set((draft) => {
        setAtPathDraft(draft.parameters, path, value);
      }),

    setFieldValue: (fieldId, value) =>
      set((draft) => {
        const p = draft.fieldPaths[fieldId];
        if (!p) return;
        setAtPathDraft(draft.parameters, p, value);
      }),

    applyImageFile: async (fieldId, file) => {
      const state = get();
      const path = state.fieldPaths[fieldId];
      const schema = state.schema;
      if (!path || !schema) return;

      const field = [...iterateLeafFields(schema.fields)].find((f) => f.id === fieldId);
      if (!field || field.kind !== "imageUpload") return;

      const maxMb = field.validation?.maxSizeMB;
      if (maxMb != null && file.size > maxMb * 1024 * 1024) {
        set((draft) => {
          setAtPathDraft(draft.parameters, path, {
            status: "error",
            fileName: file.name,
            errorMessage: `文件超过 ${maxMb}MB`,
          } satisfies ImageFieldValue);
        });
        return;
      }

      const previewUrl = URL.createObjectURL(file);
      set((draft) => {
        const prev = getAtPath(draft.parameters, path) as ImageFieldValue | undefined;
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        setAtPathDraft(draft.parameters, path, {
          status: "uploading",
          previewUrl,
          fileName: file.name,
        } satisfies ImageFieldValue);
      });

      try {
        const remoteUrl = await uploadImageToOSS(file);
        set((draft) => {
          setAtPathDraft(draft.parameters, path, {
            status: "ready",
            previewUrl,
            remoteUrl,
            fileName: file.name,
          } satisfies ImageFieldValue);
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "上传失败";
        set((draft) => {
          const cur = getAtPath(draft.parameters, path) as ImageFieldValue | undefined;
          /** 保留 `previewUrl`，便于控件区点击重新选择文件 */
          setAtPathDraft(draft.parameters, path, {
            status: "error",
            previewUrl: cur?.previewUrl,
            fileName: file.name,
            errorMessage: msg,
          } satisfies ImageFieldValue);
        });
      }
    },

    appendMultiImageFiles: async (fieldId, files) => {
      const state = get();
      const schema = state.schema;
      if (!schema) return;

      let path: ValuePath | undefined = state.fieldPaths[fieldId];
      if (!path?.length) {
        const fresh = buildFieldPathMap(schema.fields);
        path = fresh[fieldId];
        if (!path?.length) return;
        set((draft) => {
          Object.assign(draft.fieldPaths, fresh);
        });
      }

      const field = [...iterateLeafFields(schema.fields)].find((f) => f.id === fieldId);
      if (!field || field.kind !== "multiImageUpload") return;

      const maxItems = Math.min(9, Math.max(1, field.maxItems ?? 9));
      const list = Array.from(files);
      if (list.length === 0) return;

      const cur = (getAtPath(get().parameters, path) as MultiImageFieldValue | undefined)?.items ?? [];
      const room = maxItems - cur.length;
      if (room <= 0) return;

      const toAdd = list.slice(0, room);
      const maxMb = field.validation?.maxSizeMB;

      const newSlotRows: MultiImageItemValue[] = [];
      const additions: { slotId: string; file: File; previewUrl: string }[] = [];

      for (const file of toAdd) {
        const slotId =
          typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto
            ? globalThis.crypto.randomUUID()
            : `slot_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        if (maxMb != null && file.size > maxMb * 1024 * 1024) {
          newSlotRows.push({
            id: slotId,
            status: "error",
            fileName: file.name,
            errorMessage: `文件超过 ${maxMb}MB`,
          } satisfies MultiImageItemValue);
          continue;
        }
        const previewUrl = URL.createObjectURL(file);
        newSlotRows.push({
          id: slotId,
          status: "uploading",
          previewUrl,
          fileName: file.name,
        } satisfies MultiImageItemValue);
        additions.push({ slotId, file, previewUrl });
      }

      if (newSlotRows.length === 0) return;

      set((draft) => {
        const prevItems =
          (getAtPath(draft.parameters, path) as MultiImageFieldValue | undefined)?.items ?? [];
        setAtPathDraft(draft.parameters, path, {
          items: [...prevItems, ...newSlotRows],
        } satisfies MultiImageFieldValue);
      });

      await Promise.all(
        additions.map(async ({ slotId, file, previewUrl }) => {
          try {
            const remoteUrl = await uploadImageToOSS(file);
            set((draft) => {
              const block = getAtPath(draft.parameters, path) as MultiImageFieldValue | undefined;
              const items = (block?.items ?? []).map((it) =>
                it.id === slotId
                  ? ({
                      ...it,
                      status: "ready" as const,
                      remoteUrl,
                      fileName: file.name,
                      errorMessage: undefined,
                    } satisfies MultiImageItemValue)
                  : it
              );
              setAtPathDraft(draft.parameters, path, { items } satisfies MultiImageFieldValue);
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : "上传失败";
            set((draft) => {
              const block = getAtPath(draft.parameters, path) as MultiImageFieldValue | undefined;
              const items = (block?.items ?? []).map((it) =>
                it.id === slotId
                  ? ({
                      id: slotId,
                      status: "error" as const,
                      previewUrl,
                      fileName: file.name,
                      errorMessage: msg,
                    } satisfies MultiImageItemValue)
                  : it
              );
              setAtPathDraft(draft.parameters, path, { items } satisfies MultiImageFieldValue);
            });
          }
        })
      );
    },

    removeMultiImageSlot: (fieldId, slotId) =>
      set((draft) => {
        const path = draft.fieldPaths[fieldId];
        if (!path) return;
        const block = getAtPath(draft.parameters, path) as MultiImageFieldValue | undefined;
        const items = block?.items ?? [];
        const target = items.find((it) => it.id === slotId);
        if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
        setAtPathDraft(draft.parameters, path, {
          items: items.filter((it) => it.id !== slotId),
        } satisfies MultiImageFieldValue);
      }),

    clearImageField: (fieldId) =>
      set((draft) => {
        const path = draft.fieldPaths[fieldId];
        if (!path) return;
        const prev = getAtPath(draft.parameters, path) as ImageFieldValue | undefined;
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        setAtPathDraft(draft.parameters, path, emptyImageValue());
      }),

    reset: () =>
      set((draft) => {
        revokeAllPreviewUrls(draft.parameters);
        if (!draft.schema) {
          draft.parameters = {};
          return;
        }
        draft.parameters = buildInitialParameters(draft.schema);
      }),

    validate: () => {
      const { schema, parameters, fieldPaths } = get();
      const errors: Record<string, string> = {};
      if (!schema) return errors;

      for (const field of iterateLeafFields(schema.fields)) {
        if (isGroupField(field)) continue;
        const path = fieldPaths[field.id];
        const raw = path ? getAtPath(parameters, path) : undefined;

        switch (field.kind) {
          case "imageUpload": {
            const v = raw as ImageFieldValue | undefined;
            if (field.validation?.required && (!v || v.status !== "ready" || !v.remoteUrl)) {
              errors[field.id] = "请完成图片上传";
            }
            if (v?.status === "error") {
              errors[field.id] = v.errorMessage ?? "图片处理失败";
            }
            if (v?.status === "uploading") {
              errors[field.id] = "图片仍在上传中";
            }
            break;
          }
          case "multiImageUpload": {
            const v = raw as MultiImageFieldValue | undefined;
            const items = v?.items ?? [];
            if (items.some((it) => it.status === "uploading")) {
              errors[field.id] = "图片仍在上传中";
              break;
            }
            const errItem = items.find((it) => it.status === "error");
            if (errItem) {
              errors[field.id] = errItem.errorMessage ?? "某张图片上传失败";
              break;
            }
            if (field.validation?.required) {
              const readyCount = items.filter((it) => it.status === "ready" && it.remoteUrl).length;
              if (readyCount < 1) errors[field.id] = "请至少上传一张参考图";
            }
            break;
          }
          case "textInput": {
            const t = typeof raw === "string" ? raw : "";
            const r = field.validation;
            if (r?.required && !t.trim()) errors[field.id] = "必填";
            if (r?.minLength != null && t.length < r.minLength) {
              errors[field.id] = `至少 ${r.minLength} 个字符`;
            }
            if (r?.maxLength != null && t.length > r.maxLength) {
              errors[field.id] = `最多 ${r.maxLength} 个字符`;
            }
            break;
          }
          case "numberSlider": {
            const n = typeof raw === "number" ? raw : Number.NaN;
            const { min, max } = field.validation;
            if (Number.isNaN(n) || n < min || n > max) {
              errors[field.id] = `需在 ${min} ~ ${max} 之间`;
            }
            break;
          }
          case "select": {
            const s = typeof raw === "string" ? raw : "";
            if (field.validation?.required && !s) errors[field.id] = "请选择一项";
            break;
          }
          default:
            break;
        }
      }

      return errors;
    },

    buildPayload: () => {
      const { schema, parameters, fieldPaths } = get();
      if (schema) {
        for (const field of iterateLeafFields(schema.fields)) {
          const p = fieldPaths[field.id];
          const raw = p ? getAtPath(parameters, p) : undefined;
          if (field.kind === "imageUpload") {
            if ((raw as ImageFieldValue | undefined)?.status === "uploading") return null;
          } else if (field.kind === "multiImageUpload") {
            const items = (raw as MultiImageFieldValue | undefined)?.items ?? [];
            if (items.some((it) => it.status === "uploading")) return null;
          }
        }
      }
      const errors = get().validate();
      if (Object.keys(errors).length > 0) return null;
      if (!schema) return null;

      const nodeInputs: Record<string, Record<string, unknown>> = {};

      for (const field of iterateLeafFields(schema.fields)) {
        if (isGroupField(field)) continue;
        const path = fieldPaths[field.id];
        const raw = path ? getAtPath(parameters, path) : undefined;
        const mapped = mapLeafToApiValue(field, raw);
        if (mapped === undefined && (field.kind === "imageUpload" || field.kind === "multiImageUpload")) continue;

        const { nodeId, inputPath } = field.mapping;
        if (!nodeInputs[nodeId]) nodeInputs[nodeId] = {};
        deepAssignInput(nodeInputs[nodeId], inputPath, mapped);
      }

      return {
        workflowId: schema.workflowId,
        version: schema.version,
        nodeInputs,
        ...(get().gatewaySkuId && get().gatewayProviderCode
          ? { skuId: get().gatewaySkuId!, providerCode: get().gatewayProviderCode! }
          : {}),
      };
    },

    setViewingHistoryId: (id) =>
      set((draft) => {
        draft.viewingHistoryId = id;
      }),

    fetchCloudHistory: async () => {
      try {
        const res = await fetch("/api/user/history", {
          method: "GET",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          set((draft) => {
            draft.cloudHistory = [];
            if (res.status === 401) draft.viewingHistoryId = null;
          });
          return;
        }
        const json: unknown = await res.json();
        const items = parseGenerationHistoryArray(json);
        set((draft) => {
          draft.cloudHistory = items;
        });
      } catch {
        set((draft) => {
          draft.cloudHistory = [];
        });
      }
    },

    deleteCloudHistoryItem: async (taskId) => {
      const tid = taskId.trim();
      if (!tid) return;

      set((draft) => {
        draft.cloudHistory = draft.cloudHistory.filter((h) => h.taskId !== tid);
        if (draft.viewingHistoryId === tid) {
          draft.viewingHistoryId = null;
        }
      });

      try {
        const res = await fetch(`/api/user/history/${encodeURIComponent(tid)}`, {
          method: "DELETE",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          console.warn("[deleteCloudHistoryItem] 服务端删除失败", { taskId: tid, status: res.status });
        }
      } catch (e) {
        console.error("[deleteCloudHistoryItem] 网络异常", e);
      }
    },
  }))
);

const VALID_HISTORY_STATUS = new Set<string>(Object.values(GenerationHistoryStatus));

function isGenerationHistoryStatus(v: unknown): v is GenerationHistoryStatus {
  return typeof v === "string" && VALID_HISTORY_STATUS.has(v);
}

function parseGenerationHistoryArray(json: unknown): GenerationHistory[] {
  if (!Array.isArray(json)) return [];
  const out: GenerationHistory[] = [];
  for (const el of json) {
    if (el === null || typeof el !== "object") continue;
    const o = el as Record<string, unknown>;
    if (typeof o.id !== "string" || !o.id.trim()) continue;
    if (typeof o.userId !== "string" || !o.userId.trim()) continue;
    if (typeof o.taskId !== "string" || !o.taskId.trim()) continue;
    if (typeof o.skuId !== "string") continue;
    if (typeof o.providerCode !== "string") continue;
    if (!isGenerationHistoryStatus(o.status)) continue;
    if (typeof o.mediaType !== "string") continue;
    if (typeof o.cost !== "number" || !Number.isFinite(o.cost)) continue;
    const resultUrl = o.resultUrl == null ? null : String(o.resultUrl);
    if (typeof o.createdAt !== "string" && typeof o.createdAt !== "number") continue;
    if (typeof o.updatedAt !== "string" && typeof o.updatedAt !== "number") continue;
    const actualCost =
      typeof o.actualCost === "number" && Number.isFinite(o.actualCost) ? Math.round(o.actualCost) : null;
    const sourceAssetBytes =
      typeof o.sourceAssetBytes === "number" && Number.isFinite(o.sourceAssetBytes)
        ? Math.round(o.sourceAssetBytes)
        : null;
    const durationInt =
      typeof o.durationInt === "number" && Number.isFinite(o.durationInt) ? Math.round(o.durationInt) : 0;
    out.push({
      id: o.id.trim(),
      userId: o.userId.trim(),
      taskId: o.taskId.trim(),
      skuId: o.skuId,
      providerCode: o.providerCode,
      status: o.status,
      mediaType: o.mediaType,
      resultUrl,
      cost: Math.round(o.cost),
      actualCost,
      sourceAssetBytes,
      durationInt,
      createdAt: new Date(o.createdAt as string | number | Date),
      updatedAt: new Date(o.updatedAt as string | number | Date),
    });
  }
  return out;
}

function revokeAllPreviewUrls(node: unknown) {
  if (node == null || typeof node !== "object") return;
  if (!Array.isArray(node) && "previewUrl" in node) {
    const img = node as ImageFieldValue;
    if (
      typeof img.previewUrl === "string" &&
      (img.status === "uploading" || img.status === "ready" || img.status === "error")
    ) {
      URL.revokeObjectURL(img.previewUrl);
    }
  }
  for (const v of Object.values(node as Record<string, unknown>)) {
    revokeAllPreviewUrls(v);
  }
}
