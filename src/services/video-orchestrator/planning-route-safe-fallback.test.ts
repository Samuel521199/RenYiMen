import assert from "node:assert/strict";
import test from "node:test";
import {
  PLANNING_ROUTE_SAFE_FALLBACK,
  buildPlanningRouteSafeFallback,
} from "./planning-route-safe-fallback";

const metadata = {
  version: "planning-route-v1" as const,
  modelName: "qwen3.7-plus",
  inputFingerprint: "sha256:a",
  referenceFactFingerprint: "sha256:b",
};

test("default fallback uses the frozen safe route and continues Planning", () => {
  const result = buildPlanningRouteSafeFallback({
    metadata,
    context: {
      reasons: ["品类证据不足"],
      inputConflicts: ["用户文本指向产品，参考图指向游戏"],
    },
  });
  for (const [field, expected] of Object.entries(PLANNING_ROUTE_SAFE_FALLBACK)) {
    assert.equal(result.value[field], expected);
  }
  assert.equal(result.value.hookRevealLevel, "none");
  assert.equal(result.info.shouldBlockPlanning, false);
  assert.equal(result.info.recommendPlanReview, true);
  assert.deepEqual(result.info.inputConflicts, ["用户文本指向产品，参考图指向游戏"]);
  assert.match(result.value.fallbackReason as string, /计划审核阶段/);
  assert.match(result.info.userVisibleWarning, /继续生成计划/);
});

test("unsupported content is the only explicit blocking fallback", () => {
  const result = buildPlanningRouteSafeFallback({
    metadata,
    context: {
      unsupportedContentReason: "当前 Provider 不支持该媒体类型",
    },
  });
  assert.equal(result.info.shouldBlockPlanning, true);
  assert.equal(result.info.recommendPlanReview, false);
  assert.match(result.info.userVisibleWarning, /Planning 已停止/);
  assert.equal(result.value.fallbackUsed, true);
});

test("fallback reason template records why, conflicts, and review recommendation", () => {
  const result = buildPlanningRouteSafeFallback({
    metadata,
    context: {
      reasons: ["无法唯一确定 product 或 brand"],
      inputConflicts: ["文本强调产品销售；参考图只有品牌标识"],
    },
  });
  const reason = result.value.fallbackReason as string;
  assert.match(reason, /无法判断|存在冲突/);
  assert.match(reason, /文本强调产品销售/);
  assert.match(reason, /计划审核阶段/);
});
