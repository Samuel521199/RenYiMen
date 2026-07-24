import type { VideoCreativeTemplateId, VideoStoryFunction } from "./types";

export type StoryContractIssueCode =
  | "STORY_BEATS_MISSING"
  | "BEAT_ID_DUPLICATE"
  | "REQUIRED_BEAT_FUNCTION_MISSING"
  | "BEAT_TRACE_FIELD_MISSING"
  | "BEAT_TARGET_SEGMENT_INVALID"
  | "BEAT_SOURCE_EVENT_INVALID"
  | "BEAT_DEPENDENCY_MISSING"
  | "BEAT_DEPENDENCY_INVALID"
  | "BEAT_DEPENDENCY_NOT_EARLIER"
  | "PAYOFF_TRIGGER_MISSING"
  | "CTA_BENEFIT_DEPENDENCY_MISSING"
  | "CONFLICT_RESOLUTION_INVALID"
  | "EVIDENCE_REGISTRY_MISSING"
  | "EVIDENCE_ID_DUPLICATE"
  | "EVIDENCE_REFERENCE_INVALID"
  | "EVIDENCE_INTRODUCTION_NOT_EARLIER"
  | "EVIDENCE_NOT_VISIBLE"
  | "STORYBOARD_SEGMENT_MISSING"
  | "STORYBOARD_BEAT_REFERENCE_INVALID";

export interface StoryContractIssue {
  code: StoryContractIssueCode;
  path: string;
  messageZh: string;
  repairHint: string;
  beatId?: string;
  segmentNo?: number;
}

export interface StoryContractGateResult {
  passed: boolean;
  issues: StoryContractIssue[];
  metrics: {
    beatCount: number;
    evidenceCount: number;
    invalidReferenceCount: number;
    requiredFunctionCount: number;
  };
  contractVersion: "story-contract-v1";
}

type JsonRecord = Record<string, unknown>;

const REQUIRED_FUNCTIONS: Record<VideoCreativeTemplateId, VideoStoryFunction[]> = {
  game_reversal: ["hook", "conflict", "turning_point", "payoff", "cta"],
  game_bonus_payoff: ["hook", "turning_point", "payoff", "cta"],
  product_problem_solution: ["hook", "proof", "payoff", "cta"],
  ecommerce_offer_conversion: ["hook", "proof", "payoff", "cta"],
  food_sensory_reaction: ["hook", "proof", "reaction", "cta"],
  auto_performance_hero: ["hook", "proof", "payoff", "cta"],
  short_drama_conflict_twist: ["hook", "conflict", "turning_point", "cliffhanger"],
  generic_brand_story: ["hook", "conflict", "proof", "payoff", "cta"],
};

export function requiredStoryFunctionsForTemplate(templateId: VideoCreativeTemplateId): VideoStoryFunction[] {
  return [...REQUIRED_FUNCTIONS[templateId]];
}

export function validateStoryboardStoryContract(params: {
  storyboardArtistPlan: unknown;
  templateId: VideoCreativeTemplateId;
  validEventIds: Iterable<string>;
  validSegmentNos: Iterable<number>;
}): StoryContractGateResult {
  const root = record(params.storyboardArtistPlan);
  const beats = records(root.storyBeats ?? root.story_beats);
  const briefs = records(root.storyboardBrief ?? root.storyboard_brief);
  const evidence = records(root.evidenceRegistry ?? root.evidence_registry);
  const validEventIds = new Set(params.validEventIds);
  const validSegmentNos = new Set(params.validSegmentNos);
  const requiredFunctions = requiredStoryFunctionsForTemplate(params.templateId);
  const issues: StoryContractIssue[] = [];

  if (!beats.length) {
    issue(issues, "STORY_BEATS_MISSING", "story_beats", "缺少结构化 story_beats。", "按当前模板生成完整的剧情节拍与因果链。");
  }

  const beatById = new Map<string, JsonRecord>();
  const beatOrder = new Map<string, number>();
  const beatFunction = new Map<string, string>();
  for (const [index, beat] of beats.entries()) {
    const beatId = text(beat.beatId ?? beat.beat_id);
    const path = `story_beats[${index}]`;
    if (!beatId) {
      issue(issues, "BEAT_TRACE_FIELD_MISSING", `${path}.beat_id`, "剧情节拍缺少 beat_id。", "填写稳定且唯一的 beat_id。");
      continue;
    }
    if (beatById.has(beatId)) {
      issue(issues, "BEAT_ID_DUPLICATE", `${path}.beat_id`, `beat_id ${beatId} 重复。`, "为每个剧情节拍使用唯一 ID。", { beatId });
      continue;
    }
    beatById.set(beatId, beat);
    beatOrder.set(beatId, number(beat.order) || index + 1);
    beatFunction.set(beatId, text(beat.storyFunction ?? beat.story_function));
  }

  for (const required of requiredFunctions) {
    if (![...beatFunction.values()].includes(required)) {
      issue(
        issues,
        "REQUIRED_BEAT_FUNCTION_MISSING",
        "story_beats",
        `模板 ${params.templateId} 缺少 ${required} 节拍。`,
        `新增一个 story_function=${required} 的节拍，并接入前后因果关系。`,
      );
    }
  }

  const evidenceById = new Map<string, JsonRecord>();
  for (const [index, item] of evidence.entries()) {
    const evidenceId = text(item.evidenceId ?? item.evidence_id);
    const path = `evidence_registry[${index}]`;
    if (!evidenceId) {
      issue(issues, "EVIDENCE_REGISTRY_MISSING", `${path}.evidence_id`, "证据注册项缺少 evidence_id。", "填写唯一 evidence_id。");
      continue;
    }
    if (evidenceById.has(evidenceId)) {
      issue(issues, "EVIDENCE_ID_DUPLICATE", `${path}.evidence_id`, `evidence_id ${evidenceId} 重复。`, "合并重复证据或改用唯一 ID。");
      continue;
    }
    evidenceById.set(evidenceId, item);
    const introducedBy = text(item.introducedByBeatId ?? item.introduced_by_beat_id);
    if (!beatById.has(introducedBy)) {
      issue(issues, "EVIDENCE_REFERENCE_INVALID", `${path}.introduced_by_beat_id`, `证据 ${evidenceId} 的引入节拍不存在。`, "引用一个真实存在的 beat_id。");
    }
    const visibleSegments = numbers(item.visibleInSegmentNos ?? item.visible_in_segment_nos);
    if (!visibleSegments.length || visibleSegments.some((segmentNo) => !validSegmentNos.has(segmentNo))) {
      issue(issues, "EVIDENCE_NOT_VISIBLE", `${path}.visible_in_segment_nos`, `证据 ${evidenceId} 没有绑定到有效可见片段。`, "填写至少一个有效 segment_no。");
    }
  }

  for (const [index, beat] of beats.entries()) {
    const beatId = text(beat.beatId ?? beat.beat_id);
    if (!beatId) continue;
    const path = `story_beats[${index}]`;
    const storyFunction = text(beat.storyFunction ?? beat.story_function);
    for (const field of ["cause", "effect"] as const) {
      if (!text(beat[field])) {
        issue(issues, "BEAT_TRACE_FIELD_MISSING", `${path}.${field}`, `${beatId} 缺少 ${field}。`, `明确填写 ${field}，不要用空字符串占位。`, { beatId });
      }
    }
    if (!text(beat.informationUnit ?? beat.information_unit)) {
      issue(issues, "BEAT_TRACE_FIELD_MISSING", `${path}.information_unit`, `${beatId} 缺少 information_unit。`, "说明该节拍相对前一节拍新增了什么信息。", { beatId });
    }

    const targetSegments = numbers(beat.targetSegmentNos ?? beat.target_segment_nos);
    if (!targetSegments.length || targetSegments.some((segmentNo) => !validSegmentNos.has(segmentNo))) {
      issue(issues, "BEAT_TARGET_SEGMENT_INVALID", `${path}.target_segment_nos`, `${beatId} 没有绑定到有效片段。`, "引用 planning_manifest 中存在的 segment_no。", { beatId });
    }
    const sourceEvents = strings(beat.sourceEventIds ?? beat.source_event_ids);
    if (!sourceEvents.length || (validEventIds.size > 0 && sourceEvents.some((eventId) => !validEventIds.has(eventId)))) {
      issue(issues, "BEAT_SOURCE_EVENT_INVALID", `${path}.source_event_ids`, `${beatId} 没有绑定到有效 narrative_event。`, "引用 Planning Architect 已定义的 event_id。", { beatId });
    }

    const dependencies = strings(beat.dependsOnBeatIds ?? beat.depends_on_beat_ids);
    if (storyFunction !== "hook" && !dependencies.length) {
      issue(issues, "BEAT_DEPENDENCY_MISSING", `${path}.depends_on_beat_ids`, `${beatId} 缺少因果前置节拍。`, "引用一个或多个更早的 beat_id。", { beatId });
    }
    validateEarlierBeatReferences(issues, dependencies, beatId, `${path}.depends_on_beat_ids`, beatById, beatOrder);

    const evidenceFrom = strings(beat.evidenceFromBeatIds ?? beat.evidence_from_beat_ids);
    validateEarlierBeatReferences(issues, evidenceFrom, beatId, `${path}.evidence_from_beat_ids`, beatById, beatOrder);

    const keyEvidenceIds = strings(beat.keyEvidenceIds ?? beat.key_evidence_ids);
    if (["proof", "turning_point", "payoff"].includes(storyFunction) && !keyEvidenceIds.length) {
      issue(issues, "EVIDENCE_REGISTRY_MISSING", `${path}.key_evidence_ids`, `${beatId} 缺少可见证据。`, "注册并引用画面中真实可见的 evidence_id。", { beatId });
    }
    for (const evidenceId of keyEvidenceIds) {
      const item = evidenceById.get(evidenceId);
      if (!item) {
        issue(issues, "EVIDENCE_REFERENCE_INVALID", `${path}.key_evidence_ids`, `${beatId} 引用了未注册证据 ${evidenceId}。`, "在 evidence_registry 中定义该证据。", { beatId });
        continue;
      }
      const visibleSegments = new Set(numbers(item.visibleInSegmentNos ?? item.visible_in_segment_nos));
      if (!targetSegments.some((segmentNo) => visibleSegments.has(segmentNo))) {
        issue(issues, "EVIDENCE_NOT_VISIBLE", `${path}.key_evidence_ids`, `证据 ${evidenceId} 未安排在 ${beatId} 的目标片段中展示。`, "让证据至少在该 beat 的一个 target segment 中可见。", { beatId });
      }
      const introducedBy = text(item.introducedByBeatId ?? item.introduced_by_beat_id);
      if ((beatOrder.get(introducedBy) ?? Number.POSITIVE_INFINITY) > (beatOrder.get(beatId) ?? 0)) {
        issue(issues, "EVIDENCE_INTRODUCTION_NOT_EARLIER", `${path}.key_evidence_ids`, `证据 ${evidenceId} 在 ${beatId} 之后才被引入。`, "把证据安排到当前 beat 或更早 beat 的可见画面中。", { beatId });
      }
    }

    const resolvesConflict = text(beat.resolvesConflictBeatId ?? beat.resolves_conflict_beat_id);
    if (resolvesConflict) {
      validateEarlierBeatReferences(issues, [resolvesConflict], beatId, `${path}.resolves_conflict_beat_id`, beatById, beatOrder);
      if (beatFunction.get(resolvesConflict) !== "conflict") {
        issue(issues, "CONFLICT_RESOLUTION_INVALID", `${path}.resolves_conflict_beat_id`, `${beatId} 引用的 ${resolvesConflict} 不是 conflict。`, "引用一个更早的 conflict beat。", { beatId });
      }
    }

    if (storyFunction === "payoff") {
      const priorTriggerIds = unique([...dependencies, ...evidenceFrom]);
      const hasTrigger = priorTriggerIds.some((id) => ["turning_point", "proof"].includes(beatFunction.get(id) ?? ""));
      if (!hasTrigger || !evidenceFrom.length) {
        issue(issues, "PAYOFF_TRIGGER_MISSING", path, `${beatId} 的 payoff 没有明确依赖更早的 turning_point/proof。`, "在 depends_on_beat_ids 和 evidence_from_beat_ids 中引用更早的触发或证明节拍。", { beatId });
      }
    }
    if (storyFunction === "cta") {
      const hasBenefit = dependencies.some((id) => ["proof", "payoff", "reaction"].includes(beatFunction.get(id) ?? ""));
      if (!hasBenefit) {
        issue(issues, "CTA_BENEFIT_DEPENDENCY_MISSING", `${path}.depends_on_beat_ids`, `${beatId} 的 CTA 没有依赖更早的 proof/payoff/reaction。`, "让 CTA 明确引用已经建立价值的更早节拍。", { beatId });
      }
    }
  }

  const briefBySegment = new Map<number, JsonRecord>();
  for (const [index, brief] of briefs.entries()) {
    const segmentNo = number(brief.segmentNo ?? brief.segment_no);
    if (segmentNo) briefBySegment.set(segmentNo, brief);
    for (const beatId of strings(brief.linkedBeatIds ?? brief.linked_beat_ids)) {
      if (!beatById.has(beatId)) {
        issue(issues, "STORYBOARD_BEAT_REFERENCE_INVALID", `storyboard_brief[${index}].linked_beat_ids`, `片段 ${segmentNo} 引用了不存在的 beat ${beatId}。`, "只引用 story_beats 中存在的 beat_id。", { beatId, segmentNo });
      }
    }
  }
  for (const segmentNo of validSegmentNos) {
    const brief = briefBySegment.get(segmentNo);
    if (!brief) {
      issue(issues, "STORYBOARD_SEGMENT_MISSING", "storyboard_brief", `缺少 segment ${segmentNo} 的 storyboard_brief。`, "为每个规划片段生成一条 storyboard_brief。", { segmentNo });
    } else if (!strings(brief.linkedBeatIds ?? brief.linked_beat_ids).length) {
      issue(issues, "STORYBOARD_BEAT_REFERENCE_INVALID", `storyboard_brief[segment=${segmentNo}].linked_beat_ids`, `片段 ${segmentNo} 没有关联剧情节拍。`, "至少引用一个真实 beat_id。", { segmentNo });
    }
  }

  const invalidReferenceCount = issues.filter((item) =>
    item.code.includes("REFERENCE_INVALID") || item.code.includes("DEPENDENCY_")).length;
  return {
    passed: issues.length === 0,
    issues,
    metrics: {
      beatCount: beats.length,
      evidenceCount: evidence.length,
      invalidReferenceCount,
      requiredFunctionCount: requiredFunctions.length,
    },
    contractVersion: "story-contract-v1",
  };
}

function validateEarlierBeatReferences(
  issues: StoryContractIssue[],
  references: string[],
  beatId: string,
  path: string,
  beatById: Map<string, JsonRecord>,
  beatOrder: Map<string, number>,
): void {
  for (const reference of references) {
    if (!beatById.has(reference)) {
      issue(issues, "BEAT_DEPENDENCY_INVALID", path, `${beatId} 引用了不存在的前置节拍 ${reference}。`, "只引用 story_beats 中存在的 beat_id。", { beatId });
    } else if ((beatOrder.get(reference) ?? 0) >= (beatOrder.get(beatId) ?? 0)) {
      issue(issues, "BEAT_DEPENDENCY_NOT_EARLIER", path, `${beatId} 引用的 ${reference} 不是更早节拍。`, "因果依赖只能指向 order 更小的 beat。", { beatId });
    }
  }
}

function issue(
  issues: StoryContractIssue[],
  code: StoryContractIssueCode,
  path: string,
  messageZh: string,
  repairHint: string,
  context: Pick<StoryContractIssue, "beatId" | "segmentNo"> = {},
): void {
  issues.push({ code, path, messageZh, repairHint, ...context });
}

function record(value: unknown): JsonRecord {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}
function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((item): item is JsonRecord => Object.keys(record(item)).length > 0) : [];
}
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}
function strings(value: unknown): string[] {
  return unique(Array.isArray(value) ? value.map(text).filter(Boolean) : []);
}
function numbers(value: unknown): number[] {
  return unique(Array.isArray(value) ? value.map(number).filter(Boolean) : []);
}
function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
