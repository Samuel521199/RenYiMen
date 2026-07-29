import type { GenerationQualityReport } from "./types";
import type { EndFrameContinuityResult } from "./end-frame-continuity";

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
    evaluationStatus: "not_run",
    assetId: params.assetId,
    identityScore: null,
    layoutScore: null,
    promptAlignmentScore: null,
    continuityScore: null,
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
    evaluationStatus: params.endFrameContinuity?.decision === "evaluation_failed" ? "unavailable" : "not_run",
    assetId: params.assetId,
    identityScore: null,
    layoutScore: null,
    promptAlignmentScore: null,
    continuityScore: null,
    singleTakeScore: null,
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
