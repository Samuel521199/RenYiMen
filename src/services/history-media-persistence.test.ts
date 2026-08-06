import assert from "node:assert/strict";
import test from "node:test";
import { persistTemporaryHistoryVideo, persistTemporaryPollVideo } from "./history-media-persistence";

const temporaryUrl = "https://dashscope-result.oss-cn-beijing.aliyuncs.com/a.mp4?Expires=1&OSSAccessKeyId=x&Signature=y";

test("persists a temporary DashScope video using a stable OSS key", async () => {
  let key = "";
  const result = await persistTemporaryHistoryVideo({
    userId: "user-1",
    taskId: "task-1",
    resultUrl: temporaryUrl,
    mediaType: "video",
    persistMedia: async (input) => {
      key = input.key;
      return "https://media.example.com/generation-history/user-1/task-1.mp4";
    },
  });
  assert.equal(key, "generation-history/user-1/task-1.mp4");
  assert.equal(result, "https://media.example.com/generation-history/user-1/task-1.mp4");
});

test("replaces the client poll URL after persistence", async () => {
  const result = await persistTemporaryPollVideo({
    userId: "user-1",
    taskId: "task-1",
    pollData: { status: "succeeded", resultUrl: temporaryUrl, resultMediaType: "video" },
    persistMedia: async () => "https://media.example.com/video.mp4",
  });
  assert.equal(result.resultUrl, "https://media.example.com/video.mp4");
});

test("does not copy permanent or non-video results", async () => {
  let calls = 0;
  const persistMedia = async () => {
    calls += 1;
    return "unexpected";
  };
  assert.equal(await persistTemporaryHistoryVideo({
    userId: "u",
    taskId: "t",
    resultUrl: "https://media.example.com/video.mp4",
    mediaType: "video",
    persistMedia,
  }), "https://media.example.com/video.mp4");
  assert.equal(await persistTemporaryHistoryVideo({
    userId: "u",
    taskId: "t",
    resultUrl: temporaryUrl,
    mediaType: "image",
    persistMedia,
  }), temporaryUrl);
  assert.equal(calls, 0);
});
