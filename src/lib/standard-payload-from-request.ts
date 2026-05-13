/**
 * 将网关 HTTP 请求体解析为中转站标准负载（兼容历史字段名 workflow / workflowId / nodeInfoList）。
 */

import type { StandardPayload } from "@/services/providers/types";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

function tryParseScalarString(fieldValue: string): unknown {
  if (fieldValue === "") return "";
  try {
    return JSON.parse(fieldValue) as unknown;
  } catch {
    return fieldValue;
  }
}

/** 将扁平 fieldPath（如 `a.b.c`）写入节点 inputs 树 */
function applyLinearField(
  nodeInputs: Record<string, Record<string, unknown>>,
  nodeKey: string,
  fieldPath: string,
  fieldValue: string
): void {
  const parts = fieldPath.split(".").filter(Boolean);
  if (parts.length === 0) return;
  if (!nodeInputs[nodeKey]) nodeInputs[nodeKey] = {};
  let cur: Record<string, unknown> = nodeInputs[nodeKey];
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    const next = cur[p];
    if (next == null || typeof next !== "object" || Array.isArray(next)) {
      cur[p] = {};
    }
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = tryParseScalarString(fieldValue);
}

export function parseStandardPayloadFromGatewayBody(body: unknown): StandardPayload | null {
  if (!isRecord(body)) return null;
  const templateIdRaw =
    (typeof body.templateId === "string" && body.templateId.trim()) ||
    (typeof body.workflowId === "string" && body.workflowId.trim());
  if (!templateIdRaw) return null;

  const nodeInputs: Record<string, Record<string, unknown>> = {};

  if (isRecord(body.nodeInputs)) {
    for (const [nodeKey, inputs] of Object.entries(body.nodeInputs)) {
      if (inputs && typeof inputs === "object" && !Array.isArray(inputs)) {
        nodeInputs[nodeKey] = { ...(inputs as Record<string, unknown>) };
      }
    }
  }

  if (Array.isArray(body.nodeInfoList)) {
    for (const n of body.nodeInfoList) {
      if (
        !isRecord(n) ||
        typeof n.nodeId !== "string" ||
        typeof n.fieldName !== "string" ||
        typeof n.fieldValue !== "string"
      ) {
        continue;
      }
      applyLinearField(nodeInputs, n.nodeId, n.fieldName, n.fieldValue);
    }
  }

  const definitionBlob =
    (typeof body.definitionBlob === "string" && body.definitionBlob) ||
    (typeof body.workflow === "string" && body.workflow) ||
    undefined;

  const templateVersion = typeof body.version === "string" ? body.version : undefined;

  const flags: Record<string, unknown> = {};
  if (typeof body.addMetadata === "boolean") flags.addMetadata = body.addMetadata;
  if (typeof body.webhookUrl === "string") flags.webhookUrl = body.webhookUrl;
  if (typeof body.providerCode === "string" && body.providerCode.trim()) {
    flags.providerCode = body.providerCode.trim();
  }
  if (typeof body.skuId === "string" && body.skuId.trim()) {
    flags.skuId = body.skuId.trim();
  }
  /** 底图/素材字节数（客户端已知时传入，供终态 OSS 计费） */
  const billingBytes =
    typeof body.billingSourceAssetBytes === "number" && Number.isFinite(body.billingSourceAssetBytes)
      ? Math.max(0, Math.floor(body.billingSourceAssetBytes))
      : typeof body.sourceAssetBytes === "number" && Number.isFinite(body.sourceAssetBytes)
        ? Math.max(0, Math.floor(body.sourceAssetBytes))
        : undefined;
  if (billingBytes != null) {
    flags.billingSourceAssetBytes = billingBytes;
  }

  const inputs =
    isRecord(body.inputs) ? ({ ...body.inputs } as Record<string, unknown>) : undefined;

  return {
    templateId: templateIdRaw.trim(),
    templateVersion,
    nodeInputs,
    ...(inputs ? { inputs } : {}),
    definitionBlob,
    flags: Object.keys(flags).length ? flags : undefined,
  };
}
