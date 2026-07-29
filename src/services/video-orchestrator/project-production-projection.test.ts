import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { projectProductionProjection } from "./project-production-projection";

const base = {
  completedArtifactCount: 0,
  totalArtifactCount: 1,
  finalVideoReady: false,
};

test("an active durable job is the sole authority for a generating phase", () => {
  const projection = projectProductionProjection({
    ...base,
    jobs: [{
      id: "job-1",
      kind: "clip_prepare_submit",
      stage: "provider_polling",
      status: "waiting_upstream",
    }],
    taskGraphNodes: [{
      id: "segment-video:s1",
      type: "segment_video",
      status: "upstream_accepted",
    }],
  });
  assert.equal(projection.status, "CLIP_GENERATING");
  assert.equal(projection.source, "production_job");
  assert.deepEqual(projection.activeJobIds, ["job-1"]);
});

test("an incompatible queued job remains active but exposes an operational error", () => {
  const projection = projectProductionProjection({
    jobs: [{
      id: "job-incompatible",
      kind: "planning",
      targetId: "project-1",
      stage: "planning",
      status: "queued",
      lastError: "No compatible Worker is registered.",
      errorCode: "NO_COMPATIBLE_WORKER",
      recoveryAction: "DEPLOY_COMPATIBLE_WORKER",
    }],
    taskGraphNodes: [{ id: "planning", type: "generation", status: "running" }],
    completedArtifactCount: 0,
    totalArtifactCount: 1,
    finalVideoReady: false,
  });
  assert.equal(projection.status, "PLANNING");
  assert.equal(projection.errorCode, "NO_COMPATIBLE_WORKER");
  assert.equal(projection.recoveryAction, "DEPLOY_COMPATIBLE_WORKER");
});

test("an infrastructure-interrupted job projects automatic recovery instead of planning failure", () => {
  const projection = projectProductionProjection({
    ...base,
    jobs: [{
      id: "recovering-planning-job",
      kind: "planning",
      stage: "planning",
      status: "queued",
      errorCode: "INFRASTRUCTURE_RECOVERY_QUEUED",
      recoveryAction: "AUTO_RETRY_INFRASTRUCTURE",
      lastError: "Worker restarted; checkpoint preserved.",
    }],
    taskGraphNodes: [{
      id: "planning",
      type: "planning",
      status: "running",
    }],
  });

  assert.equal(projection.status, "WAITING_RECOVERY");
  assert.equal(projection.retryable, true);
  assert.equal(projection.recoveryAction, "AUTO_RETRY_INFRASTRUCTURE");
  assert.match(projection.displayMessage?.zh ?? "", /自动恢复/);
});

test("a failed job always produces a structured recovery projection", () => {
  const projection = projectProductionProjection({
    ...base,
    jobs: [{
      id: "job-failed",
      kind: "image_prepare_submit",
      stage: "contract_validation",
      status: "failed",
      errorCode: "EXECUTION_CONTRACT_INVALID",
      recoveryAction: "REPAIR_CONTRACT",
      lastError: "canonical contract missing",
      updatedAt: "2026-07-28T10:00:00.000Z",
    }],
    taskGraphNodes: [{
      id: "asset-image:a1",
      type: "asset_image",
      status: "failed",
    }],
  });
  assert.equal(projection.status, "WAITING_RECOVERY");
  assert.equal(projection.errorCode, "EXECUTION_CONTRACT_INVALID");
  assert.equal(projection.recoveryAction, "REPAIR_CONTRACT");
});

test("a completed replacement job resolves an older target failure", () => {
  const projection = projectProductionProjection({
    completedArtifactCount: 1,
    totalArtifactCount: 1,
    finalVideoReady: false,
    jobs: [
      {
        id: "old-failure",
        kind: "image_prepare_submit",
        targetId: "a1",
        artifactId: "keyframe:1:image",
        stage: "provider_submission",
        status: "failed",
        updatedAt: "2026-07-28T10:00:00.000Z",
      },
      {
        id: "replacement",
        kind: "image_prepare_submit",
        targetId: "a1",
        artifactId: "keyframe:1:image",
        stage: "provider_polling",
        status: "completed",
        updatedAt: "2026-07-28T10:01:00.000Z",
      },
    ],
    taskGraphNodes: [{
      id: "review:boundaries",
      type: "review_gate",
      status: "awaiting_review",
    }],
  });
  assert.equal(projection.status, "IMAGE_REVIEW");
  assert.equal(projection.errorCode, undefined);
});

test("review gates are authoritative when no production job is active", () => {
  const projection = projectProductionProjection({
    ...base,
    jobs: [],
    taskGraphNodes: [{
      id: "review:clips",
      type: "review_gate",
      status: "awaiting_review",
    }],
  });
  assert.equal(projection.status, "CLIP_REVIEW");
  assert.equal(projection.source, "review_gate");
});

test("an executing planning job outranks an unreachable downstream review gate", () => {
  const projection = projectProductionProjection({
    ...base,
    jobs: [{
      id: "planning-job",
      kind: "planning",
      stage: "planning",
      status: "running",
    }],
    taskGraphNodes: [
      {
        id: "planning",
        type: "planning",
        status: "running",
      },
      {
        id: "review:clips",
        type: "review_gate",
        status: "awaiting_review",
      },
    ],
  });
  assert.equal(projection.status, "PLANNING");
  assert.equal(projection.source, "production_job");
  assert.deepEqual(projection.activeJobIds, ["planning-job"]);
});

test("a durable waiting-review job still projects its review phase", () => {
  const projection = projectProductionProjection({
    ...base,
    jobs: [{
      id: "clip-review-job",
      kind: "clip_prepare_submit",
      stage: "review",
      status: "waiting_review",
    }],
    taskGraphNodes: [],
  });
  assert.equal(projection.status, "CLIP_REVIEW");
  assert.equal(projection.source, "review_gate");
});

test("unfinished frontier without an owning job is an invariant violation", () => {
  const projection = projectProductionProjection({
    ...base,
    jobs: [],
    taskGraphNodes: [{
      id: "asset-image:a1",
      type: "asset_image",
      status: "blocked",
    }],
  });
  assert.equal(projection.status, "STATE_INVARIANT_VIOLATION");
  assert.equal(projection.errorCode, "STATE_INVARIANT_VIOLATION");
  assert.equal(projection.recoveryAction, "REBUILD_TASK_GRAPH");
});

test("the projector has no candidate or provider-lease input", () => {
  const source = readFileSync(
    new URL("./project-production-projection.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /generationCandidates|providerVideoLeases|imageTaskId|clipTaskId|composeTaskId/);
});
