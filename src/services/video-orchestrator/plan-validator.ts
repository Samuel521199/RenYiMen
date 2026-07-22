import { readCameraGraph, resolveCameraInheritanceContext } from "./camera-graph";
import { frameContractContainsMotionProcess } from "./frame-contract";
import type { PlanValidationIssue } from "./types";
import { auditSingleTakePlan } from "./single-take-audit";

export type PlanValidationStage = "planning" | "keyframe_generation" | "micro_shot_generation" | "video_generation";

export interface PlanValidationContext {
  stage?: PlanValidationStage;
  targetArtifactId?: string;
  keyframeNo?: number;
  segmentNo?: number;
  requiredHardAnchorIds?: string[];
  approvedHardAnchorIds?: string[];
  selectedHardAnchorIds?: string[];
}

export class PlanValidationError extends Error {
  readonly issues: PlanValidationIssue[];
  constructor(issues: PlanValidationIssue[]) {
    const errors = issues.filter((issue) => issue.severity === "error");
    super(`计划硬校验未通过：${errors.slice(0, 5).map((issue) => `${issue.artifactId ? `${issue.artifactId}：` : ""}${issue.messageZh}${issue.retryFromStage ? ` 建议回退：${issue.retryFromStage}` : ""}`).join("；")}`);
    this.name = "PlanValidationError";
    this.issues = issues;
  }
}

export function assertPlanValidForGeneration(plan: unknown, context: PlanValidationContext): PlanValidationIssue[] {
  const issues = validateOnePromptVideoPlan(plan, context);
  if (issues.some((issue) => issue.severity === "error")) throw new PlanValidationError(issues);
  return issues;
}

export function validateOnePromptVideoPlan(planValue: unknown, context: PlanValidationContext = {}): PlanValidationIssue[] {
  const plan = record(planValue);
  const issues: PlanValidationIssue[] = [];
  const keyframes = arrayRecords(plan.keyframes);
  const segments = arrayRecords(plan.segments);
  const descriptions = arrayRecords(plan.segmentRenderDescriptions ?? plan.segment_render_descriptions);
  const briefs = arrayRecords(plan.storyboardBrief ?? plan.storyboard_brief);
  const events = arrayRecords(plan.narrativeEvents ?? plan.narrative_events);
  const graph = readCameraGraph(plan.cameraGraph ?? plan.camera_graph);
  const durationSeconds = number(plan.durationSeconds ?? plan.duration_seconds);

  for (const segment of segments) {
    const segmentNo = number(segment.segmentNo ?? segment.segment_no);
    const duration = number(segment.durationSeconds ?? segment.duration_seconds);
    if (duration < 3 || duration > 15) {
      error(issues, "SEGMENT_DURATION_OUT_OF_RANGE", `segment:${segmentNo}`, `片段时长必须在 3 至 15 秒之间，当前为 ${duration || 0} 秒。`, "stage_1_timeline");
    }
  }
  const totalDuration = segments.reduce((sum, item) => sum + number(item.durationSeconds ?? item.duration_seconds), 0);
  if (segments.length && durationSeconds > 0 && Math.abs(totalDuration - durationSeconds) > 0.01) {
    error(issues, "SEGMENT_TOTAL_DURATION_MISMATCH", "timeline", `片段总时长 ${totalDuration} 秒与项目时长 ${durationSeconds} 秒不一致。`, "stage_1_timeline");
  }
  if (keyframes.length !== segments.length + 1) {
    error(issues, "KEYFRAME_COUNT_MISMATCH", "timeline", `关键帧数量 ${keyframes.length} 必须等于片段数量 ${segments.length} 加一。`, "stage_2b_shot_decomposer");
  }

  const keyframeNos = new Set(keyframes.map((item) => number(item.keyframeNo ?? item.keyframe_no)));
  const segmentNos = new Set(segments.map((item) => number(item.segmentNo ?? item.segment_no)));
  for (let expected = 1; expected <= keyframes.length; expected += 1) {
    if (!keyframeNos.has(expected)) error(issues, "KEYFRAME_SEQUENCE_BROKEN", `keyframe:${expected}`, `缺少连续关键帧 KF${expected}。`, "stage_2b_shot_decomposer");
  }
  for (let expected = 1; expected <= segments.length; expected += 1) {
    const segment = segments.find((item) => number(item.segmentNo ?? item.segment_no) === expected);
    if (!segment) {
      error(issues, "SEGMENT_SEQUENCE_BROKEN", `segment:${expected}`, `缺少连续片段 segment ${expected}。`, "stage_2b_shot_decomposer");
      continue;
    }
    const start = number(segment.startKeyframeNo ?? segment.start_keyframe_no);
    const end = number(segment.endKeyframeNo ?? segment.end_keyframe_no);
    if (start !== expected || end !== expected + 1 || !keyframeNos.has(start) || !keyframeNos.has(end)) {
      error(issues, "SEGMENT_BOUNDARY_REFERENCE_BROKEN", `segment:${expected}`, `片段 ${expected} 必须连续引用 KF${expected} 到 KF${expected + 1}。`, "stage_2b_shot_decomposer");
    }
  }

  const descriptionsBySegment = new Map(descriptions.map((item) => [number(item.segmentNo ?? item.segment_no), item]));
  for (const segment of segments) {
    const segmentNo = number(segment.segmentNo ?? segment.segment_no);
    const artifactId = `segment:${segmentNo}`;
    const description = descriptionsBySegment.get(segmentNo);
    if (!description) continue;
    const startFrame = recordOrUndefined(description.startFrameContract ?? description.start_frame_contract);
    const endFrame = recordOrUndefined(description.endFrameContract ?? description.end_frame_contract);
    if (startFrame && frameContractContainsMotionProcess(startFrame)) error(issues, "START_FRAME_CONTAINS_MOTION", artifactId, `片段 ${segmentNo} 的首帧合同包含运动过程，必须只描述静态状态。`, "stage_2b_shot_decomposer");
    if (endFrame && frameContractContainsMotionProcess(endFrame)) error(issues, "END_FRAME_CONTAINS_MOTION", artifactId, `片段 ${segmentNo} 的尾帧合同包含运动过程，必须只描述静态状态。`, "stage_2b_shot_decomposer");
  }

  const singleTakeAudit = auditSingleTakePlan(plan, context.segmentNo ? [context.segmentNo] : undefined);
  issues.push(...singleTakeAudit.issues.map((issue) => ({
    code: issue.code,
    severity: issue.severity,
    artifactId: issue.artifactId,
    messageZh: issue.messageZh,
    retryFromStage: issue.retryFromStage,
  } satisfies PlanValidationIssue)));

  const eventIds = new Set(events.map((item) => text(item.eventId ?? item.event_id)).filter(Boolean));
  const anchorIds = new Set(readAnchorIds(plan));
  const cameraIds = new Set(graph.cameras.map((item) => item.cameraId));
  for (const brief of briefs) {
    const segmentNo = number(brief.segmentNo ?? brief.segment_no);
    for (const eventId of strings(brief.eventIds ?? brief.event_ids ?? brief.sourceEventIds ?? brief.source_event_ids)) {
      if (!eventIds.has(eventId)) error(issues, "MISSING_EVENT_REFERENCE", `segment:${segmentNo}`, `分镜引用了不存在的事件 ${eventId}。`, "stage_1_timeline");
    }
    const cameraId = text(brief.cameraId ?? brief.camera_id);
    if (cameraId && !cameraIds.has(cameraId)) error(issues, "MISSING_CAMERA_REFERENCE", `segment:${segmentNo}`, `分镜引用了不存在的机位 ${cameraId}。`, "stage_2a_storyboard");
    validateAnchorReferences(issues, strings(brief.requiredAnchorIds ?? brief.required_anchor_ids ?? brief.visibleAnchorIds ?? brief.visible_anchor_ids), anchorIds, `segment:${segmentNo}`);
  }
  for (const keyframe of keyframes) validateAnchorReferences(issues, strings(keyframe.usesConsistencyAnchors ?? keyframe.uses_consistency_anchors), anchorIds, `keyframe:${number(keyframe.keyframeNo ?? keyframe.keyframe_no)}`);
  for (const segment of segments) validateAnchorReferences(issues, strings(segment.usesConsistencyAnchors ?? segment.uses_consistency_anchors), anchorIds, `segment:${number(segment.segmentNo ?? segment.segment_no)}`);
  for (const edge of graph.relations) {
    if (!cameraIds.has(edge.fromCameraId) || !cameraIds.has(edge.toCameraId)) error(issues, "MISSING_CAMERA_RELATION_NODE", `camera:${edge.toCameraId}`, `Camera Graph relation 引用了不存在的机位。`, "stage_2a_storyboard");
  }

  validateCameraSafety(plan, graph.cameras.map((node) => ({ node, context: resolveCameraInheritanceContext(plan, node.segmentNos[0] ?? node.parentSegmentNo ?? 0) })), issues);
  validateHardAnchors(context, issues);

  if (!graph.cameras.length) warning(issues, "CAMERA_GRAPH_MISSING", "camera_graph", "计划缺少 Camera Graph；历史计划可以打开，但重新生成前应补齐机位继承关系。", "stage_2a_storyboard");
  return dedupe(issues);
}

function validateCameraSafety(plan: Record<string, unknown>, entries: Array<{ node: ReturnType<typeof readCameraGraph>["cameras"][number]; context: ReturnType<typeof resolveCameraInheritanceContext> }>, issues: PlanValidationIssue[]): void {
  const transitions = arrayRecords(plan.transitionReferencePlan ?? plan.transition_reference_plan);
  for (const { node, context } of entries) {
    if (context.relation === "alternate_view" && (!node.axisDescription || !node.spatialLayoutLock)) {
      error(issues, "ALTERNATE_VIEW_AXIS_UNRESOLVED", `camera:${node.cameraId}`, `alternate_view 机位 ${node.cameraId} 缺少轴线或左右空间锁，无法检查 180 度规则。`, "stage_2a_storyboard");
    }
    if (context.relation !== "new_camera_setup") continue;
    const hasTransition = transitions.some((item) => text(item.toCameraId ?? item.to_camera_id) === node.cameraId || node.segmentNos.includes(number(item.segmentNo ?? item.segment_no ?? item.toSegmentNo ?? item.to_segment_no)));
    const explicitNoInheritance = /无需继承|不继承|no[- ]?inheritance|independent setup/i.test(node.inheritanceReasonZh ?? "");
    const unresolved = (node.missingInfo ?? []).filter(Boolean);
    if (unresolved.length || (!hasTransition && !explicitNoInheritance)) {
      error(issues, "NEW_CAMERA_SPATIAL_SOURCE_MISSING", `camera:${node.cameraId}`, `新机位 ${node.cameraId} 缺少 transition reference 或明确的无需继承说明${unresolved.length ? `，未解决信息：${unresolved.join("、")}` : ""}。`, "stage_2a_storyboard");
    }
  }
}

function validateHardAnchors(context: PlanValidationContext, issues: PlanValidationIssue[]): void {
  const required = new Set(context.requiredHardAnchorIds ?? []);
  if (!required.size) return;
  const approved = new Set(context.approvedHardAnchorIds ?? []);
  const selected = new Set(context.selectedHardAnchorIds ?? []);
  for (const anchorId of required) {
    if (!approved.has(anchorId)) error(issues, "HARD_ANCHOR_IMAGE_MISSING", context.targetArtifactId, `可见 hard anchor ${anchorId} 没有已批准参考图。`, "asset_review");
    if (context.selectedHardAnchorIds && !selected.has(anchorId)) error(issues, "HARD_ANCHOR_NOT_SELECTED", context.targetArtifactId, `hard anchor ${anchorId} 的批准图片没有进入最终 reference selection。`, "reference_selection");
  }
}

function validateAnchorReferences(issues: PlanValidationIssue[], references: string[], known: Set<string>, artifactId: string): void {
  for (const anchorId of references) if (!known.has(anchorId)) error(issues, "MISSING_ANCHOR_REFERENCE", artifactId, `引用了不存在的 anchor ${anchorId}。`, "stage_1_timeline");
}
function readAnchorIds(plan: Record<string, unknown>): string[] {
  const consistency = record(plan.consistencyManifest ?? plan.consistency_manifest ?? record(plan.planningManifest ?? plan.planning_manifest).consistencyManifest ?? record(plan.planningManifest ?? plan.planning_manifest).consistency_manifest);
  return arrayRecords(consistency.anchors).map((item) => text(item.id ?? item.anchorId ?? item.anchor_id)).filter(Boolean);
}
function error(issues: PlanValidationIssue[], code: string, artifactId: string | undefined, messageZh: string, retryFromStage: string): void { issues.push({ code, severity: "error", artifactId, messageZh, retryFromStage }); }
function warning(issues: PlanValidationIssue[], code: string, artifactId: string | undefined, messageZh: string, retryFromStage: string): void { issues.push({ code, severity: "warning", artifactId, messageZh, retryFromStage }); }
function dedupe(issues: PlanValidationIssue[]): PlanValidationIssue[] { const seen = new Set<string>(); return issues.filter((item) => { const key = `${item.code}:${item.artifactId ?? ""}:${item.messageZh}`; if (seen.has(key)) return false; seen.add(key); return true; }); }
function record(value: unknown): Record<string, unknown> { return value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function recordOrUndefined(value: unknown): Record<string, unknown> | undefined { const result = record(value); return Object.keys(result).length ? result : undefined; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function arrayRecords(value: unknown): Record<string, unknown>[] { return array(value).filter((item) => item != null && typeof item === "object" && !Array.isArray(item)) as Record<string, unknown>[]; }
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function number(value: unknown): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function strings(value: unknown): string[] { return array(value).map(text).filter(Boolean); }
