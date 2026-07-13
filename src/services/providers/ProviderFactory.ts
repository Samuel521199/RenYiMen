import type { IProviderAdapter } from "./types";
import { ProviderError } from "./types";
import { BailianAdapter } from "./BailianAdapter";
import { GptImage2Adapter } from "./GptImage2Adapter";
import { KlingAdapter } from "./KlingAdapter";
import { RunningHubAdapter } from "./RunningHubAdapter";

/** 未显式指定 sku / provider 时的默认线路 */
export const DEFAULT_PROVIDER_CODE = "RUNNINGHUB_SVD";

/** 可选：将业务 SKU 映射到适配器代码 */
const SKU_TO_PROVIDER: Record<string, string> = {
  RH_SVD_IMG2VID: "RUNNINGHUB_SVD",
  RH_TXT2IMG_SHORTDRAMA: "RUNNINGHUB_TXT2IMG",
  /** 走 RunningHub `RUNNINGHUB_IMG2VIDEO_REMOTE_WORKFLOW_ID`（与占位 skuId 名并存） */
  KLING_CINEMA_PRO: "RUNNINGHUB_IMG2VIDEO",
  /** Kling 标准版（302.ai → kwaivgi/kling-v2.6-std/image-to-video） */
  KLING_STD_I2V: "KLING_STD",
  /** Kling 高级版（302.ai → kwaivgi/kling-video-o3-pro/image-to-video） */
  KLING_PRO_I2V: "KLING_PRO",
  /** 阿里云百炼 DashScope 图生视频（异步），网关 `providerCode` 为 ALIYUN_BAILIAN */
  BAILIAN_WANX_I2V: "ALIYUN_BAILIAN",
  /** 分镜生成出图（多图输出） */
  RH_STORYBOARD: "RUNNINGHUB_STORYBOARD",
  /** 提示词反推（图生文，Qwen3 VQA） */
  RH_PROMPT_REVERSE: "RUNNINGHUB_PROMPT_REVERSE",
  /** 换头换脸（Best-Face-Swap，双图输入） */
  RH_FACE_SWAP: "RUNNINGHUB_FACE_SWAP",
  /** 高清放大（RunningHub AI App，单图输入） */
  RH_HD_UPSCALE: "RUNNINGHUB_HD_UPSCALE",
  /** 人像抠图（RunningHub AI App，单图输入） */
  RH_MATTING: "RUNNINGHUB_MATTING",
  /** 背景替换（RunningHub AI App，双图输入：用户图 + 背景图） */
  RH_BG_REPLACE: "RUNNINGHUB_BG_REPLACE",
  /** 视频模糊一键修复（RunningHub AI App，单视频输入） */
  RH_VIDEO_ENHANCE: "RUNNINGHUB_VIDEO_ENHANCE",
  /** GPT-image-2 参考图+提示词生成图片（同步，直接返回结果，无需异步轮询） */
  GPT_IMAGE2_REF: "GPT_IMAGE2",
};

/**
 * 从网关 JSON 体解析 `providerCode` / `skuId`。
 * - `providerCode` 优先；
 * - `skuId` 先查映射表，否则原样大写回传（由工厂判断是否支持）。
 */
export function resolveProviderCodeFromBody(body: Record<string, unknown> | null): string {
  if (!body) return DEFAULT_PROVIDER_CODE;
  if (typeof body.providerCode === "string" && body.providerCode.trim()) {
    return body.providerCode.trim().toUpperCase();
  }
  if (typeof body.skuId === "string" && body.skuId.trim()) {
    const k = body.skuId.trim().toUpperCase();
    if (SKU_TO_PROVIDER[k]) return SKU_TO_PROVIDER[k];
    throw new ProviderError(`未知 skuId: ${k}（缺少 providerCode 或 SKU 未注册）`, "UNKNOWN_SKU", 400);
  }
  return DEFAULT_PROVIDER_CODE;
}

export function getProviderAdapter(providerCode: string): IProviderAdapter {
  const code = providerCode.trim().toUpperCase();
  switch (code) {
    case "RUNNINGHUB_SVD":
    case "RUNNINGHUB_TXT2IMG":
    case "RUNNINGHUB_IMG2VIDEO":
    case "RUNNINGHUB_STORYBOARD":
    case "RUNNINGHUB_PROMPT_REVERSE":
    case "RUNNINGHUB_FACE_SWAP":
    case "RUNNINGHUB_HD_UPSCALE":
    case "RUNNINGHUB_MATTING":
    case "RUNNINGHUB_BG_REPLACE":
    case "RUNNINGHUB_VIDEO_ENHANCE":
    case "RUNNINGHUB":
      return new RunningHubAdapter();
    case "KLING_STD":
      return new KlingAdapter("kwaivgi/kling-v2.6-std/image-to-video", 400, "KLING_STD_API_KEY");
    case "KLING_PRO":
      return new KlingAdapter("kwaivgi/kling-video-o3-pro/image-to-video", 600, "KLING_PRO_API_KEY");
    case "ALIYUN_BAILIAN":
    case "BAILIAN_I2V":
    case "BAILIAN":
    case "DASHSCOPE_I2V":
    case "DASHSCOPE_VIDEO":
      return new BailianAdapter();
    case "GPT_IMAGE2":
      return new GptImage2Adapter();
    default:
      throw new ProviderError(`不支持的 providerCode: ${providerCode}`, "UNKNOWN_PROVIDER", 400);
  }
}
