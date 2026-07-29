import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertCanonicalPlanContract } from "./canonical-plan-contract.ts";

const schema = read("prisma/schema.prisma");
const queue = read("src/services/video-orchestrator/production-job-queue.ts");
const workerRuntime = read("src/services/video-orchestrator/production-worker-runtime.ts");
const service = read("src/services/video-orchestrator/project-service.ts");
const planner = read("src/services/video-orchestrator/planner.ts");
const threeStagePlanner = read("src/services/video-orchestrator/three-stage-planner.ts");
const page = read("src/app/(platform)/workbench/workflows/one-prompt-video/page.tsx");
const migration = read(
  "prisma/migrations/20260728235000_enforce_phase3_target_contract_worker_handshake/migration.sql",
);

test("targetId is non-null and historical targets are classified without first-target inference", () => {
  assert.match(schema, /targetId\s+String\s+@map\("target_id"\)/);
  assert.match(migration, /"kind" IN \('planning', 'image_quality'\)/);
  assert.match(migration, /"kind" = 'compose'/);
  assert.match(migration, /MIGRATION_FAILED_TARGET/);
  assert.match(migration, /LENGTH\(BTRIM\("target_id"\)\) > 0/);
  assert.doesNotMatch(service, /inferredTarget|first generatable target/i);
});

test("every new payload carries the three-version handshake", () => {
  assert.match(queue, /payloadSchemaVersion:\s*VIDEO_PRODUCTION_PAYLOAD_SCHEMA_VERSION/);
  assert.match(queue, /requiredWorkerVersion,/);
  assert.match(queue, /contractVersion:\s*VIDEO_PRODUCTION_CONTRACT_VERSION/);
  assert.match(queue, /requiredWorkerVersion:\s*input\.runtimeVersion/);
  assert.doesNotMatch(queue, /\{\s*requiredWorkerVersion:\s*null\s*\}/);
});

test("worker registry advertises payload versions and claim compatibility is atomic", () => {
  assert.match(schema, /supportedPayloadVersions\s+Json/);
  assert.match(workerRuntime, /supportedPayloadVersions/);
  assert.match(queue, /supportedPayloadVersions/);
  assert.match(queue, /payload:\s*\{\s*path:\s*\["payloadSchemaVersion"\]/);
  assert.match(queue, /NO_COMPATIBLE_WORKER/);
  assert.match(queue, /DEPLOY_COMPATIBLE_WORKER/);
});

test("Chinese display edits and planner output cannot overwrite execution prompts", () => {
  const sources = [service, planner, threeStagePlanner].join("\n");
  assert.doesNotMatch(sources, /imagePrompt:\s*[^,\n]*(imagePromptZh|image_prompt_zh)/);
  assert.doesNotMatch(sources, /videoPrompt:\s*[^,\n]*(videoPromptZh|video_prompt_zh)/);
  assert.doesNotMatch(
    page,
    /imagePromptZh:\s*event\.target\.value,\s*imagePrompt:\s*event\.target\.value/,
  );
  assert.match(service, /providerPromptFromExecutionContract\(executionContract\)/);
});

test("post-cutover plan contract rejects every legacy alias", () => {
  const canonical = read("src/services/video-orchestrator/canonical-plan-contract.ts");
  assert.match(canonical, /NON_CANONICAL_PLAN_FIELD/);
  assert.match(canonical, /MIGRATE_PLAN_FIELDS/);
  assert.match(canonical, /LEGACY_KEYS/);
  assert.doesNotMatch(canonical, /canonicalizeGroup|first\.value/);
});

test("versioned planner checkpoint raw outputs remain opaque to execution alias validation", () => {
  const plan = assertCanonicalPlanContract({
    schemaVersion: 2,
    plannerCheckpoint: {
      checkpointVersion: 14,
      plannerMode: "split",
      stageOutputs: {
        story_architect: {
          planning_manifest: {
            timeline_blueprint: {
              segments: [{ segment_no: 1 }],
            },
          },
        },
      },
    },
  });
  assert.equal((plan.plannerCheckpoint as Record<string, unknown>).checkpointVersion, 14);
  assert.throws(() => assertCanonicalPlanContract({
    schemaVersion: 2,
    planning_manifest: {},
  }));
});

function read(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}
