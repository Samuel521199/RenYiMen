import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readStoryRolloutConfig,
  shouldAttemptStoryRewrite,
  shouldEnableShotGrouping,
  shouldEvaluateStoryQuality,
  shouldRequireStoryQualityReview,
} from "./story-rollout-config";

test("story rollout defaults to off with shot grouping on and no auto rewrite", () => {
  const config = readStoryRolloutConfig({});

  assert.deepEqual(config, {
    storyGateMode: "off",
    storyRewriteMax: 0,
    shotGroupingMode: "on",
  });
  assert.equal(shouldEvaluateStoryQuality(config), false);
  assert.equal(shouldAttemptStoryRewrite(config), false);
  assert.equal(shouldRequireStoryQualityReview(config), false);
  assert.equal(shouldEnableShotGrouping(config), true);
});

test("story rollout can be disabled to recover legacy behavior", () => {
  const config = readStoryRolloutConfig({
    ONE_PROMPT_VIDEO_STORY_GATE: "off",
    ONE_PROMPT_VIDEO_STORY_REWRITE_MAX: "2",
    ONE_PROMPT_VIDEO_SHOT_GROUPING: "off",
  });

  assert.equal(config.storyGateMode, "off");
  assert.equal(config.storyRewriteMax, 2);
  assert.equal(config.shotGroupingMode, "off");
  assert.equal(shouldEvaluateStoryQuality(config), false);
  assert.equal(shouldAttemptStoryRewrite(config), false);
  assert.equal(shouldRequireStoryQualityReview(config), false);
  assert.equal(shouldEnableShotGrouping(config), false);
});

test("story rollout strict mode enables review blocking and bounded rewrites", () => {
  const config = readStoryRolloutConfig({
    ONE_PROMPT_VIDEO_STORY_GATE: "strict",
    ONE_PROMPT_VIDEO_STORY_REWRITE_MAX: "2",
    ONE_PROMPT_VIDEO_SHOT_GROUPING: "on",
  });

  assert.equal(config.storyGateMode, "strict");
  assert.equal(config.storyRewriteMax, 2);
  assert.equal(shouldEvaluateStoryQuality(config), true);
  assert.equal(shouldAttemptStoryRewrite(config), true);
  assert.equal(shouldRequireStoryQualityReview(config), true);
});

test("story rollout invalid values fall back to safe defaults", () => {
  const config = readStoryRolloutConfig({
    ONE_PROMPT_VIDEO_STORY_GATE: "force",
    ONE_PROMPT_VIDEO_STORY_REWRITE_MAX: "9",
    ONE_PROMPT_VIDEO_SHOT_GROUPING: "maybe",
  });

  assert.deepEqual(config, {
    storyGateMode: "off",
    storyRewriteMax: 0,
    shotGroupingMode: "on",
  });
});
