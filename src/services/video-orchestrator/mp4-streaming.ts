import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function mp4TopLevelAtoms(buffer: Buffer): Array<{
  type: string;
  offset: number;
  size: number;
}> {
  const atoms: Array<{ type: string; offset: number; size: number }> = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("latin1");
    if (size === 1) {
      if (offset + 16 > buffer.length) break;
      const extended = buffer.readBigUInt64BE(offset + 8);
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(extended);
    } else if (size === 0) {
      size = buffer.length - offset;
    }
    if (size < 8 || offset + size > buffer.length) break;
    atoms.push({ type, offset, size });
    offset += size;
  }
  return atoms;
}

export function isFastStartMp4(buffer: Buffer): boolean {
  const atoms = mp4TopLevelAtoms(buffer);
  const moov = atoms.find((atom) => atom.type === "moov");
  const mdat = atoms.find((atom) => atom.type === "mdat");
  return Boolean(moov && mdat && moov.offset < mdat.offset);
}

export async function optimizeMp4ForStreaming(
  buffer: Buffer,
  ffmpegPath = process.env.FFMPEG_PATH?.trim() || "ffmpeg",
): Promise<Buffer> {
  if (isFastStartMp4(buffer)) return buffer;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "one-prompt-mp4-"));
  const inputPath = path.join(tempDir, "input.mp4");
  const outputPath = path.join(tempDir, "faststart.mp4");
  try {
    await writeFile(inputPath, buffer);
    await runFfmpeg(ffmpegPath, [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-i", inputPath,
      "-map", "0",
      "-c", "copy",
      "-movflags", "+faststart",
      outputPath,
    ]);
    const optimized = await readFile(outputPath);
    if (!isFastStartMp4(optimized)) {
      throw new Error("FFmpeg completed but MP4 metadata is still not streamable");
    }
    return optimized;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function runFfmpeg(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 8_000) stderr = stderr.slice(-8_000);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`MP4 fast-start remux failed (${code}): ${stderr.trim()}`));
    });
  });
}
