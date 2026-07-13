import { randomUUID } from "crypto";
import { GenerationHistoryStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  IProviderAdapter,
  ProviderCostResult,
  ProviderResponse,
  StandardPayload,
} from "./types";
import { ProviderError } from "./types";
import type { TaskStatusPollData } from "@/types/task-status";

// ── 计费：每张图片积分（按质量档位）────────────────────────────────────────
export const GPT_IMAGE2_CREDITS_PER_IMAGE: Record<string, number> = {
  low: 20,
  medium: 50,
  high: 150,
  auto: 50,
};

// ── 环境变量 ─────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key =
    (process.env.SOCIAL_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "").trim();
  if (!key) {
    throw new ProviderError(
      "GPT-image-2 API key 未配置，请在 .env 中设置 SOCIAL_OPENAI_API_KEY",
      "CONFIG_MISSING",
      500
    );
  }
  return key;
}

function getBaseUrl(): string {
  const url =
    (process.env.SOCIAL_OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "").trim();
  return url ? url.replace(/\/$/, "") : "https://api.openai.com";
}

// ── 参数解析 ──────────────────────────────────────────────────────────────────

function parseN(nodeInputs: Record<string, Record<string, unknown>>): number {
  const raw = nodeInputs.input?.n;
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? "1"), 10);
  return Math.min(8, Math.max(1, Number.isFinite(n) && n > 0 ? n : 1));
}

function parseQuality(nodeInputs: Record<string, Record<string, unknown>>): string {
  const q = String(nodeInputs.input?.quality ?? "medium").toLowerCase().trim();
  return q in GPT_IMAGE2_CREDITS_PER_IMAGE ? q : "medium";
}

// ── OpenAI API 调用 ───────────────────────────────────────────────────────────

async function parseImageResponse(response: Response): Promise<string[]> {
  if (!response.ok) {
    let msg = `OpenAI API 错误 (${response.status})`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) msg = body.error.message;
    } catch {
      /* ignore */
    }
    throw new ProviderError(msg, "OPENAI_API_ERROR", response.status >= 500 ? 502 : 400);
  }

  const data = (await response.json()) as {
    data?: Array<{ url?: string; b64_json?: string }>;
  };

  const urls = (data.data ?? [])
    .map((item) => {
      if (item.url) return item.url;
      if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
      return "";
    })
    .filter(Boolean);

  if (urls.length === 0) {
    throw new ProviderError("OpenAI 返回空图片结果", "EMPTY_RESULT", 502);
  }
  return urls;
}

/** 带超时的 fetch 封装 */
function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException(`请求超时 (${timeoutMs}ms)`, "TimeoutError")), timeoutMs);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function callGenerations(
  baseUrl: string,
  apiKey: string,
  prompt: string,
  n: number,
  size: string,
  quality: string
): Promise<string[]> {
  console.log("[GptImage2] callGenerations start: baseUrl=%s n=%d size=%s quality=%s", baseUrl, n, size, quality);
  const t0 = Date.now();
  const res = await fetchWithTimeout(
    `${baseUrl}/v1/images/generations`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-2",
        prompt,
        n,
        size,
        quality,
        response_format: "url",
      }),
    },
    120_000  // 120s 超时
  );
  console.log("[GptImage2] callGenerations done: status=%d elapsed=%dms", res.status, Date.now() - t0);
  return parseImageResponse(res);
}

async function callEdits(
  baseUrl: string,
  apiKey: string,
  imageUrl: string,
  prompt: string,
  n: number,
  size: string,
  quality: string
): Promise<string[]> {
  // ── 步骤 1：下载参考图（20s 超时）─────────────────────────────────────────
  console.log("[GptImage2] callEdits: downloading reference image from %s", imageUrl.slice(0, 80));
  const t0 = Date.now();
  let imgRes: Response;
  try {
    imgRes = await fetchWithTimeout(imageUrl, { redirect: "follow" }, 20_000);
  } catch (e) {
    throw new ProviderError(
      `参考图下载失败：${e instanceof Error ? e.message : String(e)}`,
      "IMAGE_FETCH_FAILED",
      502
    );
  }
  if (!imgRes.ok) {
    throw new ProviderError(
      `参考图下载失败 (HTTP ${imgRes.status})`,
      "IMAGE_FETCH_FAILED",
      502
    );
  }

  const contentType = (imgRes.headers.get("content-type") ?? "image/png")
    .split(";")[0]
    .trim();
  const imageBuffer = await imgRes.arrayBuffer();
  console.log(
    "[GptImage2] callEdits: image downloaded in %dms, size=%dKB, contentType=%s",
    Date.now() - t0,
    Math.round(imageBuffer.byteLength / 1024),
    contentType
  );

  const ext = contentType.includes("jpeg") ? "jpg" : contentType.includes("webp") ? "webp" : "png";

  // ── 步骤 2：构造 multipart 并调 APIYI（120s 超时）───────────────────────
  const formData = new FormData();
  formData.append("model", "gpt-image-2");
  formData.append("prompt", prompt);
  formData.append("n", String(n));
  formData.append("size", size);
  formData.append("quality", quality);
  // APIYI edits 端点使用 image[] 字段名（参考 ai_gateway.py get_image_field_name）
  formData.append(
    "image[]",
    new Blob([imageBuffer], { type: contentType }),
    `reference.${ext}`
  );

  console.log("[GptImage2] callEdits: posting to %s/v1/images/edits ...", baseUrl);
  const t1 = Date.now();
  const res = await fetchWithTimeout(
    `${baseUrl}/v1/images/edits`,
    {
      method: "POST",
      // 不手动设置 Content-Type，让 fetch 自动附带 multipart boundary
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    },
    120_000  // 120s 超时
  );
  console.log("[GptImage2] callEdits: APIYI responded in %dms, status=%d", Date.now() - t1, res.status);
  return parseImageResponse(res);
}

// ── Adapter 实现 ──────────────────────────────────────────────────────────────

/**
 * GPT-image-2 图片生成适配器（同步）。
 *
 * - `generate()` 直接调用 `/images/edits`（有参考图，multipart/form-data）或 `/images/generations`（无参考图，JSON），
 *   将结果 URL 编码进 `raw.directResult` 返回给网关路由，由网关路由直接写入 SUCCESS 记录并扣费。
 * - `queryTask()` 从 `GenerationHistory` 表读取已落库的 SUCCESS 结果，供轮询接口返回前端。
 *
 * 环境变量：`SOCIAL_OPENAI_API_KEY`（必填），`SOCIAL_OPENAI_BASE_URL`（可选，默认 OpenAI 官方）。
 */
export class GptImage2Adapter implements IProviderAdapter {
  calculateCost(payload: StandardPayload): ProviderCostResult {
    const n = parseN(payload.nodeInputs);
    const quality = parseQuality(payload.nodeInputs);
    const perImage = GPT_IMAGE2_CREDITS_PER_IMAGE[quality] ?? 50;
    const total = n * perImage;
    return { cost: total, sellPrice: total };
  }

  async generate(
    payload: StandardPayload,
    _credentials: unknown
  ): Promise<ProviderResponse> {
    const apiKey = getApiKey();
    const baseUrl = getBaseUrl();
    const input = payload.nodeInputs.input ?? {};

    const prompt = String(input.prompt ?? "").trim();
    if (!prompt) {
      throw new ProviderError("提示词（prompt）不能为空", "INVALID_INPUT", 400);
    }

    const n = parseN(payload.nodeInputs);
    const quality = parseQuality(payload.nodeInputs);
    const size = String(input.size ?? "1024x1024").trim();
    const imageUrl = String(input.image_url ?? "").trim();

    console.log(
      "[GptImage2] generate start: n=%d quality=%s size=%s hasImage=%s baseUrl=%s",
      n, quality, size, Boolean(imageUrl), baseUrl
    );

    let resultUrls: string[];
    if (imageUrl) {
      resultUrls = await callEdits(baseUrl, apiKey, imageUrl, prompt, n, size, quality);
    } else {
      resultUrls = await callGenerations(baseUrl, apiKey, prompt, n, size, quality);
    }

    const perImage = GPT_IMAGE2_CREDITS_PER_IMAGE[quality] ?? 50;
    const providerCost = n * perImage;

    // 使用前缀 + 简短 UUID 作为 taskId（网关轮询路由 isValidTaskId 白名单 [\w-]+）
    const taskId = `gptimg_${randomUUID().replace(/-/g, "")}`;

    return {
      taskId,
      raw: {
        directResult: {
          status: "succeeded",
          resultUrls,
          providerCost,
        },
      },
    };
  }

  /**
   * 网关轮询时调用。
   * 由于 `generate()` 已由 generate route 直接写入 SUCCESS，此处从 DB 读取已落库结果返回。
   */
  async queryTask(
    taskId: string,
    _options?: unknown
  ): Promise<TaskStatusPollData> {
    const record = await prisma.generationHistory.findUnique({
      where: { taskId },
      select: { status: true, resultUrl: true, cost: true },
    });

    if (!record) {
      return { status: "failed", errorMessage: "任务记录不存在" };
    }

    if (record.status === GenerationHistoryStatus.SUCCESS) {
      const rawUrl = record.resultUrl ?? "";
      let resultUrls: string[] | undefined;
      try {
        const parsed: unknown = JSON.parse(rawUrl);
        if (Array.isArray(parsed)) {
          resultUrls = (parsed as unknown[]).filter(
            (u): u is string => typeof u === "string" && u.length > 0
          );
        }
      } catch {
        // 单张 URL，不是 JSON
      }
      const firstUrl = resultUrls ? (resultUrls[0] ?? "") : rawUrl;
      return {
        status: "succeeded",
        resultUrl: firstUrl,
        resultUrls: resultUrls ?? (rawUrl ? [rawUrl] : undefined),
        resultMediaType: "image",
        providerCost:
          typeof record.cost === "number" && Number.isFinite(record.cost)
            ? record.cost
            : undefined,
      };
    }

    if (record.status === GenerationHistoryStatus.FAILED) {
      return { status: "failed", errorMessage: "图片生成失败" };
    }

    // PENDING 状态：generate route 还未完成落库（理论上不会发生）
    return { status: "running", progress: 50 };
  }
}
