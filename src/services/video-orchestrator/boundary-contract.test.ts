import test from "node:test";
import assert from "node:assert/strict";
import {
  bindBoundaryContractsToApprovedAssets,
  deriveCanonicalBoundaryContracts,
  validateBoundaryContracts,
} from "./boundary-contract.ts";
import type { OnePromptVideoPlan } from "./types.ts";

function fixture(): Pick<OnePromptVideoPlan, "keyframes" | "segments" | "candidateTimeline" | "storyboardBrief"> {
  return {
    keyframes: [1, 2, 3].map((keyframeNo) => ({
      keyframeNo,
      timeSeconds: [0, 4, 10][keyframeNo - 1],
      purpose: ["ordinary state", "failed match", "reward result"][keyframeNo - 1],
      scene: "game table",
      characterState: ["focused", "tense", "relieved"][keyframeNo - 1],
      productState: ["normal", "failed", "reward"][keyframeNo - 1],
      imagePrompt: `KF${keyframeNo}`,
      negativePrompt: "",
      usesConsistencyAnchors: keyframeNo === 1 ? ["hero"] : ["hero", "game_ui"],
    })),
    segments: [1, 2].map((segmentNo) => ({
      segmentNo,
      startKeyframeNo: segmentNo,
      endKeyframeNo: segmentNo + 1,
      startTimeSeconds: [0, 4][segmentNo - 1],
      endTimeSeconds: [4, 10][segmentNo - 1],
      durationSeconds: [4, 6][segmentNo - 1],
      purpose: ["attempt and fail", "trigger reward"][segmentNo - 1],
      motion: "continuous action",
      camera: "same camera",
      subjectMotion: "hand and reaction",
      environmentMotion: "UI changes",
      videoPrompt: "",
      subtitle: "",
      negativePrompt: "",
    })),
    candidateTimeline: [1, 2].map((segmentNo) => ({
      segmentNo,
      startTimeSeconds: [0, 4][segmentNo - 1],
      endTimeSeconds: [4, 10][segmentNo - 1],
      durationSeconds: [4, 6][segmentNo - 1],
      sourceEventIds: [`event_${segmentNo}`],
      requiredAnchorIds: ["hero", "game_ui"],
    })),
    storyboardBrief: [1, 2].map((segmentNo) => ({
      segmentNo,
      eventIds: [`event_${segmentNo}`],
      narrativeFunction: segmentNo === 1 ? "conflict" : "turn",
      cameraId: "camera_a",
      locationId: "table",
      visibleAnchorIds: ["hero", "game_ui"],
    })),
  };
}

test("a shared boundary has one owner and two adjacent consumers", () => {
  const plan = fixture();
  const contracts = deriveCanonicalBoundaryContracts(plan);
  validateBoundaryContracts(plan, contracts);
  const shared = contracts.find((item) => item.keyframeNo === 2);
  assert.equal(shared?.ownerSegmentNo, 1);
  assert.equal(shared?.previousSegmentNo, 1);
  assert.equal(shared?.nextSegmentNo, 2);
  assert.deepEqual(shared?.sourceEventIds, ["event_1", "event_2"]);
});

test("asset binding does not rewrite the canonical story state", () => {
  const contracts = deriveCanonicalBoundaryContracts(fixture());
  const bound = bindBoundaryContractsToApprovedAssets(contracts, ["hero", "game_ui"]);
  assert.ok(bound.every((item) => item.status === "asset_bound"));
  assert.deepEqual(bound[1].approvedAssetReferenceIds, ["hero", "game_ui"]);
  assert.equal(bound[1].storyState, contracts[1].storyState);
});
