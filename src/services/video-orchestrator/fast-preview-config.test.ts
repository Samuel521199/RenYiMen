import assert from "node:assert/strict";
import test from "node:test";
import {
  isOnePromptVideoFastPreviewEnabled,
  readOnePromptVideoFastPreviewConfig,
} from "./fast-preview-config.ts";

test("fast preview is disabled unless explicitly requested", () => {
  assert.equal(isOnePromptVideoFastPreviewEnabled({ NODE_ENV: "development" }), false);
});

test("fast preview can be enabled in development and test", () => {
  assert.equal(isOnePromptVideoFastPreviewEnabled({
    NODE_ENV: "development",
    ONE_PROMPT_VIDEO_FAST_PREVIEW: "true",
  }), true);
  assert.equal(isOnePromptVideoFastPreviewEnabled({
    NODE_ENV: "test",
    ONE_PROMPT_VIDEO_FAST_PREVIEW: " TRUE ",
  }), true);
});

test("fast preview is fail-closed in production", () => {
  const config = readOnePromptVideoFastPreviewConfig({
    NODE_ENV: "production",
    ONE_PROMPT_VIDEO_FAST_PREVIEW: "true",
  });
  assert.equal(config.enabled, false);
  assert.equal(config.reason, "production_blocked");
});
