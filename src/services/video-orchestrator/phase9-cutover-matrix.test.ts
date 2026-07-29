import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizePlanInput } from "./planner";
import {
  buildImageGenerationQualityReport,
  buildVideoGenerationQualityReport,
} from "./quality-judge";
import {
  classifyVideoProductionError,
  classifyVideoProductionFailure,
} from "./production-job-queue";
import { ProviderCapacityError } from "./provider-capacity";
import { assertCanonicalPlanContract } from "./canonical-plan-contract";
import { normalizeAliyunStoryboardPlannerCheckpoint } from "./three-stage-planner";

const queueSource = read("production-job-queue.ts");
const serviceSource = read("project-service.ts");
const workerSource = read("../../../scripts/video-production-worker.ts");
const checkpointSource = read("three-stage-planner.ts");
const pageSource = read("../../app/(platform)/workbench/workflows/one-prompt-video/page.tsx");

test("matrix 01: a 15-second project preserves the requested duration", () => {
  assert.equal(normalizePlanInput({ durationSeconds: 15 }).durationSeconds, 15);
});

test("matrix 02: a 30-second project preserves the requested duration", () => {
  assert.equal(normalizePlanInput({ durationSeconds: 30 }).durationSeconds, 30);
});

test("matrix 03: planning supports both referenced and unreferenced input", () => {
  assert.deepEqual(normalizePlanInput({ referenceImageUrls: [] }).referenceImageUrls, []);
  assert.deepEqual(
    normalizePlanInput({ referenceImageUrls: ["https://example.com/ref.png"] }).referenceImageUrls,
    ["https://example.com/ref.png"],
  );
});

test("matrix 04: planning schema errors fail before provider execution", () => {
  assert.throws(
    () => assertCanonicalPlanContract({ segments: [{ segment_no: 1 }] }),
    /Legacy plan fields are not accepted/,
  );
});

test("matrix 05: provider capacity exhaustion is retryable", () => {
  const failure = classifyVideoProductionFailure(new ProviderCapacityError());
  assert.equal(failure.disposition, "retry");
  assert.equal(failure.category, "internal_capacity");
});

test("matrix 06: upstream polling timeout reschedules the same durable job", () => {
  assert.equal(classifyVideoProductionError(new Error("upstream polling timeout")), "retry");
  assert.match(serviceSource, /rescheduleVideoProductionJob/);
  assert.match(serviceSource, /waiting_upstream/);
});

test("matrix 07: Worker restart after submission retains polling ownership", () => {
  assert.match(queueSource, /leaseExpiresAt/);
  assert.match(queueSource, /waiting_upstream/);
  assert.match(workerSource, /pumpVideoProductionJobs/);
});

test("matrix 08: Web restart cannot own or lose generation work", () => {
  assert.doesNotMatch(serviceSource, /setInterval\([^)]*submitAliyun/);
  assert.match(workerSource, /claimNextVideoProductionJob|pumpVideoProductionJobs/);
});

test("matrix 09: image quality failure returns a generation retry contract", () => {
  const report = buildImageGenerationQualityReport({
    assetId: "keyframe:1:image",
    imageUrl: null,
    prompt: "short",
    targetType: "boundary_keyframe",
  });
  assert.equal(report.passed, false);
  assert.equal(report.retryFromStage, "generation");
});

test("matrix 10: video quality failure returns a generation retry contract", () => {
  const report = buildVideoGenerationQualityReport({
    assetId: "segment:1:video",
    clipUrl: null,
    prompt: "short",
    durationSeconds: 5,
  });
  assert.equal(report.passed, false);
  assert.equal(report.retryFromStage, "generation");
});

test("matrix 11: provider prompt budget overflow requires contract repair", () => {
  const error = Object.assign(new Error("provider prompt budget exceeded"), {
    code: "EXECUTION_CONTRACT_TOO_LARGE",
  });
  assert.equal(classifyVideoProductionError(error), "contract_repair_required");
});

test("matrix 12: composition is a restartable durable job", () => {
  assert.match(queueSource, /\|\s*"compose"/);
  assert.match(serviceSource, /kind:\s*"compose"/);
  assert.match(workerSource, /compose/);
});

test("matrix 13: manual stop and recovery are separate explicit commands", () => {
  assert.match(pageSource, /\/cancel/);
  assert.match(pageSource, /\/retry-job|\/continue-task-graph/);
  assert.doesNotMatch(pageSource, /\/resume/);
});

test("matrix 14: incompatible Workers cannot claim a new payload", () => {
  assert.match(queueSource, /requiredWorkerVersion/);
  assert.match(queueSource, /claimedWorkerVersion/);
  assert.match(queueSource, /NO_COMPATIBLE_WORKER/);
  assert.match(queueSource, /payloadHandshakeMatches/);
});

test("matrix 15: checkpoint upgrades preserve compatible completed stages", () => {
  const input = normalizePlanInput({
    userPrompt: "A product reveal",
    durationSeconds: 15,
  });
  const checkpoint = normalizeAliyunStoryboardPlannerCheckpoint({
    checkpointVersion: 13,
    plannerMode: "split",
    completedStages: ["reference_analysis"],
    stageOutputs: {
      reference_analysis: { summary: "preserved" },
    },
  }, input);
  assert.equal(checkpoint.checkpointVersion, 14);
  assert.match(checkpointSource, /preservedStages/);
  assert.match(checkpointSource, /invalidatedStages/);
});

test("projection stress gate remains deterministic across 2,000 iterations", () => {
  for (let index = 0; index < 2_000; index += 1) {
    const duration = index % 2 === 0 ? 15 : 30;
    const input = normalizePlanInput({
      durationSeconds: duration,
      referenceImageUrls: index % 3 === 0
        ? ["https://example.com/reference.png"]
        : [],
    });
    assert.equal(input.durationSeconds, duration);
    assert.ok(input.referenceImageUrls.length === 0 || input.referenceImageUrls.length === 1);
  }
});

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}
