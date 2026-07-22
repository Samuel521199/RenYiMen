import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { logOnePromptVideo } from "./logger";
import type { GenerationQualityReport } from "./types";
import { onePromptRolloutEnabled } from "./rollout-flags";

interface BaseEvaluationParams {
  assetId: string;
  candidateId?: string;
  candidateNo?: number;
  mediaUrl: string;
  targetContract: Record<string, unknown>;
  selectedReferenceUrls: string[];
  referenceUsageNotes: string[];
  prompt: string;
  purpose: "anchor_reference_image" | "boundary_keyframe" | "motion_checkpoint_image" | "transition_reference_frame" | "video_segment" | "generated_bridge";
  assetCategory?: string;
  /** Brand/logo/UI lock assets require exact readable text; do not fail merely because text is visible. */
  requiresExactBrandText?: boolean;
}

export async function evaluateGeneratedImageQuality(params: BaseEvaluationParams): Promise<GenerationQualityReport> {
  if (!onePromptRolloutEnabled("ONE_PROMPT_VISUAL_QUALITY_EVAL")) return legacyQualityFallback(params, false);
  if (!qualityVisionEnabled()) return evaluationFailure(params, "真实图片视觉质量评估未启用或缺少 DashScope API Key。", "manual");
  const content: Array<Record<string, unknown>> = [{
    type: "text",
    text: [
      "Evaluate the actual generated image. Scores must come from visible media content, never prompt length.",
      `Purpose: ${params.purpose}`,
      `Target contract: ${JSON.stringify(params.targetContract)}`,
      `Generation prompt: ${params.prompt.slice(0, 2400)}`,
      `Reference usage notes: ${JSON.stringify(params.referenceUsageNotes)}`,
      "Return strict JSON with identityScore, layoutScore, promptAlignmentScore, continuityScore (0..100), productInstanceCount, personInstanceCount, wrongTextDetected, artifactIssues[], passed, retryInstruction, retryFromStage stage2b|stage3|generation.",
      "For anchors prioritize isolated identity accuracy. For boundary keyframes prioritize contract/layout/identity. For motion checkpoints prioritize same-path state and continuity.",
      "For an anchor reference image, use retryFromStage=generation for visible output defects such as extra people, unwanted backgrounds/decorations, wrong centering, bad proportions, malformed text, or missing requested elements. Stage2b is only for an impossible/contradictory shot contract and does not repair an anchor image.",
      params.requiresExactBrandText
        ? "This is a brand/logo/UI lock asset. Required brand text in the prompt is intentional. Set wrongTextDetected=true ONLY when visible text is misspelled, missing required lock wording, or random gibberish — NOT merely because readable brand/UI text is present."
        : "",
      params.assetCategory ? `Asset category: ${params.assetCategory}` : "",
    ].join("\n"),
  }, { type: "text", text: "Generated candidate:" }, { type: "image_url", image_url: { url: params.mediaUrl } }];
  for (const [index, url] of params.selectedReferenceUrls.slice(0, 4).entries()) {
    content.push({ type: "text", text: `Selected reference ${index + 1}: ${params.referenceUsageNotes[index] ?? "approved reference"}` });
    content.push({ type: "image_url", image_url: { url } });
  }
  try {
    const raw = await callVision(content, "Evaluate generated image quality and output strict JSON.");
    return normalizeImageQualityResponse(raw, params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logOnePromptVideo("generation_quality.image_eval_failed", { assetId: params.assetId, candidateId: params.candidateId, message }, "error");
    return evaluationFailure(params, `图片视觉质量评估失败：${message}`, "manual");
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
    const sampleTimes = sampleTimesForDuration(metadata.durationSeconds || params.durationSeconds);
    const frames = await Promise.all(sampleTimes.map(async (time, index) => {
      const outputPath = path.join(workDir, `frame-${index}.jpg`);
      await extractFrame(clipPath, outputPath, time);
      return `data:image/jpeg;base64,${(await readFile(outputPath)).toString("base64")}`;
    }));
    const content: Array<Record<string, unknown>> = [{
      type: "text",
      text: [
        "Evaluate the actual generated video from five ordered sampled frames and metadata. Scores must come from visible content, never prompt length.",
        `Metadata: ${JSON.stringify(metadata)}`,
        `Target contract: ${JSON.stringify(params.targetContract)}`,
        `Motion checkpoints in required order: ${JSON.stringify(params.motionCheckpoints)}`,
        `Reference usage notes: ${JSON.stringify(params.referenceUsageNotes)}`,
        "Return strict JSON with identityScore, layoutScore, promptAlignmentScore, continuityScore, firstFrameConsistencyScore, checkpointOrderScore, singleTakeScore (0..100), productInstanceCount, personInstanceCount, wrongTextDetected, artifactIssues[], metadataIssues[], passed, retryInstruction, retryFromStage stage2b|stage3|generation.",
        "Detect identity drift, abnormal duplicate instances, spatial layout drift, jump cuts, teleportation, melting, scene replacement, out-of-order checkpoints, first-frame mismatch and ending-state mismatch.",
        "Use retryFromStage=stage2b for physically unreachable or structural motion; stage3 for prompt/compiler repair; generation for ordinary visual defects.",
      ].join("\n"),
    }];
    for (const [index, frame] of frames.entries()) {
      content.push({ type: "text", text: `Ordered video sample ${index + 1}/5 at ${sampleTimes[index].toFixed(3)}s:` });
      content.push({ type: "image_url", image_url: { url: frame } });
    }
    content.push({ type: "text", text: "Approved first-frame reference:" }, { type: "image_url", image_url: { url: params.startFrameUrl } });
    content.push({ type: "text", text: "Approved end-state soft reference:" }, { type: "image_url", image_url: { url: params.endFrameUrl } });
    for (const [index, url] of params.selectedReferenceUrls.slice(0, 3).entries()) {
      content.push({ type: "text", text: `Identity/layout reference ${index + 1}: ${params.referenceUsageNotes[index] ?? "approved reference"}` });
      content.push({ type: "image_url", image_url: { url } });
    }
    const raw = await callVision(content, "Evaluate multi-frame video generation quality and output strict JSON.");
    return normalizeVideoQualityResponse(raw, params, metadata);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logOnePromptVideo("generation_quality.video_eval_failed", { assetId: params.assetId, candidateId: params.candidateId, message }, "error");
    return evaluationFailure(params, `视频多帧视觉质量评估失败：${message}`, "manual");
  } finally {
    await rm(workDir, { recursive: true, force: true });
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
    return Promise.all(safeFractions.map(async (fraction, index) => {
      const outputPath = path.join(workDir, `candidate-${index + 1}.jpg`);
      await extractFrame(clipPath, outputPath, metadata.durationSeconds * fraction);
      return { fraction, dataUrl: `data:image/jpeg;base64,${(await readFile(outputPath)).toString("base64")}` };
    }));
  } finally {
    await rm(workDir, { recursive: true, force: true });
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
  const passed = params.requiresExactBrandText
    ? brandVisualGatePassed
    : originalPassed && scoreGatePassed && !wrongTextDetected;
  return {
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
    artifactIssues: strings(source.artifactIssues ?? source.artifact_issues),
    passed,
    originalPassed,
    retryInstruction: text(source.retryInstruction ?? source.retry_instruction) || (!passed ? `Regenerate to improve visible identity (${identityScore}), layout (${layoutScore}), prompt alignment (${promptAlignmentScore}) and continuity (${continuityScore}); remove any incorrect text.` : undefined),
    retryFromStage: retryStage(source.retryFromStage ?? source.retry_from_stage),
    contentBased: true,
  };
}

function evaluationFailure(params: BaseEvaluationParams, issue: string, retryFromStage: GenerationQualityReport["retryFromStage"]): GenerationQualityReport {
  return { assetId: params.assetId, candidateId: params.candidateId, candidateNo: params.candidateNo, mediaUrl: params.mediaUrl, identityScore: 0, layoutScore: 0, promptAlignmentScore: 0, continuityScore: 0, artifactIssues: [issue], passed: false, originalPassed: false, contentBased: true, retryInstruction: "Restore visual quality evaluation and evaluate this existing candidate before generating again.", retryFromStage };
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), qualityTimeoutMs());
  try {
    const response = await fetch(`${compatibleBaseUrl()}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${requireApiKey()}` }, body: JSON.stringify({ model: process.env.ALIYUN_GENERATION_QUALITY_VISION_MODEL?.trim() || process.env.ALIYUN_STORYBOARD_VISION_MODEL?.trim() || "qwen-vl-max", messages: [{ role: "system", content: system }, { role: "user", content }], temperature: 0, response_format: { type: "json_object" } }), signal: controller.signal });
    const raw = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(extractError(raw) || `HTTP ${response.status}`);
    return parseContent(raw);
  } finally { clearTimeout(timeout); }
}
function sampleTimesForDuration(duration: number): number[] { const safe = Math.max(0.2, duration); return [0, safe * 0.25, safe * 0.5, safe * 0.75, Math.max(0, safe - 0.08)]; }
async function probeVideo(inputPath: string): Promise<{ durationSeconds: number; width: number; height: number; frameRate: number }> { const output = await runCapture(process.env.FFPROBE_PATH?.trim() || "ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", inputPath]); const data = JSON.parse(output) as Record<string, unknown>; const stream = Array.isArray(data.streams) ? record(data.streams[0]) : {}; const format = record(data.format); return { durationSeconds: Number(format.duration) || 0, width: Number(stream.width) || 0, height: Number(stream.height) || 0, frameRate: frameRate(stream.r_frame_rate) }; }
async function extractFrame(inputPath: string, outputPath: string, time: number): Promise<void> { await runCapture(process.env.FFMPEG_PATH?.trim() || "ffmpeg", ["-y", "-ss", time.toFixed(3), "-i", inputPath, "-frames:v", "1", "-vf", "scale=1024:-2:force_original_aspect_ratio=decrease", "-q:v", "3", outputPath]); }
async function download(url: string, outputPath: string): Promise<void> { const response = await fetch(url); if (!response.ok) throw new Error(`download failed HTTP ${response.status}`); await writeFile(outputPath, Buffer.from(await response.arrayBuffer())); }
async function runCapture(command: string, args: string[]): Promise<string> { return new Promise((resolve, reject) => { const child = spawn(command, args, { windowsHide: true }); let stdout = ""; let stderr = ""; child.stdout.on("data", (chunk) => { stdout += String(chunk); }); child.stderr.on("data", (chunk) => { stderr += String(chunk); }); child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`${command} exited ${code}: ${stderr.slice(-1600)}`))); }); }
function qualityVisionEnabled(): boolean { if (process.env.ONE_PROMPT_GENERATION_QUALITY_VISION_EVAL?.trim().toLowerCase() === "false") return false; return Boolean(process.env.DASHSCOPE_API_KEY || process.env.BAILIAN_API_KEY || process.env.ALIYUN_API_KEY); }
function qualityTimeoutMs(): number { const value = Number(process.env.ONE_PROMPT_GENERATION_QUALITY_TIMEOUT_MS); return Number.isFinite(value) && value >= 5000 ? Math.round(value) : 90000; }
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
