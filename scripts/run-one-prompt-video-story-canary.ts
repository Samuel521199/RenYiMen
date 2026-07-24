import { createAliyunStoryboardPlan } from "../src/services/video-orchestrator/three-stage-planner";
import type { OnePromptVideoPlan, VideoCreativeCategory } from "../src/services/video-orchestrator/types";

if (process.env.ONE_PROMPT_VIDEO_STORY_CANARY !== "1") {
  throw new Error("Live story canary is disabled. Set ONE_PROMPT_VIDEO_STORY_CANARY=1 to run real-model, billable regression.");
}

const cases: Array<{ id: string; prompt: string; category: VideoCreativeCategory }> = [
  {
    id: "game-causal-payoff",
    category: "game",
    prompt: "制作一条30秒竖屏游戏广告：主角先面临明确压力，通过可见操作扭转局面，展示结果与反应，再自然进入行动号召。",
  },
  {
    id: "product-proof",
    category: "product",
    prompt: "制作一条30秒竖屏产品广告：先展示真实痛点，再用可见操作和证据证明产品解决问题，最后给出行动号召。",
  },
  {
    id: "brand-story",
    category: "brand",
    prompt: "制作一条30秒竖屏品牌短片：从冲突或压力开始，以一个可见选择推动变化，通过证据形成回报，最后自然收束。",
  },
];

const referenceUrls = parseReferenceUrls(process.env.ONE_PROMPT_VIDEO_CANARY_REFERENCE_URLS);
const results = [];
for (const item of cases) {
  const startedAt = Date.now();
  let contractRepairCount = 0;
  const plan = await createAliyunStoryboardPlan({
    userPrompt: item.prompt,
    aspectRatio: "9:16",
    durationSeconds: 30,
    stylePreset: "cinematic",
    referenceImageUrls: referenceUrls,
  }, {
    onProgress(update) {
      contractRepairCount += update.metricsDelta?.storyContractRepairCount ?? 0;
    },
  });
  results.push(summarize(item.id, item.category, plan, contractRepairCount, Date.now() - startedAt));
}

const aggregate = {
  runAt: new Date().toISOString(),
  model: process.env.ALIYUN_STORYBOARD_MODEL ?? "qwen3.7-plus",
  referenceFactModel: process.env.ALIYUN_STORYBOARD_REFERENCE_FACT_MODEL ?? "qwen-vl-plus",
  samples: results,
  metrics: {
    sampleCount: results.length,
    causalFieldCompletenessRate: average(results.map((item) => item.causalFieldCompletenessRate)),
    invalidReferenceRate: average(results.map((item) => item.invalidReferenceRate)),
    suddenOutcomeRiskRate: average(results.map((item) => item.suddenOutcomeRisk ? 1 : 0)),
    referenceOveruseRiskRate: average(results.map((item) => item.referenceOveruseRisk ? 1 : 0)),
    firstPassRate: average(results.map((item) => item.contractRepairCount === 0 ? 1 : 0)),
    repairSuccessRate: average(results.map((item) => item.contractPassed ? 1 : 0)),
    appliedAnchorCoverageRate: average(results.map((item) => item.appliedAnchorCoverageRate)),
    invalidAnchorExclusionRate: average(results.map((item) => item.invalidAnchorExclusionRate)),
    firstPassAssetContractRate: average(results.map((item) => item.assetContractPassed ? 1 : 0)),
    hardAnchorFinalSelectionRate: averageKnown(results.map((item) => item.hardAnchorFinalSelectionRate)),
    hardAnchorFinalSelectionObservationCount: results.filter((item) => item.hardAnchorFinalSelectionRate != null).length,
    unreferencedIdentityScoreRate: averageKnown(results.map((item) => item.unreferencedIdentityScoreRate)),
    unreferencedIdentityScoreObservationCount: results.filter((item) => item.unreferencedIdentityScoreRate != null).length,
    assetDriftIssueRate: averageKnown(results.map((item) => item.assetDriftIssueRate)),
    averageLatencyMs: average(results.map((item) => item.latencyMs)),
  },
};

process.stdout.write(`${JSON.stringify(aggregate, null, 2)}\n`);
if (results.some((item) => !item.contractPassed)) process.exitCode = 1;

function summarize(
  id: string,
  category: VideoCreativeCategory,
  plan: OnePromptVideoPlan,
  contractRepairCount: number,
  latencyMs: number,
) {
  const beats = plan.storyBeats ?? [];
  const beatIds = new Set(beats.map((beat) => beat.beatId));
  const causalFields = beats.filter((beat) => beat.storyFunction !== "hook");
  const invalidReferences = causalFields.flatMap((beat) => [
    ...(beat.dependsOnBeatIds ?? []),
    ...(beat.evidenceFromBeatIds ?? []),
    ...(beat.resolvesConflictBeatId ? [beat.resolvesConflictBeatId] : []),
  ]).filter((id) => !beatIds.has(id));
  const issueCodes = new Set(plan.storyQualityReport?.issueCodes ?? []);
  const assetTargets = [
    ...(plan.assetContract?.beatTargets ?? []),
    ...(plan.assetContract?.segmentTargets ?? []),
    ...(plan.assetContract?.boundaryTargets ?? []),
  ];
  const expectedAnchorApplications = assetTargets.flatMap((target) =>
    target.derivedAnchorIds.map((anchorId) => ({ anchorId, effective: target.effectiveRequiredAnchorIds.includes(anchorId) }))
  );
  const invalidExclusions = assetTargets.flatMap((target) => target.excludedAnchors).filter((item) => !item.valid);
  const qualityReports = plan.generationQualityReports ?? [];
  const scoredIdentityReports = qualityReports.filter((report) => report.identityScoreApplicable !== false);
  const unreferencedIdentityReports = scoredIdentityReports.filter((report) => report.referenceComparable === false || (report.selectedReferenceCount ?? 0) === 0);
  const assetDriftReports = qualityReports.filter((report) =>
    report.artifactIssues.some((issue) => /identity drift|product drift|logo drift|身份漂移|产品漂移|品牌漂移/i.test(issue))
  );
  // Planner-only canaries do not run the Reference Selector. Keep the metric
  // explicitly unobserved instead of manufacturing a misleading zero.
  const hardAnchorFinalSelectionRate: number | null = null;
  return {
    id,
    category,
    latencyMs,
    contractRepairCount,
    contractPassed: invalidReferences.length === 0 && causalFields.every((beat) => (beat.dependsOnBeatIds ?? []).length > 0),
    causalFieldCompletenessRate: causalFields.length
      ? causalFields.filter((beat) => (beat.dependsOnBeatIds ?? []).length > 0).length / causalFields.length
      : 0,
    invalidReferenceRate: causalFields.length ? invalidReferences.length / causalFields.length : 0,
    suddenOutcomeRisk: issueCodes.has("sudden_outcome_risk"),
    referenceOveruseRisk: issueCodes.has("reference_overuse_risk"),
    storyQualityScore: plan.storyQualityReport?.score ?? 0,
    appliedAnchorCoverageRate: expectedAnchorApplications.length
      ? expectedAnchorApplications.filter((item) => item.effective).length / expectedAnchorApplications.length
      : 1,
    invalidAnchorExclusionRate: assetTargets.length ? invalidExclusions.length / assetTargets.length : 0,
    assetContractPassed: (plan.assetContract?.issues.length ?? 0) === 0 && invalidExclusions.length === 0,
    hardAnchorFinalSelectionRate,
    unreferencedIdentityScoreRate: scoredIdentityReports.length
      ? unreferencedIdentityReports.length / scoredIdentityReports.length
      : null,
    assetDriftIssueRate: qualityReports.length ? assetDriftReports.length / qualityReports.length : null,
  };
}

function parseReferenceUrls(value: string | undefined): string[] {
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error("ONE_PROMPT_VIDEO_CANARY_REFERENCE_URLS must be a JSON string array.");
  return parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function averageKnown(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value != null);
  return known.length ? average(known) : null;
}
