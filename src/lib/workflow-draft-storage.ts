import {
  buildFieldPathMap,
  buildInitialParameters,
  getAtPath,
  iterateLeafFields,
  setAtPath,
} from "@/lib/workflow-utils";
import type {
  ImageFieldValue,
  MultiImageFieldValue,
  MultiImageItemValue,
  WorkflowField,
  WorkflowFormSchema,
} from "@/types/workflow";
import { isGroupField } from "@/types/workflow";

const WORKFLOW_DRAFT_FORMAT_VERSION = 1;
const WORKFLOW_DRAFT_KEY_PREFIX = "workflow-form-draft:v1";

export interface WorkflowDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface WorkflowDraftEnvelope {
  formatVersion: number;
  workflowId: string;
  workflowVersion: string;
  savedAt: string;
  parameters: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function draftStorageKey(userId: string, skuId: string): string {
  return `${WORKFLOW_DRAFT_KEY_PREFIX}:${encodeURIComponent(userId)}:${encodeURIComponent(skuId)}`;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function sanitizeReadyMediaValue(raw: unknown): ImageFieldValue | null {
  if (!isRecord(raw) || raw.status !== "ready") return null;
  const remoteUrl = optionalString(raw.remoteUrl);
  if (!remoteUrl) return null;

  const value: ImageFieldValue = {
    status: "ready",
    remoteUrl,
  };
  const fileName = optionalString(raw.fileName);
  if (fileName) value.fileName = fileName;
  if (typeof raw.durationSec === "number" && Number.isFinite(raw.durationSec) && raw.durationSec >= 0) {
    value.durationSec = raw.durationSec;
  }
  return value;
}

function sanitizeReadyMultiImageValue(raw: unknown, maxItems: number): MultiImageFieldValue {
  if (!isRecord(raw) || !Array.isArray(raw.items)) return { items: [] };

  const items: MultiImageItemValue[] = [];
  for (const [index, candidate] of raw.items.entries()) {
    if (items.length >= maxItems || !isRecord(candidate) || candidate.status !== "ready") continue;
    const remoteUrl = optionalString(candidate.remoteUrl);
    if (!remoteUrl) continue;
    const fileName = optionalString(candidate.fileName);
    items.push({
      id: optionalString(candidate.id) ?? `restored_${index}`,
      status: "ready",
      remoteUrl,
      ...(fileName ? { fileName } : {}),
    });
  }
  return { items };
}

function sanitizeLeafValue(field: WorkflowField, raw: unknown): unknown {
  if (isGroupField(field)) return undefined;
  switch (field.kind) {
    case "imageUpload":
    case "videoUpload":
    case "audioUpload":
      return sanitizeReadyMediaValue(raw);
    case "multiImageUpload":
      return sanitizeReadyMultiImageValue(raw, Math.min(9, Math.max(1, field.maxItems ?? 9)));
    case "textInput":
      return typeof raw === "string" ? raw : undefined;
    case "numberSlider": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
      const clamped = Math.min(field.validation.max, Math.max(field.validation.min, raw));
      return field.validation.integer ? Math.round(clamped) : clamped;
    }
    case "select":
      return typeof raw === "string" && field.options.some((option) => option.value === raw)
        ? raw
        : undefined;
    default:
      return undefined;
  }
}

function hasUnfinishedUpload(schema: WorkflowFormSchema, parameters: Record<string, unknown>): boolean {
  const fieldPaths = buildFieldPathMap(schema.fields);
  for (const field of iterateLeafFields(schema.fields)) {
    const path = fieldPaths[field.id];
    const raw = path ? getAtPath(parameters, path) : undefined;
    if (field.kind === "imageUpload" || field.kind === "videoUpload" || field.kind === "audioUpload") {
      const status = isRecord(raw) ? raw.status : undefined;
      if (status === "uploading" || status === "error") return true;
    }
    if (field.kind === "multiImageUpload" && isRecord(raw) && Array.isArray(raw.items)) {
      if (raw.items.some((item) => isRecord(item) && (item.status === "uploading" || item.status === "error"))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Rebuild a draft against the current schema so removed/renamed fields and
 * browser-only preview URLs never leak back into the live form.
 */
export function sanitizeWorkflowDraftParameters(
  schema: WorkflowFormSchema,
  rawParameters: unknown,
): Record<string, unknown> {
  const parameters = buildInitialParameters(schema);
  if (!isRecord(rawParameters)) return parameters;

  const fieldPaths = buildFieldPathMap(schema.fields);
  for (const field of iterateLeafFields(schema.fields)) {
    const path = fieldPaths[field.id];
    if (!path) continue;
    const sanitized = sanitizeLeafValue(field, getAtPath(rawParameters, path));
    if (sanitized !== undefined && sanitized !== null) setAtPath(parameters, path, sanitized);
  }
  return parameters;
}

export function loadWorkflowDraft(
  storage: WorkflowDraftStorage,
  userId: string,
  skuId: string,
  schema: WorkflowFormSchema,
): Record<string, unknown> | null {
  const key = draftStorageKey(userId, skuId);
  try {
    const serialized = storage.getItem(key);
    if (!serialized) return null;
    const parsed = JSON.parse(serialized) as unknown;
    if (
      !isRecord(parsed)
      || parsed.formatVersion !== WORKFLOW_DRAFT_FORMAT_VERSION
      || parsed.workflowId !== schema.workflowId
    ) {
      storage.removeItem(key);
      return null;
    }
    return sanitizeWorkflowDraftParameters(schema, parsed.parameters);
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Ignore storage access failures (for example browser privacy mode).
    }
    return null;
  }
}

export function saveWorkflowDraft(
  storage: WorkflowDraftStorage,
  userId: string,
  skuId: string,
  schema: WorkflowFormSchema,
  parameters: Record<string, unknown>,
): boolean {
  if (hasUnfinishedUpload(schema, parameters)) return false;

  const envelope: WorkflowDraftEnvelope = {
    formatVersion: WORKFLOW_DRAFT_FORMAT_VERSION,
    workflowId: schema.workflowId,
    workflowVersion: schema.version,
    savedAt: new Date().toISOString(),
    parameters: sanitizeWorkflowDraftParameters(schema, parameters),
  };
  try {
    storage.setItem(draftStorageKey(userId, skuId), JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

export function clearWorkflowDraft(
  storage: WorkflowDraftStorage,
  userId: string,
  skuId: string,
): void {
  try {
    storage.removeItem(draftStorageKey(userId, skuId));
  } catch {
    // Storage can be unavailable in privacy mode; reset should still succeed.
  }
}
