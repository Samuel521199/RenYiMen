import assert from "node:assert/strict";
import test from "node:test";
import {
  PLANNING_CHRONOLOGY_ERROR_CODES,
  resolveChronologyHookPolicy,
  selectChronologyMode,
  validateChronologyHookPolicy,
} from "./planning-chronology-policy";
import {
  createManualLockedRouteClassificationCheckpoint,
  createModelRouteClassificationCheckpoint,
  decideRouteCheckpointReuse,
  routeReferenceFactFingerprint,
  routeUserInputFingerprint,
} from "./planning-route-checkpoint";
import {
  PLANNING_ROUTE_GATE_ERROR_CODES,
  evaluatePlanningRouteGate,
  type PlanningRouteExpectedMetadata,
} from "./planning-route-gate";
import { buildPlanningRouteInput } from "./planning-route-input-contract";
import {
  PLANNING_ROUTE_CATEGORY_TEMPLATE_MAP,
  PLANNING_ROUTE_MAPPING_ERROR_CODES,
  isAllowedCategoryTemplateCombination,
  validateCategoryTemplateCombination,
  validateNonGameRouteSemantics,
} from "./planning-route-mapping";
import {
  PLANNING_ROUTE_MODEL_CALL_POLICY,
  planningRouteContractMetadata,
  runPlanningRouteModelCall,
} from "./planning-route-model-call";
import {
  PlanningArchitectRouteConflictError,
  applyApprovedRouteToPlanningArchitectOutput,
  type ApprovedPlanningRouteContract,
} from "./planning-route-planning-architect";
import type {
  VideoCreativeCategory,
  VideoCreativeTemplateId,
} from "./types";

const expectedCategories: VideoCreativeCategory[] = [
  "game",
  "product",
  "ecommerce",
  "food",
  "auto",
  "short_drama",
  "brand",
  "tutorial",
  "custom",
];

const expectedTemplates: VideoCreativeTemplateId[] = [
  "game_reversal",
  "game_bonus_payoff",
  "product_problem_solution",
  "ecommerce_offer_conversion",
  "food_sensory_reaction",
  "auto_performance_hero",
  "short_drama_conflict_twist",
  "generic_brand_story",
];

const input = buildPlanningRouteInput({
  userCreative: "制作一个展示清洁产品解决污渍问题的广告。",
  durationSeconds: 30,
  aspectRatio: "9:16",
  stylePreset: "产品广告",
  hasReferenceImage: true,
  referenceFacts: {
    subjectTypes: ["product"],
    categorySignals: ["product"],
    containsUi: false,
    containsBrandElements: true,
    containsPeople: false,
    hasExplicitAdCategorySignals: true,
  },
  userConstraints: [],
});

function modelRouteValue(): Record<string, unknown> {
  return {
    videoCategory: "product",
    templateId: "product_problem_solution",
    chronologyMode: "problem_solution",
    hookMode: "pain_point",
    hookRevealLevel: "partial",
    requiresReturnPoint: false,
    categoryReason: "输入明确要求产品广告。",
    templateReason: "产品解决具体污渍问题。",
    chronologyReason: "先展示问题再展示解决方案。",
    evidence: [{
      sourceType: "user_prompt",
      sourceField: "userCreative",
      summary: "清洁产品解决污渍问题。",
      referenceFactField: null,
    }],
    categoryConfidence: 0.92,
    templateConfidence: 0.9,
    chronologyConfidence: 0.88,
    ambiguityCodes: [],
    fallbackUsed: false,
    fallbackReason: null,
    ...planningRouteContractMetadata(input),
  };
}

function approvedRoute(): ApprovedPlanningRouteContract {
  return modelRouteValue() as unknown as ApprovedPlanningRouteContract;
}

const metadata: PlanningRouteExpectedMetadata = planningRouteContractMetadata(input);

function gate(value: string | Record<string, unknown>, modelRepairAvailable = true) {
  return evaluatePlanningRouteGate({
    rawContent: typeof value === "string" ? value : JSON.stringify(value),
    expectedMetadata: metadata,
    modelRepairAvailable,
  });
}

test("step17 covers every category and template enum exposed to the model", () => {
  assert.deepEqual(input.allowedValues.videoCategories, expectedCategories);
  assert.deepEqual(input.allowedValues.templateIds, expectedTemplates);
  assert.deepEqual(Object.keys(PLANNING_ROUTE_CATEGORY_TEMPLATE_MAP), expectedCategories);
  assert.deepEqual(
    [...new Set(Object.values(PLANNING_ROUTE_CATEGORY_TEMPLATE_MAP).flat())],
    expectedTemplates,
  );
});

test("step17 accepts every declared category/template combination", () => {
  for (const [category, templates] of Object.entries(PLANNING_ROUTE_CATEGORY_TEMPLATE_MAP)) {
    for (const template of templates) {
      assert.equal(
        isAllowedCategoryTemplateCombination(
          category as VideoCreativeCategory,
          template as VideoCreativeTemplateId,
        ),
        true,
        `${category} + ${template} should be legal`,
      );
      assert.deepEqual(
        validateCategoryTemplateCombination(
          category as VideoCreativeCategory,
          template as VideoCreativeTemplateId,
        ),
        [],
      );
    }
  }
});

test("step17 rejects every undeclared category/template combination", () => {
  for (const category of expectedCategories) {
    for (const template of expectedTemplates) {
      const expected = PLANNING_ROUTE_CATEGORY_TEMPLATE_MAP[category].includes(
        template as never,
      );
      if (expected) continue;
      const issues = validateCategoryTemplateCombination(category, template);
      assert.equal(issues[0]?.code, PLANNING_ROUTE_MAPPING_ERROR_CODES.CATEGORY_TEMPLATE_MISMATCH);
      assert.equal(isAllowedCategoryTemplateCombination(category, template), false);
    }
  }
});

test("step17 uses chronological and its Hook policy as the deterministic default", () => {
  assert.equal(selectChronologyMode({}), "chronological");
  assert.deepEqual(resolveChronologyHookPolicy({ chronologyMode: "chronological" }), {
    chronologyMode: "chronological",
    hookMode: "curiosity",
    hookRevealLevel: "partial",
    requiresReturnPoint: false,
    corrected: false,
    issues: [],
  });
});

test("step17 enforces the flashforward Hook rule", () => {
  assert.deepEqual(validateChronologyHookPolicy({
    chronologyMode: "flashforward_hook",
    hookMode: "payoff_preview",
    hookRevealLevel: "partial",
    requiresReturnPoint: true,
  }), []);
  const issues = validateChronologyHookPolicy({
    chronologyMode: "flashforward_hook",
    hookMode: "curiosity",
    hookRevealLevel: "none",
    requiresReturnPoint: false,
  });
  assert.ok(issues.some((item) => item.code === PLANNING_CHRONOLOGY_ERROR_CODES.HOOK_MODE_MISMATCH));
  assert.ok(issues.some((item) => item.code === PLANNING_CHRONOLOGY_ERROR_CODES.RETURN_POINT_REQUIRED));
});

test("step17 enforces result-first as full payoff preview with a return point", () => {
  assert.deepEqual(resolveChronologyHookPolicy({ chronologyMode: "result_first" }), {
    chronologyMode: "result_first",
    hookMode: "payoff_preview",
    hookRevealLevel: "full",
    requiresReturnPoint: true,
    corrected: false,
    issues: [],
  });
  assert.notDeepEqual(validateChronologyHookPolicy({
    chronologyMode: "result_first",
    hookMode: "payoff_preview",
    hookRevealLevel: "partial",
    requiresReturnPoint: false,
  }), []);
});

test("step17 sends a low-confidence route through one targeted repair", async () => {
  const lowConfidence = modelRouteValue();
  lowConfidence.categoryConfidence = 0.4;
  const repaired = modelRouteValue();
  let calls = 0;
  const result = await runPlanningRouteModelCall({
    input,
    transport: async () => {
      calls += 1;
      return JSON.stringify(calls === 1 ? lowConfidence : repaired);
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.repairCallCount, 1);
  assert.equal(result.repairTrigger, "PLANNING_ROUTE_REPAIR_LOW_CONFIDENCE");
  assert.equal(result.gateStatus, "allow");
});

test("step17 never performs more than one repair call", async () => {
  const lowConfidence = modelRouteValue();
  lowConfidence.categoryConfidence = 0.4;
  let calls = 0;
  const result = await runPlanningRouteModelCall({
    input,
    transport: async () => {
      calls += 1;
      return JSON.stringify(lowConfidence);
    },
  });
  assert.equal(PLANNING_ROUTE_MODEL_CALL_POLICY.maxRepairCalls, 1);
  assert.equal(calls, 2);
  assert.equal(result.repairCallCount, 1);
  assert.equal(result.gateStatus, "allow_with_warning");
});

test("step17 fallback is the exact safe route and does not block supported Planning", () => {
  const result = gate("not json", false);
  assert.equal(result.status, "fallback");
  assert.deepEqual({
    videoCategory: result.value?.videoCategory,
    templateId: result.value?.templateId,
    chronologyMode: result.value?.chronologyMode,
    hookMode: result.value?.hookMode,
    hookRevealLevel: result.value?.hookRevealLevel,
    fallbackUsed: result.value?.fallbackUsed,
  }, {
    videoCategory: "custom",
    templateId: "generic_brand_story",
    chronologyMode: "chronological",
    hookMode: "curiosity",
    hookRevealLevel: "none",
    fallbackUsed: true,
  });
  assert.equal(result.fallbackInfo?.shouldBlockPlanning, false);
});

test("step17 reuses an unchanged checkpoint and invalidates changed route inputs", () => {
  const userFingerprint = routeUserInputFingerprint({ userCreative: input.userCreative });
  const referenceFingerprint = routeReferenceFactFingerprint(input.referenceFacts);
  const checkpoint = createModelRouteClassificationCheckpoint({
    routeContract: approvedRoute(),
    userInputFingerprint: userFingerprint,
    referenceFactFingerprint: referenceFingerprint,
    modelName: "qwen3.7-plus",
    modelDurationMs: 100,
    inputTokens: 10,
    outputTokens: 10,
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
  assert.equal(decideRouteCheckpointReuse({
    checkpoint,
    userInputFingerprint: routeUserInputFingerprint({ userCreative: "改成游戏广告" }),
    referenceFactFingerprint: referenceFingerprint,
  }).reason, "USER_CREATIVE_CHANGED");
  assert.equal(decideRouteCheckpointReuse({
    checkpoint,
    userInputFingerprint: userFingerprint,
    referenceFactFingerprint: routeReferenceFactFingerprint({ categorySignals: ["game"] }),
  }).reason, "REFERENCE_CATEGORY_FACTS_CHANGED");
});

test("step17 prevents Planning Architect from reclassifying the approved route", () => {
  assert.throws(
    () => applyApprovedRouteToPlanningArchitectOutput({
      classification: {
        video_category: "brand",
        template_id: "generic_brand_story",
        chronology_mode: "chronological",
      },
    }, approvedRoute()),
    (error: unknown) =>
      error instanceof PlanningArchitectRouteConflictError
      && error.code === "PLANNING_ARCHITECT_ROUTE_MUTATION",
  );
});

test("step17 preserves a user-locked route even when all input fingerprints change", () => {
  const checkpoint = createManualLockedRouteClassificationCheckpoint({
    routeContract: approvedRoute(),
    userInputFingerprint: "sha256:old-user",
    referenceFactFingerprint: "sha256:old-reference",
  });
  assert.equal(checkpoint.authority, "user");
  assert.equal(checkpoint.locked, true);
  assert.deepEqual(decideRouteCheckpointReuse({
    checkpoint,
    userInputFingerprint: "sha256:new-user",
    referenceFactFingerprint: "sha256:new-reference",
    changeKinds: ["user_creative", "reference_category_facts"],
  }), { reuse: true, reason: "MANUAL_LOCKED" });
  assert.deepEqual(checkpoint.routeContract, approvedRoute());
});

test("step17 removes all event-ID fields from Route output", () => {
  const route = modelRouteValue();
  for (const field of [
    "hookEventIds",
    "conflictEventIds",
    "turningPointEventIds",
    "payoffEventIds",
    "ctaEventIds",
    "returnToEventId",
  ]) route[field] = field.endsWith("Ids") ? ["event_1"] : "event_1";
  const result = gate(route);
  assert.equal(result.status, "deterministic_repair");
  const serialized = JSON.stringify(result.value);
  for (const field of [
    "hookEventIds",
    "conflictEventIds",
    "turningPointEventIds",
    "payoffEventIds",
    "ctaEventIds",
    "returnToEventId",
  ]) assert.equal(serialized.includes(field), false);
  assert.ok(result.issues.some((item) =>
    item.code === PLANNING_ROUTE_GATE_ERROR_CODES.EVENT_ID_FORBIDDEN));
});

test("step17 rejects game templates and game-only semantics for every non-game category", () => {
  for (const category of expectedCategories.filter((item) => item !== "game")) {
    for (const template of ["game_reversal", "game_bonus_payoff"] as const) {
      assert.equal(isAllowedCategoryTemplateCombination(category, template), false);
    }
    const issues = validateNonGameRouteSemantics(
      category,
      "jackpot bonus leaderboard 爆奖 奖池 排行榜 连胜 金币倍率",
    );
    assert.equal(issues[0]?.code, PLANNING_ROUTE_MAPPING_ERROR_CODES.GAME_SEMANTICS_FORBIDDEN);
  }
});
