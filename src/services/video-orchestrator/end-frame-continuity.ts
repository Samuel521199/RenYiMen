import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { logOnePromptVideo } from "./logger";
import {
  resolveEndFrameRequirementLevel,
  type EndFrameRequirementLevel,
} from "./video-terminal-contract";

export interface EndFrameContinuityResult {
  decision: "pass" | "retry_generation" | "return_stage_2b" | "manual_review" | "evaluation_failed";
  similarityScore: number | null;
  confidenceScore?: number;
  reasons: string[];
  retryInstruction?: string;
  sampledFrameDataUrl?: string;
}

export async function evaluateEndFrameContinuity(params: {
  projectId: string;
  segmentNo: number;
  clipUrl: string;
  approvedEndFrameUrl: string;
  endFrameContract: Record<string, unknown> | undefined;
  motionContract: Record<string, unknown> | undefined;
  endFrameRequirementLevel?: EndFrameRequirementLevel;
}): Promise<EndFrameContinuityResult> {
  if (!continuityVisionEnabled()) {
    return failure("端帧视觉检查未启用或缺少 DashScope API Key；不会机械贴入尾帧。", "Enable ONE_PROMPT_END_FRAME_VISION_EVAL and configure a DashScope API key, then retry continuity evaluation.");
  }
  const workDir = path.join(os.tmpdir(), `one-prompt-end-check-${params.projectId}-${params.segmentNo}-${Date.now()}`);
  const clipPath = path.join(workDir, "clip.mp4");
  await mkdir(workDir, { recursive: true });
  try {
    await download(params.clipUrl, clipPath);
    const sampledFrameDataUrls: string[] = [];
    for (const [index, offsetSeconds] of [0.8, 0.4, 0.12].entries()) {
      const sampledPath = path.join(workDir, `tail-frame-${index + 1}.png`);
      await extractTailFrame(clipPath, sampledPath, offsetSeconds);
      sampledFrameDataUrls.push(`data:image/png;base64,${(await readFile(sampledPath)).toString("base64")}`);
    }
    const requirementLevel = params.endFrameRequirementLevel ?? resolveEndFrameRequirementLevel(params.endFrameContract);
    const content: Array<Record<string, unknown>> = [
      {
        type: "text",
        text: [
          "Evaluate the generated video's ordered tail stability window against the approved end-state contract.",
          "Judge the minimum visible terminal facts required by the contract. Do not require pixel-for-pixel identity and do not fail non-critical background, lighting, or decorative differences.",
          "The three generated samples are ordered from earlier to later. A usable ending should converge toward and stably hold the required state; a single blurred or encoded tail frame must not veto an otherwise stable window.",
          `Segment: ${params.segmentNo}`,
          `Requirement level: ${requirementLevel}`,
          `End-frame contract: ${JSON.stringify(params.endFrameContract ?? {})}`,
          `Motion contract: ${JSON.stringify(params.motionContract ?? {})}`,
          "Return strict JSON: similarityScore 0..1, confidenceScore 0..1, stableHold true|false, hardFailure true|false, motionReachability reachable|prompt_fixable|unreachable, reasons[], retryInstruction, passed.",
          "hardFailure=true only when a required core action result, required subject/product state, identity, instance count, or indispensable spatial relationship is clearly wrong or absent.",
          "Use unreachable only when the requested motion or state transition is structurally impossible in one continuous take; do not recommend blind retries in that case.",
        ].join("\n"),
      },
    ];
    for (const [index, dataUrl] of sampledFrameDataUrls.entries()) {
      content.push({ type: "text", text: `Generated tail sample ${index + 1}/3:` });
      content.push({ type: "image_url", image_url: { url: dataUrl } });
    }
    content.push(
      { type: "text", text: "User-approved end-frame reference (target evidence, not pixel-exact requirement):" },
      { type: "image_url", image_url: { url: params.approvedEndFrameUrl } },
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), continuityTimeoutMs());
    let response: Response;
    try {
      response = await fetch(`${compatibleBaseUrl()}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${requireApiKey()}` },
        body: JSON.stringify({
          model: process.env.ALIYUN_END_FRAME_VISION_MODEL?.trim() || process.env.ALIYUN_STORYBOARD_VISION_MODEL?.trim() || "qwen-vl-max",
          messages: [
            { role: "system", content: "You are a strict video end-state continuity evaluator. Output JSON only." },
            { role: "user", content },
          ],
          temperature: 0,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    const raw = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(extractError(raw) || `HTTP ${response.status}`);
    const result = normalizeEndFrameContinuityResponse(parseContent(raw), sampledFrameDataUrls, requirementLevel);
    await logOnePromptVideo("clip.end_frame_continuity.result", {
      projectId: params.projectId,
      segmentNo: params.segmentNo,
      decision: result.decision,
      similarityScore: result.similarityScore,
      confidenceScore: result.confidenceScore,
      reasons: result.reasons,
      retryInstruction: result.retryInstruction,
    }, result.decision === "pass" ? "info" : "warn");
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logOnePromptVideo("clip.end_frame_continuity.failed", { projectId: params.projectId, segmentNo: params.segmentNo, message }, "error");
    return failure(`端帧视觉检查失败：${message}`, "Retry end-frame continuity evaluation after checking FFmpeg, media URL access, and the vision service; do not regenerate blindly.");
  } finally {
    try {
      await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
    } catch (error) {
      await logOnePromptVideo("clip.end_frame_continuity.cleanup_deferred", {
        projectId: params.projectId,
        segmentNo: params.segmentNo,
        message: error instanceof Error ? error.message : String(error),
      }, "warn");
    }
  }
}

export function normalizeEndFrameContinuityResponse(
  value: unknown,
  sampledFrameDataUrls: string[] = [],
  requirementLevel: EndFrameRequirementLevel = "hard_semantic",
): EndFrameContinuityResult {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const similarityScore = optionalClamp01(source.similarityScore ?? source.similarity_score);
  const confidenceScore = optionalClamp01(source.confidenceScore ?? source.confidence_score) ?? 0.5;
  const reachability = String(source.motionReachability ?? source.motion_reachability ?? "").toLowerCase();
  const hardFailure = source.hardFailure === true || source.hard_failure === true;
  const stableHold = source.stableHold === true || source.stable_hold === true;
  const threshold = requirementLevel === "hard_exact" ? 0.9 : requirementLevel === "hard_semantic" ? 0.75 : requirementLevel === "soft_directional" ? 0.6 : 0.5;
  const passed = source.passed === true && similarityScore != null && similarityScore >= threshold && !hardFailure && (stableHold || requirementLevel === "editorial");
  const reasons = uniqueStrings(Array.isArray(source.reasons) ? source.reasons : []);
  const modelRetry = typeof source.retryInstruction === "string" ? source.retryInstruction.trim() : typeof source.retry_instruction === "string" ? source.retry_instruction.trim() : "";
  const sampledFrameDataUrl = sampledFrameDataUrls.at(-1);
  const evidence = { similarityScore, confidenceScore, sampledFrameDataUrl };
  if (confidenceScore < 0.7 || similarityScore == null) {
    return {
      decision: "manual_review",
      ...evidence,
      reasons: reasons.length ? reasons : ["tail-window evidence is insufficient for an automatic terminal-state decision"],
      retryInstruction: "Review the existing video or retry continuity evaluation. Do not regenerate solely because evaluator confidence is low.",
    };
  }
  if (passed) return { decision: "pass", ...evidence, reasons };
  if (reachability === "unreachable") {
    return {
      decision: "return_stage_2b",
      ...evidence,
      reasons: reasons.length ? reasons : ["motion path cannot reach the approved end-state contract in one take"],
      retryInstruction: modelRetry || "Return to Stage 2B and split or simplify the physically unreachable motion contract.",
    };
  }
  return {
    decision: "retry_generation",
    ...evidence,
    reasons: reasons.length ? reasons : ["generated final sampled frame is not close enough to the approved end-state contract"],
    retryInstruction: modelRetry || "Regenerate from the same approved first frame with a clearer reachable ending-state instruction and simpler motion checkpoints.",
  };
}

function failure(reason: string, retryInstruction: string): EndFrameContinuityResult { return { decision: "evaluation_failed", similarityScore: null, reasons: [reason], retryInstruction }; }
async function download(url: string, outputPath: string): Promise<void> { const response = await fetch(url); if (!response.ok) throw new Error(`download failed HTTP ${response.status}`); await writeFile(outputPath, Buffer.from(await response.arrayBuffer())); }
async function extractTailFrame(inputPath: string, outputPath: string, offsetSeconds: number): Promise<void> {
  await run(process.env.FFMPEG_PATH?.trim() || "ffmpeg", [
    "-y",
    "-sseof",
    `-${offsetSeconds}`,
    "-i",
    inputPath,
    "-frames:v",
    "1",
    "-vf",
    "format=rgb24",
    "-c:v",
    "png",
    "-threads",
    "1",
    outputPath,
  ]);
}
async function run(command: string, args: string[]): Promise<void> { await new Promise<void>((resolve, reject) => { const child = spawn(command, args, { windowsHide: true }); let stderr = ""; child.stderr.on("data", (chunk) => { stderr += String(chunk); }); child.on("error", reject); child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${stderr.slice(-1200)}`))); }); }
function continuityVisionEnabled(): boolean { if (process.env.ONE_PROMPT_END_FRAME_VISION_EVAL?.trim().toLowerCase() === "false") return false; return Boolean(process.env.DASHSCOPE_API_KEY || process.env.BAILIAN_API_KEY || process.env.ALIYUN_API_KEY); }
function continuityTimeoutMs(): number { const value = Number(process.env.ONE_PROMPT_END_FRAME_VISION_TIMEOUT_MS); return Number.isFinite(value) && value >= 5000 ? Math.round(value) : 45000; }
function compatibleBaseUrl(): string { return (process.env.DASHSCOPE_COMPATIBLE_BASE_URL || process.env.ALIYUN_COMPATIBLE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/$/, ""); }
function requireApiKey(): string { const key = process.env.DASHSCOPE_API_KEY || process.env.BAILIAN_API_KEY || process.env.ALIYUN_API_KEY; if (!key) throw new Error("missing DashScope API key"); return key; }
function parseContent(raw: Record<string, unknown>): unknown { const choices = Array.isArray(raw.choices) ? raw.choices : []; const first = choices[0] as Record<string, unknown> | undefined; const message = first?.message as Record<string, unknown> | undefined; const content = message?.content; if (typeof content !== "string") return {}; return JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
function extractError(raw: Record<string, unknown>): string { if (typeof raw.message === "string") return raw.message; const error = raw.error as Record<string, unknown> | undefined; return typeof error?.message === "string" ? error.message : ""; }
function uniqueStrings(values: unknown[]): string[] { return [...new Set(values.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()))]; }
function optionalClamp01(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : null;
}
