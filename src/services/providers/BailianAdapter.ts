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
const WAN_ANIMATE_MOVE_MODEL = "wan2.2-animate-move";

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

export type BailianVideoSynthesisRequestBody =
  | {
      model: typeof WAN_ANIMATE_MOVE_MODEL;
      input: BailianAnimateMoveInput;
      parameters: {
        mode: "wan-std" | "wan-pro";
        check_image?: boolean;
      };
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
    const targetModel = requestedModel.toLowerCase() === WAN_ANIMATE_MOVE_MODEL
      ? WAN_ANIMATE_MOVE_MODEL
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
    const requestedModel = resolveDashScopeModel(payload).toLowerCase();
    const secs = requestedModel === WAN_ANIMATE_MOVE_MODEL
      ? resolveRequestedVideoDurationSec(payload, 2, 30)
      : resolveRequestedVideoDurationSec(payload);
    const inputNode = isRecord(payload.nodeInputs["input"]) ? payload.nodeInputs["input"] : undefined;
    const requestedMode =
      readStringFlag(isRecord(f) ? f : undefined, ["mode", "qualityMode"]) ??
      readStringFromNode(inputNode, ["mode", "qualityMode"]);
    const creditsPerSecond = requestedModel === WAN_ANIMATE_MOVE_MODEL
      ? requestedMode === "wan-pro"
        ? BAILIAN_ANIMATE_MOVE_PRO_CREDITS_PER_SECOND
        : BAILIAN_ANIMATE_MOVE_STD_CREDITS_PER_SECOND
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
    const requestedModel = resolveDashScopeModel(payload);
    const targetModel = requestedModel.toLowerCase() === WAN_ANIMATE_MOVE_MODEL
      ? WAN_ANIMATE_MOVE_MODEL
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
    const path = body.model.toLowerCase() === WAN_ANIMATE_MOVE_MODEL
      ? IMAGE_TO_VIDEO_SYNTHESIS_PATH
      : VIDEO_SYNTHESIS_PATH;
    const url = `${baseUrl}${path}`;
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
    return { taskId, raw };
  }

  async queryTask(taskId: string, credentials: unknown): Promise<TaskStatusPollData> {
    const { apiKey, baseUrl, signal } = extractBailianCredentials(credentials);
    const url = `${baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}`;
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
    return mapDashScopeTaskToPollData(raw);
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

function mapDashScopeTaskToPollData(raw: unknown): TaskStatusPollData {
  const st = readTaskStatus(raw);
  if (st === "FAILED" || st === "FAILURE" || st === "ERROR") {
    const err =
      extractDashScopeErrorMessage(raw) ||
      (isRecord(raw) && isRecord(raw.output) && typeof raw.output.message === "string"
        ? raw.output.message.trim()
        : "") ||
      "DashScope 任务失败";
    return { status: "failed", errorMessage: err };
  }
  if (st === "SUCCEEDED" || st === "SUCCESS" || st === "COMPLETED") {
    const url = extractResultVideoUrl(raw);
    if (!url) {
      return { status: "failed", errorMessage: "任务成功但未解析到 output.video_url" };
    }
    const durationSec = extractDashScopeUsageDurationSec(raw);
    const videoRatio = extractDashScopeUsageVideoRatio(raw);
    const creditsPerSecond = videoRatio === "pro"
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
