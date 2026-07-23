import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { normalizeEndFrameContinuityResponse } from "./end-frame-continuity.ts";
import { auditSingleTakePlan, SingleTakeAuditError, assertSingleTakeAuditPassed } from "./single-take-audit.ts";

function plan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    segments: [{ segmentNo: 1, videoPrompt: "One continuous take. Do not cut, dissolve, fade, or switch shots." }],
    segmentRenderDescriptions: [{
      segmentNo: 1,
      startFrameContract: { state: "人物站在入口" },
      endFrameContract: { state: "人物站在产品旁" },
      motionContract: { path: "人物沿可见路径走到产品旁" },
      singleTakeContract: { requiresCut: false, riskLevel: "low", physicallyReachable: true },
      motionCheckpoints: [{ state: "人物位于路径中段" }],
    }],
    ...overrides,
  };
}

test("one Single-take Audit accepts a reachable continuous plan and ignores explicit prohibitions", () => {
  const result = auditSingleTakePlan(plan());
  assert.equal(result.passed, true);
  assert.equal(result.action, "allow");
  assert.equal(result.auditVersion, "single-take-audit-v1");
});

test("requiresCut is a non-retryable Stage 2B block", () => {
  const value = plan();
  const descriptions = value.segmentRenderDescriptions as Array<Record<string, unknown>>;
  descriptions[0].requiresCut = true;
  const result = auditSingleTakePlan(value);
  assert.equal(result.passed, false);
  assert.equal(result.action, "block_stage_2b");
  assert.ok(result.issues.some((item) => item.code === "SINGLE_TAKE_REQUIRES_CUT" && item.repairable === false));
  assert.throws(() => assertSingleTakeAuditPassed(value), SingleTakeAuditError);
});

test("high risk and unreachable motion request Split Repair", () => {
  const value = plan();
  const description = (value.segmentRenderDescriptions as Array<Record<string, unknown>>)[0];
  description.singleTakeContract = { requiresCut: false, riskLevel: "high", physicallyReachable: false };
  const result = auditSingleTakePlan(value);
  assert.equal(result.action, "split_repair");
  assert.ok(result.issues.some((item) => item.code === "SINGLE_TAKE_HIGH_RISK"));
  assert.ok(result.issues.some((item) => item.code === "SINGLE_TAKE_PHYSICALLY_UNREACHABLE"));
});

test("positive internal dissolve language is rejected instead of rewritten", () => {
  const value = plan();
  const description = (value.segmentRenderDescriptions as Array<Record<string, unknown>>)[0];
  description.motionContract = { path: "人物走到中点，然后 dissolve to a new shot" };
  const result = auditSingleTakePlan(value);
  assert.ok(result.issues.some((item) => item.code === "INTERNAL_CUT_LANGUAGE"));
});

test("end-frame evaluator maps small gap, prompt-fixable gap and unreachable gap", () => {
  const passed = normalizeEndFrameContinuityResponse({ passed: true, similarityScore: 0.86, motionReachability: "reachable", reasons: [] });
  assert.equal(passed.decision, "pass");
  const retry = normalizeEndFrameContinuityResponse({ passed: false, similarityScore: 0.55, motionReachability: "prompt_fixable", retryInstruction: "hold the product beside the face" });
  assert.equal(retry.decision, "retry_generation");
  assert.match(retry.retryInstruction ?? "", /product/);
  const blocked = normalizeEndFrameContinuityResponse({ passed: false, similarityScore: 0.2, motionReachability: "unreachable", reasons: ["too many actions"] });
  assert.equal(blocked.decision, "return_stage_2b");
});

test("HappyHorse uses a hard first frame and a mandatory end-state prompt without pasted end-frame dissolve", () => {
  const root = process.cwd();
  const workflow = readFileSync(path.join(root, "src/services/video-orchestrator/aliyun-workflow.ts"), "utf8");
  const service = readFileSync(path.join(root, "src/services/video-orchestrator/project-service.ts"), "utf8");
  const compose = readFileSync(path.join(root, "src/services/video-orchestrator/local-compose.ts"), "utf8");
  assert.match(workflow, /acceptsLastFrameImage: false/);
  assert.match(workflow, /media: \[\{ type: "first_frame", url: params\.imageUrl \}\]/);
  assert.match(service, /MANDATORY FINAL-FRAME CONTRACT/);
  assert.match(service, /endFramePromptEnforced: true/);
  assert.doesNotMatch(service, /enforceSegmentEndFrameLocally|deterministic_exact_end_frame_postprocess|stripVideoForbiddenTerms/);
  assert.doesNotMatch(compose, /one-prompt-boundary|approved-end-frame|clip\.boundary_enforce/);
  assert.match(compose, /item\?\.visualMode \?\? "hard_cut"/);
  assert.match(service, /endFrameSemanticMode: "strong_prompt_target_and_visual_check"/);
});

test("planning, runtime validator and failure recovery share the audit service", () => {
  const root = process.cwd();
  const planner = readFileSync(path.join(root, "src/services/video-orchestrator/three-stage-planner.ts"), "utf8");
  const validator = readFileSync(path.join(root, "src/services/video-orchestrator/plan-validator.ts"), "utf8");
  const service = readFileSync(path.join(root, "src/services/video-orchestrator/project-service.ts"), "utf8");
  assert.match(planner, /auditSingleTakePlan\(/);
  assert.match(validator, /auditSingleTakePlan\(/);
  assert.match(service, /targetArtifactId: "project:failure_recovery"/);
  assert.match(service, /stage: "video_generation"/);
  assert.match(service, /MANDATORY RETRY CORRECTION FROM END-FRAME VISUAL CHECK/);
});
