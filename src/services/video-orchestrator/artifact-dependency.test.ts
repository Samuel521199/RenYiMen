import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ensurePlanArtifactMetadata, markPlanArtifactsDirty } from "./project-service.ts";

function dependencyPlan(): Record<string, unknown> {
  return {
    narrativeEvents: [{ id: "event_1" }],
    consistencyManifest: { anchors: [{ id: "person_1", type: "person", referenceStrength: "hard" }] },
    consistencyReferences: [
      { keyframeNo: -100, assetId: "person_1", assetView: "front" },
      { keyframeNo: -101, assetId: "person_1_side", sourceArtifactId: "person_1", assetView: "side" },
      { keyframeNo: -102, assetId: "person_1_back", sourceArtifactId: "person_1", assetView: "back" },
    ],
    keyframes: [
      { keyframeNo: 0, usesConsistencyAnchors: ["person_1"] },
      { keyframeNo: 1, usesConsistencyAnchors: ["person_1"] },
      { keyframeNo: 2, usesConsistencyAnchors: [] },
    ],
    segments: [
      { segmentNo: 1, startKeyframeNo: 0, endKeyframeNo: 1, usesConsistencyAnchors: ["person_1"], microShots: [{ microShotNo: 1, usesConsistencyAnchors: ["person_1"] }] },
      { segmentNo: 2, startKeyframeNo: 1, endKeyframeNo: 2, usesConsistencyAnchors: [], microShots: [] },
    ],
    cameraGraph: {
      cameras: [
        { cameraId: "cam_1", segmentNos: [1], locationId: "room" },
        { cameraId: "cam_2", segmentNos: [2], locationId: "room", parentCameraId: "cam_1", relationToParent: "alternate_view" },
      ],
      relations: [{ fromCameraId: "cam_1", toCameraId: "cam_2", relation: "alternate_view" }],
    },
    transitionReferenceArtifacts: [{ id: "transition_reference:cam_2:2", toCameraId: "cam_2", toSegmentNo: 2, relation: "alternate_view", mode: "short", inheritanceScope: ["space_layout"], status: "draft", parentKeyframeNo: 1, locked: false }],
    finalTransitionPlan: [{ fromSegmentNo: 1, toSegmentNo: 2, visualMode: "hard_cut" }],
    audioBible: { musicStyle: "bright" },
  };
}

test("metadata includes identity, stage and complete front-view dependency descendants", () => {
  const plan = dependencyPlan();
  const metadata = ensurePlanArtifactMetadata(plan);
  assert.equal(metadata["consistency_reference:-100:image"].artifactId, "consistency_reference:-100:image");
  assert.equal(metadata["consistency_reference:-100:image"].artifactType, "image");
  assert.equal(metadata["consistency_reference:-100:image"].producedByStage, "generation");
  assert.ok(metadata["consistency_reference:-101"].dependsOn.includes("consistency_reference:-100:image"));
  assert.ok(metadata["keyframe:0:reference_selection"].dependsOn.includes("consistency_reference:-100:image"));

  markPlanArtifactsDirty(plan, ["consistency_reference:-100:image"], "front changed");
  const dirty = plan.artifactMetadata as Record<string, { status: string; invalidatedByArtifactIds?: string[] }>;
  assert.equal(dirty["consistency_reference:-101:image"].status, "dirty");
  assert.equal(dirty["keyframe:0:image"].status, "dirty");
  assert.equal(dirty["segment:1:video"].status, "dirty");
  assert.equal(dirty.final_video.status, "dirty");
  assert.deepEqual(dirty["segment:1:video"].invalidatedByArtifactIds, ["consistency_reference:-100:image"]);
});

test("segment prompt dirtiness stays local except for final composition", () => {
  const plan = dependencyPlan();
  ensurePlanArtifactMetadata(plan);
  markPlanArtifactsDirty(plan, ["segment:1:prompt"], "segment prompt changed");
  const metadata = plan.artifactMetadata as Record<string, { status: string }>;
  assert.equal(metadata["segment:1:video"].status, "dirty");
  assert.notEqual(metadata["segment:2:video"].status, "dirty");
  assert.equal(metadata.final_video.status, "dirty");
});

test("camera and audio dependency chains reach their intended consumers", () => {
  const plan = dependencyPlan();
  const metadata = ensurePlanArtifactMetadata(plan);
  assert.ok(metadata["transition_reference:cam_2:2"].dependsOn.includes("camera:cam_2"));
  assert.ok(metadata["keyframe:1:reference_selection"].dependsOn.includes("transition_reference:cam_2:2"));
  assert.deepEqual(new Set(metadata["audio:final_mix"].dependsOn), new Set(["audio:bgm", "audio:tts", "audio:sfx"]));
  assert.ok(metadata.final_video.dependsOn.includes("audio:final_mix"));
});

test("resume and regeneration preserve active media until explicit candidate selection", () => {
  const source = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  const imageRegeneration = source.slice(source.indexOf("export async function regenerateShotImage"), source.indexOf("export async function regenerateMicroShotImage"));
  const clipRegeneration = source.slice(source.indexOf("export async function regenerateShotClip"), source.indexOf("export async function rollbackVideoMedia"));
  assert.match(source, /isRegeneration: Boolean\(keyframe\.imageUrl\)/);
  assert.match(source, /status: "recommended"/);
  assert.match(source, /running tasks are synchronized instead of resubmitted/);
  assert.match(source, /!item\.userAccepted/);
  assert.doesNotMatch(imageRegeneration, /imageUrl: null/);
  assert.doesNotMatch(clipRegeneration, /clipUrl: null/);
});
