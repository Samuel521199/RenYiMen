import assert from "node:assert/strict";
import test from "node:test";

import { structuredProductionError } from "./structured-production-error.ts";

test("shows the structured-output stage, cause, and checkpoint recovery guidance", () => {
  const error = structuredProductionError({
    errorCode: "STRUCTURED_OUTPUT_SYNTAX_ERROR",
    recoveryAction: "RETRY_STAGE",
    message:
      "Structured output for reference_fact_extractor remained invalid after syntax repair.",
  });

  assert.match(error.displayMessage.zh, /参考图事实提取阶段/);
  assert.match(error.displayMessage.zh, /重复字段、未闭合结构/);
  assert.match(error.displayMessage.zh, /无需重新创建项目/);
  assert.match(error.displayMessage.en, /reference fact extraction stage/i);
});

test("uses a specific label for another structured-output stage", () => {
  const error = structuredProductionError({
    errorCode: "STRUCTURED_OUTPUT_SYNTAX_ERROR",
    recoveryAction: "RETRY_STAGE",
    message: "Structured output for shot_decomposer could not be parsed.",
  });

  assert.match(error.displayMessage.zh, /分镜拆解阶段/);
});
