import assert from "node:assert/strict";
import test from "node:test";

import {
  buildJsonSyntaxRepairUserPrompt,
  DEFAULT_JSON_SYNTAX_REPAIR_MODEL,
  JSON_SYNTAX_REPAIR_SYSTEM_PROMPT,
  jsonSyntaxRepairModel,
} from "./json-syntax-repair-contract.ts";

test("JSON syntax repair prompt has one syntax-only objective", () => {
  assert.match(JSON_SYNTAX_REPAIR_SYSTEM_PROMPT, /JSON syntax only/);
  assert.match(JSON_SYNTAX_REPAIR_SYSTEM_PROMPT, /Never return repair_execution/);
  assert.match(JSON_SYNTAX_REPAIR_SYSTEM_PROMPT, /Do not add, remove, rename, reorder/);
  assert.match(JSON_SYNTAX_REPAIR_SYSTEM_PROMPT, /Do not change numbers/);
  assert.doesNotMatch(JSON_SYNTAX_REPAIR_SYSTEM_PROMPT, /STRUCTURED REPAIR EXECUTION CONTRACT/);
  assert.doesNotMatch(JSON_SYNTAX_REPAIR_SYSTEM_PROMPT, /operation_id|repair_plan_id/);
});

test("JSON syntax repair input contains no generic repair plan", () => {
  const prompt = buildJsonSyntaxRepairUserPrompt('{"items":[1 2]}', 60_000);
  assert.match(prompt, /<JSON_TO_REPAIR>/);
  assert.match(prompt, /\{"items":\[1 2\]\}/);
  assert.doesNotMatch(prompt, /repair_plan|repair_execution|operation_id/);
});

test("JSON syntax repair always selects a dedicated text model", () => {
  assert.equal(jsonSyntaxRepairModel({
    ALIYUN_JSON_REPAIR_MODEL: "qwen-plus",
    ALIYUN_STORYBOARD_MODEL: "qwen3.7-plus",
  }), "qwen-plus");
  assert.equal(jsonSyntaxRepairModel({
    ALIYUN_STORYBOARD_MODEL: "qwen3.7-plus",
  }), "qwen3.7-plus");
  assert.equal(jsonSyntaxRepairModel({}), DEFAULT_JSON_SYNTAX_REPAIR_MODEL);
});
