import assert from "node:assert/strict";
import test from "node:test";

import { bailianWan22S2vWorkflowMock } from "./bailian-wan22-s2v-workflow.ts";

test("talking video form hides the fixed model and keeps a balanced field order", () => {
  const group = bailianWan22S2vWorkflowMock.fields.find((field) => field.id === "inputGroup");
  assert.ok(group && group.kind === "group");
  assert.deepEqual(group.children.map((field) => field.id), [
    "characterImage",
    "voiceAudio",
    "resolution",
  ]);
  assert.equal(group.children.some((field) => field.id === "modelName"), false);
  const imageField = group.children.find((field) => field.id === "characterImage");
  assert.ok(imageField && imageField.kind === "imageUpload");
  assert.equal(imageField.validation?.minDimension, 400);
  assert.equal(imageField.validation?.maxDimension, 7000);
});
