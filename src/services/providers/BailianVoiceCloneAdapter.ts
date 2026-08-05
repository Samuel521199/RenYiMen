import { randomUUID } from "node:crypto";
import { GenerationHistoryStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { TaskStatusPollData } from "@/types/task-status";
import { persistRemoteMediaToOss } from "@/services/video-orchestrator/oss-media";
import type { IProviderAdapter, ProviderCostResult, ProviderResponse, StandardPayload } from "./types";
import { ProviderError } from "./types";

const DEFAULT_BASE = "https://dashscope.aliyuncs.com";
const CUSTOMIZATION_PATH = "/api/v1/services/audio/tts/customization";
const SYNTHESIS_PATH = "/api/v1/services/audio/tts/SpeechSynthesizer";
const MODEL = "qwen-audio-3.0-tts-plus";
const VOICE_READY_MAX_ATTEMPTS = 25;
const VOICE_READY_POLL_INTERVAL_MS = 1_500;
const MIN_SELL_CREDITS = 20;
const CREDITS_PER_CHARACTER = 0.05;

type VoiceCloneInput = {
  audioUrl: string;
  audioDuration?: number;
  model: string;
  language: string;
  text: string;
  instruction?: string;
  enablePreprocess: boolean;
};

type VoiceCloneDependencies = {
  persistOutput: typeof persistRemoteMediaToOss;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function extractCredentials(credentials: unknown): { apiKey: string; baseUrl: string; signal?: AbortSignal } {
  const apiKey = isRecord(credentials) && readString(credentials, "apiKey")
    || process.env.DASHSCOPE_API_KEY?.trim()
    || process.env.BAILIAN_API_KEY?.trim()
    || process.env.ALIBABA_CLOUD_API_KEY?.trim()
    || "";
  const workspaceId = process.env.DASHSCOPE_WORKSPACE_ID?.trim() || process.env.BAILIAN_WORKSPACE_ID?.trim();
  const envBase = process.env.DASHSCOPE_TTS_BASE_URL?.trim()
    || (workspaceId ? `https://${workspaceId}.cn-beijing.maas.aliyuncs.com` : undefined)
    || process.env.DASHSCOPE_BASE_URL?.trim()
    || DEFAULT_BASE;
  const baseUrl = isRecord(credentials) && readString(credentials, "baseUrl") || envBase;
  const signal = isRecord(credentials) && credentials.signal instanceof AbortSignal
    ? credentials.signal
    : undefined;
  if (!apiKey) {
    throw new ProviderError(
      "未配置百炼 API Key（请设置 DASHSCOPE_API_KEY 或 BAILIAN_API_KEY）",
      "BAILIAN_VOICE_MISSING_API_KEY",
      401,
    );
  }
  return { apiKey, baseUrl: baseUrl.replace(/\/$/, ""), signal };
}

function extractInput(payload: StandardPayload): VoiceCloneInput {
  const input = isRecord(payload.nodeInputs.input) ? payload.nodeInputs.input : undefined;
  const audioUrl = readString(input, "audio_url") ?? "";
  const text = readString(input, "text") ?? "";
  const language = (readString(input, "language") ?? "zh").toLowerCase();
  const instruction = readString(input, "instruction");
  const preprocess = readString(input, "enable_preprocess") ?? "true";
  const audioDuration = readNumber(input, "audio_duration");

  if (!/^https?:\/\//i.test(audioUrl)) {
    throw new ProviderError("请先上传可用的参考录音", "BAILIAN_VOICE_MISSING_AUDIO", 400);
  }
  if (!text) {
    throw new ProviderError("试听文本不能为空", "BAILIAN_VOICE_MISSING_TEXT", 400);
  }
  if (text.length > 1000) {
    throw new ProviderError("试听文本最多 1000 个字符", "BAILIAN_VOICE_TEXT_TOO_LONG", 400);
  }
  if (audioDuration != null && (audioDuration < 5 || audioDuration > 20)) {
    throw new ProviderError("参考录音时长须为 5～20 秒", "BAILIAN_VOICE_BAD_DURATION", 400);
  }
  return {
    audioUrl,
    audioDuration,
    model: MODEL,
    language,
    text,
    instruction,
    enablePreprocess: preprocess !== "false",
  };
}

function dashScopeMessage(raw: unknown, fallback: string): string {
  if (!isRecord(raw)) return fallback;
  const output = isRecord(raw.output) ? raw.output : undefined;
  return readString(raw, "message") || readString(raw, "msg") || readString(output, "message") || fallback;
}

async function postJson(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    throw new ProviderError(
      error instanceof Error ? error.message : "声音克隆服务网络异常",
      "BAILIAN_VOICE_NETWORK",
      502,
      error,
    );
  }
  const raw: unknown = await response.json().catch(() => ({ httpStatus: response.status }));
  const rootCode = isRecord(raw) ? raw.code : undefined;
  if (!response.ok || (typeof rootCode === "string" && rootCode && rootCode !== "0")) {
    throw new ProviderError(
      dashScopeMessage(raw, `声音克隆服务请求失败（HTTP ${response.status}）`),
      "BAILIAN_VOICE_UPSTREAM",
      response.status >= 500 ? 502 : 400,
      raw,
    );
  }
  return raw;
}

function outputRecord(raw: unknown): Record<string, unknown> | undefined {
  return isRecord(raw) && isRecord(raw.output) ? raw.output : undefined;
}

function extractVoiceId(raw: unknown): string | undefined {
  return readString(outputRecord(raw), "voice_id");
}

function extractAudioUrl(raw: unknown): string | undefined {
  const output = outputRecord(raw);
  const audio = output && isRecord(output.audio) ? output.audio : undefined;
  return readString(audio, "url")
    || readString(output, "audio_url")
    || readString(output, "url");
}

function calculateTextCredits(text: string): number {
  return Math.max(MIN_SELL_CREDITS, Math.ceil(text.length * CREDITS_PER_CHARACTER));
}

export class BailianVoiceCloneAdapter implements IProviderAdapter {
  constructor(
    private readonly dependencies: VoiceCloneDependencies = { persistOutput: persistRemoteMediaToOss },
  ) {}

  calculateCost(payload: StandardPayload): ProviderCostResult {
    const input = isRecord(payload.nodeInputs.input) ? payload.nodeInputs.input : undefined;
    const text = readString(input, "text") ?? "";
    const credits = calculateTextCredits(text);
    return { cost: credits, sellPrice: credits };
  }

  async generate(payload: StandardPayload, credentials: unknown): Promise<ProviderResponse> {
    const input = extractInput(payload);
    const { apiKey, baseUrl, signal } = extractCredentials(credentials);
    const customizationUrl = `${baseUrl}${CUSTOMIZATION_PATH}`;
    const prefix = `rym${randomUUID().replace(/-/g, "").slice(0, 7)}`;
    const created = await postJson(customizationUrl, apiKey, {
      model: "voice-enrollment",
      input: {
        action: "create_voice",
        target_model: input.model,
        prefix,
        url: input.audioUrl,
        language_hints: [input.language],
        max_prompt_audio_length: Math.min(20, Math.max(5, input.audioDuration ?? 20)),
        enable_preprocess: input.enablePreprocess,
      },
    }, signal);
    const voiceId = extractVoiceId(created);
    if (!voiceId) {
      throw new ProviderError("声音克隆服务未返回 voice_id", "BAILIAN_VOICE_BAD_RESPONSE", 502, created);
    }

    let ready = false;
    for (let attempt = 0; attempt < VOICE_READY_MAX_ATTEMPTS; attempt += 1) {
      const queried = await postJson(customizationUrl, apiKey, {
        model: "voice-enrollment",
        input: { action: "query_voice", voice_id: voiceId },
      }, signal);
      const status = (readString(outputRecord(queried), "status") ?? "").toUpperCase();
      if (status === "OK") {
        ready = true;
        break;
      }
      if (status === "UNDEPLOYED") {
        throw new ProviderError(
          "参考录音未通过声音克隆审核。请确认声音授权，并换用清晰、无背景音乐的原创录音。",
          "BAILIAN_VOICE_REJECTED",
          400,
          queried,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, VOICE_READY_POLL_INTERVAL_MS));
    }
    if (!ready) {
      throw new ProviderError("音色仍在审核处理中，请稍后重新提交", "BAILIAN_VOICE_REVIEW_TIMEOUT", 503);
    }

    const synthesized = await postJson(`${baseUrl}${SYNTHESIS_PATH}`, apiKey, {
      model: input.model,
      input: {
        text: input.text,
        voice: voiceId,
        format: "wav",
        sample_rate: 24000,
        ...(input.instruction ? { instruction: input.instruction } : {}),
      },
    }, signal);
    const temporaryAudioUrl = extractAudioUrl(synthesized);
    if (!temporaryAudioUrl) {
      throw new ProviderError("语音合成成功但未解析到音频地址", "BAILIAN_VOICE_MISSING_RESULT", 502, synthesized);
    }

    const taskId = `voice_${randomUUID().replace(/-/g, "")}`;
    const resultUrl = await this.dependencies.persistOutput({
      url: temporaryAudioUrl,
      key: `voice-clone/${taskId}.wav`,
      fallbackContentType: "audio/wav",
    });
    const providerCost = calculateTextCredits(input.text);
    return {
      taskId,
      raw: {
        directResult: {
          status: "succeeded",
          resultUrls: [resultUrl],
          resultMediaType: "audio",
          providerCost,
        },
      },
    };
  }

  async queryTask(taskId: string): Promise<TaskStatusPollData> {
    const record = await prisma.generationHistory.findUnique({
      where: { taskId },
      select: { status: true, resultUrl: true, cost: true, errorMessage: true },
    });
    if (!record) return { status: "failed", errorMessage: "声音克隆任务记录不存在" };
    if (record.status === GenerationHistoryStatus.SUCCESS && record.resultUrl) {
      return {
        status: "succeeded",
        resultUrl: record.resultUrl,
        resultMediaType: "audio",
        providerCost: record.cost,
      };
    }
    if (record.status === GenerationHistoryStatus.FAILED) {
      return { status: "failed", errorMessage: record.errorMessage || "声音克隆失败" };
    }
    return { status: "running", progress: 90 };
  }
}
