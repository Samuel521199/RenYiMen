import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizePlanningStage, planningAttemptTaskId } from "./planning-performance.ts";

const root = process.cwd();

test("normalizes segment and repair stage names for stable production percentiles", () => {
  assert.deepEqual(normalizePlanningStage("shot_decomposer_s3"), {
    stage: "shot_decomposer",
    segmentNo: 3,
    attempt: 1,
    kind: "model_call",
  });
  assert.deepEqual(normalizePlanningStage("split_repair_s2_r1"), {
    stage: "split_repair",
    segmentNo: 2,
    attempt: 2,
    kind: "repair",
  });
  assert.deepEqual(normalizePlanningStage("json_repair_storyboard_artist"), {
    stage: "json_repair",
    segmentNo: undefined,
    attempt: 1,
    kind: "repair",
  });
  assert.deepEqual(normalizePlanningStage("planning_duration_repair_r1"), {
    stage: "planning_duration_repair",
    segmentNo: undefined,
    attempt: 2,
    kind: "repair",
  });
});

test("uses one stable root task id while assigning a unique id to every execution attempt", () => {
  assert.equal(planningAttemptTaskId("root-task", 1), "root-task");
  assert.equal(planningAttemptTaskId("root-task", 2), "root-task:attempt:2");
  assert.equal(planningAttemptTaskId("root-task", 3), "root-task:attempt:3");
});

test("performance persistence stores timings and counters without prompts or media", async () => {
  const schema = await readFile(`${root}/prisma/schema.prisma`, "utf8");
  const service = await readFile(
    `${root}/src/services/video-orchestrator/planning-performance.ts`,
    "utf8",
  );
  const metricSchema = schema.slice(
    schema.indexOf("model VideoPlanningRunMetric"),
    schema.indexOf("model VideoConsistencyAnchorImage"),
  );
  assert.match(schema, /model VideoPlanningRunMetric/);
  assert.match(schema, /model VideoPlanningStageMetric/);
  assert.match(metricSchema, /rootTaskId\s+String/);
  assert.match(metricSchema, /attemptNumber\s+Int/);
  assert.match(metricSchema, /@@unique\(\[rootTaskId, attemptNumber\]\)/);
  assert.match(service, /percentile_cont\(0\.95\)/);
  assert.match(service, /first_pass_count/);
  assert.match(service, /WITH filtered_attempts AS/);
  assert.match(service, /logical_runs AS/);
  assert.doesNotMatch(metricSchema, /prompt|imageUrl|referenceUrl/i);
  assert.doesNotMatch(service, /systemPrompt|userContent|rawSummary/);
});

test("planner lifecycle records queue, real model stages, and terminal state", async () => {
  const projectService = await readFile(
    `${root}/src/services/video-orchestrator/project-service.ts`,
    "utf8",
  );
  const planner = await readFile(
    `${root}/src/services/video-orchestrator/three-stage-planner.ts`,
    "utf8",
  );
  assert.match(projectService, /queuePlanningPerformanceRun\(\{/);
  assert.match(projectService, /startPlanningPerformanceRun\(performanceTaskId,/);
  assert.match(projectService, /recordPlanningStageObservation\(performanceAttemptTaskId, metric\)/);
  assert.match(projectService, /finishPlanningPerformanceRun\(\{/);
  assert.match(projectService, /planningAttemptNumber: job\.attempt/);
  assert.match(projectService, /counters: performanceCounters/);
  assert.match(planner, /reportPlannerStageMetric\(\{/);
  assert.ok(
    planner.indexOf("const storyContractRepairDurationMs = Date.now() - storyContractStartedAt")
      < planner.indexOf("semanticStoryResult = await ensureStoryboardSemanticQuality"),
    "story contract repair timing must stop before the semantic critic starts",
  );
});

test("admin baseline API and dashboard expose real P50 and P95 metrics", async () => {
  const route = await readFile(
    `${root}/src/app/api/admin/stats/video-planning/route.ts`,
    "utf8",
  );
  const page = await readFile(
    `${root}/src/app/(platform)/workbench/admin/usage-stats/page.tsx`,
    "utf8",
  );
  assert.match(route, /getAdminAccess/);
  assert.match(route, /getPlanningPerformanceBaseline/);
  assert.match(page, /总耗时 P50/);
  assert.match(page, /总耗时 P95/);
  assert.match(page, /首轮通过率/);
  assert.doesNotMatch(page, /estimatePlanningProgress/);
});
