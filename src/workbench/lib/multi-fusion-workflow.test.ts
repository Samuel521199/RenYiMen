import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("multi-fusion workflow page wires API routes and reference uploads", () => {
  const pageSource = readFileSync(
    "src/app/(platform)/workbench/workflows/multi-fusion/page.tsx",
    "utf8",
  );

  assert.match(pageSource, /\/api\/multi-fusion\/jobs\/create/);
  assert.match(pageSource, /\/api\/multi-fusion\/jobs\/\$\{nextJobId\}\/generate/);
  assert.match(pageSource, /\/api\/multi-fusion\/available-models/);
  assert.match(pageSource, /MAX_REFERENCE_UPLOADS = 4/);
  assert.match(pageSource, /ModelSelector/);
  assert.match(pageSource, /gpt-image 系列/);
});

test("sidebar maps multi-fusion workflow permission key", () => {
  const sidebarSource = readFileSync("src/workbench/components/layout/Sidebar.tsx", "utf8");
  assert.match(sidebarSource, /\/workbench\/workflows\/multi-fusion": "multi_fusion"/);
});
