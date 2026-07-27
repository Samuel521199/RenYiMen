import type {
  VideoStorySemanticDimension,
  VideoStorySemanticIssue,
  VideoStorySemanticReview,
  VideoStorySemanticStrength,
} from "./types";

export const STORY_SEMANTIC_CRITIC_SYSTEM_PROMPT = `You are Semantic Story Critic for a controllable AI video pipeline.

Return only valid JSON. Do not rewrite the story.

Evaluate whether the existing story is persuasive, causally understandable, emotionally effective, visually tellable, and aligned with the user's audience and conversion goal. Structural completeness alone is not quality.

Review dimensions:
- audience_fit
- hook_strength
- conflict_clarity
- causal_coherence
- escalation
- turning_point_quality
- payoff_strength
- emotional_progression
- selling_point_proof
- cta_fit
- reference_transformation
- visual_storytelling
- originality

Rules:
- Every issue must cite at least one existing event_id or beat_id as evidence.
- Never invent IDs. If evidence is insufficient, do not issue an error.
- Use severity=error only for a high-confidence defect that materially breaks comprehension, persuasion, causal payoff, or the user's conversion goal.
- Subjective taste, novelty, humor, and stylistic preferences are warnings, never errors.
- Distinguish a declared dependency from an effective story: a CTA can reference payoff and still feel semantically unrelated.
- Check whether visible actions cause later results, whether escalation is earned, whether the turning point has a visible trigger, and whether payoff fulfills the opening promise.
- Check whether reference images are transformed into story assets rather than merely displayed or animated.
- Scores are integers from 1 to 5. Do not use false precision.
- Do not propose changes to duration, segment count, segment times, consistency anchors, or classification.

Return:
{
  "dimension_scores": {
    "audience_fit": 1,
    "hook_strength": 1,
    "conflict_clarity": 1,
    "causal_coherence": 1,
    "escalation": 1,
    "turning_point_quality": 1,
    "payoff_strength": 1,
    "emotional_progression": 1,
    "selling_point_proof": 1,
    "cta_fit": 1,
    "reference_transformation": 1,
    "visual_storytelling": 1,
    "originality": 1
  },
  "issues": [
    {
      "code": "HOOK_TOO_GENERIC",
      "severity": "warning | error",
      "confidence": 0.0,
      "dimension": "hook_strength",
      "claim_zh": "",
      "evidence_event_ids": [],
      "evidence_beat_ids": [],
      "why_it_hurts_zh": "",
      "repair_instruction_zh": "",
      "rewrite_from_stage": "creative_strategy | beat_sheet | storyboard"
    }
  ],
  "strengths": [
    {
      "claim_zh": "",
      "evidence_event_ids": [],
      "evidence_beat_ids": []
    }
  ],
  "summary_zh": ""
}`;

export const STORY_SEMANTIC_REPAIR_SYSTEM_PROMPT = `You are Semantic Story Repairer for a controllable AI video pipeline.

Return only valid JSON with one complete storyboard_artist_plan.

Repair only the semantic story defects supplied by the critic.

Hard preservation rules:
- Preserve classification, creative_strategy, narrative_events, planning_manifest, timeline segment count, segment numbers, segment times, consistency anchors, and source_event_ids.
- Preserve valid content not named by a critic issue.
- Do not invent event, beat, evidence, anchor, or segment IDs.
- Improve story_beats, evidence_registry, storyboard_brief, and directly dependent shot_grouping_pass only.
- Make visible causes precede effects.
- Give turning points visible triggers, payoffs observable fulfillment, and CTA a semantic bridge to an already proven benefit.
- Keep subjective originality/style suggestions conservative; never replace the user's concept just to satisfy taste.
- Return a complete plan, not a patch.

Return:
{
  "storyboard_artist_plan": {
    "story_beats": [],
    "evidence_registry": [],
    "storyboard_brief": [],
    "shot_grouping_pass": {}
  }
}`;

const DIMENSIONS: VideoStorySemanticDimension[] = [
  "audience_fit",
  "hook_strength",
  "conflict_clarity",
  "causal_coherence",
  "escalation",
  "turning_point_quality",
  "payoff_strength",
  "emotional_progression",
  "selling_point_proof",
  "cta_fit",
  "reference_transformation",
  "visual_storytelling",
  "originality",
];

const DIMENSION_SET = new Set<string>(DIMENSIONS);
const BLOCKING_CONFIDENCE = 0.75;

export function normalizeStorySemanticReview(
  value: unknown,
  params: {
    validEventIds: Iterable<string>;
    validBeatIds: Iterable<string>;
    modelName?: string;
    repairAttempts?: number;
  },
): VideoStorySemanticReview {
  const root = record(value);
  const validEventIds = new Set(params.validEventIds);
  const validBeatIds = new Set(params.validBeatIds);
  const invalidEvidenceReferences: string[] = [];
  const dimensionScores: Partial<Record<VideoStorySemanticDimension, number>> = {};
  const rawScores = record(root.dimension_scores ?? root.dimensionScores);
  for (const dimension of DIMENSIONS) {
    const score = Number(rawScores[dimension]);
    if (Number.isFinite(score)) dimensionScores[dimension] = Math.max(1, Math.min(5, Math.round(score)));
  }

  const issues = records(root.issues).map((item, index) => normalizeIssue(
    item,
    index,
    validEventIds,
    validBeatIds,
    invalidEvidenceReferences,
  ));
  const strengths = records(root.strengths).map((item) => normalizeStrength(
    item,
    validEventIds,
    validBeatIds,
    invalidEvidenceReferences,
  )).filter((item) => item.claimZh);
  const blockingIssueCodes = issues
    .filter(isBlockingStorySemanticIssue)
    .map((issue) => issue.code);

  return {
    passed: blockingIssueCodes.length === 0,
    dimensionScores,
    issues,
    strengths,
    summaryZh: text(root.summary_zh ?? root.summaryZh),
    blockingIssueCodes: unique(blockingIssueCodes),
    invalidEvidenceReferences: unique(invalidEvidenceReferences),
    repairAttempts: params.repairAttempts,
    modelName: params.modelName,
  };
}

export function isBlockingStorySemanticIssue(issue: VideoStorySemanticIssue): boolean {
  return issue.severity === "error"
    && issue.confidence >= BLOCKING_CONFIDENCE
    && (issue.evidenceEventIds.length > 0 || issue.evidenceBeatIds.length > 0);
}

function normalizeIssue(
  item: Record<string, unknown>,
  index: number,
  validEventIds: Set<string>,
  validBeatIds: Set<string>,
  invalidReferences: string[],
): VideoStorySemanticIssue {
  const rawEventIds = strings(item.evidence_event_ids ?? item.evidenceEventIds);
  const rawBeatIds = strings(item.evidence_beat_ids ?? item.evidenceBeatIds);
  const evidenceEventIds = rawEventIds.filter((id) => {
    if (validEventIds.has(id)) return true;
    invalidReferences.push(`issues[${index}].event:${id}`);
    return false;
  });
  const evidenceBeatIds = rawBeatIds.filter((id) => {
    if (validBeatIds.has(id)) return true;
    invalidReferences.push(`issues[${index}].beat:${id}`);
    return false;
  });
  const rawDimension = text(item.dimension);
  const dimension = (DIMENSION_SET.has(rawDimension) ? rawDimension : "causal_coherence") as VideoStorySemanticDimension;
  const requestedSeverity = text(item.severity) === "error" ? "error" : "warning";
  const hasEvidence = evidenceEventIds.length > 0 || evidenceBeatIds.length > 0;
  return {
    code: text(item.code) || `SEMANTIC_ISSUE_${index + 1}`,
    severity: requestedSeverity === "error" && hasEvidence ? "error" : "warning",
    confidence: clamp01(Number(item.confidence)),
    dimension,
    claimZh: text(item.claim_zh ?? item.claimZh),
    evidenceEventIds,
    evidenceBeatIds,
    whyItHurtsZh: text(item.why_it_hurts_zh ?? item.whyItHurtsZh),
    repairInstructionZh: text(item.repair_instruction_zh ?? item.repairInstructionZh),
    rewriteFromStage: normalizeRewriteStage(item.rewrite_from_stage ?? item.rewriteFromStage),
  };
}

function normalizeStrength(
  item: Record<string, unknown>,
  validEventIds: Set<string>,
  validBeatIds: Set<string>,
  invalidReferences: string[],
): VideoStorySemanticStrength {
  return {
    claimZh: text(item.claim_zh ?? item.claimZh),
    evidenceEventIds: strings(item.evidence_event_ids ?? item.evidenceEventIds).filter((id) => {
      if (validEventIds.has(id)) return true;
      invalidReferences.push(`strength.event:${id}`);
      return false;
    }),
    evidenceBeatIds: strings(item.evidence_beat_ids ?? item.evidenceBeatIds).filter((id) => {
      if (validBeatIds.has(id)) return true;
      invalidReferences.push(`strength.beat:${id}`);
      return false;
    }),
  };
}

function normalizeRewriteStage(value: unknown): VideoStorySemanticIssue["rewriteFromStage"] {
  const raw = text(value);
  return raw === "creative_strategy" || raw === "beat_sheet" ? raw : "storyboard";
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record).filter((item) => Object.keys(item).length > 0) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? unique(value.map(text).filter(Boolean))
    : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
