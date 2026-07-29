import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const schema = read("prisma/schema.prisma");
const removalMigration = read(
  "prisma/migrations/20260728235900_remove_legacy_video_execution_structure/migration.sql",
);
const planRoute = read("src/app/api/video-projects/[projectId]/plan/route.ts");
const productionSources = [
  schema,
  ...sourceFiles(path.join(root, "src"))
    .filter((file) => !file.endsWith(".test.ts"))
    .map((file) => readFileSync(file, "utf8")),
].join("\n");

const removedTokens = [
  ["model", "Video", "Shot"].join(" "),
  ["project", "reconcile"].join("_"),
  ["pumpGlobal", "VideoProviderQueue"].join(""),
  ["compose", "TaskId"].join(""),
  ["image", "TaskId"].join(""),
  ["clip", "TaskId"].join(""),
  ["segmentToEditor", "Shot"].join(""),
  ["buildLegacy", "VideoPromptContract"].join(""),
  ["ONE_PROMPT", "ARTIFACT_TABLES_"].join("_"),
];

test("legacy database entities and task pointer fields are absent from Prisma", () => {
  for (const token of removedTokens) {
    assert.equal(productionSources.includes(token), false, `${token} must be absent`);
  }
});

test("historical values are archived before destructive schema removal", () => {
  assert.match(removalMigration, /CREATE TABLE "video_legacy_execution_archive"/);
  assert.match(removalMigration, /INSERT INTO "video_legacy_execution_archive"/);
  const firstDrop = removalMigration.indexOf("DROP TABLE");
  const lastArchiveInsert = removalMigration.lastIndexOf(
    'INSERT INTO "video_legacy_execution_archive"',
  );
  assert.ok(lastArchiveInsert >= 0 && firstDrop > lastArchiveInsert);
  assert.match(removalMigration, /DROP TABLE "video_shots"/);
  assert.match(removalMigration, /ALTER TABLE "video_projects" DROP COLUMN "compose_task_id"/);
  assert.match(removalMigration, /ALTER TABLE "video_keyframes" DROP COLUMN "image_task_id"/);
  assert.match(removalMigration, /ALTER TABLE "video_segments" DROP COLUMN "clip_task_id"/);
});

test("only segment and keyframe media routes remain", () => {
  assert.equal(
    existsSync(path.join(root, "src/app/api/video-projects/[projectId]/shots/[shotId]/route.ts")),
    false,
  );
  assert.equal(
    existsSync(path.join(root, "src/app/api/video-projects/[projectId]/sync/route.ts")),
    false,
  );
  assert.equal(
    existsSync(path.join(root, "src/app/api/video-projects/[projectId]/segments/[segmentId]/route.ts")),
    true,
  );
  assert.equal(
    existsSync(path.join(root, "src/app/api/video-projects/[projectId]/keyframes/[keyframeId]/route.ts")),
    true,
  );
  assert.doesNotMatch(planRoute, /export async function PATCH/);
});

test("runtime canonical plan contract rejects aliases instead of selecting priority", () => {
  const contract = read(
    "src/services/video-orchestrator/canonical-plan-contract.ts",
  );
  assert.match(contract, /NonCanonicalPlanFieldError/);
  assert.match(contract, /LEGACY_KEYS/);
  assert.doesNotMatch(contract, /canonicalizeGroup|first\.value/);
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const target = path.join(directory, name);
    if (statSync(target).isDirectory()) return sourceFiles(target);
    return target.endsWith(".ts") || target.endsWith(".tsx") ? [target] : [];
  });
}

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}
