export interface ShotConcurrencyBenchmarkRun {
  fixtureId: string;
  concurrency: number;
  repeat: number;
  status: "completed" | "failed";
  totalDurationMs: number;
  segmentCount: number;
  microShotCount: number;
  modelRequestCount: number;
  failedModelRequestCount: number;
  rateLimitCount: number;
  retryableFailureCount: number;
  shotPipelineDurationMs: number;
  errorCategory?: string;
  errorMessage?: string;
}

export interface ShotConcurrencyBenchmarkAggregate {
  concurrency: number;
  runCount: number;
  completedCount: number;
  successRate: number;
  totalDurationP50Ms: number | null;
  totalDurationP95Ms: number | null;
  shotPipelineP50Ms: number | null;
  shotPipelineP95Ms: number | null;
  modelRequestCount: number;
  failedModelRequestCount: number;
  modelFailureRate: number;
  rateLimitCount: number;
  rateLimitRate: number;
  retryableFailureCount: number;
}

export interface ShotConcurrencyRecommendation {
  concurrency: number | null;
  eligibleConcurrencies: number[];
  reason: string;
}

export function aggregateShotConcurrencyRuns(
  runs: ShotConcurrencyBenchmarkRun[],
): ShotConcurrencyBenchmarkAggregate[] {
  const byConcurrency = new Map<number, ShotConcurrencyBenchmarkRun[]>();
  for (const run of runs) {
    byConcurrency.set(run.concurrency, [...(byConcurrency.get(run.concurrency) ?? []), run]);
  }
  return [...byConcurrency.entries()]
    .sort(([left], [right]) => left - right)
    .map(([concurrency, items]) => {
      const completed = items.filter((item) => item.status === "completed");
      const modelRequestCount = sum(items.map((item) => item.modelRequestCount));
      const failedModelRequestCount = sum(items.map((item) => item.failedModelRequestCount));
      const rateLimitCount = sum(items.map((item) => item.rateLimitCount));
      return {
        concurrency,
        runCount: items.length,
        completedCount: completed.length,
        successRate: ratio(completed.length, items.length),
        totalDurationP50Ms: percentile(completed.map((item) => item.totalDurationMs), 0.5),
        totalDurationP95Ms: percentile(completed.map((item) => item.totalDurationMs), 0.95),
        shotPipelineP50Ms: percentile(completed.map((item) => item.shotPipelineDurationMs), 0.5),
        shotPipelineP95Ms: percentile(completed.map((item) => item.shotPipelineDurationMs), 0.95),
        modelRequestCount,
        failedModelRequestCount,
        modelFailureRate: ratio(failedModelRequestCount, modelRequestCount),
        rateLimitCount,
        rateLimitRate: ratio(rateLimitCount, modelRequestCount),
        retryableFailureCount: sum(items.map((item) => item.retryableFailureCount)),
      };
    });
}

export function recommendShotConcurrency(
  aggregates: ShotConcurrencyBenchmarkAggregate[],
  thresholds: {
    minimumSuccessRate?: number;
    maximumModelFailureRate?: number;
    maximumRateLimitRate?: number;
  } = {},
): ShotConcurrencyRecommendation {
  const minimumSuccessRate = thresholds.minimumSuccessRate ?? 0.98;
  const maximumModelFailureRate = thresholds.maximumModelFailureRate ?? 0.02;
  const maximumRateLimitRate = thresholds.maximumRateLimitRate ?? 0.01;
  const eligible = aggregates.filter((item) =>
    item.completedCount > 0
    && item.successRate >= minimumSuccessRate
    && item.modelFailureRate <= maximumModelFailureRate
    && item.rateLimitRate <= maximumRateLimitRate
    && item.totalDurationP95Ms != null
  );
  if (eligible.length) {
    const fastest = [...eligible].sort((left, right) =>
      (left.shotPipelineP95Ms ?? Number.POSITIVE_INFINITY)
      - (right.shotPipelineP95Ms ?? Number.POSITIVE_INFINITY)
      || left.concurrency - right.concurrency
    )[0];
    return {
      concurrency: fastest.concurrency,
      eligibleConcurrencies: eligible.map((item) => item.concurrency),
      reason: `并发 ${fastest.concurrency} 在成功率、模型失败率和限流率阈值内，且分段拆解流水线 P95 最低。`,
    };
  }

  const fallback = [...aggregates]
    .filter((item) => item.completedCount > 0)
    .sort((left, right) =>
      right.successRate - left.successRate
      || left.rateLimitRate - right.rateLimitRate
      || left.modelFailureRate - right.modelFailureRate
      || (left.totalDurationP95Ms ?? Number.POSITIVE_INFINITY)
        - (right.totalDurationP95Ms ?? Number.POSITIVE_INFINITY)
      || left.concurrency - right.concurrency
    )[0];
  return {
    concurrency: fallback?.concurrency ?? null,
    eligibleConcurrencies: [],
    reason: fallback
      ? `没有并发档满足全部稳定性阈值；并发 ${fallback.concurrency} 是成功率优先的降级建议，需要增加样本或降低并发后复测。`
      : "没有成功样本，无法推荐并发值。",
  };
}

export function renderShotConcurrencyCsv(runs: ShotConcurrencyBenchmarkRun[]): string {
  const columns: Array<keyof ShotConcurrencyBenchmarkRun> = [
    "fixtureId",
    "concurrency",
    "repeat",
    "status",
    "totalDurationMs",
    "shotPipelineDurationMs",
    "segmentCount",
    "microShotCount",
    "modelRequestCount",
    "failedModelRequestCount",
    "rateLimitCount",
    "retryableFailureCount",
    "errorCategory",
    "errorMessage",
  ];
  return [
    columns.join(","),
    ...runs.map((run) => columns.map((column) => csvCell(run[column])).join(",")),
    "",
  ].join("\n");
}

export function renderShotConcurrencyMarkdown(params: {
  generatedAt: string;
  modelName: string;
  runs: ShotConcurrencyBenchmarkRun[];
  aggregates: ShotConcurrencyBenchmarkAggregate[];
  recommendation: ShotConcurrencyRecommendation;
}): string {
  return [
    "# Shot Decomposer 并发压测报告",
    "",
    `- 生成时间：${params.generatedAt}`,
    `- 文本模型：${params.modelName}`,
    `- 成功运行：${params.runs.filter((item) => item.status === "completed").length}/${params.runs.length}`,
    `- 推荐并发：${params.recommendation.concurrency ?? "无"}`,
    `- 推荐依据：${params.recommendation.reason}`,
    "",
    "| 并发 | 成功率 | 完整 P50 | 完整 P95 | 分段流水线 P50 | 分段流水线 P95 | 模型失败率 | 429率 |",
    "|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...params.aggregates.map((item) => [
      `| ${item.concurrency}`,
      percent(item.successRate),
      duration(item.totalDurationP50Ms),
      duration(item.totalDurationP95Ms),
      duration(item.shotPipelineP50Ms),
      duration(item.shotPipelineP95Ms),
      percent(item.modelFailureRate),
      `${percent(item.rateLimitRate)} |`,
    ].join(" | ")),
    "",
    "## 使用建议",
    "",
    params.recommendation.concurrency == null
      ? "本轮没有足够的成功数据，请检查错误并复测。"
      : `将 \`ONE_PROMPT_VIDEO_SHOT_DECOMPOSER_CONCURRENCY\` 设置为 \`${params.recommendation.concurrency}\`，先观察一周真实流量，再用相同样本复测。`,
    "",
  ].join("\n");
}

function percentile(values: number[], quantile: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return Math.round(sorted[index]);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function ratio(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

function duration(value: number | null): string {
  if (value == null) return "—";
  const seconds = Math.round(value / 1000);
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, "0")}秒`
    : `${seconds}秒`;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function csvCell(value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}
