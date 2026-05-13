import type { TaskStatusPollData } from "@/types/task-status";

/**
 * 中转站内部标准提交结构（不包含任何具体厂商字段名）。
 * 适配器负责将其翻译为各上游协议。
 */
export interface StandardPayload {
  /** 逻辑模板 / 执行图引用 ID */
  templateId: string;
  templateVersion?: string;
  /** 按逻辑节点分组的输入表 */
  nodeInputs: Record<string, Record<string, unknown>>;
  /**
   * 可选：顶层扁平入参（如 `duration`），与 `nodeInputs.input` 并存时由适配器决定优先级。
   */
  inputs?: Record<string, unknown>;
  /** 可选：完整图定义（二进制/文本 blob，由适配器解释） */
  definitionBlob?: string;
  /** 布尔开关、回调地址等中性扩展，由适配器选择性消费 */
  flags?: Record<string, unknown>;
}

export interface ProviderResponse {
  taskId: string;
  raw?: unknown;
}

/** 同步计价结果：成本积分与对外售价（积分） */
export interface ProviderCostResult {
  cost: number;
  sellPrice: number;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus?: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/**
 * RunningHub `POST /openapi/v2/run/workflow/:id` 请求体中与 `workflow`、`nodeInfoList` 同级的
 * 去水印相关试探字段（平台未文档化时多余键会被忽略；若命中隐藏开关则可关闭产物水印）。
 */
export interface RunningHubRunWorkflowWatermarkKnobs {
  watermark?: boolean;
  needWatermark?: boolean;
  isWatermark?: number | boolean;
}

/**
 * 多模型上游适配器：提单与任务查询。
 */
export interface IProviderAdapter {
  /** 根据标准负载估算成本与售价（同步，无 I/O） */
  calculateCost(payload: StandardPayload): ProviderCostResult;

  generate(payload: StandardPayload, credentials: unknown): Promise<ProviderResponse>;

  queryTask(taskId: string, credentials: unknown): Promise<TaskStatusPollData>;
}
