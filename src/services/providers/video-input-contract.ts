export type VideoImageRole =
  | "first_frame"
  | "last_frame"
  | "character_identity"
  | "product_identity"
  | "scene_layout"
  | "motion_checkpoint"
  | "style_reference"
  | "custom_reference";

export type VideoImageAuthority =
  | "native_boundary"
  | "reference_only"
  | "evaluation_only";

export type VideoImageTransportSchema =
  | "dashscope_media"
  | "named_fields"
  | "ordered_image_list"
  | "adapter_custom";

export interface VideoImageInput {
  id: string;
  role: VideoImageRole;
  url: string;
  authority: VideoImageAuthority;
  instruction: string;
  allowedUse: string[];
  forbiddenUse: string[];
  sourceArtifactId?: string;
  /** Model-facing, human-readable subject name such as "the heroine". */
  entityName?: string;
  /** Stable consistency entity identifier used by the deterministic selector. */
  anchorId?: string;
  /** The part this reference plays in the current segment action. */
  actionRole?: "actor" | "object" | "environment" | "checkpoint" | "style" | "boundary";
  /** Relative checkpoint position within the segment, from 0 to 1. */
  temporalPosition?: number;
  /** True when the current segment contract requires this reference entity. */
  requiredForSegment?: boolean;
  relevanceScore?: number;
  qualityScore?: number;
  /** Populated only after selection; retained for audit/debug metadata. */
  selectionReason?: string;
}

export interface VideoImageRoleBinding {
  transportRole?: string;
  fieldName?: string;
  nativeBoundaryControl: boolean;
  maxCount?: number;
}

/**
 * Provider-declared image input protocol. A newly connected provider can use
 * named fields, an ordered list, DashScope-style media, or its own adapter
 * mapper without changing the orchestration contract.
 */
export interface VideoProviderInputCapabilities {
  providerId: string;
  modelId: string;
  transportSchema: VideoImageTransportSchema;
  maxImages: number;
  maxPromptCharacters?: number;
  supportsSemanticEndFramePrompt: boolean;
  promptCanAddressInputOrder: boolean;
  /**
   * Controls only the model-facing presentation. The internal role map remains
   * available for validation and debugging regardless of this value.
   */
  promptReferenceMode?: "none" | "plain_action" | "ordered_subject_action";
  /** Whether the adapter promises to preserve the selected image order. */
  preservesTransportOrder?: boolean;
  /**
   * Native first/last images already contain the visible character, product,
   * and scene identity. Providers that only accept those two boundary images
   * can satisfy reference coverage without a separate reference_image asset.
   */
  nativeBoundariesCarryReferenceIdentity?: boolean;
  /** Allows a provider rollout to return to the former role-priority slice. */
  referenceSelectionMode?: "smart_coverage" | "legacy_priority";
  roleBindings: Partial<Record<VideoImageRole, VideoImageRoleBinding>>;
}

export interface ResolvedVideoImageInputs {
  transported: VideoImageInput[];
  evaluationOnly: VideoImageInput[];
  rejected: Array<VideoImageInput & { reason: string }>;
  internalReferenceMap: Array<{
    imageNumber: number;
    role: VideoImageRole;
    entityName?: string;
    anchorId?: string;
    actionRole?: VideoImageInput["actionRole"];
    allowedUse: string[];
    forbiddenUse: string[];
    selectionReason: string;
  }>;
  coverage: {
    requiredAnchorIds: string[];
    coveredAnchorIds: string[];
    uncoveredHardAnchorIds: string[];
  };
  promptRoleMap: string;
  nativeFirstFrame: boolean;
  nativeLastFrame: boolean;
}

export type VideoEndFrameRequirement =
  | "hard_exact"
  | "hard_semantic"
  | "soft_directional"
  | "editorial";

const ROLE_PRIORITY: Record<VideoImageRole, number> = {
  first_frame: 0,
  last_frame: 1,
  character_identity: 2,
  product_identity: 3,
  scene_layout: 4,
  motion_checkpoint: 5,
  style_reference: 6,
  custom_reference: 7,
};

export function resolveVideoImageInputs(params: {
  inputs: VideoImageInput[];
  capabilities: VideoProviderInputCapabilities;
  endFrameRequirementLevel: VideoEndFrameRequirement;
}): ResolvedVideoImageInputs {
  validateCapabilities(params.capabilities);
  const normalized = uniqueInputs(params.inputs);
  const first = normalized.find((input) => input.role === "first_frame");
  const last = normalized.find((input) => input.role === "last_frame");
  if (!first) throw new Error("Video image input contract requires one first_frame.");
  if (!last) throw new Error("Video image input contract requires one last_frame for planning and evaluation.");

  const candidates: VideoImageInput[] = [];
  const evaluationOnly: VideoImageInput[] = [];
  const rejected: Array<VideoImageInput & { reason: string }> = [];
  const roleCounts = new Map<VideoImageRole, number>();
  for (const input of [...normalized].sort((a, b) => ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role])) {
    const binding = params.capabilities.roleBindings[input.role];
    if (!binding) {
      evaluationOnly.push({ ...input, authority: "evaluation_only" });
      rejected.push({ ...input, reason: `Provider does not accept role ${input.role}.` });
      continue;
    }
    const count = roleCounts.get(input.role) ?? 0;
    if (binding.maxCount !== undefined && count >= binding.maxCount) {
      rejected.push({ ...input, reason: `Provider accepts at most ${binding.maxCount} ${input.role} image(s).` });
      continue;
    }
    roleCounts.set(input.role, count + 1);
    candidates.push({
      ...input,
      authority: binding.nativeBoundaryControl ? "native_boundary" : "reference_only",
    });
  }

  const transported = params.capabilities.referenceSelectionMode === "legacy_priority"
    ? candidates.slice(0, params.capabilities.maxImages).map((input) => ({
        ...input,
        selectionReason: "legacy role-priority selection",
      }))
    : selectTransportedVideoInputs(candidates, params.capabilities.maxImages);
  const transportedIds = new Set(transported.map((input) => input.id));
  for (const overflow of candidates.filter((input) => !transportedIds.has(input.id))) {
    rejected.push({
      ...overflow,
      reason: `Not selected by the ${params.capabilities.maxImages}-image coverage and diversity policy.`,
    });
  }
  const firstBinding = params.capabilities.roleBindings.first_frame;
  const lastBinding = params.capabilities.roleBindings.last_frame;
  const nativeFirstFrame = Boolean(
    firstBinding?.nativeBoundaryControl
    && transported.some((input) => input.role === "first_frame"),
  );
  const nativeLastFrame = Boolean(
    lastBinding?.nativeBoundaryControl
    && transported.some((input) => input.role === "last_frame"),
  );
  if (!transported.some((input) => input.role === "first_frame")) {
    throw new Error(`${params.capabilities.modelId} does not receive the approved first-frame image.`);
  }
  if (params.endFrameRequirementLevel === "hard_exact" && !nativeLastFrame) {
    throw new Error(
      `${params.capabilities.modelId} cannot satisfy hard_exact end-frame control because the approved last frame is not a native model input.`,
    );
  }
  if (
    params.endFrameRequirementLevel === "hard_semantic"
    && !nativeLastFrame
    && !params.capabilities.supportsSemanticEndFramePrompt
  ) {
    throw new Error(
      `${params.capabilities.modelId} supports neither native last-frame input nor a reviewed semantic end-frame target.`,
    );
  }
  const requiredAnchorIds = uniqueStrings(
    normalized
      .filter((input) => input.requiredForSegment && input.anchorId)
      .map((input) => input.anchorId as string),
  );
  const coveredAnchorIds = uniqueStrings(
    [
      ...transported.flatMap((input) => input.anchorId ? [input.anchorId] : []),
      ...(params.capabilities.nativeBoundariesCarryReferenceIdentity
        && nativeFirstFrame
        && nativeLastFrame
        ? requiredAnchorIds
        : []),
    ],
  );
  const coveredAnchorSet = new Set(coveredAnchorIds);
  const uncoveredHardAnchorIds = requiredAnchorIds.filter((anchorId) => !coveredAnchorSet.has(anchorId));
  if (uncoveredHardAnchorIds.length) {
    throw new Error(
      `${params.capabilities.modelId} cannot cover required video reference anchor(s) within its `
      + `${params.capabilities.maxImages}-image limit: ${uncoveredHardAnchorIds.join(", ")}.`,
    );
  }
  return {
    transported,
    evaluationOnly: uniqueInputs([
      ...evaluationOnly,
      ...normalized.filter((input) =>
        input.role === "last_frame"
        && !transported.some((selected) => selected.id === input.id)
      ).map((input) => ({ ...input, authority: "evaluation_only" as const })),
    ]),
    rejected,
    internalReferenceMap: transported.map((input, index) => ({
      imageNumber: index + 1,
      role: input.role,
      entityName: input.entityName,
      anchorId: input.anchorId,
      actionRole: input.actionRole,
      allowedUse: input.allowedUse,
      forbiddenUse: input.forbiddenUse,
      selectionReason: input.selectionReason ?? defaultSelectionReason(input),
    })),
    coverage: {
      requiredAnchorIds,
      coveredAnchorIds,
      uncoveredHardAnchorIds,
    },
    promptRoleMap: buildVideoImageInputMapPrompt(transported, params.capabilities),
    nativeFirstFrame,
    nativeLastFrame,
  };
}

/**
 * Deterministic, metadata-only selection. It never calls an LLM/VLM, downloads
 * images, or performs network I/O. Boundaries and required active entities are
 * selected first, then temporally diverse motion checkpoints, then the highest
 * marginal-value remaining references.
 */
function selectTransportedVideoInputs(
  candidates: VideoImageInput[],
  maxImages: number,
): VideoImageInput[] {
  const selected = new Map<string, VideoImageInput>();
  const selectedAnchorIds = new Set<string>();
  const add = (input: VideoImageInput | undefined, reason: string): void => {
    if (!input || selected.size >= maxImages || selected.has(input.id)) return;
    selected.set(input.id, { ...input, selectionReason: reason });
    if (input.anchorId) selectedAnchorIds.add(input.anchorId);
  };

  add(bestCandidate(candidates.filter((input) => input.role === "first_frame")), "approved opening boundary");
  add(bestCandidate(candidates.filter((input) => input.role === "last_frame")), "approved target ending state");

  const requiredByAnchor = new Map<string, VideoImageInput[]>();
  for (const input of candidates) {
    if (!input.requiredForSegment || !input.anchorId) continue;
    const existing = requiredByAnchor.get(input.anchorId) ?? [];
    existing.push(input);
    requiredByAnchor.set(input.anchorId, existing);
  }
  for (const anchorCandidates of requiredByAnchor.values()) {
    add(bestCandidate(anchorCandidates), "required active segment entity");
  }

  const checkpoints = candidates
    .filter((input) => input.role === "motion_checkpoint" && !selected.has(input.id))
    .sort((a, b) => normalizedTemporalPosition(a) - normalizedTemporalPosition(b));
  const checkpointTarget = Math.min(2, checkpoints.length, Math.max(0, maxImages - selected.size));
  if (checkpointTarget === 1) {
    add(
      [...checkpoints].sort((a, b) =>
        Math.abs(normalizedTemporalPosition(a) - 0.5)
        - Math.abs(normalizedTemporalPosition(b) - 0.5)
      )[0],
      "representative motion checkpoint",
    );
  } else if (checkpointTarget === 2) {
    add(checkpoints[0], "early motion checkpoint");
    add(checkpoints.at(-1), "late motion checkpoint");
  }

  const remaining = candidates
    .filter((input) =>
      !selected.has(input.id)
      && input.role !== "motion_checkpoint"
    )
    .sort((a, b) => candidateScore(b) - candidateScore(a) || originalRolePriority(a) - originalRolePriority(b));
  for (const input of remaining) {
    // One strong identity/layout reference per consistency anchor is the safe
    // default. Boundary frames and motion checkpoints already carry pose/state
    // information, so extra views of the same anchor often add ambiguity.
    if (input.anchorId && selectedAnchorIds.has(input.anchorId)) continue;
    add(input, "highest remaining relevance and coverage");
  }

  return orderSelectedInputs([...selected.values()]);
}

function orderSelectedInputs(inputs: VideoImageInput[]): VideoImageInput[] {
  return [...inputs].sort((a, b) =>
    originalRolePriority(a) - originalRolePriority(b)
    || normalizedTemporalPosition(a) - normalizedTemporalPosition(b)
    || a.id.localeCompare(b.id)
  );
}

function bestCandidate(inputs: VideoImageInput[]): VideoImageInput | undefined {
  return [...inputs].sort((a, b) =>
    candidateScore(b) - candidateScore(a)
    || a.id.localeCompare(b.id)
  )[0];
}

function candidateScore(input: VideoImageInput): number {
  const boundary = input.role === "first_frame" || input.role === "last_frame" ? 10_000 : 0;
  const required = input.requiredForSegment ? 2_000 : 0;
  const active = input.actionRole === "actor" || input.actionRole === "object" ? 1_000 : 0;
  const environment = input.actionRole === "environment" ? 300 : 0;
  return boundary + required + active + environment
    + (input.relevanceScore ?? 0)
    + (input.qualityScore ?? 0);
}

function originalRolePriority(input: VideoImageInput): number {
  return ROLE_PRIORITY[input.role];
}

function normalizedTemporalPosition(input: VideoImageInput): number {
  const value = input.temporalPosition;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0.5;
}

function defaultSelectionReason(input: VideoImageInput): string {
  if (input.role === "first_frame") return "approved opening boundary";
  if (input.role === "last_frame") return "approved target ending state";
  if (input.requiredForSegment) return "required active segment entity";
  if (input.role === "motion_checkpoint") return "ordered motion checkpoint";
  return "within provider image budget";
}

export function buildVideoImageInputMapPrompt(
  inputs: VideoImageInput[],
  capabilities: VideoProviderInputCapabilities,
): string {
  if (!inputs.length || !capabilities.promptCanAddressInputOrder) return "";
  return [
    "VIDEO IMAGE INPUT MAP — image numbers exactly match the images transported to the video model",
    ...inputs.map((input, index) => [
      `[Image ${index + 1}] = ${input.role.toUpperCase()}`,
      `Authority: ${input.authority}.`,
      `Required use: ${input.instruction}`,
      input.allowedUse.length ? `Allowed evidence: ${input.allowedUse.join("; ")}` : "",
      input.forbiddenUse.length ? `Forbidden inheritance: ${input.forbiddenUse.join("; ")}` : "",
    ].filter(Boolean).join("\n")),
    "Never exchange image roles or blend attributes outside each image's allowed evidence scope.",
  ].join("\n\n");
}

export function mapResolvedVideoImagesToTransport(
  resolved: ResolvedVideoImageInputs,
  capabilities: VideoProviderInputCapabilities,
): Record<string, unknown> | Array<Record<string, unknown>> {
  if (capabilities.transportSchema === "dashscope_media") {
    return resolved.transported.map((input) => ({
      type: capabilities.roleBindings[input.role]?.transportRole ?? input.role,
      url: input.url,
    }));
  }
  if (capabilities.transportSchema === "named_fields") {
    const fields: Record<string, unknown> = {};
    for (const input of resolved.transported) {
      const fieldName = capabilities.roleBindings[input.role]?.fieldName;
      if (!fieldName) throw new Error(`Missing named field mapping for video image role ${input.role}.`);
      const current = fields[fieldName];
      fields[fieldName] = current === undefined
        ? input.url
        : Array.isArray(current)
          ? [...current, input.url]
          : [current, input.url];
    }
    return fields;
  }
  if (capabilities.transportSchema === "ordered_image_list") {
    return resolved.transported.map((input) => ({
      url: input.url,
      role: input.role,
    }));
  }
  throw new Error("adapter_custom video input schema must be mapped inside its provider adapter.");
}

function uniqueInputs(inputs: VideoImageInput[]): VideoImageInput[] {
  const seen = new Set<string>();
  return inputs.filter((input) => {
    if (!input.url?.trim()) return false;
    const fingerprint = `${input.role}:${input.url.trim()}`;
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function validateCapabilities(capabilities: VideoProviderInputCapabilities): void {
  if (!capabilities.providerId || !capabilities.modelId) {
    throw new Error("Video provider capabilities require providerId and modelId.");
  }
  if (!Number.isInteger(capabilities.maxImages) || capabilities.maxImages < 1) {
    throw new Error("Video provider maxImages must be a positive integer.");
  }
  if (
    capabilities.maxPromptCharacters !== undefined
    && (!Number.isInteger(capabilities.maxPromptCharacters) || capabilities.maxPromptCharacters < 1)
  ) {
    throw new Error("Video provider maxPromptCharacters must be a positive integer when declared.");
  }
}
