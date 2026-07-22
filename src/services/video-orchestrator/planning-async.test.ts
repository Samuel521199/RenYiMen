import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const service = readFileSync(path.join(root, "src/services/video-orchestrator/project-service.ts"), "utf8");
const planner = readFileSync(path.join(root, "src/services/video-orchestrator/three-stage-planner.ts"), "utf8");
const planRoute = readFileSync(path.join(root, "src/app/api/video-projects/[projectId]/plan/route.ts"), "utf8");
const page = readFileSync(path.join(root, "src/app/(platform)/workbench/workflows/one-prompt-video/page.tsx"), "utf8");

test("plan endpoint accepts a background job without waiting for the planner", () => {
  assert.match(planRoute, /queueVideoProjectPlanning/);
  assert.match(planRoute, /status:\s*202/);
  assert.doesNotMatch(planRoute, /await planVideoProject/);
  assert.match(service, /new Promise<void>\(\(resolve\) => setImmediate\(resolve\)\)/);
  assert.match(service, /onePromptVideoPlanningRuns/);
  assert.match(service, /PLANNING_HEARTBEAT_MS/);
  assert.match(service, /leaseExpiresAt/);
  assert.match(service, /plan_json" #>> '\{plannerProgress,taskId\}'/);
});

test("planning state persists real stages and survives refresh or process restart", () => {
  assert.match(service, /plannerProgress/);
  assert.match(service, /writePlanningEnvelope/);
  assert.match(service, /project\.status === VideoProjectStatus\.PLANNING && !planningRuns\.has\(projectId\)/);
  assert.match(service, /queueVideoProjectPlanning\(userId, projectId\)/);
  for (const stage of [
    "planning_architect",
    "storyboard_artist",
    "shot_decomposer",
    "single_take_audit",
    "prompt_detailer",
    "story_quality_gate",
  ]) assert.match(planner, new RegExp(`stage: "${stage}"`));
  assert.match(planner, /completedSegments/);
  assert.match(planner, /totalSegments/);
});

test("hidden repair multipliers are measured and exposed", () => {
  assert.match(planner, /jsonRepairCount:\s*1/);
  assert.match(planner, /jsonRepairDurationMs/);
  assert.match(planner, /singleTakeRepairCount:\s*1/);
  assert.match(planner, /singleTakeRepairDurationMs/);
  assert.match(service, /project\.plan\.progress/);
  assert.match(page, /JSON 修复/);
  assert.match(page, /一镜到底修复/);
});

test("planning UI reads backend progress instead of an elapsed-time curve", () => {
  const planningBranch = page.slice(
    page.indexOf('if (effectiveProjectStatus === "PLANNING")'),
    page.indexOf("return projectWorkflowProgressView", page.indexOf('if (effectiveProjectStatus === "PLANNING")')),
  );
  assert.match(planningBranch, /plannerWorkflowProgressView\(project\.plannerProgress/);
  assert.doesNotMatch(planningBranch, /estimatePlanningProgress/);
  assert.match(page, /真实进度：已完成/);
  assert.match(page, /剩余 \$\{remaining\} 步/);
});
