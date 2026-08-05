import assert from "node:assert/strict";
import test from "node:test";
import { parseTimedSubtitleCues } from "../providers/bailian-subtitle-service.ts";
import { buildAssSubtitle } from "./video-subtitle-renderer.ts";

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
