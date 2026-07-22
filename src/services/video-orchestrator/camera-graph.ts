import type { CameraGraph, CameraGraphNode, CameraRelation, OnePromptVideoPlan } from "./types";

export interface CameraInheritanceContext {
  cameraId?: string;
  segmentNo: number;
  node?: CameraGraphNode;
  parent?: CameraGraphNode;
  relation?: CameraRelation;
  inheritanceDirectives: string[];
  selectorDirective?: string;
  auditDirectives: string[];
}

const RELATION_DIRECTIVES: Record<CameraRelation, string[]> = {
  same_camera_setup: ["inherit composition", "inherit camera axis", "inherit spatial layout", "inherit lighting"],
  same_axis: ["inherit camera axis", "inherit spatial direction", "framing may change"],
  derived_reframe: ["inherit subject relationships", "inherit spatial layout", "recalculate framing boundaries"],
  same_spatial_context: ["inherit location", "inherit fixed objects", "inherit lighting", "do not inherit identity from the parent frame"],
  same_subject_group: ["inherit subject group only", "do not inherit layout or identity details not backed by hard anchors"],
  alternate_view: ["preserve the 180-degree axis", "preserve left-right subject relationships", "use the alternate view without crossing the axis"],
  new_camera_setup: ["do not silently inherit the previous composition", "use a transition reference or an explicit no-inheritance decision"],
};

export function cameraRelationDirectives(relation?: CameraRelation): string[] {
  return relation ? [...RELATION_DIRECTIVES[relation]] : [];
}

export function resolveCameraInheritanceContext(
  plan: Pick<OnePromptVideoPlan, "cameraGraph" | "storyboardBrief"> | Record<string, unknown> | null | undefined,
  segmentNo: number,
): CameraInheritanceContext {
  const source = record(plan);
  const graph = readCameraGraph(source.cameraGraph ?? source.camera_graph);
  const briefs = arrayRecords(source.storyboardBrief ?? source.storyboard_brief);
  const brief = briefs.find((item) => number(item.segmentNo ?? item.segment_no) === segmentNo);
  const cameraId = text(brief?.cameraId ?? brief?.camera_id) || graph.cameras.find((item) => item.segmentNos.includes(segmentNo))?.cameraId;
  const node = graph.cameras.find((item) => item.cameraId === cameraId);
  const incomingEdge = graph.relations.find((edge) => edge.toCameraId === cameraId);
  const relation = node?.relationToParent ?? incomingEdge?.relation;
  const parentCameraId = node?.parentCameraId ?? incomingEdge?.fromCameraId;
  const parent = graph.cameras.find((item) => item.cameraId === parentCameraId);
  const inheritanceDirectives = cameraRelationDirectives(relation);
  if (node?.axisDescription) inheritanceDirectives.push(`axis lock: ${node.axisDescription}`);
  if (node?.framingRange) inheritanceDirectives.push(`framing range: ${node.framingRange}`);
  if (node?.movementStyle) inheritanceDirectives.push(`movement style: ${node.movementStyle}`);
  if (node?.spatialLayoutLock) inheritanceDirectives.push(`spatial layout lock: ${node.spatialLayoutLock}`);
  if (node?.inheritanceReasonZh) inheritanceDirectives.push(`inheritance decision: ${node.inheritanceReasonZh}`);

  const selectorDirective = relation === "same_camera_setup" || relation === "derived_reframe"
    ? "Prefer an approved parent-camera frame as space_layout evidence."
    : relation === "same_axis" || relation === "alternate_view"
      ? "Use parent-camera evidence only for axis and left-right spatial continuity."
      : relation === "same_spatial_context"
        ? "Use parent-camera evidence only for location, fixed objects, and lighting."
        : relation === "same_subject_group"
          ? "Do not use a parent-camera frame as identity evidence; hard anchors remain authoritative."
          : relation === "new_camera_setup"
            ? "Require a transition reference or an explicit no-inheritance decision."
            : undefined;
  const auditDirectives = relation === "alternate_view"
    ? ["Verify the motion path does not cross the 180-degree axis or reverse left-right relationships."]
    : relation === "new_camera_setup"
      ? ["Verify the new setup has a spatial source or an explicit no-inheritance decision."]
      : inheritanceDirectives.slice();
  return { cameraId, segmentNo, node, parent, relation, inheritanceDirectives, selectorDirective, auditDirectives };
}

export function readCameraGraph(value: unknown): CameraGraph {
  const source = record(value);
  const cameras = arrayRecords(source.cameras ?? source.nodes).flatMap((item, index) => {
    const cameraId = text(item.cameraId ?? item.camera_id ?? item.id) || `camera_${index + 1}`;
    const relationToParent = cameraRelation(item.relationToParent ?? item.relation_to_parent);
    return [{
      cameraId,
      segmentNos: array(item.segmentNos ?? item.segment_nos ?? item.segments).map(number).filter((entry) => entry > 0),
      locationId: optionalText(item.locationId ?? item.location_id),
      description: optionalText(item.description),
      parentCameraId: optionalText(item.parentCameraId ?? item.parent_camera_id),
      parentSegmentNo: optionalNumber(item.parentSegmentNo ?? item.parent_segment_no),
      axisDescription: optionalText(item.axisDescription ?? item.axis_description),
      framingRange: optionalText(item.framingRange ?? item.framing_range),
      movementStyle: optionalText(item.movementStyle ?? item.movement_style),
      spatialLayoutLock: optionalText(item.spatialLayoutLock ?? item.spatial_layout_lock),
      relationToParent,
      missingInfo: array(item.missingInfo ?? item.missing_info).map(text).filter(Boolean),
      inheritanceReasonZh: optionalText(item.inheritanceReasonZh ?? item.inheritance_reason_zh),
    }];
  });
  const relations = arrayRecords(source.relations ?? source.edges).flatMap((item) => {
    const fromCameraId = text(item.fromCameraId ?? item.from_camera_id ?? item.from);
    const toCameraId = text(item.toCameraId ?? item.to_camera_id ?? item.to);
    if (!fromCameraId || !toCameraId) return [];
    return [{
      fromCameraId,
      toCameraId,
      relation: cameraRelation(item.relation) ?? "new_camera_setup",
      reason: optionalText(item.reason),
    }];
  });
  return { cameras, relations };
}

function cameraRelation(value: unknown): CameraRelation | undefined {
  return value === "same_camera_setup" || value === "same_axis" || value === "derived_reframe" ||
    value === "same_spatial_context" || value === "same_subject_group" || value === "alternate_view" ||
    value === "new_camera_setup" ? value : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function arrayRecords(value: unknown): Record<string, unknown>[] { return array(value).map(record); }
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function number(value: unknown): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function optionalText(value: unknown): string | undefined { return text(value) || undefined; }
function optionalNumber(value: unknown): number | undefined { const parsed = number(value); return parsed > 0 ? parsed : undefined; }
