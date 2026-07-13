import type { MotionData, VideoDraftItem } from "@workbench/lib/video-workflow";

export const DEFAULT_CHARACTER_LOCK_PROMPT =
  "Keep the same character identity, facial features, outfit, and color palette as the first frame.";
export const DEFAULT_QUALITY_THRESHOLD = 75;
export const DEFAULT_PRESET_ORDER = ["reward", "emotion", "notify", "custom"] as const;

const FEEDBACK_STORAGE_KEY = "workbench_video_feedback_v1";

export type PresetFeedbackRating = "good" | "bad";

export interface PresetFeedbackEntry {
  presetId: string;
  good: number;
  bad: number;
  totalScore: number;
  samples: number;
  updatedAt: string;
}

export interface PromptBuildOptions {
  emotion?: string;
  prompt?: string;
  variable?: string;
  consistencyLockEnabled?: boolean;
  consistencyLockPrompt?: string;
}

export interface QualityJudgeOptions {
  targetDuration?: number;
  threshold?: number;
}

export interface DraftQualityResult {
  score: number;
  grade: "A" | "B" | "C" | "D";
  reasons: string[];
  pass: boolean;
}

export interface SubtitleSegment {
  start: number;
  end: number;
  text: string;
}

function stableHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function safeParseJson<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function parseBatchVariables(raw?: string, maxItems = 12): string[] {
  if (!raw) return [];
  const lines = raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  return Array.from(new Set(lines)).slice(0, maxItems);
}

export function buildVideoPrompt(options: PromptBuildOptions): string {
  const parts: string[] = [];
  if (options.emotion) {
    parts.push(`The character feels ${options.emotion}.`);
  }
  parts.push((options.prompt || "moving naturally").trim());
  if (options.variable) {
    parts.push(`Variable focus: ${options.variable.trim()}.`);
  }
  if (options.consistencyLockEnabled) {
    parts.push((options.consistencyLockPrompt || DEFAULT_CHARACTER_LOCK_PROMPT).trim());
  }
  return parts.filter(Boolean).join(" ").trim();
}

export function createAutoSubtitle(prompt?: string, motionData?: MotionData): string {
  const motionSummary = (motionData?.motion_sequence ?? []).slice(0, 2).join(" -> ");
  const base = (prompt || "").trim();
  if (!base && !motionSummary) return "精彩瞬间，持续高能";

  const composed = [base, motionSummary ? `动作: ${motionSummary}` : ""].filter(Boolean).join(" · ");
  return composed.slice(0, 64);
}

export function splitSubtitleLines(text: string, maxChars = 14): string[] {
  const normalized = String(text || "")
    .replace(/\s+/g, " ")
    .replace(/[，。！？；]/g, (match) => `${match}\n`)
    .replace(/[,.!?;]/g, (match) => `${match}\n`)
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const lines: string[] = [];
  for (const piece of normalized) {
    if (piece.length <= maxChars) {
      lines.push(piece);
      continue;
    }
    let cursor = 0;
    while (cursor < piece.length) {
      lines.push(piece.slice(cursor, cursor + maxChars));
      cursor += maxChars;
    }
  }
  return lines.slice(0, 10);
}

export function buildSubtitleSegments(
  text: string,
  duration = 5,
  maxChars = 14,
): SubtitleSegment[] {
  const lines = splitSubtitleLines(text, maxChars);
  if (!lines.length || duration <= 0) return [];
  const slot = duration / lines.length;
  return lines.map((line, index) => ({
    start: Number((index * slot).toFixed(2)),
    end: Number(Math.min(duration, (index + 1) * slot).toFixed(2)),
    text: line,
  }));
}

export function applyModelQualityResults(
  drafts: VideoDraftItem[],
  modelScores: Array<{
    draftId: string;
    score: number;
    grade: "A" | "B" | "C" | "D";
    reasons?: string[];
    suggestions?: string[];
    dimensions?: {
      consistency: number;
      motion: number;
      visual: number;
      textClean: number;
    };
  }>,
): VideoDraftItem[] {
  if (!modelScores.length) return drafts;
  const map = new Map(modelScores.map((item) => [item.draftId, item]));
  return drafts.map((draft) => {
    const scoreItem = map.get(draft.id);
    if (!scoreItem) return draft;
    return {
      ...draft,
      qualityScore: scoreItem.score,
      qualityGrade: scoreItem.grade,
      qualityReasons: scoreItem.reasons ?? draft.qualityReasons,
      qualitySuggestions: scoreItem.suggestions ?? draft.qualitySuggestions,
      qualityDimensions: scoreItem.dimensions ?? draft.qualityDimensions,
      qualityModelSource: "model",
    };
  });
}

export function chooseAutoCoverUrl(
  originalFinalUrl?: string,
  originalThumbUrl?: string,
  firstFrameUrl?: string,
): string | undefined {
  return originalThumbUrl || firstFrameUrl || originalFinalUrl;
}

export function judgeDraftQuality(draft: VideoDraftItem, options: QualityJudgeOptions = {}): DraftQualityResult {
  const threshold = options.threshold ?? DEFAULT_QUALITY_THRESHOLD;
  const targetDuration = options.targetDuration ?? 5;
  if (draft.status === "failed") {
    return {
      score: 10,
      grade: "D",
      reasons: ["生成失败"],
      pass: false,
    };
  }

  let score = 45;
  const reasons: string[] = [];

  if (draft.status === "done" || draft.status === "selected") {
    score += 20;
    reasons.push("已完成");
  }
  if (draft.video_url) {
    score += 15;
    reasons.push("可播放");
  } else {
    score -= 12;
    reasons.push("无可播放视频");
  }
  if (draft.thumbnail_url) {
    score += 8;
    reasons.push("有缩略图");
  }
  if (typeof draft.duration_seconds === "number") {
    const delta = Math.abs(draft.duration_seconds - targetDuration);
    if (delta <= 1) {
      score += 8;
      reasons.push("时长匹配");
    } else if (delta <= 3) {
      score += 3;
      reasons.push("时长基本可用");
    } else {
      score -= 6;
      reasons.push("时长偏差较大");
    }
  }

  // 给相同状态的视频一个稳定且可复现的细微区分
  const microJitter = (stableHash(`${draft.id}:${draft.model}:${draft.status}`) % 9) - 4;
  score += microJitter;
  score = clamp(Math.round(score), 0, 100);

  let grade: DraftQualityResult["grade"] = "D";
  if (score >= 88) grade = "A";
  else if (score >= 76) grade = "B";
  else if (score >= 60) grade = "C";

  return { score, grade, reasons, pass: score >= threshold };
}

export function withDraftQuality(
  drafts: VideoDraftItem[],
  options: QualityJudgeOptions = {},
): VideoDraftItem[] {
  return drafts.map((draft) => {
    const judged = judgeDraftQuality(draft, options);
    return {
      ...draft,
      qualityScore: judged.score,
      qualityGrade: judged.grade,
      qualityReasons: judged.reasons,
      qualityModelSource: "heuristic",
    };
  });
}

export function pickBestDraftByQuality(
  drafts: VideoDraftItem[],
  options: QualityJudgeOptions = {},
): VideoDraftItem | undefined {
  const scored = withDraftQuality(drafts, options).filter((item) => item.status === "done" && item.video_url);
  if (!scored.length) return undefined;
  return scored.sort((a, b) => {
    const scoreGap = (b.qualityScore ?? 0) - (a.qualityScore ?? 0);
    if (scoreGap !== 0) return scoreGap;
    return a.id > b.id ? -1 : 1;
  })[0];
}

export function readPresetFeedback(): PresetFeedbackEntry[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(FEEDBACK_STORAGE_KEY);
  const parsed = safeParseJson<PresetFeedbackEntry[]>(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}

function writePresetFeedback(entries: PresetFeedbackEntry[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(entries));
}

export function recordPresetFeedback(
  presetId: string,
  rating: PresetFeedbackRating,
  qualityScore?: number,
): PresetFeedbackEntry[] {
  const entries = readPresetFeedback();
  const now = new Date().toISOString();
  const current =
    entries.find((entry) => entry.presetId === presetId) ??
    ({
      presetId,
      good: 0,
      bad: 0,
      totalScore: 0,
      samples: 0,
      updatedAt: now,
    } as PresetFeedbackEntry);

  if (rating === "good") current.good += 1;
  else current.bad += 1;

  if (typeof qualityScore === "number") {
    current.totalScore += qualityScore;
    current.samples += 1;
  }
  current.updatedAt = now;

  const next = [...entries.filter((entry) => entry.presetId !== presetId), current];
  writePresetFeedback(next);
  return next;
}

export function getPresetOrderByFeedback(
  entries: PresetFeedbackEntry[],
  defaultOrder: string[] = [...DEFAULT_PRESET_ORDER],
): string[] {
  if (!entries.length) return defaultOrder;
  const weights = new Map(
    entries.map((entry) => {
      const totalVotes = entry.good + entry.bad;
      const winRate = totalVotes > 0 ? entry.good / totalVotes : 0;
      const avgScore = entry.samples > 0 ? entry.totalScore / entry.samples : 70;
      const confidence = Math.min(totalVotes, 20) / 20;
      const weight = winRate * 70 + avgScore * 0.3 + confidence * 10;
      return [entry.presetId, weight];
    }),
  );

  return [...defaultOrder].sort((a, b) => (weights.get(b) ?? -1) - (weights.get(a) ?? -1));
}

export function getPresetStats(entries: PresetFeedbackEntry[]): Record<string, { winRate: number; samples: number }> {
  return entries.reduce(
    (acc, entry) => {
      const totalVotes = entry.good + entry.bad;
      acc[entry.presetId] = {
        winRate: totalVotes > 0 ? Number(((entry.good / totalVotes) * 100).toFixed(0)) : 0,
        samples: totalVotes,
      };
      return acc;
    },
    {} as Record<string, { winRate: number; samples: number }>,
  );
}
