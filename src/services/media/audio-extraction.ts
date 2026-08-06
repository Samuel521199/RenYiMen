import { execFile } from "node:child_process";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { uploadMediaBufferToOss } from "@/services/video-orchestrator/oss-media";

const execFileAsync = promisify(execFile);
const MAX_INPUT_BYTES = 200 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 120 * 1024 * 1024;

export type AudioExtractionFormat = "mp3" | "wav" | "m4a";

export interface ExtractedAudioResult {
  url: string;
  format: AudioExtractionFormat;
  codec: string;
  sampleRate?: number;
  channels?: number;
  durationSeconds?: number;
  bytes: number;
}

interface AudioStreamProbe {
  codec_name?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
}

interface AudioExtractionDependencies {
  fetchImpl?: typeof fetch;
  uploadOutput?: typeof uploadMediaBufferToOss;
}

export async function extractAudioFromVideo(
  sourceUrl: string,
  format: AudioExtractionFormat,
  taskId: string,
  dependencies: AudioExtractionDependencies = {},
): Promise<ExtractedAudioResult> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const uploadOutput = dependencies.uploadOutput ?? uploadMediaBufferToOss;
  const ffmpegPath = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const ffprobePath = process.env.FFPROBE_PATH?.trim() || ffprobePathFor(ffmpegPath);
  const workDir = await mkdtemp(path.join(os.tmpdir(), "workflow-audio-extract-"));
  const sourcePath = path.join(workDir, "source-video");
  const outputPath = path.join(workDir, `extracted-audio.${format}`);

  try {
    await downloadToFile(sourceUrl, sourcePath, fetchImpl);
    const probe = await probeFirstAudioStream(ffprobePath, sourcePath);
    await runFfmpeg(ffmpegPath, sourcePath, outputPath, format);
    const body = await readFile(outputPath);
    if (body.byteLength === 0) throw new Error("提取后的音频文件为空");
    if (body.byteLength > MAX_OUTPUT_BYTES) {
      throw new Error(`提取后的音频超过 ${Math.floor(MAX_OUTPUT_BYTES / 1024 / 1024)}MB 限制`);
    }

    const url = await uploadOutput({
      key: `audio-extraction/${taskId}.${format}`,
      body,
      contentType: contentTypeFor(format),
    });
    return {
      url,
      format,
      codec: outputCodecFor(format),
      sampleRate: positiveNumber(probe.sample_rate),
      channels: positiveNumber(probe.channels),
      durationSeconds: positiveNumber(probe.duration),
      bytes: body.byteLength,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function downloadToFile(url: string, filePath: string, fetchImpl: typeof fetch): Promise<void> {
  const response = await fetchImpl(url, {
    cache: "no-store",
    headers: { Accept: "video/*,application/octet-stream;q=0.8" },
  });
  if (!response.ok || !response.body) {
    throw new Error(`下载源视频失败（HTTP ${response.status}）`);
  }
  const declaredBytes = Number(response.headers.get("content-length") || "0");
  if (declaredBytes > MAX_INPUT_BYTES) {
    throw new Error(`源视频超过 ${Math.floor(MAX_INPUT_BYTES / 1024 / 1024)}MB 限制`);
  }

  const destination = await open(filePath, "w");
  const reader = response.body.getReader();
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_INPUT_BYTES) {
        await reader.cancel();
        throw new Error(`源视频超过 ${Math.floor(MAX_INPUT_BYTES / 1024 / 1024)}MB 限制`);
      }
      await destination.write(value);
    }
  } finally {
    await destination.close();
  }
  if (receivedBytes === 0) throw new Error("源视频文件为空");
}

async function probeFirstAudioStream(ffprobePath: string, sourcePath: string): Promise<AudioStreamProbe> {
  let stdout: string;
  try {
    const result = await execFileAsync(ffprobePath, [
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", "stream=codec_name,sample_rate,channels,duration",
      "-of", "json",
      sourcePath,
    ], { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });
    stdout = result.stdout;
  } catch (error) {
    throw new Error(`无法读取视频音轨：${processErrorMessage(error)}`);
  }
  const parsed = JSON.parse(stdout) as { streams?: AudioStreamProbe[] };
  const stream = parsed.streams?.[0];
  if (!stream?.codec_name) throw new Error("该视频不包含可提取的音轨");
  return stream;
}

async function runFfmpeg(
  ffmpegPath: string,
  sourcePath: string,
  outputPath: string,
  format: AudioExtractionFormat,
): Promise<void> {
  const codecArgs = format === "mp3"
    ? ["-c:a", "libmp3lame", "-b:a", "256k"]
    : format === "wav"
      ? ["-c:a", "pcm_s16le", "-ar", "48000"]
      : ["-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart"];
  try {
    await execFileAsync(ffmpegPath, [
      "-y", "-nostdin", "-hide_banner", "-loglevel", "error",
      "-i", sourcePath,
      "-map", "0:a:0",
      "-vn",
      ...codecArgs,
      outputPath,
    ], { windowsHide: true, timeout: 10 * 60_000, maxBuffer: 2 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`音频提取失败：${processErrorMessage(error)}`);
  }
}

function ffprobePathFor(ffmpegPath: string): string {
  if (ffmpegPath !== "ffmpeg") {
    const parsed = path.parse(ffmpegPath);
    return path.join(parsed.dir, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
  }
  return "ffprobe";
}

function contentTypeFor(format: AudioExtractionFormat): string {
  if (format === "mp3") return "audio/mpeg";
  if (format === "wav") return "audio/wav";
  return "audio/mp4";
}

function outputCodecFor(format: AudioExtractionFormat): string {
  if (format === "mp3") return "mp3";
  if (format === "wav") return "pcm_s16le";
  return "aac";
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function processErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const record = error as { stderr?: unknown; message?: unknown };
  const stderr = typeof record.stderr === "string" ? record.stderr.trim() : "";
  if (stderr) return stderr.slice(-800);
  return typeof record.message === "string" ? record.message : "unknown error";
}
