import type { IProviderAdapter } from "./types";
import { ProviderError } from "./types";
import { BailianAdapter } from "./BailianAdapter";
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
  /** 阿里云百炼 DashScope 图生视频（异步），网关 `providerCode` 为 ALIYUN_BAILIAN */
  BAILIAN_WANX_I2V: "ALIYUN_BAILIAN",
  /** 分镜生成出图（多图输出） */
  RH_STORYBOARD: "RUNNINGHUB_STORYBOARD",
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
    case "RUNNINGHUB":
      return new RunningHubAdapter();
    case "KLING_PRO":
      return new KlingAdapter();
    case "ALIYUN_BAILIAN":
    case "BAILIAN_I2V":
    case "BAILIAN":
    case "DASHSCOPE_I2V":
    case "DASHSCOPE_VIDEO":
      return new BailianAdapter();
    default:
      throw new ProviderError(`不支持的 providerCode: ${providerCode}`, "UNKNOWN_PROVIDER", 400);
  }
}
