import assert from "node:assert/strict";
import test from "node:test";
import { BailianVoiceCloneAdapter } from "./BailianVoiceCloneAdapter.ts";
import type { StandardPayload } from "./types.ts";

function payload(overrides: Record<string, unknown> = {}): StandardPayload {
  return {
    templateId: "bailian-voice-clone",
    nodeInputs: {
      input: {
        audio_url: "https://example.com/reference.wav",
        audio_duration: 12.5,
        model: "qwen-audio-3.0-tts-plus",
        language: "zh",
        text: "欢迎来到我们的创作工作室，很高兴为你服务。",
        instruction: "语气亲切自然，语速稍慢",
        enable_preprocess: "true",
        authorization: "confirmed",
        ...overrides,
      },
    },
  };
}

test("voice clone always registers Qwen, waits for approval, and synthesizes audio", async () => {
  const previousFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  let call = 0;
  try {
    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      call += 1;
      const responseBody = call === 1
        ? { output: { voice_id: "qwen-audio-3.0-tts-plus-rym-test" } }
        : call === 2
          ? { output: { status: "OK", target_model: "qwen-audio-3.0-tts-plus" } }
          : { output: { audio: { url: "https://dashscope.example.com/result.wav" } } };
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const persisted: string[] = [];
    const adapter = new BailianVoiceCloneAdapter({
      persistOutput: async ({ url }) => {
        persisted.push(url);
        return "https://cdn.example.com/voice-clone/result.wav";
      },
    });
    const result = await adapter.generate(payload({
      model: "cosyvoice-v3.5-plus",
      authorization: "",
    }), {
      apiKey: "test-key",
      baseUrl: "https://workspace.example.com",
    });

    assert.equal(requests.length, 3);
    assert.equal(requests[0].url, "https://workspace.example.com/api/v1/services/audio/tts/customization");
    const createInput = (requests[0].body.input as Record<string, unknown>);
    assert.match(String(createInput.prefix), /^rym[a-f0-9]{7}$/);
    assert.deepEqual(requests[0].body, {
      model: "voice-enrollment",
      input: {
        action: "create_voice",
        target_model: "qwen-audio-3.0-tts-plus",
        prefix: createInput.prefix,
        url: "https://example.com/reference.wav",
        language_hints: ["zh"],
        max_prompt_audio_length: 12.5,
        enable_preprocess: true,
      },
    });
    assert.deepEqual(requests[1].body, {
      model: "voice-enrollment",
      input: { action: "query_voice", voice_id: "qwen-audio-3.0-tts-plus-rym-test" },
    });
    assert.deepEqual(requests[2].body, {
      model: "qwen-audio-3.0-tts-plus",
      input: {
        text: "欢迎来到我们的创作工作室，很高兴为你服务。",
        voice: "qwen-audio-3.0-tts-plus-rym-test",
        format: "wav",
        sample_rate: 24000,
        instruction: "语气亲切自然，语速稍慢",
      },
    });
    assert.deepEqual(persisted, ["https://dashscope.example.com/result.wav"]);
    assert.match(result.taskId, /^voice_[a-f0-9]{32}$/);
    assert.deepEqual((result.raw as Record<string, unknown>).directResult, {
      status: "succeeded",
      resultUrls: ["https://cdn.example.com/voice-clone/result.wav"],
      resultMediaType: "audio",
      providerCost: 20,
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("voice clone rejects recordings outside the 5–20 second range", async () => {
  const adapter = new BailianVoiceCloneAdapter({
    persistOutput: async ({ url }) => url,
  });
  await assert.rejects(
    adapter.generate(payload({ audio_duration: 3 }), {
      apiKey: "test-key",
      baseUrl: "https://workspace.example.com",
    }),
    /参考录音时长须为 5～20 秒/,
  );
});
