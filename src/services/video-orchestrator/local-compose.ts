import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { logOnePromptVideo } from "./logger";
import type { VideoAspectRatio } from "./types";

interface LocalComposeParams {
  projectId: string;
  title: string;
  clipUrls: string[];
  clipDurations?: number[];
  aspectRatio: VideoAspectRatio;
}

interface OssConfig {
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicDomain: string;
  forcePathStyle: boolean;
}

export async function composeVideoClipsLocally(params: LocalComposeParams): Promise<string> {
  const cfg = readOssConfig();
  const ffmpegPath = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const workDir = path.join(os.tmpdir(), `one-prompt-compose-${params.projectId}-${Date.now()}`);
  await mkdir(workDir, { recursive: true });
  await logOnePromptVideo("compose.local.start", {
    projectId: params.projectId,
    title: params.title,
    clipCount: params.clipUrls.length,
    transitionSeconds: composeTransitionSeconds(params.clipDurations),
    aspectRatio: params.aspectRatio,
    workDir,
    ffmpegPath,
  });

  try {
    const clipPaths: string[] = [];
    for (let index = 0; index < params.clipUrls.length; index += 1) {
      const clipPath = path.join(workDir, `clip-${String(index + 1).padStart(2, "0")}.mp4`);
      await downloadToFile(params.clipUrls[index], clipPath);
      clipPaths.push(clipPath);
    }

    const outputPath = path.join(workDir, "final.mp4");
    const transitionSeconds = composeTransitionSeconds(params.clipDurations);
    const audioPresence = await Promise.all(clipPaths.map((clipPath) => probeClipHasAudio(ffmpegPath, clipPath)));
    await logOnePromptVideo("compose.local.audio_probe", {
      projectId: params.projectId,
      clipCount: clipPaths.length,
      clipsWithAudio: audioPresence.filter(Boolean).length,
      audioPresence,
    }, audioPresence.every(Boolean) ? "info" : "warn");
    if (clipPaths.length > 1 && transitionSeconds > 0) {
      await composeWithXfade(ffmpegPath, clipPaths, params.clipDurations ?? [], transitionSeconds, outputPath, audioPresence);
    } else {
      await composeWithConcat(ffmpegPath, clipPaths, path.join(workDir, "concat.txt"), outputPath);
    }

    const key = `one-prompt-video/final/${params.projectId}-${Date.now()}.mp4`;
    const publicUrl = await uploadFileToOss(cfg, key, outputPath);
    await logOnePromptVideo("compose.local.success", {
      projectId: params.projectId,
      clipCount: params.clipUrls.length,
      publicUrl,
      key,
    });
    return publicUrl;
  } catch (error) {
    await logOnePromptVideo("compose.local.error", {
      projectId: params.projectId,
      error: error instanceof Error ? error.message : String(error),
    }, "error");
    throw error;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function readOssConfig(): OssConfig {
  const region = process.env.OSS_REGION?.trim();
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.OSS_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.OSS_BUCKET_NAME?.trim();
  const publicDomain = process.env.OSS_PUBLIC_DOMAIN?.trim();
  if (!region || !accessKeyId || !secretAccessKey || !bucket || !publicDomain) {
    throw new Error("Local composition needs OSS_REGION / OSS_ACCESS_KEY_ID / OSS_SECRET_ACCESS_KEY / OSS_BUCKET_NAME / OSS_PUBLIC_DOMAIN.");
  }
  return {
    region,
    endpoint: process.env.OSS_ENDPOINT?.trim() || undefined,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicDomain,
    forcePathStyle: process.env.OSS_FORCE_PATH_STYLE?.trim().toLowerCase() === "true",
  };
}

async function downloadToFile(url: string, outputPath: string): Promise<void> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download clip HTTP ${res.status}: ${url}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  await writeFile(outputPath, bytes);
}

function toFfmpegConcatPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/'/g, "'\\''");
}

async function composeWithConcat(ffmpegPath: string, clipPaths: string[], listPath: string, outputPath: string): Promise<void> {
  await writeFile(listPath, clipPaths.map((clipPath) => `file '${toFfmpegConcatPath(clipPath)}'`).join("\n"), "utf8");
  await runFfmpeg(ffmpegPath, [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

async function composeWithXfade(
  ffmpegPath: string,
  clipPaths: string[],
  durations: number[],
  transitionSeconds: number,
  outputPath: string,
  audioPresence: boolean[],
): Promise<void> {
  const args = ["-y", ...clipPaths.flatMap((clipPath) => ["-i", clipPath])];
  const canCrossfadeAudio = audioPresence.every(Boolean);
  const safeDurations = clipPaths.map((_, index) => {
    const duration = Number(durations[index]);
    return Number.isFinite(duration) && duration > transitionSeconds * 2 ? duration : 5;
  });
  const filters: string[] = clipPaths.map((_, index) => `[${index}:v]setpts=PTS-STARTPTS,format=yuv420p[v${index}]`);
  let previousLabel = "v0";
  for (let index = 1; index < clipPaths.length; index += 1) {
    const outputLabel = index === clipPaths.length - 1 ? "outv" : `x${index}`;
    const previousDuration = safeDurations.slice(0, index).reduce((sum, value) => sum + value, 0) - transitionSeconds * (index - 1);
    const offset = Math.max(0, previousDuration - transitionSeconds);
    filters.push(`[${previousLabel}][v${index}]xfade=transition=fade:duration=${transitionSeconds}:offset=${offset.toFixed(3)}[${outputLabel}]`);
    previousLabel = outputLabel;
  }
  if (canCrossfadeAudio) {
    filters.push(...clipPaths.map((_, index) => `[${index}:a]asetpts=PTS-STARTPTS,aformat=sample_rates=44100:channel_layouts=stereo[a${index}]`));
    let previousAudioLabel = "a0";
    for (let index = 1; index < clipPaths.length; index += 1) {
      const outputAudioLabel = index === clipPaths.length - 1 ? "outa" : `ax${index}`;
      filters.push(`[${previousAudioLabel}][a${index}]acrossfade=d=${transitionSeconds}:c1=tri:c2=tri[${outputAudioLabel}]`);
      previousAudioLabel = outputAudioLabel;
    }
  }
  await runFfmpeg(ffmpegPath, [
    ...args,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[outv]",
    ...(canCrossfadeAudio ? ["-map", "[outa]"] : ["-an"]),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    ...(canCrossfadeAudio ? ["-c:a", "aac", "-b:a", "192k"] : []),
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

function composeTransitionSeconds(durations: number[] | undefined): number {
  const configured = Number(process.env.ONE_PROMPT_COMPOSE_TRANSITION_SECONDS ?? "0.35");
  if (!Number.isFinite(configured) || configured <= 0) return 0;
  const shortest: number = durations
    ?.filter((value) => Number.isFinite(value) && value > 0)
    .reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY) ?? Number.POSITIVE_INFINITY;
  const maxSafe = Number.isFinite(shortest) ? Math.max(0, shortest / 3) : configured;
  return Math.max(0, Math.min(configured, maxSafe, 1));
}

function runFfmpeg(ffmpegPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 6000) stderr = stderr.slice(-6000);
    });
    child.on("error", (error) => {
      reject(new Error(`Failed to start ffmpeg: ${error.message}. Install ffmpeg or configure FFMPEG_PATH.`));
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg composition failed with exit code ${code}: ${stderr}`));
    });
  });
}

function ffprobePathFor(ffmpegPath: string): string {
  const configured = process.env.FFPROBE_PATH?.trim();
  if (configured) return configured;
  if (ffmpegPath && ffmpegPath !== "ffmpeg") {
    const parsed = path.parse(ffmpegPath);
    return path.join(parsed.dir, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
  }
  return "ffprobe";
}

function probeClipHasAudio(ffmpegPath: string, clipPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ffprobePath = ffprobePathFor(ffmpegPath);
    const child = spawn(ffprobePath, [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_type",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      clipPath,
    ], { windowsHide: true });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => {
      resolve(code === 0 && stdout.includes("audio"));
    });
  });
}

async function uploadFileToOss(cfg: OssConfig, key: string, filePath: string): Promise<string> {
  const client = new S3Client({
    region: cfg.region,
    ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    forcePathStyle: cfg.forcePathStyle,
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  const body = await readFile(filePath);
  await client.send(new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    Body: body,
    ContentLength: body.length,
    ContentType: "video/mp4",
  }));
  return buildPublicUrl(cfg.publicDomain, key);
}

function buildPublicUrl(publicDomain: string, key: string): string {
  const base = publicDomain.replace(/\/+$/, "");
  const pathValue = key.split("/").map((seg) => encodeURIComponent(seg)).join("/");
  return `${base}/${pathValue}`;
}
