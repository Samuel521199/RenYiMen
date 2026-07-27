import test from "node:test";
import assert from "node:assert/strict";
import {
  mapResolvedVideoImagesToTransport,
  resolveVideoImageInputs,
  type VideoImageInput,
  type VideoProviderInputCapabilities,
} from "./video-input-contract.ts";
import { aliyunVideoImageInputCapabilities } from "../video-orchestrator/aliyun-workflow.ts";

const inputs: VideoImageInput[] = [{
  id: "start",
  role: "first_frame",
  url: "https://example.com/start.png",
  authority: "native_boundary",
  instruction: "Start from this exact image.",
  allowedUse: ["initial composition"],
  forbiddenUse: ["do not swap with end"],
}, {
  id: "end",
  role: "last_frame",
  url: "https://example.com/end.png",
  authority: "native_boundary",
  instruction: "End at this exact image.",
  allowedUse: ["terminal composition"],
  forbiddenUse: ["do not show early"],
}, {
  id: "character",
  role: "character_identity",
  url: "https://example.com/character.png",
  authority: "reference_only",
  instruction: "Identity only.",
  allowedUse: ["face", "clothing"],
  forbiddenUse: ["do not copy pose"],
}];

test("first-frame-only providers never pretend the end image was transported", () => {
  const capabilities: VideoProviderInputCapabilities = {
    providerId: "test",
    modelId: "first-only",
    transportSchema: "dashscope_media",
    maxImages: 1,
    supportsSemanticEndFramePrompt: true,
    promptCanAddressInputOrder: true,
    roleBindings: {
      first_frame: { transportRole: "first_frame", nativeBoundaryControl: true, maxCount: 1 },
    },
  };
  const resolved = resolveVideoImageInputs({
    inputs,
    capabilities,
    endFrameRequirementLevel: "hard_semantic",
  });
  assert.deepEqual(resolved.transported.map((item) => item.role), ["first_frame"]);
  assert.ok(resolved.evaluationOnly.some((item) => item.role === "last_frame"));
  assert.match(resolved.promptRoleMap, /\[Image 1\] = FIRST_FRAME/);
  assert.doesNotMatch(resolved.promptRoleMap, /LAST_FRAME/);
  assert.throws(() => resolveVideoImageInputs({
    inputs,
    capabilities,
    endFrameRequirementLevel: "hard_exact",
  }), /not a native model input/);
});

test("native first-last providers transport both boundaries with explicit roles", () => {
  const capabilities: VideoProviderInputCapabilities = {
    providerId: "test",
    modelId: "native-first-last",
    transportSchema: "dashscope_media",
    maxImages: 4,
    supportsSemanticEndFramePrompt: true,
    promptCanAddressInputOrder: true,
    roleBindings: {
      first_frame: { transportRole: "first_frame", nativeBoundaryControl: true, maxCount: 1 },
      last_frame: { transportRole: "last_frame", nativeBoundaryControl: true, maxCount: 1 },
      character_identity: { transportRole: "reference_image", nativeBoundaryControl: false },
    },
  };
  const resolved = resolveVideoImageInputs({
    inputs,
    capabilities,
    endFrameRequirementLevel: "hard_exact",
  });
  assert.equal(resolved.nativeFirstFrame, true);
  assert.equal(resolved.nativeLastFrame, true);
  assert.deepEqual(mapResolvedVideoImagesToTransport(resolved, capabilities), [
    { type: "first_frame", url: "https://example.com/start.png" },
    { type: "last_frame", url: "https://example.com/end.png" },
    { type: "reference_image", url: "https://example.com/character.png" },
  ]);
  assert.match(resolved.promptRoleMap, /\[Image 2\] = LAST_FRAME/);
  assert.match(resolved.promptRoleMap, /End at this exact image/);
});

test("odd provider schemas can map roles into arbitrary named fields", () => {
  const capabilities: VideoProviderInputCapabilities = {
    providerId: "custom",
    modelId: "odd-named-fields",
    transportSchema: "named_fields",
    maxImages: 3,
    supportsSemanticEndFramePrompt: true,
    promptCanAddressInputOrder: false,
    roleBindings: {
      first_frame: { fieldName: "init_canvas", nativeBoundaryControl: true, maxCount: 1 },
      last_frame: { fieldName: "terminal_canvas", nativeBoundaryControl: true, maxCount: 1 },
      character_identity: { fieldName: "identity_refs", nativeBoundaryControl: false },
    },
  };
  const resolved = resolveVideoImageInputs({
    inputs,
    capabilities,
    endFrameRequirementLevel: "hard_exact",
  });
  assert.deepEqual(mapResolvedVideoImagesToTransport(resolved, capabilities), {
    init_canvas: "https://example.com/start.png",
    terminal_canvas: "https://example.com/end.png",
    identity_refs: "https://example.com/character.png",
  });
  assert.equal(resolved.promptRoleMap, "");
});

test("explicit Aliyun custom-model mode maps approved boundaries to native first and last frames", () => {
  const previous = {
    enabled: process.env.ALIYUN_I2V_ALLOW_CUSTOM_MODEL,
    model: process.env.ALIYUN_I2V_MODEL,
    mode: process.env.ALIYUN_I2V_INPUT_MODE,
    max: process.env.ALIYUN_I2V_MAX_IMAGES,
  };
  try {
    process.env.ALIYUN_I2V_ALLOW_CUSTOM_MODEL = "true";
    process.env.ALIYUN_I2V_MODEL = "future-native-boundary-model";
    process.env.ALIYUN_I2V_INPUT_MODE = "native_first_last_plus_references";
    process.env.ALIYUN_I2V_MAX_IMAGES = "5";
    const capabilities = aliyunVideoImageInputCapabilities();
    const resolved = resolveVideoImageInputs({
      inputs,
      capabilities,
      endFrameRequirementLevel: "hard_exact",
    });
    assert.equal(capabilities.modelId, "future-native-boundary-model");
    assert.equal(resolved.nativeLastFrame, true);
    assert.deepEqual(mapResolvedVideoImagesToTransport(resolved, capabilities), [
      { type: "first_frame", url: "https://example.com/start.png" },
      { type: "last_frame", url: "https://example.com/end.png" },
      { type: "reference_image", url: "https://example.com/character.png" },
    ]);
  } finally {
    restoreEnv("ALIYUN_I2V_ALLOW_CUSTOM_MODEL", previous.enabled);
    restoreEnv("ALIYUN_I2V_MODEL", previous.model);
    restoreEnv("ALIYUN_I2V_INPUT_MODE", previous.mode);
    restoreEnv("ALIYUN_I2V_MAX_IMAGES", previous.max);
  }
});

test("built-in HappyHorse R2V transports start, end, and identity images as ordered references", () => {
  const previous = {
    enabled: process.env.ALIYUN_I2V_ALLOW_CUSTOM_MODEL,
    model: process.env.ALIYUN_I2V_MODEL,
    mode: process.env.ALIYUN_I2V_INPUT_MODE,
  };
  try {
    process.env.ALIYUN_I2V_ALLOW_CUSTOM_MODEL = "false";
    process.env.ALIYUN_I2V_MODEL = "ignored-custom-model";
    process.env.ALIYUN_I2V_INPUT_MODE = "first_frame_only";
    const capabilities = aliyunVideoImageInputCapabilities();
    const nineInputs: VideoImageInput[] = [
      ...inputs,
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `extra-${index + 1}`,
        role: "custom_reference" as const,
        url: `https://example.com/extra-${index + 1}.png`,
        authority: "reference_only" as const,
        instruction: `Scoped reference ${index + 1}.`,
        allowedUse: ["explicitly scoped attribute"],
        forbiddenUse: ["unrelated content"],
      })),
    ];
    const resolved = resolveVideoImageInputs({
      inputs: nineInputs,
      capabilities,
      endFrameRequirementLevel: "hard_semantic",
    });
    assert.equal(capabilities.modelId, "happyhorse-1.1-r2v");
    assert.equal(capabilities.maxImages, 9);
    assert.equal(resolved.transported.length, 9);
    assert.equal(resolved.nativeFirstFrame, false);
    assert.equal(resolved.nativeLastFrame, false);
    const transported = mapResolvedVideoImagesToTransport(resolved, capabilities);
    assert.ok(Array.isArray(transported));
    assert.deepEqual(transported.slice(0, 3), [
      { type: "reference_image", url: "https://example.com/start.png" },
      { type: "reference_image", url: "https://example.com/end.png" },
      { type: "reference_image", url: "https://example.com/character.png" },
    ]);
    assert.match(resolved.promptRoleMap, /\[Image 1\] = FIRST_FRAME/);
    assert.match(resolved.promptRoleMap, /\[Image 2\] = LAST_FRAME/);
    assert.match(resolved.promptRoleMap, /\[Image 9\] = CUSTOM_REFERENCE/);
  } finally {
    restoreEnv("ALIYUN_I2V_ALLOW_CUSTOM_MODEL", previous.enabled);
    restoreEnv("ALIYUN_I2V_MODEL", previous.model);
    restoreEnv("ALIYUN_I2V_INPUT_MODE", previous.mode);
  }
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
