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

test("describes infrastructure recovery as automatic and checkpoint-safe", () => {
  const error = structuredProductionError({
    errorCode: "INFRASTRUCTURE_RECOVERY_QUEUED",
    category: "scheduling",
    retryable: true,
    recoveryAction: "AUTO_RETRY_INFRASTRUCTURE",
  });

  assert.match(error.displayMessage.zh, /检查点均已保留/);
  assert.match(error.displayMessage.zh, /自动恢复/);
  assert.match(error.displayMessage.zh, /无需.*手动重试/);
});

test("provider quota exhaustion is non-retryable and points to billing", () => {
  const error = structuredProductionError({
    errorCode: "PROVIDER_QUOTA_EXHAUSTED",
    category: "provider_quota",
  });
  assert.equal(error.retryable, false);
  assert.equal(error.recoveryAction, "CHECK_PROVIDER_BILLING");
  assert.match(error.displayMessage.zh, /额度已用尽/);
  assert.match(error.displayMessage.en, /quota is exhausted/i);
});

test("segment contract diagnostics keep the concrete field path for the UI", () => {
  const message = "第4片段 motion_contract.camera_motion 缺失。相同合同错误连续出现两次。";
  const error = structuredProductionError({
    errorCode: "EXECUTION_CONTRACT_INVALID",
    category: "contract_validation",
    recoveryAction: "REPAIR_CONTRACT",
    message,
  });
  assert.equal(error.displayMessage.zh, message);
  assert.match(error.displayMessage.en, /motion_contract\.camera_motion/);
});
