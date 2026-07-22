import assert from "node:assert/strict";
import test from "node:test";
import {
  StoryboardStageError,
  isRetryableStoryboardStageError,
  runStoryboardStageWithRetry,
  storyboardStageHttpStatus,
} from "./storyboard-stage-retry";
import { normalizeAliyunStoryboardPlannerCheckpoint } from "./three-stage-planner";

test("shot decomposer retry only reruns the failed stage", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const result = await runStoryboardStageWithRetry({
    stage: "shot_decomposer_s4",
    maxAttempts: 3,
    baseDelayMs: 2000,
    run: async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new StoryboardStageError("first chunk timeout", {
          code: "first_chunk_timeout",
          retryable: true,
        });
      }
      return "segment-4";
    },
    sleep: async (delayMs) => { delays.push(delayMs); },
  });

  assert.equal(result, "segment-4");
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [2000, 4000]);
});

test("non-retryable upstream errors fail immediately", async () => {
  let attempts = 0;
  await assert.rejects(() => runStoryboardStageWithRetry({
    stage: "shot_decomposer_s2",
    maxAttempts: 3,
    baseDelayMs: 0,
    run: async () => {
      attempts += 1;
      throw new StoryboardStageError("bad request", {
        code: "upstream_http_error",
        retryable: false,
        httpStatus: 400,
      });
    },
  }), /bad request/);
  assert.equal(attempts, 1);
});

test("network failures are retryable but ordinary validation errors are not", () => {
  assert.equal(isRetryableStoryboardStageError(new Error("fetch failed: ECONNRESET")), true);
  assert.equal(isRetryableStoryboardStageError(new Error("invalid storyboard JSON")), false);
});

test("timeouts and upstream failures use gateway status codes", () => {
  assert.equal(storyboardStageHttpStatus(new StoryboardStageError("timeout", {
    code: "first_chunk_timeout",
    retryable: true,
  })), 504);
  assert.equal(storyboardStageHttpStatus(new StoryboardStageError("busy", {
    code: "upstream_http_error",
    retryable: true,
    httpStatus: 503,
  })), 503);
  assert.equal(storyboardStageHttpStatus(new Error("invalid local input")), 400);
});

test("planner checkpoints are reused only when the input fingerprint matches", () => {
  const input = {
    userPrompt: "一个游戏广告",
    aspectRatio: "9:16" as const,
    durationSeconds: 30,
    referenceImageUrls: ["https://example.com/reference.png"],
  };
  const initial = normalizeAliyunStoryboardPlannerCheckpoint(undefined, input);
  const stored = {
    plannerCheckpoint: {
      ...initial,
      planningRaw: { ok: true },
      shotDecomposerSegmentPlans: { "4": { segment: 4 } },
    },
  };
  const resumed = normalizeAliyunStoryboardPlannerCheckpoint(stored, input);
  assert.deepEqual(resumed.planningRaw, { ok: true });
  assert.deepEqual(resumed.shotDecomposerSegmentPlans?.["4"], { segment: 4 });

  const changed = normalizeAliyunStoryboardPlannerCheckpoint(stored, { ...input, userPrompt: "修改后的游戏广告" });
  assert.equal(changed.planningRaw, undefined);
  assert.deepEqual(changed.shotDecomposerSegmentPlans, {});
});
