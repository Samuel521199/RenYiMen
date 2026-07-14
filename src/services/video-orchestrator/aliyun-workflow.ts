import crypto from "crypto";
import type { OnePromptVideoPlan, PlanVideoProjectInput, VideoAspectRatio } from "./types";
import { createVideoPlan } from "./planner";
import { errorForLog, logOnePromptVideo } from "./logger";

const DASHSCOPE_DEFAULT_BASE = "https://dashscope.aliyuncs.com";
const IMAGE_PATH = "/api/v1/services/aigc/image-generation/generation";
const VIDEO_PATH = "/api/v1/services/aigc/video-generation/video-synthesis";
const STORYBOARD_SYSTEM_PROMPT = `You are a senior commercial video director and AI storyboard prompt engineer.

Create a controllable 30-second first-and-last-frame video plan based on the user's structured request.

Return only valid JSON. No markdown, no explanations, no comments.

Hard constraints:
- Generate exactly keyframe_count keyframes and exactly segment_count video segments.
- Keyframes are timeline boundary frames, not shot midpoint frames.
- Keyframe 1 is at 0s and the final keyframe is at duration_seconds.
- Segment 1 uses keyframe 1 as first frame and keyframe 2 as last frame.
- Segment 2 uses keyframe 2 as first frame and keyframe 3 as last frame.
- Continue this pattern until the final segment uses the last two keyframes.
- Total segment duration must equal exactly duration_seconds.
- If reference images are provided, use them to infer product appearance, character styling, scene mood, color palette, and visual constraints. Do not invent conflicting product details.
- Maintain strict continuity of character identity, face, age, hairstyle, clothing, props, location, architecture, lighting, time of day, weather, and visual style.
- image_prompt_zh and image_prompt_en describe only the static keyframe boundary image.
- They must include subject, appearance, environment, composition, shot size, camera angle, lighting, and visible pose.
- They must not include camera movement, temporal progression, or motion verbs.
- video_prompt_zh and video_prompt_en describe the transition from start keyframe to end keyframe, including subject motion, environment motion, camera movement, and pacing.
- They must include motion speed, amplitude, and stability.
- Every keyframe image and every segment video must be independently editable and generatable.
- Use Chinese for all *_zh fields and user-facing descriptions.
- Use English for all *_en fields and generation prompts.
- Do not include visible text, subtitles, logos, watermarks, UI, captions, signs, or typography in generated images.
- Convert abstract emotions into visible facial expressions, posture, gestures, composition, lighting, or action.
- Do not introduce unnecessary characters, props, locations, or plot events.
- Subtitle may be empty and must be short enough to read within the shot duration.
- Before returning, internally validate shot count, shot numbering, required fields, continuity, and exact total duration.

Return this exact structure:

{
  "title": "",
  "duration_seconds": 30,
  "aspect_ratio": "16:9",
  "visual_style": "",
  "characters": [
    {
      "id": "char_01",
      "name": "",
      "appearance": "",
      "clothing": "",
      "consistency_prompt": ""
    }
  ],
  "keyframes": [
    {
      "keyframe_no": 1,
      "time_seconds": 0,
      "purpose": "",
      "scene": "",
      "character_state": "",
      "product_state": "",
      "image_prompt_zh": "",
      "image_prompt_en": "",
      "negative_prompt": ""
    }
  ],
  "segments": [
    {
      "segment_no": 1,
      "start_keyframe_no": 1,
      "end_keyframe_no": 2,
      "start_time_seconds": 0,
      "end_time_seconds": 5,
      "duration_seconds": 5,
      "purpose": "",
      "motion": "",
      "camera": "",
      "subject_motion": "",
      "environment_motion": "",
      "video_prompt_zh": "",
      "video_prompt_en": "",
      "subtitle": "",
      "negative_prompt": ""
    }
  ],
  "validation": {
    "total_duration_seconds": 30,
    "duration_is_valid": true
  }
}`;

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

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function imageSizeFromAspectRatio(aspectRatio: VideoAspectRatio): string {
  if (aspectRatio === "16:9") return "1536*864";
  if (aspectRatio === "1:1") return "1024*1024";
  return "864*1536";
}

function supportsLastFrameMedia(modelName: string): boolean {
  const model = modelName.trim().toLowerCase();
  if (model.includes("happyhorse")) return false;
  return true;
}

function supportsOrderedFrameReferences(modelName: string): boolean {
  return modelName.trim().toLowerCase().includes("happyhorse");
}

export async function createAliyunStoryboardPlan(input: PlanVideoProjectInput): Promise<OnePromptVideoPlan> {
  const fallback = createVideoPlan(input);
  const referenceImageUrls = input.referenceImageUrls.slice(0, 4);
  const storyboardModel = referenceImageUrls.length
    ? model("ALIYUN_STORYBOARD_VISION_MODEL", "qwen-vl-max-latest")
    : model("ALIYUN_STORYBOARD_MODEL", "qwen3.7-plus");
  const body = {
    model: storyboardModel,
    messages: [
      {
        role: "system",
        content: STORYBOARD_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: buildStoryboardUserContent(input, referenceImageUrls),
      },
    ],
    temperature: 0.4,
    response_format: { type: "json_object" },
  };

  await logOnePromptVideo("aliyun.storyboard.request", {
    model: storyboardModel,
    baseUrl: compatibleBaseUrl(),
    promptLength: input.userPrompt.length,
    aspectRatio: input.aspectRatio,
    durationSeconds: input.durationSeconds,
    shotCount: input.shotCount,
    stylePreset: input.stylePreset,
    referenceImageCount: referenceImageUrls.length,
  });
  try {
    const res = await fetch(`${compatibleBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${requireDashScopeApiKey()}`,
      },
      body: JSON.stringify(body),
    });
    const raw = await safeJson(res);
    await logOnePromptVideo("aliyun.storyboard.response", {
      httpStatus: res.status,
      ok: res.ok,
      rawSummary: summarizeRaw(raw),
    }, res.ok ? "info" : "error");
    if (!res.ok) throw new Error(extractError(raw) || `百炼分镜规划失败 HTTP ${res.status}`);
    const content = extractChatContent(raw);
    if (!content) throw new Error("百炼分镜规划返回为空");
    const parsed = parseJsonObject(content);
    const plan = normalizeModelPlan(parsed, fallback, input);
    await logOnePromptVideo("aliyun.storyboard.parsed", {
      title: plan.title,
      keyframeCount: plan.keyframes.length,
      segmentCount: plan.segments.length,
      segments: plan.segments.map((segment) => ({
        segmentNo: segment.segmentNo,
        durationSeconds: segment.durationSeconds,
        startKeyframeNo: segment.startKeyframeNo,
        endKeyframeNo: segment.endKeyframeNo,
        videoPromptLength: (segment.videoPromptEn ?? segment.videoPrompt).length,
      })),
    });
    return plan;
  } catch (error) {
    await logOnePromptVideo("aliyun.storyboard.error", errorForLog(error), "error");
    throw error;
  }
}

function buildStoryboardUserContent(
  input: PlanVideoProjectInput,
  referenceImageUrls: string[],
): string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> {
  const payload = JSON.stringify({
    user_idea: input.userPrompt,
    aspect_ratio: input.aspectRatio,
    duration_seconds: input.durationSeconds,
    keyframe_count: input.shotCount + 1,
    segment_count: input.shotCount,
    style_preset: input.stylePreset,
    constraints: {
      exact_keyframe_count: input.shotCount + 1,
      exact_segment_count: input.shotCount,
      exact_total_duration: true,
      keyframes_are_timeline_boundaries: true,
      segments_use_adjacent_keyframes_as_first_and_last_frames: true,
      average_segment_duration_seconds: input.durationSeconds / input.shotCount,
      display_prompt_languages: ["zh", "en"],
      generation_prompt_language: "en",
      no_visible_text_in_images: true,
      maintain_character_continuity: true,
      maintain_location_continuity: true,
    },
    reference_image_count: referenceImageUrls.length,
    reference_image_instruction: referenceImageUrls.length
      ? "Analyze the attached reference images first. Use visible product, character, color, texture, scene, and mood details as hard visual references for the storyboard and generation prompts."
      : undefined,
  });
  if (!referenceImageUrls.length) return payload;
  return [
    { type: "text", text: payload },
    ...referenceImageUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
  ];
}

export async function submitAliyunImageTask(params: {
  prompt: string;
  aspectRatio: VideoAspectRatio;
  seed?: number;
}): Promise<string> {
  const imageModel = model("ALIYUN_IMAGE_MODEL", "wan2.7-image-pro");
  const body = {
    model: imageModel,
    input: {
      messages: [
        {
          role: "user",
          content: [{ text: params.prompt.slice(0, 5000) }],
        },
      ],
    },
    parameters: {
      size: imageSizeFromAspectRatio(params.aspectRatio),
      n: 1,
      watermark: false,
      thinking_mode: true,
      ...(params.seed != null ? { seed: params.seed } : {}),
    },
  };
  await logOnePromptVideo("aliyun.image.submit.prepare", {
    model: imageModel,
    aspectRatio: params.aspectRatio,
    size: imageSizeFromAspectRatio(params.aspectRatio),
    promptLength: params.prompt.length,
    seed: params.seed,
  });
  return submitDashScopeAsync(IMAGE_PATH, body, "阿里云万相图片生成");
}

export async function submitAliyunImageToVideoTask(params: {
  imageUrl: string;
  lastFrameUrl?: string;
  prompt: string;
  durationSeconds: number;
}): Promise<string> {
  const i2vModel = model("ALIYUN_I2V_MODEL", "happyhorse-1.1-i2v");
  const shouldSendTypedLastFrame = Boolean(params.lastFrameUrl && supportsLastFrameMedia(i2vModel));
  const shouldSendOrderedFrameReference = Boolean(params.lastFrameUrl && supportsOrderedFrameReferences(i2vModel));
  const prompt = shouldSendOrderedFrameReference
    ? [
        "Use the uploaded images as ordered frame references: Image 1 is the first frame, Image 2 is the final frame. Generate a smooth transition from Image 1 to Image 2 while following the motion instructions below.",
        params.prompt,
      ].join("\n")
    : params.prompt;
  const body = {
    model: i2vModel,
    input: {
      prompt: prompt.slice(0, 5000),
      media: [
        {
          type: "first_frame",
          url: params.imageUrl,
        },
        ...(shouldSendTypedLastFrame
          ? [
              {
                type: "last_frame",
                url: params.lastFrameUrl,
              },
            ]
          : shouldSendOrderedFrameReference
            ? [
                {
                  type: "first_frame",
                  url: params.lastFrameUrl,
                },
              ]
          : []),
      ],
    },
    parameters: {
      resolution: process.env.ALIYUN_I2V_RESOLUTION?.trim() || "720P",
      duration: clamp(params.durationSeconds, 2, 15),
      prompt_extend: true,
      watermark: false,
    },
  };
  await logOnePromptVideo("aliyun.i2v.submit.prepare", {
    model: i2vModel,
    imageUrl: params.imageUrl,
    lastFrameUrl: params.lastFrameUrl,
    lastFrameMode: shouldSendTypedLastFrame ? "last_frame" : shouldSendOrderedFrameReference ? "ordered_first_frame" : "none",
    promptLength: prompt.length,
    durationSeconds: params.durationSeconds,
    resolution: process.env.ALIYUN_I2V_RESOLUTION?.trim() || "720P",
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
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("百炼分镜规划未返回合法 JSON");
  }
}

function normalizeModelPlan(raw: unknown, fallback: OnePromptVideoPlan, input: PlanVideoProjectInput): OnePromptVideoPlan {
  const plan = isRecord(raw) ? raw : {};
  const keyframesRaw = Array.isArray(plan.keyframes) ? plan.keyframes : [];
  const segmentsRaw = Array.isArray(plan.segments) ? plan.segments : [];
  const segmentCount = Math.max(2, Math.min(10, input.shotCount || fallback.segmentCount || fallback.segments.length || 6));
  const keyframeCount = segmentCount + 1;
  const keyframes = Array.from({ length: keyframeCount }, (_, index) => {
    const keyframeNo = index + 1;
    const source = isRecord(keyframesRaw[index]) ? keyframesRaw[index] : {};
    const fb = fallback.keyframes[index];
    return {
      keyframeNo,
      timeSeconds: Number(source.timeSeconds ?? source.time_seconds ?? fb.timeSeconds),
      purpose: stringOr(source.purpose, fb.purpose),
      scene: stringOr(source.scene ?? source.scene_description, fb.scene),
      characterState: stringOr(source.characterState ?? source.character_state, fb.characterState),
      productState: stringOr(source.productState ?? source.product_state, fb.productState),
      imagePrompt: stringOr(source.imagePromptZh ?? source.image_prompt_zh ?? source.imagePrompt ?? source.image_prompt, fb.imagePromptZh ?? fb.imagePrompt),
      imagePromptZh: stringOr(source.imagePromptZh ?? source.image_prompt_zh ?? source.imagePrompt ?? source.image_prompt, fb.imagePromptZh ?? fb.imagePrompt),
      imagePromptEn: stringOr(source.imagePromptEn ?? source.image_prompt_en ?? source.imagePrompt ?? source.image_prompt, fb.imagePromptEn ?? fb.imagePrompt),
      negativePrompt: stringOr(source.negativePrompt ?? source.negative_prompt, fb.negativePrompt),
    };
  });
  const segments = Array.from({ length: segmentCount }, (_, index) => {
    const segmentNo = index + 1;
    const source = isRecord(segmentsRaw[index]) ? segmentsRaw[index] : {};
    const fb = fallback.segments[index];
    return {
      segmentNo,
      startKeyframeNo: clamp(Number(source.startKeyframeNo ?? source.start_keyframe_no ?? segmentNo), 1, keyframeCount),
      endKeyframeNo: clamp(Number(source.endKeyframeNo ?? source.end_keyframe_no ?? segmentNo + 1), 1, keyframeCount),
      startTimeSeconds: Number(source.startTimeSeconds ?? source.start_time_seconds ?? fb.startTimeSeconds),
      endTimeSeconds: Number(source.endTimeSeconds ?? source.end_time_seconds ?? fb.endTimeSeconds),
      durationSeconds: clamp(Number(source.durationSeconds ?? source.duration_seconds ?? fb.durationSeconds), 2, 15),
      purpose: stringOr(source.purpose, fb.purpose),
      motion: stringOr(source.motion, fb.motion),
      camera: stringOr(source.camera ?? source.camera_movement, fb.camera),
      subjectMotion: stringOr(source.subjectMotion ?? source.subject_motion, fb.subjectMotion),
      environmentMotion: stringOr(source.environmentMotion ?? source.environment_motion, fb.environmentMotion),
      videoPrompt: stringOr(source.videoPromptZh ?? source.video_prompt_zh ?? source.videoPrompt ?? source.video_prompt, fb.videoPromptZh ?? fb.videoPrompt),
      videoPromptZh: stringOr(source.videoPromptZh ?? source.video_prompt_zh ?? source.videoPrompt ?? source.video_prompt, fb.videoPromptZh ?? fb.videoPrompt),
      videoPromptEn: stringOr(source.videoPromptEn ?? source.video_prompt_en ?? source.videoPrompt ?? source.video_prompt, fb.videoPromptEn ?? fb.videoPrompt),
      subtitle: stringOr(source.subtitle ?? source.narration ?? source.dialogue, fb.subtitle),
      negativePrompt: stringOr(source.negativePrompt ?? source.negative_prompt, fb.negativePrompt),
    };
  });
  const shots = segments.map((segment) => {
    const start = keyframes[segment.startKeyframeNo - 1];
    return {
      shotNo: segment.segmentNo,
      durationSeconds: segment.durationSeconds,
      purpose: segment.purpose,
      camera: segment.camera,
      action: segment.motion,
      imagePrompt: start?.imagePrompt ?? "",
      imagePromptZh: start?.imagePromptZh ?? start?.imagePrompt ?? "",
      imagePromptEn: start?.imagePromptEn ?? start?.imagePrompt ?? "",
      videoPrompt: segment.videoPrompt,
      videoPromptZh: segment.videoPromptZh,
      videoPromptEn: segment.videoPromptEn,
      subtitle: segment.subtitle,
      negativePrompt: segment.negativePrompt,
    };
  });
  const firstCharacter = Array.isArray(plan.characters) && isRecord(plan.characters[0]) ? plan.characters[0] : undefined;
  return {
    title: stringOr(plan.title, fallback.title),
    logline: stringOr(plan.logline, fallback.logline),
    durationSeconds: input.durationSeconds,
    aspectRatio: input.aspectRatio,
    keyframeCount: keyframes.length,
    segmentCount: segments.length,
    styleBible: isRecord(plan.styleBible)
      ? {
          visualStyle: stringOr(plan.styleBible.visualStyle, fallback.styleBible.visualStyle),
          characterLock: stringOr(plan.styleBible.characterLock, fallback.styleBible.characterLock),
          productLock: stringOr(plan.styleBible.productLock, fallback.styleBible.productLock ?? ""),
          colorPalette: stringOr(plan.styleBible.colorPalette, fallback.styleBible.colorPalette),
          negativePrompt: stringOr(plan.styleBible.negativePrompt, fallback.styleBible.negativePrompt),
        }
      : {
          visualStyle: stringOr(plan.visual_style, fallback.styleBible.visualStyle),
          characterLock: stringOr(firstCharacter?.consistency_prompt, fallback.styleBible.characterLock),
          productLock: fallback.styleBible.productLock,
          colorPalette: fallback.styleBible.colorPalette,
          negativePrompt: fallback.styleBible.negativePrompt,
        },
    keyframes,
    segments,
    shots,
  };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
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
