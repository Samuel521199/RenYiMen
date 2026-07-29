import type {
  NarrativeEvent,
  VideoConsistencyAnchor,
} from "./types";

export type AnchorAdmissionStatus = "approved" | "event_local" | "discarded";

export type AnchorAdmissionRule =
  | "USER_REQUIREMENT"
  | "CORE_SUBJECT"
  | "BRAND_OR_EXACT_MARKING"
  | "PERSISTENT_SCENE"
  | "CROSS_EVENT_REUSE"
  | "SINGLE_USE_DECORATION"
  | "SINGLE_USE_NON_CORE"
  | "UNUSED";

export interface VideoAnchorSourceEvidence {
  source: "user_requirement" | "reference_fact" | "narrative_event" | "planner";
  text: string;
  eventIds?: string[];
}

export interface VideoEventLocalElement {
  id: string;
  sourceAnchorId: string;
  eventId: string;
  description: string;
  reason: string;
}

export interface AnchorAdmissionDecision {
  anchorId: string;
  status: AnchorAdmissionStatus;
  rule: AnchorAdmissionRule;
  score: number;
  reason: string;
  usedByEventIds: string[];
}

export interface AnchorAdmissionResult {
  approvedAnchors: VideoConsistencyAnchor[];
  eventLocalElements: VideoEventLocalElement[];
  discardedAnchorIds: string[];
  decisions: AnchorAdmissionDecision[];
}

const CORE_TYPES = new Set<VideoConsistencyAnchor["type"]>([
  "person",
  "product",
  "brand_visual",
]);

const SCENE_TYPES = new Set<VideoConsistencyAnchor["type"]>([
  "location",
  "space_layout",
]);

const DECORATION_PATTERN =
  /\b(?:decoration|decorative|particle|particles|sparkle|sparkles|glow|bokeh|confetti|leaf|leaves|petal|petals|smoke|mist|flare|light streak)\b|装饰|粒子|光斑|散景|彩纸|绿叶|叶片|花瓣|烟雾|薄雾|光晕|光效/i;

const EXACT_LOCK_DIMENSIONS = new Set([
  "identity",
  "text",
  "typography",
  "logo",
  "markings",
  "structure",
  "geometry",
  "space_layout",
]);

const CONSISTENCY_REQUIREMENT_PATTERN =
  /\b(?:must|always|same|identical|consistent|fixed|locked|preserve|unchanged|exact)\b|必须|始终|同一|一致|固定|锁定|保持|不可改变|精确还原/i;

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function anchorText(anchor: VideoConsistencyAnchor): string {
  return [
    anchor.id,
    anchor.displayNameZh,
    anchor.displayNameEn,
    anchor.descriptionZh,
    anchor.descriptionEn,
  ].filter(Boolean).join(" ");
}

function normalizedTokens(anchor: VideoConsistencyAnchor): string[] {
  return unique([
    anchor.id,
    anchor.displayNameZh ?? "",
    anchor.displayNameEn ?? "",
  ].map((value) => value.trim().toLowerCase()).filter((value) => value.length >= 2));
}

function eventMentionsAnchor(event: NarrativeEvent, anchor: VideoConsistencyAnchor): boolean {
  if (event.requiredAnchorIds.includes(anchor.id) || event.locationId === anchor.id) return true;
  const eventText = [
    ...event.participants,
    event.locationId,
    event.dramaticGoal,
    event.initialState,
    event.action,
    event.resultingState,
  ].join(" ").toLowerCase();
  return normalizedTokens(anchor).some((token) => eventText.includes(token));
}

function sourceEvidence(anchor: VideoConsistencyAnchor): VideoAnchorSourceEvidence[] {
  return anchor.sourceEvidence ?? [];
}

function isExplicitUserRequirement(anchor: VideoConsistencyAnchor, userPrompt: string): boolean {
  if (sourceEvidence(anchor).some(
    (item) => item.source === "user_requirement" && CONSISTENCY_REQUIREMENT_PATTERN.test(item.text),
  )) return true;
  const prompt = userPrompt.toLowerCase();
  return CONSISTENCY_REQUIREMENT_PATTERN.test(prompt)
    && normalizedTokens(anchor).some((token) => prompt.includes(token));
}

function isExactCritical(anchor: VideoConsistencyAnchor): boolean {
  if (anchor.type === "brand_visual") return true;
  return (anchor.lockDimensions ?? []).some((item) => EXACT_LOCK_DIMENSIONS.has(item.toLowerCase()));
}

function isDecoration(anchor: VideoConsistencyAnchor): boolean {
  return anchor.type === "effect_state"
    || anchor.candidateCategory === "decoration"
    || DECORATION_PATTERN.test(anchorText(anchor));
}

function scoreAnchor(params: {
  anchor: VideoConsistencyAnchor;
  reuseCount: number;
  explicitUserRequirement: boolean;
  decoration: boolean;
}): number {
  let score = 0;
  if (CORE_TYPES.has(params.anchor.type)) score += 5;
  if (params.explicitUserRequirement) score += 5;
  if (params.anchor.type === "brand_visual" || params.anchor.type === "product") score += 5;
  if (SCENE_TYPES.has(params.anchor.type) && params.reuseCount >= 2) score += 4;
  score += Math.max(0, params.reuseCount - 1);
  if (params.reuseCount === 1) score -= 2;
  if (params.decoration) score -= 4;
  return score;
}

function describeAnchor(anchor: VideoConsistencyAnchor): string {
  return anchor.descriptionZh
    || anchor.descriptionEn
    || anchor.displayNameZh
    || anchor.displayNameEn
    || anchor.id;
}

/**
 * Converts model-proposed candidates into the authoritative registry.
 * Usage counts are always recomputed from normalized narrative events.
 */
export function adjudicateConsistencyAnchorCandidates(params: {
  anchors: VideoConsistencyAnchor[];
  narrativeEvents: NarrativeEvent[];
  userPrompt: string;
}): AnchorAdmissionResult {
  const approvedAnchors: VideoConsistencyAnchor[] = [];
  const eventLocalElements: VideoEventLocalElement[] = [];
  const discardedAnchorIds: string[] = [];
  const decisions: AnchorAdmissionDecision[] = [];

  for (const anchor of params.anchors) {
    const usedByEventIds = unique(params.narrativeEvents
      .filter((event) => eventMentionsAnchor(event, anchor))
      .map((event) => event.eventId));
    const reuseCount = usedByEventIds.length;
    const explicitUserRequirement = isExplicitUserRequirement(anchor, params.userPrompt);
    const decoration = isDecoration(anchor);
    const score = scoreAnchor({ anchor, reuseCount, explicitUserRequirement, decoration });

    let status: AnchorAdmissionStatus;
    let rule: AnchorAdmissionRule;
    let reason: string;

    if (reuseCount === 0 && !explicitUserRequirement) {
      status = "discarded";
      rule = "UNUSED";
      reason = "No narrative event uses this candidate.";
    } else if (decoration && reuseCount < 2 && !explicitUserRequirement) {
      status = "event_local";
      rule = "SINGLE_USE_DECORATION";
      reason = "Single-use decoration remains local to its narrative event.";
    } else if (explicitUserRequirement) {
      status = "approved";
      rule = "USER_REQUIREMENT";
      reason = "The user explicitly requires this element.";
    } else if (CORE_TYPES.has(anchor.type)) {
      status = "approved";
      rule = anchor.type === "brand_visual" ? "BRAND_OR_EXACT_MARKING" : "CORE_SUBJECT";
      reason = "Core identity, product, or brand subject.";
    } else if (isExactCritical(anchor)) {
      status = "approved";
      rule = "BRAND_OR_EXACT_MARKING";
      reason = "Exact text, marking, identity, structure, or geometry is outcome-critical.";
    } else if (SCENE_TYPES.has(anchor.type) && reuseCount >= 2) {
      status = "approved";
      rule = "PERSISTENT_SCENE";
      reason = "Physical scene or layout persists across narrative events.";
    } else if (reuseCount >= 2) {
      status = "approved";
      rule = "CROSS_EVENT_REUSE";
      reason = "The element is reused across narrative events.";
    } else {
      status = "event_local";
      rule = "SINGLE_USE_NON_CORE";
      reason = "Single-use non-core element does not require cross-shot identity locking.";
    }

    decisions.push({
      anchorId: anchor.id,
      status,
      rule,
      score,
      reason,
      usedByEventIds,
    });

    if (status === "approved") {
      approvedAnchors.push({
        ...anchor,
        usedByEventIds,
        reuseCount,
        admissionReason: reason,
        admissionRule: rule,
        admissionScore: score,
        status,
      });
      continue;
    }

    if (status === "discarded") {
      discardedAnchorIds.push(anchor.id);
      continue;
    }

    for (const eventId of usedByEventIds) {
      eventLocalElements.push({
        id: `local_${anchor.id}_${eventId}`,
        sourceAnchorId: anchor.id,
        eventId,
        description: describeAnchor(anchor),
        reason,
      });
    }
  }

  return {
    approvedAnchors,
    eventLocalElements,
    discardedAnchorIds,
    decisions,
  };
}
