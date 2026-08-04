export type OnePromptVideoFeatureEnv = Record<string, string | undefined>;

/**
 * Server-controlled visibility switch for the one-prompt video workbench.
 * Fail closed: only the explicit value `true` enables the workbench.
 */
export function isOnePromptVideoWorkbenchEnabled(
  env: OnePromptVideoFeatureEnv = process.env,
): boolean {
  const configured = env.ONE_PROMPT_VIDEO_WORKBENCH_ENABLED;
  if (configured === undefined) return false;
  return configured.trim().toLowerCase() === "true";
}
