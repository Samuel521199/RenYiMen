import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("image upload errors use a soft amber warning palette", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/components/WorkflowForm/controls/ImageUploadControl.tsx"),
    "utf8",
  );

  assert.match(source, /border-amber-400\/45/);
  assert.match(source, /bg-amber-400\/\[0\.06\]/);
  assert.match(source, /text-amber-200\/90/);
  assert.doesNotMatch(source, /text-red-(?:400|600)/);
});
