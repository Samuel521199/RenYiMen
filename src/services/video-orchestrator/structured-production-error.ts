export type ProductionErrorCategory =
  | "contract"
  | "capacity"
  | "provider"
  | "scheduling"
  | "state"
  | "authorization"
  | "unknown";

export interface StructuredProductionError {
  errorCode: string;
  category: ProductionErrorCategory;
  retryable: boolean;
  targetId: string | null;
  artifactId: string | null;
  recoveryAction: string;
  displayMessage: {
    zh: string;
    en: string;
  };
}

export class StructuredCommandError extends Error {
  readonly code: string;
  readonly category: ProductionErrorCategory;
  readonly retryable: boolean;
  readonly recoveryAction: string;
  readonly targetId?: string;
  readonly artifactId?: string;

  constructor(input: {
    errorCode: string;
    message: string;
    category: ProductionErrorCategory;
    retryable?: boolean;
    recoveryAction: string;
    targetId?: string;
    artifactId?: string;
  }) {
    super(input.message);
    this.name = "StructuredCommandError";
    this.code = input.errorCode;
    this.category = input.category;
    this.retryable = input.retryable ?? false;
    this.recoveryAction = input.recoveryAction;
    this.targetId = input.targetId;
    this.artifactId = input.artifactId;
  }
}

export function structuredProductionError(input: {
  errorCode: string;
  category?: string | null;
  retryable?: boolean;
  targetId?: string | null;
  artifactId?: string | null;
  recoveryAction?: string | null;
  message?: string | null;
}): StructuredProductionError {
  const category = normalizeCategory(input.category, input.errorCode);
  const retryable = input.retryable ?? defaultRetryable(input.errorCode, category);
  const recoveryAction = input.recoveryAction
    || defaultRecoveryAction(input.errorCode, category, retryable);
  return {
    errorCode: input.errorCode || "UNKNOWN_PRODUCTION_ERROR",
    category,
    retryable,
    targetId: input.targetId ?? null,
    artifactId: input.artifactId ?? null,
    recoveryAction,
    displayMessage: displayMessageFor(
      input.errorCode,
      category,
      recoveryAction,
      input.message,
    ),
  };
}

export function structuredProductionErrorFromUnknown(
  error: unknown,
  fallback: Partial<Omit<StructuredProductionError, "displayMessage">> = {},
): StructuredProductionError {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const errorCode = stringValue(record.code)
    || stringValue(record.errorCode)
    || fallback.errorCode
    || (error instanceof Error && error.name !== "Error" ? error.name : "")
    || "COMMAND_FAILED";
  return structuredProductionError({
    errorCode,
    category: stringValue(record.category) || fallback.category,
    retryable: typeof record.retryable === "boolean" ? record.retryable : fallback.retryable,
    targetId: stringValue(record.targetId) || fallback.targetId,
    artifactId: stringValue(record.artifactId) || fallback.artifactId,
    recoveryAction: stringValue(record.recoveryAction) || fallback.recoveryAction,
    message: error instanceof Error ? error.message : String(error ?? ""),
  });
}

function normalizeCategory(category: string | null | undefined, errorCode: string): ProductionErrorCategory {
  if (category === "contract" || category === "contract_validation") return "contract";
  if (category === "capacity" || category === "internal_capacity") return "capacity";
  if (category === "scheduling" || category === "internal_scheduling") return "scheduling";
  if (category === "authorization" || category === "provider_auth") return "authorization";
  if (category === "provider" || category === "provider_network" || category === "provider_rate_limit") return "provider";
  if (category === "state") return "state";
  if (/CONTRACT|PLAN_FIELD_ALIAS_CONFLICT/.test(errorCode)) return "contract";
  if (/CAPACITY|LEASE_UNAVAILABLE/.test(errorCode)) return "capacity";
  if (/STATE|CONFLICT|INVALID_RECOVERY_REQUEST/.test(errorCode)) return "state";
  if (/AUTH|UNAUTHORIZED|FORBIDDEN/.test(errorCode)) return "authorization";
  return "unknown";
}

function defaultRetryable(errorCode: string, category: ProductionErrorCategory): boolean {
  if (category === "provider" || category === "capacity") return true;
  return /TIMEOUT|RATE_LIMIT|NETWORK|TEMPORARY/.test(errorCode);
}

function defaultRecoveryAction(
  errorCode: string,
  category: ProductionErrorCategory,
  retryable: boolean,
): string {
  if (category === "contract") return "REPAIR_CONTRACT";
  if (errorCode === "NO_COMPATIBLE_WORKER") return "DEPLOY_COMPATIBLE_WORKER";
  if (errorCode === "STATE_INVARIANT_VIOLATION") return "REBUILD_TASK_GRAPH";
  return retryable ? "RETRY_JOB" : "CONTACT_OPERATOR";
}

function displayMessageFor(
  errorCode: string,
  category: ProductionErrorCategory,
  recoveryAction: string,
  message?: string | null,
): StructuredProductionError["displayMessage"] {
  if (errorCode === "STRUCTURED_OUTPUT_SYNTAX_ERROR") {
    const stage = structuredOutputStage(message);
    const label = structuredOutputStageLabel(stage);
    const canResumeStage = recoveryAction === "RETRY_STAGE"
      || recoveryAction === "RETRY_JOB";
    return {
      zh: `${label.zh}返回的 JSON 包含重复字段、未闭合结构或其他语法问题。${
        canResumeStage
          ? "系统已保留检查点，可从该阶段自动恢复，无需重新创建项目。"
          : "系统已保留此前完成内容，无需重新创建项目。"
      }`,
      en: `${label.en} returned JSON with duplicate fields, an unclosed structure, or another syntax error. ${
        canResumeStage
          ? "The checkpoint was preserved so recovery can resume from this stage; you do not need to recreate the project."
          : "Previously completed work was preserved; you do not need to recreate the project."
      }`,
    };
  }
  if (category === "contract") {
    return {
      zh: "执行合同未通过校验。系统已保留完成内容，请修复合同后继续。",
      en: "The execution contract failed validation. Completed work was preserved; repair the contract before continuing.",
    };
  }
  if (category === "capacity") {
    return {
      zh: "模型容量暂不可用。任务未丢失，可稍后重试同一个任务。",
      en: "Provider capacity is temporarily unavailable. The job was preserved and can be retried later.",
    };
  }
  if (category === "authorization") {
    return {
      zh: "上游模型鉴权失败，请检查服务凭据后再继续。",
      en: "Provider authentication failed. Check the service credentials before continuing.",
    };
  }
  if (category === "state") {
    return {
      zh: "项目状态已经变化或不满足当前命令，请刷新后按任务图允许的动作继续。",
      en: "The project state changed or does not allow this command. Refresh and use an action allowed by the task graph.",
    };
  }
  if (category === "provider") {
    return {
      zh: "上游生成服务暂时失败，系统已保留任务状态。",
      en: "The upstream generation service failed temporarily. The durable job state was preserved.",
    };
  }
  return {
    zh: message && /[\u3400-\u9fff]/u.test(message) ? message : `任务执行失败（${errorCode}）。`,
    en: message && !/[\u3400-\u9fff]/u.test(message) ? message : `The command failed (${errorCode}).`,
  };
}

function structuredOutputStage(message?: string | null): string {
  if (!message) return "";
  const match = message.match(
    /\b(reference_fact_extractor|planning_architect|planning_duration_repair|planning_contract_repair|asset_prompt_contract_repair|asset_visual_spec|storyboard_artist|story_contract_repair|story_semantic_critic|story_semantic_repair|shot_decomposer|single_take_audit|prompt_detailer|final_validation)\b/i,
  );
  return match?.[1]?.toLowerCase() ?? "";
}

function structuredOutputStageLabel(stage: string): { zh: string; en: string } {
  const labels: Record<string, { zh: string; en: string }> = {
    reference_fact_extractor: { zh: "参考图事实提取阶段", en: "The reference fact extraction stage" },
    planning_architect: { zh: "故事架构规划阶段", en: "The story architecture planning stage" },
    planning_duration_repair: { zh: "规划时长修复阶段", en: "The planning duration repair stage" },
    planning_contract_repair: { zh: "剧情合同修复阶段", en: "The story contract repair stage" },
    asset_prompt_contract_repair: { zh: "资产描述合同修复阶段", en: "The asset prompt contract repair stage" },
    asset_visual_spec: { zh: "资产视觉规格阶段", en: "The asset visual specification stage" },
    storyboard_artist: { zh: "故事板规划阶段", en: "The storyboard planning stage" },
    story_contract_repair: { zh: "故事板剧情合同修复阶段", en: "The storyboard contract repair stage" },
    story_semantic_critic: { zh: "剧情语义评审阶段", en: "The story semantic review stage" },
    story_semantic_repair: { zh: "剧情语义修复阶段", en: "The story semantic repair stage" },
    shot_decomposer: { zh: "分镜拆解阶段", en: "The shot decomposition stage" },
    single_take_audit: { zh: "单镜头连续性校验阶段", en: "The single-take audit stage" },
    prompt_detailer: { zh: "视频提示词编译阶段", en: "The video prompt compilation stage" },
    final_validation: { zh: "最终计划校验阶段", en: "The final plan validation stage" },
  };
  return labels[stage] ?? {
    zh: "结构化输出阶段",
    en: "The structured output stage",
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
