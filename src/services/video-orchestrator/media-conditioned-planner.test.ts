import assert from "node:assert/strict";
import test from "node:test";

import { materializeResolvedMicroShots } from "./media-conditioned-planner";
import type {
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
    planningSource: "legacy_fallback" as const,
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
