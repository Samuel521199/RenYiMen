import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { planningCheckpointResumeProgress } from "./project-service.ts";

const root = process.cwd();
const service = readFileSync(path.join(root, "src/services/video-orchestrator/project-service.ts"), "utf8");
const planner = readFileSync(path.join(root, "src/services/video-orchestrator/three-stage-planner.ts"), "utf8");
const planRoute = readFileSync(path.join(root, "src/app/api/video-projects/[projectId]/plan/route.ts"), "utf8");
const page = readFileSync(path.join(root, "src/app/(platform)/workbench/workflows/one-prompt-video/page.tsx"), "utf8");
const productionJobQueue = readFileSync(
  path.join(root, "src/services/video-orchestrator/production-job-queue.ts"),
  "utf8",
);

test("retry resumes from the persisted segment checkpoint instead of resetting to zero", () => {
  const resumed = planningCheckpointResumeProgress({
    version: 11,
    inputFingerprint: "same-input",
    planningRaw: {},
    storyboardArtistPlan: {},
    storyContractReport: { passed: true, issues: [] },
    storySemanticReview: {
      passed: true,
      score: 100,
      issueCodes: [],
      blockingIssueCodes: [],
      summaryZh: "",
      summaryEn: "",
      evidence: [],
    },
    shotDecomposerSegmentPlans: Object.fromEntries(
      [1, 2, 3, 4, 5].map((segmentNo) => [String(segmentNo), {}]),
    ),
    approvedShotDecomposerSegmentPlans: Object.fromEntries(
      [1, 3, 4, 5].map((segmentNo) => [String(segmentNo), {}]),
    ),
    promptDetailSegmentPlans: Object.fromEntries(
      [1, 3, 4, 5].map((segmentNo) => [String(segmentNo), {}]),
    ),
    updatedAt: new Date(0).toISOString(),
  } as never, 1);
  assert.equal(resumed?.completedSteps, 15);
  assert.equal(resumed?.totalSteps, 17);
  assert.equal(resumed?.completedSegments, 4);
  assert.equal(resumed?.totalSegments, 5);
  assert.equal(resumed?.stage, "prompt_detailer");
});

test("plan endpoint accepts a background job without waiting for the planner", () => {
  assert.match(planRoute, /queueVideoProjectPlanning/);
  assert.match(planRoute, /status:\s*202/);
  assert.doesNotMatch(planRoute, /await planVideoProject/);
  assert.match(service, /kind: "planning"/);
  assert.match(service, /enqueueVideoProductionJob/);
  assert.match(productionJobQueue, /idempotencyKey/);
  assert.match(service, /PLANNING_HEARTBEAT_MS/);
  assert.match(service, /leaseExpiresAt/);
  assert.match(service, /plan_json" #>> '\{plannerProgress,taskId\}'/);
});

test("planning state persists real stages and survives refresh or process restart", () => {
  assert.match(service, /plannerProgress/);
  assert.match(service, /writePlanningEnvelope/);
  assert.match(service, /claimNextVideoProductionJob/);
  assert.match(service, /job\.kind === "planning"/);
  assert.match(service, /planningTaskId: taskId/);
  assert.match(service, /planningAttemptNumber: job\.attempt/);
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
  assert.match(planner, /story_gates\.checkpoint_reused/);
  assert.match(planner, /final_prompt_validation\.local_repair/);
  assert.match(planner, /delete checkpoint\.promptDetailSegmentPlans\?\.\[String\(segmentNo\)\]/);
  assert.match(service, /Math\.max\(previous\.completedSteps/);
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

test("segment planning is a dependency pipeline instead of two global barriers", () => {
  assert.match(planner, /PROMPT_DETAILER_SEGMENT_SYSTEM_PROMPT/);
  assert.match(planner, /prompt_detailer_s\$\{segment\.segmentNo\}/);
  assert.match(planner, /expectedSegmentNos:\s*\[segment\.segmentNo\]/);
  assert.match(planner, /approvedShotDecomposerSegmentPlans/);
  assert.match(planner, /promptDetailSegmentPlans/);
  assert.match(planner, /completedSegmentResults\.reduce<VideoPromptDetailPlan>/);
  assert.match(planner, /timeline_replan_required/);
  assert.match(planner, /repair_scope:\s*"target_segments_only"/);
  assert.match(planner, /Never regenerate, alter, or repeat already approved segments/);
  assert.match(planner, /owned_keyframe_nos/);
  assert.match(planner, /buildSplitRepairContent/);
  assert.match(planner, /segments:\s*params\.planningManifest\.timelineBlueprint\.segments\.filter/);
});

test("segment pipeline bounds slow calls and serializes concurrent checkpoint writes", () => {
  assert.match(planner, /ONE_PROMPT_VIDEO_SEGMENT_STAGE_STREAM_MAX_TIMEOUT_MS/);
  assert.match(planner, /return Math\.max\(jsonStageTimeoutMs\(\), 240000\)/);
  assert.match(planner, /serializePlannerCheckpointWriter/);
  assert.match(planner, /pending\.catch\(\(\) => undefined\)\.then\(\(\) => writer\(snapshot\)\)/);
});

test("planning contract failures report returned upstream work instead of claiming no provider accepted it", () => {
  assert.match(service, /planningModelReturnedBeforeFailure/);
  assert.match(service, /Strict JSON Schema validation failed/);
  assert.match(service, /upstreamAccepted:\s*plannerProgress\?\.status === "running" \|\| planningModelReturnedBeforeFailure/);
  assert.match(page, /上游已返回，本地校验或处理失败/);
  assert.match(page, /当前阶段尝试次数/);
});
