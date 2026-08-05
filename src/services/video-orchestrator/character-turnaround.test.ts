import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { validateOnePromptVideoPlan } from "./plan-validator";
import type { OnePromptVideoPlan } from "./types";
import { applyCharacterTurnaroundPoseContract, requiredApprovedAssetViewsForTarget } from "./project-service";

test("character turnaround enforces the sequential approval chain", () => {
  assert.deepEqual(requiredApprovedAssetViewsForTarget("front"), []);
  assert.deepEqual(requiredApprovedAssetViewsForTarget("side"), ["front"]);
  assert.deepEqual(requiredApprovedAssetViewsForTarget("back"), ["front", "side"]);
});

test("character turnaround plan validates three independent views and their sources", () => {
  const plan = turnaroundPlan();
  const validIssues = validateOnePromptVideoPlan(plan, { stage: "keyframe_generation" });
  assert.equal(validIssues.some((issue) => issue.severity === "error"), false);

  const invalid = structuredClone(plan);
  invalid.consistencyReferences[2].sourceView = "front";
  const invalidIssues = validateOnePromptVideoPlan(invalid, { stage: "keyframe_generation" });
  assert.ok(invalidIssues.some((issue) => issue.code === "CHARACTER_TURNAROUND_BACK_SOURCE_INVALID"));
});

test("T-pose mode applies the 3D modeling pose contract to every view", () => {
  const plan = applyCharacterTurnaroundPoseContract(
    turnaroundPlan() as unknown as OnePromptVideoPlan,
    "t_pose",
  );
  assert.equal(plan.characterPose, "t_pose");
  assert.equal(plan.consistencyReferences?.length, 3);
  for (const reference of plan.consistencyReferences ?? []) {
    assert.match(reference.imagePromptEn ?? "", /strict symmetrical 3D-modeling T-pose/);
    assert.doesNotMatch(reference.imagePromptEn ?? "", /standing neutral pose/i);
    assert.match(reference.negativePromptEn ?? "", /arms lowered/);
  }
});

test("image catalog and dedicated workbench page expose the turnaround workflow", () => {
  const catalog = source("src/app/api/skus/route.ts");
  const route = source("src/app/api/character-turnarounds/route.ts");
  const page = source("src/app/(platform)/workbench/tools/character-turnaround/page.tsx");
  const service = source("src/services/video-orchestrator/project-service.ts");
  assert.match(catalog, /skuId: "CHARACTER_TURNAROUND"/);
  assert.match(catalog, /category: "image"/);
  assert.match(catalog, /href: "\/workbench\/tools\/character-turnaround"/);
  assert.match(route, /createCharacterTurnaroundProject/);
  assert.match(route, /body\.pose === "t_pose"/);
  assert.match(page, /VIEW_ORDER\.map/);
  assert.match(page, /T 字姿势（3D）/);
  assert.match(page, /body: JSON\.stringify\(\{ referenceImageUrl, characterDescription, aspectRatio, pose \}\)/);
  assert.doesNotMatch(page, /approveFrame/);
  assert.doesNotMatch(page, /approveFront:/);
  assert.doesNotMatch(page, /approveSide:/);
  assert.doesNotMatch(page, /approveBack:/);
  assert.doesNotMatch(page, /LockKeyhole/);
  assert.match(page, /generatedCount/);
  assert.match(page, /useFileDrop/);
  assert.match(page, /\.\.\.dropZoneProps/);
  assert.match(page, /dropActive/);
  assert.match(page, /file\.type\.startsWith\("image\/"\)/);
  assert.match(page, /ACTIVE_JOB_STATUSES/);
  assert.match(page, /project\?\.productionJobs/);
  assert.doesNotMatch(page, /project\?\.status === "IMAGE_GENERATING"/);
  assert.match(page, /queuedByProject/);
  assert.match(page, /runNextAction/);
  assert.match(page, /regenerateSelected/);
  assert.match(page, /setNotice/);
  assert.match(page, /saveFileWithPicker/);
  assert.match(page, /downloadFrame/);
  assert.doesNotMatch(page, /target="_blank"/);
  assert.doesNotMatch(page, /copy\.model/);
  assert.match(page, /startNewTask/);
  assert.match(page, /continueLastTask/);
  assert.match(page, /localStorage\.removeItem\(PROJECT_STORAGE_KEY\)/);
  assert.doesNotMatch(page, /if \(selected\) await loadProject\(selected\.id, true\)/);
  assert.doesNotMatch(page, /copy\.history/);
  assert.match(service, /Approved front view retained as direct identity evidence for back-view generation/);
  assert.match(service, /normalizeCharacterTurnaroundProductionProjection/);
  assert.match(service, /character_turnaround\.auto_advance/);
  assert.match(service, /updateVideoKeyframe\(userId, projectId, nextReadyView\.id, \{ locked: true \}\)/);
  assert.match(service, /keyframeVersion: keyframe\.updatedAt\.toISOString\(\)/);
  assert.match(service, /awaitingAssetApproval && projection\.status === "STATE_INVARIANT_VIOLATION"/);
  assert.match(service, /if \(canonicalPlanChanged\) \{\s*await syncCanonicalPlanFromEntities/);
  const imageSubmissionWorker = service.slice(
    service.indexOf("async function submitNextImageTaskWork"),
    service.indexOf("async function submitNextClipTask"),
  );
  assert.match(imageSubmissionWorker, /VideoShotStatus\.SCRIPT_READY,\s*VideoShotStatus\.IMAGE_PENDING,\s*VideoShotStatus\.IMAGE_RUNNING/);
});

function turnaroundPlan() {
  const reference = (view: "front" | "side" | "back", keyframeNo: number, sourceView?: "front" | "side") => ({
    kind: "character",
    needed: true,
    keyframeNo,
    anchorId: "turnaround-character",
    assetId: `turnaround-character:${view}`,
    assetCategory: "person",
    assetView: view,
    sourceView,
    sourceArtifactId: sourceView ? `turnaround-character:${sourceView}` : undefined,
    orientation: view,
    viewGenerationMode: view === "front" ? "primary" : view === "side" ? "derived_from_front" : "derived_from_side",
    purpose: `${view} view`,
    scene: "plain background",
    characterState: `${view} view`,
    productState: "",
    imagePrompt: `${view} view`,
    negativePrompt: "collage",
  });
  return {
    workflowKind: "character_turnaround",
    title: "Character turnaround",
    logline: "One identity, three views",
    durationSeconds: 0,
    aspectRatio: "9:16",
    keyframeCount: 0,
    segmentCount: 0,
    styleBible: {
      visualStyle: "reference matched",
      characterLock: "same identity",
      colorPalette: "reference matched",
      negativePrompt: "identity drift",
    },
    consistencyManifest: {
      anchors: [{
        id: "turnaround-character",
        type: "person",
        mustStayConsistent: true,
        needsReferenceImage: true,
        referenceStrength: "hard",
        status: "approved",
      }],
    },
    consistencyReferences: [
      reference("front", -1000),
      reference("side", -1001, "front"),
      reference("back", -1002, "side"),
    ],
    keyframes: [],
    segments: [],
  };
}

function source(file: string): string {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}
