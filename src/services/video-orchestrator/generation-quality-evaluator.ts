import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { ONE_PROMPT_MAX_REFERENCE_IMAGES } from "@/lib/one-prompt-video-limits";
import { logOnePromptVideo } from "./logger";
import type { GenerationCorrectionAction, GenerationQualityReport } from "./types";
import { onePromptRolloutEnabled } from "./rollout-flags";
import type { AuthoritativeVisualContract } from "./visual-quality-contract";
import { isMotionOnlyStillIssue, reconcileGenerationIssueLedger } from "./visual-quality-contract";

const IMAGE_QUALITY_SYSTEM_PROMPT = [
  "You are an evidence-based Visual Quality Assurance Engineer and a Generative Image Repair Specification Engineer for production advertising imagery.",
  "The image labeled CURRENT OUTPUT is the only image being judged. REFERENCE IMAGE and PREVIOUS OUTPUT images are comparison evidence only. Never report an object, text, count, UI element, score, timer, person, product, or defect as present unless it is visibly present in CURRENT OUTPUT.",
  "Every input image label defines its role and allowed use. Do not transfer observations between images. A detail visible only in a reference may define the desired target, but it is not evidence that the current output contains that detail.",
  "First judge only what is visibly supported by the current pixels. Then translate confirmed defects into minimal, measurable redraw instructions. Do not preserve an old diagnosis when the new image visibly changed.",
  "Use confirmed only when the defect is clearly visible. If gaze, tiny text, occlusion, or intent cannot be determined reliably, use evidenceStatus=uncertain, confidence below 0.75, priority=recommended, and do not set passed=false solely because of that uncertain finding.",
  "For spatial repairs use normalized image coordinates: top-left=(0,0), bottom-right=(1,1). Coordinates are approximate generation targets, not claims of pixel-perfect measurement.",
  "Describe every direction from the viewer/image perspective only: viewer-left, viewer-right, up, or down. Never write ambiguous phrases such as 'character right (viewer left)'.",
  "For head or eye direction, specify a viewer-relative direction, an approximate yaw/pitch range when useful, and a normalized gaze target point. A turned head is not automatically a failed gaze; cite visible pupil/head evidence.",
  "For countable UI or product elements, specify an exact count, normalized placement, spacing or size tolerance, and the surrounding elements that must remain unchanged.",
  "Return at most three highest-impact correction actions. Avoid false precision and never invent geometry unsupported by the contract or visible image.",
  "Output strict JSON only.",
].join("\n");

const VIDEO_QUALITY_SYSTEM_PROMPT = [
  "You are an evidence-based Video Quality Assurance Engineer and a Generative Video Repair Specification Engineer for production advertising imagery.",
  "Judge ordered sampled frames and metadata only from visible evidence. Separate confirmed defects from uncertain interpretations, and never carry an old diagnosis forward when later frames visibly resolve it.",
  "Use normalized frame coordinates with top-left=(0,0), bottom-right=(1,1), viewer-relative directions only, explicit time ranges, counts, target states, tolerances, and preserved surroundings.",
  "Uncertain findings must use evidenceStatus=uncertain, confidence below 0.75, priority=recommended, and must not alone force passed=false.",
  "Return at most three highest-impact correction actions as strict JSON only.",
].join("\n");

interface QualityVisionQueueState {
  active: number;
  waiters: Array<() => void>;
}

const qualityVisionQueueGlobal = globalThis as typeof globalThis & {
  __onePromptQualityVisionQueue?: QualityVisionQueueState;
};

const qualityVisionQueue = qualityVisionQueueGlobal.__onePromptQualityVisionQueue ??= {
  active: 0,
  waiters: [],
};

interface BaseEvaluationParams {
  assetId: string;
  candidateId?: string;
  candidateNo?: number;
  mediaUrl: string;
  targetContract: Record<string, unknown>;
  selectedReferenceUrls: string[];
  referenceUsageNotes: string[];
  prompt: string;
  negativePrompt?: string;
  purpose: "anchor_reference_image" | "boundary_keyframe" | "motion_checkpoint_image" | "transition_reference_frame" | "video_segment" | "generated_bridge";
  assetCategory?: string;
  /** Brand/logo/UI lock assets require exact readable text; do not fail merely because text is visible. */
  requiresExactBrandText?: boolean;
  /** Only compiler/preflight-verified contradictions may route work back to stage 3. */
  authoritativeContractConflicts?: string[];
  visualContract?: AuthoritativeVisualContract;
  previousQualityReport?: GenerationQualityReport;
  previousCandidateUrl?: string;
}

export async function evaluateGeneratedImageQuality(params: BaseEvaluationParams): Promise<GenerationQualityReport> {
  if (!onePromptRolloutEnabled("ONE_PROMPT_VISUAL_QUALITY_EVAL")) return legacyQualityFallback(params, false);
  if (!qualityVisionEnabled()) return evaluationFailure(params, "真实图片视觉质量评估未启用或缺少 DashScope API Key。", "manual");
  const content: Array<Record<string, unknown>> = [{
    type: "text",
    text: [
      "Evaluate the actual generated image. Scores must come from visible media content, never prompt length.",
      "IMAGE LOCALIZATION CONTRACT: CURRENT OUTPUT is the sole subject of observation. Before writing any issue, count, text reading, or resolved/still-open decision, locate its visible evidence in CURRENT OUTPUT itself. Never use pixels from a REFERENCE IMAGE or PREVIOUS OUTPUT as evidence about what the current output contains.",
      "REFERENCE IMAGES define only the target attributes stated in their individual role notes. Pixels outside a role note are non-authoritative. If a game board, score, timer, logo, person, product, or text appears only in a reference, do not claim it appears in CURRENT OUTPUT.",
      "You are the final visual quality gate. If any required visual evidence, identity lock, authoritative brand content, narrative meaning, anatomy, or composition is materially wrong or missing, return passed=false. The orchestration layer will not override your veto.",
      `Purpose: ${params.purpose}`,
      `Target contract: ${JSON.stringify(params.targetContract)}`,
      `Generation prompt: ${params.prompt.slice(0, 2400)}`,
      `Negative prompt: ${(params.negativePrompt ?? "").slice(0, 1200)}`,
      `Reference usage notes: ${JSON.stringify(params.referenceUsageNotes)}`,
      params.visualContract ? `Authoritative visual contract: ${JSON.stringify(params.visualContract)}` : "",
      params.previousQualityReport ? `Previous issue ledger to compare and close: ${JSON.stringify(params.previousQualityReport.issueLedger ?? [])}` : "",
      "Return strict JSON with identityScore, layoutScore, promptAlignmentScore, continuityScore (0..100), productInstanceCount, personInstanceCount, wrongTextDetected, artifactIssues[], correctionActions[], contractConflicts[], issueDeltas[], passed, retryInstruction, retryFromStage stage2b|stage3|generation.",
      "For EVERY confirmed failed issue, correctionActions must contain one executable object: {region, element, observed, target, instruction, evidenceStatus, confidence, normalizedRegion, targetPoint, executionParameters, tolerance, priority, sourceConstraint, preserve[]}. evidenceStatus is confirmed|uncertain and confidence is 0..1. normalizedRegion is {xMin,yMin,xMax,yMax} in the top-left-origin 0..1 coordinate system; targetPoint is {x,y} in the same system. executionParameters contains only contract-supported measurable controls such as viewerRelativeDirection, yawDegrees, pitchDegrees, exactCount, spacingRatio, sizeRatio, color, or textValue. tolerance states the acceptable visible range.",
      "region must identify a concrete visual location. observed states exactly what is visibly wrong and cites visible evidence rather than inferred intent. target states one concrete desired result, including exact value/count/format/color/pose/size when the contract supports it. instruction must be imperative and ready to paste into the next generation prompt; never merely repeat the diagnosis.",
      "retryInstruction must consolidate correctionActions into a precise redraw specification: say WHAT to change, WHERE to change it, the exact TARGET state, and what nearby/strong-scoring content must remain unchanged. Prefer concrete renderable values over vague words such as improve, fix, proper, near, appropriate, or more accurate.",
      "Direction rule: use viewer-left/viewer-right only. For gaze, distinguish head yaw from pupil direction and give a normalized target point. If the current head or eyes visibly moved toward the requested side, acknowledge that delta instead of repeating 'looks forward'.",
      "Evidence rule: uncertain observations may be returned as recommended correctionActions, but they must not appear as definite artifactIssues and must not alone cause passed=false.",
      "Before proposing corrections, check Target contract, Generation prompt, Negative prompt, and reference notes for possible contradictions. The target contract and explicit required-visible evidence outrank generic negative-prompt defaults. Never infer that unlisted logo text is forbidden when an approved visual anchor contains it. Put possible contradictions in contractConflicts[] as advisory evidence only; the compiler, not this visual evaluator, owns stage-3 routing.",
      "Authority rule for exact appearance and text: an approved reference image outranks planner-written descriptions. Compare the generated logo, UI, product, and character directly with the corresponding approved reference. Do not invent forbidden or required wording that is absent from the authoritative source.",
      "Game-ad rule: authorized logo text, game title, score, timer, multiplier, buttons, and contract-required UI are allowed and often required. Fail only for missing required content, wrong spelling/value/state, gibberish, unauthorized extra copy, subtitles, or watermarks—not merely because text or UI exists.",
      "For anchors prioritize isolated identity accuracy. For boundary keyframes prioritize contract/layout/identity. For motion checkpoints prioritize same-path state and continuity.",
      "For a still image, never fail because motion itself is not visible. A static score, timer, glow, or pose may represent one instant; motion, jumping digits, countdown change, and animation belong to later video evaluation.",
      "Compare against the previous issue ledger when provided. For each prior issue, explicitly decide resolved, still_open, regressed, or invalid_for_stage. Do not silently repeat old feedback.",
      "A prior issue is resolved only when the current pixels visibly fix it. If the shot's core purpose or requiredVisibleEvidence is absent (for example social feedback in a social-feedback shot), that is a blocking failure even when numeric scores are high.",
      "For an anchor reference image, use retryFromStage=generation for visible output defects such as extra people, unwanted backgrounds/decorations, wrong centering, bad proportions, malformed text, or missing requested elements. Stage2b is only for an impossible/contradictory shot contract and does not repair an anchor image.",
      params.requiresExactBrandText
        ? "This is a brand/logo/UI lock asset. Required brand text in the prompt is intentional. Set wrongTextDetected=true ONLY when visible text is misspelled, missing required lock wording, or random gibberish — NOT merely because readable brand/UI text is present."
        : "",
      params.assetCategory ? `Asset category: ${params.assetCategory}` : "",
    ].join("\n"),
  }, {
    type: "text",
    text: "CURRENT OUTPUT — IMAGE UNDER EVALUATION. Only pixels in the next image may support observed defects, counts, text readings, UI presence, and issue-resolution decisions.",
  }, { type: "image_url", image_url: { url: params.mediaUrl } }];
  const seenReferenceUrls = new Set<string>([params.mediaUrl, params.previousCandidateUrl ?? ""]);
  const localizedReferences = params.selectedReferenceUrls
    .map((url, index) => ({ url, usageNote: params.referenceUsageNotes[index] }))
    .filter(({ url }) => {
      if (!url || seenReferenceUrls.has(url)) return false;
      seenReferenceUrls.add(url);
      return true;
    })
    .slice(0, ONE_PROMPT_MAX_REFERENCE_IMAGES);
  for (const [index, reference] of localizedReferences.entries()) {
    content.push({
      type: "text",
      text: [
        `REFERENCE IMAGE ${index + 1} — NOT CURRENT OUTPUT`,
        `Role and allowed comparison: ${reference.usageNote?.trim() || "approved reference; compare only attributes explicitly required by the target contract"}`,
        "Forbidden use: do not report, count, transcribe, or diagnose anything in this reference as if it were visible in CURRENT OUTPUT.",
      ].join("\n"),
    });
    content.push({ type: "image_url", image_url: { url: reference.url } });
  }
  if (params.previousCandidateUrl) {
    content.push({
      type: "text",
      text: "PREVIOUS OUTPUT — NOT CURRENT OUTPUT. Use only for before/after delta comparison. Re-check every prior issue against CURRENT OUTPUT pixels; never copy the previous diagnosis or describe previous pixels as current.",
    });
    content.push({ type: "image_url", image_url: { url: params.previousCandidateUrl } });
  }
  const evaluationStartedAt = Date.now();
  try {
    const raw = await callVision(content, IMAGE_QUALITY_SYSTEM_PROMPT);
    const report = {
      ...normalizeImageQualityResponse(raw, params),
      evaluationModel: qualityVisionModel(),
      evaluationDurationMs: Date.now() - evaluationStartedAt,
    };
    await logOnePromptVideo("generation_quality.image_eval_completed", {
      assetId: params.assetId,
      candidateId: params.candidateId,
      model: report.evaluationModel,
      durationMs: report.evaluationDurationMs,
      passed: report.passed,
    });
    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - evaluationStartedAt;
    await logOnePromptVideo("generation_quality.image_eval_failed", {
      assetId: params.assetId,
      candidateId: params.candidateId,
      model: qualityVisionModel(),
      durationMs,
      message,
    }, "error");
    return {
      ...evaluationFailure(params, `图片视觉质量评估失败：${message}`, "manual"),
      evaluationModel: qualityVisionModel(),
      evaluationDurationMs: durationMs,
    };
  }
}

export async function evaluateGeneratedVideoQuality(params: BaseEvaluationParams & {
  durationSeconds: number;
  motionCheckpoints: unknown[];
  startFrameUrl: string;
  endFrameUrl: string;
}): Promise<GenerationQualityReport> {
  if (!onePromptRolloutEnabled("ONE_PROMPT_VISUAL_QUALITY_EVAL")) return legacyQualityFallback(params, true);
  if (!qualityVisionEnabled()) return evaluationFailure(params, "真实视频多帧视觉质量评估未启用或缺少 DashScope API Key。", "manual");
  const workDir = path.join(os.tmpdir(), `one-prompt-video-quality-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const clipPath = path.join(workDir, "candidate.mp4");
  await mkdir(workDir, { recursive: true });
  try {
    await download(params.mediaUrl, clipPath);
    const metadata = await probeVideo(clipPath);
    const sampleTimes = sampleTimesForDuration(metadata.durationSeconds || params.durationSeconds, metadata.frameRate);
    const frames: Array<{ time: number; dataUrl: string }> = [];
    for (const [index, time] of sampleTimes.entries()) {
      const outputPath = path.join(workDir, `frame-${index}.png`);
      frames.push(await extractFrameDataUrlWithFallback(
        clipPath,
        outputPath,
        time,
        metadata.durationSeconds || params.durationSeconds,
        metadata.frameRate,
      ));
    }
    const content: Array<Record<string, unknown>> = [{
      type: "text",
      text: [
        "Evaluate the actual generated video from five ordered sampled frames and metadata. Scores must come from visible content, never prompt length.",
        `Metadata: ${JSON.stringify(metadata)}`,
        `Target contract: ${JSON.stringify(params.targetContract)}`,
        `Generation prompt: ${params.prompt.slice(0, 2400)}`,
        `Negative prompt: ${(params.negativePrompt ?? "").slice(0, 1200)}`,
        `Motion checkpoints in required order: ${JSON.stringify(params.motionCheckpoints)}`,
        `Reference usage notes: ${JSON.stringify(params.referenceUsageNotes)}`,
        "Return strict JSON with identityScore, layoutScore, promptAlignmentScore, continuityScore, firstFrameConsistencyScore, checkpointOrderScore, singleTakeScore (0..100), productInstanceCount, personInstanceCount, wrongTextDetected, artifactIssues[], metadataIssues[], correctionActions[], contractConflicts[], passed, retryInstruction, retryFromStage stage2b|stage3|generation.",
        "For every confirmed failure, correctionActions[] must specify {region, element, observed, target, instruction, evidenceStatus, confidence, normalizedRegion, targetPoint, executionParameters, tolerance, priority, sourceConstraint, preserve[]}. Make each action spatially and temporally precise and directly renderable in the next attempt. Include exact state/value/count/timing/viewer-relative direction/pose when supported by the contract, and state which successful content must remain unchanged.",
        "retryInstruction must be a consolidated shot-level modification plan, not a diagnosis. Resolve requirements using target contract and explicit visible evidence above generic negative defaults. List possible contradictions in contractConflicts[] as advisory evidence; only the compiler can authorize stage-3 routing.",
        "Detect identity drift, abnormal duplicate instances, spatial layout drift, jump cuts, teleportation, melting, scene replacement, out-of-order checkpoints, first-frame mismatch and ending-state mismatch.",
        "Use retryFromStage=stage2b for physically unreachable or structural motion; stage3 for prompt/compiler repair; generation for ordinary visual defects.",
      ].join("\n"),
    }];
    for (const [index, frame] of frames.entries()) {
      content.push({ type: "text", text: `Ordered video sample ${index + 1}/5 at ${frame.time.toFixed(3)}s:` });
      content.push({ type: "image_url", image_url: { url: frame.dataUrl } });
    }
    content.push({ type: "text", text: "Approved first-frame reference:" }, { type: "image_url", image_url: { url: params.startFrameUrl } });
    content.push({ type: "text", text: "Approved end-state soft reference:" }, { type: "image_url", image_url: { url: params.endFrameUrl } });
    for (const [index, url] of params.selectedReferenceUrls.slice(0, 3).entries()) {
      content.push({ type: "text", text: `Identity/layout reference ${index + 1}: ${params.referenceUsageNotes[index] ?? "approved reference"}` });
      content.push({ type: "image_url", image_url: { url } });
    }
    const raw = await callVision(content, VIDEO_QUALITY_SYSTEM_PROMPT);
    return normalizeVideoQualityResponse(raw, params, metadata);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logOnePromptVideo("generation_quality.video_eval_failed", { assetId: params.assetId, candidateId: params.candidateId, message }, "error");
    return evaluationFailure(params, `视频多帧视觉质量评估失败：${message}`, "manual");
  } finally {
    await removeWorkDir(workDir);
  }
}

export interface VideoTechnicalInspection {
  valid: boolean;
  durationSeconds: number;
  width: number;
  height: number;
  frameRate: number;
  errorMessage?: string;
}

/**
 * Deterministic gate for generated video files. This checks that the stored
 * MP4 downloads, has sane video metadata, and can decode a real frame. It does
 * not make any aesthetic or semantic judgement.
 */
export async function inspectGeneratedVideoTechnicalQuality(mediaUrl: string): Promise<VideoTechnicalInspection> {
  const workDir = path.join(os.tmpdir(), `one-prompt-video-technical-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const clipPath = path.join(workDir, "candidate.mp4");
  const framePath = path.join(workDir, "decode-check.png");
  await mkdir(workDir, { recursive: true });
  try {
    await download(mediaUrl, clipPath);
    const metadata = await probeVideo(clipPath);
    if (
      metadata.durationSeconds <= 0
      || metadata.width <= 0
      || metadata.height <= 0
      || metadata.frameRate <= 0
    ) {
      return { valid: false, ...metadata, errorMessage: "视频时长、尺寸或帧率元数据无效。" };
    }
    await extractFrame(clipPath, framePath, Math.min(metadata.durationSeconds * 0.5, Math.max(0, metadata.durationSeconds - 0.08)));
    const frame = await readFile(framePath);
    if (frame.byteLength < 1024) {
      return { valid: false, ...metadata, errorMessage: "视频可解码，但抽取的检测帧为空或损坏。" };
    }
    return { valid: true, ...metadata };
  } catch (error) {
    return {
      valid: false,
      durationSeconds: 0,
      width: 0,
      height: 0,
      frameRate: 0,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await removeWorkDir(workDir);
  }
}

export function normalizeImageQualityResponse(value: unknown, params: BaseEvaluationParams): GenerationQualityReport {
  const report = normalizeReport(value, params);
  // Stage 2B owns shot/motion decomposition. It cannot repair a generated
  // consistency asset (logo, character sheet, product lock, and so on), so a
  // visible defect in such an image must stay in the generation retry loop.
  if (!report.passed && params.purpose === "anchor_reference_image" && report.retryFromStage === "stage2b") {
    return { ...report, retryFromStage: "generation" };
  }
  return report;
}

export function normalizeVideoQualityResponse(value: unknown, params: BaseEvaluationParams, metadata?: { durationSeconds: number; width: number; height: number; frameRate: number }): GenerationQualityReport {
  const report = normalizeReport(value, params);
  const source = record(value);
  const singleTakeScore = score(source.singleTakeScore ?? source.single_take_score);
  const firstFrameConsistencyScore = score(source.firstFrameConsistencyScore ?? source.first_frame_consistency_score);
  const checkpointOrderScore = score(source.checkpointOrderScore ?? source.checkpoint_order_score);
  const metadataIssues = strings(source.metadataIssues ?? source.metadata_issues);
  const passed = report.passed && singleTakeScore >= 65 && firstFrameConsistencyScore >= 65 && checkpointOrderScore >= 60 && metadataIssues.length === 0 && (!metadata || metadata.durationSeconds > 0);
  return {
    ...report,
    singleTakeScore,
    firstFrameConsistencyScore,
    checkpointOrderScore,
    metadataIssues,
    passed,
    originalPassed: passed,
    retryInstruction: report.retryInstruction || (!passed ? `Improve the same-take result using the observed scores: first-frame ${firstFrameConsistencyScore}, checkpoint order ${checkpointOrderScore}, single-take ${singleTakeScore}.` : undefined),
    artifactIssues: uniqueStrings([...report.artifactIssues, ...metadataIssues, ...(metadata && metadata.durationSeconds <= 0 ? ["invalid video duration metadata"] : [])]),
  };
}

export function generationQualityCompositeScore(report: GenerationQualityReport): number {
  const values = [report.identityScore, report.layoutScore, report.promptAlignmentScore, report.continuityScore];
  if (typeof report.singleTakeScore === "number") values.push(report.singleTakeScore);
  if (typeof report.firstFrameConsistencyScore === "number") values.push(report.firstFrameConsistencyScore);
  if (typeof report.checkpointOrderScore === "number") values.push(report.checkpointOrderScore);
  return Math.round((values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)) * 1000) / 1000;
}

export async function extractVideoFrameDataUrls(mediaUrl: string, fractions = [0.2, 0.4, 0.6, 0.8]): Promise<Array<{ fraction: number; dataUrl: string }>> {
  const workDir = path.join(os.tmpdir(), `one-prompt-transition-frames-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const clipPath = path.join(workDir, "source.mp4");
  await mkdir(workDir, { recursive: true });
  try {
    await download(mediaUrl, clipPath);
    const metadata = await probeVideo(clipPath);
    if (metadata.durationSeconds <= 0) throw new Error("Transition reference video has invalid duration metadata");
    const safeFractions = fractions.map((value) => Math.max(0, Math.min(0.98, value)));
    const frames: Array<{ fraction: number; dataUrl: string }> = [];
    for (const [index, fraction] of safeFractions.entries()) {
      const outputPath = path.join(workDir, `candidate-${index + 1}.png`);
      const frame = await extractFrameDataUrlWithFallback(
        clipPath,
        outputPath,
        metadata.durationSeconds * fraction,
        metadata.durationSeconds,
        metadata.frameRate,
      );
      frames.push({ fraction, dataUrl: frame.dataUrl });
    }
    return frames;
  } finally {
    await removeWorkDir(workDir);
  }
}

function normalizeReport(value: unknown, params: BaseEvaluationParams): GenerationQualityReport {
  const source = record(value);
  const originalPassed = source.passed === true;
  const identityScore = score(source.identityScore ?? source.identity_score);
  const layoutScore = score(source.layoutScore ?? source.layout_score);
  const promptAlignmentScore = score(source.promptAlignmentScore ?? source.prompt_alignment_score);
  const continuityScore = score(source.continuityScore ?? source.continuity_score);
  const wrongTextDetected = source.wrongTextDetected === true || source.wrong_text_detected === true;
  const productInstanceCount = count(source.productInstanceCount ?? source.product_instance_count);
  const personInstanceCount = count(source.personInstanceCount ?? source.person_instance_count);
  const suspectedContractConflicts = uniqueStrings([
    ...strings(source.contractConflicts ?? source.contract_conflicts),
    ...strings(source.suspectedContractConflicts ?? source.suspected_contract_conflicts),
  ]);
  const contractConflicts = uniqueStrings([
    ...(params.authoritativeContractConflicts ?? []),
    ...(params.visualContract?.verifiedConflicts ?? []),
  ]);
  const contractConflictsVerified = contractConflicts.length > 0;
  // A visual model may misread an approved reference and invent a contract
  // (for example, treating an existing logo word as forbidden). Do not feed
  // correction actions derived from an unverified conflict back into redraws.
  const rawCorrectionActions = normalizeCorrectionActions(source.correctionActions ?? source.correction_actions);
  const rawArtifactIssues = strings(source.artifactIssues ?? source.artifact_issues);
  const invalidForStageIssues = params.visualContract?.mediaStage === "static_image"
    ? rawArtifactIssues.filter(isMotionOnlyStillIssue)
    : [];
  const correctionActions = params.visualContract?.mediaStage === "static_image"
    ? rawCorrectionActions.filter((action) => !isMotionOnlyStillIssue(`${action.observed} ${action.target} ${action.instruction}`))
    : rawCorrectionActions;
  const artifactIssues = uniqueStrings([
    ...rawArtifactIssues.filter((issue) => !invalidForStageIssues.includes(issue)),
    ...suspectedContractConflicts.map((item) => `Unverified evaluator contract suspicion: ${item}`),
  ]);
  const scoreGatePassed = identityScore >= 65 && layoutScore >= 60 && promptAlignmentScore >= 65 && continuityScore >= 60;
  // The vision model's boolean is advisory. For exact brand/logo lock assets,
  // use explicit deterministic gates so minor decorative/layout comments do
  // not veto an otherwise strong, usable logo. Exact-text or person leakage
  // remains a hard failure.
  const brandVisualGatePassed = identityScore >= 85
    && layoutScore >= 75
    && promptAlignmentScore >= 75
    && continuityScore >= 70
    && !wrongTextDetected
    && personInstanceCount === 0;
  const exactTextHardGate = params.requiresExactBrandText
    || !params.visualContract
    || params.visualContract.exactTextAuthority !== "none";
  const hardFailureReasons = uniqueStrings([
    ...contractConflicts,
    identityScore < 65 ? `identity score ${identityScore} is below 65` : "",
    layoutScore < 60 ? `layout score ${layoutScore} is below 60` : "",
    promptAlignmentScore < 65 ? `prompt alignment score ${promptAlignmentScore} is below 65` : "",
    continuityScore < 60 ? `continuity score ${continuityScore} is below 60` : "",
    wrongTextDetected && exactTextHardGate ? "authoritative locked text is visibly wrong" : "",
    params.requiresExactBrandText && !brandVisualGatePassed ? "isolated brand asset failed its deterministic identity/layout/text gate" : "",
  ]);
  // The visual model is the final semantic quality gate. Deterministic checks
  // may add failures, but a high score must never reverse passed=false.
  const passed = originalPassed && scoreGatePassed && hardFailureReasons.length === 0;
  const issueLedger = reconcileGenerationIssueLedger({
    previous: params.previousQualityReport,
    candidateNo: params.candidateNo,
    artifactIssues: [...artifactIssues, ...invalidForStageIssues],
    correctionActions,
    invalidIssueTexts: invalidForStageIssues,
  });
  const openHardIssueIds = issueLedger.filter((item) => (item.status === "open" || item.status === "regressed") && item.severity === "hard" && item.applicableStage === params.visualContract?.mediaStage).map((item) => item.issueId);
  const resolvedIssueIds = issueLedger.filter((item) => item.status === "resolved").map((item) => item.issueId);
  const softSuggestions = issueLedger.filter((item) => (item.status === "open" || item.status === "regressed") && item.severity !== "hard").map((item) => item.summary);
  const qualityDecision = contractConflictsVerified
    ? "blocked" as const
    : passed
      ? originalPassed && softSuggestions.length === 0 ? "pass" as const : "recommended" as const
      : "retry" as const;
  const retryFromStage = contractConflictsVerified
    ? "stage3" as const
    : suspectedContractConflicts.length
      ? "generation" as const
      : retryStage(source.retryFromStage ?? source.retry_from_stage);
  const suppliedRetryInstruction = suspectedContractConflicts.length && !contractConflictsVerified
    ? ""
    : text(source.retryInstruction ?? source.retry_instruction);
  return {
    policyVersion: "quality-policy-v3",
    evaluationStatus: "completed",
    assetId: params.assetId,
    candidateId: params.candidateId,
    candidateNo: params.candidateNo,
    mediaUrl: params.mediaUrl,
    identityScore,
    layoutScore,
    promptAlignmentScore,
    continuityScore,
    productInstanceCount,
    personInstanceCount,
    wrongTextDetected,
    artifactIssues,
    correctionActions,
    contractConflicts,
    suspectedContractConflicts,
    contractConflictsVerified,
    issueLedger,
    resolvedIssueIds,
    openHardIssueIds,
    qualityDecision,
    hardFailureReasons,
    softSuggestions,
    passed,
    originalPassed,
    retryInstruction: !passed || correctionActions.length > 0
      ? concreteRetryInstruction({ correctionActions, contractConflicts, suppliedRetryInstruction, identityScore, layoutScore, promptAlignmentScore, continuityScore })
      : suppliedRetryInstruction || undefined,
    retryFromStage,
    contentBased: true,
  };
}

function normalizeCorrectionActions(value: unknown): GenerationCorrectionAction[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const source = record(item);
    const instruction = text(source.instruction ?? source.action ?? source.exactInstruction ?? source.exact_instruction);
    const target = text(source.target ?? source.desired ?? source.desiredState ?? source.desired_state);
    if (!instruction && !target) return [];
    const evidenceValue = text(source.evidenceStatus ?? source.evidence_status).toLowerCase();
    const evidenceStatus = evidenceValue === "uncertain" ? "uncertain" as const : "confirmed" as const;
    const confidence = unitNumber(source.confidence);
    const priorityValue = text(source.priority).toLowerCase();
    const normalizedRegion = normalizedBox(source.normalizedRegion ?? source.normalized_region ?? source.boundingBox ?? source.bounding_box);
    const targetPoint = normalizedPoint(source.targetPoint ?? source.target_point ?? source.gazeTarget ?? source.gaze_target);
    const executionParameters = record(source.executionParameters ?? source.execution_parameters ?? source.parameters);
    return [{
      region: text(source.region ?? source.location ?? source.position) || "specified visual region",
      element: text(source.element ?? source.object ?? source.subject) || "affected visual element",
      observed: text(source.observed ?? source.current ?? source.currentObservation ?? source.current_observation) || "does not match the contract",
      target: target || instruction,
      instruction: instruction || `Render ${target}`,
      evidenceStatus,
      confidence,
      normalizedRegion,
      targetPoint,
      executionParameters: Object.keys(executionParameters).length ? executionParameters : undefined,
      tolerance: text(source.tolerance ?? source.acceptanceTolerance ?? source.acceptance_tolerance) || undefined,
      priority: evidenceStatus === "uncertain" || priorityValue === "recommended" ? "recommended" as const : "required" as const,
      sourceConstraint: text(source.sourceConstraint ?? source.source_constraint ?? source.contractSource ?? source.contract_source) || undefined,
      preserve: strings(source.preserve ?? source.keepUnchanged ?? source.keep_unchanged),
    }];
  }).slice(0, 3);
}

function concreteRetryInstruction(params: {
  correctionActions: GenerationCorrectionAction[];
  contractConflicts: string[];
  suppliedRetryInstruction: string;
  identityScore: number;
  layoutScore: number;
  promptAlignmentScore: number;
  continuityScore: number;
}): string {
  if (params.contractConflicts.length) {
    return `Do not regenerate until these prompt-contract conflicts are resolved: ${params.contractConflicts.join("; ")}. Keep the target contract and explicit required-visible evidence authoritative over generic negative defaults.`;
  }
  if (params.correctionActions.length) {
    const actions = params.correctionActions.map((action, index) => {
      const evidence = action.evidenceStatus || typeof action.confidence === "number"
        ? ` Evidence: ${action.evidenceStatus ?? "confirmed"}${typeof action.confidence === "number" ? `, confidence ${action.confidence.toFixed(2)}` : ""}.`
        : "";
      const normalizedRegion = action.normalizedRegion
        ? ` Normalized region (top-left origin): x ${action.normalizedRegion.xMin.toFixed(2)}..${action.normalizedRegion.xMax.toFixed(2)}, y ${action.normalizedRegion.yMin.toFixed(2)}..${action.normalizedRegion.yMax.toFixed(2)}.`
        : "";
      const targetPoint = action.targetPoint
        ? ` Normalized target point: (${action.targetPoint.x.toFixed(2)}, ${action.targetPoint.y.toFixed(2)}).`
        : "";
      const executionParameters = action.executionParameters && Object.keys(action.executionParameters).length
        ? ` Execution parameters: ${JSON.stringify(action.executionParameters)}.`
        : "";
      const tolerance = action.tolerance ? ` Acceptance tolerance: ${action.tolerance}.` : "";
      const preserve = action.preserve?.length ? ` Preserve unchanged: ${action.preserve.join(", ")}.` : "";
      const source = action.sourceConstraint ? ` Contract source: ${action.sourceConstraint}.` : "";
      return `${index + 1}) [${action.region}] ${action.element}: observed ${action.observed}; target ${action.target}. ${action.instruction}.${evidence}${normalizedRegion}${targetPoint}${executionParameters}${tolerance}${preserve}${source}`;
    });
    return `Apply these exact corrections in the next generation:\n${actions.join("\n")}\nKeep all unlisted high-scoring identity, layout, clothing, scene, and continuity details unchanged. Treat every direction as viewer-relative; normalized coordinates use top-left=(0,0), bottom-right=(1,1).`;
  }
  return params.suppliedRetryInstruction || `Regenerate with a concrete correction plan for identity ${params.identityScore}, layout ${params.layoutScore}, prompt alignment ${params.promptAlignmentScore}, and continuity ${params.continuityScore}; specify the exact region, element, target state, and preserved content for every failed issue.`;
}

function evaluationFailure(params: BaseEvaluationParams, issue: string, retryFromStage: GenerationQualityReport["retryFromStage"]): GenerationQualityReport {
  return {
    policyVersion: "quality-policy-v3",
    evaluationStatus: "technical_failed",
    technicalError: issue,
    technicalRetryable: true,
    assetId: params.assetId,
    candidateId: params.candidateId,
    candidateNo: params.candidateNo,
    mediaUrl: params.mediaUrl,
    identityScore: 0,
    layoutScore: 0,
    promptAlignmentScore: 0,
    continuityScore: 0,
    artifactIssues: [issue],
    passed: false,
    originalPassed: false,
    contentBased: false,
    retryInstruction: "Retry visual quality evaluation for this existing candidate. Do not regenerate the media.",
    retryFromStage,
  };
}

export function isTechnicalQualityEvaluationFailure(report: GenerationQualityReport | null | undefined): boolean {
  if (!report) return false;
  if (report.evaluationStatus === "technical_failed") return true;
  if (report.contentBased === false && report.passed === false) return true;
  return report.artifactIssues.some((issue) =>
    /视觉质量评估失败|quality evaluation failed|this operation was aborted|aborterror|timed? out|timeout|rate limit|too many requests|fetch failed|network/i.test(issue),
  );
}

function legacyQualityFallback(params: BaseEvaluationParams, video: boolean): GenerationQualityReport {
  const hasMedia = Boolean(params.mediaUrl?.trim());
  const hasPrompt = params.prompt.trim().length >= (video ? 60 : 30);
  const passed = hasMedia && hasPrompt;
  const scoreValue = passed ? 70 : 0;
  return {
    assetId: params.assetId,
    candidateId: params.candidateId,
    candidateNo: params.candidateNo,
    mediaUrl: params.mediaUrl,
    identityScore: scoreValue,
    layoutScore: scoreValue,
    promptAlignmentScore: scoreValue,
    continuityScore: scoreValue,
    singleTakeScore: video ? scoreValue : undefined,
    artifactIssues: passed ? [] : [!hasMedia ? "missing generated media url" : "generation prompt is too short"],
    passed,
    originalPassed: passed,
    contentBased: false,
    retryFromStage: "generation",
    retryInstruction: passed ? undefined : "Regenerate using the legacy precheck path while visual quality evaluation is disabled.",
  };
}

async function callVision(content: Array<Record<string, unknown>>, system: string): Promise<unknown> {
  return withQualityVisionSlot(async () => {
    const attempts = qualityVisionRequestAttempts();
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await callVisionOnce(content, system);
      } catch (error) {
        lastError = error;
        if (attempt >= attempts || !isRetryableQualityError(error)) throw error;
        await delay(qualityRetryDelayMs() * attempt);
      }
    }
    throw lastError;
  });
}

async function callVisionOnce(content: Array<Record<string, unknown>>, system: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), qualityTimeoutMs());
  try {
    const response = await fetch(`${compatibleBaseUrl()}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${requireApiKey()}` }, body: JSON.stringify({ model: qualityVisionModel(), messages: [{ role: "system", content: system }, { role: "user", content }], temperature: 0, enable_thinking: false, response_format: { type: "json_object" } }), signal: controller.signal });
    const raw = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(extractError(raw) || `HTTP ${response.status}`);
    return parseContent(raw);
  } finally { clearTimeout(timeout); }
}

async function withQualityVisionSlot<T>(work: () => Promise<T>): Promise<T> {
  const limit = qualityVisionConcurrency();
  if (qualityVisionQueue.active >= limit) {
    await new Promise<void>((resolve) => qualityVisionQueue.waiters.push(resolve));
  }
  qualityVisionQueue.active += 1;
  try {
    return await work();
  } finally {
    qualityVisionQueue.active = Math.max(0, qualityVisionQueue.active - 1);
    qualityVisionQueue.waiters.shift()?.();
  }
}

function isRetryableQualityError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /abort|timed? out|timeout|fetch failed|network|socket|econn|http 408|http 409|http 425|http 429|http 5\d\d|rate limit|too many requests/i.test(message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function sampleTimesForDuration(duration: number, frameRate = 24): number[] {
  const safe = Math.max(0.2, duration);
  const tailMargin = Math.max(0.35, 4 / Math.max(1, frameRate));
  const safeTail = Math.max(0, Math.min(safe * 0.9, safe - tailMargin));
  return [0, safe * 0.25, safe * 0.5, safe * 0.75, safeTail];
}
async function probeVideo(inputPath: string): Promise<{ durationSeconds: number; width: number; height: number; frameRate: number }> { const output = await runCapture(process.env.FFPROBE_PATH?.trim() || "ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", inputPath]); const data = JSON.parse(output) as Record<string, unknown>; const stream = Array.isArray(data.streams) ? record(data.streams[0]) : {}; const format = record(data.format); return { durationSeconds: Number(format.duration) || 0, width: Number(stream.width) || 0, height: Number(stream.height) || 0, frameRate: frameRate(stream.r_frame_rate) }; }
async function extractFrameDataUrlWithFallback(
  inputPath: string,
  outputPath: string,
  requestedTime: number,
  duration: number,
  frameRate: number,
): Promise<{ time: number; dataUrl: string }> {
  const tailMargin = Math.max(0.35, 4 / Math.max(1, frameRate));
  const maxSafeTime = Math.max(0, duration - tailMargin);
  const attempts = uniqueNumbers([
    Math.max(0, Math.min(requestedTime, maxSafeTime)),
    Math.max(0, Math.min(duration * 0.85, maxSafeTime)),
    Math.max(0, Math.min(requestedTime - 0.5, maxSafeTime)),
  ]);
  let lastError: unknown;
  for (const time of attempts) {
    try {
      await rm(outputPath, { force: true });
      await extractFrame(inputPath, outputPath, time);
      const frame = await readFile(outputPath);
      if (frame.byteLength < 1024) throw new Error(`decoded frame at ${time.toFixed(3)}s is empty`);
      return { time, dataUrl: `data:image/png;base64,${frame.toString("base64")}` };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Unable to decode a sampled video frame");
}
async function extractFrame(inputPath: string, outputPath: string, time: number): Promise<void> {
  await runCapture(process.env.FFMPEG_PATH?.trim() || "ffmpeg", [
    "-y",
    "-ss",
    time.toFixed(3),
    "-i",
    inputPath,
    "-frames:v",
    "1",
    "-vf",
    "scale=1024:-2:force_original_aspect_ratio=decrease,format=rgb24",
    "-c:v",
    "png",
    "-threads",
    "1",
    outputPath,
  ]);
}
function uniqueNumbers(values: number[]): number[] {
  return values.filter((value, index) =>
    Number.isFinite(value)
    && values.findIndex((candidate) => Math.abs(candidate - value) < 0.001) === index
  );
}
async function download(url: string, outputPath: string): Promise<void> { const response = await fetch(url); if (!response.ok) throw new Error(`download failed HTTP ${response.status}`); await writeFile(outputPath, Buffer.from(await response.arrayBuffer())); }
async function runCapture(command: string, args: string[]): Promise<string> { return new Promise((resolve, reject) => { const child = spawn(command, args, { windowsHide: true }); let stdout = ""; let stderr = ""; child.stdout.on("data", (chunk) => { stdout += String(chunk); }); child.stderr.on("data", (chunk) => { stderr += String(chunk); }); child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`${command} exited ${code}: ${stderr.slice(-1600)}`))); }); }
async function removeWorkDir(workDir: string): Promise<void> {
  try {
    await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
  } catch (error) {
    // Windows antivirus/indexing can briefly retain an ffmpeg input handle.
    // Cleanup must never overwrite an otherwise valid visual-evaluation result.
    await logOnePromptVideo("generation_quality.cleanup_deferred", {
      workDir,
      message: error instanceof Error ? error.message : String(error),
    }, "warn");
  }
}
function qualityVisionEnabled(): boolean { if (process.env.ONE_PROMPT_GENERATION_QUALITY_VISION_EVAL?.trim().toLowerCase() === "false") return false; return Boolean(process.env.DASHSCOPE_API_KEY || process.env.BAILIAN_API_KEY || process.env.ALIYUN_API_KEY); }
function qualityVisionModel(): string { return process.env.ALIYUN_GENERATION_QUALITY_VISION_MODEL?.trim() || "qwen3.6-flash"; }
function qualityTimeoutMs(): number { const value = Number(process.env.ONE_PROMPT_GENERATION_QUALITY_TIMEOUT_MS); return Number.isFinite(value) && value >= 5000 ? Math.max(60000, Math.round(value)) : 90000; }
function qualityVisionConcurrency(): number { const value = Number(process.env.ONE_PROMPT_GENERATION_QUALITY_CONCURRENCY); return Number.isFinite(value) && value >= 1 ? Math.min(4, Math.round(value)) : 2; }
function qualityVisionRequestAttempts(): number { const value = Number(process.env.ONE_PROMPT_GENERATION_QUALITY_REQUEST_ATTEMPTS); return Number.isFinite(value) && value >= 1 ? Math.min(3, Math.round(value)) : 2; }
function qualityRetryDelayMs(): number { const value = Number(process.env.ONE_PROMPT_GENERATION_QUALITY_RETRY_DELAY_MS); return Number.isFinite(value) && value >= 0 ? Math.min(30000, Math.round(value)) : 1500; }
function compatibleBaseUrl(): string { return (process.env.DASHSCOPE_COMPATIBLE_BASE_URL || process.env.ALIYUN_COMPATIBLE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/$/, ""); }
function requireApiKey(): string { const key = process.env.DASHSCOPE_API_KEY || process.env.BAILIAN_API_KEY || process.env.ALIYUN_API_KEY; if (!key) throw new Error("missing DashScope API key"); return key; }
function parseContent(raw: Record<string, unknown>): unknown { const choices = Array.isArray(raw.choices) ? raw.choices : []; const first = record(choices[0]); const message = record(first.message); const content = message.content; if (typeof content !== "string") return {}; return JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
function extractError(raw: Record<string, unknown>): string { if (typeof raw.message === "string") return raw.message; const error = record(raw.error); return typeof error.message === "string" ? error.message : ""; }
function retryStage(value: unknown): GenerationQualityReport["retryFromStage"] { return value === "stage2b" || value === "stage3" || value === "generation" ? value : "generation"; }
function frameRate(value: unknown): number { const [a, b] = String(value ?? "0/1").split("/").map(Number); return b ? a / b : a || 0; }
function record(value: unknown): Record<string, unknown> { return value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function strings(value: unknown): string[] { return Array.isArray(value) ? uniqueStrings(value) : []; }
function uniqueStrings(value: unknown[]): string[] { return [...new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()))]; }
function score(value: unknown): number { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0; }
function count(value: unknown): number { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0; }
function unitNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, Math.round(n * 1000) / 1000)) : undefined;
}
function normalizedPoint(value: unknown): { x: number; y: number } | undefined {
  const source = record(value);
  const x = unitNumber(source.x);
  const y = unitNumber(source.y);
  return x == null || y == null ? undefined : { x, y };
}
function normalizedBox(value: unknown): { xMin: number; yMin: number; xMax: number; yMax: number } | undefined {
  const source = record(value);
  const xMin = unitNumber(source.xMin ?? source.x_min);
  const yMin = unitNumber(source.yMin ?? source.y_min);
  const xMax = unitNumber(source.xMax ?? source.x_max);
  const yMax = unitNumber(source.yMax ?? source.y_max);
  if (xMin == null || yMin == null || xMax == null || yMax == null || xMin >= xMax || yMin >= yMax) return undefined;
  return { xMin, yMin, xMax, yMax };
}
