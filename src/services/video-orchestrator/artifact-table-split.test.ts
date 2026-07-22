import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(path.join(root, "prisma/migrations/20260722110000_split_video_artifacts/migration.sql"), "utf8");
const store = readFileSync(path.join(root, "src/services/video-orchestrator/plan-artifact-store.ts"), "utf8");
const service = readFileSync(path.join(root, "src/services/video-orchestrator/project-service.ts"), "utf8");

const models = [
  "VideoConsistencyAnchorImage",
  "VideoAnchorReferenceView",
  "VideoReferenceSelectionOutput",
  "VideoPromptCompilation",
  "VideoGenerationQualityReport",
  "VideoAudioAsset",
  "VideoTransitionReference",
  "VideoArtifactMetadata",
];

test("phase 10 defines all eight revisioned artifact tables", () => {
  for (const model of models) {
    assert.match(schema, new RegExp(`model ${model} \\{`));
  }
  assert.equal((schema.match(/@@unique\(\[projectId, [^\]]*revision\]\)/g) ?? []).length, 8);
});

test("migration creates all tables without altering or deleting plan_json", () => {
  for (const table of [
    "video_consistency_anchor_images",
    "video_anchor_reference_views",
    "video_reference_selection_outputs",
    "video_prompt_compilations",
    "video_generation_quality_reports",
    "video_audio_assets",
    "video_transition_references",
    "video_artifact_metadata",
  ]) assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
  assert.doesNotMatch(migration, /DROP\s+(?:COLUMN|TABLE)|DELETE\s+FROM|plan_json/i);
});

test("dual write is opt-in and planJson remains the compatibility mirror", () => {
  assert.match(store, /ONE_PROMPT_ARTIFACT_TABLES_DUAL_WRITE/);
  assert.match(store, /if \(!options\?\.force && !artifactTableDualWriteEnabled\(\)\) return/);
  assert.match(service, /data: \{ planJson: plan as Prisma\.InputJsonValue \}/);
  assert.match(service, /mirrorPlanArtifactsToTables\(projectId, plan\)/);
  assert.doesNotMatch(store, /delete\s+plan\.(?:referenceSelectionOutputs|promptDebugArtifacts|generationQualityReports|artifactMetadata|audioBible|transitionReferenceArtifacts)/);
});

test("read switching is opt-in and overlays only latest table revisions", () => {
  assert.match(store, /ONE_PROMPT_ARTIFACT_TABLES_READ/);
  assert.match(store, /if \(!artifactTableReadEnabled\(\)\) return planValue/);
  assert.match(store, /orderBy: \[\{ targetArtifactId: "asc" \}, \{ revision: "desc" \}\]/);
  assert.match(store, /latestPayloads/);
  assert.match(store, /if \(views\.length\) plan\.consistencyReferences/);
  assert.match(store, /if \(selections\.length\) plan\.referenceSelectionOutputs/);
  assert.match(store, /if \(metadata\.length\) plan\.artifactMetadata/);
  assert.match(service, /hydratePlanArtifactsFromTables\(project\.id, project\.planJson\)/);
});

test("backfill performs mirror then reconciliation before read cutover", () => {
  const script = readFileSync(path.join(root, "scripts/backfill-one-prompt-artifact-tables.ts"), "utf8");
  const mirrorIndex = script.indexOf("mirrorPlanArtifactsToTables");
  const compareIndex = script.indexOf("comparePlanJsonAndArtifactTables", mirrorIndex);
  assert.ok(mirrorIndex >= 0 && compareIndex > mirrorIndex);
  assert.match(script, /mismatched/);
  assert.match(script, /process\.exitCode = 1/);
});

test("high-frequency writers mirror reference, prompt, quality and metadata outputs", () => {
  for (const functionName of ["saveReferenceSelectionOutput", "savePromptDebugArtifact", "saveGenerationQualityReport", "updateProjectArtifactStatus"]) {
    const start = service.indexOf(`function ${functionName}`);
    const next = service.indexOf("\nfunction ", start + 10);
    const body = service.slice(start, next > start ? next : undefined);
    assert.match(body, /mirrorPlanArtifactsToTables/);
  }
});
