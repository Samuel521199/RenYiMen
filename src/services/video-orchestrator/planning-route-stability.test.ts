import assert from "node:assert/strict";
import test from "node:test";
import {
  createModelRouteClassificationCheckpoint,
  decideRouteCheckpointReuse,
  routeReferenceFactFingerprint,
  routeUserInputFingerprint,
} from "./planning-route-checkpoint";
import { buildPlanningRouteInput } from "./planning-route-input-contract";
import {
  planningRouteContractMetadata,
  runPlanningRouteModelCall,
} from "./planning-route-model-call";
import type { ApprovedPlanningRouteContract } from "./planning-route-planning-architect";
import {
  PLANNING_ROUTE_STABILITY_THRESHOLDS,
  evaluatePlanningRouteStability,
  type PlanningRouteStabilityRun,
} from "./planning-route-stability";

const expectedRoute = {
  videoCategory: "game",
  templateId: "game_bonus_payoff",
  chronologyMode: "chronological",
};

const tongitsInput = buildPlanningRouteInput({
  userCreative: "如图这个 Tongits King 游戏，我要做一个30s的广告宣传片，要求引人入胜，画面精良，且整个视频前后人物要一致。",
  durationSeconds: 30,
  aspectRatio: "9:16",
  stylePreset: "游戏广告",
  hasReferenceImage: true,
  referenceFacts: {
    subjectTypes: ["game_ui"],
    categorySignals: ["game"],
    containsUi: true,
    containsBrandElements: true,
    containsPeople: true,
    hasExplicitAdCategorySignals: true,
  },
  userConstraints: ["整个视频前后人物必须一致"],
});

function tongitsRoute(): Record<string, unknown> {
  return {
    ...expectedRoute,
    hookMode: "tease",
    hookRevealLevel: "partial",
    requiresReturnPoint: false,
    categoryReason: "用户和参考图均明确指向游戏广告。",
    templateReason: "Tongits 奖励反馈适合游戏奖励回报模板。",
    chronologyReason: "用户没有要求倒叙或结果前置。",
    evidence: [{
      sourceType: "reference_fact",
      sourceField: "referenceFacts.categorySignals",
      summary: "参考图包含游戏 UI 和明确游戏品类特征。",
      referenceFactField: "categorySignals",
    }],
    categoryConfidence: 0.99,
    templateConfidence: 0.96,
    chronologyConfidence: 0.98,
    ambiguityCodes: [],
    fallbackUsed: false,
    fallbackReason: null,
    ...planningRouteContractMetadata(tongitsInput),
  };
}

test("step19 runs the same Tongits input 20 times with no normal repair", async () => {
  const runs: PlanningRouteStabilityRun[] = [];
  let transportCalls = 0;
  const unrequestedFlashforward = {
    ...tongitsRoute(),
    chronologyMode: "flashforward_hook",
    hookMode: "payoff_preview",
    hookRevealLevel: "partial",
    requiresReturnPoint: true,
    chronologyReason: "错误地把奖励画面本身当成高潮前置要求。",
  };
  const unrequestedDemonstration = {
    ...tongitsRoute(),
    chronologyMode: "demonstration",
    hookMode: "curiosity",
    hookRevealLevel: "partial",
    requiresReturnPoint: false,
    chronologyReason: "错误地把普通游戏广告当成玩法演示。",
  };
  for (let index = 0; index < PLANNING_ROUTE_STABILITY_THRESHOLDS.runCount; index += 1) {
    const result = await runPlanningRouteModelCall({
      input: tongitsInput,
      transport: async () => {
        transportCalls += 1;
        return JSON.stringify(index % 2 === 0
          ? unrequestedFlashforward
          : unrequestedDemonstration);
      },
    });
    runs.push({
      runNo: index + 1,
      videoCategory: result.value.videoCategory,
      templateId: result.value.templateId,
      chronologyMode: result.value.chronologyMode,
      apiWaitDurationMs: result.apiWaitDurationMs,
      outputBytes: result.outputBytes,
      repairCallCount: result.repairCallCount,
      modelCallCount: result.attemptCount,
      checkpointReused: false,
    });
  }
  assert.equal(transportCalls, 20);
  assert.equal(runs.every((run) => run.repairCallCount === 0), true);
  assert.equal(runs.every((run) => run.chronologyMode === "chronological"), true);

  const route = tongitsRoute() as unknown as ApprovedPlanningRouteContract;
  const userInputFingerprint = routeUserInputFingerprint({
    userCreative: tongitsInput.userCreative,
    explicitRouteConstraints: tongitsInput.userConstraints,
  });
  const referenceFactFingerprint = routeReferenceFactFingerprint(tongitsInput.referenceFacts);
  const checkpoint = createModelRouteClassificationCheckpoint({
    routeContract: route,
    userInputFingerprint,
    referenceFactFingerprint,
    modelName: "qwen3.7-plus",
    modelDurationMs: 100,
    inputTokens: null,
    outputTokens: null,
    gateStatus: "allow",
    gateIssues: [],
    gateRepairs: [],
    repairCount: 0,
  });
  const reuse = decideRouteCheckpointReuse({
    checkpoint,
    userInputFingerprint,
    referenceFactFingerprint,
  });
  assert.deepEqual(reuse, { reuse: true, reason: "UNCHANGED" });
  runs.push({
    runNo: 21,
    videoCategory: checkpoint.routeContract.videoCategory,
    templateId: checkpoint.routeContract.templateId,
    chronologyMode: checkpoint.routeContract.chronologyMode,
    apiWaitDurationMs: 0,
    outputBytes: 0,
    repairCallCount: 0,
    modelCallCount: 0,
    checkpointReused: true,
  });

  const report = evaluatePlanningRouteStability({
    sampleId: "tongits-king-route-v1",
    expectedRoute,
    runs,
  });
  assert.equal(report.runCount, 20);
  assert.equal(report.categoryConsistencyRate, 1);
  assert.equal(report.templateConsistencyRate, 1);
  assert.equal(report.chronologyConsistencyRate, 1);
  assert.ok(report.p50ApiWaitDurationMs <= 8_000);
  assert.ok(report.p95ApiWaitDurationMs <= 15_000);
  assert.ok(report.maximumOutputBytes <= 2_048);
  assert.equal(report.normalRepairCallCount, 0);
  assert.equal(report.checkpointRecoveryModelCallCount, 0);
  assert.equal(report.passed, true);
});

test("step19 report fails every independent stability and performance boundary", () => {
  const runs = Array.from({ length: 20 }, (_, index): PlanningRouteStabilityRun => ({
    runNo: index + 1,
    videoCategory: index < 18 ? "game" : "product",
    templateId: index < 17 ? "game_bonus_payoff" : "game_reversal",
    chronologyMode: index < 18 ? "chronological" : "result_first",
    apiWaitDurationMs: index < 18 ? 8_001 : 15_001,
    outputBytes: index === 0 ? 2_049 : 1_000,
    repairCallCount: index === 0 ? 1 : 0,
    modelCallCount: 1,
    checkpointReused: false,
  }));
  runs.push({
    runNo: 21,
    videoCategory: "game",
    templateId: "game_bonus_payoff",
    chronologyMode: "chronological",
    apiWaitDurationMs: 0,
    outputBytes: 0,
    repairCallCount: 0,
    modelCallCount: 1,
    checkpointReused: true,
  });
  const report = evaluatePlanningRouteStability({
    sampleId: "failure-fixture",
    expectedRoute,
    runs,
  });
  assert.equal(report.categoryConsistencyRate, 0.9);
  assert.equal(report.templateConsistencyRate, 0.85);
  assert.equal(report.chronologyConsistencyRate, 0.9);
  assert.equal(report.passed, false);
});
