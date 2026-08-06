import assert from "node:assert/strict";
import test from "node:test";
import { LocalAudioExtractionAdapter, buildLocalAudioExtractionInput } from "./LocalAudioExtractionAdapter";
import { getProviderAdapter, resolveProviderCodeFromBody } from "./ProviderFactory";

function payload(outputFormat = "mp3") {
  return {
    templateId: "local-audio-extraction",
    nodeInputs: { input: { video_url: "https://media.example.com/source.mp4", output_format: outputFormat } },
  };
}

test("audio extraction input accepts supported formats", () => {
  assert.deepEqual(buildLocalAudioExtractionInput(payload("m4a")), {
    videoUrl: "https://media.example.com/source.mp4",
    outputFormat: "m4a",
  });
  assert.throws(() => buildLocalAudioExtractionInput(payload("flac")), /不支持的音频输出格式/);
});

test("audio extraction returns a direct audio result without model cost", async () => {
  const calls: unknown[] = [];
  const adapter = new LocalAudioExtractionAdapter({
    isAllowedSource: () => true,
    extract: async (...args) => {
      calls.push(args);
      return {
        url: "https://media.example.com/audio/result.mp3",
        format: "mp3",
        codec: "mp3",
        bytes: 1234,
      };
    },
  });
  assert.deepEqual(adapter.calculateCost(), { cost: 0, sellPrice: 0 });
  const result = await adapter.generate(payload());
  assert.equal(calls.length, 1);
  assert.match(result.taskId, /^audio_extract_[a-f0-9]{32}$/);
  assert.deepEqual((result.raw as { directResult: unknown }).directResult, {
    status: "succeeded",
    resultUrls: ["https://media.example.com/audio/result.mp3"],
    resultMediaType: "audio",
    providerCost: 0,
    audio: {
      url: "https://media.example.com/audio/result.mp3",
      format: "mp3",
      codec: "mp3",
      bytes: 1234,
    },
  });
});

test("audio extraction rejects non-platform media origins", async () => {
  const adapter = new LocalAudioExtractionAdapter({
    isAllowedSource: () => false,
    extract: async () => { throw new Error("must not run"); },
  });
  await assert.rejects(adapter.generate(payload()), /仅支持处理通过本平台上传的视频/);
});

test("audio extraction SKU resolves through the provider factory", () => {
  assert.equal(
    resolveProviderCodeFromBody({ skuId: "LOCAL_AUDIO_EXTRACTION" }),
    "LOCAL_AUDIO_EXTRACTION",
  );
  assert.ok(getProviderAdapter("LOCAL_AUDIO_EXTRACTION") instanceof LocalAudioExtractionAdapter);
});
