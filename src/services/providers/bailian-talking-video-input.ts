import type { StandardPayload } from "./types";
import { ProviderError } from "./types";

const MODEL = "qwen3-tts-instruct-flash";
const CREDITS_PER_CHARACTER = 0.02;

export const TALKING_VIDEO_VOICES = [
  "Cherry",
  "Ethan",
  "Bunny",
  "Pip",
  "Eldric Sage",
  "Katerina",
  "Neil",
  "Ryan",
] as const;

const VOICES = new Set<string>(TALKING_VIDEO_VOICES);
const LANGUAGE_TYPES = new Set(["Auto", "Chinese", "English"]);
const STYLE_INSTRUCTIONS: Record<string, string> = {
  natural: "",
  cheerful: "语气自然愉快，富有亲和力，吐字清晰。",
  calm: "语气平静沉稳，节奏从容，吐字清晰。",
  solemn: "语气庄重可信，表达克制，吐字清晰。",
  excited: "语气兴奋有活力，富有感染力，同时保持吐字清晰。",
};

export type TalkingVideoPerformanceMode = "natural" | "prompted" | "precise";

export function isTalkingVideoPayload(payload: StandardPayload): boolean {
  return payload.templateId.trim().toLowerCase() === "bailian-wan2.2-s2v";
}

export function resolveTalkingVideoPerformanceMode(
  payload: StandardPayload,
): TalkingVideoPerformanceMode {
  const mode = readString(inputNode(payload).performance_mode).toLowerCase();
  if (mode === "prompted" || mode === "precise") return mode;
  return "natural";
}

export function talkingVideoMaxAudioDurationSeconds(payload: StandardPayload): number {
  const mode = resolveTalkingVideoPerformanceMode(payload);
  return mode === "prompted" ? 15 : mode === "precise" ? 120 : 20;
}

export interface TalkingVideoTtsRequest {
  model: typeof MODEL;
  input: {
    text: string;
    voice: string;
    language_type: string;
    instructions?: string;
    optimize_instructions?: true;
  };
}

export interface TalkingVideoSpeechResult {
  audioUrl: string;
  durationSeconds: number;
  providerCost: number;
  voice: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function inputNode(payload: StandardPayload): Record<string, unknown> {
  return isRecord(payload.nodeInputs.input) ? payload.nodeInputs.input : {};
}

export function isTalkingVideoTextMode(payload: StandardPayload): boolean {
  return readString(inputNode(payload).audio_input_mode).toLowerCase() === "text";
}

export function isTalkingVideoVideoMode(payload: StandardPayload): boolean {
  return readString(inputNode(payload).audio_input_mode).toLowerCase() === "video";
}

export function buildTalkingVideoTtsRequest(payload: StandardPayload): TalkingVideoTtsRequest {
  const input = inputNode(payload);
  const text = readString(input.speech_text);
  const voice = readString(input.tts_voice) || "Cherry";
  const languageType = readString(input.tts_language) || "Auto";
  const style = readString(input.tts_style) || "natural";
  const instructions = STYLE_INSTRUCTIONS[style];

  if (!text || text.length > 600) {
    throw new ProviderError("口播文字长度须为 1–600 个字符", "BAILIAN_S2V_TTS_TEXT_INVALID", 400);
  }
  if (!VOICES.has(voice)) {
    throw new ProviderError("不支持的阿里云预置音色", "BAILIAN_S2V_TTS_VOICE_INVALID", 400);
  }
  if (!LANGUAGE_TYPES.has(languageType)) {
    throw new ProviderError("不支持的口播语言", "BAILIAN_S2V_TTS_LANGUAGE_INVALID", 400);
  }
  if (instructions == null) {
    throw new ProviderError("不支持的口播风格", "BAILIAN_S2V_TTS_STYLE_INVALID", 400);
  }

  return {
    model: MODEL,
    input: {
      text,
      voice,
      language_type: languageType,
      ...(instructions ? { instructions, optimize_instructions: true as const } : {}),
    },
  };
}

export function estimateTalkingVideoTtsCredits(payload: StandardPayload): number {
  return creditsForCharacters(buildTalkingVideoTtsRequest(payload).input.text.length);
}

export function applyTalkingVideoSpeech(
  payload: StandardPayload,
  speech: Pick<TalkingVideoSpeechResult, "audioUrl" | "durationSeconds">,
): StandardPayload {
  return {
    ...payload,
    nodeInputs: {
      ...payload.nodeInputs,
      input: {
        ...inputNode(payload),
        audio_url: speech.audioUrl,
        duration: speech.durationSeconds,
      },
    },
  };
}

export function talkingVideoTtsCreditsForCharacters(characters: number): number {
  return creditsForCharacters(characters);
}

function creditsForCharacters(characters: number): number {
  return Math.max(1, Math.ceil(Math.max(0, characters) * CREDITS_PER_CHARACTER));
}
