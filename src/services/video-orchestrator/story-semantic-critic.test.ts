import assert from "node:assert/strict";
import test from "node:test";
import {
  isBlockingStorySemanticIssue,
  normalizeStorySemanticReview,
} from "./story-semantic-critic.ts";

test("semantic critic accepts an evidence-backed high-confidence error as blocking", () => {
  const review = normalizeStorySemanticReview({
    dimension_scores: { hook_strength: 2, causal_coherence: 3 },
    issues: [{
      code: "HOOK_TOO_GENERIC",
      severity: "error",
      confidence: 0.9,
      dimension: "hook_strength",
      claim_zh: "开场没有形成具体悬念。",
      evidence_event_ids: ["event_1"],
      evidence_beat_ids: ["beat_1"],
      why_it_hurts_zh: "观众没有继续观看的理由。",
      repair_instruction_zh: "增加可见但未兑现的目标。",
      rewrite_from_stage: "beat_sheet",
    }],
    strengths: [],
    summary_zh: "需要修复开场。",
  }, {
    validEventIds: ["event_1"],
    validBeatIds: ["beat_1"],
    modelName: "critic-test",
  });

  assert.equal(review.passed, false);
  assert.deepEqual(review.blockingIssueCodes, ["HOOK_TOO_GENERIC"]);
  assert.equal(isBlockingStorySemanticIssue(review.issues[0]), true);
  assert.equal(review.dimensionScores.hook_strength, 2);
});

test("semantic critic cannot block with invented or missing evidence", () => {
  const review = normalizeStorySemanticReview({
    dimension_scores: { payoff_strength: 9 },
    issues: [
      {
        code: "INVENTED_REFERENCE",
        severity: "error",
        confidence: 0.99,
        dimension: "payoff_strength",
        claim_zh: "引用了不存在的剧情。",
        evidence_event_ids: ["event_999"],
        evidence_beat_ids: ["beat_999"],
        rewrite_from_stage: "storyboard",
      },
      {
        code: "NO_EVIDENCE",
        severity: "error",
        confidence: 0.99,
        dimension: "payoff_strength",
        claim_zh: "没有证据。",
        evidence_event_ids: [],
        evidence_beat_ids: [],
        rewrite_from_stage: "storyboard",
      },
    ],
    strengths: [],
    summary_zh: "",
  }, {
    validEventIds: ["event_1"],
    validBeatIds: ["beat_1"],
  });

  assert.equal(review.passed, true);
  assert.deepEqual(review.blockingIssueCodes, []);
  assert.equal(review.issues.every((issue) => issue.severity === "warning"), true);
  assert.deepEqual(review.invalidEvidenceReferences, [
    "issues[0].event:event_999",
    "issues[0].beat:beat_999",
  ]);
  assert.equal(review.dimensionScores.payoff_strength, 5);
});

test("low-confidence semantic criticism remains advisory", () => {
  const review = normalizeStorySemanticReview({
    issues: [{
      code: "SUBJECTIVE_ORIGINALITY",
      severity: "error",
      confidence: 0.5,
      dimension: "originality",
      claim_zh: "创意较常见。",
      evidence_event_ids: ["event_1"],
      evidence_beat_ids: [],
      rewrite_from_stage: "creative_strategy",
    }],
  }, {
    validEventIds: ["event_1"],
    validBeatIds: [],
  });

  assert.equal(review.passed, true);
  assert.equal(review.issues[0].severity, "error");
  assert.equal(isBlockingStorySemanticIssue(review.issues[0]), false);
});
