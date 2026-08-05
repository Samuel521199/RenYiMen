import assert from "node:assert/strict";
import test from "node:test";
import { bailianVoiceDesignWorkflowMock } from "@/mocks/bailian-voice-design-workflow";
import {
  buildBailianVoiceDesignRequest,
  decodeVoiceDesignTaskId,
  encodeVoiceDesignTaskId,
} from "./BailianVoiceDesignAdapter";
import { resolveProviderCodeFromBody } from "./ProviderFactory";

test("voice design schema requires text inputs and exposes no recording field", () => {
  const group = bailianVoiceDesignWorkflowMock.fields.find((field) => field.id === "inputGroup");
  assert.ok(group && group.kind === "group");
  assert.ok(group.children.some((field) => field.id === "voicePrompt" && field.kind === "textInput"));
  assert.ok(group.children.some((field) => field.id === "previewText" && field.kind === "textInput"));
  assert.equal(group.children.some((field) => field.kind === "audioUpload"), false);
  assert.equal(
    resolveProviderCodeFromBody({ skuId: "BAILIAN_COSYVOICE_VOICE_DESIGN" }),
    "ALIYUN_BAILIAN_VOICE_DESIGN",
  );
});

test("voice design catalog card uses its dedicated cover", async () => {
  const { GET } = await import("@/app/api/skus/route");
  const response = await GET();
  const body = await response.json() as { skus: Array<{ skuId: string; cover?: string }> };
  const sku = body.skus.find((item) => item.skuId === "BAILIAN_COSYVOICE_VOICE_DESIGN");
  assert.ok(sku);
  assert.equal(sku.cover, "/covers/voice-design-from-text.webp");
});

test("voice design request uses voice-enrollment with cosyvoice-v3.5-plus", () => {
  const request = buildBailianVoiceDesignRequest({
    templateId: "voice-enrollment:cosyvoice-v3.5-plus",
    nodeInputs: {
      input: {
        voice_prompt: "年轻、神秘、带机械感的女声",
        preview_text: "欢迎来到我们的未来世界，每一次聆听都是全新的发现。",
        prefix: "brand01",
        language_hint: "zh",
        response_format: "mp3",
      },
    },
  });

  assert.deepEqual(request, {
    model: "voice-enrollment",
    input: {
      action: "create_voice",
      target_model: "cosyvoice-v3.5-plus",
      voice_prompt: "年轻、神秘、带机械感的女声",
      preview_text: "欢迎来到我们的未来世界，每一次聆听都是全新的发现。",
      prefix: "brand01",
      language_hints: ["zh"],
    },
    parameters: { sample_rate: 24000, response_format: "mp3" },
  });
});

test("voice id survives the gateway-safe task id round trip", () => {
  const voiceId = "cosyvoice-v3.5-plus-vd-brand01-abc123";
  const taskId = encodeVoiceDesignTaskId(voiceId);
  assert.match(taskId, /^[\w-]+$/);
  assert.ok(taskId.length <= 128);
  assert.equal(decodeVoiceDesignTaskId(taskId), voiceId);
});

test("voice design rejects prefixes outside the upstream contract", () => {
  assert.throws(() => buildBailianVoiceDesignRequest({
    templateId: "voice-enrollment:cosyvoice-v3.5-plus",
    nodeInputs: {
      input: {
        voice_prompt: "年轻而神秘的机械质感女声",
        preview_text: "欢迎来到我们的未来世界，每一次聆听都是全新的发现。",
        prefix: "品牌音色",
      },
    },
  }), /英文字母或数字/);
});
