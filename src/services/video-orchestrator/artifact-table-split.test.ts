import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const schema = read("prisma/schema.prisma");
const migration = read(
  "prisma/migrations/20260722110000_split_video_artifacts/migration.sql",
);
const store = read("src/services/video-orchestrator/plan-artifact-store.ts");
const service = read("src/services/video-orchestrator/project-service.ts");
const canonicalContract = read(
  "src/services/video-orchestrator/canonical-plan-contract.ts",
);

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

test("all eight artifact classes remain revisioned database entities", () => {
  for (const model of models) {
    assert.match(schema, new RegExp(`model ${model} \\{`));
  }
  assert.equal(
    (schema.match(/@@unique\(\[projectId, [^\]]*revision\]\)/g) ?? []).length,
    8,
  );
});

test("artifact tables are the only runtime authority without independent flags", () => {
  const sources = `${store}\n${service}`;
  assert.doesNotMatch(
    sources,
    /ONE_PROMPT_ARTIFACT_TABLES_(?:DUAL_WRITE|READ)/,
  );
  assert.doesNotMatch(service, /mirrorPlanArtifactsToTables/);
  assert.match(service, /readArtifactPlan\(project\.id/);
  assert.match(service, /commitArtifactPlan/);
});

test("GET project is read-only and never backfills from planJson", () => {
  const start = service.indexOf("export async function getVideoProject(");
  const end = service.indexOf(
    "\nexport async function getVideoSegmentClipForDownload",
    start,
  );
  const body = service.slice(start, end);
  assert.match(body, /readArtifactPlan/);
  assert.doesNotMatch(body, /videoProject\.update|canonicalizePlanFieldAliases/);
  assert.doesNotMatch(
    body,
    /ensurePlanArtifactsBackfilled|hydratePlanArtifactsFromTables/,
  );
});

test("runtime commits tables before deriving the planJson snapshot", () => {
  const start = store.indexOf("export async function commitArtifactPlan(");
  const end = store.indexOf(
    "\nexport async function readArtifactPlan",
    start,
  );
  const body = store.slice(start, end);
  const tableWrite = body.indexOf("writeArtifactPlanTables");
  const snapshotWrite = body.indexOf("writeExecutionSnapshot");
  const compatibilityWrite = body.indexOf("videoProject.update");
  assert.ok(
    tableWrite >= 0
      && snapshotWrite > tableWrite
      && compatibilityWrite > snapshotWrite,
  );
  assert.doesNotMatch(service, /data:\s*\{\s*planJson:/);
});

test("post-cutover runtime rejects aliases and verifies the authority snapshot", () => {
  assert.match(canonicalContract, /NonCanonicalPlanFieldError/);
  assert.match(canonicalContract, /assertCanonicalPlanContract/);
  assert.doesNotMatch(store, /canonicalizePlanFieldAliases/);
  assert.match(store, /invalid artifact execution snapshot hash/);
  assert.match(store, /ARTIFACT_MIGRATION_QUARANTINED/);
  assert.match(store, /ARTIFACT_MIGRATION_MARKER/);
  assert.match(store, /ARTIFACT_EXECUTION_SNAPSHOT/);
});

test("the original table migration never destroys planJson", () => {
  for (const table of [
    "video_consistency_anchor_images",
    "video_anchor_reference_views",
    "video_reference_selection_outputs",
    "video_prompt_compilations",
    "video_generation_quality_reports",
    "video_audio_assets",
    "video_transition_references",
    "video_artifact_metadata",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
  }
  assert.doesNotMatch(
    migration,
    /DROP\s+(?:COLUMN|TABLE)|DELETE\s+FROM|plan_json/i,
  );
});

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}
