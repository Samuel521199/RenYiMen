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
  assert.equal(result.auditVersion, "single-take-audit-v2");
});

test("Chinese no-cut safety directives are not mistaken for edit instructions", () => {
  const value = plan({
    segments: [{
      segmentNo: 1,
      videoPrompt: "连续无间断单镜头。全程无内部剪切、跳切、淡入淡出、叠化、蒙太奇或场景切换。",
    }],
  });
  assert.equal(auditSingleTakePlan(value).passed, true);
});

test("Chinese no-any-cut prompt-detailer wording is treated as a prohibition", () => {
  const value = plan({
    segments: [{
      segmentNo: 1,
      videoPrompt: "全程保持明亮均匀的柔和光照和高饱和度色彩，无任何剪切、跳切、淡入淡出、溶解、交叉溶解、蒙太奇、鬼影叠加、场景切换或硬视觉过渡。",
    }],
  });
  assert.equal(auditSingleTakePlan(value).passed, true);
});

test("fallback micro-shot safety wording is not mistaken for a scene transition", () => {
  const value = plan({
    segments: [{
      segmentNo: 1,
      microShots: [{
        promptEn: "Use this as a same-take internal motion checkpoint, not as an extra video clip, not as a separate shot, and not as a scene transition.",
      }],
    }],
  });
  assert.equal(auditSingleTakePlan(value).passed, true);
});

test("requiresCut requests a real timeline boundary", () => {
  const value = plan();
  const descriptions = value.segmentRenderDescriptions as Array<Record<string, unknown>>;
  descriptions[0].requiresCut = true;
  const result = auditSingleTakePlan(value);
  assert.equal(result.passed, false);
  assert.equal(result.action, "replan_timeline");
  assert.ok(result.issues.some((item) =>
    item.code === "SINGLE_TAKE_REQUIRES_CUT"
    && item.repairable === false
    && item.structural
    && item.repairScope === "timeline"));
  assert.throws(() => assertSingleTakeAuditPassed(value), SingleTakeAuditError);
});

test("high risk and unreachable motion request a scoped segment repair", () => {
  const value = plan();
  const description = (value.segmentRenderDescriptions as Array<Record<string, unknown>>)[0];
  description.singleTakeContract = { requiresCut: false, riskLevel: "high", physicallyReachable: false };
  const result = auditSingleTakePlan(value);
  assert.equal(result.action, "repair_segment");
  assert.ok(result.issues.some((item) => item.code === "SINGLE_TAKE_HIGH_RISK"));
  assert.ok(result.issues.some((item) => item.code === "SINGLE_TAKE_PHYSICALLY_UNREACHABLE"));
});

test("high risk without structural evidence is warning-only", () => {
  const value = plan();
  const description = (value.segmentRenderDescriptions as Array<Record<string, unknown>>)[0];
  description.singleTakeContract = { requiresCut: false, riskLevel: "high", physicallyReachable: true };
  const result = auditSingleTakePlan(value);
  assert.equal(result.passed, true);
  assert.equal(result.action, "allow_with_warning");
  assert.ok(result.issues.some((item) =>
    item.code === "SINGLE_TAKE_HIGH_RISK"
    && item.severity === "warning"
    && item.repairScope === "none"));
});

test("missing contracts request contract-only repair", () => {
  const value = plan({
    segmentRenderDescriptions: [{ segmentNo: 1 }],
  });
  const result = auditSingleTakePlan(value);
  assert.equal(result.passed, false);
  assert.equal(result.action, "repair_contract");
  assert.ok(result.issues.every((item) => item.repairScope === "contract"));
});

test("positive internal dissolve language is rejected instead of rewritten", () => {
  const value = plan();
  const description = (value.segmentRenderDescriptions as Array<Record<string, unknown>>)[0];
  description.motionContract = { path: "人物走到中点，然后 dissolve to a new shot" };
  const result = auditSingleTakePlan(value);
  assert.ok(result.issues.some((item) => item.code === "INTERNAL_CUT_LANGUAGE"));
  assert.equal(result.action, "replan_timeline");
});

test("small timing overflow repairs one segment while severe overflow replans timeline", () => {
  const local = plan({
    segments: [{ segmentNo: 1, durationSeconds: 5, videoPrompt: "One continuous take." }],
  });
  const localDescription = (local.segmentRenderDescriptions as Array<Record<string, unknown>>)[0];
  localDescription.minimumExecutableSeconds = 6;
  assert.equal(auditSingleTakePlan(local).action, "repair_segment");

  const structural = plan({
    segments: [{ segmentNo: 1, durationSeconds: 5, videoPrompt: "One continuous take." }],
  });
  const structuralDescription = (structural.segmentRenderDescriptions as Array<Record<string, unknown>>)[0];
  structuralDescription.minimumExecutableSeconds = 8;
  assert.equal(auditSingleTakePlan(structural).action, "replan_timeline");
});

test("incomplete alternate view requests camera-graph repair", () => {
  const value = plan({
    storyboardBrief: [{ segmentNo: 1, cameraId: "camera_b" }],
    cameraGraph: {
      cameras: [
        {
          cameraId: "camera_a",
          segmentNos: [],
          axisDescription: "table axis from left to right",
          spatialLayoutLock: "hero stays left of product",
        },
        {
          cameraId: "camera_b",
          segmentNos: [1],
          parentCameraId: "camera_a",
          relationToParent: "alternate_view",
        },
      ],
      relations: [],
    },
  });
  const result = auditSingleTakePlan(value);
  assert.equal(result.action, "repair_camera_graph");
  assert.ok(result.issues.some((item) =>
    item.code === "ALTERNATE_VIEW_AXIS_UNRESOLVED"
    && item.repairScope === "camera_graph"));
});

test("forbidden outcome fields do not become false positive cut instructions", () => {
  const value = plan();
  const description = (value.segmentRenderDescriptions as Array<Record<string, unknown>>)[0];
  description.videoPromptContract = {
    version: "video-prompt-contract-v1",
    terminalRequirements: [{
      requirementId: "terminal.primary_result",
      priority: "hard",
      observableFact: "人物最终稳定站在产品旁",
      acceptanceCriteria: "尾帧清晰可见人物和产品",
      source: "approved_end_frame",
    }],
    motionSteps: ["人物沿可见路径连续走到产品旁"],
    preserveRequirements: ["保持人物、产品和场景一致"],
    forbiddenOutcomes: ["切镜、叠化、蒙太奇、场景切换", "cut, dissolve, crossfade, or montage"],
    narrativeBoundary: "只表现人物抵达产品旁",
    shotIntent: "连续推进",
  };
  assert.equal(auditSingleTakePlan(value).passed, true);
});

test("cut instructions remain blocked inside executable video prompt contract fields", () => {
  const value = plan();
  const description = (value.segmentRenderDescriptions as Array<Record<string, unknown>>)[0];
  description.videoPromptContract = {
    forbiddenOutcomes: ["切镜、叠化、蒙太奇"],
    motionSteps: ["人物抵达中点后切换机位，再走到产品旁"],
  };
  const result = auditSingleTakePlan(value);
  assert.ok(result.issues.some((item) => item.code === "INTERNAL_CUT_LANGUAGE"));
});

test("end-frame evaluator maps small gap, prompt-fixable gap and unreachable gap", () => {
  const passed = normalizeEndFrameContinuityResponse({ passed: true, similarityScore: 0.86, confidenceScore: 0.92, stableHold: true, motionReachability: "reachable", reasons: [] });
  assert.equal(passed.decision, "pass");
  const retry = normalizeEndFrameContinuityResponse({ passed: false, similarityScore: 0.55, confidenceScore: 0.9, stableHold: false, motionReachability: "prompt_fixable", retryInstruction: "hold the product beside the face" });
  assert.equal(retry.decision, "retry_generation");
  assert.match(retry.retryInstruction ?? "", /product/);
  const blocked = normalizeEndFrameContinuityResponse({ passed: false, similarityScore: 0.2, confidenceScore: 0.9, stableHold: false, motionReachability: "unreachable", reasons: ["too many actions"] });
  assert.equal(blocked.decision, "return_stage_2b");
  const uncertain = normalizeEndFrameContinuityResponse({ passed: false, similarityScore: 0.7, confidenceScore: 0.45, reasons: ["motion blur"] });
  assert.equal(uncertain.decision, "manual_review");
});

test("HappyHorse truthfully transports only the first frame and keeps the approved end frame for semantic evaluation", () => {
  const root = process.cwd();
  const workflow = readFileSync(path.join(root, "src/services/video-orchestrator/aliyun-workflow.ts"), "utf8");
  const service = readFileSync(path.join(root, "src/services/video-orchestrator/project-service.ts"), "utf8");
  const compiler = readFileSync(path.join(root, "src/services/video-orchestrator/video-terminal-contract.ts"), "utf8");
  const compose = readFileSync(path.join(root, "src/services/video-orchestrator/local-compose.ts"), "utf8");
  const videoInputs = readFileSync(path.join(root, "src/services/providers/video-input-contract.ts"), "utf8");
  assert.match(workflow, /customI2vModelEnabled\(\)/);
  assert.match(workflow, /"first_frame_only"/);
  assert.match(workflow, /acceptsLastFrameImage: nativeLastFrame/);
  assert.match(workflow, /mapResolvedVideoImagesToTransport/);
  assert.match(workflow, /transportRole: "first_frame"/);
  assert.match(videoInputs, /hard_exact end-frame control/);
  assert.match(videoInputs, /evaluationOnly/);
  assert.match(compiler, /MANDATORY FINAL-FRAME CONTRACT/);
  assert.match(service, /endFramePromptEnforced: true/);
  assert.doesNotMatch(service, /enforceSegmentEndFrameLocally|deterministic_exact_end_frame_postprocess|stripVideoForbiddenTerms/);
  assert.doesNotMatch(compose, /one-prompt-boundary|approved-end-frame|clip\.boundary_enforce/);
  assert.match(compose, /item\?\.visualMode \?\? "hard_cut"/);
  assert.match(service, /"native_last_frame" : "semantic_prompt_and_visual_check"/);
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
  assert.match(service, /retryCorrections,/);
});
