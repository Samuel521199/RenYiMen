import assert from "node:assert/strict";
import test from "node:test";
import {
  mergePlanningDurationRepair,
  validatePlanningDurationContract,
} from "./three-stage-planner.ts";

const input = {
  userPrompt: "A five-event game advertisement",
  aspectRatio: "9:16" as const,
  durationSeconds: 30,
  referenceImageUrls: [],
};

function segment(
  segmentNo: number,
  start: number,
  duration: number,
  reason: string,
) {
  return {
    segment_no: segmentNo,
    start_time_seconds: start,
    end_time_seconds: start + duration,
    duration_seconds: duration,
    duration_reason_zh: reason,
    minimum_executable_seconds: Math.max(3, duration - 1),
    preferred_duration_seconds: duration,
    maximum_useful_seconds: Math.min(15, duration + 2),
    timing_budget: {
      setup_seconds: 1,
      action_seconds: Math.max(1, duration - 2),
      result_seconds: duration - 1 - Math.max(1, duration - 2),
    },
    source_event_ids: [`event_${segmentNo}`],
  };
}

function planningOutput(segments: ReturnType<typeof segment>[]) {
  return {
    candidate_timeline: segments.map((item) => ({ ...item })),
    planning_manifest: {
      timeline_blueprint: {
        segment_count: segments.length,
        total_duration_seconds: 30,
        segment_duration_min_seconds: 3,
        segment_duration_max_seconds: 15,
        segments,
      },
    },
  };
}

test("accepts deliberate model-allocated durations with executable timing budgets", () => {
  const output = planningOutput([
    segment(1, 0, 4, "开场只需建立人物和普通游戏状态"),
    segment(2, 4, 6, "失败升级需要两次可见操作和情绪反应"),
    segment(3, 10, 5, "双倍奖励触发需要完整展示操作与反馈"),
    segment(4, 15, 9, "胜利兑现和社交反馈包含最多动作与反应"),
    segment(5, 24, 6, "CTA需要品牌识别和可读停留时间"),
  ]);

  assert.deepEqual(validatePlanningDurationContract(output, input), []);
});

test("rejects missing timing rationale instead of silently averaging durations", () => {
  const equalSegments = [0, 6, 12, 18, 24].map((start, index) => ({
    segment_no: index + 1,
    start_time_seconds: start,
    end_time_seconds: start + 6,
    duration_seconds: 6,
    source_event_ids: [`event_${index + 1}`],
  }));
  const issues = validatePlanningDurationContract(
    planningOutput(equalSegments as ReturnType<typeof segment>[]),
    input,
  );
  const codes = new Set(issues.map((issue) => issue.code));

  assert.equal(codes.has("DURATION_REASON_MISSING"), true);
  assert.equal(codes.has("DURATION_EXECUTABLE_RANGE_INVALID"), true);
  assert.equal(codes.has("DURATION_TIMING_BUDGET_INVALID"), true);
  assert.equal(codes.has("DURATION_MECHANICAL_EQUAL_SPLIT"), true);
});

test("duration repair replaces only timeline timing and preserves planning assets", () => {
  const original = {
    consistency_manifest: { anchors: [{ id: "hero" }] },
    planning_manifest: {
      global_style: { visual_style: "bright arcade" },
      timeline_blueprint: { segment_count: 1, segments: [] },
    },
  };
  const repairedSegments = [
    segment(1, 0, 4, "开场只需快速建立普通状态"),
    segment(2, 4, 6, "失败过程需要完整操作和反应"),
    segment(3, 10, 5, "奖励触发需要清晰因果展示"),
    segment(4, 15, 9, "胜利与社交反馈需要最长兑现时间"),
    segment(5, 24, 6, "CTA需要品牌识别和文字停留"),
  ];
  const merged = mergePlanningDurationRepair(original, {
    duration_replan: {
      candidate_timeline: repairedSegments,
      timeline_blueprint: {
        segment_count: 5,
        total_duration_seconds: 30,
        segments: repairedSegments,
      },
    },
  });

  assert.deepEqual(merged.consistency_manifest, original.consistency_manifest);
  assert.deepEqual(
    (merged.planning_manifest as Record<string, unknown>).global_style,
    { visual_style: "bright arcade" },
  );
  assert.equal(
    ((merged.planning_manifest as Record<string, unknown>).timeline_blueprint as Record<string, unknown>).segment_count,
    5,
  );
});
