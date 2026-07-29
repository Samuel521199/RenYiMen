import assert from "node:assert/strict";
import test from "node:test";
import {
  clearLocalTranslationCacheForTests,
  localizeChineseDisplayFields,
  prepareEnglishOnlyModelRequestBody,
} from "./local-translation";

type QwenMtRequest = {
  model: string;
  messages: Array<{ role: string; content: string }>;
  translation_options: {
    source_lang: string;
    target_lang: string;
    domains: string;
    terms: Array<{ source: string; target: string }>;
  };
};

function withQwenMtTestEnvironment() {
  const previous = {
    enabled: process.env.MODEL_TRANSLATION_ENABLED,
    provider: process.env.MODEL_TRANSLATION_PROVIDER,
    apiKey: process.env.QWEN_MT_API_KEY,
    model: process.env.QWEN_MT_MODEL,
    concurrency: process.env.QWEN_MT_CONCURRENCY,
    minIntervalMs: process.env.QWEN_MT_MIN_INTERVAL_MS,
  };
  process.env.MODEL_TRANSLATION_ENABLED = "true";
  process.env.MODEL_TRANSLATION_PROVIDER = "qwen-mt";
  process.env.QWEN_MT_API_KEY = "test-key";
  process.env.QWEN_MT_MODEL = "qwen-mt-plus";
  process.env.QWEN_MT_CONCURRENCY = "1";
  process.env.QWEN_MT_MIN_INTERVAL_MS = "0";
  return () => {
    for (const [name, value] of Object.entries({
      MODEL_TRANSLATION_ENABLED: previous.enabled,
      MODEL_TRANSLATION_PROVIDER: previous.provider,
      QWEN_MT_API_KEY: previous.apiKey,
      QWEN_MT_MODEL: previous.model,
      QWEN_MT_CONCURRENCY: previous.concurrency,
      QWEN_MT_MIN_INTERVAL_MS: previous.minIntervalMs,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

test("translates Chinese model inputs with Qwen-MT Plus and preserves technical fields", async () => {
  const restoreEnvironment = withQwenMtTestEnvironment();
  const previousFetch = globalThis.fetch;
  clearLocalTranslationCacheForTests();
  const calls: QwenMtRequest[] = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as QwenMtRequest;
    calls.push(body);
    const source = body.messages[0]?.content;
    const translated = source === "制作一条产品广告"
      ? "Create a product advertisement"
      : "Red packaging";
    return new Response(JSON.stringify({
      choices: [{ message: { content: translated } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const prepared = await prepareEnglishOnlyModelRequestBody({
      model: "qwen",
      messages: [{
        role: "user",
        content: JSON.stringify({
          user_idea: "制作一条产品广告",
          product: "红色包装",
          segment_no: 1,
          asset_id: "hero-product",
        }),
      }],
    });
    const messages = prepared.body.messages as Array<{ content: string }>;
    assert.doesNotMatch(messages[0].content, /\p{Script=Han}/u);
    assert.match(messages[0].content, /Create a product advertisement/);
    assert.match(messages[0].content, /hero-product/);
    assert.equal(calls.length, 2);
    assert.equal(prepared.metrics.translatedTexts, 2);
    assert.equal(prepared.metrics.provider, "qwen-mt");
    assert.equal(prepared.metrics.model, "qwen-mt-plus");
    assert.ok(calls.every((call) => call.model === "qwen-mt-plus"));
    assert.ok(calls.every((call) => call.translation_options.source_lang === "Chinese"));
    assert.ok(calls.every((call) => call.translation_options.target_lang === "English"));
    assert.ok(calls.every((call) => call.translation_options.domains.includes("game advertising")));
    assert.ok(calls.every((call) => call.translation_options.terms.some(
      (term) => term.source === "高潮" && term.target === "climax",
    )));
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnvironment();
  }
});

test("localizes only user-visible Chinese fields with reverse Qwen-MT terminology", async () => {
  const restoreEnvironment = withQwenMtTestEnvironment();
  const previousFetch = globalThis.fetch;
  clearLocalTranslationCacheForTests();
  const calls: QwenMtRequest[] = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as QwenMtRequest;
    calls.push(body);
    const source = body.messages[0]?.content;
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: source === "Hero enters" ? "主角登场" : "产品特写",
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const localized = await localizeChineseDisplayFields({
      purpose_en: "Hero enters",
      purpose_zh: "Hero enters",
      nested: {
        labelZh: "Product close-up",
        duration_reason_zh: "This internal timing reason is not shown to users",
        audio_strategy_zh: "This internal audio strategy is not shown to users",
      },
      asset_id: "hero-product",
    });
    assert.deepEqual(localized.value, {
      purpose_en: "Hero enters",
      purpose_zh: "主角登场",
      nested: {
        labelZh: "产品特写",
        duration_reason_zh: "This internal timing reason is not shown to users",
        audio_strategy_zh: "This internal audio strategy is not shown to users",
      },
      asset_id: "hero-product",
    });
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => call.translation_options.source_lang === "English"));
    assert.ok(calls.every((call) => call.translation_options.target_lang === "Chinese"));
    assert.ok(calls.every((call) => call.translation_options.terms.some(
      (term) => term.source === "climax" && term.target === "高潮",
    )));
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnvironment();
  }
});

test("reuses cached Qwen-MT translations without another upstream request", async () => {
  const restoreEnvironment = withQwenMtTestEnvironment();
  const previousFetch = globalThis.fetch;
  clearLocalTranslationCacheForTests();
  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount += 1;
    return new Response(JSON.stringify({
      choices: [{ message: { content: "The climax requires a standalone shot." } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const body = {
      messages: [{ role: "user", content: "高潮需要独立镜头" }],
    };
    const first = await prepareEnglishOnlyModelRequestBody(body);
    const second = await prepareEnglishOnlyModelRequestBody(body);
    assert.equal(callCount, 1);
    assert.equal(first.metrics.translatedTexts, 1);
    assert.equal(second.metrics.translatedTexts, 0);
    assert.equal(second.metrics.cacheHits, 1);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnvironment();
  }
});

test("strictly retries a Qwen-MT result that still contains Chinese and caches only the clean result", async () => {
  const restoreEnvironment = withQwenMtTestEnvironment();
  const previousFetch = globalThis.fetch;
  clearLocalTranslationCacheForTests();
  const calls: QwenMtRequest[] = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as QwenMtRequest;
    calls.push(body);
    const content = calls.length === 1
      ? "Keep the 品牌标志 visible"
      : "Keep the brand logo visible";
    return new Response(JSON.stringify({
      choices: [{ message: { content } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const body = {
      messages: [{ role: "user", content: "保持品牌标志清晰可见" }],
    };
    const first = await prepareEnglishOnlyModelRequestBody(body);
    const second = await prepareEnglishOnlyModelRequestBody(body);
    const messages = first.body.messages as Array<{ content: string }>;
    assert.equal(messages[0].content, "Keep the brand logo visible");
    assert.equal(calls.length, 2);
    assert.match(calls[1].translation_options.domains, /no Chinese characters/);
    assert.equal(second.metrics.cacheHits, 1);
    assert.equal(second.metrics.translatedTexts, 0);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnvironment();
  }
});

test("uses an isolated minimal-strict request when terminology guidance preserves Chinese", async () => {
  const restoreEnvironment = withQwenMtTestEnvironment();
  const previousFetch = globalThis.fetch;
  clearLocalTranslationCacheForTests();
  const calls: QwenMtRequest[] = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as QwenMtRequest;
    calls.push(body);
    const content = calls.length < 3
      ? "The screen is clean with no 干扰 elements"
      : "The screen is clean with no distracting elements";
    return new Response(JSON.stringify({
      choices: [{ message: { content } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const prepared = await prepareEnglishOnlyModelRequestBody({
      messages: [{ role: "user", content: "画面纯净无干扰元素" }],
    });
    const messages = prepared.body.messages as Array<{ content: string }>;
    assert.equal(messages[0].content, "The screen is clean with no distracting elements");
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[2].translation_options.terms, []);
    assert.match(calls[2].translation_options.domains, /Return only the English translation/);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnvironment();
  }
});

test("falls back to a non-thinking chat translation when Qwen-MT repeatedly preserves Chinese", async () => {
  const restoreEnvironment = withQwenMtTestEnvironment();
  const previousFetch = globalThis.fetch;
  clearLocalTranslationCacheForTests();
  const calls: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    const content = body.translation_options
      ? "Keep the 品牌标志 visible"
      : "Keep the brand logo visible";
    return new Response(JSON.stringify({
      choices: [{ message: { content } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const prepared = await prepareEnglishOnlyModelRequestBody({
      messages: [{ role: "user", content: "保持品牌标志清晰可见" }],
    });
    const messages = prepared.body.messages as Array<{ content: string }>;
    assert.equal(messages[0].content, "Keep the brand logo visible");
    assert.equal(calls.length, 4);
    assert.equal(calls[3].model, "qwen-plus");
    assert.equal(calls[3].enable_thinking, false);
    assert.equal(calls[3].translation_options, undefined);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnvironment();
  }
});

test("translates large request bodies in one structured chat batch", async () => {
  const restoreEnvironment = withQwenMtTestEnvironment();
  const previousFetch = globalThis.fetch;
  clearLocalTranslationCacheForTests();
  let callCount = 0;
  globalThis.fetch = (async (_input, init) => {
    callCount += 1;
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ content: string }>;
      response_format?: { type: string };
    };
    const sourceTexts = JSON.parse(body.messages[1].content) as string[];
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            translations: sourceTexts.map((_item, index) => `English item ${index + 1}`),
          }),
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const prepared = await prepareEnglishOnlyModelRequestBody({
      messages: [{
        role: "user",
        content: Array.from({ length: 8 }, (_item, index) => `中文内容${index + 1}`),
      }],
    });
    assert.equal(callCount, 1);
    assert.deepEqual(
      (prepared.body.messages as Array<{ content: string[] }>)[0].content,
      Array.from({ length: 8 }, (_item, index) => `English item ${index + 1}`),
    );
    assert.equal(prepared.metrics.translatedTexts, 8);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnvironment();
  }
});

test("preserves the DashScope JSON-object request invariant after translation", async () => {
  const restoreEnvironment = withQwenMtTestEnvironment();
  const previousFetch = globalThis.fetch;
  clearLocalTranslationCacheForTests();
  globalThis.fetch = (async () => new Response(JSON.stringify({
    choices: [{ message: { content: "Return a structured object." } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;

  try {
    const prepared = await prepareEnglishOnlyModelRequestBody({
      messages: [{ role: "user", content: "请返回结构化对象" }],
      response_format: { type: "json_object" },
    });
    const messages = prepared.body.messages as Array<{ role: string; content: string }>;
    assert.equal(messages[0].role, "system");
    assert.match(messages[0].content, /\bJSON\b/);
    assert.ok(messages.some((message) => message.content === "Return a structured object."));
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnvironment();
  }
});

test("removes Chinese display fields instead of translating them into execution context", async () => {
  const restoreEnvironment = withQwenMtTestEnvironment();
  const previousFetch = globalThis.fetch;
  clearLocalTranslationCacheForTests();
  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount += 1;
    throw new Error("translation should not be called for display-only fields");
  }) as typeof fetch;

  try {
    const prepared = await prepareEnglishOnlyModelRequestBody({
      messages: [{
        role: "user",
        content: JSON.stringify({
          imagePrompt: "A blue glass sphere on white.",
          imagePromptZh: "白色背景上的蓝色玻璃球",
          description_zh: "仅供界面展示",
          display: { zh: { prompt: "中文展示副本" } },
        }),
      }],
    });
    const content = JSON.parse(
      (prepared.body.messages as Array<{ content: string }>)[0].content,
    ) as Record<string, unknown>;
    assert.deepEqual(content, { imagePrompt: "A blue glass sphere on white." });
    assert.equal(callCount, 0);
    assert.equal(prepared.metrics.translatedTexts, 0);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnvironment();
  }
});

test("normalizes Chinese proper names that translation deliberately preserves", async () => {
  const restoreEnvironment = withQwenMtTestEnvironment();
  const previousFetch = globalThis.fetch;
  clearLocalTranslationCacheForTests();
  let callCount = 0;
  globalThis.fetch = (async (_input, init) => {
    callCount += 1;
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const isNormalization = body.messages[0]?.content.includes("zero Chinese Han characters");
    const content = isNormalization
      ? "Show the Tongits King brand logo."
      : "Show the 斗牛王 brand logo.";
    return new Response(JSON.stringify({
      choices: [{ message: { content } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const prepared = await prepareEnglishOnlyModelRequestBody({
      messages: [{ role: "user", content: "展示斗牛王品牌标志" }],
    });
    assert.equal(
      (prepared.body.messages as Array<{ content: string }>)[0].content,
      "Show the Tongits King brand logo.",
    );
    assert.equal(callCount, 5);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnvironment();
  }
});
