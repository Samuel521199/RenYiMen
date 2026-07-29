import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCreativeStrategyPatches,
  applyEventAuthorityToCreativeStrategy,
  creativeStrategyBindingFingerprint,
  deterministicLegacyOrderFallback,
  materializeNarrativeEventStoryFunctions,
  planningContractIssueFingerprint,
  shouldEscalatePlanningContractRepair,
  type PlanningContractRepairAttempt,
} from "./planning-narrative-authority.ts";
import { validatePlanningNarrativeContract } from "./story-contract-gate.ts";
import type {
  NarrativeEvent,
  VideoCreativeStrategy,
  VideoTimelineBlueprintSegment,
} from "./types.ts";

function event(eventId: string): NarrativeEvent {
  return {
    eventId,
    storyFunctions: [],
    dramaticGoal: eventId,
    participants: [],
    locationId: "room",
    initialState: "before",
    action: "visible action",
    resultingState: "after",
    requiredAnchorIds: [],
    previousEventIds: [],
    mustBecomeSeparateSegment: true,
  };
}

const timeline: VideoTimelineBlueprintSegment[] = [
  {
    segmentNo: 1,
    startTimeSeconds: 0,
    endTimeSeconds: 3,
    durationSeconds: 3,
    sourceEventIds: ["event_1"],
    requiredAnchorIds: [],
  },
  {
    segmentNo: 2,
    startTimeSeconds: 3,
    endTimeSeconds: 6,
    durationSeconds: 3,
    sourceEventIds: ["event_2"],
    requiredAnchorIds: [],
  },
];

test("legacy strategy bindings migrate once into event story-function authority", () => {
  const strategy: VideoCreativeStrategy = {
    chronologyMode: "chronological",
    conflictEventIds: ["event_1"],
    turningPointEventIds: ["event_2"],
  };
  const materialized = materializeNarrativeEventStoryFunctions(
    [event("event_1"), event("event_2")],
    strategy,
  );
  assert.equal(materialized.authority, "legacy_migrated");
  assert.deepEqual(materialized.events[0]?.storyFunctions, ["conflict"]);
  assert.deepEqual(materialized.events[1]?.storyFunctions, ["turning_point"]);
  assert.deepEqual(
    applyEventAuthorityToCreativeStrategy({}, materialized.events),
    {
      hookEventIds: [],
      conflictEventIds: ["event_1"],
      turningPointEventIds: ["event_2"],
      payoffEventIds: [],
      ctaEventIds: [],
    },
  );
});

test("declared event roles override drifted creative-strategy bindings", () => {
  const events = [
    { ...event("event_1"), storyFunctions: ["conflict" as const] },
    { ...event("event_2"), storyFunctions: ["turning_point" as const] },
  ];
  const strategy = applyEventAuthorityToCreativeStrategy({
    chronologyMode: "chronological",
    conflictEventIds: ["event_2"],
    turningPointEventIds: ["event_1"],
  }, events);
  assert.deepEqual(strategy.conflictEventIds, ["event_1"]);
  assert.deepEqual(strategy.turningPointEventIds, ["event_2"]);
  assert.equal(validatePlanningNarrativeContract({
    creativeStrategy: strategy,
    narrativeEvents: events,
    timelineSegments: timeline,
  }).passed, true);
});

test("creative-strategy repair accepts only whitelisted patches and real event IDs", () => {
  const result = applyCreativeStrategyPatches({
    strategy: { conflictEventIds: ["event_2"] },
    validEventIds: ["event_1", "event_2"],
    patches: [
      { op: "replace", path: "/conflict_event_ids", value: ["event_1"] },
      { op: "replace", path: "/template_id", value: "generic_brand_story" },
      { op: "replace", path: "/payoff_event_ids", value: ["invented_event"] },
    ],
  });
  assert.deepEqual(result.strategy.conflictEventIds, ["event_1"]);
  assert.deepEqual(result.rejectedPaths.sort(), ["/payoff_event_ids", "/template_id"]);
});

test("pure legacy order reversal has a deterministic bounded fallback", () => {
  const events = [event("event_1"), event("event_2")];
  const strategy: VideoCreativeStrategy = {
    chronologyMode: "chronological",
    conflictEventIds: ["event_2"],
    turningPointEventIds: ["event_1"],
  };
  const report = validatePlanningNarrativeContract({
    creativeStrategy: strategy,
    narrativeEvents: events,
    timelineSegments: timeline,
  });
  const fallback = deterministicLegacyOrderFallback(strategy, events, report.issues);
  assert.ok(fallback);
  assert.deepEqual(fallback.strategy.conflictEventIds, ["event_1"]);
  assert.deepEqual(fallback.strategy.turningPointEventIds, ["event_2"]);
});

test("unchanged issue and binding fingerprints escalate instead of repeating repair", () => {
  const events = [event("event_1"), event("event_2")];
  const strategy: VideoCreativeStrategy = {
    chronologyMode: "chronological",
    conflictEventIds: ["event_2"],
    turningPointEventIds: ["event_1"],
  };
  const report = validatePlanningNarrativeContract({
    creativeStrategy: strategy,
    narrativeEvents: events,
    timelineSegments: timeline,
  });
  const previous: PlanningContractRepairAttempt = {
    attempt: 1,
    mode: "binding_patch",
    issueFingerprint: planningContractIssueFingerprint(report),
    bindingFingerprintBefore: creativeStrategyBindingFingerprint(strategy),
    bindingFingerprintAfter: creativeStrategyBindingFingerprint(strategy),
    issueCountBefore: report.issues.length,
    issueCountAfter: report.issues.length,
    changedPaths: [],
    issues: report.issues,
    createdAt: new Date(0).toISOString(),
  };
  assert.equal(shouldEscalatePlanningContractRepair(previous, report, strategy), true);
});
