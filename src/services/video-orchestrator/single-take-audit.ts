import { resolveCameraInheritanceContext } from "./camera-graph";

export type SingleTakeAuditAction = "allow" | "split_repair" | "block_stage_2b";

export interface SingleTakeAuditIssue {
  code: string;
  severity: "error" | "warning";
  segmentNo?: number;
  cameraId?: string;
  artifactId?: string;
  reason: string;
  messageZh: string;
  retryFromStage: "stage2a" | "stage2b";
  repairable: boolean;
}

export interface SingleTakeAuditResult {
  passed: boolean;
  action: SingleTakeAuditAction;
  issues: SingleTakeAuditIssue[];
  auditedSegmentNos: number[];
  auditVersion: "single-take-audit-v1";
}

export class SingleTakeAuditError extends Error {
  readonly result: SingleTakeAuditResult;
  constructor(result: SingleTakeAuditResult) {
    super(`Single-take Audit 未通过：${result.issues.filter((item) => item.severity === "error").slice(0, 5).map((item) => `${item.artifactId ?? "plan"}：${item.messageZh} 建议回退：${item.retryFromStage}`).join("；")}`);
    this.name = "SingleTakeAuditError";
    this.result = result;
  }
}

export function assertSingleTakeAuditPassed(plan: unknown, segmentNos?: number[]): SingleTakeAuditResult {
  const result = auditSingleTakePlan(plan, segmentNos);
  if (!result.passed) throw new SingleTakeAuditError(result);
  return result;
}

export function auditSingleTakePlan(planValue: unknown, segmentNos?: number[]): SingleTakeAuditResult {
  const plan = record(planValue);
  const segments = arrayRecords(plan.segments);
  const descriptions = arrayRecords(plan.segmentRenderDescriptions ?? plan.segment_render_descriptions);
  const targets = new Set(segmentNos?.filter((value) => value > 0) ?? segments.map((item) => number(item.segmentNo ?? item.segment_no)).filter(Boolean));
  const issues: SingleTakeAuditIssue[] = [];
  const descriptionsBySegment = new Map(descriptions.map((item) => [number(item.segmentNo ?? item.segment_no), item]));

  for (const segmentNo of targets) {
    const artifactId = `segment:${segmentNo}`;
    const segment = segments.find((item) => number(item.segmentNo ?? item.segment_no) === segmentNo);
    const description = descriptionsBySegment.get(segmentNo);
    if (!description) {
      push(issues, "SEGMENT_RENDER_DESCRIPTION_MISSING", segmentNo, "segment_render_description_missing", `片段 ${segmentNo} 缺少执行合同。`, "stage2b", false);
      continue;
    }
    const startFrame = recordOrUndefined(description.startFrameContract ?? description.start_frame_contract);
    const endFrame = recordOrUndefined(description.endFrameContract ?? description.end_frame_contract);
    const motion = recordOrUndefined(description.motionContract ?? description.motion_contract);
    const singleTake = recordOrUndefined(description.singleTakeContract ?? description.single_take_contract);
    if (!startFrame) push(issues, "START_FRAME_CONTRACT_MISSING", segmentNo, "start_frame_contract_missing", `片段 ${segmentNo} 缺少首帧状态合同。`, "stage2b", true);
    if (!endFrame) push(issues, "END_FRAME_CONTRACT_MISSING", segmentNo, "end_frame_contract_missing", `片段 ${segmentNo} 缺少尾帧状态合同。`, "stage2b", true);
    if (!motion) push(issues, "MOTION_CONTRACT_MISSING", segmentNo, "motion_contract_missing", `片段 ${segmentNo} 缺少运动主合同。`, "stage2b", true);
    if (!singleTake) push(issues, "SINGLE_TAKE_CONTRACT_MISSING", segmentNo, "single_take_contract_missing", `片段 ${segmentNo} 缺少一镜到底合同。`, "stage2b", true);

    if (truthy(description.requiresCut ?? description.requires_cut) || truthy(singleTake?.requiresCut ?? singleTake?.requires_cut)) {
      push(issues, "SINGLE_TAKE_REQUIRES_CUT", segmentNo, "requires_cut_true", `片段 ${segmentNo} requiresCut=true，必须回到 Stage 2B 拆解，不能通过重复生成解决。`, "stage2b", false);
    }
    if (highRisk(description.riskLevel ?? description.risk_level) || highRisk(singleTake?.riskLevel ?? singleTake?.risk_level)) {
      push(issues, "SINGLE_TAKE_HIGH_RISK", segmentNo, "risk_level_high", `片段 ${segmentNo} 风险为 high，必须先执行 Split Repair。`, "stage2b", true);
    }
    if (singleTake && (singleTake.physicallyReachable === false || singleTake.physically_reachable === false)) {
      push(issues, "SINGLE_TAKE_PHYSICALLY_UNREACHABLE", segmentNo, "physically_unreachable", `片段 ${segmentNo} 的动作路径不可物理到达，必须先执行 Split Repair。`, "stage2b", true);
    }
    const checkpoints = array(description.motionCheckpoints ?? description.motion_checkpoints);
    if (checkpoints.some(containsCutLanguage)) {
      push(issues, "MOTION_CHECKPOINT_CONTAINS_CUT", segmentNo, "motion_checkpoint_contains_cut", `片段 ${segmentNo} 的中间状态包含切镜或转场。`, "stage2b", true);
    }
    if (containsCutLanguage([
      description,
      segment?.videoPrompt ?? segment?.video_prompt,
      segment?.motion,
      segment?.camera,
      segment?.microShots ?? segment?.micro_shots,
      segment?.timedPrompts ?? segment?.timed_prompts,
    ])) {
      push(issues, "INTERNAL_CUT_LANGUAGE", segmentNo, "internal_cut_language_detected", `片段 ${segmentNo} 的结构合同或生成字段包含内部切镜/叠化/蒙太奇语义，禁止靠 Prompt 文本替换隐藏。`, "stage2b", true);
    }

    const cameraContext = resolveCameraInheritanceContext(plan, segmentNo);
    if (cameraContext.relation === "alternate_view" && (!cameraContext.node?.axisDescription || !cameraContext.node?.spatialLayoutLock)) {
      issues.push({
        code: "ALTERNATE_VIEW_AXIS_UNRESOLVED",
        severity: "error",
        segmentNo,
        cameraId: cameraContext.cameraId,
        artifactId: `camera:${cameraContext.cameraId ?? "unknown"}`,
        reason: "alternate_view_axis_or_left_right_lock_missing",
        messageZh: `片段 ${segmentNo} 的 alternate_view 缺少 180 度轴线或左右关系锁。`,
        retryFromStage: "stage2a",
        repairable: false,
      });
    }
    void artifactId;
  }

  const deduped = dedupe(issues);
  const errors = deduped.filter((item) => item.severity === "error");
  const hasNonRepairable = errors.some((item) => !item.repairable);
  return {
    passed: errors.length === 0,
    action: errors.length === 0 ? "allow" : hasNonRepairable ? "block_stage_2b" : "split_repair",
    issues: deduped,
    auditedSegmentNos: [...targets].sort((a, b) => a - b),
    auditVersion: "single-take-audit-v1",
  };
}

function push(issues: SingleTakeAuditIssue[], code: string, segmentNo: number, reason: string, messageZh: string, retryFromStage: "stage2a" | "stage2b", repairable: boolean): void {
  issues.push({ code, severity: "error", segmentNo, artifactId: `segment:${segmentNo}`, reason, messageZh, retryFromStage, repairable });
}
function containsCutLanguage(value: unknown): boolean {
  const text = flatText(value)
    .replace(/\b(?:no|without|forbid(?:den)?|avoid|must not|do not|don't|never)[^.。;；\n]*(?:cut|dissolve|crossfade|montage|fade|transition|switch)[^.。;；\n]*/gi, "")
    .replace(/(?:禁止|不得|不要|避免|不可|不能)[^。；\n]*(?:切镜|跳切|转场|叠化|蒙太奇|换镜头|淡入|淡出)[^。；\n]*/g, "");
  return /\b(cut to|jump cut|hard cut|dissolve|crossfade|montage|switch to|switch angle|switch camera|scene transition|new shot|another shot|shot change|fade out|fade in)\b|切到|切镜|跳切|转场|叠化|交叉溶解|蒙太奇|换镜头|切换机位|镜头切换|场景切换|淡入|淡出/i.test(text);
}
function flatText(value: unknown): string { if (typeof value === "string") return value; if (Array.isArray(value)) return value.map(flatText).join(" "); if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).map(flatText).join(" "); return ""; }
function dedupe(issues: SingleTakeAuditIssue[]): SingleTakeAuditIssue[] { const seen = new Set<string>(); return issues.filter((item) => { const key = `${item.code}:${item.artifactId}`; if (seen.has(key)) return false; seen.add(key); return true; }); }
function record(value: unknown): Record<string, unknown> { return value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function recordOrUndefined(value: unknown): Record<string, unknown> | undefined { const result = record(value); return Object.keys(result).length ? result : undefined; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function arrayRecords(value: unknown): Record<string, unknown>[] { return array(value).filter((item) => item != null && typeof item === "object" && !Array.isArray(item)) as Record<string, unknown>[]; }
function number(value: unknown): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function truthy(value: unknown): boolean { return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true"; }
function highRisk(value: unknown): boolean { return String(value ?? "").toLowerCase() === "high"; }
