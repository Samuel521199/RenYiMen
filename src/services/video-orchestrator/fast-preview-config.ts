export type FastPreviewEnv = Record<string, string | undefined>;

export interface OnePromptVideoFastPreviewConfig {
  enabled: boolean;
  requested: boolean;
  environment: string;
  reason: "enabled" | "disabled" | "production_blocked";
}

function isEnabledValue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

/**
 * Fast preview deliberately bypasses model-based visual scoring and manual
 * review gates. It must never be possible to activate it in production with a
 * single misplaced environment variable.
 */
export function readOnePromptVideoFastPreviewConfig(
  env: FastPreviewEnv = process.env,
): OnePromptVideoFastPreviewConfig {
  const requested = isEnabledValue(env.ONE_PROMPT_VIDEO_FAST_PREVIEW);
  const environment = env.NODE_ENV?.trim().toLowerCase() || "development";
  const productionBlocked = requested && environment === "production";
  return {
    enabled: requested && !productionBlocked,
    requested,
    environment,
    reason: productionBlocked
      ? "production_blocked"
      : requested
        ? "enabled"
        : "disabled",
  };
}

export function isOnePromptVideoFastPreviewEnabled(
  env: FastPreviewEnv = process.env,
): boolean {
  return readOnePromptVideoFastPreviewConfig(env).enabled;
}
