import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const pagePath = path.join(root, "src/app/(platform)/workbench/workflows/one-prompt-video/page.tsx");
const servicePath = path.join(root, "src/services/video-orchestrator/project-service.ts");
const queuePath = path.join(root, "src/services/video-orchestrator/production-job-queue.ts");
const projectionPath = path.join(root, "src/services/video-orchestrator/project-production-projection.ts");
const errorContractPath = path.join(root, "src/services/video-orchestrator/structured-production-error.ts");
const resumeRoutePath = path.join(root, "src/app/api/video-projects/[projectId]/resume/route.ts");

const page = readFileSync(pagePath, "utf8");
const service = readFileSync(servicePath, "utf8");
const queue = readFileSync(queuePath, "utf8");
const projection = readFileSync(projectionPath, "utf8");
const errorContract = readFileSync(errorContractPath, "utf8");
const resumeRoute = readFileSync(resumeRoutePath, "utf8");

test("single-purpose Phase 7 command routes exist", () => {
  for (const command of [
    "approve-assets",
    "approve-keyframes",
    "approve-micro-shots",
    "approve-clips",
    "retry-job",
    "repair-contract",
    "continue-task-graph",
    "compose",
  ]) {
    assert.equal(
      existsSync(path.join(root, `src/app/api/video-projects/[projectId]/${command}/route.ts`)),
      true,
      `${command} route must exist`,
    );
  }
  assert.equal(
    existsSync(path.join(root, "src/app/api/video-projects/[projectId]/approve-images/route.ts")),
    false,
    "legacy approve-images route must be removed",
  );
});

test("frontend calls explicit commands and never calls the compatibility resume endpoint", () => {
  assert.doesNotMatch(page, /\/api\/video-projects\/\$\{project\.id\}\/resume/);
  assert.doesNotMatch(page, /\/approve-images/);
  assert.match(page, /\/approve-keyframes/);
  assert.match(page, /\/approve-clips/);
  assert.match(page, /\/continue-task-graph/);
  assert.match(page, /\/retry-job/);
  assert.match(page, /\/repair-contract/);

  const approveStart = page.indexOf("async function approveClips()");
  const approveEnd = page.indexOf("async function recomposeFinalVideo()", approveStart);
  const approveBody = page.slice(approveStart, approveEnd);
  assert.match(approveBody, /\/approve-clips/);
  assert.doesNotMatch(approveBody, /\/compose/);
});

test("legacy resume requires an explicit action and contains no heuristic dispatcher", () => {
  assert.match(resumeRoute, /type LegacyExplicitAction/);
  assert.match(resumeRoute, /CONTINUE_TASK_GRAPH/);
  assert.match(resumeRoute, /RETRY_JOB/);
  assert.match(resumeRoute, /REPAIR_CONTRACT/);
  assert.match(resumeRoute, /EXPLICIT_RESUME_ACTION_REQUIRED/);
  assert.doesNotMatch(resumeRoute, /resumeVideoProject/);
  assert.doesNotMatch(service, /export async function resumeVideoProject/);
  assert.doesNotMatch(resumeRoute, /keyframes|segments|finalVideoUrl|project\.status/);
});

test("structured error contract is complete and frontend behavior does not parse error prose", () => {
  for (const field of [
    "errorCode",
    "category",
    "retryable",
    "targetId",
    "artifactId",
    "recoveryAction",
    "displayMessage",
  ]) {
    assert.match(errorContract, new RegExp(`\\b${field}\\b`));
  }
  assert.match(page, /project\.productionProjection\?\.recoveryAction/);
  assert.match(page, /project\.productionProjection\?\.failedJobId/);
  assert.doesNotMatch(page, /function workflowNoticeForMessage/);
  const resumeStart = page.indexOf("async function resumeProject()");
  const resumeEnd = page.indexOf("function updateDraftMicroShot", resumeStart);
  const resumeBody = page.slice(resumeStart, resumeEnd);
  assert.match(resumeBody, /allowedActions\.includes\("EXECUTE_RECOVERY_ACTION"\)/);
  assert.match(resumeBody, /recoveryAction === "REPAIR_CONTRACT"/);
  assert.doesNotMatch(resumeBody, /\.includes\([^)]*(?:error|message)|\.match\(|\.test\(/i);
});

test("terminal job settlement is one transaction across lease, job, target, artifact, and project", () => {
  const start = queue.indexOf("export async function failVideoProductionJob");
  const end = queue.indexOf("export function classifyVideoProductionError", start);
  const body = queue.slice(start, end);
  assert.match(body, /prisma\.\$transaction/);
  assert.match(body, /videoProviderTaskLease\.updateMany/);
  assert.match(body, /videoProductionJob\.updateMany/);
  assert.match(body, /videoArtifactMetadata\.updateMany/);
  assert.match(body, /videoGenerationCandidate\.updateMany/);
  assert.match(body, /videoKeyframe\.updateMany/);
  assert.match(body, /videoSegment\.updateMany/);
  assert.match(body, /videoProject\.update/);
  assert.match(body, /VideoProjectStatus\.WAITING_RECOVERY/);
  assert.match(queue, /retryVideoProductionJob[\s\S]*failVideoProductionJob/);
  assert.doesNotMatch(service, /persistTerminalProductionJobFailure/);
});

test("failed projection exposes the command target and localized display contract", () => {
  assert.match(projection, /failedJobId:\s*failedJob\.id/);
  assert.match(projection, /structuredProductionError\(/);
  assert.match(projection, /targetId:\s*failedJob\.targetId/);
  assert.match(projection, /artifactId:\s*failedJob\.artifactId/);
});
