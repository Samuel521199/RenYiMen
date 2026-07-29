export const CANONICAL_EXECUTION_CONTRACT_VERSION = 2 as const;
export const CANONICAL_EXECUTION_LANGUAGE = "en" as const;

export interface CanonicalExecutionReference {
  url: string;
  role: string;
}

export interface CanonicalExecutionContractV2 {
  schemaVersion: typeof CANONICAL_EXECUTION_CONTRACT_VERSION;
  language: typeof CANONICAL_EXECUTION_LANGUAGE;
  targetId: string;
  artifactId: string;
  revision: number;
  prompt: string;
  negativePrompt: string;
  constraints: Record<string, unknown>;
  references: CanonicalExecutionReference[];
  display?: {
    zh?: {
      prompt?: string;
      negativePrompt?: string;
    };
  };
}

export class CanonicalExecutionContractError extends Error {
  readonly code = "EXECUTION_CONTRACT_INVALID";
  readonly recoveryAction = "REPAIR_CONTRACT";

  constructor(message: string) {
    super(message);
    this.name = "CanonicalExecutionContractError";
  }
}

export function createCanonicalExecutionContractV2(input: {
  targetId: string;
  artifactId: string;
  revision: number;
  prompt: string;
  negativePrompt?: string;
  constraints?: Record<string, unknown>;
  references?: CanonicalExecutionReference[];
  displayZh?: {
    prompt?: string;
    negativePrompt?: string;
  };
}): CanonicalExecutionContractV2 {
  const contract: CanonicalExecutionContractV2 = {
    schemaVersion: CANONICAL_EXECUTION_CONTRACT_VERSION,
    language: CANONICAL_EXECUTION_LANGUAGE,
    targetId: input.targetId.trim(),
    artifactId: input.artifactId.trim(),
    revision: input.revision,
    prompt: input.prompt.trim(),
    negativePrompt: input.negativePrompt?.trim() ?? "",
    constraints: input.constraints ?? {},
    references: (input.references ?? []).map((reference) => ({
      url: reference.url.trim(),
      role: reference.role.trim(),
    })),
    ...(input.displayZh
      ? {
          display: {
            zh: {
              ...(input.displayZh.prompt?.trim()
                ? { prompt: input.displayZh.prompt.trim() }
                : {}),
              ...(input.displayZh.negativePrompt?.trim()
                ? { negativePrompt: input.displayZh.negativePrompt.trim() }
                : {}),
            },
          },
        }
      : {}),
  };
  assertCanonicalExecutionContractV2(contract);
  return contract;
}

export function assertCanonicalExecutionContractV2(
  value: unknown,
): asserts value is CanonicalExecutionContractV2 {
  if (!isRecord(value)) invalid("Execution contract must be an object.");
  if (value.schemaVersion !== CANONICAL_EXECUTION_CONTRACT_VERSION) {
    invalid(`Execution contract schemaVersion must be ${CANONICAL_EXECUTION_CONTRACT_VERSION}.`);
  }
  if (value.language !== CANONICAL_EXECUTION_LANGUAGE) {
    invalid("Execution contract language must be en.");
  }
  requireText(value.targetId, "targetId");
  requireText(value.artifactId, "artifactId");
  if (!Number.isInteger(value.revision) || Number(value.revision) < 1) {
    invalid("Execution contract revision must be a positive integer.");
  }
  const prompt = requireText(value.prompt, "prompt");
  const negativePrompt = typeof value.negativePrompt === "string"
    ? value.negativePrompt.trim()
    : invalid("Execution contract negativePrompt must be a string.");
  assertEnglishExecutionText(prompt, "prompt");
  assertEnglishExecutionText(negativePrompt, "negativePrompt");
  if (!isRecord(value.constraints)) invalid("Execution contract constraints must be an object.");
  if (!Array.isArray(value.references)) invalid("Execution contract references must be an array.");
  for (const [index, reference] of value.references.entries()) {
    if (!isRecord(reference)) invalid(`Execution reference ${index} must be an object.`);
    requireText(reference.url, `references[${index}].url`);
    requireText(reference.role, `references[${index}].role`);
  }
}

export function providerPromptFromExecutionContract(
  contract: CanonicalExecutionContractV2,
): string {
  assertCanonicalExecutionContractV2(contract);
  return contract.prompt;
}

function assertEnglishExecutionText(value: string, field: string): void {
  if (containsCjk(value)) {
    invalid(`${field} contains Chinese display prose; canonical execution text must be English.`);
  }
}

function containsCjk(value: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(value);
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(`${field} must be a non-empty string.`);
  return value.trim();
}

function invalid(message: string): never {
  throw new CanonicalExecutionContractError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
