import assert from "node:assert/strict";
import test from "node:test";
import { estimateTalkingVideoSpeechDuration } from "./talking-video-speech-duration";

test("estimates a broad English speaking-time range from word count", () => {
  const estimate = estimateTalkingVideoSpeechDuration(
    "AI video will not replace creators. It helps us turn ideas into content faster.",
  );

  assert.equal(estimate.englishWords, 14);
  assert.equal(estimate.cjkCharacters, 0);
  assert.equal(estimate.minSeconds, 14 / 3);
  assert.equal(estimate.maxSeconds, 14 / 2);
});

test("combines English words and Chinese characters for mixed scripts", () => {
  const estimate = estimateTalkingVideoSpeechDuration("AI 视频正在改变创作方式");

  assert.equal(estimate.englishWords, 1);
  assert.equal(estimate.cjkCharacters, 10);
  assert.ok(estimate.minSeconds < estimate.maxSeconds);
});
