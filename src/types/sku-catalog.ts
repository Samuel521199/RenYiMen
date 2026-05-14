import type { WorkflowFormSchema } from "@/types/workflow";

/** SKU 所属的创作功能大类 */
export type SkuCategory = "prompt" | "image" | "video";

/** 大厅可售 SKU（含动态表单 Schema） */
export interface SkuDefinition {
  skuId: string;
  providerCode: string;
  displayName: string;
  description?: string;
  /** 所属分类：prompt 提示词 / image 图片 / video 视频 */
  category: SkuCategory;
  /** 售价（积分），用于按钮与展示 */
  sellCredits: number;
  /** 挂载到 DynamicForm 的 UI Schema */
  uiSchema: WorkflowFormSchema;
}

export interface SkuCatalogResponse {
  ok: true;
  skus: SkuDefinition[];
}
