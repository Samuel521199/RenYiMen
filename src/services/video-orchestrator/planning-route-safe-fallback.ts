export const PLANNING_ROUTE_SAFE_FALLBACK = {
  videoCategory: "custom",
  templateId: "generic_brand_story",
  chronologyMode: "chronological",
  hookMode: "curiosity",
  hookRevealLevel: "none",
  requiresReturnPoint: false,
  fallbackUsed: true,
} as const;

export const PLANNING_ROUTE_FALLBACK_REASON_TEMPLATES = {
  INSUFFICIENT_EVIDENCE: "输入证据不足，无法可靠确定视频品类或叙事模板。",
  CONFLICTING_INPUTS: "用户文本与参考信息存在冲突，无法可靠确定唯一品类。",
  INVALID_MODEL_RESULT: "路由模型结果未通过合同校验，且没有可用的定向修复结果。",
  UNSUPPORTED_CONTENT: "用户要求包含当前系统不支持的内容。",
} as const;

export interface PlanningRouteFallbackMetadata {
  version: "planning-route-v1";
  modelName: string;
  inputFingerprint: string;
  referenceFactFingerprint: string;
}

export interface PlanningRouteFallbackContext {
  reasons?: string[];
  inputConflicts?: string[];
  unsupportedContentReason?: string | null;
}

export interface PlanningRouteSafeFallbackInfo {
  reason: string;
  inputConflicts: string[];
  recommendPlanReview: boolean;
  shouldBlockPlanning: boolean;
  blockingReason: string | null;
  userVisibleWarning: string;
}

export interface PlanningRouteSafeFallbackResult {
  value: Record<string, unknown>;
  info: PlanningRouteSafeFallbackInfo;
}

function uniqueNonEmpty(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((item) => item.trim()).filter(Boolean))];
}

export function buildPlanningRouteSafeFallback(params: {
  metadata: PlanningRouteFallbackMetadata;
  context?: PlanningRouteFallbackContext;
}): PlanningRouteSafeFallbackResult {
  const reasons = uniqueNonEmpty(params.context?.reasons);
  const inputConflicts = uniqueNonEmpty(params.context?.inputConflicts);
  const unsupportedContentReason = params.context?.unsupportedContentReason?.trim() || null;
  const shouldBlockPlanning = unsupportedContentReason !== null;

  const primaryReason = unsupportedContentReason
    ? `${PLANNING_ROUTE_FALLBACK_REASON_TEMPLATES.UNSUPPORTED_CONTENT} ${unsupportedContentReason}`
    : inputConflicts.length
      ? PLANNING_ROUTE_FALLBACK_REASON_TEMPLATES.CONFLICTING_INPUTS
      : reasons[0] ?? PLANNING_ROUTE_FALLBACK_REASON_TEMPLATES.INSUFFICIENT_EVIDENCE;
  const conflictSummary = inputConflicts.length
    ? inputConflicts.slice(0, 4).join("；")
    : "未发现可明确列出的输入冲突";
  const fallbackReason = [
    primaryReason,
    `冲突信息：${conflictSummary}。`,
    shouldBlockPlanning
      ? "该请求超出当前系统能力，不能继续自动规划。"
      : "已采用通用品牌故事顺叙路线继续规划，建议在计划审核阶段确认或修改品类与叙事路线。",
  ].join(" ");

  const userVisibleWarning = shouldBlockPlanning
    ? `当前请求包含系统暂不支持的内容，Planning 已停止：${unsupportedContentReason}`
    : `暂时无法可靠判断视频品类，已使用“通用品牌故事 + 顺叙”继续生成计划。原因：${primaryReason}${inputConflicts.length
      ? `发现冲突：${inputConflicts.slice(0, 3).join("；")}。`
      : " "}建议在计划审核阶段确认或修改品类、模板和时间顺序。`;

  return {
    value: {
      ...PLANNING_ROUTE_SAFE_FALLBACK,
      categoryReason: primaryReason,
      templateReason: "使用通用品牌故事模板，避免错误套用垂直行业模板。",
      chronologyReason: "使用风险最低的顺叙模式，且不提前透露最终结果。",
      evidence: [{
        sourceType: "program_policy",
        sourceField: "safeFallback",
        summary: `安全回退；${conflictSummary}。`,
        referenceFactField: null,
      }],
      categoryConfidence: 0,
      templateConfidence: 0,
      chronologyConfidence: 0,
      ambiguityCodes: inputConflicts.length
        ? ["CATEGORY_CONFLICT", "INSUFFICIENT_EVIDENCE"]
        : ["INSUFFICIENT_EVIDENCE"],
      fallbackReason,
      ...params.metadata,
    },
    info: {
      reason: primaryReason,
      inputConflicts,
      recommendPlanReview: !shouldBlockPlanning,
      shouldBlockPlanning,
      blockingReason: unsupportedContentReason,
      userVisibleWarning,
    },
  };
}
