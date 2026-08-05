import type { TaskStatusPollData } from "@/types/task-status";
import type {
  IProviderAdapter,
  ProviderCostResult,
  ProviderResponse,
  StandardPayload,
} from "./types";
import { ProviderError } from "./types";
import type { VideoProviderInputCapabilities } from "./video-input-contract";

const DEFAULT_BASE = "https://dashscope.aliyuncs.com";
const VIDEO_SYNTHESIS_PATH = "/api/v1/services/aigc/video-generation/video-synthesis";
const IMAGE_TO_VIDEO_SYNTHESIS_PATH = "/api/v1/services/aigc/image2video/video-synthesis";
const TRIPO_3D_GENERATION_PATH = "/api/v1/services/aigc/video-generation/3d-generation";
const WAN_ANIMATE_MOVE_MODEL = "wan2.2-animate-move";
const WAN_S2V_MODEL = "wan2.2-s2v";
const TRIPO_P1_MODEL = "Tripo/Tripo-P1.0";
const TRIPO_H31_MODEL = "Tripo/Tripo-H3.1";
const TRIPO_TASK_PREFIX = "tripo_";

/** 网关轮询单次 GET `/api/v1/tasks/{id}` 超时上限（DashScope 排队可能较久） */
export const BAILIAN_GATEWAY_POLL_DEADLINE_MS = 60_000;

/**
 * HappyHorse 1.1 六折期实扣：积分 / 秒（原百炼视频口径为 250 积分/秒）。
 * 对外导出同名语义，供 SKU 预估与文档引用。
 */
const POINTS_PER_SECOND = 150;
export const BAILIAN_VIDEO_CREDITS_PER_SECOND = POINTS_PER_SECOND;

/** 项目积分口径：人民币 1 元折算为 250 积分。 */
export const BAILIAN_CREDITS_PER_CNY = 250;
/** wan2.2-animate-move 华北 2 官方原价：标准 0.4 元/秒、专业 0.6 元/秒。 */
export const BAILIAN_ANIMATE_MOVE_STD_CREDITS_PER_SECOND = Math.round(0.4 * BAILIAN_CREDITS_PER_CNY);
export const BAILIAN_ANIMATE_MOVE_PRO_CREDITS_PER_SECOND = Math.round(0.6 * BAILIAN_CREDITS_PER_CNY);
/** wan2.2-s2v 华北 2 官方原价：480P 0.5 元/秒、720P 0.9 元/秒。 */
export const BAILIAN_S2V_480P_CREDITS_PER_SECOND = Math.round(0.5 * BAILIAN_CREDITS_PER_CNY);
export const BAILIAN_S2V_720P_CREDITS_PER_SECOND = Math.round(0.9 * BAILIAN_CREDITS_PER_CNY);

const BAILIAN_DEFAULT_USAGE_DURATION_SEC = 5;

const BAILIAN_REQUEST_DURATION_MIN = 3;
const BAILIAN_REQUEST_DURATION_MAX = 15;

/** 无 `catalogBaseCost` 时的目录参考：默认 5 秒 × 单价 */
export const BAILIAN_DEFAULT_ESTIMATE_CREDITS =
  BAILIAN_DEFAULT_USAGE_DURATION_SEC * BAILIAN_VIDEO_CREDITS_PER_SECOND;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

function extractBailianCredentials(credentials: unknown): { apiKey: string; baseUrl: string; signal?: AbortSignal } {
  const fromEnv =
    process.env.DASHSCOPE_API_KEY?.trim() ||
    process.env.BAILIAN_API_KEY?.trim() ||
    process.env.ALIBABA_CLOUD_API_KEY?.trim() ||
    "";
  let baseUrl = (process.env.DASHSCOPE_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
  let apiKey = fromEnv;
  let signal: AbortSignal | undefined;
  if (isRecord(credentials)) {
    if (typeof credentials.apiKey === "string" && credentials.apiKey.trim()) {
      apiKey = credentials.apiKey.trim();
    }
    if (typeof credentials.baseUrl === "string" && credentials.baseUrl.trim()) {
      baseUrl = credentials.baseUrl.trim().replace(/\/$/, "");
    }
    if (credentials.signal instanceof AbortSignal) {
      signal = credentials.signal;
    }
  }
  if (!apiKey) {
    throw new ProviderError(
      "未配置百炼 / DashScope API Key（请设置环境变量 DASHSCOPE_API_KEY 或 BAILIAN_API_KEY）",
      "BAILIAN_MISSING_API_KEY",
      401
    );
  }
  return { apiKey, baseUrl, signal };
}

function resolveTripoBaseUrl(credentials: unknown): string {
  if (isRecord(credentials) && typeof credentials.tripoBaseUrl === "string" && credentials.tripoBaseUrl.trim()) {
    return credentials.tripoBaseUrl.trim().replace(/\/$/, "");
  }
  const explicit = process.env.BAILIAN_TRIPO_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const workspaceId =
    (isRecord(credentials) && typeof credentials.workspaceId === "string" ? credentials.workspaceId.trim() : "")
    || process.env.BAILIAN_WORKSPACE_ID?.trim()
    || process.env.DASHSCOPE_WORKSPACE_ID?.trim()
    || "";
  if (!workspaceId || !/^[a-zA-Z0-9-]+$/.test(workspaceId)) {
    throw new ProviderError(
      "Tripo 3D 需要华北2（北京）百炼业务空间，请配置 BAILIAN_WORKSPACE_ID 或 BAILIAN_TRIPO_BASE_URL",
      "BAILIAN_TRIPO_MISSING_WORKSPACE",
      400,
    );
  }
  return `https://${workspaceId}.cn-beijing.maas.aliyuncs.com`;
}

function readStringFlag(flags: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!flags) return undefined;
  for (const k of keys) {
    const v = flags[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function readStringFromNode(node: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!node) return undefined;
  for (const k of keys) {
    const v = node[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function readNumberFlag(flags: Record<string, unknown> | undefined, keys: string[]): number | undefined {
  if (!flags) return undefined;
  for (const k of keys) {
    const v = flags[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v.trim());
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function readNumberFromNode(node: Record<string, unknown> | undefined, keys: string[]): number | undefined {
  if (!node) return undefined;
  for (const k of keys) {
    const v = node[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v.trim());
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function readBooleanFlag(flags: Record<string, unknown> | undefined, keys: string[]): boolean | undefined {
  if (!flags) return undefined;
  for (const k of keys) {
    const v = flags[k];
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (s === "true" || s === "1") return true;
      if (s === "false" || s === "0") return false;
    }
  }
  return undefined;
}

function readBooleanFromNode(node: Record<string, unknown> | undefined, keys: string[]): boolean | undefined {
  if (!node) return undefined;
  for (const k of keys) {
    const v = node[k];
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (s === "true" || s === "1") return true;
      if (s === "false" || s === "0") return false;
    }
  }
  return undefined;
}

/** 从 `inputs.image_urls` 或节点上的数组字段解析出公网图片 URL 列表 */
function normalizeHttpImageUrlArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const t = item.trim();
    if (/^https?:\/\//i.test(t)) out.push(t);
  }
  return out;
}

/** Preserve Tripo's fixed front/left/back/right slot positions, including empty directions. */
function normalizeTripoImageSlots(raw: unknown): Array<string | undefined> {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 4).map((item) => {
    if (typeof item !== "string") return undefined;
    const value = item.trim();
    return /^https?:\/\//i.test(value) ? value : undefined;
  });
}

function findFirstImageHttpUrl(nodeInputs: StandardPayload["nodeInputs"]): string | undefined {
  const stack: unknown[] = [];
  for (const n of Object.values(nodeInputs)) stack.push(n);
  let steps = 0;
  while (stack.length && steps++ < 400) {
    const cur = stack.shift();
    if (typeof cur === "string") {
      const t = cur.trim();
      if (/^https?:\/\//i.test(t)) return t;
    } else if (isRecord(cur)) {
      for (const v of Object.values(cur)) stack.push(v);
    } else if (Array.isArray(cur)) {
      for (const v of cur) stack.push(v);
    }
  }
  return undefined;
}

/** 收集节点文本，优先常见 positive / prompt 路径 */
function extractPromptFromNodeInputs(nodeInputs: StandardPayload["nodeInputs"]): string | undefined {
  const tryNodes = ["37", "prompt", "input", "text"];
  for (const id of tryNodes) {
    const n = nodeInputs[id];
    if (!isRecord(n)) continue;
    const t =
      (typeof n.text === "string" && n.text.trim()) ||
      (typeof n.prompt === "string" && n.prompt.trim()) ||
      (typeof n.value === "string" && n.value.trim());
    if (t) return t;
  }
  for (const n of Object.values(nodeInputs)) {
    if (!isRecord(n)) continue;
    for (const [k, v] of Object.entries(n)) {
      if (typeof v !== "string" || !v.trim()) continue;
      const kl = k.toLowerCase();
      if (kl.includes("image") || kl === "url" || kl.endsWith("_url")) continue;
      if (/^https?:\/\//i.test(v.trim())) continue;
      if (v.trim().length > 4) return v.trim();
    }
  }
  return undefined;
}

function resolveDashScopeModel(payload: StandardPayload): string {
  const templateId = payload.templateId.trim().toLowerCase();
  if (templateId.includes(WAN_ANIMATE_MOVE_MODEL)) return WAN_ANIMATE_MOVE_MODEL;
  if (templateId.includes(WAN_S2V_MODEL)) return WAN_S2V_MODEL;
  const input = payload.nodeInputs["input"];
  if (isRecord(input)) {
    const mn = input.modelName;
    if (typeof mn === "string" && mn.trim()) return mn.trim();
    const m = input.model;
    if (typeof m === "string" && m.trim()) return m.trim();
  }
  const f = payload.flags;
  const fromFlag =
    readStringFlag(isRecord(f) ? f : undefined, [
      "modelName",
      "bailianModel",
      "dashScopeModel",
      "dashscopeModel",
      "videoModel",
      "model",
    ]) ?? "";
  if (fromFlag) return fromFlag;
  const tid = payload.templateId?.trim() ?? "";
  if (/^(?:wan|happyhorse|pixverse|kling|vidu)[a-z0-9._/-]*$/i.test(tid)) return tid;
  return "wan2.7-i2v-2026-04-25";
}

function forceHappyHorseModel(requestedModel: string, payload: StandardPayload): string {
  const input = payload.nodeInputs["input"];
  const inputNode = isRecord(input) ? input : undefined;
  const requestedLc = requestedModel.trim().toLowerCase();
  const templateLc = payload.templateId.trim().toLowerCase();
  const hasReferenceImages =
    normalizeHttpImageUrlArray(payload.inputs?.image_urls).length > 0 ||
    normalizeHttpImageUrlArray(inputNode?.image_urls).length > 0;
  const isR2v =
    requestedLc.includes("r2v") ||
    templateLc.includes("multi-ref") ||
    templateLc.includes("r2v") ||
    hasReferenceImages;

  return isR2v ? "happyhorse-1.1-r2v" : "happyhorse-1.1-i2v";
}

function shouldForceHappyHorseModel(): boolean {
  const raw =
    process.env.BAILIAN_FORCE_HAPPYHORSE_MODEL ??
    process.env.DASHSCOPE_FORCE_HAPPYHORSE_MODEL;
  if (raw == null || raw.trim() === "") return false;
  return ["1", "true", "on", "yes"].includes(raw.trim().toLowerCase());
}

/** 表单 / flags / 顶层 inputs 请求的成片时长（秒），钳制在 DashScope 常见区间 3–15 */
function resolveRequestedVideoDurationSec(
  payload: StandardPayload,
  minSeconds = BAILIAN_REQUEST_DURATION_MIN,
  maxSeconds = BAILIAN_REQUEST_DURATION_MAX,
): number {
  const fromInputs =
    payload.inputs?.duration != null && payload.inputs.duration !== ""
      ? Number(payload.inputs.duration)
      : Number.NaN;

  const flags = isRecord(payload.flags) ? payload.flags : undefined;
  const inputNode = isRecord(payload.nodeInputs["input"]) ? payload.nodeInputs["input"] : undefined;
  const fromInputNode =
    inputNode?.duration != null && inputNode.duration !== ""
      ? Number(inputNode.duration)
      : Number.NaN;

  const raw =
    Number.isFinite(fromInputs)
      ? fromInputs
      : Number.isFinite(fromInputNode)
        ? fromInputNode
        : readNumberFlag(flags, ["duration", "videoDuration", "seconds"]) ??
          readNumberFromNode(inputNode, ["duration", "videoDuration", "seconds"]);
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : BAILIAN_DEFAULT_USAGE_DURATION_SEC;
  return Math.min(maxSeconds, Math.max(minSeconds, Math.round(n)));
}

const BAILIAN_RATIO_WHITELIST = new Set(["16:9", "9:16", "3:4", "4:3", "1:1"]);

/** 画面比例：优先 `inputs.ratio`，其次节点 `input.ratio`，默认 16:9 */
function resolveRatio(payload: StandardPayload, inputNode: Record<string, unknown> | undefined): string {
  const fromInputs = payload.inputs?.ratio;
  const fromNode = inputNode?.ratio;
  const raw =
    typeof fromInputs === "string" && fromInputs.trim()
      ? fromInputs.trim()
      : typeof fromNode === "string" && fromNode.trim()
        ? fromNode.trim()
        : "";
  if (raw && BAILIAN_RATIO_WHITELIST.has(raw)) return raw;
  return "16:9";
}

const R2V_MAX_IMAGES = 9;

/** Reference-to-Video（r2v）：每张参考图为 `reference_image`，HappyHorse 官方上限为 9 张。 */
function buildR2vReferenceMediaList(
  singleImageUrl: string | undefined,
  imageUrls: string[]
): Array<{ type: "reference_image"; url: string }> {
  if (imageUrls.length > 0) {
    if (imageUrls.length > R2V_MAX_IMAGES) {
      throw new ProviderError(
        `参考图最多 ${R2V_MAX_IMAGES} 张，当前上传了 ${imageUrls.length} 张，请删除多余图片后重试。`,
        "BAILIAN_TOO_MANY_IMAGES",
        400
      );
    }
    return imageUrls.map((url) => ({ type: "reference_image", url }));
  }
  const trimmed =
    typeof singleImageUrl === "string" && singleImageUrl.trim() && /^https?:\/\//i.test(singleImageUrl.trim())
      ? singleImageUrl.trim()
      : undefined;
  if (trimmed) return [{ type: "reference_image", url: trimmed }];
  return [];
}

/** Wan I2V: one native first frame, optionally followed by one native last frame. */
function buildI2vBoundaryMedia(
  singleImageUrl: string | undefined,
  imageUrls: string[],
  explicitLastFrameUrl?: string,
): Array<{ type: "first_frame" | "last_frame"; url: string }> {
  const trimmed =
    typeof singleImageUrl === "string" && singleImageUrl.trim() && /^https?:\/\//i.test(singleImageUrl.trim())
      ? singleImageUrl.trim()
      : undefined;
  const firstUrl = trimmed ?? imageUrls[0];
  if (!firstUrl) return [];
  const explicitLast =
    typeof explicitLastFrameUrl === "string"
    && explicitLastFrameUrl.trim()
    && /^https?:\/\//i.test(explicitLastFrameUrl.trim())
      ? explicitLastFrameUrl.trim()
      : undefined;
  const lastUrl = explicitLast ?? imageUrls.find((url) => url !== firstUrl);
  return [
    { type: "first_frame", url: firstUrl },
    ...(lastUrl ? [{ type: "last_frame" as const, url: lastUrl }] : []),
  ];
}

/** 万相 / HappyHorse：`input.media`（r2v 为 `reference_image`，i2v 为 `first_frame`）+ `parameters` */
export type BailianVideoSynthesisInputWan27 = {
  prompt: string;
  negative_prompt?: string;
  media: Array<{ type: string; url: string }>;
};

/** 早期图生视频：`input.image_url`（与 `prompt` 并列） */
export type BailianVideoSynthesisInputLegacy = {
  image_url: string;
  prompt: string;
};

/** 万相图生动作：把参考视频中的动作与表情迁移到人物图片。 */
export type BailianAnimateMoveInput = {
  image_url: string;
  video_url: string;
  watermark?: boolean;
};

export type BailianS2vInput = {
  image_url: string;
  audio_url: string;
};

type TripoGenerationMode = "text" | "single_image" | "multi_image";
type TripoImageInput = { type: "jpeg" | "png"; file_token: string };

export type BailianTripo3dRequestBody = {
  model: typeof TRIPO_P1_MODEL | typeof TRIPO_H31_MODEL;
  input:
    | { prompt: string }
    | { image: string }
    | { images: Array<TripoImageInput | Record<string, never>> };
  parameters: {
    face_limit?: number;
    texture_quality?: "standard" | "detailed";
    geometry_quality?: "standard" | "ultra";
    texture?: false;
    pbr?: false;
  };
};

export type BailianVideoSynthesisRequestBody =
  | BailianTripo3dRequestBody
  | {
      model: typeof WAN_ANIMATE_MOVE_MODEL;
      input: BailianAnimateMoveInput;
      parameters: {
        mode: "wan-std" | "wan-pro";
        check_image?: boolean;
      };
    }
  | {
      model: typeof WAN_S2V_MODEL;
      input: BailianS2vInput;
      parameters: { resolution: "480P" | "720P" };
    }
  | {
      model: string;
      input: BailianVideoSynthesisInputWan27;
      parameters: Record<string, unknown>;
    }
  | {
      model: string;
      input: BailianVideoSynthesisInputLegacy;
      parameters?: Record<string, unknown>;
    };

function normalizeTripoModel(model: string): typeof TRIPO_P1_MODEL | typeof TRIPO_H31_MODEL | undefined {
  const normalized = model.trim().toLowerCase();
  if (normalized === TRIPO_P1_MODEL.toLowerCase()) return TRIPO_P1_MODEL;
  if (normalized === TRIPO_H31_MODEL.toLowerCase()) return TRIPO_H31_MODEL;
  return undefined;
}

function resolveTripoGenerationMode(inputNode: Record<string, unknown> | undefined): TripoGenerationMode {
  const raw = readStringFromNode(inputNode, ["generation_mode", "generationMode"]);
  if (raw === "single_image" || raw === "multi_image") return raw;
  return "text";
}

function inferTripoImageType(url: string): "jpeg" | "png" {
  try {
    return /\.png$/i.test(new URL(url).pathname) ? "png" : "jpeg";
  } catch {
    return /\.png(?:$|[?#])/i.test(url) ? "png" : "jpeg";
  }
}

function buildTripo3dPayload(
  payload: StandardPayload,
  model: typeof TRIPO_P1_MODEL | typeof TRIPO_H31_MODEL,
): BailianTripo3dRequestBody {
  const inputNode = isRecord(payload.nodeInputs.input) ? payload.nodeInputs.input : undefined;
  const mode = resolveTripoGenerationMode(inputNode);
  let input: BailianTripo3dRequestBody["input"];

  if (mode === "text") {
    const prompt = readStringFromNode(inputNode, ["prompt", "text"])?.trim() ?? "";
    if (!prompt || prompt.length > 1024) {
      throw new ProviderError("文生 3D 提示词长度必须为 1–1024 个字符", "BAILIAN_TRIPO_INVALID_PROMPT", 400);
    }
    input = { prompt };
  } else if (mode === "single_image") {
    const image = readStringFromNode(inputNode, ["image_url", "imageUrl"]);
    if (!image || !/^https?:\/\//i.test(image)) {
      throw new ProviderError("单图生 3D 需要一张已上传的公网 JPEG/PNG 图片", "BAILIAN_TRIPO_MISSING_IMAGE", 400);
    }
    input = { image };
  } else {
    const slots = normalizeTripoImageSlots(inputNode?.image_urls);
    const validImageCount = slots.filter((url): url is string => typeof url === "string").length;
    if (validImageCount < 2 || validImageCount > 4) {
      throw new ProviderError("多图生 3D 需要按前、左、后、右顺序上传 2–4 张图片", "BAILIAN_TRIPO_INVALID_IMAGE_COUNT", 400);
    }
    input = {
      images: Array.from({ length: 4 }, (_, index): TripoImageInput | Record<string, never> => {
        const url = slots[index];
        return url
          ? { type: inferTripoImageType(url), file_token: url } satisfies TripoImageInput
          : {};
      }),
    };
  }

  const textureOutput = readStringFromNode(inputNode, ["texture_output", "textureOutput"]);
  const faceLimit = readNumberFromNode(inputNode, ["face_limit", "faceLimit"]);
  const parameters: BailianTripo3dRequestBody["parameters"] = {};
  if (faceLimit != null) {
    const maximum = model === TRIPO_P1_MODEL ? 20_000 : 2_000_000;
    if (!Number.isInteger(faceLimit) || faceLimit < 48 || faceLimit > maximum) {
      throw new ProviderError(
        `${model === TRIPO_P1_MODEL ? "Tripo P1.0" : "Tripo H3.1"} 面数必须为 48–${maximum.toLocaleString("zh-CN")} 之间的整数`,
        "BAILIAN_TRIPO_INVALID_FACE_LIMIT",
        400,
      );
    }
    parameters.face_limit = faceLimit;
  }
  if (textureOutput === "base") {
    parameters.texture = false;
    parameters.pbr = false;
  } else {
    parameters.texture_quality =
      readStringFromNode(inputNode, ["texture_quality", "textureQuality"]) === "detailed"
        ? "detailed"
        : "standard";
  }
  if (model === TRIPO_H31_MODEL) {
    parameters.geometry_quality = faceLimit != null
      ? faceLimit > 1_500_000 ? "ultra" : "standard"
      : readStringFromNode(inputNode, ["geometry_quality", "geometryQuality"]) === "ultra"
        ? "ultra"
        : "standard";
  }
  return { model, input, parameters };
}

export function estimateBailianTripoCredits(options: {
  model: string;
  generationMode: string;
  textureOutput: string;
  textureQuality?: string;
  geometryQuality?: string;
  faceLimit?: number;
}): number {
  const model = normalizeTripoModel(options.model) ?? TRIPO_P1_MODEL;
  const isImageMode = options.generationMode !== "text";
  let priceCny: number;
  if (model === TRIPO_P1_MODEL) {
    const base = isImageMode ? 2.8 : 2.1;
    priceCny = options.textureOutput === "base" ? base : base + (options.textureQuality === "detailed" ? 1.4 : 0.7);
  } else {
    const standardBase = isImageMode ? 1.4 : 0.7;
    const geometryPremium = (options.faceLimit != null ? options.faceLimit > 1_500_000 : options.geometryQuality === "ultra") ? 1.4 : 0;
    const texturePremium = options.textureOutput === "base" ? 0 : options.textureQuality === "detailed" ? 1.4 : 0.7;
    priceCny = standardBase + geometryPremium + texturePremium;
  }
  return Math.round(priceCny * BAILIAN_CREDITS_PER_CNY);
}

function calculateTripoCredits(payload: StandardPayload, model: typeof TRIPO_P1_MODEL | typeof TRIPO_H31_MODEL): number {
  const inputNode = isRecord(payload.nodeInputs.input) ? payload.nodeInputs.input : undefined;
  return estimateBailianTripoCredits({
    model,
    generationMode: resolveTripoGenerationMode(inputNode),
    textureOutput: readStringFromNode(inputNode, ["texture_output", "textureOutput"]) ?? "pbr",
    textureQuality: readStringFromNode(inputNode, ["texture_quality", "textureQuality"]),
    geometryQuality: readStringFromNode(inputNode, ["geometry_quality", "geometryQuality"]),
    faceLimit: readNumberFromNode(inputNode, ["face_limit", "faceLimit"]),
  });
}

function encodeTripoTaskId(upstreamTaskId: string, credits: number): string {
  return `${TRIPO_TASK_PREFIX}${credits}__${upstreamTaskId}`;
}

function parseTripoTaskId(taskId: string): { upstreamTaskId: string; credits: number } | null {
  const match = /^tripo_(\d+)__(.+)$/.exec(taskId);
  if (!match) return null;
  const credits = Number(match[1]);
  return Number.isFinite(credits) && credits > 0
    ? { upstreamTaskId: match[2], credits }
    : null;
}

/**
 * 阿里云百炼 / DashScope 图生视频（异步任务）适配器。
 * - `buildPayload`：标准负载 → DashScope `video-synthesis` 请求体；
 * - `submitTask`：POST 提单并返回 `task_id`；
 * - `generate`：IProviderAdapter 入口，内部串联上述步骤；
 * - `queryTask`：GET `/api/v1/tasks/{task_id}` 轮询。
 */
export class BailianAdapter implements IProviderAdapter {
  getVideoInputCapabilities(payload: StandardPayload): VideoProviderInputCapabilities {
    const requestedModel = resolveDashScopeModel(payload);
    const requestedLc = requestedModel.toLowerCase();
    const targetModel = requestedLc === WAN_ANIMATE_MOVE_MODEL || requestedLc === WAN_S2V_MODEL
      ? requestedLc
      : shouldForceHappyHorseModel()
      ? forceHappyHorseModel(requestedModel, payload)
      : requestedModel;
    const modelLc = targetModel.toLowerCase();
    const isR2v = modelLc.includes("r2v");
    if (isR2v) {
      const referenceBinding = {
        transportRole: "reference_image",
        nativeBoundaryControl: false,
      };
      return {
        providerId: "ALIYUN_BAILIAN",
        modelId: targetModel,
        transportSchema: "dashscope_media",
        maxImages: R2V_MAX_IMAGES,
        maxPromptCharacters: 5000,
        supportsSemanticEndFramePrompt: true,
        promptCanAddressInputOrder: true,
        roleBindings: {
          first_frame: referenceBinding,
          last_frame: referenceBinding,
          character_identity: referenceBinding,
          product_identity: referenceBinding,
          scene_layout: referenceBinding,
          motion_checkpoint: referenceBinding,
          style_reference: referenceBinding,
          custom_reference: referenceBinding,
        },
      };
    }
    const isWan27I2v = modelLc.startsWith("wan2.7-i2v");
    return {
      providerId: "ALIYUN_BAILIAN",
      modelId: targetModel,
      transportSchema: targetModel.toLowerCase().includes("wan2") || targetModel.toLowerCase().includes("happyhorse")
        ? "dashscope_media"
        : "named_fields",
      maxImages: isWan27I2v ? 2 : 1,
      maxPromptCharacters: 5000,
      supportsSemanticEndFramePrompt: true,
      promptCanAddressInputOrder: false,
      nativeBoundariesCarryReferenceIdentity: isWan27I2v,
      roleBindings: {
        first_frame: {
          transportRole: "first_frame",
          fieldName: "image_url",
          nativeBoundaryControl: true,
          maxCount: 1,
        },
        ...(isWan27I2v ? {
          last_frame: {
            transportRole: "last_frame",
            fieldName: "last_frame_url",
            nativeBoundaryControl: true,
            maxCount: 1,
          },
        } : {}),
      },
    };
  }

  calculateCost(payload: StandardPayload): ProviderCostResult {
    const f = payload.flags;
    const resolvedModel = resolveDashScopeModel(payload);
    const tripoModel = normalizeTripoModel(resolvedModel);
    if (tripoModel) {
      const credits = calculateTripoCredits(payload, tripoModel);
      return { cost: credits, sellPrice: credits };
    }
    const requestedModel = resolvedModel.toLowerCase();
    const secs = requestedModel === WAN_ANIMATE_MOVE_MODEL
      ? resolveRequestedVideoDurationSec(payload, 2, 30)
      : requestedModel === WAN_S2V_MODEL
        ? resolveRequestedVideoDurationSec(payload, 1, 20)
        : resolveRequestedVideoDurationSec(payload);
    const inputNode = isRecord(payload.nodeInputs["input"]) ? payload.nodeInputs["input"] : undefined;
    const requestedMode =
      readStringFlag(isRecord(f) ? f : undefined, ["mode", "qualityMode"]) ??
      readStringFromNode(inputNode, ["mode", "qualityMode"]);
    const requestedResolution =
      readStringFlag(isRecord(f) ? f : undefined, ["resolution", "videoResolution"]) ??
      readStringFromNode(inputNode, ["resolution", "videoResolution"]);
    const creditsPerSecond = requestedModel === WAN_ANIMATE_MOVE_MODEL
      ? requestedMode === "wan-pro"
        ? BAILIAN_ANIMATE_MOVE_PRO_CREDITS_PER_SECOND
        : BAILIAN_ANIMATE_MOVE_STD_CREDITS_PER_SECOND
      : requestedModel === WAN_S2V_MODEL
        ? requestedResolution?.toUpperCase() === "720P"
          ? BAILIAN_S2V_720P_CREDITS_PER_SECOND
          : BAILIAN_S2V_480P_CREDITS_PER_SECOND
      : BAILIAN_VIDEO_CREDITS_PER_SECOND;
    let cost = secs * creditsPerSecond;
    if (isRecord(f) && typeof f.catalogBaseCost === "number" && Number.isFinite(f.catalogBaseCost)) {
      const b = Math.floor(f.catalogBaseCost);
      if (b >= 1) cost = b;
    }
    return { cost, sellPrice: cost };
  }

  /**
   * 将 `StandardPayload` 转为 DashScope 视频合成 JSON。
   * - 图片来源：单图 `image_url` 路径；多图 `payload.inputs.image_urls` / `nodeInputs.input.image_urls`（`http(s)` 字符串数组）→ `input.media`；
   * - 成片时长：`payload.inputs.duration` → `nodeInputs.input.duration` → flags，默认 5 秒并钳制 3–15；
   * - 模型名含 `wan2` 或 `happyhorse`：`input.media` + `parameters`（r2v 多图为 `reference_image`；i2v 单图 `first_frame`）；
   * - 其余模型：`input.image_url` + 可选 `parameters`（来自 `bailianParameters` 等）。
   */
  buildPayload(payload: StandardPayload): BailianVideoSynthesisRequestBody {
    const flags = isRecord(payload.flags) ? payload.flags : undefined;
    const inputNode = isRecord(payload.nodeInputs["input"]) ? payload.nodeInputs["input"] : undefined;
    const requestedModel = resolveDashScopeModel(payload);
    const tripoModel = normalizeTripoModel(requestedModel);
    if (tripoModel) return buildTripo3dPayload(payload, tripoModel);
    const imageUrls = payload.inputs?.image_urls || [];
    const refFromInputs = normalizeHttpImageUrlArray(Array.isArray(imageUrls) ? imageUrls : []);
    const refImageUrls =
      refFromInputs.length > 0 ? refFromInputs : normalizeHttpImageUrlArray(inputNode?.image_urls);
    const imageUrl =
      readStringFlag(flags, ["imageUrl", "image_url", "firstFrameUrl", "first_frame_url"]) ??
      readStringFromNode(inputNode, ["image_url", "imageUrl", "first_frame_url", "firstFrameUrl"]) ??
      findFirstImageHttpUrl(payload.nodeInputs);
    const lastFrameUrl =
      readStringFlag(flags, ["lastFrameUrl", "last_frame_url", "endFrameUrl", "end_frame_url"]) ??
      readStringFromNode(inputNode, ["last_frame_url", "lastFrameUrl", "end_frame_url", "endFrameUrl"]);
    const hasRefArray = refImageUrls.length > 0;
    const hasSingle = typeof imageUrl === "string" && imageUrl.trim() && /^https?:\/\//i.test(imageUrl.trim());
    if (!hasSingle && !hasRefArray) {
      throw new ProviderError(
        "缺少图生视频所需的图片公网 URL（请提供 image_url / flags.imageUrl，或 inputs.image_urls / input.image_urls 中的 http(s) 地址）",
        "BAILIAN_MISSING_IMAGE_URL",
        400
      );
    }
    const promptRaw =
      readStringFlag(flags, ["prompt", "positivePrompt", "text"]) ??
      extractPromptFromNodeInputs(payload.nodeInputs);
    const prompt = promptRaw?.trim() ?? "";
    const requestedLc = requestedModel.toLowerCase();
    const targetModel = requestedLc === WAN_ANIMATE_MOVE_MODEL || requestedLc === WAN_S2V_MODEL
      ? requestedLc
      : shouldForceHappyHorseModel()
      ? forceHappyHorseModel(requestedModel, payload)
      : requestedModel;
    const modelLc = targetModel.toLowerCase();
    if (modelLc === WAN_ANIMATE_MOVE_MODEL) {
      const videoUrl =
        readStringFlag(flags, ["videoUrl", "video_url", "referenceVideoUrl", "reference_video_url"]) ??
        readStringFromNode(inputNode, ["video_url", "videoUrl", "reference_video_url", "referenceVideoUrl"]);
      if (!videoUrl || !/^https?:\/\//i.test(videoUrl)) {
        throw new ProviderError(
          "缺少舞蹈参考视频的公网 URL（请提供 input.video_url）",
          "BAILIAN_MISSING_VIDEO_URL",
          400
        );
      }
      const characterImageUrl =
        readStringFlag(flags, ["imageUrl", "image_url", "characterImageUrl", "character_image_url"]) ??
        readStringFromNode(inputNode, ["image_url", "imageUrl", "character_image_url", "characterImageUrl"]) ??
        refImageUrls[0];
      if (!characterImageUrl) {
        throw new ProviderError(
          "缺少人物图片的公网 URL（请提供 input.image_url）",
          "BAILIAN_MISSING_IMAGE_URL",
          400
        );
      }
      const requestedMode =
        readStringFlag(flags, ["mode", "qualityMode"]) ??
        readStringFromNode(inputNode, ["mode", "qualityMode"]);
      const mode: "wan-std" | "wan-pro" = requestedMode === "wan-pro" ? "wan-pro" : "wan-std";
      return {
        model: WAN_ANIMATE_MOVE_MODEL,
        input: {
          image_url: characterImageUrl,
          video_url: videoUrl.trim(),
          watermark:
            readBooleanFlag(flags, ["watermark", "showWatermark"]) ??
            readBooleanFromNode(inputNode, ["watermark", "showWatermark"]) ??
            false,
        },
        parameters: {
          mode,
          check_image:
            readBooleanFlag(flags, ["check_image", "checkImage"]) ??
            readBooleanFromNode(inputNode, ["check_image", "checkImage"]) ??
            true,
        },
      };
    }
    if (modelLc === WAN_S2V_MODEL) {
      const audioUrl =
        readStringFlag(flags, ["audioUrl", "audio_url", "voiceAudioUrl", "voice_audio_url"]) ??
        readStringFromNode(inputNode, ["audio_url", "audioUrl", "voice_audio_url", "voiceAudioUrl"]);
      if (!audioUrl || !/^https?:\/\//i.test(audioUrl)) {
        throw new ProviderError(
          "缺少人声音频的公网 URL（请提供 input.audio_url）",
          "BAILIAN_MISSING_AUDIO_URL",
          400
        );
      }
      const resolutionRaw =
        readStringFlag(flags, ["resolution", "videoResolution"]) ??
        readStringFromNode(inputNode, ["resolution", "videoResolution"]);
      return {
        model: WAN_S2V_MODEL,
        input: {
          image_url: imageUrl!.trim(),
          audio_url: audioUrl.trim(),
        },
        parameters: {
          resolution: resolutionRaw?.toUpperCase() === "720P" ? "720P" : "480P",
        },
      };
    }
    const usesMediaInput = modelLc.includes("wan2") || modelLc.includes("happyhorse");
    const extraParams = flags?.bailianParameters ?? flags?.dashscopeParameters;
    const requestDuration = resolveRequestedVideoDurationSec(payload);

    if (usesMediaInput) {
      const parameters: Record<string, unknown> = {
        resolution:
          readStringFlag(flags, ["resolution", "videoResolution"]) ??
          readStringFromNode(inputNode, ["resolution", "videoResolution"]) ??
          "720P",
        duration: requestDuration,
        watermark:
          readBooleanFlag(flags, ["watermark", "showWatermark"]) ??
          readBooleanFromNode(inputNode, ["watermark", "showWatermark"]) ??
          false,
      };
      if (modelLc.includes("wan2")) {
        parameters.prompt_extend =
          readBooleanFlag(flags, ["prompt_extend", "promptExtend"]) ??
          readBooleanFromNode(inputNode, ["prompt_extend", "promptExtend"]) ??
          false;
      }
      if (isRecord(extraParams)) {
        Object.assign(parameters, extraParams);
      }
      if (modelLc.includes("happyhorse")) {
        delete parameters.prompt_extend;
        delete parameters.promptExtend;
      }
      const isR2v = modelLc.includes("r2v");
      const media = isR2v
        ? buildR2vReferenceMediaList(imageUrl, refImageUrls)
        : buildI2vBoundaryMedia(imageUrl, refImageUrls, lastFrameUrl);
      if (media.length === 0) {
        throw new ProviderError(
          "无法组装图生视频所需的 input.media（请检查图片 URL）",
          "BAILIAN_MISSING_IMAGE_URL",
          400
        );
      }

      if (!modelLc.startsWith("wan2.7-i2v")) {
        parameters.ratio = resolveRatio(payload, inputNode);
      }
      const negativePrompt =
        readStringFlag(flags, ["negativePrompt", "negative_prompt"]) ??
        readStringFromNode(inputNode, ["negativePrompt", "negative_prompt"]);

      return {
        model: targetModel,
        input: {
          prompt: prompt || "",
          ...(modelLc.startsWith("wan2.7-i2v") && negativePrompt
            ? { negative_prompt: negativePrompt.slice(0, 500) }
            : {}),
          media,
        },
        parameters,
      };
    }

    const legacyImage =
      (typeof imageUrl === "string" && /^https?:\/\//i.test(imageUrl.trim()) ? imageUrl.trim() : undefined) ??
      refImageUrls[0];
    if (!legacyImage) {
      throw new ProviderError(
        "缺少图生视频所需的图片公网 URL（legacy 模型需有效 image_url）",
        "BAILIAN_MISSING_IMAGE_URL",
        400
      );
    }

    const body: BailianVideoSynthesisRequestBody = {
      model: targetModel,
      input: {
        image_url: legacyImage,
        prompt: prompt || "",
      },
    };
    const legacyParams: Record<string, unknown> = { duration: requestDuration };
    if (isRecord(extraParams)) {
      Object.assign(legacyParams, extraParams);
    }
    legacyParams.ratio = resolveRatio(payload, inputNode);
    body.parameters = legacyParams;
    return body;
  }

  async submitTask(
    body: BailianVideoSynthesisRequestBody,
    credentials: unknown
  ): Promise<{ taskId: string; raw: unknown }> {
    const { apiKey, baseUrl, signal } = extractBailianCredentials(credentials);
    const bodyModel = body.model.toLowerCase();
    const isTripo = normalizeTripoModel(body.model) != null;
    const path = isTripo
      ? TRIPO_3D_GENERATION_PATH
      : bodyModel === WAN_ANIMATE_MOVE_MODEL || bodyModel === WAN_S2V_MODEL
        ? IMAGE_TO_VIDEO_SYNTHESIS_PATH
        : VIDEO_SYNTHESIS_PATH;
    const url = `${isTripo ? resolveTripoBaseUrl(credentials) : baseUrl}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-DashScope-Async": "enable",
        },
        body: JSON.stringify(body),
        cache: "no-store",
        signal,
      });
    } catch (e) {
      if (e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError")) {
        throw new ProviderError("DashScope 请求中断或超时", "BAILIAN_NETWORK", 502, e);
      }
      throw new ProviderError(e instanceof Error ? e.message : "网络异常", "BAILIAN_NETWORK", 502, e);
    }
    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
      raw = { parseError: true, httpStatus: res.status };
    }
    if (!res.ok) {
      const msg = extractDashScopeErrorMessage(raw) || `HTTP ${res.status}`;
      throw new ProviderError(msg, "BAILIAN_HTTP", res.status, raw);
    }
    const taskId = extractCreateTaskId(raw);
    if (!taskId) {
      throw new ProviderError("DashScope 响应中缺少 task_id", "BAILIAN_BAD_RESPONSE", undefined, raw);
    }
    return { taskId, raw };
  }

  async generate(payload: StandardPayload, credentials: unknown): Promise<ProviderResponse> {
    const body = this.buildPayload(payload);
    const { taskId, raw } = await this.submitTask(body, credentials);
    const tripoModel = normalizeTripoModel(body.model);
    return {
      taskId: tripoModel ? encodeTripoTaskId(taskId, calculateTripoCredits(payload, tripoModel)) : taskId,
      raw,
    };
  }

  async queryTask(taskId: string, credentials: unknown): Promise<TaskStatusPollData> {
    const { apiKey, baseUrl, signal } = extractBailianCredentials(credentials);
    const tripoTask = parseTripoTaskId(taskId);
    const upstreamTaskId = tripoTask?.upstreamTaskId ?? taskId;
    const url = `${tripoTask ? resolveTripoBaseUrl(credentials) : baseUrl}/api/v1/tasks/${encodeURIComponent(upstreamTaskId)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        cache: "no-store",
        signal,
      });
    } catch (e) {
      if (e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError")) {
        throw new ProviderError("DashScope 查询中断或超时", "BAILIAN_POLL_ABORTED", 503, e);
      }
      throw new ProviderError(e instanceof Error ? e.message : "网络异常", "BAILIAN_POLL_NETWORK", 502, e);
    }
    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
      raw = { parseError: true, httpStatus: res.status };
    }
    if (!res.ok) {
      const msg = extractDashScopeErrorMessage(raw) || `HTTP ${res.status}`;
      return { status: "failed", errorMessage: msg };
    }
    return mapDashScopeTaskToPollData(raw, tripoTask?.credits);
  }
}

function extractCreateTaskId(raw: unknown): string | undefined {
  if (!isRecord(raw)) return undefined;
  const out = raw.output;
  if (isRecord(out)) {
    const a =
      (typeof out.task_id === "string" && out.task_id.trim()) ||
      (typeof out.taskId === "string" && out.taskId.trim());
    if (a) return a;
  }
  const b =
    (typeof raw.task_id === "string" && raw.task_id.trim()) ||
    (typeof raw.taskId === "string" && raw.taskId.trim());
  return b || undefined;
}

function extractDashScopeErrorMessage(raw: unknown): string | undefined {
  if (!isRecord(raw)) return undefined;
  const msg =
    (typeof raw.message === "string" && raw.message.trim()) ||
    (typeof raw.msg === "string" && raw.msg.trim());
  if (msg) return msg;
  const out = raw.output;
  if (isRecord(out) && typeof out.message === "string" && out.message.trim()) return out.message.trim();
  return undefined;
}

function readTaskStatus(raw: unknown): string {
  if (!isRecord(raw)) return "";
  const out = raw.output;
  if (isRecord(out)) {
    const s = out.task_status ?? out.taskStatus ?? out.status;
    if (typeof s === "string" && s.trim()) return s.trim().toUpperCase();
  }
  const top = raw.task_status ?? raw.taskStatus ?? raw.status;
  if (typeof top === "string" && top.trim()) return top.trim().toUpperCase();
  return "";
}

function extractResultVideoUrl(raw: unknown): string | undefined {
  if (!isRecord(raw)) return undefined;
  const out = raw.output;
  if (isRecord(out)) {
    const vu =
      (typeof out.video_url === "string" && out.video_url.trim()) ||
      (typeof out.videoUrl === "string" && out.videoUrl.trim());
    if (vu) return vu;
    const results = out.results;
    if (isRecord(results)) {
      const u =
        (typeof results.video_url === "string" && results.video_url.trim()) ||
        (typeof results.videoUrl === "string" && results.videoUrl.trim());
      if (u) return u;
    }
    if (Array.isArray(results) && results[0] && isRecord(results[0])) {
      const u = results[0].url;
      if (typeof u === "string" && u.trim()) return u.trim();
    }
  }
  return undefined;
}

function extractTripoResult(raw: unknown): { modelUrl?: string; previewUrl?: string } {
  if (!isRecord(raw) || !isRecord(raw.output) || !Array.isArray(raw.output.results)) return {};
  const first = raw.output.results.find(isRecord);
  if (!first) return {};
  const modelUrl =
    (typeof first.pbr_model_url === "string" && first.pbr_model_url.trim())
    || (typeof first.base_model_url === "string" && first.base_model_url.trim())
    || undefined;
  const previewUrl =
    typeof first.rendered_image_url === "string" && first.rendered_image_url.trim()
      ? first.rendered_image_url.trim()
      : undefined;
  return { modelUrl, previewUrl };
}

/** 从 DashScope 任务查询结果解析生成视频时长（秒），缺省按 5 秒参与计费估算 */
function extractDashScopeUsageDurationSec(raw: unknown): number {
  if (!isRecord(raw)) return BAILIAN_DEFAULT_USAGE_DURATION_SEC;
  const usage = raw.usage;
  if (!isRecord(usage)) return BAILIAN_DEFAULT_USAGE_DURATION_SEC;
  const d = usage.video_duration ?? usage.duration;
  if (typeof d === "number" && Number.isFinite(d) && d > 0) return d;
  if (typeof d === "string" && d.trim()) {
    const n = Number(d.trim());
    if (Number.isFinite(n) && n > 0) return n;
  }
  return BAILIAN_DEFAULT_USAGE_DURATION_SEC;
}

function extractDashScopeUsageVideoRatio(raw: unknown): string {
  if (!isRecord(raw) || !isRecord(raw.usage)) return "";
  const ratio = raw.usage.video_ratio;
  return typeof ratio === "string" ? ratio.trim().toLowerCase() : "";
}

function extractDashScopeUsageResolution(raw: unknown): number | undefined {
  if (!isRecord(raw) || !isRecord(raw.usage)) return undefined;
  const value = raw.usage.SR ?? raw.usage.sr;
  const resolution = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(resolution) ? resolution : undefined;
}

function mapDashScopeTaskToPollData(raw: unknown, tripoCredits?: number): TaskStatusPollData {
  const st = readTaskStatus(raw);
  if (st === "FAILED" || st === "FAILURE" || st === "ERROR" || st === "CANCELED" || st === "UNKNOWN") {
    const err =
      extractDashScopeErrorMessage(raw) ||
      (isRecord(raw) && isRecord(raw.output) && typeof raw.output.message === "string"
        ? raw.output.message.trim()
        : "") ||
      "DashScope 任务失败";
    return { status: "failed", errorMessage: err };
  }
  if (st === "SUCCEEDED" || st === "SUCCESS" || st === "COMPLETED") {
    if (tripoCredits != null) {
      const result = extractTripoResult(raw);
      if (!result.modelUrl) {
        return { status: "failed", errorMessage: "Tripo 任务成功但未返回 pbr_model_url 或 base_model_url" };
      }
      return {
        status: "succeeded",
        resultUrl: result.modelUrl,
        resultPreviewUrl: result.previewUrl,
        resultMediaType: "model",
        progress: 100,
        flatFeeCredits: tripoCredits,
      };
    }
    const url = extractResultVideoUrl(raw);
    if (!url) {
      return { status: "failed", errorMessage: "任务成功但未解析到 output.video_url" };
    }
    const durationSec = extractDashScopeUsageDurationSec(raw);
    const videoRatio = extractDashScopeUsageVideoRatio(raw);
    const resolution = extractDashScopeUsageResolution(raw);
    const creditsPerSecond = resolution === 720
      ? BAILIAN_S2V_720P_CREDITS_PER_SECOND
      : resolution === 480
        ? BAILIAN_S2V_480P_CREDITS_PER_SECOND
      : videoRatio === "pro"
      ? BAILIAN_ANIMATE_MOVE_PRO_CREDITS_PER_SECOND
      : videoRatio === "standard"
        ? BAILIAN_ANIMATE_MOVE_STD_CREDITS_PER_SECOND
        : POINTS_PER_SECOND;
    const providerCost = Math.round(durationSec * creditsPerSecond);
    return {
      status: "succeeded",
      resultUrl: url,
      progress: 100,
      providerCost,
      providerDurationSec: durationSec,
    };
  }
  if (st === "PENDING" || st === "QUEUED" || st === "SUBMITTED") {
    return { status: "queued", progress: 22 };
  }
  if (st === "RUNNING" || st === "PROCESSING") {
    return { status: "running", progress: 68 };
  }
  return { status: "running", progress: 45 };
}
