import assert from "node:assert/strict";
import test from "node:test";
import {
  ROUTE_DISPLAY_ONLY_FIELDS,
  comparePlanningRouteContracts,
} from "./planning-route-invalidation";
import type { ApprovedPlanningRouteContract } from "./planning-route-planning-architect";

function route(): ApprovedPlanningRouteContract {
  return {
    videoCategory: "product",
    templateId: "product_problem_solution",
    chronologyMode: "problem_solution",
    hookMode: "pain_point",
    hookRevealLevel: "partial",
    requiresReturnPoint: false,
    categoryReason: "产品广告",
    templateReason: "痛点解决",
    chronologyReason: "问题在前",
    evidence: ["用户创意"],
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

test("video category change invalidates all Planning after Route", () => {
  const next = { ...route(), videoCategory: "brand" as const };
  const result = comparePlanningRouteContracts(route(), next);
  assert.equal(result.invalidateProductionContent, true);
  assert.equal(result.checkpointBoundary, "story_architect");
  assert.deepEqual(result.semanticScopes, ["planning_after_route"]);
});

test("template, chronology, and Hook policy changes retain their semantic scopes", () => {
  const previous = route();
  const next = {
    ...route(),
    templateId: "generic_brand_story" as const,
    chronologyMode: "chronological" as const,
    hookMode: "curiosity" as const,
    hookRevealLevel: "none" as const,
  };
  const result = comparePlanningRouteContracts(previous, next);
  assert.deepEqual(result.semanticScopes, [
    "narrative_and_downstream",
    "narrative_event_order_and_downstream",
    "narrative_events_and_downstream",
  ]);
  assert.equal(result.checkpointBoundary, "story_architect");
});

test("reasons, evidence, confidence, ambiguity, fallback, and audit metadata are display-only", () => {
  const next = {
    ...route(),
    categoryReason: "更新理由",
    evidence: ["更新证据"],
    categoryConfidence: 0.75,
    ambiguityCodes: ["LOW_CATEGORY_CONFIDENCE"],
    fallbackUsed: true,
    fallbackReason: "展示警告",
    modelName: "manual",
    inputFingerprint: "sha256:c",
  };
  const result = comparePlanningRouteContracts(route(), next);
  assert.equal(result.invalidateProductionContent, false);
  assert.equal(result.checkpointBoundary, "none");
  assert.deepEqual(result.semanticScopes, ["none"]);
  assert.ok(result.changedFields.every((field) =>
    (ROUTE_DISPLAY_ONLY_FIELDS as readonly string[]).includes(field)));
});

test("unknown contract fields invalidate conservatively", () => {
  const next = { ...route(), futureProductionRule: "new" };
  const result = comparePlanningRouteContracts(route(), next);
  assert.equal(result.invalidateProductionContent, true);
  assert.deepEqual(result.unknownChangedFields, ["futureProductionRule"]);
  assert.deepEqual(result.semanticScopes, ["planning_after_route"]);
});
