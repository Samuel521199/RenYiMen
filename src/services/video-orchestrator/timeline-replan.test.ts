import assert from "node:assert/strict";
import test from "node:test";
import { createVideoPlan } from "./planner.ts";
import {
  applyTimelineReplanToPlanningRaw,
  createTimelineChangeRequest,
  hasMeaningfulTimelineChangeDirective,
  invalidateCheckpointAfterTimelineReplan,
  locallyRepairableFinalPromptSegmentNos,
  repairAlternateViewCameraGraph,
  repairMissingSingleTakeContracts,
  timelineChangeRequestRepairIssues,
  type AliyunStoryboardPlannerCheckpoint,
} from "./three-stage-planner.ts";
import { auditSingleTakePlan } from "./single-take-audit.ts";
import type { VideoPlanningManifest } from "./types.ts";

test("final validation routes only prompt-level cut issues back to their owning segments", () => {
  assert.deepEqual(locallyRepairableFinalPromptSegmentNos([
    {
      code: "INTERNAL_CUT_LANGUAGE",
      severity: "error",
      artifactId: "segment:3",
      messageZh: "local wording repair",
      retryFromStage: "stage2b",
    },
    {
      code: "SINGLE_TAKE_HIGH_RISK",
      severity: "warning",
      artifactId: "segment:4",
      messageZh: "warning only",
    },
  ]), [3]);
});

const input = {
  userPrompt: "A person leaves a room and appears on a rooftop.",
  aspectRatio: "16:9" as const,
  durationSeconds: 15,
  referenceImageUrls: [],
};

const currentManifest: VideoPlanningManifest = {
  timelineBlueprint: {
    segmentCount: 3,
    totalDurationSeconds: 15,
    segmentDurationMinSeconds: 3,
    segmentDurationMaxSeconds: 15,
    segments: [
      {
        segmentNo: 1,
        startTimeSeconds: 0,
        endTimeSeconds: 5,
        durationSeconds: 5,
        durationReasonZh: "室内人物和普通状态需要建立时间",
        minimumExecutableSeconds: 4,
        preferredDurationSeconds: 5,
        maximumUsefulSeconds: 6,
        timingBudget: { setupSeconds: 2, actionSeconds: 2, resultSeconds: 1 },
        purposeZh: "建立室内人物",
        sourceEventIds: ["event_1"],
      },
      {
        segmentNo: 2,
        startTimeSeconds: 5,
        endTimeSeconds: 10,
        durationSeconds: 5,
        durationReasonZh: "离开房间和转场动作需要完整展示",
        minimumExecutableSeconds: 4,
        preferredDurationSeconds: 5,
        maximumUsefulSeconds: 6,
        timingBudget: { setupSeconds: 1, actionSeconds: 3, resultSeconds: 1 },
        purposeZh: "离开房间并到达屋顶",
        sourceEventIds: ["event_2"],
      },
      {
        segmentNo: 3,
        startTimeSeconds: 10,
        endTimeSeconds: 15,
        durationSeconds: 5,
        durationReasonZh: "屋顶结果需要建立反应和收束",
        minimumExecutableSeconds: 4,
        preferredDurationSeconds: 5,
        maximumUsefulSeconds: 6,
        timingBudget: { setupSeconds: 1, actionSeconds: 2, resultSeconds: 2 },
        purposeZh: "屋顶结果",
        sourceEventIds: ["event_3"],
      },
    ],
  },
  consistencyManifest: { anchors: [] },
};

test("non-repairable single-take audit becomes a structured timeline change request", () => {
  const request = createTimelineChangeRequest({
    passed: false,
    action: "replan_timeline",
    auditedSegmentNos: [2],
    auditVersion: "single-take-audit-v2",
    issues: [{
      code: "SINGLE_TAKE_REQUIRES_CUT",
      severity: "error",
      segmentNo: 2,
      artifactId: "segment:2",
      reason: "requires_cut_true",
      reasonCode: "requires_cut_true",
      messageZh: "需要切分",
      retryFromStage: "stage2b",
      repairable: false,
      sourcePath: "segmentRenderDescriptions[2].singleTakeContract.requiresCut",
      evidenceType: "deterministic_contract",
      confidence: 1,
      structural: true,
      repairScope: "timeline",
    }],
  }, {
    segment_render_descriptions: [{
      segment_no: 2,
      timeline_change_request: { reason: "location_change" },
      recommended_split: [{ at: "door exit" }, { at: "rooftop arrival" }],
    }],
  });

  assert.equal(request.changeType, "split_segment");
  assert.equal(request.firstAffectedSegmentNo, 2);
  assert.deepEqual(request.affectedSegmentNos, [2]);
  assert.deepEqual(request.issueCodes, ["SINGLE_TAKE_REQUIRES_CUT"]);
  assert.equal(request.requestedChanges.length, 2);
});

test("empty timeline hints do not trigger replanning and fallback repair issues are never empty", () => {
  assert.equal(hasMeaningfulTimelineChangeDirective([]), false);
  assert.equal(hasMeaningfulTimelineChangeDirective({}), false);
  assert.equal(hasMeaningfulTimelineChangeDirective([{ at: "card reveal" }]), true);

  const issues = timelineChangeRequestRepairIssues({
    requestId: "timeline_empty_issue_defense",
    source: "single_take_audit",
    changeType: "split_segment",
    affectedSegmentNos: [2],
    firstAffectedSegmentNo: 2,
    issueCodes: [],
    reasons: [],
    requestedChanges: [{ at: "card reveal" }],
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.code, "TIMELINE_SPLIT_DIRECTIVE");
  assert.equal(issues[0]?.segmentNo, 2);
});

test("an explicit split directive synthesizes a timeline audit issue", () => {
  const request = createTimelineChangeRequest({
    passed: false,
    action: "repair_segment",
    auditedSegmentNos: [2],
    auditVersion: "single-take-audit-v2",
    issues: [{
      code: "SINGLE_TAKE_CHECKPOINT_BUDGET_EXCEEDED",
      severity: "error",
      segmentNo: 2,
      artifactId: "segment:2",
      reason: "checkpoint_count_3_exceeds_2",
      reasonCode: "checkpoint_count_3_exceeds_2",
      messageZh: "动作检查点过多",
      retryFromStage: "stage2b",
      repairable: true,
      sourcePath: "segmentRenderDescriptions[2].motionCheckpoints",
      evidenceType: "timing_budget",
      confidence: 0.9,
      structural: false,
      repairScope: "segment",
    }],
  }, {
    segment_render_descriptions: [{
      segment_no: 2,
      recommended_split: [{ at: "card reveal" }],
    }],
  });
  assert.deepEqual(request.issueCodes, ["TIMELINE_SPLIT_DIRECTIVE"]);
  assert.equal(request.reasons[0], "single_take_repair_exhausted_with_explicit_split_directive");
});

test("timeline replan preserves the locked prefix and adds a real segment", () => {
  const fallback = createVideoPlan(input);
  const planningRaw = {
    narrative_events: [{ event_id: "event_1" }, { event_id: "event_2" }, { event_id: "event_3" }],
    planning_manifest: {
      consistency_manifest: { anchors: [] },
      timeline_blueprint: {
        segment_count: 3,
        segments: currentManifest.timelineBlueprint.segments,
      },
    },
  };
  const revised = applyTimelineReplanToPlanningRaw({
    planningRaw,
    currentManifest,
    input,
    fallback,
    request: {
      requestId: "timeline_test",
      source: "single_take_audit",
      changeType: "split_segment",
      affectedSegmentNos: [2],
      firstAffectedSegmentNo: 2,
      issueCodes: ["SINGLE_TAKE_REQUIRES_CUT"],
      reasons: ["requires_cut_true"],
      requestedChanges: [],
    },
    timelineReplanRaw: {
      timeline_replan: {
        planning_manifest: {
          timeline_blueprint: {
            segment_count: 4,
            total_duration_seconds: 15,
            segment_duration_min_seconds: 3,
            segment_duration_max_seconds: 15,
            segments: [
              currentManifest.timelineBlueprint.segments[0],
              {
                segment_no: 2,
                start_time_seconds: 5,
                end_time_seconds: 8,
                duration_seconds: 3,
                duration_reason_zh: "人物走到门口需要完整动作时间",
                minimum_executable_seconds: 3,
                preferred_duration_seconds: 3,
                maximum_useful_seconds: 4,
                timing_budget: { setup_seconds: 1, action_seconds: 2, result_seconds: 0 },
                purpose_zh: "人物走到门口",
                source_event_ids: ["event_2"],
              },
              {
                segment_no: 3,
                start_time_seconds: 8,
                end_time_seconds: 11,
                duration_seconds: 3,
                duration_reason_zh: "屋顶环境建立需要短暂识别时间",
                minimum_executable_seconds: 3,
                preferred_duration_seconds: 3,
                maximum_useful_seconds: 4,
                timing_budget: { setup_seconds: 1, action_seconds: 1, result_seconds: 1 },
                purpose_zh: "切到屋顶建立环境",
                source_event_ids: ["event_2"],
              },
              {
                segment_no: 4,
                start_time_seconds: 11,
                end_time_seconds: 15,
                duration_seconds: 4,
                duration_reason_zh: "屋顶结果需要动作兑现和反应时间",
                minimum_executable_seconds: 3,
                preferred_duration_seconds: 4,
                maximum_useful_seconds: 5,
                timing_budget: { setup_seconds: 1, action_seconds: 1, result_seconds: 2 },
                purpose_zh: "屋顶结果",
                source_event_ids: ["event_3"],
              },
            ],
          },
        },
      },
    },
  });

  const timeline = (revised.planning_manifest as Record<string, unknown>).timeline_blueprint as Record<string, unknown>;
  assert.equal(timeline.segment_count, 4);
  assert.deepEqual((timeline.segments as unknown[])[0], currentManifest.timelineBlueprint.segments[0]);
});

test("timeline replan invalidates only the affected segment and later caches", () => {
  const checkpoint = {
    version: 10,
    inputFingerprint: "test",
    storyboardArtistPlan: { story_beats: [] },
    storyContractReport: { passed: true, issues: [] },
    shotDecomposerSegmentPlans: { "1": { id: "keep" }, "2": { id: "drop" }, "3": { id: "drop" } },
    approvedShotDecomposerSegmentPlans: { "1": { id: "keep" }, "2": { id: "drop" } },
    promptDetailSegmentPlans: { "1": {}, "2": {} },
    updatedAt: new Date(0).toISOString(),
  } as unknown as AliyunStoryboardPlannerCheckpoint;

  invalidateCheckpointAfterTimelineReplan(checkpoint, 2);

  assert.equal(checkpoint.storyboardArtistPlan, undefined);
  assert.deepEqual(Object.keys(checkpoint.shotDecomposerSegmentPlans ?? {}), ["1"]);
  assert.deepEqual(Object.keys(checkpoint.approvedShotDecomposerSegmentPlans ?? {}), ["1"]);
  assert.deepEqual(Object.keys(checkpoint.promptDetailSegmentPlans ?? {}), ["1"]);
});

test("missing execution contracts are completed locally without changing segment timing", () => {
  const source = {
    segments: [{
      segment_no: 1,
      start_time_seconds: 0,
      end_time_seconds: 5,
      duration_seconds: 5,
      purpose_zh: "人物走向产品",
      motion: "人物沿桌边连续走向产品",
    }],
    segment_render_descriptions: [{ segment_no: 1 }],
  };
  const audit = auditSingleTakePlan(source, [1]);
  const repaired = repairMissingSingleTakeContracts(source, audit, [1]);

  assert.equal(repaired.changed, true);
  assert.deepEqual(repaired.plan.segments, source.segments);
  const nextAudit = auditSingleTakePlan(repaired.plan, [1]);
  assert.equal(nextAudit.passed, true);
});

test("alternate-view repair inherits only parent axis and layout evidence", () => {
  const storyboardPlan = {
    storyboard_brief: [{ segment_no: 2, camera_id: "camera_b" }],
    camera_graph: {
      cameras: [
        {
          camera_id: "camera_a",
          segment_nos: [1],
          axis_description: "table axis left-to-right",
          spatial_layout_lock: "hero left, product right",
        },
        {
          camera_id: "camera_b",
          segment_nos: [2],
          parent_camera_id: "camera_a",
          relation_to_parent: "alternate_view",
        },
      ],
      relations: [],
    },
  };
  const executablePlan = {
    ...storyboardPlan,
    segments: [{ segment_no: 2, duration_seconds: 5, motion: "continuous walk" }],
    segment_render_descriptions: [{
      segment_no: 2,
      start_frame_contract: { state: "start" },
      end_frame_contract: { state: "end" },
      motion_contract: { subject_motion: "continuous walk" },
      single_take_contract: { requires_cut: false, physically_reachable: true },
    }],
  };
  const audit = auditSingleTakePlan(executablePlan, [2]);
  assert.equal(audit.action, "repair_camera_graph");
  assert.equal(repairAlternateViewCameraGraph(storyboardPlan, audit), true);

  const nextAudit = auditSingleTakePlan({
    ...executablePlan,
    cameraGraph: storyboardPlan.camera_graph,
  }, [2]);
  assert.equal(nextAudit.passed, true);
});
