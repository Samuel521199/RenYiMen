import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { extractAudioFromVideo } from "./audio-extraction";

const ffmpegPath = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const ffmpegAvailable = spawnSync(ffmpegPath, ["-version"], { windowsHide: true }).status === 0;

test("extractAudioFromVideo creates a playable MP3 from a video audio stream", { skip: !ffmpegAvailable }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "audio-extraction-test-"));
  const videoPath = path.join(tempDir, "source.mp4");
  try {
    const generated = spawnSync(ffmpegPath, [
      "-y",
      "-f", "lavfi", "-i", "color=c=black:s=320x180:r=24:d=1",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
      "-shortest",
      "-c:v", "libx264",
      "-c:a", "aac",
      "-pix_fmt", "yuv420p",
      videoPath,
    ], { windowsHide: true, encoding: "utf8" });
    assert.equal(generated.status, 0, generated.stderr);
    const video = await readFile(videoPath);
    let uploaded: Buffer | undefined;

    const result = await extractAudioFromVideo(
      "https://media.example.com/source.mp4",
      "mp3",
      "test-task",
      {
        fetchImpl: async () => new Response(video, {
          status: 200,
          headers: { "content-type": "video/mp4", "content-length": String(video.byteLength) },
        }),
        uploadOutput: async ({ body }) => {
          uploaded = body;
          return "https://media.example.com/audio/test-task.mp3";
        },
      },
    );

    assert.equal(result.url, "https://media.example.com/audio/test-task.mp3");
    assert.equal(result.format, "mp3");
    assert.equal(result.codec, "mp3");
    assert.ok(result.bytes > 1_000);
    assert.ok(uploaded && uploaded.byteLength === result.bytes);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("extractAudioFromVideo reports videos without an audio stream", { skip: !ffmpegAvailable }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "audio-extraction-silent-test-"));
  const videoPath = path.join(tempDir, "silent.mp4");
  try {
    const generated = spawnSync(ffmpegPath, [
      "-y",
      "-f", "lavfi", "-i", "color=c=black:s=320x180:r=24:d=1",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-an",
      videoPath,
    ], { windowsHide: true, encoding: "utf8" });
    assert.equal(generated.status, 0, generated.stderr);
    const video = await readFile(videoPath);

    await assert.rejects(
      extractAudioFromVideo(
        "https://media.example.com/silent.mp4",
        "mp3",
        "silent-test-task",
        {
          fetchImpl: async () => new Response(video, {
            status: 200,
            headers: { "content-type": "video/mp4", "content-length": String(video.byteLength) },
          }),
          uploadOutput: async () => {
            throw new Error("must not upload");
          },
        },
      ),
      /该视频不包含可提取的音轨/,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
