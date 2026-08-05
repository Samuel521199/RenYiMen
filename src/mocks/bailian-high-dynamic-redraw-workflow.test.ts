import assert from "node:assert/strict";
import test from "node:test";
import { BailianAdapter } from "@/services/providers/BailianAdapter";
import { resolveProviderCodeFromBody } from "@/services/providers/ProviderFactory";
import { bailianHighDynamicRedrawWorkflowMock } from "./bailian-high-dynamic-redraw-workflow";

test("high-dynamic redraw exposes the Wan 2.7 video-edit input limits", () => {
  assert.equal(bailianHighDynamicRedrawWorkflowMock.workflowId, "wan2.7-videoedit");
  const group = bailianHighDynamicRedrawWorkflowMock.fields.find((field) => field.id === "inputGroup");
  assert.ok(group && group.kind === "group");

  const sourceVideo = group.children.find((field) => field.id === "sourceVideo");
  assert.ok(sourceVideo && sourceVideo.kind === "videoUpload");
  assert.ok(sourceVideo.validation);
  assert.equal(sourceVideo.validation.minDurationSec, 2);
  assert.equal(sourceVideo.validation.maxDurationSec, 10);

  const references = group.children.find((field) => field.id === "referenceImages");
  assert.ok(references && references.kind === "multiImageUpload");
  assert.equal(references.maxItems, 4);
  assert.equal(resolveProviderCodeFromBody({ skuId: "BAILIAN_HIGH_DYNAMIC_REDRAW" }), "ALIYUN_BAILIAN");
});

test("high-dynamic redraw builds the dedicated wan2.7-videoedit payload", () => {
  const adapter = new BailianAdapter();
  const payload = {
    templateId: "wan2.7-videoedit",
    nodeInputs: {
      input: {
        video_url: "https://example.com/source.mp4",
        reference_image_urls: ["https://example.com/style.png"],
        prompt: "改成厚涂动画风格，保留复杂动作、运动轨迹和镜头推进。",
        resolution: "720P",
        audio_setting: "origin",
        duration: 5,
      },
    },
  };

  assert.deepEqual(adapter.buildPayload(payload), {
    model: "wan2.7-videoedit",
    input: {
      prompt: "改成厚涂动画风格，保留复杂动作、运动轨迹和镜头推进。",
      media: [
        { type: "video", url: "https://example.com/source.mp4" },
        { type: "reference_image", url: "https://example.com/style.png" },
      ],
    },
    parameters: {
      resolution: "720P",
      watermark: false,
      audio_setting: "origin",
      prompt_extend: true,
    },
  });
  assert.deepEqual(adapter.calculateCost(payload), { cost: 1500, sellPrice: 1500 });
  const capabilities = adapter.getVideoInputCapabilities(payload);
  assert.equal(capabilities.modelId, "wan2.7-videoedit");
  assert.equal(capabilities.maxImages, 4);
  assert.equal(capabilities.maxPromptCharacters, 5000);
});

test("high-dynamic redraw settles from total billed input and output duration", async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      output: {
        task_status: "SUCCEEDED",
        video_url: "https://example.com/restyled.mp4",
      },
      usage: {
        duration: 10.04,
        input_video_duration: 5.02,
        output_video_duration: 5.02,
        SR: 720,
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

    const result = await new BailianAdapter().queryTask("high-dynamic-task", {
      apiKey: "test-key",
      baseUrl: "https://dashscope.example.com",
      skuId: "BAILIAN_HIGH_DYNAMIC_REDRAW",
    });
    assert.equal(result.status, "succeeded");
    assert.equal(result.providerDurationSec, 10.04);
    assert.equal(result.providerCost, 1506);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
