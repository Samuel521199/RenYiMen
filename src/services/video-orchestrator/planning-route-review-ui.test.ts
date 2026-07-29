import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const pageSource = readFileSync(
  path.join(process.cwd(), "src/app/(platform)/workbench/workflows/one-prompt-video/page.tsx"),
  "utf8",
);
const serviceSource = readFileSync(
  path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"),
  "utf8",
);
const apiSource = readFileSync(
  path.join(process.cwd(), "src/app/api/video-projects/[projectId]/route-classification/route.ts"),
  "utf8",
);

test("PLAN_REVIEW renders an independent route section with every required field", () => {
  assert.match(pageSource, /project\.status === "PLAN_REVIEW"/);
  assert.match(pageSource, /<PlanningRouteReview/);
  const panel = pageSource.slice(
    pageSource.indexOf("function PlanningRouteReview"),
    pageSource.indexOf("function RouteSelect"),
  );
  for (const field of [
    "videoCategory",
    "templateId",
    "chronologyMode",
    "hookMode",
    "hookRevealLevel",
    "requiresReturnPoint",
    "categoryReason",
    "templateReason",
    "chronologyReason",
    "categoryConfidence",
    "templateConfidence",
    "chronologyConfidence",
    "fallbackReason",
  ]) assert.match(panel, new RegExp(field));
  assert.match(panel, /Route 审计与性能/);
});

test("route review saves through a dedicated endpoint and exposes user lock state", () => {
  assert.match(pageSource, /\/route-classification/);
  assert.match(apiSource, /updateUserPlanningRoute/);
  assert.match(serviceSource, /authority: "user"/);
  assert.match(serviceSource, /locked: true/);
  assert.match(serviceSource, /applyManualPlanningRouteClassification\(\{/);
  assert.match(serviceSource, /comparePlanningRouteContracts\(previousRoute, routeContract\)/);
  assert.match(serviceSource, /changes\.invalidateProductionContent[\s\S]*queueVideoProjectPlanning/);
  assert.match(serviceSource, /planning\.route\.user_override/);
});

test("server enforces category-template and chronology-Hook combinations", () => {
  assert.match(serviceSource, /validateCategoryTemplateCombination/);
  assert.match(serviceSource, /validateChronologyHookPolicy/);
  assert.match(serviceSource, /Route Contract can only be edited during PLAN_REVIEW/);
});
