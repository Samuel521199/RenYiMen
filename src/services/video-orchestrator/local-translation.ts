import { createHash } from "node:crypto";

type TranslationLanguage = "zh" | "en";

interface LibreTranslateResponse {
  translatedText?: string | string[];
}

interface QwenMtResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    code?: string;
    message?: string;
  };
  code?: string;
  message?: string;
}

export class ProviderQuotaError extends Error {
  readonly code = "PROVIDER_QUOTA_EXHAUSTED";
  readonly provider = "qwen-mt";
  readonly recoveryAction = "CHECK_PROVIDER_BILLING";
  readonly httpStatus?: number;

  constructor(message: string, httpStatus?: number) {
    super(message);
    this.name = "ProviderQuotaError";
    this.httpStatus = httpStatus;
  }
}

function qwenResponseError(
  raw: QwenMtResponse,
  status: number,
  fallback: string,
): Error {
  const message = raw.error?.message || raw.message || fallback;
  const code = raw.error?.code || raw.code || "";
  if (/token[-_ ]?limit|quota|insufficient[_ -]?balance|billing/i.test(`${code} ${message}`)) {
    return new ProviderQuotaError(message, status);
  }
  return new Error(message);
}

function qwenTranslationFallbackModel(): string {
  return process.env.QWEN_MT_FALLBACK_MODEL?.trim() || "qwen-plus";
}

interface TranslationMetrics {
  cacheHits: number;
  translatedTexts: number;
  durationMs: number;
  provider?: "qwen-mt" | "libretranslate";
  model?: string;
}

const HAN_TEXT_PATTERN = /\p{Script=Han}/u;
const TRANSLATION_CACHE_MAX = 2_000;
const DEFAULT_QWEN_MT_MODEL = "qwen-mt-plus";
const TRANSLATION_POLICY_REVISION = "game-video-terms-v1";
const DEFAULT_QWEN_MT_DOMAIN = [
  "The text is from a game advertising and AI video production workflow.",
  "Translate film, storyboard, camera, visual design, game UI, and marketing terminology precisely.",
  "Preserve brand names, identifiers, JSON syntax, numbers, and established production terminology.",
  "Do not rewrite, summarize, explain, add, or omit information.",
].join(" ");
const ZH_TO_EN_TERMS = [
  { source: "高潮", target: "climax" },
  { source: "国风", target: "Guofeng" },
  { source: "关键牌", target: "decisive card" },
  { source: "关键出牌", target: "decisive play" },
  { source: "行动号召", target: "call to action" },
  { source: "引导下载", target: "drive downloads" },
  { source: "胜利奖励", target: "victory rewards" },
  { source: "游戏标题", target: "game title" },
  { source: "分镜", target: "storyboard shot" },
  { source: "镜头", target: "shot" },
] as const;
const translationCache = new Map<string, string>();

function translationEnabled(): boolean {
  return (
    process.env.MODEL_TRANSLATION_ENABLED
    ?? process.env.LOCAL_TRANSLATION_ENABLED
    ?? ""
  ).trim().toLowerCase() === "true";
}

function translationProvider(): "qwen-mt" | "libretranslate" {
  const value = (
    process.env.MODEL_TRANSLATION_PROVIDER
    ?? process.env.LOCAL_TRANSLATION_PROVIDER
    ?? "qwen-mt"
  ).trim().toLowerCase();
  if (value === "qwen-mt" || value === "qwen_mt" || value === "qwen") return "qwen-mt";
  if (value === "libretranslate" || value === "libre") return "libretranslate";
  throw new Error(`Unsupported model translation provider: ${value}`);
}

function translationBaseUrl(): string {
  return (process.env.LOCAL_TRANSLATION_BASE_URL?.trim() || "http://127.0.0.1:5000").replace(/\/+$/, "");
}

function qwenMtBaseUrl(): string {
  return (
    process.env.QWEN_MT_BASE_URL
    ?? process.env.DASHSCOPE_COMPATIBLE_BASE_URL
    ?? process.env.ALIYUN_COMPATIBLE_BASE_URL
    ?? "https://dashscope.aliyuncs.com/compatible-mode/v1"
  ).trim().replace(/\/+$/, "");
}

function qwenMtApiKey(): string {
  const key = (
    process.env.QWEN_MT_API_KEY
    ?? process.env.DASHSCOPE_API_KEY
    ?? process.env.BAILIAN_API_KEY
    ?? process.env.ALIYUN_API_KEY
    ?? ""
  ).trim();
  if (!key) {
    throw new Error(
      "Qwen-MT translation requires QWEN_MT_API_KEY, DASHSCOPE_API_KEY, BAILIAN_API_KEY, or ALIYUN_API_KEY",
    );
  }
  return key;
}

function qwenMtModel(): string {
  return process.env.QWEN_MT_MODEL?.trim() || DEFAULT_QWEN_MT_MODEL;
}

function qwenMtConcurrency(): number {
  const parsed = Number(process.env.QWEN_MT_CONCURRENCY);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(16, Math.round(parsed)));
}

function qwenMtMinIntervalMs(): number {
  const parsed = Number(process.env.QWEN_MT_MIN_INTERVAL_MS);
  if (!Number.isFinite(parsed)) return 1_200;
  return Math.max(0, Math.min(10_000, Math.round(parsed)));
}

function qwenMtBatchThreshold(): number {
  const parsed = Number(process.env.QWEN_MT_BATCH_THRESHOLD);
  if (!Number.isFinite(parsed)) return 8;
  return Math.max(2, Math.min(100, Math.round(parsed)));
}

let qwenMtNextRequestAt = 0;

async function waitForQwenMtRequestSlot(): Promise<void> {
  const now = Date.now();
  const delayMs = Math.max(0, qwenMtNextRequestAt - now);
  qwenMtNextRequestAt = Math.max(now, qwenMtNextRequestAt) + qwenMtMinIntervalMs();
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

function translationTimeoutMs(): number {
  const parsed = Number(
    process.env.MODEL_TRANSLATION_TIMEOUT_MS
    ?? process.env.LOCAL_TRANSLATION_TIMEOUT_MS,
  );
  if (!Number.isFinite(parsed)) return 30_000;
  return Math.max(1_000, Math.min(60_000, Math.round(parsed)));
}

function translationCacheKey(
  text: string,
  source: TranslationLanguage,
  target: TranslationLanguage,
  provider: "qwen-mt" | "libretranslate",
): string {
  const runtimeIdentity = provider === "qwen-mt"
    ? `${provider}:${qwenMtModel()}:${process.env.QWEN_MT_DOMAIN_PROMPT?.trim() || DEFAULT_QWEN_MT_DOMAIN}`
    : provider;
  return createHash("sha256")
    .update(`${TRANSLATION_POLICY_REVISION}\0${runtimeIdentity}\0${source}\0${target}\0${text}`)
    .digest("hex");
}

function libreLanguageCode(language: TranslationLanguage): string {
  return language === "zh" ? "zh-Hans" : language;
}

function qwenLanguageName(language: TranslationLanguage): string {
  return language === "zh" ? "Chinese" : "English";
}

function qwenMtTerms(source: TranslationLanguage, target: TranslationLanguage) {
  if (source === "zh" && target === "en") return ZH_TO_EN_TERMS;
  if (source === "en" && target === "zh") {
    return ZH_TO_EN_TERMS.map((term) => ({
      source: term.target,
      target: term.source,
    }));
  }
  return [];
}

function setCachedTranslation(key: string, translated: string): void {
  translationCache.set(key, translated);
  if (translationCache.size <= TRANSLATION_CACHE_MAX) return;
  const oldest = translationCache.keys().next().value;
  if (typeof oldest === "string") translationCache.delete(oldest);
}

export function containsHanText(value: string): boolean {
  return HAN_TEXT_PATTERN.test(value);
}

async function translateWithLibreTranslate(
  texts: string[],
  source: TranslationLanguage,
  target: TranslationLanguage,
): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), translationTimeoutMs());
  let response: Response;
  try {
    response = await fetch(`${translationBaseUrl()}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: texts,
        source: libreLanguageCode(source),
        target: libreLanguageCode(target),
        format: "text",
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Local translation timed out after ${translationTimeoutMs()}ms`, { cause: error });
    }
    throw new Error("Local LibreTranslate is unavailable", { cause: error });
  } finally {
    clearTimeout(timeout);
  }

  const raw = await response.json().catch(() => ({})) as LibreTranslateResponse & { error?: string };
  if (!response.ok) {
    throw new Error(raw.error || `Local translation failed with HTTP ${response.status}`);
  }
  const translated = Array.isArray(raw.translatedText)
    ? raw.translatedText
    : texts.length === 1 && typeof raw.translatedText === "string"
      ? [raw.translatedText]
      : [];
  if (translated.length !== texts.length || translated.some((item) => typeof item !== "string")) {
    throw new Error("Local translation returned an invalid batch response");
  }
  return translated;
}

async function requestOneWithQwenMt(
  text: string,
  source: TranslationLanguage,
  target: TranslationLanguage,
  strictTargetLanguage: "normal" | "strict" | "minimal-strict" = "normal",
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), translationTimeoutMs());
  let response: Response;
  try {
    response = await fetch(`${qwenMtBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${qwenMtApiKey()}`,
      },
      body: JSON.stringify({
        model: qwenMtModel(),
        messages: [{ role: "user", content: text }],
        translation_options: {
          source_lang: qwenLanguageName(source),
          target_lang: qwenLanguageName(target),
          terms: strictTargetLanguage === "minimal-strict" ? [] : qwenMtTerms(source, target),
          domains: strictTargetLanguage === "minimal-strict"
            ? "Translate every Chinese Han character into natural English. Return only the English translation and no Chinese characters."
            : [
                process.env.QWEN_MT_DOMAIN_PROMPT?.trim() || DEFAULT_QWEN_MT_DOMAIN,
                strictTargetLanguage === "strict" && target === "en"
                  ? "Translate every Chinese Han character into natural English. The output must contain English only and no Chinese characters."
                  : "",
              ].filter(Boolean).join(" "),
        },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Qwen-MT translation timed out after ${translationTimeoutMs()}ms`, { cause: error });
    }
    throw new Error("Qwen-MT translation service is unavailable", { cause: error });
  } finally {
    clearTimeout(timeout);
  }

  const raw = await response.json().catch(() => ({})) as QwenMtResponse;
  if (!response.ok) {
    throw qwenResponseError(
      raw,
      response.status,
      `Qwen-MT translation failed with HTTP ${response.status}`,
    );
  }
  const translated = raw.choices?.[0]?.message?.content?.trim();
  if (!translated) throw new Error("Qwen-MT returned an empty or invalid translation");
  return translated;
}

async function requestOneWithQwenChatFallback(
  text: string,
  source: TranslationLanguage,
  target: TranslationLanguage,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), translationTimeoutMs());
  try {
    await waitForQwenMtRequestSlot();
    const response = await fetch(`${qwenMtBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${qwenMtApiKey()}`,
      },
      body: JSON.stringify({
        model: qwenTranslationFallbackModel(),
        messages: [
          {
            role: "system",
            content: `Translate the user text from ${qwenLanguageName(source)} to ${qwenLanguageName(target)}. Return only the translation. Preserve identifiers, numbers, and JSON syntax. Do not explain.`,
          },
          { role: "user", content: text },
        ],
        enable_thinking: false,
        temperature: 0,
      }),
      signal: controller.signal,
    });
    const raw = await response.json().catch(() => ({})) as QwenMtResponse;
    if (!response.ok) {
      throw qwenResponseError(
        raw,
        response.status,
        `Qwen translation fallback failed with HTTP ${response.status}`,
      );
    }
    const translated = raw.choices?.[0]?.message?.content?.trim();
    if (!translated) throw new Error("Qwen translation fallback returned empty text");
    return translated;
  } finally {
    clearTimeout(timeout);
  }
}

async function normalizeEnglishResidueWithQwen(text: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), translationTimeoutMs());
  try {
    await waitForQwenMtRequestSlot();
    const response = await fetch(`${qwenMtBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${qwenMtApiKey()}`,
      },
      body: JSON.stringify({
        model: qwenTranslationFallbackModel(),
        messages: [
          {
            role: "system",
            content: [
              "Rewrite the user text as English-only production copy.",
              "Replace every remaining Chinese Han sequence, including proper names and quoted labels, with an English translation, an English description, or Latin transliteration.",
              "The output must contain zero Chinese Han characters.",
              "Preserve identifiers, numbers, punctuation, and JSON syntax. Return only the rewritten text.",
            ].join(" "),
          },
          { role: "user", content: text },
        ],
        enable_thinking: false,
        temperature: 0,
      }),
      signal: controller.signal,
    });
    const raw = await response.json().catch(() => ({})) as QwenMtResponse;
    if (!response.ok) {
      throw qwenResponseError(
        raw,
        response.status,
        `Qwen English normalization failed with HTTP ${response.status}`,
      );
    }
    const normalized = raw.choices?.[0]?.message?.content?.trim();
    if (!normalized) throw new Error("Qwen English normalization returned empty text");
    return normalized;
  } finally {
    clearTimeout(timeout);
  }
}

async function translateBatchWithQwenChatFallback(
  texts: string[],
  source: TranslationLanguage,
  target: TranslationLanguage,
): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), translationTimeoutMs());
  try {
    await waitForQwenMtRequestSlot();
    const response = await fetch(`${qwenMtBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${qwenMtApiKey()}`,
      },
      body: JSON.stringify({
        model: qwenTranslationFallbackModel(),
        messages: [
          {
            role: "system",
            content: [
              `Translate every item in the JSON array from ${qwenLanguageName(source)} to ${qwenLanguageName(target)}.`,
              "Return one JSON object with exactly this shape: {\"translations\":[\"...\"]}.",
              "Keep the same item count and order. Preserve identifiers, numbers, and JSON syntax inside each item.",
              target === "en" ? "Every output item must contain English only and no Chinese characters." : "",
              "Do not explain or add fields.",
            ].filter(Boolean).join(" "),
          },
          { role: "user", content: JSON.stringify(texts) },
        ],
        enable_thinking: false,
        temperature: 0,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    const raw = await response.json().catch(() => ({})) as QwenMtResponse;
    if (!response.ok) {
      throw qwenResponseError(
        raw,
        response.status,
        `Qwen batch translation failed with HTTP ${response.status}`,
      );
    }
    const content = raw.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("Qwen batch translation returned empty text");
    const parsed = JSON.parse(content) as { translations?: unknown };
    if (
      !Array.isArray(parsed.translations)
      || parsed.translations.length !== texts.length
      || parsed.translations.some((item) => typeof item !== "string" || !item.trim())
    ) {
      throw new Error("Qwen batch translation returned an invalid translation array");
    }
    const translations = parsed.translations.map((item) => String(item).trim());
    if (source === "zh" && target === "en" && translations.some(containsHanText)) {
      throw new Error("Qwen batch translation returned Chinese residue");
    }
    return translations;
  } finally {
    clearTimeout(timeout);
  }
}

function isQwenMtRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /rate.?limit|request limit|too many requests|HTTP 429/i.test(message);
}

async function translateOneWithQwenMt(
  text: string,
  source: TranslationLanguage,
  target: TranslationLanguage,
  strictTargetLanguage: "normal" | "strict" | "minimal-strict" = "normal",
): Promise<string> {
  const maxAttempts = 5;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await waitForQwenMtRequestSlot();
    try {
      return await requestOneWithQwenMt(text, source, target, strictTargetLanguage);
    } catch (error) {
      lastError = error;
      if (!isQwenMtRateLimitError(error) || attempt === maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
    }
  }
  throw lastError;
}

async function translateWithQwenMt(
  texts: string[],
  source: TranslationLanguage,
  target: TranslationLanguage,
): Promise<string[]> {
  const output = new Array<string>(texts.length);
  let cursor = 0;
  const workerCount = Math.min(qwenMtConcurrency(), texts.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < texts.length) {
      const index = cursor;
      cursor += 1;
      let translated = await translateOneWithQwenMt(texts[index], source, target);
      if (source === "zh" && target === "en" && containsHanText(translated)) {
        translated = await translateOneWithQwenMt(texts[index], source, target, "strict");
      }
      if (source === "zh" && target === "en" && containsHanText(translated)) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        translated = await translateOneWithQwenMt(texts[index], source, target, "minimal-strict");
      }
      if (source === "zh" && target === "en" && containsHanText(translated)) {
        translated = await requestOneWithQwenChatFallback(texts[index], source, target);
      }
      if (source === "zh" && target === "en" && containsHanText(translated)) {
        translated = await normalizeEnglishResidueWithQwen(translated);
      }
      if (source === "zh" && target === "en" && containsHanText(translated)) {
        throw new Error(
          `Qwen translation returned Chinese residue after MT and chat fallbacks (sourceHash=${createHash("sha256").update(texts[index]).digest("hex").slice(0, 12)})`,
        );
      }
      output[index] = translated;
    }
  }));
  return output;
}

export async function translateTexts(
  texts: string[],
  source: TranslationLanguage,
  target: TranslationLanguage,
): Promise<{ texts: string[]; metrics: TranslationMetrics }> {
  const startedAt = Date.now();
  if (!texts.length || source === target) {
    return {
      texts: [...texts],
      metrics: { cacheHits: texts.length, translatedTexts: 0, durationMs: Date.now() - startedAt },
    };
  }
  if (!translationEnabled()) {
    throw new Error(
      "Model translation is required but disabled. Set MODEL_TRANSLATION_ENABLED=true.",
    );
  }
  const provider = translationProvider();
  const providerModel = provider === "qwen-mt" ? qwenMtModel() : "libretranslate";

  const output = new Array<string>(texts.length);
  const missingByText = new Map<string, number[]>();
  let cacheHits = 0;
  texts.forEach((text, index) => {
    const key = translationCacheKey(text, source, target, provider);
    const cached = translationCache.get(key);
    if (cached !== undefined) {
      if (source === "zh" && target === "en" && containsHanText(cached)) {
        translationCache.delete(key);
      } else {
        output[index] = cached;
        cacheHits += 1;
        return;
      }
    }
    const indices = missingByText.get(text) ?? [];
    indices.push(index);
    missingByText.set(text, indices);
  });

  const missingTexts = [...missingByText.keys()];
  if (missingTexts.length) {
    let translated: string[];
    if (provider === "qwen-mt" && missingTexts.length >= qwenMtBatchThreshold()) {
      try {
        translated = await translateBatchWithQwenChatFallback(missingTexts, source, target);
      } catch {
        translated = await translateWithQwenMt(missingTexts, source, target);
      }
    } else {
      translated = provider === "qwen-mt"
        ? await translateWithQwenMt(missingTexts, source, target)
        : await translateWithLibreTranslate(missingTexts, source, target);
    }
    if (translated.length !== missingTexts.length || translated.some((item) => typeof item !== "string")) {
      throw new Error("Model translation returned an invalid response");
    }
    missingTexts.forEach((text, translatedIndex) => {
      const value = translated[translatedIndex].trim();
      if (!value) throw new Error("Model translation returned empty text");
      if (source === "zh" && target === "en" && containsHanText(value)) {
        throw new Error("Model translation returned Chinese residue for an English target");
      }
      const key = translationCacheKey(text, source, target, provider);
      setCachedTranslation(key, value);
      for (const outputIndex of missingByText.get(text) ?? []) output[outputIndex] = value;
    });
  }

  return {
    texts: output,
    metrics: {
      cacheHits,
      translatedTexts: missingTexts.length,
      durationMs: Date.now() - startedAt,
      provider,
      model: providerModel,
    },
  };
}

function collectHanStrings(value: unknown, output: Set<string>): void {
  if (typeof value === "string") {
    if (!containsHanText(value)) return;
    const parsed = parseJsonContainer(value);
    if (parsed !== undefined) {
      collectHanStrings(parsed, output);
    } else {
      output.add(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectHanStrings(item, output));
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectHanStrings(item, output));
  }
}

function isDisplayOnlyFieldKey(key: string): boolean {
  return key === "display" || key.endsWith("Zh") || key.endsWith("_zh");
}

function stripDisplayOnlyFields(value: unknown): unknown {
  if (typeof value === "string") {
    const parsed = parseJsonContainer(value);
    return parsed === undefined ? value : JSON.stringify(stripDisplayOnlyFields(parsed));
  }
  if (Array.isArray(value)) return value.map((item) => stripDisplayOnlyFields(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !isDisplayOnlyFieldKey(key))
        .map(([key, item]) => [key, stripDisplayOnlyFields(item)]),
    );
  }
  return value;
}

function replaceStrings(value: unknown, translations: Map<string, string>): unknown {
  if (typeof value === "string") {
    const direct = translations.get(value);
    if (direct !== undefined) return direct;
    const parsed = parseJsonContainer(value);
    return parsed === undefined ? value : JSON.stringify(replaceStrings(parsed, translations));
  }
  if (Array.isArray(value)) return value.map((item) => replaceStrings(item, translations));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceStrings(item, translations)]),
    );
  }
  return value;
}

function ensureJsonObjectInstruction(
  messages: unknown,
  responseFormat: unknown,
): unknown {
  const isJsonObject = (
    responseFormat
    && typeof responseFormat === "object"
    && (responseFormat as { type?: unknown }).type === "json_object"
  );
  if (!isJsonObject || !Array.isArray(messages)) return messages;
  const containsJsonInstruction = messages.some((message) => (
    message
    && typeof message === "object"
    && typeof (message as { content?: unknown }).content === "string"
    && /\bjson\b/i.test((message as { content: string }).content)
  ));
  if (containsJsonInstruction) return messages;
  return [
    {
      role: "system",
      content: "Return the response as a valid JSON object.",
    },
    ...messages,
  ];
}

function parseJsonContainer(value: string): unknown | undefined {
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function prepareEnglishOnlyModelRequestBody(
  body: Record<string, unknown>,
): Promise<{ body: Record<string, unknown>; metrics: TranslationMetrics }> {
  const executionMessages = stripDisplayOnlyFields(body.messages);
  const strings = new Set<string>();
  collectHanStrings(executionMessages, strings);
  if (!strings.size) {
    return {
      body: {
        ...body,
        messages: ensureJsonObjectInstruction(executionMessages, body.response_format),
      },
      metrics: { cacheHits: 0, translatedTexts: 0, durationMs: 0 },
    };
  }
  const sourceTexts = [...strings];
  const translated = await translateTexts(sourceTexts, "zh", "en");
  const replacements = new Map(sourceTexts.map((text, index) => [text, translated.texts[index]]));
  const translatedMessages = replaceStrings(executionMessages, replacements);
  const prepared = {
    ...body,
    messages: ensureJsonObjectInstruction(translatedMessages, body.response_format),
  };
  const residue = new Set<string>();
  collectHanStrings(prepared.messages, residue);
  if (residue.size) {
    throw new Error(
      `English-only model boundary rejected ${residue.size} untranslated Chinese text value(s)`,
    );
  }
  return { body: prepared, metrics: translated.metrics };
}

/**
 * Only fields that the current workbench renders to users belong here.
 * Internal planner/audit fields may also end in `_zh`; translating those adds
 * latency and cost without improving the user experience.
 */
const USER_VISIBLE_CHINESE_FIELD_KEYS = new Set([
  "actionZh",
  "action_zh",
  "backgroundZh",
  "background_zh",
  "cameraZh",
  "camera_zh",
  "descriptionZh",
  "description_zh",
  "detailZh",
  "detail_zh",
  "displayNameZh",
  "display_name_zh",
  "imagePromptZh",
  "image_prompt_zh",
  "labelZh",
  "label_zh",
  "linesZh",
  "lines_zh",
  "messageZh",
  "message_zh",
  "negativePromptZh",
  "negative_prompt_zh",
  "promptZh",
  "prompt_zh",
  "purposeZh",
  "purpose_zh",
  "reasonZh",
  "reason_zh",
  "recommendationZh",
  "recommendation_zh",
  "sceneZh",
  "scene_zh",
  "summaryZh",
  "summary_zh",
  "titleZh",
  "title_zh",
  "videoPromptZh",
  "video_prompt_zh",
]);

function isUserVisibleChineseFieldKey(key: string): boolean {
  return USER_VISIBLE_CHINESE_FIELD_KEYS.has(key);
}

function collectChineseDisplayStrings(value: unknown, output: Set<string>, translateBranch = false): void {
  if (typeof value === "string") {
    if (translateBranch && value.trim()) output.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectChineseDisplayStrings(item, output, translateBranch));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => {
      collectChineseDisplayStrings(item, output, translateBranch || isUserVisibleChineseFieldKey(key));
    });
  }
}

function replaceChineseDisplayStrings(
  value: unknown,
  translations: Map<string, string>,
  translateBranch = false,
): unknown {
  if (typeof value === "string") return translateBranch ? translations.get(value) ?? value : value;
  if (Array.isArray(value)) {
    return value.map((item) => replaceChineseDisplayStrings(item, translations, translateBranch));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replaceChineseDisplayStrings(item, translations, translateBranch || isUserVisibleChineseFieldKey(key)),
      ]),
    );
  }
  return value;
}

export async function localizeChineseDisplayFields(
  value: unknown,
): Promise<{ value: unknown; metrics: TranslationMetrics }> {
  const strings = new Set<string>();
  collectChineseDisplayStrings(value, strings);
  const sourceTexts = [...strings].filter((text) => !containsHanText(text));
  if (!sourceTexts.length) {
    return {
      value,
      metrics: { cacheHits: 0, translatedTexts: 0, durationMs: 0 },
    };
  }
  const translated = await translateTexts(sourceTexts, "en", "zh");
  const replacements = new Map(sourceTexts.map((text, index) => [text, translated.texts[index]]));
  return {
    value: replaceChineseDisplayStrings(value, replacements),
    metrics: translated.metrics,
  };
}

export async function localizeChineseDisplayFieldsNonCritical(
  value: unknown,
  options: {
    scheduleRetry?: (work: () => void) => void;
  } = {},
): Promise<{
  value: unknown;
  metrics: TranslationMetrics;
  deferred: boolean;
  deferredError?: unknown;
}> {
  try {
    const localized = await localizeChineseDisplayFields(value);
    return { ...localized, deferred: false };
  } catch (error) {
    const scheduleRetry = options.scheduleRetry ?? ((work: () => void) => {
      const timer = setTimeout(work, 60_000);
      timer.unref?.();
    });
    scheduleRetry(() => {
      // The retry safely warms the translation cache. Canonical English output
      // has already continued through the pipeline and remains authoritative.
      void localizeChineseDisplayFields(value).catch(() => undefined);
    });
    return {
      value,
      metrics: { cacheHits: 0, translatedTexts: 0, durationMs: 0 },
      deferred: true,
      deferredError: error,
    };
  }
}

export function clearLocalTranslationCacheForTests(): void {
  translationCache.clear();
  qwenMtNextRequestAt = 0;
}
