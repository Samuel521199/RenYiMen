import assert from "node:assert/strict";
import test from "node:test";
import { GET as getSkuCatalog } from "../../app/api/skus/route";
import { bailianEffectReplicationWorkflowMock } from "../../mocks/bailian-effect-replication-workflow";
import { resolveProviderCodeFromBody } from "./ProviderFactory";
import {
  BailianAdapter,
  BAILIAN_WAN27_VIDEO_EDIT_1080P_CREDITS_PER_SECOND,
  BAILIAN_WAN27_VIDEO_EDIT_720P_CREDITS_PER_SECOND,
} from "./BailianAdapter";
import { ProviderError, type StandardPayload } from "./types";

function effectReplicationPayload(overrides: Record<string, unknown> = {}): StandardPayload {
  return {
    templateId: "bailian-wan2.7-effect-replication",
    nodeInputs: {
      input: {
        video_url: "https://cdn.example.com/fire-effect.mp4",
        video_duration: 6,
        image_url: "https://cdn.example.com/target-character.png",
        prompt: "参考视频中的火焰和粒子特效，将特效应用到图片中的人物身上",
        resolution: "720P",
        audio_setting: "auto",
        ...overrides,
      },
    },
  };
}

test("effect replication SKU routes to Alibaba Model Studio and exposes the required media fields", () => {
  assert.equal(
    resolveProviderCodeFromBody({ skuId: "BAILIAN_WAN27_EFFECT_REPLICATION" }),
    "ALIYUN_BAILIAN",
  );
  assert.equal(bailianEffectReplicationWorkflowMock.workflowId, "bailian-wan2.7-effect-replication");
  const fields = bailianEffectReplicationWorkflowMock.fields[0];
  assert.equal(fields.kind, "group");
  if (fields.kind !== "group") return;
  assert.equal(fields.children.find((field) => field.id === "effectReferenceVideo")?.kind, "videoUpload");
  assert.equal(fields.children.find((field) => field.id === "targetCharacterImage")?.kind, "imageUpload");
});

test("effect replication catalog card intentionally leaves its cover unset", async () => {
  const body = await (await getSkuCatalog()).json();
  const sku = body.skus.find((item: { skuId: string }) =>
    item.skuId === "BAILIAN_WAN27_EFFECT_REPLICATION"
  );
  assert.ok(sku);
  assert.equal(sku.cover, undefined);
  assert.equal(sku.displayName, "特效复刻");
  assert.equal(sku.providerCode, "ALIYUN_BAILIAN");
});

test("wan2.7 effect replication builds the documented video and target-image media list", () => {
  const body = new BailianAdapter().buildPayload(effectReplicationPayload({
    resolution: "1080P",
    audio_setting: "origin",
  }));

  assert.deepEqual(body, {
    model: "wan2.7-videoedit",
    input: {
      prompt: "参考视频中的火焰和粒子特效，将特效应用到图片中的人物身上",
      media: [
        { type: "video", url: "https://cdn.example.com/fire-effect.mp4" },
        { type: "reference_image", url: "https://cdn.example.com/target-character.png" },
      ],
    },
    parameters: {
      resolution: "1080P",
      watermark: false,
      audio_setting: "origin",
      prompt_extend: true,
    },
  });
});

test("wan2.7 effect replication estimates credits using the selected resolution", () => {
  const adapter = new BailianAdapter();
  assert.deepEqual(adapter.calculateCost(effectReplicationPayload()), {
    cost: 6 * BAILIAN_WAN27_VIDEO_EDIT_720P_CREDITS_PER_SECOND,
    sellPrice: 6 * BAILIAN_WAN27_VIDEO_EDIT_720P_CREDITS_PER_SECOND,
  });
  assert.deepEqual(adapter.calculateCost(effectReplicationPayload({ resolution: "1080P" })), {
    cost: 6 * BAILIAN_WAN27_VIDEO_EDIT_1080P_CREDITS_PER_SECOND,
    sellPrice: 6 * BAILIAN_WAN27_VIDEO_EDIT_1080P_CREDITS_PER_SECOND,
  });
});

test("wan2.7 effect replication rejects requests without a target character image", () => {
  assert.throws(
    () => new BailianAdapter().buildPayload(effectReplicationPayload({ image_url: "" })),
    (error: unknown) => error instanceof ProviderError && error.code === "BAILIAN_MISSING_REFERENCE_IMAGE",
  );
});

test("wan2.7 effect replication settles usage at its model-specific rate", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    output: {
      task_status: "SUCCEEDED",
      video_url: "https://cdn.example.com/effect-replica.mp4",
    },
    usage: { duration: 12, SR: 1080 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    const result = await new BailianAdapter().queryTask("effect-replication-task", {
      apiKey: "test-key",
      baseUrl: "https://dashscope.example.com",
      skuId: "BAILIAN_WAN27_EFFECT_REPLICATION",
    });
    assert.equal(result.status, "succeeded");
    assert.equal(result.providerCost, 12 * BAILIAN_WAN27_VIDEO_EDIT_1080P_CREDITS_PER_SECOND);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
