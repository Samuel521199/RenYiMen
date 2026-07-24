import type {
  NarrativeEvent,
  VideoAssetContract,
  VideoAssetContractExclusion,
  VideoAssetContractTarget,
  VideoConsistencyAnchor,
  VideoPlanningManifest,
} from "./types";

type JsonRecord = Record<string, unknown>;

export interface AssetContractResolution {
  contract: VideoAssetContract;
  storyboardArtistPlan: Record<string, unknown>;
}

export function resolveAssetContract(params: {
  planningManifest: VideoPlanningManifest;
  narrativeEvents: NarrativeEvent[];
  storyboardArtistPlan: Record<string, unknown>;
  referenceFacts?: unknown;
}): AssetContractResolution {
  const anchors = params.planningManifest.consistencyManifest.anchors;
  const anchorById = new Map(anchors.map((anchor) => [anchor.id, anchor]));
  const eventById = new Map(params.narrativeEvents.map((event) => [event.eventId, event]));
  const timelineBySegment = new Map(
    params.planningManifest.timelineBlueprint.segments.map((segment) => [segment.segmentNo, segment]),
  );
  const root = params.storyboardArtistPlan;
  const beats = records(root.storyBeats ?? root.story_beats);
  const briefs = records(root.storyboardBrief ?? root.storyboard_brief);
  const issues: VideoAssetContract["issues"] = [];

  const beatTargets = beats.map((beat, index) => {
    const beatId = text(beat.beatId ?? beat.beat_id) || `beat_${index + 1}`;
    const sourceEventIds = strings(beat.sourceEventIds ?? beat.source_event_ids);
    const targetSegmentNos = numbers(beat.targetSegmentNos ?? beat.target_segment_nos);
    const declaredAnchorIds = strings(beat.requiredAnchorIds ?? beat.required_anchor_ids);
    const exclusions = normalizeExclusions(beat.anchorExclusions ?? beat.anchor_exclusions, anchorById, `beat:${beatId}`, issues);
    const derivedAnchorIds = unique([
      ...sourceEventIds.flatMap((eventId) => eventById.get(eventId)?.requiredAnchorIds ?? []),
      ...targetSegmentNos.flatMap((segmentNo) => timelineBySegment.get(segmentNo)?.requiredAnchorIds ?? []),
      ...sourceEventIds.flatMap((eventId) => matchEventEntitiesToAnchors(eventById.get(eventId), anchors)),
    ]);
    return target({
      targetType: "beat",
      targetId: beatId,
      declaredAnchorIds,
      derivedAnchorIds,
      exclusions,
      anchors,
      reasons: [
        ...sourceEventIds.map((eventId) => `source_event:${eventId}`),
        ...targetSegmentNos.map((segmentNo) => `target_segment:${segmentNo}`),
      ],
    });
  });
  const beatTargetById = new Map(beatTargets.map((item) => [item.targetId, item]));

  const segmentTargets = params.planningManifest.timelineBlueprint.segments.map((segment) => {
    const brief = briefs.find((item) => number(item.segmentNo ?? item.segment_no) === segment.segmentNo);
    const linkedBeatIds = unique([
      ...strings(brief?.linkedBeatIds ?? brief?.linked_beat_ids),
      ...beats
        .filter((beat) => numbers(beat.targetSegmentNos ?? beat.target_segment_nos).includes(segment.segmentNo))
        .map((beat) => text(beat.beatId ?? beat.beat_id))
        .filter(Boolean),
    ]);
    const sourceEventIds = unique([
      ...(segment.sourceEventIds ?? []),
      ...strings(brief?.sourceEventIds ?? brief?.source_event_ids ?? brief?.eventIds ?? brief?.event_ids),
    ]);
    const declaredAnchorIds = unique([
      ...(segment.requiredAnchorIds ?? []),
      ...strings(brief?.requiredAnchorIds ?? brief?.required_anchor_ids ?? brief?.visibleAnchorIds ?? brief?.visible_anchor_ids),
    ]);
    const exclusions = normalizeExclusions(brief?.anchorExclusions ?? brief?.anchor_exclusions, anchorById, `segment:${segment.segmentNo}`, issues);
    const derivedAnchorIds = unique([
      ...(segment.requiredAnchorIds ?? []),
      ...sourceEventIds.flatMap((eventId) => eventById.get(eventId)?.requiredAnchorIds ?? []),
      ...linkedBeatIds.flatMap((beatId) => beatTargetById.get(beatId)?.effectiveRequiredAnchorIds ?? []),
      ...sourceEventIds.flatMap((eventId) => matchEventEntitiesToAnchors(eventById.get(eventId), anchors)),
      ...matchLocationToAnchors(text(brief?.locationId ?? brief?.location_id), anchors),
    ]);
    return target({
      targetType: "segment",
      targetId: String(segment.segmentNo),
      segmentNo: segment.segmentNo,
      declaredAnchorIds,
      derivedAnchorIds,
      exclusions,
      anchors,
      reasons: [
        ...sourceEventIds.map((eventId) => `source_event:${eventId}`),
        ...linkedBeatIds.map((beatId) => `linked_beat:${beatId}`),
      ],
    });
  });
  const segmentTargetByNo = new Map(segmentTargets.map((item) => [item.segmentNo as number, item]));
  const boundaryTargets = Array.from(
    { length: params.planningManifest.timelineBlueprint.segmentCount + 1 },
    (_, index) => {
      const keyframeNo = index + 1;
      const adjacent = [segmentTargetByNo.get(keyframeNo - 1), segmentTargetByNo.get(keyframeNo)].filter(Boolean) as VideoAssetContractTarget[];
      return target({
        targetType: "keyframe",
        targetId: String(keyframeNo),
        keyframeNo,
        declaredAnchorIds: [],
        derivedAnchorIds: unique(adjacent.flatMap((item) => item.effectiveRequiredAnchorIds)),
        exclusions: [],
        anchors,
        reasons: adjacent.map((item) => `adjacent_segment:${item.segmentNo}`),
      });
    },
  );

  const contract: VideoAssetContract = {
    version: "asset-contract-v1",
    beatTargets,
    segmentTargets,
    boundaryTargets,
    referenceFactFingerprint: stableReferenceFactFingerprint(params.referenceFacts),
    issues,
  };
  return {
    contract,
    storyboardArtistPlan: {
      ...root,
      asset_contract: contract,
      story_beats: beats.map((beat, index) => applyTargetFields(beat, beatTargets[index])),
      storyboard_brief: briefs.map((brief) => {
        const segmentNo = number(brief.segmentNo ?? brief.segment_no);
        return applyTargetFields(brief, segmentTargetByNo.get(segmentNo));
      }),
    },
  };
}

export function targetForSegment(contract: VideoAssetContract | undefined, segmentNo: number): VideoAssetContractTarget | undefined {
  return contract?.segmentTargets.find((item) => item.segmentNo === segmentNo);
}

export function targetForKeyframe(contract: VideoAssetContract | undefined, keyframeNo: number): VideoAssetContractTarget | undefined {
  return contract?.boundaryTargets.find((item) => item.keyframeNo === keyframeNo);
}

export function effectiveAnchorIdsForChild(
  declaredAnchorIds: string[] | undefined,
  parentTarget: VideoAssetContractTarget | undefined,
  exclusions?: VideoAssetContractExclusion[],
): string[] {
  const excluded = new Set((exclusions ?? []).filter((item) => item.valid).map((item) => item.anchorId));
  return unique([
    ...(parentTarget?.effectiveRequiredAnchorIds ?? []),
    ...(declaredAnchorIds ?? []),
  ]).filter((anchorId) => !excluded.has(anchorId));
}

function applyTargetFields(source: JsonRecord, resolved: VideoAssetContractTarget | undefined): JsonRecord {
  if (!resolved) return source;
  return {
    ...source,
    declared_anchor_ids: resolved.declaredAnchorIds,
    derived_anchor_ids: resolved.derivedAnchorIds,
    effective_required_anchor_ids: resolved.effectiveRequiredAnchorIds,
    anchor_exclusions: resolved.excludedAnchors,
    required_anchor_ids: resolved.effectiveRequiredAnchorIds,
  };
}

function target(params: {
  targetType: VideoAssetContractTarget["targetType"];
  targetId: string;
  segmentNo?: number;
  keyframeNo?: number;
  declaredAnchorIds: string[];
  derivedAnchorIds: string[];
  exclusions: VideoAssetContractExclusion[];
  anchors: VideoConsistencyAnchor[];
  reasons: string[];
}): VideoAssetContractTarget {
  const validExclusions = new Set(params.exclusions.filter((item) => item.valid).map((item) => item.anchorId));
  const effectiveRequiredAnchorIds = unique([...params.derivedAnchorIds, ...params.declaredAnchorIds])
    .filter((anchorId) => !validExclusions.has(anchorId));
  const anchorById = new Map(params.anchors.map((anchor) => [anchor.id, anchor]));
  return {
    targetType: params.targetType,
    targetId: params.targetId,
    segmentNo: params.segmentNo,
    keyframeNo: params.keyframeNo,
    declaredAnchorIds: unique(params.declaredAnchorIds),
    derivedAnchorIds: unique(params.derivedAnchorIds),
    effectiveRequiredAnchorIds,
    excludedAnchors: params.exclusions,
    expectedVisibleEntities: effectiveRequiredAnchorIds.map((anchorId) => {
      const anchor = anchorById.get(anchorId);
      return anchor?.displayNameZh || anchor?.displayNameEn || anchorId;
    }),
    derivationReasons: unique(params.reasons),
  };
}

function normalizeExclusions(
  value: unknown,
  anchorById: Map<string, VideoConsistencyAnchor>,
  targetId: string,
  issues: VideoAssetContract["issues"],
): VideoAssetContractExclusion[] {
  return records(value).map((item) => {
    const anchorId = text(item.anchorId ?? item.anchor_id);
    const reason = text(item.reason ?? item.reasonZh ?? item.reason_zh);
    const visibility = text(item.visibility ?? item.presence);
    const valid = anchorById.has(anchorId)
      && reason.length >= 8
      && /not_visible|offscreen|absent|occluded|画外|不出现|不可见|被遮挡/i.test(`${visibility} ${reason}`);
    if (!valid) {
      issues.push({
        code: "UNJUSTIFIED_ANCHOR_EXCLUSION",
        targetId,
        anchorId,
        messageZh: `锚点 ${anchorId || "未知"} 的排除缺少有效的不可见理由。`,
      });
    }
    return { anchorId, reason, visibility, valid };
  });
}

function matchEventEntitiesToAnchors(event: NarrativeEvent | undefined, anchors: VideoConsistencyAnchor[]): string[] {
  if (!event) return [];
  const values = [...event.participants, event.locationId].map(normalize).filter(Boolean);
  return anchors.filter((anchor) => {
    const names = [anchor.id, anchor.displayNameZh, anchor.displayNameEn].map(normalize).filter(Boolean);
    return values.some((value) => names.some((name) => value === name || value.includes(name) || name.includes(value)));
  }).map((anchor) => anchor.id);
}

function matchLocationToAnchors(locationId: string, anchors: VideoConsistencyAnchor[]): string[] {
  const value = normalize(locationId);
  if (!value) return [];
  return anchors.filter((anchor) => {
    if (anchor.type !== "location" && anchor.type !== "space_layout") return false;
    return [anchor.id, anchor.displayNameZh, anchor.displayNameEn]
      .map(normalize)
      .filter(Boolean)
      .some((name) => value === name || value.includes(name) || name.includes(value));
  }).map((anchor) => anchor.id);
}

function stableReferenceFactFingerprint(value: unknown): string | undefined {
  if (value == null) return undefined;
  const serialized = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function record(value: unknown): JsonRecord {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}
function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record).filter((item) => Object.keys(item).length > 0) : [];
}
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}
function strings(value: unknown): string[] {
  return unique(Array.isArray(value) ? value.map(text).filter(Boolean) : []);
}
function numbers(value: unknown): number[] {
  return unique(Array.isArray(value) ? value.map(number).filter((item) => item > 0) : []);
}
function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
function normalize(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, "");
}
