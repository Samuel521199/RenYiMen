/**
 * 将表单产出的 `nodeInputs` 扁平化为 RunningHub `nodeInfoList` 项（fieldValue 一律为字符串）。
 */
export function flattenNodeInputsToRunningHubOverrides(
  nodeInputs: Record<string, Record<string, unknown>>
): { nodeId: string; fieldName: string; fieldValue: string }[] {
  const list: { nodeId: string; fieldName: string; fieldValue: string }[] = [];
  for (const [nodeId, inputs] of Object.entries(nodeInputs)) {
    if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) continue;
    flattenRecord(inputs, nodeId, "", list);
  }
  return expandNode58ResolutionToWidthHeight(list);
}

/** 文生图等：节点 58 上形如 `720x1440` 的 `resolution` 拆成 RunningHub 覆盖项 `width` / `height`。 */
function expandNode58ResolutionToWidthHeight(
  list: { nodeId: string; fieldName: string; fieldValue: string }[]
): { nodeId: string; fieldName: string; fieldValue: string }[] {
  const out: { nodeId: string; fieldName: string; fieldValue: string }[] = [];
  for (const e of list) {
    if (e.nodeId === "58" && e.fieldName === "resolution") {
      const m = e.fieldValue.trim().match(/^(\d+)\s*[xX×]\s*(\d+)$/);
      if (m) {
        out.push({ nodeId: "58", fieldName: "width", fieldValue: m[1] });
        out.push({ nodeId: "58", fieldName: "height", fieldValue: m[2] });
        continue;
      }
    }
    out.push(e);
  }
  return out;
}

function flattenRecord(
  obj: Record<string, unknown>,
  nodeId: string,
  prefix: string,
  out: { nodeId: string; fieldName: string; fieldValue: string }[]
): void {
  for (const [key, val] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      flattenRecord(val as Record<string, unknown>, nodeId, path, out);
    } else {
      out.push({
        nodeId,
        fieldName: path,
        fieldValue:
          val === null || val === undefined
            ? ""
            : typeof val === "string"
              ? val
              : JSON.stringify(val),
      });
    }
  }
}
