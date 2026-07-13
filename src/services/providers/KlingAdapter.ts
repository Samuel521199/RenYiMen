import type { TaskStatusPollData } from "@/types/task-status";
import type { IProviderAdapter, ProviderCostResult, ProviderResponse, StandardPayload } from "./types";
import { ProviderError } from "./types";

/**
 * 302.ai Kling 视频生成适配器。
 *
 * 提交：POST https://api.302.ai/ws/api/v3/{modelName}
 *       payload: { prompt, duration, aspect_ratio, sound, image: "<公网URL>" }
 * 轮询：GET  https://api.302.ai/ws/api/v3/predictions/{taskId}/result
 *
 * 模型（通过构造参数传入）：
 *  - 标准版：kwaivgi/kling-v2.6-std/image-to-video   (~400 credits)
 *  - 高级版：kwaivgi/kling-video-o3-pro/image-to-video (~600 credits)
 */

const API_302AI_BASE =
  (process.env.KLING_302AI_BASE_URL ?? "https://api.302.ai/ws/api/v3").replace(/\/$/, "");

const KLING_ASPECT_RATIOS = new Set(["16:9", "9:16", "1:1", "4:3", "3:4"]);
const SUPPORTED_DURATIONS = new Set([5, 10]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function readStr(obj: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** 从 StandardPayload 中解析图片公网 URL（单张） */
function resolveImageUrl(payload: StandardPayload): string {
  const inputNode = isRecord(payload.nodeInputs["input"]) ? payload.nodeInputs["input"] : undefined;
  const flags = isRecord(payload.flags) ? payload.flags : undefined;

  const url =
    readStr(flags, ["imageUrl", "image_url", "firstFrameUrl"]) ??
    readStr(inputNode, ["image_url", "imageUrl", "image"]);

  // 从所有节点中找第一个 http 字符串
  if (!url) {
    for (const node of Object.values(payload.nodeInputs)) {
      if (!isRecord(node)) continue;
      for (const val of Object.values(node)) {
        if (typeof val === "string" && /^https?:\/\//i.test(val.trim())) return val.trim();
      }
    }
  }

  if (!url || !/^https?:\/\//i.test(url)) {
    throw new ProviderError(
      "缺少图生视频所需的参考图公网 URL（请提供 image_url 或 imageUrl）",
      "KLING_MISSING_IMAGE_URL",
      400
    );
  }
  return url;
}

function resolvePrompt(payload: StandardPayload): string {
  const inputNode = isRecord(payload.nodeInputs["input"]) ? payload.nodeInputs["input"] : undefined;
  const flags = isRecord(payload.flags) ? payload.flags : undefined;
  return (
    readStr(flags, ["prompt", "positivePrompt", "text"]) ??
    readStr(inputNode, ["prompt", "positivePrompt", "text"]) ??
    ""
  );
}

function resolveDuration(payload: StandardPayload): number {
  const inputNode = isRecord(payload.nodeInputs["input"]) ? payload.nodeInputs["input"] : undefined;
  const raw =
    payload.inputs?.duration ??
    inputNode?.duration ??
    (isRecord(payload.flags) ? payload.flags?.duration : undefined);
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : 5;
  const clamped = Number.isFinite(n) ? Math.round(n) : 5;
  // 对齐 Kling 支持的时长：5s 或 10s
  return SUPPORTED_DURATIONS.has(clamped) ? clamped : clamped >= 7 ? 10 : 5;
}

function resolveAspectRatio(payload: StandardPayload): string {
  const inputNode = isRecord(payload.nodeInputs["input"]) ? payload.nodeInputs["input"] : undefined;
  const flags = isRecord(payload.flags) ? payload.flags : undefined;
  const raw =
    readStr(flags, ["ratio", "aspectRatio", "aspect_ratio"]) ??
    readStr(inputNode, ["ratio", "aspectRatio", "aspect_ratio"]) ??
    "16:9";
  return KLING_ASPECT_RATIOS.has(raw) ? raw : "16:9";
}

/** 解析 302.ai 提交响应，提取 requestId */
function extractRequestId(data: unknown): string {
  const d = isRecord(data) ? data : {};
  const inner = isRecord(d.data) ? d.data : d;
  const id =
    inner.id ??
    inner.requestId ??
    inner.request_id ??
    inner.task_id ??
    d.id ??
    d.requestId;
  if (typeof id === "string" && id.trim()) return id.trim();
  if (typeof id === "number") return String(id);
  return "";
}

/** 解析 302.ai 轮询响应 → TaskStatusPollData */
function parsePollResponse(data: unknown, creditsPerGeneration: number): TaskStatusPollData {
  const d = isRecord(data) ? data : {};
  const inner = isRecord(d.data) ? d.data : d;
  const status = (typeof inner.status === "string" ? inner.status : "pending").toLowerCase();

  if (["succeeded", "success", "completed", "done"].includes(status)) {
    const outputs = Array.isArray(inner.outputs) ? inner.outputs : [];
    const videoUrl: string =
      (typeof outputs[0] === "string" ? outputs[0] : "") ||
      (typeof inner.output === "string" ? inner.output : "") ||
      (typeof inner.video_url === "string" ? inner.video_url : "") ||
      (typeof inner.url === "string" ? inner.url : "");
    if (!videoUrl) {
      return { status: "failed", errorMessage: "任务成功但未解析到视频 URL" };
    }
    return { status: "succeeded", resultUrl: videoUrl, flatFeeCredits: creditsPerGeneration };
  }

  if (["failed", "error", "cancelled"].includes(status)) {
    const err =
      (typeof inner.error === "string" ? inner.error : "") ||
      (typeof d.message === "string" ? d.message : "") ||
      "生成失败";
    return { status: "failed", errorMessage: err };
  }

  // queued / processing / pending
  return { status: "running" };
}

export class KlingAdapter implements IProviderAdapter {
  constructor(
    /** 302.ai 模型路径，如 kwaivgi/kling-video-o3-pro/image-to-video */
    private readonly modelPath: string,
    /** 本次生成固定扣除积分 */
    private readonly creditsPerGeneration: number,
    /** 读取 API Key 的环境变量名，默认 KLING_302AI_API_KEY */
    private readonly apiKeyEnvVar: string = "KLING_302AI_API_KEY"
  ) {}

  calculateCost(_payload: StandardPayload): ProviderCostResult {
    return { cost: this.creditsPerGeneration, sellPrice: this.creditsPerGeneration };
  }

  async generate(payload: StandardPayload): Promise<ProviderResponse> {
    const apiKey = process.env[this.apiKeyEnvVar];
    if (!apiKey) {
      throw new ProviderError(
        `未配置 ${this.apiKeyEnvVar}，请在 .env 中添加`,
        "KLING_MISSING_API_KEY",
        500
      );
    }

    const imageUrl = resolveImageUrl(payload);
    const prompt = resolvePrompt(payload);
    const duration = resolveDuration(payload);
    const aspectRatio = resolveAspectRatio(payload);

    const endpoint = `${API_302AI_BASE}/${this.modelPath}`;
    console.log("[KlingAdapter] 提交任务 model=%s duration=%ds ratio=%s", this.modelPath, duration, aspectRatio);

    const body: Record<string, unknown> = {
      prompt,
      duration,
      aspect_ratio: aspectRatio,
      sound: true,
      image: imageUrl,
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    let respData: unknown;
    try {
      respData = await res.json();
    } catch {
      throw new ProviderError(
        `302.ai 响应解析失败 (HTTP ${res.status})`,
        "KLING_PARSE_ERROR",
        502
      );
    }

    if (!res.ok) {
      const msg =
        (isRecord(respData) &&
          (typeof respData.message === "string" ? respData.message :
           isRecord(respData.error) && typeof respData.error.message === "string" ? respData.error.message :
           typeof respData.error === "string" ? respData.error : "")) ||
        `HTTP ${res.status}`;
      throw new ProviderError(`302.ai Kling 提交失败: ${msg}`, "KLING_SUBMIT_ERROR", res.status >= 500 ? 502 : 400);
    }

    const taskId = extractRequestId(respData);
    if (!taskId) {
      throw new ProviderError(
        `302.ai 响应中未找到 requestId: ${JSON.stringify(respData).slice(0, 200)}`,
        "KLING_NO_TASK_ID",
        502
      );
    }

    console.log("[KlingAdapter] 任务已提交 taskId=%s", taskId);
    return { taskId };
  }

  async queryTask(taskId: string): Promise<TaskStatusPollData> {
    const apiKey = process.env[this.apiKeyEnvVar];
    if (!apiKey) {
      return { status: "failed", errorMessage: `未配置 ${this.apiKeyEnvVar}` };
    }

    const pollUrl = `${API_302AI_BASE}/predictions/${taskId}/result`;

    let res: Response;
    try {
      res = await fetch(pollUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[KlingAdapter] 轮询网络错误 taskId=%s %s", taskId, msg);
      return { status: "running" };
    }

    if (!res.ok) {
      console.warn("[KlingAdapter] 轮询返回 %d taskId=%s", res.status, taskId);
      if (res.status === 404) return { status: "failed", errorMessage: "任务不存在或已过期" };
      return { status: "running" };
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return { status: "running" };
    }

    return parsePollResponse(data, this.creditsPerGeneration);
  }
}
