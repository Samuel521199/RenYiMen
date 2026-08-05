import assert from "node:assert/strict";
import test from "node:test";
import { BailianAdapter } from "@/services/providers/BailianAdapter";
import { resolveProviderCodeFromBody } from "@/services/providers/ProviderFactory";
import { bailianOverallStyleTransferWorkflowMock } from "./bailian-overall-style-transfer-workflow";

test("overall style transfer exposes the requested presets and provider route", () => {
  const group = bailianOverallStyleTransferWorkflowMock.fields.find((field) => field.id === "inputGroup");
  assert.ok(group && group.kind === "group");

  const style = group.children.find((field) => field.id === "targetStyle");
  assert.ok(style && style.kind === "select");
  assert.deepEqual(
    style.options.map((option) => option.label),
    ["真人变动画", "写实变国风", "黏土动画", "水彩", "赛博朋克"],
  );
  assert.equal(resolveProviderCodeFromBody({ skuId: "BAILIAN_OVERALL_STYLE_TRANSFER" }), "ALIYUN_BAILIAN");
});

test("overall style transfer composes the preset and optional direction for video edit", () => {
  const payload = new BailianAdapter().buildPayload({
    templateId: "happyhorse-1.0-video-edit",
    nodeInputs: {
      input: {
        video_url: "https://example.com/source.mp4",
        style_prompt: "将整段视频统一转换为手绘水彩风格。",
        prompt: "保留人物服装配色。",
        resolution: "720P",
        audio_setting: "origin",
      },
    },
  });

  assert.equal(payload.model, "happyhorse-1.0-video-edit");
  if (payload.model !== "happyhorse-1.0-video-edit") throw new Error("unexpected model");
  assert.equal(payload.input.prompt, "将整段视频统一转换为手绘水彩风格。\n保留人物服装配色。");
});

test("overall style transfer submits a selected preset only once when details are empty", () => {
  const payload = new BailianAdapter().buildPayload({
    templateId: "happyhorse-1.0-video-edit",
    nodeInputs: {
      input: {
        video_url: "https://example.com/source.mp4",
        style_prompt: "将整段视频统一转换为精致黏土动画风格。",
        prompt: "",
      },
    },
  });

  if (payload.model !== "happyhorse-1.0-video-edit") throw new Error("unexpected model");
  assert.equal(payload.input.prompt, "将整段视频统一转换为精致黏土动画风格。");
});
