export type OnePromptVideoStoryGateMode = "off" | "warn" | "strict";
export type OnePromptVideoShotGroupingMode = "off" | "on";

export interface OnePromptVideoStoryRolloutConfig {
  storyGateMode: OnePromptVideoStoryGateMode;
  storyRewriteMax: 0 | 1 | 2;
  shotGroupingMode: OnePromptVideoShotGroupingMode;
}

const DEFAULT_STORY_GATE_MODE: OnePromptVideoStoryGateMode = "off";
const DEFAULT_STORY_REWRITE_MAX: 0 | 1 | 2 = 0;
const DEFAULT_SHOT_GROUPING_MODE: OnePromptVideoShotGroupingMode = "on";

type EnvLike = Record<string, string | undefined>;

function readString(env: EnvLike, name: string): string {
  return (env[name] ?? "").trim().toLowerCase();
}

function readStoryGateMode(env: EnvLike): OnePromptVideoStoryGateMode {
  const raw = readString(env, "ONE_PROMPT_VIDEO_STORY_GATE");
  if (raw === "off" || raw === "warn" || raw === "strict") return raw;
  return DEFAULT_STORY_GATE_MODE;
}

function readStoryRewriteMax(env: EnvLike): 0 | 1 | 2 {
  const raw = readString(env, "ONE_PROMPT_VIDEO_STORY_REWRITE_MAX");
  if (raw === "1") return 1;
  if (raw === "2") return 2;
  if (raw === "0") return 0;
  return DEFAULT_STORY_REWRITE_MAX;
}

function readShotGroupingMode(env: EnvLike): OnePromptVideoShotGroupingMode {
  const raw = readString(env, "ONE_PROMPT_VIDEO_SHOT_GROUPING");
  if (raw === "off" || raw === "on") return raw;
  return DEFAULT_SHOT_GROUPING_MODE;
}

export function readStoryRolloutConfig(env: EnvLike = process.env): OnePromptVideoStoryRolloutConfig {
  return {
    storyGateMode: readStoryGateMode(env),
    storyRewriteMax: readStoryRewriteMax(env),
    shotGroupingMode: readShotGroupingMode(env),
  };
}

export function shouldEvaluateStoryQuality(config: OnePromptVideoStoryRolloutConfig): boolean {
  return config.storyGateMode !== "off";
}

export function shouldAttemptStoryRewrite(config: OnePromptVideoStoryRolloutConfig): boolean {
  return shouldEvaluateStoryQuality(config) && config.storyRewriteMax > 0;
}

export function shouldRequireStoryQualityReview(config: OnePromptVideoStoryRolloutConfig): boolean {
  return config.storyGateMode === "strict";
}

export function shouldEnableShotGrouping(config: OnePromptVideoStoryRolloutConfig): boolean {
  return config.shotGroupingMode === "on";
}
