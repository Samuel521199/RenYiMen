import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const pagePath = path.join(root, "src/app/(platform)/workbench/workflows/one-prompt-video/page.tsx");
const projectServicePath = path.join(root, "src/services/video-orchestrator/project-service.ts");
const taskGraphPath = path.join(root, "src/services/video-orchestrator/task-graph-progress.ts");
const syncRoutePath = path.join(root, "src/app/api/video-projects/[projectId]/sync/route.ts");

const page = readFileSync(pagePath, "utf8");
const projectService = readFileSync(projectServicePath, "utf8");
const taskGraph = readFileSync(taskGraphPath, "utf8");

test("one-prompt frontend uses segment and keyframe entities without VideoShot aliases", () => {
  assert.doesNotMatch(page, /\binterface\s+VideoShot\b/);
  assert.doesNotMatch(page, /\bselectedShot(?:Id)?\b/);
  assert.doesNotMatch(page, /\bshotNo\b/);
  assert.doesNotMatch(page, /\bsegmentToEditorShot\b/);
  assert.match(page, /\binterface\s+VideoSegment\b/);
  assert.match(page, /\binterface\s+VideoKeyframe\b/);
  assert.match(page, /\bselectedSegment(?:Id)?\b/);
});

test("frontend projection does not read legacy provider task fields", () => {
  assert.doesNotMatch(page, /\bimageTaskId\b/);
  assert.doesNotMatch(page, /\bclipTaskId\b/);
  assert.doesNotMatch(page, /\bimageStatus\b/);
});

test("workflow stage, progress, and actions are derived from taskGraph", () => {
  assert.match(page, /workflowStageForTaskGraph\(project\?\.taskGraph\)/);
  assert.match(page, /taskGraphWorkflowProgressView\(project\.taskGraph/);
  assert.match(page, /taskGraph\?\.allowedActions\.includes\("APPROVE_CURRENT_NODE"\)/);
  assert.match(page, /currentTaskNodeId\s*=\s*project\?\.taskGraph\?\.currentNode/);
  assert.doesNotMatch(page, /function\s+workflowStageForProject\b/);
  assert.doesNotMatch(page, /function\s+projectWorkflowProgressView\b/);
  assert.doesNotMatch(page, /function\s+projectProgress\b/);
});

test("resume preserves the current task node instead of showing project creation", () => {
  const start = page.indexOf("async function resumeProject()");
  const end = page.indexOf("function updateDraftMicroShot", start);
  assert.ok(start >= 0 && end > start);
  const resumeBody = page.slice(start, end);
  assert.match(resumeBody, /phase:\s*"resuming"/);
  assert.match(resumeBody, /\/continue-task-graph|\/retry-job|\/repair-contract/);
  assert.doesNotMatch(resumeBody, /\/resume/);
  assert.doesNotMatch(resumeBody, /phase:\s*"creating"/);
  assert.doesNotMatch(resumeBody, /percent:\s*1\b/);
  assert.doesNotMatch(page, /type\s+OptimisticProgressPhase\s*=\s*[^;]*"creating"/);
});

test("projection polling is GET-only and the legacy sync route is removed", () => {
  assert.match(page, /const\s+pollProjectProjection\s*=\s*useCallback/);
  assert.match(page, /fetchJson\(`\/api\/video-projects\/\$\{projectId\}`,\s*copy\)/);
  assert.doesNotMatch(page, /\/sync\b/);
  assert.equal(existsSync(syncRoutePath), false);
});

test("backend exposes the canonical taskGraph view model and no shots compatibility output", () => {
  for (const field of ["currentNode", "status", "progress", "allowedActions", "recoveryAction"]) {
    assert.match(taskGraph, new RegExp(`\\b${field}\\b`));
  }
  assert.match(projectService, /taskGraph:\s*projectedTaskGraph/);
  assert.doesNotMatch(projectService, /\bserializeSegmentAsShot\b/);
  assert.doesNotMatch(projectService, /^\s+shots\s*:/m);
});
