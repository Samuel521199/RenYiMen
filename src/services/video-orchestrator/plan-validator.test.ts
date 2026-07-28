import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { cameraRelationDirectives, deriveCameraGraphFromStoryboardBrief, resolveCameraInheritanceContext } from "./camera-graph.ts";
import { frameContractContainsMotionProcess, repairMotionfulEndpointContracts } from "./frame-contract.ts";
import { PlanValidationError, assertPlanValidForGeneration, validateOnePromptVideoPlan } from "./plan-validator.ts";

function validPlan(): Record<string, unknown> {
  return {
    title: "validator fixture",
    durationSeconds: 6,
    consistencyManifest: { anchors: [{ anchorId: "person_1", type: "person", referenceStrength: "hard" }] },
    narrativeEvents: [{ eventId: "event_1" }],
    storyboardBrief: [{ segmentNo: 1, eventIds: ["event_1"], cameraId: "cam_1", requiredAnchorIds: ["person_1"] }],
    cameraGraph: {
      cameras: [{ cameraId: "cam_1", segmentNos: [1], locationId: "room" }],
      relations: [],
    },
    keyframes: [
      { keyframeNo: 1, usesConsistencyAnchors: ["person_1"] },
      { keyframeNo: 2, usesConsistencyAnchors: ["person_1"] },
    ],
    segments: [{ segmentNo: 1, startKeyframeNo: 1, endKeyframeNo: 2, durationSeconds: 6, usesConsistencyAnchors: ["person_1"] }],
    segmentRenderDescriptions: [{
      segmentNo: 1,
      startFrameContract: { state: "人物站在桌子左侧" },
      endFrameContract: { state: "人物站在桌子右侧" },
      motionContract: { path: "人物沿桌边连续行走" },
      singleTakeContract: { requiresCut: false, riskLevel: "low", physicallyReachable: true },
      motionCheckpoints: [{ state: "人物位于桌子中央" }],
    }],
  };
}

function errorCodes(plan: unknown): string[] {
  return validateOnePromptVideoPlan(plan).filter((item) => item.severity === "error").map((item) => item.code);
}

test("valid historical camera nodes remain compatible without new optional fields", () => {
  assert.deepEqual(errorCodes(validPlan()), []);
});

test("planning sends oversized keyframe prompts back to shot decomposition", () => {
  const plan = validPlan();
  (plan.keyframes as Array<Record<string, unknown>>)[0]!.imagePromptZh =
    `关键帧画面，${"具体可见状态".repeat(700)}`;
  const issues = validateOnePromptVideoPlan(plan, { stage: "planning" });
  assert.ok(issues.some((issue) =>
    issue.code === "IMAGE_PROMPT_PLANNING_BUDGET_EXCEEDED"
    && issue.retryFromStage === "stage_2b_shot_decomposer"
  ));
});

test("missing camera graph can be conservatively derived from storyboard briefs", () => {
  const cameraGraph = deriveCameraGraphFromStoryboardBrief([
    { segmentNo: 1, cameraId: "camera_01", locationId: "table", visualDescZh: "牌桌中景" },
    { segmentNo: 2, cameraId: "camera_02", locationId: "table", visualDescZh: "同一牌桌近景" },
    { segmentNo: 3, cameraId: "camera_03", locationId: "store", visualDescZh: "商店结尾" },
  ]);

  assert.deepEqual(cameraGraph.cameras.map((camera) => camera.cameraId), ["camera_01", "camera_02", "camera_03"]);
  assert.equal(cameraGraph.cameras[0].relationToParent, "new_camera_setup");
  assert.equal(cameraGraph.cameras[1].relationToParent, "same_spatial_context");
  assert.equal(cameraGraph.cameras[2].relationToParent, "new_camera_setup");
  const plan = validPlan();
  plan.storyboardBrief = [
    { segmentNo: 1, eventIds: ["event_1"], cameraId: "camera_01", requiredAnchorIds: ["person_1"] },
  ];
  plan.cameraGraph = deriveCameraGraphFromStoryboardBrief(plan.storyboardBrief);
  assert.ok(!errorCodes(plan).includes("MISSING_CAMERA_REFERENCE"));
  assert.ok(!errorCodes(plan).includes("NEW_CAMERA_SPATIAL_SOURCE_MISSING"));
});

test("normalized consistency anchors using id are accepted", () => {
  const plan = validPlan();
  plan.consistencyManifest = { anchors: [{ id: "person_1", type: "person", referenceStrength: "hard" }] };
  assert.ok(!errorCodes(plan).includes("MISSING_ANCHOR_REFERENCE"));
});

test("planning rejects abstract palette mood promoted to a scene-layout anchor", () => {
  const plan = validPlan();
  plan.consistencyManifest = {
    anchors: [{
      id: "festival_bg",
      type: "location",
      displayNameZh: "节日感彩色背景",
      needsReferenceImage: true,
      descriptionZh: "高饱和模糊光斑与渐变色块",
      assetImageContract: {
        subjectCount: 0,
        subjectDescription: "抽象散景，没有具体物体",
        environment: {
          background: "模糊节日氛围",
          foreground: "None",
          midground: "渐变色块",
          backgroundLayer: "虚化光斑",
          spatialRelationships: ["色块重叠", "散景大小变化"],
        },
      },
    }],
  };
  const issues = validateOnePromptVideoPlan(plan, { stage: "planning" });
  assert.ok(issues.some((issue) => issue.code === "PALETTE_MOOD_MISCLASSIFIED_AS_SCENE" && issue.severity === "error"));
});

test("palette and style anchors cannot become required visible evidence", () => {
  const plan = validPlan();
  plan.consistencyManifest = {
    anchors: [{
      id: "palette_1",
      type: "palette_mood",
      needsReferenceImage: false,
      descriptionZh: "明亮高饱和主色调",
    }],
  };
  plan.keyframes = [
    { keyframeNo: 1, effectiveRequiredAnchorIds: ["palette_1"], usesConsistencyAnchors: ["palette_1"] },
    { keyframeNo: 2, usesConsistencyAnchors: [] },
  ];
  const issues = validateOnePromptVideoPlan(plan, { stage: "planning" });
  assert.ok(issues.some((issue) => issue.code === "SOFT_STYLE_ANCHOR_MARKED_VISIBLE" && issue.severity === "error"));
});

test("planning requires a scene contract when cameras claim spatial continuity", () => {
  const plan = validPlan();
  plan.cameraGraph = {
    cameras: [
      { cameraId: "cam_1", segmentNos: [1], relationToParent: "new_camera_setup" },
      { cameraId: "cam_2", segmentNos: [2], parentCameraId: "cam_1", relationToParent: "same_spatial_context" },
    ],
    relations: [{ fromCameraId: "cam_1", toCameraId: "cam_2", relation: "same_spatial_context" }],
  };
  const issues = validateOnePromptVideoPlan(plan, { stage: "planning" });
  assert.ok(issues.some((issue) => issue.code === "SCENE_CONTRACT_MISSING"));
});

test("scene continuity accepts one physical scene-layout authority shared by both cameras", () => {
  const plan = validPlan();
  plan.consistencyManifest = {
    anchors: [
      { id: "person_1", type: "person", referenceStrength: "hard" },
      {
        id: "table_stage",
        type: "space_layout",
        needsReferenceImage: true,
        descriptionZh: "实体游戏桌舞台空间",
        assetImageContract: {
          subjectCount: 0,
          subjectDescription: "无人空景游戏桌舞台",
          environment: {
            foreground: "前景弧形桌沿",
            midground: "中景中央游戏桌与左右站位区",
            backgroundLayer: "后景实体拱门与两根立柱",
            background: "封闭摄影棚舞台",
            spatialRelationships: ["游戏桌位于两根立柱正中间", "拱门在游戏桌后方两米"],
          },
        },
      },
    ],
  };
  plan.cameraGraph = {
    cameras: [
      { cameraId: "cam_1", sceneId: "scene_table", segmentNos: [1], relationToParent: "new_camera_setup" },
      { cameraId: "cam_2", sceneId: "scene_table", segmentNos: [2], parentCameraId: "cam_1", relationToParent: "same_spatial_context" },
    ],
    relations: [{ fromCameraId: "cam_1", toCameraId: "cam_2", relation: "same_spatial_context" }],
  };
  plan.sceneContracts = [{
    version: "scene-contract-v1",
    sceneId: "scene_table",
    layoutAnchorId: "table_stage",
    cameraIds: ["cam_1", "cam_2"],
    segmentNos: [1, 2],
    continuityMode: "single_space",
    spatialLayoutLock: "桌居中、立柱分列左右、拱门固定在桌后",
    fixedLandmarks: ["游戏桌", "左立柱", "右立柱", "后方拱门"],
    authority: { kind: "scene_layout_asset", anchorId: "table_stage" },
  }];
  const issues = validateOnePromptVideoPlan(plan, { stage: "planning" });
  assert.ok(!issues.some((issue) => issue.code.startsWith("SCENE_") || issue.code === "CAMERA_SCENE_BINDING_BROKEN"));
});

test("semantic asset coverage detects omitted derived anchors and unjustified exclusions", () => {
  const plan = validPlan();
  plan.keyframes = [
    {
      keyframeNo: 1,
      usesConsistencyAnchors: [],
      declaredAnchorIds: [],
      derivedAnchorIds: ["person_1"],
      effectiveRequiredAnchorIds: [],
      excludedAnchors: [],
    },
    { keyframeNo: 2, usesConsistencyAnchors: ["person_1"] },
  ];
  assert.ok(errorCodes(plan).includes("REQUIRED_ANCHOR_COVERAGE_MISSING"));

  (plan.keyframes as Array<Record<string, unknown>>)[0].excludedAnchors = [{
    anchorId: "person_1",
    reason: "not needed",
    valid: false,
  }];
  assert.ok(errorCodes(plan).includes("UNJUSTIFIED_ANCHOR_EXCLUSION"));
});

test("motionful endpoint contracts are rebuilt from static boundary keyframes before validation", () => {
  const plan = validPlan();
  plan.keyframes = [
    { keyframeNo: 1, timeSeconds: 0, scene: "房间", characterState: "人物站在左侧", productState: "产品静置", usesConsistencyAnchors: ["person_1"] },
    { keyframeNo: 2, timeSeconds: 6, scene: "房间", characterState: "人物已站在右侧", productState: "产品仍静置", usesConsistencyAnchors: ["person_1"] },
  ];
  const descriptions = plan.segmentRenderDescriptions as Array<Record<string, unknown>>;
  descriptions[0].endFrameContract = { state: "人物从左侧移动到右侧的过程" };
  assert.ok(errorCodes(plan).includes("END_FRAME_CONTAINS_MOTION"));

  const repaired = repairMotionfulEndpointContracts(plan as never);
  assert.ok(!errorCodes(repaired).includes("END_FRAME_CONTAINS_MOTION"));
  assert.equal(repaired.segmentRenderDescriptions?.[0].endFrameContract?.characterState, "人物已站在右侧");
  assert.match(repaired.plannerWarnings?.at(-1) ?? "", /segment 1 end frame -> KF2/);
});

test("motionful boundary keyframe wording is staticized instead of failing validation again", () => {
  const plan = validPlan();
  plan.keyframes = [
    { keyframeNo: 1, timeSeconds: 0, scene: "游戏房间", characterState: "主角准备操作", productState: "游戏界面待机", usesConsistencyAnchors: ["person_1"] },
    {
      keyframeNo: 2,
      timeSeconds: 6,
      scene: "游戏房间",
      characterState: "主角保持专注表情，双手正在操作游戏界面，身体轻微前倾",
      productState: "游戏界面方块开始移动，计时器显示初始时间，得分栏为0",
      usesConsistencyAnchors: ["person_1"],
    },
  ];
  const descriptions = plan.segmentRenderDescriptions as Array<Record<string, unknown>>;
  descriptions[0].endFrameContract = { characterState: "双手正在操作游戏界面" };

  const repaired = repairMotionfulEndpointContracts(plan as never);
  const endFrame = repaired.segmentRenderDescriptions?.[0].endFrameContract;
  assert.equal(endFrame?.characterState, "主角保持专注表情，双手保持操作游戏界面的姿势，身体轻微前倾");
  assert.equal(endFrame?.productState, "游戏界面方块呈现启动后的布局，计时器显示初始时间，得分栏为0");
  assert.equal(frameContractContainsMotionProcess(endFrame), false);
  assert.ok(!errorCodes(repaired).includes("END_FRAME_CONTAINS_MOTION"));
});

test("endpoint detector does not join unrelated fields into fake from-to motion", () => {
  const contract = {
    characterPosition: "Visible from the chest up behind the cards.",
    cardPosition: "Spanning the lower-center to the bottom of the frame.",
  };

  assert.equal(frameContractContainsMotionProcess(contract), false);
  assert.equal(frameContractContainsMotionProcess({
    ...contract,
    actionState: "The character is moving from the table to the logo.",
  }), true);
});

test("duration, total, keyframe count and boundary continuity are hard errors", () => {
  const plan = validPlan();
  plan.durationSeconds = 20;
  plan.keyframes = [{ keyframeNo: 1 }, { keyframeNo: 3 }, { keyframeNo: 4 }];
  plan.segments = [
    { segmentNo: 1, startKeyframeNo: 1, endKeyframeNo: 3, durationSeconds: 2 },
    { segmentNo: 2, startKeyframeNo: 3, endKeyframeNo: 4, durationSeconds: 16 },
  ];
  const codes = errorCodes(plan);
  assert.ok(codes.includes("SEGMENT_DURATION_OUT_OF_RANGE"));
  assert.ok(codes.includes("SEGMENT_TOTAL_DURATION_MISMATCH"));
  assert.ok(codes.includes("KEYFRAME_SEQUENCE_BROKEN"));
  assert.ok(codes.includes("SEGMENT_BOUNDARY_REFERENCE_BROKEN"));
});

test("missing render contracts and invalid references are hard errors", () => {
  const plan = validPlan();
  plan.storyboardBrief = [{ segmentNo: 1, eventIds: ["missing_event"], cameraId: "missing_camera", requiredAnchorIds: ["missing_anchor"] }];
  plan.segmentRenderDescriptions = [{ segmentNo: 1 }];
  const codes = errorCodes(plan);
  assert.ok(codes.includes("START_FRAME_CONTRACT_MISSING"));
  assert.ok(codes.includes("END_FRAME_CONTRACT_MISSING"));
  assert.ok(codes.includes("MOTION_CONTRACT_MISSING"));
  assert.ok(codes.includes("SINGLE_TAKE_CONTRACT_MISSING"));
  assert.ok(codes.includes("MISSING_EVENT_REFERENCE"));
  assert.ok(codes.includes("MISSING_CAMERA_REFERENCE"));
  assert.ok(codes.includes("MISSING_ANCHOR_REFERENCE"));
});

test("static keyframe generation is not blocked by unrelated video execution contracts", () => {
  const plan = validPlan();
  plan.segmentRenderDescriptions = [{ segmentNo: 1 }];
  const codes = validateOnePromptVideoPlan(plan, { stage: "keyframe_generation", keyframeNo: 1 })
    .filter((item) => item.severity === "error")
    .map((item) => item.code);
  assert.ok(!codes.includes("START_FRAME_CONTRACT_MISSING"));
  assert.ok(!codes.includes("END_FRAME_CONTRACT_MISSING"));
  assert.ok(!codes.includes("MOTION_CONTRACT_MISSING"));
  assert.ok(!codes.includes("SINGLE_TAKE_CONTRACT_MISSING"));
  assert.ok(errorCodes(plan).includes("SINGLE_TAKE_CONTRACT_MISSING"));
});

test("static micro-shot image generation is not blocked by motionful video contracts", () => {
  const plan = validPlan();
  plan.segmentRenderDescriptions = [{
    segmentNo: 1,
    startFrameContract: { state: "人物正在走向桌子" },
    endFrameContract: { state: "人物从门口移动到桌边的过程" },
    motionContract: { path: "连续路径" },
    singleTakeContract: { requiresCut: true, riskLevel: "high", physicallyReachable: false },
    motionCheckpoints: [
      { state: "动作一" },
      { state: "动作二" },
      { state: "动作三" },
      { state: "动作四" },
    ],
  }];
  const codes = validateOnePromptVideoPlan(plan, {
    stage: "micro_shot_generation",
    segmentNo: 1,
    targetArtifactId: "segment:1:micro_shot:1:image",
  })
    .filter((item) => item.severity === "error")
    .map((item) => item.code);
  assert.ok(!codes.includes("START_FRAME_CONTAINS_MOTION"));
  assert.ok(!codes.includes("END_FRAME_CONTAINS_MOTION"));
  assert.ok(!codes.includes("SINGLE_TAKE_REQUIRES_CUT"));
  assert.ok(!codes.includes("SINGLE_TAKE_HIGH_RISK"));
  assert.ok(errorCodes(plan).includes("END_FRAME_CONTAINS_MOTION"));
});

test("frame motion, checkpoint cuts and unsafe single-take flags are hard errors", () => {
  const plan = validPlan();
  plan.segmentRenderDescriptions = [{
    segmentNo: 1,
    startFrameContract: { state: "人物正在走向桌子" },
    endFrameContract: { state: "人物从门口移动到桌边的过程" },
    motionContract: { path: "连续路径" },
    singleTakeContract: { requiresCut: true, riskLevel: "high", physicallyReachable: false },
    motionCheckpoints: [{ state: "switch angle then dissolve" }],
  }];
  const codes = errorCodes(plan);
  assert.ok(codes.includes("START_FRAME_CONTAINS_MOTION"));
  assert.ok(codes.includes("END_FRAME_CONTAINS_MOTION"));
  assert.ok(codes.includes("MOTION_CHECKPOINT_CONTAINS_CUT"));
  assert.ok(codes.includes("SINGLE_TAKE_REQUIRES_CUT"));
  assert.ok(codes.includes("SINGLE_TAKE_HIGH_RISK"));
  assert.ok(codes.includes("SINGLE_TAKE_PHYSICALLY_UNREACHABLE"));
});

test("new camera setup needs a spatial source or explicit no-inheritance decision", () => {
  const plan = validPlan();
  plan.cameraGraph = {
    cameras: [
      { cameraId: "cam_0", segmentNos: [], locationId: "room" },
      { cameraId: "cam_1", segmentNos: [1], parentCameraId: "cam_0", relationToParent: "new_camera_setup", missingInfo: ["空间来源"] },
    ],
    relations: [{ fromCameraId: "cam_0", toCameraId: "cam_1", relation: "new_camera_setup" }],
  };
  assert.ok(errorCodes(plan).includes("NEW_CAMERA_SPATIAL_SOURCE_MISSING"));
  const graph = (plan.cameraGraph as { cameras: Array<Record<string, unknown>> }).cameras;
  graph[1].missingInfo = [];
  graph[1].inheritanceReasonZh = "独立产品棚机位，无需继承上一机位";
  assert.ok(!errorCodes(plan).includes("NEW_CAMERA_SPATIAL_SOURCE_MISSING"));
});

test("the initial root camera does not require a transition from a nonexistent parent", () => {
  const plan = validPlan();
  plan.cameraGraph = {
    cameras: [{
      cameraId: "cam_1",
      segmentNos: [1],
      parentCameraId: "",
      parentSegmentNo: 0,
      relationToParent: "new_camera_setup",
      inheritanceReasonZh: "首个镜头，无父镜头。",
      missingInfo: [],
    }],
    relations: [],
  };
  assert.ok(!errorCodes(plan).includes("NEW_CAMERA_SPATIAL_SOURCE_MISSING"));
});

test("alternate view requires axis and left-right layout locks", () => {
  const plan = validPlan();
  plan.cameraGraph = {
    cameras: [
      { cameraId: "cam_0", segmentNos: [] },
      { cameraId: "cam_1", segmentNos: [1], parentCameraId: "cam_0", relationToParent: "alternate_view" },
    ],
    relations: [{ fromCameraId: "cam_0", toCameraId: "cam_1", relation: "alternate_view" }],
  };
  assert.ok(errorCodes(plan).includes("ALTERNATE_VIEW_AXIS_UNRESOLVED"));
});

test("hard anchors must be approved and selected before target generation", () => {
  const plan = validPlan();
  assert.throws(() => assertPlanValidForGeneration(plan, {
    stage: "keyframe_generation",
    targetArtifactId: "keyframe:1",
    requiredHardAnchorIds: ["person_1"],
    approvedHardAnchorIds: [],
    selectedHardAnchorIds: [],
  }), (error) => error instanceof PlanValidationError && error.issues.some((issue) => issue.code === "HARD_ANCHOR_IMAGE_MISSING"));
  assert.throws(() => assertPlanValidForGeneration(plan, {
    stage: "keyframe_generation",
    targetArtifactId: "keyframe:1",
    requiredHardAnchorIds: ["person_1"],
    approvedHardAnchorIds: ["person_1"],
    selectedHardAnchorIds: [],
  }), (error) => error instanceof PlanValidationError && error.issues.some((issue) => issue.code === "HARD_ANCHOR_NOT_SELECTED"));
});

test("camera relation scopes produce explicit inheritance and audit directives", () => {
  assert.deepEqual(cameraRelationDirectives("same_axis"), ["inherit camera axis", "inherit spatial direction", "framing may change"]);
  const plan = validPlan();
  plan.cameraGraph = {
    cameras: [
      { cameraId: "cam_0", segmentNos: [], axisDescription: "人物从左向右" },
      { cameraId: "cam_1", segmentNos: [1], parentCameraId: "cam_0", relationToParent: "alternate_view", axisDescription: "不越轴", spatialLayoutLock: "人物仍在产品左侧" },
    ],
    relations: [{ fromCameraId: "cam_0", toCameraId: "cam_1", relation: "alternate_view" }],
  };
  const context = resolveCameraInheritanceContext(plan, 1);
  assert.equal(context.relation, "alternate_view");
  assert.match(context.auditDirectives.join(" "), /180-degree axis/);
  assert.match(context.selectorDirective ?? "", /left-right/);
});

test("all prompt and regeneration paths are wired to Camera Graph and hard validation", () => {
  const service = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  const planner = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/three-stage-planner.ts"), "utf8");
  const audit = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/single-take-audit.ts"), "utf8");
  assert.match(service, /Camera Graph inheritance contract/);
  assert.match(service, /assertReferenceSelectionValid\(/);
  assert.match(service, /assertPlanValidForGeneration\(project\.planJson/);
  assert.doesNotMatch(service, /single_take_audit_softened|action: "softened_and_continued"/);
  assert.match(planner, /assertPlanValidForGeneration\(plan, \{ stage: "planning" \}\)/);
  assert.match(audit, /alternate_view_axis_or_left_right_lock_missing/);
});
