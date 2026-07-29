import assert from "node:assert/strict";
import test from "node:test";

import { adjudicateConsistencyAnchorCandidates } from "./anchor-admission";
import type { NarrativeEvent, VideoConsistencyAnchor } from "./types";

function anchor(
  id: string,
  type: VideoConsistencyAnchor["type"],
  overrides: Partial<VideoConsistencyAnchor> = {},
): VideoConsistencyAnchor {
  return {
    id,
    type,
    displayNameZh: id,
    mustStayConsistent: true,
    needsReferenceImage: true,
    ...overrides,
  };
}

function event(
  eventId: string,
  requiredAnchorIds: string[],
  overrides: Partial<NarrativeEvent> = {},
): NarrativeEvent {
  return {
    eventId,
    dramaticGoal: "",
    participants: [],
    locationId: "",
    initialState: "",
    action: "",
    resultingState: "",
    requiredAnchorIds,
    previousEventIds: [],
    mustBecomeSeparateSegment: true,
    ...overrides,
  };
}

test("single-use decorative leaves are demoted to an event-local element", () => {
  const result = adjudicateConsistencyAnchorCandidates({
    anchors: [anchor("green_leaves", "prop", {
      displayNameZh: "绿叶装饰",
      candidateCategory: "decoration",
    })],
    narrativeEvents: [
      event("event_1", []),
      event("event_2", ["green_leaves"]),
    ],
    userPrompt: "高潮画面中有绿色叶片飞过",
  });

  assert.deepEqual(result.approvedAnchors, []);
  assert.equal(result.eventLocalElements.length, 1);
  assert.equal(result.eventLocalElements[0]?.eventId, "event_2");
  assert.equal(result.decisions[0]?.rule, "SINGLE_USE_DECORATION");
});

test("model-provided reuse_count is ignored and recomputed from events", () => {
  const result = adjudicateConsistencyAnchorCandidates({
    anchors: [anchor("sparkles", "effect_state", {
      reuseCount: 99,
      usedByEventIds: ["fake_1", "fake_2"],
    })],
    narrativeEvents: [event("event_1", ["sparkles"])],
    userPrompt: "结尾增加粒子光效",
  });

  assert.equal(result.decisions[0]?.usedByEventIds.length, 1);
  assert.equal(result.decisions[0]?.status, "event_local");
});

test("core subjects and cross-event props are approved", () => {
  const result = adjudicateConsistencyAnchorCandidates({
    anchors: [
      anchor("bull", "person"),
      anchor("cards", "prop"),
    ],
    narrativeEvents: [
      event("event_1", ["bull", "cards"]),
      event("event_2", ["bull", "cards"]),
    ],
    userPrompt: "公牛进行一局扑克牌游戏",
  });

  assert.deepEqual(result.approvedAnchors.map((item) => item.id), ["bull", "cards"]);
  assert.equal(result.approvedAnchors[0]?.reuseCount, 2);
  assert.equal(result.approvedAnchors[1]?.admissionRule, "CROSS_EVENT_REUSE");
});

test("persistent physical scenes are approved while unused candidates are discarded", () => {
  const result = adjudicateConsistencyAnchorCandidates({
    anchors: [
      anchor("studio", "space_layout"),
      anchor("unused_bg", "graphic_backdrop"),
    ],
    narrativeEvents: [
      event("event_1", [], { locationId: "studio" }),
      event("event_2", [], { locationId: "studio" }),
    ],
    userPrompt: "摄影棚中的牌桌游戏",
  });

  assert.deepEqual(result.approvedAnchors.map((item) => item.id), ["studio"]);
  assert.equal(result.approvedAnchors[0]?.admissionRule, "PERSISTENT_SCENE");
  assert.deepEqual(result.discardedAnchorIds, ["unused_bg"]);
});

test("a one-off element is approved only when exact continuity is explicitly required", () => {
  const result = adjudicateConsistencyAnchorCandidates({
    anchors: [anchor("special_leaf", "prop", {
      displayNameZh: "特殊叶片",
      candidateCategory: "decoration",
      sourceEvidence: [{
        source: "user_requirement",
        text: "必须保持特殊叶片的缺口形状完全一致",
      }],
    })],
    narrativeEvents: [event("event_1", ["special_leaf"])],
    userPrompt: "必须保持特殊叶片的缺口形状完全一致",
  });

  assert.deepEqual(result.approvedAnchors.map((item) => item.id), ["special_leaf"]);
  assert.equal(result.approvedAnchors[0]?.admissionRule, "USER_REQUIREMENT");
});
