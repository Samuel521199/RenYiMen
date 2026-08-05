import assert from "node:assert/strict";
import test from "node:test";
import { bailianEmotionalTtsWorkflowMock } from "@/mocks/bailian-emotional-tts-workflow";
import {
  BailianEmotionalTtsAdapter,
  buildBailianEmotionalTtsRequest,
} from "./BailianEmotionalTtsAdapter";
import { resolveProviderCodeFromBody } from "./ProviderFactory";
import type { StandardPayload } from "./types";

function payload(overrides: Record<string, unknown> = {}): StandardPayload {
  return {
    templateId: "qwen-audio-3.0-tts-plus",
    nodeInputs: {
      input: {
        text: "太好了！我们终于找到他了！",
        voice: "longanlingxin",
        emotion: "excited",
        rate: 1.15,
        volume: 68,
        ...overrides,
      },
    },
  };
}

test("emotional TTS schema exposes six emotions, speed, and volume", () => {
  const group = bailianEmotionalTtsWorkflowMock.fields.find((field) => field.id === "inputGroup");
  assert.ok(group && group.kind === "group");
  const emotion = group.children.find((field) => field.id === "emotion");
  assert.ok(emotion && emotion.kind === "select");
  assert.deepEqual(emotion.options.map((option) => option.value), [
    "happy",
    "sad",
    "angry",
    "whisper",
    "excited",
    "calm",
  ]);
  assert.ok(group.children.some((field) => field.id === "rate" && field.kind === "numberSlider"));
  assert.ok(group.children.some((field) => field.id === "volume" && field.kind === "numberSlider"));
  assert.equal(resolveProviderCodeFromBody({ skuId: "BAILIAN_EMOTIONAL_TTS" }), "ALIYUN_BAILIAN_EMOTIONAL_TTS");
});

test("emotional TTS catalog card uses its dedicated cover", async () => {
  const { GET } = await import("@/app/api/skus/route");
  const response = await GET();
  const body = await response.json() as { skus: Array<{ skuId: string; cover?: string }> };
  const sku = body.skus.find((item) => item.skuId === "BAILIAN_EMOTIONAL_TTS");
  assert.ok(sku);
  assert.equal(sku.cover, "/covers/expressive-voiceover.webp");
});

test("emotional TTS maps controls to the official Qwen Audio request", () => {
  assert.deepEqual(buildBailianEmotionalTtsRequest(payload()), {
    model: "qwen-audio-3.0-tts-plus",
    input: {
      text: "[excited]太好了！我们终于找到他了！",
      voice: "longanlingxin",
      instruction: "情绪激动、充满能量，节奏富有戏剧张力。",
      format: "mp3",
      sample_rate: 24000,
      rate: 1.15,
      volume: 68,
    },
  });

  assert.throws(() => buildBailianEmotionalTtsRequest(payload({ rate: 2.1 })), /语速须在/);
  assert.throws(() => buildBailianEmotionalTtsRequest(payload({ volume: 50.5 })), /音量须为/);
});

test("emotional TTS persists the temporary audio and returns a direct audio result", async () => {
  const previousFetch = globalThis.fetch;
  let requestUrl = "";
  let requestBody: unknown;
  let persistedUrl = "";
  try {
    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        output: {
          finish_reason: "stop",
          audio: { url: "https://dashscope.example.com/result.mp3" },
        },
        usage: { characters: 100 },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const adapter = new BailianEmotionalTtsAdapter({
      persistOutput: async ({ url }) => {
        persistedUrl = url;
        return "https://oss.example.com/emotional-tts/result.mp3";
      },
    });
    const result = await adapter.generate(payload(), {
      apiKey: "test-key",
      baseUrl: "https://workspace.example.com",
    });

    assert.equal(requestUrl, "https://workspace.example.com/api/v1/services/audio/tts/SpeechSynthesizer");
    assert.equal((requestBody as { model: string }).model, "qwen-audio-3.0-tts-plus");
    assert.equal(persistedUrl, "https://dashscope.example.com/result.mp3");
    assert.match(result.taskId, /^tts_[a-f0-9]+$/);
    assert.deepEqual(result.raw, {
      directResult: {
        status: "succeeded",
        resultUrls: ["https://oss.example.com/emotional-tts/result.mp3"],
        resultMediaType: "audio",
        providerCost: 4,
      },
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
