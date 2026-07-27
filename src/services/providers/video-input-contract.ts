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
  roleBindings: Partial<Record<VideoImageRole, VideoImageRoleBinding>>;
}

export interface ResolvedVideoImageInputs {
  transported: VideoImageInput[];
  evaluationOnly: VideoImageInput[];
  rejected: Array<VideoImageInput & { reason: string }>;
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

  const transported = candidates.slice(0, params.capabilities.maxImages);
  for (const overflow of candidates.slice(params.capabilities.maxImages)) {
    rejected.push({ ...overflow, reason: `Provider accepts at most ${params.capabilities.maxImages} image(s).` });
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
    promptRoleMap: buildVideoImageInputMapPrompt(transported, params.capabilities),
    nativeFirstFrame,
    nativeLastFrame,
  };
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
