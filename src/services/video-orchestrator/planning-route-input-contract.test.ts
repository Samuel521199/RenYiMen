import assert from "node:assert/strict";
import test from "node:test";
import {
  PLANNING_ROUTE_INPUT_BUDGET,
  PLANNING_ROUTE_INPUT_ERROR_CODES,
  PlanningRouteInputContractError,
  buildPlanningRouteInput,
  compressPlanningRouteReferenceFacts,
  findForbiddenPlanningRouteInputFields,
} from "./planning-route-input-contract";

function assertContractError(
  callback: () => unknown,
  code: string,
): PlanningRouteInputContractError {
  assert.throws(callback, (error: unknown) => {
    assert.ok(error instanceof PlanningRouteInputContractError);
    assert.equal(error.code, code);
    return true;
  });
  try {
    callback();
  } catch (error) {
    return error as PlanningRouteInputContractError;
  }
  throw new Error("expected PlanningRouteInputContractError");
}

test("builder emits only compact route input and program-owned policy", () => {
  const result = buildPlanningRouteInput({
    userCreative: "制作一个30秒竖屏游戏广告。",
    durationSeconds: 30,
    aspectRatio: "9:16",
    stylePreset: "游戏广告",
    hasReferenceImage: true,
    referenceFacts: {
      subjectTypes: ["person", "game_ui"],
      categorySignals: ["game"],
      containsUi: true,
      containsBrandElements: false,
      containsPeople: true,
      hasExplicitAdCategorySignals: true,
      description: "This deliberately long analysis must never enter the route input.".repeat(100),
    },
    userConstraints: ["人物前后一致", "人物前后一致"],
  });

  assert.deepEqual(Object.keys(result), [
    "version",
    "userCreative",
    "durationSeconds",
    "aspectRatio",
    "stylePreset",
    "hasReferenceImage",
    "referenceFacts",
    "userConstraints",
    "allowedValues",
    "categoryTemplateMap",
  ]);
  assert.deepEqual(result.referenceFacts, {
    subjectTypes: ["person", "game_ui"],
    categorySignals: ["game"],
    containsUi: true,
    containsBrandElements: false,
    containsPeople: true,
    hasExplicitAdCategorySignals: true,
  });
  assert.deepEqual(result.userConstraints, ["人物前后一致"]);
  assert.deepEqual(result.categoryTemplateMap.tutorial, ["generic_brand_story"]);
  assert.ok(JSON.stringify(result).length <= PLANNING_ROUTE_INPUT_BUDGET.totalSerializedChars);
});

test("reference fact compression retains exactly six objective fields", () => {
  const facts = compressPlanningRouteReferenceFacts({
    subjectTypes: ["product", "brand_mark", "unsupported"],
    categorySignals: ["product", "unknown", "unsupported"],
    containsUi: false,
    containsBrandElements: false,
    containsPeople: false,
    hasExplicitAdCategorySignals: true,
    fullAnalysis: "drop me",
    assetPrompt: "drop me",
  }, true);

  assert.deepEqual(Object.keys(facts), [
    "subjectTypes",
    "categorySignals",
    "containsUi",
    "containsBrandElements",
    "containsPeople",
    "hasExplicitAdCategorySignals",
  ]);
  assert.deepEqual(facts.subjectTypes, ["product", "brand_mark"]);
  assert.deepEqual(facts.categorySignals, ["product", "unknown"]);
  assert.equal(facts.containsBrandElements, true);
  assert.equal("fullAnalysis" in facts, false);
});

test("no reference image clears all reference facts", () => {
  assert.deepEqual(compressPlanningRouteReferenceFacts({
    subjectTypes: ["game_ui"],
    categorySignals: ["game"],
    containsUi: true,
  }, false), {
    subjectTypes: [],
    categorySignals: [],
    containsUi: false,
    containsBrandElements: false,
    containsPeople: false,
    hasExplicitAdCategorySignals: false,
  });
});

test("forbidden planning structures are detected recursively", () => {
  const paths = findForbiddenPlanningRouteInputFields({
    safe: {
      camera_graph: {},
      nested: [{ segmentTimeline: "not an exact forbidden key" }, { audioBible: {} }],
    },
    providerCapabilities: {},
  });
  assert.deepEqual(paths, [
    "$.safe.camera_graph",
    "$.safe.nested[1].audioBible",
    "$.providerCapabilities",
  ]);
});

test("builder rejects representative forbidden fields", () => {
  for (const field of [
    "assetLibrary",
    "referenceAnalysis",
    "assetImagePrompt",
    "cameraGraph",
    "segments",
    "audioBible",
    "subtitlePolicy",
    "keyframes",
    "providerCapabilities",
    "shotDecomposerContract",
  ]) {
    const error = assertContractError(
      () => buildPlanningRouteInput({
        userCreative: "test",
        hasReferenceImage: false,
        [field]: {},
      }),
      PLANNING_ROUTE_INPUT_ERROR_CODES.FORBIDDEN_FIELD,
    );
    assert.match(error.paths[0] ?? "", new RegExp(field));
  }
});

test("builder rejects unknown top-level fields", () => {
  assertContractError(
    () => buildPlanningRouteInput({
      userCreative: "test",
      hasReferenceImage: false,
      targetAudience: "not in the route input whitelist",
    }),
    PLANNING_ROUTE_INPUT_ERROR_CODES.UNKNOWN_FIELD,
  );
});

test("builder rejects field budget overflow without truncating user intent", () => {
  assertContractError(
    () => buildPlanningRouteInput({
      userCreative: "x".repeat(PLANNING_ROUTE_INPUT_BUDGET.userCreativeChars + 1),
      hasReferenceImage: false,
    }),
    PLANNING_ROUTE_INPUT_ERROR_CODES.FIELD_BUDGET_EXCEEDED,
  );
  assertContractError(
    () => buildPlanningRouteInput({
      userCreative: "test",
      hasReferenceImage: false,
      userConstraints: ["x".repeat(PLANNING_ROUTE_INPUT_BUDGET.userConstraintCharsEach + 1)],
    }),
    PLANNING_ROUTE_INPUT_ERROR_CODES.FIELD_BUDGET_EXCEEDED,
  );
});
