import { validateChronologyHookPolicy } from "./planning-chronology-policy";
import {
  isAllowedCategoryTemplateCombination,
  validateNonGameRouteSemantics,
} from "./planning-route-mapping";
import type {
  VideoChronologyMode,
  VideoCreativeCategory,
  VideoCreativeTemplateId,
  VideoHookMode,
  VideoHookRevealLevel,
} from "./types";

export interface PlanningRouteFixtureDecision {
  videoCategory: VideoCreativeCategory;
  templateId: VideoCreativeTemplateId;
  chronologyMode: VideoChronologyMode;
  hookMode: VideoHookMode;
  hookRevealLevel: VideoHookRevealLevel;
  requiresReturnPoint: boolean;
}

export interface PlanningRouteClearFixture {
  id: string;
  group: string;
  expected: PlanningRouteFixtureDecision;
}

export interface PlanningRouteFixturePrediction extends PlanningRouteFixtureDecision {
  id: string;
  semanticText: string;
}

export interface PlanningRouteFixedSampleMetrics {
  clearSampleCount: number;
  correctCategoryCount: number;
  categoryAccuracy: number;
  legalCategoryTemplateCount: number;
  categoryTemplateLegalRate: number;
  legalChronologyCount: number;
  chronologyLegalRate: number;
  nonGameSampleCount: number;
  gameSemanticPollutionCount: number;
  nonGameSemanticPollutionRate: number;
  missingPredictionIds: string[];
  unexpectedPredictionIds: string[];
  passed: boolean;
}

export const PLANNING_ROUTE_FIXED_SAMPLE_THRESHOLDS = {
  minimumCategoryAccuracy: 0.98,
  categoryTemplateLegalRate: 1,
  chronologyLegalRate: 1,
  maximumNonGameSemanticPollutionRate: 0,
} as const;

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function evaluatePlanningRouteFixedSamples(params: {
  samples: PlanningRouteClearFixture[];
  predictions: PlanningRouteFixturePrediction[];
}): PlanningRouteFixedSampleMetrics {
  const sampleIds = new Set(params.samples.map((sample) => sample.id));
  const predictionsById = new Map(params.predictions.map((prediction) => [prediction.id, prediction]));
  const missingPredictionIds = params.samples
    .filter((sample) => !predictionsById.has(sample.id))
    .map((sample) => sample.id);
  const unexpectedPredictionIds = params.predictions
    .filter((prediction) => !sampleIds.has(prediction.id))
    .map((prediction) => prediction.id);

  let correctCategoryCount = 0;
  let legalCategoryTemplateCount = 0;
  let legalChronologyCount = 0;
  let nonGameSampleCount = 0;
  let gameSemanticPollutionCount = 0;

  for (const sample of params.samples) {
    const prediction = predictionsById.get(sample.id);
    if (!prediction) continue;
    if (prediction.videoCategory === sample.expected.videoCategory) correctCategoryCount += 1;
    if (isAllowedCategoryTemplateCombination(prediction.videoCategory, prediction.templateId)) {
      legalCategoryTemplateCount += 1;
    }
    if (validateChronologyHookPolicy(prediction).length === 0) legalChronologyCount += 1;
    if (prediction.videoCategory !== "game") {
      nonGameSampleCount += 1;
      if (validateNonGameRouteSemantics(prediction.videoCategory, prediction.semanticText).length) {
        gameSemanticPollutionCount += 1;
      }
    }
  }

  const clearSampleCount = params.samples.length;
  const categoryAccuracy = rate(correctCategoryCount, clearSampleCount);
  const categoryTemplateLegalRate = rate(legalCategoryTemplateCount, clearSampleCount);
  const chronologyLegalRate = rate(legalChronologyCount, clearSampleCount);
  const nonGameSemanticPollutionRate = rate(gameSemanticPollutionCount, nonGameSampleCount);
  const passed = missingPredictionIds.length === 0
    && unexpectedPredictionIds.length === 0
    && categoryAccuracy >= PLANNING_ROUTE_FIXED_SAMPLE_THRESHOLDS.minimumCategoryAccuracy
    && categoryTemplateLegalRate === PLANNING_ROUTE_FIXED_SAMPLE_THRESHOLDS.categoryTemplateLegalRate
    && chronologyLegalRate === PLANNING_ROUTE_FIXED_SAMPLE_THRESHOLDS.chronologyLegalRate
    && nonGameSemanticPollutionRate
      === PLANNING_ROUTE_FIXED_SAMPLE_THRESHOLDS.maximumNonGameSemanticPollutionRate;

  return {
    clearSampleCount,
    correctCategoryCount,
    categoryAccuracy,
    legalCategoryTemplateCount,
    categoryTemplateLegalRate,
    legalChronologyCount,
    chronologyLegalRate,
    nonGameSampleCount,
    gameSemanticPollutionCount,
    nonGameSemanticPollutionRate,
    missingPredictionIds,
    unexpectedPredictionIds,
    passed,
  };
}
