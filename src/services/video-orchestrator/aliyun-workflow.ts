import crypto from "crypto";
import type { VideoAspectRatio } from "./types";
import { errorForLog, logOnePromptVideo } from "./logger";

const DASHSCOPE_DEFAULT_BASE = "https://dashscope.aliyuncs.com";
const IMAGE_PATH = "/api/v1/services/aigc/image-generation/generation";
const VIDEO_PATH = "/api/v1/services/aigc/video-generation/video-synthesis";
const ONE_PROMPT_VIDEO_MODEL = "happyhorse-1.1-i2v";
type DashScopeTaskStatus = "pending" | "running" | "succeeded" | "failed";

export interface DashScopeTaskResult {
  status: DashScopeTaskStatus;
  resultUrl?: string;
  errorMessage?: string;
  raw?: unknown;
}

export interface ImsJobResult {
  status: "running" | "succeeded" | "failed";
  mediaUrl?: string;
  errorMessage?: string;
  raw?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function requireDashScopeApiKey(): string {
  const key =
    process.env.DASHSCOPE_API_KEY?.trim() ||
    process.env.BAILIAN_API_KEY?.trim() ||
    process.env.ALIBABA_CLOUD_API_KEY?.trim() ||
    "";
  if (!key) throw new Error("未配置 DASHSCOPE_API_KEY 或 BAILIAN_API_KEY，无法调用阿里云百炼");
  return key;
}

function dashScopeBaseUrl(): string {
  return (process.env.DASHSCOPE_BASE_URL || DASHSCOPE_DEFAULT_BASE).replace(/\/$/, "");
}

function compatibleBaseUrl(): string {
  const fromEnv = process.env.DASHSCOPE_COMPAT_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return `${dashScopeBaseUrl()}/compatible-mode/v1`;
}

function model(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function onePromptI2vModel(): string {
  return ONE_PROMPT_VIDEO_MODEL;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function imageSizeFromAspectRatio(aspectRatio: VideoAspectRatio): string {
  if (aspectRatio === "16:9") return "1536*864";
  if (aspectRatio === "1:1") return "1024*1024";
  return "864*1536";
}

export async function submitAliyunImageTask(params: {
  prompt: string;
  negativePrompt?: string;
  referenceImageUrls?: string[];
  aspectRatio: VideoAspectRatio;
  seed?: number;
}): Promise<string> {
  const imageModel = model("ALIYUN_IMAGE_MODEL", "wan2.7-image-pro");
  const supportsNegativePrompt = process.env.ALIYUN_IMAGE_SUPPORTS_NEGATIVE_PROMPT?.trim().toLowerCase() === "true";
  const referenceImageUrls = (params.referenceImageUrls ?? []).filter(Boolean).slice(0, 4);
  const finalPrompt = supportsNegativePrompt || !params.negativePrompt
    ? params.prompt
    : `${params.prompt}\nAvoid: ${params.negativePrompt}`;
  const buildBody = (withReferences: boolean) => ({
    model: imageModel,
    input: {
      messages: [
        {
          role: "user",
          content: [
            { text: finalPrompt.slice(0, 5000) },
            ...(withReferences ? referenceImageUrls.map((url) => ({ image: url })) : []),
          ],
        },
      ],
    },
    parameters: {
      size: imageSizeFromAspectRatio(params.aspectRatio),
      n: 1,
      watermark: false,
      thinking_mode: true,
      ...(supportsNegativePrompt && params.negativePrompt ? { negative_prompt: params.negativePrompt.slice(0, 1500) } : {}),
      ...(params.seed != null ? { seed: params.seed } : {}),
    },
  });
  await logOnePromptVideo("aliyun.image.submit.prepare", {
    model: imageModel,
    aspectRatio: params.aspectRatio,
    size: imageSizeFromAspectRatio(params.aspectRatio),
    promptLength: finalPrompt.length,
    negativePromptLength: params.negativePrompt?.length ?? 0,
    referenceImageCount: referenceImageUrls.length,
    supportsNegativePrompt,
    seed: params.seed,
  });
  try {
    return await submitDashScopeAsync(IMAGE_PATH, buildBody(referenceImageUrls.length > 0), "阿里云万相图片生成");
  } catch (error) {
    if (!referenceImageUrls.length) throw error;
    await logOnePromptVideo("aliyun.image.submit.reference_fallback", {
      model: imageModel,
      referenceImageCount: referenceImageUrls.length,
      ...errorForLog(error),
    }, "warn");
    return submitDashScopeAsync(IMAGE_PATH, buildBody(false), "阿里云万相图片生成");
  }
}
export async function submitAliyunImageToVideoTask(params: {
  imageUrl: string;
  lastFrameUrl: string;
  prompt: string;
  durationSeconds: number;
}): Promise<string> {
  const i2vModel = onePromptI2vModel();
  if (!params.lastFrameUrl?.trim()) {
    throw new Error("HappyHorse boundary-constrained generation requires an end-frame image URL for deterministic post-processing.");
  }
  const prompt = params.prompt;
  const duration = clamp(params.durationSeconds, 3, 15);
  const resolution = process.env.ALIYUN_I2V_RESOLUTION?.trim() || "720P";
  const generateAudio = process.env.ALIYUN_I2V_AUDIO?.trim().toLowerCase() !== "false";
  const body = {
    model: i2vModel,
    input: {
      prompt: prompt.slice(0, 5000),
      // HappyHorse 1.1 I2V accepts exactly one first_frame. The approved end
      // boundary is enforced deterministically after this task succeeds.
      media: [{ type: "first_frame", url: params.imageUrl }],
    },
    parameters: {
      resolution,
      duration,
      audio: generateAudio,
      prompt_extend: process.env.ALIYUN_I2V_PROMPT_EXTEND?.trim().toLowerCase() === "true",
      watermark: false,
    },
  };
  await logOnePromptVideo("aliyun.i2v.submit.prepare", {
    model: i2vModel,
    configuredModel: process.env.ALIYUN_I2V_MODEL?.trim() || null,
    forcedModel: true,
    imageUrl: params.imageUrl,
    lastFrameUrl: params.lastFrameUrl,
    lastFrameMode: "deterministic_postprocess",
    promptLength: prompt.length,
    requestedDurationSeconds: params.durationSeconds,
    durationSeconds: duration,
    resolution,
    generateAudio,
  });
  return submitDashScopeAsync(VIDEO_PATH, body, "阿里云万相图生视频");
}

export async function queryDashScopeTask(taskId: string): Promise<DashScopeTaskResult> {
  await logOnePromptVideo("dashscope.task.query.request", { taskId });
  try {
    const res = await fetch(`${dashScopeBaseUrl()}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${requireDashScopeApiKey()}` },
    });
    const raw = await safeJson(res);
    if (!res.ok) {
      const failed = { status: "failed" as const, errorMessage: extractError(raw) || `DashScope 查询失败 HTTP ${res.status}`, raw };
      await logOnePromptVideo("dashscope.task.query.response", {
        taskId,
        httpStatus: res.status,
        status: failed.status,
        errorMessage: failed.errorMessage,
        rawSummary: summarizeRaw(raw),
      }, "error");
      return failed;
    }
    const output = isRecord(raw) && isRecord(raw.output) ? raw.output : undefined;
    const status = String(output?.task_status || "").toUpperCase();
    if (status === "SUCCEEDED") {
      const resultUrl = extractResultUrl(raw);
      const result = resultUrl
        ? { status: "succeeded" as const, resultUrl, raw }
        : { status: "failed" as const, errorMessage: "DashScope 任务成功但未解析到结果 URL", raw };
      await logOnePromptVideo("dashscope.task.query.response", {
        taskId,
        httpStatus: res.status,
        upstreamStatus: status,
        status: result.status,
        resultUrl: result.status === "succeeded" ? result.resultUrl : undefined,
        errorMessage: result.status === "failed" ? result.errorMessage : undefined,
      }, result.status === "failed" ? "error" : "info");
      return result;
    }
    if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
      const result = { status: "failed" as const, errorMessage: extractError(raw) || `DashScope 任务状态 ${status}`, raw };
      await logOnePromptVideo("dashscope.task.query.response", {
        taskId,
        httpStatus: res.status,
        upstreamStatus: status,
        status: result.status,
        errorMessage: result.errorMessage,
        rawSummary: summarizeRaw(raw),
      }, "error");
      return result;
    }
    const result = { status: status === "RUNNING" ? "running" as const : "pending" as const, raw };
    await logOnePromptVideo("dashscope.task.query.response", {
      taskId,
      httpStatus: res.status,
      upstreamStatus: status,
      status: result.status,
    });
    return result;
  } catch (error) {
    await logOnePromptVideo("dashscope.task.query.error", { taskId, ...errorForLog(error) }, "error");
    throw error;
  }
}

export async function submitImsComposeJob(params: {
  projectId: string;
  title: string;
  clipUrls: string[];
  aspectRatio: VideoAspectRatio;
}): Promise<string> {
  if (!params.clipUrls.length) throw new Error("没有可合成的视频片段");
  const outputMediaConfig = buildImsOutputMediaConfig(params.projectId, params.aspectRatio);
  await logOnePromptVideo("ims.compose.submit.prepare", {
    projectId: params.projectId,
    title: params.title,
    clipCount: params.clipUrls.length,
    aspectRatio: params.aspectRatio,
    outputMediaConfig,
  });
  const timeline = {
    VideoTracks: [
      {
        VideoTrackClips: params.clipUrls.map((url) => ({
          MediaURL: url,
          Out: 15,
          AdaptMode: "Cover",
        })),
      },
    ],
  };
  const raw = await callAliyunIce("SubmitMediaProducingJob", {
    Timeline: JSON.stringify(timeline),
    OutputMediaTarget: process.env.ALIYUN_IMS_OUTPUT_TARGET?.trim() || "oss-object",
    OutputMediaConfig: JSON.stringify(outputMediaConfig),
    ProjectMetadata: JSON.stringify({ Title: params.title || "one-prompt-video" }),
    Source: "OPENAPI",
    ClientToken: crypto.createHash("sha1").update(`${params.projectId}-${Date.now()}`).digest("hex").slice(0, 32),
  });
  const jobId = isRecord(raw) && typeof raw.JobId === "string" ? raw.JobId : "";
  if (!jobId) throw new Error(extractError(raw) || "IMS 合成任务提交后未返回 JobId");
  await logOnePromptVideo("ims.compose.submit.success", {
    projectId: params.projectId,
    jobId,
    rawSummary: summarizeRaw(raw),
  });
  return jobId;
}

export async function queryImsComposeJob(jobId: string): Promise<ImsJobResult> {
  await logOnePromptVideo("ims.compose.query.request", { jobId });
  const raw = await callAliyunIce("GetMediaProducingJob", { JobId: jobId });
  const job = isRecord(raw) && isRecord(raw.MediaProducingJob) ? raw.MediaProducingJob : undefined;
  const status = String(job?.Status || "").toLowerCase();
  if (status === "success") {
    const mediaUrl = typeof job?.MediaURL === "string" ? job.MediaURL : undefined;
    await logOnePromptVideo("ims.compose.query.response", { jobId, upstreamStatus: status, status: "succeeded", mediaUrl });
    return { status: "succeeded", mediaUrl, raw };
  }
  if (status === "failed") {
    const result = { status: "failed" as const, errorMessage: extractError(job) || "IMS 合成失败", raw };
    await logOnePromptVideo("ims.compose.query.response", { jobId, upstreamStatus: status, status: result.status, errorMessage: result.errorMessage, rawSummary: summarizeRaw(raw) }, "error");
    return result;
  }
  await logOnePromptVideo("ims.compose.query.response", { jobId, upstreamStatus: status, status: "running" });
  return { status: "running", raw };
}

async function submitDashScopeAsync(path: string, body: unknown, label: string): Promise<string> {
  await logOnePromptVideo("dashscope.task.submit.request", {
    label,
    path,
    model: isRecord(body) && typeof body.model === "string" ? body.model : undefined,
  });
  try {
    const res = await fetch(`${dashScopeBaseUrl()}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
        Authorization: `Bearer ${requireDashScopeApiKey()}`,
      },
      body: JSON.stringify(body),
    });
    const raw = await safeJson(res);
    const output = isRecord(raw) && isRecord(raw.output) ? raw.output : undefined;
    const taskId = typeof output?.task_id === "string" ? output.task_id : "";
    await logOnePromptVideo("dashscope.task.submit.response", {
      label,
      path,
      httpStatus: res.status,
      ok: res.ok,
      taskId,
      rawSummary: summarizeRaw(raw),
    }, res.ok && taskId ? "info" : "error");
    if (!res.ok) throw new Error(extractError(raw) || `${label}提交失败 HTTP ${res.status}`);
    if (!taskId) throw new Error(extractError(raw) || `${label}提交后未返回 task_id`);
    return taskId;
  } catch (error) {
    await logOnePromptVideo("dashscope.task.submit.error", { label, path, ...errorForLog(error) }, "error");
    throw error;
  }
}

function buildImsOutputMediaConfig(projectId: string, aspectRatio: VideoAspectRatio): Record<string, unknown> {
  const target = process.env.ALIYUN_IMS_OUTPUT_TARGET?.trim() || "oss-object";
  const width = aspectRatio === "16:9" ? 1280 : aspectRatio === "1:1" ? 1080 : 720;
  const height = aspectRatio === "16:9" ? 720 : aspectRatio === "1:1" ? 1080 : 1280;
  if (target === "vod-media") {
    const storageLocation = process.env.ALIYUN_IMS_VOD_STORAGE_LOCATION?.trim();
    if (!storageLocation) throw new Error("ALIYUN_IMS_VOD_STORAGE_LOCATION 未配置，无法输出到 VOD");
    return {
      StorageLocation: storageLocation,
      FileName: `${projectId}.mp4`,
      Width: width,
      Height: height,
      Bitrate: 3000,
      VodTemplateGroupId: process.env.ALIYUN_IMS_VOD_TEMPLATE_GROUP_ID?.trim() || "VOD_NO_TRANSCODE",
    };
  }

  const template = process.env.ALIYUN_IMS_OUTPUT_MEDIA_URL_TEMPLATE?.trim();
  const fixed = process.env.ALIYUN_IMS_OUTPUT_MEDIA_URL?.trim();
  const mediaUrl = template
    ? template.replace(/\{projectId\}/g, projectId).replace(/\{timestamp\}/g, String(Date.now()))
    : fixed;
  if (!mediaUrl) {
    throw new Error("ALIYUN_IMS_OUTPUT_MEDIA_URL_TEMPLATE 未配置，无法提交 IMS 合成输出");
  }
  return { MediaURL: mediaUrl, Width: width, Height: height, Bitrate: 3000 };
}

async function callAliyunIce(action: string, params: Record<string, string>): Promise<unknown> {
  const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID?.trim();
  const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET?.trim();
  if (!accessKeyId || !accessKeySecret) {
    throw new Error("未配置 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET，无法调用 IMS");
  }
  const regionId = process.env.ALIYUN_IMS_REGION?.trim() || "cn-shanghai";
  const endpoint = process.env.ALIYUN_IMS_ENDPOINT?.trim() || `https://ice.${regionId}.aliyuncs.com/`;
  const common: Record<string, string> = {
    Action: action,
    Version: "2020-11-09",
    Format: "JSON",
    AccessKeyId: accessKeyId,
    SignatureMethod: "HMAC-SHA1",
    SignatureVersion: "1.0",
    SignatureNonce: crypto.randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    RegionId: regionId,
    ...params,
  };
  const canonical = Object.keys(common)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(common[key])}`)
    .join("&");
  const stringToSign = `GET&%2F&${percentEncode(canonical)}`;
  const signature = crypto.createHmac("sha1", `${accessKeySecret}&`).update(stringToSign).digest("base64");
  const url = `${endpoint.replace(/\/$/, "")}/?${canonical}&Signature=${percentEncode(signature)}`;
  await logOnePromptVideo("ims.call.request", {
    action,
    regionId,
    endpoint,
    paramKeys: Object.keys(params),
  });
  try {
    const res = await fetch(url);
    const raw = await safeJson(res);
    const failed = !res.ok || (isRecord(raw) && (raw.Code || raw.Message) && !raw.JobId && !raw.MediaProducingJob);
    await logOnePromptVideo("ims.call.response", {
      action,
      httpStatus: res.status,
      ok: !failed,
      rawSummary: summarizeRaw(raw),
    }, failed ? "error" : "info");
    if (failed) {
      const message = extractError(raw) || `IMS ${action} 失败 HTTP ${res.status}`;
      const requestId = isRecord(raw) && typeof raw.RequestId === "string" ? raw.RequestId : undefined;
      const troubleshootUrl = deepFindUrl(raw);
      const permissionHint =
        isRecord(raw) && raw.Code === "Forbidden"
          ? "请给当前 ALIYUN_ACCESS_KEY_ID 对应的 RAM 用户添加 AliyunICEFullAccess，或至少授权 ice:SubmitMediaProducingJob / ice:GetMediaProducingJob。"
          : "";
      throw new Error(
        [message, requestId ? `RequestId=${requestId}` : "", permissionHint, troubleshootUrl ? `Troubleshoot=${troubleshootUrl}` : ""]
          .filter(Boolean)
          .join(" "),
      );
    }
    return raw;
  } catch (error) {
    const detail = errorForLog(error);
    await logOnePromptVideo("ims.call.error", { action, endpoint, regionId, ...detail }, "error");
    throw new Error(`IMS ${action} 请求失败：${String(detail.message || "网络异常")}（endpoint=${endpoint} region=${regionId}）`);
  }
}

function percentEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/\+/g, "%20")
    .replace(/\*/g, "%2A")
    .replace(/%7E/g, "~");
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) };
  }
}

function extractChatContent(raw: unknown): string {
  if (!isRecord(raw) || !Array.isArray(raw.choices)) return "";
  const first = raw.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return "";
  return typeof first.message.content === "string" ? first.message.content.trim() : "";
}

function parseJsonObject(text: string): unknown {
  let trimmed = text.trim();
  const fence = String.fromCharCode(96, 96, 96);
  if (trimmed.startsWith(fence)) {
    trimmed = trimmed.slice(fence.length).trimStart();
    if (/^[a-zA-Z]+/.test(trimmed)) trimmed = trimmed.replace(/^[a-zA-Z]+/, "").trimStart();
    if (trimmed.endsWith(fence)) trimmed = trimmed.slice(0, -fence.length).trimEnd();
    trimmed = trimmed.trim();
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("百炼分镜规划未返回合法 JSON");
  }
}

function extractResultUrl(raw: unknown): string | undefined {
  const output = isRecord(raw) && isRecord(raw.output) ? raw.output : undefined;
  if (typeof output?.video_url === "string") return output.video_url;
  if (Array.isArray(output?.choices)) {
    for (const choice of output.choices) {
      if (!isRecord(choice) || !isRecord(choice.message) || !Array.isArray(choice.message.content)) continue;
      for (const item of choice.message.content) {
        if (!isRecord(item)) continue;
        if (typeof item.image === "string") return item.image;
        if (typeof item.video === "string") return item.video;
      }
    }
  }
  return deepFindUrl(raw);
}

function deepFindUrl(value: unknown): string | undefined {
  const stack = [value];
  let steps = 0;
  while (stack.length && steps++ < 500) {
    const current = stack.shift();
    if (typeof current === "string" && /^https?:\/\//i.test(current)) return current;
    if (Array.isArray(current)) stack.push(...current);
    else if (isRecord(current)) stack.push(...Object.values(current));
  }
  return undefined;
}

function extractError(raw: unknown): string | undefined {
  if (!isRecord(raw)) return undefined;
  const output = isRecord(raw.output) ? raw.output : raw;
  const code = typeof output.Code === "string" ? output.Code : typeof output.code === "string" ? output.code : "";
  const msg = typeof output.Message === "string" ? output.Message : typeof output.message === "string" ? output.message : "";
  if (code && msg) return `${code}: ${msg}`;
  return msg || code || undefined;
}

function summarizeRaw(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const output = isRecord(raw.output) ? raw.output : undefined;
  return {
    requestId: raw.request_id || raw.RequestId,
    code: raw.code || raw.Code,
    message: raw.message || raw.Message,
    taskId: output?.task_id,
    taskStatus: output?.task_status,
    jobId: raw.JobId,
    hasMediaProducingJob: Boolean(raw.MediaProducingJob),
    resultUrl: extractResultUrl(raw),
  };
}
