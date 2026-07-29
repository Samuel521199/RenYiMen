import assert from "node:assert/strict";
import test from "node:test";
import {
  PLANNING_ROUTE_SIMPLE_REPAIR_CODES,
  repairPlanningRouteSimpleErrors,
} from "./planning-route-deterministic-repair";

function baseRoute(): Record<string, unknown> {
  return {
    videoCategory: "product",
    templateId: "product_problem_solution",
    chronologyMode: "chronological",
    hookMode: "curiosity",
    hookRevealLevel: "partial",
    requiresReturnPoint: false,
    categoryReason: "Product evidence is explicit.",
    templateReason: "The product solves a stated problem.",
    chronologyReason: "No reverse chronology was requested.",
    evidence: [{
      sourceType: "user_prompt",
      sourceField: "userCreative",
      summary: "A product advertisement.",
      referenceFactField: null,
    }],
    categoryConfidence: 0.9,
    templateConfidence: 0.9,
    chronologyConfidence: 0.9,
    ambiguityCodes: [],
    fallbackUsed: false,
    fallbackReason: null,
    version: "planning-route-v1",
    modelName: "qwen3.7-plus",
    inputFingerprint: "sha256:a",
    referenceFactFingerprint: "sha256:b",
  };
}

test("repairs snake_case aliases at top level and in evidence", () => {
  const route = baseRoute();
  route.video_category = route.videoCategory;
  delete route.videoCategory;
  const evidence = (route.evidence as Array<Record<string, unknown>>)[0];
  evidence.source_type = evidence.sourceType;
  delete evidence.sourceType;
  const result = repairPlanningRouteSimpleErrors(route);
  assert.equal(result.value.videoCategory, "product");
  assert.equal((result.value.evidence as Array<Record<string, unknown>>)[0].sourceType, "user_prompt");
  assert.equal(result.repairs.filter((item) =>
    item.ruleCode === PLANNING_ROUTE_SIMPLE_REPAIR_CODES.FIELD_ALIAS).length, 2);
});

test("normalizes enum case and separators", () => {
  const route = baseRoute();
  route.videoCategory = " PRODUCT ";
  route.templateId = "Product-Problem-Solution";
  const result = repairPlanningRouteSimpleErrors(route);
  assert.equal(result.value.videoCategory, "product");
  assert.equal(result.value.templateId, "product_problem_solution");
});

test("removes unknown top-level and evidence fields", () => {
  const route = baseRoute();
  route.cameraGraph = {};
  (route.evidence as Array<Record<string, unknown>>)[0].eventId = "event_1";
  const result = repairPlanningRouteSimpleErrors(route);
  assert.equal("cameraGraph" in result.value, false);
  assert.equal("eventId" in (result.value.evidence as Array<Record<string, unknown>>)[0], false);
});

test("defaults missing chronology and missing chronological Hook fields", () => {
  const route = baseRoute();
  delete route.chronologyMode;
  delete route.hookMode;
  delete route.hookRevealLevel;
  delete route.requiresReturnPoint;
  const result = repairPlanningRouteSimpleErrors(route);
  assert.equal(result.value.chronologyMode, "chronological");
  assert.equal(result.value.hookMode, "curiosity");
  assert.equal(result.value.hookRevealLevel, "partial");
  assert.equal(result.value.requiresReturnPoint, false);
});

test("fills a unique category template but never guesses the two-way game template", () => {
  const product = baseRoute();
  delete product.templateId;
  assert.equal(repairPlanningRouteSimpleErrors(product).value.templateId, "product_problem_solution");
  const game = baseRoute();
  game.videoCategory = "game";
  delete game.templateId;
  assert.equal("templateId" in repairPlanningRouteSimpleErrors(game).value, false);
});

test("clamps finite confidence and normalizes ambiguity arrays", () => {
  const route = baseRoute();
  route.categoryConfidence = -0.2;
  route.templateConfidence = 1.4;
  route.ambiguityCodes = [" input-too-short ", "", "INPUT_TOO_SHORT"];
  const result = repairPlanningRouteSimpleErrors(route);
  assert.equal(result.value.categoryConfidence, 0);
  assert.equal(result.value.templateConfidence, 1);
  assert.deepEqual(result.value.ambiguityCodes, ["INPUT_TOO_SHORT"]);
});

test("normalizes missing and null ambiguity arrays to an empty array", () => {
  const missing = baseRoute();
  delete missing.ambiguityCodes;
  assert.deepEqual(repairPlanningRouteSimpleErrors(missing).value.ambiguityCodes, []);
  const nil = baseRoute();
  nil.ambiguityCodes = null;
  assert.deepEqual(repairPlanningRouteSimpleErrors(nil).value.ambiguityCodes, []);
});

test("reports conflicting aliases without overwriting the canonical value", () => {
  const route = baseRoute();
  route.video_category = "game";
  const result = repairPlanningRouteSimpleErrors(route);
  assert.equal(result.value.videoCategory, "product");
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].code, PLANNING_ROUTE_SIMPLE_REPAIR_CODES.ALIAS_CONFLICT);
});

test("repair is idempotent", () => {
  const route = baseRoute();
  route.video_category = route.videoCategory;
  delete route.videoCategory;
  route.templateId = "PRODUCT-PROBLEM-SOLUTION";
  route.ambiguityCodes = [" input-too-short "];
  const first = repairPlanningRouteSimpleErrors(route);
  const second = repairPlanningRouteSimpleErrors(first.value);
  assert.deepEqual(second.value, first.value);
  assert.deepEqual(second.repairs, []);
  assert.deepEqual(second.conflicts, []);
});
