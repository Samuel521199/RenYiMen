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

test("quality UI supports manual override, explicit status, retry and candidate image preview", () => {
  const picker = pageSource.slice(
    pageSource.indexOf("function GenerationCandidatePicker"),
    pageSource.indexOf("function formatQualityScore"),
  );
  assert.match(picker, /Quality passed/);
  assert.match(picker, /System failed · kept manually/);
  assert.match(picker, /System failed/);
  assert.match(picker, /Generation failed/);
  assert.match(picker, /Kept by your choice despite the quality check/);
  assert.match(picker, /onSelect\(candidate\)/);
  assert.match(picker, /人工采用/);
  assert.doesNotMatch(picker, /采用此版本/);
  assert.doesNotMatch(picker, /bg-cyan-400 text-slate-950/);
  assert.match(picker, /report\.retryInstruction/);
  assert.match(picker, /onRetry\(report\.retryInstruction!/);
  assert.match(picker, /identityScore/);
  assert.match(picker, /singleTakeScore/);
  assert.match(picker, /repeat\(auto-fill,minmax\(9\.5rem,1fr\)\)/);
  assert.match(picker, /setPreviewCandidate\(candidate\)/);
  assert.match(picker, /const issueLedger = report\?\.issueLedger \?\? \[\]/);
  assert.match(picker, /issueLedger\.filter/);
  assert.match(picker, /转视频检查/);
  assert.match(picker, /待新版质检/);
  assert.match(picker, /质检通过 · 有建议/);
  assert.match(picker, /cursor-zoom-in/);
  assert.match(picker, /role="dialog"/);
  assert.match(picker, /event\.key === "Escape"/);
  assert.match(picker, /const candidateOrdinals = useMemo/);
  assert.match(picker, /displayCandidateNo/);
  assert.doesNotMatch(picker, /passed=false/);
  assert.doesNotMatch(picker, /userAccepted=true/);
  assert.doesNotMatch(picker, /artifactIssues\.join/);
  assert.doesNotMatch(picker, /\{report\.retryInstruction\}<\/p>/);
});

test("selecting a boundary candidate explains that the next frame continues automatically", () => {
  assert.match(pageSource, /已采用该画面，正在自动生成下一帧/);
  assert.match(pageSource, /Image accepted; generating the next frame automatically/);
});

test("all enlarged image previews share wheel zoom, drag pan, and reset controls", () => {
  const zoomViewer = pageSource.slice(
    pageSource.indexOf("function ZoomableImage"),
    pageSource.indexOf("function formatQualityScore"),
  );
  assert.match(zoomViewer, /onWheel=/);
  assert.match(zoomViewer, /event\.preventDefault\(\)/);
  assert.match(zoomViewer, /onPointerDown=/);
  assert.match(zoomViewer, /setPointerCapture/);
  assert.match(zoomViewer, /onDoubleClick=\{reset\}/);
  assert.match(zoomViewer, /Math\.round\(scale \* 100\)/);
  assert.match(zoomViewer, /zoomViewAtPoint\(current, factor, \{ x: focusX, y: focusY \}\)/);
  assert.match(zoomViewer, /event\.clientX - rect\.left - rect\.width \/ 2/);
  assert.match(zoomViewer, /transformOrigin: "center center"/);
  assert.equal((pageSource.match(/<ZoomableImage/g) ?? []).length, 3);
});

test("candidate issue summary stays compact and loads localized copy without blocking generation", () => {
  const picker = pageSource.slice(
    pageSource.indexOf("function GenerationCandidatePicker"),
    pageSource.indexOf("function ZoomableImage"),
  );
  assert.match(picker, /expandedIssueCandidateIds/);
  assert.match(picker, /aria-expanded=\{issueDetailsExpanded\}/);
  assert.match(picker, /点击查看具体问题/);
  assert.match(picker, /issue\.status === "open" \|\| issue\.status === "regressed"/);
  assert.match(picker, /issue\.status === "resolved"/);
  assert.match(picker, /issue\.status === "invalid_for_stage"/);
  assert.match(picker, /requestQualitySummary/);
  assert.match(picker, /\/quality-summary/);
  assert.match(picker, /qualitySummaryLoading/);
  assert.match(picker, /qualitySummary\.items\.map/);
  assert.match(picker, /正在整理质检结论/);
  assert.doesNotMatch(picker, /模型原文：/);
  assert.doesNotMatch(picker, /修改建议：/);
  assert.doesNotMatch(picker, /correction\.preserve\.join/);
  assert.doesNotMatch(pageSource, /return "检测到其他画面质量问题。"/);
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

test("stopping generation requires explicit user and API confirmation", () => {
  const cancelRoute = readFileSync(
    path.join(process.cwd(), "src/app/api/video-projects/[projectId]/cancel/route.ts"),
    "utf8",
  );
  assert.match(pageSource, /window\.confirm\(copy\.stopGenerationConfirm\)/);
  assert.match(pageSource, /if \(!event\.isTrusted\) return/);
  assert.match(pageSource, /confirmation: "stop-generation"/);
  assert.match(pageSource, /cancelIntentId/);
  assert.match(cancelRoute, /body\?\.confirmation !== "stop-generation"/);
  assert.match(cancelRoute, /A fresh user stop intent is required/);
});

test("manual stop and resume update parent, child artifacts, and active candidates together", () => {
  const service = readFileSync(
    path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"),
    "utf8",
  );
  assert.match(service, /videoGenerationCandidate\.updateMany\([\s\S]*?status: "cancelled"/);
  assert.match(service, /project\.resume\.clear_manual_stop_children/);
  assert.match(service, /errorMessage: MANUAL_STOP_MESSAGE[\s\S]*?status: VideoShotStatus\.IMAGE_PENDING/);
  assert.match(service, /errorMessage: MANUAL_STOP_MESSAGE[\s\S]*?status: VideoShotStatus\.CLIP_PENDING/);
});

test("a previous project error is hidden while a new generation cycle is active", () => {
  assert.match(pageSource, /const generationRecoveryActive = Boolean/);
  assert.match(pageSource, /generationProjectId === project\.id/);
  assert.match(pageSource, /const visibleProjectError = project\?\.errorMessage[\s\S]*?!generationRecoveryActive/);
  assert.match(pageSource, /\{\(error \|\| visibleProjectError\) && \(/);
  assert.doesNotMatch(pageSource, /\{\(error \|\| \(project\?\.errorMessage/);
});

test("workflow errors follow the selected interface language instead of rendering mixed raw messages", () => {
  const localizer = pageSource.slice(
    pageSource.indexOf("function localizeWorkflowError"),
    pageSource.indexOf("function shotStatusLabel"),
  );
  assert.match(localizer, /Required transition scene-layout reference was not selected/);
  assert.match(localizer, /继续生成前，请先为机位/);
  assert.match(localizer, /Before continuing, select and confirm/);
  assert.match(localizer, /isBudgetExhausted/);
  assert.match(localizer, /this revision chain has exhausted its automatic retry budget/);
  assert.match(localizer, /compiler-verified generation-contract conflict/);
  assert.match(localizer, /function localizeQualityIssue/);
  assert.match(pageSource, /const localizedActionError = error \? localizeWorkflowError\(error, pageLang\)/);
  assert.match(pageSource, /const localizedProjectError = visibleProjectError \? localizeWorkflowError\(visibleProjectError, pageLang\)/);
  assert.doesNotMatch(pageSource, /<p className="text-red-300">\{error\}<\/p>/);
  assert.doesNotMatch(pageSource, /<p className="text-amber-300">\{visibleProjectError\}<\/p>/);
});

test("keyframe regeneration preserves history and adds one learned candidate at a time", () => {
  const service = readFileSync(
    path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"),
    "utf8",
  );
  const learning = service.slice(
    service.indexOf("function buildImageCandidateLearningSummary"),
    service.indexOf("export async function regenerateShotImage"),
  );
  const regeneration = service.slice(
    service.indexOf("export async function regenerateShotImage"),
    service.indexOf("export async function regenerateMicroShotImage"),
  );
  const sequentialSubmission = service.slice(
    service.indexOf("async function submitNextImageTask"),
    service.indexOf("async function syncClipTasks"),
  );
  assert.match(service, /historicalCandidateCount = await prisma\.videoGenerationCandidate\.count/);
  assert.match(service, /candidateNo = historicalCandidateCount \+ localCandidateNo/);
  assert.match(learning, /Preserve every earlier candidate as history/);
  assert.match(learning, /accumulatedFailureIssues/);
  assert.match(learning, /accumulatedRetryInstructions/);
  assert.match(learning, /strongDimensions/);
  assert.match(regeneration, /candidateCount: 1/);
  assert.match(regeneration, /incrementalRegeneration: true/);
  assert.match(regeneration, /learnedFromCandidateIds: learning\.sourceCandidateIds/);
  assert.doesNotMatch(regeneration, /videoGenerationCandidate\.delete/);
  assert.doesNotMatch(regeneration, /imageUrl: null/);
  assert.match(sequentialSubmission, /buildImageCandidateLearningSummary\(project, artifactId/);
  assert.match(sequentialSubmission, /candidateCount: 1/);
  assert.match(sequentialSubmission, /incremental candidate #/);
});

test("keyframe regeneration gives immediate target-level progress feedback", () => {
  const regeneration = pageSource.slice(
    pageSource.indexOf("async function regenerateImage"),
    pageSource.indexOf("async function regenerateClip"),
  );
  assert.match(pageSource, /const \[regeneratingImageIds, setRegeneratingImageIds\] = useState<string\[\]>\(\[\]\)/);
  assert.match(regeneration, /setRegeneratingImageIds/);
  assert.match(regeneration, /function isRegeneratingImage/);
  assert.match(regeneration, /return regeneratingImageIds\.includes\(keyframe\.id\)/);
  assert.doesNotMatch(regeneration, /keyframe\.status === "IMAGE_RUNNING"/);
  assert.doesNotMatch(regeneration, /\["pending", "running", "succeeded", "evaluating"\]/);
  assert.match(pageSource, /aria-busy=\{isRegeneratingImage\(keyframe\)\}/);
  assert.match(pageSource, /isRegeneratingImage\(keyframe\) \? "animate-spin" : ""/);
  assert.match(pageSource, /retrying=\{isRegeneratingImage\(selectedKeyframe\)\}/);
});
