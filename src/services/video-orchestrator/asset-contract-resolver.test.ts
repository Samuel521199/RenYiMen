import assert from "node:assert/strict";
import test from "node:test";
import { resolveAssetContract } from "./asset-contract-resolver.ts";
import type { NarrativeEvent, VideoPlanningManifest } from "./types.ts";

const manifest: VideoPlanningManifest = {
  timelineBlueprint: {
    segmentCount: 1,
    totalDurationSeconds: 6,
    segmentDurationMinSeconds: 2,
    segmentDurationMaxSeconds: 10,
    segments: [{
      segmentNo: 1,
      startTimeSeconds: 0,
      endTimeSeconds: 6,
      durationSeconds: 6,
      requiredAnchorIds: ["character_main"],
      sourceEventIds: ["event_1"],
    }],
  },
  consistencyManifest: {
    anchors: [{
      id: "character_main",
      type: "person",
      displayNameZh: "主角",
      mustStayConsistent: true,
      needsReferenceImage: true,
      referenceStrength: "hard",
    }],
  },
};

const events: NarrativeEvent[] = [{
  eventId: "event_1",
  dramaticGoal: "show the action",
  participants: ["character_main"],
  locationId: "room",
  initialState: "ready",
  action: "acts",
  resultingState: "done",
  requiredAnchorIds: ["character_main"],
  previousEventIds: [],
  mustBecomeSeparateSegment: true,
}];

test("an explicit empty model declaration cannot erase deterministic anchor inheritance", () => {
  const result = resolveAssetContract({
    planningManifest: manifest,
    narrativeEvents: events,
    storyboardArtistPlan: {
      story_beats: [{ beat_id: "beat_1", source_event_ids: ["event_1"], target_segment_nos: [1], required_anchor_ids: [] }],
      storyboard_brief: [{ segment_no: 1, linked_beat_ids: ["beat_1"], required_anchor_ids: [] }],
    },
  });
  assert.deepEqual(result.contract.beatTargets[0]?.declaredAnchorIds, []);
  assert.deepEqual(result.contract.beatTargets[0]?.derivedAnchorIds, ["character_main"]);
  assert.deepEqual(result.contract.segmentTargets[0]?.effectiveRequiredAnchorIds, ["character_main"]);
  assert.deepEqual(result.contract.boundaryTargets.map((item) => item.effectiveRequiredAnchorIds), [["character_main"], ["character_main"]]);
});

test("only a justified explicit exclusion can remove a derived anchor", () => {
  const result = resolveAssetContract({
    planningManifest: manifest,
    narrativeEvents: events,
    storyboardArtistPlan: {
      story_beats: [{
        beat_id: "beat_1",
        source_event_ids: ["event_1"],
        target_segment_nos: [1],
        anchor_exclusions: [{
          anchor_id: "character_main",
          visibility: "offscreen",
          reason: "The character remains offscreen for this reaction insert.",
        }],
      }],
      storyboard_brief: [{ segment_no: 1, linked_beat_ids: ["beat_1"] }],
    },
  });
  assert.deepEqual(result.contract.beatTargets[0]?.effectiveRequiredAnchorIds, []);
  assert.equal(result.contract.beatTargets[0]?.excludedAnchors[0]?.valid, true);
});
