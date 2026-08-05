import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { parseTimedSubtitleCues } from "../providers/bailian-subtitle-service.ts";
import { buildAssSubtitle, renderVideoWithSubtitles } from "./video-subtitle-renderer.ts";

test("parseTimedSubtitleCues extracts and sorts sentence timestamps", () => {
  const cues = parseTimedSubtitleCues({
    transcripts: [{
      sentences: [
        { begin_time: 1800, end_time: 2600, text: "第二句" },
        { begin_time: 100, end_time: 1500, text: "第一句" },
        { begin_time: 900, end_time: 800, text: "无效时间" },
      ],
    }],
  });
  assert.deepEqual(cues, [
    { startMs: 100, endMs: 1500, text: "第一句" },
    { startMs: 1800, endMs: 2600, text: "第二句" },
  ]);
});

test("buildAssSubtitle creates timed, escaped, two-line subtitle events", () => {
  const output = buildAssSubtitle([{
    startMs: 100,
    endMs: 3820,
    text: "这是一段需要自动换行并且包含{特殊}字符的字幕内容",
  }]);
  assert.match(output, /Dialogue: 0,0:00:00\.10,0:00:03\.82/);
  assert.match(output, /\\N/);
  assert.doesNotMatch(output, /包含\{特殊\}/);
  assert.match(output, /Microsoft YaHei|Noto Sans CJK SC/);
});

const ffmpegExecutable = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const ffmpegAvailable = spawnSync(ffmpegExecutable, ["-version"], { windowsHide: true }).status === 0;

test("renderVideoWithSubtitles produces a playable MP4", { skip: !ffmpegAvailable }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "subtitle-render-test-"));
  const source = path.join(directory, "source.mp4");
  try {
    const generated = spawnSync(ffmpegExecutable, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=black:s=640x360:d=1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", source,
    ], { windowsHide: true });
    assert.equal(generated.status, 0, generated.stderr?.toString());
    const output = await renderVideoWithSubtitles(await readFile(source), [{ startMs: 0, endMs: 900, text: "字幕测试" }]);
    assert.ok(output.byteLength > 1_000);
    assert.equal(output.subarray(4, 8).toString("ascii"), "ftyp");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
