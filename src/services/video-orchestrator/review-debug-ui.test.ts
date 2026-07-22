import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const pageSource = readFileSync(
  path.join(process.cwd(), "src/app/(platform)/workbench/workflows/one-prompt-video/page.tsx"),
  "utf8",
);

test("three-view review keeps independent cards and front-view generation gating without debug decorations", () => {
  assert.match(pageSource, /orderedAssetKeyframes\.map\(\(keyframe\)/);
  assert.match(pageSource, /personDerivedViewWaitReason/);
  assert.doesNotMatch(pageSource, /本次 front 更新影响|Affected by this front update/);
  assert.doesNotMatch(pageSource, /身份派生来源|Derived identity source/);
  assert.doesNotMatch(pageSource, /机位过渡生产链|Camera transition production/);
});

test("reference selector UI explains every candidate and compiled prompt", () => {
  const selector = pageSource.slice(
    pageSource.indexOf("function ReferenceSelectorCandidateGrid"),
    pageSource.indexOf("function formatReferenceScore"),
  );
  for (const field of [
    "candidate.url",
    "candidate.purpose",
    "candidate.relevanceScore",
    "candidate.viewMatchScore",
    "candidate.recencyScore",
    "candidate.conflictScore",
    "candidate.finalScore",
    "candidate.detectedOrientation",
    "candidate.assetView",
    "candidate.rejectionReason",
    "candidate.usageNote",
  ]) assert.match(selector, new RegExp(field.replace(".", "\\.")));
  assert.match(pageSource, /item\.finalTextPrompt/);
});

test("quality UI supports manual override, explicit status and retry instruction", () => {
  const picker = pageSource.slice(
    pageSource.indexOf("function GenerationCandidatePicker"),
    pageSource.indexOf("function formatQualityScore"),
  );
  assert.match(picker, /System passed/);
  assert.match(picker, /System failed · user accepted/);
  assert.match(picker, /onSelect\(candidate\)/);
  assert.match(picker, /report\.retryInstruction/);
  assert.match(picker, /onRetry\(report\.retryInstruction!/);
  assert.match(picker, /identityScore/);
  assert.match(picker, /singleTakeScore/);
  assert.match(picker, /repeat\(auto-fill,minmax\(6\.75rem,1fr\)\)/);
  assert.doesNotMatch(picker, /artifactIssues\.join/);
  assert.doesNotMatch(picker, /\{report\.retryInstruction\}<\/p>/);
});

test("asset progress counts approvals and keeps approval available after a recoverable failure", () => {
  assert.match(pageSource, /Boolean\(keyframe\.imageUrl\) && \(keyframe\.locked \|\| keyframe\.status === "IMAGE_APPROVED"\)/);
  assert.match(pageSource, /project\.status === "IMAGE_REVIEW" \|\| project\.status === "FAILED"/);
  const primaryActionStart = pageSource.indexOf("const primaryStageAction");
  const primaryAction = pageSource.slice(primaryActionStart, pageSource.indexOf("return (", primaryActionStart));
  assert.ok(primaryAction.indexOf("if (canApproveAssets)") < primaryAction.indexOf('if (project.status === "FAILED")'));
});

test("upstream edits preview and confirm dependency impact without deleting old revisions", () => {
  assert.match(pageSource, /function ArtifactImpactPreview/);
  assert.match(pageSource, /function confirmArtifactImpact/);
  assert.match(pageSource, /old revisions are preserved/);
  assert.match(pageSource, /confirmArtifactImpact\(project/);
  assert.doesNotMatch(pageSource.slice(pageSource.indexOf("function confirmArtifactImpact"), pageSource.indexOf("function currentGenerationQualityReports")), /delete|remove/i);
});

test("text undo and media rollback remain available", () => {
  assert.match(pageSource, /onUndo=\{\(\) => undoKeyframeField/);
  assert.match(pageSource, /onUndo=\{\(\) => undoShotField/);
  assert.match(pageSource, /rollbackMedia\("keyframe_image"/);
  assert.match(pageSource, /rollbackMedia\("segment_clip"/);
});
