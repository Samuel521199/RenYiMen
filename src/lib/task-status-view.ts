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

export const DANCE_MOVE_LOADING_HINTS = [
  "正在分析参考视频中的舞蹈动作与节奏…",
  "正在识别人物姿态和面部表情…",
  "正在将动作轨迹迁移到图片人物…",
  "正在优化肢体连贯性与画面稳定性…",
  "正在渲染舞蹈视频，平均约需 377 秒，请耐心等待…",
];

export const S2V_LOADING_HINTS = [
  "正在分析人声音频的节奏、语气与口型…",
  "正在让人物表情和动作与声音同步…",
  "正在优化嘴型、面部细节与身体动作…",
  "正在渲染有声视频，通常约需 5–10 分钟，请耐心等待…",
];

export const VIDEO_CONTINUATION_LOADING_HINTS = [
  "正在分析原视频的主体、动作与镜头趋势…",
  "正在从原视频结尾生成后续画面…",
  "正在保持前后片段的画面与动作连贯性…",
  "正在渲染续写视频，通常需要数分钟，请耐心等待…",
];

export const CAMERA_REPLICATION_LOADING_HINTS = [
  "正在分析参考视频的镜头轨迹、速度与节奏…",
  "正在识别目标图片中的主体与场景结构…",
  "正在复刻推拉、环绕、升降或跟拍运镜…",
  "正在渲染运镜复刻视频，通常需要数分钟，请耐心等待…",
];

export const EFFECT_REPLICATION_LOADING_HINTS = [
  "正在分析参考视频中的火焰、变身、粒子等动态特效…",
  "正在识别目标图片中的人物外观与场景结构…",
  "正在将参考特效迁移到目标人物并保持主体一致性…",
  "正在渲染特效复刻视频，通常需要数分钟，请耐心等待…",
];

function resolveLoadingHints(skuId?: string): string[] {
  if (skuId === "BAILIAN_WAN22_ANIMATE_MOVE") return DANCE_MOVE_LOADING_HINTS;
  if (skuId === "BAILIAN_WAN22_S2V") return S2V_LOADING_HINTS;
  if (skuId === "BAILIAN_WAN27_VIDEO_CONTINUATION") return VIDEO_CONTINUATION_LOADING_HINTS;
  if (skuId === "BAILIAN_WAN27_CAMERA_REPLICATION") return CAMERA_REPLICATION_LOADING_HINTS;
  if (skuId === "BAILIAN_WAN27_EFFECT_REPLICATION") return EFFECT_REPLICATION_LOADING_HINTS;
  return DEFAULT_TASK_LOADING_HINTS;
}

/** 各 SKU 预计完成耗时（毫秒），未列出的 SKU 使用默认 150s。 */
const SKU_EXPECTED_DURATION_MS: Record<string, number> = {
  BAILIAN_WAN22_ANIMATE_MOVE: 377_000,
  BAILIAN_WAN22_S2V: 450_000,
  BAILIAN_WANX_I2V: 180_000,
  BAILIAN_WAN27_VIDEO_CONTINUATION: 240_000,
  BAILIAN_WAN27_CAMERA_REPLICATION: 240_000,
  BAILIAN_WAN27_EFFECT_REPLICATION: 240_000,
  KLING_CINEMA_PRO: 180_000,
  RH_SVD_IMG2VID: 180_000,
  RH_TXT2IMG_SHORTDRAMA: 30_000,
  RH_STORYBOARD: 300_000,
  RH_PROMPT_REVERSE: 30_000,
  RH_FACE_SWAP: 120_000,
  RH_HD_UPSCALE: 60_000,
  RH_MATTING: 30_000,
  RH_BG_REPLACE: 60_000,
  RH_VIDEO_ENHANCE: 180_000,
  /** GPT-image-2 同步生成，预计 15–45s（含网络往返） */
  GPT_IMAGE2_REF: 30_000,
  /** Kling 标准版（302.ai），预计 2–4 分钟 */
  KLING_STD_I2V: 180_000,
  /** Kling 高级版（302.ai），预计 3–5 分钟 */
  KLING_PRO_I2V: 240_000,
};

const DEFAULT_EXPECTED_DURATION_MS = 150_000;

export function resolveExpectedDurationMsForSku(sku: { skuId: string } | null): number {
  if (!sku?.skuId) return DEFAULT_EXPECTED_DURATION_MS;
  return SKU_EXPECTED_DURATION_MS[sku.skuId] ?? DEFAULT_EXPECTED_DURATION_MS;
}

/**
 * 伪进度：预计耗时内按真实时间比例线性增长并封顶 95%；超过预计耗时后缓慢趋近 99%。
 * 只有上游明确成功时，UI 才切换到 100%。
 */
export function computePseudoProgressPercent(elapsedMs: number, expectedDurationMs: number): number {
  if (!(expectedDurationMs > 0) || !Number.isFinite(elapsedMs) || elapsedMs < 0) return 0;
  const elapsedRatio = elapsedMs / expectedDurationMs;
  if (elapsedRatio <= 1) return Math.min(95, 100 * elapsedRatio);

  const overtimeRatio = elapsedRatio - 1;
  return Math.min(99, 95 + 4 * (1 - Math.exp(-overtimeRatio)));
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
    /** 用于选择与当前生成类型匹配的阶段提示。 */
    skuId?: string;
  }
): TaskStatusViewModel {
  if (data?.status === "succeeded") {
    const sellPrice =
      typeof data.sellPrice === "number" && Number.isFinite(data.sellPrice) && data.sellPrice >= 0
        ? data.sellPrice
        : undefined;
    const resultUrl = data.resultUrl?.trim() ? String(data.resultUrl).trim() : undefined;
    // resultMediaType 由适配器明确设置时优先使用，避免 CDN 无后缀 URL 被误判为 video
    const mediaType: "image" | "video" | "text" | undefined =
      data.resultMediaType === "image" || data.resultMediaType === "video" || data.resultMediaType === "text"
        ? data.resultMediaType
        : resultUrl
          ? inferMediaTypeFromResultUrl(resultUrl)
          : undefined;
    const resultUrls =
      Array.isArray(data.resultUrls) && data.resultUrls.length > 1
        ? (data.resultUrls as string[])
        : undefined;
    const resultText = typeof data.resultText === "string" && data.resultText.trim()
      ? data.resultText.trim()
      : undefined;
    return {
      phase: "success",
      videoUrl: resultUrl,
      ...(mediaType !== undefined ? { mediaType } : {}),
      ...(resultUrls !== undefined ? { resultUrls } : {}),
      ...(resultText !== undefined ? { resultText } : {}),
      hints: resolveLoadingHints(ctx.skuId),
      ...(sellPrice !== undefined ? { sellPrice } : {}),
    };
  }

  if (data?.status === "failed") {
    return {
      phase: "failure",
      errorMessage: data.errorMessage ?? "生成失败，原因未知。",
      hints: resolveLoadingHints(ctx.skuId),
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
    progress:
      typeof data?.progress === "number" && Number.isFinite(data.progress)
        ? Math.max(0, Math.min(99, data.progress))
        : null,
    elapsedMs: elapsed,
    expectedDurationMs: expectedMs,
    hints: resolveLoadingHints(ctx.skuId),
    transportMessage,
  };
}
