import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  assertModelRepairPlan,
  buildModelRepairPlan,
  diffDeterministicChanges,
  recordDeterministicChange,
  validateModelRepairPlan,
} from "./repair-plan.ts";

const plannerSource = readFileSync(
  path.join(process.cwd(), "src/services/video-orchestrator/three-stage-planner.ts"),
  "utf8",
);

test("model repair plan converts audit issues into explicit scoped operations", () => {
  const plan = buildModelRepairPlan({
    targetStage: "split_repair",
    issues: [{
      code: "MOTION_CHECKPOINT_CONTAINS_CUT",
      segmentNo: 3,
      reason: "motion_checkpoint_contains_cut:motionCheckpoints[1].actionZh",
      messageZh: "中间状态包含切镜",
      repairable: true,
    }],
    preserveRules: ["Preserve segment duration."],
  });
  assert.equal(plan.targetScope.kind, "segments");
  assert.deepEqual(plan.targetScope.segmentNos, [3]);
  assert.equal(plan.operations[0].action, "update");
  assert.equal(plan.operations[0].path, "motionCheckpoints[1].actionZh");
  assert.match(plan.operations[0].desiredChange, /continuous physically reachable action/);
  assert.ok(plan.operations[0].acceptanceCriteria.length >= 2);
  assert.doesNotThrow(() => assertModelRepairPlan(plan));
});

test("model repair plan distinguishes add and delete operations", () => {
  const plan = buildModelRepairPlan({
    targetStage: "story_contract_repair",
    issues: [
      { code: "STORY_BEATS_MISSING", path: "story_beats", repairHint: "Add required beats." },
      { code: "BEAT_ID_DUPLICATE", path: "story_beats[2].beat_id", repairHint: "Delete or replace the duplicate identifier." },
    ],
  });
  assert.deepEqual(plan.operations.map((operation) => operation.action), ["add", "delete"]);
  assert.deepEqual(validateModelRepairPlan(plan), []);
});

test("deterministic changes require an exact path and acceptance criteria", () => {
  const change = recordDeterministicChange({
    action: "update",
    path: "planning_manifest.timeline_blueprint.segments[1].start_time_seconds",
    before: 6,
    after: 5,
    reasonCode: "TIMELINE_CONTINUITY",
    acceptanceCriteria: ["No gap or overlap remains."],
  });
  assert.equal(change.version, "deterministic-change-v1");
  assert.equal(change.before, 6);
  assert.equal(change.after, 5);
});

test("deterministic program repair records exact add update and delete paths", () => {
  const changes = diffDeterministicChanges({
    before: { segment: { duration: 6, obsolete: true } },
    after: { segment: { duration: 5, reason: "reachable action" } },
    reasonCode: "TIMELINE_NORMALIZATION",
    acceptanceCriteria: ["The normalized timeline validates."],
  });
  assert.deepEqual(
    changes.map((change) => [change.action, change.path]),
    [
      ["update", "$.segment.duration"],
      ["delete", "$.segment.obsolete"],
      ["add", "$.segment.reason"],
    ],
  );
});

test("every major model repair path carries the structured execution contract", () => {
  for (const stage of [
    "asset_prompt_contract_repair",
    "timeline_replan",
    "planning_duration_repair",
    "planning_contract_repair",
    "story_contract_repair",
    "story_semantic_repair",
    "shot_decomposer_contract_repair",
    "story_quality_rewrite",
    "split_repair",
    "asset_visual_spec_repair",
  ]) {
    assert.match(plannerSource, new RegExp(`targetStage:\\s*"${stage}"`));
  }
  assert.match(plannerSource, /STRUCTURED REPAIR EXECUTION CONTRACT/);
  assert.match(plannerSource, /automatic_repair\.plan\.created/);
  assert.match(plannerSource, /deterministic_repair\.change_log/);
});
