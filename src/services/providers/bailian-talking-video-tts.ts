import { randomUUID } from "node:crypto";
import { probeRemoteMediaDurationSeconds } from "@/services/media/remote-media-duration";
import { persistRemoteMediaToOss } from "@/services/video-orchestrator/oss-media";
import { estimateTalkingVideoSpeechDuration } from "@/lib/talking-video-speech-duration";
import { exceedsMediaDurationMaximum } from "@/lib/media-duration-boundary";
import type { StandardPayload } from "./types";
import { ProviderError } from "./types";
import {
  buildTalkingVideoTtsRequest,
  resolveTalkingVideoPerformanceMode,
  talkingVideoMaxAudioDurationSeconds,
  talkingVideoTtsCreditsForCharacters,
  type TalkingVideoSpeechResult,
} from "./bailian-talking-video-input";

const DEFAULT_BASE = "https://dashscope.aliyuncs.com";
const SYNTHESIS_PATH = "/api/v1/services/aigc/multimodal-generation/generation";

interface TalkingVideoTtsDependencies {
  fetchImpl?: typeof fetch;
  persistOutput?: typeof persistRemoteMediaToOss;
  probeDuration?: typeof probeRemoteMediaDurationSeconds;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function synthesizeTalkingVideoSpeech(
  payload: StandardPayload,
  rawCredentials: unknown,
  dependencies: TalkingVideoTtsDependencies = {},
): Promise<TalkingVideoSpeechResult> {
  const request = buildTalkingVideoTtsRequest(payload);
  const { apiKey, baseUrl, signal } = credentials(rawCredentials);
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const persistOutput = dependencies.persistOutput ?? persistRemoteMediaToOss;
  const probeDuration = dependencies.probeDuration ?? probeRemoteMediaDurationSeconds;
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}${SYNTHESIS_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(request),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    throw new ProviderError(
      error instanceof Error ? error.message : "阿里云口播语音合成网络异常",
      "BAILIAN_S2V_TTS_NETWORK",
      502,
      error,
    );
  }

  const raw: unknown = await response.json().catch(() => ({ httpStatus: response.status }));
  const code = isRecord(raw) ? raw.code : undefined;
  if (!response.ok || (typeof code === "string" && code !== "" && code !== "0")) {
    throw new ProviderError(
      responseMessage(raw, `阿里云口播语音合成失败（HTTP ${response.status}）`),
      "BAILIAN_S2V_TTS_UPSTREAM",
      response.status >= 500 ? 502 : 400,
      raw,
    );
  }

  const temporaryUrl = responseAudioUrl(raw);
  if (!temporaryUrl) {
    throw new ProviderError("阿里云已完成语音合成，但没有返回音频地址", "BAILIAN_S2V_TTS_MISSING_RESULT", 502, raw);
  }
  let durationSeconds: number;
  try {
    durationSeconds = await probeDuration(temporaryUrl);
  } catch (error) {
    throw new ProviderError(
      error instanceof Error ? error.message : "无法读取生成语音的时长",
      "BAILIAN_S2V_TTS_DURATION_PROBE_FAILED",
      502,
      error,
    );
  }
  const maxDurationSeconds = talkingVideoMaxAudioDurationSeconds(payload);
  const performanceMode = resolveTalkingVideoPerformanceMode(payload);
  const exceedsLimit = exceedsMediaDurationMaximum(
    durationSeconds,
    maxDurationSeconds,
    performanceMode !== "prompted",
  );
  if (exceedsLimit) {
    const estimate = estimateTalkingVideoSpeechDuration(request.input.text);
    const looksEnglish = request.input.language_type === "English"
      || (estimate.englishWords > 0 && estimate.cjkCharacters === 0);
    const inputSummary = looksEnglish
      ? `${estimate.englishWords} 个英文单词`
      : `${Array.from(request.input.text).length} 个字符`;
    const textPreview = request.input.text.length > 36
      ? `${request.input.text.slice(0, 36)}...`
      : request.input.text;
    throw new ProviderError(
      maxDurationSeconds === 20
        ? `生成语音为 ${durationSeconds.toFixed(1)} 秒（本次实际处理 ${inputSummary}，开头：“${textPreview}”），超过有声视频要求的 20 秒限制，请缩短口播文字`
        : `生成语音为 ${durationSeconds.toFixed(1)} 秒（本次实际处理 ${inputSummary}，开头：“${textPreview}”），超过当前动作模式的 ${maxDurationSeconds} 秒限制，请缩短口播文字`,
      "BAILIAN_S2V_TTS_TOO_LONG",
      400,
      {
        durationSeconds,
        maxDurationSeconds,
        englishWords: estimate.englishWords,
        cjkCharacters: estimate.cjkCharacters,
        textPreview,
      },
    );
  }

  const id = randomUUID().replace(/-/g, "");
  const audioUrl = await persistOutput({
    url: temporaryUrl,
    key: `talking-video-tts/${id}.wav`,
    fallbackContentType: "audio/wav",
  });
  const characters = usageCharacters(raw) ?? request.input.text.length;
  return {
    audioUrl,
    durationSeconds,
    providerCost: talkingVideoTtsCreditsForCharacters(characters),
    voice: request.input.voice,
  };
}

function credentials(value: unknown): { apiKey: string; baseUrl: string; signal?: AbortSignal } {
  const record = isRecord(value) ? value : undefined;
  const apiKey = readString(record?.apiKey)
    || process.env.DASHSCOPE_API_KEY?.trim()
    || process.env.BAILIAN_API_KEY?.trim()
    || process.env.ALIBABA_CLOUD_API_KEY?.trim()
    || "";
  const baseUrl = readString(record?.baseUrl)
    || process.env.DASHSCOPE_BASE_URL?.trim()
    || DEFAULT_BASE;
  const signal = record?.signal instanceof AbortSignal ? record.signal : undefined;
  if (!apiKey) {
    throw new ProviderError(
      "未配置阿里云百炼 API Key（请设置 DASHSCOPE_API_KEY 或 BAILIAN_API_KEY）",
      "BAILIAN_S2V_TTS_MISSING_API_KEY",
      401,
    );
  }
  return { apiKey, baseUrl: baseUrl.replace(/\/+$/, ""), signal };
}

function responseAudioUrl(raw: unknown): string | undefined {
  if (!isRecord(raw) || !isRecord(raw.output) || !isRecord(raw.output.audio)) return undefined;
  const url = readString(raw.output.audio.url);
  return /^https?:\/\//i.test(url) ? url : undefined;
}

function responseMessage(raw: unknown, fallback: string): string {
  if (!isRecord(raw)) return fallback;
  return readString(raw.message) || readString(raw.code) || fallback;
}

function usageCharacters(raw: unknown): number | undefined {
  if (!isRecord(raw) || !isRecord(raw.usage)) return undefined;
  const value = raw.usage.characters;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
