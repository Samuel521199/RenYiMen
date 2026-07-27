import { createHash } from "node:crypto";

export const GENERATION_INPUT_FINGERPRINT_VERSION = "generation-input-v1";
export const QUALITY_EVALUATION_FINGERPRINT_VERSION = "quality-evaluation-v1";

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue | undefined };

function canonicalize(value: unknown): CanonicalValue | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map((item) => canonicalize(item) as CanonicalValue);
  if (typeof value !== "object") return String(value);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

/**
 * Candidate counters are observability text, not a meaningful generation
 * change. Removing them prevents a retry from bypassing the duplicate guard
 * merely because it calls itself candidate #3 instead of candidate #2.
 */
export function normalizeGenerationPromptForFingerprint(prompt: string): string {
  return prompt
    .replace(/^This is candidate #\d+\..*$/gim, "")
    .replace(/^Prior attempts reviewed:.*$/gim, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildGenerationInputFingerprint(input: {
  kind: string;
  prompt: string;
  negativePrompt?: string;
  referenceImageUrls?: string[];
  parameters?: unknown;
}): string {
  return fingerprint({
    version: GENERATION_INPUT_FINGERPRINT_VERSION,
    kind: input.kind,
    prompt: normalizeGenerationPromptForFingerprint(input.prompt),
    negativePrompt: input.negativePrompt?.trim() ?? "",
    referenceImageUrls: input.referenceImageUrls ?? [],
    parameters: input.parameters ?? {},
  });
}

export function buildQualityEvaluationFingerprint(input: {
  kind: string;
  mediaUrl: string;
  prompt: string;
  negativePrompt?: string;
  selectedReferenceUrls?: string[];
  targetContract?: unknown;
  visualContract?: unknown;
  parameters?: unknown;
}): string {
  return fingerprint({
    version: QUALITY_EVALUATION_FINGERPRINT_VERSION,
    kind: input.kind,
    mediaUrl: input.mediaUrl,
    prompt: normalizeGenerationPromptForFingerprint(input.prompt),
    negativePrompt: input.negativePrompt?.trim() ?? "",
    selectedReferenceUrls: input.selectedReferenceUrls ?? [],
    targetContract: input.targetContract ?? {},
    visualContract: input.visualContract ?? {},
    parameters: input.parameters ?? {},
  });
}
