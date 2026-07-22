import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveShotGroupingPass } from "./three-stage-planner";
import type { VideoStoryBeat, VideoTimelineBlueprintSegment } from "./types";

function segment(partial: Partial<VideoTimelineBlueprintSegment> & Pick<VideoTimelineBlueprintSegment, "segmentNo" | "durationSeconds" | "beatRole">): VideoTimelineBlueprintSegment {
  const start = (partial.segmentNo - 1) * partial.durationSeconds;
  return {
    segmentNo: partial.segmentNo,
    startTimeSeconds: partial.startTimeSeconds ?? start,
    endTimeSeconds: partial.endTimeSeconds ?? start + partial.durationSeconds,
    durationSeconds: partial.durationSeconds,
    beatRole: partial.beatRole,
    purposeZh: partial.purposeZh ?? "",
    purposeEn: partial.purposeEn ?? "",
    requiredAnchorIds: partial.requiredAnchorIds ?? ["scene_a"],
    sourceEventIds: partial.sourceEventIds ?? [`event_${partial.segmentNo}`],
    splitReasonZh: partial.splitReasonZh ?? "",
    boundaryModeHint: partial.boundaryModeHint ?? "continuous",
  };
}

function beat(beatId: string, storyFunction: VideoStoryBeat["storyFunction"], targetSegmentNos: number[]): VideoStoryBeat {
  return {
    beatId,
    order: Number(beatId.replace(/\D/g, "")) || 1,
    storyFunction,
    targetSegmentNos,
    titleZh: beatId,
    informationUnit: beatId,
  };
}

test("shot grouping merges compatible adjacent beats and splits payoff and CTA entry", () => {
  const result = deriveShotGroupingPass([
    beat("beat_1", "hook", [1]),
    beat("beat_2", "conflict", [2]),
    beat("beat_3", "payoff", [3]),
    beat("beat_4", "cta", [4]),
  ], [
    segment({ segmentNo: 1, durationSeconds: 4, beatRole: "hook", purposeZh: "压力开场" }),
    segment({ segmentNo: 2, durationSeconds: 4, beatRole: "interaction", purposeZh: "同场冲突升级" }),
    segment({ segmentNo: 3, durationSeconds: 4, beatRole: "payoff", purposeZh: "结果兑现" }),
    segment({ segmentNo: 4, durationSeconds: 4, beatRole: "ending", purposeZh: "CTA 进入" }),
  ]);

  assert.deepEqual(result.groups.map((group) => group.segment_nos), [[1, 2], [3], [4]]);
  assert.deepEqual(result.splitReasons.map((item) => item.reason_code), ["payoff_state_change", "cta_enter"]);
});

test("shot grouping rejects merges over the i2v 15 second limit", () => {
  const result = deriveShotGroupingPass([
    beat("beat_1", "proof", [1, 2]),
  ], [
    segment({ segmentNo: 1, durationSeconds: 8, beatRole: "proof", purposeZh: "同一证明动作前半段" }),
    segment({ segmentNo: 2, durationSeconds: 8, beatRole: "proof", purposeZh: "同一证明动作后半段" }),
  ]);

  assert.deepEqual(result.groups.map((group) => group.segment_nos), [[1], [2]]);
  assert.equal(result.splitReasons[0]?.reason_code, "duration_limit");
});

test("shot grouping records space-change split reasons", () => {
  const result = deriveShotGroupingPass([
    beat("beat_1", "proof", [1]),
    beat("beat_2", "proof", [2]),
  ], [
    segment({ segmentNo: 1, durationSeconds: 5, beatRole: "proof", purposeZh: "厨房制作", requiredAnchorIds: ["kitchen"] }),
    segment({ segmentNo: 2, durationSeconds: 5, beatRole: "proof", purposeZh: "餐桌展示", requiredAnchorIds: ["table"] }),
  ]);

  assert.deepEqual(result.groups.map((group) => group.segment_nos), [[1], [2]]);
  assert.equal(result.splitReasons[0]?.reason_code, "space_change");
});
