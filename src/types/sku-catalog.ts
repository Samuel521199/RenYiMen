import type { WorkflowFormSchema } from "@/types/workflow";

/** SKU 鎵€灞炵殑鍒涗綔鍔熻兘澶х被 */
export type SkuCategory = "prompt" | "image" | "video";

/** 澶у巺鍙敭 SKU锛堝惈鍔ㄦ€佽〃鍗?Schema锛?*/
export interface SkuDefinition {
  skuId: string;
  providerCode: string;
  displayName: string;
  description?: string;
  /** English display name */
  displayNameEn?: string;
  /** English description */
  descriptionEn?: string;
  /** 鎵€灞炲垎绫伙細prompt 鎻愮ず璇?/ image 鍥剧墖 / video 瑙嗛 */
  category: SkuCategory;
  /**
   * 灏侀潰鍥捐矾寰勶紙鐩稿浜?/public锛屽 /covers/sample-a.png锛夈€?
   * 鍦ㄧ敾寤婅鍥句腑灞曠ず涓哄崱鐗囧皝闈紝鐣欑┖鏃舵樉绀虹被鐩笎鍙樺崰浣嶇銆?
   * 鏇挎崲灏侀潰鏃跺彧闇€瑕嗙洊 public/covers/ 涓搴旀枃浠跺嵆鍙紝鏃犻渶淇敼浠ｇ爜銆?
   */
  cover?: string;
  /** 鍞环锛堢Н鍒嗭級锛岀敤浜庢寜閽笌灞曠ず */
  sellCredits: number;
  /** Optional direct app entry. When present, the gallery card navigates to this route instead of opening DynamicForm. */
  href?: string;
  /** 鎸傝浇鍒?DynamicForm 鐨?UI Schema */
  uiSchema: WorkflowFormSchema;
}

export interface SkuCatalogResponse {
  ok: true;
  skus: SkuDefinition[];
}
