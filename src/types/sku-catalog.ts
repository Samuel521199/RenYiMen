import type { WorkflowFormSchema } from "@/types/workflow";

/** 大厅可售 SKU（含动态表单 Schema） */
export interface SkuDefinition {
  skuId: string;
  providerCode: string;
  displayName: string;
  description?: string;
  /** 售价（积分），用于按钮与展示 */
  sellCredits: number;
  /** 挂载到 DynamicForm 的 UI Schema */
  uiSchema: WorkflowFormSchema;
}

export interface SkuCatalogResponse {
  ok: true;
  skus: SkuDefinition[];
}
