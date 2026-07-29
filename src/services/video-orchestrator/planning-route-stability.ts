import { PLANNING_ROUTE_MODEL_CALL_POLICY } from "./planning-route-model-call";

export interface PlanningRouteStabilityRun {
  runNo: number;
  videoCategory: unknown;
  templateId: unknown;
  chronologyMode: unknown;
  apiWaitDurationMs: number;
  outputBytes: number;
  repairCallCount: number;
  modelCallCount: number;
  checkpointReused: boolean;
}

export interface PlanningRouteStabilityReport {
  sampleId: string;
  runCount: number;
  expectedRoute: {
    videoCategory: string;
    templateId: string;
    chronologyMode: string;
  };
  categoryConsistencyRate: number;
  templateConsistencyRate: number;
  chronologyConsistencyRate: number;
  p50ApiWaitDurationMs: number;
  p95ApiWaitDurationMs: number;
  maximumOutputBytes: number;
  normalRepairCallCount: number;
  checkpointRecoveryModelCallCount: number;
  thresholds: {
    categoryConsistencyRate: number;
    templateConsistencyRate: number;
    chronologyConsistencyRate: number;
    p50ApiWaitDurationMs: number;
    p95ApiWaitDurationMs: number;
    maximumOutputBytes: number;
    normalRepairCallCount: number;
    checkpointRecoveryModelCallCount: number;
  };
  passed: boolean;
}

export const PLANNING_ROUTE_STABILITY_THRESHOLDS = {
  runCount: 20,
  categoryConsistencyRate: 0.95,
  templateConsistencyRate: 0.9,
  chronologyConsistencyRate: 0.95,
  p50ApiWaitDurationMs: PLANNING_ROUTE_MODEL_CALL_POLICY.performanceTargetsMs.p50,
  p95ApiWaitDurationMs: PLANNING_ROUTE_MODEL_CALL_POLICY.performanceTargetsMs.p95,
  maximumOutputBytes: PLANNING_ROUTE_MODEL_CALL_POLICY.maxOutputBytes,
  normalRepairCallCount: 0,
  checkpointRecoveryModelCallCount: 0,
} as const;

function rate(matches: number, total: number): number {
  return total === 0 ? 0 : matches / total;
}

function nearestRank(values: number[], percentile: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentile * sorted.length) - 1);
  return sorted[index] ?? 0;
}

export function evaluatePlanningRouteStability(params: {
  sampleId: string;
  expectedRoute: PlanningRouteStabilityReport["expectedRoute"];
  runs: PlanningRouteStabilityRun[];
}): PlanningRouteStabilityReport {
  const normalRuns = params.runs.filter((run) => !run.checkpointReused);
  const checkpointRuns = params.runs.filter((run) => run.checkpointReused);
  const categoryConsistencyRate = rate(
    normalRuns.filter((run) => run.videoCategory === params.expectedRoute.videoCategory).length,
    normalRuns.length,
  );
  const templateConsistencyRate = rate(
    normalRuns.filter((run) => run.templateId === params.expectedRoute.templateId).length,
    normalRuns.length,
  );
  const chronologyConsistencyRate = rate(
    normalRuns.filter((run) => run.chronologyMode === params.expectedRoute.chronologyMode).length,
    normalRuns.length,
  );
  const p50ApiWaitDurationMs = nearestRank(
    normalRuns.map((run) => run.apiWaitDurationMs),
    0.5,
  );
  const p95ApiWaitDurationMs = nearestRank(
    normalRuns.map((run) => run.apiWaitDurationMs),
    0.95,
  );
  const maximumOutputBytes = Math.max(0, ...normalRuns.map((run) => run.outputBytes));
  const normalRepairCallCount = normalRuns.reduce((sum, run) => sum + run.repairCallCount, 0);
  const checkpointRecoveryModelCallCount = checkpointRuns.reduce(
    (sum, run) => sum + run.modelCallCount,
    0,
  );
  const thresholds = {
    categoryConsistencyRate: PLANNING_ROUTE_STABILITY_THRESHOLDS.categoryConsistencyRate,
    templateConsistencyRate: PLANNING_ROUTE_STABILITY_THRESHOLDS.templateConsistencyRate,
    chronologyConsistencyRate: PLANNING_ROUTE_STABILITY_THRESHOLDS.chronologyConsistencyRate,
    p50ApiWaitDurationMs: PLANNING_ROUTE_STABILITY_THRESHOLDS.p50ApiWaitDurationMs,
    p95ApiWaitDurationMs: PLANNING_ROUTE_STABILITY_THRESHOLDS.p95ApiWaitDurationMs,
    maximumOutputBytes: PLANNING_ROUTE_STABILITY_THRESHOLDS.maximumOutputBytes,
    normalRepairCallCount: PLANNING_ROUTE_STABILITY_THRESHOLDS.normalRepairCallCount,
    checkpointRecoveryModelCallCount:
      PLANNING_ROUTE_STABILITY_THRESHOLDS.checkpointRecoveryModelCallCount,
  };
  const passed = normalRuns.length === PLANNING_ROUTE_STABILITY_THRESHOLDS.runCount
    && checkpointRuns.length >= 1
    && categoryConsistencyRate >= thresholds.categoryConsistencyRate
    && templateConsistencyRate >= thresholds.templateConsistencyRate
    && chronologyConsistencyRate >= thresholds.chronologyConsistencyRate
    && p50ApiWaitDurationMs <= thresholds.p50ApiWaitDurationMs
    && p95ApiWaitDurationMs <= thresholds.p95ApiWaitDurationMs
    && maximumOutputBytes <= thresholds.maximumOutputBytes
    && normalRepairCallCount === thresholds.normalRepairCallCount
    && checkpointRecoveryModelCallCount === thresholds.checkpointRecoveryModelCallCount;

  return {
    sampleId: params.sampleId,
    runCount: normalRuns.length,
    expectedRoute: params.expectedRoute,
    categoryConsistencyRate,
    templateConsistencyRate,
    chronologyConsistencyRate,
    p50ApiWaitDurationMs,
    p95ApiWaitDurationMs,
    maximumOutputBytes,
    normalRepairCallCount,
    checkpointRecoveryModelCallCount,
    thresholds,
    passed,
  };
}
