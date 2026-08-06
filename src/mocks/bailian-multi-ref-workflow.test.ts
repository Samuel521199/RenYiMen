import assert from "node:assert/strict";
import test from "node:test";

import { bailianMultiRefWorkflowMock } from "./bailian-multi-ref-workflow.ts";

test("multi-reference form exposes nine images and separate positive and negative prompts", () => {
  const group = bailianMultiRefWorkflowMock.fields[0];
  assert.equal(group.kind, "group");
  if (group.kind !== "group") return;

  const references = group.children.find((field) => field.id === "image_urls");
  assert.equal(references?.kind, "multiImageUpload");
  if (references?.kind === "multiImageUpload") {
    assert.equal(references.maxItems, 9);
    assert.equal(references.validation?.minDimension, 400);
  }

  const positivePrompt = group.children.find((field) => field.id === "videoPrompt");
  assert.equal(positivePrompt?.kind, "textInput");
  assert.deepEqual(positivePrompt?.mapping.inputPath, ["prompt"]);

  const negativePrompt = group.children.find((field) => field.id === "negativePrompt");
  assert.equal(negativePrompt?.kind, "textInput");
  assert.deepEqual(negativePrompt?.mapping.inputPath, ["negative_prompt"]);
  if (negativePrompt?.kind === "textInput") {
    assert.equal(negativePrompt.validation?.maxLength, 500);
  }
});
