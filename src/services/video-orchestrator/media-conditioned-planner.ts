import {
  callStructuredVisionModel,
  structuredVisionAvailable,
  structuredVisionModelName,
} from "./generation-quality-evaluator";
import { videoPromptContractFromUnknown } from "./video-terminal-contract";
import type {
  SegmentRenderDescription,
  VideoBoundaryContract,
  VideoMediaConditionedSegmentPlan,
  VideoMicroShot,
  VideoObservedBoundaryFacts,
  VideoPlanSegment,
  VideoPromptContract,
} from "./types";

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
  "video_prompt_contract must contain 1-3 terminal_requirements with at least one hard item, 1-3 motion_steps, at most 5 preserve_requirements, at most 5 forbidden_outcomes, narrative_boundary, and shot_intent.",
].join("\n");

export async function observeApprovedBoundaryFrame(params: {
  contract: VideoBoundaryContract;
  imageUrl: string;
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
    ], OBSERVATION_SYSTEM_PROMPT);
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
}): Promise<VideoMediaConditionedSegmentPlan> {
  const refinedAt = new Date().toISOString();
  if (!structuredVisionAvailable()) {
    return fallbackPlan(params, refinedAt, "Structured vision is unavailable; retained the audited provisional motion contract.");
  }
  try {
    const raw = await callStructuredVisionModel([
      {
        type: "text",
        text: [
          `Fixed segment: ${JSON.stringify(params.segment)}`,
          `Canonical start boundary: ${JSON.stringify(params.startContract)}`,
          `Canonical end boundary: ${JSON.stringify(params.endContract)}`,
          `Observed start facts: ${JSON.stringify(params.startFacts)}`,
          `Observed end facts: ${JSON.stringify(params.endFacts)}`,
          `Provisional pre-image plan (advisory only): ${JSON.stringify(params.provisional ?? {})}`,
          `Fixed duration: ${params.segment.durationSeconds} seconds.`,
          "Output only this segment. Do not change timings, boundaries, events, assets, or story meaning.",
        ].join("\n"),
      },
      { type: "text", text: "START IMAGE — approved first-frame pixel authority." },
      { type: "image_url", image_url: { url: params.startImageUrl } },
      { type: "text", text: "END IMAGE — approved terminal-state pixel authority." },
      { type: "image_url", image_url: { url: params.endImageUrl } },
    ], MOTION_PLANNER_SYSTEM_PROMPT);
    return normalizeMediaPlan(raw, params, refinedAt);
  } catch (error) {
    return fallbackPlan(
      params,
      refinedAt,
      `Media-conditioned planning failed: ${error instanceof Error ? error.message : String(error)}`,
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
  return {
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
    motionCheckpoints: normalizeCheckpoints(
      source.motion_checkpoints ?? source.motionCheckpoints,
      params.segment,
    ),
    videoPromptContract: promptContract,
    planningStatus: "media_conditioned",
    warnings,
    refinedAt,
    modelName: structuredVisionModelName(),
  };
}

function fallbackPlan(
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
  const existingContract = videoPromptContractFromUnknown(provisional);
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
      source: "approved_end_frame",
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
  return {
    version: "media-conditioned-segment-v1",
    segmentNo: params.segment.segmentNo,
    startKeyframeNo: params.segment.startKeyframeNo,
    endKeyframeNo: params.segment.endKeyframeNo,
    startBoundaryImageUrl: params.startImageUrl,
    endBoundaryImageUrl: params.endImageUrl,
    startFrameContract: params.provisional?.startFrameContract ?? {
      canonicalBoundary: params.startContract,
      observedFacts: params.startFacts,
    },
    endFrameContract: params.provisional?.endFrameContract ?? {
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
    motionCheckpoints: params.provisional?.motionCheckpoints ?? [],
    videoPromptContract,
    planningStatus: "fallback",
    warnings: [warning],
    refinedAt,
  };
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
  return value.flatMap((item, index) => {
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
      prompt: stringValue(source.prompt, purpose),
    }];
  });
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
