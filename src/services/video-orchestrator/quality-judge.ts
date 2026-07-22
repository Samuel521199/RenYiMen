import type { VideoShot } from "@prisma/client";
import type { GenerationQualityReport } from "./types";
import type { EndFrameContinuityResult } from "./end-frame-continuity";

export function scoreShotImage(shot: Pick<VideoShot, "imageUrl" | "imagePrompt" | "locked">): number {
  let score = 45;
  if (shot.imageUrl) score += 30;
  if (shot.imagePrompt && shot.imagePrompt.length > 80) score += 15;
  if (shot.locked) score += 5;
  return Math.max(0, Math.min(100, score));
}

export function buildImageGenerationQualityReport(params: {
  assetId: string;
  imageUrl?: string | null;
  prompt?: string | null;
  selectedReferenceUrls?: string[];
  targetType: "anchor_reference_image" | "boundary_keyframe" | "motion_checkpoint_image";
  upstreamError?: string | null;
}): GenerationQualityReport {
  const issues: string[] = [];
  const prompt = params.prompt?.trim() ?? "";
  if (!params.imageUrl) issues.push("missing generated image url");
  if (params.upstreamError) issues.push(`upstream error: ${params.upstreamError}`);
  if (prompt.length < 60) issues.push("image prompt is too short to reliably preserve identity, layout, and product details");
  if (/subtitle|caption|watermark|timecode|random text|字幕|水印|时间码/i.test(prompt)) {
    issues.push("image prompt may allow visible text artifacts");
  }

  return {
    assetId: params.assetId,
    identityScore: 0,
    layoutScore: 0,
    promptAlignmentScore: 0,
    continuityScore: 0,
    singleTakeScore: undefined,
    artifactIssues: issues,
    passed: false,
    contentBased: false,
    retryFromStage: "generation",
    retryInstruction: retryInstructionForIssues(issues, params.targetType),
  };
}

export function buildVideoGenerationQualityReport(params: {
  assetId: string;
  clipUrl?: string | null;
  prompt?: string | null;
  durationSeconds?: number | null;
  upstreamError?: string | null;
  endFrameContinuity?: EndFrameContinuityResult;
  continuityRetryCount?: number;
}): GenerationQualityReport {
  const issues: string[] = [];
  const prompt = params.prompt?.trim() ?? "";
  if (!params.clipUrl) issues.push("missing generated video url");
  if (params.upstreamError) issues.push(`upstream error: ${params.upstreamError}`);
  if (prompt.length < 120) issues.push("video prompt is too short to describe a continuous motion path");
  if (params.durationSeconds && (params.durationSeconds < 3 || params.durationSeconds > 15)) {
    issues.push("video duration is outside HappyHorse recommended 3-15s range");
  }
  if (params.endFrameContinuity && params.endFrameContinuity.decision !== "pass") {
    issues.push(...params.endFrameContinuity.reasons.map((reason) => `end-frame continuity: ${reason}`));
  }

  return {
    assetId: params.assetId,
    identityScore: 0,
    layoutScore: 0,
    promptAlignmentScore: 0,
    continuityScore: 0,
    singleTakeScore: 0,
    artifactIssues: issues,
    passed: false,
    contentBased: false,
    retryFromStage: params.endFrameContinuity?.decision === "return_stage_2b" ? "stage2b" : "generation",
    retryInstruction: params.endFrameContinuity?.retryInstruction || retryInstructionForIssues(issues, "video_segment"),
    endFrameSimilarityScore: params.endFrameContinuity?.similarityScore,
    endFrameDecision: params.endFrameContinuity?.decision,
    endFrameReasons: params.endFrameContinuity?.reasons,
    continuityRetryCount: params.continuityRetryCount,
  };
}

function retryInstructionForIssues(issues: string[], targetType: string): string {
  if (!issues.length) return "";
  if (issues.some((issue) => issue.includes("cut or transition") || issue.includes("continuous motion"))) {
    return "Simplify the motion contract, reduce motion checkpoints, and remove all cut/transition language before regenerating the video segment.";
  }
  if (issues.some((issue) => issue.includes("visible text") || issue.includes("logo"))) {
    return "Strengthen product/logo reference usage, forbid wrong text, UI overlays, watermarks, and accidental captions in the prompt.";
  }
  if (issues.some((issue) => issue.includes("identity"))) {
    return "Strengthen identity reference usage and explicitly preserve character clothing, silhouette, face, product instance, and anchor locks.";
  }
  if (issues.some((issue) => issue.includes("layout"))) {
    return "Strengthen scene layout, parent camera reference, spatial relationships, and camera-axis constraints.";
  }
  if (targetType === "motion_checkpoint_image") {
    return "Regenerate this motion checkpoint image with clearer same-segment state, visible anchor locks, and stricter reference usage.";
  }
  if (targetType === "video_segment") {
    return "Regenerate this video segment from the same approved first frame after simplifying prompt and single-take contract.";
  }
  return "Regenerate this asset with stronger reference usage and a clearer prompt contract.";
}

export function buildPlaceholderKeyframeUrl(params: {
  shotNo: number;
  aspectRatio: string;
  title: string;
  purpose: string;
  subtitle: string;
}): string {
  const width = params.aspectRatio === "16:9" ? 1280 : params.aspectRatio === "1:1" ? 1024 : 720;
  const height = params.aspectRatio === "16:9" ? 720 : params.aspectRatio === "1:1" ? 1024 : 1280;
  const title = escapeXml(params.title.slice(0, 28));
  const purpose = escapeXml(params.purpose.slice(0, 42));
  const subtitle = escapeXml(params.subtitle.slice(0, 36));
  const hue = (params.shotNo * 47) % 360;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},50%,18%)"/><stop offset="1" stop-color="hsl(${(hue + 80) % 360},45%,8%)"/></linearGradient></defs>`,
    `<rect width="100%" height="100%" fill="url(#bg)"/>`,
    `<rect x="${width * 0.08}" y="${height * 0.08}" width="${width * 0.84}" height="${height * 0.84}" rx="28" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.22)" stroke-width="2"/>`,
    `<text x="${width * 0.12}" y="${height * 0.18}" fill="rgba(255,255,255,0.72)" font-family="Arial, sans-serif" font-size="${Math.round(width * 0.045)}" font-weight="700">SHOT ${String(params.shotNo).padStart(2, "0")}</text>`,
    `<text x="${width * 0.12}" y="${height * 0.34}" fill="white" font-family="Arial, sans-serif" font-size="${Math.round(width * 0.055)}" font-weight="700">${title}</text>`,
    `<text x="${width * 0.12}" y="${height * 0.46}" fill="rgba(255,255,255,0.86)" font-family="Arial, sans-serif" font-size="${Math.round(width * 0.035)}">${purpose}</text>`,
    `<text x="${width * 0.12}" y="${height * 0.78}" fill="rgba(255,255,255,0.76)" font-family="Arial, sans-serif" font-size="${Math.round(width * 0.032)}">${subtitle}</text>`,
    `</svg>`,
  ].join("");
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
