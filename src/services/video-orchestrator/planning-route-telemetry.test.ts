import assert from "node:assert/strict";
import test from "node:test";
import {
  PLANNING_ROUTE_LOG_EVENTS,
  createPlanningRouteLogRecord,
  summarizePlanningRoutePerformance,
} from "./planning-route-telemetry";

test("route lifecycle event table contains the ten required events in order", () => {
  assert.deepEqual(PLANNING_ROUTE_LOG_EVENTS, [
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
  ]);
});

test("every route log record contains the complete mandatory metric shape", () => {
  const record = createPlanningRouteLogRecord({
    projectId: "project-1",
    routeTaskId: "route-1",
    model: "qwen3.7-plus",
  });
  assert.deepEqual(record, {
    projectId: "project-1",
    routeTaskId: "route-1",
    model: "qwen3.7-plus",
    apiWaitDurationMs: 0,
    routeDurationMs: 0,
    inputTokens: null,
    outputTokens: null,
    inputCharacterCount: 0,
    responseCharacterCount: 0,
    videoCategory: null,
    templateId: null,
    chronologyMode: null,
    categoryConfidence: null,
    templateConfidence: null,
    chronologyConfidence: null,
    gateResult: null,
    repairCount: 0,
    fallback: false,
    checkpointReused: false,
  });
});

test("P50/P95 use nearest-rank and API wait excludes checkpoint hits", () => {
  const records = [100, 200, 300, 400, 500].map((duration, index) =>
    createPlanningRouteLogRecord({
      projectId: "project-1",
      routeTaskId: `route-${index}`,
      model: "qwen3.7-plus",
      apiWaitDurationMs: duration,
      routeDurationMs: duration + 50,
      repairCount: index === 1 ? 1 : 0,
      fallback: index === 2,
      checkpointReused: index === 4,
    }));
  const summary = summarizePlanningRoutePerformance(records);
  assert.deepEqual(summary.apiWaitMs, { p50: 200, p95: 400 });
  assert.deepEqual(summary.routeDurationMs, { p50: 350, p95: 550 });
  assert.equal(summary.checkpointReuseRate, 0.2);
  assert.equal(summary.repairRate, 0.25);
  assert.equal(summary.fallbackRate, 0.25);
});
