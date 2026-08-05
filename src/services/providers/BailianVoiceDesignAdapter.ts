import { Buffer } from "node:buffer";
import { prisma } from "@/lib/prisma";
import { uploadMediaBufferToOss } from "@/services/video-orchestrator/oss-media";
import type { TaskStatusPollData } from "@/types/task-status";
import type { IProviderAdapter, ProviderCostResult, ProviderResponse, StandardPayload } from "./types";
import { ProviderError } from "./types";

const VOICE_ENROLLMENT_MODEL = "voice-enrollment";
const TARGET_MODEL = "cosyvoice-v3.5-plus";

type VoiceDesignFormat = "wav" | "mp3";

export interface BailianVoiceDesignRequest {
  model: typeof VOICE_ENROLLMENT_MODEL;
  input: {
    action: "create_voice";
    target_model: typeof TARGET_MODEL;
    voice_prompt: string;
    preview_text: string;
    prefix: string;
    language_hints: ["zh" | "en"];
  };
  parameters: {
    sample_rate: 24000;
    response_format: VoiceDesignFormat;
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function buildBailianVoiceDesignRequest(payload: StandardPayload): BailianVoiceDesignRequest {
  const input = payload.nodeInputs.input ?? {};
  const voicePrompt = text(input.voice_prompt);
  const previewText = text(input.preview_text);
  const prefix = text(input.prefix);
  const language = text(input.language_hint) === "en" ? "en" : "zh";
  const responseFormat: VoiceDesignFormat = text(input.response_format) === "mp3" ? "mp3" : "wav";

  if (voicePrompt.length < 2 || voicePrompt.length > 500) {
    throw new ProviderError("音色描述长度须为 2–500 个字符", "BAILIAN_VOICE_PROMPT_INVALID", 400);
  }
  if (previewText.length < 15 || previewText.length > 200) {
    throw new ProviderError("试听文案长度须为 15–200 个字符", "BAILIAN_PREVIEW_TEXT_INVALID", 400);
  }
  if (!/^[A-Za-z0-9]{1,10}$/.test(prefix)) {
    throw new ProviderError("音色名称前缀仅支持 1–10 位英文字母或数字", "BAILIAN_VOICE_PREFIX_INVALID", 400);
  }

  return {
    model: VOICE_ENROLLMENT_MODEL,
    input: {
      action: "create_voice",
      target_model: TARGET_MODEL,
      voice_prompt: voicePrompt,
      preview_text: previewText,
      prefix,
      language_hints: [language],
    },
    parameters: {
      sample_rate: 24000,
      response_format: responseFormat,
    },
  };
}

function apiKey(): string {
  const value = process.env.BAILIAN_API_KEY?.trim()
    || process.env.DASHSCOPE_API_KEY?.trim()
    || process.env.ALIBABA_CLOUD_API_KEY?.trim();
  if (!value) throw new ProviderError("未配置 BAILIAN_API_KEY 或 DASHSCOPE_API_KEY", "BAILIAN_API_KEY_MISSING", 500);
  return value;
}

function endpoint(): string {
  const explicit = process.env.BAILIAN_VOICE_DESIGN_ENDPOINT?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const workspaceId = process.env.BAILIAN_WORKSPACE_ID?.trim() || process.env.DASHSCOPE_WORKSPACE_ID?.trim();
  if (!workspaceId) {
    throw new ProviderError(
      "未配置 BAILIAN_WORKSPACE_ID（百炼业务空间 ID）",
      "BAILIAN_WORKSPACE_ID_MISSING",
      500,
    );
  }
  return `https://${workspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization`;
}

function errorMessage(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "百炼音色设计请求失败";
  const value = raw as Record<string, unknown>;
  const output = value.output && typeof value.output === "object" ? value.output as Record<string, unknown> : undefined;
  return text(value.message) || text(output?.message) || text(value.code) || "百炼音色设计请求失败";
}

function parseResponse(raw: unknown): { voiceId: string; audio: Buffer } {
  if (!raw || typeof raw !== "object") {
    throw new ProviderError("百炼未返回有效的音色设计结果", "BAILIAN_VOICE_BAD_RESPONSE", 502);
  }
  const output = (raw as Record<string, unknown>).output;
  if (!output || typeof output !== "object") {
    throw new ProviderError(errorMessage(raw), "BAILIAN_VOICE_BAD_RESPONSE", 502, raw);
  }
  const outputRecord = output as Record<string, unknown>;
  const preview = outputRecord.preview_audio;
  const previewRecord = preview && typeof preview === "object" ? preview as Record<string, unknown> : undefined;
  const voiceId = text(outputRecord.voice_id);
  const encoded = text(previewRecord?.data).replace(/^data:audio\/[a-z0-9.+-]+;base64,/i, "");
  if (!voiceId || !encoded) {
    throw new ProviderError("百炼响应缺少 voice_id 或试听音频", "BAILIAN_VOICE_BAD_RESPONSE", 502, raw);
  }
  return { voiceId, audio: Buffer.from(encoded, "base64") };
}

export function encodeVoiceDesignTaskId(voiceId: string): string {
  return `voice_${Buffer.from(voiceId, "utf8").toString("base64url")}`;
}

export function decodeVoiceDesignTaskId(taskId: string): string | undefined {
  if (!taskId.startsWith("voice_")) return undefined;
  try {
    const value = Buffer.from(taskId.slice(6), "base64url").toString("utf8").trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

export class BailianVoiceDesignAdapter implements IProviderAdapter {
  calculateCost(_payload: StandardPayload): ProviderCostResult {
    return { cost: 0, sellPrice: 0 };
  }

  async generate(payload: StandardPayload): Promise<ProviderResponse> {
    const body = buildBailianVoiceDesignRequest(payload);
    let response: Response;
    try {
      response = await fetch(endpoint(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
      });
    } catch (error) {
      throw new ProviderError(
        error instanceof Error ? error.message : "百炼音色设计网络异常",
        "BAILIAN_VOICE_NETWORK",
        502,
        error,
      );
    }

    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new ProviderError("百炼音色设计响应不是有效 JSON", "BAILIAN_VOICE_BAD_RESPONSE", 502);
    }
    if (!response.ok) {
      throw new ProviderError(errorMessage(raw), "BAILIAN_VOICE_HTTP", response.status, raw);
    }

    const { voiceId, audio } = parseResponse(raw);
    const format = body.parameters.response_format;
    const resultUrl = await uploadMediaBufferToOss({
      key: `voice-design/${Date.now()}-${voiceId.replace(/[^A-Za-z0-9_-]+/g, "-")}.${format}`,
      body: audio,
      contentType: format === "mp3" ? "audio/mpeg" : "audio/wav",
    });
    return {
      taskId: encodeVoiceDesignTaskId(voiceId),
      raw: {
        directResult: {
          status: "succeeded",
          resultUrls: [resultUrl],
          resultMediaType: "audio",
          providerCost: 0,
        },
      },
    };
  }

  async queryTask(taskId: string): Promise<TaskStatusPollData> {
    const record = await prisma.generationHistory.findUnique({
      where: { taskId },
      select: { status: true, resultUrl: true, cost: true },
    });
    if (!record) return { status: "failed", errorMessage: "音色设计任务记录不存在" };
    if (record.status === "FAILED") return { status: "failed", errorMessage: "音色设计失败" };
    if (record.status !== "SUCCESS") return { status: "running", progress: 50 };

    const voiceId = decodeVoiceDesignTaskId(taskId);
    return {
      status: "succeeded",
      resultUrl: record.resultUrl,
      resultMediaType: "audio",
      resultText: voiceId ? `音色 ID：${voiceId}` : undefined,
      providerCost: record.cost,
    };
  }
}
