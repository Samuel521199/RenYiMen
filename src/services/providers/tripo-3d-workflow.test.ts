import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { bailianTripo3dWorkflowMock } from "../../mocks/bailian-tripo-3d-workflow.ts";
import { buildFieldPathMap, buildInitialParameters, isWorkflowFieldVisible, iterateLeafFields, resolveNumberInputMax } from "../../lib/workflow-utils.ts";
import { BailianAdapter } from "./BailianAdapter.ts";
import { ProviderError, type StandardPayload } from "./types.ts";
import { useWorkflowStore } from "../../store/useWorkflowStore.ts";

function payload(input: Record<string, unknown>): StandardPayload {
  return {
    templateId: "bailian-tripo-3d",
    nodeInputs: { input },
  };
}

test("Tripo workflow registers the model category and three mutually exclusive input modes", () => {
  const catalog = readFileSync(path.join(process.cwd(), "src/app/api/skus/route.ts"), "utf8");
  const studio = readFileSync(path.join(process.cwd(), "src/components/WorkflowForm/WorkflowStudio.tsx"), "utf8");
  assert.match(catalog, /skuId: "BAILIAN_TRIPO_3D"/);
  assert.match(catalog, /category: "model"/);
  assert.match(studio, /key: "model"/);

  const leaves = [...iterateLeafFields(bailianTripo3dWorkflowMock.fields)];
  const mode = leaves.find((field) => field.id === "generationMode");
  assert.ok(mode && mode.kind === "select");
  assert.deepEqual(mode.options.map((option) => option.value), ["text", "single_image", "multi_image"]);

  const parameters = buildInitialParameters(bailianTripo3dWorkflowMock);
  const fieldPaths = buildFieldPathMap(bailianTripo3dWorkflowMock.fields);
  assert.equal(isWorkflowFieldVisible(leaves.find((field) => field.id === "prompt")!, parameters, fieldPaths), true);
  assert.equal(isWorkflowFieldVisible(leaves.find((field) => field.id === "singleImage")!, parameters, fieldPaths), false);
  assert.equal(isWorkflowFieldVisible(leaves.find((field) => field.id === "multiImages")!, parameters, fieldPaths), false);

  const faceLimit = leaves.find((field) => field.id === "faceLimit");
  assert.ok(faceLimit && faceLimit.kind === "numberInput");
  assert.equal(faceLimit.validation.max, 2_000_000);
  assert.deepEqual(faceLimit.presets?.map((preset) => preset.value), [20_000, 100_000, 500_000, 1_000_000, 1_500_000, 2_000_000]);
  assert.equal(resolveNumberInputMax(faceLimit, parameters, fieldPaths), 20_000);

  const multiImages = leaves.find((field) => field.id === "multiImages");
  assert.ok(multiImages && multiImages.kind === "multiImageUpload");
  assert.deepEqual(multiImages.slots?.map((slot) => slot.id), ["front", "left", "back", "right"]);
});

test("Tripo adapter builds exactly one input shape for text, single-image, and multi-image generation", () => {
  const adapter = new BailianAdapter();
  const textBody = adapter.buildPayload(payload({
    generation_mode: "text",
    modelName: "Tripo/Tripo-P1.0",
    prompt: "一只可爱的猫",
    image_url: "https://example.com/ignored.png",
    texture_output: "pbr",
    texture_quality: "standard",
  }));
  assert.deepEqual(textBody.input, { prompt: "一只可爱的猫" });
  assert.deepEqual(textBody.parameters, { texture_quality: "standard" });

  const singleBody = adapter.buildPayload(payload({
    generation_mode: "single_image",
    modelName: "Tripo/Tripo-H3.1",
    image_url: "https://example.com/front.png",
    texture_output: "base",
    geometry_quality: "ultra",
  }));
  assert.deepEqual(singleBody.input, { image: "https://example.com/front.png" });
  assert.deepEqual(singleBody.parameters, { texture: false, pbr: false, geometry_quality: "ultra" });

  const multiBody = adapter.buildPayload(payload({
    generation_mode: "multi_image",
    modelName: "Tripo/Tripo-P1.0",
    image_urls: ["https://example.com/front.png", "https://example.com/left.jpg"],
    texture_output: "pbr",
    texture_quality: "detailed",
  }));
  assert.deepEqual(multiBody.input, {
    images: [
      { type: "png", file_token: "https://example.com/front.png" },
      { type: "jpeg", file_token: "https://example.com/left.jpg" },
      {},
      {},
    ],
  });

  const sparseMultiBody = adapter.buildPayload(payload({
    generation_mode: "multi_image",
    modelName: "Tripo/Tripo-H3.1",
    image_urls: ["https://example.com/front.png", null, "https://example.com/back.png", null],
    texture_output: "pbr",
  }));
  assert.deepEqual(sparseMultiBody.input, {
    images: [
      { type: "png", file_token: "https://example.com/front.png" },
      {},
      { type: "png", file_token: "https://example.com/back.png" },
      {},
    ],
  });

  assert.throws(
    () => adapter.buildPayload(payload({
      generation_mode: "multi_image",
      modelName: "Tripo/Tripo-P1.0",
      image_urls: ["https://example.com/only-one.png"],
    })),
    (error) => error instanceof ProviderError && error.code === "BAILIAN_TRIPO_INVALID_IMAGE_COUNT",
  );
});

test("Tripo pricing follows the selected model, input mode, texture, and geometry quality", () => {
  const adapter = new BailianAdapter();
  assert.equal(adapter.calculateCost(payload({
    generation_mode: "text",
    modelName: "Tripo/Tripo-P1.0",
    texture_output: "pbr",
    texture_quality: "standard",
  })).sellPrice, 700);

  assert.equal(adapter.calculateCost(payload({
    generation_mode: "single_image",
    modelName: "Tripo/Tripo-H3.1",
    texture_output: "pbr",
    texture_quality: "detailed",
    face_limit: 2_000_000,
  })).sellPrice, 1050);
});

test("Tripo face count supports presets and custom values with model-specific limits", () => {
  const adapter = new BailianAdapter();

  const standard = adapter.buildPayload(payload({
    generation_mode: "text",
    modelName: "Tripo/Tripo-H3.1",
    prompt: "cat",
    texture_output: "base",
    face_limit: 1_500_000,
  }));
  assert.deepEqual(standard.parameters, {
    face_limit: 1_500_000,
    texture: false,
    pbr: false,
    geometry_quality: "standard",
  });

  const ultra = adapter.buildPayload(payload({
    generation_mode: "text",
    modelName: "Tripo/Tripo-H3.1",
    prompt: "cat",
    texture_output: "base",
    face_limit: 2_000_000,
  }));
  assert.deepEqual(ultra.parameters, {
    face_limit: 2_000_000,
    texture: false,
    pbr: false,
    geometry_quality: "ultra",
  });

  for (const [modelName, faceLimit] of [
    ["Tripo/Tripo-P1.0", 20_001],
    ["Tripo/Tripo-H3.1", 2_000_001],
    ["Tripo/Tripo-H3.1", 47],
    ["Tripo/Tripo-H3.1", 100.5],
  ] as const) {
    assert.throws(
      () => adapter.buildPayload(payload({
        generation_mode: "text",
        modelName,
        prompt: "cat",
        face_limit: faceLimit,
      })),
      (error) => error instanceof ProviderError && error.code === "BAILIAN_TRIPO_INVALID_FACE_LIMIT",
    );
  }
});

test("Tripo directional form preserves empty view slots in the standard payload", () => {
  const store = useWorkflowStore.getState();
  store.hydrateSchema(bailianTripo3dWorkflowMock);
  store.setGatewaySelection("BAILIAN_TRIPO_3D", "ALIYUN_BAILIAN");
  store.setFieldValue("generationMode", "multi_image");
  store.setFieldValue("modelName", "Tripo/Tripo-H3.1");
  store.setFieldValue("multiImages", {
    items: [
      { id: "front-item", slotId: "front", status: "ready", remoteUrl: "https://example.com/front.png" },
      { id: "back-item", slotId: "back", status: "ready", remoteUrl: "https://example.com/back.png" },
    ],
  });

  const standardPayload = store.buildPayload();
  assert.ok(standardPayload);
  assert.deepEqual(standardPayload.nodeInputs.input.image_urls, [
    "https://example.com/front.png",
    null,
    "https://example.com/back.png",
    null,
  ]);
});

test("Tripo submission uses the Beijing workspace endpoint and polling returns a GLB model with preview", async () => {
  const adapter = new BailianAdapter();
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  try {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/3d-generation")) {
        return new Response(JSON.stringify({ output: { task_id: "upstream-123", task_status: "PENDING" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        output: {
          task_id: "upstream-123",
          task_status: "SUCCEEDED",
          results: [{
            pbr_model_url: "https://cdn.example.com/cat.glb?expires=2h",
            rendered_image_url: "https://cdn.example.com/cat.webp?expires=2h",
          }],
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    const request = payload({
      generation_mode: "text",
      modelName: "Tripo/Tripo-P1.0",
      prompt: "cat",
      texture_output: "pbr",
      texture_quality: "standard",
    });
    const generated = await adapter.generate(request, {
      apiKey: "test-key",
      tripoBaseUrl: "https://workspace.cn-beijing.maas.aliyuncs.com",
    });
    assert.equal(generated.taskId, "tripo_700__upstream-123");

    const result = await adapter.queryTask(generated.taskId, {
      apiKey: "test-key",
      tripoBaseUrl: "https://workspace.cn-beijing.maas.aliyuncs.com",
    });
    assert.equal(result.status, "succeeded");
    assert.equal(result.resultMediaType, "model");
    assert.equal(result.resultUrl, "https://cdn.example.com/cat.glb?expires=2h");
    assert.equal(result.resultPreviewUrl, "https://cdn.example.com/cat.webp?expires=2h");
    assert.equal(result.flatFeeCredits, 700);
    assert.deepEqual(urls, [
      "https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/video-generation/3d-generation",
      "https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/tasks/upstream-123",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
