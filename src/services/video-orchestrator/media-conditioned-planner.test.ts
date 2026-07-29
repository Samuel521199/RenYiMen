import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalMotionContractFromPlannerOutput,
  compactFallbackCheckpoints,
  materializeResolvedMicroShots,
  mediaConditionedCheckpointLimit,
  staticFrameContractFromApprovedBoundary,
  validateMediaConditionedSegmentPlan,
} from "./media-conditioned-planner";
import type {
  VideoBoundaryContract,
  VideoMicroShot,
  VideoObservedBoundaryFacts,
  VideoPlanSegment,
} from "./types";

const intent: VideoMicroShot = {
  microShotNo: 7,
  localTimeSeconds: 2,
  absoluteTimeSeconds: 12,
  purpose: "Raise the product",
  scene: "Game room",
  action: "The heroine begins raising the phone.",
  camera: "Medium shot",
  referenceType: "image_prompt",
  imagePrompt: "Early screenplay-only image prompt.",
  usesConsistencyAnchors: ["heroine", "phone"],
  prompt: "Raise the product.",
};

const segment: VideoPlanSegment = {
  segmentNo: 2,
  startKeyframeNo: 2,
  endKeyframeNo: 3,
  startTimeSeconds: 10,
  endTimeSeconds: 14,
  durationSeconds: 4,
  purpose: "Show the victory",
  motion: "Raise the phone and turn.",
  camera: "One continuous medium shot.",
  subjectMotion: "Raise and turn.",
  environmentMotion: "Subtle ambient motion.",
  videoPrompt: "Show the victory.",
  subtitle: "",
  negativePrompt: "",
  usesConsistencyAnchors: ["heroine", "phone"],
  microShots: [intent],
};

function observed(
  keyframeNo: number,
  imageUrl: string,
  composition: string,
): VideoObservedBoundaryFacts {
  return {
    version: "observed-boundary-facts-v1",
    keyframeNo,
    imageUrl,
    observedAt: "2026-07-27T00:00:00.000Z",
    contractPassed: true,
    scene: "Game room",
    cameraView: "Medium shot",
    composition,
    characterState: "Heroine in a red jacket",
    productState: "Black phone in hand",
    anchorPositions: {},
    occlusions: [],
    lighting: "Soft key light",
    uncertainties: [],
  };
}

test("materialization treats early micro-shots as intent and media checkpoints as authority", () => {
  const result = materializeResolvedMicroShots({
    checkpoints: [{
      ...intent,
      microShotNo: 1,
      localTimeSeconds: 2.25,
      absoluteTimeSeconds: 12.25,
      action: "The heroine has raised the phone halfway and is turning toward camera.",
      imagePrompt: "",
    }],
    segment,
    startFacts: observed(2, "https://example.com/start.png", "heroine faces left"),
    endFacts: observed(3, "https://example.com/end.png", "victorious frontal pose"),
    startImageUrl: "https://example.com/start.png",
    endImageUrl: "https://example.com/end.png",
    refinedAt: "2026-07-27T01:00:00.000Z",
    planningSource: "media_conditioned",
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].microShotNo, 7);
  assert.equal(result[0].sourceIntentMicroShotNo, 7);
  assert.equal(result[0].action, "The heroine has raised the phone halfway and is turning toward camera.");
  assert.equal(result[0].referenceType, "image_prompt");
  assert.match(result[0].imagePrompt ?? "", /approved opening composition/i);
  assert.equal(result[0].imageUrl, undefined);
  assert.equal(result[0].planningSource, "media_conditioned");
  assert.match(result[0].resolvedRevisionId ?? "", /^resolved-micro-shots-v1:/);
});

test("resolved revision is deterministic for the same boundaries and changes with a boundary", () => {
  const base = {
    checkpoints: [intent],
    segment,
    startFacts: observed(2, "https://example.com/start.png", "heroine faces left"),
    endFacts: observed(3, "https://example.com/end.png", "victorious frontal pose"),
    startImageUrl: "https://example.com/start.png",
    refinedAt: "2026-07-27T01:00:00.000Z",
    planningSource: "media_conditioned" as const,
  };
  const first = materializeResolvedMicroShots({
    ...base,
    endImageUrl: "https://example.com/end.png",
  });
  const repeated = materializeResolvedMicroShots({
    ...base,
    endImageUrl: "https://example.com/end.png",
  });
  const changed = materializeResolvedMicroShots({
    ...base,
    endImageUrl: "https://example.com/end-v2.png",
  });

  assert.equal(first[0].resolvedRevisionId, repeated[0].resolvedRevisionId);
  assert.notEqual(first[0].resolvedRevisionId, changed[0].resolvedRevisionId);
});

test("media-conditioned checkpoint budget is capped at three", () => {
  assert.equal(mediaConditionedCheckpointLimit(2), 1);
  assert.equal(mediaConditionedCheckpointLimit(7), 3);
  assert.equal(mediaConditionedCheckpointLimit(30), 3);
});

test("approved boundary facts deterministically own the static endpoint contract", () => {
  const contract: VideoBoundaryContract = {
    version: "boundary-contract-v1",
    keyframeNo: 3,
    timeSeconds: 14,
    ownerSegmentNo: 2,
    sourceEventIds: [],
    linkedBeatIds: [],
    requiredAnchorIds: ["heroine"],
    approvedAssetReferenceIds: [],
    storyState: "The heroine moves from the left to the right.",
    scene: "Game room",
    characterState: "The heroine is moving toward the camera.",
    productState: "Phone in hand",
    immutableFields: [],
    forbiddenStoryStates: [],
    status: "image_approved",
  };
  const facts = observed(
    3,
    "https://example.com/end.png",
    "The heroine is transitioning from the left to the right.",
  );
  facts.characterState = "The heroine is moving toward the camera.";

  const endpoint = staticFrameContractFromApprovedBoundary(contract, facts);

  assert.equal(endpoint.authority, "approved_boundary_image");
  assert.equal(endpoint.imageUrl, "https://example.com/end.png");
  assert.equal(endpoint.staticStateOnly, true);
  assert.doesNotMatch(JSON.stringify(endpoint), /\bmoving|transitioning from\b/i);
});

test("planner motion prose is canonicalized once at the model boundary", () => {
  const motion = canonicalMotionContractFromPlannerOutput({
    type: "continuous_dolly_in",
    subject_action: "The sphere rolls toward the lens.",
    camera_action: "Smooth push-in.",
    prop_paths: ["sphere follows the optical axis"],
  }, {
    segment,
    startFacts: observed(2, "https://example.com/start.png", "wide framing"),
    endFacts: observed(3, "https://example.com/end.png", "macro framing"),
  });

  assert.equal(motion.version, "continuous-motion-contract-v1");
  assert.equal(motion.continuous_time, true);
  assert.deepEqual(motion.camera_motion, {
    type: "dolly_in",
    start: "Medium shot",
    end: "Medium shot",
  });
  assert.deepEqual(motion.subject_actions, [{
    subject: "heroine",
    action: "The sphere rolls toward the lens.",
  }]);
});

test("provisional checkpoint compaction preserves authored first, middle, and last states", () => {
  const checkpoints = Array.from({ length: 5 }, (_value, index) => ({
    ...intent,
    microShotNo: index + 1,
    localTimeSeconds: index + 1,
    absoluteTimeSeconds: 10 + index + 1,
    purpose: `state-${index + 1}`,
  }));

  const compacted = compactFallbackCheckpoints(checkpoints, 3);

  assert.deepEqual(compacted.map((item) => item.purpose), ["state-1", "state-3", "state-5"]);
  assert.equal(compactFallbackCheckpoints(checkpoints, 5), checkpoints);
});

test("media-conditioned stage contract rejects invalid output before downstream generation", () => {
  const checkpoints = Array.from({ length: 4 }, (_value, index) => ({
    ...intent,
    microShotNo: index + 1,
    localTimeSeconds: index + 1,
    absoluteTimeSeconds: 10 + index + 1,
  }));
  const plan = {
    version: "media-conditioned-segment-v1" as const,
    segmentNo: segment.segmentNo,
    startKeyframeNo: segment.startKeyframeNo,
    endKeyframeNo: segment.endKeyframeNo,
    startBoundaryImageUrl: "https://example.com/start.png",
    endBoundaryImageUrl: "https://example.com/end.png",
    startFrameContract: { state: "The heroine is moving from left to right." },
    endFrameContract: { state: "The heroine stands on the right." },
    motionContract: { subjectMotion: "Move right." },
    singleTakeContract: { physicallyReachable: true },
    motionCheckpoints: checkpoints,
    resolvedMicroShots: checkpoints,
    microShotRevisionId: "revision",
    videoPromptContract: {
      version: "video-prompt-contract-v1" as const,
      terminalRequirements: [{
        requirementId: "end",
        priority: "hard" as const,
        observableFact: "The heroine stands on the right.",
        acceptanceCriteria: "Visible in the final stable frames.",
        evidenceRefs: [{ type: "approved_end_frame" as const, id: "keyframe:2" }],
        source: "approved_end_frame" as const,
        sources: ["approved_end_frame" as const],
      }],
      motionSteps: ["Move continuously to the right."],
      preserveRequirements: [],
      forbiddenOutcomes: [],
      narrativeBoundary: "Do not add later events.",
      shotIntent: "Show the move.",
    },
    planningStatus: "media_conditioned" as const,
    warnings: [],
    refinedAt: "2026-07-28T00:00:00.000Z",
  };

  assert.throws(
    () => validateMediaConditionedSegmentPlan(plan, segment),
    /static snapshot/,
  );
  plan.startFrameContract = { state: "The heroine stands on the left." };
  assert.throws(
    () => validateMediaConditionedSegmentPlan(plan, segment),
    /maximum is 2/,
  );
});

test("unreachable single-take decisions require consistent cut evidence", () => {
  const plan = {
    version: "media-conditioned-segment-v1" as const,
    segmentNo: segment.segmentNo,
    startKeyframeNo: segment.startKeyframeNo,
    endKeyframeNo: segment.endKeyframeNo,
    startBoundaryImageUrl: "https://example.com/start.png",
    endBoundaryImageUrl: "https://example.com/end.png",
    startFrameContract: { state: "The heroine stands on the left." },
    endFrameContract: { state: "The heroine stands on the right." },
    motionContract: { subjectMotion: "Move right." },
    singleTakeContract: {
      physicallyReachable: false,
      requires_cut: false,
      continuous_time: true,
      risk_level: "low",
    },
    motionCheckpoints: [],
    resolvedMicroShots: [],
    microShotRevisionId: "revision",
    videoPromptContract: {
      version: "video-prompt-contract-v1" as const,
      terminalRequirements: [{
        requirementId: "end",
        priority: "hard" as const,
        observableFact: "The heroine stands on the right.",
        acceptanceCriteria: "Visible in the final stable frames.",
        evidenceRefs: [{ type: "approved_end_frame" as const, id: "keyframe:3" }],
        source: "approved_end_frame" as const,
        sources: ["approved_end_frame" as const],
      }],
      motionSteps: ["Move continuously to the right."],
      preserveRequirements: [],
      forbiddenOutcomes: [],
      narrativeBoundary: "Do not add later events.",
      shotIntent: "Show the move.",
    },
    planningStatus: "media_conditioned" as const,
    warnings: [],
    refinedAt: "2026-07-28T00:00:00.000Z",
  };

  assert.throws(
    () => validateMediaConditionedSegmentPlan(plan, segment),
    /internally inconsistent/,
  );
});
