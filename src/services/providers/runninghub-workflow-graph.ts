import fs from "node:fs";

import type { ComfyNodeShell } from "./runninghub-node-overrides";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

export function readRunningHubWorkflowGraphFromDisk(absPath: string): Record<string, ComfyNodeShell> | null {
  try {
    if (!fs.existsSync(absPath)) return null;
    const txt = fs.readFileSync(absPath, "utf8");
    const parsed = JSON.parse(txt) as unknown;
    if (!isRecord(parsed)) return null;
    return parsed as Record<string, ComfyNodeShell>;
  } catch (e) {
    console.error("[RunningHubWorkflowGraph] 读取工作流 JSON 失败", absPath, e);
    return null;
  }
}
