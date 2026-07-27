import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { logOnePromptVideo } from "./logger";
import type {
  AtomicVisualRequirement,
  DeferredVideoIssueResult,
  DeferredVideoQualityCheck,
  GenerationCorrectionAction,
  GenerationQualityReport,
  ImageCorrectionScope,
  ImageRepairContextSection,
  ImageRepairDecision,
  ImageRepairMode,
  VisualEvidenceObservation,
} from "./types";
import { onePromptRolloutEnabled } from "./rollout-flags";
import type { AuthoritativeVisualContract } from "./visual-quality-contract";
import {
  compileAtomicVisualRequirements,
  isMotionOnlyStillIssue,
  reconcileGenerationIssueLedger,
} from "./visual-quality-contract";
import { withProviderCapacity, type ProviderSchedulingContext } from "./provider-capacity";

const IMAGE_QUALITY_SYSTEM_PROMPT = [
  "You are an evidence-based visual evidence extractor for production advertising imagery. You are not the final quality judge and you do not plan repairs.",
  "The image labeled CURRENT OUTPUT is the only image being judged. REFERENCE IMAGE and PREVIOUS OUTPUT images are comparison evidence only. Never report an object, text, count, UI element, score, timer, person, product, or defect as present unless it is visibly present in CURRENT OUTPUT.",
  "Every input image label defines its role and allowed use. Do not transfer observations between images. A detail visible only in a reference may define the desired target, but it is not evidence that the current output contains that detail.",
  "Evaluate only the supplied atomic requirements. For every requirement return exactly one status: satisfied, violated, unknown, or not_applicable.",
  "A violated result requires localized visible evidence from CURRENT OUTPUT and confidence of at least 0.80. Otherwise return unknown.",
  "If gaze, tiny text, occlusion, anatomy, count, or intent cannot be determined reliably, return unknown. Unknown is not a failure.",
  "Do not decide whether the whole image passes. Do not output passed, retryFromStage, repair mode, correction actions, or new requirements.",
  "For localized evidence use normalized image coordinates: top-left=(0,0), bottom-right=(1,1). Coordinates are approximate evidence regions, not claims of pixel-perfect measurement.",
  "Describe every direction from the viewer/image perspective only: viewer-left, viewer-right, up, or down. Never write ambiguous phrases such as 'character right (viewer left)'.",
  "For head or eye direction, specify a viewer-relative direction, an approximate yaw/pitch range when useful, and a normalized gaze target point. A turned head is not automatically a failed gaze; cite visible pupil/head evidence.",
  "For countable UI or product elements, report the visible count and location without inventing an expected value outside the atomic requirement.",
  "Return evaluationConfidence, the four summary scores, visible counts, wrongTextDetected, and observations[]. Every observation must include requirementId, status, confidence, evidenceSource=current_output|reference_only|unavailable, description, and normalizedRegion when visible.",
  "Output strict JSON only.",
].join("\n");

const IMAGE_QUALITY_ADJUDICATION_SYSTEM_PROMPT = [
  "You are a visual evidence adjudicator. Review only the disputed atomic requirements.",
  "CURRENT OUTPUT is the sole evidence of what exists. References define target appearance only.",
  "Do not add requirements, propose repairs, or decide the whole image's pass status.",
  "For every disputed requirement return confirmed_violation, rejected_violation, or unresolved with confidence and localized CURRENT OUTPUT evidence.",
  "A confirmed violation requires confidence >= 0.80 and must exceed the explicit contract tolerance.",
  "Output strict JSON only as {adjudications:[{requirementId,status,confidence,evidenceSource,description,normalizedRegion}]}.",
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
  deferredVideoQualityChecks?: DeferredVideoQualityCheck[];
  schedulingContext?: Omit<ProviderSchedulingContext, "targetId">;
}

export async function evaluateGeneratedImageQuality(params: BaseEvaluationParams): Promise<GenerationQualityReport> {
  const moduleNameZh = imageQualityModuleNameZh(params.purpose);
  const referenceCheckStartedAtMs = Date.now();
  const referenceGate = missingReferenceQualityReport(params);
  if (referenceGate) {
    await logOnePromptVideo("production.step.completed", {
      moduleNameZh,
      stepNameZh: "程序检查质检所需参考图是否齐全",
      executionMethod: "deterministic_program",
      durationMs: Date.now() - referenceCheckStartedAtMs,
      passed: false,
      resultZh: "参考图不齐，打回参考图选择阶段",
    });
    return referenceGate;
  }
  await logOnePromptVideo("production.step.completed", {
    moduleNameZh,
    stepNameZh: "程序检查质检所需参考图是否齐全",
    executionMethod: "deterministic_program",
    durationMs: Date.now() - referenceCheckStartedAtMs,
    passed: true,
    resultZh: "质检输入齐全",
  });
  if (!onePromptRolloutEnabled("ONE_PROMPT_VISUAL_QUALITY_EVAL")) return legacyQualityFallback(params, false);
  if (!qualityVisionEnabled()) return evaluationFailure(params, "真实图片视觉质量评估未启用或缺少 DashScope API Key。", "manual");
  const qualityPromptStartedAtMs = Date.now();
  const atomicRequirements = compileAtomicVisualRequirements({
    targetContract: params.targetContract,
    visualContract: params.visualContract,
    purpose: params.purpose,
  });
  const content: Array<Record<string, unknown>> = [{
    type: "text",
    text: [
      "Extract visible evidence from the actual generated image. Scores must come from visible media content, never prompt length.",
      "IMAGE LOCALIZATION CONTRACT: CURRENT OUTPUT is the sole subject of observation. Before writing any issue, count, text reading, or resolved/still-open decision, locate its visible evidence in CURRENT OUTPUT itself. Never use pixels from a REFERENCE IMAGE or PREVIOUS OUTPUT as evidence about what the current output contains.",
      "REFERENCE IMAGES define only the target attributes stated in their individual role notes. Pixels outside a role note are non-authoritative. If a game board, score, timer, logo, person, product, or text appears only in a reference, do not claim it appears in CURRENT OUTPUT.",
      `Purpose: ${params.purpose}`,
      `Atomic visual requirements: ${JSON.stringify(atomicRequirements)}`,
      `Reference usage notes: ${JSON.stringify(params.referenceUsageNotes)}`,
      params.visualContract ? `Applicable visual policy: ${JSON.stringify({
        mediaStage: params.visualContract.mediaStage,
        exactTextAuthority: params.visualContract.exactTextAuthority,
        allowGameUi: params.visualContract.allowGameUi,
        allowBrandText: params.visualContract.allowBrandText,
      })}` : "",
      "Return strict JSON with evaluationConfidence (0..1), identityScore, layoutScore, promptAlignmentScore, continuityScore (0..100), productInstanceCount, personInstanceCount, wrongTextDetected, and observations[].",
      "Each observations[] item must be {requirementId,status,confidence,evidenceSource,description,observedText,expectedText,normalizedRegion}. status is satisfied|violated|unknown|not_applicable. evidenceSource is current_output|reference_only|unavailable.",
      "Do not output a whole-image passed boolean. Do not output correctionActions, artifactIssues, repair mode, retry stage, or requirements absent from Atomic visual requirements.",
      "Authority rule for exact appearance and text: an approved reference image outranks planner-written descriptions. Compare the generated logo, UI, product, and character directly with the corresponding approved reference. Do not invent forbidden or required wording that is absent from the authoritative source.",
      "Game-ad rule: authorized logo text, game title, score, timer, multiplier, buttons, and contract-required UI are allowed and often required. Mark violated only for a supplied atomic requirement, not merely because text or UI exists.",
      "For a still image, motion, countdown change, jumping digits, and animation are not directly observable. Return not_applicable for motion-only requirements.",
      params.requiresExactBrandText
        ? "This is a brand/logo/UI lock asset. Set wrongTextDetected=true only when an atomic exact-text requirement is visibly violated."
        : "",
      params.assetCategory ? `Asset category: ${params.assetCategory}` : "",
    ].join("\n"),
  }, {
    type: "text",
    text: "CURRENT OUTPUT — IMAGE UNDER EVALUATION. Only pixels in the next image may support observed defects, counts, text readings, UI presence, and issue-resolution decisions.",
  }, { type: "image_url", image_url: { url: params.mediaUrl } }];
  const seenReferenceUrls = new Set<string>([params.mediaUrl, params.previousCandidateUrl ?? ""]);
  const localizedReferences = selectRoleDiverseQualityReferences(params.selectedReferenceUrls
    .map((url, index) => ({ url, usageNote: params.referenceUsageNotes[index] }))
    .filter(({ url }) => {
      if (!url || seenReferenceUrls.has(url)) return false;
      seenReferenceUrls.add(url);
      return true;
    }), qualityReferenceLimit());
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
  await logOnePromptVideo("production.step.completed", {
    moduleNameZh,
    stepNameZh: "编写本张候选图的视觉质检提示词",
    executionMethod: "program",
    durationMs: Date.now() - qualityPromptStartedAtMs,
    model: qualityVisionModel(),
    resultZh: "已写入原子视觉要求、按角色筛选的参考图和当前候选图；上一轮诊断不进入主检查",
  });
  const evaluationStartedAt = Date.now();
  try {
    await logOnePromptVideo("production.step.start", {
      moduleNameZh,
      stepNameZh: "视觉大模型检查候选图",
      executionMethod: "vision_model",
      model: qualityVisionModel(),
    });
    const raw = await callVision(content, IMAGE_QUALITY_SYSTEM_PROMPT, params.schedulingContext);
    const modelDurationMs = Date.now() - evaluationStartedAt;
    await logOnePromptVideo("production.step.completed", {
      moduleNameZh,
      stepNameZh: "视觉大模型检查候选图",
      executionMethod: "vision_model",
      model: qualityVisionModel(),
      durationMs: modelDurationMs,
      resultZh: "视觉大模型已返回质检意见",
    });
    const decisionStartedAtMs = Date.now();
    let normalized = normalizeImageQualityResponse(raw, params);
    if (normalized.adjudicationRequired) {
      await logOnePromptVideo("generation_quality.image_adjudication.start", {
        assetId: params.assetId,
        candidateId: params.candidateId,
        reason: normalized.adjudicationReason,
        model: qualityAdjudicationModel(),
      });
      const adjudicationRaw = await callVision(
        buildImageAdjudicationContent({
          mediaUrl: params.mediaUrl,
          requirements: normalized.atomicRequirements ?? atomicRequirements,
          references: localizedReferences,
          primaryReport: normalized,
        }),
        IMAGE_QUALITY_ADJUDICATION_SYSTEM_PROMPT,
        params.schedulingContext,
        qualityAdjudicationModel(),
      );
      normalized = {
        ...normalizeImageQualityResponse(
          mergeImageAdjudication(raw, adjudicationRaw, normalized.atomicRequirements ?? atomicRequirements),
          params,
        ),
        evaluationStatus: "completed",
        technicalRetryable: undefined,
        adjudicationRequired: false,
        adjudicationPerformed: true,
        adjudicationReason: normalized.adjudicationReason,
      };
      await logOnePromptVideo("generation_quality.image_adjudication.completed", {
        assetId: params.assetId,
        candidateId: params.candidateId,
        model: qualityAdjudicationModel(),
        passed: normalized.passed,
        hardFailureReasons: normalized.hardFailureReasons,
      });
    }
    const report = {
      ...normalized,
      evaluationModel: qualityVisionModel(),
      evaluationDurationMs: Date.now() - evaluationStartedAt,
    };
    await logOnePromptVideo("production.step.completed", {
      moduleNameZh,
      stepNameZh: report.passed ? "程序整理质检结果并作出通过决定" : "程序整理质检结果并制定返修方案",
      executionMethod: "program",
      durationMs: Date.now() - decisionStartedAtMs,
      passed: report.passed,
      repairMode: report.repairDecision?.mode,
      resultZh: report.passed ? "通过，进入候选结果池" : "未通过，已生成返修路径和修改要求",
    });
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

function imageQualityModuleNameZh(purpose: BaseEvaluationParams["purpose"]): string {
  if (purpose === "anchor_reference_image") return "一致性资产图片质检";
  if (purpose === "boundary_keyframe") return "关键帧图片质检";
  if (purpose === "motion_checkpoint_image") return "子分镜参考图质检";
  if (purpose === "transition_reference_frame") return "转场参考帧质检";
  return "图片质量检查";
}

function selectRoleDiverseQualityReferences(
  references: Array<{ url: string; usageNote?: string }>,
  limit: number,
): Array<{ url: string; usageNote?: string }> {
  const roleOf = (note?: string): string => {
    const value = note?.toLowerCase() ?? "";
    if (/identity|character|person|face|人物|角色|身份|脸/.test(value)) return "identity";
    if (/brand|logo|text|品牌|标志|文字/.test(value)) return "brand";
    if (/product|package|产品|包装/.test(value)) return "product";
    if (/layout|scene|camera|space|构图|场景|镜头|空间/.test(value)) return "layout";
    if (/ui|score|timer|game|界面|分数|计时|游戏/.test(value)) return "ui";
    return "other";
  };
  const selected: Array<{ url: string; usageNote?: string }> = [];
  const selectedRoles = new Set<string>();
  for (const reference of references) {
    const role = roleOf(reference.usageNote);
    if (selectedRoles.has(role)) continue;
    selected.push(reference);
    selectedRoles.add(role);
    if (selected.length >= limit) return selected;
  }
  for (const reference of references) {
    if (selected.some((item) => item.url === reference.url)) continue;
    selected.push(reference);
    if (selected.length >= limit) break;
  }
  return selected;
}

function buildImageAdjudicationContent(input: {
  mediaUrl: string;
  requirements: AtomicVisualRequirement[];
  references: Array<{ url: string; usageNote?: string }>;
  primaryReport: GenerationQualityReport;
}): Array<Record<string, unknown>> {
  const disputedRequirementIds = new Set(
    input.primaryReport.evidenceObservations
      ?.filter((item) => item.status === "violated" || item.status === "unknown")
      .map((item) => item.requirementId)
      ?? [],
  );
  const disputedRequirements = input.requirements.filter((item) =>
    disputedRequirementIds.size === 0 || disputedRequirementIds.has(item.requirementId)
  ).slice(0, 6);
  const content: Array<Record<string, unknown>> = [{
    type: "text",
    text: [
      `Disputed atomic requirements: ${JSON.stringify(disputedRequirements)}`,
      `Primary evidence observations: ${JSON.stringify(input.primaryReport.evidenceObservations ?? [])}`,
      "Review only these requirements. Do not inspect or criticize unrelated details.",
    ].join("\n"),
  }, {
    type: "text",
    text: "CURRENT OUTPUT — sole source of visible evidence.",
  }, {
    type: "image_url",
    image_url: { url: input.mediaUrl },
  }];
  for (const [index, reference] of input.references.slice(0, 2).entries()) {
    content.push({
      type: "text",
      text: `REFERENCE ${index + 1} — target comparison only. Role: ${reference.usageNote || "approved target attributes only"}`,
    });
    content.push({ type: "image_url", image_url: { url: reference.url } });
  }
  return content;
}

function mergeImageAdjudication(
  primary: unknown,
  adjudication: unknown,
  requirements: AtomicVisualRequirement[],
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...record(primary), passed: true };
  const source = record(adjudication);
  const items = Array.isArray(source.adjudications) ? source.adjudications : [];
  const requirementIds = new Set(requirements.map((item) => item.requirementId));
  merged.observations = items.flatMap((item) => {
    const value = record(item);
    const requirementId = text(value.requirementId ?? value.requirement_id);
    if (!requirementIds.has(requirementId)) return [];
    const status = text(value.status).toLowerCase();
    return [{
      requirementId,
      status: status === "confirmed_violation"
        ? "violated"
        : status === "rejected_violation"
          ? "satisfied"
          : "unknown",
      confidence: unitNumber(value.confidence) ?? 0,
      evidenceSource: text(value.evidenceSource ?? value.evidence_source).toLowerCase() === "current_output"
        ? "current_output"
        : "unavailable",
      description: text(value.description ?? value.evidence),
      normalizedRegion: normalizedBox(value.normalizedRegion ?? value.normalized_region),
    }];
  });
  return merged;
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
    const downloadStartedAtMs = Date.now();
    await download(params.mediaUrl, clipPath);
    await logOnePromptVideo("production.step.completed", {
      moduleNameZh: "视频片段质检",
      stepNameZh: "程序下载候选视频供质检",
      executionMethod: "deterministic_program",
      durationMs: Date.now() - downloadStartedAtMs,
      resultZh: "视频文件下载完成",
    });
    const probeStartedAtMs = Date.now();
    const metadata = await probeVideo(clipPath);
    await logOnePromptVideo("production.step.completed", {
      moduleNameZh: "视频片段质检",
      stepNameZh: "程序读取视频时长、尺寸和帧率",
      executionMethod: "deterministic_program",
      durationMs: Date.now() - probeStartedAtMs,
      resultZh: `${metadata.width}×${metadata.height}，${metadata.durationSeconds.toFixed(2)} 秒`,
    });
    const sampleTimes = sampleTimesForDuration(metadata.durationSeconds || params.durationSeconds, metadata.frameRate);
    const frames: Array<{ time: number; dataUrl: string }> = [];
    const frameExtractionStartedAtMs = Date.now();
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
    await logOnePromptVideo("production.step.completed", {
      moduleNameZh: "视频片段质检",
      stepNameZh: "程序抽取多帧质检样本",
      executionMethod: "deterministic_program",
      durationMs: Date.now() - frameExtractionStartedAtMs,
      resultZh: `抽取 ${frames.length} 帧`,
    });
    const qualityPromptStartedAtMs = Date.now();
    const content: Array<Record<string, unknown>> = [{
      type: "text",
      text: [
        "Evaluate the actual generated video from five ordered sampled frames and metadata. Scores must come from visible content, never prompt length.",
        `Metadata: ${JSON.stringify(metadata)}`,
        `Target contract: ${JSON.stringify(params.targetContract)}`,
        `Generation prompt: ${params.prompt.slice(0, 2400)}`,
        `Negative prompt: ${(params.negativePrompt ?? "").slice(0, 1200)}`,
        `Motion checkpoints in required order: ${JSON.stringify(params.motionCheckpoints)}`,
        `DEFERRED IMAGE ISSUES — REQUIRED VIDEO CHECK CONTRACT: ${JSON.stringify(params.deferredVideoQualityChecks ?? [])}`,
        `Reference usage notes: ${JSON.stringify(params.referenceUsageNotes)}`,
        "Return strict JSON with evaluationConfidence (0..1), identityScore, layoutScore, promptAlignmentScore, continuityScore, firstFrameConsistencyScore, checkpointOrderScore, singleTakeScore (0..100), productInstanceCount, personInstanceCount, wrongTextDetected, artifactIssues[], metadataIssues[], correctionActions[], contractConflicts[], deferredVideoIssueResults[], passed, retryInstruction, retryFromStage stage2b|stage3|generation.",
        "For every item in DEFERRED IMAGE ISSUES, return exactly one deferredVideoIssueResults item with the same sourceIssueId and status resolved|open|unverifiable. resolved requires visible evidence in the sampled video frames; open means the required motion/state is visibly absent or wrong; unverifiable means the samples do not contain enough evidence. Include concise evidence and the observed timeRange when available. Never silently omit a deferred check.",
        "Return at most 3 unique correctionActions, limited to the highest-impact confirmed deltas for this candidate only; do not repeat diagnosis history or restate the unchanged base contract. Each correctionActions[] item must specify {region, element, observed, target, instruction, evidenceStatus, confidence, normalizedRegion, targetPoint, executionParameters, tolerance, priority, sourceConstraint, preserve[]}. Make each action spatially and temporally precise and directly renderable in the next attempt. Include exact state/value/count/timing/viewer-relative direction/pose when supported by the contract, and state which successful content must remain unchanged.",
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
    const boundaryUrls = new Set([params.startFrameUrl, params.endFrameUrl].map((url) => url.trim()).filter(Boolean));
    const additionalReferences = params.selectedReferenceUrls
      .filter((url) => !boundaryUrls.has(url.trim()))
      .slice(0, 3);
    for (const [index, url] of additionalReferences.entries()) {
      content.push({ type: "text", text: `Identity/layout reference ${index + 1}: ${params.referenceUsageNotes[index] ?? "approved reference"}` });
      content.push({ type: "image_url", image_url: { url } });
    }
    await logOnePromptVideo("production.step.completed", {
      moduleNameZh: "视频片段质检",
      stepNameZh: "编写候选视频的多帧质检提示词",
      executionMethod: "program",
      durationMs: Date.now() - qualityPromptStartedAtMs,
      model: qualityVisionModel(),
      resultZh: "已写入动作检查点、首尾帧、参考图和抽样画面",
    });
    await logOnePromptVideo("production.step.start", {
      moduleNameZh: "视频片段质检",
      stepNameZh: "视觉大模型检查候选视频",
      executionMethod: "vision_model",
      model: qualityVisionModel(),
    });
    const modelStartedAtMs = Date.now();
    const raw = await callVision(content, VIDEO_QUALITY_SYSTEM_PROMPT, params.schedulingContext);
    await logOnePromptVideo("production.step.completed", {
      moduleNameZh: "视频片段质检",
      stepNameZh: "视觉大模型检查候选视频",
      executionMethod: "vision_model",
      model: qualityVisionModel(),
      durationMs: Date.now() - modelStartedAtMs,
      resultZh: "视觉大模型已返回多帧质检意见",
    });
    const normalizeStartedAtMs = Date.now();
    const report = normalizeVideoQualityResponse(raw, params, metadata);
    await logOnePromptVideo("production.step.completed", {
      moduleNameZh: "视频片段质检",
      stepNameZh: "程序整理视频质检结果",
      executionMethod: "program",
      durationMs: Date.now() - normalizeStartedAtMs,
      passed: report.passed,
      resultZh: report.passed ? "模型建议通过（视频最终仍由人工审核）" : "模型发现问题（作为人工审核建议）",
    });
    return report;
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
  audioStreamPresent: boolean;
  audioCodec?: string;
  audioSampleRate?: number;
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
  const inspectionStartedAtMs = Date.now();
  try {
    await download(mediaUrl, clipPath);
    const metadata = await probeVideo(clipPath);
    if (
      metadata.durationSeconds <= 0
      || metadata.width <= 0
      || metadata.height <= 0
      || metadata.frameRate <= 0
    ) {
      await logOnePromptVideo("production.step.completed", {
        moduleNameZh: "视频片段质检",
        stepNameZh: "程序硬检查视频文件可下载、可读取、可解码",
        executionMethod: "deterministic_program",
        durationMs: Date.now() - inspectionStartedAtMs,
        passed: false,
        resultZh: "视频元数据无效，打回重新生成",
      });
      return { valid: false, ...metadata, errorMessage: "视频时长、尺寸或帧率元数据无效。" };
    }
    await extractFrame(clipPath, framePath, Math.min(metadata.durationSeconds * 0.5, Math.max(0, metadata.durationSeconds - 0.08)));
    const frame = await readFile(framePath);
    if (frame.byteLength < 1024) {
      await logOnePromptVideo("production.step.completed", {
        moduleNameZh: "视频片段质检",
        stepNameZh: "程序硬检查视频文件可下载、可读取、可解码",
        executionMethod: "deterministic_program",
        durationMs: Date.now() - inspectionStartedAtMs,
        passed: false,
        resultZh: "检测帧为空或损坏，打回重新生成",
      });
      return { valid: false, ...metadata, errorMessage: "视频可解码，但抽取的检测帧为空或损坏。" };
    }
    await logOnePromptVideo("production.step.completed", {
      moduleNameZh: "视频片段质检",
      stepNameZh: "程序硬检查视频文件可下载、可读取、可解码",
      executionMethod: "deterministic_program",
      durationMs: Date.now() - inspectionStartedAtMs,
      passed: true,
      resultZh: `${metadata.width}×${metadata.height}，${metadata.durationSeconds.toFixed(2)} 秒，可正常解码，${metadata.audioStreamPresent ? `音轨 ${metadata.audioCodec || "unknown"}/${metadata.audioSampleRate || 0}Hz` : "无音轨"}`,
    });
    return { valid: true, ...metadata };
  } catch (error) {
    await logOnePromptVideo("production.step.completed", {
      moduleNameZh: "视频片段质检",
      stepNameZh: "程序硬检查视频文件可下载、可读取、可解码",
      executionMethod: "deterministic_program",
      durationMs: Date.now() - inspectionStartedAtMs,
      passed: false,
      resultZh: "程序硬检查失败，打回重新生成",
      message: error instanceof Error ? error.message : String(error),
    }, "error");
    return {
      valid: false,
      durationSeconds: 0,
      width: 0,
      height: 0,
      frameRate: 0,
      audioStreamPresent: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await removeWorkDir(workDir);
  }
}

export function normalizeImageQualityResponse(value: unknown, params: BaseEvaluationParams): GenerationQualityReport {
  let report = normalizeReport(value, params);
  // Stage 2B owns shot/motion decomposition. It cannot repair a generated
  // consistency asset (logo, character sheet, product lock, and so on), so a
  // visible defect in such an image must stay in the generation retry loop.
  if (!report.passed && params.purpose === "anchor_reference_image" && report.retryFromStage === "stage2b") {
    report = { ...report, retryFromStage: "generation" };
  }
  return {
    ...report,
    repairDecision: report.passed ? undefined : decideImageRepair(report, params),
  };
}

function decideImageRepair(
  report: GenerationQualityReport,
  params: BaseEvaluationParams,
): ImageRepairDecision {
  const actions = (report.correctionActions ?? []).filter((action) =>
    action.evidenceStatus !== "uncertain" && action.priority !== "recommended"
  );
  const editRegions = actions.flatMap((action) => action.normalizedRegion ? [action.normalizedRegion] : []);
  const preserve = uniqueStrings(actions.flatMap((action) => action.preserve ?? [])).slice(0, 20);
  const issueText = [
    ...report.artifactIssues,
    ...(report.hardFailureReasons ?? []),
    ...actions.flatMap((action) => [action.region, action.element, action.observed, action.target, action.instruction]),
  ].join(" ");
  const scores = [
    report.identityScore,
    report.layoutScore,
    report.promptAlignmentScore,
    report.continuityScore,
  ].filter((score): score is number => typeof score === "number");
  const minimumScore = scores.length === 4 ? Math.min(...scores) : null;
  const globalStructuralFailure =
    /wrong (?:scene|subject count|person count|product count)|extra (?:person|people|character|subject|product)|multiple (?:people|characters|subjects)|missing (?:main )?(?:person|character|product|scene)|entire (?:scene|composition|layout)|identity (?:failure|mismatch)|unrelated (?:background|scene)|scene replacement|background contamination|asset isolation|全局|整体|错误场景|主体数量|人物数量|产品数量|额外人物|额外角色|缺少主体|身份严重|背景污染|资产隔离/i.test(issueText);
  const isolatedAssetContamination = params.purpose === "anchor_reference_image"
    && /background|scenery|environment|poster|ui|title|extra character|second character|multiple (?:people|characters|subjects)|场景|背景|海报|界面|标题|其他角色|多个角色/i.test(issueText);
  const severeScoreFailure = minimumScore != null && minimumScore < 55;
  const incompleteEvaluation =
    report.evaluationStatus === "partial"
    || report.evaluationStatus === "technical_failed"
    || report.evaluationStatus === "unavailable"
    || report.contentBased === false;
  const regressedIssues = (report.issueLedger ?? []).filter((issue) =>
    issue.status === "regressed" && issue.applicableStage === "static_image"
  );
  const hardRegressedIssue = regressedIssues.some((issue) => issue.severity === "hard");
  const repeatedlyRegressedIssue = regressedIssues.some((issue) => issue.occurrenceCount >= 3);

  let mode: ImageRepairMode;
  let correctionScope: ImageCorrectionScope;
  let baselineUsable = false;
  let reasonCodes: string[];
  let requiredContextSections: ImageRepairContextSection[];
  let confidence: number;

  if (report.evaluationStatus === "reference_missing" || report.retryFromStage === "reference_selector") {
    mode = "reference_reselect";
    correctionScope = "global";
    reasonCodes = ["required_reference_missing"];
    requiredContextSections = ["minimal_contract", "approved_references"];
    confidence = 1;
  } else if (incompleteEvaluation) {
    mode = "reevaluate_only";
    correctionScope = "global";
    reasonCodes = ["quality_evaluation_incomplete"];
    requiredContextSections = [];
    confidence = 1;
  } else if (report.contractConflictsVerified || report.retryFromStage === "stage3") {
    mode = "contract_recompile";
    correctionScope = "global";
    reasonCodes = ["verified_contract_conflict"];
    requiredContextSections = ["full_original_prompt", "minimal_contract"];
    confidence = 1;
  } else if (report.retryFromStage === "stage2b") {
    mode = "storyboard_replan";
    correctionScope = "global";
    reasonCodes = ["structural_or_unreachable_frame_contract"];
    requiredContextSections = ["narrative_boundary", "camera_graph", "full_original_prompt"];
    confidence = 0.98;
  } else if (report.retryFromStage === "manual") {
    mode = "manual_review";
    correctionScope = "global";
    reasonCodes = ["automatic_repair_not_reliable"];
    requiredContextSections = ["minimal_contract"];
    confidence = 0.95;
  } else if (severeScoreFailure || globalStructuralFailure || isolatedAssetContamination || hardRegressedIssue || repeatedlyRegressedIssue) {
    mode = "full_regenerate";
    correctionScope = "global";
    reasonCodes = uniqueStrings([
      severeScoreFailure ? "severe_score_failure" : "",
      globalStructuralFailure ? "global_structure_failure" : "",
      isolatedAssetContamination ? "isolated_asset_contamination" : "",
      hardRegressedIssue ? "hard_issue_regressed" : "",
      repeatedlyRegressedIssue ? "issue_regressed_multiple_times" : "",
    ]);
    requiredContextSections = [
      "minimal_contract",
      "asset_locks",
      ...(params.purpose === "boundary_keyframe" ? ["narrative_boundary", "camera_graph"] as ImageRepairContextSection[] : []),
      "approved_references",
      "full_original_prompt",
    ];
    confidence = 0.95;
  } else {
    const localEligible =
      minimumScore != null
      && minimumScore >= 75
      && actions.length >= 1
      && actions.length <= 3
      && editRegions.length === actions.length
      && report.wrongTextDetected !== true
      && regressedIssues.length === 0;
    if (localEligible) {
      mode = "local_edit";
      correctionScope = "local";
      baselineUsable = true;
      reasonCodes = ["bounded_confirmed_corrections", "strong_baseline_scores"];
      requiredContextSections = ["minimal_contract", "approved_references"];
      confidence = 0.92;
    } else {
      mode = "guided_regenerate";
      correctionScope = editRegions.length ? "regional" : "global";
      baselineUsable = minimumScore == null || minimumScore >= 55;
      reasonCodes = uniqueStrings([
        actions.length === 0 ? "no_bounded_correction_actions" : "",
        editRegions.length !== actions.length ? "corrections_not_fully_localized" : "",
        minimumScore != null && minimumScore < 75 ? "baseline_scores_below_local_edit_threshold" : "",
        report.wrongTextDetected ? "locked_text_requires_rerender" : "",
        regressedIssues.length ? "regressed_issue_requires_broader_regeneration" : "",
      ]);
      requiredContextSections = [
        "minimal_contract",
        "asset_locks",
        ...(params.purpose === "boundary_keyframe" ? ["narrative_boundary", "camera_graph"] as ImageRepairContextSection[] : []),
        "approved_references",
      ];
      confidence = 0.85;
    }
  }

  return {
    mode,
    reasonCodes: uniqueStrings([...reasonCodes, ...(report.suggestedRepairReasonCodes ?? []).map((code) => `model:${code}`)]),
    baselineUsable,
    baselineCandidateId: baselineUsable ? report.candidateId : undefined,
    correctionScope,
    editRegions,
    preserve,
    requiredContextSections,
    confidence: Math.min(confidence, report.evaluationConfidence ?? 1),
    decidedBy: "deterministic_router",
    suggestedMode: report.suggestedRepairMode,
  };
}

export function normalizeVideoQualityResponse(value: unknown, params: BaseEvaluationParams, metadata?: { durationSeconds: number; width: number; height: number; frameRate: number }): GenerationQualityReport {
  const report = normalizeReport(value, params);
  const source = record(value);
  const singleTakeScore = optionalScore(source.singleTakeScore ?? source.single_take_score);
  const firstFrameConsistencyScore = optionalScore(source.firstFrameConsistencyScore ?? source.first_frame_consistency_score);
  const checkpointOrderScore = optionalScore(source.checkpointOrderScore ?? source.checkpoint_order_score);
  const metadataIssues = strings(source.metadataIssues ?? source.metadata_issues);
  const deferredVideoIssueResults = normalizeDeferredVideoIssueResults(
    source.deferredVideoIssueResults ?? source.deferred_video_issue_results,
    params.deferredVideoQualityChecks ?? [],
  );
  const unresolvedDeferredChecks = deferredVideoIssueResults.filter((item) => item.status === "open");
  const unverifiableDeferredChecks = deferredVideoIssueResults.filter((item) => item.status === "unverifiable");
  const resolvedDeferredVideoIssueIds = deferredVideoIssueResults.filter((item) => item.status === "resolved").map((item) => item.sourceIssueId);
  const openDeferredVideoIssueIds = unresolvedDeferredChecks.map((item) => item.sourceIssueId);
  const videoScoresComplete = singleTakeScore != null && firstFrameConsistencyScore != null && checkpointOrderScore != null;
  const passed = report.passed
    && videoScoresComplete
    && singleTakeScore >= 65
    && firstFrameConsistencyScore >= 65
    && checkpointOrderScore >= 60
    && metadataIssues.length === 0
    && unresolvedDeferredChecks.length === 0
    && unverifiableDeferredChecks.length === 0
    && (!metadata || metadata.durationSeconds > 0);
  const needsReEvaluation = report.evaluationStatus === "partial" || !videoScoresComplete || unverifiableDeferredChecks.length > 0;
  const deferredRetryInstruction = unresolvedDeferredChecks.length
    ? "Resolve these image-to-video handoff checks: " + unresolvedDeferredChecks.map((result) => {
        const contract = params.deferredVideoQualityChecks?.find((item) => item.sourceIssueId === result.sourceIssueId);
        return `[${result.sourceIssueId}] ${contract?.requiredVideoCheck ?? "deferred motion requirement"}${result.evidence ? `; observed: ${result.evidence}` : ""}`;
      }).join("; ")
    : "";
  const deferredLedgerEntries = deferredVideoIssueResults.map((result) => {
    const contract = params.deferredVideoQualityChecks?.find((item) => item.sourceIssueId === result.sourceIssueId);
    return {
      issueId: result.sourceIssueId,
      fingerprint: `deferred_video:${result.sourceIssueId}`,
      category: contract?.category ?? "artifact",
      region: contract?.region,
      summary: result.evidence || contract?.requiredVideoCheck || "Deferred image issue requires video verification",
      target: contract?.expectedState,
      severity: result.status === "unverifiable" ? "advisory" as const : "soft" as const,
      applicableStage: "video" as const,
      status: result.status === "resolved" ? "resolved" as const : "open" as const,
      firstSeenCandidateNo: params.candidateNo,
      lastSeenCandidateNo: params.candidateNo,
      occurrenceCount: 1,
    };
  });
  const issueLedger = [...new Map([
    ...(report.issueLedger ?? []),
    ...deferredLedgerEntries,
  ].map((item) => [item.issueId, item])).values()];
  return {
    ...report,
    evaluationStatus: needsReEvaluation ? "partial" : report.evaluationStatus,
    technicalRetryable: needsReEvaluation ? true : report.technicalRetryable,
    singleTakeScore,
    firstFrameConsistencyScore,
    checkpointOrderScore,
    metadataIssues,
    deferredVideoIssueResults,
    resolvedDeferredVideoIssueIds,
    openDeferredVideoIssueIds,
    issueLedger,
    resolvedIssueIds: uniqueStrings([...(report.resolvedIssueIds ?? []), ...resolvedDeferredVideoIssueIds]),
    softSuggestions: uniqueStrings([
      ...(report.softSuggestions ?? []),
      ...deferredLedgerEntries.filter((item) => item.status === "open").map((item) => item.summary),
    ]),
    passed,
    originalPassed: passed,
    qualityDecision: needsReEvaluation ? "review" : unresolvedDeferredChecks.length ? "retry" : report.qualityDecision,
    retryFromStage: needsReEvaluation ? "manual" : report.retryFromStage,
    retryInstruction: needsReEvaluation
      ? "Retry visual quality evaluation for this existing candidate because one or more required video metrics or deferred issue results were not returned. Do not regenerate the media."
      : deferredRetryInstruction || report.retryInstruction || (!passed ? `Improve the same-take result using the observed scores: first-frame ${firstFrameConsistencyScore}, checkpoint order ${checkpointOrderScore}, single-take ${singleTakeScore}.` : undefined),
    artifactIssues: uniqueStrings([
      ...report.artifactIssues,
      ...metadataIssues,
      ...unresolvedDeferredChecks.map((result) => {
        const contract = params.deferredVideoQualityChecks?.find((item) => item.sourceIssueId === result.sourceIssueId);
        return `Deferred image issue remains open [${result.sourceIssueId}]: ${contract?.requiredVideoCheck ?? result.evidence ?? "required video evidence missing"}`;
      }),
      ...(metadata && metadata.durationSeconds <= 0 ? ["invalid video duration metadata"] : []),
    ]),
  };
}

function normalizeDeferredVideoIssueResults(
  value: unknown,
  checks: DeferredVideoQualityCheck[],
): DeferredVideoIssueResult[] {
  if (!checks.length) return [];
  const rawResults = Array.isArray(value) ? value.map(record) : [];
  return checks.map((check) => {
    const source = rawResults.find((item) =>
      text(item.sourceIssueId ?? item.source_issue_id) === check.sourceIssueId
    );
    const rawStatus = text(source?.status).toLowerCase();
    const status: DeferredVideoIssueResult["status"] = rawStatus === "resolved"
      ? "resolved"
      : rawStatus === "open"
        ? "open"
        : "unverifiable";
    return {
      sourceIssueId: check.sourceIssueId,
      status,
      evidence: text(source?.evidence) || undefined,
      timeRange: text(source?.timeRange ?? source?.time_range) || undefined,
    };
  });
}

export function generationQualityCompositeScore(report: GenerationQualityReport): number | null {
  const values = [report.identityScore, report.layoutScore, report.promptAlignmentScore, report.continuityScore];
  if (typeof report.singleTakeScore === "number") values.push(report.singleTakeScore);
  if (typeof report.firstFrameConsistencyScore === "number") values.push(report.firstFrameConsistencyScore);
  if (typeof report.checkpointOrderScore === "number") values.push(report.checkpointOrderScore);
  const scoredValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!scoredValues.length) return null;
  return Math.round((scoredValues.reduce((sum, value) => sum + value, 0) / scoredValues.length) * 1000) / 1000;
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
  const modelDecisionProvided = typeof source.passed === "boolean";
  const originalPassed = source.passed === true;
  const atomicRequirements = compileAtomicVisualRequirements({
    targetContract: params.targetContract,
    visualContract: params.visualContract,
    purpose: params.purpose,
  });
  const evidenceObservations = normalizeEvidenceObservations(
    source.observations ?? source.evidenceObservations ?? source.evidence_observations,
    atomicRequirements,
  );
  const suggestedRepairMode = imageRepairMode(source.suggestedRepairMode ?? source.suggested_repair_mode);
  const suggestedCorrectionScope = imageCorrectionScope(source.correctionScope ?? source.correction_scope);
  const suggestedBaselineUsable = typeof (source.baselineUsable ?? source.baseline_usable) === "boolean"
    ? Boolean(source.baselineUsable ?? source.baseline_usable)
    : undefined;
  const suggestedRepairReasonCodes = strings(source.repairReasonCodes ?? source.repair_reason_codes);
  const evaluationConfidence = optionalUnitScore(source.evaluationConfidence ?? source.evaluation_confidence);
  const identityScore = optionalScore(source.identityScore ?? source.identity_score);
  const layoutScore = optionalScore(source.layoutScore ?? source.layout_score);
  const promptAlignmentScore = optionalScore(source.promptAlignmentScore ?? source.prompt_alignment_score);
  const continuityScore = optionalScore(source.continuityScore ?? source.continuity_score);
  const scoreSetComplete = identityScore != null && layoutScore != null && promptAlignmentScore != null && continuityScore != null;
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
  const evidenceCorrectionActions = correctionActionsFromEvidence(evidenceObservations, atomicRequirements);
  const evidenceArtifactIssues = evidenceIssues(evidenceObservations, atomicRequirements);
  const rawCorrectionActions = evidenceObservations.length
    ? evidenceCorrectionActions
    : normalizeCorrectionActions(source.correctionActions ?? source.correction_actions);
  const rawArtifactIssues = evidenceObservations.length
    ? evidenceArtifactIssues
    : strings(source.artifactIssues ?? source.artifact_issues);
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
  const scoreGatePassed = scoreSetComplete && identityScore >= 65 && layoutScore >= 60 && promptAlignmentScore >= 65 && continuityScore >= 60;
  // The vision model's boolean is advisory. For exact brand/logo lock assets,
  // use explicit deterministic gates so minor decorative/layout comments do
  // not veto an otherwise strong, usable logo. Exact-text or person leakage
  // remains a hard failure.
  const brandVisualGatePassed = scoreSetComplete
    && identityScore >= 85
    && layoutScore >= 75
    && promptAlignmentScore >= 75
    && continuityScore >= 70
    && !wrongTextDetected
    && personInstanceCount === 0;
  const exactTextHardGate = params.requiresExactBrandText
    || params.visualContract?.exactTextAuthority === "approved_reference"
    || params.visualContract?.exactTextAuthority === "structured_contract";
  const confirmedHardRequirementViolations = evidenceObservations.flatMap((observation) => {
    const requirement = atomicRequirements.find((item) => item.requirementId === observation.requirementId);
    if (
      !requirement
      || requirement.severity !== "hard"
      || observation.status !== "violated"
      || observation.confidence < 0.8
      || observation.evidenceSource !== "current_output"
    ) return [];
    return [`requirement ${requirement.requirementId} visibly violated: ${observation.description || requirement.target}`];
  });
  const confirmedLegacyViolations = evidenceObservations.length
    ? []
    : correctionActions.flatMap((action) => {
        if (
          action.evidenceStatus === "uncertain"
          || action.priority === "recommended"
          || (action.confidence ?? 1) < 0.8
          || !action.normalizedRegion
        ) return [];
        return [`legacy localized contract evidence: ${action.observed}`];
      });
  const hardFailureReasons = uniqueStrings([
    ...contractConflicts,
    ...confirmedHardRequirementViolations,
    ...confirmedLegacyViolations,
    identityScore != null && identityScore < 65 ? `identity score ${identityScore} is below 65` : "",
    layoutScore != null && layoutScore < 60 ? `layout score ${layoutScore} is below 60` : "",
    promptAlignmentScore != null && promptAlignmentScore < 65 ? `prompt alignment score ${promptAlignmentScore} is below 65` : "",
    continuityScore != null && continuityScore < 60 ? `continuity score ${continuityScore} is below 60` : "",
    wrongTextDetected && exactTextHardGate ? "authoritative locked text is visibly wrong" : "",
    params.requiresExactBrandText && !brandVisualGatePassed ? "isolated brand asset failed its deterministic identity/layout/text gate" : "",
  ]);
  const lowConfidence = evaluationConfidence != null && evaluationConfidence < 0.7;
  const unsupportedModelVeto =
    modelDecisionProvided
    && !originalPassed
    && scoreGatePassed
    && !lowConfidence
    && hardFailureReasons.length === 0;
  const highScoreEvidenceConflict =
    confirmedHardRequirementViolations.length > 0
    && identityScore != null && identityScore >= 85
    && layoutScore != null && layoutScore >= 80
    && promptAlignmentScore != null && promptAlignmentScore >= 80
    && continuityScore != null && continuityScore >= 80;
  const adjudicationRequired = unsupportedModelVeto || highScoreEvidenceConflict;
  // The model supplies evidence; the deterministic policy owns the decision.
  // A legacy whole-image veto with no supported hard evidence is adjudicated
  // once instead of immediately triggering paid media regeneration.
  const passed =
    !unsupportedModelVeto
    && scoreSetComplete
    && !lowConfidence
    && scoreGatePassed
    && hardFailureReasons.length === 0;
  const issueLedger = reconcileGenerationIssueLedger({
    previous: params.previousQualityReport,
    candidateNo: params.candidateNo,
    artifactIssues: [...artifactIssues, ...invalidForStageIssues],
    correctionActions,
    evidenceObservations,
    invalidIssueTexts: invalidForStageIssues,
  });
  const openHardIssueIds = issueLedger.filter((item) => (item.status === "open" || item.status === "regressed") && item.severity === "hard" && item.applicableStage === params.visualContract?.mediaStage).map((item) => item.issueId);
  const resolvedIssueIds = issueLedger.filter((item) => item.status === "resolved").map((item) => item.issueId);
  const softSuggestions = uniqueStrings([
    ...issueLedger
      .filter((item) => (item.status === "open" || item.status === "regressed") && item.severity !== "hard")
      .map((item) => item.summary),
    ...evidenceObservations.flatMap((observation) => {
      if (observation.status !== "unknown" && !(observation.status === "violated" && observation.confidence < 0.8)) return [];
      const requirement = atomicRequirements.find((item) => item.requirementId === observation.requirementId);
      return requirement ? [`Unresolved evidence for ${requirement.requirementId}: ${requirement.target}`] : [];
    }),
  ]);
  const qualityDecision = !scoreSetComplete || lowConfidence || adjudicationRequired
    ? "review" as const
    : contractConflictsVerified
    ? "blocked" as const
    : passed
      ? softSuggestions.length === 0 ? "pass" as const : "recommended" as const
      : "retry" as const;
  const retryFromStage = !scoreSetComplete || lowConfidence || adjudicationRequired
    ? "manual" as const
    : contractConflictsVerified
    ? "stage3" as const
    : suspectedContractConflicts.length
      ? "generation" as const
      : retryStage(source.retryFromStage ?? source.retry_from_stage);
  const suppliedRetryInstruction = suspectedContractConflicts.length && !contractConflictsVerified
    ? ""
    : text(source.retryInstruction ?? source.retry_instruction);
  const expectedAnchorIds = contractAnchorIds(params.targetContract);
  const selectedReferenceCount = params.selectedReferenceUrls.filter((url) => Boolean(url?.trim())).length;
  const referenceComparable = expectedAnchorIds.length === 0 || selectedReferenceCount > 0;
  const referenceText = `${expectedAnchorIds.join(" ")} ${params.referenceUsageNotes.join(" ")}`.toLowerCase();
  const comparableChecks = uniqueStrings([
    selectedReferenceCount > 0 ? "layout" : "",
    expectedAnchorIds.length > 0 && selectedReferenceCount > 0 ? "identity" : "",
    /product|logo|brand|ui|产品|品牌|界面/.test(referenceText) && selectedReferenceCount > 0 ? "product" : "",
  ]);
  return {
    policyVersion: "quality-policy-v4",
    evaluationStatus: adjudicationRequired
      ? "adjudication_required"
      : scoreSetComplete && !lowConfidence ? "completed" : "partial",
    technicalRetryable: adjudicationRequired ? false : scoreSetComplete && !lowConfidence ? undefined : true,
    evaluationConfidence: evaluationConfidence ?? undefined,
    suggestedRepairMode,
    suggestedCorrectionScope,
    suggestedBaselineUsable,
    suggestedRepairReasonCodes,
    referenceComparable,
    identityScoreApplicable: expectedAnchorIds.length > 0 && selectedReferenceCount > 0,
    productConsistencyScoreApplicable: comparableChecks.includes("product"),
    expectedAnchorIds,
    selectedReferenceCount,
    missingReferenceAnchorIds: [],
    comparableChecks,
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
    atomicRequirements,
    evidenceObservations,
    adjudicationRequired,
    adjudicationReason: unsupportedModelVeto
      ? "legacy_model_veto_without_supported_hard_evidence"
      : highScoreEvidenceConflict
        ? "high_scores_conflict_with_confirmed_hard_evidence"
        : undefined,
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
    originalPassed: modelDecisionProvided ? originalPassed : undefined,
    retryInstruction: adjudicationRequired
      ? "Re-adjudicate the disputed visual evidence for this existing candidate. Do not regenerate the media."
      : !scoreSetComplete || lowConfidence
      ? "Retry visual quality evaluation for this existing candidate because required evidence was incomplete or evaluator confidence was low. Do not regenerate the media."
      : !passed || correctionActions.length > 0
      ? concreteRetryInstruction({ correctionActions, contractConflicts, suppliedRetryInstruction, identityScore, layoutScore, promptAlignmentScore, continuityScore })
      : suppliedRetryInstruction || undefined,
    retryFromStage,
    contentBased: true,
  };
}

function normalizeEvidenceObservations(
  value: unknown,
  requirements: AtomicVisualRequirement[],
): VisualEvidenceObservation[] {
  if (!Array.isArray(value)) return [];
  const requirementIds = new Set(requirements.map((item) => item.requirementId));
  const observations = new Map<string, VisualEvidenceObservation>();
  for (const item of value) {
    const source = record(item);
    const requirementId = text(source.requirementId ?? source.requirement_id);
    if (!requirementId || !requirementIds.has(requirementId)) continue;
    const statusValue = text(source.status).toLowerCase();
    const status: VisualEvidenceObservation["status"] =
      statusValue === "satisfied"
      || statusValue === "violated"
      || statusValue === "not_applicable"
        ? statusValue
        : "unknown";
    const evidenceValue = text(source.evidenceSource ?? source.evidence_source).toLowerCase();
    const evidenceSource: VisualEvidenceObservation["evidenceSource"] =
      evidenceValue === "current_output" || evidenceValue === "reference_only"
        ? evidenceValue
        : "unavailable";
    const confidence = unitNumber(source.confidence) ?? 0;
    observations.set(requirementId, {
      requirementId,
      status,
      confidence,
      evidenceSource,
      description: text(source.description ?? source.evidence ?? source.observed) || undefined,
      observedText: text(source.observedText ?? source.observed_text) || undefined,
      expectedText: text(source.expectedText ?? source.expected_text) || undefined,
      normalizedRegion: normalizedBox(source.normalizedRegion ?? source.normalized_region ?? source.region),
    });
  }
  // A missing observation is explicitly unknown, not silently satisfied.
  return requirements.map((requirement) => observations.get(requirement.requirementId) ?? {
    requirementId: requirement.requirementId,
    status: "unknown",
    confidence: 0,
    evidenceSource: "unavailable",
    description: "Evaluator did not return evidence for this atomic requirement.",
  });
}

function evidenceIssues(
  observations: VisualEvidenceObservation[],
  requirements: AtomicVisualRequirement[],
): string[] {
  return observations.flatMap((observation) => {
    if (
      observation.status !== "violated"
      || observation.confidence < 0.8
      || observation.evidenceSource !== "current_output"
    ) return [];
    const requirement = requirements.find((item) => item.requirementId === observation.requirementId);
    if (!requirement) return [];
    return [`[${requirement.requirementId}] ${observation.description || `Current output does not satisfy: ${requirement.target}`}`];
  });
}

function correctionActionsFromEvidence(
  observations: VisualEvidenceObservation[],
  requirements: AtomicVisualRequirement[],
): GenerationCorrectionAction[] {
  return observations.flatMap((observation) => {
    if (
      observation.status !== "violated"
      || observation.confidence < 0.8
      || observation.evidenceSource !== "current_output"
    ) return [];
    const requirement = requirements.find((item) => item.requirementId === observation.requirementId);
    if (!requirement) return [];
    const region = observation.normalizedRegion ? requirement.domain : "specified visual region";
    return [{
      region,
      element: requirement.domain,
      observed: observation.description || "Current output visibly violates the atomic requirement.",
      target: requirement.target,
      instruction: `Render the current output so that it satisfies requirement ${requirement.requirementId}: ${requirement.target}`,
      evidenceStatus: "confirmed" as const,
      confidence: observation.confidence,
      normalizedRegion: observation.normalizedRegion,
      tolerance: requirement.tolerance,
      priority: requirement.severity === "hard" ? "required" as const : "recommended" as const,
      sourceConstraint: `requirement:${requirement.requirementId}`,
      preserve: [],
    }];
  }).slice(0, 3);
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
  identityScore: number | null;
  layoutScore: number | null;
  promptAlignmentScore: number | null;
  continuityScore: number | null;
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
    policyVersion: "quality-policy-v4",
    evaluationStatus: "technical_failed",
    technicalError: issue,
    technicalRetryable: true,
    assetId: params.assetId,
    candidateId: params.candidateId,
    candidateNo: params.candidateNo,
    mediaUrl: params.mediaUrl,
    identityScore: null,
    layoutScore: null,
    promptAlignmentScore: null,
    continuityScore: null,
    artifactIssues: [issue],
    passed: false,
    originalPassed: false,
    contentBased: false,
    retryInstruction: "Retry visual quality evaluation for this existing candidate. Do not regenerate the media.",
    retryFromStage,
    repairDecision: params.purpose === "video_segment" || params.purpose === "generated_bridge"
      ? undefined
      : {
          mode: "reevaluate_only",
          reasonCodes: ["quality_evaluation_technical_failure"],
          baselineUsable: false,
          correctionScope: "global",
          editRegions: [],
          preserve: [],
          requiredContextSections: [],
          confidence: 1,
          decidedBy: "deterministic_router",
        },
  };
}

function contractAnchorIds(targetContract: Record<string, unknown>): string[] {
  const source =
    targetContract.effectiveRequiredAnchorIds
    ?? targetContract.effective_required_anchor_ids
    ?? targetContract.requiredAnchorIds
    ?? targetContract.required_anchor_ids
    ?? targetContract.usesConsistencyAnchors
    ?? targetContract.uses_consistency_anchors;
  return [...new Set(strings(source))];
}

function missingReferenceQualityReport(params: BaseEvaluationParams): GenerationQualityReport | undefined {
  if (params.purpose === "anchor_reference_image") return undefined;
  const expectedAnchorIds = contractAnchorIds(params.targetContract);
  if (expectedAnchorIds.length === 0 || params.selectedReferenceUrls.some((url) => Boolean(url?.trim()))) return undefined;
  const issue = `缺少资产合同要求的可比参考图：${expectedAnchorIds.join("、")}`;
  return {
    policyVersion: "quality-policy-v4",
    evaluationStatus: "reference_missing",
    technicalRetryable: false,
    referenceComparable: false,
    identityScoreApplicable: false,
    productConsistencyScoreApplicable: false,
    expectedAnchorIds,
    selectedReferenceCount: 0,
    missingReferenceAnchorIds: expectedAnchorIds,
    comparableChecks: [],
    assetId: params.assetId,
    candidateId: params.candidateId,
    candidateNo: params.candidateNo,
    mediaUrl: params.mediaUrl,
    identityScore: null,
    layoutScore: null,
    promptAlignmentScore: null,
    continuityScore: null,
    artifactIssues: [issue],
    passed: false,
    originalPassed: false,
    contentBased: false,
    qualityDecision: "blocked",
    retryInstruction: "先回到资产参考选择，补齐合同要求的已批准参考图，再对当前候选重新质检；不要重新生成媒体。",
    retryFromStage: "reference_selector",
    repairDecision: {
      mode: "reference_reselect",
      reasonCodes: ["required_reference_missing"],
      baselineUsable: false,
      correctionScope: "global",
      editRegions: [],
      preserve: [],
      requiredContextSections: ["minimal_contract", "approved_references"],
      confidence: 1,
      decidedBy: "deterministic_router",
    },
  };
}

export function isReferenceMissingQualityEvaluation(report: GenerationQualityReport | null | undefined): boolean {
  return report?.evaluationStatus === "reference_missing" || report?.referenceComparable === false;
}

export function isTechnicalQualityEvaluationFailure(report: GenerationQualityReport | null | undefined): boolean {
  if (!report) return false;
  if (isReferenceMissingQualityEvaluation(report)) return false;
  if (report.evaluationStatus === "not_run") return false;
  if (
    report.evaluationStatus === "technical_failed"
    || report.evaluationStatus === "unavailable"
    || report.evaluationStatus === "partial"
    || report.evaluationStatus === "adjudication_required"
  ) return true;
  if (report.contentBased === false && report.passed === false) return true;
  return report.artifactIssues.some((issue) =>
    /视觉质量评估失败|quality evaluation failed|this operation was aborted|aborterror|timed? out|timeout|rate limit|too many requests|fetch failed|network/i.test(issue),
  );
}

function legacyQualityFallback(params: BaseEvaluationParams, video: boolean): GenerationQualityReport {
  const hasMedia = Boolean(params.mediaUrl?.trim());
  const hasPrompt = params.prompt.trim().length >= (video ? 60 : 30);
  const passed = hasMedia && hasPrompt;
  return {
    evaluationStatus: "not_run",
    assetId: params.assetId,
    candidateId: params.candidateId,
    candidateNo: params.candidateNo,
    mediaUrl: params.mediaUrl,
    identityScore: null,
    layoutScore: null,
    promptAlignmentScore: null,
    continuityScore: null,
    singleTakeScore: video ? null : undefined,
    artifactIssues: passed ? [] : [!hasMedia ? "missing generated media url" : "generation prompt is too short"],
    passed,
    originalPassed: passed,
    contentBased: false,
    qualityDecision: "review",
    retryFromStage: "generation",
    retryInstruction: passed ? undefined : "Regenerate using the legacy precheck path while visual quality evaluation is disabled.",
  };
}

async function callVision(
  content: Array<Record<string, unknown>>,
  system: string,
  schedulingContext?: Omit<ProviderSchedulingContext, "targetId">,
  model = qualityVisionModel(),
): Promise<unknown> {
  return withQualityVisionSlot(async () => {
    const attempts = qualityVisionRequestAttempts();
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await (schedulingContext
          ? withProviderCapacity({
              lane: "visual_quality",
              modelId: model,
              context: {
                ...schedulingContext,
                targetId: `visual-quality:${randomUUID()}`,
              },
              operation: () => callVisionOnce(content, system, model),
              waitTimeoutMs: qualityTimeoutMs(),
            })
          : callVisionOnce(content, system, model));
      } catch (error) {
        lastError = error;
        if (attempt >= attempts || !isRetryableQualityError(error)) throw error;
        await delay(qualityRetryDelayMs() * attempt);
      }
    }
    throw lastError;
  });
}

/**
 * Shared structured-vision gateway for post-approval planning. Keeping it here
 * makes observation and quality evaluation use the same model, retry, timeout,
 * and concurrency policy.
 */
export async function callStructuredVisionModel(
  content: Array<Record<string, unknown>>,
  system: string,
  schedulingContext?: Omit<ProviderSchedulingContext, "targetId">,
): Promise<unknown> {
  return callVision(content, system, schedulingContext);
}

export function structuredVisionModelName(): string {
  return qualityVisionModel();
}

export function structuredVisionAvailable(): boolean {
  return qualityVisionEnabled();
}

async function callVisionOnce(content: Array<Record<string, unknown>>, system: string, model = qualityVisionModel()): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), qualityTimeoutMs());
  try {
    const response = await fetch(`${compatibleBaseUrl()}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${requireApiKey()}` }, body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content }], temperature: 0, enable_thinking: false, response_format: { type: "json_object" } }), signal: controller.signal });
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
async function probeVideo(inputPath: string): Promise<{
  durationSeconds: number;
  width: number;
  height: number;
  frameRate: number;
  audioStreamPresent: boolean;
  audioCodec?: string;
  audioSampleRate?: number;
}> {
  const output = await runCapture(
    process.env.FFPROBE_PATH?.trim() || "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate:format=duration",
      "-of",
      "json",
      inputPath,
    ],
  );
  const data = JSON.parse(output) as Record<string, unknown>;
  const streams = Array.isArray(data.streams) ? data.streams.map(record) : [];
  const videoStream = streams.find((stream) => stream.codec_type === "video") ?? {};
  const audioStream = streams.find((stream) => stream.codec_type === "audio");
  const format = record(data.format);
  return {
    durationSeconds: Number(format.duration) || 0,
    width: Number(videoStream.width) || 0,
    height: Number(videoStream.height) || 0,
    frameRate: frameRate(videoStream.r_frame_rate),
    audioStreamPresent: Boolean(audioStream),
    audioCodec: typeof audioStream?.codec_name === "string" ? audioStream.codec_name : undefined,
    audioSampleRate: Number(audioStream?.sample_rate) || undefined,
  };
}
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
function qualityAdjudicationModel(): string { return process.env.ALIYUN_GENERATION_QUALITY_ADJUDICATION_MODEL?.trim() || qualityVisionModel(); }
export function generationQualityModelIdentity(): string {
  return `dashscope:vision=${qualityVisionModel()};adjudication=${qualityAdjudicationModel()}`;
}
function qualityTimeoutMs(): number { const value = Number(process.env.ONE_PROMPT_GENERATION_QUALITY_TIMEOUT_MS); return Number.isFinite(value) && value >= 5000 ? Math.max(60000, Math.round(value)) : 90000; }
function qualityReferenceLimit(): number { const value = Number(process.env.ONE_PROMPT_GENERATION_QUALITY_REFERENCE_LIMIT); return Number.isFinite(value) && value >= 1 ? Math.min(4, Math.round(value)) : 3; }
function qualityVisionConcurrency(): number { const value = Number(process.env.ONE_PROMPT_GENERATION_QUALITY_CONCURRENCY); return Number.isFinite(value) && value >= 1 ? Math.min(4, Math.round(value)) : 4; }
function qualityVisionRequestAttempts(): number { const value = Number(process.env.ONE_PROMPT_GENERATION_QUALITY_REQUEST_ATTEMPTS); return Number.isFinite(value) && value >= 1 ? Math.min(3, Math.round(value)) : 2; }
function qualityRetryDelayMs(): number { const value = Number(process.env.ONE_PROMPT_GENERATION_QUALITY_RETRY_DELAY_MS); return Number.isFinite(value) && value >= 0 ? Math.min(30000, Math.round(value)) : 1500; }
function compatibleBaseUrl(): string { return (process.env.DASHSCOPE_COMPATIBLE_BASE_URL || process.env.ALIYUN_COMPATIBLE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/$/, ""); }
function requireApiKey(): string { const key = process.env.DASHSCOPE_API_KEY || process.env.BAILIAN_API_KEY || process.env.ALIYUN_API_KEY; if (!key) throw new Error("missing DashScope API key"); return key; }
function parseContent(raw: Record<string, unknown>): unknown { const choices = Array.isArray(raw.choices) ? raw.choices : []; const first = record(choices[0]); const message = record(first.message); const content = message.content; if (typeof content !== "string") return {}; return JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
function extractError(raw: Record<string, unknown>): string { if (typeof raw.message === "string") return raw.message; const error = record(raw.error); return typeof error.message === "string" ? error.message : ""; }
function retryStage(value: unknown): GenerationQualityReport["retryFromStage"] { return value === "stage2b" || value === "stage3" || value === "generation" ? value : "generation"; }
function imageRepairMode(value: unknown): ImageRepairMode | undefined {
  return value === "reevaluate_only"
    || value === "local_edit"
    || value === "guided_regenerate"
    || value === "full_regenerate"
    || value === "reference_reselect"
    || value === "contract_recompile"
    || value === "storyboard_replan"
    || value === "manual_review"
    ? value
    : undefined;
}
function imageCorrectionScope(value: unknown): ImageCorrectionScope | undefined {
  return value === "local" || value === "regional" || value === "global" ? value : undefined;
}
function frameRate(value: unknown): number { const [a, b] = String(value ?? "0/1").split("/").map(Number); return b ? a / b : a || 0; }
function record(value: unknown): Record<string, unknown> { return value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function strings(value: unknown): string[] { return Array.isArray(value) ? uniqueStrings(value) : []; }
function uniqueStrings(value: unknown[]): string[] { return [...new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()))]; }
function optionalScore(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
}
function optionalUnitScore(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
}
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
