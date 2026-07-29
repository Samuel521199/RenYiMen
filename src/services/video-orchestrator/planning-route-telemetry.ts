import type { ApprovedPlanningRouteContract } from "./planning-route-planning-architect";

export const PLANNING_ROUTE_LOG_EVENTS = [
  "planning.route.prepare",
  "planning.route.model.start",
  "planning.route.model.complete",
  "planning.route.parse",
  "planning.route.gate",
  "planning.route.deterministic_repair",
  "planning.route.model_repair",
  "planning.route.fallback",
  "planning.route.checkpoint.reused",
  "planning.route.complete",
] as const;

export type PlanningRouteLogEvent = typeof PLANNING_ROUTE_LOG_EVENTS[number];

export interface PlanningRouteLogRecord extends Record<string, unknown> {
  projectId: string;
  routeTaskId: string;
  model: string;
  apiWaitDurationMs: number;
  routeDurationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  inputCharacterCount: number;
  responseCharacterCount: number;
  videoCategory: string | null;
  templateId: string | null;
  chronologyMode: string | null;
  categoryConfidence: number | null;
  templateConfidence: number | null;
  chronologyConfidence: number | null;
  gateResult: string | null;
  repairCount: number;
  fallback: boolean;
  checkpointReused: boolean;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function createPlanningRouteLogRecord(params: {
  projectId: string;
  routeTaskId: string;
  model: string;
  route?: ApprovedPlanningRouteContract | Record<string, unknown>;
  apiWaitDurationMs?: number;
  routeDurationMs?: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  inputCharacterCount?: number;
  responseCharacterCount?: number;
  gateResult?: string | null;
  repairCount?: number;
  fallback?: boolean;
  checkpointReused?: boolean;
  extra?: Record<string, unknown>;
}): PlanningRouteLogRecord {
  const route = params.route ?? {};
  return {
    projectId: params.projectId,
    routeTaskId: params.routeTaskId,
    model: params.model,
    apiWaitDurationMs: params.apiWaitDurationMs ?? 0,
    routeDurationMs: params.routeDurationMs ?? 0,
    inputTokens: params.inputTokens ?? null,
    outputTokens: params.outputTokens ?? null,
    inputCharacterCount: params.inputCharacterCount ?? 0,
    responseCharacterCount: params.responseCharacterCount ?? 0,
    videoCategory: typeof route.videoCategory === "string" ? route.videoCategory : null,
    templateId: typeof route.templateId === "string" ? route.templateId : null,
    chronologyMode: typeof route.chronologyMode === "string" ? route.chronologyMode : null,
    categoryConfidence: finiteNumber(route.categoryConfidence),
    templateConfidence: finiteNumber(route.templateConfidence),
    chronologyConfidence: finiteNumber(route.chronologyConfidence),
    gateResult: params.gateResult ?? null,
    repairCount: params.repairCount ?? 0,
    fallback: params.fallback ?? Boolean(route.fallbackUsed),
    checkpointReused: params.checkpointReused ?? false,
    ...(params.extra ?? {}),
  };
}

function nearestRank(values: number[], percentile: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentile * sorted.length) - 1);
  return sorted[index] ?? null;
}

export interface PlanningRoutePerformanceSummary {
  sampleCount: number;
  modelCallSampleCount: number;
  apiWaitMs: { p50: number | null; p95: number | null };
  routeDurationMs: { p50: number | null; p95: number | null };
  checkpointReuseRate: number;
  repairRate: number;
  fallbackRate: number;
}

export function summarizePlanningRoutePerformance(
  completed: PlanningRouteLogRecord[],
): PlanningRoutePerformanceSummary {
  const modelCalls = completed.filter((item) => !item.checkpointReused);
  const rate = (count: number) => completed.length ? count / completed.length : 0;
  const modelRate = (count: number) => modelCalls.length ? count / modelCalls.length : 0;
  return {
    sampleCount: completed.length,
    modelCallSampleCount: modelCalls.length,
    apiWaitMs: {
      p50: nearestRank(modelCalls.map((item) => item.apiWaitDurationMs), 0.5),
      p95: nearestRank(modelCalls.map((item) => item.apiWaitDurationMs), 0.95),
    },
    routeDurationMs: {
      p50: nearestRank(completed.map((item) => item.routeDurationMs), 0.5),
      p95: nearestRank(completed.map((item) => item.routeDurationMs), 0.95),
    },
    checkpointReuseRate: rate(completed.filter((item) => item.checkpointReused).length),
    repairRate: modelRate(modelCalls.filter((item) => item.repairCount > 0).length),
    fallbackRate: modelRate(modelCalls.filter((item) => item.fallback).length),
  };
}
