import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PLANNING_ROUTE_ROLLOUT_STAGES,
  assertRouteContractIsSoleAuthority,
  comparePlanningRouteShadow,
  decidePlanningRouteRollout,
  planningRouteProjectBucket,
} from "./planning-route-rollout";

test("step20 freezes the required rollout order", () => {
  assert.deepEqual(PLANNING_ROUTE_ROLLOUT_STAGES, [
    "local_fixed_samples",
    "test_live_model",
    "shadow_compare",
    "nonbillable_canary",
    "internal_new_projects",
    "percent_10",
    "percent_50",
    "percent_100",
  ]);
});

test("step20 shadow mode compares only classification and never affects Planning", () => {
  const decision = decidePlanningRouteRollout({
    stage: "shadow_compare",
    projectId: "project-shadow",
  });
  assert.equal(decision.executeRouteModel, true);
  assert.equal(decision.affectFormalPlanning, false);
  assert.equal(decision.authority, "legacy_planning_architect");
  assert.equal(decision.comparisonMode, "classification_only");
  const comparison = comparePlanningRouteShadow({
    routeContract: {
      videoCategory: "game",
      templateId: "game_bonus_payoff",
      chronologyMode: "chronological",
      categoryConfidence: 0.99,
    },
    legacyClassification: {
      video_category: "game",
      template_id: "game_reversal",
      chronology_mode: "chronological",
      narrative_events: [{ event_id: "ignored" }],
    },
  });
  assert.deepEqual(comparison.fields, ["videoCategory", "templateId", "chronologyMode"]);
  assert.equal(comparison.matches, false);
  assert.deepEqual(comparison.mismatches.map((item) => item.field), ["templateId"]);
  assert.equal(comparison.affectsFormalPlanning, false);
});

test("step20 canary and internal stages select only their explicit cohorts", () => {
  assert.equal(decidePlanningRouteRollout({
    stage: "nonbillable_canary",
    projectId: "canary",
    nonbillableCanary: true,
  }).authority, "route_contract");
  assert.equal(decidePlanningRouteRollout({
    stage: "nonbillable_canary",
    projectId: "paid",
    nonbillableCanary: false,
  }).executeRouteModel, false);
  assert.equal(decidePlanningRouteRollout({
    stage: "internal_new_projects",
    projectId: "internal",
    internalProject: true,
  }).authority, "route_contract");
  assert.equal(decidePlanningRouteRollout({
    stage: "internal_new_projects",
    projectId: "external",
    internalProject: false,
  }).authority, "legacy_planning_architect");
});

test("step20 percentage rollout uses a stable project cohort", () => {
  for (const projectId of ["project-a", "project-b", "project-c", "project-d"]) {
    const bucket = planningRouteProjectBucket(projectId);
    assert.equal(planningRouteProjectBucket(projectId), bucket);
    assert.equal(decidePlanningRouteRollout({
      stage: "percent_10",
      projectId,
    }).selected, bucket < 10);
    assert.equal(decidePlanningRouteRollout({
      stage: "percent_50",
      projectId,
    }).selected, bucket < 50);
    const full = decidePlanningRouteRollout({
      stage: "percent_100",
      projectId,
    });
    assert.equal(full.selected, true);
    assert.equal(full.authority, "route_contract");
  }
});

test("step20 formal cutover rejects missing contracts and dual authority", () => {
  const rolloutDecision = decidePlanningRouteRollout({
    stage: "percent_100",
    projectId: "formal-project",
  });
  assert.doesNotThrow(() => assertRouteContractIsSoleAuthority({
    rolloutDecision,
    approvedRouteContractPresent: true,
    planningArchitectClassificationEnabled: false,
  }));
  assert.throws(() => assertRouteContractIsSoleAuthority({
    rolloutDecision,
    approvedRouteContractPresent: true,
    planningArchitectClassificationEnabled: true,
  }), /PLANNING_ROUTE_DUAL_AUTHORITY_FORBIDDEN/);
  assert.throws(() => assertRouteContractIsSoleAuthority({
    rolloutDecision,
    approvedRouteContractPresent: false,
    planningArchitectClassificationEnabled: false,
  }), /PLANNING_ROUTE_DUAL_AUTHORITY_FORBIDDEN/);
});

test("step20 production planner already mirrors Route Contract and blocks reclassification", () => {
  const source = readFileSync(new URL("./three-stage-planner.ts", import.meta.url), "utf8");
  assert.match(source, /approved_route_contract:\s*approvedRouteContractForPlanningArchitect/);
  assert.match(source, /applyApprovedRouteToPlanningArchitectOutput\(/);
  assert.match(source, /mirrorApprovedRouteToFinalPlan\(plan, approvedRouteContract\)/);
  assert.match(source, /assertRouteContractIsSoleAuthority\(\{/);
  assert.match(source, /stage:\s*"percent_100"/);
  assert.match(source, /planningArchitectClassificationEnabled:\s*false/);
  const lockSource = readFileSync(
    new URL("./planning-route-planning-architect.ts", import.meta.url),
    "utf8",
  );
  assert.match(lockSource, /Do not classify the video again/);
  assert.match(lockSource, /Do not modify approved_route_contract/);
});
