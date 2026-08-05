import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TimedSubtitleCue } from "@/services/providers/bailian-subtitle-service";

function assTime(milliseconds: number): string {
  const centiseconds = Math.max(0, Math.round(milliseconds / 10));
  const hours = Math.floor(centiseconds / 360_000);
  const minutes = Math.floor((centiseconds % 360_000) / 6_000);
  const seconds = Math.floor((centiseconds % 6_000) / 100);
  const fraction = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(fraction).padStart(2, "0")}`;
}

function visibleLength(value: string): number {
  return Array.from(value).reduce((total, char) => total + (/^[\x00-\xff]$/.test(char) ? 0.55 : 1), 0);
}

function wrapSubtitleText(value: string): string {
  const text = value.replace(/[{}\\]/g, (char) => ({ "{": "｛", "}": "｝", "\\": "＼" }[char] ?? char)).trim();
  if (visibleLength(text) <= 20) return text;
  const chars = Array.from(text);
  let score = 0;
  let bestIndex = Math.floor(chars.length / 2);
  const target = visibleLength(text) / 2;
  for (let index = 0; index < chars.length; index += 1) {
    score += /^[\x00-\xff]$/.test(chars[index]!) ? 0.55 : 1;
    if (score >= target) {
      bestIndex = index + 1;
      break;
    }
  }
  const punctuation = /[，。！？、；：,.!?;: ]/;
  for (let distance = 0; distance <= 6; distance += 1) {
    for (const candidate of [bestIndex + distance, bestIndex - distance]) {
      if (candidate > 0 && candidate < chars.length && punctuation.test(chars[candidate - 1]!)) {
        bestIndex = candidate;
        distance = 99;
        break;
      }
    }
  }
  return `${chars.slice(0, bestIndex).join("").trim()}\\N${chars.slice(bestIndex).join("").trim()}`;
}

export function buildAssSubtitle(cues: TimedSubtitleCue[]): string {
  const fontName = process.platform === "win32" ? "Microsoft YaHei" : "Noto Sans CJK SC";
  const events = cues.map((cue) =>
    `Dialogue: 0,${assTime(cue.startMs)},${assTime(Math.max(cue.endMs, cue.startMs + 500))},Default,,0,0,0,,${wrapSubtitleText(cue.text)}`
  );
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1920",
    "PlayResY: 1080",
    "ScaledBorderAndShadow: yes",
    "WrapStyle: 2",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${fontName},54,&H00FFFFFF,&H00FFFFFF,&HCC000000,&H88000000,-1,0,0,0,100,100,0,0,1,3,1,2,80,80,58,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}

function ffmpegFilterPath(filePath: string): string {
  return filePath
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

function runFfmpeg(args: string[]): Promise<void> {
  const executable = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 12_000) stderr = stderr.slice(-12_000);
    });
    child.once("error", (error) => reject(new Error(`无法启动 FFmpeg：${error.message}`)));
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`字幕视频合成失败（FFmpeg ${code}）：${stderr.trim()}`));
    });
  });
}

export async function renderVideoWithSubtitles(video: Buffer, cues: TimedSubtitleCue[]): Promise<Buffer> {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "renyimen-subtitles-"));
  const inputPath = path.join(tempDirectory, "source.mp4");
  const subtitlePath = path.join(tempDirectory, "captions.ass");
  const outputPath = path.join(tempDirectory, "captioned.mp4");
  try {
    await Promise.all([
      writeFile(inputPath, video),
      writeFile(subtitlePath, buildAssSubtitle(cues), "utf8"),
    ]);
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", inputPath,
      "-vf", `ass='${ffmpegFilterPath(subtitlePath)}'`,
      "-map", "0:v:0", "-map", "0:a?",
      "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart",
      outputPath,
    ]);
    return await readFile(outputPath);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}
