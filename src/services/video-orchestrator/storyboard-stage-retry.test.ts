import assert from "node:assert/strict";
import test from "node:test";
import {
  StoryboardStageError,
  isRetryableStoryboardStageError,
  runStoryboardStageWithRetry,
  storyboardStageHttpStatus,
} from "./storyboard-stage-retry";
import { mergeTargetedShotDecomposerRepair, normalizeAliyunStoryboardPlannerCheckpoint } from "./three-stage-planner";

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
  assert.equal(isRetryableStoryboardStageError(new StoryboardStageError("invalid model contract", {
    code: "contract_validation_error",
    retryable: true,
  })), true);
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
      approvedShotDecomposerSegmentPlans: { "4": { approved: true } },
      promptDetailSegmentPlans: {
        "4": {
          segmentVideoPrompts: [{ segmentNo: 4, videoPromptZh: "连续镜头" }],
        },
      },
    },
  };
  const resumed = normalizeAliyunStoryboardPlannerCheckpoint(stored, input);
  assert.deepEqual(resumed.planningRaw, { ok: true });
  assert.deepEqual(resumed.shotDecomposerSegmentPlans?.["4"], { segment: 4 });
  assert.deepEqual(resumed.approvedShotDecomposerSegmentPlans?.["4"], { approved: true });
  assert.equal(resumed.promptDetailSegmentPlans?.["4"]?.segmentVideoPrompts?.[0]?.segmentNo, 4);

  const changed = normalizeAliyunStoryboardPlannerCheckpoint(stored, { ...input, userPrompt: "修改后的游戏广告" });
  assert.equal(changed.planningRaw, undefined);
  assert.deepEqual(changed.shotDecomposerSegmentPlans, {});
  assert.deepEqual(changed.approvedShotDecomposerSegmentPlans, {});
  assert.deepEqual(changed.promptDetailSegmentPlans, {});
});

test("legacy planner checkpoints are invalidated when the prompt contract version changes", () => {
  const input = {
    userPrompt: "一个产品广告",
    aspectRatio: "9:16" as const,
    durationSeconds: 45,
    referenceImageUrls: [],
  };
  const current = normalizeAliyunStoryboardPlannerCheckpoint(undefined, input);
  const legacy = normalizeAliyunStoryboardPlannerCheckpoint({
    plannerCheckpoint: {
      ...current,
      version: 1,
      planningRaw: { stale: true },
      shotDecomposerSegmentPlans: { "1": { stale: true } },
    },
  }, input);

  assert.equal(legacy.version, 8);
  assert.equal(legacy.planningRaw, undefined);
  assert.deepEqual(legacy.shotDecomposerSegmentPlans, {});
});

test("targeted split repair merges partial fields without deleting the approved segment contracts", () => {
  const original = {
    segments: [{
      segment_no: 5,
      purpose_zh: "CTA",
      duration_seconds: 6,
      subject_motion: "Logo fade in",
      motion: "Logo fade in over the table",
    }],
    keyframes: [{ keyframe_no: 5 }, { keyframe_no: 6 }],
    segment_render_descriptions: [{
      segment_no: 5,
      start_frame_contract: { state: "牌桌空镜" },
      end_frame_contract: { state: "品牌结尾" },
      motion_contract: { path: "镜头连续推进" },
      single_take_contract: { requires_cut: false, subject_path: "Logo fade in" },
      video_prompt_contract: { motion_steps: ["Logo fade in"] },
    }],
  };
  const repair = {
    segments: [{
      segment_no: 5,
      subject_motion: "实体品牌牌从桌后连续滑入画面",
      motion: "镜头连续推进，实体品牌牌从桌后滑入并保持静止",
    }],
    segment_render_descriptions: [{
      segment_no: 5,
    }],
  };

  const merged = mergeTargetedShotDecomposerRepair(original, repair, [5]);
  const description = (merged.segment_render_descriptions as Array<Record<string, unknown>>)[0];
  assert.equal((merged.segments as unknown[]).length, 1);
  assert.equal((merged.keyframes as unknown[]).length, 2);
  assert.deepEqual(description.start_frame_contract, { state: "牌桌空镜" });
  assert.deepEqual(description.motion_contract, { path: "镜头连续推进", subject_motion: "镜头连续推进，实体品牌牌从桌后滑入并保持静止" });
  assert.deepEqual(description.single_take_contract, { requires_cut: false, subject_path: "镜头连续推进，实体品牌牌从桌后滑入并保持静止" });
  assert.deepEqual(description.video_prompt_contract, { motion_steps: ["镜头连续推进，实体品牌牌从桌后滑入并保持静止"] });
});
