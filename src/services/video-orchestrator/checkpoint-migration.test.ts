import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const planner = read("src/services/video-orchestrator/three-stage-planner.ts");

test("checkpoint v14 keeps the canonical migration envelope", () => {
  for (const field of [
    "checkpointVersion",
    "plannerMode",
    "inputFingerprint",
    "inputSnapshot",
    "completedStages",
    "stageOutputs",
    "contractVersions",
    "referenceFingerprint",
  ]) {
    assert.match(planner, new RegExp(`\\b${field}\\b`));
  }
  assert.match(planner, /migrateCheckpointV12ToV13/);
  assert.match(planner, /migrateCheckpointV13ToV14/);
});

test("version and planner-mode changes migrate instead of emptying the checkpoint", () => {
  assert.match(planner, /migrateCheckpointEnvelopeToV14/);
  assert.match(planner, /planner_mode:\$\{historicalMode\}->split/);
  assert.doesNotMatch(
    planner,
    /checkpointVersion[^]{0,240}(return\s+empty|return\s+\{\s*version)/i,
  );
});

test("minimum invalidation boundaries and migration audit are explicit", () => {
  assert.match(planner, /reference_input_changed/);
  assert.match(planner, /story_input_changed/);
  assert.match(planner, /contract_version:\$\{stage\}/);
  assert.match(planner, /preservedStages/);
  assert.match(planner, /invalidatedStages/);
  assert.match(planner, /aliyun\.storyboard\.checkpoint\.resume_plan/);
  assert.match(planner, /failedSegmentNosFromError/);
  assert.match(
    planner,
    /stage === "final_validation"[\s\S]*?delete checkpoint\.shotDecomposerSegmentPlans\?\.\[key\]/,
  );
});

test("planner input fingerprint contains only user planning inputs", () => {
  const snapshot = planner.match(
    /function plannerInputSnapshot[\s\S]*?\n\}/,
  )?.[0] ?? "";
  assert.match(snapshot, /userPrompt/);
  assert.match(snapshot, /referenceImageUrls/);
  assert.doesNotMatch(snapshot, /workerVersion|runtimeVersion|display|codeVersion/);
});

function read(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}
