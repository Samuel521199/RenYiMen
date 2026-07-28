import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyVideoProductionError } from "./production-job-queue";
import { StoryboardStageError } from "./storyboard-stage-retry";

const serviceSource = readFileSync(
  new URL("./project-service.ts", import.meta.url),
  "utf8",
);
const queueSource = readFileSync(
  new URL("./production-job-queue.ts", import.meta.url),
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
    "waiting_dependency",
    "preparing_prompt",
    "submitted",
    "generating",
    "waiting_quality",
    "quality_checking",
    "waiting_candidate_selection",
    "waiting_asset_confirmation",
    "contract_repair_required",
    "retryable_failed",
    "terminal_failed",
    "completed",
  ]) {
    assert.match(queueSource, new RegExp(`"${stage}"`));
  }
  assert.match(queueSource, /leaseExpiresAt/);
  assert.match(queueSource, /attempt:\s*\{\s*increment:\s*1\s*\}/);
});

test("image targets are claimed before reference analysis and prompt preparation", () => {
  const workStart = serviceSource.indexOf("async function submitNextImageTaskWork");
  const workEnd = serviceSource.indexOf("async function syncClipTasks", workStart);
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

test("cron only discovers work, while deployment runs a separate worker service", () => {
  assert.match(cronSource, /pumpGlobalProviderQueue/);
  assert.doesNotMatch(cronSource, /pumpVideoProductionJobs/);
  assert.match(composeSource, /video-planning-worker:/);
  assert.match(composeSource, /video-image-worker:/);
  assert.match(composeSource, /video-clip-worker:/);
  assert.match(composeSource, /video-reconcile-worker:/);
  assert.match(composeSource, /video-quality-worker:/);
  assert.match(composeSource, /target:\s*worker/);
});

test("reconcile workers continuously recover orphaned upstream tasks", () => {
  assert.match(workerSource, /pumpGlobalProviderQueue/);
  assert.match(workerSource, /VIDEO_PRODUCTION_RECONCILE_DISCOVERY_MS/);
  assert.match(workerSource, /kinds\.includes\("project_reconcile"\)/);
  assert.match(serviceSource, /activeReconcileJob/);
  assert.match(serviceSource, /status:\s*\{\s*in:\s*\["queued",\s*"running"\]\s*\}/);
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

test("clip submission always schedules durable reconciliation", () => {
  const handlerStart = serviceSource.indexOf('if (job.kind === "clip_prepare_submit")');
  const qualityStart = serviceSource.indexOf('if (job.kind === "image_quality")', handlerStart);
  const handler = serviceSource.slice(handlerStart, qualityStart);
  assert.match(handler, /submitNextClipTask/);
  assert.match(handler, /enqueueProjectReconcileJob/);
  assert.match(handler, /reason:\s*"clips_submitted"/);
});

test("local development runs the same isolated worker lanes as production", () => {
  for (const kinds of [
    "planning",
    "image_prepare_submit,micro_shot_prepare_submit",
    "clip_prepare_submit",
    "project_reconcile",
    "image_quality",
  ]) {
    assert.ok(devRunnerSource.includes(kinds));
  }
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
  assert.equal(classifyVideoProductionError(new Error("HTTP 429 rate limit")), "retry");
  assert.equal(classifyVideoProductionError(new Error("HTTP 401 unauthorized")), "terminal");
  assert.match(serviceSource, /persistTerminalProductionJobFailure/);
  assert.match(serviceSource, /kind === "clip_prepare_submit"/);
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
