/**
 * RunningHub 视频类工作流：统一「本地完整 Comfy JSON + apply nodeInfo + 清空 nodeInfoList」，
 * 避免仅提交 nodeInfoList 触发上游 Custom validation / 秒失败。
 *
 * 新增视频 SKU 时：在 `DEFAULT_VIDEO_BINDINGS` 增加一项，或运行时调用 `registerRunningHubVideoWorkflowBinding`。
 */

import { randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { StandardPayload } from "./types";
import type { ComfyNodeShell } from "./runninghub-node-overrides";
import { applyNodeInfoListToComfyWorkflow } from "./runninghub-node-overrides";
import { readRunningHubWorkflowGraphFromDisk } from "./runninghub-workflow-graph";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

function cloneWorkflowGraph<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

const IMG2VIDEO_TEMPLATE_ID = "lu-img2video-i2v";
const LEGACY_IMG2VIDEO_TEMPLATE_ID = "kling-cinema-pro-placeholder";

/** 与 `RunningHubAdapter` 原 `isRunningHubImg2VideoPayload` 一致。 */
export function isRunningHubImg2VideoPayload(payload: StandardPayload): boolean {
  const f = payload.flags;
  const prov =
    isRecord(f) && typeof f.providerCode === "string" ? f.providerCode.trim().toUpperCase() : "";
  const sku = isRecord(f) && typeof f.skuId === "string" ? f.skuId.trim().toUpperCase() : "";
  if (prov === "RUNNINGHUB_IMG2VIDEO") return true;
  if (sku === "KLING_CINEMA_PRO") return true;
  const tid = payload.templateId.trim().toLowerCase();
  return tid === IMG2VIDEO_TEMPLATE_ID || tid === LEGACY_IMG2VIDEO_TEMPLATE_ID;
}

/** 与 `RunningHubAdapter` 原 `isRunningHubSvdFirstLastPayload` 一致。 */
export function isRunningHubSvdFirstLastPayload(payload: StandardPayload): boolean {
  const f = payload.flags;
  const prov =
    isRecord(f) && typeof f.providerCode === "string" ? f.providerCode.trim().toUpperCase() : "";
  if (prov === "RUNNINGHUB_SVD") return true;
  const sku = isRecord(f) && typeof f.skuId === "string" ? f.skuId.trim().toUpperCase() : "";
  return sku === "RH_SVD_IMG2VID";
}

export type RunningHubVideoRandomizeSeeds = (workflow: Record<string, ComfyNodeShell>) => void;

export interface RunningHubVideoWorkflowBinding {
  /** 稳定标识，用于日志 */
  id: string;
  match: (payload: StandardPayload) => boolean;
  envWorkflowJsonKey: string;
  envWorkflowFileKey: string;
  /** 相对项目根；在未设置 FILE 环境变量时作为默认路径 */
  defaultRelativePath: string;
  randomizeSeeds: RunningHubVideoRandomizeSeeds;
  /**
   * 参与 `outputs` 解析时的节点 ID 优先级（追加在全局默认列表之后去重）。
   * LU 图生视频常见 26；首尾帧 VHS 常见 25。
   */
  preferredOutputNodeIds?: readonly string[];
}

function randomizeImg2VideoSamplerSeeds(workflow: Record<string, ComfyNodeShell>): void {
  for (const id of ["16", "17"]) {
    const n = workflow[id];
    if (!n?.inputs || !("noise_seed" in n.inputs)) continue;
    (n.inputs as Record<string, unknown>).noise_seed = randomInt(0, 2 ** 31);
  }
  const n76 = workflow["76"];
  if (n76?.inputs && "seed" in n76.inputs) {
    (n76.inputs as Record<string, unknown>).seed = randomInt(0, 2 ** 31);
  }
}

function randomizeSvdFlfSamplerSeeds(workflow: Record<string, ComfyNodeShell>): void {
  for (const id of ["29", "30"]) {
    const n = workflow[id];
    if (!n?.inputs || !("noise_seed" in n.inputs)) continue;
    (n.inputs as Record<string, unknown>).noise_seed = randomInt(0, 2 ** 31);
  }
  const n24 = workflow["24"];
  if (n24?.inputs && "seed" in n24.inputs) {
    (n24.inputs as Record<string, unknown>).seed = randomInt(0, 2 ** 31);
  }
}

const DEFAULT_VIDEO_BINDINGS: RunningHubVideoWorkflowBinding[] = [
  {
    id: "lu-img2video-i2v",
    match: isRunningHubImg2VideoPayload,
    envWorkflowJsonKey: "RUNNINGHUB_IMG2VIDEO_WORKFLOW_JSON",
    envWorkflowFileKey: "RUNNINGHUB_IMG2VIDEO_WORKFLOW_FILE",
    defaultRelativePath: "config/runninghub/lu-img2video-workflow.json",
    randomizeSeeds: randomizeImg2VideoSamplerSeeds,
    preferredOutputNodeIds: ["26"],
  },
  {
    id: "lu-flf2video",
    match: isRunningHubSvdFirstLastPayload,
    envWorkflowJsonKey: "RUNNINGHUB_SVD_WORKFLOW_JSON",
    envWorkflowFileKey: "RUNNINGHUB_SVD_WORKFLOW_FILE",
    defaultRelativePath: "config/runninghub/lu-flf2video-workflow.json",
    randomizeSeeds: randomizeSvdFlfSamplerSeeds,
    preferredOutputNodeIds: ["25"],
  },
];

const videoBindings: RunningHubVideoWorkflowBinding[] = [...DEFAULT_VIDEO_BINDINGS];

/** 全局默认：LU 图生视频 / 首尾帧 / 文生图出图等常见 Save 或 VHS 节点。 */
const DEFAULT_VIDEO_OUTPUT_NODE_PRIORITY = ["25", "26", "132"] as const;

/**
 * 合并默认与各 binding 的 `preferredOutputNodeIds`，供 `pickResultMediaUrl` 使用（前者优先）。
 */
export function getRunningHubVideoPreferredOutputNodeIds(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of DEFAULT_VIDEO_OUTPUT_NODE_PRIORITY) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const b of videoBindings) {
    for (const id of b.preferredOutputNodeIds ?? []) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

/** 运行时注册新的视频工作流（后注册项优先匹配，与数组顺序一致：unshift）。 */
export function registerRunningHubVideoWorkflowBinding(binding: RunningHubVideoWorkflowBinding): void {
  videoBindings.unshift(binding);
}

export function getRunningHubVideoWorkflowBindings(): readonly RunningHubVideoWorkflowBinding[] {
  return videoBindings;
}

function shouldSendFullVideoWorkflow(binding: RunningHubVideoWorkflowBinding): boolean {
  const j = process.env[binding.envWorkflowJsonKey];
  if (typeof j === "string" && j.trim()) return true;
  const f = process.env[binding.envWorkflowFileKey];
  if (typeof f === "string" && f.trim()) return true;
  return fs.existsSync(path.join(process.cwd(), binding.defaultRelativePath));
}

function resolveVideoWorkflowFileAbsPath(binding: RunningHubVideoWorkflowBinding): string | null {
  const fromEnv = process.env[binding.envWorkflowFileKey];
  const raw = typeof fromEnv === "string" ? fromEnv.trim() : "";
  if (raw) {
    return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
  }
  const def = path.join(process.cwd(), binding.defaultRelativePath);
  return fs.existsSync(def) ? def : null;
}

function loadVideoWorkflowGraph(binding: RunningHubVideoWorkflowBinding): Record<string, ComfyNodeShell> | null {
  const envJson = process.env[binding.envWorkflowJsonKey];
  const jsonRaw = typeof envJson === "string" ? envJson.trim() : "";
  if (jsonRaw) {
    try {
      const parsed = JSON.parse(jsonRaw) as unknown;
      if (isRecord(parsed)) return parsed as Record<string, ComfyNodeShell>;
    } catch (e) {
      console.error(`[RunningHubVideoWorkflow] ${binding.envWorkflowJsonKey} 解析失败`, e);
    }
  }
  const fileAbs = resolveVideoWorkflowFileAbsPath(binding);
  if (!fileAbs) return null;
  return readRunningHubWorkflowGraphFromDisk(fileAbs);
}

export type RunningHubVideoGeneratePreparation =
  | {
      matched: true;
      bindingId: string;
      mode: "full_workflow";
      workflowJson: string;
    }
  | {
      matched: true;
      bindingId: string;
      mode: "node_info_only";
      nodeInfoList: { nodeId: string; fieldName: string; fieldValue: string }[];
      definitionBlob?: string;
    };

/**
 * 若命中任一视频 binding：优先返回完整 `workflow` JSON；否则退回 nodeInfoList + 可选 definitionBlob。
 * 未命中任何视频线路时返回 `null`，由适配器走通用分支。
 */
export function prepareRunningHubVideoGenerateBody(options: {
  payload: StandardPayload;
  nodeInfoFlat: { nodeId: string; fieldName: string; fieldValue: string }[];
}): RunningHubVideoGeneratePreparation | null {
  const { payload, nodeInfoFlat } = options;
  for (const binding of videoBindings) {
    if (!binding.match(payload)) continue;
    if (!shouldSendFullVideoWorkflow(binding)) {
      return {
        matched: true,
        bindingId: binding.id,
        mode: "node_info_only",
        nodeInfoList: nodeInfoFlat.length ? nodeInfoFlat : [],
        definitionBlob:
          typeof payload.definitionBlob === "string" && payload.definitionBlob.trim()
            ? payload.definitionBlob.trim()
            : undefined,
      };
    }
    const graph = loadVideoWorkflowGraph(binding);
    if (!graph) {
      console.warn(
        `[RunningHubVideoWorkflow] binding=${binding.id} 应发送完整 workflow 但未加载到 JSON，退回 nodeInfoList`
      );
      return {
        matched: true,
        bindingId: binding.id,
        mode: "node_info_only",
        nodeInfoList: nodeInfoFlat.length ? nodeInfoFlat : [],
        definitionBlob:
          typeof payload.definitionBlob === "string" && payload.definitionBlob.trim()
            ? payload.definitionBlob.trim()
            : undefined,
      };
    }
    const wf = cloneWorkflowGraph(graph);
    applyNodeInfoListToComfyWorkflow(wf, nodeInfoFlat);
    binding.randomizeSeeds(wf);
    return {
      matched: true,
      bindingId: binding.id,
      mode: "full_workflow",
      workflowJson: JSON.stringify(wf),
    };
  }
  return null;
}
