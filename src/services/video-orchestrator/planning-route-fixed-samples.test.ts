import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPlanningRouteInput } from "./planning-route-input-contract";
import {
  PLANNING_ROUTE_FIXED_SAMPLE_THRESHOLDS,
  evaluatePlanningRouteFixedSamples,
  type PlanningRouteClearFixture,
  type PlanningRouteFixturePrediction,
} from "./planning-route-fixed-sample-evaluator";

interface FixtureFile {
  fixtureVersion: number;
  capturedForStep: string;
  clearSamples: Array<PlanningRouteClearFixture & {
    input: {
      userCreative: string;
      stylePreset?: string;
    };
    baseline: Omit<PlanningRouteFixturePrediction, "id">;
  }>;
  boundarySamples: Array<{
    id: string;
    boundary: string;
    input: { userCreative: string };
    acceptedCategories: string[];
    acceptedTemplates: string[];
  }>;
}

const fixture = JSON.parse(readFileSync(
  new URL("./__fixtures__/planning-route/fixed-classification-samples.json", import.meta.url),
  "utf8",
)) as FixtureFile;

const predictions = fixture.clearSamples.map((sample): PlanningRouteFixturePrediction => ({
  id: sample.id,
  ...sample.baseline,
}));

test("step18 freezes exactly 40 clear samples in the requested category distribution", () => {
  assert.equal(fixture.fixtureVersion, 1);
  assert.equal(fixture.capturedForStep, "18-fixed-route-classification-samples");
  assert.equal(fixture.clearSamples.length, 40);
  const counts = Object.fromEntries([
    "game",
    "product",
    "ecommerce",
    "food",
    "auto",
    "short_drama",
    "brand",
    "tutorial_custom",
  ].map((group) => [
    group,
    fixture.clearSamples.filter((sample) => sample.group === group).length,
  ]));
  assert.deepEqual(counts, {
    game: 5,
    product: 5,
    ecommerce: 5,
    food: 5,
    auto: 5,
    short_drama: 5,
    brand: 5,
    tutorial_custom: 5,
  });
  const tutorialCustom = fixture.clearSamples.filter((sample) => sample.group === "tutorial_custom");
  assert.equal(tutorialCustom.filter((sample) => sample.expected.videoCategory === "tutorial").length, 3);
  assert.equal(tutorialCustom.filter((sample) => sample.expected.videoCategory === "custom").length, 2);
  assert.equal(new Set(fixture.clearSamples.map((sample) => sample.id)).size, 40);
});

test("step18 clear inputs all pass the compact Route input contract", () => {
  for (const sample of fixture.clearSamples) {
    const built = buildPlanningRouteInput({
      userCreative: sample.input.userCreative,
      durationSeconds: 30,
      aspectRatio: "9:16",
      stylePreset: sample.input.stylePreset ?? null,
      hasReferenceImage: false,
      referenceFacts: null,
      userConstraints: [],
    });
    assert.ok(built.userCreative.length > 0, sample.id);
  }
});

test("step18 freezes all six requested ambiguous boundary pairs", () => {
  assert.equal(fixture.boundarySamples.length, 6);
  assert.deepEqual(new Set(fixture.boundarySamples.map((sample) => sample.boundary)), new Set([
    "product_vs_brand",
    "product_vs_ecommerce",
    "game_vs_animation",
    "packaged_food_vs_restaurant",
    "auto_brand_vs_performance",
    "short_drama_vs_brand",
  ]));
  for (const sample of fixture.boundarySamples) {
    assert.ok(sample.input.userCreative.trim().length > 0);
    assert.ok(sample.acceptedCategories.length >= 2);
    assert.ok(sample.acceptedTemplates.length >= 2);
  }
});

test("step18 frozen baseline satisfies every acceptance threshold", () => {
  const metrics = evaluatePlanningRouteFixedSamples({
    samples: fixture.clearSamples,
    predictions,
  });
  assert.equal(PLANNING_ROUTE_FIXED_SAMPLE_THRESHOLDS.minimumCategoryAccuracy, 0.98);
  assert.equal(metrics.clearSampleCount, 40);
  assert.equal(metrics.correctCategoryCount, 40);
  assert.equal(metrics.categoryAccuracy, 1);
  assert.equal(metrics.categoryTemplateLegalRate, 1);
  assert.equal(metrics.chronologyLegalRate, 1);
  assert.equal(metrics.nonGameSampleCount, 35);
  assert.equal(metrics.nonGameSemanticPollutionRate, 0);
  assert.deepEqual(metrics.missingPredictionIds, []);
  assert.deepEqual(metrics.unexpectedPredictionIds, []);
  assert.equal(metrics.passed, true);
});

test("step18 evaluator fails 39/40 accuracy because 97.5% is below 98%", () => {
  const changed = structuredClone(predictions);
  changed[0] = {
    ...changed[0],
    videoCategory: "brand",
    templateId: "generic_brand_story",
  };
  const metrics = evaluatePlanningRouteFixedSamples({
    samples: fixture.clearSamples,
    predictions: changed,
  });
  assert.equal(metrics.categoryAccuracy, 0.975);
  assert.equal(metrics.passed, false);
});

test("step18 evaluator detects illegal mapping, chronology, and non-game game semantics", () => {
  const changed = structuredClone(predictions);
  const productIndex = changed.findIndex((item) => item.id === "product-01");
  changed[productIndex] = {
    ...changed[productIndex],
    templateId: "game_bonus_payoff",
    chronologyMode: "flashforward_hook",
    hookMode: "curiosity",
    hookRevealLevel: "none",
    requiresReturnPoint: false,
    semanticText: "product jackpot bonus leaderboard",
  };
  const metrics = evaluatePlanningRouteFixedSamples({
    samples: fixture.clearSamples,
    predictions: changed,
  });
  assert.ok(metrics.categoryTemplateLegalRate < 1);
  assert.ok(metrics.chronologyLegalRate < 1);
  assert.ok(metrics.nonGameSemanticPollutionRate > 0);
  assert.equal(metrics.passed, false);
});

test("step18 fixtures contain no credentials, external URLs, or personal identifiers", () => {
  const serialized = JSON.stringify(fixture);
  assert.doesNotMatch(serialized, /https?:\/\//i);
  assert.doesNotMatch(serialized, /api[_-]?key|bearer\s|password|token=/i);
  assert.doesNotMatch(serialized, /@[\w.-]+\.[a-z]{2,}/i);
});
