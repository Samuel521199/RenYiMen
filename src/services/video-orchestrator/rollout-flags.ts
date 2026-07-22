export const ONE_PROMPT_ROLLOUT_FLAG_NAMES = [
  "ONE_PROMPT_REFERENCE_SELECTOR_V2",
  "ONE_PROMPT_THREE_VIEW_DERIVATION",
  "ONE_PROMPT_STRICT_VALIDATION",
  "ONE_PROMPT_VISUAL_QUALITY_EVAL",
  "ONE_PROMPT_TRANSITION_REFERENCE",
  "ONE_PROMPT_UNIFIED_AUDIO_MIX",
  "ONE_PROMPT_ARTIFACT_GRAPH_V2",
] as const;

export type OnePromptRolloutFlagName = typeof ONE_PROMPT_ROLLOUT_FLAG_NAMES[number];
export type OnePromptRolloutFlags = Record<OnePromptRolloutFlagName, boolean>;
type EnvLike = Record<string, string | undefined>;

export interface OnePromptRolloutSnapshot {
  version: "phase9-v1";
  cohort: string;
  capturedAt: string;
  flags: OnePromptRolloutFlags;
}

export function onePromptRolloutEnabled(name: OnePromptRolloutFlagName, env: EnvLike = process.env): boolean {
  return parseBoolean(env[name], true);
}

export function readOnePromptRolloutFlags(env: EnvLike = process.env): OnePromptRolloutFlags {
  return Object.fromEntries(ONE_PROMPT_ROLLOUT_FLAG_NAMES.map((name) => [name, onePromptRolloutEnabled(name, env)])) as OnePromptRolloutFlags;
}

export function createOnePromptRolloutSnapshot(env: EnvLike = process.env, now = new Date()): OnePromptRolloutSnapshot {
  return {
    version: "phase9-v1",
    cohort: env.ONE_PROMPT_ROLLOUT_COHORT?.trim() || "internal",
    capturedAt: now.toISOString(),
    flags: readOnePromptRolloutFlags(env),
  };
}

export function legacyReferenceSelection<T extends { hardRequired?: boolean; url?: string }>(candidates: T[], limit = 4): { selected: T[]; candidates: Array<T & { selected: boolean; rejectionReason?: string }> } {
  const selected = [...candidates.filter((candidate) => candidate.hardRequired), ...candidates.filter((candidate) => !candidate.hardRequired)]
    .filter((candidate, index, values) => Boolean(candidate.url) && values.findIndex((item) => item.url === candidate.url) === index)
    .slice(0, limit);
  const selectedSet = new Set(selected);
  return {
    selected,
    candidates: candidates.map((candidate) => ({
      ...candidate,
      selected: selectedSet.has(candidate),
      rejectionReason: selectedSet.has(candidate) ? undefined : "Legacy selector limit reached while Reference Selector V2 is disabled.",
    })),
  };
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null || !value.trim()) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["false", "0", "off", "no", "disabled"].includes(normalized)) return false;
  if (["true", "1", "on", "yes", "enabled"].includes(normalized)) return true;
  return fallback;
}
