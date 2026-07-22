import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { evaluatePhase9Acceptance, type Phase9AcceptanceEvidence, type Phase9ScenarioId } from "./phase9-acceptance.ts";
import { createOnePromptRolloutSnapshot, legacyReferenceSelection, ONE_PROMPT_ROLLOUT_FLAG_NAMES, readOnePromptRolloutFlags } from "./rollout-flags.ts";
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

test("every phase 9 rollout switch is independent and defaults on", () => {
  const defaults = readOnePromptRolloutFlags({});
  for (const name of ONE_PROMPT_ROLLOUT_FLAG_NAMES) assert.equal(defaults[name], true);
  for (const disabledName of ONE_PROMPT_ROLLOUT_FLAG_NAMES) {
    const flags = readOnePromptRolloutFlags({ [disabledName]: "false" });
    assert.equal(flags[disabledName], false);
    for (const name of ONE_PROMPT_ROLLOUT_FLAG_NAMES.filter((item) => item !== disabledName)) assert.equal(flags[name], true);
  }
});

test("rollout snapshot records cohort without mutating plan assets", () => {
  const snapshot = createOnePromptRolloutSnapshot({ ONE_PROMPT_ROLLOUT_COHORT: "small-new-projects", ONE_PROMPT_STRICT_VALIDATION: "false" }, new Date("2026-07-22T00:00:00.000Z"));
  assert.equal(snapshot.cohort, "small-new-projects");
  assert.equal(snapshot.flags.ONE_PROMPT_STRICT_VALIDATION, false);
  assert.equal(snapshot.capturedAt, "2026-07-22T00:00:00.000Z");
});

test("legacy reference fallback preserves hard anchors before ordinary references", () => {
  const decision = legacyReferenceSelection([
    { url: "style", hardRequired: false },
    { url: "person", hardRequired: true },
    { url: "product", hardRequired: true },
  ], 2);
  assert.deepEqual(decision.selected.map((item) => item.url), ["person", "product"]);
});

test("runtime wiring covers validation, derivation, quality, transition, audio and artifact graph fallbacks", () => {
  const projectService = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  const qualityEvaluator = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/generation-quality-evaluator.ts"), "utf8");
  for (const name of ["ONE_PROMPT_REFERENCE_SELECTOR_V2", "ONE_PROMPT_THREE_VIEW_DERIVATION", "ONE_PROMPT_STRICT_VALIDATION", "ONE_PROMPT_TRANSITION_REFERENCE", "ONE_PROMPT_UNIFIED_AUDIO_MIX", "ONE_PROMPT_ARTIFACT_GRAPH_V2"]) assert.match(projectService, new RegExp(name));
  assert.match(qualityEvaluator, /ONE_PROMPT_VISUAL_QUALITY_EVAL/);
  assert.match(projectService, /rolloutFlags = createOnePromptRolloutSnapshot/);
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

test("unified audio mix strips random segment audio and disabled flag restores legacy policy", () => {
  const previous = process.env.ONE_PROMPT_UNIFIED_AUDIO_MIX;
  try {
    process.env.ONE_PROMPT_UNIFIED_AUDIO_MIX = "true";
    assert.equal(readAudioBible({ audioBible: { mode: "mixed", stripSourceAudio: false } })?.stripSourceAudio, true);
    process.env.ONE_PROMPT_UNIFIED_AUDIO_MIX = "false";
    assert.equal(readAudioBible({ audioBible: { mode: "mixed", stripSourceAudio: false } })?.stripSourceAudio, false);
  } finally {
    if (previous == null) delete process.env.ONE_PROMPT_UNIFIED_AUDIO_MIX;
    else process.env.ONE_PROMPT_UNIFIED_AUDIO_MIX = previous;
  }
});

test("artifact graph flag controls propagation without deleting existing metadata", () => {
  const plan: Record<string, unknown> = {
    keyframes: [{ keyframeNo: 0 }, { keyframeNo: 1 }],
    segments: [{ segmentNo: 1, startKeyframeNo: 0, endKeyframeNo: 1, microShots: [] }],
  };
  const previous = process.env.ONE_PROMPT_ARTIFACT_GRAPH_V2;
  try {
    process.env.ONE_PROMPT_ARTIFACT_GRAPH_V2 = "true";
    ensurePlanArtifactMetadata(plan);
    process.env.ONE_PROMPT_ARTIFACT_GRAPH_V2 = "false";
    markPlanArtifactsDirty(plan, ["keyframe:0:prompt"], "legacy fallback test");
    const metadata = plan.artifactMetadata as Record<string, { status?: string }>;
    assert.equal(metadata["keyframe:0:prompt"]?.status, "dirty");
    assert.notEqual(metadata["keyframe:0:image"]?.status, "dirty");
    assert.ok(metadata["segment:1:video"], "existing dependency metadata must be preserved while the flag is off");
  } finally {
    if (previous == null) delete process.env.ONE_PROMPT_ARTIFACT_GRAPH_V2;
    else process.env.ONE_PROMPT_ARTIFACT_GRAPH_V2 = previous;
  }
});
