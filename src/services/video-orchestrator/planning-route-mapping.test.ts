import assert from "node:assert/strict";
import test from "node:test";
import {
  PLANNING_ROUTE_CATEGORY_TEMPLATE_MAP,
  PLANNING_ROUTE_MAPPING_ERROR_CODES,
  deterministicTemplateForCategory,
  isAllowedCategoryTemplateCombination,
  resolveCategoryTemplateMapping,
  validateCategoryTemplateCombination,
  validateNonGameRouteSemantics,
} from "./planning-route-mapping";
import type {
  VideoCreativeCategory,
  VideoCreativeTemplateId,
} from "./types";

const expectedMapping: Record<VideoCreativeCategory, readonly VideoCreativeTemplateId[]> = {
  game: ["game_reversal", "game_bonus_payoff"],
  product: ["product_problem_solution"],
  ecommerce: ["ecommerce_offer_conversion"],
  food: ["food_sensory_reaction"],
  auto: ["auto_performance_hero"],
  short_drama: ["short_drama_conflict_twist"],
  brand: ["generic_brand_story"],
  tutorial: ["generic_brand_story"],
  custom: ["generic_brand_story"],
};

test("program-owned category/template mapping matches planning-route-v1", () => {
  assert.deepEqual(PLANNING_ROUTE_CATEGORY_TEMPLATE_MAP, expectedMapping);
  for (const [category, templates] of Object.entries(expectedMapping)) {
    for (const templateId of templates) {
      assert.equal(
        isAllowedCategoryTemplateCombination(
          category as VideoCreativeCategory,
          templateId,
        ),
        true,
      );
    }
  }
});

test("explicit illegal combinations return a stable mismatch error code", () => {
  for (const [videoCategory, templateId] of [
    ["product", "game_bonus_payoff"],
    ["food", "game_reversal"],
    ["short_drama", "ecommerce_offer_conversion"],
  ] as const) {
    const issues = validateCategoryTemplateCombination(videoCategory, templateId);
    assert.equal(issues.length, 1);
    assert.equal(
      issues[0]?.code,
      PLANNING_ROUTE_MAPPING_ERROR_CODES.CATEGORY_TEMPLATE_MISMATCH,
    );
  }
});

test("invalid model combination falls back by category instead of trusting templateId", () => {
  const result = resolveCategoryTemplateMapping({
    videoCategory: "product",
    templateId: "game_bonus_payoff",
    semanticText: "skincare serum",
  });

  assert.equal(result.videoCategory, "product");
  assert.equal(result.templateId, "product_problem_solution");
  assert.equal(result.fallbackUsed, true);
  assert.match(result.fallbackReason ?? "", /not allowed/);
});

test("missing category and template use custom plus generic brand story", () => {
  const result = resolveCategoryTemplateMapping({});

  assert.equal(result.videoCategory, "custom");
  assert.equal(result.templateId, "generic_brand_story");
  assert.equal(result.fallbackUsed, true);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    [
      PLANNING_ROUTE_MAPPING_ERROR_CODES.CATEGORY_MISSING,
      PLANNING_ROUTE_MAPPING_ERROR_CODES.TEMPLATE_MISSING,
    ],
  );
});

test("tutorial and custom are valid generic brand story routes", () => {
  assert.equal(
    isAllowedCategoryTemplateCombination("tutorial", "generic_brand_story"),
    true,
  );
  assert.equal(
    isAllowedCategoryTemplateCombination("custom", "generic_brand_story"),
    true,
  );
});

test("game fallback chooses bonus template only from game reward evidence", () => {
  assert.equal(deterministicTemplateForCategory("game", "visible bonus multiplier"), "game_bonus_payoff");
  assert.equal(deterministicTemplateForCategory("game", "underdog comeback"), "game_reversal");
});

test("non-game generated route text rejects game-only semantics", () => {
  for (const term of ["jackpot", "bonus", "leaderboard"]) {
    const issues = validateNonGameRouteSemantics("product", `Use a ${term} payoff.`);
    assert.equal(issues.length, 1);
    assert.equal(
      issues[0]?.code,
      PLANNING_ROUTE_MAPPING_ERROR_CODES.GAME_SEMANTICS_FORBIDDEN,
    );
  }
  assert.deepEqual(validateNonGameRouteSemantics("game", "bonus jackpot leaderboard"), []);
  assert.deepEqual(validateNonGameRouteSemantics("food", "sensory proof and customer reaction"), []);
});
