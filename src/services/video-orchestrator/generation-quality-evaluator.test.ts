import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { generationQualityCompositeScore, normalizeImageQualityResponse, normalizeVideoQualityResponse } from "./generation-quality-evaluator.ts";

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

test("high-scoring brand logo passes despite an overly strict model boolean", () => {
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
  assert.equal(report.passed, true);
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

test("manual acceptance fields do not rewrite original passed=false", () => {
  const report = normalizeImageQualityResponse({ identityScore: 65, layoutScore: 70, promptAlignmentScore: 72, continuityScore: 68, passed: false }, base);
  const accepted = { ...report, userAccepted: true, originalPassed: report.originalPassed ?? report.passed };
  assert.equal(accepted.passed, false);
  assert.equal(accepted.originalPassed, false);
  assert.equal(accepted.userAccepted, true);
});

test("candidate orchestration waits for the complete batch and ranks passing media", () => {
  const source = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  assert.match(source, /batch\.some\(\(candidate\) => candidate\.status === "running" \|\| candidate\.status === "pending"\)/);
  assert.match(source, /candidate\.passed === true && candidate\.mediaUrl/);
  assert.match(source, /sort\(\(a, b\) => \(b\.compositeScore \?\? 0\) - \(a\.compositeScore \?\? 0\)\)/);
  assert.doesNotMatch(source, /passing\[0\][\s\S]{0,80}createdAt/);
  assert.match(source, /ONE_PROMPT_IMAGE_CANDIDATE_COUNT", 1/);
  const claimIndex = source.indexOf("const claim = await prisma.videoKeyframe.updateMany");
  const submitIndex = source.indexOf("const taskId = await createImageCandidateBatch", claimIndex);
  assert.ok(claimIndex >= 0 && submitIndex > claimIndex);
  assert.match(source, /submit\.skip_claimed/);
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
});

test("sync immediately schedules recoverable candidate failures without a user click", () => {
  const source = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  assert.match(source, /anchorImageMisclassifiedAsStage2b/);
  assert.match(source, /status: VideoProjectStatus\.IMAGE_GENERATING, errorMessage: null/);
  assert.match(source, /syncGenerationCandidates\(project\);[\s\S]{0,400}project = await requireVideoProject\(userId, projectId\);[\s\S]{0,200}syncImageTasks\(project\)/);
});

test("failed-candidate acceptance is explicit and keeps passed unchanged", () => {
  const source = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  assert.match(source, /candidate\.passed !== true && !userAccepted/);
  assert.match(source, /userAccepted: candidate\.passed !== true && userAccepted/);
  assert.match(source, /originalPassed: report\.originalPassed \?\? report\.passed/);
  assert.doesNotMatch(source, /passed:\s*userAccepted/);
});
