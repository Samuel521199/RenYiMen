import { isOnePromptVideoFastPreviewEnabled } from "./fast-preview-config";

export type ScriptQaEnv = Record<string, string | undefined>;

export interface OnePromptVideoScriptQaConfig {
  enabled: boolean;
  requested: boolean;
  disabledByFastPreview: boolean;
}

function isEnabledValue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

/**
 * Optional, model-call-heavy script QA is opt-in. Structural validation (JSON,
 * required fields, durations, references and provider request contracts) does
 * not use this switch and remains fail-closed.
 */
export function readOnePromptVideoScriptQaConfig(
  env: ScriptQaEnv = process.env,
): OnePromptVideoScriptQaConfig {
  const requested = isEnabledValue(env.ONE_PROMPT_VIDEO_SCRIPT_QA);
  const disabledByFastPreview = isOnePromptVideoFastPreviewEnabled(env);
  return {
    enabled: requested && !disabledByFastPreview,
    requested,
    disabledByFastPreview,
  };
}

export function isOnePromptVideoScriptQaEnabled(
  env: ScriptQaEnv = process.env,
): boolean {
  return readOnePromptVideoScriptQaConfig(env).enabled;
}
