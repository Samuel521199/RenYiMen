import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

import {
  aggregateShotConcurrencyRuns,
  recommendShotConcurrency,
  renderShotConcurrencyCsv,
  renderShotConcurrencyMarkdown,
  type ShotConcurrencyBenchmarkRun,
} from "../src/services/video-orchestrator/shot-concurrency-benchmark";
import type {
  AliyunStoryboardPlannerCheckpoint,
  AliyunStoryboardStageMetric,
} from "../src/services/video-orchestrator/three-stage-planner";

interface BenchmarkFixture {
  id: string;
  prompt: string;
  stylePreset: string;
}

interface CliOptions {
  live: boolean;
  concurrencies: number[];
  repeats: number;
  fixtureCount: number;
  cooldownMs: number;
  outputDir: string;
}

const fixtures: BenchmarkFixture[] = [
  {
    id: "product-proof",
    stylePreset: "cinematic commercial",
    prompt: "制作一条30秒竖屏护肤产品广告。开场展示熬夜后的皮肤干燥困扰，人物实际使用产品，随后通过清晰可见的肤质和情绪变化证明效果，最后以产品特写和简洁行动号召收束。全片人物、产品包装和浴室空间保持一致，每段必须是一镜到底。",
  },
  {
    id: "game-causal-payoff",
    stylePreset: "polished mobile game ad",
    prompt: "制作一条30秒竖屏手机游戏广告。主角先遭遇明确失败压力，通过一次可见的策略操作扭转局面，展示对手反应和胜利证据，最后自然进入游戏下载号召。保持主角、游戏桌和核心道具一致，每个视频片段内部不得切镜。",
  },
  {
    id: "short-drama-conflict",
    stylePreset: "cinematic short drama",
    prompt: "制作一条30秒竖屏都市短剧。女主在会议中被同事质疑，她展示一份可见证据扭转权力关系，对方的态度和现场反应必须清楚，最后以女主从容离场收束。人物服装、办公室空间和关键文件保持一致，每段采用连续可实现的单镜头。",
  },
];

class SeedCheckpointReady extends Error {
  constructor() {
    super("Benchmark seed checkpoint is ready.");
    this.name = "SeedCheckpointReady";
  }
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const options = parseCliOptions(process.argv.slice(2));
  const selectedFixtures = fixtures.slice(0, options.fixtureCount);
  const estimatedPlannerRuns = selectedFixtures.length * options.repeats * options.concurrencies.length;
  const estimate = {
    mode: options.live ? "live" : "dry-run",
    model: process.env.ALIYUN_STORYBOARD_MODEL?.trim() || "qwen3.7-plus",
    concurrencies: options.concurrencies,
    repeats: options.repeats,
    fixtures: selectedFixtures.map((item) => item.id),
    seedCheckpointRuns: selectedFixtures.length,
    measuredPlannerRuns: estimatedPlannerRuns,
    estimatedSegmentModelCalls: estimatedPlannerRuns * 5 * 2,
    note: "估算按每个项目5段、每段拆解与Prompt细化各1次计算，不含模型修复和时间线重规划。",
  };
  process.stdout.write(`${JSON.stringify(estimate, null, 2)}\n`);
  if (!options.live) {
    process.stdout.write("\n这是 dry-run，未调用任何模型。添加 --live 并设置 ONE_PROMPT_VIDEO_CONCURRENCY_BENCHMARK=1 才会执行真实压测。\n");
    return;
  }
  if (process.env.ONE_PROMPT_VIDEO_CONCURRENCY_BENCHMARK !== "1") {
    throw new Error("真实压测保护未解除：请设置 ONE_PROMPT_VIDEO_CONCURRENCY_BENCHMARK=1。");
  }
  if (
    !process.env.DASHSCOPE_API_KEY?.trim()
    && !process.env.BAILIAN_API_KEY?.trim()
    && !process.env.ALIYUN_API_KEY?.trim()
  ) {
    throw new Error("缺少 DASHSCOPE_API_KEY、BAILIAN_API_KEY 或 ALIYUN_API_KEY。");
  }

  const { createAliyunStoryboardPlan } = await import("../src/services/video-orchestrator/three-stage-planner");
  const generatedAt = new Date().toISOString();
  const reportDir = resolveReportDirectory(options.outputDir, generatedAt);
  await mkdir(reportDir, { recursive: true });
  const seedCheckpoints = new Map<string, AliyunStoryboardPlannerCheckpoint>();
  for (const fixture of selectedFixtures) {
    process.stdout.write(`\n[seed] ${fixture.id}: 生成共享前置检查点…\n`);
    const checkpoint = await createSeedCheckpoint(fixture, createAliyunStoryboardPlan);
    seedCheckpoints.set(fixture.id, checkpoint);
    await writeFile(
      path.join(reportDir, `seed-${fixture.id}.json`),
      `${JSON.stringify(checkpoint, null, 2)}\n`,
      "utf8",
    );
  }

  const runs: ShotConcurrencyBenchmarkRun[] = [];
  const executionOrder = interleavedExecutionOrder(options, selectedFixtures);
  // The seed checkpoint already contains the semantic story review. Disable
  // the unrelated critic during measured runs so the benchmark pays for and
  // measures the per-segment pipeline rather than a constant serial prelude.
  process.env.ONE_PROMPT_VIDEO_SEMANTIC_STORY_GATE = "off";
  for (let index = 0; index < executionOrder.length; index += 1) {
    const item = executionOrder[index];
    const checkpoint = requiredCheckpoint(seedCheckpoints, item.fixture.id);
    process.env.ONE_PROMPT_VIDEO_SHOT_DECOMPOSER_MODE = "segment";
    process.env.ONE_PROMPT_VIDEO_SHOT_DECOMPOSER_CONCURRENCY = String(item.concurrency);
    process.stdout.write(
      `\n[${index + 1}/${executionOrder.length}] fixture=${item.fixture.id} concurrency=${item.concurrency} repeat=${item.repeat}\n`,
    );
    const run = await runBenchmarkCase({
      fixture: item.fixture,
      concurrency: item.concurrency,
      repeat: item.repeat,
      checkpoint,
      createAliyunStoryboardPlan,
    });
    runs.push(run);
    process.stdout.write(
      `${run.status} total=${formatMs(run.totalDurationMs)} pipeline=${formatMs(run.shotPipelineDurationMs)} requests=${run.modelRequestCount} 429=${run.rateLimitCount}\n`,
    );
    await writeInterimReports(reportDir, generatedAt, runs);
    if (options.cooldownMs > 0 && index < executionOrder.length - 1) {
      await delay(options.cooldownMs);
    }
  }

  const { recommendation } = await writeInterimReports(reportDir, generatedAt, runs);
  process.stdout.write(`\n完成。推荐并发：${recommendation.concurrency ?? "无"}\n${recommendation.reason}\n`);
  process.stdout.write(`报告目录：${reportDir}\n`);
  if (!runs.some((item) => item.status === "completed")) process.exitCode = 1;
}

async function createSeedCheckpoint(
  fixture: BenchmarkFixture,
  createPlan: typeof import("../src/services/video-orchestrator/three-stage-planner").createAliyunStoryboardPlan,
): Promise<AliyunStoryboardPlannerCheckpoint> {
  let seed: AliyunStoryboardPlannerCheckpoint | undefined;
  try {
    await createPlan(plannerInput(fixture), {
      onCheckpoint(checkpoint) {
        seed = structuredClone(checkpoint);
        if (
          checkpoint.storyboardArtistPlan
          && !Object.keys(checkpoint.shotDecomposerSegmentPlans ?? {}).length
        ) {
          throw new SeedCheckpointReady();
        }
      },
    });
  } catch (error) {
    if (!(error instanceof SeedCheckpointReady)) throw error;
  }
  if (!seed?.storyboardArtistPlan || !seed.planningRaw) {
    throw new Error(`Fixture ${fixture.id} 未能生成可复用的 Stage 2B 前检查点。`);
  }
  return resetSegmentCheckpoint(seed);
}

async function runBenchmarkCase(params: {
  fixture: BenchmarkFixture;
  concurrency: number;
  repeat: number;
  checkpoint: AliyunStoryboardPlannerCheckpoint;
  createAliyunStoryboardPlan: typeof import("../src/services/video-orchestrator/three-stage-planner").createAliyunStoryboardPlan;
}): Promise<ShotConcurrencyBenchmarkRun> {
  const stageMetrics: AliyunStoryboardStageMetric[] = [];
  const startedAt = Date.now();
  try {
    const plan = await params.createAliyunStoryboardPlan(plannerInput(params.fixture), {
      checkpoint: resetSegmentCheckpoint(params.checkpoint),
      onStageMetric(metric) {
        stageMetrics.push(metric);
      },
    });
    return buildRunResult({
      fixtureId: params.fixture.id,
      concurrency: params.concurrency,
      repeat: params.repeat,
      status: "completed",
      totalDurationMs: Date.now() - startedAt,
      segmentCount: plan.segments.length,
      microShotCount: plan.segments.reduce((sum, segment) => sum + (segment.microShots?.length ?? 0), 0),
      stageMetrics,
    });
  } catch (error) {
    return buildRunResult({
      fixtureId: params.fixture.id,
      concurrency: params.concurrency,
      repeat: params.repeat,
      status: "failed",
      totalDurationMs: Date.now() - startedAt,
      segmentCount: 0,
      microShotCount: 0,
      stageMetrics,
      error,
    });
  }
}

function buildRunResult(params: {
  fixtureId: string;
  concurrency: number;
  repeat: number;
  status: "completed" | "failed";
  totalDurationMs: number;
  segmentCount: number;
  microShotCount: number;
  stageMetrics: AliyunStoryboardStageMetric[];
  error?: unknown;
}): ShotConcurrencyBenchmarkRun {
  const relevant = params.stageMetrics.filter((metric) =>
    /^(shot_decomposer_s\d+|prompt_detailer_s\d+|split_repair|timeline_replan)/i.test(metric.stage)
  );
  const firstStartedAt = relevant.reduce(
    (minimum, metric) => Math.min(minimum, metric.startedAt.getTime()),
    Number.POSITIVE_INFINITY,
  );
  const lastCompletedAt = relevant.reduce(
    (maximum, metric) => Math.max(maximum, metric.completedAt.getTime()),
    0,
  );
  const errorMessage = params.error instanceof Error ? params.error.message : params.error ? String(params.error) : undefined;
  const implicitRateLimit = errorMessage && /(?:HTTP\s*)?429|rate.?limit|too many requests/i.test(errorMessage) ? 1 : 0;
  return {
    fixtureId: params.fixtureId,
    concurrency: params.concurrency,
    repeat: params.repeat,
    status: params.status,
    totalDurationMs: params.totalDurationMs,
    segmentCount: params.segmentCount,
    microShotCount: params.microShotCount,
    modelRequestCount: relevant.length,
    failedModelRequestCount: relevant.filter((metric) => metric.status === "failed").length,
    rateLimitCount: relevant.filter((metric) => metric.httpStatus === 429).length + implicitRateLimit,
    retryableFailureCount: relevant.filter((metric) => metric.status === "failed" && metric.retryable).length,
    shotPipelineDurationMs: Number.isFinite(firstStartedAt) && lastCompletedAt >= firstStartedAt
      ? lastCompletedAt - firstStartedAt
      : params.totalDurationMs,
    errorCategory: params.error instanceof Error ? params.error.name : params.error ? "unknown_error" : undefined,
    errorMessage,
  };
}

async function writeInterimReports(
  reportDir: string,
  generatedAt: string,
  runs: ShotConcurrencyBenchmarkRun[],
) {
  const aggregates = aggregateShotConcurrencyRuns(runs);
  const recommendation = recommendShotConcurrency(aggregates);
  const payload = {
    generatedAt,
    updatedAt: new Date().toISOString(),
    modelName: process.env.ALIYUN_STORYBOARD_MODEL?.trim() || "qwen3.7-plus",
    configuredConcurrencies: [...new Set(runs.map((item) => item.concurrency))].sort((a, b) => a - b),
    recommendation,
    aggregates,
    runs,
  };
  await Promise.all([
    writeFile(path.join(reportDir, "report.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8"),
    writeFile(path.join(reportDir, "runs.csv"), renderShotConcurrencyCsv(runs), "utf8"),
    writeFile(path.join(reportDir, "report.md"), renderShotConcurrencyMarkdown({
      generatedAt,
      modelName: payload.modelName,
      runs,
      aggregates,
      recommendation,
    }), "utf8"),
  ]);
  return { aggregates, recommendation };
}

function interleavedExecutionOrder(options: CliOptions, selectedFixtures: BenchmarkFixture[]) {
  return Array.from({ length: options.repeats }, (_, repeatIndex) =>
    selectedFixtures.flatMap((fixture, fixtureIndex) => {
      const rotated = rotate(options.concurrencies, (repeatIndex + fixtureIndex) % options.concurrencies.length);
      return rotated.map((concurrency) => ({
        fixture,
        concurrency,
        repeat: repeatIndex + 1,
      }));
    })
  ).flat();
}

function plannerInput(fixture: BenchmarkFixture) {
  return {
    userPrompt: fixture.prompt,
    aspectRatio: "9:16" as const,
    durationSeconds: 30,
    stylePreset: fixture.stylePreset,
    referenceImageUrls: [],
  };
}

function resetSegmentCheckpoint(
  checkpoint: AliyunStoryboardPlannerCheckpoint,
): AliyunStoryboardPlannerCheckpoint {
  const copy = structuredClone(checkpoint);
  delete copy.shotDecomposerSegmentPlans;
  delete copy.approvedShotDecomposerSegmentPlans;
  delete copy.promptDetailSegmentPlans;
  copy.timelineReplanAttempts = 0;
  copy.timelineChangeHistory = [];
  copy.updatedAt = new Date().toISOString();
  return copy;
}

function parseCliOptions(args: string[]): CliOptions {
  const live = args.includes("--live");
  const concurrencies = parseIntegerList(option(args, "--concurrency") ?? "1,2,3,4,6,8,10", 1, 10);
  const repeats = parseInteger(option(args, "--repeats") ?? "2", 1, 20, "--repeats");
  const fixtureCount = parseInteger(option(args, "--fixtures") ?? "1", 1, fixtures.length, "--fixtures");
  const cooldownMs = parseInteger(option(args, "--cooldown-ms") ?? "3000", 0, 300_000, "--cooldown-ms");
  return {
    live,
    concurrencies,
    repeats,
    fixtureCount,
    cooldownMs,
    outputDir: option(args, "--output") ?? path.join("reports", "one-prompt-video", "shot-concurrency"),
  };
}

function option(args: string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseIntegerList(value: string, minimum: number, maximum: number): number[] {
  const values = [...new Set(value.split(",").map((item) =>
    parseInteger(item.trim(), minimum, maximum, "--concurrency")
  ))].sort((left, right) => left - right);
  if (!values.length) throw new Error("--concurrency 至少需要一个整数。");
  return values;
}

function parseInteger(value: string, minimum: number, maximum: number, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} 必须是 ${minimum} 到 ${maximum} 之间的整数。`);
  }
  return parsed;
}

function resolveReportDirectory(baseDir: string, generatedAt: string): string {
  const safeTimestamp = generatedAt.replace(/[:.]/g, "-");
  return path.resolve(process.cwd(), baseDir, safeTimestamp);
}

function requiredCheckpoint(
  checkpoints: Map<string, AliyunStoryboardPlannerCheckpoint>,
  fixtureId: string,
): AliyunStoryboardPlannerCheckpoint {
  const checkpoint = checkpoints.get(fixtureId);
  if (!checkpoint) throw new Error(`Missing seed checkpoint for ${fixtureId}.`);
  return checkpoint;
}

function rotate<T>(items: T[], offset: number): T[] {
  if (!items.length) return [];
  const index = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(index), ...items.slice(0, index)];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
