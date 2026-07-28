import { createHash } from "node:crypto";
import {
  callStructuredVisionModel,
  structuredVisionAvailable,
  structuredVisionModelName,
} from "./generation-quality-evaluator";
import { frameContractContainsMotionProcess } from "./frame-contract";
import {
  validateVideoPromptContract,
  videoPromptContractFromUnknown,
} from "./video-terminal-contract";
import type {
  SegmentRenderDescription,
  VideoBoundaryContract,
  VideoMediaConditionedSegmentPlan,
  VideoMicroShot,
  VideoObservedBoundaryFacts,
  VideoPlanSegment,
  VideoPromptContract,
} from "./types";
import type { ProviderSchedulingContext } from "./provider-capacity";

const OBSERVATION_SYSTEM_PROMPT = [
  "You are a Boundary Frame Observer.",
  "Report only facts visibly supported by CURRENT APPROVED BOUNDARY IMAGE.",
  "The semantic boundary contract describes intent but is not pixel evidence.",
  "Do not invent hidden geometry, motion, off-screen objects, or future events.",
  "Use viewer-relative directions. Put ambiguity in uncertainties.",
  "Return strict JSON only.",
].join("\n");

const MOTION_PLANNER_SYSTEM_PROMPT = [
  "You are a Media-Conditioned Segment Motion Planner for a single-take image-to-video system.",
  "The story, segment count, duration, assets, and canonical boundary contracts are already approved and immutable.",
  "The two approved boundary images are pixel authority for unspecified visual facts.",
  "Design only the continuous physical/camera path from START IMAGE to END IMAGE.",
  "Never add a cut, dissolve, teleport, scene replacement, hidden montage, new story event, or new asset.",
  "If the transition cannot be reached in the fixed duration as one continuous take, set physically_reachable=false and explain in warnings; do not disguise it.",
  "Return strict JSON only. The response must include start_frame_contract, end_frame_contract, motion_contract, single_take_contract with physically_reachable boolean, motion_checkpoints, and video_prompt_contract version video-prompt-contract-v1.",
  "start_frame_contract and end_frame_contract are STATIC SNAPSHOTS. Every nested text field must describe only visible state at that instant; never describe movement, transition, process, or a from-to path there.",
  "Each motion_checkpoints item must describe a real intermediate state using local_time_seconds, purpose, scene, action, camera, visible_anchor_ids, reference_type (text, image_prompt, or mixed), and image_prompt when a reference image is required.",
  "motion_checkpoints are internal states only: every local_time_seconds must be strictly greater than 0 and strictly less than the fixed duration. Do not repeat either boundary frame as a checkpoint.",
  "The user message gives MAXIMUM_MOTION_CHECKPOINTS. Return no more than that number. Prefer a minimal preparation -> decisive action -> resolved intermediate path; do not pad the list.",
  "Treat the provisional micro shots as story intent only. Reconcile every checkpoint with the pixels in both approved boundary images and keep each state physically reachable from its neighbors.",
  "video_prompt_contract must contain 1-3 terminal_requirements with at least one hard item, 1-3 motion_steps, at most 5 preserve_requirements, at most 5 forbidden_outcomes, narrative_boundary, and shot_intent.",
  "Every terminal_requirements item must contain these exact non-empty keys: requirement_id, priority (hard or soft), observable_fact, acceptance_criteria, and evidence_refs. Do not output source or sources; application code compiles provenance from typed evidence references.",
  "motion_steps, preserve_requirements, and forbidden_outcomes must be arrays of non-empty strings, not arrays of objects.",
].join("\n");

const MOTION_PLANNER_REPAIR_SYSTEM_PROMPT = [
  MOTION_PLANNER_SYSTEM_PROMPT,
  "",
  "STRUCTURED CONTRACT REPAIR MODE:",
  "The previous response failed deterministic validation. Repair only the listed violations.",
  "Return one complete replacement object for this segment, not a sparse patch and not an explanation.",
  "Do not change approved story meaning, duration, boundary images, asset identities, camera axis, or fields that already satisfy the contract.",
  "The deterministic validator will run again. A claim that the issue is fixed has no effect unless the returned JSON actually satisfies the exact schema.",
].join("\n");

export async function observeApprovedBoundaryFrame(params: {
  contract: VideoBoundaryContract;
  imageUrl: string;
  schedulingContext?: Omit<ProviderSchedulingContext, "targetId">;
}): Promise<VideoObservedBoundaryFacts> {
  const observedAt = new Date().toISOString();
  if (!structuredVisionAvailable()) {
    return fallbackObservation(params.contract, params.imageUrl, observedAt);
  }
  try {
    const raw = await callStructuredVisionModel([
      {
        type: "text",
        text: [
          `Canonical semantic contract: ${JSON.stringify(params.contract)}`,
          "Return {contract_passed, scene, camera_view, composition, character_state, product_state, anchor_positions, occlusions, lighting, uncertainties}.",
          "anchor_positions must be an object keyed by required anchor id. Do not claim an anchor is visible unless pixels support it.",
        ].join("\n"),
      },
      {
        type: "text",
        text: "CURRENT APPROVED BOUNDARY IMAGE — the only source of observed visual facts.",
      },
      { type: "image_url", image_url: { url: params.imageUrl } },
    ], OBSERVATION_SYSTEM_PROMPT, params.schedulingContext);
    const source = record(raw);
    return {
      version: "observed-boundary-facts-v1",
      keyframeNo: params.contract.keyframeNo,
      imageUrl: params.imageUrl,
      observedAt,
      observationModel: structuredVisionModelName(),
      contractPassed: booleanValue(source.contract_passed ?? source.contractPassed, true),
      scene: stringValue(source.scene, params.contract.scene),
      cameraView: stringValue(source.camera_view ?? source.cameraView, ""),
      composition: stringValue(source.composition, params.contract.compositionIntent ?? ""),
      characterState: stringValue(source.character_state ?? source.characterState, params.contract.characterState),
      productState: stringValue(source.product_state ?? source.productState, params.contract.productState),
      anchorPositions: stringRecord(source.anchor_positions ?? source.anchorPositions),
      occlusions: stringArray(source.occlusions),
      lighting: stringValue(source.lighting, ""),
      uncertainties: stringArray(source.uncertainties),
    };
  } catch (error) {
    const fallback = fallbackObservation(params.contract, params.imageUrl, observedAt);
    fallback.uncertainties = [
      `Vision observation failed: ${error instanceof Error ? error.message : String(error)}`,
    ];
    return fallback;
  }
}

export async function planMediaConditionedSegment(params: {
  segment: VideoPlanSegment;
  startContract: VideoBoundaryContract;
  endContract: VideoBoundaryContract;
  startFacts: VideoObservedBoundaryFacts;
  endFacts: VideoObservedBoundaryFacts;
  startImageUrl: string;
  endImageUrl: string;
  provisional?: SegmentRenderDescription;
  schedulingContext?: Omit<ProviderSchedulingContext, "targetId">;
}): Promise<VideoMediaConditionedSegmentPlan> {
  const refinedAt = new Date().toISOString();
  if (!structuredVisionAvailable()) {
    return validatedFallbackPlan(
      params,
      refinedAt,
      "Structured vision is unavailable; retained an audited conservative fallback contract.",
    );
  }
  let raw: unknown;
  try {
    raw = await callStructuredVisionModel([
      {
        type: "text",
        text: [
          `Fixed segment: ${JSON.stringify(params.segment)}`,
          `Canonical start boundary: ${JSON.stringify(params.startContract)}`,
          `Canonical end boundary: ${JSON.stringify(params.endContract)}`,
          `Observed start facts: ${JSON.stringify(params.startFacts)}`,
          `Observed end facts: ${JSON.stringify(params.endFacts)}`,
          `Provisional pre-image plan (advisory only): ${JSON.stringify(params.provisional ?? {})}`,
          `ALLOWED_TERMINAL_EVIDENCE: ${JSON.stringify(mediaConditionedEvidenceCatalog(params))}`,
          `Fixed duration: ${params.segment.durationSeconds} seconds.`,
          `MAXIMUM_MOTION_CHECKPOINTS: ${mediaConditionedCheckpointLimit(params.segment.durationSeconds)}.`,
          "Output only this segment. Do not change timings, boundaries, events, assets, or story meaning.",
        ].join("\n"),
      },
      { type: "text", text: "START IMAGE — approved first-frame pixel authority." },
      { type: "image_url", image_url: { url: params.startImageUrl } },
      { type: "text", text: "END IMAGE — approved terminal-state pixel authority." },
      { type: "image_url", image_url: { url: params.endImageUrl } },
    ], MOTION_PLANNER_SYSTEM_PROMPT, params.schedulingContext);
    return normalizeMediaPlan(raw, params, refinedAt);
  } catch (error) {
    if (raw !== undefined && isMediaContractValidationError(error)) {
      try {
        const repairedRaw = await callStructuredVisionModel([
          {
            type: "text",
            text: [
              `VALIDATION_FAILURE: ${errorMessage(error)}`,
              `INVALID_RESPONSE_TO_REPAIR: ${JSON.stringify(raw)}`,
              `IMMUTABLE_SEGMENT: ${JSON.stringify(params.segment)}`,
              `IMMUTABLE_START_BOUNDARY: ${JSON.stringify(params.startContract)}`,
              `IMMUTABLE_END_BOUNDARY: ${JSON.stringify(params.endContract)}`,
              `ALLOWED_TERMINAL_EVIDENCE: ${JSON.stringify(mediaConditionedEvidenceCatalog(params))}`,
              `MAXIMUM_MOTION_CHECKPOINTS: ${mediaConditionedCheckpointLimit(params.segment.durationSeconds)}.`,
              "Return the complete corrected segment contract only.",
            ].join("\n"),
          },
          { type: "text", text: "START IMAGE — unchanged approved pixel authority." },
          { type: "image_url", image_url: { url: params.startImageUrl } },
          { type: "text", text: "END IMAGE — unchanged approved pixel authority." },
          { type: "image_url", image_url: { url: params.endImageUrl } },
        ], MOTION_PLANNER_REPAIR_SYSTEM_PROMPT, params.schedulingContext);
        const repaired = normalizeMediaPlan(repairedRaw, params, refinedAt);
        return {
          ...repaired,
          planningStatus: "media_conditioned_repaired",
          warnings: [
            ...repaired.warnings,
            `The first media-conditioned response failed deterministic validation and was replaced by one scoped contract repair: ${errorMessage(error)}`,
          ],
        };
      } catch (repairError) {
        return validatedFallbackPlan(
          params,
          refinedAt,
          `Media-conditioned contract repair failed; used an audited conservative fallback. Initial error: ${errorMessage(error)}. Repair error: ${errorMessage(repairError)}`,
        );
      }
    }
    return validatedFallbackPlan(
      params,
      refinedAt,
      `Media-conditioned planning infrastructure failed; used an audited conservative fallback: ${errorMessage(error)}`,
    );
  }
}

function normalizeMediaPlan(
  value: unknown,
  params: Parameters<typeof planMediaConditionedSegment>[0],
  refinedAt: string,
): VideoMediaConditionedSegmentPlan {
  const source = record(value);
  const singleTake = record(source.single_take_contract ?? source.singleTakeContract);
  const physicallyReachable = booleanValue(
    singleTake.physically_reachable ?? singleTake.physicallyReachable,
    false,
  );
  const promptContract = videoPromptContractFromUnknown(
    source.video_prompt_contract ?? source.videoPromptContract,
  );
  if (!promptContract) throw new Error("Missing video_prompt_contract.");
  const warnings = stringArray(source.warnings);
  if (!physicallyReachable && !warnings.length) {
    warnings.push("The approved boundary images are not physically reachable as one continuous take.");
  }
  const resolvedMicroShots = materializeResolvedMicroShots({
    checkpoints: normalizeCheckpoints(
      source.motion_checkpoints ?? source.motionCheckpoints,
      params.segment,
    ),
    segment: params.segment,
    startFacts: params.startFacts,
    endFacts: params.endFacts,
    startImageUrl: params.startImageUrl,
    endImageUrl: params.endImageUrl,
    refinedAt,
    planningSource: "media_conditioned",
  });
  const microShotRevisionId = resolvedMicroShots[0]?.resolvedRevisionId
    ?? buildResolvedRevisionId(params, resolvedMicroShots);
  const normalized: VideoMediaConditionedSegmentPlan = {
    version: "media-conditioned-segment-v1",
    segmentNo: params.segment.segmentNo,
    startKeyframeNo: params.segment.startKeyframeNo,
    endKeyframeNo: params.segment.endKeyframeNo,
    startBoundaryImageUrl: params.startImageUrl,
    endBoundaryImageUrl: params.endImageUrl,
    startFrameContract: record(source.start_frame_contract ?? source.startFrameContract),
    endFrameContract: record(source.end_frame_contract ?? source.endFrameContract),
    motionContract: record(source.motion_contract ?? source.motionContract),
    singleTakeContract: { ...singleTake, physicallyReachable },
    motionCheckpoints: resolvedMicroShots,
    resolvedMicroShots,
    microShotRevisionId,
    videoPromptContract: promptContract,
    planningStatus: "media_conditioned",
    warnings,
    refinedAt,
    modelName: structuredVisionModelName(),
  };
  validateMediaConditionedEvidence(normalized, params);
  validateMediaConditionedSegmentPlan(normalized, params.segment);
  return normalized;
}

function validatedFallbackPlan(
  params: Parameters<typeof planMediaConditionedSegment>[0],
  refinedAt: string,
  warning: string,
): VideoMediaConditionedSegmentPlan {
  const provisional = params.provisional ?? {
    segmentNo: params.segment.segmentNo,
    visibleAnchorIds: params.segment.effectiveRequiredAnchorIds
      ?? params.segment.usesConsistencyAnchors
      ?? [],
  };
  const existingContract = readValidVideoPromptContract(provisional);
  const videoPromptContract: VideoPromptContract = existingContract ?? {
    version: "video-prompt-contract-v1",
    terminalRequirements: [{
      requirementId: `segment_${params.segment.segmentNo}_approved_end`,
      priority: "hard",
      observableFact: [
        params.endFacts.scene,
        params.endFacts.characterState,
        params.endFacts.productState,
        params.endFacts.composition,
      ].filter(Boolean).join("; "),
      acceptanceCriteria: "The final stable frames visibly match the approved end boundary image and its canonical story state.",
      evidenceRefs: [{
        type: "approved_end_frame",
        id: `keyframe:${params.segment.endKeyframeNo}`,
      }],
      source: "approved_end_frame",
      sources: ["approved_end_frame"],
    }],
    motionSteps: [
      params.segment.motion
      || params.segment.subjectMotion
      || "Use the shortest physically plausible continuous path between the approved boundary states.",
    ],
    preserveRequirements: [
      "Preserve approved identities, product appearance, scene continuity, and camera axis.",
    ],
    forbiddenOutcomes: [
      "No cut, dissolve, teleportation, scene replacement, montage, or duplicated subject.",
    ],
    narrativeBoundary: `Animate only segment ${params.segment.segmentNo}; do not introduce later story events.`,
    shotIntent: params.segment.purpose,
  };
  const provisionalSingleTake = provisional.singleTakeContract ?? {};
  const fallbackCheckpoints = params.provisional?.motionCheckpoints?.length
    ? params.provisional.motionCheckpoints
    : params.segment.microShots ?? [];
  const boundedFallbackCheckpoints = compactFallbackCheckpoints(
    fallbackCheckpoints,
    mediaConditionedCheckpointLimit(params.segment.durationSeconds),
  );
  const resolvedMicroShots = materializeResolvedMicroShots({
    checkpoints: boundedFallbackCheckpoints,
    segment: params.segment,
    startFacts: params.startFacts,
    endFacts: params.endFacts,
    startImageUrl: params.startImageUrl,
    endImageUrl: params.endImageUrl,
    refinedAt,
    planningSource: "legacy_fallback",
  });
  const microShotRevisionId = resolvedMicroShots[0]?.resolvedRevisionId
    ?? buildResolvedRevisionId(params, resolvedMicroShots);
  const fallback: VideoMediaConditionedSegmentPlan = {
    version: "media-conditioned-segment-v1",
    segmentNo: params.segment.segmentNo,
    startKeyframeNo: params.segment.startKeyframeNo,
    endKeyframeNo: params.segment.endKeyframeNo,
    startBoundaryImageUrl: params.startImageUrl,
    endBoundaryImageUrl: params.endImageUrl,
    startFrameContract: {
      canonicalBoundary: params.startContract,
      observedFacts: params.startFacts,
    },
    endFrameContract: {
      canonicalBoundary: params.endContract,
      observedFacts: params.endFacts,
    },
    motionContract: params.provisional?.motionContract ?? {
      subjectMotion: params.segment.subjectMotion || params.segment.motion,
      environmentMotion: params.segment.environmentMotion,
    },
    singleTakeContract: {
      ...provisionalSingleTake,
      physicallyReachable: booleanValue(
        provisionalSingleTake.physicallyReachable
          ?? provisionalSingleTake.physically_reachable,
        true,
      ),
    },
    motionCheckpoints: resolvedMicroShots,
    resolvedMicroShots,
    microShotRevisionId,
    videoPromptContract,
    planningStatus: "fallback",
    warnings: [warning],
    refinedAt,
  };
  validateMediaConditionedEvidence(fallback, params);
  validateMediaConditionedSegmentPlan(fallback, params.segment);
  return fallback;
}

function fallbackObservation(
  contract: VideoBoundaryContract,
  imageUrl: string,
  observedAt: string,
): VideoObservedBoundaryFacts {
  return {
    version: "observed-boundary-facts-v1",
    keyframeNo: contract.keyframeNo,
    imageUrl,
    observedAt,
    contractPassed: true,
    scene: contract.scene,
    cameraView: "",
    composition: contract.compositionIntent ?? "",
    characterState: contract.characterState,
    productState: contract.productState,
    anchorPositions: {},
    occlusions: [],
    lighting: "",
    uncertainties: ["Vision observation unavailable; semantic contract retained as fallback."],
  };
}

function normalizeCheckpoints(value: unknown, segment: VideoPlanSegment): VideoMicroShot[] {
  if (!Array.isArray(value)) return [];
  const checkpoints = value.flatMap((item, index) => {
    const source = record(item);
    const localTimeSeconds = numberValue(
      source.localTimeSeconds ?? source.local_time_seconds ?? source.timeSeconds ?? source.time_seconds,
      Math.min(segment.durationSeconds, ((index + 1) * segment.durationSeconds) / (value.length + 1)),
    );
    const purpose = stringValue(source.purpose ?? source.state, `Motion checkpoint ${index + 1}`);
    return [{
      microShotNo: index + 1,
      localTimeSeconds,
      absoluteTimeSeconds: segment.startTimeSeconds + localTimeSeconds,
      purpose,
      scene: stringValue(source.scene, ""),
      action: stringValue(source.action ?? source.motion, purpose),
      camera: stringValue(source.camera, ""),
      referenceType: referenceTypeValue(source.reference_type ?? source.referenceType),
      imagePrompt: stringValue(source.image_prompt ?? source.imagePrompt, ""),
      usesConsistencyAnchors: stringArray(
        source.visible_anchor_ids
          ?? source.visibleAnchorIds
          ?? source.uses_consistency_anchors
          ?? source.usesConsistencyAnchors,
      ),
      prompt: stringValue(source.prompt, purpose),
    }];
  }).sort((left, right) => left.localTimeSeconds - right.localTimeSeconds);
  for (let index = 0; index < checkpoints.length; index += 1) {
    const checkpoint = checkpoints[index];
    if (
      checkpoint.localTimeSeconds <= 0
      || checkpoint.localTimeSeconds >= segment.durationSeconds
      || (index > 0 && checkpoint.localTimeSeconds <= checkpoints[index - 1].localTimeSeconds)
    ) {
      throw new Error(
        `Invalid motion checkpoint timing at segment ${segment.segmentNo}, checkpoint ${index + 1}.`,
      );
    }
  }
  const limit = mediaConditionedCheckpointLimit(segment.durationSeconds);
  if (checkpoints.length > limit) {
    throw new Error(
      `Segment ${segment.segmentNo} returned ${checkpoints.length} motion checkpoints; maximum is ${limit}.`,
    );
  }
  return checkpoints;
}

export function mediaConditionedCheckpointLimit(durationSeconds: number): number {
  return Math.max(1, Math.min(3, Math.ceil(Math.max(0.1, durationSeconds) / 2.5)));
}

/**
 * The fallback path may only reuse already-authored provisional checkpoints.
 * It never rewrites their prose. When the legacy plan exceeds the current
 * contract, retain evenly distributed states so the first/middle/last intent
 * survives while the fallback itself remains schema-valid.
 */
export function compactFallbackCheckpoints(
  checkpoints: VideoMicroShot[],
  limit: number,
): VideoMicroShot[] {
  if (checkpoints.length <= limit) return checkpoints;
  if (limit <= 1) return [checkpoints[Math.floor((checkpoints.length - 1) / 2)]];
  const selectedIndexes = new Set<number>();
  for (let index = 0; index < limit; index += 1) {
    selectedIndexes.add(Math.round((index * (checkpoints.length - 1)) / (limit - 1)));
  }
  return checkpoints.filter((_checkpoint, index) => selectedIndexes.has(index));
}

export function validateMediaConditionedSegmentPlan(
  plan: VideoMediaConditionedSegmentPlan,
  segment: VideoPlanSegment,
): void {
  if (!Object.keys(plan.startFrameContract).length) throw new Error("Missing start_frame_contract.");
  if (!Object.keys(plan.endFrameContract).length) throw new Error("Missing end_frame_contract.");
  if (!Object.keys(plan.motionContract).length) throw new Error("Missing motion_contract.");
  if (!Object.keys(plan.singleTakeContract).length) throw new Error("Missing single_take_contract.");
  if (frameContractContainsMotionProcess(plan.startFrameContract)) {
    throw new Error("start_frame_contract must contain only one static snapshot.");
  }
  if (frameContractContainsMotionProcess(plan.endFrameContract)) {
    throw new Error("end_frame_contract must contain only one static snapshot.");
  }
  const limit = mediaConditionedCheckpointLimit(segment.durationSeconds);
  if (plan.motionCheckpoints.length > limit) {
    throw new Error(
      `Segment ${segment.segmentNo} has ${plan.motionCheckpoints.length} checkpoints; maximum is ${limit}.`,
    );
  }
  const ordered = [...plan.motionCheckpoints].sort(
    (left, right) => left.localTimeSeconds - right.localTimeSeconds,
  );
  ordered.forEach((checkpoint, index) => {
    if (
      checkpoint.localTimeSeconds <= 0
      || checkpoint.localTimeSeconds >= segment.durationSeconds
      || (index > 0 && checkpoint.localTimeSeconds <= ordered[index - 1].localTimeSeconds)
    ) {
      throw new Error(
        `Segment ${segment.segmentNo} checkpoint ${checkpoint.microShotNo} is not a strictly ordered internal state.`,
      );
    }
  });
  validateVideoPromptContract(plan.videoPromptContract);
}

function isMediaContractValidationError(error: unknown): boolean {
  return /contract|checkpoint|strictly ordered|motion_steps|terminal_requirements|forbidden_outcomes|preserve_requirements|physically_reachable|json/i.test(
    errorMessage(error),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readValidVideoPromptContract(value: unknown): VideoPromptContract | undefined {
  try {
    const contract = videoPromptContractFromUnknown(value);
    if (!contract) return undefined;
    validateVideoPromptContract(contract);
    return contract;
  } catch {
    return undefined;
  }
}

function mediaConditionedEvidenceCatalog(
  params: Parameters<typeof planMediaConditionedSegment>[0],
): Array<{ type: string; id: string }> {
  const refs: Array<{ type: string; id: string }> = [{
    type: "approved_end_frame",
    id: `keyframe:${params.endContract.keyframeNo}`,
  }, {
    type: "planner_artifact",
    id: `segment:${params.segment.segmentNo}`,
  }];
  for (const beatId of params.segment.linkedBeatIds ?? []) {
    refs.push({ type: "story_contract", id: `beat:${beatId}` });
  }
  for (const evidenceId of params.segment.keyEvidenceIds ?? []) {
    refs.push({ type: "story_contract", id: `evidence:${evidenceId}` });
  }
  for (const anchorId of params.segment.effectiveRequiredAnchorIds
    ?? params.segment.usesConsistencyAnchors
    ?? []) {
    refs.push({ type: "story_contract", id: `anchor:${anchorId}` });
  }
  const provisionalContract = readValidVideoPromptContract(params.provisional);
  for (const requirement of provisionalContract?.terminalRequirements ?? []) {
    for (const ref of requirement.evidenceRefs) {
      refs.push({ type: ref.type, id: ref.id });
    }
  }
  return Array.from(
    new Map(refs.map((ref) => [`${ref.type}:${ref.id}`, ref])).values(),
  );
}

function validateMediaConditionedEvidence(
  plan: VideoMediaConditionedSegmentPlan,
  params: Parameters<typeof planMediaConditionedSegment>[0],
): void {
  const allowed = new Set(
    mediaConditionedEvidenceCatalog(params).map((ref) => `${ref.type}:${ref.id}`),
  );
  for (const requirement of plan.videoPromptContract.terminalRequirements) {
    for (const ref of requirement.evidenceRefs) {
      if (!allowed.has(`${ref.type}:${ref.id}`)) {
        throw new Error(
          `terminal_requirements evidence "${ref.type}:${ref.id}" is not present in ALLOWED_TERMINAL_EVIDENCE.`,
        );
      }
    }
  }
}

export function materializeResolvedMicroShots(params: {
  checkpoints: VideoMicroShot[];
  segment: VideoPlanSegment;
  startFacts: VideoObservedBoundaryFacts;
  endFacts: VideoObservedBoundaryFacts;
  startImageUrl: string;
  endImageUrl: string;
  refinedAt: string;
  planningSource: "media_conditioned" | "legacy_fallback";
}): VideoMicroShot[] {
  const intents = params.segment.microShots ?? [];
  const checkpoints = params.checkpoints.length ? params.checkpoints : intents;
  const usedIntentIndexes = new Set<number>();
  const usedMicroShotNos = new Set<number>();
  const ordered = checkpoints
    .map((checkpoint) => ({ ...checkpoint }))
    .sort((left, right) => left.localTimeSeconds - right.localTimeSeconds);
  const orderedTimesAreValid = ordered.every((checkpoint, index) =>
    checkpoint.localTimeSeconds > 0
    && checkpoint.localTimeSeconds < params.segment.durationSeconds
    && (index === 0 || checkpoint.localTimeSeconds > ordered[index - 1].localTimeSeconds)
  );
  const draft = ordered.map((checkpoint, index) => {
    const intentIndex = nearestUnusedIntentIndex(
      checkpoint.localTimeSeconds,
      intents,
      usedIntentIndexes,
    );
    if (intentIndex >= 0) usedIntentIndexes.add(intentIndex);
    const intent = intentIndex >= 0 ? intents[intentIndex] : undefined;
    const fallbackTime = ((index + 1) * params.segment.durationSeconds) / (ordered.length + 1);
    const localTimeSeconds = clampIntermediateTime(
      orderedTimesAreValid ? checkpoint.localTimeSeconds : fallbackTime,
      params.segment.durationSeconds,
      fallbackTime,
    );
    const preferredMicroShotNo = intent?.microShotNo;
    let microShotNo = Number.isInteger(preferredMicroShotNo) && Number(preferredMicroShotNo) > 0
      ? Number(preferredMicroShotNo)
      : index + 1;
    while (usedMicroShotNos.has(microShotNo)) microShotNo += 1;
    usedMicroShotNos.add(microShotNo);
    const referenceType = checkpoint.referenceType ?? intent?.referenceType ?? "text";
    const anchors = checkpoint.usesConsistencyAnchors?.length
      ? checkpoint.usesConsistencyAnchors
      : intent?.usesConsistencyAnchors
        ?? params.segment.effectiveRequiredAnchorIds
        ?? params.segment.usesConsistencyAnchors
        ?? [];
    const scene = checkpoint.scene || intent?.scene || params.startFacts.scene;
    const action = checkpoint.action || intent?.action || checkpoint.purpose;
    const camera = checkpoint.camera || intent?.camera || params.startFacts.cameraView;
    const imagePrompt = referenceType === "text"
      ? undefined
      : checkpoint.imagePrompt?.trim()
        || buildResolvedImagePrompt({
          segment: params.segment,
          localTimeSeconds,
          scene,
          action,
          camera,
          anchors,
          startFacts: params.startFacts,
          endFacts: params.endFacts,
        });
    return {
      ...checkpoint,
      microShotNo,
      localTimeSeconds,
      absoluteTimeSeconds: params.segment.startTimeSeconds + localTimeSeconds,
      purpose: checkpoint.purpose || intent?.purpose || `Motion checkpoint ${index + 1}`,
      scene,
      action,
      camera: camera || undefined,
      referenceType,
      imagePrompt,
      usesConsistencyAnchors: anchors,
      prompt: checkpoint.prompt || intent?.prompt || action,
      imageUrl: undefined,
      imageTaskId: undefined,
      imageStatus: "idle" as const,
      errorMessage: undefined,
      planningSource: params.planningSource,
      sourceIntentMicroShotNo: intent?.microShotNo,
      resolvedAt: params.refinedAt,
      startBoundaryImageUrl: params.startImageUrl,
      endBoundaryImageUrl: params.endImageUrl,
    };
  });
  const revisionId = buildResolvedRevisionId({
    segment: params.segment,
    startImageUrl: params.startImageUrl,
    endImageUrl: params.endImageUrl,
  }, draft);
  return draft.map((microShot) => ({
    ...microShot,
    resolvedRevisionId: revisionId,
  }));
}

function nearestUnusedIntentIndex(
  timeSeconds: number,
  intents: VideoMicroShot[],
  used: Set<number>,
): number {
  let selected = -1;
  let selectedDistance = Number.POSITIVE_INFINITY;
  intents.forEach((intent, index) => {
    if (used.has(index)) return;
    const distance = Math.abs(intent.localTimeSeconds - timeSeconds);
    if (distance < selectedDistance) {
      selected = index;
      selectedDistance = distance;
    }
  });
  return selected;
}

function clampIntermediateTime(value: number, durationSeconds: number, fallback: number): number {
  const safeDuration = Math.max(0.2, durationSeconds);
  const candidate = Number.isFinite(value) ? value : fallback;
  return Math.min(safeDuration - 0.1, Math.max(0.1, candidate));
}

function buildResolvedImagePrompt(params: {
  segment: VideoPlanSegment;
  localTimeSeconds: number;
  scene: string;
  action: string;
  camera: string;
  anchors: string[];
  startFacts: VideoObservedBoundaryFacts;
  endFacts: VideoObservedBoundaryFacts;
}): string {
  return [
    `Create the physically reachable intermediate frame at +${params.localTimeSeconds.toFixed(2)}s of one continuous take.`,
    `Scene: ${params.scene || params.startFacts.scene}.`,
    `Action state: ${params.action}.`,
    params.camera ? `Camera: ${params.camera}.` : "",
    params.anchors.length ? `Preserve these approved consistency anchors: ${params.anchors.join(", ")}.` : "",
    `It must continue naturally from the approved opening composition (${params.startFacts.composition})`,
    `and remain physically reachable to the approved ending composition (${params.endFacts.composition}).`,
    "Do not introduce a cut, scene replacement, new subject, or later story event.",
  ].filter(Boolean).join(" ");
}

function buildResolvedRevisionId(
  params: Pick<Parameters<typeof planMediaConditionedSegment>[0], "segment" | "startImageUrl" | "endImageUrl">,
  microShots: VideoMicroShot[],
): string {
  const payload = {
    version: "resolved-micro-shots-v1",
    segmentNo: params.segment.segmentNo,
    startImageUrl: params.startImageUrl,
    endImageUrl: params.endImageUrl,
    microShots: microShots.map((item) => ({
      no: item.microShotNo,
      time: item.localTimeSeconds,
      purpose: item.purpose,
      scene: item.scene,
      action: item.action,
      camera: item.camera,
      referenceType: item.referenceType,
      imagePrompt: item.imagePrompt,
      anchors: item.usesConsistencyAnchors,
    })),
  };
  return `resolved-micro-shots-v1:${createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 20)}`;
}

function referenceTypeValue(value: unknown): VideoMicroShot["referenceType"] {
  return value === "text" || value === "image_prompt" || value === "mixed"
    ? value
    : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function stringRecord(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record(value))
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}
