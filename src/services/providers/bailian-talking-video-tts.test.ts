import assert from "node:assert/strict";
import test from "node:test";
import { bailianWan22S2vWorkflowMock } from "@/mocks/bailian-wan22-s2v-workflow";
import { BailianAdapter } from "./BailianAdapter";
import {
  buildTalkingVideoTtsRequest,
} from "./bailian-talking-video-input";
import { synthesizeTalkingVideoSpeech } from "./bailian-talking-video-tts";
import { resolveProviderCodeFromBody } from "./ProviderFactory";
import type { StandardPayload } from "./types";
import { iterateLeafFields } from "@/lib/workflow-utils";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { isGroupField } from "@/types/workflow";

function textModePayload(overrides: Record<string, unknown> = {}): StandardPayload {
  return {
    templateId: "bailian-wan2.2-s2v",
    nodeInputs: {
      input: {
        modelName: "wan2.2-s2v",
        image_url: "https://example.com/character.png",
        audio_input_mode: "text",
        speech_text: "欢迎来到我们的直播间。",
        tts_voice: "Eldric Sage",
        tts_language: "Chinese",
        tts_style: "calm",
        resolution: "480P",
        duration: 5,
        ...overrides,
      },
    },
  };
}

test("talking video schema exposes conditional text and upload modes with Alibaba voices", () => {
  assert.deepEqual(
    bailianWan22S2vWorkflowMock.fields.map((field) => field.id),
    ["characterGroup", "speechGroup", "motionGroup"],
  );
  const fields = [...iterateLeafFields(bailianWan22S2vWorkflowMock.fields)];
  const mode = fields.find((field) => field.id === "audioInputMode");
  const performance = fields.find((field) => field.id === "performanceMode");
  const text = fields.find((field) => field.id === "speechText");
  const voice = fields.find((field) => field.id === "ttsVoice");
  const upload = fields.find((field) => field.id === "voiceAudio");
  const videoUpload = fields.find((field) => field.id === "voiceVideo");
  const actionPrompt = fields.find((field) => field.id === "actionPrompt");
  assert.ok(mode && mode.kind === "select");
  assert.ok(performance && performance.kind === "select");
  assert.equal(performance.defaultValue, "prompted");
  assert.deepEqual(performance.options.map((option) => option.value), ["natural", "prompted", "precise"]);
  assert.deepEqual(mode.options.map((option) => option.value), ["text", "upload", "video"]);
  assert.equal(mode.display, "segmented");
  assert.equal(mode.options.some((option) => option.value === "upload" && option.label.includes("MP3")), true);
  assert.deepEqual(mode.clearFieldsByValue, {
    text: ["voiceAudio", "voiceVideo"],
    upload: ["speechText", "voiceVideo"],
    video: ["speechText", "voiceAudio"],
  });
  assert.ok(text && text.kind === "textInput" && text.visibleWhen?.equals === "text");
  if (!upload || isGroupField(upload) || upload.kind !== "audioUpload") {
    assert.fail("voiceAudio must be an audio upload field");
  }
  assert.equal(upload.visibleWhen?.equals, "upload");
  assert.equal(upload.requirement, "required");
  assert.deepEqual(upload.validation?.durationRangeByFieldValue, {
    fieldId: "performanceMode",
    values: {
      natural: {
        minDurationSec: 2,
        maxDurationSec: 20,
        maxExclusive: true,
        label: "自然口播",
        labelEn: "Natural",
      },
      prompted: {
        minDurationSec: 2,
        maxDurationSec: 15,
        maxExclusive: false,
        label: "提示词手势",
        labelEn: "Prompted Gestures",
      },
      precise: {
        minDurationSec: 2,
        maxDurationSec: 120,
        minExclusive: true,
        maxExclusive: true,
        label: "精准动作",
        labelEn: "Precise Motion",
      },
    },
  });
  if (!videoUpload || isGroupField(videoUpload) || videoUpload.kind !== "videoUpload") {
    assert.fail("voiceVideo must be a video upload field");
  }
  assert.equal(videoUpload.visibleWhen?.equals, "video");
  assert.deepEqual(videoUpload.validation?.accept, ["video/mp4"]);
  assert.equal(videoUpload.validation?.maxSizeMB, 200);
  assert.deepEqual(
    videoUpload.validation?.durationRangeByFieldValue,
    upload.validation?.durationRangeByFieldValue,
  );
  if (!actionPrompt || isGroupField(actionPrompt)) assert.fail("actionPrompt must be a leaf field");
  assert.equal(actionPrompt.requirement, "optional");
  assert.ok(voice && voice.kind === "select");
  assert.deepEqual(voice.options.map((option) => option.value), [
    "Cherry", "Ethan", "Bunny", "Pip", "Eldric Sage", "Katerina", "Neil", "Ryan",
  ]);
  assert.equal(resolveProviderCodeFromBody({ skuId: "BAILIAN_WAN22_S2V" }), "ALIYUN_BAILIAN");
});

test("talking video extracts MP4 audio to MP3 before submitting the selected motion model", async () => {
  const previousFetch = globalThis.fetch;
  let submittedBody: unknown;
  let extractedSource = "";
  try {
    globalThis.fetch = (async (_input, init) => {
      submittedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ output: { task_id: "s2v-from-mp4" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const adapter = new BailianAdapter({
      isAllowedTalkingVideoSource: () => true,
      extractTalkingAudio: async (sourceUrl, format) => {
        extractedSource = sourceUrl;
        assert.equal(format, "mp3");
        return {
          url: "https://oss.example.com/talking-video/extracted.mp3",
          format: "mp3",
          codec: "mp3",
          durationSeconds: 8.5,
          bytes: 1024,
        };
      },
    });

    const generated = await adapter.generate({
      templateId: "bailian-wan2.2-s2v",
      nodeInputs: {
        input: {
          performance_mode: "natural",
          audio_input_mode: "video",
          image_url: "https://example.com/character.png",
          audio_video_url: "https://oss.example.com/source.mp4",
          duration: 8.5,
          resolution: "480P",
        },
      },
    }, { apiKey: "test-key", baseUrl: "https://dashscope.example.com" });

    assert.equal(generated.taskId, "s2v-from-mp4");
    assert.equal(extractedSource, "https://oss.example.com/source.mp4");
    assert.deepEqual(submittedBody, {
      model: "wan2.2-s2v",
      input: {
        image_url: "https://example.com/character.png",
        audio_url: "https://oss.example.com/talking-video/extracted.mp3",
      },
      parameters: { resolution: "480P" },
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("talking video payload reuses the previewed MP3 without extracting the MP4 twice", async () => {
  const store = useWorkflowStore.getState();
  store.hydrateSchema(bailianWan22S2vWorkflowMock);
  store.setGatewaySelection("BAILIAN_WAN22_S2V", "ALIYUN_BAILIAN");
  store.setFieldValue("audioInputMode", "video");
  store.setFieldValue("characterImage", {
    status: "ready",
    remoteUrl: "https://example.com/character.png",
  });
  store.setFieldValue("voiceVideo", {
    status: "ready",
    remoteUrl: "https://oss.example.com/source.mp4",
    durationSec: 8.5,
    extractedAudio: {
      status: "ready",
      remoteUrl: "https://oss.example.com/source.mp3",
      durationSec: 8.4,
      fileName: "source.mp3",
    },
  });
  const payload = store.buildPayload();
  assert.equal(payload?.nodeInputs.input.audio_video_url, "https://oss.example.com/source.mp4");
  assert.equal(payload?.nodeInputs.input.audio_url, "https://oss.example.com/source.mp3");
  assert.equal(payload?.nodeInputs.input.duration, 8.4);

  const previousFetch = globalThis.fetch;
  let extractionCalls = 0;
  let submittedBody: unknown;
  try {
    globalThis.fetch = (async (_input, init) => {
      submittedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ output: { task_id: "prepared-mp3-task" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const adapter = new BailianAdapter({
      isAllowedTalkingVideoSource: () => true,
      extractTalkingAudio: async () => {
        extractionCalls += 1;
        throw new Error("must not extract twice");
      },
    });
    const generated = await adapter.generate({
      templateId: payload!.workflowId,
      nodeInputs: payload!.nodeInputs,
    }, {
      apiKey: "test-key",
      baseUrl: "https://dashscope.example.com",
    });
    assert.equal(generated.taskId, "w27talk_0__prepared-mp3-task");
    assert.equal(extractionCalls, 0);
    assert.deepEqual((submittedBody as { input?: { media?: unknown[] } }).input?.media, [
      { type: "first_frame", url: "https://example.com/character.png" },
      { type: "driving_audio", url: "https://oss.example.com/source.mp3" },
    ]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("talking video validates uploaded audio duration against the selected motion mode", () => {
  const store = useWorkflowStore.getState();
  store.hydrateSchema(bailianWan22S2vWorkflowMock);
  store.setFieldValue("audioInputMode", "upload");
  store.setFieldValue("characterImage", {
    status: "ready",
    remoteUrl: "https://example.com/character.png",
  });

  const setAudioDuration = (durationSec: number) => store.setFieldValue("voiceAudio", {
    status: "ready",
    remoteUrl: "https://example.com/voice.mp3",
    durationSec,
  });

  store.setFieldValue("performanceMode", "prompted");
  setAudioDuration(15);
  assert.equal(store.validate().voiceAudio, undefined);
  setAudioDuration(15.1);
  assert.match(store.validate().voiceAudio, /不超过 15 秒/);

  store.setFieldValue("performanceMode", "natural");
  setAudioDuration(19.9);
  assert.equal(store.validate().voiceAudio, undefined);
  setAudioDuration(20);
  assert.match(store.validate().voiceAudio, /小于 20 秒/);

  store.setFieldValue("performanceMode", "precise");
  setAudioDuration(2);
  assert.match(store.validate().voiceAudio, /大于 2 秒/);
  setAudioDuration(119.9);
  assert.equal(store.validate().voiceAudio, undefined);
  setAudioDuration(120);
  assert.match(store.validate().voiceAudio, /小于 120 秒/);
});

test("talking video backend enforces the same exclusive precise-motion duration boundaries", async () => {
  const adapter = new BailianAdapter();
  const payload = (duration: number): StandardPayload => ({
    templateId: "bailian-wan2.2-s2v",
    nodeInputs: {
      input: {
        performance_mode: "precise",
        audio_input_mode: "upload",
        image_url: "https://example.com/character.png",
        audio_url: "https://example.com/voice.mp3",
        duration,
        video_url: "https://example.com/reference.mp4",
        motion_duration: 6,
        mode: "wan-pro",
      },
    },
  });

  await assert.rejects(adapter.generate(payload(2), { apiKey: "test" }), /大于 2 秒/);
  await assert.rejects(adapter.generate(payload(120), { apiKey: "test" }), /短于 120 秒/);
});

test("prompted gesture mode sends image, exact driving audio, and motion prompts to Wan 2.7", () => {
  const adapter = new BailianAdapter();
  assert.deepEqual(adapter.buildPayload({
    templateId: "bailian-wan2.2-s2v",
    nodeInputs: {
      input: {
        performance_mode: "prompted",
        audio_input_mode: "upload",
        image_url: "https://example.com/character.png",
        audio_url: "https://example.com/voice.mp3",
        duration: 10,
        style_prompt: "半身商务口播，手势自然克制。",
        prompt: "强调重点时轻抬右手。",
        negative_prompt: "多余手指、遮挡面部",
        resolution: "1080P",
      },
    },
  }), {
    model: "wan2.7-i2v-2026-04-25",
    input: {
      prompt: "半身商务口播，手势自然克制。\n强调重点时轻抬右手。",
      negative_prompt: "多余手指、遮挡面部",
      media: [
        { type: "first_frame", url: "https://example.com/character.png" },
        { type: "driving_audio", url: "https://example.com/voice.mp3" },
      ],
    },
    parameters: {
      resolution: "1080P",
      duration: 10,
      watermark: false,
      prompt_extend: false,
    },
  });
});

test("prompted gesture mode tolerates AAC padding and clamps the model duration to 15 seconds", async () => {
  const previousFetch = globalThis.fetch;
  let submittedBody: unknown;
  try {
    globalThis.fetch = (async (_input, init) => {
      submittedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ output: { task_id: "aac-padding-task" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const generated = await new BailianAdapter().generate({
      templateId: "bailian-wan2.2-s2v",
      nodeInputs: {
        input: {
          performance_mode: "prompted",
          audio_input_mode: "upload",
          image_url: "https://example.com/character.png",
          audio_url: "https://example.com/voice.mp3",
          duration: 15.022993,
          resolution: "1080P",
        },
      },
    }, { apiKey: "test-key" });

    assert.equal(generated.taskId, "w27talk_0__aac-padding-task");
    assert.equal((submittedBody as { parameters: { duration: number } }).parameters.duration, 15);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("talking video text mode builds the official Qwen3 TTS request", () => {
  assert.deepEqual(buildTalkingVideoTtsRequest(textModePayload()), {
    model: "qwen3-tts-instruct-flash",
    input: {
      text: "欢迎来到我们的直播间。",
      voice: "Eldric Sage",
      language_type: "Chinese",
      instructions: "语气平静沉稳，节奏从容，吐字清晰。",
      optimize_instructions: true,
    },
  });
  assert.throws(
    () => buildTalkingVideoTtsRequest(textModePayload({ tts_voice: "unknown" })),
    /不支持的阿里云预置音色/,
  );
});

test("talking video speech is synthesized, duration-checked, and persisted before S2V", async () => {
  let requestedUrl = "";
  let requestedBody: unknown;
  let persistedSource = "";
  const result = await synthesizeTalkingVideoSpeech(
    textModePayload(),
    { apiKey: "test-key", baseUrl: "https://dashscope.example.com" },
    {
      fetchImpl: async (input, init) => {
        requestedUrl = String(input);
        requestedBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          output: { finish_reason: "stop", audio: { url: "https://dashscope.example.com/speech.wav" } },
          usage: { characters: 50 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
      probeDuration: async () => 8.4,
      persistOutput: async ({ url }) => {
        persistedSource = url;
        return "https://oss.example.com/talking-video/speech.wav";
      },
    },
  );
  assert.equal(requestedUrl, "https://dashscope.example.com/api/v1/services/aigc/multimodal-generation/generation");
  assert.equal((requestedBody as { model: string }).model, "qwen3-tts-instruct-flash");
  assert.equal(persistedSource, "https://dashscope.example.com/speech.wav");
  assert.deepEqual(result, {
    audioUrl: "https://oss.example.com/talking-video/speech.wav",
    durationSeconds: 8.4,
    providerCost: 1,
    voice: "Eldric Sage",
  });
});

test("talking video rejects synthesized speech at or above 20 seconds before video submission", async () => {
  await assert.rejects(
    synthesizeTalkingVideoSpeech(
      textModePayload(),
      { apiKey: "test-key", baseUrl: "https://dashscope.example.com" },
      {
        fetchImpl: async () => new Response(JSON.stringify({
          output: { audio: { url: "https://dashscope.example.com/too-long.wav" } },
        }), { status: 200, headers: { "content-type": "application/json" } }),
        probeDuration: async () => 20.1,
        persistOutput: async () => {
          throw new Error("must not persist");
        },
      },
    ),
    /超过有声视频要求的 20 秒限制/,
  );
});

test("talking video timeout identifies the exact English input that was measured", async () => {
  const script = "AI video will not replace creators. It helps us turn ideas into content faster.";
  await assert.rejects(
    synthesizeTalkingVideoSpeech(
      textModePayload({ speech_text: script, tts_language: "English" }),
      { apiKey: "test-key", baseUrl: "https://dashscope.example.com" },
      {
        fetchImpl: async () => new Response(JSON.stringify({
          output: { audio: { url: "https://dashscope.example.com/too-long.wav" } },
        }), { status: 200, headers: { "content-type": "application/json" } }),
        probeDuration: async () => 21.4,
        persistOutput: async () => "https://oss.example.com/unused.wav",
      },
    ),
    /14 个英文单词.*AI video will not replace creators/,
  );
});

test("Bailian adapter chains text-to-speech into S2V and carries TTS cost into polling", async () => {
  const previousFetch = globalThis.fetch;
  let submittedBody: unknown;
  try {
    globalThis.fetch = (async (_input, init) => {
      if (init?.method === "POST") submittedBody = JSON.parse(String(init.body));
      return init?.method === "POST"
        ? new Response(JSON.stringify({ output: { task_id: "s2v-task" } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        : new Response(JSON.stringify({
            output: {
              task_status: "SUCCEEDED",
              results: { video_url: "https://example.com/talking.mp4" },
            },
            usage: { duration: 5, SR: 480 },
          }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const adapter = new BailianAdapter({
      synthesizeTalkingSpeech: async () => ({
        audioUrl: "https://oss.example.com/generated-speech.wav",
        durationSeconds: 8.4,
        providerCost: 2,
        voice: "Eldric Sage",
      }),
    });
    const generated = await adapter.generate(textModePayload(), {
      apiKey: "test-key",
      baseUrl: "https://dashscope.example.com",
    });
    assert.equal(generated.taskId, "s2vtts_2__s2v-task");
    assert.deepEqual(submittedBody, {
      model: "wan2.2-s2v",
      input: {
        image_url: "https://example.com/character.png",
        audio_url: "https://oss.example.com/generated-speech.wav",
      },
      parameters: { resolution: "480P" },
    });

    const poll = await adapter.queryTask(generated.taskId, {
      apiKey: "test-key",
      baseUrl: "https://dashscope.example.com",
      skuId: "BAILIAN_WAN22_S2V",
    });
    assert.equal(poll.status, "succeeded");
    assert.equal(poll.providerCost, 627);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("precise motion mode persists Animate Move state and advances to VideoRetalk", async () => {
  const previousFetch = globalThis.fetch;
  const submitted: Array<{ url: string; body: Record<string, unknown> }> = [];
  let postCount = 0;
  let getCount = 0;
  try {
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (init?.method === "POST") {
        submitted.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
        postCount += 1;
        return new Response(JSON.stringify({
          output: { task_id: postCount === 1 ? "animate-task" : "retalk-task" },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      getCount += 1;
      return new Response(JSON.stringify(getCount === 1 ? {
        output: {
          task_status: "SUCCEEDED",
          results: { video_url: "https://example.com/motion.mp4" },
        },
        usage: { duration: 6, video_ratio: "pro" },
      } : {
        output: {
          task_status: "SUCCEEDED",
          results: { video_url: "https://example.com/final.mp4" },
        },
        usage: { duration: 8, SR: 720 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const adapter = new BailianAdapter();
    const generated = await adapter.generate({
      templateId: "bailian-wan2.2-s2v",
      nodeInputs: {
        input: {
          performance_mode: "precise",
          audio_input_mode: "upload",
          image_url: "https://example.com/character.png",
          audio_url: "https://example.com/voice.mp3",
          duration: 8,
          video_url: "https://example.com/reference.mp4",
          motion_duration: 6,
          mode: "wan-pro",
          video_extension: true,
        },
      },
    }, { apiKey: "test-key", baseUrl: "https://dashscope.example.com" });
    assert.match(generated.taskId, /^talkchain_[a-f0-9]{32}$/);
    assert.equal(submitted[0]?.url, "https://dashscope.example.com/api/v1/services/aigc/image2video/video-synthesis");
    assert.equal(submitted[0]?.body.model, "wan2.2-animate-move");

    const afterAnimate = await adapter.queryTask(generated.taskId, {
      apiKey: "test-key",
      baseUrl: "https://dashscope.example.com",
      skuId: "BAILIAN_WAN22_S2V",
      providerState: generated.providerState,
    });
    assert.equal(afterAnimate.status, "running");
    assert.equal(afterAnimate.progress, 55);
    assert.equal(submitted[1]?.body.model, "videoretalk");
    assert.deepEqual(submitted[1]?.body, {
      model: "videoretalk",
      input: {
        video_url: "https://example.com/motion.mp4",
        audio_url: "https://example.com/voice.mp3",
      },
      parameters: { video_extension: true },
    });

    const completed = await adapter.queryTask(generated.taskId, {
      apiKey: "test-key",
      baseUrl: "https://dashscope.example.com",
      skuId: "BAILIAN_WAN22_S2V",
      providerState: afterAnimate.providerState,
    });
    assert.equal(completed.status, "succeeded");
    assert.equal(completed.resultUrl, "https://example.com/final.mp4");
    assert.equal(completed.flatFeeCredits, 1060);
    assert.equal(completed.providerState, null);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
