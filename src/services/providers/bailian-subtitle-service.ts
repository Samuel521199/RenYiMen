import { ProviderError } from "./types";

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com";
const DEFAULT_MODEL = "qwen3-asr-flash-filetrans";
const POLL_INTERVAL_MS = 1_200;
const TRANSCRIPTION_TIMEOUT_MS = 120_000;

export interface TimedSubtitleCue {
  startMs: number;
  endMs: number;
  text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requireDashScopeConfig(): { apiKey: string; baseUrl: string; model: string } {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim()
    || process.env.BAILIAN_API_KEY?.trim()
    || process.env.ALIBABA_CLOUD_API_KEY?.trim();
  if (!apiKey) {
    throw new ProviderError(
      "字幕识别服务未配置，请设置 DASHSCOPE_API_KEY 或 BAILIAN_API_KEY",
      "SUBTITLE_ASR_MISSING_API_KEY",
      503,
    );
  }
  return {
    apiKey,
    baseUrl: (process.env.DASHSCOPE_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model: process.env.BAILIAN_SUBTITLE_ASR_MODEL?.trim() || DEFAULT_MODEL,
  };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorMessage(raw: unknown, fallback: string): string {
  if (!isRecord(raw)) return fallback;
  const output = isRecord(raw.output) ? raw.output : undefined;
  return readString(raw, "message") || readString(output, "message") || fallback;
}

function taskStatus(raw: unknown): string {
  if (!isRecord(raw)) return "";
  const output = isRecord(raw.output) ? raw.output : undefined;
  return (readString(output, "task_status") || readString(raw, "task_status") || "").toUpperCase();
}

function taskIdFrom(raw: unknown): string | undefined {
  if (!isRecord(raw)) return undefined;
  const output = isRecord(raw.output) ? raw.output : undefined;
  return readString(output, "task_id") || readString(raw, "task_id");
}

function transcriptionUrlFrom(raw: unknown): string | undefined {
  if (!isRecord(raw)) return undefined;
  const output = isRecord(raw.output) ? raw.output : undefined;
  const result = output && isRecord(output.result) ? output.result : undefined;
  return readString(result, "transcription_url") || readString(output, "transcription_url");
}

function finiteTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

/** Parse the official Qwen file-transcription JSON into subtitle-ready sentence cues. */
export function parseTimedSubtitleCues(raw: unknown): TimedSubtitleCue[] {
  if (!isRecord(raw) || !Array.isArray(raw.transcripts)) return [];
  const cues: TimedSubtitleCue[] = [];
  for (const transcript of raw.transcripts) {
    if (!isRecord(transcript) || !Array.isArray(transcript.sentences)) continue;
    for (const sentence of transcript.sentences) {
      if (!isRecord(sentence)) continue;
      const startMs = finiteTimestamp(sentence.begin_time);
      const endMs = finiteTimestamp(sentence.end_time);
      const text = readString(sentence, "text");
      if (startMs === undefined || endMs === undefined || endMs <= startMs || !text) continue;
      cues.push({ startMs, endMs, text });
    }
  }
  return cues.sort((a, b) => a.startMs - b.startMs);
}

export async function transcribeAudioForSubtitles(audioUrl: string): Promise<TimedSubtitleCue[]> {
  const { apiKey, baseUrl, model } = requireDashScopeConfig();
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  const submitted = await fetch(`${baseUrl}/api/v1/services/audio/asr/transcription`, {
    method: "POST",
    headers: { ...headers, "X-DashScope-Async": "enable" },
    body: JSON.stringify({
      model,
      input: { file_url: audioUrl },
      parameters: { channel_id: [0], enable_itn: true, enable_words: true },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const submittedJson = await readJsonResponse(submitted);
  if (!submitted.ok) {
    throw new ProviderError(errorMessage(submittedJson, `字幕识别提单失败（HTTP ${submitted.status}）`), "SUBTITLE_ASR_SUBMIT_FAILED", 502, submittedJson);
  }
  const taskId = taskIdFrom(submittedJson);
  if (!taskId) throw new ProviderError("字幕识别服务未返回任务 ID", "SUBTITLE_ASR_BAD_RESPONSE", 502, submittedJson);

  const deadline = Date.now() + TRANSCRIPTION_TIMEOUT_MS;
  let completed: unknown = null;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const response = await fetch(`${baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    completed = await readJsonResponse(response);
    if (!response.ok) {
      throw new ProviderError(errorMessage(completed, `字幕识别查询失败（HTTP ${response.status}）`), "SUBTITLE_ASR_QUERY_FAILED", 502, completed);
    }
    const status = taskStatus(completed);
    if (status === "SUCCEEDED") break;
    if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
      throw new ProviderError(errorMessage(completed, "字幕识别失败"), "SUBTITLE_ASR_FAILED", 502, completed);
    }
  }
  if (taskStatus(completed) !== "SUCCEEDED") {
    throw new ProviderError("字幕识别等待超时，请稍后重试", "SUBTITLE_ASR_TIMEOUT", 504);
  }
  const transcriptionUrl = transcriptionUrlFrom(completed);
  if (!transcriptionUrl) {
    throw new ProviderError("字幕识别结果缺少下载地址", "SUBTITLE_ASR_BAD_RESULT", 502, completed);
  }
  const resultResponse = await fetch(transcriptionUrl, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  const resultJson = await readJsonResponse(resultResponse);
  if (!resultResponse.ok) {
    throw new ProviderError(`字幕识别结果下载失败（HTTP ${resultResponse.status}）`, "SUBTITLE_ASR_RESULT_DOWNLOAD_FAILED", 502);
  }
  const cues = parseTimedSubtitleCues(resultJson);
  if (cues.length === 0) {
    throw new ProviderError("没有识别到可用的人声内容", "SUBTITLE_ASR_EMPTY", 422, resultJson);
  }
  return cues;
}
