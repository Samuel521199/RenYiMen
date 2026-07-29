import assert from "node:assert/strict";
import test from "node:test";
import { buildPlanningRouteInput } from "./planning-route-input-contract";
import {
  PLANNING_ROUTE_MODEL_REPAIR_TRIGGERS,
  assessPlanningRouteModelRepair,
  validatePlanningRouteModelRepairMutation,
} from "./planning-route-model-repair-policy";

function inputFor(params: {
  creative: string;
  style?: string;
  referenceSignals?: Array<"game" | "product" | "food" | "auto" | "ecommerce" | "brand" | "tutorial" | "unknown">;
}) {
  return buildPlanningRouteInput({
    userCreative: params.creative,
    durationSeconds: 20,
    aspectRatio: "9:16",
    stylePreset: params.style ?? null,
    hasReferenceImage: Boolean(params.referenceSignals?.length),
    referenceFacts: {
      subjectTypes: [],
      categorySignals: params.referenceSignals ?? [],
      containsUi: false,
      containsBrandElements: false,
      containsPeople: false,
      hasExplicitAdCategorySignals: Boolean(params.referenceSignals?.length),
    },
    userConstraints: [],
  });
}

function route(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    videoCategory: "product",
    templateId: "product_problem_solution",
    chronologyMode: "chronological",
    hookMode: "curiosity",
    hookRevealLevel: "partial",
    requiresReturnPoint: false,
    categoryReason: "Product category.",
    templateReason: "Problem solution template.",
    chronologyReason: "Default chronology.",
    evidence: [{ sourceType: "user_prompt", sourceField: "userCreative", summary: "Product.", referenceFactField: null }],
    categoryConfidence: 0.7,
    templateConfidence: 0.7,
    chronologyConfidence: 0.7,
    ambiguityCodes: [],
    fallbackUsed: false,
    fallbackReason: null,
    version: "planning-route-v1",
    modelName: "qwen3.7-plus",
    inputFingerprint: "sha256:a",
    referenceFactFingerprint: "sha256:b",
    ...overrides,
  };
}

test("allows exactly the six approved semantic ambiguity and reliability families", () => {
  const cases = [
    {
      input: inputFor({ creative: "A game advertisement" }),
      output: route({ videoCategory: "game", templateId: undefined, ambiguityCodes: ["TEMPLATE_CONFLICT"] }),
      trigger: PLANNING_ROUTE_MODEL_REPAIR_TRIGGERS.GAME_TEMPLATE_AMBIGUOUS,
    },
    {
      input: inputFor({ creative: "A product brand story" }),
      output: route({ ambiguityCodes: ["CATEGORY_CONFLICT"] }),
      trigger: PLANNING_ROUTE_MODEL_REPAIR_TRIGGERS.PRODUCT_BRAND_AMBIGUOUS,
    },
    {
      input: inputFor({ creative: "An ecommerce product shopping ad" }),
      output: route({ ambiguityCodes: ["CATEGORY_CONFLICT"] }),
      trigger: PLANNING_ROUTE_MODEL_REPAIR_TRIGGERS.PRODUCT_ECOMMERCE_AMBIGUOUS,
    },
    {
      input: inputFor({ creative: "Show the result first in a non-linear story" }),
      output: route({ ambiguityCodes: ["CHRONOLOGY_CONFLICT"] }),
      trigger: PLANNING_ROUTE_MODEL_REPAIR_TRIGGERS.NONLINEAR_CHRONOLOGY_CONFLICT,
    },
    {
      input: inputFor({ creative: "A game advertisement", referenceSignals: ["product"] }),
      output: route({ videoCategory: "game", templateId: "game_reversal" }),
      trigger: PLANNING_ROUTE_MODEL_REPAIR_TRIGGERS.REFERENCE_TEXT_CATEGORY_CONFLICT,
    },
    {
      input: inputFor({ creative: "A product advertisement" }),
      output: route({ categoryConfidence: 0.4 }),
      trigger: PLANNING_ROUTE_MODEL_REPAIR_TRIGGERS.LOW_CONFIDENCE,
    },
  ];
  assert.equal(cases.length, Object.keys(PLANNING_ROUTE_MODEL_REPAIR_TRIGGERS).length);
  for (const item of cases) {
    const assessment = assessPlanningRouteModelRepair({
      input: item.input,
      previousOutput: JSON.stringify(item.output),
    });
    assert.equal(assessment.allowed, true);
    assert.equal(assessment.trigger, item.trigger);
  }
});

test("does not repair malformed JSON or ordinary contract errors", () => {
  const input = inputFor({ creative: "A product advertisement" });
  assert.equal(assessPlanningRouteModelRepair({ input, previousOutput: "```json\n{}\n```" }).allowed, false);
  assert.equal(assessPlanningRouteModelRepair({
    input,
    previousOutput: JSON.stringify(route({ templateReason: "" })),
  }).allowed, false);
});

test("mutation validator freezes evidence, fallback state, metadata, and input facts", () => {
  const before = route();
  const after = route({
    videoCategory: "brand",
    templateId: "generic_brand_story",
    evidence: [],
    inputFingerprint: "changed",
    userCreative: "changed input",
  });
  const errors = validatePlanningRouteModelRepairMutation({
    previousBaseline: before,
    repairedOutput: JSON.stringify(after),
    expectedMetadata: {
      version: "planning-route-v1",
      modelName: "qwen3.7-plus",
      inputFingerprint: "sha256:a",
      referenceFactFingerprint: "sha256:b",
    },
  });
  assert.ok(errors.some((item) => item.includes("protected field evidence")));
  assert.ok(errors.some((item) => item.includes("protected field inputFingerprint")));
  assert.ok(errors.some((item) => item.includes("input fact field userCreative")));
});

test("mutation validator allows only route decision, policy, confidence, reason, and ambiguity changes", () => {
  const before = route();
  const after = route({
    videoCategory: "brand",
    templateId: "generic_brand_story",
    chronologyMode: "result_first",
    hookMode: "payoff_preview",
    hookRevealLevel: "full",
    requiresReturnPoint: false,
    categoryReason: "Brand-led.",
    templateReason: "Brand story.",
    chronologyReason: "Result first.",
    categoryConfidence: 0.8,
    templateConfidence: 0.8,
    chronologyConfidence: 0.8,
    ambiguityCodes: [],
  });
  assert.deepEqual(validatePlanningRouteModelRepairMutation({
    previousBaseline: before,
    repairedOutput: JSON.stringify(after),
    expectedMetadata: {
      version: "planning-route-v1",
      modelName: "qwen3.7-plus",
      inputFingerprint: "sha256:a",
      referenceFactFingerprint: "sha256:b",
    },
  }), []);
});
