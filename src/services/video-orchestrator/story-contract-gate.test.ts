import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validatePlanningNarrativeContract,
  validateStoryboardStoryContract,
} from "./story-contract-gate";

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

test("planning narrative contract accepts chronological event bindings", () => {
  const report = validatePlanningNarrativeContract({
    creativeStrategy: {
      chronologyMode: "chronological",
      hookMode: "pain_point",
      hookRevealLevel: "partial",
      hook: "The timer is almost empty and the player still needs one match.",
      conflict: "The ordinary move fails.",
      turningPoint: "A visible operation triggers the double bonus.",
      payoff: "The player clears the level.",
      cta: "Download now.",
      hookEventIds: ["event_1"],
      conflictEventIds: ["event_2"],
      turningPointEventIds: ["event_3"],
      payoffEventIds: ["event_4"],
      ctaEventIds: ["event_5"],
    },
    narrativeEvents: Array.from({ length: 5 }, (_, index) => ({
      eventId: `event_${index + 1}`,
      dramaticGoal: `goal ${index + 1}`,
      participants: ["main_character"],
      locationId: "game_room",
      initialState: `start ${index + 1}`,
      action: `action ${index + 1}`,
      resultingState: `result ${index + 1}`,
      requiredAnchorIds: ["main_character"],
      previousEventIds: index ? [`event_${index}`] : [],
      mustBecomeSeparateSegment: true,
    })),
    timelineSegments: Array.from({ length: 5 }, (_, index) => ({
      segmentNo: index + 1,
      startTimeSeconds: index * 6,
      endTimeSeconds: (index + 1) * 6,
      durationSeconds: 6,
      beatRole: index === 0 ? "hook" : "custom",
      purposeZh: `purpose ${index + 1}`,
      purposeEn: "",
      splitReasonZh: "",
      subtitleIntentZh: "",
      audioIntentZh: "",
      requiredAnchorIds: ["main_character"],
      sourceEventIds: [`event_${index + 1}`],
      boundaryModeHint: "continuous",
    })),
  });
  assert.equal(report.passed, true, JSON.stringify(report.issues, null, 2));
});

test("planning narrative contract rejects Color Blitz hook leaking the turning point", () => {
  const report = validatePlanningNarrativeContract({
    creativeStrategy: {
      chronologyMode: "chronological",
      hookMode: "payoff_preview",
      hookRevealLevel: "full",
      hookZh: "普通玩家专注游戏，突然屏幕闪现 Double Up Bonus 特效。",
      turningPointZh: "玩家触发 Double Up Bonus，得分翻倍。",
      hookEventIds: ["event_3"],
      turningPointEventIds: ["event_3"],
    },
    narrativeEvents: [
      {
        eventId: "event_1",
        dramaticGoal: "建立游戏压力",
        participants: ["main_character"],
        locationId: "game_room",
        initialState: "普通关卡",
        action: "玩家尝试匹配",
        resultingState: "仍未突破",
        requiredAnchorIds: ["main_character"],
        previousEventIds: [],
        mustBecomeSeparateSegment: true,
      },
      {
        eventId: "event_3",
        dramaticGoal: "触发双倍奖励",
        participants: ["main_character"],
        locationId: "game_room",
        initialState: "即将失败",
        action: "触发 Double Up Bonus",
        resultingState: "得分翻倍",
        requiredAnchorIds: ["main_character"],
        previousEventIds: ["event_1"],
        mustBecomeSeparateSegment: true,
      },
    ],
    timelineSegments: [
      {
        segmentNo: 1,
        startTimeSeconds: 0,
        endTimeSeconds: 6,
        durationSeconds: 6,
        beatRole: "hook",
        purposeZh: "建立压力",
        purposeEn: "",
        splitReasonZh: "",
        subtitleIntentZh: "",
        audioIntentZh: "",
        requiredAnchorIds: ["main_character"],
        sourceEventIds: ["event_1"],
        boundaryModeHint: "continuous",
      },
      {
        segmentNo: 2,
        startTimeSeconds: 6,
        endTimeSeconds: 12,
        durationSeconds: 6,
        beatRole: "custom",
        purposeZh: "触发奖励",
        purposeEn: "",
        splitReasonZh: "",
        subtitleIntentZh: "",
        audioIntentZh: "",
        requiredAnchorIds: ["main_character"],
        sourceEventIds: ["event_3"],
        boundaryModeHint: "continuous",
      },
    ],
  });
  assert.equal(report.passed, false);
  const codes = new Set(report.issues.map((item) => item.code));
  assert.equal(codes.has("HOOK_TURNING_POINT_EVENT_OVERLAP"), true);
  assert.equal(codes.has("CHRONOLOGICAL_HOOK_FULL_REVEAL"), true);
});

test("planning narrative contract allows an explicit flashforward with a return event", () => {
  const report = validatePlanningNarrativeContract({
    creativeStrategy: {
      chronologyMode: "flashforward_hook",
      hookMode: "payoff_preview",
      hookRevealLevel: "full",
      hook: "A one-second preview shows the double reward.",
      turningPoint: "The chronological story later reaches the double reward.",
      hookEventIds: ["event_3"],
      turningPointEventIds: ["event_3"],
      returnToEventId: "event_1",
    },
    narrativeEvents: [
      {
        eventId: "event_1",
        dramaticGoal: "Return to the initial pressure",
        participants: [],
        locationId: "game_room",
        initialState: "ordinary play",
        action: "timer counts down",
        resultingState: "pressure rises",
        requiredAnchorIds: [],
        previousEventIds: [],
        mustBecomeSeparateSegment: true,
      },
      {
        eventId: "event_3",
        dramaticGoal: "Preview and later deliver the turn",
        participants: [],
        locationId: "game_room",
        initialState: "near failure",
        action: "bonus triggers",
        resultingState: "score doubles",
        requiredAnchorIds: [],
        previousEventIds: ["event_1"],
        mustBecomeSeparateSegment: true,
      },
    ],
    timelineSegments: [
      {
        segmentNo: 1,
        startTimeSeconds: 0,
        endTimeSeconds: 6,
        durationSeconds: 6,
        beatRole: "hook",
        purposeZh: "",
        purposeEn: "",
        splitReasonZh: "",
        subtitleIntentZh: "",
        audioIntentZh: "",
        requiredAnchorIds: [],
        sourceEventIds: ["event_1", "event_3"],
        boundaryModeHint: "hard_cut",
      },
    ],
  });
  assert.equal(report.passed, true, JSON.stringify(report.issues, null, 2));
});
