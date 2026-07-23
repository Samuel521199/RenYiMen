import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { generationQualityCompositeScore, normalizeImageQualityResponse, normalizeVideoQualityResponse } from "./generation-quality-evaluator.ts";
import { nextGenerationCandidateAttempt } from "./project-service.ts";

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
  assert.match(source, /artifactCandidates\.filter\(\(item\) => item\.status === "succeeded" && !item\.qualityReport && item\.mediaUrl\)/);
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
  assert.match(source, /ONE_PROMPT_IMAGE_CANDIDATE_COUNT", 1/);
  const claimIndex = source.indexOf("const claim = await prisma.videoKeyframe.updateMany");
  const submitIndex = source.indexOf("const taskId = await createImageCandidateBatch", claimIndex);
  assert.ok(claimIndex >= 0 && submitIndex > claimIndex);
  assert.match(source, /submit\.skip_claimed/);
  assert.match(source, /status: "evaluating"/);
  assert.match(source, /evaluationClaim\.count !== 1/);
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
  assert.match(source, /await evaluateGeneratedImageQuality\(evaluationParams\)/);
});

test("visual veto remains final and stale recovery cannot submit after a candidate becomes ready", () => {
  const evaluator = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/generation-quality-evaluator.ts"), "utf8");
  const service = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  assert.match(evaluator, /const passed = originalPassed && scoreGatePassed && hardFailureReasons\.length === 0/);
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
});
