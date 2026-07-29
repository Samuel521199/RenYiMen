import { loadEnvConfig } from "@next/env";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createModelRouteClassificationCheckpoint,
  decideRouteCheckpointReuse,
  routeReferenceFactFingerprint,
  routeUserInputFingerprint,
} from "../src/services/video-orchestrator/planning-route-checkpoint";
import { buildPlanningRouteInput } from "../src/services/video-orchestrator/planning-route-input-contract";
import {
  createOpenAiCompatiblePlanningRouteTransport,
  runPlanningRouteModelCall,
} from "../src/services/video-orchestrator/planning-route-model-call";
import type { ApprovedPlanningRouteContract } from "../src/services/video-orchestrator/planning-route-planning-architect";
import {
  PLANNING_ROUTE_STABILITY_THRESHOLDS,
  evaluatePlanningRouteStability,
  type PlanningRouteStabilityRun,
} from "../src/services/video-orchestrator/planning-route-stability";

loadEnvConfig(process.cwd());

const live = process.argv.includes("--live");
const confirmed = process.argv.includes("--confirm-billable");
const expectedRoute = {
  videoCategory: "game",
  templateId: "game_bonus_payoff",
  chronologyMode: "chronological",
};
const input = buildPlanningRouteInput({
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

function apiKey(): string {
  const value = process.env.DASHSCOPE_API_KEY
    || process.env.BAILIAN_API_KEY
    || process.env.ALIYUN_API_KEY;
  if (!value?.trim()) {
    throw new Error("缺少 DASHSCOPE_API_KEY、BAILIAN_API_KEY 或 ALIYUN_API_KEY。");
  }
  return value.trim();
}

function endpoint(): string {
  const base = process.env.DASHSCOPE_COMPATIBLE_BASE_URL
    || process.env.ALIYUN_COMPATIBLE_BASE_URL
    || "https://dashscope.aliyuncs.com/compatible-mode/v1";
  return `${base.replace(/\/$/, "")}/chat/completions`;
}

async function main(): Promise<void> {
  const estimate = {
    mode: live ? "live" : "dry-run",
    sampleId: "tongits-king-route-v1",
    normalRuns: PLANNING_ROUTE_STABILITY_THRESHOLDS.runCount,
    checkpointRecoveryRuns: 1,
    maximumPaidModelCalls: PLANNING_ROUTE_STABILITY_THRESHOLDS.runCount * 2,
    expectedNormalPaidModelCalls: PLANNING_ROUTE_STABILITY_THRESHOLDS.runCount,
    expectedRoute,
  };
  process.stdout.write(`${JSON.stringify(estimate, null, 2)}\n`);
  if (!live) {
    process.stdout.write("Dry-run only. No model request was sent.\n");
    return;
  }
  if (!confirmed) {
    throw new Error("真实稳定性测试需要同时传入 --live --confirm-billable。");
  }

  const transport = createOpenAiCompatiblePlanningRouteTransport({
    endpoint: endpoint(),
    apiKey: apiKey(),
  });
  const runs: PlanningRouteStabilityRun[] = [];
  let lastRoute: ApprovedPlanningRouteContract | null = null;
  for (let index = 0; index < PLANNING_ROUTE_STABILITY_THRESHOLDS.runCount; index += 1) {
    const result = await runPlanningRouteModelCall({ input, transport });
    lastRoute = result.value as unknown as ApprovedPlanningRouteContract;
    const run: PlanningRouteStabilityRun = {
      runNo: index + 1,
      videoCategory: result.value.videoCategory,
      templateId: result.value.templateId,
      chronologyMode: result.value.chronologyMode,
      apiWaitDurationMs: result.apiWaitDurationMs,
      outputBytes: result.outputBytes,
      repairCallCount: result.repairCallCount,
      modelCallCount: result.attemptCount,
      checkpointReused: false,
    };
    runs.push(run);
    process.stdout.write(
      `[${run.runNo}/20] ${String(run.videoCategory)} -> ${String(run.templateId)} -> ${String(run.chronologyMode)}; wait=${run.apiWaitDurationMs}ms; repair=${run.repairCallCount}\n`,
    );
  }

  if (!lastRoute) throw new Error("稳定性测试没有产生 Route Contract。");
  const userInputFingerprint = routeUserInputFingerprint({
    userCreative: input.userCreative,
    explicitRouteConstraints: input.userConstraints,
  });
  const referenceFactFingerprint = routeReferenceFactFingerprint(input.referenceFacts);
  const checkpoint = createModelRouteClassificationCheckpoint({
    routeContract: lastRoute,
    userInputFingerprint,
    referenceFactFingerprint,
    modelName: "qwen3.7-plus",
    modelDurationMs: runs.at(-1)?.apiWaitDurationMs ?? 0,
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
  if (!reuse.reuse) throw new Error(`checkpoint 未复用：${reuse.reason}`);
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
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const outputDirectory = path.join(
    process.cwd(),
    "docs",
    "baselines",
    `planning-route-stability-${stamp}`,
  );
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, "report.json");
  await writeFile(outputPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    liveModel: true,
    report,
    runs,
  }, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${outputPath}\n`);
  if (!report.passed) process.exitCode = 1;
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
