/**
 * Comfy 工作流节点 inputs 的扁平覆盖（供文生图 / 视频工作流共用）。
 */

export type ComfyNodeShell = {
  class_type: string;
  inputs: Record<string, unknown>;
};

export function parseCoercedFieldValue(fieldValue: string): unknown {
  if (fieldValue === "") return "";
  const n = Number(fieldValue);
  if (fieldValue === String(n) && Number.isFinite(n)) return n;
  if (fieldValue === "true") return true;
  if (fieldValue === "false") return false;
  try {
    return JSON.parse(fieldValue) as unknown;
  } catch {
    return fieldValue;
  }
}

export function assignComfyInputField(root: Record<string, unknown>, fieldName: string, value: unknown): void {
  const parts = fieldName.split(".").filter(Boolean);
  if (parts.length === 0) return;
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    const next = cur[p];
    if (next == null || typeof next !== "object" || Array.isArray(next)) {
      cur[p] = {};
    }
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value as unknown;
}

export function syncNode82PromptToClipText(workflow: Record<string, ComfyNodeShell>): void {
  const n82 = workflow["82"];
  if (!n82?.inputs) return;
  if (n82.class_type !== "CLIPTextEncode") return;
  const prompt = n82.inputs.prompt;
  if (typeof prompt === "string" && prompt.trim()) {
    n82.inputs.text = prompt;
  }
}

export function applyNodeInfoListToComfyWorkflow(
  workflow: Record<string, ComfyNodeShell>,
  list: { nodeId: string; fieldName: string; fieldValue: string }[],
  options?: { syncTxt2ImgPrompt?: boolean }
): void {
  for (const { nodeId, fieldName, fieldValue } of list) {
    const node = workflow[nodeId];
    if (!node) {
      console.warn("[RunningHubWorkflowApply] 工作流覆盖跳过未知节点", nodeId);
      continue;
    }
    assignComfyInputField(node.inputs, fieldName, parseCoercedFieldValue(fieldValue));
  }
  if (options?.syncTxt2ImgPrompt) {
    syncNode82PromptToClipText(workflow);
  }
}
