import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  PLANNING_ARCHITECT_ROUTE_LOCK_RULES,
  PlanningArchitectRouteConflictError,
  applyApprovedRouteToPlanningArchitectOutput,
  approvedRouteContractForPlanningArchitect,
  mirrorApprovedRouteToCreativeStrategy,
  mirrorApprovedRouteToFinalPlan,
  type ApprovedPlanningRouteContract,
} from "./planning-route-planning-architect";
import { PLANNING_ROUTE_LOG_EVENTS } from "./planning-route-telemetry";
import type { OnePromptVideoPlan } from "./types";

function route(): ApprovedPlanningRouteContract {
  return {
    videoCategory: "product",
    templateId: "product_problem_solution",
    chronologyMode: "problem_solution",
    hookMode: "pain_point",
    hookRevealLevel: "partial",
    requiresReturnPoint: false,
    categoryReason: "Product evidence.",
    templateReason: "Problem-solution route.",
    chronologyReason: "Problem before solution.",
    evidence: [],
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

test("Planning Architect receives a cloned approved Route Contract", () => {
  const source = route();
  const mapped = approvedRouteContractForPlanningArchitect(source);
  assert.deepEqual(mapped, source);
  mapped.videoCategory = "brand";
  assert.equal(source.videoCategory, "product");
});

test("route lock rules forbid reclassification, mutation, and private fallback", () => {
  assert.match(PLANNING_ARCHITECT_ROUTE_LOCK_RULES, /Do not classify the video again/);
  assert.match(PLANNING_ARCHITECT_ROUTE_LOCK_RULES, /Do not modify approved_route_contract/);
  assert.match(PLANNING_ARCHITECT_ROUTE_LOCK_RULES, /Do not silently fall back to another template/);
  assert.match(PLANNING_ARCHITECT_ROUTE_LOCK_RULES, /route_contract_error/);
});

test("Planning output mirrors the approved route without changing downstream structures", () => {
  const narrativeEvents = [{ event_id: "event_1", action: "apply product" }];
  const anchors = [{ id: "product_1" }];
  const timeline = { segments: [{ segment_no: 1 }] };
  const audioBible = { music: "soft" };
  const output = applyApprovedRouteToPlanningArchitectOutput({
    classification: {},
    creative_strategy: {
      hook_event_ids: ["event_1"],
      conversion_goal_zh: "购买",
    },
    narrative_events: narrativeEvents,
    consistency_manifest: { anchors },
    planning_manifest: { timeline_blueprint: timeline },
    audio_bible: audioBible,
  }, route());
  assert.equal((output.classification as Record<string, unknown>).video_category, "product");
  assert.equal((output.classification as Record<string, unknown>).template_id, "product_problem_solution");
  assert.equal((output.classification as Record<string, unknown>).chronology_mode, "problem_solution");
  assert.equal((output.creative_strategy as Record<string, unknown>).hook_mode, "pain_point");
  assert.deepEqual(output.narrative_events, narrativeEvents);
  assert.deepEqual(output.consistency_manifest, { anchors });
  assert.deepEqual(output.planning_manifest, { timeline_blueprint: timeline });
  assert.deepEqual(output.audio_bible, audioBible);
});

test("a model reclassification attempt returns a structured route mutation error", () => {
  assert.throws(
    () => applyApprovedRouteToPlanningArchitectOutput({
      classification: {
        video_category: "brand",
        template_id: "generic_brand_story",
        chronology_mode: "chronological",
      },
    }, route()),
    (error: unknown) => {
      assert.ok(error instanceof PlanningArchitectRouteConflictError);
      assert.equal(error.code, "PLANNING_ARCHITECT_ROUTE_MUTATION");
      assert.deepEqual(error.conflictingRouteFields, ["videoCategory"]);
      return true;
    },
  );
});

test("a reported input conflict becomes a structured error and never changes template", () => {
  assert.throws(
    () => applyApprovedRouteToPlanningArchitectOutput({
      route_contract_error: {
        code: "PLANNING_ARCHITECT_ROUTE_INPUT_CONFLICT",
        message: "Reference says game while approved route says product.",
        conflicting_input_fields: ["reference_facts.categorySignals"],
        conflicting_route_fields: ["videoCategory"],
      },
    }, route()),
    (error: unknown) => {
      assert.ok(error instanceof PlanningArchitectRouteConflictError);
      assert.equal(error.code, "PLANNING_ARCHITECT_ROUTE_INPUT_CONFLICT");
      assert.deepEqual(error.conflictingInputFields, ["reference_facts.categorySignals"]);
      assert.deepEqual(error.conflictingRouteFields, ["videoCategory"]);
      return true;
    },
  );
});

test("creative strategy and final plan classification are mirrored from route", () => {
  const strategy = mirrorApprovedRouteToCreativeStrategy({
    hookEventIds: ["event_1"],
    returnToEventId: "event_1",
  }, route());
  assert.equal(strategy.videoCategory, "product");
  assert.equal(strategy.templateId, "product_problem_solution");
  assert.equal(strategy.chronologyMode, "problem_solution");
  assert.equal(strategy.hookMode, "pain_point");
  assert.equal(strategy.hookRevealLevel, "partial");
  assert.equal(strategy.returnToEventId, "");

  const plan = mirrorApprovedRouteToFinalPlan({
    creativeStrategy: strategy,
    plannerWarnings: [],
  } as unknown as OnePromptVideoPlan, route());
  assert.deepEqual(plan.approvedRouteContract, route());
  assert.equal(plan.creativeStrategy?.templateId, "product_problem_solution");
});

test("production planner approves Route before Planning Architect and mirrors the final plan", () => {
  const source = readFileSync(new URL("./three-stage-planner.ts", import.meta.url), "utf8");
  const routeCallIndex = source.indexOf("runPlanningRouteModelCall({");
  const planningCallIndex = source.indexOf("planningRaw = await buildSplitPlanningRaw({");
  assert.ok(routeCallIndex > 0);
  assert.ok(planningCallIndex > routeCallIndex);
  assert.match(source, /approved_route_contract:\s*approvedRouteContractForPlanningArchitect/);
  assert.match(source, /applyApprovedRouteToPlanningArchitectOutput\(/);
  assert.match(source, /plan = mirrorApprovedRouteToFinalPlan\(plan, approvedRouteContract\)/);
  assert.match(source, /approvedRouteContract\?: ApprovedPlanningRouteContract/);
  assert.match(source, /routeClassification\?: RouteClassificationCheckpoint/);
  assert.match(source, /decideRouteCheckpointReuse\(\{/);
  assert.match(source, /createModelRouteClassificationCheckpoint\(\{/);
  assert.match(source, /inputTokens:\s*routeResult\.inputTokens/);
  assert.match(source, /outputTokens:\s*routeResult\.outputTokens/);
  assert.match(source, /export function applyManualPlanningRouteClassification/);
  assert.match(source, /createManualLockedRouteClassificationCheckpoint\(\{/);
  assert.match(source, /comparePlanningRouteContracts\(/);
  assert.match(source, /if \(routeChanges\.invalidateProductionContent\)/);
  assert.match(source, /invalidatePlanningContentAfterRoute\(checkpoint\)/);
  for (const event of PLANNING_ROUTE_LOG_EVENTS) {
    assert.match(source, new RegExp(`writeRouteLog\\("${event.replaceAll(".", "\\.")}"`));
  }
});
