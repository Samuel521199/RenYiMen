import assert from "node:assert/strict";
import test from "node:test";
import {
  PLANNING_ROUTE_GATE_ERROR_CODES,
  PLANNING_ROUTE_GATE_VALIDATION_ORDER,
  evaluatePlanningRouteGate,
  type PlanningRouteExpectedMetadata,
} from "./planning-route-gate";

const metadata: PlanningRouteExpectedMetadata = {
  version: "planning-route-v1",
  modelName: "qwen3.7-plus",
  inputFingerprint: `sha256:${"a".repeat(64)}`,
  referenceFactFingerprint: `sha256:${"b".repeat(64)}`,
};

function validRoute(): Record<string, unknown> {
  return {
    videoCategory: "game",
    templateId: "game_bonus_payoff",
    chronologyMode: "chronological",
    hookMode: "tease",
    hookRevealLevel: "partial",
    requiresReturnPoint: false,
    categoryReason: "用户明确要求游戏广告。",
    templateReason: "参考事实显示奖励 UI。",
    chronologyReason: "用户未要求倒叙。",
    evidence: [{
      sourceType: "user_prompt",
      sourceField: "userCreative",
      summary: "用户明确要求游戏广告。",
      referenceFactField: null,
    }],
    categoryConfidence: 0.99,
    templateConfidence: 0.92,
    chronologyConfidence: 0.88,
    ambiguityCodes: [],
    fallbackUsed: false,
    fallbackReason: null,
    ...metadata,
  };
}

function evaluate(value: string | Record<string, unknown>, modelRepairAvailable = true) {
  return evaluatePlanningRouteGate({
    rawContent: typeof value === "string" ? value : JSON.stringify(value),
    expectedMetadata: metadata,
    modelRepairAvailable,
  });
}

test("gate freezes the required validation order", () => {
  assert.deepEqual(PLANNING_ROUTE_GATE_VALIDATION_ORDER, [
    "json_parse",
    "contract_version",
    "required_fields",
    "enum_values",
    "category_template_mapping",
    "chronology_hook_policy",
    "confidence_range",
    "fallback_reason",
    "event_ids",
    "scope_fields",
  ]);
});

test("valid route is allowed", () => {
  const result = evaluate(validRoute());
  assert.equal(result.status, "allow");
  assert.deepEqual(result.issues, []);
});

test("low but legal confidence is allowed with warning", () => {
  const route = validRoute();
  route.categoryConfidence = 0.4;
  const result = evaluate(route);
  assert.equal(result.status, "allow_with_warning");
  assert.equal(result.issues[0]?.code, PLANNING_ROUTE_GATE_ERROR_CODES.LOW_CONFIDENCE);
});

test("invalid JSON requests model repair then falls back when repair is unavailable", () => {
  assert.equal(evaluate("```json\n{}\n```", true).status, "model_repair");
  const fallback = evaluate("not json", false);
  assert.equal(fallback.status, "fallback");
  assert.equal(fallback.value?.videoCategory, "custom");
  assert.equal(fallback.value?.templateId, "generic_brand_story");
  assert.equal(fallback.value?.hookRevealLevel, "none");
  assert.equal(fallback.fallbackInfo?.shouldBlockPlanning, false);
  assert.equal(fallback.fallbackInfo?.recommendPlanReview, true);
  assert.match(fallback.fallbackInfo?.userVisibleWarning ?? "", /计划审核阶段/);
});

test("application-owned metadata is repaired deterministically", () => {
  const route = validRoute();
  route.version = "wrong";
  route.inputFingerprint = "wrong";
  const result = evaluate(route);
  assert.equal(result.status, "deterministic_repair");
  assert.equal(result.value?.version, metadata.version);
  assert.equal(result.value?.inputFingerprint, metadata.inputFingerprint);
});

test("category/template mismatch repairs by category", () => {
  const route = validRoute();
  route.videoCategory = "product";
  route.templateId = "game_bonus_payoff";
  route.categoryReason = "用户明确要求护肤产品广告。";
  route.templateReason = "产品用于解决皮肤干燥问题。";
  const result = evaluate(route);
  assert.equal(result.status, "deterministic_repair");
  assert.equal(result.value?.videoCategory, "product");
  assert.equal(result.value?.templateId, "product_problem_solution");
  assert.ok(result.issues.some((item) =>
    item.code === PLANNING_ROUTE_GATE_ERROR_CODES.CATEGORY_TEMPLATE_MISMATCH));
});

test("chronology and Hook mismatch uses deterministic policy defaults", () => {
  const route = validRoute();
  route.chronologyMode = "flashforward_hook";
  route.hookMode = "tease";
  route.hookRevealLevel = "none";
  route.requiresReturnPoint = false;
  const result = evaluate(route);
  assert.equal(result.status, "deterministic_repair");
  assert.equal(result.value?.hookMode, "payoff_preview");
  assert.equal(result.value?.hookRevealLevel, "partial");
  assert.equal(result.value?.requiresReturnPoint, true);
});

test("numeric confidence overflow is clamped deterministically", () => {
  const route = validRoute();
  route.templateConfidence = 1.4;
  const result = evaluate(route);
  assert.equal(result.status, "deterministic_repair");
  assert.equal(result.value?.templateConfidence, 1);
});

test("fallback without a reason receives a deterministic reason", () => {
  const route = validRoute();
  route.fallbackUsed = true;
  delete route.fallbackReason;
  route.ambiguityCodes = ["INSUFFICIENT_EVIDENCE"];
  const result = evaluate(route);
  assert.equal(result.status, "deterministic_repair");
  assert.equal(typeof result.value?.fallbackReason, "string");
});

test("event reference fields and scope fields are stripped", () => {
  const route = validRoute();
  route.hookEventIds = ["event_1"];
  route.cameraGraph = { nodes: [] };
  route.unexpectedField = "remove me";
  (route.evidence as Array<Record<string, unknown>>)[0].eventId = "event_2";
  const result = evaluate(route);
  assert.equal(result.status, "deterministic_repair");
  assert.equal("hookEventIds" in (result.value ?? {}), false);
  assert.equal("cameraGraph" in (result.value ?? {}), false);
  assert.equal("unexpectedField" in (result.value ?? {}), false);
  assert.equal(
    "eventId" in ((result.value?.evidence as Array<Record<string, unknown>>)[0] ?? {}),
    false,
  );
  assert.ok(result.issues.some((item) =>
    item.code === PLANNING_ROUTE_GATE_ERROR_CODES.EVENT_ID_FORBIDDEN));
  assert.ok(result.issues.some((item) =>
    item.code === PLANNING_ROUTE_GATE_ERROR_CODES.SCOPE_FIELD_FORBIDDEN));
});

test("event IDs hidden in allowed text require model repair", () => {
  const route = validRoute();
  route.categoryReason = "Use event_3 because it is the Hook.";
  assert.equal(evaluate(route, true).status, "model_repair");
  assert.equal(evaluate(route, false).status, "fallback");
});

test("missing semantic fields require model repair", () => {
  const route = validRoute();
  delete route.templateReason;
  assert.equal(evaluate(route, true).status, "model_repair");
  assert.equal(evaluate(route, false).status, "fallback");
});

test("simple repairs are audited and the repaired result passes the full gate", () => {
  const route = validRoute();
  route.video_category = " PRODUCT ";
  delete route.videoCategory;
  delete route.templateId;
  delete route.chronologyMode;
  delete route.hookMode;
  route.unknown_extra = true;
  route.categoryReason = "A product advertisement is explicitly requested.";
  route.templateReason = "The product solves a stated problem.";
  const result = evaluate(route);
  assert.equal(result.status, "deterministic_repair");
  assert.equal(result.value?.videoCategory, "product");
  assert.equal(result.value?.templateId, "product_problem_solution");
  assert.equal(result.value?.chronologyMode, "chronological");
  assert.equal(result.value?.hookMode, "curiosity");
  assert.equal("unknown_extra" in (result.value ?? {}), false);
  assert.ok(result.repairs.every((item) => item.path.startsWith("$.")));
  assert.ok(result.repairs.some((item) =>
    item.ruleCode === "PLANNING_ROUTE_REPAIR_FIELD_ALIAS"
    && item.sourcePath === "$.video_category"));
});

test("conflicting aliases require model repair and are never silently selected", () => {
  const route = validRoute();
  route.video_category = "product";
  const result = evaluate(route, true);
  assert.equal(result.status, "model_repair");
  assert.equal(result.value, null);
  assert.ok(result.issues.some((item) =>
    item.code === PLANNING_ROUTE_GATE_ERROR_CODES.FIELD_ALIAS_CONFLICT));
});

test("missing game template is not guessed because the mapping is not unique", () => {
  const route = validRoute();
  delete route.templateId;
  assert.equal(evaluate(route, true).status, "model_repair");
  assert.equal(evaluate(route, false).status, "fallback");
});
