import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildInitialParameters } from "../lib/workflow-utils.ts";
import { klingStdWorkflowMock } from "./kling-std-workflow.ts";

test("Kling standard audio toggle is enabled by default", () => {
  const parameters = buildInitialParameters(klingStdWorkflowMock);
  const inputGroup = parameters.inputGroup as Record<string, unknown>;

  assert.equal(inputGroup.sound, true);
});

test("Kling adapter submits the configured sound toggle", () => {
  const source = readFileSync("src/services/providers/KlingAdapter.ts", "utf8");

  assert.match(source, /const sound = resolveSound\(payload\)/);
  assert.match(source, /\bsound,\s*\n\s*image:/);
});
