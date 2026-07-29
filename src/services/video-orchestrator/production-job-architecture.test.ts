import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  capacityRetryDelayMs,
  classifyVideoProductionError,
  classifyVideoProductionFailure,
  failureBudgetForCategory,
  infrastructureRetryDelayMs,
  ProductionSchedulingInvariantError,
} from "./production-job-queue";
import {
  configuredProviderCapacity,
  isProviderCapacityError,
  ProviderCapacityError,
} from "./provider-capacity";
import { StoryboardStageError } from "./storyboard-stage-retry";
import { StructuredOutputSyntaxError } from "./structured-output-error";

const serviceSource = readFileSync(
  new URL("./project-service.ts", import.meta.url),
  "utf8",
);
const queueSource = readFileSync(
  new URL("./production-job-queue.ts", import.meta.url),
  "utf8",
);
const providerCapacitySource = readFileSync(
  new URL("./provider-capacity.ts", import.meta.url),
  "utf8",
);
const schemaSource = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);
const cronSource = readFileSync(
  new URL("../../app/api/cron/cleanup/route.ts", import.meta.url),
  "utf8",
);
const composeSource = readFileSync(
  new URL("../../../docker-compose.yml", import.meta.url),
  "utf8",
);
const devRunnerSource = readFileSync(
  new URL("../../../scripts/dev-with-video-worker.mjs", import.meta.url),
  "utf8",
);
const workerSource = readFileSync(
  new URL("../../../scripts/video-production-worker.ts", import.meta.url),
  "utf8",
);
const aliyunWorkflowSource = readFileSync(
  new URL("./aliyun-workflow.ts", import.meta.url),
  "utf8",
);
const readableLoggerSource = readFileSync(
  new URL("./logger.ts", import.meta.url),
  "utf8",
);
const pollMetricsMigrationSource = readFileSync(
  new URL("../../../prisma/migrations/20260728210000_add_generation_poll_metrics/migration.sql", import.meta.url),
  "utf8",
);
const targetInvariantMigrationSource = readFileSync(
  new URL("../../../prisma/migrations/20260728224500_enforce_video_job_target_invariants/migration.sql", import.meta.url),
  "utf8",
);
const phaseOneInvariantMigrationSource = readFileSync(
  new URL("../../../prisma/migrations/20260728233000_archive_legacy_reconcile_and_enforce_active_target_job/migration.sql", import.meta.url),
  "utf8",
);
const retryBudgetMigrationSource = readFileSync(
  new URL("../../../prisma/migrations/20260729103000_split_video_job_retry_budgets/migration.sql", import.meta.url),
  "utf8",
);
const mediaPlannerSource = readFileSync(
  new URL("./media-conditioned-planner.ts", import.meta.url),
  "utf8",
);
const clipRegenerateRouteSource = readFileSync(
  new URL("../../app/api/video-projects/[projectId]/segments/[segmentId]/clip/route.ts", import.meta.url),
  "utf8",
);
const executionContractErrorSource = readFileSync(
  new URL("./execution-contract-error.ts", import.meta.url),
  "utf8",
);

test("/sync is a read-only projection and production work stays in a worker", () => {
  const readStart = serviceSource.indexOf("export async function syncVideoProject");
  const workerStart = serviceSource.indexOf("async function runVideoProjectReconcileWorker");
  assert.ok(readStart >= 0 && workerStart > readStart);
  const readOnlyBody = serviceSource.slice(readStart, workerStart);
  assert.match(readOnlyBody, /requireVideoProject/);
  assert.match(readOnlyBody, /productionMode:\s*"read_only"/);
  assert.doesNotMatch(readOnlyBody, /syncGenerationCandidates|syncImageTasks|persistRemoteMediaToOss|runImageQualityWorker/);
  assert.match(serviceSource.slice(workerStart), /syncGenerationCandidates/);
});

test("durable jobs expose the complete production state machine and lease before work", () => {
  assert.match(schemaSource, /model VideoProductionJob/);
  assert.match(schemaSource, /model VideoProductionCircuit/);
  for (const stage of [
    "planning",
    "contract_validation",
    "provider_submission",
    "provider_polling",
    "quality_evaluation",
    "composition",
  ]) {
    assert.match(queueSource, new RegExp(`"${stage}"`));
  }
  for (const status of [
    "queued",
    "claimed",
    "running",
    "waiting_upstream",
    "waiting_review",
    "completed",
    "failed",
    "cancelled",
  ]) {
    assert.match(queueSource, new RegExp(`"${status}"`));
  }
  const statusTypeStart = queueSource.indexOf("export type VideoProductionJobStatus");
  const statusTypeEnd = queueSource.indexOf("export const ACTIVE_VIDEO_PRODUCTION_JOB_STATUSES", statusTypeStart);
  const statusTypeSource = queueSource.slice(statusTypeStart, statusTypeEnd);
  assert.doesNotMatch(statusTypeSource, /"waiting_dependency"|"preparing_prompt"|"submitted"|"generating"|"terminal_failed"/);
  assert.match(queueSource, /leaseExpiresAt/);
  const claimStart = queueSource.indexOf("export async function claimNextVideoProductionJob");
  const claimEnd = queueSource.indexOf("export async function recoverExpiredVideoProductionJobLeases", claimStart);
  assert.doesNotMatch(
    queueSource.slice(claimStart, claimEnd),
    /attempt:\s*\{\s*increment:\s*1\s*\}/,
  );
  assert.match(queueSource, /modelAttempt:\s*\{\s*increment:\s*1\s*\}/);
  assert.match(queueSource, /stageRepairAttempt:\s*\{\s*increment:\s*1\s*\}/);
});

test("capacity waits reuse one target job with bounded exponential backoff", () => {
  assert.equal(capacityRetryDelayMs(1, () => 0), 5_000);
  assert.equal(capacityRetryDelayMs(2, () => 0), 10_000);
  assert.equal(capacityRetryDelayMs(3, () => 0), 20_000);
  assert.equal(capacityRetryDelayMs(6, () => 0), 120_000);
  assert.equal(capacityRetryDelayMs(20, () => 1), 156_000);
  assert.match(queueSource, /deferVideoProductionJobForCapacity/);
  assert.match(queueSource, /capacityWaitCount/);
  assert.match(queueSource, /CAPACITY_WAIT_MAX_COUNT\s*=\s*12/);
  assert.match(queueSource, /CAPACITY_WAIT_MAX_AGE_MS\s*=\s*30\s*\*\s*60_000/);
  assert.doesNotMatch(queueSource, /attempt:\s*\{\s*decrement:/);
});

test("image submission jobs are target-scoped and capacity denial cannot complete as submitted", () => {
  const queueStart = serviceSource.indexOf("async function queueNextImageTask");
  const queueEnd = serviceSource.indexOf("async function queueNextClipTask", queueStart);
  const queueBody = serviceSource.slice(queueStart, queueEnd);
  assert.match(queueBody, /targetId:\s*target\.id/);
  assert.match(queueBody, /image-submit:\$\{projectId\}:\$\{target\.id\}:\$\{revision\}/);
  assert.match(queueBody, /reactivateFailed:\s*options\.reactivateFailed/);
  assert.doesNotMatch(serviceSource, /"image\.resume"/);
  assert.match(serviceSource, /retryFailedVideoProductionJobById/);
  assert.match(queueSource, /input\.reactivateFailed\s*&&\s*existing\.status\s*===\s*"failed"/);
  assert.match(queueBody, /generationRevision/);
  assert.doesNotMatch(queueBody, /videoProductionRevision\(projectId\)/);
  assert.match(queueBody, /MAX_BOUNDARY_IMAGE_CONCURRENCY_WHILE_ASSETS_PENDING\s*-\s*activeBoundaryCount/);
  assert.match(queueBody, /ASSET_IMAGE_JOB_PRIORITY[\s\S]*BOUNDARY_IMAGE_JOB_PRIORITY/);
  assert.match(queueBody, /selectedAssetTargets[\s\S]*readyBoundaryTargets\.slice/);

  const workStart = serviceSource.indexOf("async function submitNextImageTaskWork");
  const workEnd = serviceSource.indexOf("async function submitNextClipTask", workStart);
  const workBody = serviceSource.slice(workStart, workEnd);
  assert.match(workBody, /targetId:\s*string/);
  assert.match(workBody, /throw error/);
  assert.match(workBody, /正在等待本地图片生成容量槽位/);

  const workerStart = serviceSource.indexOf("export async function pumpVideoProductionJobs");
  const workerEnd = serviceSource.indexOf("async function persistTerminalProductionJobFailure", workerStart);
  const workerBody = serviceSource.slice(workerStart, workerEnd);
  assert.match(workerBody, /isProviderCapacityError\(error\)/);
  assert.match(workerBody, /deferVideoProductionJobForCapacity/);
  assert.match(workerBody, /production_job\.worker\.capacity_wait/);
});

test("image fairness excludes stale or non-executable waiters", () => {
  assert.match(providerCapacitySource, /status:\s*"waiting"[\s\S]*lastRequestedAt:\s*\{\s*lt:\s*freshAfter\s*\}/);
  assert.match(providerCapacitySource, /kind:\s*"image_prepare_submit"/);
  assert.match(providerCapacitySource, /status:\s*\{\s*in:\s*\["queued",\s*"running"\]\s*\}/);
  assert.match(providerCapacitySource, /inactiveKeyframeWaiterIds/);
  assert.match(providerCapacitySource, /Provider demand released because its keyframe submission job is no longer active/);
  assert.match(providerCapacitySource, /!keyframeTargetIds\.has\(item\.targetId\)[\s\S]*\|\|\s*activeTargetIds\.has\(item\.targetId\)/);
  assert.match(providerCapacitySource, /hasPendingAssetImageJob/);
  assert.match(providerCapacitySource, /MAX_NON_ASSET_IMAGE_CAPACITY_WHILE_ASSETS_PENDING/);
  assert.match(providerCapacitySource, /activeNonAssetImageCount\s*>=\s*MAX_NON_ASSET_IMAGE_CAPACITY_WHILE_ASSETS_PENDING/);
  assert.match(serviceSource, /const activeTargetIds = new Set\(project\.productionJobs/);
  assert.match(serviceSource, /\.filter\(\(keyframe\) => !activeTargetIds\.has\(keyframe\.id\)\)/);
});

test("image targets are claimed before reference analysis and prompt preparation", () => {
  const workStart = serviceSource.indexOf("async function submitNextImageTaskWork");
  const workEnd = serviceSource.indexOf("async function submitNextClipTask", workStart);
  const body = serviceSource.slice(workStart, workEnd);
  const claimIndex = body.indexOf("prisma.videoKeyframe.updateMany");
  const prepareIndex = body.indexOf("prepareKeyframeImageSubmission");
  assert.ok(claimIndex >= 0);
  assert.ok(prepareIndex > claimIndex);
});

test("required person references never degrade to a text-only provider request", () => {
  const submitStart = aliyunWorkflowSource.indexOf("export async function submitAliyunImageTask");
  const submitEnd = aliyunWorkflowSource.indexOf("const PRIORITY_PROMPT_MARKERS", submitStart);
  const submitBody = aliyunWorkflowSource.slice(submitStart, submitEnd);
  assert.match(submitBody, /referencePolicy\?: "none" \| "optional" \| "required"/);
  assert.match(submitBody, /REQUIRED_IMAGE_REFERENCE_MISSING/);
  assert.match(submitBody, /textOnlyFallbackBlocked:\s*true/);
  assert.doesNotMatch(submitBody, /reference_fallback/);
  assert.doesNotMatch(submitBody, /buildBody\(fallbackPromptReport\.prompt,\s*false\)/);

  const batchStart = serviceSource.indexOf("async function createImageCandidateBatch");
  const batchEnd = serviceSource.indexOf("async function createVideoCandidateBatch", batchStart);
  const batchBody = serviceSource.slice(batchStart, batchEnd);
  assert.match(batchBody, /HARD IDENTITY/);
  assert.match(batchBody, /禁止降级为纯文字生成/);
  assert.match(batchBody, /referencePolicy,/);
});

test("prompt budget overflow routes to contract repair instead of blind generation retry", () => {
  const error = new Error("Image prompt contract invalid: protected facts exceed provider budget");
  error.name = "ImagePromptContractBudgetError";
  assert.equal(classifyVideoProductionError(error), "contract_repair_required");
});

test("cron does not discover production work, while deployment runs target workers", () => {
  assert.doesNotMatch(cronSource, /pumpGlobalProviderQueue|pumpVideoProductionJobs/);
  assert.doesNotMatch(cronSource, /pumpVideoProductionJobs/);
  assert.match(composeSource, /video-planning-worker:/);
  assert.match(composeSource, /video-image-worker:/);
  assert.match(composeSource, /video-clip-worker:/);
  assert.doesNotMatch(composeSource, /video-reconcile-worker:|project_reconcile/);
  assert.match(composeSource, /video-quality-worker:/);
  assert.match(composeSource, /clip_prepare_submit,compose/);
  assert.match(composeSource, /target:\s*worker/);
});

test("target jobs remain durable through upstream polling without reconcile discovery", () => {
  assert.doesNotMatch(workerSource, /pumpGlobalProviderQueue|project_reconcile|RECONCILE_DISCOVERY/);
  assert.match(serviceSource, /continueSubmittedTargetJob/);
  assert.match(serviceSource, /SUBMITTED_TARGET_JOB_STAGES/);
  assert.match(serviceSource, /rescheduleAt:\s*new Date\(Date\.now\(\) \+ 3_000\)/);
});

test("candidate polling records every upstream query in the human-readable ledger", () => {
  const pollStart = serviceSource.indexOf("async function pollGenerationCandidateUpstream");
  const pollEnd = serviceSource.indexOf("async function syncGenerationCandidates", pollStart);
  assert.ok(pollStart >= 0 && pollEnd > pollStart);
  const pollBody = serviceSource.slice(pollStart, pollEnd);
  assert.match(schemaSource, /upstreamPollCount\s+Int\s+@default\(0\)/);
  assert.match(schemaSource, /upstreamPollTotalMs\s+Int\s+@default\(0\)/);
  assert.match(pollMetricsMigrationSource, /upstream_poll_count/);
  assert.match(pollBody, /upstreamPollCount:\s*\{\s*increment:\s*1\s*\}/);
  assert.match(pollBody, /upstreamPollTotalMs:\s*\{\s*increment:\s*queryDurationMs\s*\}/);
  assert.match(pollBody, /stepNameZh:\s*"向上游查询生成进度"/);
  assert.match(pollBody, /upstreamPollNo:\s*pollNo/);
  assert.match(pollBody, /elapsedSinceSubmissionMs/);
  assert.match(pollBody, /nextPollDelayMs/);
  assert.match(serviceSource, /providerQueueDurationMs/);
  assert.match(serviceSource, /providerRenderDurationMs/);
  assert.match(serviceSource, /pollDiscoveryDelayMs/);
  assert.match(readableLoggerSource, /第 \$\{pollNo\} 次轮询/);
  assert.match(readableLoggerSource, /非查询耗时（上游处理\+轮询间隔）/);
});

test("clip submission keeps provider polling on the same durable target job", () => {
  const handlerStart = serviceSource.indexOf('if (job.kind === "clip_prepare_submit")');
  const qualityStart = serviceSource.indexOf('if (job.kind === "image_quality")', handlerStart);
  const handler = serviceSource.slice(handlerStart, qualityStart);
  assert.match(handler, /submitNextClipTask/);
  assert.match(handler, /stage:\s*"provider_polling"/);
  assert.match(handler, /rescheduleAt/);
  assert.doesNotMatch(handler, /enqueueProjectReconcileJob|project_reconcile/);
});

test("local development runs the same isolated worker lanes as production", () => {
  assert.doesNotMatch(devRunnerSource, /"--watch"/);
  assert.match(devRunnerSource, /VIDEO_PRODUCTION_RUNTIME_VERSION:\s*devRuntimeVersion/);
  for (const kinds of [
    "planning",
    "image_prepare_submit,micro_shot_prepare_submit",
    "clip_prepare_submit,compose",
    "image_quality",
  ]) {
    assert.ok(devRunnerSource.includes(kinds));
  }
});

test("Worker interruptions have a separate recovery budget and never consume business attempts", () => {
  assert.equal(infrastructureRetryDelayMs(1), 2_000);
  assert.equal(infrastructureRetryDelayMs(2), 4_000);
  assert.equal(infrastructureRetryDelayMs(6), 60_000);
  assert.equal(infrastructureRetryDelayMs(100), 60_000);
  for (const field of [
    "modelAttempt",
    "stageRepairAttempt",
    "infrastructureAttempt",
    "leaseLossCount",
    "userRetryCount",
    "deploymentGraceUntil",
  ]) {
    assert.match(schemaSource, new RegExp(field));
  }
  assert.match(queueSource, /recoverExpiredVideoProductionJobLeases/);
  assert.match(queueSource, /AUTO_RETRY_INFRASTRUCTURE/);
  assert.match(queueSource, /isInfrastructureRetryCategory\(input\.category\)/);
  assert.match(queueSource, /reason:\s*input\.category === "provider_rate_limit"/);
  const recoveryStart = queueSource.indexOf("export async function recoverExpiredVideoProductionJobLeases");
  const recoveryEnd = queueSource.indexOf("export async function releaseVideoProductionJobForInfrastructure", recoveryStart);
  assert.doesNotMatch(
    queueSource.slice(recoveryStart, recoveryEnd),
    /attempt:\s*\{\s*increment:/,
  );
  assert.match(retryBudgetMigrationSource, /plannerCheckpoint/);
  assert.match(retryBudgetMigrationSource, /INFRASTRUCTURE_RECOVERY_QUEUED/);
});

test("Worker shutdown drains the active lease and requeues it if the grace period expires", () => {
  assert.match(workerSource, /shouldStop:\s*\(\)\s*=>\s*stopping/);
  assert.match(workerSource, /beginVideoProductionDeploymentDrain/);
  assert.match(workerSource, /releaseVideoProductionJobForInfrastructure/);
  assert.match(workerSource, /VIDEO_PRODUCTION_WORKER_SHUTDOWN_GRACE_MS/);
  assert.match(queueSource, /DEFAULT_DEPLOYMENT_GRACE_MS\s*=\s*10\s*\*\s*60_000/);
  assert.match(queueSource, /lastInterruptionReason:\s*"deployment_draining"/);
  assert.match(queueSource, /GREATEST\([\s\S]*deployment_grace_until/);
  assert.match(composeSource, /stop_grace_period:\s*10m30s/);
});

test("candidate selection and asset confirmation are separate human states", () => {
  assert.match(serviceSource, /waiting_candidate_selection/);
  assert.match(serviceSource, /waiting_asset_confirmation/);
  assert.match(serviceSource, /hasUnresolvedSelectableImageCandidate/);
  assert.match(serviceSource, /resolvedTargets/);
  assert.match(serviceSource, /productionJobs:\s*project\.productionJobs\.map/);
  assert.match(serviceSource, /productionState/);
});

test("durable workers stop deterministic contract failures instead of blindly retrying", () => {
  const contractError = new Error("计划硬校验未通过：segment 2 checkpoint maximum is 3");
  contractError.name = "PlanValidationError";
  assert.equal(classifyVideoProductionError(contractError), "contract_repair_required");
  assert.equal(classifyVideoProductionError(new StoryboardStageError(
    "asset contract failed deterministic validation",
    { code: "contract_validation_error", retryable: true },
  )), "contract_repair_required");
  assert.equal(classifyVideoProductionError({
    name: "StoryboardStageError",
    message: "serialized asset contract failure",
    code: "contract_validation_error",
    retryable: true,
  }), "contract_repair_required");
  assert.equal(classifyVideoProductionError(new Error("HTTP 429 rate limit")), "retry");
  assert.equal(classifyVideoProductionError(new Error("HTTP 401 unauthorized")), "terminal");
  assert.doesNotMatch(serviceSource, /persistTerminalProductionJobFailure/);
  assert.match(queueSource, /export async function failVideoProductionJob/);
  assert.match(queueSource, /prisma\.\$transaction/);
  assert.match(queueSource, /videoProviderTaskLease\.updateMany/);
  assert.match(serviceSource, /kind === "clip_prepare_submit"/);
});

test("structured syntax failures remain stage-repairable and never restart the durable planning job", () => {
  const error = new StructuredOutputSyntaxError(
    "reference_fact_extractor",
    "JSON remained invalid after syntax repair",
  );
  const classification = classifyVideoProductionFailure(error);
  assert.equal(classification.disposition, "stage_repairable");
  assert.equal(classification.category, "structured_output_syntax");
  assert.match(serviceSource, /disposition === "retry"[\s\S]*retryVideoProductionJob/);
  assert.match(serviceSource, /disposition === "stage_repairable"[\s\S]*"RETRY_STAGE"/);
  assert.match(serviceSource, /Reflect\.get\(error, "classification"\) === "stage_repairable"/);
});

test("production failures preserve capacity, throttling, and scheduler semantics", () => {
  assert.equal(
    classifyVideoProductionFailure(new Error("HTTP 429 too many requests")).category,
    "provider_rate_limit",
  );
  const quota = classifyVideoProductionFailure(
    new Error("You exceeded your current quota: token-limit; check billing details"),
  );
  assert.equal(quota.disposition, "terminal");
  assert.equal(quota.category, "provider_quota");
  assert.equal(failureBudgetForCategory(quota.category), "none");
  assert.equal(
    classifyVideoProductionFailure(
      new ProductionSchedulingInvariantError("image_prepare_submit requires a non-empty targetId"),
    ).category,
    "internal_scheduling",
  );
  assert.match(queueSource, /errorCategory:\s*"internal_capacity"/);
  assert.match(providerCapacitySource, /assertSchedulingContext\(context\)/);
});

test("zero provider capacity produces a structured retry signal", () => {
  const previous = process.env.ONE_PROMPT_IMAGE_GLOBAL_CONCURRENCY;
  process.env.ONE_PROMPT_IMAGE_GLOBAL_CONCURRENCY = "0";
  try {
    assert.equal(configuredProviderCapacity("image_generation"), 0);
    assert.equal(isProviderCapacityError(new ProviderCapacityError()), true);
    assert.equal(
      new ProviderCapacityError("lease unavailable", "LEASE_UNAVAILABLE").code,
      "LEASE_UNAVAILABLE",
    );
  } finally {
    if (previous === undefined) delete process.env.ONE_PROMPT_IMAGE_GLOBAL_CONCURRENCY;
    else process.env.ONE_PROMPT_IMAGE_GLOBAL_CONCURRENCY = previous;
  }
});

test("workers handshake runtime versions and report meaningful progress", () => {
  assert.match(schemaSource, /model VideoProductionWorkerRuntime/);
  assert.match(schemaSource, /requiredWorkerVersion/);
  assert.match(schemaSource, /claimedWorkerVersion/);
  assert.match(workerSource, /resolveVideoProductionRuntimeVersion/);
  assert.match(workerSource, /heartbeatVideoProductionWorker/);
  assert.match(workerSource, /meaningfulProgressCount/);
  assert.match(serviceSource, /workerStalled/);
  assert.match(serviceSource, /submissionState/);
});

test("reconcile polling reschedules the same durable row", () => {
  const start = serviceSource.indexOf("async function continueSubmittedTargetJob");
  const end = serviceSource.indexOf("async function processClaimedVideoProductionJob", start);
  const body = serviceSource.slice(start, end);
  assert.match(body, /rescheduleAt/);
  assert.doesNotMatch(body, /enqueueProjectReconcileJob/);
  assert.match(queueSource, /rescheduleVideoProductionJob/);
  assert.doesNotMatch(queueSource, /project_reconcile/);
});

test("target-scoped image jobs cannot infer a target while executing", () => {
  const start = serviceSource.indexOf('if (job.kind === "image_prepare_submit")');
  const end = serviceSource.indexOf('if (job.kind === "micro_shot_prepare_submit")', start);
  const body = serviceSource.slice(start, end);
  assert.match(body, /ProductionSchedulingInvariantError/);
  assert.doesNotMatch(body, /inferredTarget/);
  assert.match(queueSource, /targetId:\s*string/);
  assert.match(targetInvariantMigrationSource, /video_production_jobs_target_scoped_check/);
  assert.match(targetInvariantMigrationSource, /ALTER COLUMN "target_id" SET NOT NULL/);
  assert.match(targetInvariantMigrationSource, /video_provider_task_leases_nonempty_target_check/);
});

test("clip approval commits review state and queues durable submission instead of holding the request open", () => {
  const start = serviceSource.indexOf("export async function approveMicroShotReferences");
  const end = serviceSource.indexOf("function buildFinalCompositionSequence", start);
  const body = serviceSource.slice(start, end);
  assert.match(body, /assertPlanValidForGeneration/);
  assert.match(body, /prisma\.\$transaction/);
  assert.match(body, /queueNextClipTask/);
  assert.doesNotMatch(body, /await submitNextClipTask/);
});

test("all production jobs and final composition use non-null target-scoped durable jobs", () => {
  assert.match(queueSource, /targetId:\s*string/);
  assert.match(serviceSource, /const targetId = microShotJobTargetId/);
  assert.match(serviceSource, /targetId:\s*segment\.id/);
  assert.match(serviceSource, /kind:\s*"compose"/);
  assert.match(serviceSource, /targetId:\s*"final"/);
  assert.match(serviceSource, /performVideoProjectComposition/);
  assert.match(workerSource, /"compose"/);
});

test("manual regeneration queues work instead of submitting providers in the request", () => {
  const imageStart = serviceSource.indexOf("export async function regenerateKeyframeImage");
  const microStart = serviceSource.indexOf("export async function regenerateMicroShotImage");
  const clipStart = serviceSource.indexOf("export async function regenerateSegmentClip");
  const clipEnd = serviceSource.indexOf("async function regenerateSegmentClipInternal", clipStart);
  assert.match(serviceSource.slice(imageStart, microStart), /action:\s*"regenerate"/);
  assert.match(serviceSource.slice(microStart, clipStart), /action:\s*"regenerate"/);
  assert.match(serviceSource.slice(clipStart, clipEnd), /executeInline:\s*false/);
  assert.doesNotMatch(serviceSource.slice(imageStart, serviceSource.indexOf("async function regenerateKeyframeImageInternal", imageStart)), /executeInline\?:/);
  assert.doesNotMatch(serviceSource.slice(microStart, serviceSource.indexOf("async function regenerateMicroShotImageInternal", microStart)), /executeInline\?:/);
  assert.doesNotMatch(clipRegenerateRouteSource, /getProviderAdapter|\.generate\(|submit/);
});

test("runtime generation refuses legacy video prompt-contract synthesis", () => {
  assert.doesNotMatch(serviceSource, /buildLegacyVideoPromptContract/);
  assert.match(serviceSource, /requireCanonicalVideoPromptContract/);
  assert.match(serviceSource, /ExecutionContractMissingError/);
  assert.match(clipRegenerateRouteSource, /executionContractErrorDetails/);
  assert.match(executionContractErrorSource, /errorCode:\s*EXECUTION_CONTRACT_MISSING/);
  assert.match(executionContractErrorSource, /recoveryAction:\s*REPAIR_CONTRACT/);
  assert.doesNotMatch(mediaPlannerSource, /validatedFallbackPlan|legacy_fallback/);
});

test("phase one archives reconcile jobs and enforces one live target job", () => {
  assert.match(phaseOneInvariantMigrationSource, /"kind" = 'project_reconcile'/);
  assert.match(phaseOneInvariantMigrationSource, /"status" = 'cancelled'/);
  assert.match(phaseOneInvariantMigrationSource, /video_production_jobs_one_active_target/);
  assert.match(phaseOneInvariantMigrationSource, /WHERE "status" IN \('queued', 'running'\)/);
  assert.match(queueSource, /activeForTarget/);
});
