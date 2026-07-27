import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateShotConcurrencyRuns,
  recommendShotConcurrency,
  renderShotConcurrencyCsv,
  selectAdaptiveFinalists,
  type ShotConcurrencyBenchmarkRun,
} from "./shot-concurrency-benchmark.ts";

const runs: ShotConcurrencyBenchmarkRun[] = [
  completed(2, 1, 900_000),
  completed(2, 2, 840_000),
  completed(4, 1, 620_000),
  completed(4, 2, 650_000),
  { ...completed(8, 1, 590_000), modelRequestCount: 20, rateLimitCount: 2, failedModelRequestCount: 2 },
  { ...completed(8, 2, 610_000), modelRequestCount: 20, rateLimitCount: 2, failedModelRequestCount: 2 },
];

test("concurrency benchmark aggregates percentiles and error rates per level", () => {
  const aggregates = aggregateShotConcurrencyRuns(runs);
  assert.deepEqual(aggregates.map((item) => item.concurrency), [2, 4, 8]);
  assert.equal(aggregates[1].totalDurationP50Ms, 620_000);
  assert.equal(aggregates[1].totalDurationP95Ms, 650_000);
  assert.equal(aggregates[2].rateLimitRate, 0.1);
});

test("recommendation rejects a faster concurrency level when it is unstable", () => {
  const recommendation = recommendShotConcurrency(aggregateShotConcurrencyRuns(runs));
  assert.equal(recommendation.concurrency, 4);
  assert.deepEqual(recommendation.eligibleConcurrencies, [2, 4]);
});

test("adaptive first pass selects the two fastest stable levels", () => {
  const firstPass = aggregateShotConcurrencyRuns([
    completed(1, 1, 900_000),
    completed(4, 1, 600_000),
    completed(8, 1, 500_000),
    {
      ...completed(10, 1, 450_000),
      modelRequestCount: 20,
      failedModelRequestCount: 1,
      rateLimitCount: 1,
    },
  ]);
  assert.deepEqual(selectAdaptiveFinalists(firstPass), [8, 4]);
});

test("CSV output safely quotes model errors", () => {
  const csv = renderShotConcurrencyCsv([{
    ...completed(2, 1, 1000),
    status: "failed",
    errorMessage: "HTTP 429, retry later",
  }]);
  assert.match(csv, /"HTTP 429, retry later"/);
});

function completed(
  concurrency: number,
  repeat: number,
  totalDurationMs: number,
): ShotConcurrencyBenchmarkRun {
  return {
    fixtureId: "product-proof",
    concurrency,
    repeat,
    status: "completed",
    totalDurationMs,
    segmentCount: 5,
    microShotCount: 5,
    modelRequestCount: 20,
    failedModelRequestCount: 0,
    rateLimitCount: 0,
    retryableFailureCount: 0,
    shotPipelineDurationMs: Math.round(totalDurationMs * 0.8),
  };
}
