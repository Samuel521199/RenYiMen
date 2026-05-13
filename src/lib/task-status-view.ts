import type { TaskStatusPollData, TaskStatusViewModel } from "@/types/task-status";

/** 根据结果 URL 路径推断媒体类型；无明确图片后缀时视为视频。 */
export function inferMediaTypeFromResultUrl(url: string): "image" | "video" {
  const path = url.trim().split(/[?#]/)[0] ?? "";
  if (/\.(png|jpe?g|webp)$/i.test(path)) return "image";
  return "video";
}

export const DEFAULT_TASK_LOADING_HINTS = [
  "模型正在进行物理计算…",
  "正在渲染光影帧…",
  "排队拥挤，请耐心等待…",
  "正在排队分配算力…",
  "正在解析首尾帧与提示词语义…",
  "正在调度视频扩散模型…",
  "长任务预计数分钟，您可暂时离开本页，稍后返回查看结果。",
];

/** 各 SKU 预计完成耗时（毫秒），未列出的 SKU 使用默认 150s。 */
const SKU_EXPECTED_DURATION_MS: Record<string, number> = {
  BAILIAN_WANX_I2V: 180_000,
  KLING_CINEMA_PRO: 180_000,
  RH_SVD_IMG2VID: 180_000,
  RH_TXT2IMG_SHORTDRAMA: 30_000,
};

const DEFAULT_EXPECTED_DURATION_MS = 150_000;

export function resolveExpectedDurationMsForSku(sku: { skuId: string } | null): number {
  if (!sku?.skuId) return DEFAULT_EXPECTED_DURATION_MS;
  return SKU_EXPECTED_DURATION_MS[sku.skuId] ?? DEFAULT_EXPECTED_DURATION_MS;
}

/**
 * 伪进度：ease-out 缓动，随已耗时 / 预计耗时趋近 99%，成功后再由 UI 切到 100%。
 */
export function computePseudoProgressPercent(elapsedMs: number, expectedDurationMs: number): number {
  if (!(expectedDurationMs > 0) || !Number.isFinite(elapsedMs) || elapsedMs < 0) return 0;
  const t = Math.min(1, Math.max(0, elapsedMs / expectedDurationMs));
  const eased = 1 - (1 - t) ** 3;
  return Math.min(99, 99 * eased);
}

/**
 * 将轮询数据与传输层状态合并为 `TaskStatusViewer` 所需的展示模型。
 */
export function buildTaskViewerModel(
  data: TaskStatusPollData | null,
  ctx: {
    isPolling: boolean;
    transportError: Error | null;
    consecutiveErrors: number;
    /** 自开始轮询起的毫秒数（来自 `useTaskPolling.elapsedMs`） */
    elapsedMs?: number;
    /** 当前 SKU 预计总耗时；缺省按 150s 伪进度 */
    expectedDurationMs?: number;
  }
): TaskStatusViewModel {
  if (data?.status === "succeeded") {
    const sellPrice =
      typeof data.sellPrice === "number" && Number.isFinite(data.sellPrice) && data.sellPrice >= 0
        ? data.sellPrice
        : undefined;
    const resultUrl = data.resultUrl?.trim() ? String(data.resultUrl).trim() : undefined;
    const mediaType = resultUrl ? inferMediaTypeFromResultUrl(resultUrl) : undefined;
    return {
      phase: "success",
      videoUrl: resultUrl,
      ...(mediaType !== undefined ? { mediaType } : {}),
      hints: DEFAULT_TASK_LOADING_HINTS,
      ...(sellPrice !== undefined ? { sellPrice } : {}),
    };
  }

  if (data?.status === "failed") {
    return {
      phase: "failure",
      errorMessage: data.errorMessage ?? "生成失败，原因未知。",
      hints: DEFAULT_TASK_LOADING_HINTS,
    };
  }

  const subPhase: "queued" | "running" =
    !data || data.status === "queued" ? "queued" : "running";

  let transportMessage: string | undefined;
  if (ctx.transportError && ctx.isPolling) {
    transportMessage = `请求异常（${ctx.transportError.message}），已按指数退避自动重试（第 ${ctx.consecutiveErrors} 次）。`;
  }

  const expectedMs = ctx.expectedDurationMs ?? DEFAULT_EXPECTED_DURATION_MS;
  const elapsed = typeof ctx.elapsedMs === "number" && ctx.elapsedMs >= 0 ? ctx.elapsedMs : 0;

  return {
    phase: "loading",
    subPhase,
    elapsedMs: elapsed,
    expectedDurationMs: expectedMs,
    hints: DEFAULT_TASK_LOADING_HINTS,
    transportMessage,
  };
}
