import { randomUUID } from "node:crypto";
import { GenerationHistoryStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { persistRemoteMediaToOss } from "@/services/video-orchestrator/oss-media";
import type { TaskStatusPollData } from "@/types/task-status";
import type { IProviderAdapter, ProviderCostResult, ProviderResponse, StandardPayload } from "./types";
import { ProviderError } from "./types";

const MODEL = "qwen-audio-3.0-tts-plus";
const DEFAULT_BASE = "https://dashscope.aliyuncs.com";
const SYNTHESIS_PATH = "/api/v1/services/audio/tts/SpeechSynthesizer";
const CREDITS_PER_CHARACTER = 0.035;

const VOICES = new Set(["longanlingxin", "longanlufeng"]);
const EMOTIONS = {
  happy: { tag: "", instruction: "开心愉悦，语气明快自然，带有真诚笑意，适合短剧对白。" },
  sad: { tag: "[sad]", instruction: "悲伤低落，情绪克制而真实，适合短剧对白。" },
  angry: { tag: "[angry]", instruction: "愤怒有张力，语气强烈但吐字清晰，适合短剧对白。" },
  whisper: { tag: "[whispers]", instruction: "使用轻柔耳语，气声自然，保持台词清晰可辨。" },
  excited: { tag: "[excited]", instruction: "情绪激动、充满能量，节奏富有戏剧张力。" },
  calm: { tag: "", instruction: "冷静克制，语调平稳，节奏从容，适合短剧对白。" },
} as const;

type EmotionalTtsDependencies = {
  persistOutput: typeof persistRemoteMediaToOss;
};

export interface BailianEmotionalTtsRequest {
  model: typeof MODEL;
  input: {
    text: string;
    voice: string;
    instruction: string;
    format: "mp3";
    sample_rate: 24000;
    rate: number;
    volume: number;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function creditsForCharacters(characters: number): number {
  return Math.max(1, Math.ceil(Math.max(0, characters) * CREDITS_PER_CHARACTER));
}

export function buildBailianEmotionalTtsRequest(payload: StandardPayload): BailianEmotionalTtsRequest {
  const input = isRecord(payload.nodeInputs.input) ? payload.nodeInputs.input : {};
  const text = stringValue(input.text);
  const voice = stringValue(input.voice) || "longanlingxin";
  const emotionKey = stringValue(input.emotion) || "happy";
  const emotion = EMOTIONS[emotionKey as keyof typeof EMOTIONS];
  const rate = numberValue(input.rate, 1);
  const volume = numberValue(input.volume, 50);

  if (!text || text.length > 2000) {
    throw new ProviderError("配音台词长度须为 1–2000 个字符", "BAILIAN_TTS_TEXT_INVALID", 400);
  }
  if (!VOICES.has(voice)) {
    throw new ProviderError("不支持的配音音色", "BAILIAN_TTS_VOICE_INVALID", 400);
  }
  if (!emotion) {
    throw new ProviderError("不支持的配音情绪", "BAILIAN_TTS_EMOTION_INVALID", 400);
  }
  if (rate < 0.5 || rate > 2) {
    throw new ProviderError("语速须在 0.5–2.0 之间", "BAILIAN_TTS_RATE_INVALID", 400);
  }
  if (!Number.isInteger(volume) || volume < 0 || volume > 100) {
    throw new ProviderError("音量须为 0–100 的整数", "BAILIAN_TTS_VOLUME_INVALID", 400);
  }

  return {
    model: MODEL,
    input: {
      text: `${emotion.tag}${text}`,
      voice,
      instruction: emotion.instruction,
      format: "mp3",
      sample_rate: 24000,
      rate,
      volume,
    },
  };
}

function credentials(value: unknown): { apiKey: string; baseUrl: string; signal?: AbortSignal } {
  const record = isRecord(value) ? value : undefined;
  const apiKey = stringValue(record?.apiKey)
    || process.env.DASHSCOPE_API_KEY?.trim()
    || process.env.BAILIAN_API_KEY?.trim()
    || process.env.ALIBABA_CLOUD_API_KEY?.trim()
    || "";
  const workspaceId = process.env.DASHSCOPE_WORKSPACE_ID?.trim() || process.env.BAILIAN_WORKSPACE_ID?.trim();
  const baseUrl = stringValue(record?.baseUrl)
    || process.env.DASHSCOPE_TTS_BASE_URL?.trim()
    || (workspaceId ? `https://${workspaceId}.cn-beijing.maas.aliyuncs.com` : "")
    || process.env.DASHSCOPE_BASE_URL?.trim()
    || DEFAULT_BASE;
  const signal = record?.signal instanceof AbortSignal ? record.signal : undefined;
  if (!apiKey) {
    throw new ProviderError(
      "未配置百炼 API Key（请设置 DASHSCOPE_API_KEY 或 BAILIAN_API_KEY）",
      "BAILIAN_TTS_MISSING_API_KEY",
      401,
    );
  }
  return { apiKey, baseUrl: baseUrl.replace(/\/+$/, ""), signal };
}

function responseMessage(raw: unknown, fallback: string): string {
  if (!isRecord(raw)) return fallback;
  const output = isRecord(raw.output) ? raw.output : undefined;
  return stringValue(raw.message) || stringValue(raw.msg) || stringValue(output?.message) || fallback;
}

function audioUrl(raw: unknown): string | undefined {
  if (!isRecord(raw) || !isRecord(raw.output) || !isRecord(raw.output.audio)) return undefined;
  const url = stringValue(raw.output.audio.url);
  return /^https?:\/\//i.test(url) ? url : undefined;
}

function usageCharacters(raw: unknown): number | undefined {
  if (!isRecord(raw) || !isRecord(raw.usage)) return undefined;
  const value = raw.usage.characters;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export class BailianEmotionalTtsAdapter implements IProviderAdapter {
  constructor(
    private readonly dependencies: EmotionalTtsDependencies = { persistOutput: persistRemoteMediaToOss },
  ) {}

  calculateCost(payload: StandardPayload): ProviderCostResult {
    const body = buildBailianEmotionalTtsRequest(payload);
    const credits = creditsForCharacters(body.input.text.length);
    return { cost: credits, sellPrice: credits };
  }

  async generate(payload: StandardPayload, rawCredentials: unknown): Promise<ProviderResponse> {
    const body = buildBailianEmotionalTtsRequest(payload);
    const { apiKey, baseUrl, signal } = credentials(rawCredentials);
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${SYNTHESIS_PATH}`, {
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
        error instanceof Error ? error.message : "情绪化配音服务网络异常",
        "BAILIAN_TTS_NETWORK",
        502,
        error,
      );
    }

    const raw: unknown = await response.json().catch(() => ({ httpStatus: response.status }));
    const code = isRecord(raw) ? raw.code : undefined;
    if (!response.ok || (typeof code === "string" && code !== "" && code !== "0")) {
      throw new ProviderError(
        responseMessage(raw, `情绪化配音请求失败（HTTP ${response.status}）`),
        "BAILIAN_TTS_UPSTREAM",
        response.status >= 500 ? 502 : 400,
        raw,
      );
    }

    const temporaryUrl = audioUrl(raw);
    if (!temporaryUrl) {
      throw new ProviderError("配音成功但未解析到音频地址", "BAILIAN_TTS_MISSING_RESULT", 502, raw);
    }
    const taskId = `tts_${randomUUID().replace(/-/g, "")}`;
    const resultUrl = await this.dependencies.persistOutput({
      url: temporaryUrl,
      key: `emotional-tts/${taskId}.mp3`,
      fallbackContentType: "audio/mpeg",
    });
    const providerCost = creditsForCharacters(usageCharacters(raw) ?? body.input.text.length);
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
    if (!record) return { status: "failed", errorMessage: "情绪化配音任务记录不存在" };
    if (record.status === GenerationHistoryStatus.SUCCESS && record.resultUrl) {
      return {
        status: "succeeded",
        resultUrl: record.resultUrl,
        resultMediaType: "audio",
        providerCost: record.cost,
      };
    }
    if (record.status === GenerationHistoryStatus.FAILED) {
      return { status: "failed", errorMessage: record.errorMessage || "情绪化配音失败" };
    }
    return { status: "running", progress: 90 };
  }
}
