import { randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { flattenNodeInputsToRunningHubOverrides } from "@/lib/workflow-node-info-list";
import type { TaskStatusPollData } from "@/types/task-status";
import type {
  IProviderAdapter,
  ProviderCostResult,
  ProviderResponse,
  RunningHubRunWorkflowWatermarkKnobs,
  StandardPayload,
} from "./types";
import { ProviderError } from "./types";
import type { ComfyNodeShell } from "./runninghub-node-overrides";
import { applyNodeInfoListToComfyWorkflow } from "./runninghub-node-overrides";
import { readRunningHubWorkflowGraphFromDisk } from "./runninghub-workflow-graph";
import { rewriteHttpUrlsInNodeInfoListForRunningHubImages } from "./runninghub-remote-image-upload";
import {
  getRunningHubVideoPreferredOutputNodeIds,
  isRunningHubImg2VideoPayload,
  prepareRunningHubVideoGenerateBody,
} from "./runninghub-video-workflow";

const DEFAULT_API_BASE = "https://www.runninghub.cn";
const DEFAULT_API_KEY = "dafe6f7aa9b04b239d74cf184d4f5c56";

/** 单次对 RunningHub 的 HTTP 调用（status / outputs）最长等待，防止中转被上游拖死。 */
export const RUNNINGHUB_PER_FETCH_TIMEOUT_MS = 15_000;

/** 网关整次 `queryTask` 上限（含最多两次串行上游请求 + 余量）。 */
export const RUNNINGHUB_GATEWAY_POLL_DEADLINE_MS = RUNNINGHUB_PER_FETCH_TIMEOUT_MS * 2 + 5_000;

/** 兼容旧引用：与网关轮询总时限一致。 */
export const RUNNINGHUB_DEFAULT_QUERY_TIMEOUT_MS = RUNNINGHUB_GATEWAY_POLL_DEADLINE_MS;

/** OpenAPI v2：运行工作流（workflowId 在 URL 路径中） */
const V2_RUN_WORKFLOW_PREFIX = "/openapi/v2/run/workflow";

const TASK_STATUS_PATH = "/task/openapi/status";
const TASK_OUTPUTS_PATH = "/task/openapi/outputs";
/** OpenAPI v2：任务详情（含 `usage.consumeCoins` / `usage.taskCostTime`，与 status 仅返回字符串态不同） */
const V2_QUERY_TASK_PATH = "/openapi/v2/query";

const BASE_COST_CREDITS = 5;
const HD_SURGE_CREDITS = 3;

function getDefaultApiKey(): string {
  return process.env.RUNNINGHUB_API_KEY?.trim() || DEFAULT_API_KEY;
}

function getDefaultBaseUrl(): string {
  return (process.env.RUNNINGHUB_API_BASE_URL || DEFAULT_API_BASE).replace(/\/$/, "");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

function extractTaskId(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const data = o.data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.taskId === "string") return d.taskId;
    if (typeof d.task_id === "string") return d.task_id;
  }
  if (typeof o.taskId === "string") return o.taskId;
  if (typeof o.task_id === "string") return o.task_id;
  return null;
}

function parseFiniteRhConsumeCoins(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  if (typeof v === "string" && v.trim()) {
    const t = v.trim();
    if (/^(null|undefined|nan)$/i.test(t)) return undefined;
    const n = Number(t);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return undefined;
}

/** 收集可能携带 `usage` / `taskUsageList` 的 JSON 片段（含 v2/query、webhook 嵌套）。 */
function collectRhUsageBlobCandidates(root: unknown): unknown[] {
  const blobs: unknown[] = [];
  if (root !== undefined && root !== null) blobs.push(root);
  if (!isRecord(root)) return blobs;
  if (root.data !== undefined) blobs.push(root.data);
  const ev = root.eventData ?? root.event_data;
  if (isRecord(ev)) blobs.push(ev);
  const inner = root.result ?? root.payload;
  if (isRecord(inner)) blobs.push(inner);
  return blobs;
}

/**
 * 从 RunningHub 单段原始 JSON 中解析 RH 币消耗：
 * `usage.consumeCoins` 或 `taskUsageList[0].usage.consumeCoins`；
 * 支持 `data` 信封、`eventData`（Webhook）、`/openapi/v2/query` 根级体。
 */
function extractRhConsumeCoinsFromPayload(root: unknown): number | undefined {
  const blobs = collectRhUsageBlobCandidates(root);

  for (const blob of blobs) {
    if (!isRecord(blob)) continue;
    const usage = blob.usage;
    if (isRecord(usage)) {
      const c = parseFiniteRhConsumeCoins(usage.consumeCoins);
      if (c !== undefined) return c;
    }
    const list = blob.taskUsageList;
    if (Array.isArray(list) && list.length > 0) {
      const first = list[0];
      if (isRecord(first)) {
        const u2 = first.usage;
        if (isRecord(u2)) {
          const c2 = parseFiniteRhConsumeCoins(u2.consumeCoins);
          if (c2 !== undefined) return c2;
        }
      }
    }
  }
  return undefined;
}

/** 优先 `/openapi/v2/query`（用量完整），再回退 status / outputs。 */
function resolveRhProviderCostCoins(
  statusRaw: unknown,
  outputsRaw: unknown,
  detailRaw?: unknown
): number | undefined {
  return (
    (detailRaw !== undefined ? extractRhConsumeCoinsFromPayload(detailRaw) : undefined) ??
    extractRhConsumeCoinsFromPayload(statusRaw) ??
    extractRhConsumeCoinsFromPayload(outputsRaw)
  );
}

function parseRhTaskCostTimeToDurationInt(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
    const t = Math.trunc(v);
    return t <= 2_147_483_647 ? t : 2_147_483_647;
  }
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.trim());
    if (Number.isFinite(n) && n >= 0) {
      const t = Math.trunc(n);
      return t <= 2_147_483_647 ? t : 2_147_483_647;
    }
  }
  return undefined;
}

/**
 * 从 RunningHub 原始 JSON 解析 `usage.taskCostTime`（或 `taskUsageList[0].usage.taskCostTime`），
 * 单位为秒，写入网关 `durationInt`。
 */
function extractRhTaskCostTimeFromPayload(root: unknown): number | undefined {
  const blobs = collectRhUsageBlobCandidates(root);

  for (const blob of blobs) {
    if (!isRecord(blob)) continue;
    const usage = blob.usage;
    if (isRecord(usage) && usage.taskCostTime !== undefined) {
      const s = parseRhTaskCostTimeToDurationInt(usage.taskCostTime);
      if (s != null && s > 0) return s;
    }
    const list = blob.taskUsageList;
    if (Array.isArray(list) && list.length > 0) {
      const first = list[0];
      if (isRecord(first)) {
        const u2 = first.usage;
        if (isRecord(u2) && u2.taskCostTime !== undefined) {
          const s2 = parseRhTaskCostTimeToDurationInt(u2.taskCostTime);
          if (s2 != null && s2 > 0) return s2;
        }
      }
    }
  }
  return undefined;
}

function resolveRhProviderTaskDurationSec(
  statusRaw: unknown,
  outputsRaw: unknown,
  detailRaw?: unknown
): number | undefined {
  return (
    (detailRaw !== undefined ? extractRhTaskCostTimeFromPayload(detailRaw) : undefined) ??
    extractRhTaskCostTimeFromPayload(statusRaw) ??
    extractRhTaskCostTimeFromPayload(outputsRaw)
  );
}

const MAX_REASONABLE_ASSET_BYTES = 20 * 1024 * 1024 * 1024;
const RH_BYTE_HINT_KEYS = new Set([
  "fileSize",
  "file_size",
  "sizeBytes",
  "size_bytes",
  "bytes",
  "contentLength",
  "content_length",
  "materialSize",
  "material_size",
  "assetSize",
  "asset_size",
  "sourceSize",
  "source_size",
  "inputFileSize",
  "input_file_size",
  "fileByteSize",
  "resourceSize",
  "totalSize",
  "total_size",
]);

function parseFinitePositiveAssetBytes(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    const n = Math.floor(v);
    return n <= MAX_REASONABLE_ASSET_BYTES ? n : undefined;
  }
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.trim());
    if (Number.isFinite(n) && n > 0) {
      const f = Math.floor(n);
      return f <= MAX_REASONABLE_ASSET_BYTES ? f : undefined;
    }
  }
  return undefined;
}

/**
 * 从 RunningHub 状态/输出原始 JSON 中尽力解析素材体积（字节），供网关与 OSS 计费换算。
 */
function extractRhAssetSizeBytesFromPayload(root: unknown): number | undefined {
  let best: number | undefined;
  const consider = (v: unknown): void => {
    const n = parseFinitePositiveAssetBytes(v);
    if (n == null) return;
    if (best == null || n > best) best = n;
  };

  const blobs: unknown[] = [];
  if (root != null) blobs.push(root);
  if (isRecord(root) && root.data != null) blobs.push(root.data);

  for (const blob of blobs) {
    if (!isRecord(blob)) continue;
    for (const key of RH_BYTE_HINT_KEYS) {
      if (key in blob) consider(blob[key]);
    }
    const arr = blob.files ?? blob.fileList ?? blob.outputs;
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (!isRecord(item)) continue;
        for (const key of RH_BYTE_HINT_KEYS) {
          if (key in item) consider(item[key]);
        }
        consider(item.size);
        consider(item.fileSize);
      }
    }
  }

  const visit = (node: unknown, depth: number): void => {
    if (depth > 14 || node == null) return;
    if (typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const x of node) visit(x, depth + 1);
      return;
    }
    const rec = node as Record<string, unknown>;
    for (const [k, v] of Object.entries(rec)) {
      if (RH_BYTE_HINT_KEYS.has(k)) consider(v);
      visit(v, depth + 1);
    }
  };
  for (const b of blobs) visit(b, 0);

  return best;
}

function resolveRhProviderAssetSizeBytes(statusRaw: unknown, outputsRaw: unknown): number | undefined {
  return extractRhAssetSizeBytesFromPayload(statusRaw) ?? extractRhAssetSizeBytesFromPayload(outputsRaw);
}

function extractCredentials(credentials: unknown): { apiKey: string; baseUrl: string; signal?: AbortSignal } {
  const c = credentials && typeof credentials === "object" ? (credentials as Record<string, unknown>) : {};
  const apiKey = typeof c.apiKey === "string" && c.apiKey.trim() ? c.apiKey.trim() : getDefaultApiKey();
  const baseUrlRaw = typeof c.baseUrl === "string" && c.baseUrl.trim() ? c.baseUrl.trim() : getDefaultBaseUrl();
  const baseUrl = baseUrlRaw.replace(/\/$/, "");
  const signal = c.signal instanceof AbortSignal ? c.signal : undefined;
  return { apiKey, baseUrl, signal };
}

// --- 短剧文生图（RUNNINGHUB_TXT2IMG）：Comfy 工作流骨架 + 节点 132 出图解析 -----------------

const TXT2IMG_TEMPLATE_ID = "rh-txt2img-shortdrama";

/** RunningHub 控制台 /「获取工作流 Json」中的数字 workflowId（与前端 Schema 的 slug 不同）。 */
function getRunningHubTxt2ImgRemoteWorkflowId(): string | null {
  const v = process.env.RUNNINGHUB_TXT2IMG_REMOTE_WORKFLOW_ID?.trim();
  return v || null;
}

/** 图生视频（大厅「图生视频」SKU）：RunningHub 控制台数字 workflowId，`POST .../run/workflow/:id`。 */
function getRunningHubImg2VideoRemoteWorkflowId(): string | null {
  const v = process.env.RUNNINGHUB_IMG2VIDEO_REMOTE_WORKFLOW_ID?.trim();
  return v || null;
}

/** 首尾帧生成视频等：优先环境变量中的数字 workflowId。 */
function getRunningHubSvdRemoteWorkflowId(): string | null {
  const v =
    process.env.RUNNINGHUB_SVD_REMOTE_WORKFLOW_ID?.trim() ||
    process.env.RUNNINGHUB_REMOTE_WORKFLOW_ID?.trim();
  return v || null;
}

/** 分镜生成出图（多图输出）：工作流 ID。 */
function getRunningHubStoryboardRemoteWorkflowId(): string | null {
  return process.env.RUNNINGHUB_STORYBOARD_REMOTE_WORKFLOW_ID?.trim() || null;
}

function getRunningHubPromptReverseRemoteWorkflowId(): string | null {
  return process.env.RUNNINGHUB_PROMPT_REVERSE_WORKFLOW_ID?.trim() || null;
}

const DEFAULT_TXT2IMG_WORKFLOW_RELATIVE = "config/runninghub/lu-shortdrama-txt2img-workflow.json";
const DEFAULT_STORYBOARD_WORKFLOW_RELATIVE = "config/runninghub/lu-storyboard-workflow.json";
const DEFAULT_PROMPT_REVERSE_WORKFLOW_RELATIVE = "config/runninghub/lu-prompt-reverse-workflow.json";

function resolveTxt2ImgWorkflowFileAbsPath(): string | null {
  const fromEnv = process.env.RUNNINGHUB_TXT2IMG_WORKFLOW_FILE?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.join(process.cwd(), fromEnv);
  }
  const def = path.join(process.cwd(), DEFAULT_TXT2IMG_WORKFLOW_RELATIVE);
  return fs.existsSync(def) ? def : null;
}

/** 是否随请求发送完整 `workflow` JSON（与仅发 nodeInfoList 相对）。 */
function shouldSendFullTxt2ImgWorkflowBody(): boolean {
  if (process.env.RUNNINGHUB_TXT2IMG_WORKFLOW_JSON?.trim()) return true;
  if (process.env.RUNNINGHUB_TXT2IMG_WORKFLOW_FILE?.trim()) return true;
  return fs.existsSync(path.join(process.cwd(), DEFAULT_TXT2IMG_WORKFLOW_RELATIVE));
}

function resolveStoryboardWorkflowFileAbsPath(): string | null {
  const fromEnv = process.env.RUNNINGHUB_STORYBOARD_WORKFLOW_FILE?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.join(process.cwd(), fromEnv);
  }
  const def = path.join(process.cwd(), DEFAULT_STORYBOARD_WORKFLOW_RELATIVE);
  return fs.existsSync(def) ? def : null;
}

function loadStoryboardBaseWorkflow(): Record<string, ComfyNodeShell> {
  const fromEnvJson = process.env.RUNNINGHUB_STORYBOARD_WORKFLOW_JSON?.trim();
  if (fromEnvJson) {
    return JSON.parse(fromEnvJson) as Record<string, ComfyNodeShell>;
  }
  const filePath = resolveStoryboardWorkflowFileAbsPath();
  if (filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, ComfyNodeShell>;
  }
  throw new ProviderError(
    "分镜工作流配置缺失：请设置 RUNNINGHUB_STORYBOARD_WORKFLOW_FILE 或 RUNNINGHUB_STORYBOARD_WORKFLOW_JSON。",
    "RH_MISSING_STORYBOARD_WORKFLOW",
    500
  );
}

function resolvePromptReverseWorkflowFileAbsPath(): string | null {
  const fromEnv = process.env.RUNNINGHUB_PROMPT_REVERSE_WORKFLOW_FILE?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.join(process.cwd(), fromEnv);
  }
  const def = path.join(process.cwd(), DEFAULT_PROMPT_REVERSE_WORKFLOW_RELATIVE);
  return fs.existsSync(def) ? def : null;
}

function loadPromptReverseBaseWorkflow(): Record<string, ComfyNodeShell> {
  const filePath = resolvePromptReverseWorkflowFileAbsPath();
  if (filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, ComfyNodeShell>;
  }
  throw new ProviderError(
    "提示词反推工作流配置缺失：请设置 RUNNINGHUB_PROMPT_REVERSE_WORKFLOW_FILE 或确认文件存在。",
    "RH_MISSING_PROMPT_REVERSE_WORKFLOW",
    500
  );
}

const PROMPT_REVERSE_TEMPLATE_ID = "lu-prompt-reverse";
const STORYBOARD_TEMPLATE_ID = "lu-storyboard";

function isRunningHubPromptReversePayload(payload: StandardPayload): boolean {
  const f = payload.flags;
  const prov =
    isRecord(f) && typeof f.providerCode === "string" ? f.providerCode.trim().toUpperCase() : "";
  const sku = isRecord(f) && typeof f.skuId === "string" ? f.skuId.trim().toUpperCase() : "";
  if (prov === "RUNNINGHUB_PROMPT_REVERSE") return true;
  if (sku === "RH_PROMPT_REVERSE") return true;
  return payload.templateId.trim().toLowerCase() === PROMPT_REVERSE_TEMPLATE_ID;
}

function isRunningHubStoryboardPayload(payload: StandardPayload): boolean {
  const f = payload.flags;
  const prov =
    isRecord(f) && typeof f.providerCode === "string" ? f.providerCode.trim().toUpperCase() : "";
  const sku = isRecord(f) && typeof f.skuId === "string" ? f.skuId.trim().toUpperCase() : "";
  if (prov === "RUNNINGHUB_STORYBOARD") return true;
  if (sku === "RH_STORYBOARD") return true;
  return payload.templateId.trim().toLowerCase() === STORYBOARD_TEMPLATE_ID;
}

function isRunningHubTxt2ImgPayload(payload: StandardPayload): boolean {
  const f = payload.flags;
  const prov =
    isRecord(f) && typeof f.providerCode === "string" ? f.providerCode.trim().toUpperCase() : "";
  const sku = isRecord(f) && typeof f.skuId === "string" ? f.skuId.trim().toUpperCase() : "";
  if (prov === "RUNNINGHUB_TXT2IMG") return true;
  if (sku === "RH_TXT2IMG_SHORTDRAMA") return true;
  return payload.templateId.trim().toLowerCase() === TXT2IMG_TEMPLATE_ID;
}

/**
 * 发起「运行工作流」时使用的 RunningHub 数字 workflowId（写入 URL 路径 `/openapi/v2/run/workflow/:id`）。
 */
function resolveRunWorkflowIdForPayload(payload: StandardPayload): string | null {
  if (isRunningHubTxt2ImgPayload(payload)) {
    return getRunningHubTxt2ImgRemoteWorkflowId();
  }
  if (isRunningHubImg2VideoPayload(payload)) {
    return getRunningHubImg2VideoRemoteWorkflowId();
  }
  if (isRunningHubStoryboardPayload(payload)) {
    return getRunningHubStoryboardRemoteWorkflowId();
  }
  if (isRunningHubPromptReversePayload(payload)) {
    return getRunningHubPromptReverseRemoteWorkflowId();
  }
  const fromEnv = getRunningHubSvdRemoteWorkflowId();
  if (fromEnv) return fromEnv;
  const tid = payload.templateId.trim();
  if (/^\d{10,}$/.test(tid)) return tid;
  return null;
}

function cloneDeep<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * 短剧六件套文生图：节点 58, 82, 127–132, 136, 138, 140 的可执行骨架。
 * 生产环境可设置 `RUNNINGHUB_TXT2IMG_WORKFLOW_JSON`（整段 JSON 字符串）覆盖本结构。
 */
const BUILTIN_SHORTDRAMA_TXT2IMG_WORKFLOW: Record<string, ComfyNodeShell> = {
  "136": {
    class_type: "CheckpointLoaderSimple",
    inputs: { ckpt_name: "put_your_checkpoint.safetensors" },
  },
  "82": {
    class_type: "CLIPTextEncode",
    inputs: { clip: ["136", 1], text: "", prompt: "" },
  },
  "138": {
    class_type: "CLIPTextEncode",
    inputs: { clip: ["136", 1], text: "" },
  },
  "58": {
    class_type: "EmptyLatentImage",
    inputs: { width: 720, height: 1440, batch_size: 1 },
  },
  "131": {
    class_type: "KSampler",
    inputs: {
      seed: 0,
      steps: 20,
      cfg: 7,
      sampler_name: "euler",
      scheduler: "normal",
      denoise: 1,
      model: ["136", 0],
      positive: ["82", 0],
      negative: ["138", 0],
      latent_image: ["58", 0],
    },
  },
  "140": {
    class_type: "VAEDecode",
    inputs: { samples: ["131", 0], vae: ["136", 2] },
  },
  "132": {
    class_type: "SaveImage",
    inputs: { filename_prefix: "shortdrama_txt2img", images: ["140", 0] },
  },
  "127": { class_type: "Note", inputs: { text: "" } },
  "128": { class_type: "Note", inputs: { text: "" } },
  "129": { class_type: "Note", inputs: { text: "" } },
  "130": { class_type: "Note", inputs: { text: "" } },
};

function loadShortdramaTxt2ImgBaseWorkflow(): Record<string, ComfyNodeShell> {
  const env = process.env.RUNNINGHUB_TXT2IMG_WORKFLOW_JSON?.trim();
  if (env) {
    try {
      const parsed = JSON.parse(env) as unknown;
      if (isRecord(parsed)) return parsed as Record<string, ComfyNodeShell>;
    } catch (e) {
      console.error("[RunningHubAdapter] RUNNINGHUB_TXT2IMG_WORKFLOW_JSON 解析失败", e);
    }
  }
  const fileAbs = resolveTxt2ImgWorkflowFileAbsPath();
  if (fileAbs) {
    const fromDisk = readRunningHubWorkflowGraphFromDisk(fileAbs);
    if (fromDisk) return fromDisk;
  }
  return cloneDeep(BUILTIN_SHORTDRAMA_TXT2IMG_WORKFLOW);
}

function setKsamplerRandomSeed(workflow: Record<string, ComfyNodeShell>, samplerNodeId: string): void {
  const n = workflow[samplerNodeId];
  if (!n?.inputs) return;
  n.inputs.seed = randomInt(0, 2 ** 31);
}

function dedupeFiles(files: RunningHubOutputFile[]): RunningHubOutputFile[] {
  const seen = new Set<string>();
  const out: RunningHubOutputFile[] = [];
  for (const f of files) {
    if (!f.fileUrl) continue;
    if (seen.has(f.fileUrl)) continue;
    seen.add(f.fileUrl);
    out.push(f);
  }
  return out;
}

function guessFileTypeFromUrl(url: string): string | undefined {
  const lower = url.toLowerCase();
  if (lower.includes(".png")) return "png";
  if (/\.jpe?g(\?|#|$)/i.test(lower)) return "jpeg";
  if (lower.includes(".webp")) return "webp";
  if (/\.(mp4|webm|mov)(\?|#|$)/i.test(lower)) return "mp4";
  return undefined;
}

/** RunningHub outputs 顶层 `code` 可能缺失或为字符串，缺省视为成功态由 data 判定。 */
function normalizeRhOutputCode(code: unknown): number | undefined {
  if (typeof code === "number" && Number.isFinite(code)) return code;
  if (typeof code === "string" && code.trim()) {
    const n = Number(code.trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function walkUnknownForRunningHubFiles(v: unknown, out: RunningHubOutputFile[]): void {
  if (v == null) return;
  if (typeof v === "string") {
    if (
      /^https?:\/\//i.test(v) &&
      /\.(png|jpe?g|webp|gif|mp4|webm|mov)(\?|#|$)/i.test(v)
    ) {
      out.push({ fileUrl: v, fileType: guessFileTypeFromUrl(v) });
    }
    return;
  }
  if (Array.isArray(v)) {
    for (const x of v) walkUnknownForRunningHubFiles(x, out);
    return;
  }
  if (!isRecord(v)) return;
  if (typeof v.fileUrl === "string" && v.fileUrl) {
    out.push({
      fileUrl: v.fileUrl,
      fileType: typeof v.fileType === "string" ? v.fileType : guessFileTypeFromUrl(v.fileUrl),
    });
  }
  if (typeof v.url === "string" && /^https?:\/\//i.test(v.url)) {
    out.push({ fileUrl: v.url, fileType: guessFileTypeFromUrl(v.url) });
  }
  for (const x of Object.values(v)) walkUnknownForRunningHubFiles(x, out);
}

function collectFilesFromRunningHubDataObject(data: Record<string, unknown>): RunningHubOutputFile[] {
  const files: RunningHubOutputFile[] = [];
  walkUnknownForRunningHubFiles(data, files);
  return dedupeFiles(files);
}

function getOutputsDataRecord(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {};
  const d = raw.data;
  return isRecord(d) ? d : {};
}

function collectUrlsUnderNode(data: Record<string, unknown>, nodeId: string): RunningHubOutputFile[] {
  const node = data[nodeId];
  const out: RunningHubOutputFile[] = [];
  walkUnknownForRunningHubFiles(node, out);
  return dedupeFiles(out);
}

/** 深度收集任意 http(s) 媒体链接（应对 outputs.data 结构与节点 ID 不一致的情况）。 */
function deepCollectMediaHttpUrls(v: unknown, out: Set<string>): void {
  if (v == null) return;
  if (typeof v === "string") {
    if (
      /^https?:\/\//i.test(v) &&
      /\.(png|jpe?g|webp|gif|mp4|webm|mov)(\?|#|$)/i.test(v)
    ) {
      out.add(v.trim());
    }
    return;
  }
  if (Array.isArray(v)) {
    for (const x of v) deepCollectMediaHttpUrls(x, out);
    return;
  }
  if (!isRecord(v)) return;
  for (const x of Object.values(v)) deepCollectMediaHttpUrls(x, out);
}

function urlsToOutputFiles(urls: Iterable<string>): RunningHubOutputFile[] {
  const list: RunningHubOutputFile[] = [];
  for (const u of urls) {
    list.push({ fileUrl: u, fileType: guessFileTypeFromUrl(u) });
  }
  return list;
}

/** 避免 `{}` 等空对象被当成 failedReason 误判为失败。 */
function hasSubstantiveFailedReason(r: unknown): boolean {
  if (r == null) return false;
  if (Array.isArray(r)) return r.length > 0;
  if (typeof r !== "object") return true;
  for (const v of Object.values(r as Record<string, unknown>)) {
    if (v == null) continue;
    if (typeof v === "string" && v.trim()) return true;
    if (typeof v === "number" || typeof v === "boolean") return true;
    if (typeof v === "object" && hasSubstantiveFailedReason(v)) return true;
  }
  return false;
}

function pickFirstImageUrl(files: RunningHubOutputFile[]): string | null {
  const re = /\.(png|jpe?g|webp|gif)(\?|#|$)/i;
  const lower = (t: string) => t.toLowerCase();
  const hit = files.find(
    (f) =>
      f.fileUrl &&
      (re.test(f.fileUrl) ||
        lower(f.fileType ?? "").includes("image") ||
        lower(f.fileType ?? "").includes("png") ||
        lower(f.fileType ?? "").includes("jpeg") ||
        lower(f.fileType ?? "") === "webp")
  );
  return hit?.fileUrl ?? null;
}

/** 优先常见输出节点，再遍历 data 下所有 Comfy 节点，最后对整段响应做深度 URL 扫描。 */
function pickResultMediaUrl(out: RunningHubTaskOutputsParsed): string | null {
  const data = getOutputsDataRecord(out.raw);
  const preferred = getRunningHubVideoPreferredOutputNodeIds();
  for (const nodeId of preferred) {
    const from = collectUrlsUnderNode(data, nodeId);
    const vid = pickVideoUrl(from);
    if (vid) return vid;
    const img = pickFirstImageUrl(from);
    if (img) return img;
    const any = from.find((f) => f.fileUrl)?.fileUrl;
    if (any) return any;
  }
  for (const nodeId of Object.keys(data)) {
    if (preferred.includes(nodeId)) continue;
    const from = collectUrlsUnderNode(data, nodeId);
    const vid = pickVideoUrl(from);
    if (vid) return vid;
    const imgOther = pickFirstImageUrl(from);
    if (imgOther) return imgOther;
    const anyOther = from.find((f) => f.fileUrl)?.fileUrl;
    if (anyOther) return anyOther;
  }
  const merged = dedupeFiles([...out.files]);
  const vidAll = pickVideoUrl(merged);
  if (vidAll) return vidAll;
  const img = pickFirstImageUrl(merged);
  if (img) return img;

  const deep = new Set<string>();
  deepCollectMediaHttpUrls(out.raw, deep);
  const deepFiles = urlsToOutputFiles(deep);
  const dv = pickVideoUrl(deepFiles);
  if (dv) return dv;
  const di = pickFirstImageUrl(deepFiles);
  if (di) return di;
  return deepFiles.find((f) => f.fileUrl)?.fileUrl ?? null;
}

/** 文本中是否体现 ≥1080p 档分辨率 */
function stringImpliesHighRes(s: string): boolean {
  const t = s.toLowerCase();
  if (/(^|[^0-9])(1080|2160|4320)(p|i)?|4\s*k|uhd/.test(t)) return true;
  const m = t.match(/\b(\d{3,4})\s*[x×]\s*(\d{3,4})\b/);
  if (m) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (Number.isFinite(a) && Number.isFinite(b)) return Math.max(a, b) >= 1080;
  }
  return false;
}

function walkForHighRes(v: unknown, hit: { high: boolean }): void {
  if (hit.high) return;
  if (typeof v === "string") {
    if (stringImpliesHighRes(v)) hit.high = true;
    return;
  }
  if (typeof v === "number" && Number.isFinite(v) && v >= 1080) {
    hit.high = true;
    return;
  }
  if (!v || typeof v !== "object") return;
  if (Array.isArray(v)) {
    for (const x of v) walkForHighRes(x, hit);
    return;
  }
  for (const x of Object.values(v as Record<string, unknown>)) walkForHighRes(x, hit);
}

/**
 * 是否按 ≥1080p 加价：显式 width/height、resolution 文案、nodeInputs 深扫、definitionBlob。
 */
function is1080pOrAbove(payload: StandardPayload): boolean {
  const f = payload.flags;
  if (isRecord(f)) {
    if (f.pricingHighRes === true || f.force1080Pricing === true) return true;
    const w = readDim(f.width);
    const h = readDim(f.height);
    if (w !== null && w >= 1080) return true;
    if (h !== null && h >= 1080) return true;
    if (w !== null && h !== null && Math.max(w, h) >= 1080) return true;
    if (typeof f.resolution === "string" && stringImpliesHighRes(f.resolution)) return true;
  }
  const hit = { high: false };
  for (const node of Object.values(payload.nodeInputs)) {
    walkForHighRes(node, hit);
    if (hit.high) return true;
  }
  if (typeof payload.definitionBlob === "string" && stringImpliesHighRes(payload.definitionBlob)) {
    return true;
  }
  if (stringImpliesHighRes(payload.templateId)) return true;
  return hit.high;
}

function readDim(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * RunningHub 侧模拟计价：基础 5 分；≥1080p 加 3 分；可选 `flags.catalogBaseCost` 覆盖基础分。
 * 0 利润：`sellPrice` 与 `cost` 一致（对外展示与余额门槛参考；任务完成后实扣以轮询结算为准）。
 */
export function runningHubCalculateCost(payload: StandardPayload): ProviderCostResult {
  let cost = BASE_COST_CREDITS;
  if (isRecord(payload.flags) && typeof payload.flags.catalogBaseCost === "number") {
    const b = Math.floor(payload.flags.catalogBaseCost);
    if (Number.isFinite(b) && b >= 1) cost = b;
  }
  if (is1080pOrAbove(payload)) {
    cost += HD_SURGE_CREDITS;
  }
  return { cost, sellPrice: cost };
}

function runningHubInstanceType(): string {
  const v = process.env.RUNNINGHUB_INSTANCE_TYPE?.trim();
  return v || "default";
}

/** VIP：run/workflow 顶层去水印试探字段（与 workflow 同级，冗余键由上游忽略）。 */
const RUNNINGHUB_RUN_WATERMARK_KNOBS: RunningHubRunWorkflowWatermarkKnobs = {
  watermark: false,
  needWatermark: false,
  isWatermark: 0,
};

/** OpenAPI v2 `run/workflow` 示例中为字符串 `"false"` / `"true"`。 */
function runningHubUsePersonalQueueString(): string {
  const v = process.env.RUNNINGHUB_USE_PERSONAL_QUEUE?.trim().toLowerCase();
  if (v === "true") return "true";
  return "false";
}

function linkAbortSignals(parent: AbortSignal, child: AbortSignal): AbortSignal {
  const c = new AbortController();
  const forward = (src: AbortSignal) => {
    if (c.signal.aborted) return;
    c.abort(src.reason);
  };
  if (parent.aborted) {
    forward(parent);
    return c.signal;
  }
  if (child.aborted) {
    forward(child);
    return c.signal;
  }
  parent.addEventListener("abort", () => forward(parent), { once: true });
  child.addEventListener("abort", () => forward(child), { once: true });
  return c.signal;
}

/** 单次轮询请求：父级 signal（网关/客户端）与 15s 强制超时取先触发者。 */
async function runRhPollFetch<T>(
  parent: AbortSignal | undefined,
  fn: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const timeoutAc = new AbortController();
  const timer = setTimeout(() => {
    timeoutAc.abort(new DOMException("RH_POLL_FETCH_TIMEOUT", "TimeoutError"));
  }, RUNNINGHUB_PER_FETCH_TIMEOUT_MS);
  const linked = parent ? linkAbortSignals(parent, timeoutAc.signal) : timeoutAc.signal;
  try {
    return await fn(linked);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRunningHubPost(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
  apiKey: string,
  signal: AbortSignal | undefined
): Promise<unknown> {
  const url = `${baseUrl}${path}`;
  let res: Response;
  const opts: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  };
  if (signal) opts.signal = signal;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    if (e instanceof DOMException && e.message === "RH_POLL_FETCH_TIMEOUT") {
      throw new ProviderError("RunningHub 单次查询超时", "RH_POLL_FETCH_TIMEOUT", undefined, e);
    }
    if (e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError")) {
      throw new ProviderError(
        e.message && e.message !== "RH_POLL_FETCH_TIMEOUT" ? e.message : "上游请求中断",
        "RH_POLL_ABORTED",
        undefined,
        e
      );
    }
    console.error("[RunningHubAdapter] fetch 异常", path, e);
    throw new ProviderError(
      e instanceof Error ? e.message : "网络异常",
      "RH_NETWORK",
      undefined,
      e
    );
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    raw = { parseError: true, httpStatus: res.status };
  }

  if (!res.ok) {
    console.error("[RunningHubAdapter] HTTP 非 2xx", path, res.status, raw);
    throw new ProviderError(`HTTP ${res.status}`, "RH_HTTP", res.status, raw);
  }

  return raw;
}

export interface RunningHubOutputFile {
  fileUrl?: string;
  fileType?: string;
}

export interface RunningHubTaskOutputsParsed {
  code: number;
  msg: string;
  files: RunningHubOutputFile[];
  isRunning?: boolean;
  failedReason?: unknown;
  raw: unknown;
}

function pickVideoUrl(files: RunningHubOutputFile[]): string | null {
  const lower = (t: string) => t.toLowerCase();
  const videoLike = files.find(
    (f) =>
      f.fileUrl &&
      (lower(f.fileType ?? "") === "mp4" ||
        lower(f.fileType ?? "").includes("video") ||
        /\.(mp4|webm|mov)(\?|#|$)/i.test(lower(f.fileUrl)))
  );
  if (videoLike?.fileUrl) return videoLike.fileUrl;
  const first = files.find((f) => f.fileUrl);
  return first?.fileUrl ?? null;
}

function summarizeFailedReason(reason: unknown): string {
  if (reason == null) return "任务执行失败";
  if (typeof reason === "string" && reason.trim()) return reason.trim();
  if (typeof reason !== "object") return "任务执行失败";
  const r = reason as Record<string, unknown>;
  if (typeof r.exception_message === "string" && r.exception_message.trim()) return r.exception_message.trim();
  if (typeof r.message === "string" && r.message.trim()) return r.message.trim();
  if (typeof r.exception_type === "string" && r.exception_type.trim()) return r.exception_type.trim();
  return "任务执行失败";
}

/** RunningHub `/task/openapi/status` 解析后的任务生命周期（与 HTTP 200 无关）。 */
type RhTaskLifecyclePhase = "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED" | "UNKNOWN";

/**
 * 从 `data` 段读取 task_status / status（支持 `data` 为字符串、`{ task_status }`、或 `[{ task_status }]`）。
 */
function readRhTaskStatusRawValue(data: unknown): unknown {
  if (data == null) return undefined;
  if (typeof data === "string") {
    const t = data.trim();
    return t.length ? t : undefined;
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return undefined;
    const first = data[0];
    if (isRecord(first)) {
      const v =
        first.task_status ??
        first.taskStatus ??
        first.status ??
        first.state;
      if (v != null) return v;
    }
    if (typeof first === "string" || typeof first === "number") return first;
    return undefined;
  }
  if (isRecord(data)) {
    const v =
      data.task_status ??
      data.taskStatus ??
      data.status ??
      data.state;
    if (v != null) return v;
  }
  return undefined;
}

function normalizeRhTaskLifecyclePhase(v: unknown): RhTaskLifecyclePhase {
  if (v == null) return "UNKNOWN";
  if (typeof v === "number" && Number.isFinite(v)) {
    if (v === 0) return "QUEUED";
    if (v === 1) return "RUNNING";
    if (v === 2) return "SUCCESS";
    if (v === 3 || v === 4 || v === 5) return "FAILED";
    return "UNKNOWN";
  }
  const s = String(v).trim().toUpperCase();
  if (
    ["PENDING", "QUEUE", "QUEUED", "WAITING", "SUBMITTED", "IDLE", "0"].includes(s) ||
    s === "待排队" ||
    s === "排队中"
  ) {
    return "QUEUED";
  }
  if (
    ["RUNNING", "PROCESSING", "EXECUTING", "WORKING", "PROGRESS", "1"].includes(s) ||
    s === "执行中" ||
    s === "处理中"
  ) {
    return "RUNNING";
  }
  if (["SUCCESS", "SUCCEEDED", "DONE", "COMPLETED", "FINISHED", "2"].includes(s) || s === "成功") {
    return "SUCCESS";
  }
  if (
    ["FAILED", "FAIL", "ERROR", "CANCELLED", "CANCELED", "ABORTED", "TIMEOUT", "TIME_OUT", "3", "4", "5"].includes(
      s
    ) ||
    s === "失败" ||
    s === "超时"
  ) {
    return "FAILED";
  }
  return "UNKNOWN";
}

function firstNonEmptyString(...vals: unknown[]): string | null {
  for (const x of vals) {
    if (typeof x === "string" && x.trim()) return x.trim();
  }
  return null;
}

const TRIVIAL_OUTER_MSG = new Set(["success", "ok", ""]);

function extractRhFailureMessageFromRecord(rec: Record<string, unknown>): string | null {
  const fromFailed = rec.failedReason ?? rec.failed_reason;
  if (fromFailed != null && typeof fromFailed === "object" && hasSubstantiveFailedReason(fromFailed)) {
    return summarizeFailedReason(fromFailed);
  }
  return firstNonEmptyString(
    rec.error_msg,
    rec.errorMsg,
    rec.error_message,
    rec.errorMessage,
    rec.fail_msg,
    rec.failMsg,
    rec.fail_reason,
    rec.failReason,
    rec.reason,
    typeof rec.message === "string" && rec.message.trim() && rec.message !== "success" ? rec.message : undefined,
    typeof fromFailed === "string" ? fromFailed : undefined
  );
}

/**
 * 任务失败时的文案：优先 `data` 内深层字段，避免误用请求级外层 `msg`（常为 "success"）。
 */
function extractRhFailureMessage(statusRaw: unknown, statusData: unknown): string {
  if (isRecord(statusData)) {
    const m = extractRhFailureMessageFromRecord(statusData);
    if (m) return m;
  }
  if (Array.isArray(statusData) && statusData.length > 0 && isRecord(statusData[0])) {
    const m = extractRhFailureMessageFromRecord(statusData[0] as Record<string, unknown>);
    if (m) return m;
  }
  if (isRecord(statusRaw)) {
    const inner = statusRaw.data;
    if (isRecord(inner)) {
      const m = extractRhFailureMessageFromRecord(inner);
      if (m) return m;
    }
    const outerMsg = typeof statusRaw.msg === "string" ? statusRaw.msg.trim() : "";
    if (outerMsg && !TRIVIAL_OUTER_MSG.has(outerMsg.toLowerCase())) {
      return outerMsg;
    }
  }
  return "RunningHub 平台返回任务失败";
}

/** 状态接口根级 `errorMessages` 等（`data` 仅为字符串 FAILED 时仍可能有可读线索）。 */
function extractRhTopLevelErrorHints(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  const em = raw.errorMessages ?? raw.error_messages;
  if (Array.isArray(em) && em.length > 0) {
    const parts: string[] = [];
    for (const x of em) {
      if (typeof x === "string" && x.trim()) parts.push(x.trim());
      else if (isRecord(x) && typeof x.message === "string" && x.message.trim()) {
        parts.push(x.message.trim());
      }
    }
    if (parts.length) return parts.join("；");
  }
  if (typeof em === "string" && em.trim()) return em.trim();
  return firstNonEmptyString(raw.error_msg, raw.errorMsg, raw.detail, raw.errMsg);
}

function resolveRhLifecyclePhaseFromStatusPayload(raw: unknown): { phase: RhTaskLifecyclePhase; data: unknown } {
  if (!isRecord(raw)) return { phase: "UNKNOWN", data: undefined };
  const data = raw.data;
  let rawStatus = readRhTaskStatusRawValue(data);
  let phase = normalizeRhTaskLifecyclePhase(rawStatus);
  if (phase === "UNKNOWN") {
    rawStatus = raw.task_status ?? raw.taskStatus ?? raw.status ?? raw.state;
    phase = normalizeRhTaskLifecyclePhase(rawStatus);
  }
  return { phase, data };
}

/** 从 outputs 收集所有图片 URL（支持扩展名 + fileType 双重判断，兼容无后缀 CDN URL）。 */
function pickAllImageUrlsFromOutputs(outputs: RunningHubTaskOutputsParsed): string[] {
  const imageRe = /\.(png|jpe?g|webp|gif)(\?|#|$)/i;
  const seen = new Set<string>();
  const result: string[] = [];

  const isImageFile = (f: RunningHubOutputFile) =>
    imageRe.test(f.fileUrl ?? "") ||
    (f.fileType ?? "").toLowerCase().includes("image");

  // outputs.files 已聚合 data 节点 + 深度扫描的所有文件（含 fileType 字段）
  for (const f of outputs.files) {
    if (f.fileUrl && isImageFile(f) && !seen.has(f.fileUrl)) {
      seen.add(f.fileUrl);
      result.push(f.fileUrl);
    }
  }

  // 补充：逐节点扫描（含 fileType 判断），避免 outputs.files 聚合时遗漏
  const data = getOutputsDataRecord(outputs.raw);
  for (const nodeId of Object.keys(data)) {
    for (const f of collectUrlsUnderNode(data, nodeId)) {
      if (f.fileUrl && isImageFile(f) && !seen.has(f.fileUrl)) {
        seen.add(f.fileUrl);
        result.push(f.fileUrl);
      }
    }
  }

  return result;
}

/** 状态已为 SUCCESS 后，根据 outputs 接口结果映射为轮询终态或继续 running（804 仍在跑）。 */
function mapRhOutputsToPollDataAfterSuccess(outputs: RunningHubTaskOutputsParsed): TaskStatusPollData {
  if (outputs.isRunning) {
    return { status: "running", progress: 72 };
  }
  if (outputs.code === 805 || hasSubstantiveFailedReason(outputs.failedReason)) {
    return { status: "failed", errorMessage: summarizeFailedReason(outputs.failedReason) };
  }
  const mediaUrl = pickResultMediaUrl(outputs);
  if (mediaUrl) {
    const allImages = pickAllImageUrlsFromOutputs(outputs);
    const resultUrls = allImages.length > 1 ? allImages : undefined;
    // 当能收集到图片时，明确标注媒体类型，避免 CDN 无后缀 URL 被误判为 video
    const resultMediaType = allImages.length >= 1 ? ("image" as const) : undefined;
    return {
      status: "succeeded",
      resultUrl: mediaUrl,
      progress: 100,
      ...(resultUrls ? { resultUrls } : {}),
      ...(resultMediaType ? { resultMediaType } : {}),
    };
  }
  const oc = normalizeRhOutputCode(outputs.code);
  if (oc !== undefined && oc !== 0 && oc !== 200) {
    const deep = extractRhFailureMessage(outputs.raw, getOutputsDataRecord(outputs.raw));
    if (deep !== "RunningHub 平台返回任务失败") return { status: "failed", errorMessage: deep };
    const trivial =
      typeof outputs.msg === "string" && TRIVIAL_OUTER_MSG.has(outputs.msg.trim().toLowerCase());
    return {
      status: "failed",
      errorMessage: trivial ? "获取输出失败" : outputs.msg || "获取输出失败",
    };
  }
  return { status: "failed", errorMessage: "成功但未解析到可用的图片或视频地址" };
}

async function queryTaskStatus(
  taskId: string,
  apiKey: string,
  baseUrl: string,
  signal: AbortSignal | undefined
): Promise<{ raw: unknown; data: unknown; phase: RhTaskLifecyclePhase }> {
  const raw = await fetchRunningHubPost(baseUrl, TASK_STATUS_PATH, { apiKey, taskId }, apiKey, signal);
  if (!raw || typeof raw !== "object") {
    throw new ProviderError("状态响应格式异常", "RH_BAD_RESPONSE", undefined, raw);
  }
  const o = raw as Record<string, unknown>;
  const code = o.code;
  if (typeof code === "number" && code !== 0 && code !== 200) {
    console.error("[RunningHubAdapter] 状态接口业务错误", code, o.msg, raw);
    throw new ProviderError(
      typeof o.msg === "string" ? o.msg : "查询任务状态失败",
      "RH_BUSINESS",
      undefined,
      raw
    );
  }
  const { phase, data } = resolveRhLifecyclePhaseFromStatusPayload(raw);
  return { raw, data, phase };
}

async function queryTaskOutputs(
  taskId: string,
  apiKey: string,
  baseUrl: string,
  signal: AbortSignal | undefined
): Promise<RunningHubTaskOutputsParsed> {
  const raw = await fetchRunningHubPost(baseUrl, TASK_OUTPUTS_PATH, { apiKey, taskId }, apiKey, signal);
  if (!raw || typeof raw !== "object") {
    return { code: 0, msg: "invalid", files: [], raw };
  }
  const o = raw as Record<string, unknown>;
  const codeNorm = normalizeRhOutputCode(o.code);
  const msg = typeof o.msg === "string" ? o.msg : "";
  const codeOut = codeNorm ?? 0;

  if (codeNorm === 804) {
    return { code: 804, msg, files: [], isRunning: true, raw };
  }

  const data = o.data;
  if (isRecord(data) && hasSubstantiveFailedReason(data.failedReason)) {
    return {
      code: codeNorm ?? 0,
      msg,
      files: [],
      failedReason: data.failedReason,
      raw,
    };
  }

  if (Array.isArray(data)) {
    return { code: codeOut, msg, files: data as RunningHubOutputFile[], raw };
  }

  if (isRecord(data)) {
    const files = collectFilesFromRunningHubDataObject(data as Record<string, unknown>);
    const deep = new Set<string>();
    deepCollectMediaHttpUrls(raw, deep);
    const merged = dedupeFiles([...files, ...urlsToOutputFiles(deep)]);
    return { code: codeOut, msg, files: merged, raw };
  }

  const deepOnly = new Set<string>();
  deepCollectMediaHttpUrls(raw, deepOnly);
  return { code: codeOut, msg, files: urlsToOutputFiles(deepOnly), raw };
}

/**
 * 从文本内容（SaveImage image_urls 输出 / txt 文件）中提取图片 URL。
 * 支持换行分隔、JSON 数组、逗号分隔等格式。
 */
function parseImageUrlsFromText(text: string): string[] {
  const imageRe = /https?:\/\/[^\s"',\]]+\.(png|jpe?g|webp|gif)(\?[^\s"',\]]*)?/gi;
  const matches = text.match(imageRe);
  if (matches) return [...new Set(matches)];
  // 尝试 JSON 数组格式
  try {
    const parsed = JSON.parse(text.trim());
    if (Array.isArray(parsed)) {
      return parsed
        .filter((v): v is string => typeof v === "string" && /^https?:\/\//.test(v))
        .filter((v) => /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(v));
    }
  } catch {
    // 非 JSON，忽略
  }
  return [];
}

/**
 * 从 `/openapi/v2/query` 响应的 `results[]` 数组中提取所有图片 URL。
 * 优先识别直接 image outputType（png/jpg/gif 等），
 * 其次解析 txt 结果里内联的 text 字段（SaveImage image_urls 输出会把 URL 写在 text 里）。
 */
function extractImageUrlsFromV2QueryResults(raw: unknown): string[] {
  if (!isRecord(raw)) return [];
  const results = raw.results;
  if (!Array.isArray(results)) return [];
  const IMAGE_TYPES = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
  const seen = new Set<string>();
  const urls: string[] = [];

  const addUrl = (u: string) => {
    const trimmed = u.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      urls.push(trimmed);
    }
  };

  for (const r of results) {
    if (!isRecord(r)) continue;
    const url = typeof r.url === "string" ? r.url.trim() : null;
    const outputType = typeof r.outputType === "string" ? r.outputType.toLowerCase().trim() : "";

    // 直接图片类型结果（png/jpg/gif 等）
    if (url && (IMAGE_TYPES.has(outputType) || /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(url))) {
      addUrl(url);
      continue;
    }

    // 任意类型 result 中若 text 字段含有图片 URL，也提取（SaveImage image_urls 等输出机制）
    if (typeof r.text === "string" && r.text.trim()) {
      parseImageUrlsFromText(r.text).forEach(addUrl);
    }
  }
  return urls;
}

/**
 * 从 `/openapi/v2/query` 响应的 `results[]` 中提取纯文本内容。
 * 用于提示词反推等仅输出文字的工作流（`ShowText|pysssss`、`ShellAgentPluginOutputText` 等）。
 * 不限制 outputType，只要 `r.text` 非空且不含图片 URL 即视为纯文本。
 * 仅在没有图片 URL 的情况下才会使用此结果。
 */
function extractPlainTextFromV2QueryInlineResults(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  const results = raw.results;
  if (!Array.isArray(results)) return null;

  for (const r of results) {
    if (!isRecord(r)) continue;
    const inlineText = typeof r.text === "string" ? r.text.trim() : null;
    if (!inlineText) continue;
    // 如果行内文本不含图片 URL，则视为纯文本输出（提示词反推生成的描述文字）
    const imageUrls = parseImageUrlsFromText(inlineText);
    if (imageUrls.length === 0) {
      console.log(
        "[RH] extractPlainTextFromV2QueryInlineResults 发现纯文本:",
        "outputType=",
        r.outputType,
        "preview=",
        inlineText.slice(0, 100)
      );
      return inlineText;
    }
  }
  return null;
}

const MIN_JSON_SCAN_TEXT_LEN = 48;

/**
 * 在任意 JSON 子树中收集 `text` 键下的字符串，取最长一条（且不含可解析的图片 URL）。
 * 用于 v2/query 标记 SUCCESS 但 `results` 异常为空等兜底场景。
 */
function extractLongestPlainTextFromJsonTextKeys(root: unknown, depth = 0): string | null {
  if (depth > 14 || root === null || root === undefined) return null;
  let best: string | null = null;
  const consider = (s: unknown) => {
    if (typeof s !== "string") return;
    const t = s.trim();
    if (t.length < MIN_JSON_SCAN_TEXT_LEN) return;
    if (parseImageUrlsFromText(t).length > 0) return;
    if (!best || t.length > best.length) best = t;
  };
  if (Array.isArray(root)) {
    for (const item of root) {
      const sub = extractLongestPlainTextFromJsonTextKeys(item, depth + 1);
      if (sub && (!best || sub.length > best.length)) best = sub;
    }
    return best;
  }
  if (!isRecord(root)) return best;
  for (const [k, v] of Object.entries(root)) {
    if (k === "text") consider(v);
    if (typeof v === "object" && v !== null) {
      const sub = extractLongestPlainTextFromJsonTextKeys(v, depth + 1);
      if (sub && (!best || sub.length > best.length)) best = sub;
    }
  }
  return best;
}

/** 官方 OpenAPI：`POST /openapi/v2/query`，请求体为 `{ taskId }`（`usage.consumeCoins` / `usage.taskCostTime` 等）。 */
async function queryOpenApiV2TaskDetail(
  taskId: string,
  apiKey: string,
  baseUrl: string,
  signal: AbortSignal | undefined
): Promise<unknown> {
  return fetchRunningHubPost(baseUrl, V2_QUERY_TASK_PATH, { taskId }, apiKey, signal);
}

export class RunningHubAdapter implements IProviderAdapter {
  calculateCost(payload: StandardPayload): ProviderCostResult {
    return runningHubCalculateCost(payload);
  }

  async generate(payload: StandardPayload, credentials: unknown): Promise<ProviderResponse> {
    try {
      const { apiKey, baseUrl, signal } = extractCredentials(credentials);
      const nodeInfoFlatRaw = flattenNodeInputsToRunningHubOverrides(payload.nodeInputs);
      console.log("[RH generate] nodeInfoFlatRaw (上传前):", JSON.stringify(nodeInfoFlatRaw));
      const nodeInfoFlat = await rewriteHttpUrlsInNodeInfoListForRunningHubImages(nodeInfoFlatRaw, {
        baseUrl,
        apiKey,
        signal,
      });
      console.log("[RH generate] nodeInfoFlat (图片上传后):", JSON.stringify(nodeInfoFlat));

      const runWorkflowId = resolveRunWorkflowIdForPayload(payload);
      if (!runWorkflowId) {
        const msg = isRunningHubTxt2ImgPayload(payload)
          ? "文生图需在环境变量 RUNNINGHUB_TXT2IMG_REMOTE_WORKFLOW_ID 中配置 RunningHub 数字工作流 ID（用于 URL 路径 /openapi/v2/run/workflow/:id）。"
          : isRunningHubImg2VideoPayload(payload)
            ? "图生视频需在环境变量 RUNNINGHUB_IMG2VIDEO_REMOTE_WORKFLOW_ID 中配置 RunningHub 数字工作流 ID（用于 URL 路径 /openapi/v2/run/workflow/:id）。"
            : "首尾帧生成视频需在环境变量 RUNNINGHUB_SVD_REMOTE_WORKFLOW_ID 或 RUNNINGHUB_REMOTE_WORKFLOW_ID 中配置 RunningHub 数字工作流 ID；或在请求的 workflowId 字段直接传数字 ID。建议同时保留仓库内 config/runninghub/lu-flf2video-workflow.json（或设置 RUNNINGHUB_SVD_WORKFLOW_FILE）以便随请求发送完整 workflow，避免仅 nodeInfoList 触发 Custom validation。";
        throw new ProviderError(msg, "RH_MISSING_REMOTE_WORKFLOW_ID", 400);
      }

      const addMetadata = !(isRecord(payload.flags) && payload.flags.addMetadata === false);

      /** 与 `workflow` / `nodeInfoList` 同级注入去水印试探字段（见 `RunningHubRunWorkflowWatermarkKnobs`）。 */
      const runBody: Record<string, unknown> = {
        ...RUNNINGHUB_RUN_WATERMARK_KNOBS,
        addMetadata,
        nodeInfoList: [] as { nodeId: string; fieldName: string; fieldValue: string }[],
        instanceType: runningHubInstanceType(),
        usePersonalQueue: runningHubUsePersonalQueueString(),
      };

      if (isRunningHubPromptReversePayload(payload)) {
        const wf = loadPromptReverseBaseWorkflow();
        applyNodeInfoListToComfyWorkflow(wf, nodeInfoFlat, {});
        // 随机化 llama_cpp_instruct_adv seed，确保每次推理独立（节点 5）
        const inferNode = wf["5"];
        if (inferNode?.inputs) {
          inferNode.inputs.seed = randomInt(0, 281474976710655);
        }
        const wfJson = JSON.stringify(wf);
        console.log("[RH generate] PromptReverse workflow JSON 预览（前 600 chars）:", wfJson.slice(0, 600));
        runBody.workflow = wfJson;
        runBody.nodeInfoList = [];
      } else if (isRunningHubStoryboardPayload(payload)) {
        const wf = loadStoryboardBaseWorkflow();
        applyNodeInfoListToComfyWorkflow(wf, nodeInfoFlat, {});
        // 随机化 KSampler 种子，确保每次结果不同
        const ksamplerNode = wf["56"];
        if (ksamplerNode?.inputs) {
          ksamplerNode.inputs.seed = randomInt(0, 2 ** 31);
        }
        runBody.workflow = JSON.stringify(wf);
        runBody.nodeInfoList = [];
      } else if (isRunningHubTxt2ImgPayload(payload)) {
        if (shouldSendFullTxt2ImgWorkflowBody()) {
          const wf = loadShortdramaTxt2ImgBaseWorkflow();
          applyNodeInfoListToComfyWorkflow(wf, nodeInfoFlat, { syncTxt2ImgPrompt: true });
          setKsamplerRandomSeed(wf, "131");
          runBody.workflow = JSON.stringify(wf);
          runBody.nodeInfoList = [];
        } else {
          const listWithSeed = [...nodeInfoFlat];
          listWithSeed.push({
            nodeId: "131",
            fieldName: "seed",
            fieldValue: String(randomInt(0, 2 ** 31)),
          });
          runBody.nodeInfoList = listWithSeed;
        }
      } else {
        const videoPrep = prepareRunningHubVideoGenerateBody({ payload, nodeInfoFlat });
        if (videoPrep?.matched) {
          if (videoPrep.mode === "full_workflow") {
            runBody.workflow = videoPrep.workflowJson;
            runBody.nodeInfoList = [];
          } else {
            runBody.nodeInfoList = videoPrep.nodeInfoList;
            if (videoPrep.definitionBlob) {
              runBody.workflow = videoPrep.definitionBlob;
            }
          }
        } else {
          runBody.nodeInfoList = nodeInfoFlat.length ? nodeInfoFlat : [];
          if (payload.definitionBlob) {
            runBody.workflow = payload.definitionBlob;
          }
        }
      }

      if (isRecord(payload.flags) && typeof payload.flags.webhookUrl === "string") {
        runBody.webhookUrl = payload.flags.webhookUrl;
      }

      const runPath = `${V2_RUN_WORKFLOW_PREFIX}/${encodeURIComponent(runWorkflowId)}`;
      const raw = await fetchRunningHubPost(baseUrl, runPath, runBody, apiKey, signal);

      if (!raw || typeof raw !== "object") {
        throw new ProviderError("上游响应格式异常", "RH_BAD_RESPONSE", undefined, raw);
      }

      const o = raw as Record<string, unknown>;
      const code = o.code;
      if (typeof code === "number" && code !== 0 && code !== 200) {
        console.error("[RunningHubAdapter] run/workflow 业务错误码", code, o.msg ?? o.message, raw);
        const msgRaw =
          typeof o.msg === "string"
            ? o.msg
            : typeof o.message === "string"
              ? o.message
              : "上游业务错误";
        let message = msgRaw;
        if (code === 404 && (msgRaw === "NOT_FOUND" || msgRaw.toUpperCase().includes("NOT_FOUND"))) {
          message = `${msgRaw}：请核对 URL 中的 workflowId（${runWorkflowId}）是否在 RunningHub 控制台存在，并与当前 API Key 权限匹配。`;
        }
        throw new ProviderError(message, "RH_BUSINESS", code === 404 ? 502 : undefined, raw);
      }

      const taskId = extractTaskId(raw);
      if (!taskId) {
        console.error("[RunningHubAdapter] 响应中缺少 taskId", raw);
        throw new ProviderError("上游响应缺少 taskId", "RH_BAD_RESPONSE", undefined, raw);
      }

      return { taskId, raw };
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      console.error("[RunningHubAdapter] generate 未分类异常", e);
      throw new ProviderError(
        e instanceof Error ? e.message : String(e),
        "RH_UNEXPECTED",
        undefined,
        e
      );
    }
  }

  async queryTask(taskId: string, credentials: unknown): Promise<TaskStatusPollData> {
    const { apiKey, baseUrl, signal: credSignal } = extractCredentials(credentials);
    const parent = credSignal ?? AbortSignal.timeout(RUNNINGHUB_GATEWAY_POLL_DEADLINE_MS);

    const statusParsed = await runRhPollFetch(parent, (sig) =>
      queryTaskStatus(taskId, apiKey, baseUrl, sig)
    );
    try {
      console.log("[RunningHub Raw Poll Response]:", JSON.stringify(statusParsed.raw));
    } catch {
      console.log("[RunningHub Raw Poll Response]:", statusParsed.raw);
    }

    const { phase, raw, data } = statusParsed;

    if (phase === "QUEUED") {
      return { status: "queued", progress: 28 };
    }
    if (phase === "RUNNING") {
      return { status: "running", progress: 62 };
    }
    /** 无法识别时保持 loading，避免过早终态；与网关 `loading` 对齐。 */
    if (phase === "UNKNOWN") {
      return { status: "running", progress: 48 };
    }
    if (phase === "FAILED") {
      const topHints = extractRhTopLevelErrorHints(raw);
      let detailFromOutputs: string | null = null;
      let detailFromV2: string | null = null;

      // 拉取 /task/openapi/outputs 以获取 failedReason
      try {
        const outputs = await runRhPollFetch(parent, (sig) =>
          queryTaskOutputs(taskId, apiKey, baseUrl, sig)
        );
        try {
          console.log("[RH FAILED] task/openapi/outputs 原始响应:", JSON.stringify(outputs.raw));
        } catch {
          console.log("[RH FAILED] task/openapi/outputs 原始响应（序列化失败）:", outputs.raw);
        }
        if (hasSubstantiveFailedReason(outputs.failedReason)) {
          detailFromOutputs = summarizeFailedReason(outputs.failedReason);
        } else {
          const om = typeof outputs.msg === "string" ? outputs.msg.trim() : "";
          if (om && !TRIVIAL_OUTER_MSG.has(om.toLowerCase())) {
            detailFromOutputs = om;
          } else {
            const deep = extractRhFailureMessage(outputs.raw, getOutputsDataRecord(outputs.raw));
            if (deep !== "RunningHub 平台返回任务失败") detailFromOutputs = deep;
          }
        }
      } catch (e) {
        console.warn("[RH FAILED] 拉取 task/openapi/outputs 失败", e instanceof Error ? e.message : e);
      }

      // 额外拉取 v2/query，获取更详细的错误信息（nodeOutputs / errorMessages 等）
      try {
        const v2Detail = await runRhPollFetch(parent, (sig) =>
          queryOpenApiV2TaskDetail(taskId, apiKey, baseUrl, sig)
        );
        try {
          console.log("[RH FAILED] openapi/v2/query 原始响应:", JSON.stringify(v2Detail));
        } catch {
          console.log("[RH FAILED] openapi/v2/query 原始响应（序列化失败）:", v2Detail);
        }
        if (isRecord(v2Detail)) {
          const errMsgs = (v2Detail as Record<string, unknown>).errorMessages;
          if (typeof errMsgs === "string" && errMsgs.trim()) {
            detailFromV2 = errMsgs.trim();
          } else if (Array.isArray(errMsgs) && errMsgs.length > 0) {
            detailFromV2 = errMsgs.join("；");
          }
        }
      } catch (e) {
        console.warn("[RH FAILED] 拉取 openapi/v2/query 失败", e instanceof Error ? e.message : e);
      }

      const fromStatus = extractRhFailureMessage(raw, data);
      const candidates = [
        detailFromV2,
        detailFromOutputs,
        topHints,
        fromStatus !== "RunningHub 平台返回任务失败" ? fromStatus : null,
      ].filter((x): x is string => typeof x === "string" && Boolean(x.trim()));
      const unique = [...new Set(candidates.map((s) => s.trim()))];
      console.log("[RH FAILED] 最终错误信息候选:", unique);
      if (unique.length > 0) {
        return { status: "failed", errorMessage: unique.join("；") };
      }
      return {
        status: "failed",
        errorMessage:
          "上游算力节点执行失败，未返回详细原因。请在 RunningHub 控制台查看该任务日志；若使用外链图片，请确认算力环境能访问该 URL。",
      };
    }

    const [detailRaw, outputs] = await Promise.all([
      runRhPollFetch(parent, (sig) => queryOpenApiV2TaskDetail(taskId, apiKey, baseUrl, sig)).catch(
        (e) => {
          console.warn("[RunningHubAdapter] /openapi/v2/query 失败，用量可能仅来自 status/outputs", {
            taskId,
            message: e instanceof Error ? e.message : String(e),
          });
          return undefined;
        }
      ),
      runRhPollFetch(parent, (sig) => queryTaskOutputs(taskId, apiKey, baseUrl, sig)),
    ]);
    const providerCost = resolveRhProviderCostCoins(raw, outputs.raw, detailRaw);
    const providerAssetSizeBytes = resolveRhProviderAssetSizeBytes(raw, outputs.raw);
    const providerDurationSec = resolveRhProviderTaskDurationSec(raw, outputs.raw, detailRaw);

    // ── 详细诊断日志 ──────────────────────────────────────────────
    try {
      console.log("[RH DEBUG] detailRaw (v2/query 原始响应):", JSON.stringify(detailRaw));
    } catch {
      console.log("[RH DEBUG] detailRaw (v2/query 原始响应，序列化失败):", detailRaw);
    }
    try {
      console.log("[RH DEBUG] outputs.raw (task/openapi/outputs 原始响应):", JSON.stringify(outputs.raw));
    } catch {
      console.log("[RH DEBUG] outputs.raw (序列化失败):", outputs.raw);
    }
    // ────────────────────────────────────────────────────────────

    // 优先从 /openapi/v2/query 的 results[] 提取图片（含 outputType 字段，最可靠）
    let v2ImageUrls = extractImageUrlsFromV2QueryResults(detailRaw);
    console.log("[RH DEBUG] extractImageUrlsFromV2QueryResults 结果:", {
      taskId,
      v2ImageUrlsCount: v2ImageUrls.length,
      v2ImageUrls,
    });

    // 尝试从 v2/query 行内 text 字段中提取纯文本（如提示词反推 ShellAgentPluginOutputText 直接返回 text）
    const v2InlinePlainText = v2ImageUrls.length === 0
      ? extractPlainTextFromV2QueryInlineResults(detailRaw)
      : null;

    // 如果行内未找到图片，尝试从 txt 结果文件中解析图片 URL 或纯文本内容
    // - 图片 URL 场景：SaveImage image_urls 输出通过 ShellAgentPluginOutputText 返回为 txt 文件
    // - 纯文本场景：提示词反推等 VQA 工作流直接输出文本内容
    // 使用数组 ref 规避 TypeScript 对 async 回调内修改的外部变量的 narrowing 误判
    const capturedPlainTexts: string[] = [];
    if (v2ImageUrls.length === 0 && isRecord(detailRaw) && Array.isArray(detailRaw.results)) {
      const txtResults = (detailRaw.results as unknown[]).filter(
        (r): r is Record<string, unknown> =>
          isRecord(r) &&
          typeof r.url === "string" &&
          r.url.trim().length > 0 &&
          (() => {
            const ot = typeof r.outputType === "string" ? r.outputType.toLowerCase().trim() : "";
            if (ot === "txt") return true;
            if (/\.txt(\?|#|$)/i.test(r.url.trim())) return true;
            return false;
          })()
      );
      if (txtResults.length > 0) {
        const fetchedUrls: string[] = [];
        await Promise.allSettled(
          txtResults.map(async (r) => {
            try {
              const txtUrl = (r.url as string).trim();
              const resp = await fetch(txtUrl, { signal: parent ?? undefined });
              if (resp.ok) {
                const text = await resp.text();
                console.log("[RH DEBUG] 拉取 txt 文件内容:", {
                  taskId,
                  txtUrl,
                  contentPreview: text.slice(0, 200),
                });
                const parsed = parseImageUrlsFromText(text);
                if (parsed.length > 0) {
                  fetchedUrls.push(...parsed);
                } else if (text.trim() && capturedPlainTexts.length === 0) {
                  // 无图片 URL，作为纯文本输出保留（如提示词反推）
                  capturedPlainTexts.push(text.trim());
                }
              }
            } catch (e) {
              console.warn("[RH DEBUG] 拉取 txt 文件失败:", e);
            }
          })
        );
        if (fetchedUrls.length > 0) {
          console.log("[RH DEBUG] 从 txt 文件解析到图片 URL:", { taskId, count: fetchedUrls.length, fetchedUrls });
          v2ImageUrls = [...new Set(fetchedUrls)];
        }
      }
    }

    // 纯文本输出（如提示词反推）：
    // 优先级：v2/query 行内 text > 从 txt 文件 URL 拉取的内容
    const capturedPlainText = capturedPlainTexts[0];
    const finalPlainText = v2InlinePlainText ?? capturedPlainText ?? null;
    if (v2ImageUrls.length === 0 && finalPlainText) {
      console.log("[RunningHubAdapter] 检测到纯文本输出，作为 resultText 返回", {
        taskId,
        source: v2InlinePlainText ? "v2/query inline text" : "fetched txt file",
        textPreview: finalPlainText.slice(0, 100),
      });
      return {
        status: "succeeded",
        resultText: finalPlainText,
        resultMediaType: "text",
        progress: 100,
        ...(providerCost != null ? { providerCost } : {}),
        ...(providerAssetSizeBytes != null ? { providerAssetSizeBytes } : {}),
        ...(providerDurationSec != null ? { providerDurationSec } : {}),
      };
    }

    // v2 标记 SUCCESS 但 results 无可用条目时，扫描整棵 JSON 中带 `text` 键的长字符串（RH 字段变化兜底）
    const v2MarkedSuccess =
      isRecord(detailRaw) && String(detailRaw.status ?? "").toUpperCase() === "SUCCESS";
    if (v2ImageUrls.length === 0 && !finalPlainText && v2MarkedSuccess) {
      const scanned =
        extractLongestPlainTextFromJsonTextKeys(detailRaw) ??
        extractLongestPlainTextFromJsonTextKeys(outputs.raw);
      if (scanned) {
        console.log("[RunningHubAdapter] 通过 JSON text 键扫描得到纯文本（SUCCESS 兜底）", {
          taskId,
          textPreview: scanned.slice(0, 100),
        });
        return {
          status: "succeeded",
          resultText: scanned,
          resultMediaType: "text",
          progress: 100,
          ...(providerCost != null ? { providerCost } : {}),
          ...(providerAssetSizeBytes != null ? { providerAssetSizeBytes } : {}),
          ...(providerDurationSec != null ? { providerDurationSec } : {}),
        };
      }
    }

    const mapped = mapRhOutputsToPollDataAfterSuccess(outputs);
    console.log("[RH DEBUG] mapRhOutputsToPollDataAfterSuccess 结果:", {
      taskId,
      mappedStatus: mapped.status,
      mappedResultUrl: (mapped as { resultUrl?: string }).resultUrl,
      mappedResultUrls: (mapped as { resultUrls?: string[] }).resultUrls,
      mappedResultMediaType: (mapped as { resultMediaType?: string }).resultMediaType,
    });

    // v2 results 有图片时，无论 outputs 接口解析结果如何都优先使用
    // （VHS_VideoCombine GIF / PNG 等 outputs 可能比 task/openapi/outputs 返回更早或更完整）
    if (v2ImageUrls.length > 0) {
      console.log("[RunningHubAdapter] v2/query results 提取到图片，使用 v2 结果", {
        taskId,
        count: v2ImageUrls.length,
        urls: v2ImageUrls,
      });
      const finalResult: TaskStatusPollData = {
        status: "succeeded",
        resultUrl: v2ImageUrls[0],
        resultMediaType: "image",
        ...(v2ImageUrls.length > 1 ? { resultUrls: v2ImageUrls } : {}),
        progress: 100,
        ...(providerCost != null ? { providerCost } : {}),
        ...(providerAssetSizeBytes != null ? { providerAssetSizeBytes } : {}),
        ...(providerDurationSec != null ? { providerDurationSec } : {}),
      };
      console.log("[RH DEBUG] 最终返回给网关的 pollData:", {
        taskId,
        resultUrl: finalResult.resultUrl,
        resultMediaType: finalResult.resultMediaType,
        resultUrlsCount: finalResult.resultUrls?.length ?? 0,
      });
      return finalResult;
    }

    if (mapped.status === "succeeded") {
      const fallbackResult = {
        ...mapped,
        ...(providerCost != null ? { providerCost } : {}),
        ...(providerAssetSizeBytes != null ? { providerAssetSizeBytes } : {}),
        ...(providerDurationSec != null ? { providerDurationSec } : {}),
      };
      console.log("[RH DEBUG] v2 无图片，回退 outputs 解析结果:", {
        taskId,
        resultUrl: fallbackResult.resultUrl,
        resultMediaType: (fallbackResult as TaskStatusPollData).resultMediaType,
      });
      return fallbackResult;
    }
    return mapped;
  }
}
