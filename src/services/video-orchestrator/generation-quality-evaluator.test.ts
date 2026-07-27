import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { evaluateGeneratedImageQuality, generationQualityCompositeScore, isReferenceMissingQualityEvaluation, isTechnicalQualityEvaluationFailure, normalizeImageQualityResponse, normalizeVideoQualityResponse } from "./generation-quality-evaluator.ts";
import {
  generationQualityAttemptsUsed,
  generationTransportAttemptsUsed,
  hasUsableVideoCandidateForActiveClip,
  nextGenerationCandidateAttempt,
  selectLatestUsableImageBaseline,
} from "./project-service.ts";
import { mediaKeyMatchingContentType } from "./oss-media.ts";
import {
  fitAliyunImagePrompt,
  fitAliyunImagePromptWithReport,
  fitAliyunNegativePrompt,
  prepareAliyunImagePrompt,
  validateModelImagePromptCompaction,
} from "./aliyun-workflow.ts";
import {
  ONE_PROMPT_IMAGE_PROMPT_COMPACTION_THRESHOLD_CHARS,
  ONE_PROMPT_IMAGE_PROMPT_MAX_CHARS,
} from "../../lib/one-prompt-video-limits.ts";

const base = {
  assetId: "keyframe:1:image",
  candidateId: "candidate-2",
  candidateNo: 2,
  mediaUrl: "https://example.test/candidate.jpg",
  targetContract: { subject: "one approved character" },
  selectedReferenceUrls: ["https://example.test/reference.jpg"],
  referenceUsageNotes: ["identity only"],
  prompt: "short prompt",
  purpose: "boundary_keyframe" as const,
};

test("image quality evaluation uses a dedicated fast vision model, bounded concurrency, and a realistic timeout", () => {
  const source = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/generation-quality-evaluator.ts"), "utf8");
  assert.match(source, /ALIYUN_GENERATION_QUALITY_VISION_MODEL\?\.trim\(\) \|\| "qwen3\.6-flash"/);
  assert.doesNotMatch(source, /ALIYUN_GENERATION_QUALITY_VISION_MODEL\?\.trim\(\) \|\| process\.env\.ALIYUN_STORYBOARD_VISION_MODEL/);
  assert.match(source, /: 90000;/);
  assert.match(source, /ONE_PROMPT_GENERATION_QUALITY_CONCURRENCY/);
  assert.match(source, /qualityVisionRequestAttempts/);
  assert.match(source, /withQualityVisionSlot/);
  assert.match(source, /enable_thinking: false/);
  assert.match(source, /evaluationDurationMs: Date\.now\(\) - evaluationStartedAt/);
});

test("technical evaluator failures are distinct from visual vetoes", () => {
  assert.equal(isTechnicalQualityEvaluationFailure({
    assetId: "keyframe:1:image",
    identityScore: 0,
    layoutScore: 0,
    promptAlignmentScore: 0,
    continuityScore: 0,
    artifactIssues: ["图片视觉质量评估失败：This operation was aborted"],
    passed: false,
    contentBased: false,
    evaluationStatus: "technical_failed",
  }), true);
  assert.equal(isTechnicalQualityEvaluationFailure({
    assetId: "keyframe:1:image",
    identityScore: 0,
    layoutScore: 0,
    promptAlignmentScore: 0,
    continuityScore: 0,
    artifactIssues: ["required logo is visibly missing"],
    passed: false,
    contentBased: true,
    evaluationStatus: "completed",
  }), false);
});

test("missing evaluator metrics remain unscored instead of becoming zero", () => {
  const report = normalizeImageQualityResponse({ passed: false }, base);
  assert.equal(report.evaluationStatus, "partial");
  assert.equal(report.identityScore, null);
  assert.equal(report.layoutScore, null);
  assert.equal(report.qualityDecision, "review");
  assert.equal(generationQualityCompositeScore(report), null);
});

test("missing required references is routed to reference selection without a redraw or fake identity score", async () => {
  const report = await evaluateGeneratedImageQuality({
    ...base,
    targetContract: { effectiveRequiredAnchorIds: ["character_main"] },
    selectedReferenceUrls: [],
    referenceUsageNotes: [],
  });
  assert.equal(report.evaluationStatus, "reference_missing");
  assert.equal(report.referenceComparable, false);
  assert.equal(report.identityScoreApplicable, false);
  assert.equal(report.retryFromStage, "reference_selector");
  assert.equal(report.technicalRetryable, false);
  assert.deepEqual(report.missingReferenceAnchorIds, ["character_main"]);
  assert.equal(isReferenceMissingQualityEvaluation(report), true);
  assert.equal(isTechnicalQualityEvaluationFailure(report), false);
});

test("video frame extraction uses PNG and cleanup cannot overwrite a valid evaluation", () => {
  const source = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/generation-quality-evaluator.ts"), "utf8");
  assert.match(source, /`frame-\$\{index\}\.png`/);
  assert.match(source, /format=rgb24/);
  assert.match(source, /"-c:v",\s*"png"/);
  assert.match(source, /extractFrameDataUrlWithFallback/);
  assert.match(source, /const tailMargin = Math\.max\(0\.35, 4 \/ Math\.max\(1, frameRate\)\)/);
  assert.match(source, /Math\.min\(duration \* 0\.85, maxSafeTime\)/);
  assert.match(source, /await removeWorkDir\(workDir\)/);
  assert.match(source, /Cleanup must never overwrite an otherwise valid visual-evaluation result/);
});

test("segment video sync uses deterministic validation and keeps visual review explicitly on demand", () => {
  const evaluator = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/generation-quality-evaluator.ts"), "utf8");
  const service = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  assert.match(evaluator, /inspectGeneratedVideoTechnicalQuality/);
  assert.match(evaluator, /does[\s*]+not make any aesthetic or semantic judgement/i);
  assert.match(service, /if \(item\.kind === "segment_video"\) return false/);
  assert.match(service, /export async function analyzeSegmentVideoCandidate/);
  assert.match(service, /generation_quality\.video_advisory_requested/);
  assert.match(service, /advisoryOnly: true/);
  assert.match(service, /status: \{ in: \["succeeded", "evaluating", "evaluated", "quality_retry", "quality_failed"\] \}/);
  assert.match(service, /status: "review_ready",[\s\S]{0,80}passed: null/);
  assert.match(service, /Video candidates are ready for user review; automated visual analysis is advisory only/);
  assert.match(service, /candidate\.kind !== "segment_video" && candidate\.passed !== true/);
  assert.match(service, /reconcileSegmentVideoProjectStatus\(project\.id\)/);
  assert.match(service, /const allSegmentsReady = snapshot\.segments\.length > 0 && readyCount === snapshot\.segments\.length/);
  assert.match(service, /allSegmentsReady \? VideoProjectStatus\.CLIP_REVIEW : VideoProjectStatus\.CLIP_GENERATING/);
  assert.match(service, /recoverableLegacyFailure/);
  assert.match(service, /const hasActiveVideoCandidate/);
  assert.match(service, /\|\| hasActiveVideoCandidate/);
  assert.doesNotMatch(service, /const hasActiveVideoGenerationTasks/);
  assert.match(service, /activeCandidate \? "ready" : "generating"/);
  assert.match(service, /Video visual analysis[\s\S]{0,120}must never turn an existing playable result into FAILED/);
  assert.match(service, /const recoverableClipBackedSegments = clipBackedUnreadySegments/);
  assert.match(evaluator, /audioStreamPresent: Boolean\(audioStream\)/);
  assert.match(service, /generation_quality\.video_audio_technical/);
  assert.match(service, /nativeAudioExpected && !technical\.audioStreamPresent \? "warn" : "info"/);
});

test("an active clip backed by a technically usable video candidate does not require a visual pass", () => {
  const activeUrl = "https://example.test/segment-1.mp4";
  assert.equal(hasUsableVideoCandidateForActiveClip([{
    kind: "segment_video",
    targetId: "segment-1",
    status: "selected",
    mediaUrl: activeUrl,
  }], "segment-1", activeUrl), true);
  assert.equal(hasUsableVideoCandidateForActiveClip([{
    kind: "segment_video",
    targetId: "segment-1",
    status: "failed",
    mediaUrl: activeUrl,
  }], "segment-1", activeUrl), false);
  assert.equal(hasUsableVideoCandidateForActiveClip([{
    kind: "segment_video",
    targetId: "segment-2",
    status: "selected",
    mediaUrl: activeUrl,
  }], "segment-1", activeUrl), false);
});

test("image quality normalization preserves scores observed by the visual model", () => {
  const report = normalizeImageQualityResponse({
    identityScore: 91,
    layoutScore: 84,
    promptAlignmentScore: 88,
    continuityScore: 82,
    productInstanceCount: 1,
    personInstanceCount: 1,
    wrongTextDetected: false,
    artifactIssues: ["minor hand artifact"],
    passed: true,
    retryInstruction: "repair the hand",
    retryFromStage: "generation",
  }, base);
  assert.equal(report.contentBased, true);
  assert.equal(report.identityScore, 91);
  assert.equal(report.candidateId, "candidate-2");
  assert.equal(report.productInstanceCount, 1);
  assert.equal(report.passed, true);
});

test("failed visual evaluations produce a spatially precise next-generation correction plan", () => {
  const report = normalizeImageQualityResponse({
    identityScore: 95,
    layoutScore: 90,
    promptAlignmentScore: 85,
    continuityScore: 88,
    passed: false,
    artifactIssues: ["score does not show the intended losing state"],
    correctionActions: [{
      region: "bottom-center HUD",
      element: "player and opponent score",
      observed: "a single score of 0",
      target: "player 12, opponent 24",
      instruction: "Render one score row reading 12–24 with the player visibly behind",
      evidenceStatus: "confirmed",
      confidence: 0.96,
      normalizedRegion: { xMin: 0.35, yMin: 0.82, xMax: 0.65, yMax: 0.94 },
      targetPoint: { x: 0.5, y: 0.88 },
      executionParameters: { exactCount: 2, textValue: "12–24", viewerRelativeDirection: "center" },
      tolerance: "score row remains within ±0.04 normalized position",
      sourceConstraint: "narrative state: imminent failure",
      preserve: ["character face", "board layout"],
    }],
    retryInstruction: "fix the score",
    retryFromStage: "generation",
  }, base);
  assert.equal(report.correctionActions?.[0]?.region, "bottom-center HUD");
  assert.match(report.retryInstruction ?? "", /bottom-center HUD/);
  assert.match(report.retryInstruction ?? "", /player 12, opponent 24/);
  assert.equal(report.correctionActions?.[0]?.evidenceStatus, "confirmed");
  assert.equal(report.correctionActions?.[0]?.confidence, 0.96);
  assert.deepEqual(report.correctionActions?.[0]?.targetPoint, { x: 0.5, y: 0.88 });
  assert.match(report.retryInstruction ?? "", /Normalized region \(top-left origin\): x 0\.35\.\.0\.65, y 0\.82\.\.0\.94/);
  assert.match(report.retryInstruction ?? "", /Execution parameters: \{"exactCount":2,"textValue":"12–24","viewerRelativeDirection":"center"\}/);
  assert.match(report.retryInstruction ?? "", /Acceptance tolerance:/);
  assert.match(report.retryInstruction ?? "", /Preserve unchanged: character face, board layout/);
  assert.doesNotMatch(report.retryInstruction ?? "", /^fix the score$/);
});

test("bounded high-score defects route to local edit with the current candidate as baseline", () => {
  const report = normalizeImageQualityResponse({
    evaluationConfidence: 0.94,
    identityScore: 92,
    layoutScore: 88,
    promptAlignmentScore: 86,
    continuityScore: 90,
    passed: false,
    suggestedRepairMode: "local_edit",
    correctionScope: "local",
    baselineUsable: true,
    repairReasonCodes: ["localized_gaze_error"],
    artifactIssues: ["pupils point forward instead of viewer-right"],
    correctionActions: [{
      region: "eye region",
      element: "pupil direction",
      observed: "both pupils point forward",
      target: "both pupils point viewer-right",
      instruction: "Move only both pupils toward viewer-right",
      evidenceStatus: "confirmed",
      confidence: 0.94,
      normalizedRegion: { xMin: 0.4, yMin: 0.16, xMax: 0.61, yMax: 0.35 },
      preserve: ["face identity", "head angle", "clothing", "background"],
    }],
    retryFromStage: "generation",
  }, base);
  assert.equal(report.repairDecision?.mode, "local_edit");
  assert.equal(report.repairDecision?.baselineUsable, true);
  assert.equal(report.repairDecision?.baselineCandidateId, "candidate-2");
  assert.deepEqual(report.repairDecision?.requiredContextSections, ["minimal_contract", "approved_references"]);
  assert.deepEqual(report.repairDecision?.preserve, ["face identity", "head angle", "clothing", "background"]);
  assert.equal(report.repairDecision?.suggestedMode, "local_edit");
});

test("deterministic routing rejects local edit for global structural failures", () => {
  const report = normalizeImageQualityResponse({
    evaluationConfidence: 0.98,
    identityScore: 48,
    layoutScore: 40,
    promptAlignmentScore: 51,
    continuityScore: 62,
    passed: false,
    suggestedRepairMode: "local_edit",
    correctionScope: "local",
    baselineUsable: true,
    artifactIssues: ["wrong scene and extra character contaminate the isolated asset"],
    correctionActions: [{
      region: "full frame",
      element: "scene and subject count",
      observed: "an unrelated background and extra character are visible",
      target: "one isolated character on white",
      instruction: "Regenerate the isolated asset from the authoritative contract",
      normalizedRegion: { xMin: 0, yMin: 0, xMax: 1, yMax: 1 },
    }],
    retryFromStage: "generation",
  }, { ...base, purpose: "anchor_reference_image" });
  assert.equal(report.repairDecision?.mode, "full_regenerate");
  assert.equal(report.repairDecision?.baselineUsable, false);
  assert.equal(report.repairDecision?.suggestedMode, "local_edit");
  assert.ok(report.repairDecision?.reasonCodes.includes("severe_score_failure"));
});

test("incomplete quality evidence re-evaluates the same media instead of regenerating", () => {
  const report = normalizeImageQualityResponse({ passed: false }, base);
  assert.equal(report.repairDecision?.mode, "reevaluate_only");
  assert.equal(report.repairDecision?.baselineUsable, false);
  assert.deepEqual(report.repairDecision?.requiredContextSections, []);
});

test("a resolved image issue that returns upgrades local editing to guided regeneration", () => {
  const previousQualityReport = {
    assetId: base.assetId,
    identityScore: 90,
    layoutScore: 90,
    promptAlignmentScore: 90,
    continuityScore: 90,
    artifactIssues: [],
    passed: true,
    issueLedger: [{
      issueId: "issue_hand",
      fingerprint: "anatomy:right",
      category: "anatomy" as const,
      region: "right hand",
      summary: "right hand fingers overlap",
      target: "five clearly separated fingers",
      severity: "soft" as const,
      applicableStage: "static_image" as const,
      status: "resolved" as const,
      firstSeenCandidateNo: 1,
      lastSeenCandidateNo: 2,
      occurrenceCount: 1,
    }],
  };
  const report = normalizeImageQualityResponse({
    evaluationConfidence: 0.96,
    identityScore: 90,
    layoutScore: 88,
    promptAlignmentScore: 89,
    continuityScore: 90,
    passed: false,
    artifactIssues: ["right hand fingers overlap"],
    correctionActions: [{
      region: "right hand",
      element: "hand anatomy",
      observed: "right hand fingers overlap",
      target: "five clearly separated fingers",
      instruction: "Restore five clearly separated fingers",
      normalizedRegion: { xMin: 0.55, yMin: 0.45, xMax: 0.72, yMax: 0.7 },
    }],
    retryFromStage: "generation",
  }, { ...base, previousQualityReport });
  assert.equal(report.issueLedger?.find((issue) => issue.issueId === "issue_hand")?.status, "regressed");
  assert.equal(report.repairDecision?.mode, "guided_regenerate");
  assert.ok(report.repairDecision?.reasonCodes.includes("regressed_issue_requires_broader_regeneration"));
});

test("an image issue that regresses repeatedly forces full regeneration", () => {
  const previousQualityReport = {
    assetId: base.assetId,
    identityScore: 90,
    layoutScore: 90,
    promptAlignmentScore: 90,
    continuityScore: 90,
    artifactIssues: [],
    passed: true,
    issueLedger: [{
      issueId: "issue_hand",
      fingerprint: "anatomy:right",
      category: "anatomy" as const,
      region: "right hand",
      summary: "right hand fingers overlap",
      target: "five clearly separated fingers",
      severity: "soft" as const,
      applicableStage: "static_image" as const,
      status: "resolved" as const,
      occurrenceCount: 2,
    }],
  };
  const report = normalizeImageQualityResponse({
    evaluationConfidence: 0.96,
    identityScore: 90,
    layoutScore: 88,
    promptAlignmentScore: 89,
    continuityScore: 90,
    passed: false,
    artifactIssues: ["right hand fingers overlap"],
    correctionActions: [{
      region: "right hand",
      element: "hand anatomy",
      observed: "right hand fingers overlap",
      target: "five clearly separated fingers",
      instruction: "Restore five clearly separated fingers",
      normalizedRegion: { xMin: 0.55, yMin: 0.45, xMax: 0.72, yMax: 0.7 },
    }],
    retryFromStage: "generation",
  }, { ...base, previousQualityReport });
  assert.equal(report.repairDecision?.mode, "full_regenerate");
  assert.ok(report.repairDecision?.reasonCodes.includes("issue_regressed_multiple_times"));
});

test("uncertain visual findings become recommended rather than required corrections", () => {
  const report = normalizeImageQualityResponse({
    identityScore: 92,
    layoutScore: 90,
    promptAlignmentScore: 88,
    continuityScore: 91,
    passed: true,
    correctionActions: [{
      region: "character eyes",
      element: "pupil direction",
      observed: "pupil direction is partly occluded",
      target: "viewer-left gaze",
      instruction: "Keep the current head turn and move both pupils toward viewer-left",
      evidenceStatus: "uncertain",
      confidence: 0.61,
      priority: "required",
      targetPoint: { x: 0.2, y: 0.3 },
    }],
  }, base);
  assert.equal(report.passed, true);
  assert.equal(report.qualityDecision, "recommended");
  assert.equal(report.correctionActions?.[0]?.priority, "recommended");
  assert.match(report.retryInstruction ?? "", /Evidence: uncertain, confidence 0\.61/);
  assert.match(report.retryInstruction ?? "", /viewer-relative/);
});

test("visual evaluator prompt defines evidence-based QA and normalized repair coordinates", () => {
  const source = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/generation-quality-evaluator.ts"), "utf8");
  assert.match(source, /evidence-based Visual Quality Assurance Engineer/);
  assert.match(source, /Generative Image Repair Specification Engineer/);
  assert.match(source, /top-left=\(0,0\), bottom-right=\(1,1\)/);
  assert.match(source, /viewer-left, viewer-right/);
  assert.match(source, /evidenceStatus=uncertain/);
  assert.match(source, /do not set passed=false solely/);
  assert.match(source, /A turned head is not automatically a failed gaze/);
  assert.match(source, /at most 3 unique correctionActions/);
  assert.match(source, /do not repeat diagnosis history/);
});

test("visual-model contract suspicions keep the image veto while staying in generation repair", () => {
  const report = normalizeImageQualityResponse({
    identityScore: 95,
    layoutScore: 90,
    promptAlignmentScore: 85,
    continuityScore: 88,
    passed: false,
    contractConflicts: ["logo is both required and forbidden"],
    retryFromStage: "generation",
  }, base);
  assert.equal(report.passed, false);
  assert.equal(report.retryFromStage, "generation");
  assert.deepEqual(report.contractConflicts, []);
  assert.deepEqual(report.suspectedContractConflicts, ["logo is both required and forbidden"]);
  assert.equal(report.contractConflictsVerified, false);
  assert.equal(report.qualityDecision, "retry");
});

test("motion-only criticism is deferred from still-image quality to video quality", () => {
  const report = normalizeImageQualityResponse({
    identityScore: 95,
    layoutScore: 90,
    promptAlignmentScore: 85,
    continuityScore: 92,
    passed: false,
    artifactIssues: ["Timer is static and lacks dynamic animation cues"],
    retryFromStage: "generation",
  }, { ...base, visualContract: {
    version: "visual-contract-v1",
    mediaStage: "static_image",
    sourcePriority: [],
    requiredText: [],
    allowedText: [],
    forbiddenText: [],
    exactTextAuthority: "none",
    allowGameUi: true,
    allowBrandText: false,
    staticRequirements: [],
    deferredVideoChecks: ["timer changes"],
    verifiedConflicts: [],
    warnings: [],
  } });
  assert.equal(report.passed, false);
  assert.equal(report.qualityDecision, "retry");
  assert.deepEqual(report.artifactIssues, []);
  assert.equal(report.issueLedger?.[0]?.status, "invalid_for_stage");
});

test("only compiler-verified contract conflicts route work back to stage 3", () => {
  const report = normalizeImageQualityResponse({
    identityScore: 95,
    layoutScore: 90,
    promptAlignmentScore: 85,
    continuityScore: 88,
    passed: true,
    contractConflicts: ["visual evaluator suspicion"],
  }, { ...base, authoritativeContractConflicts: ["logo is both required and forbidden"] });
  assert.equal(report.passed, false);
  assert.equal(report.retryFromStage, "stage3");
  assert.deepEqual(report.contractConflicts, ["logo is both required and forbidden"]);
  assert.equal(report.contractConflictsVerified, true);
  assert.match(report.retryInstruction ?? "", /Do not regenerate until/);
});

test("prompt length does not change a normalized actual-media score", () => {
  const visibleResult = { identityScore: 77, layoutScore: 76, promptAlignmentScore: 75, continuityScore: 74, passed: false };
  const short = normalizeImageQualityResponse(visibleResult, base);
  const long = normalizeImageQualityResponse(visibleResult, { ...base, prompt: "x".repeat(20_000) });
  assert.deepEqual(
    [short.identityScore, short.layoutScore, short.promptAlignmentScore, short.continuityScore, short.passed],
    [long.identityScore, long.layoutScore, long.promptAlignmentScore, long.continuityScore, long.passed],
  );
});

test("video composite includes first-frame, checkpoint-order and single-take evidence", () => {
  const report = normalizeVideoQualityResponse({
    identityScore: 90,
    layoutScore: 80,
    promptAlignmentScore: 70,
    continuityScore: 60,
    firstFrameConsistencyScore: 50,
    checkpointOrderScore: 40,
    singleTakeScore: 30,
    passed: false,
  }, { ...base, purpose: "video_segment" });
  assert.equal(generationQualityCompositeScore(report), 60);
  assert.equal(report.firstFrameConsistencyScore, 50);
  assert.equal(report.checkpointOrderScore, 40);
});

test("video quality closes deferred image issues by source issue id", () => {
  const deferredVideoQualityChecks = [{
    sourceIssueId: "keyframe:1:image::issue_timer",
    sourceArtifactId: "keyframe:1:image",
    category: "game_ui" as const,
    region: "timer",
    requiredVideoCheck: "timer visibly counts down from 10 to 7",
    expectedState: "10 to 7 countdown",
  }];
  const report = normalizeVideoQualityResponse({
    evaluationConfidence: 0.95,
    identityScore: 90,
    layoutScore: 90,
    promptAlignmentScore: 90,
    continuityScore: 90,
    firstFrameConsistencyScore: 90,
    checkpointOrderScore: 90,
    singleTakeScore: 90,
    deferredVideoIssueResults: [{
      sourceIssueId: "keyframe:1:image::issue_timer",
      status: "resolved",
      evidence: "timer reads 10, 9, 8, then 7 across ordered samples",
      timeRange: "0.0s-2.4s",
    }],
    passed: true,
  }, { ...base, purpose: "video_segment", deferredVideoQualityChecks });
  assert.equal(report.passed, true);
  assert.deepEqual(report.resolvedDeferredVideoIssueIds, ["keyframe:1:image::issue_timer"]);
  assert.equal(report.issueLedger?.find((issue) => issue.issueId === "keyframe:1:image::issue_timer")?.status, "resolved");
});

test("open or omitted deferred video checks cannot silently pass", () => {
  const deferredVideoQualityChecks = [{
    sourceIssueId: "keyframe:1:image::issue_timer",
    sourceArtifactId: "keyframe:1:image",
    category: "game_ui" as const,
    requiredVideoCheck: "timer visibly counts down from 10 to 7",
  }];
  const commonResult = {
    evaluationConfidence: 0.95,
    identityScore: 90,
    layoutScore: 90,
    promptAlignmentScore: 90,
    continuityScore: 90,
    firstFrameConsistencyScore: 90,
    checkpointOrderScore: 90,
    singleTakeScore: 90,
    passed: true,
  };
  const open = normalizeVideoQualityResponse({
    ...commonResult,
    deferredVideoIssueResults: [{
      sourceIssueId: "keyframe:1:image::issue_timer",
      status: "open",
      evidence: "timer remains fixed at 10",
    }],
  }, { ...base, purpose: "video_segment", deferredVideoQualityChecks });
  assert.equal(open.passed, false);
  assert.equal(open.qualityDecision, "retry");
  assert.deepEqual(open.openDeferredVideoIssueIds, ["keyframe:1:image::issue_timer"]);
  assert.match(open.retryInstruction ?? "", /timer visibly counts down from 10 to 7/);

  const omitted = normalizeVideoQualityResponse(commonResult, {
    ...base,
    purpose: "video_segment",
    deferredVideoQualityChecks,
  });
  assert.equal(omitted.passed, false);
  assert.equal(omitted.evaluationStatus, "partial");
  assert.equal(omitted.qualityDecision, "review");
  assert.match(omitted.retryInstruction ?? "", /Do not regenerate the media/);
});

test("exact brand logo assets fail when the evaluator detects wrong text", () => {
  const report = normalizeImageQualityResponse({
    identityScore: 82,
    layoutScore: 78,
    promptAlignmentScore: 80,
    continuityScore: 76,
    wrongTextDetected: true,
    artifactIssues: ["minor typography spacing"],
    passed: true,
    retryFromStage: "generation",
  }, { ...base, purpose: "anchor_reference_image", requiresExactBrandText: true, assetCategory: "brand_visual" });
  assert.equal(report.passed, false);
  assert.equal(report.wrongTextDetected, true);
});

test("high scores never override the visual model's brand-logo veto", () => {
  const report = normalizeImageQualityResponse({
    identityScore: 95,
    layoutScore: 85,
    promptAlignmentScore: 80,
    continuityScore: 90,
    personInstanceCount: 0,
    wrongTextDetected: false,
    artifactIssues: ["minor x2 alignment deviation", "small decorative star"],
    passed: false,
    retryFromStage: "generation",
  }, { ...base, purpose: "anchor_reference_image", requiresExactBrandText: true, assetCategory: "brand_visual" });
  assert.equal(report.passed, false);
  assert.equal(report.originalPassed, false);
});

test("wrong text still fails boundary keyframes", () => {
  const report = normalizeImageQualityResponse({
    identityScore: 82,
    layoutScore: 78,
    promptAlignmentScore: 80,
    continuityScore: 76,
    wrongTextDetected: true,
    passed: true,
  }, base);
  assert.equal(report.passed, false);
});

test("anchor image defects stay in generation retry instead of rolling back shot decomposition", () => {
  const report = normalizeImageQualityResponse({
    identityScore: 85,
    layoutScore: 70,
    promptAlignmentScore: 65,
    continuityScore: 75,
    artifactIssues: ["unexpected character and decorative background"],
    passed: false,
    retryInstruction: "Render only the centered logo on white.",
    retryFromStage: "stage2b",
  }, { ...base, purpose: "anchor_reference_image", assetCategory: "brand_visual", requiresExactBrandText: true });
  assert.equal(report.passed, false);
  assert.equal(report.retryFromStage, "generation");
});

test("manual acceptance preserves rather than rewrites the visual model's veto", () => {
  const report = normalizeImageQualityResponse({ identityScore: 65, layoutScore: 70, promptAlignmentScore: 72, continuityScore: 68, passed: false }, base);
  const accepted = { ...report, userAccepted: true, originalPassed: report.originalPassed ?? report.passed };
  assert.equal(accepted.passed, false);
  assert.equal(accepted.qualityDecision, "retry");
  assert.equal(accepted.originalPassed, false);
  assert.equal(accepted.userAccepted, true);
});

test("candidate orchestration evaluates all batches, waits for the complete pool, and ranks passing media", () => {
  const source = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  assert.match(source, /item\.status === "succeeded" && !item\.qualityReport/);
  assert.match(source, /item\.status !== "quality_retry"/);
  assert.match(source, /allArtifactCandidates\.some\(\(candidate\) => unsettledStatuses\.has\(candidate\.status\)\)/);
  assert.doesNotMatch(source, /latestBatchByArtifact/);
  assert.match(source, /candidate\.passed === true && candidate\.mediaUrl/);
  assert.match(source, /sort\(\(a, b\) => \(b\.compositeScore \?\? 0\) - \(a\.compositeScore \?\? 0\)\)/);
  assert.doesNotMatch(source, /passing\[0\][\s\S]{0,80}createdAt/);
  assert.match(source, /userProtectedSelection/);
  assert.match(source, /targetKeyframe\?\.locked/);
  assert.match(source, /targetSegment\?\.locked/);
  assert.match(source, /protectLockedSelection/);
  assert.match(source, /selected: true, userAccepted: true/);
  assert.match(source, /locked: false, NOT: \{ status: VideoShotStatus\.IMAGE_APPROVED \}/);
  assert.match(source, /function imageCandidateCount\(\): number \{[\s\S]{0,240}return 1/);
  assert.match(source, /function videoCandidateCount\(\): number \{[\s\S]{0,320}return 1/);
  const claimIndex = source.indexOf("const claim = await prisma.videoKeyframe.updateMany");
  const submitIndex = source.indexOf("const taskId = await createImageCandidateBatch", claimIndex);
  assert.ok(claimIndex >= 0 && submitIndex > claimIndex);
  assert.match(source, /submit\.skip_claimed/);
  assert.match(source, /status: "evaluating"/);
  assert.match(source, /evaluationClaim\.count !== 1/);
  assert.match(source, /qualityReport: \{ equals: Prisma\.DbNull \}/);
  assert.match(source, /generation_quality\.duplicate_result_discarded/);
  assert.match(source, /isTechnicalQualityEvaluationFailure/);
  assert.match(source, /compositeScore: null/);
  assert.match(source, /passed: null/);
  assert.match(source, /status: technicalRetryExhausted \? "quality_failed" : "quality_retry"/);
  assert.match(source, /where: candidate\.status === "quality_retry"/);
  assert.match(source, /id: candidate\.id,[\s\S]{0,80}status: "evaluating"/);
  assert.doesNotMatch(source, /wasIncorrectlyPromoted[\s\S]{0,240}evaluateGeneratedImageQuality/);
});

test("image retries use repair-mode prompt packets for keyframes, assets and micro-shots", () => {
  const service = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  const workflow = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/aliyun-workflow.ts"), "utf8");
  assert.match(service, /function buildImageAttemptPrompt/);
  assert.match(service, /LOCAL IMAGE REPAIR PACKET/);
  assert.match(service, /GUIDED IMAGE REGENERATION PACKET/);
  assert.match(service, /FULL IMAGE REGENERATION/);
  assert.match(service, /RESOLVED-STATE PRESERVATION LOCK/);
  assert.match(service, /const mayReuseBaseline = repairMode === "local_edit" \|\| repairMode === "guided_regenerate"/);
  assert.match(service, /const baselineUrl = mayReuseBaseline/);
  assert.match(service, /repairMode: learning\.repairMode/);
  assert.match(service, /kind: "micro_shot_image"[\s\S]{0,1000}prompt: learnedPrompt/);
  assert.match(workflow, /"LOCAL IMAGE REPAIR"/);
  assert.match(workflow, /"GUIDED IMAGE REGENERATION"/);
  assert.match(workflow, /"FULL IMAGE REGENERATION"/);
  assert.match(workflow, /"RESOLVED-STATE PRESERVATION LOCK"/);
});

test("deferred still-image issues become a generation handoff and manual or on-demand checklist", () => {
  const service = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  const evaluator = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/generation-quality-evaluator.ts"), "utf8");
  assert.match(service, /function deferredVideoQualityChecksForSegment/);
  assert.match(service, /IMAGE-TO-VIDEO HANDOFF/);
  assert.match(service, /deferredVideoQualityChecks,/);
  assert.match(service, /manualVideoQualityChecks/);
  assert.match(service, /analyzeSegmentVideoCandidate/);
  assert.match(evaluator, /DEFERRED IMAGE ISSUES — REQUIRED VIDEO CHECK CONTRACT/);
  assert.match(evaluator, /deferredVideoIssueResults/);
  assert.match(evaluator, /Never silently omit a deferred check/);
});

test("overlength image prompts keep retry corrections ahead of descriptive detail", () => {
  const prompt = [
    "Core scene description. ".repeat(180),
    "MANDATORY RETRY CORRECTION\nAdd exactly two visible like icons and turn the head 10 degrees viewer-left.",
    "INCREMENTAL CANDIDATE IMPROVEMENT\nDo not repeat the missing logo. Preserve the approved character identity.",
    "Additional decorative detail. ".repeat(160),
  ].join("\n\n");
  const fitted = fitAliyunImagePrompt(prompt);
  assert.ok(fitted.length <= 5000);
  assert.ok(fitted.startsWith("CRITICAL GENERATION CONTRACT"));
  assert.match(fitted, /Add exactly two visible like icons/);
  assert.match(fitted, /Do not repeat the missing logo/);
});

test("image prompt compiler starts semantic compaction at the soft budget and keeps whole units", () => {
  const prompt = Array.from(
    { length: 240 },
    (_, index) => `Visible scene fact ${index + 1}: the subject occupies a concrete position in the frame.`,
  ).join("\n");
  const report = fitAliyunImagePromptWithReport(prompt);
  assert.equal(report.exceededSoftBudget, true);
  assert.equal(report.compacted, true);
  assert.ok(report.prompt.length <= ONE_PROMPT_IMAGE_PROMPT_COMPACTION_THRESHOLD_CHARS);
  assert.ok(report.omittedUnits > 0);
  assert.match(report.prompt, /\.$/);
});

test("image prompt compiler preserves tail repair and forbidden facts before decorative prose", () => {
  const prompt = [
    Array.from({ length: 180 }, (_, index) => `Decorative beautiful atmosphere variation ${index + 1}.`).join("\n"),
    "MANDATORY RETRY CORRECTION\nThe approved character must hold exactly two red cards in the viewer-left hand.",
    "Avoid: duplicate people, a third card, altered clothing, watermark, subtitles, and UI.",
  ].join("\n\n");
  const report = fitAliyunImagePromptWithReport(prompt);
  assert.ok(report.prompt.length <= ONE_PROMPT_IMAGE_PROMPT_MAX_CHARS);
  assert.ok(report.prompt.startsWith("CRITICAL GENERATION CONTRACT"));
  assert.match(report.prompt, /exactly two red cards/);
  assert.match(report.prompt, /a third card/);
  assert.doesNotMatch(report.prompt, /variation 180/);
});

test("image prompt compiler exposes when critical units do not fit the hard provider budget", () => {
  const prompt = Array.from(
    { length: 48 },
    (_, index) => [
      `MANDATORY RETRY CORRECTION ${index + 1}`,
      `Required visible invariant ${index + 1}: preserve UNIQUE_${index + 1} exactly; ${`specific_${index + 1}_identity_detail `.repeat(10)}`,
    ].join("\n"),
  ).join("\n\n");
  const report = fitAliyunImagePromptWithReport(prompt);
  assert.ok(report.prompt.length <= ONE_PROMPT_IMAGE_PROMPT_MAX_CHARS);
  assert.ok(report.omittedCriticalUnits > 0);
});

test("model prompt compaction validation requires every fact id and protected literal", () => {
  const facts = [
    {
      id: "fact_001",
      text: "Show exactly 2 cards labeled BRAND_X.",
      requiredLiterals: ["2", "BRAND_X"],
    },
    {
      id: "fact_002",
      text: "INPUT IMAGE 9 supplies identity only.",
      requiredLiterals: ["9", "INPUT", "IMAGE"],
    },
  ];
  const valid = validateModelImagePromptCompaction({
    compressed_prompt: "Show exactly 2 cards labeled BRAND_X. INPUT IMAGE 9 supplies identity only.",
    preserved_fact_ids: ["fact_001", "fact_002"],
  }, facts);
  assert.equal(valid.ok, true);
  const missingFact = validateModelImagePromptCompaction({
    compressed_prompt: "Show exactly 2 cards labeled BRAND_X. INPUT IMAGE 9 supplies identity only.",
    preserved_fact_ids: ["fact_001"],
  }, facts);
  assert.deepEqual(missingFact, { ok: false, reason: "missing_fact_ids:fact_002" });
  const missingLiteral = validateModelImagePromptCompaction({
    compressed_prompt: "Show the cards. INPUT IMAGE 9 supplies identity only.",
    preserved_fact_ids: ["fact_001", "fact_002"],
  }, facts);
  assert.equal(missingLiteral.ok, false);
  if (!missingLiteral.ok) assert.match(missingLiteral.reason, /missing_protected_literals/);
});

test("hybrid image prompt compaction calls a non-thinking model only for omitted critical units", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/services/video-orchestrator/aliyun-workflow.ts"),
    "utf8",
  );
  assert.match(source, /if \(!detail\.omittedCriticalUnits\.length\) return base/);
  assert.match(source, /enable_thinking: false/);
  assert.match(source, /preserved_fact_ids/);
  assert.match(source, /validateModelImagePromptCompaction/);
  assert.match(source, /fallback: "deterministic_semantic_unit_compaction"/);
});

test("negative prompt compaction keeps complete constraints instead of slicing a sentence", () => {
  const prompt = Array.from(
    { length: 100 },
    (_, index) => `Never render forbidden artifact ${index + 1} or its duplicate.`,
  ).join("\n");
  const fitted = fitAliyunNegativePrompt(prompt);
  assert.ok(fitted.length <= 1500);
  assert.match(fitted, /\.$/);
  assert.doesNotMatch(fitted, /artifact 100/);
});

test("image generation prompt maps every uploaded reference to a narrow role", () => {
  const prepared = prepareAliyunImagePrompt(
    "Render the approved character holding the product.",
    undefined,
    ["https://example.test/person.jpg", "https://example.test/layout.jpg"],
    ["Character identity only; do not copy pose or background.", "Scene layout and lighting only; do not copy people, UI, or text."],
  );
  assert.match(prepared, /MULTI-IMAGE INPUT MAP/);
  assert.match(prepared, /INPUT IMAGE 1[\s\S]*Character identity only/);
  assert.match(prepared, /INPUT IMAGE 2[\s\S]*Scene layout and lighting only/);
  assert.match(prepared, /never merge unrelated subjects, text, UI, products, or backgrounds/i);
  assert.ok(prepared.length <= 5000);
});

test("nine-image role map survives prompt compaction together with retry corrections", () => {
  const references = Array.from({ length: 9 }, (_, index) => `https://example.test/reference-${index + 1}.jpg`);
  const notes = references.map((_, index) => `Reference ${index + 1} role only; preserve attribute ${index + 1} and ignore unrelated pixels.`);
  const prepared = prepareAliyunImagePrompt(
    [
      "Long scene detail. ".repeat(400),
      "MANDATORY RETRY CORRECTION\nShow exactly two approved like icons in the current output.",
    ].join("\n\n"),
    undefined,
    references,
    notes,
  );
  assert.match(prepared, /INPUT IMAGE 9/);
  assert.match(prepared, /Show exactly two approved like icons/);
  assert.match(prepared, /Long scene detail/);
  assert.ok(prepared.length <= 5000);
});

test("reference role notes are not silently cut at the former 220-character boundary", () => {
  const distinctiveTail = "FINAL_ROLE_FACT_MUST_SURVIVE";
  const roleNote = `${"identity evidence, ".repeat(14)}${distinctiveTail}.`;
  assert.ok(roleNote.length > 220);
  const prepared = prepareAliyunImagePrompt(
    "Render exactly one approved subject.",
    undefined,
    ["https://example.test/person.jpg"],
    [roleNote],
  );
  assert.match(prepared, new RegExp(distinctiveTail));
});

test("image evaluator localizes current output and prevents reference-pixel leakage", () => {
  const source = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/generation-quality-evaluator.ts"), "utf8");
  assert.match(source, /CURRENT OUTPUT — IMAGE UNDER EVALUATION/);
  assert.match(source, /REFERENCE IMAGE \$\{index \+ 1\} — NOT CURRENT OUTPUT/);
  assert.match(source, /do not report, count, transcribe, or diagnose anything in this reference/);
  assert.match(source, /PREVIOUS OUTPUT — NOT CURRENT OUTPUT/);
  assert.match(source, /seenReferenceUrls\.has\(url\)/);
});

test("candidate learning uses latest lineage state instead of historical highest score", () => {
  const source = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  assert.match(source, /latest_usable_candidate_then_nearest_usable_ancestor/);
  assert.doesNotMatch(source, /strongest_structurally_usable_candidate_then_unscored_latest_fallback/);
  assert.match(source, /isStructurallyUsableImageBaseline/);
  assert.match(source, /hasIsolationViolation/);
  assert.match(source, /report\.layoutScore \?\? 0\) >= 55/);
  assert.match(source, /latestEvaluated\?\.report\.issueLedger/);
  assert.match(source, /parentCandidateId: learning\.baselineSelection\.baselineCandidateId/);
  assert.doesNotMatch(source, /const baselineUrl = currentImageUrl \|\| selected\?\.mediaUrl/);
});

test("latest usable image stays the baseline even when an older image may have scored higher", () => {
  const selected = selectLatestUsableImageBaseline([
    {
      id: "older-high-score",
      candidateNo: 1,
      createdAtMs: 1,
      structurallyUsable: true,
      catastrophicRegressionReasons: [],
      regressionAgainstParent: false,
    },
    {
      id: "latest-improved-state",
      candidateNo: 2,
      createdAtMs: 2,
      parentCandidateId: "older-high-score",
      structurallyUsable: true,
      catastrophicRegressionReasons: [],
      regressionAgainstParent: true,
    },
  ]);
  assert.equal(selected.latestCandidateId, "latest-improved-state");
  assert.equal(selected.baselineCandidateId, "latest-improved-state");
  assert.equal(selected.fallbackDepth, 0);
});

test("catastrophic latest image falls back only to its nearest usable ancestor", () => {
  const selected = selectLatestUsableImageBaseline([
    {
      id: "root",
      candidateNo: 1,
      createdAtMs: 1,
      structurallyUsable: true,
      catastrophicRegressionReasons: [],
      regressionAgainstParent: false,
    },
    {
      id: "nearest-parent",
      candidateNo: 2,
      createdAtMs: 2,
      parentCandidateId: "root",
      structurallyUsable: true,
      catastrophicRegressionReasons: [],
      regressionAgainstParent: false,
    },
    {
      id: "newer-sibling-not-in-lineage",
      candidateNo: 3,
      createdAtMs: 3,
      parentCandidateId: "root",
      structurallyUsable: true,
      catastrophicRegressionReasons: [],
      regressionAgainstParent: false,
    },
    {
      id: "latest-broken",
      candidateNo: 4,
      createdAtMs: 4,
      parentCandidateId: "nearest-parent",
      structurallyUsable: false,
      catastrophicRegressionReasons: ["explicit_catastrophic_visual_failure"],
      regressionAgainstParent: true,
    },
  ]);
  assert.equal(selected.latestCandidateId, "latest-broken");
  assert.equal(selected.baselineCandidateId, "nearest-parent");
  assert.equal(selected.fallbackDepth, 1);
  assert.deepEqual(selected.catastrophicRegressionReasons, ["explicit_catastrophic_visual_failure"]);
});

test("baseline selection stops when the whole image lineage is unusable", () => {
  const selected = selectLatestUsableImageBaseline([
    {
      id: "broken-root",
      candidateNo: 1,
      createdAtMs: 1,
      structurallyUsable: false,
      catastrophicRegressionReasons: ["structurally_unusable_baseline"],
      regressionAgainstParent: false,
    },
    {
      id: "broken-latest",
      candidateNo: 2,
      createdAtMs: 2,
      parentCandidateId: "broken-root",
      structurallyUsable: false,
      catastrophicRegressionReasons: ["hard_issue_regressed"],
      regressionAgainstParent: true,
    },
  ]);
  assert.equal(selected.baselineUsable, false);
  assert.equal(selected.baselineCandidateId, undefined);
});

test("isolated asset compilation uses one target anchor and rejects global-anchor leakage", () => {
  const source = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  assert.match(source, /resolveImageTargetDependencyScope/);
  assert.match(source, /requiredAnchorIds: targetAnchorId \? \[targetAnchorId\] : \[\]/);
  assert.match(source, /Project-level anchors are downstream consumers and must not appear in this asset/);
  assert.match(source, /生成前检测到全局锚点污染/);
  assert.match(source, /STYLE-ONLY reference for isolated asset/);
});

test("image candidates continue beyond three results before requiring a human decision", () => {
  const source = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  assert.match(source, /ONE_PROMPT_IMAGE_GENERATION_MAX_RETRIES", 5/);
  assert.match(source, /Math\.min\(8,/);
  assert.match(source, /generationMaxRetries\(retryCycleCandidates\[0\]\?\.kind as CandidateKind \| undefined\)/);
  assert.match(source, /const automaticRetryLimit =/);
  assert.match(source, /自动重试 \$\{automaticRetryLimit\} 次/);
});

test("legacy batches do not consume a new retry cycle", () => {
  const legacy = Array.from({ length: 7 }, (_, index) => ({
    artifactId: "keyframe:2:image",
    batchId: `old-${7 - index}`,
    status: "evaluated",
    metadata: { attempt: 7 - index },
  }));
  const next = nextGenerationCandidateAttempt(legacy as never, "keyframe:2:image");
  assert.equal(next.attempt, 1);
  assert.ok(next.retryCycleId);
});

test("automatic retries stay in one cycle while manual retries start a fresh cycle", () => {
  const current = [{
    artifactId: "keyframe:2:image",
    batchId: "current-batch",
    status: "evaluated",
    metadata: { attempt: 2, retryCycleId: "cycle-a" },
  }];
  assert.deepEqual(nextGenerationCandidateAttempt(current as never, "keyframe:2:image"), { attempt: 3, retryCycleId: "cycle-a" });
  assert.deepEqual(nextGenerationCandidateAttempt(current as never, "keyframe:2:image", "cycle-b"), { attempt: 1, retryCycleId: "cycle-b" });
});

test("technical quality failures and upstream transport failures do not consume visual retry budget", () => {
  const candidates = [
    {
      artifactId: "segment:1:micro_shot:1:image",
      batchId: "batch-1",
      status: "quality_retry",
      mediaUrl: "https://example.test/one.png",
      metadata: { attempt: 1, retryCycleId: "cycle-a" },
      qualityReport: {
        identityScore: 0,
        layoutScore: 0,
        promptAlignmentScore: 0,
        continuityScore: 0,
        passed: false,
        artifactIssues: ["图片视觉质量评估失败：This operation was aborted"],
      },
    },
    {
      artifactId: "segment:1:micro_shot:1:image",
      batchId: "batch-2",
      status: "failed",
      mediaUrl: null,
      metadata: { attempt: 2, retryCycleId: "cycle-a" },
      qualityReport: null,
    },
    {
      artifactId: "segment:1:micro_shot:1:image",
      batchId: "batch-3",
      status: "evaluated",
      mediaUrl: "https://example.test/three.png",
      metadata: { attempt: 3, retryCycleId: "cycle-a" },
      qualityReport: {
        identityScore: 70,
        layoutScore: 70,
        promptAlignmentScore: 70,
        continuityScore: 70,
        passed: false,
        artifactIssues: ["visible identity drift"],
      },
    },
  ];
  assert.equal(generationQualityAttemptsUsed(candidates as never), 1);
  assert.equal(generationTransportAttemptsUsed(candidates as never), 1);
});

test("a technical failure can requeue the same preserved candidate without paid regeneration", () => {
  const source = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  const retry = source.slice(
    source.indexOf("export async function retryGenerationCandidateQuality"),
    source.indexOf("async function syncImageTasks"),
  );
  assert.match(retry, /status: "quality_retry"/);
  assert.match(retry, /qualityTechnicalAttempts: 0/);
  assert.match(retry, /qualityNextRetryAt: new Date\(\)\.toISOString\(\)/);
  assert.match(retry, /updateGenerationTargetForTechnicalQualityRetry/);
  assert.doesNotMatch(retry, /submitAliyunImageTask|createImageCandidateBatch/);
});

test("persisted media key extension follows the actual response content type", () => {
  assert.equal(mediaKeyMatchingContentType("one-prompt/frame.jpg", "image/png"), "one-prompt/frame.png");
  assert.equal(mediaKeyMatchingContentType("one-prompt/frame.png", "image/jpeg"), "one-prompt/frame.jpg");
  assert.equal(mediaKeyMatchingContentType("one-prompt/clip.mp4", "video/mp4"), "one-prompt/clip.mp4");
});

test("resume repairs failed artifacts before waiting for unrelated candidate review", () => {
  const source = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  const dirtyKeyframeCheck = source.indexOf("const dirtyKeyframe =");
  const pendingReviewCheck = source.indexOf("const pendingRevisionReview =");
  assert.ok(dirtyKeyframeCheck >= 0);
  assert.ok(pendingReviewCheck > dirtyKeyframeCheck);
  assert.match(source, /!keyframe\.locked && keyframe\.status !== VideoShotStatus\.IMAGE_APPROVED/);
  assert.match(source, /!segment\.locked && segment\.status !== VideoShotStatus\.CLIP_APPROVED/);
  assert.match(source, /project\.resume\.approve_ready_asset_library/);
  assert.match(source, /return approveAssetLibrary\(userId, projectId\)/);
  const failedBoundaryRecovery = source.indexOf("project.resume.failed_boundary_new_retry_cycle");
  const runningWorkCheck = source.indexOf("const hasRunningImageWork");
  assert.ok(failedBoundaryRecovery >= 0 && failedBoundaryRecovery < runningWorkCheck);
});

test("sync immediately schedules recoverable candidate failures without a user click", () => {
  const source = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  assert.match(source, /anchorImageMisclassifiedAsStage2b/);
  assert.match(source, /status: VideoProjectStatus\.IMAGE_GENERATING, errorMessage: null/);
  assert.match(source, /unverifiedEvaluatorConflict/);
  assert.match(source, /retryBudgetExhausted/);
  assert.match(source, /经编译器确认的提示合同冲突/);
  assert.match(source, /syncGenerationCandidates\(project\);[\s\S]{0,400}project = await requireVideoProject\(userId, projectId\);[\s\S]{0,200}syncImageTasks\(project\)/);
});

test("legacy image quality reports upgrade in place before another paid generation", () => {
  const source = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  assert.match(source, /async function upgradeLegacyImageQualityReports/);
  assert.match(source, /existing\.policyVersion === "quality-policy-v3"/);
  assert.match(source, /await upgradeLegacyImageQualityReports\(project\)/);
  assert.match(source, /buildAuthoritativeVisualContract/);
  assert.match(source, /previousQualityReport: previous\?\.report/);
  assert.match(source, /normalizeImageQualityResponse\(existing, evaluationParams\)/);
  assert.doesNotMatch(source, /wasIncorrectlyPromoted[\s\S]{0,240}evaluateGeneratedImageQuality/);
});

test("visual veto remains final and stale recovery cannot submit after a candidate becomes ready", () => {
  const evaluator = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/generation-quality-evaluator.ts"), "utf8");
  const service = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  assert.match(evaluator, /const passed = originalPassed && scoreSetComplete && !lowConfidence && scoreGatePassed && hardFailureReasons\.length === 0/);
  assert.match(evaluator, /You are the final visual quality gate/);
  assert.match(service, /options: \{ recovery\?: boolean \} = \{\}/);
  assert.match(service, /image\.regenerate\.skip_stale_recovery/);
  assert.match(service, /imageUrl: keyframe\.imageUrl,[\s\S]{0,120}status: \{ in: \[VideoShotStatus\.FAILED, VideoShotStatus\.IMAGE_PENDING\] \}/);
});

test("failed-candidate acceptance is explicit and keeps passed unchanged", () => {
  const source = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  assert.match(source, /candidate\.passed !== true && !userAccepted/);
  assert.match(source, /userAccepted: candidate\.passed !== true && userAccepted/);
  assert.match(source, /originalPassed: report\.originalPassed \?\? report\.passed/);
  assert.doesNotMatch(source, /passed:\s*userAccepted/);
});

test("manual boundary candidate acceptance immediately continues the next frame", () => {
  const source = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  const selection = source.slice(
    source.indexOf("export async function selectGenerationCandidate"),
    source.indexOf("async function syncImageTasks"),
  );
  assert.match(selection, /missingBoundaryFrames/);
  assert.match(selection, /status: VideoProjectStatus\.IMAGE_GENERATING/);
  assert.match(selection, /submitNextImageTask\(\{/);
  assert.match(selection, /image\.continue_after_manual_candidate_selection/);
  assert.match(selection, /micro_shot\.manual_candidate\.auto_continue/);
  assert.match(selection, /requiredMicroShotImageIssues\(selectedProject\)\.length === 0/);
});

test("asset generation prepares dependency-ready targets in parallel with a five-task render cap", () => {
  const service = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  const envExample = readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
  const localEnvExample = readFileSync(path.join(process.cwd(), ".env.local.example"), "utf8");
  assert.match(service, /const DEFAULT_IMAGE_TASK_CONCURRENCY = 5/);
  assert.match(service, /const MAX_UPSTREAM_TASK_CONCURRENCY = 5/);
  assert.match(envExample, /ONE_PROMPT_VIDEO_IMAGE_CONCURRENCY=5/);
  assert.match(localEnvExample, /ONE_PROMPT_VIDEO_IMAGE_CONCURRENCY=5/);
  assert.match(service, /const preparedSubmissions = await Promise\.allSettled\(/);
  assert.match(service, /prepareKeyframeImageSubmission\(project, nextKeyframe\)/);
  assert.match(service, /planJson persistence and task claiming ordered to prevent lost updates/);
  assert.match(service, /isAssetViewGenerationReady\(project, keyframe\.keyframeNo\)/);
  assert.match(service, /return Boolean\(frontKeyframe && isApprovedConsistencyReference\(frontKeyframe\)\)/);
  assert.match(service, /All asset-library images must be generated before approval/);
});
