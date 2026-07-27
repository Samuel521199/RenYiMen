import type {
  VideoAudioPlan,
  VideoPromptContract,
  VideoPromptTerminalRequirement,
} from "./types";

export type EndFrameRequirementLevel =
  | "hard_exact"
  | "hard_semantic"
  | "soft_directional"
  | "editorial";

export interface VideoTerminalProviderCapabilities {
  acceptsLastFrameImage: boolean;
  endFrameSemanticMode: "soft_prompt_target" | "native_last_frame";
}

export interface HappyHorsePromptInput {
  durationSeconds: number;
  requirementLevel: EndFrameRequirementLevel;
  startState: string;
  contract: VideoPromptContract;
  retryCorrections: string[];
  modelId?: string;
  audioPlan?: VideoAudioPlan;
  firstFrameIsNativeInput?: boolean;
  lastFrameIsNativeInput?: boolean;
}

export interface CompiledHappyHorsePrompt {
  prompt: string;
  requirementLevel: EndFrameRequirementLevel;
  compacted: false;
  warnings: string[];
}

export interface LegacyVideoPromptContractInput {
  terminalState: string;
  motionPath: string;
  preserveRequirements: string[];
  narrativeBoundary: string;
  shotIntent: string;
}

const HAPPYHORSE_PROMPT_BUDGET = 4200;

export function resolveEndFrameRequirementLevel(value: unknown): EndFrameRequirementLevel {
  const source = record(value);
  const raw = String(
    source.endFrameRequirementLevel
    ?? source.end_frame_requirement_level
    ?? source.terminalStateControl
    ?? source.terminal_state_control
    ?? "",
  ).trim().toLowerCase();
  if (raw === "hard_exact" || raw === "hard_semantic" || raw === "soft_directional" || raw === "editorial") {
    return raw;
  }
  return "hard_semantic";
}

export function assertEndFrameRequirementSupported(
  requirementLevel: EndFrameRequirementLevel,
  capabilities: VideoTerminalProviderCapabilities,
  providerName: string,
): void {
  if (requirementLevel !== "hard_exact" || capabilities.acceptsLastFrameImage) return;
  throw new Error(
    `${providerName} only accepts a first-frame image, but this segment requires hard_exact terminal control. `
    + "Route the segment to a provider/workflow with native last-frame input or lower the reviewed requirement level.",
  );
}

export function videoPromptContractFromUnknown(value: unknown): VideoPromptContract | undefined {
  const source = record(value);
  const nestedContract = source.videoPromptContract ?? source.video_prompt_contract;
  const looksLikeDirectContract =
    source.version === "video-prompt-contract-v1"
    || "terminalRequirements" in source
    || "terminal_requirements" in source;
  const contractSource = record(nestedContract ?? (looksLikeDirectContract ? source : undefined));
  if (!Object.keys(contractSource).length) return undefined;
  if (contractSource.version !== "video-prompt-contract-v1") {
    throw new Error(
      "video_prompt_contract.version must be video-prompt-contract-v1.",
    );
  }
  const terminalRequirements = strictArray(
    contractSource.terminalRequirements ?? contractSource.terminal_requirements,
    "terminal_requirements",
  )
    .map((item, index) => normalizeTerminalRequirement(item, index));
  return {
    version: "video-prompt-contract-v1",
    terminalRequirements,
    motionSteps: strictStringArray(
      contractSource.motionSteps ?? contractSource.motion_steps,
      "motion_steps",
    ),
    preserveRequirements: strictStringArray(
      contractSource.preserveRequirements ?? contractSource.preserve_requirements,
      "preserve_requirements",
    ),
    forbiddenOutcomes: strictStringArray(
      contractSource.forbiddenOutcomes ?? contractSource.forbidden_outcomes,
      "forbidden_outcomes",
    ),
    narrativeBoundary: stringValue(contractSource.narrativeBoundary ?? contractSource.narrative_boundary),
    shotIntent: stringValue(contractSource.shotIntent ?? contractSource.shot_intent),
  };
}

/**
 * Compatibility only for plans created before video-prompt-contract-v1.
 * It wraps complete existing contract fields without selecting, summarizing,
 * deduplicating, or truncating their meaning.
 */
export function buildLegacyVideoPromptContract(input: LegacyVideoPromptContractInput): VideoPromptContract {
  return {
    version: "video-prompt-contract-v1",
    terminalRequirements: [{
      requirementId: "legacy.complete_terminal_state",
      priority: "hard",
      observableFact: input.terminalState,
      acceptanceCriteria: "The final stable frames visibly satisfy the complete approved terminal state.",
      source: "approved_end_frame",
    }],
    motionSteps: input.motionPath ? [input.motionPath] : [],
    preserveRequirements: input.preserveRequirements,
    forbiddenOutcomes: [
      "No cut, dissolve, teleportation, scene replacement, pasted still, or inserted freeze-frame.",
      "No subtitles, captions, watermarks, timecodes, random letters, lyrics, or unrequested UI.",
    ],
    narrativeBoundary: input.narrativeBoundary,
    shotIntent: input.shotIntent,
  };
}

/**
 * The compiler is deliberately non-creative. The planning model owns semantic
 * compression inside video_prompt_contract; this function only validates and
 * serializes that contract. Invalid or over-budget contracts are rejected
 * instead of being silently rewritten.
 */
export function compileHappyHorseVideoPrompt(input: HappyHorsePromptInput): CompiledHappyHorsePrompt {
  validateVideoPromptContract(input.contract, input.retryCorrections);
  const settleStart = Math.max(1, Number((input.durationSeconds * 0.7).toFixed(1)));
  const isReferenceToVideo = input.modelId?.toLowerCase().includes("r2v") === true;
  const blocks = [
    input.firstFrameIsNativeInput
      ? "START CONTROL: the approved first image is a native FIRST_FRAME input."
      : "START CONTROL: the approved first image is a role-labeled reference image, not a native hard first frame.",
    [
      `HAPPYHORSE ${isReferenceToVideo ? "REFERENCE-TO-VIDEO" : "FIRST-FRAME I2V"} — VALIDATED MODEL CONTRACT`,
      input.lastFrameIsNativeInput
        ? `CONTROL LEVEL: ${input.requirementLevel}. The approved last image is the native LAST_FRAME image input and every terminal requirement describes how to reach it.`
        : `CONTROL LEVEL: ${input.requirementLevel}. The approved last image is not a native model input and is enforced as a reviewed semantic target.`,
      `DURATION: ${input.durationSeconds}s. Complete the main action by ${settleStart}s, then decelerate and hold the terminal state through the final visible moment.`,
    ].join("\n"),
    [
      input.firstFrameIsNativeInput ? "1. HARD START INPUT" : "1. APPROVED START REFERENCE TARGET",
      input.startState,
    ].join("\n"),
    [
      "2. MANDATORY FINAL-FRAME CONTRACT",
      ...input.contract.terminalRequirements.map((item) => [
        `REQUIREMENT ${item.requirementId} [${item.priority}]`,
        `Visible fact: ${item.observableFact}`,
        `Acceptance: ${item.acceptanceCriteria}`,
        `Source: ${item.source}`,
      ].join("\n")),
    ].join("\n"),
    [
      "3. CONTINUOUS MOTION STEPS",
      ...input.contract.motionSteps.map((item, index) => `STEP ${index + 1}: ${item}`),
    ].join("\n"),
    input.contract.preserveRequirements.length
      ? ["4. PRESERVE UNCHANGED", ...input.contract.preserveRequirements.map((item) => `- ${item}`)].join("\n")
      : "",
    input.contract.forbiddenOutcomes.length
      ? ["5. FORBIDDEN OUTCOMES", ...input.contract.forbiddenOutcomes.map((item) => `- ${item}`)].join("\n")
      : "",
    input.contract.narrativeBoundary
      ? `6. NARRATIVE BOUNDARY\n${input.contract.narrativeBoundary}`
      : "",
    input.contract.shotIntent
      ? `7. SHOT INTENT\n${input.contract.shotIntent}`
      : "",
    input.retryCorrections.length
      ? ["8. STRUCTURED RETRY DELTA — APPLY WITHOUT CHANGING OTHER CONTRACT ITEMS", ...input.retryCorrections.map((item) => `- ${item}`)].join("\n")
      : "",
    compileHappyHorseAudioContract(input.audioPlan, input.durationSeconds),
    [
      "10. OUTPUT RULE",
      "Use one physically plausible uninterrupted take. The last stable frames must satisfy every hard terminal requirement.",
    ].join("\n"),
  ].filter(Boolean);
  const prompt = blocks.join("\n\n");
  if (prompt.length > HAPPYHORSE_PROMPT_BUDGET) {
    throw new Error(
      `video_prompt_contract compiles to ${prompt.length} characters, exceeding the HappyHorse budget of ${HAPPYHORSE_PROMPT_BUDGET}. `
      + "Return to the planning model to compress soft descriptions without dropping or rewriting hard requirements.",
    );
  }
  return { prompt, requirementLevel: input.requirementLevel, compacted: false, warnings: [] };
}

export function resolveVideoAudioStrategy(
  audioPlan: VideoAudioPlan | undefined,
): NonNullable<VideoAudioPlan["strategy"]> {
  if (
    audioPlan?.strategy === "native_ambience"
    || audioPlan?.strategy === "native_full"
    || audioPlan?.strategy === "post_only"
  ) {
    return audioPlan.strategy;
  }
  if (audioPlan?.mode === "silent") return "post_only";
  // Legacy plans did not distinguish exact post-produced speech from model
  // speech. Keep synchronized ambience by default without risking invented ad
  // copy or a different music bed in every segment.
  return "native_ambience";
}

export function compileHappyHorseAudioContract(
  audioPlan: VideoAudioPlan | undefined,
  durationSeconds: number,
): string {
  const strategy = resolveVideoAudioStrategy(audioPlan);
  const lines = [
    ...(audioPlan?.linesEn ?? []),
    ...(audioPlan?.linesZh ?? []),
    ...(audioPlan?.lines ?? []),
  ].map((line) => line.trim()).filter(Boolean);
  const effects = (audioPlan?.soundEffects ?? []).slice(0, 4);
  const music = audioPlan?.backgroundMusic;
  const block = ["9. AUDIO CONTRACT", `Strategy: ${strategy}.`];

  if (strategy === "post_only") {
    block.push(
      "Do not generate dialogue, voice-over, background music, or intentional sound effects.",
      "The final soundtrack is authored in post-production.",
    );
    return block.join("\n");
  }

  if (strategy === "native_ambience") {
    block.push(
      "Generate synchronized diegetic ambience and action sound effects only.",
      "No dialogue. No voice-over. No background music. Do not invent speech.",
    );
  } else {
    block.push("Generate a synchronized native soundtrack for this video.");
    if (lines.length) {
      block.push(
        `The speaker ${audioPlan?.speaker ? `(${audioPlan.speaker}) ` : ""}says exactly: ${lines.map((line) => `"${line}"`).join(" / ")}`,
        audioPlan?.language ? `Language: ${audioPlan.language}.` : "",
        audioPlan?.voiceStyle ? `Voice style: ${audioPlan.voiceStyle}.` : "",
        "Synchronize visible mouth movement naturally with the spoken line. Do not add unrelated speech.",
      );
    } else {
      block.push("No dialogue or voice-over. Do not invent speech.");
    }
    if (music?.source === "native") {
      block.push(
        `Generate background music${music.style ? ` in a ${music.style} style` : ""}${music.mood ? ` with a ${music.mood} mood` : ""}.`,
      );
    } else {
      block.push("No background music; project-wide music is handled in post-production.");
    }
  }

  for (const effect of effects) {
    const timing = Number.isFinite(effect.timingSeconds)
      ? `At approximately ${Math.max(0, Math.min(durationSeconds, Number(effect.timingSeconds))).toFixed(1)}s, `
      : "";
    block.push(`${timing}${effect.source} ${effect.action}: ${effect.description}.`);
  }
  return block.filter(Boolean).join("\n");
}

export function validateVideoPromptContract(contract: VideoPromptContract, retryCorrections: string[] = []): void {
  if (contract.version !== "video-prompt-contract-v1") throw new Error("Unsupported video prompt contract version.");
  if (contract.terminalRequirements.length < 1 || contract.terminalRequirements.length > 3) {
    throw new Error("video_prompt_contract must contain 1 to 3 terminal requirements.");
  }
  if (!contract.terminalRequirements.some((item) => item.priority === "hard")) {
    throw new Error("video_prompt_contract must contain at least one hard terminal requirement.");
  }
  if (contract.motionSteps.length < 1 || contract.motionSteps.length > 3) {
    throw new Error("video_prompt_contract must contain 1 to 3 continuous motion steps.");
  }
  if (contract.preserveRequirements.length > 5) throw new Error("video_prompt_contract may contain at most 5 preserve requirements.");
  if (contract.forbiddenOutcomes.length > 5) throw new Error("video_prompt_contract may contain at most 5 forbidden outcomes.");
  if (retryCorrections.length > 3) throw new Error("A retry may contain at most 3 structured correction actions.");
  assertNoDuplicateValues(contract.terminalRequirements.map((item) => item.requirementId), "terminal requirement IDs");
  assertNoDuplicateValues(contract.motionSteps, "motion steps");
  assertNoDuplicateValues(contract.preserveRequirements, "preserve requirements");
  assertNoDuplicateValues(contract.forbiddenOutcomes, "forbidden outcomes");
  assertNoDuplicateValues(retryCorrections, "retry corrections");
  for (const requirement of contract.terminalRequirements) {
    if (!requirement.requirementId || !requirement.observableFact || !requirement.acceptanceCriteria) {
      throw new Error("Every terminal requirement must include requirementId, observableFact, and acceptanceCriteria.");
    }
  }
}

function normalizeTerminalRequirement(
  value: unknown,
  index: number,
): VideoPromptTerminalRequirement {
  const source = record(value);
  const requirementId = stringValue(source.requirementId ?? source.requirement_id);
  const observableFact = stringValue(source.observableFact ?? source.observable_fact);
  const acceptanceCriteria = stringValue(source.acceptanceCriteria ?? source.acceptance_criteria);
  if (!requirementId || !observableFact || !acceptanceCriteria) {
    throw new Error(
      `video_prompt_contract.terminal_requirements[${index}] must include requirement_id, observable_fact, and acceptance_criteria.`,
    );
  }
  const priority = stringValue(source.priority);
  if (priority !== "hard" && priority !== "soft") {
    throw new Error(
      `video_prompt_contract.terminal_requirements[${index}].priority must be hard or soft.`,
    );
  }
  const rawSource = stringValue(source.source);
  const normalizedSource = normalizeTerminalRequirementSource(rawSource);
  if (!normalizedSource) {
    throw new Error(
      `video_prompt_contract.terminal_requirements[${index}].source "${rawSource || "(empty)"}" is invalid.`,
    );
  }
  return {
    requirementId,
    priority,
    observableFact,
    acceptanceCriteria,
    source: normalizedSource,
  };
}

function normalizeTerminalRequirementSource(
  value: string,
): VideoPromptTerminalRequirement["source"] | undefined {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "user") return "user";
  if (normalized === "story_contract") return "story_contract";
  if (normalized === "approved_end_frame") return "approved_end_frame";
  if (normalized === "planner") return "planner";

  // Model-facing schemas occasionally return a more descriptive provenance
  // label. Normalize only aliases whose ownership is unambiguous; provenance
  // values without a recognizable owner remain hard errors.
  if (/(?:approved_)?(?:end|last|terminal)_(?:frame|keyframe|boundary)|end_frame_contract/.test(normalized)) {
    return "approved_end_frame";
  }
  if (/story|narrative|beat/.test(normalized)) return "story_contract";
  if (/user|brief|request/.test(normalized)) return "user";
  if (/planner|planning|timeline|segment|shot_decomposer/.test(normalized)) return "planner";
  return undefined;
}

function assertNoDuplicateValues(values: string[], label: string): void {
  const normalized = values.map((item) => item.trim().toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`video_prompt_contract contains duplicate ${label}; the planning model must resolve them explicitly.`);
  }
}

function strictArray(value: unknown, fieldName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`video_prompt_contract.${fieldName} must be an array.`);
  }
  return value;
}

function strictStringArray(value: unknown, fieldName: string): string[] {
  return strictArray(value, fieldName).map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(
        `video_prompt_contract.${fieldName}[${index}] must be a non-empty string.`,
      );
    }
    return item.trim();
  });
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
