import assert from "node:assert/strict";
import test from "node:test";
import { GET as getSkuCatalog } from "../../app/api/skus/route";
import { bailianCameraReplicationWorkflowMock } from "../../mocks/bailian-camera-replication-workflow";
import { useWorkflowStore } from "../../store/useWorkflowStore";
import { resolveProviderCodeFromBody } from "./ProviderFactory";
import {
  BailianAdapter,
  BAILIAN_WAN27_VIDEO_EDIT_1080P_CREDITS_PER_SECOND,
  BAILIAN_WAN27_VIDEO_EDIT_720P_CREDITS_PER_SECOND,
} from "./BailianAdapter";
import { ProviderError, type StandardPayload } from "./types";

function cameraReplicationPayload(overrides: Record<string, unknown> = {}): StandardPayload {
  return {
    templateId: "bailian-wan2.7-camera-replication",
    nodeInputs: {
      input: {
        video_url: "https://cdn.example.com/camera-reference.mp4",
        video_duration: 8,
        image_urls: ["https://cdn.example.com/target-scene.png"],
        prompt: "将参考视频中的环绕跟拍运镜复刻到图1场景",
        resolution: "720P",
        audio_setting: "origin",
        ...overrides,
      },
    },
  };
}

test("camera replication SKU routes to Alibaba Model Studio and exposes the intended form", () => {
  assert.equal(
    resolveProviderCodeFromBody({ skuId: "BAILIAN_WAN27_CAMERA_REPLICATION" }),
    "ALIYUN_BAILIAN",
  );
  assert.equal(bailianCameraReplicationWorkflowMock.workflowId, "bailian-wan2.7-camera-replication");
  const group = bailianCameraReplicationWorkflowMock.fields[0];
  assert.equal(group.kind, "group");
  if (group.kind !== "group") return;
  const targetImages = group.children.find((field) => field.id === "targetImages");
  assert.equal(targetImages?.kind, "multiImageUpload");
  if (targetImages?.kind === "multiImageUpload") {
    assert.equal(targetImages.maxItems, 4);
    assert.equal(targetImages.validation?.required, true);
  }
});

test("camera replication catalog card uses its dedicated cover", async () => {
  const body = await (await getSkuCatalog()).json();
  const sku = body.skus.find((item: { skuId: string }) =>
    item.skuId === "BAILIAN_WAN27_CAMERA_REPLICATION"
  );
  assert.ok(sku);
  assert.equal(sku.cover, "/covers/camera-movement-replication.webp");
  assert.equal(sku.displayName, "运镜复刻");
  assert.equal(sku.providerCode, "ALIYUN_BAILIAN");
});

test("camera replication form maps uploaded media and instructions to the gateway payload", () => {
  const store = useWorkflowStore.getState();
  store.hydrateSchema(bailianCameraReplicationWorkflowMock);
  store.setGatewaySelection("BAILIAN_WAN27_CAMERA_REPLICATION", "ALIYUN_BAILIAN");
  store.setFieldValue("referenceVideo", {
    status: "ready",
    remoteUrl: "https://cdn.example.com/camera-reference.mp4",
    durationSec: 7,
  });
  store.setFieldValue("targetImages", {
    items: [{
      id: "target-1",
      status: "ready",
      remoteUrl: "https://cdn.example.com/target.png",
    }],
  });
  store.setFieldValue("replicationPrompt", "复刻参考视频中的升降运镜");

  assert.deepEqual(store.validate(), {});
  const payload = store.buildPayload();
  assert.ok(payload);
  assert.equal(payload.nodeInputs.input.video_url, "https://cdn.example.com/camera-reference.mp4");
  assert.equal(payload.nodeInputs.input.video_duration, 7);
  assert.deepEqual(payload.nodeInputs.input.image_urls, ["https://cdn.example.com/target.png"]);
  assert.equal(payload.nodeInputs.input.prompt, "复刻参考视频中的升降运镜");
});

test("Wan 2.7 camera replication builds the documented video and reference-image media list", () => {
  const body = new BailianAdapter().buildPayload(cameraReplicationPayload({
    image_urls: [
      "https://cdn.example.com/character.png",
      "https://cdn.example.com/scene.webp",
    ],
    resolution: "1080P",
  }));

  assert.deepEqual(body, {
    model: "wan2.7-videoedit",
    input: {
      prompt: "将参考视频中的环绕跟拍运镜复刻到图1场景",
      media: [
        { type: "video", url: "https://cdn.example.com/camera-reference.mp4" },
        { type: "reference_image", url: "https://cdn.example.com/character.png" },
        { type: "reference_image", url: "https://cdn.example.com/scene.webp" },
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

test("Wan 2.7 camera replication prices by source duration and caps it at 10 seconds", () => {
  const adapter = new BailianAdapter();
  assert.deepEqual(adapter.calculateCost(cameraReplicationPayload()), {
    cost: 8 * BAILIAN_WAN27_VIDEO_EDIT_720P_CREDITS_PER_SECOND,
    sellPrice: 8 * BAILIAN_WAN27_VIDEO_EDIT_720P_CREDITS_PER_SECOND,
  });
  assert.deepEqual(adapter.calculateCost(cameraReplicationPayload({ video_duration: 30, resolution: "1080P" })), {
    cost: 10 * BAILIAN_WAN27_VIDEO_EDIT_1080P_CREDITS_PER_SECOND,
    sellPrice: 10 * BAILIAN_WAN27_VIDEO_EDIT_1080P_CREDITS_PER_SECOND,
  });
});

test("Wan 2.7 camera replication requires a target reference image", () => {
  assert.throws(
    () => new BailianAdapter().buildPayload(cameraReplicationPayload({ image_urls: [] })),
    (error: unknown) => error instanceof ProviderError && error.code === "BAILIAN_MISSING_REFERENCE_IMAGE",
  );
});

test("Wan 2.7 camera replication settles usage at its model-specific rate", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    output: {
      task_status: "SUCCEEDED",
      video_url: "https://cdn.example.com/camera-replication.mp4",
    },
    usage: { duration: 6, SR: 1080 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    const result = await new BailianAdapter().queryTask("camera-replication-task", {
      apiKey: "test-key",
      baseUrl: "https://dashscope.example.com",
      skuId: "BAILIAN_WAN27_CAMERA_REPLICATION",
    });
    assert.equal(result.status, "succeeded");
    assert.equal(result.providerCost, 6 * BAILIAN_WAN27_VIDEO_EDIT_1080P_CREDITS_PER_SECOND);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
