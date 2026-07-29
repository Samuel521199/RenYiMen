import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const service = readFileSync(
  path.join(root, "src/services/video-orchestrator/project-service.ts"),
  "utf8",
);
const page = readFileSync(
  path.join(root, "src/app/(platform)/workbench/workflows/one-prompt-video/page.tsx"),
  "utf8",
);

test("project deletion bypasses artifact hydration and is ownership-scoped and idempotent", () => {
  const start = service.indexOf("export async function deleteVideoProject(");
  const end = service.indexOf("\nexport async function cancelVideoProject(", start);
  assert.ok(start >= 0 && end > start);
  const body = service.slice(start, end);

  assert.match(body, /videoProject\.deleteMany/);
  assert.match(body, /where:\s*\{\s*id:\s*projectId,\s*userId\s*\}/);
  assert.doesNotMatch(body, /requireVideoProject|getVideoProject|readArtifactPlan/);
});

test("deleted projects cannot be restored by late polling responses", () => {
  assert.match(page, /deletedProjectIdsRef\s*=\s*useRef<Set<string>>/);
  assert.match(page, /deletedProjectIdsRef\.current\.add\(projectId\)/);
  assert.match(page, /if\s*\(deletedProjectIdsRef\.current\.has\(nextProject\.id\)\)\s*return/);
  assert.match(
    page,
    /res\.project\s*&&\s*!deletedProjectIdsRef\.current\.has\(projectId\)/,
  );
  assert.match(page, /deletedProjectIdsRef\.current\.delete\(projectId\)/);
});
