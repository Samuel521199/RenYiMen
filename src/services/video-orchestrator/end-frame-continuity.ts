import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { logOnePromptVideo } from "./logger";

export interface EndFrameContinuityResult {
  decision: "pass" | "retry_generation" | "return_stage_2b" | "evaluation_failed";
  similarityScore: number;
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
}): Promise<EndFrameContinuityResult> {
  if (!continuityVisionEnabled()) {
    return failure("端帧视觉检查未启用或缺少 DashScope API Key；不会机械贴入尾帧。", "Enable ONE_PROMPT_END_FRAME_VISION_EVAL and configure a DashScope API key, then retry continuity evaluation.");
  }
  const workDir = path.join(os.tmpdir(), `one-prompt-end-check-${params.projectId}-${params.segmentNo}-${Date.now()}`);
  const clipPath = path.join(workDir, "clip.mp4");
  const sampledPath = path.join(workDir, "last-frame.jpg");
  await mkdir(workDir, { recursive: true });
  try {
    await download(params.clipUrl, clipPath);
    await extractLastFrame(clipPath, sampledPath);
    const sampledFrameDataUrl = `data:image/jpeg;base64,${(await readFile(sampledPath)).toString("base64")}`;
    const content: Array<Record<string, unknown>> = [
      {
        type: "text",
        text: [
          "Compare the generated video's last sampled frame with the approved end-frame reference and ending-state contract.",
          "The approved end frame is a soft semantic target, not a hard pixel-perfect requirement.",
          `Segment: ${params.segmentNo}`,
          `End-frame contract: ${JSON.stringify(params.endFrameContract ?? {})}`,
          `Motion contract: ${JSON.stringify(params.motionContract ?? {})}`,
          "Return strict JSON: similarityScore 0..1, motionReachability reachable|prompt_fixable|unreachable, reasons[], retryInstruction, passed.",
          "passed=true only when identity, subject/product state, composition direction, location/layout, lighting intent and final action state are acceptably close.",
          "Use unreachable only when the requested motion or state transition is structurally impossible in one continuous take; do not recommend blind retries in that case.",
        ].join("\n"),
      },
      { type: "text", text: "Generated video last sampled frame:" },
      { type: "image_url", image_url: { url: sampledFrameDataUrl } },
      { type: "text", text: "User-approved end-frame reference:" },
      { type: "image_url", image_url: { url: params.approvedEndFrameUrl } },
    ];
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
    const result = normalizeEndFrameContinuityResponse(parseContent(raw), sampledFrameDataUrl);
    await logOnePromptVideo("clip.end_frame_continuity.result", {
      projectId: params.projectId,
      segmentNo: params.segmentNo,
      decision: result.decision,
      similarityScore: result.similarityScore,
      reasons: result.reasons,
      retryInstruction: result.retryInstruction,
    }, result.decision === "pass" ? "info" : "warn");
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logOnePromptVideo("clip.end_frame_continuity.failed", { projectId: params.projectId, segmentNo: params.segmentNo, message }, "error");
    return failure(`端帧视觉检查失败：${message}`, "Retry end-frame continuity evaluation after checking FFmpeg, media URL access, and the vision service; do not regenerate blindly.");
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export function normalizeEndFrameContinuityResponse(value: unknown, sampledFrameDataUrl?: string): EndFrameContinuityResult {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const similarityScore = clamp01(Number(source.similarityScore ?? source.similarity_score));
  const reachability = String(source.motionReachability ?? source.motion_reachability ?? "").toLowerCase();
  const passed = source.passed === true && similarityScore >= 0.72;
  const reasons = uniqueStrings(Array.isArray(source.reasons) ? source.reasons : []);
  const modelRetry = typeof source.retryInstruction === "string" ? source.retryInstruction.trim() : typeof source.retry_instruction === "string" ? source.retry_instruction.trim() : "";
  if (passed) return { decision: "pass", similarityScore, reasons, sampledFrameDataUrl };
  if (reachability === "unreachable") {
    return {
      decision: "return_stage_2b",
      similarityScore,
      reasons: reasons.length ? reasons : ["motion path cannot reach the approved end-state contract in one take"],
      retryInstruction: modelRetry || "Return to Stage 2B and split or simplify the physically unreachable motion contract.",
      sampledFrameDataUrl,
    };
  }
  return {
    decision: "retry_generation",
    similarityScore,
    reasons: reasons.length ? reasons : ["generated final sampled frame is not close enough to the approved end-state contract"],
    retryInstruction: modelRetry || "Regenerate from the same approved first frame with a clearer reachable ending-state instruction and simpler motion checkpoints.",
    sampledFrameDataUrl,
  };
}

function failure(reason: string, retryInstruction: string): EndFrameContinuityResult { return { decision: "evaluation_failed", similarityScore: 0, reasons: [reason], retryInstruction }; }
async function download(url: string, outputPath: string): Promise<void> { const response = await fetch(url); if (!response.ok) throw new Error(`download failed HTTP ${response.status}`); await writeFile(outputPath, Buffer.from(await response.arrayBuffer())); }
async function extractLastFrame(inputPath: string, outputPath: string): Promise<void> { await run(process.env.FFMPEG_PATH?.trim() || "ffmpeg", ["-y", "-sseof", "-0.12", "-i", inputPath, "-frames:v", "1", "-q:v", "2", outputPath]); }
async function run(command: string, args: string[]): Promise<void> { await new Promise<void>((resolve, reject) => { const child = spawn(command, args, { windowsHide: true }); let stderr = ""; child.stderr.on("data", (chunk) => { stderr += String(chunk); }); child.on("error", reject); child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${stderr.slice(-1200)}`))); }); }
function continuityVisionEnabled(): boolean { if (process.env.ONE_PROMPT_END_FRAME_VISION_EVAL?.trim().toLowerCase() === "false") return false; return Boolean(process.env.DASHSCOPE_API_KEY || process.env.BAILIAN_API_KEY || process.env.ALIYUN_API_KEY); }
function continuityTimeoutMs(): number { const value = Number(process.env.ONE_PROMPT_END_FRAME_VISION_TIMEOUT_MS); return Number.isFinite(value) && value >= 5000 ? Math.round(value) : 45000; }
function compatibleBaseUrl(): string { return (process.env.DASHSCOPE_COMPATIBLE_BASE_URL || process.env.ALIYUN_COMPATIBLE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/$/, ""); }
function requireApiKey(): string { const key = process.env.DASHSCOPE_API_KEY || process.env.BAILIAN_API_KEY || process.env.ALIYUN_API_KEY; if (!key) throw new Error("missing DashScope API key"); return key; }
function parseContent(raw: Record<string, unknown>): unknown { const choices = Array.isArray(raw.choices) ? raw.choices : []; const first = choices[0] as Record<string, unknown> | undefined; const message = first?.message as Record<string, unknown> | undefined; const content = message?.content; if (typeof content !== "string") return {}; return JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
function extractError(raw: Record<string, unknown>): string { if (typeof raw.message === "string") return raw.message; const error = raw.error as Record<string, unknown> | undefined; return typeof error?.message === "string" ? error.message : ""; }
function uniqueStrings(values: unknown[]): string[] { return [...new Set(values.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()))]; }
function clamp01(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0; }
