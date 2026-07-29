import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { evaluatePhase9Acceptance, type Phase9AcceptanceEvidence, type Phase9ScenarioId } from "./phase9-acceptance.ts";
import { ensurePlanArtifactMetadata, markPlanArtifactsDirty, readAudioBible } from "./project-service.ts";

function media(artifactId: string) {
  return { artifactId, generated: true, referenceSelection: true, promptDebug: true, qualityReport: true, artifactMetadata: true };
}

function base(scenarioId: Phase9ScenarioId): Phase9AcceptanceEvidence {
  return {
    scenarioId,
    hardAnchors: [{ id: "person_1", visible: true, approved: true, selected: true }],
    generationAttempts: [{ artifactId: `${scenarioId}:image`, kind: "image", submitted: true, idempotencyKey: `${scenarioId}:image:r1` }],
    revisions: [{ artifactId: `${scenarioId}:image`, approvedRevision: "r1", activeRevision: "r1", backgroundOverwrote: false }],
    mediaArtifacts: [media(`${scenarioId}:image`)],
  };
}

const scenarios: Phase9AcceptanceEvidence[] = [
  {
    ...base("single_character_turn"),
    threeViews: ["front", "side", "back"].map((view) => ({ view: view as "front" | "side" | "back", beforeRevision: `${view}-r1`, afterRevision: `${view}-r1` })),
  },
  {
    ...base("person_single_product"),
    hardAnchors: [
      { id: "person_1", visible: true, approved: true, selected: true },
      { id: "product_1", visible: true, approved: true, selected: true },
    ],
    product: { expectedInstances: 1, observedInstances: 1, appearedWithoutSource: false },
  },
  {
    ...base("two_camera_same_scene"),
    camera: { graphUsed: true, axisPreserved: true, transitionReferenceUsed: true },
  },
  {
    ...base("large_state_change"),
    generationAttempts: [{ artifactId: "segment:1:video", kind: "video", submitted: false, requiresCut: true, riskLevel: "high", idempotencyKey: "segment:1:video:r1" }],
    splitRepair: { blockedBeforeSubmit: true, repairRequested: true },
  },
  {
    ...base("thirty_second_audio_ad"),
    audio: { postProductionMode: true, narration: true, bgm: true, sfx: true, subtitles: true, randomSourceAudioStreams: 0 },
    mediaArtifacts: [media("keyframe:1:image"), media("segment:1:video"), media("final_video")],
  },
  {
    ...base("front_edit_selective_rerun"),
    dirtyRerun: {
      expectedArtifactIds: ["consistency_reference:-101:image", "consistency_reference:-102:image", "keyframe:1:image", "segment:1:video", "final_video"],
      actualArtifactIds: ["consistency_reference:-101:image", "consistency_reference:-102:image", "keyframe:1:image", "segment:1:video", "final_video"],
    },
    threeViews: [
      { view: "front", beforeRevision: "front-r1", afterRevision: "front-r2", intentionallyRegenerated: true },
      { view: "side", beforeRevision: "side-r1", afterRevision: "side-r1" },
      { view: "back", beforeRevision: "back-r1", afterRevision: "back-r1" },
    ],
  },
  {
    ...base("resume_after_failure"),
    resume: { runningTaskIdsBefore: ["task-live"], submittedTaskIdsAfter: ["task-new"], completedArtifactIdsBefore: ["keyframe:1:image"], resubmittedArtifactIdsAfter: ["segment:2:video"] },
  },
  {
    ...base("historical_project_compatibility"),
    history: { opened: true, regenerated: true, approved: true, rolledBack: true, planJsonReadable: true },
  },
];

for (const evidence of scenarios) {
  test(`phase 9 scenario passes: ${evidence.scenarioId}`, () => {
    const result = evaluatePhase9Acceptance(evidence);
    assert.equal(result.passed, true, result.issues.join("; "));
    assert.equal(result.metrics.hardAnchorMissRate, 0);
    assert.equal(result.metrics.unapprovedHardAnchorGenerationCount, 0);
    assert.equal(result.metrics.unsafeVideoSubmissionCount, 0);
    assert.equal(result.metrics.threeViewOverwriteCount, 0);
    assert.equal(result.metrics.approvedRevisionOverwriteCount, 0);
    assert.equal(result.metrics.duplicateSubmissionCount, 0);
    assert.equal(result.metrics.observableMediaCoverage, 1);
    assert.equal(result.metrics.randomSourceAudioStreamCount, 0);
  });
}

test("phase 9 architecture is a hard cutover without legacy rollout fallbacks", () => {
  const projectService = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  const qualityEvaluator = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/generation-quality-evaluator.ts"), "utf8");
  assert.doesNotMatch(projectService, /onePromptRolloutEnabled|legacyReferenceSelection|rolloutFlags/);
  assert.doesNotMatch(qualityEvaluator, /legacyQualityFallback|ONE_PROMPT_VISUAL_QUALITY_EVAL/);
  assert.match(projectService, /running tasks are synchronized instead of resubmitted/);
});

test("acceptance evaluator detects every zero-tolerance metric violation", () => {
  const result = evaluatePhase9Acceptance({
    scenarioId: "thirty_second_audio_ad",
    hardAnchors: [{ id: "person", visible: true, approved: false, selected: false }],
    generationAttempts: [
      { artifactId: "kf", kind: "image", submitted: true, idempotencyKey: "same" },
      { artifactId: "seg", kind: "video", submitted: true, requiresCut: true, riskLevel: "high", idempotencyKey: "same" },
    ],
    threeViews: [{ view: "front", beforeRevision: "r1", afterRevision: "r2" }],
    revisions: [{ artifactId: "kf", approvedRevision: "r1", activeRevision: "r2", backgroundOverwrote: true }],
    mediaArtifacts: [{ ...media("kf"), qualityReport: false }],
    audio: { postProductionMode: true, narration: true, bgm: true, sfx: true, subtitles: true, randomSourceAudioStreams: 1 },
  });
  assert.equal(result.passed, false);
  assert.equal(result.metrics.hardAnchorMissRate, 1);
  assert.equal(result.metrics.unapprovedHardAnchorGenerationCount, 1);
  assert.equal(result.metrics.unsafeVideoSubmissionCount, 1);
  assert.equal(result.metrics.threeViewOverwriteCount, 1);
  assert.equal(result.metrics.approvedRevisionOverwriteCount, 1);
  assert.equal(result.metrics.duplicateSubmissionCount, 1);
  assert.equal(result.metrics.observableMediaCoverage, 0);
  assert.equal(result.metrics.randomSourceAudioStreamCount, 1);
});

test("unified audio mix always strips random segment audio", () => {
  process.env.ONE_PROMPT_UNIFIED_AUDIO_MIX = "false";
  assert.equal(readAudioBible({ audioBible: { mode: "mixed", stripSourceAudio: false } })?.stripSourceAudio, true);
  delete process.env.ONE_PROMPT_UNIFIED_AUDIO_MIX;
});

test("artifact graph propagation is always enabled", () => {
  const plan: Record<string, unknown> = {
    keyframes: [{ keyframeNo: 0 }, { keyframeNo: 1 }],
    segments: [{ segmentNo: 1, startKeyframeNo: 0, endKeyframeNo: 1, microShots: [] }],
  };
  process.env.ONE_PROMPT_ARTIFACT_GRAPH_V2 = "false";
  ensurePlanArtifactMetadata(plan);
  markPlanArtifactsDirty(plan, ["keyframe:0:prompt"], "canonical dependency propagation");
  delete process.env.ONE_PROMPT_ARTIFACT_GRAPH_V2;
  const metadata = plan.artifactMetadata as Record<string, { status?: string }>;
  assert.equal(metadata["keyframe:0:prompt"]?.status, "dirty");
  assert.equal(metadata["keyframe:0:image"]?.status, "dirty");
  assert.equal(metadata["segment:1:video"]?.status, "dirty");
});
