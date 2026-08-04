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
import { BailianAdapter } from "./BailianAdapter.ts";
import type { StandardPayload } from "./types.ts";

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
      inputs: inputs.map((input) =>
        input.role === "character_identity"
          ? { ...input, requiredForSegment: true, anchorId: "character:hero" }
          : input
      ),
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

test("built-in Wan 2.7 I2V transports only native first and last frame boundaries", () => {
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
    const resolved = resolveVideoImageInputs({
      inputs: inputs.map((input) =>
        input.role === "character_identity"
          ? { ...input, requiredForSegment: true, anchorId: "character:hero" }
          : input
      ),
      capabilities,
      endFrameRequirementLevel: "hard_exact",
    });
    assert.equal(capabilities.modelId, "wan2.7-i2v-2026-04-25");
    assert.equal(capabilities.maxImages, 2);
    assert.equal(resolved.nativeFirstFrame, true);
    assert.equal(resolved.nativeLastFrame, true);
    const transported = mapResolvedVideoImagesToTransport(resolved, capabilities);
    assert.deepEqual(transported, [
      { type: "first_frame", url: "https://example.com/start.png" },
      { type: "last_frame", url: "https://example.com/end.png" },
    ]);
    assert.equal(resolved.promptRoleMap, "");
    assert.ok(resolved.evaluationOnly.some((item) => item.role === "character_identity"));
    assert.deepEqual(resolved.coverage.uncoveredHardAnchorIds, []);
  } finally {
    restoreEnv("ALIYUN_I2V_ALLOW_CUSTOM_MODEL", previous.enabled);
    restoreEnv("ALIYUN_I2V_MODEL", previous.model);
    restoreEnv("ALIYUN_I2V_INPUT_MODE", previous.mode);
  }
});

test("HappyHorse R2V compatibility profile remains available without native boundary claims", () => {
  const previous = {
    enabled: process.env.ALIYUN_I2V_ALLOW_CUSTOM_MODEL,
    model: process.env.ALIYUN_I2V_MODEL,
    mode: process.env.ALIYUN_I2V_INPUT_MODE,
    max: process.env.ALIYUN_I2V_MAX_IMAGES,
  };
  try {
    process.env.ALIYUN_I2V_ALLOW_CUSTOM_MODEL = "true";
    process.env.ALIYUN_I2V_MODEL = "happyhorse-1.1-r2v";
    process.env.ALIYUN_I2V_INPUT_MODE = "multi_reference";
    process.env.ALIYUN_I2V_MAX_IMAGES = "9";
    const capabilities = aliyunVideoImageInputCapabilities();
    const resolved = resolveVideoImageInputs({
      inputs,
      capabilities,
      endFrameRequirementLevel: "hard_semantic",
    });
    assert.equal(capabilities.modelId, "happyhorse-1.1-r2v");
    assert.equal(resolved.nativeFirstFrame, false);
    assert.equal(resolved.nativeLastFrame, false);
    assert.deepEqual(mapResolvedVideoImagesToTransport(resolved, capabilities), [
      { type: "reference_image", url: "https://example.com/start.png" },
      { type: "reference_image", url: "https://example.com/end.png" },
      { type: "reference_image", url: "https://example.com/character.png" },
    ]);
  } finally {
    restoreEnv("ALIYUN_I2V_ALLOW_CUSTOM_MODEL", previous.enabled);
    restoreEnv("ALIYUN_I2V_MODEL", previous.model);
    restoreEnv("ALIYUN_I2V_INPUT_MODE", previous.mode);
    restoreEnv("ALIYUN_I2V_MAX_IMAGES", previous.max);
  }
});

test("Bailian gateway defaults to Wan 2.7 native first-last payload without R2V parameters", () => {
  const previous = {
    force: process.env.BAILIAN_FORCE_HAPPYHORSE_MODEL,
    legacyForce: process.env.DASHSCOPE_FORCE_HAPPYHORSE_MODEL,
  };
  try {
    delete process.env.BAILIAN_FORCE_HAPPYHORSE_MODEL;
    delete process.env.DASHSCOPE_FORCE_HAPPYHORSE_MODEL;
    const payload: StandardPayload = {
      templateId: "bailian-wanx-i2v",
      nodeInputs: {
        input: {
          firstFrameUrl: "https://example.com/start.png",
          lastFrameUrl: "https://example.com/end.png",
          prompt: "The camera moves continuously between the supplied boundary images.",
          negativePrompt: "cut, dissolve",
          duration: 10,
          ratio: "9:16",
        },
      },
    };
    const adapter = new BailianAdapter();
    const capabilities = adapter.getVideoInputCapabilities(payload);
    const body = adapter.buildPayload(payload);
    assert.equal(capabilities.modelId, "wan2.7-i2v-2026-04-25");
    assert.equal(capabilities.roleBindings.last_frame?.nativeBoundaryControl, true);
    assert.equal(capabilities.maxImages, 2);
    assert.equal(body.model, "wan2.7-i2v-2026-04-25");
    assert.ok("media" in body.input);
    assert.deepEqual(body.input.media, [
      { type: "first_frame", url: "https://example.com/start.png" },
      { type: "last_frame", url: "https://example.com/end.png" },
    ]);
    assert.equal(body.input.negative_prompt, "cut, dissolve");
    assert.equal(body.parameters?.prompt_extend, false);
    assert.equal(body.parameters?.ratio, undefined);
  } finally {
    restoreEnv("BAILIAN_FORCE_HAPPYHORSE_MODEL", previous.force);
    restoreEnv("DASHSCOPE_FORCE_HAPPYHORSE_MODEL", previous.legacyForce);
  }
});

test("Bailian gateway keeps the explicit HappyHorse compatibility switch", () => {
  const previous = process.env.BAILIAN_FORCE_HAPPYHORSE_MODEL;
  try {
    process.env.BAILIAN_FORCE_HAPPYHORSE_MODEL = "true";
    const payload: StandardPayload = {
      templateId: "bailian-wanx-i2v",
      nodeInputs: {
        input: {
          firstFrameUrl: "https://example.com/start.png",
          prompt: "A continuous camera move.",
        },
      },
    };
    const body = new BailianAdapter().buildPayload(payload);
    assert.equal(body.model, "happyhorse-1.1-i2v");
  } finally {
    restoreEnv("BAILIAN_FORCE_HAPPYHORSE_MODEL", previous);
  }
});

test("Bailian dance motion transfer uses the dedicated image and video contract", async () => {
  const previousForce = process.env.BAILIAN_FORCE_HAPPYHORSE_MODEL;
  const previousFetch = globalThis.fetch;
  try {
    process.env.BAILIAN_FORCE_HAPPYHORSE_MODEL = "true";
    const adapter = new BailianAdapter();
    const body = adapter.buildPayload({
      templateId: "bailian-wan2.2-animate-move",
      nodeInputs: {
        input: {
          image_url: "https://example.com/character.png",
          video_url: "https://example.com/dance.mp4",
          mode: "wan-pro",
        },
      },
    });

    assert.equal(body.model, "wan2.2-animate-move");
    assert.deepEqual(body.input, {
      image_url: "https://example.com/character.png",
      video_url: "https://example.com/dance.mp4",
      watermark: false,
    });
    assert.deepEqual(body.parameters, { mode: "wan-pro", check_image: true });
    assert.deepEqual(adapter.calculateCost({
      templateId: "bailian-wan2.2-animate-move",
      nodeInputs: { input: { modelName: "wan2.2-animate-move", mode: "wan-std", duration: 5 } },
    }), { cost: 500, sellPrice: 500 });
    assert.deepEqual(adapter.calculateCost({
      templateId: "bailian-wan2.2-animate-move",
      nodeInputs: { input: { modelName: "wan2.2-animate-move", mode: "wan-pro", duration: 5 } },
    }), { cost: 750, sellPrice: 750 });

    let submittedUrl = "";
    globalThis.fetch = (async (input: string | URL | Request) => {
      submittedUrl = String(input);
      return new Response(JSON.stringify({ output: { task_id: "dance-task" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const submitted = await adapter.submitTask(body, {
      apiKey: "test-key",
      baseUrl: "https://dashscope.example.com",
    });
    assert.equal(submitted.taskId, "dance-task");
    assert.equal(
      submittedUrl,
      "https://dashscope.example.com/api/v1/services/aigc/image2video/video-synthesis",
    );
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv("BAILIAN_FORCE_HAPPYHORSE_MODEL", previousForce);
  }
});

test("Bailian dance result prices professional output from usage duration and mode", async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      output: {
        task_status: "SUCCEEDED",
        results: { video_url: "https://example.com/result.mp4" },
      },
      usage: { video_duration: 12.5, video_ratio: "pro" },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
    const result = await new BailianAdapter().queryTask("dance-task", {
      apiKey: "test-key",
      baseUrl: "https://dashscope.example.com",
    });
    assert.equal(result.status, "succeeded");
    assert.equal(result.resultUrl, "https://example.com/result.mp4");
    assert.equal(result.providerDurationSec, 12.5);
    assert.equal(result.providerCost, 1875);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Bailian wan2.2-s2v uses native image/audio fields and the image-to-video endpoint", async () => {
  const previousFetch = globalThis.fetch;
  const previousForce = process.env.BAILIAN_FORCE_HAPPYHORSE_MODEL;
  try {
    process.env.BAILIAN_FORCE_HAPPYHORSE_MODEL = "true";
    const adapter = new BailianAdapter();
    const body = adapter.buildPayload({
      templateId: "bailian-wan2.2-s2v",
      nodeInputs: {
        input: {
          modelName: "wan2.2-s2v",
          image_url: "https://example.com/character.png",
          audio_url: "https://example.com/voice.mp3",
          resolution: "720P",
        },
      },
    });

    assert.deepEqual(body, {
      model: "wan2.2-s2v",
      input: {
        image_url: "https://example.com/character.png",
        audio_url: "https://example.com/voice.mp3",
      },
      parameters: { resolution: "720P" },
    });
    assert.deepEqual(adapter.calculateCost({
      templateId: "bailian-wan2.2-s2v",
      nodeInputs: { input: { modelName: "wan2.2-s2v", resolution: "480P", duration: 5 } },
    }), { cost: 625, sellPrice: 625 });
    assert.deepEqual(adapter.calculateCost({
      templateId: "bailian-wan2.2-s2v",
      nodeInputs: { input: { modelName: "wan2.2-s2v", resolution: "720P", duration: 18 } },
    }), { cost: 4050, sellPrice: 4050 });

    let submittedUrl = "";
    globalThis.fetch = (async (input: string | URL | Request) => {
      submittedUrl = String(input);
      return new Response(JSON.stringify({ output: { task_id: "s2v-task" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    await adapter.submitTask(body, { apiKey: "test-key", baseUrl: "https://dashscope.example.com" });
    assert.equal(
      submittedUrl,
      "https://dashscope.example.com/api/v1/services/aigc/image2video/video-synthesis",
    );
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv("BAILIAN_FORCE_HAPPYHORSE_MODEL", previousForce);
  }
});

test("Bailian wan2.2-s2v result prices actual duration using the returned resolution", async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      output: {
        task_status: "SUCCEEDED",
        results: { video_url: "https://example.com/talking.mp4" },
      },
      usage: { duration: 18.13, SR: 720, video_count: 1 },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
    const result = await new BailianAdapter().queryTask("s2v-task", {
      apiKey: "test-key",
      baseUrl: "https://dashscope.example.com",
    });
    assert.equal(result.status, "succeeded");
    assert.equal(result.providerDurationSec, 18.13);
    assert.equal(result.providerCost, 4079);
  } finally {
    globalThis.fetch = previousFetch;
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
