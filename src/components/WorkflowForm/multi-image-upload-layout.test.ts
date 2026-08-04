import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("multi-image actions only reserve columns for visible upload tiles", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/components/WorkflowForm/controls/MultiImageUploadWidget.tsx"),
    "utf8",
  );

  assert.match(source, /visibleTileCount = items\.length \+ \(canAddMore \? 1 : 0\)/);
  assert.match(source, /sm:w-fit/);
  assert.doesNotMatch(source, /max-w-\[520px\]/);
  assert.doesNotMatch(source, /min-w-\[200px\]/);
});
