import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/components/WorkflowForm/WorkflowStudio.tsx", "utf8");

test("opening a tool adds an in-page browser history entry", () => {
  assert.match(source, /WORKFLOW_STUDIO_HISTORY_KEY/);
  assert.match(source, /window\.history\.pushState/);
  assert.match(source, /\[WORKFLOW_STUDIO_HISTORY_KEY\]: sku\.skuId/);
});

test("browser back restores the gallery and forward restores the tool", () => {
  assert.match(source, /window\.addEventListener\("popstate"/);
  assert.match(source, /setView\("gallery"\)/);
  assert.match(source, /applySku\(sku\)/);
  assert.match(source, /setView\("studio"\)/);
});

test("the built-in back action uses the same history entry", () => {
  assert.match(source, /currentState\?\.\[WORKFLOW_STUDIO_HISTORY_KEY\]/);
  assert.match(source, /window\.history\.back\(\)/);
});
