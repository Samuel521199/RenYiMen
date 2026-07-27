import test from "node:test";
import assert from "node:assert/strict";
import {
  mapResolvedVideoImagesToTransport,
  resolveVideoImageInputs,
  type VideoImageInput,
  type VideoProviderInputCapabilities,
} from "./video-input-contract.ts";
import {
  aliyunVideoImageInputCapabilities,
  assembleVideoSubmissionPrompt,
} from "../video-orchestrator/aliyun-workflow.ts";

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

test("smart selection preserves required active entities and a motion checkpoint before optional references", () => {
  const referenceBinding = {
    transportRole: "reference_image",
    nativeBoundaryControl: false,
  };
  const capabilities: VideoProviderInputCapabilities = {
    providerId: "test",
    modelId: "ordered-r2v",
    transportSchema: "dashscope_media",
    maxImages: 5,
    supportsSemanticEndFramePrompt: true,
    promptCanAddressInputOrder: true,
    promptReferenceMode: "ordered_subject_action",
    preservesTransportOrder: true,
    roleBindings: {
      first_frame: referenceBinding,
      last_frame: referenceBinding,
      character_identity: referenceBinding,
      product_identity: referenceBinding,
      motion_checkpoint: referenceBinding,
      custom_reference: referenceBinding,
    },
  };
  const candidates: VideoImageInput[] = [
    inputs[0],
    inputs[1],
    {
      ...inputs[2],
      anchorId: "heroine",
      actionRole: "actor",
      requiredForSegment: true,
    },
    {
      id: "phone",
      role: "product_identity",
      url: "https://example.com/phone.png",
      authority: "reference_only",
      instruction: "Preserve the phone.",
      allowedUse: ["black frame"],
      forbiddenUse: [],
      anchorId: "phone",
      actionRole: "object",
      requiredForSegment: true,
    },
    ...[0.2, 0.5, 0.8].map((temporalPosition, index) => ({
      id: `checkpoint-${index + 1}`,
      role: "motion_checkpoint" as const,
      url: `https://example.com/checkpoint-${index + 1}.png`,
      authority: "reference_only" as const,
      instruction: "Ordered checkpoint.",
      allowedUse: ["intermediate pose"],
      forbiddenUse: [],
      actionRole: "checkpoint" as const,
      temporalPosition,
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `optional-${index + 1}`,
      role: "custom_reference" as const,
      url: `https://example.com/optional-${index + 1}.png`,
      authority: "reference_only" as const,
      instruction: "Optional reference.",
      allowedUse: ["optional detail"],
      forbiddenUse: [],
    })),
  ];

  const resolved = resolveVideoImageInputs({
    inputs: candidates,
    capabilities,
    endFrameRequirementLevel: "hard_semantic",
  });

  assert.deepEqual(
    resolved.transported.map((input) => input.role),
    ["first_frame", "last_frame", "character_identity", "product_identity", "motion_checkpoint"],
  );
  assert.deepEqual(resolved.coverage.uncoveredHardAnchorIds, []);
  assert.deepEqual(
    resolved.internalReferenceMap.map((item) => item.imageNumber),
    [1, 2, 3, 4, 5],
  );
  assert.ok(resolved.rejected.some((input) => input.role === "custom_reference"));
});

test("internal reference maps stay out of the model-facing prompt unless an experiment enables them", () => {
  const capabilities: VideoProviderInputCapabilities = {
    providerId: "test",
    modelId: "ordered-r2v",
    transportSchema: "dashscope_media",
    maxImages: 3,
    supportsSemanticEndFramePrompt: true,
    promptCanAddressInputOrder: true,
    promptReferenceMode: "ordered_subject_action",
    preservesTransportOrder: true,
    roleBindings: {
      first_frame: { transportRole: "reference_image", nativeBoundaryControl: false },
      last_frame: { transportRole: "reference_image", nativeBoundaryControl: false },
      character_identity: { transportRole: "reference_image", nativeBoundaryControl: false },
    },
  };
  const resolved = resolveVideoImageInputs({
    inputs,
    capabilities,
    endFrameRequirementLevel: "hard_semantic",
  });
  const modelFacingPrompt = "MAIN ACTION\n\nThe character from [Image 3] moves continuously.";

  assert.equal(
    assembleVideoSubmissionPrompt(resolved, modelFacingPrompt, false),
    modelFacingPrompt,
  );
  assert.match(
    assembleVideoSubmissionPrompt(resolved, modelFacingPrompt, true),
    /VIDEO IMAGE INPUT MAP/,
  );
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
