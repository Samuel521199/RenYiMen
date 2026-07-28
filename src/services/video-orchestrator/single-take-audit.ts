import { resolveCameraInheritanceContext } from "./camera-graph";

export const SINGLE_TAKE_AUDIT_POLICY_VERSION = "single-take-audit-v2" as const;

export type SingleTakeAuditAction =
  | "allow"
  | "allow_with_warning"
  | "repair_contract"
  | "repair_camera_graph"
  | "repair_segment"
  | "replan_timeline";

export type SingleTakeEvidenceType =
  | "deterministic_contract"
  | "executable_instruction"
  | "camera_graph"
  | "timing_budget"
  | "model_assessment";

export type SingleTakeRepairScope = "none" | "contract" | "camera_graph" | "segment" | "timeline";

export interface SingleTakeAuditIssue {
  code: string;
  severity: "error" | "warning";
  segmentNo?: number;
  cameraId?: string;
  artifactId?: string;
  reason: string;
  reasonCode: string;
  messageZh: string;
  retryFromStage: "stage2a" | "stage2b";
  repairable: boolean;
  sourcePath: string;
  matchedText?: string;
  evidenceType: SingleTakeEvidenceType;
  confidence: number;
  structural: boolean;
  repairScope: SingleTakeRepairScope;
}

export interface SingleTakeAuditResult {
  passed: boolean;
  action: SingleTakeAuditAction;
  issues: SingleTakeAuditIssue[];
  auditedSegmentNos: number[];
  auditVersion: typeof SINGLE_TAKE_AUDIT_POLICY_VERSION;
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
  const targets = new Set(
    segmentNos?.filter((value) => value > 0)
    ?? segments.map((item) => number(item.segmentNo ?? item.segment_no)).filter(Boolean),
  );
  const issues: SingleTakeAuditIssue[] = [];
  const descriptionsBySegment = new Map(
    descriptions.map((item) => [number(item.segmentNo ?? item.segment_no), item]),
  );

  for (const segmentNo of targets) {
    const segment = segments.find((item) => number(item.segmentNo ?? item.segment_no) === segmentNo);
    const description = descriptionsBySegment.get(segmentNo);
    if (!description) {
      push(issues, {
        code: "SEGMENT_RENDER_DESCRIPTION_MISSING",
        segmentNo,
        reason: "segment_render_description_missing",
        messageZh: `片段 ${segmentNo} 缺少执行合同。`,
        sourcePath: `segmentRenderDescriptions[segmentNo=${segmentNo}]`,
        evidenceType: "deterministic_contract",
        confidence: 1,
        repairScope: "contract",
      });
      continue;
    }

    const startFrame = recordOrUndefined(description.startFrameContract ?? description.start_frame_contract);
    const endFrame = recordOrUndefined(description.endFrameContract ?? description.end_frame_contract);
    const motion = recordOrUndefined(description.motionContract ?? description.motion_contract);
    const singleTake = recordOrUndefined(description.singleTakeContract ?? description.single_take_contract);
    const videoPromptContract = record(
      description.videoPromptContract ?? description.video_prompt_contract,
    );
    if (!startFrame) pushMissingContract(issues, segmentNo, "START_FRAME_CONTRACT_MISSING", "start_frame_contract_missing", "startFrameContract");
    if (!endFrame) pushMissingContract(issues, segmentNo, "END_FRAME_CONTRACT_MISSING", "end_frame_contract_missing", "endFrameContract");
    if (!motion) pushMissingContract(issues, segmentNo, "MOTION_CONTRACT_MISSING", "motion_contract_missing", "motionContract");
    if (!singleTake) pushMissingContract(issues, segmentNo, "SINGLE_TAKE_CONTRACT_MISSING", "single_take_contract_missing", "singleTakeContract");
    const usesEvidenceRefs = arrayRecords(
      videoPromptContract.terminalRequirements ?? videoPromptContract.terminal_requirements,
    ).some((requirement) => Array.isArray(requirement.evidenceRefs ?? requirement.evidence_refs));
    if (motion && (usesEvidenceRefs || motion.version === "continuous-motion-contract-v1")) {
      const subjectActions = arrayRecords(motion.subjectActions ?? motion.subject_actions);
      const cameraMotion = recordOrUndefined(motion.cameraMotion ?? motion.camera_motion);
      const cameraType = String(cameraMotion?.type ?? "");
      const validCameraTypes = new Set([
        "static",
        "pan",
        "tilt",
        "dolly_in",
        "dolly_out",
        "truck_left",
        "truck_right",
        "pedestal_up",
        "pedestal_down",
        "orbit",
        "zoom_in",
        "zoom_out",
        "handheld_follow",
        "crane",
      ]);
      const motionSchemaValid =
        motion.version === "continuous-motion-contract-v1"
        && motion.continuous_time === true
        && subjectActions.length > 0
        && subjectActions.every((item) => Boolean(String(item.subject ?? "").trim())
          && Boolean(String(item.action ?? "").trim()))
        && Boolean(cameraMotion)
        && validCameraTypes.has(cameraType);
      if (!motionSchemaValid) {
        push(issues, {
          code: "CONTINUOUS_MOTION_CONTRACT_INVALID",
          segmentNo,
          reason: "continuous_motion_contract_schema_invalid",
          messageZh: `片段 ${segmentNo} 的片段内运动合同不是可验证的 continuous-motion-contract-v1，需要仅重写当前片段。`,
          sourcePath: `segmentRenderDescriptions[${segmentNo}].motionContract`,
          evidenceType: "deterministic_contract",
          confidence: 1,
          repairScope: "segment",
        });
      }
    }

    if (truthy(description.requiresCut ?? description.requires_cut) || truthy(singleTake?.requiresCut ?? singleTake?.requires_cut)) {
      push(issues, {
        code: "SINGLE_TAKE_REQUIRES_CUT",
        segmentNo,
        reason: "requires_cut_true",
        messageZh: `片段 ${segmentNo} 明确 requiresCut=true，必须形成真实镜头边界。`,
        sourcePath: `segmentRenderDescriptions[${segmentNo}].singleTakeContract.requiresCut`,
        evidenceType: "deterministic_contract",
        confidence: 1,
        structural: true,
        repairScope: "timeline",
        repairable: false,
      });
    }

    const unreachable = singleTake?.physicallyReachable === false || singleTake?.physically_reachable === false;
    if (unreachable) {
      push(issues, {
        code: "SINGLE_TAKE_PHYSICALLY_UNREACHABLE",
        segmentNo,
        reason: "physically_unreachable",
        messageZh: `片段 ${segmentNo} 的动作路径被明确标记为不可物理到达，需要重新拆分当前片段。`,
        sourcePath: `segmentRenderDescriptions[${segmentNo}].singleTakeContract.physicallyReachable`,
        evidenceType: "model_assessment",
        confidence: 0.8,
        structural: true,
        repairScope: "timeline",
        repairable: false,
      });
    }

    const riskHigh = highRisk(description.riskLevel ?? description.risk_level)
      || highRisk(singleTake?.riskLevel ?? singleTake?.risk_level);
    if (riskHigh) {
      push(issues, {
        code: "SINGLE_TAKE_HIGH_RISK",
        severity: unreachable ? "error" : "warning",
        segmentNo,
        reason: unreachable ? "high_risk_with_unreachable_evidence" : "high_risk_without_structural_evidence",
        messageZh: unreachable
          ? `片段 ${segmentNo} 同时为 high risk 且动作不可达，需要局部简化。`
          : `片段 ${segmentNo} 被模型标记为 high risk，但没有结构性失败证据，保留警告并允许继续。`,
        sourcePath: `segmentRenderDescriptions[${segmentNo}].singleTakeContract.riskLevel`,
        evidenceType: "model_assessment",
        confidence: unreachable ? 0.85 : 0.55,
        repairScope: unreachable ? "segment" : "none",
      });
    }

    const executableRoots: Array<{ path: string; value: unknown }> = [
      { path: `segmentRenderDescriptions[${segmentNo}].motionContract`, value: motion },
      { path: `segmentRenderDescriptions[${segmentNo}].singleTakeContract`, value: singleTake },
      {
        path: `segmentRenderDescriptions[${segmentNo}].videoPromptContract.motionSteps`,
        value: videoPromptContract.motionSteps ?? videoPromptContract.motion_steps,
      },
      { path: `segments[${segmentNo}].videoPrompt`, value: segment?.videoPrompt ?? segment?.video_prompt },
      { path: `segments[${segmentNo}].motion`, value: segment?.motion },
      { path: `segments[${segmentNo}].camera`, value: segment?.camera },
      { path: `segments[${segmentNo}].microShots`, value: segment?.microShots ?? segment?.micro_shots },
      { path: `segments[${segmentNo}].timedPrompts`, value: segment?.timedPrompts ?? segment?.timed_prompts },
      { path: `segmentRenderDescriptions[${segmentNo}].motionCheckpoints`, value: description.motionCheckpoints ?? description.motion_checkpoints },
    ];
    const cutEvidence = executableRoots.flatMap((root) => findCutLanguageEvidence(root.value, root.path))[0];
    if (cutEvidence) {
      const route = classifyPositiveCutInstruction(cutEvidence.text);
      push(issues, {
        code: route === "boundary_transition_leak"
          ? "BOUNDARY_TRANSITION_LEAKED_INTO_SEGMENT"
          : cutEvidence.path.includes("motionCheckpoints")
            ? "MOTION_CHECKPOINT_CONTAINS_CUT"
            : "INTERNAL_CUT_LANGUAGE",
        segmentNo,
        reason: `${route}:${cutEvidence.path}`,
        messageZh: route === "boundary_transition_leak"
          ? `片段 ${segmentNo} 把片段边界的剪辑计划写进了视频执行字段，应移回 final_transition_plan。`
          : `片段 ${segmentNo} 的可执行字段使用了切镜措辞；先局部改写为同场景连续运动，不直接升级为时间线重规划。`,
        sourcePath: cutEvidence.path,
        matchedText: cutEvidence.text,
        evidenceType: "executable_instruction",
        confidence: 1,
        structural: false,
        repairScope: "segment",
        repairable: true,
      });
    }

    const durationSeconds = number(segment?.durationSeconds ?? segment?.duration_seconds);
    const minimumExecutableSeconds = number(
      description.minimumExecutableSeconds
      ?? description.minimum_executable_seconds
      ?? singleTake?.minimumExecutableSeconds
      ?? singleTake?.minimum_executable_seconds,
    );
    if (durationSeconds > 0 && minimumExecutableSeconds > durationSeconds) {
      const severe = minimumExecutableSeconds > durationSeconds * 1.35;
      push(issues, {
        code: severe ? "SINGLE_TAKE_TIMING_STRUCTURALLY_EXCEEDED" : "SINGLE_TAKE_TIMING_BUDGET_EXCEEDED",
        segmentNo,
        reason: `minimum_${minimumExecutableSeconds}s_exceeds_segment_${durationSeconds}s`,
        messageZh: `片段 ${segmentNo} 最低执行时间 ${minimumExecutableSeconds}s 超过片段时长 ${durationSeconds}s。`,
        sourcePath: `segmentRenderDescriptions[${segmentNo}].minimumExecutableSeconds`,
        evidenceType: "timing_budget",
        confidence: 1,
        structural: severe,
        repairScope: severe ? "timeline" : "segment",
        repairable: !severe,
      });
    }

    const checkpoints = array(description.motionCheckpoints ?? description.motion_checkpoints);
    const checkpointLimit = Math.max(1, Math.min(3, Math.ceil((durationSeconds || 5) / 2.5)));
    if (checkpoints.length > checkpointLimit) {
      push(issues, {
        code: "SINGLE_TAKE_CHECKPOINT_BUDGET_EXCEEDED",
        segmentNo,
        reason: `checkpoint_count_${checkpoints.length}_exceeds_${checkpointLimit}`,
        messageZh: `片段 ${segmentNo} 有 ${checkpoints.length} 个动作检查点，超过当前时长建议上限 ${checkpointLimit}。`,
        sourcePath: `segmentRenderDescriptions[${segmentNo}].motionCheckpoints`,
        evidenceType: "timing_budget",
        confidence: 0.9,
        repairScope: "segment",
      });
    }

    const cameraContext = resolveCameraInheritanceContext(plan, segmentNo);
    if (
      cameraContext.relation === "alternate_view"
      && (!cameraContext.node?.axisDescription || !cameraContext.node?.spatialLayoutLock)
    ) {
      push(issues, {
        code: "ALTERNATE_VIEW_AXIS_UNRESOLVED",
        segmentNo,
        cameraId: cameraContext.cameraId,
        artifactId: `camera:${cameraContext.cameraId ?? "unknown"}`,
        reason: "alternate_view_axis_or_left_right_lock_missing",
        messageZh: `片段 ${segmentNo} 的 alternate_view 缺少轴线或左右空间锁，应只修复 Camera Graph。`,
        sourcePath: `cameraGraph.cameras[${cameraContext.cameraId ?? "unknown"}]`,
        evidenceType: "camera_graph",
        confidence: 1,
        repairScope: "camera_graph",
      });
    }
  }

  const deduped = dedupe(issues);
  const errors = deduped.filter((item) => item.severity === "error");
  const action = decideAuditAction(deduped);
  return {
    passed: errors.length === 0,
    action,
    issues: deduped,
    auditedSegmentNos: [...targets].sort((a, b) => a - b),
    auditVersion: SINGLE_TAKE_AUDIT_POLICY_VERSION,
  };
}

function decideAuditAction(issues: SingleTakeAuditIssue[]): SingleTakeAuditAction {
  const errors = issues.filter((item) => item.severity === "error");
  if (errors.some((item) => item.repairScope === "timeline")) return "replan_timeline";
  if (errors.some((item) => item.repairScope === "camera_graph")) return "repair_camera_graph";
  if (errors.some((item) => item.repairScope === "segment")) return "repair_segment";
  if (errors.some((item) => item.repairScope === "contract")) return "repair_contract";
  return issues.some((item) => item.severity === "warning") ? "allow_with_warning" : "allow";
}

function pushMissingContract(
  issues: SingleTakeAuditIssue[],
  segmentNo: number,
  code: string,
  reason: string,
  field: string,
): void {
  push(issues, {
    code,
    segmentNo,
    reason,
    messageZh: `片段 ${segmentNo} 缺少 ${field}，应只补齐合同。`,
    sourcePath: `segmentRenderDescriptions[${segmentNo}].${field}`,
    evidenceType: "deterministic_contract",
    confidence: 1,
    repairScope: "contract",
  });
}

function push(
  issues: SingleTakeAuditIssue[],
  input: Omit<SingleTakeAuditIssue, "severity" | "artifactId" | "reasonCode" | "retryFromStage" | "repairable" | "structural">
    & Partial<Pick<SingleTakeAuditIssue, "severity" | "artifactId" | "retryFromStage" | "repairable" | "structural">>,
): void {
  issues.push({
    ...input,
    severity: input.severity ?? "error",
    artifactId: input.artifactId ?? `segment:${input.segmentNo}`,
    reasonCode: input.reason,
    retryFromStage: input.retryFromStage ?? (input.repairScope === "camera_graph" ? "stage2a" : "stage2b"),
    repairable: input.repairable ?? input.repairScope !== "timeline",
    structural: input.structural ?? input.repairScope === "timeline",
  });
}

function findCutLanguageEvidence(value: unknown, rootPath: string): Array<{ path: string; text: string }> {
  return executableTextLeaves(value, rootPath).filter((leaf) => {
    const text = stripNegativeCutClauses(leaf.text);
    return /\b(cut to|jump cut|hard cut|dissolve(?:\s+to)?|crossfade|montage|switch to|switch angle|switch camera|scene transition|new shot|another shot|shot change|fade out|fade in)\b|切到|切镜|跳切|转场|叠化|交叉溶解|蒙太奇|切换镜头|切换机位|镜头切换|场景切换|淡入|淡出/i.test(text);
  });
}

function classifyPositiveCutInstruction(
  text: string,
): "wording_only" | "boundary_transition_leak" {
  const normalized = stripNegativeCutClauses(text);
  if (
    /\b(?:after|before|between)\s+(?:segment|clip|shot)s?\b|\b(?:next|previous)\s+(?:segment|clip)\b/i.test(normalized)
    || /(?:片段|视频段|成片段)[一二三四五六七八九十\d]*(?:结束|开始|之间|之后|以前|前|后)|(?:下一|上一)片段/.test(normalized)
  ) {
    return "boundary_transition_leak";
  }
  return "wording_only";
}

function stripNegativeCutClauses(value: string): string {
  return value
    .replace(/\bnot\s+as\s+(?:an?\s+)?(?:extra\s+video\s+clip|separate\s+shot|scene\s+transition)\b/gi, "")
    .replace(/\b(?:no|without|forbid(?:den)?|avoid|must not|do not|don't|never)\b[^.;\n]*/gi, "")
    .replace(/(?:禁止|不得|不要|避免|不可|不能|无任何|无内部)[^。；\n]*/g, "")
    .replace(/无(?:剪辑|剪切|切割|切镜|跳切|淡入淡出|淡入|淡出|叠化|溶解|交叉溶解|蒙太奇|场景切换|场景交换|瞬移|硬过渡|硬视觉过渡)/g, "");
}

function executableTextLeaves(value: unknown, path: string, parentKey = ""): Array<{ path: string; text: string }> {
  if (isNegativeConstraintKey(parentKey)) return [];
  if (typeof value === "string") return [{ path, text: value }];
  if (Array.isArray(value)) return value.flatMap((item, index) => executableTextLeaves(item, `${path}[${index}]`, parentKey));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .flatMap(([key, item]) => executableTextLeaves(item, `${path}.${key}`, key));
  }
  return [];
}

function isNegativeConstraintKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9\u4e00-\u9fff]/gi, "").toLowerCase();
  return normalized.includes("forbidden")
    || normalized.includes("prohibited")
    || normalized.includes("disallowed")
    || normalized.includes("negativeprompt")
    || normalized.includes("禁止项")
    || normalized.includes("负面提示");
}

function dedupe(issues: SingleTakeAuditIssue[]): SingleTakeAuditIssue[] {
  const seen = new Set<string>();
  return issues.filter((item) => {
    const key = `${item.code}:${item.artifactId}:${item.sourcePath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  const result = record(value);
  return Object.keys(result).length ? result : undefined;
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function arrayRecords(value: unknown): Record<string, unknown>[] {
  return array(value).filter((item) => item != null && typeof item === "object" && !Array.isArray(item)) as Record<string, unknown>[];
}
function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}
function highRisk(value: unknown): boolean { return String(value ?? "").toLowerCase() === "high"; }
