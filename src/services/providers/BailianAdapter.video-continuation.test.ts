import assert from "node:assert/strict";
import test from "node:test";

import { GET as getSkuCatalog } from "../../app/api/skus/route";
import { bailianVideoContinuationWorkflowMock } from "../../mocks/bailian-video-continuation-workflow";
import { useWorkflowStore } from "../../store/useWorkflowStore";
import { BailianAdapter } from "./BailianAdapter";
import { resolveProviderCodeFromBody } from "./ProviderFactory";
import { ProviderError, type StandardPayload } from "./types";

function continuationPayload(
  input: Record<string, unknown>,
): StandardPayload {
  return {
    templateId: "bailian-wan2.7-video-continuation",
    nodeInputs: { input },
  };
}

test("video continuation schema exposes natural, instruction and last-frame modes", () => {
  const group = bailianVideoContinuationWorkflowMock.fields[0];
  assert.equal(group.kind, "group");
  if (group.kind !== "group") return;

  const mode = group.children.find((field) => field.id === "continuationMode");
  const firstClip = group.children.find((field) => field.id === "firstClip");
  const instructionPrompt = group.children.find((field) => field.id === "instructionPrompt");
  const lastFrame = group.children.find((field) => field.id === "lastFrame");
  const lastFramePrompt = group.children.find((field) => field.id === "lastFramePrompt");
  const duration = group.children.find((field) => field.id === "duration");

  assert.ok(mode && mode.kind === "select");
  assert.deepEqual(mode.options.map((option) => option.value), ["natural", "instruction", "last_frame"]);
  assert.ok(firstClip && firstClip.kind === "videoUpload");
  assert.equal(firstClip.validation?.minDurationSec, 2);
  assert.equal(firstClip.validation?.maxDurationSec, 10);
  assert.ok(instructionPrompt && instructionPrompt.kind === "textInput");
  assert.deepEqual(instructionPrompt.visibleWhen, { fieldId: "continuationMode", equals: "instruction" });
  assert.equal(instructionPrompt.validation?.required, true);
  assert.ok(lastFrame && lastFrame.kind === "imageUpload");
  assert.deepEqual(lastFrame.visibleWhen, { fieldId: "continuationMode", equals: "last_frame" });
  assert.equal(lastFrame.validation?.required, true);
  assert.ok(lastFramePrompt && lastFramePrompt.kind === "textInput");
  assert.deepEqual(lastFramePrompt.visibleWhen, { fieldId: "continuationMode", equals: "last_frame" });
  assert.ok(duration && duration.kind === "numberSlider");
  assert.equal(duration.validation.greaterThanMediaDurationFieldId, "firstClip");
});

test("natural video continuation sends first_clip without an instruction prompt", () => {
  const body = new BailianAdapter().buildPayload(continuationPayload({
    continuation_mode: "natural",
    first_clip_url: "https://example.com/source.mp4",
    prompt: "This must be ignored in natural mode.",
    duration: 12,
    resolution: "720P",
  }));

  assert.equal(body.model, "wan2.7-i2v-2026-04-25");
  assert.ok("media" in body.input);
  assert.deepEqual(body.input.media, [
    { type: "first_clip", url: "https://example.com/source.mp4" },
  ]);
  assert.equal(body.input.prompt, "");
  assert.equal(body.parameters?.duration, 12);
  assert.equal(body.parameters?.resolution, "720P");
});

test("instruction continuation requires and sends the requested next action", () => {
  const adapter = new BailianAdapter();
  assert.throws(
    () => adapter.buildPayload(continuationPayload({
      continuation_mode: "instruction",
      first_clip_url: "https://example.com/source.mp4",
      duration: 12,
    })),
    (error: unknown) => error instanceof ProviderError
      && error.code === "BAILIAN_MISSING_CONTINUATION_PROMPT",
  );

  const body = adapter.buildPayload(continuationPayload({
    continuation_mode: "instruction",
    first_clip_url: "https://example.com/source.mp4",
    prompt: "The character turns around while the camera slowly pushes in.",
    duration: 12,
  }));
  assert.ok("media" in body.input);
  assert.equal(body.input.prompt, "The character turns around while the camera slowly pushes in.");
  assert.deepEqual(body.input.media, [
    { type: "first_clip", url: "https://example.com/source.mp4" },
  ]);
});

test("last-frame continuation sends first_clip and last_frame", () => {
  const body = new BailianAdapter().buildPayload(continuationPayload({
    continuation_mode: "last_frame",
    first_clip_url: "https://example.com/source.mov",
    last_frame_url: "https://example.com/ending.webp",
    duration: 15,
    resolution: "1080P",
  }));

  assert.ok("media" in body.input);
  assert.deepEqual(body.input.media, [
    { type: "first_clip", url: "https://example.com/source.mov" },
    { type: "last_frame", url: "https://example.com/ending.webp" },
  ]);
});

test("last-frame continuation rejects a missing target frame", () => {
  assert.throws(
    () => new BailianAdapter().buildPayload(continuationPayload({
      continuation_mode: "last_frame",
      first_clip_url: "https://example.com/source.mp4",
      duration: 12,
    })),
    (error: unknown) => error instanceof ProviderError
      && error.code === "BAILIAN_MISSING_LAST_FRAME_URL",
  );
});

test("video continuation SKU resolves through the Bailian provider", () => {
  assert.equal(
    resolveProviderCodeFromBody({ skuId: "BAILIAN_WAN27_VIDEO_CONTINUATION" }),
    "ALIYUN_BAILIAN",
  );
});

test("video continuation catalog card uses its dedicated cover", async () => {
  const body = await (await getSkuCatalog()).json();
  const sku = body.skus.find((item: { skuId: string }) =>
    item.skuId === "BAILIAN_WAN27_VIDEO_CONTINUATION"
  );
  assert.ok(sku);
  assert.equal(sku.cover, "/covers/video-continuation.webp");
  assert.equal(sku.providerCode, "ALIYUN_BAILIAN");
  const mode = sku.uiSchema.fields[0].children.find(
    (field: { id: string }) => field.id === "continuationMode",
  );
  assert.deepEqual(
    mode.options.map((option: { value: string }) => option.value),
    ["natural", "instruction", "last_frame"],
  );
});

test("workflow validation activates the target last frame only in last-frame mode", () => {
  const store = useWorkflowStore.getState();
  store.hydrateSchema(bailianVideoContinuationWorkflowMock);
  store.setGatewaySelection("BAILIAN_WAN27_VIDEO_CONTINUATION", "ALIYUN_BAILIAN");
  store.setFieldValue("firstClip", {
    status: "ready",
    remoteUrl: "https://example.com/source.mp4",
    durationSec: 6,
  });

  assert.deepEqual(store.validate(), {});
  const standardPayload = store.buildPayload();
  assert.ok(standardPayload);
  assert.equal(standardPayload.nodeInputs.input.first_clip_url, "https://example.com/source.mp4");
  assert.equal(standardPayload.nodeInputs.input.last_frame_url, undefined);
  assert.equal(standardPayload.nodeInputs.input.prompt, undefined);

  store.setFieldValue("continuationMode", "instruction");
  assert.ok(store.validate().instructionPrompt);
  store.setFieldValue("instructionPrompt", "人物继续向前走，镜头缓慢推近。");
  assert.deepEqual(store.validate(), {});
  assert.equal(
    store.buildPayload()?.nodeInputs.input.prompt,
    "人物继续向前走，镜头缓慢推近。",
  );

  store.setFieldValue("continuationMode", "last_frame");
  assert.equal(store.validate().lastFrame, "请完成图片上传");
  store.setFieldValue("lastFrame", {
    status: "ready",
    remoteUrl: "https://example.com/ending.webp",
  });
  store.setFieldValue("lastFramePrompt", "人物走向门口，最终停在目标画面。");
  assert.deepEqual(store.validate(), {});
  assert.equal(
    store.buildPayload()?.nodeInputs.input.last_frame_url,
    "https://example.com/ending.webp",
  );
  assert.equal(
    store.buildPayload()?.nodeInputs.input.prompt,
    "人物走向门口，最终停在目标画面。",
  );

  store.setFieldValue("duration", 6);
  assert.match(store.validate().duration, /必须大于原视频时长/);
});
