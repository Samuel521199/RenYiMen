import assert from "node:assert/strict";
import { test } from "node:test";
import { validateStoryboardStoryContract } from "./story-contract-gate";

function validPlan(): Record<string, unknown> {
  const beat = (
    beatId: string,
    order: number,
    storyFunction: string,
    dependsOnBeatIds: string[],
    extra: Record<string, unknown> = {},
  ) => ({
    beat_id: beatId,
    order,
    story_function: storyFunction,
    cause: `cause ${order}`,
    effect: `effect ${order}`,
    information_unit: `information ${order}`,
    depends_on_beat_ids: dependsOnBeatIds,
    evidence_from_beat_ids: [],
    key_evidence_ids: [],
    source_event_ids: ["event_1"],
    target_segment_nos: [1],
    ...extra,
  });
  return {
    story_beats: [
      beat("beat_hook", 1, "hook", []),
      beat("beat_conflict", 2, "conflict", ["beat_hook"]),
      beat("beat_proof", 3, "proof", ["beat_conflict"], { key_evidence_ids: ["proof_visible"] }),
      beat("beat_payoff", 4, "payoff", ["beat_proof"], {
        evidence_from_beat_ids: ["beat_proof"],
        resolves_conflict_beat_id: "beat_conflict",
        key_evidence_ids: ["proof_visible"],
      }),
      beat("beat_cta", 5, "cta", ["beat_payoff"]),
    ],
    evidence_registry: [{
      evidence_id: "proof_visible",
      description: "Observable result",
      introduced_by_beat_id: "beat_proof",
      visible_in_segment_nos: [1],
    }],
    storyboard_brief: [{
      segment_no: 1,
      linked_beat_ids: ["beat_hook", "beat_conflict", "beat_proof", "beat_payoff", "beat_cta"],
    }],
  };
}

test("story contract accepts a valid causal graph", () => {
  const report = validateStoryboardStoryContract({
    storyboardArtistPlan: validPlan(),
    templateId: "generic_brand_story",
    validEventIds: ["event_1"],
    validSegmentNos: [1],
  });
  assert.equal(report.passed, true, JSON.stringify(report.issues, null, 2));
  assert.equal(report.metrics.invalidReferenceCount, 0);
});

test("story contract rejects fake, forward, and invisible references", () => {
  const plan = validPlan();
  const beats = plan.story_beats as Array<Record<string, unknown>>;
  beats[3].depends_on_beat_ids = ["missing_beat"];
  beats[3].evidence_from_beat_ids = ["beat_cta"];
  beats[3].key_evidence_ids = ["missing_evidence"];
  const report = validateStoryboardStoryContract({
    storyboardArtistPlan: plan,
    templateId: "generic_brand_story",
    validEventIds: ["event_1"],
    validSegmentNos: [1],
  });
  assert.equal(report.passed, false);
  const codes = new Set(report.issues.map((issue) => issue.code));
  assert.equal(codes.has("BEAT_DEPENDENCY_INVALID"), true);
  assert.equal(codes.has("BEAT_DEPENDENCY_NOT_EARLIER"), true);
  assert.equal(codes.has("EVIDENCE_REFERENCE_INVALID"), true);
  assert.equal(codes.has("PAYOFF_TRIGGER_MISSING"), true);
});

