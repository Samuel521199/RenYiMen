import assert from "node:assert/strict";
import test from "node:test";

import { bailianDanceMoveWorkflowMock } from "./bailian-dance-move-workflow";
import { iterateLeafFields } from "../lib/workflow-utils";

test("dance motion transfer defaults to professional mode", () => {
  const mode = [...iterateLeafFields(bailianDanceMoveWorkflowMock.fields)].find(
    (field) => field.id === "mode",
  );

  assert.ok(mode && mode.kind === "select");
  assert.equal(mode.defaultValue, "wan-pro");
  assert.deepEqual(mode.options, [
    {
      value: "wan-std",
      label: "标准模式（适合快速预览效果）",
      labelEn: "Standard (Best for quick previews)",
    },
    {
      value: "wan-pro",
      label: "专业模式（适合专业细腻生成）",
      labelEn: "Professional (Best for detailed generation)",
    },
  ]);
});
