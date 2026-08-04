import assert from "node:assert/strict";
import test from "node:test";

import { klingCinemaWorkflowMock } from "./kling-cinema-workflow.ts";

test("image-to-video form hides the marked helper and endpoint text", () => {
  const group = klingCinemaWorkflowMock.fields.find((field) => field.id === "reference");
  assert.ok(group && group.kind === "group");
  assert.equal(group.description, undefined);
  assert.equal(group.descriptionEn, undefined);

  const duration = group.children.find((field) => field.id === "videoDurationSeconds");
  assert.ok(duration && duration.kind === "numberSlider");
  assert.equal(duration.showMinLabel, false);
  assert.equal(duration.showMaxLabel, false);
});
