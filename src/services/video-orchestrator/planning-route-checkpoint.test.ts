import assert from "node:assert/strict";
import test from "node:test";
import {
  createManualLockedRouteClassificationCheckpoint,
  createModelRouteClassificationCheckpoint,
  decideRouteCheckpointReuse,
  routeReferenceFactFingerprint,
  routeUserInputFingerprint,
} from "./planning-route-checkpoint";
import type { ApprovedPlanningRouteContract } from "./planning-route-planning-architect";

function route(): ApprovedPlanningRouteContract {
  return {
    videoCategory: "product",
    templateId: "product_problem_solution",
    chronologyMode: "problem_solution",
    hookMode: "pain_point",
    hookRevealLevel: "none",
    requiresReturnPoint: false,
    categoryReason: "明确产品广告",
    templateReason: "痛点解决结构",
    chronologyReason: "先问题后方案",
    fallbackUsed: false,
    fallbackReason: null,
    version: "planning-route-v1",
    modelName: "qwen3.7-plus",
    inputFingerprint: "sha256:model-input",
    referenceFactFingerprint: "sha256:model-reference",
  };
}

const userFingerprint = routeUserInputFingerprint({
  userCreative: "展示清洁产品解决污渍问题",
  explicitRouteConstraints: ["不要倒叙"],
});
const referenceFingerprint = routeReferenceFactFingerprint({
  subjectTypes: ["product"],
  categorySignals: ["product"],
  containsUi: false,
  containsBrandElements: true,
  containsPeople: false,
  hasExplicitAdCategorySignals: true,
});

test("model checkpoint persists route, observability, Gate, repair, and fallback fields", () => {
  const checkpoint = createModelRouteClassificationCheckpoint({
    routeContract: route(),
    userInputFingerprint: userFingerprint,
    referenceFactFingerprint: referenceFingerprint,
    modelName: "qwen3.7-plus",
    modelDurationMs: 4321,
    inputTokens: 812,
    outputTokens: 246,
    gateStatus: "allow_with_warning",
    gateIssues: [],
    gateRepairs: [],
    repairCount: 1,
    now: "2026-07-29T00:00:00.000Z",
  });
  assert.equal(checkpoint.stage, "route_classification");
  assert.equal(checkpoint.routeContractVersion, "planning-route-v1");
  assert.equal(checkpoint.modelDurationMs, 4321);
  assert.equal(checkpoint.inputTokens, 812);
  assert.equal(checkpoint.outputTokens, 246);
  assert.equal(checkpoint.gateResult.status, "allow_with_warning");
  assert.equal(checkpoint.repairCount, 1);
  assert.equal(checkpoint.fallbackInfo, null);
});

test("unchanged creative and compact reference category facts reuse the checkpoint", () => {
  const checkpoint = createModelRouteClassificationCheckpoint({
    routeContract: route(),
    userInputFingerprint: userFingerprint,
    referenceFactFingerprint: referenceFingerprint,
    modelName: "qwen3.7-plus",
    modelDurationMs: 100,
    inputTokens: null,
    outputTokens: null,
    gateStatus: "allow",
    gateIssues: [],
    gateRepairs: [],
    repairCount: 0,
  });
  assert.deepEqual(decideRouteCheckpointReuse({
    checkpoint,
    userInputFingerprint: userFingerprint,
    referenceFactFingerprint: referenceFingerprint,
  }), { reuse: true, reason: "UNCHANGED" });
});

test("creative change and reference category fact change invalidate independently", () => {
  const checkpoint = createModelRouteClassificationCheckpoint({
    routeContract: route(),
    userInputFingerprint: userFingerprint,
    referenceFactFingerprint: referenceFingerprint,
    modelName: "qwen3.7-plus",
    modelDurationMs: 100,
    inputTokens: null,
    outputTokens: null,
    gateStatus: "allow",
    gateIssues: [],
    gateRepairs: [],
    repairCount: 0,
  });
  assert.equal(decideRouteCheckpointReuse({
    checkpoint,
    userInputFingerprint: routeUserInputFingerprint({ userCreative: "改成游戏奖励广告" }),
    referenceFactFingerprint: referenceFingerprint,
  }).reason, "USER_CREATIVE_CHANGED");
  assert.equal(decideRouteCheckpointReuse({
    checkpoint,
    userInputFingerprint: userFingerprint,
    referenceFactFingerprint: routeReferenceFactFingerprint({
      subjectTypes: ["game_ui"],
      categorySignals: ["game"],
    }),
  }).reason, "REFERENCE_CATEGORY_FACTS_CHANGED");
});

test("sound, asset appearance, subtitle, duration, and aspect changes do not rerun route", () => {
  const checkpoint = createModelRouteClassificationCheckpoint({
    routeContract: route(),
    userInputFingerprint: userFingerprint,
    referenceFactFingerprint: referenceFingerprint,
    modelName: "qwen3.7-plus",
    modelDurationMs: 100,
    inputTokens: null,
    outputTokens: null,
    gateStatus: "allow",
    gateIssues: [],
    gateRepairs: [],
    repairCount: 0,
  });
  const decision = decideRouteCheckpointReuse({
    checkpoint,
    userInputFingerprint: "ignored-for-explicit-non-route-change",
    referenceFactFingerprint: "ignored-for-explicit-non-route-change",
    changeKinds: ["sound", "asset_appearance", "subtitle", "duration", "aspect_ratio"],
  });
  assert.deepEqual(decision, { reuse: true, reason: "NON_ROUTE_CHANGE_ONLY" });
});

test("manual classification is saved locked and suppresses all future model reruns", () => {
  const checkpoint = createManualLockedRouteClassificationCheckpoint({
    routeContract: route(),
    userInputFingerprint: userFingerprint,
    referenceFactFingerprint: referenceFingerprint,
    now: "2026-07-29T01:00:00.000Z",
  });
  assert.equal(checkpoint.status, "manual_locked");
  assert.equal(checkpoint.source, "manual");
  assert.equal(checkpoint.authority, "user");
  assert.equal(checkpoint.locked, true);
  assert.deepEqual(decideRouteCheckpointReuse({
    checkpoint,
    userInputFingerprint: "changed-user",
    referenceFactFingerprint: "changed-reference",
    changeKinds: ["user_creative", "reference_category_facts"],
  }), { reuse: true, reason: "MANUAL_LOCKED" });
});
