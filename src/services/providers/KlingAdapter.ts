import type { TaskStatusPollData } from "@/types/task-status";
import type { IProviderAdapter, ProviderCostResult, ProviderResponse, StandardPayload } from "./types";
import { ProviderError } from "./types";

/** 可灵占位适配器，演示多厂商扩展点 */
export class KlingAdapter implements IProviderAdapter {
  calculateCost(_payload: StandardPayload): ProviderCostResult {
    void _payload;
    const cost = 8;
    return { cost, sellPrice: cost };
  }

  async generate(_payload: StandardPayload, _credentials: unknown): Promise<ProviderResponse> {
    void _payload;
    void _credentials;
    throw new ProviderError("Not Implemented", "NOT_IMPLEMENTED", 501);
  }

  async queryTask(_taskId: string, _credentials: unknown): Promise<TaskStatusPollData> {
    void _taskId;
    void _credentials;
    throw new ProviderError("Not Implemented", "NOT_IMPLEMENTED", 501);
  }
}
