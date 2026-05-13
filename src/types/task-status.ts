/**
 * 生成历史摘要：与 `/api/user/history` 及底片带展示字段对齐。
 */
export interface TaskHistoryItem {
  taskId: string;
  resultUrl: string;
  mediaType: "image" | "video";
  skuId?: string;
  timestamp: number;
}

/**
 * 后端任务轮询返回的规范化结构（可与实际 API DTO 再适配）。
 */
export type RemoteTaskStatus = "queued" | "running" | "succeeded" | "failed";

export interface TaskStatusPollData {
  status: RemoteTaskStatus;
  /** 0–100，可选；缺省时 UI 使用不确定进度样式 */
  progress?: number | null;
  resultUrl?: string | null;
  errorMessage?: string | null;
  /** 成功轮询时：本次从用户余额实扣的积分（与 `GET /api/gateway/task` 的 `sellPrice` 一致） */
  sellPrice?: number;
  /** 上游用量或计费标量：如 RunningHub RH 币、DashScope `usage` 内 token/price 等，供网关实扣参考 */
  providerCost?: number | null;
  /** 上游报文中解析到的素材体积（字节），用于 OSS 类积分换算；可与提单时落库的底图大小合并使用 */
  providerAssetSizeBytes?: number | null;
  /**
   * 上游任务耗时（秒），如 RunningHub `usage.taskCostTime` 解析后的整型；未解析到则不传。
   */
  providerDurationSec?: number | null;
}

/**
 * `TaskStatusViewer` 使用的展示层模型（与轮询数据解耦，便于动画与文案）。
 */
export type TaskViewerPhase = "loading" | "success" | "failure";

export interface TaskStatusViewModel {
  phase: TaskViewerPhase;
  /** loading 时区分排队与执行中（文案与动效可微调） */
  subPhase?: "queued" | "running";
  progress?: number | null;
  /** loading：自本次任务开始轮询起累计毫秒（前端时钟） */
  elapsedMs?: number;
  /** loading：用于伪进度条与「预计」时间文案的预计总耗时（毫秒） */
  expectedDurationMs?: number;
  /** 轮播占位提示 */
  hints?: string[];
  videoUrl?: string;
  /** 成功态下根据 `resultUrl` 推断的展示类型（图片 / 视频） */
  mediaType?: "image" | "video";
  errorMessage?: string;
  /** 传输层连续失败等 */
  transportMessage?: string;
  /** 任务完成后展示的扣费积分：须为网关轮询返回的实扣值（`sellPrice`） */
  sellPrice?: number;
}
