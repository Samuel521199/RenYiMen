import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Read the duration of a public audio/video URL without downloading it into application memory. */
export async function probeRemoteMediaDurationSeconds(mediaUrl: string): Promise<number> {
  if (!/^https?:\/\//i.test(mediaUrl)) throw new Error("媒体地址不是有效的公网 URL");
  const ffprobePath = process.env.FFPROBE_PATH?.trim() || ffprobePathFor(process.env.FFMPEG_PATH?.trim());
  let stdout: string;
  try {
    const result = await execFileAsync(ffprobePath, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "json",
      mediaUrl,
    ], { windowsHide: true, timeout: 60_000, maxBuffer: 1024 * 1024 });
    stdout = result.stdout;
  } catch (error) {
    throw new Error(`无法读取生成音频的时长：${processErrorMessage(error)}`);
  }
  const parsed = JSON.parse(stdout) as { format?: { duration?: string | number } };
  const duration = Number(parsed.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("生成音频没有有效时长");
  return duration;
}

function ffprobePathFor(ffmpegPath: string | undefined): string {
  if (ffmpegPath && ffmpegPath !== "ffmpeg") {
    const parsed = path.parse(ffmpegPath);
    return path.join(parsed.dir, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
  }
  return "ffprobe";
}

function processErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const record = error as { stderr?: unknown; message?: unknown };
  const stderr = typeof record.stderr === "string" ? record.stderr.trim() : "";
  if (stderr) return stderr.slice(-800);
  return typeof record.message === "string" ? record.message : "unknown error";
}
