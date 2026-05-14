/** 网关对前端统一暴露的任务轮询状态 */
export type GatewayTaskClientStatus = "loading" | "success" | "failure";

export interface GatewayTaskPollBody {
  status: GatewayTaskClientStatus;
  /** loading 时 0–100，便于 UI 展示 */
  progress?: number;
  videoUrl?: string;
  error?: string;
  /** 成功时可选：本次任务从用户余额实扣的积分（与 `GenerationHistory.cost` 一致） */
  sellPrice?: number;
  /** 上游实际 RH 币消耗（若适配器解析到） */
  providerCost?: number;
  /**
   * 多图输出（如分镜）：所有图片 URL。
   * `videoUrl` 仍为第一张（向后兼容）。
   */
  resultUrls?: string[];
  /** 适配器明确标注的媒体类型，优先于客户端从 URL 后缀推断。 */
  resultMediaType?: "image" | "video";
}
