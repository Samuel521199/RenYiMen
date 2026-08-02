import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  ONE_PROMPT_IMAGE_PROMPT_GENERATION_TARGET_CHARS,
  ONE_PROMPT_MAX_REFERENCE_IMAGES,
} from "@/lib/one-prompt-video-limits";
import type {
  AnchorStateTimeline,
  ArtifactMetadata,
  CameraGraph,
  FinalTransitionPlan,
  GenerationQualityReport,
  NarrativeEvent,
  OnePromptVideoPlan,
  PlanValidationIssue,
  PlanVideoProjectInput,
  PromptDebugArtifact,
  ReferenceSelectionOutput,
  SegmentRenderDescription,
  StoryboardBrief,
  VideoAspectRatio,
  VideoAssetView,
  VideoAssetContract,
  VideoAudioPlan,
  VideoConsistencyAnchor,
  VideoCreativeCategory,
  VideoCreativeStrategy,
  VideoCreativeTemplateId,
  VideoMicroShot,
  VideoNarrativeMicroRules,
  VideoPlanKeyframe,
  VideoPlanningManifest,
  VideoSceneContract,
  VideoPlanSegment,
  VideoPromptDetailPlan,
  VideoStyleBible,
  VideoStoryBeat,
  VideoStoryEvidence,
  VideoStoryFunction,
  VideoStoryQualityReport,
  VideoStorySemanticReview,
  VideoStoryTraceFields,
  VideoShotGroupingPass,
  VideoTimelineBlueprintSegment,
} from "./types";
import {
  defaultCategoryForTemplate,
  deterministicTemplateForCategory,
  resolveCategoryTemplateMapping,
} from "./planning-route-mapping";
import { resolveChronologyHookPolicy } from "./planning-chronology-policy";
import { buildPlanningRouteInput } from "./planning-route-input-contract";
import {
  PLANNING_ROUTE_MODEL_CALL_POLICY,
  PlanningRouteModelCallError,
  buildPlanningRouteChatRequest,
  buildPlanningRouteUserPrompt,
  createOpenAiCompatiblePlanningRouteTransport,
  runPlanningRouteModelCall,
} from "./planning-route-model-call";
import {
  ROUTE_CLASSIFICATION_STAGE_CONTRACT_VERSION,
  createManualLockedRouteClassificationCheckpoint,
  createModelRouteClassificationCheckpoint,
  decideRouteCheckpointReuse,
  routeReferenceFactFingerprint,
  routeUserInputFingerprint,
  type RouteClassificationCheckpoint,
} from "./planning-route-checkpoint";
import {
  comparePlanningRouteContracts,
} from "./planning-route-invalidation";
import {
  createPlanningRouteLogRecord,
  type PlanningRouteLogEvent,
} from "./planning-route-telemetry";
import {
  assertRouteContractIsSoleAuthority,
  decidePlanningRouteRollout,
} from "./planning-route-rollout";
import {
  PLANNING_ARCHITECT_ROUTE_LOCK_RULES,
  applyApprovedRouteToPlanningArchitectOutput,
  approvedRouteContractForPlanningArchitect,
  mirrorApprovedRouteToCreativeStrategy,
  mirrorApprovedRouteToFinalPlan,
  PlanningArchitectRouteConflictError,
  type ApprovedPlanningRouteContract,
} from "./planning-route-planning-architect";
import { createVideoPlan } from "./planner";
import {
  advanceStructuredFailureState,
  formatStructuredContractIssues,
  sanitizeStructuredCandidate,
  shouldStopStructuredFailureRetry,
  systemicStructuredFailureSegments,
  structuredContractIssueFingerprint,
  structuredStageJsonSchema,
  validateStructuredStageValue,
  type StructuredContractIssue,
  type StructuredFailureState,
  type StructuredStageContract,
} from "./structured-stage-contract";
import {
  segmentCameraMotionTypes,
  segmentShotDecomposerContract,
  segmentShotDecomposerExample,
  type SegmentShotDecomposerOutput,
} from "./segment-shot-decomposer-contract";
import { JsonStageStreamAssembler } from "./json-stage-stream-assembler";
import {
  repairJsonDeterministically,
  validateJsonRepairSemanticPreservation,
} from "./deterministic-json-repair";
import {
  referenceFactContract,
  referenceFactsPromptExampleJson,
} from "./reference-fact-contract";
import {
  buildJsonSyntaxRepairUserPrompt,
  JSON_SYNTAX_REPAIR_SYSTEM_PROMPT,
  jsonSyntaxRepairModel,
} from "./json-syntax-repair-contract";
import {
  isStructuredOutputSyntaxError,
  StructuredOutputSyntaxError,
} from "./structured-output-error";
import {
  jsonParseErrorDiagnostic,
  structuredContentDiagnostic,
  structuredContentDiff,
} from "./structured-output-diagnostics";
import {
  deriveCanonicalBoundaryContracts,
  validateBoundaryContracts,
} from "./boundary-contract";
import {
  compileAssetImagePromptEn,
  ASSET_IMAGE_CONTRACT_MAX_JSON_CHARS,
  isChinesePromptDisplayCopy,
  validatePlanningAssetImageContracts,
  validatePlanningAssetExecutionPrompts,
  type AssetImageContractIssue,
} from "./asset-image-contract";
import {
  assessAssetVisualSpecEligibility,
  isReferenceImageEligibleAnchor,
  isVisibleEvidenceAnchor,
  normalizeAnchorSemantics,
} from "./anchor-semantics";
import {
  adjudicateConsistencyAnchorCandidates,
  type AnchorAdmissionResult,
} from "./anchor-admission";
import { normalizePlayingCardContract } from "./playing-card-contract";
import { errorForLog, logOnePromptVideo } from "./logger";
import { isOnePromptVideoScriptQaEnabled } from "./script-qa-config";
import { assertPlanValidForGeneration, validateOnePromptVideoPlan } from "./plan-validator";
import { repairMotionfulEndpointContracts } from "./frame-contract";
import { auditSingleTakePlan, type SingleTakeAuditResult } from "./single-take-audit";
import { deriveCameraGraphFromStoryboardBrief } from "./camera-graph";
import {
  validateVideoPromptContract,
  videoPromptContractFromUnknown,
} from "./video-terminal-contract";
import { decideStoryRewrite, markStoryRewriteRequired, withStoryQualityGate, type StoryRewriteDecision } from "./story-quality-gate";
import {
  readStoryRolloutConfig,
  shouldEnableShotGrouping,
  shouldEvaluateStoryQuality,
  shouldRequireStoryQualityReview,
  type OnePromptVideoStoryRolloutConfig,
} from "./story-rollout-config";
import {
  StoryboardStageError,
  runStoryboardStageWithRetry,
  storyboardContractValidationFeedback,
} from "./storyboard-stage-retry";
import {
  requiredStoryFunctionsForTemplate,
  validatePlanningNarrativeContract,
  validateStoryboardStoryContract,
  type PlanningNarrativeContractIssue,
  type PlanningNarrativeContractResult,
  type StoryContractGateResult,
} from "./story-contract-gate";
import {
  applyCreativeStrategyPatches,
  applyEventAuthorityToCreativeStrategy,
  applyEventStoryFunctionPatches,
  creativeStrategyBindingFingerprint,
  deterministicLegacyOrderFallback,
  materializeNarrativeEventStoryFunctions,
  planningContractIssueFingerprint,
  shouldEscalatePlanningContractRepair,
  type CreativeStrategyPatch,
  type EventStoryFunctionPatch,
  type PlanningContractRepairAttempt,
} from "./planning-narrative-authority";
import {
  acquireProviderCapacity,
  releaseProviderLeaseByToken,
  withProviderCapacity,
  type ProviderLeaseGrant,
  type ProviderSchedulingContext,
} from "./provider-capacity";
import {
  effectiveAnchorIdsForChild,
  resolveAssetContract,
  targetForKeyframe,
  targetForSegment,
} from "./asset-contract-resolver";
import {
  normalizeStorySemanticReview,
  STORY_SEMANTIC_CRITIC_SYSTEM_PROMPT,
  STORY_SEMANTIC_REPAIR_SYSTEM_PROMPT,
} from "./story-semantic-critic";
import {
  advanceRepairConvergence,
  type RepairConvergenceDecision,
} from "./repair-convergence-controller";
import {
  buildModelRepairPlan,
  diffDeterministicChanges,
  type ModelRepairPlan,
} from "./repair-plan";

const MIN_SEGMENT_SECONDS = 3;
const MAX_SEGMENT_SECONDS = 15;
const MAX_SINGLE_TAKE_REVISIONS = 3;
const MAX_STORY_QUALITY_REWRITES = 2;
const MAX_JSON_REPAIR_INPUT_CHARS = 60000;
const DEFAULT_JSON_STAGE_TIMEOUT_MS = 180000;
const REFERENCE_FACT_STAGE_MAX_ATTEMPTS = 2;
const referenceFactCache = new Map<string, Promise<unknown>>();

const STRUCTURED_REPAIR_EXECUTION_RULES = `

STRUCTURED REPAIR EXECUTION CONTRACT
- repair_plan is authoritative and mandatory.
- Execute every operation in repair_plan.operations and do not invent additional operations.
- action states whether to add, update, delete, or move content; path identifies the exact authorized location.
- Preserve every repair_plan.globalPreserveRules item and every operation.preservePaths item.
- Return repair_execution with repair_plan_id and one result per operation_id.
- Each result must state status=applied|not_applicable, the exact path, and a concise change_summary.
- Do not report applied unless the returned JSON actually contains that change.
- The application will reject unauthorized scope changes and re-run deterministic acceptance checks.`;

type StoryTemplateBeatDefinition = {
  storyFunction: VideoStoryFunction;
  titleZh: string;
  cause: string;
  effect: string;
  informationUnit: string;
  actionContinuity?: NonNullable<VideoStoryTraceFields["actionContinuity"]>;
  reactionBeat?: string;
  powerShift?: string;
};

const STORY_TEMPLATE_DEFINITIONS: Record<VideoCreativeTemplateId, {
  videoCategory: VideoCreativeCategory;
  conversionGoalZh: string;
  templateReasonZh: string;
  minimumBeats: StoryTemplateBeatDefinition[];
}> = {
  game_reversal: {
    videoCategory: "game",
    conversionGoalZh: "让用户相信自己也能从劣势中翻盘并立即试玩。",
    templateReasonZh: "适合有对手、失败压力、关键操作、反超爽点的游戏广告。",
    minimumBeats: [
      { storyFunction: "hook", titleZh: "逆风开局", cause: "玩家处于明显劣势", effect: "观众想知道如何翻盘", informationUnit: "展示失败压力和对手优势" },
      { storyFunction: "conflict", titleZh: "最后机会", cause: "资源或时间快耗尽", effect: "行动动机被建立", informationUnit: "明确胜负条件" },
      { storyFunction: "turning_point", titleZh: "关键操作触发", cause: "主角执行可见操作", effect: "局势开始改变", informationUnit: "展示触发动作", actionContinuity: { motivationOrPreparation: "主角观察局势并决定冒险", execution: "主角完成关键点击/下注/技能释放", resultOrReaction: "奖励、牌面或战局开始反转" }, reactionBeat: "对手或旁观者露出震惊反应", powerShift: "主角从劣势转为掌控局面" },
      { storyFunction: "payoff", titleZh: "反超胜利", cause: "关键操作兑现结果", effect: "爽点成立", informationUnit: "展示胜利结果和奖励", actionContinuity: { motivationOrPreparation: "反转迹象已经出现", execution: "奖励/分数/牌局完成结算", resultOrReaction: "主角庆祝，对手震惊" }, reactionBeat: "主角和社交圈庆祝", powerShift: "主角成为赢家" },
      { storyFunction: "cta", titleZh: "立即试玩", cause: "观众刚看到可复制的爽点", effect: "引导下载或试玩", informationUnit: "Play now / Download" },
    ],
  },
  game_bonus_payoff: {
    videoCategory: "game",
    conversionGoalZh: "突出奖励机制和即时爽感，推动用户试玩。",
    templateReasonZh: "适合以 bonus、combo、倍率、爆奖为核心卖点的游戏广告。",
    minimumBeats: [
      { storyFunction: "hook", titleZh: "奖励即将触发", cause: "画面出现接近奖励的状态", effect: "观众期待爆点", informationUnit: "展示奖励条件" },
      { storyFunction: "turning_point", titleZh: "触发 bonus", cause: "主角完成最后一步操作", effect: "奖励机制启动", informationUnit: "展示触发动作", actionContinuity: { motivationOrPreparation: "主角识别 bonus 机会", execution: "完成最后一步操作", resultOrReaction: "bonus UI/奖励动效开始" }, reactionBeat: "主角露出惊喜反应", powerShift: "普通局面升级为高奖励局面" },
      { storyFunction: "payoff", titleZh: "奖励爆发", cause: "bonus 被成功触发", effect: "爽点兑现", informationUnit: "展示金币、倍率或奖励结果", actionContinuity: { motivationOrPreparation: "bonus 已启动", execution: "奖励连锁释放", resultOrReaction: "主角庆祝奖励结果" }, reactionBeat: "观众角色/朋友震惊", powerShift: "主角获得明显收益" },
      { storyFunction: "cta", titleZh: "领取奖励", cause: "奖励爽感已经建立", effect: "引导试玩", informationUnit: "Download / Claim bonus" },
    ],
  },
  product_problem_solution: {
    videoCategory: "product",
    conversionGoalZh: "让用户理解产品解决了具体问题并产生购买信任。",
    templateReasonZh: "适合护肤品、日用品、工具类产品的痛点-证明-结果广告。",
    minimumBeats: [
      { storyFunction: "hook", titleZh: "真实痛点", cause: "用户遇到具体困扰", effect: "观众产生代入", informationUnit: "展示使用前问题" },
      { storyFunction: "proof", titleZh: "产品介入", cause: "痛点需要解决方案", effect: "产品价值开始被证明", informationUnit: "展示成分、使用方式或卖点证据" },
      { storyFunction: "payoff", titleZh: "效果证明", cause: "产品持续作用", effect: "前后差异可见", informationUnit: "展示改善结果", actionContinuity: { motivationOrPreparation: "用户决定尝试产品", execution: "按正确方式使用产品", resultOrReaction: "用户看到改善并露出轻松/满意反应" }, reactionBeat: "用户自信或安心", powerShift: "从被问题困扰转为掌控状态" },
      { storyFunction: "cta", titleZh: "品牌购买引导", cause: "效果和信任已经建立", effect: "引导购买/了解更多", informationUnit: "品牌、优惠或购买入口" },
    ],
  },
  ecommerce_offer_conversion: {
    videoCategory: "ecommerce",
    conversionGoalZh: "用痛点、卖点证明和限时优惠推动下单。",
    templateReasonZh: "适合电商短视频，强调需求、产品证明、优惠紧迫和下单 CTA。",
    minimumBeats: [
      { storyFunction: "hook", titleZh: "下单前痛点", cause: "用户有迫切需求", effect: "观众理解购买理由", informationUnit: "展示痛点场景" },
      { storyFunction: "proof", titleZh: "卖点证明", cause: "产品解决痛点", effect: "购买信任上升", informationUnit: "展示核心卖点/规格/场景效果" },
      { storyFunction: "payoff", titleZh: "优惠出现", cause: "价值已经证明", effect: "形成行动紧迫感", informationUnit: "价格、赠品、限时优惠", reactionBeat: "用户觉得现在买更划算", powerShift: "从犹豫转为下单理由充分" },
      { storyFunction: "cta", titleZh: "立即下单", cause: "优惠窗口有限", effect: "引导点击购买", informationUnit: "Order now / Buy now" },
    ],
  },
  food_sensory_reaction: {
    videoCategory: "food",
    conversionGoalZh: "用制作过程、感官刺激和顾客反应引发到店或下单欲望。",
    templateReasonZh: "适合餐饮广告，围绕食材、制作、香气口感、顾客反应和门店 CTA。",
    minimumBeats: [
      { storyFunction: "hook", titleZh: "食材/出餐吸引", cause: "热腾腾的制作瞬间出现", effect: "观众被食欲吸引", informationUnit: "展示食材或出餐动作" },
      { storyFunction: "proof", titleZh: "感官证明", cause: "制作过程释放香气和质感", effect: "味觉想象增强", informationUnit: "热气、汤汁、拉丝、酥脆、色泽" },
      { storyFunction: "reaction", titleZh: "顾客第一口反应", cause: "食物被端到顾客面前", effect: "美味被人类反应证明", informationUnit: "顾客表情和动作", actionContinuity: { motivationOrPreparation: "顾客闻到香气准备品尝", execution: "顾客吃下第一口", resultOrReaction: "顾客露出满足反应" } },
      { storyFunction: "cta", titleZh: "门店/套餐 CTA", cause: "食欲和信任已经建立", effect: "引导到店、团购或下单", informationUnit: "门店名、套餐、地址或立即下单" },
    ],
  },
  auto_performance_hero: {
    videoCategory: "auto",
    conversionGoalZh: "突出车辆性能、质感和驾驶向往，推动预约试驾或咨询。",
    templateReasonZh: "适合汽车或交通工具广告，强调外观、性能场景、驾驶体验和 CTA。",
    minimumBeats: [
      { storyFunction: "hook", titleZh: "视觉登场", cause: "车辆以强视觉姿态出现", effect: "建立高级感和注意力", informationUnit: "外观、灯光、道路环境" },
      { storyFunction: "proof", titleZh: "性能证明", cause: "车辆进入动态场景", effect: "性能可信", informationUnit: "加速、操控、空间或智能功能" },
      { storyFunction: "payoff", titleZh: "驾驶向往", cause: "性能和质感被证明", effect: "形成拥有欲", informationUnit: "驾驶者反应和英雄镜头", reactionBeat: "驾驶者自信/愉悦", powerShift: "从观察车辆转为想象拥有" },
      { storyFunction: "cta", titleZh: "预约试驾", cause: "向往已经建立", effect: "引导留资或试驾", informationUnit: "Book a test drive" },
    ],
  },
  short_drama_conflict_twist: {
    videoCategory: "short_drama",
    conversionGoalZh: "用人物关系、冲突、反转和悬念推动继续观看。",
    templateReasonZh: "适合剧情短片，重点是人物关系、误会/冲突、反转线索和悬念收束。",
    minimumBeats: [
      { storyFunction: "hook", titleZh: "关系悬念", cause: "人物处在不稳定关系中", effect: "观众想知道发生了什么", informationUnit: "人物关系和情绪状态" },
      { storyFunction: "conflict", titleZh: "冲突升级", cause: "误会、压力或秘密被揭开", effect: "情绪张力增加", informationUnit: "冲突原因" },
      { storyFunction: "turning_point", titleZh: "反转线索", cause: "关键物件/一句话/动作出现", effect: "观众重新理解关系", informationUnit: "反转证据", actionContinuity: { motivationOrPreparation: "角色准备离开或做出决定", execution: "反转线索出现", resultOrReaction: "角色停下并重新判断" }, reactionBeat: "角色震惊/迟疑/心软", powerShift: "信息优势从隐藏方转向主角或观众" },
      { storyFunction: "cliffhanger", titleZh: "悬念停顿", cause: "反转刚刚成立", effect: "推动继续观看", informationUnit: "未揭晓的下一步" },
    ],
  },
  generic_brand_story: {
    videoCategory: "brand",
    conversionGoalZh: "用通用 hook、冲突、证明、payoff 和 CTA 建立品牌记忆或行动。",
    templateReasonZh: "当分类不确定时使用，避免套用游戏、餐饮、电商等垂直语义。",
    minimumBeats: [
      { storyFunction: "hook", titleZh: "开场注意力", cause: "提出一个清晰问题或愿景", effect: "观众理解主题", informationUnit: "品牌/主题 hook" },
      { storyFunction: "conflict", titleZh: "阻力或需求", cause: "目标尚未达成", effect: "故事需要推进", informationUnit: "问题、阻力或未满足需求" },
      { storyFunction: "proof", titleZh: "解决路径", cause: "品牌/人物采取行动", effect: "可信度建立", informationUnit: "证据、过程或场景证明" },
      { storyFunction: "payoff", titleZh: "价值兑现", cause: "解决路径奏效", effect: "主题被记住", informationUnit: "结果、情绪或品牌价值" },
      { storyFunction: "cta", titleZh: "行动引导", cause: "价值已经兑现", effect: "引导了解、关注或购买", informationUnit: "CTA" },
    ],
  },
};

const STORY_QUALITY_REWRITE_SYSTEM_PROMPT = `You are Story Quality Rewrite Planner for a controllable AI video pipeline.

Return only valid JSON. No markdown, explanations, comments, or extra text.

Your job:
- Repair a weak video plan according to Story Quality Gate issues.
- Preserve aspect ratio, total duration, segment count, segment numbers, segment start/end times, boundary keyframe numbers, consistency anchors, asset library intent, style bible, and camera continuity constraints.
- Do not turn a non-game video into a game ad. Do not use bonus, jackpot, cards, coins, opponent shock, leaderboard, or win streak unless the selected category is game.
- If rewrite_from_stage is creative_strategy, rewrite creative_strategy and all downstream story_beats, storyboard_brief, shot_grouping_pass, keyframes, segments, and prompt_detail_plan.
- If rewrite_from_stage is beat_sheet, preserve creative_strategy but rewrite story_beats and all downstream storyboard/prompt fields.
- If rewrite_from_stage is storyboard, preserve creative_strategy and story_beats but rewrite storyboard_brief, keyframes, segments, segment_render_descriptions, and prompt_detail_plan.
- Every payoff, win, conversion, order, transformation, or reward must have a visible prior trigger/proof and a reactionBeat.
- Every turning_point/proof/payoff must include action_continuity with motivation_or_preparation, execution, and result_or_reaction.
- Every segment must provide a new information_unit, linked_beat_ids, story_function, cause, effect, and key_evidence_ids when evidence matters.
- References are assets and identity/style constraints, not the story itself.

Output contract:
{
  "story_quality_rewrite_plan": {
    "rewrite_from_stage": "creative_strategy | beat_sheet | storyboard",
    "creative_strategy": {},
    "story_beats": [],
    "shot_grouping_pass": {},
    "storyboard_brief": [],
    "segment_render_descriptions": [],
    "keyframes": [],
    "segments": [],
    "prompt_detail_plan": {},
    "rewrite_notes": []
  }
}`;

type PlanStructureExtras = {
  narrativeEvents: NarrativeEvent[];
  creativeStrategy: VideoCreativeStrategy;
  storyBeats: VideoStoryBeat[];
  evidenceRegistry: VideoStoryEvidence[];
  assetContract?: VideoAssetContract;
  narrativeMicroRules: VideoNarrativeMicroRules;
  shotGroupingPass?: VideoShotGroupingPass;
  storyQualityReport: VideoStoryQualityReport;
  storySemanticReview?: VideoStorySemanticReview;
  anchorStateTimeline: AnchorStateTimeline[];
  audioBible: Record<string, unknown>;
  candidateTimeline: VideoTimelineBlueprintSegment[];
  storyboardBrief: StoryboardBrief[];
  segmentRenderDescriptions: SegmentRenderDescription[];
  cameraGraph?: CameraGraph;
  sceneContracts: VideoSceneContract[];
  transitionReferencePlan: unknown[];
  finalTransitionPlan: FinalTransitionPlan[];
  referenceSelectionOutputs: ReferenceSelectionOutput[];
  promptDebugArtifacts: Record<string, PromptDebugArtifact>;
  artifactMetadata: Record<string, ArtifactMetadata>;
  generationQualityReports: GenerationQualityReport[];
  warnings: string[];
};

type ShotGroupingSplitReason = NonNullable<VideoShotGroupingPass["splitReasons"]>[number];

const PLANNING_ARCHITECT_SYSTEM_PROMPT = `You are Planning Architect for a controllable AI video pipeline.

Return only valid JSON. No markdown, explanations, or comments.

Your only job in stage 1:
- Understand the user's video task.
- Accept approved_route_contract as immutable. Do not choose video_category, template_id, chronology_mode, or Hook policy.
- Construct causal narrative_events from the approved route. Only after the event chain exists, derive creative_strategy hook, conflict, turning point, payoff, and CTA from those events. Creative prose must summarize bound events and must never invent a second story.
- Do not use game-only semantics such as bonus, jackpot, opponent shock, cards, coins, leaderboard, or win streak unless video_category is game.
- If approved_route_contract conflicts with immutable input, return route_contract_error. Never select another template or private fallback.
- First decompose the task into narrative_events before deciding the segment timeline.
- Bind every creative function to narrative_events through hook_event_ids, conflict_event_ids, turning_point_event_ids, payoff_event_ids, and cta_event_ids.
- Default chronology_mode to chronological. In chronological mode, the hook may establish a pain point, curiosity gap, or partial tease, but it must not fully reveal the turning point, payoff, reward, solution, victory, or final product state.
- Use flashforward_hook only when an intentional climax preview materially improves the concept. Then set hook_mode=payoff_preview, hook_reveal_level=partial or full, and return_to_event_id to the earlier event where chronological storytelling resumes.
- The same event must not serve as both hook and turning point in chronological mode.
- Output narrative_micro_rules so later stages know which story failures to avoid, especially sudden outcome, reference-only animation, missing visible trigger, and CTA before payoff.
- Decide which objects, states, visual rules, and task elements must stay consistent across the whole video.
- For every consistency anchor, separate static visual locks from dynamic state changes across the story.
- Output anchor_state_timeline so later stages can distinguish legal state evolution from identity drift.
- Decide whether this video needs editorial overlay subtitles, and if needed define their role, language, timing, placement, readability, and editability requirements.
- Derive candidate_timeline and planning_manifest.timeline_blueprint from narrative_events. Do not invent segment boundaries without event reasons.
- Do not write detailed narrative keyframes, video prompts, or micro-shot prompts.
- You MUST write one executable English asset-sheet image contract for every anchor with needs_reference_image=true. This is an isolated reusable generation specification, not a narrative keyframe. Do not output localized prompt copies.

Hard rules:
- Every segment duration must be 3-15 seconds.
- Total segment duration must equal duration_seconds exactly.
- Segment count must be between segment_count_min and segment_count_max.
- You, not application code, must allocate every segment's duration from its event complexity, action path, subtitle/CTA readability, emotional rhythm, camera travel, and physically reachable start-to-end state.
- Never obtain segment durations by simply dividing duration_seconds by segment_count unless you independently justify why every segment has genuinely equal timing needs.
- Every segment must output duration_reason_zh, minimum_executable_seconds, preferred_duration_seconds, maximum_useful_seconds, and timing_budget.
- timing_budget.setup_seconds + timing_budget.action_seconds + timing_budget.result_seconds must equal duration_seconds for that segment exactly.
- minimum_executable_seconds <= duration_seconds <= maximum_useful_seconds, and preferred_duration_seconds must remain inside the same range.
- Do not default to 6 segments for 30 seconds. Choose by task complexity, information rhythm, subtitle rhythm, action continuity, scene changes, and generation continuity risk.
- Every segment must be generatable as one continuous unbroken camera take. A segment is not a montage container.
- If a beat requires a location change, environment replacement, large time jump, major camera setup change, major composition reset, subject teleport, product state discontinuity, or dissolve-like transformation, create a new segment boundary instead of putting that change inside one segment.
- Start and end boundary frames of the same segment must be compatible as two moments from the same continuous shot: same location logic, same camera axis family, same subject/product identity, same lighting direction, and no impossible scene jump.
- Identify consistency anchors dynamically. Do not assume every task has a product. Anchors may be person, product, prop, location, style, palette_mood, graphic_backdrop, brand_visual, task_object, effect_state, vehicle, food, space_layout, or custom.
- Keep palette_mood in global_style whenever possible. A palette, saturation level, color temperature, lighting mood, bokeh, blur, gradient, abstract color field, or festive atmosphere is not a location and must not become a scene/space-layout reference image.
- A reusable physical scene and a visual style guide are different contracts. Never make one anchor serve both roles. palette_mood/style/graphic_backdrop has needs_reference_image=false and is not an asset-review item.
- Use graphic_backdrop only for an explicitly reusable brand motif, pattern, or texture. It is a soft graphic reference, never physical space-layout evidence.
- Create location/space_layout only for a physical environment with stable reusable geometry: at least two concrete foreground/midground/background structures and measurable spatial relationships. If those facts are absent, do not invent a scene asset to make the schema look complete.
- If two or more narrative events intentionally occur in one continuous physical space, create one dedicated location/space_layout anchor for that space. It must use semantic_role=physical_scene, reference_usage.role=scene_layout, needs_reference_image=true, and contain an empty-set overview contract with foreground, midground, background_layer, fixed landmarks, subject placement zones, and at least two directional or measurable spatial relationships. Color atmosphere belongs in global_style or a separate palette_mood anchor, never in this layout anchor.
- palette_mood, style, and graphic_backdrop are never requiredVisibleEvidence and must not enter required_anchor_ids merely because their color or rendering treatment applies globally.
- A consistency-anchor image prompt is an asset-sheet prompt, not a narrative keyframe. Keep identity/appearance facts, but remove story actions, screen positions, title interactions, scene decoration, and event-specific composition.
- For every anchor with needs_reference_image=true, asset_image_contract is mandatory. Never use placeholders such as "fixed spatial layout", "lighting direction", "color atmosphere", "main background structure", "clear presentation", or "high quality" unless you replace them with actual visible values.
- Every asset_image_contract must make the result mechanically checkable: exact subject count; concrete subject description; framing; camera angle; placement; frame occupancy; named background; lighting direction and quality; forbidden elements; and at least two acceptance criteria.
- Every person asset_image_contract must also preserve the reference-derived rendering medium through rendering_style.medium, dimensionality, shading, edge_treatment, surface_treatment, depth_treatment, authority, and forbidden_drift. "Cartoon" alone is invalid because it does not distinguish 2D illustration from stylized 3D CGI.
- Person/product/prop/task-object/vehicle/food contracts must list concrete identity, geometry, clothing, marking, or material details. Scene/location/space-layout contracts must separately specify foreground, midground, far background, and at least two explicit spatial relationships or distances.
- Every natural-language value in asset_image_contract must use English. The application compiles the English provider execution prompt from this single contract.
- Keep each complete compiled English execution prompt at or below ${ONE_PROMPT_IMAGE_PROMPT_GENERATION_TARGET_CHARS} characters. Use compact visible attribute clauses and remove explanations, repetition, synonyms, and ornamental quality phrases without dropping any contract fact.
- A prop prompt must be operationally specific rather than generic: state the exact object count, named variants, face/orientation, arrangement, material, colors, intrinsic markings, and forbidden extra objects. If the prop is a playing card, explicitly name every required rank and suit and require matching corner indices; never combine "A/K must be visible" with a blanket "no text" instruction.
- For a person anchor, asset_image_contract must request exactly one character, one requested view, centered and clearly visible on a plain white or light-neutral studio background. It must explicitly forbid scenery, decorative backgrounds, text, titles, logos, UI, frames, collages, and duplicate people.
- Reference images may contain a finished poster or advertisement. Extract the anchor's stable identity only; never copy the reference image's background, typography, logo placement, framing, or full composition into a person asset prompt.
- Scene/location anchors may describe the environment. Brand-visual anchors may describe approved logos or typography. Do not leak those elements into person, prop, or product asset prompts unless they are an intrinsic part of that asset.
- Every narrative_event must include event_id, story_functions, dramatic_goal, participants, location_id, initial_state, action, resulting_state, required_anchor_ids, previous_event_ids, and must_become_separate_segment.
- story_functions is the authoritative source for hook, conflict, turning_point, payoff, and CTA event bindings. Assign only responsibilities visibly supported by the event. Adjacent functions may share one event.
- previous_event_ids must only reference earlier narrative_events.
- required_anchor_ids must exist in consistency_manifest. If you discover a needed anchor, add it to consistency_manifest before referencing it.
- Every candidate_timeline segment and every planning_manifest.timeline_blueprint segment must include source_event_ids.
- If any source event has must_become_separate_segment=true, do not merge it with unrelated events unless split_reason_zh explicitly explains why this remains a single continuous take.
- anchor_state_timeline must record each dynamic anchor's anchor_id and states with segment_no or event_id, start_state, end_state, start_position, end_position, holder_at_start, holder_at_end, and visible_transition_path.
- A product/prop cannot occupy two mutually exclusive places at the same time unless consistency_manifest explicitly defines multiple instances.
- Holder changes must have a visible_transition_path or an event explanation.
- The timeline_blueprint is a hard contract for later stages.
- In chronological mode keep hook, conflict, turning_point, payoff, and CTA in nondecreasing event order whenever those functions apply. Adjacent functions may bind the same observable event when one action legitimately carries both roles (for example, one decisive card play can be both conflict and turning_point). Reject only actual reversal. Strategy event bindings, narrative_events, and timeline source_event_ids must describe one identical causal chain. The dedicated chronological hook rules still forbid hook/turning-point overlap and a full payoff reveal.
- Emit the top-level sections in the dependency order shown below: classification, consistency_manifest, narrative_events, creative_strategy, narrative_micro_rules, anchor_state_timeline, audio_bible, candidate_timeline, planning_manifest.
- classification is the single source of truth for video_type, video_category, template_id, template_reason_zh, chronology_mode, and fallback_reason_zh. Do not duplicate those fields inside creative_strategy.
- Finish the anchor registry and causal narrative_events before emitting creative_strategy. Every creative_strategy event ID must reference an event already emitted above. The application deterministically derives those event IDs from narrative_events.story_functions; any compatibility event ID fields you emit must exactly match that derivation.

Return this JSON shape:
{
  "classification": {
    "video_type": "game_ad | product_ad | ecommerce_ad | food_ad | short_drama | brand_film | tutorial | custom",
    "video_category": "game | product | ecommerce | food | auto | short_drama | brand | tutorial | custom",
    "template_id": "game_reversal | game_bonus_payoff | product_problem_solution | ecommerce_offer_conversion | food_sensory_reaction | auto_performance_hero | short_drama_conflict_twist | generic_brand_story",
    "template_reason_zh": "",
    "chronology_mode": "chronological | flashforward_hook | result_first | problem_solution | demonstration",
    "fallback_reason_zh": ""
  },
  "consistency_manifest": {
    "anchors": [
      {
        "id": "main_character",
        "type": "person",
        "display_name_zh": "",
        "display_name_en": "",
        "must_stay_consistent": true,
        "needs_reference_image": true,
        "reference_strength": "hard",
        "description_zh": "",
        "description_en": "",
        "visual_lock": {
          "shape": "",
          "material": "",
          "color": "",
          "markings": "",
          "scale": "",
          "state": "",
          "forbidden_drift": []
        },
        "applies_to": ["keyframes", "segments", "micro_shots"],
        "user_editable": true,
        "asset_image_contract": {
          "subject_count": 1,
          "subject_description": "concrete visible identity or environment description",
          "composition": {
            "framing": "exact shot size",
            "camera_angle": "exact camera height, angle, and facing direction",
            "placement": "exact placement in frame",
            "occupancy": "approximate frame occupancy percentage"
          },
          "environment": {
            "background": "named background, not a placeholder",
            "foreground": "required for scene/location/space_layout",
            "midground": "required for scene/location/space_layout",
            "background_layer": "required for scene/location/space_layout",
            "spatial_relationships": ["A is left/right/in front of B with distance", "C is behind/beyond D"]
          },
          "lighting": {
            "direction": "named direction such as upper-left/front-right/backlight",
            "quality": "hard/soft and shadow behavior",
            "color_temperature": "warm/cool/neutral or Kelvin description"
          },
          "rendering_style": {
            "medium": "concrete medium such as stylized 3D CGI",
            "dimensionality": "2d | 2.5d | 3d | mixed",
            "shading": "concrete shading and volume treatment",
            "edge_treatment": "outline or edge treatment",
            "surface_treatment": "concrete surface language",
            "depth_treatment": "flat, layered, volumetric, or depth-of-field treatment",
            "authority": "user_reference | global_style | planner",
            "forbidden_drift": ["specific incompatible rendering style"]
          },
          "palette": ["named color 1", "named color 2"],
          "material_details": ["concrete material/surface detail"],
          "intrinsic_details": ["identity-locked detail 1", "identity-locked detail 2", "identity-locked detail 3"],
          "forbidden_elements": ["unrelated character", "unrelated prop", "text", "logo", "UI"],
          "acceptance_criteria": ["visually verifiable criterion 1", "visually verifiable criterion 2"]
        }
      }
    ]
  },
  "narrative_events": [
    {
      "event_id": "event_1",
      "story_functions": ["hook", "conflict"],
      "dramatic_goal": "",
      "participants": [],
      "location_id": "",
      "initial_state": "",
      "action": "",
      "resulting_state": "",
      "required_anchor_ids": [],
      "previous_event_ids": [],
      "must_become_separate_segment": true
    }
  ],
  "creative_strategy": {
    "hook_mode": "pain_point | curiosity | tease | payoff_preview",
    "hook_reveal_level": "none | partial | full",
    "hook_event_ids": ["event_1"],
    "conflict_event_ids": ["event_2"],
    "turning_point_event_ids": ["event_3"],
    "payoff_event_ids": ["event_4"],
    "cta_event_ids": ["event_5"],
    "return_to_event_id": "",
    "conversion_goal_zh": "",
    "audience_zh": "",
    "core_promise_zh": "",
    "hook_zh": "",
    "conflict_zh": "",
    "turning_point_zh": "",
    "payoff_zh": "",
    "cta_zh": "",
    "emotional_arc": [],
    "selling_point_ids": [],
    "reference_usage_strategy_zh": "",
    "risks": []
  },
  "narrative_micro_rules": {
    "causal_chain_required": true,
    "forbid_sudden_outcome": true,
    "forbid_reference_only_animation": true,
    "require_hook_before_asset_showcase": true,
    "require_payoff_before_cta": true,
    "require_reaction_after_turning_point": true,
    "require_visible_trigger_before_state_change": true,
    "required_beat_functions": ["hook", "setup", "conflict", "turning_point", "payoff", "cta"],
    "forbidden_patterns": [],
    "continuity_rules": [],
    "cta_rules": []
  },
  "anchor_state_timeline": [
    {
      "anchor_id": "",
      "states": [
        {
          "event_id": "event_1",
          "segment_no": 1,
          "start_state": "",
          "end_state": "",
          "start_position": "",
          "end_position": "",
          "holder_at_start": "",
          "holder_at_end": "",
          "visible_transition_path": ""
        }
      ]
    }
  ],
  "audio_bible": {
    "overall_strategy_zh": "",
    "voice_consistency_zh": "",
    "music_mood_zh": "",
    "sound_effect_rules_zh": ""
  },
  "candidate_timeline": [
    {
      "segment_no": 1,
      "start_time_seconds": 0,
      "end_time_seconds": 5,
      "duration_seconds": 5,
      "duration_reason_zh": "Why this event needs this exact amount of screen time",
      "minimum_executable_seconds": 4,
      "preferred_duration_seconds": 5,
      "maximum_useful_seconds": 7,
      "timing_budget": {
        "setup_seconds": 1,
        "action_seconds": 3,
        "result_seconds": 1
      },
      "source_event_ids": [],
      "purpose_zh": "",
      "split_reason_zh": "",
      "required_anchor_ids": []
    }
  ],
  "planning_manifest": {
    "project_intent": {
      "video_type": "product_ad | short_drama | tutorial | ecommerce | brand_film | custom",
      "primary_goal_zh": "",
      "primary_goal_en": "",
      "target_viewer_zh": "",
      "target_viewer_en": "",
      "success_criteria": []
    },
    "story_strategy": {
      "narrative_arc_zh": "",
      "narrative_arc_en": "",
      "recommended_segment_density": "low | medium | high",
      "subtitle_strategy_zh": "",
      "audio_strategy_zh": ""
    },
    "subtitle_policy": {
      "needed": true,
      "reason_zh": "",
      "content_role": "none | brand_slogan | product_selling_points | voiceover_caption | dialogue_caption | emotional_copy | instructional_steps | custom",
      "language": "zh-CN",
      "style_zh": "",
      "timing_strategy_zh": "",
      "placement_zh": "",
      "max_chars_per_line": 14,
      "max_lines": 2,
      "avoid_regions_zh": [],
      "user_editable": true
    },
    "timeline_blueprint": {
      "segment_count": 0,
      "total_duration_seconds": 0,
      "segment_duration_min_seconds": 3,
      "segment_duration_max_seconds": 15,
      "split_strategy_zh": "",
      "segments": [
        {
          "segment_no": 1,
          "start_time_seconds": 0,
          "end_time_seconds": 5,
          "duration_seconds": 5,
          "duration_reason_zh": "Why this event needs this exact amount of screen time",
          "minimum_executable_seconds": 4,
          "preferred_duration_seconds": 5,
          "maximum_useful_seconds": 7,
          "timing_budget": {
            "setup_seconds": 1,
            "action_seconds": 3,
            "result_seconds": 1
          },
          "beat_role": "hook | setup | interaction | proof | payoff | ending | custom",
          "purpose_zh": "",
          "purpose_en": "",
          "split_reason_zh": "",
          "subtitle_intent_zh": "",
          "audio_intent_zh": "",
          "required_anchor_ids": [],
          "source_event_ids": [],
          "boundary_mode_hint": "continuous | hard_cut | dissolve | match_cut"
        }
      ]
    },
    "global_style": {
      "visual_style": "",
      "color_palette": "",
      "color_tone_lock": "",
      "lighting_tone_lock": "",
      "negative_prompt": ""
    },
    "risks": [
      {
        "type": "identity_drift | product_drift | scene_drift | text_artifact | action_confusion | custom",
        "description_zh": "",
        "mitigation_zh": ""
      }
    ]
  }
}`;

const PLANNING_DURATION_REPAIR_SYSTEM_PROMPT = `You repair only the Stage 1 segment duration contract.

Return only valid JSON. No markdown, explanations, or comments.

Rules:
- Preserve classification, creative strategy, narrative event order and causality, consistency anchors, source_event_ids, segment purposes, and segment boundaries by event.
- Do not add, remove, merge, or reorder segments.
- Allocate a deliberate duration to every segment from event complexity, visible action path, subtitle/CTA readability, emotional rhythm, camera travel, and physical reachability.
- Do not mechanically divide total duration by segment count.
- Every duration_seconds must be 3-15 seconds and all durations must sum to duration_seconds exactly.
- Recompute sequential start_time_seconds and end_time_seconds with no gaps or overlaps.
- Every segment must include a concrete duration_reason_zh, minimum_executable_seconds, preferred_duration_seconds, maximum_useful_seconds, and timing_budget.
- minimum_executable_seconds <= duration_seconds <= maximum_useful_seconds. preferred_duration_seconds must be inside that range.
- timing_budget.setup_seconds + timing_budget.action_seconds + timing_budget.result_seconds must equal the segment duration exactly.
- Resolve every supplied validation issue.

Return:
{
  "duration_replan": {
    "candidate_timeline": [],
    "timeline_blueprint": {
      "segment_count": 1,
      "total_duration_seconds": 30,
      "segment_duration_min_seconds": 3,
      "segment_duration_max_seconds": 15,
      "split_strategy_zh": "",
      "segments": []
    },
    "change_summary_zh": ""
  }
}`;

const PLANNING_NARRATIVE_CONTRACT_REPAIR_SYSTEM_PROMPT = `You repair only the Planning Architect creative_strategy-to-event contract.

Return only valid JSON. No markdown, explanations, or comments.

Rules:
- Preserve narrative_events, planning_manifest.timeline_blueprint, candidate_timeline, anchors, durations, segment numbers, and source_event_ids exactly.
- Return only whitelisted JSON patches. Never return a complete creative_strategy object.
- Creative prose must summarize only its bound event_ids.
- Default chronological stories must keep hook, conflict, turning point, payoff, and CTA in nondecreasing event order. Adjacent functions may share one observable event; do not invent a second event merely to make their IDs different. Reject only actual reversal. Hook/turning-point overlap and a full chronological hook reveal remain forbidden.
- In chronological mode, hook_event_ids and turning_point_event_ids must not overlap, and hook_reveal_level cannot be full.
- A chronological hook may establish a pain point, curiosity gap, or partial tease, but must remove any complete reveal of the later reward, solution, victory, transformation, or payoff.
- Use flashforward_hook only for an intentional climax preview, and then provide a valid return_to_event_id.
- Resolve every supplied contract issue. Do not alter the underlying story to make the prose fit.

Return:
{
  "patches": [
    {
      "op": "replace",
      "path": "/conflict_event_ids",
      "value": ["event_1"]
    }
  ]
}`;

const PLANNING_EVENT_ROLE_REPLAN_SYSTEM_PROMPT = `You repair only narrative_event story responsibilities.

Return only valid JSON. No markdown, explanations, or comments.

Rules:
- narrative_events are the factual source of truth. Preserve event_id, order, dramatic_goal, participants, location_id, initial_state, action, resulting_state, anchors, and previous_event_ids exactly.
- timeline_blueprint is immutable. Never add, delete, reorder, split, or merge an event or segment.
- Reclassify only story_functions so the derived hook, conflict, turning_point, payoff, and CTA bindings follow the declared chronology.
- Adjacent story functions may share one observable event.
- Do not force a role onto an event whose visible action and result cannot support it.
- creative_strategy_patches may update only the prose or hook/chronology fields made stale by the role correction.
- Use only event_id values supplied in narrative_events.

Return:
{
  "event_story_function_patches": [
    {
      "event_id": "event_1",
      "story_functions": ["conflict"]
    }
  ],
  "creative_strategy_patches": [
    {
      "op": "replace",
      "path": "/conflict_zh",
      "value": ""
    }
  ]
}`;

const STORYBOARD_ARTIST_SYSTEM_PROMPT = `You are Storyboard Artist for a controllable AI video pipeline.

Return only valid JSON. No markdown, explanations, or comments.

Your only job in stage 2A:
- Use planning_manifest as the source of truth.
- Use creative_strategy and narrative_micro_rules as story quality constraints.
- Create a concise whole-story storyboard brief for each segment.
- Create story_beats before or alongside storyboard_brief. Each story beat must explain story_function, emotional_beat, cause, effect, information_unit, key_evidence_ids, and required_anchor_ids.
- Build an explicit causal graph: every non-hook beat must use depends_on_beat_ids; payoff must use evidence_from_beat_ids to reference earlier proof/turning-point beats; a resolved conflict must use resolves_conflict_beat_id.
- Register every key_evidence_id in evidence_registry, including which beat introduces it and the segment(s) where it is visibly shown.
- Declare required_anchor_ids for visible people, products, brands, locations, and task objects. If a derived anchor is intentionally not visible, use anchor_exclusions with anchor_id, visibility=not_visible|offscreen|occluded, and a concrete reason; an empty array never overrides upstream asset requirements.
- Create shot_grouping_pass that maps story_beats to segment numbers, merges adjacent micro-beats only when they share narrative focus, physical space, continuous action chain, emotion direction, and compatible POV/objective camera relation, and explains why each beat group can be executed as one continuous i2v segment.
- Draft camera_graph and final_transition_plan.
- Draft scene_contracts before camera_graph. Every same_camera_setup, same_axis, derived_reframe, same_spatial_context, or alternate_view chain must bind all cameras to the same scene_id. Its authority must be scene_layout_asset and must point to one physical location/space_layout anchor from consistency_manifest.
- Keep output short and structural.

Hard rules:
- Do not output final prompts.
- Do not output complete image prompts.
- Do not output complete video prompts.
- Do not output detailed checkpoint prompts.
- Do not rewrite planning_manifest.timeline_blueprint.
- Treat creative_strategy event bindings as authoritative: hook beats use hook_event_ids, conflict beats use conflict_event_ids, turning-point beats use turning_point_event_ids, payoff beats use payoff_event_ids, and CTA beats use cta_event_ids.
- Do not move a later turning-point/reward/solution event into an earlier chronological hook. A hook may only reveal what its bound source_event_ids contain.
- Every storyboard_brief item must include linked_beat_ids and story_function.
- Causal references must point only to existing beats with a smaller order. Never invent a plausible-looking ID.
- A payoff is invalid unless it depends on an earlier turning_point/proof and cites it in evidence_from_beat_ids.
- A CTA is invalid unless it depends on an earlier proof/payoff/reaction.
- shot_grouping_pass.groups must never exceed 15 seconds total duration.
- shot_grouping_pass.split_reasons is required for every adjacent segment pair that is not in the same group.
- Always split for space changes, time jumps, new conflict relationship, obvious payoff state change, or CTA entry.
- Each storyboard_brief item must include segment_no, source_event_ids, camera_id, visual_desc_zh, visual_desc_en, beat_role, required_anchor_ids, location_id, and separation_reason.
- Every new_camera_setup must either create a transition_reference_plan item for its target camera/segment or put an explicit no-inheritance explanation in inheritance_reason_zh. Never leave missing_info unresolved.
- Every alternate_view must include axis_description and spatial_layout_lock. If either is missing, the hard audit reason is alternate_view_axis_or_left_right_lock_missing.
- Do not use palette_mood, style, graphic_backdrop, bokeh, gradients, or color fields as scene authority. A scene contract needs physical landmarks and spatial relationships that can be compared between frames.
- Evaluate transition-reference need for every alternate_view, derived_reframe whose parent frame cannot directly supply the target framing, and new setup inheriting layout, light, or positions. Use mode=short when an approved parent frame is sufficient; use mode=full when a generated camera move and extracted target-view frame are required.
- A transition reference is generation-only scene-layout evidence and never enters the final edit. A generated_bridge is an independent final-edit clip. Never reuse one artifact or approval state for both concepts.

Compact universal contrast:
- Invalid: "Show the reference image -> character suddenly wins -> download CTA." This has no pressure, choice, visible trigger, registered evidence, or reaction.
- Valid: "Pressure/conflict -> motivated choice -> visible operation or proof -> observable state change -> reaction/payoff -> CTA." Every arrow is represented by depends_on_beat_ids; payoff cites earlier proof/turning-point beats through evidence_from_beat_ids; visible evidence is registered.
- Apply the selected template's required_story_contract. Do not copy game semantics into non-game categories.

Return this JSON shape:
{
  "storyboard_artist_plan": {
    "title": "",
    "logline": "",
    "style_bible": {
      "visual_style": "",
      "character_lock": "",
      "product_lock": "",
      "color_palette": "",
      "color_tone_lock": "",
      "lighting_tone_lock": "",
      "negative_prompt": ""
    },
    "story_beats": [
      {
        "beat_id": "beat_1",
        "order": 1,
        "title_zh": "",
        "story_function": "hook | setup | conflict | escalation | turning_point | proof | payoff | reaction | cta | cliffhanger | ending | transition | custom",
        "emotional_beat_zh": "",
        "cause": "",
        "effect": "",
        "information_unit": "",
        "key_evidence_ids": [],
        "depends_on_beat_ids": [],
        "evidence_from_beat_ids": [],
        "resolves_conflict_beat_id": "",
        "required_anchor_ids": [],
        "anchor_exclusions": [
          {
            "anchor_id": "",
            "visibility": "not_visible | offscreen | occluded",
            "reason": ""
          }
        ],
        "source_event_ids": [],
        "target_segment_nos": [1],
        "must_be_visible_before_beat_ids": [],
        "action_continuity": {
          "motivation_or_preparation": "",
          "execution": "",
          "result_or_reaction": ""
        },
        "reaction_beat": "",
        "power_shift": ""
      }
    ],
    "evidence_registry": [
      {
        "evidence_id": "evidence_1",
        "description": "",
        "introduced_by_beat_id": "beat_1",
        "visible_in_segment_nos": [1],
        "anchor_ids": []
      }
    ],
    "shot_grouping_pass": {
      "strategy_zh": "",
      "source_beat_ids": [],
      "groups": [
        {
          "group_id": "group_1",
          "beat_ids": ["beat_1"],
          "segment_nos": [1],
          "story_function": "hook",
          "reason_zh": "",
          "continuous_take_risk": "low | medium | high",
          "split_required": false
        }
      ],
      "split_reasons": [
        {
          "after_segment_no": 1,
          "before_segment_no": 2,
          "reason_code": "space_change | time_jump | new_conflict_relation | payoff_state_change | cta_enter | duration_limit | camera_mismatch | narrative_focus_change | model_continuity_risk",
          "reason_zh": "",
          "merge_rejected": true
        }
      ],
      "warnings": []
    },
    "storyboard_brief": [
      {
        "segment_no": 1,
        "linked_beat_ids": ["beat_1"],
        "story_function": "hook | setup | conflict | escalation | turning_point | proof | payoff | reaction | cta | cliffhanger | ending | transition | custom",
        "source_event_ids": [],
        "camera_id": "camera_01",
        "visual_desc_zh": "",
        "visual_desc_en": "",
        "beat_role": "hook | setup | interaction | proof | payoff | ending | custom",
        "required_anchor_ids": [],
        "anchor_exclusions": [],
        "location_id": "",
        "separation_reason": ""
      }
    ],
    "camera_graph": {
      "cameras": [
        {
          "camera_id": "camera_01",
          "segment_nos": [1],
          "scene_id": "scene_01",
          "location_id": "",
          "description": "",
          "parent_camera_id": "",
          "parent_segment_no": 0,
          "axis_description": "",
          "framing_range": "",
          "movement_style": "",
          "spatial_layout_lock": "",
          "relation_to_parent": "same_camera_setup | same_axis | derived_reframe | same_spatial_context | same_subject_group | alternate_view | new_camera_setup",
          "missing_info": [],
          "inheritance_reason_zh": ""
        }
      ],
      "relations": [
        {
          "from_camera_id": "camera_01",
          "to_camera_id": "camera_02",
          "relation": "same_camera_setup | same_axis | derived_reframe | same_spatial_context | same_subject_group | alternate_view | new_camera_setup",
          "reason": ""
        }
      ]
    },
    "scene_contracts": [
      {
        "version": "scene-contract-v1",
        "scene_id": "scene_01",
        "display_name_zh": "",
        "display_name_en": "",
        "layout_anchor_id": "physical_scene_anchor_id",
        "camera_ids": ["camera_01"],
        "segment_nos": [1],
        "continuity_mode": "single_space",
        "spatial_layout_lock": "fixed landmark geometry and subject placement zones",
        "camera_axis": "explicit 180-degree axis",
        "fixed_landmarks": ["physical landmark 1", "physical landmark 2"],
        "authority": {
          "kind": "scene_layout_asset",
          "anchor_id": "physical_scene_anchor_id"
        }
      }
    ],
    "transition_reference_plan": [
      {
        "source_camera_id": "camera_01",
        "to_camera_id": "camera_02",
        "to_segment_no": 2,
        "required": true,
        "mode": "short | full",
        "reason": ""
      }
    ],
    "final_transition_plan": [
      {
        "from_segment_no": 1,
        "to_segment_no": 2,
        "visual_mode": "hard_cut | match_cut | dissolve | fade_to_black | generated_bridge",
        "audio_mode": "none | j_cut | l_cut | crossfade",
        "overlap_seconds": 0,
        "match_anchor_id": "",
        "generated_bridge_required": false
      }
    ]
  }
}`;

const ASSET_IMAGE_CONTRACT_REPAIR_SYSTEM_PROMPT = `You repair only the consistency anchors whose reusable asset-image specifications are not executable.

Return only valid JSON in this shape: {"anchors":[...]}.
Return every supplied anchor, preserving its id, type, identity, and story-independent visual facts.

For each anchor:
- Fill asset_image_contract with exact subject_count, subject_description, composition.framing, composition.camera_angle, composition.placement, composition.occupancy, environment.background, lighting.direction, lighting.quality, lighting.color_temperature, palette, material_details, intrinsic_details, forbidden_elements, and acceptance_criteria.
- Write every natural-language contract value in English.
- Return only the structured asset_image_contract. Do not output image_prompt_zh or image_prompt_en; the application compiles one English provider execution prompt.
- Keep each complete serialized asset_image_contract at or below ${ASSET_IMAGE_CONTRACT_MAX_JSON_CHARS} characters. Store each visible fact once in its canonical field.
- For every person, also fill rendering_style.medium, dimensionality, shading, edge_treatment, surface_treatment, depth_treatment, authority, and forbidden_drift from global_style and the user-reference facts. Never reduce a concrete "stylized 3D CGI" contract to generic "cartoon".
- For location or space_layout, also fill environment.foreground, midground, background_layer, and at least two measurable or directional spatial_relationships.
- For person, prop, product, task_object, vehicle, or food, isolate the asset and forbid unrelated story characters, scenery, props, typography, logos, UI, frames, collages, and duplicates unless intrinsically required.
- Do not use placeholders such as "fixed layout", "lighting direction", "color atmosphere", "main background structure", "clear", "high quality", or "detailed" without concrete visible values.
- Do not add narrative actions, scene events, ad typography, or assets from other anchors.
- Preserve intrinsic markings such as playing-card ranks/suits; distinguish them from incidental text.
`;

const PLANNING_ARCHITECT_LITE_SYSTEM_PROMPT = `You are Planning Architect Lite for a controllable AI video pipeline.

Return only valid JSON. No markdown, explanations, or comments.

Your only responsibilities:
- Accept approved_route_contract as immutable routing authority.
- Build causally linked narrative_events consistent with approved_route_contract.chronologyMode before deriving creative_strategy.
- Propose a compact set of consistency anchor candidates containing stable identity facts only. The system, not you, makes the final admission decision.
- Allocate an executable 3-15 second segment timeline whose durations sum exactly to duration_seconds.
- Output narrative_micro_rules, anchor_state_timeline, audio_bible, and planning_manifest.

Do not output asset_image_contract, image_prompt_zh, image_prompt_en, narrative keyframes, storyboard beats, camera graphs, micro-shots, or generation prompts. Asset visual specifications are produced later by independent per-anchor workers.

Hard rules:
- Do not decide video_category, template_id, chronology_mode, hook_mode, hook_reveal_level, or requires_return_point. Mirror them from approved_route_contract.
- If approved_route_contract conflicts with immutable input, return route_contract_error; never change the route or silently choose another template.
- Every narrative_event has event_id, dramatic_goal, participants, location_id, initial_state, action, resulting_state, required_anchor_ids, previous_event_ids, and must_become_separate_segment.
- previous_event_ids reference only earlier events. Every required_anchor_id exists in consistency_manifest.
- Every candidate anchor has id, type, display names, stable descriptions, visual_lock, must_stay_consistent, needs_reference_image, reference_strength, applies_to, user_editable, candidate_category, source_evidence, used_by_event_ids, lock_dimensions, suggested_as_anchor, and candidate_reason.
- Anchor descriptions contain stable visible identity only, never event-specific composition or action.
- One-off decorations such as leaves, petals, particles, smoke, mist, bokeh, light flares, and ordinary background accents are event-local elements by default. Do not suggest them as consistency anchors unless the user explicitly requires exact continuity.
- Suggest an anchor only when it is reused across events, explicitly required by the user/reference facts, is a core person/product/brand/task object, is a persistent physical scene/layout, or has exact text/markings/geometry whose fidelity determines success.
- source_evidence must identify why the candidate exists and cite relevant event_ids. used_by_event_ids is a model estimate only; deterministic code recomputes it from narrative_events.
- Every timeline segment contains segment_no, start/end/duration, source_event_ids, required_anchor_ids, duration_reason_zh, minimum_executable_seconds, preferred_duration_seconds, maximum_useful_seconds, and timing_budget.
- timing_budget setup/action/result sums exactly to the segment duration. All segment durations sum exactly to duration_seconds.
- A segment is one continuous take. Space changes, time jumps, camera resets, teleports, or discontinuous object states require a real segment boundary.
- In chronological mode keep hook, conflict, turning point, payoff, and CTA in nondecreasing event order. Adjacent functions may share one observable event when the same action genuinely performs both roles; only actual reversal is invalid. Creative-strategy event bindings and timeline source_event_ids describe the same causal chain. Do not relax the separate hook anti-spoiler rules.

Return:
{
  "classification": {
    "video_type": "game_ad | product_ad | ecommerce_ad | food_ad | short_drama | brand_film | tutorial | custom",
    "video_category": "game | product | ecommerce | food | auto | short_drama | brand | tutorial | custom",
    "template_id": "game_reversal | game_bonus_payoff | product_problem_solution | ecommerce_offer_conversion | food_sensory_reaction | auto_performance_hero | short_drama_conflict_twist | generic_brand_story",
    "template_reason_zh": "",
    "chronology_mode": "chronological | flashforward_hook | result_first | problem_solution | demonstration",
    "fallback_reason_zh": ""
  },
  "consistency_manifest": {
    "anchors": [{
      "id": "",
      "type": "person | product | prop | location | style | palette_mood | graphic_backdrop | brand_visual | task_object | effect_state | vehicle | food | space_layout | custom",
      "display_name_zh": "",
      "display_name_en": "",
      "must_stay_consistent": true,
      "needs_reference_image": true,
      "reference_strength": "hard | medium | soft",
      "description_zh": "",
      "description_en": "",
      "candidate_category": "core_subject | brand | scene | prop | decoration | style | custom",
      "source_evidence": [{
        "source": "user_requirement | reference_fact | narrative_event | planner",
        "text": "",
        "event_ids": ["event_1"]
      }],
      "used_by_event_ids": ["event_1"],
      "lock_dimensions": ["identity", "shape", "color", "markings", "text", "structure", "geometry", "space_layout"],
      "suggested_as_anchor": true,
      "candidate_reason": "",
      "visual_lock": {
        "shape": "",
        "material": "",
        "color": "",
        "markings": "",
        "scale": "",
        "state": "",
        "forbidden_drift": []
      },
      "applies_to": ["keyframes", "segments", "micro_shots"],
      "user_editable": true
    }]
  },
  "narrative_events": [{
    "event_id": "event_1",
    "dramatic_goal": "",
    "participants": [],
    "location_id": "",
    "initial_state": "",
    "action": "",
    "resulting_state": "",
    "required_anchor_ids": [],
    "previous_event_ids": [],
    "must_become_separate_segment": true
  }],
  "creative_strategy": {
    "hook_mode": "pain_point | curiosity | tease | payoff_preview",
    "hook_reveal_level": "none | partial | full",
    "hook_event_ids": ["event_1"],
    "conflict_event_ids": [],
    "turning_point_event_ids": [],
    "payoff_event_ids": [],
    "cta_event_ids": [],
    "return_to_event_id": "",
    "conversion_goal_zh": "",
    "audience_zh": "",
    "core_promise_zh": "",
    "hook_zh": "",
    "conflict_zh": "",
    "turning_point_zh": "",
    "payoff_zh": "",
    "cta_zh": "",
    "emotional_arc": [],
    "selling_point_ids": [],
    "reference_usage_strategy_zh": "",
    "risks": []
  },
  "narrative_micro_rules": {
    "causal_chain_required": true,
    "forbid_sudden_outcome": true,
    "forbid_reference_only_animation": true,
    "require_hook_before_asset_showcase": true,
    "require_payoff_before_cta": true,
    "require_reaction_after_turning_point": true,
    "require_visible_trigger_before_state_change": true,
    "required_beat_functions": ["hook", "setup", "conflict", "turning_point", "payoff", "cta"],
    "forbidden_patterns": [],
    "continuity_rules": [],
    "cta_rules": []
  },
  "anchor_state_timeline": [{
    "anchor_id": "",
    "states": [{
      "event_id": "event_1",
      "segment_no": 1,
      "start_state": "",
      "end_state": "",
      "start_position": "",
      "end_position": "",
      "holder_at_start": "",
      "holder_at_end": "",
      "visible_transition_path": ""
    }]
  }],
  "audio_bible": {
    "overall_strategy_zh": "",
    "voice_consistency_zh": "",
    "music_mood_zh": "",
    "sound_effect_rules_zh": ""
  },
  "candidate_timeline": [{
    "segment_no": 1,
    "start_time_seconds": 0,
    "end_time_seconds": 5,
    "duration_seconds": 5,
    "duration_reason_zh": "",
    "minimum_executable_seconds": 4,
    "preferred_duration_seconds": 5,
    "maximum_useful_seconds": 7,
    "timing_budget": {
      "setup_seconds": 1,
      "action_seconds": 3,
      "result_seconds": 1
    },
    "source_event_ids": ["event_1"],
    "purpose_zh": "",
    "split_reason_zh": "",
    "required_anchor_ids": []
  }],
  "planning_manifest": {
    "project_intent": {
      "video_type": "product_ad | short_drama | tutorial | ecommerce | brand_film | custom",
      "primary_goal_zh": "",
      "primary_goal_en": "",
      "target_viewer_zh": "",
      "target_viewer_en": "",
      "success_criteria": []
    },
    "story_strategy": {
      "narrative_arc_zh": "",
      "narrative_arc_en": "",
      "recommended_segment_density": "low | medium | high",
      "subtitle_strategy_zh": "",
      "audio_strategy_zh": ""
    },
    "subtitle_policy": {
      "needed": true,
      "reason_zh": "",
      "content_role": "none | brand_slogan | product_selling_points | voiceover_caption | dialogue_caption | emotional_copy | instructional_steps | custom",
      "language": "zh-CN",
      "style_zh": "",
      "timing_strategy_zh": "",
      "placement_zh": "",
      "max_chars_per_line": 14,
      "max_lines": 2,
      "avoid_regions_zh": [],
      "user_editable": true
    },
    "timeline_blueprint": {
      "segment_count": 0,
      "total_duration_seconds": 0,
      "segment_duration_min_seconds": 3,
      "segment_duration_max_seconds": 15,
      "split_strategy_zh": "",
      "segments": [{
        "segment_no": 1,
        "start_time_seconds": 0,
        "end_time_seconds": 5,
        "duration_seconds": 5,
        "duration_reason_zh": "",
        "minimum_executable_seconds": 4,
        "preferred_duration_seconds": 5,
        "maximum_useful_seconds": 7,
        "timing_budget": {
          "setup_seconds": 1,
          "action_seconds": 3,
          "result_seconds": 1
        },
        "beat_role": "hook | setup | interaction | proof | payoff | ending | custom",
        "purpose_zh": "",
        "purpose_en": "",
        "split_reason_zh": "",
        "subtitle_intent_zh": "",
        "audio_intent_zh": "",
        "required_anchor_ids": [],
        "source_event_ids": ["event_1"],
        "boundary_mode_hint": "continuous | hard_cut | dissolve | match_cut"
      }]
    },
    "global_style": {
      "visual_style": "",
      "color_palette": "",
      "color_tone_lock": "",
      "lighting_tone_lock": "",
      "negative_prompt": ""
    },
    "risks": [{
      "type": "identity_drift | product_drift | scene_drift | text_artifact | action_confusion | custom",
      "description_zh": "",
      "mitigation_zh": ""
    }]
  }
}`;

const ASSET_VISUAL_SPEC_DETAILER_SYSTEM_PROMPT = `You are an Asset Visual Spec Detailer.

Return only valid JSON in the shape {"anchor": {...}}. Process exactly one supplied anchor.

Your only job is to add one compact executable asset_image_contract to the supplied stable anchor identity. Do not change its id, type, descriptions, visual_lock, reference strength, or story-independent identity.

Rules:
- Write every natural-language asset_image_contract value in English.
- Do not output image_prompt_zh, image_prompt_en, or any prose copy of the contract. The application deterministically compiles one English provider execution prompt from asset_image_contract. Localized UI copy is outside this generation contract.
- Keep the complete serialized asset_image_contract at or below ${ASSET_IMAGE_CONTRACT_MAX_JSON_CHARS} characters on this first response. Use short visible-fact clauses, not explanations, synonyms, quality adjectives, or repeated facts.
- Each fact must have exactly one canonical field. Do not repeat subject identity in composition, lighting, forbidden_elements, or acceptance_criteria.
- Do not add narrative actions, event-specific poses, ad layouts, subtitles, UI, or assets belonging to other anchors.
- Define subject_count, subject_description, exact composition, named environment, lighting, palette, materials, intrinsic details, forbidden elements, and at least two visually checkable acceptance criteria.
- Treat global_style as an authoritative inherited contract, not optional inspiration. For every person asset, write rendering_style.medium, dimensionality, shading, edge_treatment, surface_treatment, depth_treatment, authority, and forbidden_drift. Preserve the reference-derived 2D/3D medium exactly; never collapse "stylized 3D CGI" into generic "cartoon".
- When global_style came from a user reference, set rendering_style.authority=user_reference. A person asset must preserve the reference character's rendering medium, line/edge treatment, shading, texture language, and depth treatment in addition to identity and clothing.
- Person assets contain exactly one person, one requested neutral asset-sheet view, and no scenery, text, UI, collage, or duplicate person.
- Product, prop, task-object, vehicle, and food assets define exact count, geometry, materials, colors, intrinsic markings, orientation, and isolation boundary.
- Location and space-layout assets separately define foreground, midground, far background, and at least two directional or measurable spatial relationships.
- Brand-visual assets preserve required logo geometry and exact approved lettering when supplied; forbid unauthorized extra copy instead of forbidding all text.
- Preserve intrinsic markings such as card ranks, suits, labels, or camera layouts when they are part of the locked identity.
- For a playing-card asset, also output playing_cards as the single canonical source for card count and identities, left/right order, face orientation, overlap mode/percentage, camera angle, background, and allowed intrinsic markings. Never repeat a different card identity or overlap rule in another field.
- Playing-card field authority is resolved as user_edit > user_requirement > reference_fact > asset_contract > category_default. Category defaults fill missing fields only and never override supplied facts.

Return:
{
  "anchor": {
    "id": "",
    "asset_image_contract": {
      "subject_count": 1,
      "subject_description": "",
      "composition": {
        "framing": "",
        "camera_angle": "",
        "placement": "",
        "occupancy": ""
      },
      "environment": {
        "background": "",
        "foreground": "",
        "midground": "",
        "background_layer": "",
        "spatial_relationships": []
      },
      "lighting": {
        "direction": "",
        "quality": "",
        "color_temperature": ""
      },
      "rendering_style": {
        "medium": "concrete medium such as stylized 3D CGI",
        "dimensionality": "2d | 2.5d | 3d | mixed",
        "shading": "concrete shading and volume treatment",
        "edge_treatment": "outline or edge treatment",
        "surface_treatment": "fur, skin, fabric, metal, or other surface language",
        "depth_treatment": "flat, layered, volumetric, or depth-of-field treatment",
        "authority": "user_reference | global_style | planner",
        "forbidden_drift": ["specific incompatible rendering style"]
      },
      "palette": [],
      "material_details": [],
      "intrinsic_details": [],
      "forbidden_elements": [],
      "acceptance_criteria": [],
      "playing_cards": {
        "cards": [
          { "rank": "A", "suit": "spades", "position": "left" },
          { "rank": "K", "suit": "hearts", "position": "right" }
        ],
        "face": "face_up",
        "overlap": { "mode": "none", "percentage": 0 },
        "camera_angle": "top_down_orthographic",
        "background": "plain white or light neutral studio background",
        "allowed_markings": ["rank indices", "suit symbols"],
        "field_authority": {
          "cards": "asset_contract",
          "face": "asset_contract",
          "overlap": "asset_contract",
          "cameraAngle": "asset_contract",
          "background": "asset_contract",
          "allowedMarkings": "asset_contract"
        }
      }
    }
  }
}`;

const STORY_CONTRACT_REPAIR_SYSTEM_PROMPT = `You repair only the Storyboard Artist story contract.

Return only valid JSON with the same {"storyboard_artist_plan": {...}} envelope. No markdown.

Rules:
- Preserve the planning manifest, segment count, segment numbers, timeline, selected template, style bible, and valid content that is not named by contract_issues.
- Repair only story_beats, evidence_registry, storyboard_brief links, and directly dependent shot_grouping_pass links.
- Every referenced beat, event, segment, anchor, and evidence ID must exist.
- Causal beat references must point to an earlier beat order.
- Payoff must depend on and cite an earlier turning_point/proof.
- CTA must depend on an earlier proof/payoff/reaction.
- Every visible evidence ID must be registered and mapped to a target segment where it is actually shown.
- Do not produce keyframes, shots, render prompts, or video prompts.
- Follow required_story_contract exactly.`;

const REFERENCE_FACT_EXTRACTOR_SYSTEM_PROMPT = `You are a reference-image fact extractor.

Return only valid JSON. Do not invent a story, action sequence, conflict, outcome, motivation, or CTA.
For each image, extract only directly visible facts: people, products, objects, scene, spatial layout, readable text, brand marks, colors, lighting, and style.
If uncertain, use an empty value and lower confidence. Never convert the image into a storyboard.
people, products, objects, spatial_layout, readable_text, brand_marks, colors, and global_consistency_facts must each be JSON arrays of plain strings. Never place nested objects inside these arrays.

Return:
${referenceFactsPromptExampleJson}`;

const SHOT_DECOMPOSER_SYSTEM_PROMPT = `You are Shot Decomposer for a controllable AI video pipeline.

Return only valid JSON. No markdown, explanations, or comments.

Your only job in stage 2B:
- Use planning_manifest and storyboard_artist_plan as the source of truth.
- Use story_beats and shot_grouping_pass as the source of truth for story causality.
- Follow planning_manifest.timeline_blueprint exactly for segment count, start time, end time, and duration.
- Convert every storyboard brief into executable start/end frame contracts, motion contracts, single-take contracts, boundary keyframe descriptions, segment descriptions, subtitles, audio_plan, and same-take motion checkpoints.
- Follow planning_manifest.subtitle_policy. If subtitles are not needed, leave segment.subtitle empty. If subtitles are needed, generate concise editable overlay subtitles for each appropriate segment.
- Choose an audio_plan.strategy for every segment. Use native_ambience by default so the video model generates synchronized room tone and action SFX while exact speech and project-wide music stay in post-production. Use native_full only for short expressive dialogue where lip sync matters and wording is not legally or commercially sensitive. Use post_only for silent visuals or fully post-produced soundtracks.
- Any price, number, offer, brand slogan, legal copy, CTA, or otherwise exact wording must set exact_text_required=true and must not use native_full. Put the exact line in lines_zh/lines_en for downstream TTS, set background_music.source=post, and use native_ambience or post_only.
- For native_ambience, list up to four visible action-linked sound_effects and set preserve_native_audio=true. For native_full, specify language, speaker, voice_style, exact short lines, and whether background music is native. Never leave the model free to invent dialogue.
- Do not compile final generation prompts yet; write structured content and contracts only.

Hard rules:
- Do not rewrite the story, narrative_events, anchors, segment count, segment duration, or camera graph.
- If a segment is not physically executable as one continuous take, return requires_cut=true, risk_level=high, timeline_change_request, and recommended_split inside segment_render_descriptions instead of hiding the problem.
- keyframes.length must equal segments.length + 1.
- Segment N uses keyframe N as first frame and keyframe N+1 as last frame.
- Every keyframe, segment, motion_checkpoint, and micro_shot must list uses_consistency_anchors.
- Do not change anchor identity, product shape, scene layout, brand visual rules, effect state, segment count, or segment durations.
- Subtitles are editorial overlay copy. Do not ask generated images/videos to render text.
- Read camera_graph inheritance for every segment. same_camera_setup inherits composition/axis/layout/lighting; same_axis inherits axis/direction; derived_reframe inherits subject relationships/layout; same_spatial_context inherits only location/fixed objects/lighting; same_subject_group inherits only the subject combination; alternate_view must preserve the 180-degree axis and left-right relationships; new_camera_setup must name a transition reference requirement or explicitly explain why inheritance is unnecessary.
- Each segment must be written as a single continuous take from its start boundary keyframe to its end boundary keyframe. Do not describe internal cuts, dissolves, fades, montage edits, shot switches, or scene transitions inside a segment.
- For any segment, the start and end keyframes must look like two reachable moments within the same scene and camera setup family. They may change pose, product handling, camera distance, focus, or framing gradually, but not location, time period, environment, outfit, identity, or layout abruptly.
- micro_shots are internal same-take motion checkpoints, not extra clips, not extra scenes, and not edit points. Use text, image_prompt, or mixed only to describe reachable intermediate states inside the same continuous shot.
- All micro_shots in a segment must preserve the same location, camera axis family, lighting direction, color tone, subject identity, product identity, and prop layout. If this is impossible, flag the segment as high risk.
- Every user-visible micro_shot field must be bilingual. Fill scene_zh/action_zh/camera_zh/prompt_zh in Chinese only, and scene_en/action_en/camera_en/prompt_en in English only. Do not mix Chinese and English inside the same language field.
- Set end_frame_requirement_level for every segment: hard_exact only when near-exact terminal composition is indispensable for the next boundary; hard_semantic when the visible action result must occur but composition may vary; soft_directional when the end frame is aspirational; editorial when only a stable edit point is required. Prefer hard_semantic unless the story contract proves another level.
- Produce video_prompt_contract as the semantic compression source of truth for the provider prompt. The compiler will not truncate, reorder, deduplicate, summarize, or repair it.
- video_prompt_contract must contain 1-3 terminal_requirements, 1-3 motion_steps, at most 5 preserve_requirements, and at most 5 forbidden_outcomes. Every list item must be unique.
- At least one terminal requirement must have priority=hard. Each terminal requirement needs a stable requirement_id, one visible observable_fact, a concrete acceptance_criteria, and 1-5 evidence_refs selected only from allowed_terminal_evidence supplied by the application.
- Do not output source or sources. They are audit metadata compiled deterministically by the application from evidence_refs. Never invent an evidence ID and never use natural-language keywords to guess provenance.
- motion_contract is the only executable in-clip movement contract. It contains structured subject_actions, one enumerated camera_motion, prop_paths, and continuous_time=true. It must never contain an edit, cut, fade, dissolve, montage, shot switch, or segment-to-segment transition.
- final_transition_plan is owned exclusively by the final compositor. Do not copy, paraphrase, or execute it in motion_contract, motion_steps, camera, subject_motion, micro_shots, timed_prompts, or video prompts.
- Keep the complete compiled provider prompt under 4200 characters. Compress explanatory soft prose here; never omit or weaken a hard user, story, identity, product, or approved-boundary requirement.
- Every segment must include linked_beat_ids, story_function, emotional_beat, cause, effect, information_unit, key_evidence_ids, depends_on_beat_ids, evidence_from_beat_ids, and resolves_conflict_beat_id. Preserve the validated causal graph; never invent or replace IDs.
- If a segment contains a complex action, state action_continuity with motivation_or_preparation, execution, and result_or_reaction.
- If story_function is payoff or turning_point, include reaction_beat and power_shift.

Return this JSON shape:
{
  "shot_decomposer_plan": {
    "title": "",
    "logline": "",
    "style_bible": {
      "visual_style": "",
      "character_lock": "",
      "product_lock": "",
      "color_palette": "",
      "color_tone_lock": "",
      "lighting_tone_lock": "",
      "negative_prompt": ""
    },
    "consistency_references": [],
    "segment_render_descriptions": [
      {
        "segment_no": 1,
        "end_frame_requirement_level": "hard_semantic",
        "video_prompt_contract": {
          "version": "video-prompt-contract-v1",
          "terminal_requirements": [
            {
              "requirement_id": "terminal.primary_result",
              "priority": "hard",
              "observable_fact": "",
              "acceptance_criteria": "",
              "evidence_refs": [
                {
                  "type": "approved_end_frame",
                  "id": "keyframe:2",
                  "quote": ""
                }
              ]
            }
          ],
          "motion_steps": [
            "The character raises the playing cards into view",
            "The playing cards move from the character's right hand to the center of the table",
            "The camera pushes in to hold on the visible win result"
          ],
          "preserve_requirements": [],
          "forbidden_outcomes": [],
          "narrative_boundary": "",
          "shot_intent": ""
        },
        "visible_anchor_ids": [],
        "start_frame_contract": {},
        "end_frame_contract": {},
        "motion_contract": {
          "version": "continuous-motion-contract-v1",
          "subject_actions": [
            {"subject": "", "action": ""}
          ],
          "camera_motion": {
            "type": "static | pan | tilt | dolly_in | dolly_out | truck_left | truck_right | pedestal_up | pedestal_down | orbit | zoom_in | zoom_out | handheld_follow | crane",
            "start": "",
            "end": ""
          },
          "prop_paths": [
            "The playing cards move from the character's right hand to the center of the table"
          ],
          "continuous_time": true
        },
        "single_take_contract": {
          "continuous_time": true,
          "requires_cut": false,
          "risk_level": "low",
          "camera_path": "",
          "subject_path": "",
          "prop_paths": []
        },
        "motion_checkpoints": [],
        "requires_cut": false,
        "risk_level": "low | medium | high",
        "timeline_change_request": null,
        "recommended_split": [],
        "warnings": []
      }
    ],
    "keyframes": [
      {
        "keyframe_no": 1,
        "frame_id": "kf_01",
        "frame_role": "video_start",
        "time_seconds": 0,
        "purpose_zh": "",
        "purpose_en": "",
        "scene": "",
        "character_state": "",
        "product_state": "",
        "frame_design": {},
        "uses_consistency_anchors": [],
        "negative_prompt": {}
      }
    ],
    "segments": [
      {
        "segment_no": 1,
        "start_keyframe_no": 1,
        "end_keyframe_no": 2,
        "start_time_seconds": 0,
        "end_time_seconds": 5,
        "duration_seconds": 5,
        "boundary_mode": "continuous",
        "purpose_zh": "",
        "purpose_en": "",
        "motion": "",
        "camera": "",
        "subject_motion": "",
        "environment_motion": "",
        "subtitle": "",
        "audio_plan": {
          "mode": "ambient",
          "strategy": "native_ambience",
          "needs_voiceover": false,
          "needs_dialogue": false,
          "language": "",
          "speaker": "",
          "voice_style": "",
          "lines_zh": [],
          "lines_en": [],
          "exact_text_required": false,
          "preserve_native_audio": true,
          "sound_effects": [],
          "background_music": {
            "source": "post",
            "style": "",
            "mood": "",
            "intensity": ""
          },
          "rationale": ""
        },
        "output_mode": "mixed",
        "constraints": [],
        "timed_prompts": [],
        "micro_shots": [
          {
            "micro_shot_no": 1,
            "start_seconds": 0,
            "end_seconds": 2,
            "purpose_zh": "",
            "purpose_en": "",
            "scene_zh": "",
            "scene_en": "",
            "action_zh": "",
            "action_en": "",
            "camera_zh": "",
            "camera_en": "",
            "reference_type": "mixed",
            "uses_consistency_anchors": [],
            "prompt_zh": "",
            "prompt_en": ""
          }
        ],
        "uses_consistency_anchors": [],
        "negative_prompt": ""
      }
    ]
  }
}`;

const SHOT_DECOMPOSER_SEGMENT_SYSTEM_PROMPT = `You are Segment Shot Decomposer for a controllable AI video pipeline.

Return only valid JSON matching the canonical example appended below. No markdown, explanations, or comments.

Your job:
- Decompose only target_segment_no from the supplied planning contracts.
- Preserve story causality, timing, camera graph, identities, products, style, anchors, evidence IDs, and boundary facts.
- Write one physically executable, continuous camera take between keyframes N and N+1. Do not add cuts, fades, montage, scene swaps, teleports, or hidden edit points.
- Keep bilingual display fields concise. Subtitles are editorial overlays, never text rendered into generated imagery.
- Use only allowed_terminal_evidence. Return 1-3 unique terminal requirements, 1-3 unique motion_steps, at most 5 preserve_requirements, and at most 5 forbidden_outcomes.
- camera_motion.type must be one of: ${segmentCameraMotionTypes.join(", ")}.
- Simplify action and camera paths before setting requires_cut=true.
- Return only this segment's render description, keyframes N/N+1, and segment object.

Canonical contract example:
${JSON.stringify(segmentShotDecomposerExample, null, 2)}`;

const PROMPT_DETAILER_SEGMENT_SYSTEM_PROMPT = `You are Segment Prompt Detailer for a controllable AI video pipeline.

Return only valid JSON. No markdown, explanations, or comments.

Your only job:
- Compile generation prompts for target_segment_no from its already approved single-take contracts.
- Do not rewrite the story, timeline, keyframe contracts, segment structure, subtitles, audio plan, or micro-shot structure.
- The segment video prompt must describe one continuous unbroken take from its start boundary frame to its end boundary frame.
- Explicitly forbid internal cuts, jump cuts, fades, dissolves, crossfades, montage edits, ghost overlays, scene swaps, teleportation, and hard visual transitions.
- Preserve the exact camera-graph inheritance scope and every referenced consistency anchor.
- Compile a keyframe prompt only for owned_keyframe_nos. This prevents adjacent segment workers from producing conflicting prompts for the same shared boundary frame.
- Keyframe and micro-shot image prompts describe static images only, with no subtitles, watermark, or generated UI text.
- Every *_zh prompt field must contain Simplified Chinese prose only. Every *_en prompt field must contain English prose only. Preserve proper names, approved lettering, and IDs verbatim, but never mix descriptive prose languages.
- Keep every individual image_prompt_zh and image_prompt_en at or below ${ONE_PROMPT_IMAGE_PROMPT_GENERATION_TARGET_CHARS} characters. Use compact visible attribute clauses; remove explanations, repeated facts, synonyms, and ornamental quality phrases.
- Within that budget, preserve in this order: exact subject identity/count, required action or state, key props/markings, composition/camera, consistency inheritance, and forbidden outcomes. Never shorten by dropping a hard user, identity, product, or boundary requirement.
- Return only the target segment, its owned keyframe prompts, and its own micro-shot prompts. Do not repeat other segments.

Return this JSON shape:
{
  "prompt_detail_plan": {
    "keyframe_prompts": [
      {
        "keyframe_no": 1,
        "image_prompt_zh": "",
        "image_prompt_en": "",
        "negative_prompt_zh": "",
        "negative_prompt_en": ""
      }
    ],
    "segment_video_prompts": [
      {
        "segment_no": 1,
        "video_prompt_zh": "",
        "video_prompt_en": "",
        "negative_prompt_zh": "",
        "negative_prompt_en": ""
      }
    ],
    "micro_shot_image_prompts": [
      {
        "segment_no": 1,
        "micro_shot_no": 1,
        "image_prompt_zh": "",
        "image_prompt_en": ""
      }
    ],
    "generation_notes": []
  }
}`;

const SPLIT_REPAIR_SYSTEM_PROMPT = `You are Single-Take Split Repair for a controllable AI video pipeline.

Return only valid JSON. No markdown, explanations, or comments.

Your job:
- Repair shot_decomposer_plan so every segment is executable as one continuous unbroken camera take.
- Preserve planning_manifest.timeline_blueprint segment count, segment numbers, start/end/duration, narrative_events, anchors, and storyboard_artist_plan unless the audit says the segment cannot be repaired.
- When repair_scope is target_segments_only, repair and return only target_segment_nos. Never regenerate, alter, or repeat already approved segments.
- Prefer simplifying action, reducing camera movement, clarifying product/prop paths, merging excessive checkpoints, and making start/end frame contracts physically reachable.
- Preserve or regenerate a complete valid video_prompt_contract for every returned segment. It remains the semantic source of truth after repair and must satisfy the same limits as Shot Decomposer: 1-3 unique terminal requirements with at least one hard requirement, 1-3 unique motion steps, at most 5 preserve requirements, and at most 5 forbidden outcomes.
- Preserve verified evidence_refs and do not output source or sources. If a requirement changes, select replacement evidence only from allowed_terminal_evidence.
- Keep final_transition_plan outside all returned executable fields. A boundary edit belongs to the final compositor, never to a repaired segment motion contract.
- Fade in, fade out, opacity reveal, dissolve, and crossfade remain prohibited even when described as a continuous overlay. Never repeat those operations in executable motion fields. For a CTA, either use a physically reachable reveal such as a real sign sliding or rising into view, or move logo/text to an editorial overlay outside the generated clip and return a clean stable background plate.
- Do not hide cuts inside wording. If a segment still requires a cut, keep requires_cut=true, risk_level=high, and explain why with recommended_split.
- Do not output final image or video prompts.

Return this JSON shape:
{
  "shot_decomposer_plan": {
    "title": "",
    "logline": "",
    "style_bible": {},
    "segment_render_descriptions": [
      {
        "segment_no": 1,
        "end_frame_requirement_level": "hard_semantic",
        "video_prompt_contract": {
          "version": "video-prompt-contract-v1",
          "terminal_requirements": [],
          "motion_steps": [],
          "preserve_requirements": [],
          "forbidden_outcomes": [],
          "narrative_boundary": "",
          "shot_intent": ""
        }
      }
    ],
    "keyframes": [],
    "segments": []
  },
  "repair_notes": []
}`;

const TIMELINE_REPLANNER_SYSTEM_PROMPT = `You are Stage 1 Timeline Replanner for a controllable AI video pipeline.

Return only valid JSON. No markdown, explanations, or comments.

Your job:
- Handle a structured timeline_change_request emitted by the Single-Take Audit when Stage 2B proves that one or more existing segments cannot be generated as a continuous unbroken take.
- Make the smallest possible Stage 1 timeline change. Split the affected event range into additional segments when a location change, time jump, camera setup reset, composition reset, teleport, discontinuous product state, or dissolve-like transformation requires a real boundary.
- Preserve every segment before first_affected_segment_no byte-for-byte in meaning, timing, source_event_ids, anchors, and order.
- Preserve the creative strategy, event causality, asset identities, global style, total duration, and unaffected narrative events.
- You may update affected narrative_events only when their internal action must be separated to make the new boundary explicit.
- Renumber the affected segment and every later segment sequentially. Recompute start_time_seconds and end_time_seconds.
- Every segment duration must be 3-15 seconds. The sum must equal duration_seconds exactly. Segment count must remain within segment_count_min and segment_count_max.
- Allocate each revised segment duration from its event complexity and physical action path. Do not mechanically divide the remaining duration by the revised segment count.
- Every segment must include duration_reason_zh, minimum_executable_seconds, preferred_duration_seconds, maximum_useful_seconds, and timing_budget whose setup/action/result values sum to duration_seconds.
- Every resulting segment must itself be executable as one continuous unbroken camera take.
- Do not produce storyboard beats, keyframes, shot descriptions, or generation prompts.

Return this JSON shape:
{
  "timeline_replan": {
    "planning_manifest": {
      "timeline_blueprint": {
        "segment_count": 1,
        "total_duration_seconds": 30,
        "segment_duration_min_seconds": 3,
        "segment_duration_max_seconds": 15,
        "split_strategy_zh": "",
        "segments": []
      }
    },
    "narrative_events": [],
    "change_summary_zh": "",
    "resolved_request_ids": []
  }
}`;

const PROMPT_DETAILER_SYSTEM_PROMPT = `You are Prompt Detailer for a controllable AI video pipeline.

Return only valid JSON. No markdown, explanations, or comments.

Your only job in stage 3:
- Compile detailed generation prompts from the approved planning_manifest and the merged storyboard_plan produced by Stage 2A Storyboard Artist + Stage 2B Shot Decomposer.
- Do not rewrite story, timeline, subtitles, audio plan, or micro-shot structure.
- Preserve story_beats, linked_beat_ids, story_function, cause/effect, and payoff/turning-point reaction information as prompt context. Do not erase the story trace.
- Respect storyboard_brief, camera_graph, final_transition_plan, segment_render_descriptions, start/end frame contracts, motion contracts, and single_take_contracts.
- Compile the exact camera_graph inheritance scope into every affected image/video prompt. Never turn a same_spatial_context or same_subject_group relation into unrestricted visual copying. For alternate_view preserve the 180-degree axis and left-right relationships. For new_camera_setup use its transition reference decision and do not silently copy the previous composition.
- Every prompt must preserve the anchors referenced by that keyframe, segment, or micro-shot.
- Keyframe prompts describe one still image only, no motion process, no subtitles, no watermark, no UI.
- Segment prompts describe one continuous unbroken camera take from start boundary frame to end boundary frame.
- Segment prompts must explicitly forbid internal cuts, jump cuts, fades, dissolves, crossfades, montage edits, ghost overlays, scene swaps, teleportation, and hard visual transitions inside the clip.
- Micro-shot image prompts describe one static internal reference image that belongs to the same continuous take and same scene, not a separate shot or scene.
- Every *_zh prompt field must contain Simplified Chinese prose only. Every *_en prompt field must contain English prose only. Preserve proper names, approved lettering, and IDs verbatim, but never mix descriptive prose languages.
- Keep every individual image_prompt_zh and image_prompt_en at or below ${ONE_PROMPT_IMAGE_PROMPT_GENERATION_TARGET_CHARS} characters. Use compact visible attribute clauses; remove explanations, repeated facts, synonyms, and ornamental quality phrases.
- Within that budget, preserve in this order: exact subject identity/count, required action or state, key props/markings, composition/camera, consistency inheritance, and forbidden outcomes. Never shorten by dropping a hard user, identity, product, or boundary requirement.

Return this JSON shape:
{
  "prompt_detail_plan": {
    "keyframe_prompts": [
      {
        "keyframe_no": 1,
        "image_prompt_zh": "",
        "image_prompt_en": "",
        "negative_prompt_zh": "",
        "negative_prompt_en": ""
      }
    ],
    "segment_video_prompts": [
      {
        "segment_no": 1,
        "video_prompt_zh": "",
        "video_prompt_en": "",
        "negative_prompt_zh": "",
        "negative_prompt_en": ""
      }
    ],
    "micro_shot_image_prompts": [
      {
        "segment_no": 1,
        "micro_shot_no": 1,
        "image_prompt_zh": "",
        "image_prompt_en": ""
      }
    ],
    "negative_prompt_groups": [],
    "generation_notes": []
  }
}`;

type ChatContent = string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

type JsonStageContentResult = {
  httpStatus: number;
  ok: boolean;
  durationMs: number;
  content: string;
  rawSummary: unknown;
  streamChunkMode: "non_stream" | "none" | "delta" | "cumulative" | "mixed";
  errorMessage?: string;
};

export type PlanningDecompositionMode = "split";

export type PlannerCheckpointStage =
  | "reference_analysis"
  | "route_classification"
  | "story_architect"
  | "asset_contract"
  | "storyboard_artist"
  | "story_validation"
  | "shot_decomposition"
  | "prompt_compilation";

export interface AliyunStoryboardPlannerCheckpoint {
  version: 14;
  checkpointVersion: 14;
  plannerMode: "split";
  inputFingerprint: string;
  inputSnapshot: Record<string, unknown>;
  completedStages: PlannerCheckpointStage[];
  stageOutputs: Partial<Record<PlannerCheckpointStage, unknown>>;
  contractVersions: Record<PlannerCheckpointStage, string>;
  referenceFingerprint: string;
  migrationAudit?: {
    fromVersion: number;
    toVersion: 14;
    preservedStages: PlannerCheckpointStage[];
    invalidatedStages: PlannerCheckpointStage[];
    reasons: string[];
    migratedAt: string;
  };
  referenceFactsRaw?: unknown;
  referenceFactsFingerprint?: string;
  routeClassification?: RouteClassificationCheckpoint;
  approvedRouteContract?: ApprovedPlanningRouteContract;
  planningDecompositionMode?: PlanningDecompositionMode;
  planningCoreRaw?: unknown;
  assetVisualSpecsByAnchorId?: Record<string, unknown>;
  assetVisualSpecFingerprints?: Record<string, string>;
  planningRaw?: unknown;
  assetPromptRepairRaw?: unknown;
  storyboardArtistPlan?: Record<string, unknown>;
  storyContractReport?: StoryContractGateResult;
  storySemanticReview?: VideoStorySemanticReview;
  shotDecomposerSegmentPlans?: Record<string, Record<string, unknown>>;
  approvedShotDecomposerSegmentPlans?: Record<string, Record<string, unknown>>;
  promptDetailSegmentPlans?: Record<string, VideoPromptDetailPlan>;
  finalPromptRepairAttempts?: number;
  timelineReplanAttempts?: number;
  timelineChangeHistory?: TimelineChangeRequest[];
  planningContractRepairState?: {
    status: "repairing" | "event_replan_required" | "passed";
    authority: "event" | "legacy_migrated";
    attempts: PlanningContractRepairAttempt[];
    currentIssues: PlanningNarrativeContractIssue[];
    lastCandidateRaw?: unknown;
    updatedAt: string;
  };
  resumeFromStage?: AliyunStoryboardProgressStage;
  lastFailure?: {
    fingerprint: string;
    stage: string;
    code: string;
    count: number;
    invalidatedAt: string;
  };
  structuredFailures?: Record<string, StructuredFailureState>;
  updatedAt: string;
}

export interface TimelineChangeRequest {
  requestId: string;
  source: "single_take_audit";
  changeType: "split_segment";
  affectedSegmentNos: number[];
  firstAffectedSegmentNo: number;
  issueCodes: string[];
  reasons: string[];
  requestedChanges: unknown[];
}

function structuredFailureCheckpointKey(
  stage: string,
  segment: number,
  schemaVersion: string,
): string {
  return `${stage}:segment=${segment}:schema=${schemaVersion}`;
}

function contractIssuesFromStageError(error: unknown): StructuredContractIssue[] {
  const messages = error instanceof StoryboardStageError && error.validationErrors?.length
    ? error.validationErrors
    : [error instanceof Error ? error.message : String(error)];
  return messages.map((rawMessage) => {
    const separator = rawMessage.indexOf(": ");
    return {
      path: separator > 0 ? rawMessage.slice(0, separator) : "$",
      code: error instanceof StoryboardStageError ? error.code : "contract_validation_error",
      kind: "shape",
      message: separator > 0 ? rawMessage.slice(separator + 2) : rawMessage,
    };
  });
}

function structuredIssueUserSummary(
  segmentNo: number,
  issues: readonly StructuredContractIssue[],
): string {
  const details = issues.slice(0, 3).map((issue) => {
    const path = issue.path
      .replace(/^\$\.shot_decomposer_plan\.segment_render_descriptions\[\d+\]\.?/, "")
      .replace(/^\$\./, "");
    const reason = /required/i.test(issue.message)
      ? "缺失"
      : issue.message;
    return `${path || "合同结构"} ${reason}`;
  });
  return `第${segmentNo}片段 ${details.join("；")}`;
}

export class TimelineReplanRequiredError extends Error {
  readonly request: TimelineChangeRequest;

  constructor(request: TimelineChangeRequest) {
    super(`Stage 1 timeline replan required from segment ${request.firstAffectedSegmentNo}: ${request.issueCodes.join(", ")}`);
    this.name = "TimelineReplanRequiredError";
    this.request = request;
  }
}

export type AliyunStoryboardProgressStage =
  | "queued"
  | "reference_fact_extractor"
  | "planning_architect"
  | "planning_contract_repair"
  | "planning_duration_repair"
  | "asset_prompt_contract_gate"
  | "asset_prompt_contract_repair"
  | "asset_visual_spec"
  | "storyboard_artist"
  | "story_contract_gate"
  | "story_contract_repair"
  | "story_semantic_critic"
  | "story_semantic_repair"
  | "asset_contract_gate"
  | "shot_decomposer"
  | "single_take_audit"
  | "split_repair"
  | "timeline_replan"
  | "json_repair"
  | "prompt_detailer"
  | "story_quality_gate"
  | "complete"
  | "failed";

export interface AliyunStoryboardProgressUpdate {
  stage: AliyunStoryboardProgressStage;
  completedSteps?: number;
  totalSteps?: number;
  currentSegmentNo?: number;
  completedSegments?: number;
  totalSegments?: number;
  attempt?: number;
  detailZh?: string;
  detailEn?: string;
  metricsDelta?: {
    jsonRepairCount?: number;
    jsonRepairDurationMs?: number;
    singleTakeRepairCount?: number;
    singleTakeRepairDurationMs?: number;
    storyContractRepairCount?: number;
    storyContractRepairDurationMs?: number;
  };
}

export interface AliyunStoryboardStageMetric {
  stage: string;
  modelName: string;
  status: "completed" | "failed";
  durationMs: number;
  httpStatus?: number;
  retryable?: boolean;
  startedAt: Date;
  completedAt: Date;
}

interface AliyunStoryboardPlannerOptions {
  checkpoint?: unknown;
  onCheckpoint?: (checkpoint: AliyunStoryboardPlannerCheckpoint) => Promise<void> | void;
  onProgress?: (progress: AliyunStoryboardProgressUpdate) => Promise<void> | void;
  onStageMetric?: (metric: AliyunStoryboardStageMetric) => Promise<void> | void;
  schedulingContext?: Omit<ProviderSchedulingContext, "targetId">;
}

const plannerProgressStorage = new AsyncLocalStorage<{
  onProgress?: (progress: AliyunStoryboardProgressUpdate) => Promise<void> | void;
  onStageMetric?: (metric: AliyunStoryboardStageMetric) => Promise<void> | void;
  schedulingContext?: Omit<ProviderSchedulingContext, "targetId">;
}>();

const STORYBOARD_PLANNER_CHECKPOINT_VERSION = 14 as const;
const STORYBOARD_PLANNER_CONTRACT_REVISION = "2026-07-29-approved-route-contract-v1";
const PLANNER_CHECKPOINT_STAGE_ORDER: readonly PlannerCheckpointStage[] = [
  "reference_analysis",
  "route_classification",
  "story_architect",
  "asset_contract",
  "storyboard_artist",
  "story_validation",
  "shot_decomposition",
  "prompt_compilation",
];
const PLANNER_CHECKPOINT_CONTRACT_VERSIONS: Record<PlannerCheckpointStage, string> = {
  reference_analysis: "reference-facts-v1",
  route_classification: ROUTE_CLASSIFICATION_STAGE_CONTRACT_VERSION,
  story_architect: "story-architect-v3-approved-route",
  asset_contract: "asset-contract-v2",
  storyboard_artist: "storyboard-artist-v2",
  story_validation: "story-validation-v2",
  shot_decomposition: "shot-decomposition-v2",
  prompt_compilation: "canonical-execution-contract-v2",
};

export async function createAliyunStoryboardPlan(
  input: PlanVideoProjectInput,
  options: AliyunStoryboardPlannerOptions = {},
): Promise<OnePromptVideoPlan> {
  return plannerProgressStorage.run(
    {
      onProgress: options.onProgress,
      onStageMetric: options.onStageMetric,
      schedulingContext: options.schedulingContext,
    },
    () => createAliyunStoryboardPlanInternal(input, options),
  );
}

export function applyManualPlanningRouteClassification(params: {
  checkpoint: AliyunStoryboardPlannerCheckpoint;
  input: PlanVideoProjectInput;
  referenceFactsRaw: unknown;
  routeContract: ApprovedPlanningRouteContract;
  editorName?: string;
  now?: string;
}): AliyunStoryboardPlannerCheckpoint {
  const previousRouteContract =
    params.checkpoint.routeClassification?.routeContract
    ?? params.checkpoint.approvedRouteContract;
  const routeChanges = comparePlanningRouteContracts(
    previousRouteContract,
    params.routeContract,
  );
  const routeInput = buildPlanningRouteInputForArchitect(
    params.input,
    params.referenceFactsRaw,
  );
  params.checkpoint.routeClassification =
    createManualLockedRouteClassificationCheckpoint({
      routeContract: params.routeContract,
      userInputFingerprint: routeUserInputFingerprint({
        userCreative: params.input.userPrompt,
        explicitRouteConstraints: routeInput.userConstraints,
      }),
      referenceFactFingerprint: routeReferenceFactFingerprint(
        routeInput.referenceFacts,
      ),
      editorModelName: params.editorName,
      previous: params.checkpoint.routeClassification,
      now: params.now,
    });
  params.checkpoint.approvedRouteContract =
    params.checkpoint.routeClassification.routeContract;
  if (routeChanges.invalidateProductionContent) {
    invalidatePlanningContentAfterRoute(params.checkpoint);
  }
  synchronizeCheckpointV14Fields(params.checkpoint);
  params.checkpoint.updatedAt =
    params.now ?? params.checkpoint.routeClassification.updatedAt;
  return params.checkpoint;
}

async function buildSplitPlanningRaw(params: {
  input: PlanVideoProjectInput;
  modelName: string;
  referenceFactsRaw: unknown;
  approvedRouteContract: ApprovedPlanningRouteContract;
  fallback: OnePromptVideoPlan;
  checkpoint: AliyunStoryboardPlannerCheckpoint;
  onCheckpoint?: (checkpoint: AliyunStoryboardPlannerCheckpoint) => Promise<void> | void;
}): Promise<Record<string, unknown>> {
  let planningCoreRaw = params.checkpoint.planningCoreRaw;
  if (planningCoreRaw === undefined) {
    planningCoreRaw = await executeStructuredStage({
      stage: "planning_architect_lite",
      modelName: params.modelName,
      systemPrompt: `${PLANNING_ARCHITECT_LITE_SYSTEM_PROMPT}${PLANNING_ARCHITECT_ROUTE_LOCK_RULES}`,
      userContent: buildPlanningArchitectContent(
        params.input,
        params.referenceFactsRaw,
        params.approvedRouteContract,
      ),
      temperature: 0.25,
    });
  } else {
    await logOnePromptVideo("aliyun.storyboard.planning_architect_lite.checkpoint_reused", {
      inputFingerprint: params.checkpoint.inputFingerprint,
    });
  }
  planningCoreRaw = applyApprovedRouteToPlanningArchitectOutput(
    planningCoreRaw,
    params.approvedRouteContract,
  );
  planningCoreRaw = await ensurePlanningDurationContract({
    input: params.input,
    modelName: params.modelName,
    planningRaw: planningCoreRaw,
  });
  let manifest = normalizePlanningManifest(
    planningCoreRaw,
    params.input,
    params.fallback,
  );
  const anchorCandidates = anchorCandidatesForAdmission(
    planningCoreRaw,
    manifest.consistencyManifest.anchors,
  );
  const admission = adjudicateConsistencyAnchorCandidates({
    anchors: anchorCandidates,
    narrativeEvents: narrativeEventsForAnchorAdmission(
      planningCoreRaw,
      manifest.consistencyManifest.anchors,
    ),
    userPrompt: params.input.userPrompt,
  });
  await logOnePromptVideo("aliyun.storyboard.anchor_admission.completed", {
    candidateCount: anchorCandidates.length,
    approvedCount: admission.approvedAnchors.length,
    eventLocalCount: admission.eventLocalElements.length,
    discardedCount: admission.discardedAnchorIds.length,
    decisions: admission.decisions.map((decision) => ({
      anchorId: decision.anchorId,
      status: decision.status,
      rule: decision.rule,
      score: decision.score,
      actualReuseCount: decision.usedByEventIds.length,
    })),
  });
  planningCoreRaw = applyAnchorAdmissionToPlanningRaw(planningCoreRaw, anchorCandidates, admission);
  params.checkpoint.planningCoreRaw = planningCoreRaw;
  await savePlannerCheckpoint(params.checkpoint, params.onCheckpoint);

  manifest = normalizePlanningManifest(
    planningCoreRaw,
    params.input,
    params.fallback,
  );
  manifest.consistencyManifest.eventLocalElements = admission.eventLocalElements;
  manifest.consistencyManifest.admissionDecisions = admission.decisions;
  manifest = await detailPlanningAssetVisualSpecs({
    input: params.input,
    modelName: params.modelName,
    planningManifest: manifest,
    checkpoint: params.checkpoint,
    onCheckpoint: params.onCheckpoint,
  });
  manifest = materializePlanningAssetImagePrompts(manifest);
  const issues = [
    ...validatePlanningAssetImageContracts(manifest.consistencyManifest.anchors),
    ...validatePlanningAssetExecutionPrompts(manifest.consistencyManifest.anchors),
  ];
  if (issues.length) {
    throw new StoryboardStageError(
      `Split planning did not produce executable asset contracts: ${formatAssetContractIssues(issues)}`,
      { code: "contract_validation_error", retryable: true },
    );
  }
  return assemblePlanningAssetSpecs(
    planningCoreRaw,
    manifest.consistencyManifest.anchors,
  );
}

const ANCHOR_REFERENCE_ARRAY_KEYS = new Set([
  "required_anchor_ids",
  "requiredAnchorIds",
  "declared_anchor_ids",
  "declaredAnchorIds",
  "derived_anchor_ids",
  "derivedAnchorIds",
  "effective_required_anchor_ids",
  "effectiveRequiredAnchorIds",
  "visible_anchor_ids",
  "visibleAnchorIds",
  "uses_consistency_anchors",
  "usesConsistencyAnchors",
]);

function narrativeEventsForAnchorAdmission(
  planningRaw: unknown,
  anchors: VideoConsistencyAnchor[],
): NarrativeEvent[] {
  const envelope = isRecord(planningRaw) ? planningRaw : {};
  const root = isRecord(envelope.planning_manifest)
    ? envelope.planning_manifest
    : isRecord(envelope.planningManifest)
      ? envelope.planningManifest
      : {};
  const source = readLoose(envelope, "narrativeEvents", "narrative_events")
    ?? readLoose(root, "narrativeEvents", "narrative_events")
    ?? [];
  return normalizeNarrativeEvents(source, {
    warnings: [],
    anchorIds: new Set(anchors.map((anchor) => anchor.id)),
  });
}

function anchorCandidatesForAdmission(
  planningRaw: unknown,
  fallbackAnchors: VideoConsistencyAnchor[],
): VideoConsistencyAnchor[] {
  const envelope = isRecord(planningRaw) ? planningRaw : {};
  const topManifest = isRecord(envelope.consistency_manifest)
    ? envelope.consistency_manifest
    : isRecord(envelope.consistencyManifest)
      ? envelope.consistencyManifest
      : {};
  const planningManifest = isRecord(envelope.planning_manifest)
    ? envelope.planning_manifest
    : isRecord(envelope.planningManifest)
      ? envelope.planningManifest
      : {};
  const nestedManifest = isRecord(planningManifest.consistency_manifest)
    ? planningManifest.consistency_manifest
    : isRecord(planningManifest.consistencyManifest)
      ? planningManifest.consistencyManifest
      : {};
  const storedCandidates = topManifest.anchor_candidates
    ?? topManifest.anchorCandidates
    ?? nestedManifest.anchor_candidates
    ?? nestedManifest.anchorCandidates;
  const normalized = normalizeAnchors(storedCandidates);
  return normalized.length ? normalized : fallbackAnchors;
}

function scrubRejectedAnchorReferences(value: unknown, rejectedIds: Set<string>): unknown {
  if (Array.isArray(value)) {
    return value
      .filter((item) => {
        if (!isRecord(item)) return true;
        const anchorId = stringOr(item.anchorId ?? item.anchor_id, "");
        return !anchorId || !rejectedIds.has(anchorId);
      })
      .map((item) => scrubRejectedAnchorReferences(item, rejectedIds));
  }
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (ANCHOR_REFERENCE_ARRAY_KEYS.has(key) && Array.isArray(item)) {
      result[key] = item.filter((anchorId) => typeof anchorId !== "string" || !rejectedIds.has(anchorId));
      continue;
    }
    result[key] = scrubRejectedAnchorReferences(item, rejectedIds);
  }
  return result;
}

function applyAnchorAdmissionToPlanningRaw(
  planningRaw: unknown,
  candidates: VideoConsistencyAnchor[],
  admission: AnchorAdmissionResult,
): Record<string, unknown> {
  const rejectedIds = new Set(admission.decisions
    .filter((decision) => decision.status !== "approved")
    .map((decision) => decision.anchorId));
  const scrubbed = scrubRejectedAnchorReferences(
    assemblePlanningAssetSpecs(planningRaw, admission.approvedAnchors),
    rejectedIds,
  );
  const envelope = isRecord(scrubbed) ? scrubbed : {};
  const topManifest = isRecord(envelope.consistency_manifest)
    ? envelope.consistency_manifest
    : {};
  const planningManifest = isRecord(envelope.planning_manifest)
    ? envelope.planning_manifest
    : {};
  const nestedManifest = isRecord(planningManifest.consistency_manifest)
    ? planningManifest.consistency_manifest
    : {};
  return {
    ...envelope,
    consistency_manifest: {
      ...topManifest,
      anchors: admission.approvedAnchors,
      anchor_candidates: candidates,
      event_local_elements: admission.eventLocalElements,
      admission_decisions: admission.decisions,
    },
    planning_manifest: {
      ...planningManifest,
      consistency_manifest: {
        ...nestedManifest,
        anchors: admission.approvedAnchors,
        anchor_candidates: candidates,
        event_local_elements: admission.eventLocalElements,
        admission_decisions: admission.decisions,
      },
    },
  };
}

async function createAliyunStoryboardPlanInternal(
  input: PlanVideoProjectInput,
  options: AliyunStoryboardPlannerOptions,
): Promise<OnePromptVideoPlan> {
  const referenceImageUrls = input.referenceImageUrls.slice(0, ONE_PROMPT_MAX_REFERENCE_IMAGES);
  const fallback = createVideoPlan(input);
  const textModel = model("ALIYUN_STORYBOARD_MODEL", "qwen3.7-plus");
  const referenceFactModel = model("ALIYUN_STORYBOARD_REFERENCE_FACT_MODEL", "qwen-vl-plus");
  const checkpoint = normalizeAliyunStoryboardPlannerCheckpoint(options.checkpoint, input);
  const onCheckpoint = serializePlannerCheckpointWriter(options.onCheckpoint);
  checkpoint.planningDecompositionMode = "split";
  await logOnePromptVideo("aliyun.storyboard.checkpoint.resume_plan", {
    checkpointVersion: checkpoint.checkpointVersion,
    plannerMode: checkpoint.plannerMode,
    preservedStages: checkpoint.migrationAudit?.preservedStages ?? [],
    invalidatedStages: checkpoint.migrationAudit?.invalidatedStages ?? [],
    invalidationReasons: checkpoint.migrationAudit?.reasons ?? [],
    referenceFingerprint: checkpoint.referenceFingerprint,
  });

  await logOnePromptVideo("aliyun.storyboard.three_stage.start", {
    promptLength: input.userPrompt.length,
    aspectRatio: input.aspectRatio,
    durationSeconds: input.durationSeconds,
    referenceImageCount: referenceImageUrls.length,
  });

  try {
    const resumeValidation = revalidatePlannerCheckpointForResume({
      checkpoint,
      input,
      fallback,
    });
    if (resumeValidation.invalidated) {
      await savePlannerCheckpoint(checkpoint, onCheckpoint);
      await logOnePromptVideo("aliyun.storyboard.checkpoint.invalidated_on_resume", {
        resumeFromStage: checkpoint.resumeFromStage,
        issueCount: resumeValidation.issues.length,
        issues: resumeValidation.issues.slice(0, 20),
        lastFailure: checkpoint.lastFailure,
      }, "warn");
    }
    const referenceFactsFingerprint = referenceImageUrls.length
      ? createHash("sha256").update(JSON.stringify(referenceImageUrls)).digest("hex")
      : "";
    let referenceFactsRaw: unknown = {};
    if (referenceImageUrls.length) {
      const reusableReferenceFacts = checkpoint.referenceFactsFingerprint === referenceFactsFingerprint
        && checkpoint.referenceFactsRaw !== undefined;
      if (!reusableReferenceFacts) await reportPlannerProgress({
        stage: "reference_fact_extractor",
        completedSteps: 0,
        totalSteps: 5,
        detailZh: "正在提取参考图中的客观人物、产品、场景和布局事实。",
        detailEn: "Extracting objective people, product, scene, and layout facts from the references.",
      });
      if (reusableReferenceFacts) {
        referenceFactsRaw = checkpoint.referenceFactsRaw;
        await logOnePromptVideo("aliyun.storyboard.reference_facts.checkpoint_reused", {
          inputFingerprint: checkpoint.inputFingerprint,
          referenceFactsFingerprint,
        });
        if (clearPlannerCheckpointFailureAfterStageSuccess(
          checkpoint,
          "reference_fact_extractor",
        )) {
          await savePlannerCheckpoint(checkpoint, onCheckpoint);
        }
      } else {
        referenceFactsRaw = await runStoryboardStageWithRetry({
          stage: "reference_fact_extractor",
          maxAttempts: REFERENCE_FACT_STAGE_MAX_ATTEMPTS,
          baseDelayMs: 250,
          run: () => extractReferenceFacts(
            referenceFactModel,
            referenceImageUrls,
            referenceFactsFingerprint,
          ),
          onRetry: async ({ attempt, nextAttempt, error }) => {
            await logOnePromptVideo(
              "aliyun.storyboard.reference_fact_extractor.stage_retry",
              {
                attempt,
                nextAttempt,
                retryScope: "current_stage_only",
                errorClassification: isStructuredOutputSyntaxError(error)
                  ? error.classification
                  : "transient_stage_error",
                ...errorForLog(error),
              },
              "warn",
            );
            await reportPlannerProgress({
              stage: "reference_fact_extractor",
              detailZh: `参考图事实结构化输出未通过，正在仅重试当前阶段（${nextAttempt}/${REFERENCE_FACT_STAGE_MAX_ATTEMPTS}）。`,
              detailEn: `Reference fact structured output failed. Retrying only this stage (${nextAttempt}/${REFERENCE_FACT_STAGE_MAX_ATTEMPTS}).`,
            });
          },
        });
        checkpoint.referenceFactsRaw = referenceFactsRaw;
        checkpoint.referenceFactsFingerprint = referenceFactsFingerprint;
        clearPlannerCheckpointFailureAfterStageSuccess(
          checkpoint,
          "reference_fact_extractor",
        );
        await savePlannerCheckpoint(checkpoint, onCheckpoint);
        await logOnePromptVideo(
          "aliyun.storyboard.reference_fact_extractor.checkpoint_saved",
          {
            referenceFactsFingerprint,
            nextStage: "planning_architect",
          },
        );
      }
    }
    const routeInput = buildPlanningRouteInputForArchitect(input, referenceFactsRaw);
    const currentRouteUserInputFingerprint = routeUserInputFingerprint({
      userCreative: input.userPrompt,
      explicitRouteConstraints: routeInput.userConstraints,
    });
    const currentRouteReferenceFactFingerprint = routeReferenceFactFingerprint(
      routeInput.referenceFacts,
    );
    const routeReuse = decideRouteCheckpointReuse({
      checkpoint: checkpoint.routeClassification,
      userInputFingerprint: currentRouteUserInputFingerprint,
      referenceFactFingerprint: currentRouteReferenceFactFingerprint,
    });
    const routeTaskId = randomUUID();
    const routeStageStartedAtMs = Date.now();
    const routeProjectId = options.schedulingContext?.projectId ?? "unscoped";
    const compactRouteInputCharacterCount = JSON.stringify(routeInput).length;
    const initialRouteRequestCharacterCount = JSON.stringify(
      buildPlanningRouteChatRequest(buildPlanningRouteUserPrompt(routeInput)),
    ).length;
    const writeRouteLog = async (
      event: PlanningRouteLogEvent,
      params: Omit<Parameters<typeof createPlanningRouteLogRecord>[0], "projectId" | "routeTaskId" | "model">,
    ) => logOnePromptVideo(event, createPlanningRouteLogRecord({
      projectId: routeProjectId,
      routeTaskId,
      model: PLANNING_ROUTE_MODEL_CALL_POLICY.model,
      ...params,
    }));
    await writeRouteLog("planning.route.prepare", {
      route: checkpoint.routeClassification?.routeContract,
      routeDurationMs: Date.now() - routeStageStartedAtMs,
      inputCharacterCount: routeReuse.reuse ? 0 : initialRouteRequestCharacterCount,
      checkpointReused: routeReuse.reuse,
      gateResult: checkpoint.routeClassification?.gateResult.status ?? null,
      repairCount: 0,
      fallback: Boolean(checkpoint.routeClassification?.fallbackInfo),
      extra: {
        reuseDecision: routeReuse.reason,
        referenceFactCount: routeInput.hasReferenceImage ? 1 : 0,
        compactRouteInputCharacterCount,
      },
    });
    const previousRouteContract =
      checkpoint.routeClassification?.routeContract
      ?? checkpoint.approvedRouteContract;
    let approvedRouteContract = routeReuse.reuse
      ? checkpoint.routeClassification?.routeContract
      : undefined;
    if (!approvedRouteContract) {
      checkpoint.routeClassification = undefined;
      checkpoint.approvedRouteContract = undefined;
      await reportPlannerProgress({
        stage: "planning_architect",
        detailZh: "正在确定视频品类、叙事模板、时间顺序和 Hook 路线。",
        detailEn: "Selecting the approved video category, narrative template, chronology, and Hook route.",
      });
      await writeRouteLog("planning.route.model.start", {
        routeDurationMs: Date.now() - routeStageStartedAtMs,
        inputCharacterCount: initialRouteRequestCharacterCount,
        checkpointReused: false,
        extra: { attempt: 1, hardTimeoutMs: PLANNING_ROUTE_MODEL_CALL_POLICY.hardTimeoutMs },
      });
      let routeResult: Awaited<ReturnType<typeof runPlanningRouteModelCall>>;
      try {
        routeResult = await runPlanningRouteModelCall({
          input: routeInput,
          transport: createOpenAiCompatiblePlanningRouteTransport({
            endpoint: `${compatibleBaseUrl()}/chat/completions`,
            apiKey: requireDashScopeApiKey(),
          }),
        });
      } catch (error) {
        await writeRouteLog("planning.route.model.complete", {
          apiWaitDurationMs: error instanceof PlanningRouteModelCallError
            ? error.apiWaitDurationMs
            : 0,
          routeDurationMs: Date.now() - routeStageStartedAtMs,
          inputCharacterCount: error instanceof PlanningRouteModelCallError
            ? error.inputCharacterCount
            : initialRouteRequestCharacterCount,
          responseCharacterCount: error instanceof PlanningRouteModelCallError
            ? error.responseCharacterCount
            : 0,
          checkpointReused: false,
          extra: { status: "failed", ...errorForLog(error) },
        });
        await writeRouteLog("planning.route.complete", {
          apiWaitDurationMs: error instanceof PlanningRouteModelCallError
            ? error.apiWaitDurationMs
            : 0,
          routeDurationMs: Date.now() - routeStageStartedAtMs,
          inputCharacterCount: error instanceof PlanningRouteModelCallError
            ? error.inputCharacterCount
            : initialRouteRequestCharacterCount,
          responseCharacterCount: error instanceof PlanningRouteModelCallError
            ? error.responseCharacterCount
            : 0,
          checkpointReused: false,
          extra: { status: "failed", ...errorForLog(error) },
        });
        throw error;
      }
      const routeResultLog = {
        route: routeResult.value,
        apiWaitDurationMs: routeResult.apiWaitDurationMs,
        routeDurationMs: Date.now() - routeStageStartedAtMs,
        inputTokens: routeResult.inputTokens,
        outputTokens: routeResult.outputTokens,
        inputCharacterCount: routeResult.inputCharacterCount,
        responseCharacterCount: routeResult.responseCharacterCount,
        gateResult: routeResult.gateStatus,
        repairCount: routeResult.repairCallCount,
        fallback: routeResult.gateStatus === "fallback",
        checkpointReused: false,
      };
      await writeRouteLog("planning.route.model.complete", {
        ...routeResultLog,
        extra: {
          status: "completed",
          attemptCount: routeResult.attemptCount,
          fullApiWaitDurationMs: routeResult.apiWaitDurationMs,
        },
      });
      let parseSucceeded = false;
      try {
        JSON.parse(routeResult.rawContent);
        parseSucceeded = true;
      } catch {
        parseSucceeded = false;
      }
      await writeRouteLog("planning.route.parse", {
        ...routeResultLog,
        extra: { parseSucceeded },
      });
      await writeRouteLog("planning.route.gate", {
        ...routeResultLog,
        extra: {
          issueCodes: routeResult.gateIssues.map((item) => item.code),
          repairCodes: routeResult.gateRepairs.map((item) => item.ruleCode ?? item.action),
        },
      });
      if (routeResult.gateRepairs.length) {
        await writeRouteLog("planning.route.deterministic_repair", {
          ...routeResultLog,
          extra: {
            deterministicRepairCount: routeResult.gateRepairs.length,
            repairCodes: routeResult.gateRepairs.map((item) => item.ruleCode ?? item.action),
          },
        });
      }
      if (routeResult.repairCallCount > 0) {
        await writeRouteLog("planning.route.model_repair", {
          ...routeResultLog,
          extra: {
            repairTrigger: routeResult.repairTrigger,
            repairFailureReasons: routeResult.repairFailureReasons,
          },
        });
      }
      if (routeResult.gateStatus === "fallback") {
        await writeRouteLog("planning.route.fallback", {
          ...routeResultLog,
          extra: {
            fallbackReason: routeResult.value.fallbackReason ?? null,
            shouldBlockPlanning: routeResult.fallbackInfo?.shouldBlockPlanning ?? false,
          },
        });
      }
      if (routeResult.fallbackInfo?.shouldBlockPlanning) {
        await writeRouteLog("planning.route.complete", {
          ...routeResultLog,
          routeDurationMs: Date.now() - routeStageStartedAtMs,
          extra: {
            status: "blocked",
            blockingReason: routeResult.fallbackInfo.blockingReason ?? null,
          },
        });
        throw new PlanningArchitectRouteConflictError({
          code: "PLANNING_ARCHITECT_ROUTE_INPUT_CONFLICT",
          message: routeResult.fallbackInfo.blockingReason
            ?? "Approved Route Contract cannot continue because the request is unsupported",
          conflictingInputFields: ["userPrompt"],
        });
      }
      approvedRouteContract = routeResult.value as ApprovedPlanningRouteContract;
      const routeChanges = comparePlanningRouteContracts(
        previousRouteContract,
        approvedRouteContract,
      );
      if (routeChanges.invalidateProductionContent) {
        invalidatePlanningContentAfterRoute(checkpoint);
      }
      checkpoint.approvedRouteContract = approvedRouteContract;
      checkpoint.routeClassification = createModelRouteClassificationCheckpoint({
        routeContract: approvedRouteContract,
        userInputFingerprint: currentRouteUserInputFingerprint,
        referenceFactFingerprint: currentRouteReferenceFactFingerprint,
        modelName: PLANNING_ROUTE_MODEL_CALL_POLICY.model,
        modelDurationMs: routeResult.durationMs,
        inputTokens: routeResult.inputTokens,
        outputTokens: routeResult.outputTokens,
        gateStatus: routeResult.gateStatus,
        gateIssues: routeResult.gateIssues,
        gateRepairs: routeResult.gateRepairs,
        repairCount: routeResult.repairCallCount,
        fallbackInfo: routeResult.fallbackInfo,
      });
      await savePlannerCheckpoint(checkpoint, onCheckpoint);
      await logOnePromptVideo("aliyun.storyboard.route_contract.approved", {
        videoCategory: approvedRouteContract.videoCategory,
        templateId: approvedRouteContract.templateId,
        chronologyMode: approvedRouteContract.chronologyMode,
        hookMode: approvedRouteContract.hookMode,
        hookRevealLevel: approvedRouteContract.hookRevealLevel,
        fallbackUsed: approvedRouteContract.fallbackUsed,
        gateStatus: routeResult.gateStatus,
        repairTrigger: routeResult.repairTrigger,
        attemptCount: routeResult.attemptCount,
        modelDurationMs: routeResult.durationMs,
        inputTokens: routeResult.inputTokens,
        outputTokens: routeResult.outputTokens,
        changedFields: routeChanges.changedFields,
        invalidationBoundary: routeChanges.checkpointBoundary,
        invalidationScopes: routeChanges.semanticScopes,
      });
      await writeRouteLog("planning.route.complete", {
        ...routeResultLog,
        route: approvedRouteContract,
        routeDurationMs: Date.now() - routeStageStartedAtMs,
        extra: {
          status: "completed",
          changedFields: routeChanges.changedFields,
          invalidationBoundary: routeChanges.checkpointBoundary,
        },
      });
    } else {
      checkpoint.approvedRouteContract = approvedRouteContract;
      await writeRouteLog("planning.route.checkpoint.reused", {
        route: approvedRouteContract,
        routeDurationMs: Date.now() - routeStageStartedAtMs,
        inputTokens: 0,
        outputTokens: 0,
        inputCharacterCount: 0,
        responseCharacterCount: 0,
        gateResult: checkpoint.routeClassification?.gateResult.status ?? null,
        repairCount: 0,
        fallback: Boolean(checkpoint.routeClassification?.fallbackInfo),
        checkpointReused: true,
        extra: { reuseReason: routeReuse.reason },
      });
      await logOnePromptVideo("aliyun.storyboard.route_contract.checkpoint_reused", {
        videoCategory: approvedRouteContract.videoCategory,
        templateId: approvedRouteContract.templateId,
        chronologyMode: approvedRouteContract.chronologyMode,
        reuseReason: routeReuse.reason,
        locked: checkpoint.routeClassification?.locked ?? false,
      });
      await writeRouteLog("planning.route.complete", {
        route: approvedRouteContract,
        routeDurationMs: Date.now() - routeStageStartedAtMs,
        inputTokens: 0,
        outputTokens: 0,
        inputCharacterCount: 0,
        responseCharacterCount: 0,
        gateResult: checkpoint.routeClassification?.gateResult.status ?? null,
        repairCount: 0,
        fallback: Boolean(checkpoint.routeClassification?.fallbackInfo),
        checkpointReused: true,
        extra: { status: "completed", reuseReason: routeReuse.reason },
      });
    }
    assertRouteContractIsSoleAuthority({
      rolloutDecision: decidePlanningRouteRollout({
        stage: "percent_100",
        projectId: routeProjectId,
      }),
      approvedRouteContractPresent: Boolean(approvedRouteContract),
      planningArchitectClassificationEnabled: false,
    });
    if (checkpoint.planningRaw === undefined) await reportPlannerProgress({
      stage: "planning_architect",
      completedSteps: referenceImageUrls.length ? 1 : 0,
      totalSteps: referenceImageUrls.length ? 5 : 4,
      detailZh: "正在理解创意、参考图、广告目标和时间轴约束。",
      detailEn: "Understanding the brief, references, campaign goal, and timeline constraints.",
    });
    let planningRaw = checkpoint.planningRaw;
    if (planningRaw === undefined) {
      const planningPromptStartedAtMs = Date.now();
      await logOnePromptVideo("production.step.completed", {
        moduleNameZh: "故事架构与一致性资产规划",
        stepNameZh: "编写故事架构和一致性资产规划提示词",
        executionMethod: "program",
        durationMs: Date.now() - planningPromptStartedAtMs,
        model: textModel,
        resultZh: "已写入创意、参考事实、广告目标、时长和资产约束",
      });
      planningRaw = await buildSplitPlanningRaw({
        input,
        modelName: textModel,
        referenceFactsRaw,
        approvedRouteContract,
        fallback,
        checkpoint,
        onCheckpoint,
      });
    }
    if (checkpoint.planningRaw !== undefined) {
      await logOnePromptVideo("aliyun.storyboard.planning_architect.checkpoint_reused", {
        inputFingerprint: checkpoint.inputFingerprint,
      });
    }
    planningRaw = await ensurePlanningDurationContract({
      input,
      modelName: textModel,
      planningRaw,
    });
    planningRaw = applyApprovedRouteToPlanningArchitectOutput(
      planningRaw,
      approvedRouteContract,
    );
    checkpoint.planningRaw = planningRaw;
    clearPlannerCheckpointFailureAfterStageSuccess(checkpoint, [
      "planning_architect",
      "planning_duration_repair",
    ]);
    await savePlannerCheckpoint(checkpoint, onCheckpoint);
    let planningManifest = materializePlanningAssetImagePrompts(
      normalizePlanningManifest(planningRaw, input, fallback),
    );
    await reportPlannerProgress({
      stage: "asset_prompt_contract_gate",
      detailZh: "正在检查人物、场景和道具资产描述是否具体、可执行且可验收。",
      detailEn: "Checking whether character, scene, and prop asset specifications are concrete, executable, and testable.",
    });
    const assetContractCheckStartedAtMs = Date.now();
    let assetContractIssues = [
      ...validatePlanningAssetImageContracts(planningManifest.consistencyManifest.anchors),
      ...validatePlanningAssetExecutionPrompts(planningManifest.consistencyManifest.anchors),
    ];
    await logOnePromptVideo("production.step.completed", {
      moduleNameZh: "一致性资产规划",
      stepNameZh: "程序质检资产描述是否具体、可生成、可验收",
      executionMethod: "deterministic_program",
      durationMs: Date.now() - assetContractCheckStartedAtMs,
      passed: assetContractIssues.length === 0,
      resultZh: assetContractIssues.length
        ? `发现 ${assetContractIssues.length} 个问题，打回大模型修复`
        : `检查 ${planningManifest.consistencyManifest.anchors.length} 个资产，全部通过`,
    });
    if (assetContractIssues.length) {
      const assetRepairCycleStartedAtMs = Date.now();
      await reportPlannerProgress({
        stage: "asset_prompt_contract_repair",
        attempt: 1,
        detailZh: `发现 ${assetContractIssues.length} 个资产描述结构问题，正在规划阶段自动返修。`,
        detailEn: `Found ${assetContractIssues.length} asset specification issues. Repairing them before storyboard decomposition.`,
      });
      const invalidAnchorIds = new Set(assetContractIssues.map((issue) => issue.anchorId));
      const invalidAnchors = planningManifest.consistencyManifest.anchors.filter((anchor) => invalidAnchorIds.has(anchor.id));
      const assetRepairPlan = buildModelRepairPlan({
        targetStage: "asset_prompt_contract_repair",
        issues: assetContractIssues,
        scope: { kind: "anchors", anchorIds: [...invalidAnchorIds] },
        preserveRules: [
          "Preserve anchor id, type, identity descriptions, visual_lock, reference strength, and every valid anchor.",
          "Modify only asset_image_contract for invalid anchors. All natural-language contract values must be English.",
        ],
      });
      // The cached repair is already known to fail this deterministic gate.
      // Generate a fresh targeted repair instead of replaying invalid output.
      const repairPromptStartedAtMs = Date.now();
      const repairUserContent = JSON.stringify({
        user_idea: input.userPrompt,
        aspect_ratio: input.aspectRatio,
        global_style: planningManifest.globalStyle,
        invalid_anchors: invalidAnchors,
        validation_issues: assetContractIssues,
        repair_plan: assetRepairPlan,
      });
      await logOnePromptVideo("production.step.completed", {
        moduleNameZh: "一致性资产规划",
        stepNameZh: "根据程序质检问题编写资产规划返修提示词",
        executionMethod: "program",
        durationMs: Date.now() - repairPromptStartedAtMs,
        model: textModel,
        attempt: 1,
        resultZh: `把 ${assetContractIssues.length} 个问题写入返修要求`,
      });
      const assetPromptRepairRaw = await executeStructuredStage({
        stage: "asset_prompt_contract_repair",
        modelName: textModel,
        systemPrompt: `${ASSET_IMAGE_CONTRACT_REPAIR_SYSTEM_PROMPT}${STRUCTURED_REPAIR_EXECUTION_RULES}`,
        userContent: repairUserContent,
        temperature: 0.15,
        maxTokens: Math.min(6000, invalidAnchors.length * 1200 + 400),
      });
      checkpoint.assetPromptRepairRaw = assetPromptRepairRaw;
      await savePlannerCheckpoint(checkpoint, onCheckpoint);
      planningManifest = materializePlanningAssetImagePrompts(
        mergeRepairedAssetAnchors(planningManifest, assetPromptRepairRaw),
      );
      const repairedAssetCheckStartedAtMs = Date.now();
      assetContractIssues = [
        ...validatePlanningAssetImageContracts(planningManifest.consistencyManifest.anchors),
        ...validatePlanningAssetExecutionPrompts(planningManifest.consistencyManifest.anchors),
      ];
      await logOnePromptVideo("production.step.completed", {
        moduleNameZh: "一致性资产规划",
        stepNameZh: "程序复检大模型返修后的资产描述",
        executionMethod: "deterministic_program",
        durationMs: Date.now() - repairedAssetCheckStartedAtMs,
        passed: assetContractIssues.length === 0,
        attempt: 2,
        resultZh: assetContractIssues.length
          ? `返修后仍有 ${assetContractIssues.length} 个问题`
          : "返修后的资产描述已经通过",
      }, assetContractIssues.length ? "warn" : "info");
      await logOnePromptVideo("production.step.completed", {
        moduleNameZh: "一致性资产规划",
        stepNameZh: "本轮资产规划从质检打回到返修复检完成",
        executionMethod: "program",
        durationMs: Date.now() - assetRepairCycleStartedAtMs,
        passed: assetContractIssues.length === 0,
        attempt: 1,
        resultZh: assetContractIssues.length ? "返修仍未通过" : "返修闭环完成",
      }, assetContractIssues.length ? "warn" : "info");
      if (assetContractIssues.length) {
        throw new StoryboardStageError(
          `剧本拆解未生成可执行的资产图片合同：${formatAssetContractIssues(assetContractIssues)}`,
          {
            code: "contract_validation_error",
            retryable: false,
            stage: "asset_prompt_contract_repair",
            validationErrors: assetContractIssues.map((issue) => `${issue.anchorId}.${issue.field}: ${issue.message}`),
          },
        );
      }
    }
    planningManifest = materializePlanningAssetImagePrompts(planningManifest);
    planningRaw = assemblePlanningAssetSpecs(
      planningRaw,
      planningManifest.consistencyManifest.anchors,
    );
    checkpoint.planningRaw = planningRaw;
    clearPlannerCheckpointFailureAfterStageSuccess(checkpoint, [
      "asset_prompt_contract_gate",
      "asset_prompt_contract_repair",
    ]);
    await savePlannerCheckpoint(checkpoint, onCheckpoint);
    const totalSegments = planningManifest.timelineBlueprint.segments.length;
    const segmentPipelineEnabled = totalSegments > 1;
    const referenceStepOffset = referenceImageUrls.length ? 1 : 0;
    const totalPlanningSteps = (segmentPipelineEnabled ? totalSegments * 2 : totalSegments) + 6 + referenceStepOffset;
    await reportPlannerProgress({
      stage: "storyboard_artist",
      completedSteps: 1 + referenceStepOffset,
      totalSteps: totalPlanningSteps,
      totalSegments,
      detailZh: `规划架构已完成，正在设计剧情节拍、冲突、转折和 CTA；后续需要拆解 ${totalSegments} 个片段。`,
      detailEn: `Planning architecture is complete. Designing story beats, conflict, payoff, and CTA before decomposing ${totalSegments} segments.`,
    });
    let planningStoryDesignBase = storyDesignStageContext(planningRaw);
    let planningCreativeStrategy = normalizeCreativeStrategy(
      planningStoryDesignBase.creative_strategy,
      planningManifest,
      [],
    );
    let planningNarrativeEvents = normalizeNarrativeEvents(
      planningStoryDesignBase.narrative_events,
      {
        warnings: [],
        anchorIds: new Set(planningManifest.consistencyManifest.anchors.map((anchor) => anchor.id)),
      },
    );
    const narrativeAuthority = materializeNarrativeEventStoryFunctions(
      planningNarrativeEvents,
      planningCreativeStrategy,
    );
    planningNarrativeEvents = narrativeAuthority.events;
    planningCreativeStrategy = applyEventAuthorityToCreativeStrategy(
      planningCreativeStrategy,
      planningNarrativeEvents,
    );
    const planningNarrativeContract = await ensurePlanningNarrativeContract({
      input,
      modelName: textModel,
      planningManifest,
      creativeStrategy: planningCreativeStrategy,
      narrativeEvents: planningNarrativeEvents,
      authority: narrativeAuthority.authority,
      checkpoint,
      onCheckpoint,
    });
    planningCreativeStrategy = mirrorApprovedRouteToCreativeStrategy(
      planningNarrativeContract.creativeStrategy,
      approvedRouteContract,
    );
    planningNarrativeEvents = planningNarrativeContract.narrativeEvents;
    planningRaw = replacePlanningNarrativeAuthority(
      planningRaw,
      planningCreativeStrategy,
      planningNarrativeEvents,
    );
    checkpoint.planningRaw = planningRaw;
    await savePlannerCheckpoint(checkpoint, onCheckpoint);
    planningStoryDesignBase = storyDesignStageContext(planningRaw);
    const planningTemplateId = planningCreativeStrategy.templateId ?? "generic_brand_story";
    const planningStoryDesignContext: Record<string, unknown> = {
      ...planningStoryDesignBase,
      creative_strategy: planningCreativeStrategy,
    };
    await logOnePromptVideo("aliyun.storyboard.planning_architect.parsed", {
      planningRaw,
      planningManifest,
      storyDesignContext: planningStoryDesignContext,
    });

    let storyboardArtistPlan = checkpoint.storyboardArtistPlan;
    if (!storyboardArtistPlan) {
      const storyboardArtistRaw = await executeStructuredStage({
        stage: "storyboard_artist",
        modelName: textModel,
        systemPrompt: STORYBOARD_ARTIST_SYSTEM_PROMPT,
        userContent: JSON.stringify({
          user_idea: input.userPrompt,
          aspect_ratio: input.aspectRatio,
          duration_seconds: input.durationSeconds,
          planning_manifest: planningManifest,
          story_design_context: planningStoryDesignContext,
          required_story_contract: {
            template_id: planningTemplateId,
            required_story_functions: requiredStoryFunctionsForTemplate(planningTemplateId),
            chronology_mode: planningCreativeStrategy.chronologyMode,
            hook_event_ids: planningCreativeStrategy.hookEventIds,
            conflict_event_ids: planningCreativeStrategy.conflictEventIds,
            turning_point_event_ids: planningCreativeStrategy.turningPointEventIds,
            payoff_event_ids: planningCreativeStrategy.payoffEventIds,
            cta_event_ids: planningCreativeStrategy.ctaEventIds,
            causal_fields: ["depends_on_beat_ids", "evidence_from_beat_ids", "resolves_conflict_beat_id"],
            evidence_registry_required: true,
          },
          confirmed_anchor_images: [],
        }),
        temperature: 0.3,
      });
      storyboardArtistPlan = unwrapPlanRoot(storyboardArtistRaw, "storyboard_artist_plan");
    } else {
      await logOnePromptVideo("aliyun.storyboard.storyboard_artist.checkpoint_reused", {
        inputFingerprint: checkpoint.inputFingerprint,
      });
    }
    await logOnePromptVideo("aliyun.storyboard.storyboard_artist.parsed", {
      storyboardArtistPlan,
    });
    const storyContractStartedAt = Date.now();
    let storyContractResult: Awaited<ReturnType<typeof ensureStoryboardStoryContract>>;
    const reusableStoryGates = Boolean(
      checkpoint.storyboardArtistPlan
      && checkpoint.storyContractReport?.passed
      && checkpoint.storySemanticReview,
    );
    if (reusableStoryGates) {
      storyContractResult = {
        storyboardArtistPlan,
        report: checkpoint.storyContractReport!,
        repairCount: 0,
      };
    } else {
      storyContractResult = await ensureStoryboardStoryContract({
        input,
        modelName: textModel,
        planningManifest,
        planningStoryDesignContext,
        planningTemplateId,
        storyboardArtistPlan,
      });
      storyboardArtistPlan = storyContractResult.storyboardArtistPlan;
    }
    const storyContractRepairDurationMs = Date.now() - storyContractStartedAt;
    let semanticStoryResult: Awaited<ReturnType<typeof ensureStoryboardSemanticQuality>>;
    if (reusableStoryGates) {
      semanticStoryResult = {
        storyboardArtistPlan,
        review: checkpoint.storySemanticReview!,
        repairCount: 0,
      };
      await logOnePromptVideo("aliyun.storyboard.story_gates.checkpoint_reused", {
        inputFingerprint: checkpoint.inputFingerprint,
        storyContractPassed: checkpoint.storyContractReport?.passed,
        semanticReviewPassed: checkpoint.storySemanticReview?.passed,
      });
    } else {
      semanticStoryResult = await ensureStoryboardSemanticQuality({
        input,
        modelName: model("ALIYUN_STORY_CRITIC_MODEL", textModel),
        repairModelName: textModel,
        planningManifest,
        planningStoryDesignContext,
        planningTemplateId,
        storyboardArtistPlan,
        referenceFacts: referenceFactsRaw,
      });
      storyboardArtistPlan = semanticStoryResult.storyboardArtistPlan;
      const assetContractResolution = resolveAssetContract({
        planningManifest,
        narrativeEvents: planningNarrativeEvents,
        storyboardArtistPlan,
        referenceFacts: referenceFactsRaw,
      });
      storyboardArtistPlan = assetContractResolution.storyboardArtistPlan;
      checkpoint.storyboardArtistPlan = storyboardArtistPlan;
      checkpoint.storyContractReport = storyContractResult.report;
      checkpoint.storySemanticReview = semanticStoryResult.review;
      clearPlannerCheckpointFailureAfterStageSuccess(checkpoint, [
        "storyboard_artist",
        "story_contract_gate",
        "story_contract_repair",
        "story_semantic_critic",
        "story_semantic_repair",
      ]);
      await savePlannerCheckpoint(checkpoint, onCheckpoint);
    }
    if (clearPlannerCheckpointFailureAfterStageSuccess(checkpoint, [
      "storyboard_artist",
      "story_contract_gate",
      "story_contract_repair",
      "story_semantic_critic",
      "story_semantic_repair",
    ])) {
      await savePlannerCheckpoint(checkpoint, onCheckpoint);
    }
    await reportPlannerProgress({
      stage: "story_contract_gate",
      completedSteps: 2 + referenceStepOffset,
      totalSteps: totalPlanningSteps,
      completedSegments: 0,
      totalSegments,
      detailZh: "剧情合同已通过，因果引用、证据引用和模板必需节拍均有效。",
      detailEn: "The story contract passed: causal links, evidence references, and template-required beats are valid.",
      metricsDelta: storyContractResult.repairCount > 0 ? {
        storyContractRepairDurationMs,
      } : undefined,
    });
    await reportPlannerProgress({
      stage: "story_semantic_critic",
      completedSteps: 3 + referenceStepOffset,
      totalSteps: totalPlanningSteps,
      completedSegments: 0,
      totalSegments,
      detailZh: semanticStoryResult.review.passed
        ? "语义剧情评审已通过，钩子、因果、转折、兑现和转化目标具有有效证据。"
        : `语义剧情评审仍有 ${semanticStoryResult.review.blockingIssueCodes.length} 项高置信度问题，已记录供审核。`,
      detailEn: semanticStoryResult.review.passed
        ? "The semantic story review passed with evidence-backed hook, causality, payoff, and conversion alignment."
        : `The semantic story review retained ${semanticStoryResult.review.blockingIssueCodes.length} high-confidence issue(s) for review.`,
    });
    await reportPlannerProgress({
      stage: "asset_contract_gate",
      completedSteps: 4 + referenceStepOffset,
      totalSteps: totalPlanningSteps,
      completedSegments: 0,
      totalSegments,
      detailZh: "资产合同已解析，人物、产品、品牌和场景锚点已映射到剧情节拍、片段与边界帧。",
      detailEn: "The asset contract is resolved: character, product, brand, and scene anchors are mapped to beats, segments, and boundaries.",
    });
    await reportPlannerProgress({
      stage: "shot_decomposer",
      completedSteps: 5 + referenceStepOffset,
      totalSteps: totalPlanningSteps,
      completedSegments: 0,
      totalSegments,
      detailZh: `剧情设计已完成，开始拆解 ${totalSegments} 个可执行视频片段。`,
      detailEn: `Story design is complete. Decomposing ${totalSegments} executable video segments.`,
    });

    const shotStoryDesignContext = {
      ...planningStoryDesignContext,
      story_beats: readLoose(storyboardArtistPlan, "storyBeats", "story_beats") ?? planningStoryDesignContext.story_beats,
      shot_grouping_pass: readLoose(storyboardArtistPlan, "shotGroupingPass", "shot_grouping_pass") ?? planningStoryDesignContext.shot_grouping_pass,
    };
    let shotPipelineResult: ShotDecomposerPipelineResult;
    let shotDecomposerPlan: Record<string, unknown>;
    try {
      shotPipelineResult = await createShotDecomposerPlan({
        input,
        modelName: textModel,
        planningManifest,
        storyboardArtistPlan,
        storyDesignContext: shotStoryDesignContext,
        checkpoint,
        onCheckpoint,
        baseCompletedSteps: 5 + referenceStepOffset,
        totalPlanningSteps,
      });
      shotDecomposerPlan = shotPipelineResult.shotDecomposerPlan;
      await logOnePromptVideo("aliyun.storyboard.shot_decomposer.parsed", {
        shotDecomposerPlan,
      });
      if (!shotPipelineResult.promptDetailPlan) {
        shotDecomposerPlan = await repairShotDecomposerPlanUntilSingleTake({
          input,
          modelName: textModel,
          planningManifest,
          storyboardArtistPlan,
          storyDesignContext: shotStoryDesignContext,
          shotDecomposerPlan,
        });
      }
    } catch (error) {
      if (!(error instanceof TimelineReplanRequiredError)) throw error;
      const replanAttempts = checkpoint.timelineReplanAttempts ?? 0;
      const maxReplans = timelineReplanMax();
      if (replanAttempts >= maxReplans) {
        throw new Error(
          `Timeline replan limit reached (${maxReplans}). ${error.message}`,
          { cause: error },
        );
      }
      await reportPlannerProgress({
        stage: "timeline_replan",
        attempt: replanAttempts + 1,
        currentSegmentNo: error.request.firstAffectedSegmentNo,
        totalSegments,
        detailZh: `第 ${error.request.firstAffectedSegmentNo} 段存在无法在单镜头内完成的结构变化，正在自动回退到 Stage 1 局部新增分段。`,
        detailEn: `Segment ${error.request.firstAffectedSegmentNo} contains a structural change that cannot fit one take. Returning to Stage 1 for a local timeline split.`,
      });
      const bounds = segmentCountBounds(input.durationSeconds);
      const timelineRepairPlan = buildModelRepairPlan({
        targetStage: "timeline_replan",
        issues: timelineChangeRequestRepairIssues(error.request),
        scope: { kind: "segments", segmentNos: error.request.affectedSegmentNos },
        preserveRules: [
          `Preserve every segment before ${error.request.firstAffectedSegmentNo} exactly.`,
          "Preserve total duration, creative strategy, causal event order, asset identities, and global style.",
        ],
      });
      let contractValidationFeedback = "";
      const revisedPlanningRaw = await runStoryboardStageWithRetry({
        stage: `timeline_replan_r${replanAttempts + 1}`,
        maxAttempts: 2,
        baseDelayMs: 0,
        run: async () => {
          const timelineReplanRaw = await executeStructuredStage({
            stage: `timeline_replan_r${replanAttempts + 1}`,
            modelName: textModel,
            systemPrompt: contractValidationFeedback
              ? `${TIMELINE_REPLANNER_SYSTEM_PROMPT}

The previous response violated the timeline replan contract. Return a complete corrected timeline_replan.
Validation error: ${contractValidationFeedback}
${STRUCTURED_REPAIR_EXECUTION_RULES}`
              : `${TIMELINE_REPLANNER_SYSTEM_PROMPT}${STRUCTURED_REPAIR_EXECUTION_RULES}`,
            userContent: JSON.stringify({
              user_idea: input.userPrompt,
              aspect_ratio: input.aspectRatio,
              duration_seconds: input.durationSeconds,
              segment_count_min: bounds.min,
              segment_count_max: bounds.max,
              segment_duration_min_seconds: MIN_SEGMENT_SECONDS,
              segment_duration_max_seconds: MAX_SEGMENT_SECONDS,
              planning_manifest: planningManifest,
              story_design_context: planningStoryDesignContext,
              timeline_change_request: error.request,
              repair_plan: timelineRepairPlan,
              locked_prefix_segments: planningManifest.timelineBlueprint.segments.slice(
                0,
                Math.max(0, error.request.firstAffectedSegmentNo - 1),
              ),
            }),
            temperature: 0.15,
          });
          try {
            return applyTimelineReplanToPlanningRaw({
              planningRaw,
              timelineReplanRaw,
              currentManifest: planningManifest,
              input,
              fallback,
              request: error.request,
            });
          } catch (validationError) {
            contractValidationFeedback = validationError instanceof Error
              ? validationError.message
              : String(validationError);
            throw new StoryboardStageError(contractValidationFeedback, {
              code: "contract_validation_error",
              retryable: true,
              cause: validationError,
            });
          }
        },
      });
      checkpoint.planningRaw = revisedPlanningRaw;
      checkpoint.timelineReplanAttempts = replanAttempts + 1;
      checkpoint.timelineChangeHistory = [
        ...(checkpoint.timelineChangeHistory ?? []),
        error.request,
      ].slice(-10);
      invalidateCheckpointAfterTimelineReplan(
        checkpoint,
        error.request.firstAffectedSegmentNo,
      );
      await savePlannerCheckpoint(checkpoint, onCheckpoint);
      await logOnePromptVideo("aliyun.storyboard.timeline_replan.applied", {
        request: error.request,
        attempt: checkpoint.timelineReplanAttempts,
        previousSegmentCount: planningManifest.timelineBlueprint.segments.length,
        nextSegmentCount: normalizePlanningManifest(
          revisedPlanningRaw,
          input,
          fallback,
        ).timelineBlueprint.segments.length,
        preservedPrefixSegmentCount: error.request.firstAffectedSegmentNo - 1,
      }, "warn");
      return createAliyunStoryboardPlanInternal(input, {
        ...options,
        checkpoint,
      });
    }
    await reportPlannerProgress({
      stage: "prompt_detailer",
      completedSteps: segmentPipelineEnabled ? totalPlanningSteps - 2 : totalSegments + 4 + referenceStepOffset,
      totalSteps: totalPlanningSteps,
      completedSegments: totalSegments,
      totalSegments,
      detailZh: shotPipelineResult.promptDetailPlan
        ? "所有片段均已完成拆解、一镜到底审计和提示词编译。"
        : "分镜和一镜到底检查已完成，正在编译图片、视频和负面提示词。",
      detailEn: shotPipelineResult.promptDetailPlan
        ? "All segment pipelines completed decomposition, single-take audit, and prompt compilation."
        : "Shot decomposition and single-take audit are complete. Compiling image, video, and negative prompts.",
    });
    let storyboardPlan = mergeStage2Plans(storyboardArtistPlan, shotDecomposerPlan);

    let promptDetailPlan = shotPipelineResult.promptDetailPlan;
    if (!promptDetailPlan) {
      const promptDetailRaw = await executeStructuredStage({
        stage: "prompt_detailer",
        modelName: textModel,
        systemPrompt: PROMPT_DETAILER_SYSTEM_PROMPT,
        userContent: JSON.stringify({
          planning_manifest: planningManifest,
          story_design_context: storyDesignStageContext(storyboardPlan),
          storyboard_plan: storyboardPlan,
          storyboard_artist_plan: storyboardArtistPlan,
          shot_decomposer_plan: shotDecomposerPlan,
          confirmed_anchor_images: [],
          confirmed_keyframe_images: [],
          user_edits: {},
        }),
        temperature: 0.25,
      });
      promptDetailPlan = normalizePromptDetailPlan(promptDetailRaw);
      await logOnePromptVideo("aliyun.storyboard.prompt_detailer.parsed", {
        promptDetailRaw,
        promptDetailPlan,
      });
    } else {
      await logOnePromptVideo("aliyun.storyboard.prompt_detailer.segment_pipeline.merged", {
        keyframePromptCount: promptDetailPlan.keyframePrompts?.length ?? 0,
        segmentPromptCount: promptDetailPlan.segmentVideoPrompts?.length ?? 0,
        microShotPromptCount: promptDetailPlan.microShotImagePrompts?.length ?? 0,
      });
    }
    await reportPlannerProgress({
      stage: "story_quality_gate",
      completedSteps: totalPlanningSteps - 1,
      totalSteps: totalPlanningSteps,
      completedSegments: totalSegments,
      totalSegments,
      detailZh: "提示词已完成，正在执行剧情质量和结构校验。",
      detailEn: "Prompts are complete. Running story quality and structural validation.",
    });

    const storyRolloutConfig = readStoryRolloutConfig();
    await logOnePromptVideo("story_rollout.config", { ...storyRolloutConfig });

    const storyQualityCheckStartedAtMs = Date.now();
    const planFallback = createVideoPlan({ ...input, shotCount: planningManifest.timelineBlueprint.segmentCount });
    let plan = buildThreeStagePlan({
      input,
      fallback: planFallback,
      planningRaw,
      planningManifest,
      storyboardPlan,
      promptDetailPlan,
      shotGroupingEnabled: shouldEnableShotGrouping(storyRolloutConfig),
    });
    plan = applyStoryQualityGateForRollout(plan, storyRolloutConfig);
    const finalStoryDecision = decideStoryRewrite(plan.storyQualityReport);
    plan = finalizeStoryQualityRollout(plan, storyRolloutConfig, 0, finalStoryDecision);
    plan = mirrorApprovedRouteToFinalPlan(plan, approvedRouteContract);
    await logOnePromptVideo("production.step.completed", {
      moduleNameZh: "脚本拆解",
      stepNameZh: "程序执行剧情质量和结构质检",
      executionMethod: "deterministic_program",
      durationMs: Date.now() - storyQualityCheckStartedAtMs,
      passed: !finalStoryDecision.shouldRewrite,
      resultZh: finalStoryDecision.shouldRewrite
        ? `发现 ${finalStoryDecision.reasons.length} 项问题，需要返修`
        : "剧情质量和结构检查通过",
    }, finalStoryDecision.shouldRewrite ? "warn" : "info");
    await logOnePromptVideo("story_quality_rewrite.deferred_to_pre_shot_contract", {
      storyGateMode: storyRolloutConfig.storyGateMode,
      configuredLateRewriteMaxIgnored: storyRolloutConfig.storyRewriteMax,
      score: plan.storyQualityReport?.score,
      issueCodes: plan.storyQualityReport?.issueCodes ?? [],
    }, finalStoryDecision.shouldRewrite ? "warn" : "info");
    const finalStoryContract = validateStoryboardStoryContract({
      storyboardArtistPlan: plan,
      templateId: plan.creativeStrategy?.templateId ?? planningTemplateId,
      validEventIds: (plan.narrativeEvents ?? []).map((event) => event.eventId),
      validSegmentNos: plan.segments.map((segment) => segment.segmentNo),
    });
    if (isOnePromptVideoScriptQaEnabled() && !finalStoryContract.passed) {
      throw new Error(`Final story contract drifted after normalization: ${finalStoryContract.issues
        .slice(0, 8)
        .map((issue) => `${issue.code}@${issue.path}`)
        .join(", ")}`);
    }
    const planBeforeDeterministicEndpointRepair = plan;
    plan = repairMotionfulEndpointContracts(plan);
    const deterministicEndpointChanges = diffDeterministicChanges({
      before: planBeforeDeterministicEndpointRepair,
      after: plan,
      reasonCode: "MOTIONFUL_ENDPOINT_STATICIZATION",
      acceptanceCriteria: [
        "Boundary keyframes describe static visible states rather than motion processes.",
        "Boundary and generation validators pass after normalization.",
      ],
    });
    if (deterministicEndpointChanges.length) {
      await logOnePromptVideo("deterministic_repair.change_log", {
        repairType: "motionful_endpoint_contract",
        executionMethod: "deterministic_program",
        changes: deterministicEndpointChanges,
      });
    }
    const validationIssues = validateOnePromptVideoPlan(plan, { stage: "planning" });
    const finalPromptRepairSegmentNos = locallyRepairableFinalPromptSegmentNos(validationIssues);
    const finalPromptRepairAttempts = checkpoint.finalPromptRepairAttempts ?? 0;
    const validationErrors = validationIssues.filter((issue) => issue.severity === "error");
    if (
      finalPromptRepairSegmentNos.length
      && validationErrors.every((issue) =>
        LOCALLY_REPAIRABLE_FINAL_PROMPT_CODES.has(issue.code)
        && /^segment:\d+$/.test(issue.artifactId ?? ""))
      && finalPromptRepairAttempts < 2
    ) {
      checkpoint.finalPromptRepairAttempts = finalPromptRepairAttempts + 1;
      for (const segmentNo of finalPromptRepairSegmentNos) {
        delete checkpoint.promptDetailSegmentPlans?.[String(segmentNo)];
        if (finalPromptRepairAttempts > 0) {
          delete checkpoint.approvedShotDecomposerSegmentPlans?.[String(segmentNo)];
          delete checkpoint.shotDecomposerSegmentPlans?.[String(segmentNo)];
        }
      }
      await savePlannerCheckpoint(checkpoint, onCheckpoint);
      await logOnePromptVideo("aliyun.storyboard.final_prompt_validation.local_repair", {
        attempt: checkpoint.finalPromptRepairAttempts,
        segmentNos: finalPromptRepairSegmentNos,
        invalidatedStages: finalPromptRepairAttempts > 0
          ? ["shot_decomposer", "single_take_audit", "prompt_detailer"]
          : ["prompt_detailer"],
        issues: validationErrors,
      }, "warn");
      await reportPlannerProgress({
        stage: "prompt_detailer",
        completedSteps: Math.max(0, totalPlanningSteps - 2),
        totalSteps: totalPlanningSteps,
        completedSegments: Math.max(0, totalSegments - finalPromptRepairSegmentNos.length),
        totalSegments,
        detailZh: `最终校验发现片段 ${finalPromptRepairSegmentNos.join("、")} 的提示词包含正向切镜指令，正在仅返修对应片段。`,
        detailEn: `Final validation found positive cut instructions in segment(s) ${finalPromptRepairSegmentNos.join(", ")}. Only those segments are being repaired.`,
      });
      return createAliyunStoryboardPlanInternal(input, {
        ...options,
        checkpoint,
      });
    }
    assertPlanValidForGeneration(plan, { stage: "planning" });
    if (checkpoint.finalPromptRepairAttempts) {
      checkpoint.finalPromptRepairAttempts = 0;
      await savePlannerCheckpoint(checkpoint, onCheckpoint);
    }

    await logOnePromptVideo("aliyun.storyboard.three_stage.parsed", {
      title: plan.title,
      planningManifest: plan.planningManifest,
      narrativeEvents: plan.narrativeEvents,
      creativeStrategy: plan.creativeStrategy,
      storyBeats: plan.storyBeats,
      narrativeMicroRules: plan.narrativeMicroRules,
      shotGroupingPass: plan.shotGroupingPass,
      storyQualityReport: plan.storyQualityReport,
      anchorStateTimeline: plan.anchorStateTimeline,
      storyboardBrief: plan.storyboardBrief,
      segmentRenderDescriptions: plan.segmentRenderDescriptions,
      finalTransitionPlan: plan.finalTransitionPlan,
      anchorCount: plan.consistencyManifest?.anchors.length ?? 0,
      keyframeCount: plan.keyframes.length,
      segmentCount: plan.segments.length,
      segments: plan.segments.map((segment) => ({
        segmentNo: segment.segmentNo,
        durationSeconds: segment.durationSeconds,
        anchors: segment.usesConsistencyAnchors,
      })),
      plannerWarnings: plan.plannerWarnings ?? [],
      validationIssues,
    });
    await reportPlannerProgress({
      stage: "complete",
      completedSteps: totalPlanningSteps,
      totalSteps: totalPlanningSteps,
      completedSegments: totalSegments,
      totalSegments,
      detailZh: "剧本、分镜、提示词和质量校验均已完成。",
      detailEn: "Script, shots, prompts, and quality validation are complete.",
    });
    if (clearPlannerCheckpointFailureAfterStageSuccess(checkpoint, "complete")) {
      await savePlannerCheckpoint(checkpoint, onCheckpoint);
    }
    return plan;
  } catch (error) {
    const failedStage = checkpointFailureStage(error);
    invalidatePlannerCheckpointAfterFailure(checkpoint, failedStage, error);
    await savePlannerCheckpoint(checkpoint, onCheckpoint).catch((checkpointError) =>
      logOnePromptVideo("aliyun.storyboard.checkpoint.failure_invalidation_save_failed", {
        failedStage,
        originalError: errorForLog(error),
        checkpointError: errorForLog(checkpointError),
      }, "error"));
    await logOnePromptVideo("aliyun.storyboard.checkpoint.invalidated_after_failure", {
      failedStage,
      resumeFromStage: checkpoint.resumeFromStage,
      lastFailure: checkpoint.lastFailure,
    }, "warn");
    await logOnePromptVideo("aliyun.storyboard.three_stage.error", errorForLog(error), "error");
    throw error;
  }
}

async function executeStructuredStage<T = unknown>(params: {
  stage: string;
  modelName: string;
  systemPrompt: string;
  userContent: ChatContent;
  temperature: number;
  maxTokens?: number;
  contract?: StructuredStageContract<T>;
  signal?: AbortSignal;
}): Promise<T> {
  const startedAt = new Date();
  const startedAtMs = startedAt.getTime();
  const moduleNameZh = plannerModuleNameZh(params.stage);
  const promptBuildStartedAtMs = Date.now();
  const reasoningPolicy = jsonStageReasoningPolicy(params.stage);
  const generatedJsonSchema = params.contract
    ? structuredStageJsonSchema(params.contract)
    : undefined;
  const generatedJsonSchemaFingerprint = generatedJsonSchema
    ? createHash("sha256").update(JSON.stringify(generatedJsonSchema)).digest("hex")
    : undefined;
  const attachedRepairPlan = extractAttachedRepairPlan(params.userContent);
  if (attachedRepairPlan) {
    await logOnePromptVideo("automatic_repair.plan.created", {
      stage: params.stage,
      repairPlan: attachedRepairPlan,
    });
  }
  const body: Record<string, unknown> = {
    model: params.modelName,
    messages: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.userContent },
    ],
    temperature: params.temperature,
    enable_thinking: reasoningPolicy.enableThinking,
    // DashScope's OpenAI-compatible endpoint currently supports json_object,
    // not OpenAI's json_schema response type. Strict schema enforcement runs
    // locally immediately after parsing, before a segment can be checkpointed.
    response_format: { type: "json_object" },
  };
  if (params.maxTokens !== undefined) {
    body.max_tokens = params.maxTokens;
  }
  if (reasoningPolicy.thinkingBudget !== undefined) {
    body.thinking_budget = reasoningPolicy.thinkingBudget;
  }
  await logOnePromptVideo("production.step.completed", {
    moduleNameZh,
    stepNameZh: "组装本阶段提示词和请求内容",
    executionMethod: "program",
    durationMs: Date.now() - promptBuildStartedAtMs,
    model: params.modelName,
    resultZh: "系统提示词、用户内容和返回格式已经组装完成",
  });
  await logOnePromptVideo(`aliyun.storyboard.${params.stage}.request`, {
    model: params.modelName,
    baseUrl: compatibleBaseUrl(),
    enableThinking: reasoningPolicy.enableThinking,
      thinkingBudget: reasoningPolicy.thinkingBudget,
      maxTokens: params.maxTokens,
      responseFormat: params.contract
        ? "json_object_plus_local_zod_contract"
        : "json_object",
      contractName: params.contract?.name,
      schemaVersion: params.contract?.version,
      generatedJsonSchemaFingerprint,
    });
  let observationRecorded = false;
  try {
    await logOnePromptVideo("production.step.start", {
      moduleNameZh,
      stepNameZh: "把提示词交给大模型并等待完整返回",
      executionMethod: "model",
      model: params.modelName,
    });
    const modelRequestStartedAtMs = Date.now();
    const result = await fetchJsonStageContent(params.stage, body, params.signal);
    const completedAt = new Date();
    await logOnePromptVideo("production.step.completed", {
      moduleNameZh,
      stepNameZh: "把提示词交给大模型并等待完整返回",
      executionMethod: "model",
      model: params.modelName,
      durationMs: Date.now() - modelRequestStartedAtMs,
      resultZh: result.ok ? "大模型已返回内容" : `上游返回 HTTP ${result.httpStatus}`,
    }, result.ok ? "info" : "error");
    await logOnePromptVideo(`aliyun.storyboard.${params.stage}.response`, {
      httpStatus: result.httpStatus,
      ok: result.ok,
      durationMs: completedAt.getTime() - startedAtMs,
      rawSummary: result.rawSummary,
      streamChunkMode: result.streamChunkMode,
    }, result.ok ? "info" : "error");
    await reportPlannerStageMetric({
      stage: params.stage,
      modelName: params.modelName,
      status: result.ok ? "completed" : "failed",
      durationMs: completedAt.getTime() - startedAtMs,
      httpStatus: result.httpStatus,
      retryable: !result.ok && (result.httpStatus === 408 || result.httpStatus === 429 || result.httpStatus >= 500),
      startedAt,
      completedAt,
    });
    observationRecorded = true;
    if (!result.ok) {
      throw new StoryboardStageError(
        result.errorMessage || `Aliyun storyboard ${params.stage} failed HTTP ${result.httpStatus}`,
        {
          code: "upstream_http_error",
          retryable: result.httpStatus === 408 || result.httpStatus === 429 || result.httpStatus >= 500,
          httpStatus: result.httpStatus,
        },
      );
    }
    const content = result.content;
    if (!content) throw new Error(`Aliyun storyboard ${params.stage} returned empty content`);
    const parseStartedAtMs = Date.now();
    let parsed: unknown;
    try {
      parsed = parseJsonObject(content);
      await logOnePromptVideo("production.step.completed", {
        moduleNameZh,
        stepNameZh: "程序解析并检查大模型返回的 JSON",
        executionMethod: "program",
        durationMs: Date.now() - parseStartedAtMs,
        resultZh: "JSON 结构可用",
      });
    } catch (parseError) {
      await logOnePromptVideo("production.step.completed", {
        moduleNameZh,
        stepNameZh: "程序解析并检查大模型返回的 JSON",
        executionMethod: "program",
        durationMs: Date.now() - parseStartedAtMs,
        resultZh: "JSON 不合格，先执行程序机械修复",
      }, "warn");
      await logOnePromptVideo(`aliyun.storyboard.${params.stage}.json_parse.failed`, {
        error: errorForLog(parseError),
        originalOutput: structuredContentDiagnostic(content),
        firstParseError: jsonParseErrorDiagnostic(parseError, content),
        schemaVersion: params.contract?.version,
        schemaFingerprint: generatedJsonSchemaFingerprint,
        streamChunkMode: result.streamChunkMode,
      }, "warn");
      if (params.stage.startsWith("json_repair")) throw parseError;
      const deterministicStartedAtMs = Date.now();
      const deterministicRepair = repairJsonDeterministically(content);
      let deterministicAccepted = false;
      if (deterministicRepair.status === "repaired") {
        let contractStatus: "not_configured" | "valid" | "repairable" = "not_configured";
        let contractIssues: StructuredContractIssue[] = [];
        if (params.contract) {
          const contractResult = validateStructuredStageValue(
            params.contract,
            deterministicRepair.value,
          );
          if (contractResult.status === "fatal") throw contractResult.error;
          contractStatus = contractResult.status;
          if (contractResult.status === "valid") {
            parsed = contractResult.value;
            deterministicAccepted = true;
          } else {
            contractIssues = contractResult.issues;
          }
        } else {
          parsed = deterministicRepair.value;
          deterministicAccepted = true;
        }
        await logOnePromptVideo(
          `aliyun.storyboard.${params.stage}.json_deterministic_repair.completed`,
          {
            accepted: deterministicAccepted,
            durationMs: Date.now() - deterministicStartedAtMs,
            contractStatus,
            contractName: params.contract?.name,
            schemaVersion: params.contract?.version,
            contractIssues,
            originalSemanticFingerprint:
              deterministicRepair.originalSemanticFingerprint,
            repairedSemanticFingerprint:
              deterministicRepair.repairedSemanticFingerprint,
            repairedContentLength: deterministicRepair.repairedText.length,
            repairedContentSha256: createHash("sha256")
              .update(deterministicRepair.repairedText)
              .digest("hex"),
            originalOutput: structuredContentDiagnostic(content),
            repairedOutput: structuredContentDiagnostic(
              deterministicRepair.repairedText,
            ),
            contentDiff: structuredContentDiff(
              content,
              deterministicRepair.repairedText,
            ),
            schemaFingerprint: generatedJsonSchemaFingerprint,
            streamChunkMode: result.streamChunkMode,
          },
          deterministicAccepted ? "info" : "warn",
        );
      } else {
        await logOnePromptVideo(
          `aliyun.storyboard.${params.stage}.json_deterministic_repair.failed`,
          {
            durationMs: Date.now() - deterministicStartedAtMs,
            reason: deterministicRepair.reason,
            error: errorForLog(deterministicRepair.error),
            repairedContentLength:
              deterministicRepair.repairedText?.length,
            originalOutput: structuredContentDiagnostic(content),
            repairedOutput: deterministicRepair.repairedText === undefined
              ? undefined
              : structuredContentDiagnostic(deterministicRepair.repairedText),
            contentDiff: deterministicRepair.repairedText === undefined
              ? undefined
              : structuredContentDiff(content, deterministicRepair.repairedText),
            schemaVersion: params.contract?.version,
            schemaFingerprint: generatedJsonSchemaFingerprint,
            streamChunkMode: result.streamChunkMode,
          },
          "warn",
        );
      }
      if (!deterministicAccepted) {
        try {
          parsed = await repairJsonStageContent({
            stage: params.stage,
            modelName: jsonSyntaxRepairModel(),
            content,
            schemaVersion: params.contract?.version,
            schemaFingerprint: generatedJsonSchemaFingerprint,
            sourceStreamChunkMode: result.streamChunkMode,
            signal: params.signal,
          });
        } catch (repairError) {
          if (repairError instanceof StoryboardStageError) throw repairError;
          throw new StructuredOutputSyntaxError(
            params.stage,
            `Structured output for ${params.stage} remained invalid after local and model JSON syntax repair.`,
            { cause: repairError },
          );
        }
      }
    }
    if (params.contract) {
      const schemaStartedAtMs = Date.now();
      const contractResult = validateStructuredStageValue(params.contract, parsed);
      const contractIssues = contractResult.status === "repairable"
        ? contractResult.issues
        : [];
      await logOnePromptVideo("production.step.completed", {
        moduleNameZh,
        stepNameZh: "程序按 Zod 合同校验字段、类型和语义约束",
        executionMethod: "deterministic_program",
        durationMs: Date.now() - schemaStartedAtMs,
        resultZh: contractResult.status === "valid"
          ? "合同校验通过"
          : contractResult.status === "repairable"
            ? `合同不合格，发现 ${contractIssues.length} 个问题`
            : "合同归一化失败",
      }, contractResult.status === "valid" ? "info" : "warn");
      if (contractResult.status === "fatal") throw contractResult.error;
      if (contractResult.status === "repairable") {
        const validationErrors = contractIssues.map((issue) => `${issue.path}: ${issue.message}`);
        throw new StoryboardStageError(
          `Structured stage contract validation failed: ${formatStructuredContractIssues(contractIssues.slice(0, 8))}`,
          {
            code: "contract_validation_error",
            retryable: true,
            validationErrors,
            stage: params.stage,
            rawCandidate: contractResult.raw,
          },
        );
      }
      parsed = contractResult.value;
    }
    throwIfBatchCancelled(params.stage, params.signal);
    return parsed as T;
  } catch (error) {
    if (!observationRecorded) {
      const completedAt = new Date();
      await reportPlannerStageMetric({
        stage: params.stage,
        modelName: params.modelName,
        status: "failed",
        durationMs: completedAt.getTime() - startedAtMs,
        retryable: error instanceof StoryboardStageError ? error.retryable : undefined,
        startedAt,
        completedAt,
      });
    }
    throw error;
  }
}

function plannerModuleNameZh(stage: string): string {
  if (stage.startsWith("reference_fact_extractor")) return "参考素材事实提取";
  if (stage.startsWith("planning_architect")) return "故事架构与一致性资产规划";
  if (stage.startsWith("asset_prompt_contract")) return "一致性资产规划质检与返修";
  if (stage.startsWith("planning_contract") || stage.startsWith("planning_duration")) return "故事架构质检与返修";
  if (stage.startsWith("storyboard_artist")) return "故事板规划";
  if (stage.startsWith("shot_decomposer")) return "脚本拆解";
  if (stage.startsWith("prompt_detailer")) return "生成提示词细化";
  if (stage.startsWith("story_contract")) return "故事逻辑质检与修复";
  if (stage.startsWith("story_quality")) return "剧情质量质检与返修";
  if (stage.startsWith("split_repair")) return "镜头拆分质检与修复";
  if (stage.startsWith("json_repair")) return "大模型返回格式修复";
  return "脚本与分镜规划";
}

function batchCancelledStageError(stage: string, signal: AbortSignal): StoryboardStageError {
  return new StoryboardStageError(
    `Storyboard stage ${stage} was cancelled because another task in the same batch failed.`,
    {
      code: "batch_cancelled",
      retryable: false,
      stage,
      cause: signal.reason,
    },
  );
}

function throwIfBatchCancelled(stage: string, signal?: AbortSignal): void {
  if (signal?.aborted) throw batchCancelledStageError(stage, signal);
}

function forwardAbortSignal(
  parent: AbortSignal | undefined,
  controller: AbortController,
): () => void {
  if (!parent) return () => undefined;
  const onAbort = () => controller.abort(parent.reason);
  if (parent.aborted) {
    onAbort();
    return () => undefined;
  }
  parent.addEventListener("abort", onAbort, { once: true });
  return () => parent.removeEventListener("abort", onAbort);
}

async function fetchJsonStage(
  stage: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  const timeoutMs = jsonStageTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const detachParentAbort = forwardAbortSignal(signal, controller);
  try {
    throwIfBatchCancelled(stage, signal);
    const operation = () => fetch(`${compatibleBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${requireDashScopeApiKey()}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const schedulingContext = plannerProgressStorage.getStore()?.schedulingContext;
    return await (schedulingContext
      ? withProviderCapacity({
          lane: "text_planning",
          modelId: typeof body.model === "string" ? body.model : "unknown",
          context: {
            ...schedulingContext,
            targetId: `planning:${stage}:${randomUUID()}`,
          },
          operation,
          waitTimeoutMs: jsonStageTimeoutMs(),
          signal: controller.signal,
        })
      : operation());
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      if (signal?.aborted) {
        await logOnePromptVideo(`aliyun.storyboard.${stage}.cancelled`, {
          model: body.model,
          reason: "batch_peer_failed",
        }, "warn");
        throw batchCancelledStageError(stage, signal);
      }
      await logOnePromptVideo(`aliyun.storyboard.${stage}.timeout`, {
        timeoutMs,
        model: body.model,
      }, "error");
      throw new StoryboardStageError(
        `三阶段脚本拆解 ${stage} 请求超过 ${Math.round(timeoutMs / 1000)} 秒未返回，已停止生成。请稍后重试，或检查 DASHSCOPE/百炼网络与额度。`,
        { code: "request_timeout", retryable: true, cause: error },
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    detachParentAbort();
  }
}

async function fetchJsonStageContent(
  stage: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<JsonStageContentResult> {
  if (shouldStreamJsonStage(stage)) return fetchJsonStageContentStream(stage, body, signal);
  const startedAt = Date.now();
  const res = await fetchJsonStage(stage, body, signal);
  const raw = await safeJson(res);
  return {
    httpStatus: res.status,
    ok: res.ok,
    durationMs: Date.now() - startedAt,
    content: res.ok ? extractChatContent(raw) : "",
    rawSummary: summarizeRaw(raw),
    streamChunkMode: "non_stream",
    errorMessage: extractError(raw),
  };
}

async function fetchJsonStageContentStream(
  stage: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<JsonStageContentResult> {
  const startedAt = Date.now();
  const firstChunkTimeoutMs = jsonStageTimeoutMs();
  const idleTimeoutMs = jsonStageStreamIdleTimeoutMs();
  const maxStreamMs = jsonStageStreamMaxTimeoutMs(stage);
  const controller = new AbortController();
  const detachParentAbort = forwardAbortSignal(signal, controller);
  let abortReason = "first_chunk_timeout";
  let idleTimeout: ReturnType<typeof setTimeout> | undefined;
  const maxTimeout = setTimeout(() => {
    abortReason = "max_stream_timeout";
    controller.abort();
  }, maxStreamMs);
  const armIdleTimeout = (ms: number, reason: string) => {
    if (idleTimeout) clearTimeout(idleTimeout);
    abortReason = reason;
    idleTimeout = setTimeout(() => controller.abort(), ms);
  };
  armIdleTimeout(firstChunkTimeoutMs, "first_chunk_timeout");
  let capacityLease: ProviderLeaseGrant | undefined;

  try {
    throwIfBatchCancelled(stage, signal);
    const operation = () => fetch(`${compatibleBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${requireDashScopeApiKey()}`,
      },
      body: JSON.stringify({
        ...body,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: controller.signal,
    });
    const schedulingContext = plannerProgressStorage.getStore()?.schedulingContext;
    if (schedulingContext) {
      capacityLease = await acquireProviderCapacity({
          lane: "text_planning",
          modelId: typeof body.model === "string" ? body.model : "unknown",
          context: {
            ...schedulingContext,
            targetId: `planning-stream:${stage}:${randomUUID()}`,
          },
          waitTimeoutMs: maxStreamMs,
          signal: controller.signal,
      });
    }
    const res = await operation();
    if (!res.ok) {
      if (idleTimeout) clearTimeout(idleTimeout);
      clearTimeout(maxTimeout);
      const raw = await safeJson(res);
      return {
        httpStatus: res.status,
        ok: false,
        durationMs: Date.now() - startedAt,
        content: "",
        rawSummary: summarizeRaw(raw),
        streamChunkMode: "none",
        errorMessage: extractError(raw),
      };
    }
    if (!res.body) throw new Error(`Aliyun storyboard ${stage} stream returned empty body`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const contentAssembler = new JsonStageStreamAssembler();
    let buffer = "";
    let chunkCount = 0;
    let reasoningChunkCount = 0;
    let reasoningContentLength = 0;
    let firstNetworkChunkMs: number | undefined;
    let firstSseEventMs: number | undefined;
    let firstReasoningChunkMs: number | undefined;
    let firstAnswerChunkMs: number | undefined;
    let finishReason: unknown;
    let usage: unknown;

    const consumeEvent = (eventText: string) => {
      const data = eventText
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
        .trim();
      if (!data || data === "[DONE]") return;
      if (firstSseEventMs === undefined) firstSseEventMs = Date.now() - startedAt;
      let raw: unknown;
      try {
        raw = JSON.parse(data);
      } catch {
        return;
      }
      if (isRecord(raw) && raw.usage) usage = raw.usage;
      const choices = isRecord(raw) && Array.isArray(raw.choices) ? raw.choices : [];
      for (let choiceIndex = 0; choiceIndex < choices.length; choiceIndex += 1) {
        const choice = choices[choiceIndex];
        if (!isRecord(choice)) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const delta = isRecord(choice.delta) ? choice.delta : undefined;
        const message = isRecord(choice.message) ? choice.message : undefined;
        const reasoningPiece = typeof delta?.reasoning_content === "string"
          ? delta.reasoning_content
          : typeof message?.reasoning_content === "string"
            ? message.reasoning_content
            : "";
        if (reasoningPiece) {
          reasoningChunkCount += 1;
          reasoningContentLength += reasoningPiece.length;
          if (firstReasoningChunkMs === undefined) {
            firstReasoningChunkMs = Date.now() - startedAt;
          }
        }
        const deltaContent = typeof delta?.content === "string"
          ? delta.content
          : undefined;
        const messageContent = typeof message?.content === "string"
          ? message.content
          : undefined;
        const piece = contentAssembler.append({
          choiceIndex: typeof choice.index === "number" ? choice.index : choiceIndex,
          deltaContent,
          messageContent,
        });
        if (piece) {
          chunkCount += 1;
          if (firstAnswerChunkMs === undefined) firstAnswerChunkMs = Date.now() - startedAt;
        }
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (firstNetworkChunkMs === undefined) firstNetworkChunkMs = Date.now() - startedAt;
      armIdleTimeout(idleTimeoutMs, "stream_idle_timeout");
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let delimiterIndex = buffer.indexOf("\n\n");
      while (delimiterIndex >= 0) {
        const eventText = buffer.slice(0, delimiterIndex);
        buffer = buffer.slice(delimiterIndex + 2);
        consumeEvent(eventText);
        delimiterIndex = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode();
    buffer = buffer.replace(/\r\n/g, "\n");
    if (buffer.trim()) consumeEvent(buffer);
    if (idleTimeout) clearTimeout(idleTimeout);
    clearTimeout(maxTimeout);

    const content = contentAssembler.content().trim();
    const streamAssembly = contentAssembler.metrics();
    return {
      httpStatus: res.status,
      ok: true,
      durationMs: Date.now() - startedAt,
      content,
      rawSummary: {
        stream: true,
        chunkCount,
        reasoningChunkCount,
        reasoningContentLength,
        contentLength: content.length,
        firstNetworkChunkMs,
        firstSseEventMs,
        firstReasoningChunkMs,
        firstAnswerChunkMs,
        // Backward compatibility for existing log analysis. This field has
        // always meant the first answer token, not the first network packet.
        firstChunkMs: firstAnswerChunkMs,
        finishReason,
        usage,
        streamAssembly,
      },
      streamChunkMode: streamAssembly.contentMode,
    };
  } catch (error) {
    if (idleTimeout) clearTimeout(idleTimeout);
    clearTimeout(maxTimeout);
    if (error instanceof Error && error.name === "AbortError") {
      if (signal?.aborted) {
        await logOnePromptVideo(`aliyun.storyboard.${stage}.cancelled`, {
          model: body.model,
          reason: "batch_peer_failed",
        }, "warn");
        throw batchCancelledStageError(stage, signal);
      }
      await logOnePromptVideo(`aliyun.storyboard.${stage}.stream_timeout`, {
        model: body.model,
        abortReason,
        firstChunkTimeoutMs,
        idleTimeoutMs,
        maxStreamMs,
      }, "error");
      const code = abortReason === "stream_idle_timeout"
        ? "stream_idle_timeout"
        : abortReason === "max_stream_timeout"
          ? "max_stream_timeout"
          : "first_chunk_timeout";
      throw new StoryboardStageError(
        `三阶段脚本拆解 ${stage} 流式请求超时（${abortReason}），已停止生成。请稍后重试，或检查 DASHSCOPE/百炼网络与额度。`,
        { code, retryable: true, cause: error },
      );
    }
    throw error;
  } finally {
    detachParentAbort();
    if (capacityLease) {
      await releaseProviderLeaseByToken(capacityLease.leaseToken, "completed").catch(() => undefined);
    }
  }
}

function extractAttachedRepairPlan(content: ChatContent): ModelRepairPlan | undefined {
  if (typeof content !== "string") return undefined;
  try {
    const parsed = JSON.parse(content);
    if (!isRecord(parsed) || !isRecord(parsed.repair_plan)) return undefined;
    return parsed.repair_plan as unknown as ModelRepairPlan;
  } catch {
    return undefined;
  }
}

async function repairJsonStageContent(params: {
  stage: string;
  modelName: string;
  content: string;
  schemaVersion?: string;
  schemaFingerprint?: string;
  sourceStreamChunkMode: JsonStageContentResult["streamChunkMode"];
  signal?: AbortSignal;
}): Promise<unknown> {
  const startedAt = new Date();
  const startedAtMs = startedAt.getTime();
  const repairContent = buildJsonSyntaxRepairUserPrompt(
    params.content,
    MAX_JSON_REPAIR_INPUT_CHARS,
  );
  const body = {
    model: params.modelName,
    messages: [
      { role: "system", content: JSON_SYNTAX_REPAIR_SYSTEM_PROMPT },
      { role: "user", content: repairContent },
    ],
    temperature: 0,
    enable_thinking: false,
    response_format: { type: "json_object" },
  };
  await logOnePromptVideo(`aliyun.storyboard.${params.stage}.json_repair.request`, {
    model: params.modelName,
    contentLength: params.content.length,
    originalOutput: structuredContentDiagnostic(params.content),
    repairInput: structuredContentDiagnostic(repairContent),
    schemaVersion: params.schemaVersion,
    schemaFingerprint: params.schemaFingerprint,
    sourceStreamChunkMode: params.sourceStreamChunkMode,
    repairScope: "json_syntax_only",
    temperature: 0,
    enableThinking: false,
  }, "warn");
  await reportPlannerProgress({
    stage: "json_repair",
    detailZh: `${params.stage} 返回的 JSON 不完整，正在执行结构修复。`,
    detailEn: `${params.stage} returned invalid JSON. Repairing its structure.`,
    metricsDelta: { jsonRepairCount: 1 },
  });
  let result: JsonStageContentResult;
  try {
    result = await fetchJsonStageContent(`json_repair_${params.stage}`, body, params.signal);
  } catch (error) {
    const completedAt = new Date();
    await reportPlannerStageMetric({
      stage: `json_repair_${params.stage}`,
      modelName: params.modelName,
      status: "failed",
      durationMs: completedAt.getTime() - startedAtMs,
      retryable: error instanceof StoryboardStageError ? error.retryable : undefined,
      startedAt,
      completedAt,
    });
    throw error;
  }
  const completedAt = new Date();
  const repairDurationMs = completedAt.getTime() - startedAtMs;
  await reportPlannerStageMetric({
    stage: `json_repair_${params.stage}`,
    modelName: params.modelName,
    status: result.ok ? "completed" : "failed",
    durationMs: repairDurationMs,
    httpStatus: result.httpStatus,
    retryable: !result.ok && (result.httpStatus === 408 || result.httpStatus === 429 || result.httpStatus >= 500),
    startedAt,
    completedAt,
  });
  await logOnePromptVideo(`aliyun.storyboard.${params.stage}.json_repair.response`, {
    httpStatus: result.httpStatus,
    ok: result.ok,
    durationMs: repairDurationMs,
    rawSummary: result.rawSummary,
    repairOutput: structuredContentDiagnostic(result.content),
    contentDiff: structuredContentDiff(params.content, result.content),
    schemaVersion: params.schemaVersion,
    schemaFingerprint: params.schemaFingerprint,
    sourceStreamChunkMode: params.sourceStreamChunkMode,
    repairStreamChunkMode: result.streamChunkMode,
  }, result.ok ? "info" : "error");
  await reportPlannerProgress({
    stage: "json_repair",
    detailZh: `${params.stage} JSON 结构修复已结束。`,
    detailEn: `${params.stage} JSON repair finished.`,
    metricsDelta: { jsonRepairDurationMs: repairDurationMs },
  });
  if (!result.ok) throw new Error(result.errorMessage || `Aliyun storyboard ${params.stage} JSON repair failed HTTP ${result.httpStatus}`);
  const repairedContent = result.content;
  if (!repairedContent) throw new Error(`Aliyun storyboard ${params.stage} JSON repair returned empty content`);
  let repaired: unknown;
  try {
    repaired = parseJsonObject(repairedContent);
  } catch (repairParseError) {
    await logOnePromptVideo(
      `aliyun.storyboard.${params.stage}.json_repair.parse_failed`,
      {
        repairedOutput: structuredContentDiagnostic(repairedContent),
        repairParseError: jsonParseErrorDiagnostic(
          repairParseError,
          repairedContent,
        ),
        originalOutput: structuredContentDiagnostic(params.content),
        contentDiff: structuredContentDiff(params.content, repairedContent),
        schemaVersion: params.schemaVersion,
        schemaFingerprint: params.schemaFingerprint,
        sourceStreamChunkMode: params.sourceStreamChunkMode,
        repairStreamChunkMode: result.streamChunkMode,
      },
      "error",
    );
    throw repairParseError;
  }
  if (
    isRecord(repaired)
    && Object.prototype.hasOwnProperty.call(repaired, "repair_execution")
  ) {
    throw new Error(
      `Aliyun storyboard ${params.stage} JSON syntax repair illegally returned repair_execution`,
    );
  }
  const semanticValidation = validateJsonRepairSemanticPreservation(
    params.content,
    repairedContent,
  );
  if (!semanticValidation.valid) {
    await logOnePromptVideo(
      `aliyun.storyboard.${params.stage}.json_repair.semantic_validation_failed`,
      {
        originalOutput: structuredContentDiagnostic(params.content),
        repairedOutput: structuredContentDiagnostic(repairedContent),
        contentDiff: structuredContentDiff(params.content, repairedContent),
        semanticValidation,
        schemaVersion: params.schemaVersion,
        schemaFingerprint: params.schemaFingerprint,
        sourceStreamChunkMode: params.sourceStreamChunkMode,
        repairStreamChunkMode: result.streamChunkMode,
      },
      "error",
    );
    throw new Error(
      `Aliyun storyboard ${params.stage} JSON syntax repair changed semantic content: ${semanticValidation.message}`,
    );
  }
  await logOnePromptVideo(`aliyun.storyboard.${params.stage}.json_repair.success`, {
    repairedContentLength: repairedContent.length,
    model: params.modelName,
    contentDiff: structuredContentDiff(params.content, repairedContent),
    schemaVersion: params.schemaVersion,
    schemaFingerprint: params.schemaFingerprint,
    sourceStreamChunkMode: params.sourceStreamChunkMode,
    repairStreamChunkMode: result.streamChunkMode,
    originalSemanticFingerprint:
      semanticValidation.originalSemanticFingerprint,
    repairedSemanticFingerprint:
      semanticValidation.repairedSemanticFingerprint,
  });
  return repaired;
}

function compactReferenceFactsForPlanningRoute(referenceFactsRaw: unknown): {
  subjectTypes: Array<"person" | "game_ui" | "product" | "food" | "vehicle" | "scene" | "brand_mark" | "other">;
  categorySignals: Array<"game" | "product" | "food" | "auto" | "ecommerce" | "brand" | "tutorial" | "unknown">;
  containsUi: boolean;
  containsBrandElements: boolean;
  containsPeople: boolean;
  hasExplicitAdCategorySignals: boolean;
} {
  const root = isRecord(referenceFactsRaw) ? referenceFactsRaw : {};
  const facts = arrayOfRecords(root.reference_facts);
  const subjectTypes = new Set<"person" | "game_ui" | "product" | "food" | "vehicle" | "scene" | "brand_mark" | "other">();
  const categorySignals = new Set<"game" | "product" | "food" | "auto" | "ecommerce" | "brand" | "tutorial" | "unknown">();
  const searchable = facts.map((fact) => [
    ...(normalizeStringArray(fact.people) ?? []),
    ...(normalizeStringArray(fact.products) ?? []),
    ...(normalizeStringArray(fact.objects) ?? []),
    ...(normalizeStringArray(fact.readable_text) ?? []),
    ...(normalizeStringArray(fact.brand_marks) ?? []),
    stringOr(fact.scene, ""),
  ].join(" ")).join(" ").toLowerCase();
  const containsPeople = facts.some((fact) => Array.isArray(fact.people) && fact.people.length > 0);
  const containsProducts = facts.some((fact) => Array.isArray(fact.products) && fact.products.length > 0);
  const containsBrandElements = facts.some((fact) => Array.isArray(fact.brand_marks) && fact.brand_marks.length > 0);
  const containsUi = /\bui|interface|hud|score|button|menu\b|界面|按钮|分数|排行榜/.test(searchable);
  if (containsPeople) subjectTypes.add("person");
  if (containsProducts) subjectTypes.add("product");
  if (containsBrandElements) subjectTypes.add("brand_mark");
  if (facts.some((fact) => stringOr(fact.scene, "").trim())) subjectTypes.add("scene");
  if (/\bgame|gameplay|jackpot|bonus|leaderboard\b|游戏|关卡|爆奖|奖励/.test(searchable)) {
    categorySignals.add("game");
    subjectTypes.add("game_ui");
  }
  if (containsProducts || /\bproduct\b|产品|商品/.test(searchable)) categorySignals.add("product");
  if (containsBrandElements || /\bbrand\b|品牌/.test(searchable)) categorySignals.add("brand");
  if (/\bfood|dish|meal|restaurant\b|食品|食物|菜品|餐厅/.test(searchable)) {
    categorySignals.add("food");
    subjectTypes.add("food");
  }
  if (/\bcar|vehicle|automotive\b|汽车|车辆/.test(searchable)) {
    categorySignals.add("auto");
    subjectTypes.add("vehicle");
  }
  if (/\bshop|shopping|checkout|buy now|offer\b|电商|购物|下单|优惠/.test(searchable)) {
    categorySignals.add("ecommerce");
  }
  if (!subjectTypes.size && facts.length) subjectTypes.add("other");
  return {
    subjectTypes: [...subjectTypes],
    categorySignals: categorySignals.size ? [...categorySignals] : [],
    containsUi,
    containsBrandElements,
    containsPeople,
    hasExplicitAdCategorySignals: categorySignals.size > 0,
  };
}

function buildPlanningRouteInputForArchitect(
  input: PlanVideoProjectInput,
  referenceFactsRaw: unknown,
): ReturnType<typeof buildPlanningRouteInput> {
  return buildPlanningRouteInput({
    userCreative: input.userPrompt,
    durationSeconds: input.durationSeconds,
    aspectRatio: input.aspectRatio,
    stylePreset: input.stylePreset ?? null,
    hasReferenceImage: input.referenceImageUrls.length > 0,
    referenceFacts: compactReferenceFactsForPlanningRoute(referenceFactsRaw),
    userConstraints: [],
  });
}

function buildPlanningArchitectContent(
  input: PlanVideoProjectInput,
  referenceFacts: unknown,
  approvedRouteContract: ApprovedPlanningRouteContract,
): ChatContent {
  const bounds = segmentCountBounds(input.durationSeconds);
  return JSON.stringify({
    user_idea: input.userPrompt,
    aspect_ratio: input.aspectRatio,
    duration_seconds: input.durationSeconds,
    style_preset: input.stylePreset,
    segment_count_min: bounds.min,
    segment_count_max: bounds.max,
    segment_duration_min_seconds: MIN_SEGMENT_SECONDS,
    segment_duration_max_seconds: MAX_SEGMENT_SECONDS,
    reference_facts: referenceFacts,
    approved_route_contract: approvedRouteContractForPlanningArchitect(approvedRouteContract),
    reference_usage_rule: "Reference facts constrain identity, product, scene, and style only. They are not a story or timeline.",
  });
}

export interface PlanningDurationContractIssue {
  code: string;
  path: string;
  message: string;
}

export function validatePlanningDurationContract(
  planningRaw: unknown,
  input: PlanVideoProjectInput,
): PlanningDurationContractIssue[] {
  const envelope = isRecord(planningRaw) ? planningRaw : {};
  const root = isRecord(envelope.planning_manifest) ? envelope.planning_manifest : envelope;
  const timeline = isRecord(root.timeline_blueprint)
    ? root.timeline_blueprint
    : isRecord(root.timelineBlueprint)
      ? root.timelineBlueprint
      : {};
  const segments = arrayOfRecords(timeline.segments);
  const issues: PlanningDurationContractIssue[] = [];
  const bounds = segmentCountBounds(input.durationSeconds);
  const declaredCount = strictInteger(timeline.segment_count ?? timeline.segmentCount);
  const declaredTotal = strictInteger(timeline.total_duration_seconds ?? timeline.totalDurationSeconds);
  if (!segments.length) {
    return [{
      code: "DURATION_SEGMENTS_MISSING",
      path: "planning_manifest.timeline_blueprint.segments",
      message: "timeline_blueprint.segments must be a non-empty array.",
    }];
  }
  if (declaredCount !== segments.length) {
    issues.push({ code: "DURATION_SEGMENT_COUNT_MISMATCH", path: "planning_manifest.timeline_blueprint.segment_count", message: `segment_count must equal ${segments.length}.` });
  }
  if (segments.length < bounds.min || segments.length > bounds.max) {
    issues.push({ code: "DURATION_SEGMENT_COUNT_OUT_OF_RANGE", path: "planning_manifest.timeline_blueprint.segments", message: `segment count must be within ${bounds.min}-${bounds.max}.` });
  }
  if (declaredTotal !== input.durationSeconds) {
    issues.push({ code: "DURATION_TOTAL_DECLARATION_INVALID", path: "planning_manifest.timeline_blueprint.total_duration_seconds", message: `total_duration_seconds must equal ${input.durationSeconds}.` });
  }
  if (
    strictInteger(timeline.segment_duration_min_seconds ?? timeline.segmentDurationMinSeconds) !== MIN_SEGMENT_SECONDS
    || strictInteger(timeline.segment_duration_max_seconds ?? timeline.segmentDurationMaxSeconds) !== MAX_SEGMENT_SECONDS
  ) {
    issues.push({ code: "DURATION_LIMIT_DECLARATION_INVALID", path: "planning_manifest.timeline_blueprint", message: `segment duration limits must be ${MIN_SEGMENT_SECONDS}-${MAX_SEGMENT_SECONDS} seconds.` });
  }

  let cursor = 0;
  let allocatedTotal = 0;
  const durationReasons: string[] = [];
  segments.forEach((segment, index) => {
    const path = `planning_manifest.timeline_blueprint.segments[${index}]`;
    const segmentNo = strictInteger(segment.segment_no ?? segment.segmentNo);
    const start = strictInteger(segment.start_time_seconds ?? segment.startTimeSeconds);
    const end = strictInteger(segment.end_time_seconds ?? segment.endTimeSeconds);
    const duration = strictInteger(segment.duration_seconds ?? segment.durationSeconds);
    const minimum = strictInteger(segment.minimum_executable_seconds ?? segment.minimumExecutableSeconds);
    const preferred = strictInteger(segment.preferred_duration_seconds ?? segment.preferredDurationSeconds);
    const maximum = strictInteger(segment.maximum_useful_seconds ?? segment.maximumUsefulSeconds);
    const reason = stringOr(segment.duration_reason_zh ?? segment.durationReasonZh, "").trim();
    const budget = isRecord(segment.timing_budget)
      ? segment.timing_budget
      : isRecord(segment.timingBudget)
        ? segment.timingBudget
        : {};
    const setup = strictInteger(budget.setup_seconds ?? budget.setupSeconds);
    const action = strictInteger(budget.action_seconds ?? budget.actionSeconds);
    const result = strictInteger(budget.result_seconds ?? budget.resultSeconds);
    durationReasons.push(reason);

    if (segmentNo !== index + 1) {
      issues.push({ code: "DURATION_SEGMENT_NUMBER_INVALID", path: `${path}.segment_no`, message: `segment_no must equal ${index + 1}.` });
    }
    if (duration === undefined || duration < MIN_SEGMENT_SECONDS || duration > MAX_SEGMENT_SECONDS) {
      issues.push({ code: "DURATION_VALUE_INVALID", path: `${path}.duration_seconds`, message: `duration_seconds must be an integer within ${MIN_SEGMENT_SECONDS}-${MAX_SEGMENT_SECONDS}.` });
    }
    if (start !== cursor || duration === undefined || end !== cursor + duration) {
      issues.push({ code: "DURATION_BOUNDARY_INVALID", path, message: `segment must start at ${cursor} and end at start + duration with no gap or overlap.` });
    }
    if (reason.length < 8) {
      issues.push({ code: "DURATION_REASON_MISSING", path: `${path}.duration_reason_zh`, message: "duration_reason_zh must explain the event-specific timing need." });
    }
    if (
      minimum === undefined || preferred === undefined || maximum === undefined || duration === undefined
      || minimum < MIN_SEGMENT_SECONDS || maximum > MAX_SEGMENT_SECONDS
      || minimum > duration || duration > maximum || preferred < minimum || preferred > maximum
    ) {
      issues.push({ code: "DURATION_EXECUTABLE_RANGE_INVALID", path, message: "minimum_executable_seconds <= duration_seconds <= maximum_useful_seconds and preferred_duration_seconds must be inside that range." });
    }
    if (
      setup === undefined || action === undefined || result === undefined
      || setup < 0 || action < 0 || result < 0 || duration === undefined
      || setup + action + result !== duration
    ) {
      issues.push({ code: "DURATION_TIMING_BUDGET_INVALID", path: `${path}.timing_budget`, message: "setup_seconds + action_seconds + result_seconds must equal duration_seconds exactly." });
    }
    if (duration !== undefined) {
      allocatedTotal += duration;
      cursor += duration;
    }
  });
  if (allocatedTotal !== input.durationSeconds) {
    issues.push({ code: "DURATION_TOTAL_MISMATCH", path: "planning_manifest.timeline_blueprint.segments", message: `segment durations sum to ${allocatedTotal}; expected ${input.durationSeconds}.` });
  }

  const candidateSegments = arrayOfRecords(envelope.candidate_timeline ?? envelope.candidateTimeline);
  if (candidateSegments.length !== segments.length) {
    issues.push({ code: "DURATION_CANDIDATE_TIMELINE_MISMATCH", path: "candidate_timeline", message: "candidate_timeline must contain the same number of segments as timeline_blueprint." });
  } else {
    candidateSegments.forEach((candidate, index) => {
      const blueprint = segments[index];
      const fieldsMatch = [
        ["segment_no", "segmentNo"],
        ["start_time_seconds", "startTimeSeconds"],
        ["end_time_seconds", "endTimeSeconds"],
        ["duration_seconds", "durationSeconds"],
      ].every(([snake, camel]) =>
        strictInteger(candidate[snake] ?? candidate[camel])
        === strictInteger(blueprint[snake] ?? blueprint[camel]));
      if (!fieldsMatch) {
        issues.push({ code: "DURATION_CANDIDATE_TIMELINE_MISMATCH", path: `candidate_timeline[${index}]`, message: "candidate_timeline timing must exactly mirror timeline_blueprint." });
      }
    });
  }

  const uniqueDurations = new Set(segments.map((segment) =>
    strictInteger(segment.duration_seconds ?? segment.durationSeconds)));
  const normalizedReasons = durationReasons.map((reason) => reason.replace(/\s+/g, "").toLowerCase());
  if (segments.length >= 3 && uniqueDurations.size === 1 && new Set(normalizedReasons).size <= 1) {
    issues.push({ code: "DURATION_MECHANICAL_EQUAL_SPLIT", path: "planning_manifest.timeline_blueprint.segments", message: "equal durations require distinct event-specific reasons; mechanical total/count division is not accepted." });
  }
  return issues;
}

async function ensurePlanningDurationContract(params: {
  input: PlanVideoProjectInput;
  modelName: string;
  planningRaw: unknown;
}): Promise<Record<string, unknown>> {
  let current = isRecord(params.planningRaw) ? params.planningRaw : {};
  const maxRepairs = planningDurationRepairMax();
  for (let revision = 0; revision <= maxRepairs; revision += 1) {
    const issues = validatePlanningDurationContract(current, params.input);
    if (!issues.length) return current;
    if (revision >= maxRepairs) {
      throw new StoryboardStageError(
        `Planning duration contract remains invalid: ${issues.slice(0, 8).map((issue) => `${issue.code}@${issue.path}`).join(", ")}`,
        { code: "contract_validation_error", retryable: true },
      );
    }
    await reportPlannerProgress({
      stage: "planning_duration_repair",
      attempt: revision + 1,
      detailZh: `发现 ${issues.length} 个分段时长合同问题，正在让 Planning Architect 重新分配每段时长。`,
      detailEn: `Found ${issues.length} segment duration contract issue(s). Asking Planning Architect to reallocate segment timing.`,
    });
    const repairPlan = buildModelRepairPlan({
      targetStage: "planning_duration_repair",
      issues,
      scope: { kind: "document" },
      preserveRules: [
        "Preserve classification, consistency anchors, narrative event order, creative strategy, segment count, and segment purposes.",
        "Only candidate_timeline and planning_manifest.timeline_blueprint timing fields may change.",
      ],
    });
    const repairRaw = await executeStructuredStage({
      stage: `planning_duration_repair_r${revision + 1}`,
      modelName: params.modelName,
      systemPrompt: `${PLANNING_DURATION_REPAIR_SYSTEM_PROMPT}${STRUCTURED_REPAIR_EXECUTION_RULES}`,
      userContent: JSON.stringify({
        user_idea: params.input.userPrompt,
        duration_seconds: params.input.durationSeconds,
        segment_count_bounds: segmentCountBounds(params.input.durationSeconds),
        current_planning_output: current,
        validation_issues: issues,
        repair_plan: repairPlan,
      }),
      temperature: 0.15,
    });
    current = mergePlanningDurationRepair(current, repairRaw);
  }
  return current;
}

export function mergePlanningDurationRepair(planningRaw: unknown, repairRaw: unknown): Record<string, unknown> {
  const base = isRecord(planningRaw) ? { ...planningRaw } : {};
  const repairEnvelope = isRecord(repairRaw) ? repairRaw : {};
  const replan = isRecord(repairEnvelope.duration_replan) ? repairEnvelope.duration_replan : repairEnvelope;
  const timeline = isRecord(replan.timeline_blueprint)
    ? replan.timeline_blueprint
    : isRecord(replan.timelineBlueprint)
      ? replan.timelineBlueprint
      : {};
  if (!arrayOfRecords(timeline.segments).length) return base;
  const baseManifest = isRecord(base.planning_manifest)
    ? { ...base.planning_manifest }
    : isRecord(base.planningManifest)
      ? { ...base.planningManifest }
      : {};
  return {
    ...base,
    candidate_timeline: Array.isArray(replan.candidate_timeline) ? replan.candidate_timeline : timeline.segments,
    planning_manifest: {
      ...baseManifest,
      timeline_blueprint: timeline,
    },
  };
}

function strictInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

async function extractReferenceFacts(
  modelName: string,
  referenceImageUrls: string[],
  fingerprint: string,
): Promise<unknown> {
  const existing = referenceFactCache.get(fingerprint);
  if (existing) return existing;
  const pending = executeStructuredStage({
    stage: "reference_fact_extractor",
    modelName,
    systemPrompt: REFERENCE_FACT_EXTRACTOR_SYSTEM_PROMPT,
    userContent: [
      {
        type: "text",
        text: JSON.stringify({
          instruction: "Extract objective visible facts only. Do not propose a story.",
          image_count: referenceImageUrls.length,
        }),
      },
      ...referenceImageUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
    ],
    temperature: 0.05,
    contract: referenceFactContract,
  });
  referenceFactCache.set(fingerprint, pending);
  if (referenceFactCache.size > 100) {
    const oldest = referenceFactCache.keys().next().value;
    if (oldest) referenceFactCache.delete(oldest);
  }
  try {
    return await pending;
  } catch (error) {
    referenceFactCache.delete(fingerprint);
    throw error;
  }
}

async function ensurePlanningNarrativeContract(params: {
  input: PlanVideoProjectInput;
  modelName: string;
  planningManifest: VideoPlanningManifest;
  creativeStrategy: VideoCreativeStrategy;
  narrativeEvents: NarrativeEvent[];
  authority: "event" | "legacy_migrated";
  checkpoint: AliyunStoryboardPlannerCheckpoint;
  onCheckpoint?: (checkpoint: AliyunStoryboardPlannerCheckpoint) => Promise<void> | void;
}): Promise<{
  creativeStrategy: VideoCreativeStrategy;
  narrativeEvents: NarrativeEvent[];
  report: PlanningNarrativeContractResult;
  repairCount: number;
}> {
  const maxRepairs = storyContractRepairMax();
  let authority = params.authority;
  let currentEvents = params.narrativeEvents;
  let current = authority === "event"
    ? applyEventAuthorityToCreativeStrategy(params.creativeStrategy, currentEvents)
    : params.creativeStrategy;
  let report = validatePlanningNarrativeContract({
    creativeStrategy: current,
    narrativeEvents: currentEvents,
    timelineSegments: params.planningManifest.timelineBlueprint.segments,
  });
  if (!isOnePromptVideoScriptQaEnabled()) {
    await logOnePromptVideo("aliyun.storyboard.planning_contract.advisory_only", {
      passed: report.passed,
      issues: report.issues,
      reason: "ONE_PROMPT_VIDEO_SCRIPT_QA is disabled",
    }, report.passed ? "info" : "warn");
    return {
      creativeStrategy: current,
      narrativeEvents: currentEvents,
      report,
      repairCount: 0,
    };
  }
  const attempts = [...(params.checkpoint.planningContractRepairState?.attempts ?? [])].slice(-8);
  let previousAttempt = attempts.at(-1);
  let repairCount = 0;
  const maxStageVisits = maxRepairs === 0 ? 0 : maxRepairs + 1;
  for (; !report.passed && repairCount < maxStageVisits; repairCount += 1) {
    const issuesBefore = report.issues;
    const issueCountBefore = report.issues.length;
    const issueFingerprint = planningContractIssueFingerprint(report);
    const bindingFingerprintBefore = creativeStrategyBindingFingerprint(current);
    const shouldEscalate = shouldEscalatePlanningContractRepair(previousAttempt, report, current);
    let mode: PlanningContractRepairAttempt["mode"] = "binding_patch";
    let changedPaths: string[] = [];
    let candidateRaw: unknown;

    if (authority === "legacy_migrated" && shouldEscalate && previousAttempt?.mode === "binding_patch") {
      const fallback = deterministicLegacyOrderFallback(current, currentEvents, report.issues);
      if (fallback) {
        mode = "deterministic_fallback";
        current = fallback.strategy;
        changedPaths = fallback.changedPaths;
      }
    }
    if (mode !== "deterministic_fallback" && (authority === "event" || shouldEscalate)) {
      mode = "event_role_replan";
    }

    await reportPlannerProgress({
      stage: "planning_contract_repair",
      attempt: repairCount + 1,
      detailZh: mode === "event_role_replan"
        ? `事件职责与时间线存在 ${report.issues.length} 项不一致，正在局部重规划 narrative_event.story_functions。`
        : `创意策略与事件时间线存在 ${report.issues.length} 项不一致，正在以白名单 Patch 修复事件绑定。`,
      detailEn: mode === "event_role_replan"
        ? `Narrative event responsibilities have ${report.issues.length} contract issue(s). Replanning event roles only.`
        : `Creative strategy has ${report.issues.length} event-contract issue(s). Applying a whitelisted binding patch.`,
    });
    if (mode !== "deterministic_fallback") {
      const repairPlan = mode === "event_role_replan"
        ? buildModelRepairPlan({
            targetStage: "planning_event_role_replan",
            issues: report.issues,
            scope: { kind: "document" },
            preserveRules: [
              "Modify only narrative_events.story_functions and directly stale creative strategy prose.",
              "Preserve every event fact, event order, timeline segment, duration, anchor, and source_event_id.",
            ],
          })
        : buildModelRepairPlan({
            targetStage: "planning_contract_repair",
            issues: report.issues,
            scope: { kind: "document" },
            preserveRules: [
              "Modify only whitelisted creative_strategy fields.",
              "Preserve narrative_events and planning_manifest.timeline_blueprint exactly.",
            ],
          });
      candidateRaw = await executeStructuredStage({
        stage: mode === "event_role_replan"
          ? `planning_event_role_replan_${repairCount + 1}`
          : `planning_contract_repair_${repairCount + 1}`,
        modelName: params.modelName,
        systemPrompt: `${
          mode === "event_role_replan"
            ? PLANNING_EVENT_ROLE_REPLAN_SYSTEM_PROMPT
            : PLANNING_NARRATIVE_CONTRACT_REPAIR_SYSTEM_PROMPT
        }${STRUCTURED_REPAIR_EXECUTION_RULES}`,
        userContent: JSON.stringify({
          user_idea: params.input.userPrompt,
          current_creative_strategy: current,
          narrative_events: currentEvents,
          timeline_blueprint: params.planningManifest.timelineBlueprint,
          contract_issues: report.issues,
          previous_attempts: attempts.slice(-2),
          repair_plan: repairPlan,
        }),
        temperature: mode === "event_role_replan" ? 0.08 : 0.05,
      });
      const envelope = isRecord(candidateRaw) ? candidateRaw : {};
      if (mode === "event_role_replan") {
        const eventPatchResult = applyEventStoryFunctionPatches({
          events: currentEvents,
          patches: normalizeEventStoryFunctionPatches(
            readLoose(envelope, "eventStoryFunctionPatches", "event_story_function_patches"),
          ),
        });
        currentEvents = eventPatchResult.events;
        changedPaths.push(...eventPatchResult.changedEventIds.map((eventId) => `/narrative_events/${eventId}/story_functions`));
        current = applyEventAuthorityToCreativeStrategy(current, currentEvents);
        const prosePatchResult = applyCreativeStrategyPatches({
          strategy: current,
          patches: normalizeCreativeStrategyPatches(
            readLoose(envelope, "creativeStrategyPatches", "creative_strategy_patches"),
          ),
          validEventIds: currentEvents.map((event) => event.eventId),
        });
        current = applyEventAuthorityToCreativeStrategy(prosePatchResult.strategy, currentEvents);
        changedPaths.push(...prosePatchResult.changedPaths);
        authority = "event";
      } else {
        const patchResult = applyCreativeStrategyPatches({
          strategy: current,
          patches: normalizeCreativeStrategyPatches(envelope.patches),
          validEventIds: currentEvents.map((event) => event.eventId),
        });
        current = patchResult.strategy;
        changedPaths.push(...patchResult.changedPaths);
        currentEvents = materializeNarrativeEventStoryFunctions(
          currentEvents.map((event) => ({ ...event, storyFunctions: [] })),
          current,
        ).events;
      }
    } else {
      currentEvents = materializeNarrativeEventStoryFunctions(
        currentEvents.map((event) => ({ ...event, storyFunctions: [] })),
        current,
      ).events;
    }

    report = validatePlanningNarrativeContract({
      creativeStrategy: current,
      narrativeEvents: currentEvents,
      timelineSegments: params.planningManifest.timelineBlueprint.segments,
    });
    const attempt: PlanningContractRepairAttempt = {
      attempt: repairCount + 1,
      mode,
      issueFingerprint,
      bindingFingerprintBefore,
      bindingFingerprintAfter: creativeStrategyBindingFingerprint(current),
      issueCountBefore,
      issueCountAfter: report.issues.length,
      changedPaths: uniqueStrings(changedPaths),
      issues: issuesBefore,
      createdAt: new Date().toISOString(),
    };
    attempts.push(attempt);
    previousAttempt = attempt;
    params.checkpoint.planningContractRepairState = {
      status: report.passed ? "passed" : "repairing",
      authority,
      attempts: attempts.slice(-8),
      currentIssues: report.issues,
      lastCandidateRaw: candidateRaw,
      updatedAt: new Date().toISOString(),
    };
    params.checkpoint.planningRaw = replacePlanningNarrativeAuthority(
      params.checkpoint.planningRaw,
      current,
      currentEvents,
    );
    params.checkpoint.resumeFromStage = report.passed
      ? undefined
      : "planning_contract_repair";
    if (report.passed) {
      clearPlannerCheckpointFailureAfterStageSuccess(
        params.checkpoint,
        "planning_contract_repair",
      );
    }
    await savePlannerCheckpoint(params.checkpoint, params.onCheckpoint);
    await logOnePromptVideo("aliyun.storyboard.planning_contract.repair", {
      attempt: repairCount + 1,
      mode,
      passed: report.passed,
      issueFingerprint,
      bindingFingerprintBefore,
      bindingFingerprintAfter: attempt.bindingFingerprintAfter,
      changedPaths: attempt.changedPaths,
      remainingIssues: report.issues,
    }, report.passed ? "info" : "warn");
    if (report.passed) {
      return {
        creativeStrategy: current,
        narrativeEvents: currentEvents,
        report,
        repairCount: repairCount + 1,
      };
    }
  }
  if (!report.passed) {
    params.checkpoint.planningContractRepairState = {
      status: "event_replan_required",
      authority,
      attempts: attempts.slice(-8),
      currentIssues: report.issues,
      lastCandidateRaw: params.checkpoint.planningContractRepairState?.lastCandidateRaw,
      updatedAt: new Date().toISOString(),
    };
    params.checkpoint.resumeFromStage = "planning_contract_repair";
    await savePlannerCheckpoint(params.checkpoint, params.onCheckpoint);
    throw new StoryboardStageError(
      `Planning narrative contract validation failed: ${report.issues
        .slice(0, 8)
        .map((item) => `${item.code}@${item.path}`)
        .join(", ")}`,
      {
        code: "contract_validation_error",
        retryable: false,
        stage: "planning_contract_repair",
        validationErrors: report.issues.map((item) => `${item.code}@${item.path}: ${item.repairHint}`),
      },
    );
  }
  params.checkpoint.planningContractRepairState = {
    status: "passed",
    authority,
    attempts: attempts.slice(-8),
    currentIssues: [],
    updatedAt: new Date().toISOString(),
  };
  params.checkpoint.resumeFromStage = undefined;
  if (clearPlannerCheckpointFailureAfterStageSuccess(
    params.checkpoint,
    "planning_contract_repair",
  )) {
    await savePlannerCheckpoint(params.checkpoint, params.onCheckpoint);
  }
  return {
    creativeStrategy: current,
    narrativeEvents: currentEvents,
    report,
    repairCount: 0,
  };
}

function normalizeCreativeStrategyPatches(value: unknown): CreativeStrategyPatch[] {
  return arrayOfRecords(value).flatMap((item) => {
    const path = stringOr(item.path, "");
    if (item.op !== "replace" || !path) return [];
    return [{ op: "replace", path, value: item.value }];
  });
}

function normalizeEventStoryFunctionPatches(value: unknown): EventStoryFunctionPatch[] {
  return arrayOfRecords(value).flatMap((item) => {
    const eventId = stringOr(item.eventId ?? item.event_id, "");
    if (!eventId) return [];
    return [{
      eventId,
      storyFunctions: normalizeStoryFunctionArray(item.storyFunctions ?? item.story_functions),
    }];
  });
}

function replacePlanningCreativeStrategy(
  planningRaw: unknown,
  creativeStrategy: VideoCreativeStrategy,
): Record<string, unknown> {
  const envelope = isRecord(planningRaw) ? { ...planningRaw } : {};
  envelope.classification = {
    video_type: creativeStrategy.videoType,
    video_category: creativeStrategy.videoCategory,
    template_id: creativeStrategy.templateId,
    template_reason_zh: creativeStrategy.templateReasonZh,
    chronology_mode: creativeStrategy.chronologyMode,
    fallback_reason_zh: creativeStrategy.fallbackReasonZh,
  };
  delete envelope.creativeStrategy;
  envelope.creative_strategy = creativeStrategy;
  return envelope;
}

function replacePlanningNarrativeAuthority(
  planningRaw: unknown,
  creativeStrategy: VideoCreativeStrategy,
  narrativeEvents: NarrativeEvent[],
): Record<string, unknown> {
  const envelope = replacePlanningCreativeStrategy(planningRaw, creativeStrategy);
  delete envelope.narrativeEvents;
  envelope.narrative_events = narrativeEvents.map((event) => ({
    event_id: event.eventId,
    story_functions: event.storyFunctions ?? [],
    dramatic_goal: event.dramaticGoal,
    participants: event.participants,
    location_id: event.locationId,
    initial_state: event.initialState,
    action: event.action,
    resulting_state: event.resultingState,
    required_anchor_ids: event.requiredAnchorIds,
    previous_event_ids: event.previousEventIds,
    must_become_separate_segment: event.mustBecomeSeparateSegment,
  }));
  return envelope;
}

export function applyTimelineReplanToPlanningRaw(params: {
  planningRaw: unknown;
  timelineReplanRaw: unknown;
  currentManifest: VideoPlanningManifest;
  input: PlanVideoProjectInput;
  fallback: OnePromptVideoPlan;
  request: TimelineChangeRequest;
}): Record<string, unknown> {
  const responseEnvelope = isRecord(params.timelineReplanRaw) ? params.timelineReplanRaw : {};
  const replan = isRecord(responseEnvelope.timeline_replan)
    ? responseEnvelope.timeline_replan
    : responseEnvelope;
  const manifestPatch = isRecord(replan.planning_manifest)
    ? replan.planning_manifest
    : isRecord(replan.planningManifest)
      ? replan.planningManifest
      : {};
  const timelinePatch = isRecord(manifestPatch.timeline_blueprint)
    ? manifestPatch.timeline_blueprint
    : isRecord(manifestPatch.timelineBlueprint)
      ? manifestPatch.timelineBlueprint
      : {};
  if (!arrayOfRecords(timelinePatch.segments).length) {
    throw new Error("Timeline Replanner returned no timeline_blueprint.segments.");
  }

  const baseEnvelope = isRecord(params.planningRaw) ? { ...params.planningRaw } : {};
  const baseManifest = isRecord(baseEnvelope.planning_manifest)
    ? { ...baseEnvelope.planning_manifest }
    : isRecord(baseEnvelope.planningManifest)
      ? { ...baseEnvelope.planningManifest }
      : { ...params.currentManifest };
  const revisedRaw: Record<string, unknown> = {
    ...baseEnvelope,
    planning_manifest: {
      ...baseManifest,
      timeline_blueprint: timelinePatch,
    },
    candidate_timeline: timelinePatch.segments,
  };
  const revisedNarrativeEvents = replan.narrative_events ?? replan.narrativeEvents;
  if (Array.isArray(revisedNarrativeEvents) && revisedNarrativeEvents.length) {
    revisedRaw.narrative_events = revisedNarrativeEvents;
  }

  const durationIssues = validatePlanningDurationContract(revisedRaw, params.input);
  if (durationIssues.length) {
    throw new Error(
      `Timeline Replanner returned an invalid duration contract: ${durationIssues
        .slice(0, 8)
        .map((issue) => `${issue.code}@${issue.path}`)
        .join(", ")}`,
    );
  }
  const revisedManifest = normalizePlanningManifest(
    revisedRaw,
    params.input,
    params.fallback,
  );
  const currentSegments = params.currentManifest.timelineBlueprint.segments;
  const revisedSegments = revisedManifest.timelineBlueprint.segments;
  if (revisedSegments.length <= currentSegments.length) {
    throw new Error(
      `Timeline Replanner must add at least one segment; received ${revisedSegments.length}, current ${currentSegments.length}.`,
    );
  }
  const lockedPrefixCount = Math.max(0, params.request.firstAffectedSegmentNo - 1);
  for (let index = 0; index < lockedPrefixCount; index += 1) {
    if (!timelineSegmentsEquivalent(currentSegments[index], revisedSegments[index])) {
      throw new Error(
        `Timeline Replanner changed locked prefix segment ${index + 1}; only segment ${params.request.firstAffectedSegmentNo} and later may change.`,
      );
    }
  }
  return revisedRaw;
}

function timelineSegmentsEquivalent(
  left: VideoTimelineBlueprintSegment | undefined,
  right: VideoTimelineBlueprintSegment | undefined,
): boolean {
  if (!left || !right) return false;
  return JSON.stringify({
    segmentNo: left.segmentNo,
    startTimeSeconds: left.startTimeSeconds,
    endTimeSeconds: left.endTimeSeconds,
    durationSeconds: left.durationSeconds,
    beatRole: left.beatRole ?? "custom",
    purposeZh: left.purposeZh ?? "",
    requiredAnchorIds: left.requiredAnchorIds ?? [],
    sourceEventIds: left.sourceEventIds ?? [],
    boundaryModeHint: left.boundaryModeHint ?? "continuous",
  }) === JSON.stringify({
    segmentNo: right.segmentNo,
    startTimeSeconds: right.startTimeSeconds,
    endTimeSeconds: right.endTimeSeconds,
    durationSeconds: right.durationSeconds,
    beatRole: right.beatRole ?? "custom",
    purposeZh: right.purposeZh ?? "",
    requiredAnchorIds: right.requiredAnchorIds ?? [],
    sourceEventIds: right.sourceEventIds ?? [],
    boundaryModeHint: right.boundaryModeHint ?? "continuous",
  });
}

export function invalidateCheckpointAfterTimelineReplan(
  checkpoint: AliyunStoryboardPlannerCheckpoint,
  firstAffectedSegmentNo: number,
): void {
  const keepPrefix = <T>(records: Record<string, T> | undefined): Record<string, T> =>
    Object.fromEntries(
      Object.entries(records ?? {}).filter(([key]) => {
        const segmentNo = Number(key);
        return Number.isInteger(segmentNo) && segmentNo > 0 && segmentNo < firstAffectedSegmentNo;
      }),
    );
  checkpoint.storyboardArtistPlan = undefined;
  checkpoint.storyContractReport = undefined;
  checkpoint.storySemanticReview = undefined;
  checkpoint.planningContractRepairState = undefined;
  checkpoint.shotDecomposerSegmentPlans = keepPrefix(checkpoint.shotDecomposerSegmentPlans);
  checkpoint.approvedShotDecomposerSegmentPlans = keepPrefix(checkpoint.approvedShotDecomposerSegmentPlans);
  checkpoint.promptDetailSegmentPlans = keepPrefix(checkpoint.promptDetailSegmentPlans);
}

async function ensureStoryboardStoryContract(params: {
  input: PlanVideoProjectInput;
  modelName: string;
  planningManifest: VideoPlanningManifest;
  planningStoryDesignContext: Record<string, unknown>;
  planningTemplateId: VideoCreativeTemplateId;
  storyboardArtistPlan: Record<string, unknown>;
}): Promise<{
  storyboardArtistPlan: Record<string, unknown>;
  report: StoryContractGateResult;
  repairCount: number;
}> {
  const validSegmentNos = params.planningManifest.timelineBlueprint.segments.map((segment) => segment.segmentNo);
  const validEventIds = uniqueStrings(params.planningManifest.timelineBlueprint.segments
    .flatMap((segment) => segment.sourceEventIds ?? []));
  const requiredStoryContract = {
    template_id: params.planningTemplateId,
    required_story_functions: requiredStoryFunctionsForTemplate(params.planningTemplateId),
    valid_event_ids: validEventIds,
    valid_segment_nos: validSegmentNos,
    causal_reference_rule: "references must exist and point to a smaller beat order",
    evidence_rule: "every key_evidence_id must exist in evidence_registry and be visible in the beat target segment",
  };
  const maxRepairs = storyContractRepairMax();
  let current = params.storyboardArtistPlan;
  let report = validateStoryboardStoryContract({
    storyboardArtistPlan: current,
    templateId: params.planningTemplateId,
    validEventIds,
    validSegmentNos,
  });
  if (!isOnePromptVideoScriptQaEnabled()) {
    await logOnePromptVideo("aliyun.storyboard.story_contract.advisory_only", {
      passed: report.passed,
      issues: report.issues,
      reason: "ONE_PROMPT_VIDEO_SCRIPT_QA is disabled",
    }, report.passed ? "info" : "warn");
    return { storyboardArtistPlan: current, report, repairCount: 0 };
  }
  for (let repairCount = 0; !report.passed && repairCount < maxRepairs; repairCount += 1) {
    await reportPlannerProgress({
      stage: "story_contract_repair",
      attempt: repairCount + 1,
      detailZh: `剧情合同有 ${report.issues.length} 项不一致，正在定向修复剧情节拍和引用。`,
      detailEn: `The story contract has ${report.issues.length} inconsistencies. Repairing only story beats and references.`,
      metricsDelta: { storyContractRepairCount: 1 },
    });
    const repairIssues = report.issues.map((issue) => ({
      code: issue.code,
      path: issue.path,
      messageZh: issue.messageZh,
      repairHint: issue.repairHint,
      segmentNo: issue.segmentNo,
    }));
    const repairPlan = buildModelRepairPlan({
      targetStage: "story_contract_repair",
      issues: repairIssues,
      scope: { kind: "document" },
      preserveRules: [
        "Modify only story_beats, evidence_registry, storyboard_brief links, and directly dependent shot_grouping_pass links.",
        "Preserve planning, camera graph, transition plan, segment timing, and all valid story content.",
      ],
    });
    const repairedRaw = await executeStructuredStage({
      stage: `story_contract_repair_${repairCount + 1}`,
      modelName: params.modelName,
      systemPrompt: `${STORY_CONTRACT_REPAIR_SYSTEM_PROMPT}${STRUCTURED_REPAIR_EXECUTION_RULES}`,
      userContent: JSON.stringify({
        user_idea: params.input.userPrompt,
        planning_manifest: params.planningManifest,
        story_design_context: params.planningStoryDesignContext,
        required_story_contract: requiredStoryContract,
        contract_issues: report.issues.map((issue) => ({
          code: issue.code,
          path: issue.path,
          beat_id: issue.beatId,
          segment_no: issue.segmentNo,
          repair_hint: issue.repairHint,
        })),
        repair_plan: repairPlan,
        current_storyboard_artist_plan: current,
      }),
      temperature: 0.15,
    });
    current = mergeSemanticStoryRepair(
      current,
      unwrapPlanRoot(repairedRaw, "storyboard_artist_plan"),
    );
    report = validateStoryboardStoryContract({
      storyboardArtistPlan: current,
      templateId: params.planningTemplateId,
      validEventIds,
      validSegmentNos,
    });
    await logOnePromptVideo("aliyun.storyboard.story_contract.repair", {
      attempt: repairCount + 1,
      passed: report.passed,
      remainingIssues: report.issues,
    }, report.passed ? "info" : "warn");
    if (report.passed) return { storyboardArtistPlan: current, report, repairCount: repairCount + 1 };
  }
  if (!report.passed) {
    throw new Error(`Story contract validation failed before shot decomposition: ${report.issues
      .slice(0, 8)
      .map((issue) => `${issue.code}@${issue.path}`)
      .join(", ")}`);
  }
  return { storyboardArtistPlan: current, report, repairCount: 0 };
}

async function ensureStoryboardSemanticQuality(params: {
  input: PlanVideoProjectInput;
  modelName: string;
  repairModelName: string;
  planningManifest: VideoPlanningManifest;
  planningStoryDesignContext: Record<string, unknown>;
  planningTemplateId: VideoCreativeTemplateId;
  storyboardArtistPlan: Record<string, unknown>;
  referenceFacts: unknown;
}): Promise<{
  storyboardArtistPlan: Record<string, unknown>;
  review: VideoStorySemanticReview;
  repairCount: number;
}> {
  const mode = semanticStoryGateMode();
  let current = params.storyboardArtistPlan;
  if (mode === "off") {
    const review: VideoStorySemanticReview = {
      passed: true,
      dimensionScores: {},
      issues: [],
      strengths: [],
      summaryZh: "语义剧情评审已通过环境变量关闭。",
      blockingIssueCodes: [],
      invalidEvidenceReferences: [],
      repairAttempts: 0,
      modelName: params.modelName,
    };
    return { storyboardArtistPlan: attachSemanticReview(current, review), review, repairCount: 0 };
  }

  let review: VideoStorySemanticReview;
  try {
    review = await reviewStoryboardSemantics({ ...params, storyboardArtistPlan: current, repairAttempts: 0 });
  } catch (error) {
    if (mode === "strict") throw error;
    review = semanticStoryUnavailableReview(params.modelName, error);
    await logOnePromptVideo("aliyun.storyboard.story_semantic_critic.unavailable", {
      mode,
      ...errorForLog(error),
    }, "warn");
    return { storyboardArtistPlan: attachSemanticReview(current, review), review, repairCount: 0 };
  }
  const semanticContractRevision = createHash("sha256").update(JSON.stringify({
    userPrompt: params.input.userPrompt,
    planningManifest: params.planningManifest,
    planningTemplateId: params.planningTemplateId,
  })).digest("hex");
  let convergence: RepairConvergenceDecision = advanceRepairConvergence({
    stage: "story_semantic",
    repairMode: "local_edit",
    contractRevision: semanticContractRevision,
    report: semanticReviewAsQualityReport(review),
    candidateId: "storyboard:initial",
    candidateNo: 1,
    policy: {
      maxRepairAttempts: semanticStoryRepairMax(),
      // Initial review plus the configured number of repair reviews.
      maxStageVisits: semanticStoryRepairMax() + 1,
    },
  });
  const maxRepairs = semanticStoryRepairMax();
  for (let repairCount = 0; !review.passed && repairCount < maxRepairs; repairCount += 1) {
    if (!convergence.mayContinueAutomatically) {
      await logOnePromptVideo("aliyun.storyboard.story_semantic_repair.convergence_stopped", {
        attempt: repairCount + 1,
        terminalState: convergence.terminalState,
        reason: convergence.reason,
        bestObjective: convergence.episode.bestObjective,
      }, "warn");
      break;
    }
    await reportPlannerProgress({
      stage: "story_semantic_repair",
      attempt: repairCount + 1,
      detailZh: `语义剧情评审发现 ${review.blockingIssueCodes.length} 项高置信度问题，正在定向修复剧情节拍。`,
      detailEn: `Semantic story review found ${review.blockingIssueCodes.length} high-confidence issue(s). Repairing story beats only.`,
    });
    try {
      const semanticRepairIssues = review.issues
        .filter((issue) => issue.severity === "error" && issue.confidence >= 0.72)
        .map((issue) => ({
          code: issue.code,
          path: issue.rewriteFromStage === "storyboard" ? "storyboard_brief" : "story_beats",
          message: issue.claimZh,
          repairHint: issue.repairInstructionZh,
        }));
      const repairPlan = buildModelRepairPlan({
        targetStage: "story_semantic_repair",
        issues: semanticRepairIssues.length
          ? semanticRepairIssues
          : review.blockingIssueCodes.map((code) => ({
              code,
              path: "story_beats",
              message: code,
              repairHint: "Repair the blocking semantic issue using only evidence-backed story beat changes.",
            })),
        scope: { kind: "document" },
        preserveRules: [
          "Modify only story_beats, evidence_registry, storyboard_brief, and shot_grouping_pass.",
          "Preserve the planning manifest, timeline, camera graph, transitions, anchors, and valid causal links.",
        ],
      });
      const repairedRaw = await executeStructuredStage({
        stage: `story_semantic_repair_${repairCount + 1}`,
        modelName: params.repairModelName,
        systemPrompt: `${STORY_SEMANTIC_REPAIR_SYSTEM_PROMPT}${STRUCTURED_REPAIR_EXECUTION_RULES}`,
        userContent: JSON.stringify({
          user_idea: params.input.userPrompt,
          planning_manifest: params.planningManifest,
          story_design_context: params.planningStoryDesignContext,
          critic_review: review,
          repair_plan: repairPlan,
          current_storyboard_artist_plan: current,
        }),
        temperature: 0.18,
      });
      current = mergeSemanticStoryRepair(current, unwrapPlanRoot(repairedRaw, "storyboard_artist_plan"));
      const repairedContract = await ensureStoryboardStoryContract({
        input: params.input,
        modelName: params.repairModelName,
        planningManifest: params.planningManifest,
        planningStoryDesignContext: params.planningStoryDesignContext,
        planningTemplateId: params.planningTemplateId,
        storyboardArtistPlan: current,
      });
      current = repairedContract.storyboardArtistPlan;
      review = await reviewStoryboardSemantics({
        ...params,
        storyboardArtistPlan: current,
        repairAttempts: repairCount + 1,
      });
      convergence = advanceRepairConvergence({
        previous: convergence.episode,
        stage: "story_semantic",
        repairMode: repairCount === 0 ? "local_edit" : "guided_regenerate",
        contractRevision: semanticContractRevision,
        report: semanticReviewAsQualityReport(review),
        candidateId: `storyboard:repair:${repairCount + 1}`,
        candidateNo: repairCount + 2,
        policy: {
          maxRepairAttempts: maxRepairs,
          maxStageVisits: maxRepairs + 1,
        },
      });
    } catch (error) {
      if (mode === "strict") throw error;
      await logOnePromptVideo("aliyun.storyboard.story_semantic_repair.unavailable", {
        mode,
        attempt: repairCount + 1,
        ...errorForLog(error),
      }, "warn");
      break;
    }
  }

  current = attachSemanticReview(current, review);
  await logOnePromptVideo("aliyun.storyboard.story_semantic_critic.result", {
    mode,
    passed: review.passed,
    repairAttempts: review.repairAttempts,
    blockingIssueCodes: review.blockingIssueCodes,
    invalidEvidenceReferences: review.invalidEvidenceReferences,
    dimensionScores: review.dimensionScores,
    convergenceTerminalState: convergence.terminalState,
    convergenceReason: convergence.reason,
    convergenceBestObjective: convergence.episode.bestObjective,
  }, review.passed ? "info" : "warn");
  if (!review.passed && mode === "strict") {
    throw new Error(`Semantic story review failed before shot decomposition: ${review.blockingIssueCodes.slice(0, 8).join(", ")}`);
  }
  return {
    storyboardArtistPlan: current,
    review,
    repairCount: review.repairAttempts ?? 0,
  };
}

function semanticReviewAsQualityReport(
  review: VideoStorySemanticReview,
): GenerationQualityReport {
  const scores = Object.values(review.dimensionScores)
    .filter((score): score is number => typeof score === "number")
    .map((score) => score * 20);
  const minimumScore = scores.length ? Math.min(...scores) : review.passed ? 100 : 0;
  return {
    assetId: "storyboard_semantic_contract",
    identityScore: minimumScore,
    layoutScore: minimumScore,
    promptAlignmentScore: minimumScore,
    continuityScore: minimumScore,
    artifactIssues: review.issues.map((issue) => `${issue.code}: ${issue.claimZh}`),
    hardFailureReasons: review.blockingIssueCodes,
    missingReferenceAnchorIds: review.invalidEvidenceReferences,
    passed: review.passed,
    retryFromStage: review.issues.some((issue) => issue.rewriteFromStage === "creative_strategy")
      ? "stage2b"
      : "stage3",
  };
}

function semanticStoryUnavailableReview(modelName: string, error: unknown): VideoStorySemanticReview {
  return {
    passed: true,
    dimensionScores: {},
    issues: [{
      code: "SEMANTIC_CRITIC_UNAVAILABLE",
      severity: "warning",
      confidence: 1,
      dimension: "causal_coherence",
      claimZh: "语义剧情评审服务暂时不可用，本轮仅保留硬编码剧情合同检查。",
      evidenceEventIds: [],
      evidenceBeatIds: [],
      whyItHurtsZh: "本轮无法获得对吸引力、转折、兑现和转化语义的模型评审。",
      repairInstructionZh: "稍后重新运行剧情评审，或在严格模式下阻止继续生成。",
      rewriteFromStage: "storyboard",
    }],
    strengths: [],
    summaryZh: error instanceof Error
      ? `语义剧情评审不可用：${error.message}`
      : "语义剧情评审不可用。",
    blockingIssueCodes: [],
    invalidEvidenceReferences: [],
    repairAttempts: 0,
    modelName,
  };
}

async function reviewStoryboardSemantics(params: {
  input: PlanVideoProjectInput;
  modelName: string;
  planningManifest: VideoPlanningManifest;
  planningStoryDesignContext: Record<string, unknown>;
  storyboardArtistPlan: Record<string, unknown>;
  referenceFacts: unknown;
  repairAttempts: number;
}): Promise<VideoStorySemanticReview> {
  const storyBeats = arrayOfRecords(readLoose(params.storyboardArtistPlan, "storyBeats", "story_beats"));
  const validBeatIds = storyBeats
    .map((beat) => stringOr(beat.beatId ?? beat.beat_id, ""))
    .filter(Boolean);
  const narrativeEvents = arrayOfRecords(readLoose(params.planningStoryDesignContext, "narrativeEvents", "narrative_events"));
  const validEventIds = narrativeEvents
    .map((event) => stringOr(event.eventId ?? event.event_id, ""))
    .filter(Boolean);
  const creativeStrategy = isRecord(params.planningStoryDesignContext.creative_strategy)
    ? params.planningStoryDesignContext.creative_strategy
    : {};
  const raw = await executeStructuredStage({
    stage: params.repairAttempts > 0
      ? `story_semantic_critic_after_repair_${params.repairAttempts}`
      : "story_semantic_critic",
    modelName: params.modelName,
    systemPrompt: STORY_SEMANTIC_CRITIC_SYSTEM_PROMPT,
    userContent: JSON.stringify({
      user_idea: params.input.userPrompt,
      aspect_ratio: params.input.aspectRatio,
      duration_seconds: params.input.durationSeconds,
      target_audience: readLoose(creativeStrategy, "audienceZh", "audience_zh"),
      conversion_goal: readLoose(creativeStrategy, "conversionGoalZh", "conversion_goal_zh"),
      reference_facts: params.referenceFacts,
      creative_strategy: creativeStrategy,
      narrative_events: narrativeEvents,
      story_beats: storyBeats,
      evidence_registry: readLoose(params.storyboardArtistPlan, "evidenceRegistry", "evidence_registry") ?? [],
      timeline_blueprint: params.planningManifest.timelineBlueprint,
      storyboard_brief: readLoose(params.storyboardArtistPlan, "storyboardBrief", "storyboard_brief") ?? [],
    }),
    temperature: 0.12,
  });
  return normalizeStorySemanticReview(raw, {
    validEventIds,
    validBeatIds,
    modelName: params.modelName,
    repairAttempts: params.repairAttempts,
  });
}

function mergeSemanticStoryRepair(
  current: Record<string, unknown>,
  repaired: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...current };
  for (const [camel, snake] of [
    ["storyBeats", "story_beats"],
    ["evidenceRegistry", "evidence_registry"],
    ["storyboardBrief", "storyboard_brief"],
    ["shotGroupingPass", "shot_grouping_pass"],
  ] as const) {
    const value = readLoose(repaired, camel, snake);
    if (value === undefined) continue;
    delete next[camel];
    next[snake] = value;
  }
  return next;
}

function attachSemanticReview(
  plan: Record<string, unknown>,
  review: VideoStorySemanticReview,
): Record<string, unknown> {
  return {
    ...plan,
    story_semantic_review: review,
  };
}

function semanticStoryGateMode(): "off" | "warn" | "strict" {
  if (!isOnePromptVideoScriptQaEnabled()) return "off";
  const raw = String(process.env.ONE_PROMPT_VIDEO_SEMANTIC_STORY_GATE ?? "warn").trim().toLowerCase();
  return raw === "off" || raw === "strict" ? raw : "warn";
}

function semanticStoryRepairMax(): number {
  if (!isOnePromptVideoScriptQaEnabled()) return 0;
  const raw = Number(process.env.ONE_PROMPT_VIDEO_SEMANTIC_STORY_REPAIR_MAX);
  if (!Number.isFinite(raw)) return 1;
  return Math.max(0, Math.min(2, Math.round(raw)));
}

function storyContractRepairMax(): number {
  if (!isOnePromptVideoScriptQaEnabled()) return 0;
  const raw = Number(process.env.ONE_PROMPT_VIDEO_STORY_CONTRACT_REPAIR_MAX);
  if (!Number.isFinite(raw)) return 2;
  return Math.max(0, Math.min(3, Math.round(raw)));
}

function timelineReplanMax(): number {
  if (!isOnePromptVideoScriptQaEnabled()) return 0;
  const raw = Number(process.env.ONE_PROMPT_VIDEO_TIMELINE_REPLAN_MAX);
  if (!Number.isFinite(raw)) return 2;
  return Math.max(0, Math.min(3, Math.round(raw)));
}

function planningDurationRepairMax(): number {
  if (!isOnePromptVideoScriptQaEnabled()) return 0;
  const raw = Number(process.env.ONE_PROMPT_VIDEO_DURATION_REPAIR_MAX);
  if (!Number.isFinite(raw)) return 2;
  return Math.max(0, Math.min(3, Math.round(raw)));
}

function storyDesignStageContext(source: unknown): Record<string, unknown> {
  const envelope = isRecord(source) ? source : {};
  const root = unwrapPlanRoot(source, "planning_manifest");
  return {
    creative_strategy: planningCreativeStrategySource(source),
    narrative_micro_rules: readLoose(envelope, "narrativeMicroRules", "narrative_micro_rules") ?? readLoose(root, "narrativeMicroRules", "narrative_micro_rules") ?? {},
    narrative_events: readLoose(envelope, "narrativeEvents", "narrative_events") ?? readLoose(root, "narrativeEvents", "narrative_events") ?? [],
    story_beats: readLoose(envelope, "storyBeats", "story_beats") ?? readLoose(root, "storyBeats", "story_beats") ?? [],
    shot_grouping_pass: readLoose(envelope, "shotGroupingPass", "shot_grouping_pass") ?? readLoose(root, "shotGroupingPass", "shot_grouping_pass") ?? {},
  };
}

function planningCreativeStrategySource(source: unknown): Record<string, unknown> {
  const envelope = isRecord(source) ? source : {};
  const root = unwrapPlanRoot(source, "planning_manifest");
  const strategy = firstDefined(
    readLoose(envelope, "creativeStrategy", "creative_strategy"),
    readLoose(root, "creativeStrategy", "creative_strategy"),
  );
  const classification = firstDefined(
    readLoose(envelope, "classification", "classification"),
    readLoose(root, "classification", "classification"),
  );
  return {
    ...(isRecord(strategy) ? strategy : {}),
    ...(isRecord(classification) ? classification : {}),
  };
}

interface ShotDecomposerPipelineResult {
  shotDecomposerPlan: Record<string, unknown>;
  promptDetailPlan?: VideoPromptDetailPlan;
}

type SegmentShotPipelineResult =
  | {
    status: "completed";
    shotDecomposerPlan: Record<string, unknown>;
    promptDetailPlan?: VideoPromptDetailPlan;
  }
  | {
    status: "timeline_replan_required";
    request: TimelineChangeRequest;
  };

async function createShotDecomposerPlan(params: {
  input: PlanVideoProjectInput;
  modelName: string;
  planningManifest: VideoPlanningManifest;
  storyboardArtistPlan: Record<string, unknown>;
  storyDesignContext: Record<string, unknown>;
  checkpoint: AliyunStoryboardPlannerCheckpoint;
  onCheckpoint?: (checkpoint: AliyunStoryboardPlannerCheckpoint) => Promise<void> | void;
  baseCompletedSteps: number;
  totalPlanningSteps: number;
}): Promise<ShotDecomposerPipelineResult> {
  const timelineSegments = params.planningManifest.timelineBlueprint.segments;

  const concurrency = shotDecomposerConcurrency();
  await logOnePromptVideo("aliyun.storyboard.shot_decomposer.segmented.start", {
    segmentCount: timelineSegments.length,
    concurrency,
    model: params.modelName,
  });

  let decomposedSegments = 0;
  let completedSegments = 0;
  const totalSteps = params.totalPlanningSteps;
  const segmentResults = await mapWithConcurrency<VideoTimelineBlueprintSegment, SegmentShotPipelineResult>(
    timelineSegments,
    concurrency,
    async (segment) => {
    const stage = `shot_decomposer_s${segment.segmentNo}`;
    const checkpointKey = String(segment.segmentNo);
    let plan = params.checkpoint.shotDecomposerSegmentPlans?.[checkpointKey];
    if (!plan) {
      let contractValidationFeedback = "";
      const structuredFailureKey = structuredFailureCheckpointKey(
        stage,
        segment.segmentNo,
        segmentShotDecomposerContract.version,
      );
      const handleStructuredContractFailure = async (error: unknown): Promise<never> => {
        const feedback = storyboardContractValidationFeedback(error);
        if (!feedback) throw error;
        contractValidationFeedback = feedback;
        const identity = structuredContractIssueFingerprint(
          {
            stage,
            segment: segment.segmentNo,
            schemaVersion: segmentShotDecomposerContract.version,
          },
          contractIssuesFromStageError(error),
        );
        const issues = contractIssuesFromStageError(error);
        const state = {
          ...advanceStructuredFailureState(
          params.checkpoint.structuredFailures?.[structuredFailureKey],
          identity,
          ),
          issues,
          candidatePreview: sanitizeStructuredCandidate(
            error instanceof StoryboardStageError ? error.rawCandidate : undefined,
          ),
        };
        params.checkpoint.structuredFailures = {
          ...(params.checkpoint.structuredFailures ?? {}),
          [structuredFailureKey]: state,
        };
        const systemicMatches = Object.entries(params.checkpoint.structuredFailures)
          .filter(([, failure]) =>
            failure.schemaVersion === state.schemaVersion
            && failure.issueFingerprint === state.issueFingerprint
            && Number.isInteger(failure.segment)
          );
        const affectedSegments = systemicStructuredFailureSegments(
          systemicMatches.map(([, failure]) => failure),
          state,
        );
        if (affectedSegments.length >= 2) {
          for (const [key, failure] of systemicMatches) {
            params.checkpoint.structuredFailures[key] = {
              ...failure,
              systemic: true,
              affectedSegments,
            };
          }
        }
        await savePlannerCheckpoint(params.checkpoint, params.onCheckpoint);
        if (affectedSegments.length >= 2) {
          await logOnePromptVideo("aliyun.storyboard.structured_contract.systemic_circuit_opened", {
            stage,
            segmentNo: segment.segmentNo,
            affectedSegments,
            schemaVersion: state.schemaVersion,
            issueFingerprint: state.issueFingerprint,
            issues,
            disposition: "contract_repair_required",
          }, "error");
          throw new StoryboardStageError(
            `${structuredIssueUserSummary(segment.segmentNo, issues)}。相同合同错误同时出现在分段 ${affectedSegments.join("、")}，已停止继续调用模型，请修复系统 Schema 或提示词后从失败分段恢复。`,
            {
              code: "contract_validation_error",
              retryable: false,
              validationErrors: error instanceof StoryboardStageError
                ? error.validationErrors
                : [feedback],
              stage,
              rawCandidate: error instanceof StoryboardStageError
                ? error.rawCandidate
                : undefined,
              cause: error,
            },
          );
        }
        if (shouldStopStructuredFailureRetry(state)) {
          await logOnePromptVideo("aliyun.storyboard.structured_contract.retry_stopped", {
            stage,
            segmentNo: segment.segmentNo,
            schemaVersion: state.schemaVersion,
            issueFingerprint: state.issueFingerprint,
            unchangedCount: state.count,
            disposition: "contract_repair_required",
          }, "error");
          throw new StoryboardStageError(
            `${structuredIssueUserSummary(segment.segmentNo, issues)}。相同合同错误连续出现两次，已停止继续调用模型；请局部修复该分段合同。`,
            {
              code: "contract_validation_error",
              retryable: false,
              validationErrors: error instanceof StoryboardStageError
                ? error.validationErrors
                : [feedback],
              stage,
              rawCandidate: error instanceof StoryboardStageError
                ? error.rawCandidate
                : undefined,
              cause: error,
            },
          );
        }
        throw error;
      };
      plan = await runStoryboardStageWithRetry({
        stage,
        maxAttempts: shotDecomposerRetryAttempts(),
        baseDelayMs: shotDecomposerRetryBaseDelayMs(),
        run: async () => {
          const baseContent = buildShotDecomposerSegmentContent({
            ...params,
            segment,
          });
          const repairPlan = contractValidationFeedback
            ? buildModelRepairPlan({
                targetStage: "shot_decomposer_contract_repair",
                issues: [{
                  code: "SHOT_DECOMPOSER_SCHEMA_INVALID",
                  path: `shot_decomposer_plan.segment_render_descriptions[segment_no=${segment.segmentNo}]`,
                  message: contractValidationFeedback,
                  repairHint: "Return the complete target-segment JSON, correcting every reported path and preserving every hard terminal, motion, identity, product, and boundary requirement.",
                  segmentNo: segment.segmentNo,
                }],
                scope: { kind: "segments", segmentNos: [segment.segmentNo] },
                preserveRules: [
                  "Preserve story, timing, camera graph, anchor identity, subtitles, audio plan, and micro-shot structure.",
                  "Modify only fields named by the strict schema errors and directly dependent fields in the target segment.",
                ],
              })
            : undefined;
          let raw: SegmentShotDecomposerOutput;
          try {
            raw = await executeStructuredStage({
              stage,
              modelName: params.modelName,
              systemPrompt: contractValidationFeedback
                ? `${SHOT_DECOMPOSER_SEGMENT_SYSTEM_PROMPT}

The previous response violated the strict target-segment JSON contract. Return the complete target-segment JSON again.
Correct every reported JSON path. motion_steps must contain 1-3 strings. motion_contract.prop_paths must be an array of strings, never objects.
Resolve the reported issues through model reasoning. Do not omit hard requirements and do not ask application code to repair your output.
${STRUCTURED_REPAIR_EXECUTION_RULES}`
                : SHOT_DECOMPOSER_SEGMENT_SYSTEM_PROMPT,
              userContent: contractValidationFeedback
                ? JSON.stringify({
                  original_request: JSON.parse(baseContent),
                  previous_contract_validation_error: contractValidationFeedback,
                  repair_plan: repairPlan,
                })
                : baseContent,
              temperature: 0.1,
              contract: segmentShotDecomposerContract,
            });
          } catch (error) {
            return handleStructuredContractFailure(error);
          }
          const candidatePlan = unwrapPlanRoot(raw, "shot_decomposer_plan");
          try {
            assertShotPlanVideoPromptContract(
              candidatePlan,
              segment.segmentNo,
              buildTerminalEvidenceCatalog({
                ...params,
                segment,
              }),
            );
          } catch (error) {
            contractValidationFeedback = error instanceof Error ? error.message : String(error);
            return handleStructuredContractFailure(new StoryboardStageError(
              `Segment ${segment.segmentNo} video prompt contract is invalid: ${contractValidationFeedback}`,
              {
                code: "contract_validation_error",
                retryable: true,
                validationErrors: [contractValidationFeedback],
                stage,
                cause: error,
              },
            ));
          }
          if (params.checkpoint.structuredFailures?.[structuredFailureKey]) {
            delete params.checkpoint.structuredFailures[structuredFailureKey];
          }
          return candidatePlan;
        },
        onRetry: async ({ attempt, nextAttempt, delayMs, error }) => {
          const isContractRetry =
            error instanceof StoryboardStageError
            && error.code === "contract_validation_error";
          await logOnePromptVideo("aliyun.storyboard.shot_decomposer.segment.retry", {
            segmentNo: segment.segmentNo,
            stage,
            attempt,
            nextAttempt,
            delayMs,
            error: errorForLog(error),
          }, "warn");
          await reportPlannerProgress({
            stage: "shot_decomposer",
            completedSteps: params.baseCompletedSteps + decomposedSegments + completedSegments,
            totalSteps,
            currentSegmentNo: segment.segmentNo,
            completedSegments,
            totalSegments: timelineSegments.length,
            attempt: nextAttempt,
            detailZh: isContractRetry
              ? `第 ${segment.segmentNo} 段的视频提示合同不合规，正在把校验错误反馈给规划模型并请求重新输出。`
              : `第 ${segment.segmentNo} 段上游请求失败，${Math.round(delayMs / 1000)} 秒后进行第 ${nextAttempt} 次尝试。`,
            detailEn: isContractRetry
              ? `Segment ${segment.segmentNo} returned an invalid video prompt contract. The validation error is being sent back to the planning model for a complete replacement.`
              : `Segment ${segment.segmentNo} failed upstream. Attempt ${nextAttempt} starts in ${Math.round(delayMs / 1000)}s; ${completedSegments}/${timelineSegments.length} segments are complete.`,
          });
        },
      });
      params.checkpoint.shotDecomposerSegmentPlans = {
        ...(params.checkpoint.shotDecomposerSegmentPlans ?? {}),
        [checkpointKey]: plan,
      };
      await savePlannerCheckpoint(params.checkpoint, params.onCheckpoint);
    } else {
      await logOnePromptVideo("aliyun.storyboard.shot_decomposer.segment.checkpoint_reused", {
        segmentNo: segment.segmentNo,
        stage,
      });
    }
    assertShotPlanVideoPromptContract(plan, segment.segmentNo);
    await logOnePromptVideo("aliyun.storyboard.shot_decomposer.segment.parsed", {
      segmentNo: segment.segmentNo,
      keyframeCount: arrayOfRecords(plan.keyframes).length,
      segmentCount: arrayOfRecords(plan.segments).length,
      renderDescriptionCount: arrayOfRecords(plan.segment_render_descriptions ?? plan.segmentRenderDescriptions).length,
    });
    decomposedSegments += 1;
    await reportPlannerProgress({
      stage: "shot_decomposer",
      completedSteps: params.baseCompletedSteps + decomposedSegments + completedSegments,
      totalSteps,
      currentSegmentNo: segment.segmentNo,
      completedSegments,
      totalSegments: timelineSegments.length,
      detailZh: `第 ${segment.segmentNo} 段拆解完成，正在进行本段一镜到底审计和提示词编译；已有 ${completedSegments}/${timelineSegments.length} 段完成全流程。`,
      detailEn: `Segment ${segment.segmentNo} is decomposed. Auditing and compiling prompts now; ${completedSegments}/${timelineSegments.length} segments have completed the full pipeline.`,
    });
    let approvedPlan = params.checkpoint.approvedShotDecomposerSegmentPlans?.[checkpointKey];
    if (!approvedPlan) {
      try {
        approvedPlan = await repairShotDecomposerPlanUntilSingleTake({
          input: params.input,
          modelName: params.modelName,
          planningManifest: params.planningManifest,
          storyboardArtistPlan: params.storyboardArtistPlan,
          storyDesignContext: params.storyDesignContext,
          shotDecomposerPlan: plan,
          expectedSegmentNos: [segment.segmentNo],
        });
      } catch (error) {
        if (error instanceof TimelineReplanRequiredError) {
          return {
            status: "timeline_replan_required",
            request: error.request,
          };
        }
        throw error;
      }
      params.checkpoint.approvedShotDecomposerSegmentPlans = {
        ...(params.checkpoint.approvedShotDecomposerSegmentPlans ?? {}),
        [checkpointKey]: approvedPlan,
      };
      await savePlannerCheckpoint(params.checkpoint, params.onCheckpoint);
    } else {
      await logOnePromptVideo("aliyun.storyboard.single_take.segment.checkpoint_reused", {
        segmentNo: segment.segmentNo,
      });
    }
    assertShotPlanVideoPromptContract(approvedPlan, segment.segmentNo);

    let promptDetailPlan = params.checkpoint.promptDetailSegmentPlans?.[checkpointKey];
    if (!promptDetailPlan) {
      const promptDetailRaw = await executeStructuredStage({
        stage: `prompt_detailer_s${segment.segmentNo}`,
        modelName: params.modelName,
        systemPrompt: PROMPT_DETAILER_SEGMENT_SYSTEM_PROMPT,
        userContent: buildPromptDetailerSegmentContent({
          ...params,
          segment,
          approvedSegmentPlan: approvedPlan,
        }),
        temperature: 0.22,
      });
      promptDetailPlan = normalizePromptDetailPlan(promptDetailRaw);
      params.checkpoint.promptDetailSegmentPlans = {
        ...(params.checkpoint.promptDetailSegmentPlans ?? {}),
        [checkpointKey]: promptDetailPlan,
      };
      await savePlannerCheckpoint(params.checkpoint, params.onCheckpoint);
    } else {
      await logOnePromptVideo("aliyun.storyboard.prompt_detailer.segment.checkpoint_reused", {
        segmentNo: segment.segmentNo,
      });
    }

    completedSegments += 1;
    await reportPlannerProgress({
      stage: "prompt_detailer",
      completedSteps: params.baseCompletedSteps + decomposedSegments + completedSegments,
      totalSteps,
      currentSegmentNo: segment.segmentNo,
      completedSegments,
      totalSegments: timelineSegments.length,
      detailZh: `第 ${segment.segmentNo} 段已完成拆解、审计和提示词编译；全流程完成 ${completedSegments}/${timelineSegments.length} 段。`,
      detailEn: `Segment ${segment.segmentNo} completed decomposition, audit, and prompt compilation; ${completedSegments}/${timelineSegments.length} segment pipelines are complete.`,
    });
      return { status: "completed", shotDecomposerPlan: approvedPlan, promptDetailPlan };
    },
  );

  const timelineChangeRequests = segmentResults.flatMap((result) =>
    result.status === "timeline_replan_required" ? [result.request] : []);
  if (timelineChangeRequests.length) {
    throw new TimelineReplanRequiredError(
      combineTimelineChangeRequests(timelineChangeRequests),
    );
  }
  const completedSegmentResults = segmentResults.filter(
    (result): result is Extract<SegmentShotPipelineResult, { status: "completed" }> =>
      result.status === "completed",
  );

  const merged = mergeShotDecomposerSegmentPlans({
    storyboardArtistPlan: params.storyboardArtistPlan,
    planningManifest: params.planningManifest,
    segmentPlans: completedSegmentResults.map((result) => result.shotDecomposerPlan),
  });
  const mergedPromptDetailPlan = completedSegmentResults.reduce<VideoPromptDetailPlan>(
    (current, result) => result.promptDetailPlan
      ? mergePromptDetailPlans(current, result.promptDetailPlan)
      : current,
    {},
  );
  await logOnePromptVideo("aliyun.storyboard.shot_decomposer.segmented.merged", {
    segmentCount: arrayOfRecords(merged.segments).length,
    keyframeCount: arrayOfRecords(merged.keyframes).length,
    renderDescriptionCount: arrayOfRecords(merged.segment_render_descriptions ?? merged.segmentRenderDescriptions).length,
  });
  if (clearPlannerCheckpointFailureAfterStageSuccess(params.checkpoint, [
    "shot_decomposer",
    "single_take_audit",
    "prompt_detailer",
  ])) {
    await savePlannerCheckpoint(params.checkpoint, params.onCheckpoint);
  }
  return {
    shotDecomposerPlan: merged,
    promptDetailPlan: mergedPromptDetailPlan,
  };
}

function assertShotPlanVideoPromptContract(
  plan: Record<string, unknown>,
  segmentNo: number,
  allowedEvidence?: TerminalEvidenceCatalogItem[],
): void {
  const descriptions = arrayOfRecords(
    plan.segment_render_descriptions ?? plan.segmentRenderDescriptions,
  );
  const description = descriptions.find(
    (item) => numberFrom(item.segmentNo ?? item.segment_no) === segmentNo,
  );
  if (!description) {
    throw new Error(`segment_render_descriptions is missing segment ${segmentNo}.`);
  }
  const contract = videoPromptContractFromUnknown(description);
  if (!contract) {
    throw new Error(`segment ${segmentNo} is missing video_prompt_contract.`);
  }
  if (allowedEvidence) {
    const allowed = new Set(
      allowedEvidence.map((item) => `${item.type}:${item.id}`),
    );
    const rawContract = isRecord(description.videoPromptContract)
      ? description.videoPromptContract
      : isRecord(description.video_prompt_contract)
        ? description.video_prompt_contract
        : {};
    const rawRequirements = arrayOfRecords(
      rawContract.terminalRequirements ?? rawContract.terminal_requirements,
    );
    rawRequirements.forEach((requirement, requirementIndex) => {
      const rawRefs = requirement.evidenceRefs ?? requirement.evidence_refs;
      // Existing checkpoints created before evidence_refs remain readable. New
      // strict-schema responses always enter this branch and are fully checked.
      if (rawRefs === undefined && requirement.source !== undefined) return;
      const refs = arrayOfRecords(rawRefs);
      refs.forEach((ref, evidenceIndex) => {
        const key = `${stringOr(ref.type, "")}:${stringOr(ref.id, "")}`;
        if (!allowed.has(key)) {
          throw new Error(
            `segment ${segmentNo} terminal requirement ${requirementIndex + 1} evidence_refs[${evidenceIndex}] `
            + `"${key}" does not exist in allowed_terminal_evidence.`,
          );
        }
      });
    });
  }
  validateVideoPromptContract(contract);
}

type TerminalEvidenceCatalogItem = {
  type: "user_input" | "story_contract" | "approved_end_frame" | "planner_artifact";
  id: string;
  label: string;
};

function buildTerminalEvidenceCatalog(params: {
  input: PlanVideoProjectInput;
  planningManifest: VideoPlanningManifest;
  storyboardArtistPlan: Record<string, unknown>;
  storyDesignContext: Record<string, unknown>;
  segment: VideoTimelineBlueprintSegment;
}): TerminalEvidenceCatalogItem[] {
  const segmentNo = params.segment.segmentNo;
  const storyboardBrief = arrayOfRecords(
    readLoose(params.storyboardArtistPlan, "storyboardBrief", "storyboard_brief"),
  );
  const targetBrief = storyboardBrief.find(
    (item) => numberFrom(item.segmentNo ?? item.segment_no) === segmentNo,
  ) ?? {};
  const cameraId = safeId(targetBrief.cameraId ?? targetBrief.camera_id, "");
  const storyBeats = arrayOfRecords(
    readLoose(params.storyboardArtistPlan, "storyBeats", "story_beats")
    ?? params.storyDesignContext.story_beats,
  );
  const linkedBeatIds = new Set(
    normalizeStringArray(targetBrief.linkedBeatIds ?? targetBrief.linked_beat_ids) ?? [],
  );
  const targetBeats = storyBeats.filter((beat) => {
    const beatId = safeId(beat.beatId ?? beat.beat_id, "");
    return linkedBeatIds.has(beatId)
      || normalizeNumberArray(beat.targetSegmentNos ?? beat.target_segment_nos).includes(segmentNo);
  });
  const refs: TerminalEvidenceCatalogItem[] = [{
    type: "user_input",
    id: "user_prompt",
    label: "The user's original request.",
  }, {
    type: "approved_end_frame",
    id: `keyframe:${segmentNo + 1}`,
    label: `The reviewed semantic end-boundary contract for segment ${segmentNo}.`,
  }, {
    type: "planner_artifact",
    id: `segment:${segmentNo}`,
    label: `The approved timeline contract for segment ${segmentNo}.`,
  }];
  if (cameraId) {
    refs.push({
      type: "planner_artifact",
      id: `camera:${cameraId}`,
      label: `The camera-graph node assigned to segment ${segmentNo}.`,
    });
  }
  for (const beat of targetBeats) {
    const beatId = safeId(beat.beatId ?? beat.beat_id, "");
    if (beatId) {
      refs.push({
        type: "story_contract",
        id: `beat:${beatId}`,
        label: "A validated story beat assigned to this segment.",
      });
    }
    for (const eventId of normalizeStringArray(beat.sourceEventIds ?? beat.source_event_ids) ?? []) {
      refs.push({
        type: "story_contract",
        id: `event:${eventId}`,
        label: "A validated narrative event supporting this segment.",
      });
    }
  }
  for (const anchorId of normalizeStringArray(
    targetBrief.requiredAnchorIds ?? targetBrief.required_anchor_ids,
  ) ?? []) {
    refs.push({
      type: "story_contract",
      id: `anchor:${anchorId}`,
      label: "A consistency anchor required by the approved story contract.",
    });
  }
  return Array.from(
    new Map(refs.map((item) => [`${item.type}:${item.id}`, item])).values(),
  );
}

function storyboardWithoutFinalTransitions(
  storyboardArtistPlan: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized = { ...storyboardArtistPlan };
  delete sanitized.finalTransitionPlan;
  delete sanitized.final_transition_plan;
  return sanitized;
}

function buildShotDecomposerSegmentContent(params: {
  input: PlanVideoProjectInput;
  planningManifest: VideoPlanningManifest;
  storyboardArtistPlan: Record<string, unknown>;
  storyDesignContext: Record<string, unknown>;
  segment: VideoTimelineBlueprintSegment;
}): string {
  const segmentNo = params.segment.segmentNo;
  const timelineSegments = params.planningManifest.timelineBlueprint.segments;
  const adjacentTimelineSegments = timelineSegments.filter((item) => Math.abs(item.segmentNo - segmentNo) <= 1);
  const storyboardBrief = arrayOfRecords(readLoose(params.storyboardArtistPlan, "storyboardBrief", "storyboard_brief"));
  const targetStoryboardBrief = storyboardBrief.find((item) => numberFrom(item.segmentNo ?? item.segment_no) === segmentNo) ?? {};
  const adjacentStoryboardBrief = storyboardBrief.filter((item) => Math.abs(numberFrom(item.segmentNo ?? item.segment_no) - segmentNo) <= 1);
  const storyBeats = arrayOfRecords(readLoose(params.storyboardArtistPlan, "storyBeats", "story_beats") ?? params.storyDesignContext.story_beats);
  const targetStoryBeats = storyBeats.filter((item) => {
    const segmentNos = normalizeNumberArray(item.targetSegmentNos ?? item.target_segment_nos);
    const linkedBeatIds = normalizeStringArray(targetStoryboardBrief.linkedBeatIds ?? targetStoryboardBrief.linked_beat_ids) ?? [];
    const beatId = safeId(item.beatId ?? item.beat_id, "");
    return segmentNos.includes(segmentNo) || (beatId && linkedBeatIds.includes(beatId));
  });
  const shotGroupingGroups = arrayOfRecords(readLoose(isRecord(params.storyDesignContext.shot_grouping_pass) ? params.storyDesignContext.shot_grouping_pass : {}, "groups", "groups"))
    .concat(arrayOfRecords(readLoose(isRecord(readLoose(params.storyboardArtistPlan, "shotGroupingPass", "shot_grouping_pass")) ? readLoose(params.storyboardArtistPlan, "shotGroupingPass", "shot_grouping_pass") as Record<string, unknown> : {}, "groups", "groups")));
  const targetShotGroup = shotGroupingGroups.find((group) => normalizeNumberArray(group.segmentNos ?? group.segment_nos).includes(segmentNo)) ?? {};
  const allowedTerminalEvidence = buildTerminalEvidenceCatalog(params);

  return JSON.stringify({
    user_idea: params.input.userPrompt,
    aspect_ratio: params.input.aspectRatio,
    duration_seconds: params.input.durationSeconds,
    target_segment_no: segmentNo,
    total_segment_count: timelineSegments.length,
    planning_manifest_summary: {
      project_intent: params.planningManifest.projectIntent,
      story_strategy: params.planningManifest.storyStrategy,
      subtitle_policy: params.planningManifest.subtitlePolicy,
      global_style: params.planningManifest.globalStyle,
      risks: params.planningManifest.risks,
      timeline_blueprint: {
        segment_count: params.planningManifest.timelineBlueprint.segmentCount,
        total_duration_seconds: params.planningManifest.timelineBlueprint.totalDurationSeconds,
        split_strategy_zh: params.planningManifest.timelineBlueprint.splitStrategyZh,
        target_segment: params.segment,
        adjacent_segments: adjacentTimelineSegments,
      },
      consistency_manifest: params.planningManifest.consistencyManifest,
    },
    story_design_context: {
      creative_strategy: params.storyDesignContext.creative_strategy,
      narrative_micro_rules: params.storyDesignContext.narrative_micro_rules,
      target_story_beats: targetStoryBeats,
      target_shot_group: targetShotGroup,
    },
    storyboard_context: {
      title: params.storyboardArtistPlan.title,
      logline: params.storyboardArtistPlan.logline,
      style_bible: readLoose(params.storyboardArtistPlan, "styleBible", "style_bible"),
      target_storyboard_brief: targetStoryboardBrief,
      adjacent_storyboard_brief: adjacentStoryboardBrief,
      camera_graph: readLoose(params.storyboardArtistPlan, "cameraGraph", "camera_graph"),
      target_story_beats: targetStoryBeats,
      target_shot_group: targetShotGroup,
    },
    allowed_terminal_evidence: allowedTerminalEvidence,
    edit_boundary_policy: {
      owner: "final_compositor",
      executable_by_video_model: false,
      instruction: "Do not invent, copy, or paraphrase inter-segment edit transitions.",
    },
    output_contract: {
      only_target_segment: true,
      segment_no: segmentNo,
      start_keyframe_no: segmentNo,
      end_keyframe_no: segmentNo + 1,
      required_arrays: ["segment_render_descriptions", "segments", "keyframes"],
      keyframes_to_return: [segmentNo, segmentNo + 1],
    },
  });
}

function buildPromptDetailerSegmentContent(params: {
  input: PlanVideoProjectInput;
  planningManifest: VideoPlanningManifest;
  storyboardArtistPlan: Record<string, unknown>;
  storyDesignContext: Record<string, unknown>;
  segment: VideoTimelineBlueprintSegment;
  approvedSegmentPlan: Record<string, unknown>;
}): string {
  const segmentNo = params.segment.segmentNo;
  const storyboardBrief = arrayOfRecords(readLoose(params.storyboardArtistPlan, "storyboardBrief", "storyboard_brief"));
  const targetStoryboardBrief = storyboardBrief.find((item) => numberFrom(item.segmentNo ?? item.segment_no) === segmentNo) ?? {};
  const storyBeats = arrayOfRecords(readLoose(params.storyboardArtistPlan, "storyBeats", "story_beats") ?? params.storyDesignContext.story_beats);
  const linkedBeatIds = normalizeStringArray(targetStoryboardBrief.linkedBeatIds ?? targetStoryboardBrief.linked_beat_ids) ?? [];
  const targetStoryBeats = storyBeats.filter((item) => {
    const targetSegmentNos = normalizeNumberArray(item.targetSegmentNos ?? item.target_segment_nos);
    const beatId = safeId(item.beatId ?? item.beat_id, "");
    return targetSegmentNos.includes(segmentNo) || (beatId && linkedBeatIds.includes(beatId));
  });
  const ownedKeyframeNos = segmentNo === 1 ? [1, 2] : [segmentNo + 1];

  return JSON.stringify({
    user_idea: params.input.userPrompt,
    aspect_ratio: params.input.aspectRatio,
    duration_seconds: params.input.durationSeconds,
    target_segment_no: segmentNo,
    owned_keyframe_nos: ownedKeyframeNos,
    target_timeline_segment: params.segment,
    consistency_manifest: params.planningManifest.consistencyManifest,
    global_style: params.planningManifest.globalStyle,
    subtitle_policy: params.planningManifest.subtitlePolicy,
    storyboard_context: {
      target_storyboard_brief: targetStoryboardBrief,
      target_story_beats: targetStoryBeats,
      camera_graph: readLoose(params.storyboardArtistPlan, "cameraGraph", "camera_graph"),
    },
    edit_boundary_policy: {
      owner: "final_compositor",
      executable_by_video_model: false,
    },
    approved_segment_plan: params.approvedSegmentPlan,
    output_contract: {
      only_target_segment: true,
      target_segment_no: segmentNo,
      owned_keyframe_nos: ownedKeyframeNos,
    },
  });
}

function mergeShotDecomposerSegmentPlans(params: {
  storyboardArtistPlan: Record<string, unknown>;
  planningManifest: VideoPlanningManifest;
  segmentPlans: Record<string, unknown>[];
}): Record<string, unknown> {
  const renderDescriptions = uniqueRecordsByNumber(
    params.segmentPlans.flatMap((plan) => arrayOfRecords(plan.segment_render_descriptions ?? plan.segmentRenderDescriptions)),
    ["segmentNo", "segment_no"],
  );
  const segments = uniqueRecordsByNumber(
    params.segmentPlans.flatMap((plan) => arrayOfRecords(plan.segments)),
    ["segmentNo", "segment_no"],
  );
  const keyframes = uniqueRecordsByNumber(
    params.segmentPlans.flatMap((plan) => arrayOfRecords(plan.keyframes)),
    ["keyframeNo", "keyframe_no"],
  );
  const consistencyReferences = params.segmentPlans.flatMap((plan) => arrayOfRecords(plan.consistency_references ?? plan.consistencyReferences));

  return {
    title: stringOr(params.storyboardArtistPlan.title, ""),
    logline: stringOr(params.storyboardArtistPlan.logline, ""),
    style_bible: readLoose(params.storyboardArtistPlan, "styleBible", "style_bible") ?? {},
    consistency_references: consistencyReferences,
    segment_render_descriptions: renderDescriptions,
    keyframes,
    segments,
    segment_decomposition_mode: "per_segment",
    segment_decomposition_count: params.planningManifest.timelineBlueprint.segments.length,
  };
}

function uniqueRecordsByNumber(items: Record<string, unknown>[], keyNames: string[]): Record<string, unknown>[] {
  const byNumber = new Map<number, Record<string, unknown>>();
  for (const item of items) {
    const n = numberFrom(firstDefined(...keyNames.map((key) => item[key])));
    if (!n) continue;
    const current = byNumber.get(n);
    byNumber.set(n, current ? mergeRecordPreferExisting(current, item) : item);
  }
  return Array.from(byNumber.entries())
    .sort(([a], [b]) => a - b)
    .map(([, item]) => item);
}

function mergeRecordPreferExisting(existing: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(next)) {
    const current = merged[key];
    if (current === undefined || current === null || current === "") {
      merged[key] = value;
    } else if (isRecord(current) && isRecord(value)) {
      merged[key] = mergeRecordPreferExisting(current, value);
    }
  }
  return merged;
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let firstError: unknown;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < items.length && firstError === undefined) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        if (firstError === undefined) firstError = error;
      }
    }
  }));
  if (firstError !== undefined) throw firstError;
  return results;
}

function mergeStage2Plans(storyboardArtistPlan: Record<string, unknown>, shotDecomposerPlan: Record<string, unknown>): Record<string, unknown> {
  return {
    ...storyboardArtistPlan,
    ...shotDecomposerPlan,
    title: stringOr(shotDecomposerPlan.title, stringOr(storyboardArtistPlan.title, "")),
    logline: stringOr(shotDecomposerPlan.logline, stringOr(storyboardArtistPlan.logline, "")),
    style_bible: isRecord(shotDecomposerPlan.style_bible)
      ? shotDecomposerPlan.style_bible
      : isRecord(shotDecomposerPlan.styleBible)
        ? shotDecomposerPlan.styleBible
        : isRecord(storyboardArtistPlan.style_bible)
          ? storyboardArtistPlan.style_bible
          : storyboardArtistPlan.styleBible,
    storyboard_brief: readLoose(storyboardArtistPlan, "storyboardBrief", "storyboard_brief") ?? [],
    story_beats: readLoose(storyboardArtistPlan, "storyBeats", "story_beats") ?? [],
    shot_grouping_pass: readLoose(storyboardArtistPlan, "shotGroupingPass", "shot_grouping_pass") ?? {},
    story_quality_report: readLoose(storyboardArtistPlan, "storyQualityReport", "story_quality_report") ?? {},
    camera_graph: readLoose(storyboardArtistPlan, "cameraGraph", "camera_graph") ?? {},
    final_transition_plan: readLoose(storyboardArtistPlan, "finalTransitionPlan", "final_transition_plan") ?? [],
    segment_render_descriptions: readLoose(shotDecomposerPlan, "segmentRenderDescriptions", "segment_render_descriptions") ?? [],
    keyframes: readLoose(shotDecomposerPlan, "keyframes", "keyframes") ?? [],
    segments: readLoose(shotDecomposerPlan, "segments", "segments") ?? [],
    consistency_references: readLoose(shotDecomposerPlan, "consistencyReferences", "consistency_references") ?? [],
  };
}

async function rewriteStoryPlanUntilQualityPass(params: {
  input: PlanVideoProjectInput;
  modelName: string;
  planningRaw?: unknown;
  planningManifest: VideoPlanningManifest;
  fallback: OnePromptVideoPlan;
  storyboardPlan: Record<string, unknown>;
  promptDetailPlan: VideoPromptDetailPlan;
  plan: OnePromptVideoPlan;
  rolloutConfig: OnePromptVideoStoryRolloutConfig;
}): Promise<{
  plan: OnePromptVideoPlan;
  storyboardPlan: Record<string, unknown>;
  promptDetailPlan: VideoPromptDetailPlan;
}> {
  let currentPlan = params.plan;
  let currentStoryboardPlan = params.storyboardPlan;
  let currentPromptDetailPlan = params.promptDetailPlan;
  const maxAttempts = Math.min(MAX_STORY_QUALITY_REWRITES, params.rolloutConfig.storyRewriteMax);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const decision = decideStoryRewrite(currentPlan.storyQualityReport);
    await logOnePromptVideo("story_quality_rewrite.decision", {
      attempt,
      shouldRewrite: decision.shouldRewrite,
      stage: decision.stage,
      score: decision.score,
      riskScores: decision.riskScores,
      hardIssueCodes: decision.hardIssueCodes,
      reasons: decision.reasons,
      issueCodes: currentPlan.storyQualityReport?.issueCodes ?? [],
    }, decision.shouldRewrite ? "warn" : "info");
    if (!decision.shouldRewrite) {
      return {
        plan: {
          ...currentPlan,
          storyQualityReport: {
            ...(currentPlan.storyQualityReport ?? {}),
            rewriteRequired: false,
            autoRewriteAttempts: attempt,
            rewriteReasons: [],
            rewriteFromStage: "none",
          },
        },
        storyboardPlan: currentStoryboardPlan,
        promptDetailPlan: currentPromptDetailPlan,
      };
    }

    const repairPlan = buildModelRepairPlan({
      targetStage: "story_quality_rewrite",
      issues: (
        decision.hardIssueCodes.length
          ? decision.hardIssueCodes
          : decision.reasons.length
            ? decision.reasons
            : ["STORY_QUALITY_REWRITE_REQUIRED"]
      ).map(
        (code, index) => ({
          code,
          path: decision.stage === "creative_strategy"
            ? "creative_strategy"
            : decision.stage === "beat_sheet"
              ? "story_beats"
              : "storyboard_brief",
          message: decision.reasons[index] ?? code,
          repairHint: `Repair the ${decision.stage} quality issue and regenerate only its explicitly dependent downstream story fields.`,
        }),
      ),
      scope: { kind: "document" },
      preserveRules: [
        "Preserve planning timeline, segment count, segment times, consistency anchors, global style, and valid upstream story fields.",
        `Rewrite only ${decision.stage} and fields explicitly downstream from that stage.`,
      ],
    });
    const rewriteRaw = await executeStructuredStage({
      stage: `story_quality_rewrite_${attempt + 1}_${decision.stage}`,
      modelName: params.modelName,
      systemPrompt: `${STORY_QUALITY_REWRITE_SYSTEM_PROMPT}${STRUCTURED_REPAIR_EXECUTION_RULES}`,
      userContent: buildStoryQualityRewriteContent({
        input: params.input,
        planningManifest: params.planningManifest,
        storyboardPlan: currentStoryboardPlan,
        promptDetailPlan: currentPromptDetailPlan,
        plan: currentPlan,
        decision,
        attempt: attempt + 1,
        maxAttempts,
        repairPlan,
      }),
      temperature: 0.22,
    });
    const applied = applyStoryQualityRewrite({
      stage: decision.stage,
      storyboardPlan: currentStoryboardPlan,
      promptDetailPlan: currentPromptDetailPlan,
      rewriteRaw,
    });
    currentStoryboardPlan = applied.storyboardPlan;
    currentPromptDetailPlan = applied.promptDetailPlan;
    currentPlan = withStoryQualityGate(buildThreeStagePlan({
      input: params.input,
      fallback: params.fallback,
      planningRaw: params.planningRaw,
      planningManifest: params.planningManifest,
      storyboardPlan: currentStoryboardPlan,
      promptDetailPlan: currentPromptDetailPlan,
      shotGroupingEnabled: shouldEnableShotGrouping(params.rolloutConfig),
    }));
    currentPlan = {
      ...currentPlan,
      storyQualityReport: {
        ...(currentPlan.storyQualityReport ?? {}),
        autoRewriteAttempts: attempt + 1,
        rewriteReasons: decideStoryRewrite(currentPlan.storyQualityReport).reasons,
      },
      plannerWarnings: uniqueStrings([
        ...(currentPlan.plannerWarnings ?? []),
        `story quality rewrite attempt ${attempt + 1} from ${decision.stage}: ${decision.reasons.join("; ")}`,
      ]),
    };
    await logOnePromptVideo("story_quality_rewrite.result", {
      attempt: attempt + 1,
      fromStage: decision.stage,
      rewriteNotes: applied.rewriteNotes,
      score: currentPlan.storyQualityReport?.score,
      issueCodes: currentPlan.storyQualityReport?.issueCodes ?? [],
    }, decideStoryRewrite(currentPlan.storyQualityReport).shouldRewrite ? "warn" : "info");
  }

  const finalDecision = decideStoryRewrite(currentPlan.storyQualityReport);
  if (!finalDecision.shouldRewrite) {
    return { plan: currentPlan, storyboardPlan: currentStoryboardPlan, promptDetailPlan: currentPromptDetailPlan };
  }
  return {
    plan: finalizeStoryQualityRollout(currentPlan, params.rolloutConfig, maxAttempts, finalDecision),
    storyboardPlan: currentStoryboardPlan,
    promptDetailPlan: currentPromptDetailPlan,
  };
}

function applyStoryQualityGateForRollout(
  plan: OnePromptVideoPlan,
  _config: OnePromptVideoStoryRolloutConfig,
): OnePromptVideoPlan {
  return withStoryQualityGate(plan);
}

function finalizeStoryQualityRollout(
  plan: OnePromptVideoPlan,
  config: OnePromptVideoStoryRolloutConfig,
  attempts: number,
  decision: StoryRewriteDecision,
): OnePromptVideoPlan {
  if (!shouldEvaluateStoryQuality(config)) return plan;
  if (decision.shouldRewrite && shouldRequireStoryQualityReview(config)) {
    return markStoryRewriteRequired(plan, attempts, decision);
  }
  return {
    ...plan,
    storyQualityReport: {
      ...(plan.storyQualityReport ?? {}),
      rewriteRequired: false,
      autoRewriteAttempts: attempts,
      rewriteReasons: decision.shouldRewrite ? decision.reasons : [],
      rewriteFromStage: decision.shouldRewrite ? decision.stage : "none",
    },
  };
}

function buildStoryQualityRewriteContent(params: {
  input: PlanVideoProjectInput;
  planningManifest: VideoPlanningManifest;
  storyboardPlan: Record<string, unknown>;
  promptDetailPlan: VideoPromptDetailPlan;
  plan: OnePromptVideoPlan;
  decision: StoryRewriteDecision;
  attempt: number;
  maxAttempts: number;
  repairPlan: ModelRepairPlan;
}): string {
  return JSON.stringify({
    user_idea: params.input.userPrompt,
    aspect_ratio: params.input.aspectRatio,
    duration_seconds: params.input.durationSeconds,
    rewrite_from_stage: params.decision.stage,
    attempt: params.attempt,
    max_attempts: params.maxAttempts,
    story_quality_report: params.plan.storyQualityReport,
    rewrite_reasons: params.decision.reasons,
    repair_plan: params.repairPlan,
    planning_manifest: params.planningManifest,
    current_story_design: {
      creative_strategy: params.plan.creativeStrategy,
      story_beats: params.plan.storyBeats,
      narrative_micro_rules: params.plan.narrativeMicroRules,
      shot_grouping_pass: params.plan.shotGroupingPass,
    },
    current_storyboard_plan: params.storyboardPlan,
    current_prompt_detail_plan: params.promptDetailPlan,
    current_normalized_plan_summary: {
      title: params.plan.title,
      logline: params.plan.logline,
      segments: params.plan.segments.map((segment) => ({
        segment_no: segment.segmentNo,
        start_time_seconds: segment.startTimeSeconds,
        end_time_seconds: segment.endTimeSeconds,
        duration_seconds: segment.durationSeconds,
        linked_beat_ids: segment.linkedBeatIds,
        story_function: segment.storyFunction,
        purpose: segment.purpose,
        cause: segment.cause,
        effect: segment.effect,
        information_unit: segment.informationUnit,
        key_evidence_ids: segment.keyEvidenceIds,
        depends_on_beat_ids: segment.dependsOnBeatIds,
        evidence_from_beat_ids: segment.evidenceFromBeatIds,
        resolves_conflict_beat_id: segment.resolvesConflictBeatId,
        action_continuity: segment.actionContinuity,
        reaction_beat: segment.reactionBeat,
        power_shift: segment.powerShift,
      })),
    },
    hard_constraints: {
      preserve_timeline_segment_count: params.planningManifest.timelineBlueprint.segmentCount,
      preserve_segment_times: params.planningManifest.timelineBlueprint.segments,
      preserve_consistency_anchors: params.planningManifest.consistencyManifest.anchors,
    },
  });
}

function applyStoryQualityRewrite(params: {
  stage: StoryRewriteDecision["stage"];
  storyboardPlan: Record<string, unknown>;
  promptDetailPlan: VideoPromptDetailPlan;
  rewriteRaw: unknown;
}): {
  storyboardPlan: Record<string, unknown>;
  promptDetailPlan: VideoPromptDetailPlan;
  rewriteNotes: string[];
} {
  const root = unwrapPlanRoot(params.rewriteRaw, "story_quality_rewrite_plan");
  const nextStoryboardPlan = { ...params.storyboardPlan };
  nextStoryboardPlan.story_quality_report = {};
  nextStoryboardPlan.storyQualityReport = {};
  const allowCreative = params.stage === "creative_strategy";
  const allowBeats = allowCreative || params.stage === "beat_sheet";
  const allowStoryboard = allowBeats || params.stage === "storyboard" || params.stage === "shot_grouping";
  if (allowCreative && isRecord(readLoose(root, "creativeStrategy", "creative_strategy"))) {
    nextStoryboardPlan.creative_strategy = readLoose(root, "creativeStrategy", "creative_strategy");
    nextStoryboardPlan.creativeStrategy = readLoose(root, "creativeStrategy", "creative_strategy");
  }
  if (allowBeats && Array.isArray(readLoose(root, "storyBeats", "story_beats"))) {
    nextStoryboardPlan.story_beats = readLoose(root, "storyBeats", "story_beats");
    nextStoryboardPlan.storyBeats = readLoose(root, "storyBeats", "story_beats");
  }
  if ((allowBeats || params.stage === "shot_grouping") && isRecord(readLoose(root, "shotGroupingPass", "shot_grouping_pass"))) {
    nextStoryboardPlan.shot_grouping_pass = readLoose(root, "shotGroupingPass", "shot_grouping_pass");
    nextStoryboardPlan.shotGroupingPass = readLoose(root, "shotGroupingPass", "shot_grouping_pass");
  }
  if (allowStoryboard) {
    for (const [camelKey, snakeKey] of [
      ["storyboardBrief", "storyboard_brief"],
      ["segmentRenderDescriptions", "segment_render_descriptions"],
      ["keyframes", "keyframes"],
      ["segments", "segments"],
    ] as const) {
      const value = readLoose(root, camelKey, snakeKey);
      if (Array.isArray(value)) {
        nextStoryboardPlan[snakeKey] = value;
        nextStoryboardPlan[camelKey] = value;
      }
    }
  }
  const promptDetailRaw = readLoose(root, "promptDetailPlan", "prompt_detail_plan");
  const nextPromptDetailPlan = isRecord(promptDetailRaw)
    ? mergePromptDetailPlans(params.promptDetailPlan, normalizePromptDetailPlan({ prompt_detail_plan: promptDetailRaw }))
    : params.promptDetailPlan;
  return {
    storyboardPlan: nextStoryboardPlan,
    promptDetailPlan: nextPromptDetailPlan,
    rewriteNotes: normalizeStringArray(readLoose(root, "rewriteNotes", "rewrite_notes")) ?? [],
  };
}

function mergePromptDetailPlans(base: VideoPromptDetailPlan, patch: VideoPromptDetailPlan): VideoPromptDetailPlan {
  return {
    keyframePrompts: mergeByNumber(base.keyframePrompts ?? [], patch.keyframePrompts ?? [], "keyframeNo"),
    segmentVideoPrompts: mergeByNumber(base.segmentVideoPrompts ?? [], patch.segmentVideoPrompts ?? [], "segmentNo"),
    microShotImagePrompts: mergeByTwoNumbers(base.microShotImagePrompts ?? [], patch.microShotImagePrompts ?? [], "segmentNo", "microShotNo"),
    negativePromptGroups: patch.negativePromptGroups ?? base.negativePromptGroups,
    generationNotes: uniqueStrings([...(base.generationNotes ?? []), ...(patch.generationNotes ?? [])]),
  };
}

function mergeByNumber<T extends Record<K, number>, K extends keyof T>(base: T[], patch: T[], key: K): T[] {
  const map = new Map<number, T>();
  for (const item of base) map.set(Number(item[key]), item);
  for (const item of patch) map.set(Number(item[key]), { ...(map.get(Number(item[key])) ?? {} as T), ...item });
  return Array.from(map.values()).sort((a, b) => Number(a[key]) - Number(b[key]));
}

function mergeByTwoNumbers<T extends Record<K1 | K2, number>, K1 extends keyof T, K2 extends keyof T>(base: T[], patch: T[], key1: K1, key2: K2): T[] {
  const keyFor = (item: T) => `${Number(item[key1])}:${Number(item[key2])}`;
  const map = new Map<string, T>();
  for (const item of base) map.set(keyFor(item), item);
  for (const item of patch) map.set(keyFor(item), { ...(map.get(keyFor(item)) ?? {} as T), ...item });
  return Array.from(map.values()).sort((a, b) => Number(a[key1]) - Number(b[key1]) || Number(a[key2]) - Number(b[key2]));
}

function buildSplitRepairContent(params: {
  input: PlanVideoProjectInput;
  planningManifest: VideoPlanningManifest;
  storyboardArtistPlan: Record<string, unknown>;
  storyDesignContext: Record<string, unknown>;
  shotDecomposerPlan: Record<string, unknown>;
  expectedSegmentNos: number[];
  auditIssues: unknown[];
  repairPlan: ModelRepairPlan;
  revision: number;
  maxRevisions: number;
}): string {
  const targeted = params.expectedSegmentNos.length > 0
    && params.expectedSegmentNos.length < params.planningManifest.timelineBlueprint.segments.length;
  if (!targeted) {
    return JSON.stringify({
      user_idea: params.input.userPrompt,
      aspect_ratio: params.input.aspectRatio,
      duration_seconds: params.input.durationSeconds,
      planning_manifest: params.planningManifest,
      story_design_context: params.storyDesignContext,
      storyboard_artist_plan: storyboardWithoutFinalTransitions(params.storyboardArtistPlan),
      shot_decomposer_plan: params.shotDecomposerPlan,
      allowed_terminal_evidence: params.planningManifest.timelineBlueprint.segments
        .filter((segment) => params.expectedSegmentNos.includes(segment.segmentNo))
        .flatMap((segment) => buildTerminalEvidenceCatalog({ ...params, segment })),
      edit_boundary_policy: {
        owner: "final_compositor",
        executable_by_video_model: false,
      },
      repair_scope: "whole_plan",
      target_segment_nos: params.expectedSegmentNos,
      single_take_audit_issues: params.auditIssues,
      repair_plan: params.repairPlan,
      revision: params.revision,
      max_revisions: params.maxRevisions,
    });
  }

  const targets = new Set(params.expectedSegmentNos);
  const storyboardBrief = arrayOfRecords(readLoose(params.storyboardArtistPlan, "storyboardBrief", "storyboard_brief"))
    .filter((item) => targets.has(numberFrom(item.segmentNo ?? item.segment_no)));
  const storyBeats = arrayOfRecords(readLoose(params.storyboardArtistPlan, "storyBeats", "story_beats"))
    .filter((item) => normalizeNumberArray(item.targetSegmentNos ?? item.target_segment_nos).some((segmentNo) => targets.has(segmentNo)));
  return JSON.stringify({
    user_idea: params.input.userPrompt,
    aspect_ratio: params.input.aspectRatio,
    duration_seconds: params.input.durationSeconds,
    planning_manifest: {
      project_intent: params.planningManifest.projectIntent,
      story_strategy: params.planningManifest.storyStrategy,
      global_style: params.planningManifest.globalStyle,
      consistency_manifest: params.planningManifest.consistencyManifest,
      timeline_blueprint: {
        ...params.planningManifest.timelineBlueprint,
        segments: params.planningManifest.timelineBlueprint.segments.filter((segment) => targets.has(segment.segmentNo)),
      },
    },
    story_design_context: {
      creative_strategy: params.storyDesignContext.creative_strategy,
      narrative_micro_rules: params.storyDesignContext.narrative_micro_rules,
      story_beats: storyBeats,
    },
    storyboard_artist_plan: {
      storyboard_brief: storyboardBrief,
      story_beats: storyBeats,
      camera_graph: readLoose(params.storyboardArtistPlan, "cameraGraph", "camera_graph"),
    },
    shot_decomposer_plan: params.shotDecomposerPlan,
    allowed_terminal_evidence: params.planningManifest.timelineBlueprint.segments
      .filter((segment) => targets.has(segment.segmentNo))
      .flatMap((segment) => buildTerminalEvidenceCatalog({ ...params, segment })),
    edit_boundary_policy: {
      owner: "final_compositor",
      executable_by_video_model: false,
    },
    repair_scope: "target_segments_only",
    target_segment_nos: params.expectedSegmentNos,
    single_take_audit_issues: params.auditIssues,
    repair_plan: params.repairPlan,
    revision: params.revision,
    max_revisions: params.maxRevisions,
  });
}

async function repairShotDecomposerPlanUntilSingleTake(params: {
  input: PlanVideoProjectInput;
  modelName: string;
  planningManifest: VideoPlanningManifest;
  storyboardArtistPlan: Record<string, unknown>;
  storyDesignContext: Record<string, unknown>;
  shotDecomposerPlan: Record<string, unknown>;
  expectedSegmentNos?: number[];
}): Promise<Record<string, unknown>> {
  let currentPlan = params.shotDecomposerPlan;
  let contractRepairApplied = false;
  let cameraGraphRepairApplied = false;
  const expectedSegmentNos = params.expectedSegmentNos
    ?? params.planningManifest.timelineBlueprint.segments.map((segment) => segment.segmentNo);
  const maxRevisions = singleTakeMaxRevisions(Boolean(params.expectedSegmentNos?.length));
  for (let revision = 0; revision <= maxRevisions; revision += 1) {
    await reportPlannerProgress({
      stage: "single_take_audit",
      attempt: revision + 1,
      detailZh: revision === 0 ? "正在检查每个片段能否一镜到底执行。" : `正在复核第 ${revision} 轮一镜到底修复结果。`,
      detailEn: revision === 0 ? "Auditing whether every segment is executable as one continuous take." : `Reviewing single-take repair round ${revision}.`,
    });
    const auditStartedAtMs = Date.now();
    const audit = auditSingleTakePlan({
      ...params.storyboardArtistPlan,
      ...currentPlan,
      durationSeconds: params.input.durationSeconds,
      cameraGraph: params.storyboardArtistPlan.cameraGraph ?? params.storyboardArtistPlan.camera_graph,
      storyboardBrief: params.storyboardArtistPlan.storyboardBrief ?? params.storyboardArtistPlan.storyboard_brief,
      segments: currentPlan.segments,
      segmentRenderDescriptions: currentPlan.segmentRenderDescriptions ?? currentPlan.segment_render_descriptions,
    }, expectedSegmentNos);
    await logOnePromptVideo("production.step.completed", {
      moduleNameZh: "脚本拆解",
      stepNameZh: revision === 0 ? "程序检查每个片段能否一镜到底执行" : "程序复检拆分返修结果",
      executionMethod: "deterministic_program",
      durationMs: Date.now() - auditStartedAtMs,
      passed: audit.passed,
      attempt: revision + 1,
      resultZh: audit.passed ? "结构可执行" : `发现 ${audit.issues.length} 个结构问题，需要返修`,
    }, audit.passed ? "info" : "warn");
    await logOnePromptVideo("single_take_audit.result", {
      revision,
      passed: audit.passed,
      action: audit.action,
      issues: audit.issues,
    }, audit.passed ? "info" : "warn");
    if (audit.passed) return currentPlan;
    if (audit.action === "replan_timeline") {
      throw new TimelineReplanRequiredError(
        createTimelineChangeRequest(audit, currentPlan),
      );
    }
    if (audit.action === "repair_contract" && !contractRepairApplied) {
      const beforeContractRepair = currentPlan;
      const repaired = repairMissingSingleTakeContracts(currentPlan, audit, expectedSegmentNos);
      contractRepairApplied = repaired.changed;
      if (repaired.changed) {
        currentPlan = repaired.plan;
        await logOnePromptVideo("deterministic_repair.change_log", {
          repairType: "single_take_missing_contract",
          executionMethod: "deterministic_program",
          changes: diffDeterministicChanges({
            before: beforeContractRepair,
            after: currentPlan,
            reasonCode: "SINGLE_TAKE_CONTRACT_MISSING",
            acceptanceCriteria: [
              "Every targeted segment has start, end, motion, and single-take contracts.",
              "The Single-Take Audit no longer reports a missing-contract issue.",
            ],
          }),
        });
        revision -= 1;
        continue;
      }
    }
    if (audit.action === "repair_contract") {
      throw new Error(singleTakeAuditErrorMessage(audit.issues));
    }
    if (audit.action === "repair_camera_graph" && !cameraGraphRepairApplied) {
      const beforeCameraGraphRepair = JSON.parse(JSON.stringify(
        params.storyboardArtistPlan.cameraGraph
        ?? params.storyboardArtistPlan.camera_graph
        ?? {},
      ));
      cameraGraphRepairApplied = repairAlternateViewCameraGraph(params.storyboardArtistPlan, audit);
      if (cameraGraphRepairApplied) {
        await logOnePromptVideo("deterministic_repair.change_log", {
          repairType: "alternate_view_camera_graph",
          executionMethod: "deterministic_program",
          changes: diffDeterministicChanges({
            before: beforeCameraGraphRepair,
            after: params.storyboardArtistPlan.cameraGraph
              ?? params.storyboardArtistPlan.camera_graph
              ?? {},
            rootPath: "$.camera_graph",
            reasonCode: "ALTERNATE_VIEW_AXIS_UNRESOLVED",
            acceptanceCriteria: [
              "Every repaired alternate-view camera has an explicit axis description and spatial layout lock.",
              "The Single-Take Audit no longer reports a camera-graph issue.",
            ],
          }),
        });
        revision -= 1;
        continue;
      }
    }
    if (audit.action === "repair_camera_graph") {
      throw new Error(singleTakeAuditErrorMessage(audit.issues));
    }
    if (revision >= maxRevisions) {
      if (auditNeedsTimelineReplan(audit, currentPlan)) {
        throw new TimelineReplanRequiredError(
          createTimelineChangeRequest(audit, currentPlan),
        );
      }
      throw new Error(singleTakeAuditErrorMessage(audit.issues));
    }

    const repairStartedAt = Date.now();
    await reportPlannerProgress({
      stage: "split_repair",
      attempt: revision + 1,
      detailZh: `一镜到底审计发现 ${audit.issues.length} 个结构问题，正在执行第 ${revision + 1} 轮拆分修复。`,
      detailEn: `Single-take audit found ${audit.issues.length} structural issue(s). Running split repair round ${revision + 1}.`,
      metricsDelta: { singleTakeRepairCount: 1 },
    });
    const repairPlan = buildModelRepairPlan({
      targetStage: "split_repair",
      issues: audit.issues,
      scope: { kind: "segments", segmentNos: expectedSegmentNos },
      preserveRules: [
        "Preserve segment count, numbers, start/end time, duration, story causality, anchors, subtitles, and audio plan.",
        "Modify only target segments and their matching segment_render_descriptions and boundary contracts.",
      ],
    });
    const repairRaw = await executeStructuredStage({
      stage: params.expectedSegmentNos?.length === 1
        ? `split_repair_s${params.expectedSegmentNos[0]}_r${revision + 1}`
        : `split_repair_${revision + 1}`,
      modelName: params.modelName,
      systemPrompt: `${SPLIT_REPAIR_SYSTEM_PROMPT}${STRUCTURED_REPAIR_EXECUTION_RULES}`,
      userContent: buildSplitRepairContent({
        ...params,
        shotDecomposerPlan: currentPlan,
        expectedSegmentNos,
        auditIssues: audit.issues,
        repairPlan,
        revision: revision + 1,
        maxRevisions,
      }),
      temperature: 0.1,
    });
    await reportPlannerProgress({
      stage: "single_take_audit",
      attempt: revision + 2,
      detailZh: `第 ${revision + 1} 轮拆分修复已完成，正在重新审计。`,
      detailEn: `Split repair round ${revision + 1} is complete. Re-running the audit.`,
      metricsDelta: { singleTakeRepairDurationMs: Date.now() - repairStartedAt },
    });
    const repairedEnvelope = isRecord(repairRaw) ? repairRaw : {};
    const repairedPlan = unwrapPlanRoot(
      isRecord(repairedEnvelope.shot_decomposer_plan) ? repairedEnvelope : repairedEnvelope.split_repair_plan,
      "shot_decomposer_plan",
    );
    const repairPatch = Object.keys(repairedPlan).length ? repairedPlan : unwrapPlanRoot(repairRaw, "shot_decomposer_plan");
    await logOnePromptVideo("split_repair.patch_fields", {
      revision: revision + 1,
      segments: arrayOfRecords(repairPatch.segments).map((segment) => ({
        segmentNo: numberFrom(segment.segmentNo ?? segment.segment_no),
        motion: segment.motion,
        subjectMotion: segment.subjectMotion ?? segment.subject_motion,
      })),
      renderDescriptions: arrayOfRecords(
        repairPatch.segmentRenderDescriptions ?? repairPatch.segment_render_descriptions,
      ).map((description) => {
        const motionContract = isRecord(description.motionContract)
          ? description.motionContract
          : isRecord(description.motion_contract)
            ? description.motion_contract
            : {};
        return {
          segmentNo: numberFrom(description.segmentNo ?? description.segment_no),
          subjectMotion: motionContract.subjectMotion ?? motionContract.subject_motion,
          motionSteps: readLoose(
            isRecord(description.videoPromptContract)
              ? description.videoPromptContract
              : isRecord(description.video_prompt_contract)
                ? description.video_prompt_contract
                : {},
            "motionSteps",
            "motion_steps",
          ),
        };
      }),
    });
    currentPlan = mergeTargetedShotDecomposerRepair(currentPlan, repairPatch, expectedSegmentNos);
    await logOnePromptVideo("split_repair.result", {
      revision: revision + 1,
      repairNotes: isRecord(repairRaw) ? repairRaw.repair_notes ?? repairRaw.repairNotes : undefined,
      segmentCount: arrayOfRecords(currentPlan.segments).length,
      renderDescriptionCount: arrayOfRecords(currentPlan.segment_render_descriptions ?? currentPlan.segmentRenderDescriptions).length,
    });
  }
  return currentPlan;
}

export function repairMissingSingleTakeContracts(
  shotDecomposerPlan: Record<string, unknown>,
  audit: SingleTakeAuditResult,
  expectedSegmentNos: number[],
): { plan: Record<string, unknown>; changed: boolean } {
  const repairableSegments = new Set(
    audit.issues
      .filter((issue) => issue.severity === "error" && issue.repairScope === "contract")
      .map((issue) => issue.segmentNo)
      .filter((segmentNo): segmentNo is number =>
        typeof segmentNo === "number" && expectedSegmentNos.includes(segmentNo)),
  );
  if (!repairableSegments.size) return { plan: shotDecomposerPlan, changed: false };

  const segments = arrayOfRecords(shotDecomposerPlan.segments);
  const sourceDescriptions = arrayOfRecords(
    shotDecomposerPlan.segmentRenderDescriptions ?? shotDecomposerPlan.segment_render_descriptions,
  );
  const descriptionsBySegment = new Map(
    sourceDescriptions.map((description) => [
      numberFrom(description.segmentNo ?? description.segment_no),
      description,
    ]),
  );
  let changed = false;

  for (const segmentNo of repairableSegments) {
    const segment = segments.find(
      (item) => numberFrom(item.segmentNo ?? item.segment_no) === segmentNo,
    ) ?? {};
    const description = descriptionsBySegment.get(segmentNo) ?? { segment_no: segmentNo };
    const next = { ...description };
    const motionText = stringOr(
      segment.subjectMotion ?? segment.subject_motion ?? segment.motion,
      "continuous visible motion from the approved start boundary to the approved end boundary",
    );
    const purposeText = stringOr(
      segment.purposeZh ?? segment.purpose_zh ?? segment.purpose ?? segment.purposeEn ?? segment.purpose_en,
      `segment ${segmentNo} approved boundary state`,
    );

    if (!isRecord(next.startFrameContract) && !isRecord(next.start_frame_contract)) {
      next.start_frame_contract = {
        state: `Approved start boundary for ${purposeText}`,
        source: "segment_boundary_contract_repair",
      };
      changed = true;
    }
    if (!isRecord(next.endFrameContract) && !isRecord(next.end_frame_contract)) {
      next.end_frame_contract = {
        state: `Approved end boundary for ${purposeText}`,
        source: "segment_boundary_contract_repair",
      };
      changed = true;
    }
    if (!isRecord(next.motionContract) && !isRecord(next.motion_contract)) {
      next.motion_contract = {
        subject_motion: motionText,
        source: "existing_segment_motion",
      };
      changed = true;
    }
    if (!isRecord(next.singleTakeContract) && !isRecord(next.single_take_contract)) {
      next.single_take_contract = {
        requires_cut: false,
        risk_level: "unknown",
        subject_path: motionText,
        source: "existing_segment_contract",
      };
      changed = true;
    }
    descriptionsBySegment.set(segmentNo, next);
  }

  if (!changed) return { plan: shotDecomposerPlan, changed: false };
  const descriptions = Array.from(descriptionsBySegment.entries())
    .filter(([segmentNo]) => segmentNo > 0)
    .sort(([left], [right]) => left - right)
    .map(([, description]) => description);
  const plan: Record<string, unknown> = {
    ...shotDecomposerPlan,
    segment_render_descriptions: descriptions,
  };
  delete plan.segmentRenderDescriptions;
  return { plan, changed: true };
}

export function repairAlternateViewCameraGraph(
  storyboardArtistPlan: Record<string, unknown>,
  audit: SingleTakeAuditResult,
): boolean {
  const cameraIds = new Set(
    audit.issues
      .filter((issue) => issue.severity === "error" && issue.repairScope === "camera_graph")
      .map((issue) => issue.cameraId)
      .filter((cameraId): cameraId is string => Boolean(cameraId)),
  );
  if (!cameraIds.size) return false;

  const graphKey = isRecord(storyboardArtistPlan.cameraGraph) ? "cameraGraph" : "camera_graph";
  const graph = isRecord(storyboardArtistPlan[graphKey])
    ? storyboardArtistPlan[graphKey] as Record<string, unknown>
    : {};
  const camerasKey = Array.isArray(graph.cameras) ? "cameras" : "nodes";
  const cameras = arrayOfRecords(graph[camerasKey]);
  const byId = new Map(cameras.map((camera) => [
    stringOr(camera.cameraId ?? camera.camera_id ?? camera.id, ""),
    camera,
  ]));
  let changed = false;
  const repairedCameras = cameras.map((camera) => {
    const cameraId = stringOr(camera.cameraId ?? camera.camera_id ?? camera.id, "");
    if (!cameraIds.has(cameraId)) return camera;
    const parentId = stringOr(camera.parentCameraId ?? camera.parent_camera_id, "");
    const parent = byId.get(parentId);
    const parentAxis = stringOr(parent?.axisDescription ?? parent?.axis_description, "");
    const parentLayout = stringOr(parent?.spatialLayoutLock ?? parent?.spatial_layout_lock, "");
    const next = { ...camera };

    if (!stringOr(camera.axisDescription ?? camera.axis_description, "") && parentAxis) {
      const key = "axisDescription" in camera ? "axisDescription" : "axis_description";
      next[key] = parentAxis;
      changed = true;
    }
    if (!stringOr(camera.spatialLayoutLock ?? camera.spatial_layout_lock, "") && parentLayout) {
      const key = "spatialLayoutLock" in camera ? "spatialLayoutLock" : "spatial_layout_lock";
      next[key] = parentLayout;
      changed = true;
    }
    return next;
  });
  if (!changed) return false;

  storyboardArtistPlan[graphKey] = {
    ...graph,
    [camerasKey]: repairedCameras,
  };
  return true;
}

function auditNeedsTimelineReplan(
  audit: SingleTakeAuditResult,
  shotDecomposerPlan: Record<string, unknown>,
): boolean {
  if (audit.issues.some(
    (issue) => issue.severity === "error"
      && issue.structural
      && issue.repairScope === "timeline",
  )) {
    return true;
  }
  return arrayOfRecords(
    shotDecomposerPlan.segmentRenderDescriptions ?? shotDecomposerPlan.segment_render_descriptions,
  ).some((description) => [
    description.timelineChangeRequest,
    description.timeline_change_request,
    description.recommendedSplit,
    description.recommended_split,
  ].some(hasMeaningfulTimelineChangeDirective));
}

export function hasMeaningfulTimelineChangeDirective(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.some(hasMeaningfulTimelineChangeDirective);
  if (isRecord(value)) {
    return Object.values(value).some(hasMeaningfulTimelineChangeDirective);
  }
  return false;
}

const LOCALLY_REPAIRABLE_FINAL_PROMPT_CODES = new Set([
  "INTERNAL_CUT_LANGUAGE",
  "BOUNDARY_TRANSITION_LEAKED_INTO_SEGMENT",
  "MOTION_CHECKPOINT_CONTAINS_CUT",
]);

export function locallyRepairableFinalPromptSegmentNos(
  issues: PlanValidationIssue[],
): number[] {
  return [...new Set(issues.flatMap((issue) => {
    if (
      issue.severity !== "error"
      || !LOCALLY_REPAIRABLE_FINAL_PROMPT_CODES.has(issue.code)
    ) return [];
    const match = /^segment:(\d+)$/.exec(issue.artifactId ?? "");
    return match ? [Number(match[1])] : [];
  }))].sort((left, right) => left - right);
}

export function createTimelineChangeRequest(
  audit: SingleTakeAuditResult,
  shotDecomposerPlan: Record<string, unknown>,
): TimelineChangeRequest {
  const timelineIssues = audit.issues.filter(
    (issue) => issue.severity === "error" && issue.repairScope === "timeline",
  );
  const affectedSegmentNos = Array.from(new Set(
    timelineIssues
      .map((issue) => issue.segmentNo)
      .filter((segmentNo): segmentNo is number => typeof segmentNo === "number" && segmentNo > 0),
  )).sort((left, right) => left - right);
  const fallbackSegmentNos = audit.auditedSegmentNos.filter((segmentNo) => segmentNo > 0);
  const targets = affectedSegmentNos.length ? affectedSegmentNos : fallbackSegmentNos;
  const descriptions = arrayOfRecords(
    shotDecomposerPlan.segmentRenderDescriptions ?? shotDecomposerPlan.segment_render_descriptions,
  );
  const requestedChanges = targets.flatMap((segmentNo) => {
    const description = descriptions.find(
      (item) => numberFrom(item.segmentNo ?? item.segment_no) === segmentNo,
    );
    if (!description) return [];
    return [
      description.timelineChangeRequest ?? description.timeline_change_request,
      description.recommendedSplit ?? description.recommended_split,
    ].filter((value) => value !== undefined && value !== null);
  });
  let issueCodes = uniqueStrings(
    timelineIssues.map((issue) => issue.code),
  );
  let reasons = uniqueStrings(
    timelineIssues.map((issue) => issue.reason),
  );
  if (!issueCodes.length && requestedChanges.length) {
    issueCodes = ["TIMELINE_SPLIT_DIRECTIVE"];
    reasons = ["single_take_repair_exhausted_with_explicit_split_directive"];
  }
  const firstAffectedSegmentNo = Math.max(1, Math.min(...(targets.length ? targets : [1])));
  const requestSeed = JSON.stringify({
    affectedSegmentNos: targets,
    issueCodes,
    reasons,
    requestedChanges,
  });
  return {
    requestId: `timeline_${createHash("sha256").update(requestSeed).digest("hex").slice(0, 12)}`,
    source: "single_take_audit",
    changeType: "split_segment",
    affectedSegmentNos: targets,
    firstAffectedSegmentNo,
    issueCodes,
    reasons,
    requestedChanges,
  };
}

function combineTimelineChangeRequests(requests: TimelineChangeRequest[]): TimelineChangeRequest {
  const affectedSegmentNos = Array.from(new Set(
    requests.flatMap((request) => request.affectedSegmentNos),
  )).sort((left, right) => left - right);
  const issueCodes = uniqueStrings(requests.flatMap((request) => request.issueCodes));
  const reasons = uniqueStrings(requests.flatMap((request) => request.reasons));
  const requestedChanges = requests.flatMap((request) => request.requestedChanges);
  const requestSeed = JSON.stringify({ affectedSegmentNos, issueCodes, reasons, requestedChanges });
  return {
    requestId: `timeline_${createHash("sha256").update(requestSeed).digest("hex").slice(0, 12)}`,
    source: "single_take_audit",
    changeType: "split_segment",
    affectedSegmentNos,
    firstAffectedSegmentNo: Math.max(1, Math.min(...(affectedSegmentNos.length ? affectedSegmentNos : [1]))),
    issueCodes,
    reasons,
    requestedChanges,
  };
}

export function timelineChangeRequestRepairIssues(request: TimelineChangeRequest): Array<{
  code: string;
  path: string;
  message: string;
  repairHint: string;
  segmentNo: number;
}> {
  const codes = request.issueCodes.length
    ? request.issueCodes
    : ["TIMELINE_SPLIT_DIRECTIVE"];
  return codes.map((code, index) => ({
    code,
    path: `planning_manifest.timeline_blueprint.segments[segment_no>=${request.firstAffectedSegmentNo}]`,
    message: request.reasons[index]
      ?? request.reasons[0]
      ?? `Segment ${request.firstAffectedSegmentNo} requires an explicit timeline split.`,
    repairHint: "Split the affected event range at a real discontinuity boundary and recompute only the affected suffix timing.",
    segmentNo: request.affectedSegmentNos[index]
      ?? request.affectedSegmentNos[0]
      ?? request.firstAffectedSegmentNo,
  }));
}

export function mergeTargetedShotDecomposerRepair(
  basePlan: Record<string, unknown>,
  repairPatch: Record<string, unknown>,
  targetSegmentNos: number[],
): Record<string, unknown> {
  const targets = new Set(targetSegmentNos);
  const mergeNumberedRecords = (
    baseValue: unknown,
    patchValue: unknown,
    keyNames: string[],
    restrictToTargets: boolean,
  ): Record<string, unknown>[] => {
    const map = new Map<number, Record<string, unknown>>();
    for (const item of arrayOfRecords(baseValue)) {
      const itemNo = numberFrom(firstDefined(...keyNames.map((key) => item[key])));
      if (itemNo) map.set(itemNo, item);
    }
    for (const item of arrayOfRecords(patchValue)) {
      const itemNo = numberFrom(firstDefined(...keyNames.map((key) => item[key])));
      if (!itemNo || (restrictToTargets && targets.size && !targets.has(itemNo))) continue;
      map.set(itemNo, { ...(map.get(itemNo) ?? {}), ...item });
    }
    return Array.from(map.entries())
      .sort(([left], [right]) => left - right)
      .map(([, item]) => item);
  };

  const merged: Record<string, unknown> = { ...basePlan };
  merged.segments = mergeNumberedRecords(basePlan.segments, repairPatch.segments, ["segmentNo", "segment_no"], true);
  const allowedKeyframeNos = new Set(
    [...targets].flatMap((segmentNo) => [segmentNo, segmentNo + 1]),
  );
  const scopedKeyframePatch = arrayOfRecords(repairPatch.keyframes).filter((keyframe) =>
    allowedKeyframeNos.has(numberFrom(keyframe.keyframeNo ?? keyframe.keyframe_no)));
  merged.keyframes = mergeNumberedRecords(
    basePlan.keyframes,
    scopedKeyframePatch,
    ["keyframeNo", "keyframe_no"],
    false,
  );
  merged.segment_render_descriptions = mergeNumberedRecords(
    basePlan.segmentRenderDescriptions ?? basePlan.segment_render_descriptions,
    repairPatch.segmentRenderDescriptions ?? repairPatch.segment_render_descriptions,
    ["segmentNo", "segment_no"],
    true,
  );
  const patchedSegments = new Map(
    arrayOfRecords(repairPatch.segments).flatMap((item) => {
      const segmentNo = numberFrom(item.segmentNo ?? item.segment_no);
      return segmentNo ? [[segmentNo, item] as const] : [];
    }),
  );
  merged.segment_render_descriptions = arrayOfRecords(merged.segment_render_descriptions).map((description) => {
    const segmentNo = numberFrom(description.segmentNo ?? description.segment_no);
    const patchedSegment = patchedSegments.get(segmentNo);
    if (!patchedSegment) return description;
    const repairedSubjectMotion = stringOr(patchedSegment.subjectMotion ?? patchedSegment.subject_motion, "");
    const repairedMotion = stringOr(patchedSegment.motion, repairedSubjectMotion);
    const authoritativeMotion = repairedMotion || repairedSubjectMotion;
    if (!repairedSubjectMotion && !repairedMotion) return description;

    const motionContractKey = isRecord(description.motionContract) ? "motionContract" : "motion_contract";
    const motionContract = isRecord(description[motionContractKey]) ? description[motionContractKey] as Record<string, unknown> : {};
    const singleTakeContractKey = isRecord(description.singleTakeContract) ? "singleTakeContract" : "single_take_contract";
    const singleTakeContract = isRecord(description[singleTakeContractKey]) ? description[singleTakeContractKey] as Record<string, unknown> : {};
    const videoPromptContractKey = isRecord(description.videoPromptContract) ? "videoPromptContract" : "video_prompt_contract";
    const videoPromptContract = isRecord(description[videoPromptContractKey]) ? description[videoPromptContractKey] as Record<string, unknown> : {};

    return {
      ...description,
      [motionContractKey]: {
        ...motionContract,
        [("subjectMotion" in motionContract) ? "subjectMotion" : "subject_motion"]: authoritativeMotion,
      },
      [singleTakeContractKey]: {
        ...singleTakeContract,
        [("subjectPath" in singleTakeContract) ? "subjectPath" : "subject_path"]: authoritativeMotion,
      },
      [videoPromptContractKey]: {
        ...videoPromptContract,
        [("motionSteps" in videoPromptContract) ? "motionSteps" : "motion_steps"]: [authoritativeMotion],
      },
    };
  });
  delete merged.segmentRenderDescriptions;
  return merged;
}

function singleTakeAuditErrorMessage(issues: Array<{ segmentNo?: number; reason?: string }>): string {
  const summary = issues.slice(0, 5).map((issue) => {
    const segmentNo = typeof issue.segmentNo === "number" ? `镜头 ${issue.segmentNo}` : "某个镜头";
    const reason = typeof issue.reason === "string" ? issue.reason : "single_take_audit_failed";
    return `${segmentNo}: ${reason}`;
  }).join("；");
  return `一镜到底审计未通过，已阻止进入视频生成。${summary || "请简化动作、补充产品路径或拆分高风险镜头。"}`;
}


function buildThreeStagePlan(params: {
  input: PlanVideoProjectInput;
  fallback: OnePromptVideoPlan;
  planningRaw?: unknown;
  planningManifest: VideoPlanningManifest;
  storyboardPlan: unknown;
  promptDetailPlan: VideoPromptDetailPlan;
  shotGroupingEnabled?: boolean;
}): OnePromptVideoPlan {
  const source = isRecord(params.storyboardPlan) ? params.storyboardPlan : {};
  const extras = normalizePlanStructureExtras({
    planningRaw: params.planningRaw,
    storyboardPlan: params.storyboardPlan,
    promptDetailPlan: params.promptDetailPlan,
    manifest: params.planningManifest,
    shotGroupingEnabled: params.shotGroupingEnabled,
  });
  const promptDetails = params.promptDetailPlan;
  const styleBible = normalizeStyleBible(source.styleBible ?? source.style_bible, params.planningManifest, params.fallback.styleBible);
  const timeline = params.planningManifest.timelineBlueprint;
  const keyframePromptMap = new Map((promptDetails.keyframePrompts ?? []).map((item) => [item.keyframeNo, item]));
  const segmentPromptMap = new Map((promptDetails.segmentVideoPrompts ?? []).map((item) => [item.segmentNo, item]));
  const microPromptMap = new Map((promptDetails.microShotImagePrompts ?? []).map((item) => [`${item.segmentNo}:${item.microShotNo}`, item]));
  const keyframesRaw = arrayOfRecords(source.keyframes);
  const segmentsRaw = arrayOfRecords(source.segments);
  const keyframeCount = timeline.segments.length + 1;
  const boundaryTimes = [0, ...timeline.segments.map((segment) => segment.endTimeSeconds)];
  const storyWarnings = [...extras.warnings];

  const keyframes: VideoPlanKeyframe[] = Array.from({ length: keyframeCount }, (_, index) => {
    const keyframeNo = index + 1;
    const sourceFrame = keyframesRaw.find((item) => numberFrom(item.keyframeNo ?? item.keyframe_no) === keyframeNo) ?? keyframesRaw[index] ?? {};
    const fallbackFrame = params.fallback.keyframes[index] ?? params.fallback.keyframes[params.fallback.keyframes.length - 1];
    const detail = keyframePromptMap.get(keyframeNo);
    const declaredAnchorIds = normalizeStringArray(sourceFrame.usesConsistencyAnchors ?? sourceFrame.uses_consistency_anchors) ?? [];
    const boundaryTarget = targetForKeyframe(extras.assetContract, keyframeNo);
    const derivedAnchorIds = uniqueStrings([
      ...anchorsForBoundary(params.planningManifest, keyframeNo),
      ...(boundaryTarget?.derivedAnchorIds ?? []),
    ]);
    const anchors = effectiveAnchorIdsForChild(
      uniqueStrings([...declaredAnchorIds, ...derivedAnchorIds]),
      boundaryTarget,
      boundaryTarget?.excludedAnchors,
    );
    const negative = flattenNegative(sourceFrame.negativePrompt ?? sourceFrame.negative_prompt) || styleBible.negativePrompt;
    return {
      keyframeNo,
      frameId: stringOr(sourceFrame.frameId ?? sourceFrame.frame_id, `kf_${String(keyframeNo).padStart(2, "0")}`),
      frameRole: normalizeFrameRole(sourceFrame.frameRole ?? sourceFrame.frame_role, keyframeNo, keyframeCount),
      timeSeconds: boundaryTimes[index] ?? params.input.durationSeconds,
      purpose: stringOr(sourceFrame.purposeZh ?? sourceFrame.purpose_zh ?? sourceFrame.purpose, fallbackFrame.purpose),
      purposeZh: stringOr(sourceFrame.purposeZh ?? sourceFrame.purpose_zh ?? sourceFrame.purpose, fallbackFrame.purposeZh ?? fallbackFrame.purpose),
      purposeEn: stringOr(sourceFrame.purposeEn ?? sourceFrame.purpose_en, fallbackFrame.purposeEn ?? ""),
      scene: stringOr(sourceFrame.scene, fallbackFrame.scene),
      characterState: stringOr(sourceFrame.characterState ?? sourceFrame.character_state, fallbackFrame.characterState),
      productState: stringOr(sourceFrame.productState ?? sourceFrame.product_state, fallbackFrame.productState),
      frameDesign: isRecord(sourceFrame.frameDesign) ? sourceFrame.frameDesign as VideoPlanKeyframe["frameDesign"] : isRecord(sourceFrame.frame_design) ? sourceFrame.frame_design as VideoPlanKeyframe["frameDesign"] : fallbackFrame.frameDesign,
      imagePrompt: stringOr(detail?.imagePromptEn ?? sourceFrame.imagePromptEn ?? sourceFrame.image_prompt_en ?? sourceFrame.imagePrompt ?? sourceFrame.image_prompt, fallbackFrame.imagePromptEn ?? fallbackFrame.imagePrompt),
      imagePromptZh: stringOr(detail?.imagePromptZh ?? sourceFrame.imagePromptZh ?? sourceFrame.image_prompt_zh, fallbackFrame.imagePromptZh ?? fallbackFrame.imagePrompt),
      imagePromptEn: stringOr(detail?.imagePromptEn ?? sourceFrame.imagePromptEn ?? sourceFrame.image_prompt_en, fallbackFrame.imagePromptEn ?? fallbackFrame.imagePrompt),
      negativePromptGroups: isRecord(sourceFrame.negativePrompt ?? sourceFrame.negative_prompt) ? sourceFrame.negativePrompt as VideoPlanKeyframe["negativePromptGroups"] : fallbackFrame.negativePromptGroups,
      negativePrompt: negative,
      negativePromptZh: stringOr(detail?.negativePromptZh ?? sourceFrame.negativePromptZh ?? sourceFrame.negative_prompt_zh, fallbackFrame.negativePromptZh ?? negative),
      negativePromptEn: stringOr(detail?.negativePromptEn ?? sourceFrame.negativePromptEn ?? sourceFrame.negative_prompt_en, fallbackFrame.negativePromptEn ?? negative),
      declaredAnchorIds,
      derivedAnchorIds,
      effectiveRequiredAnchorIds: anchors,
      excludedAnchors: boundaryTarget?.excludedAnchors ?? [],
      usesConsistencyAnchors: anchors,
    };
  });

  const segments: VideoPlanSegment[] = timeline.segments.map((timelineSegment, index) => {
    const segmentNo = timelineSegment.segmentNo;
    const sourceSegment = segmentsRaw.find((item) => numberFrom(item.segmentNo ?? item.segment_no) === segmentNo) ?? segmentsRaw[index] ?? {};
    const fallbackSegment = params.fallback.segments[index] ?? params.fallback.segments[params.fallback.segments.length - 1];
    const detail = segmentPromptMap.get(segmentNo);
    const declaredAnchorIds = normalizeStringArray(sourceSegment.usesConsistencyAnchors ?? sourceSegment.uses_consistency_anchors) ?? [];
    const segmentTarget = targetForSegment(extras.assetContract, segmentNo);
    const derivedAnchorIds = uniqueStrings([
      ...(timelineSegment.requiredAnchorIds ?? []),
      ...(segmentTarget?.derivedAnchorIds ?? []),
    ]);
    const anchors = effectiveAnchorIdsForChild(
      uniqueStrings([...declaredAnchorIds, ...derivedAnchorIds]),
      segmentTarget,
      segmentTarget?.excludedAnchors,
    );
    const negative = flattenNegative(sourceSegment.negativePrompt ?? sourceSegment.negative_prompt) || styleBible.negativePrompt;
    const storyboardBrief = extras.storyboardBrief.find((brief) => brief.segmentNo === segmentNo);
    const storyTrace = normalizeSegmentStoryTrace({
      sourceSegment,
      timelineSegment,
      storyboardBrief,
      storyBeats: extras.storyBeats,
      warnings: storyWarnings,
    });
    const microShots = normalizeMicroShotsForSegment({
      value: sourceSegment.microShots ?? sourceSegment.micro_shots,
      fallback: fallbackSegment.microShots,
      segmentNo,
      startSeconds: timelineSegment.startTimeSeconds,
      durationSeconds: timelineSegment.durationSeconds,
      segmentPurpose: stringOr(sourceSegment.purposeZh ?? sourceSegment.purpose_zh ?? sourceSegment.purpose, timelineSegment.purposeZh ?? fallbackSegment.purpose),
      segmentCamera: stringOr(sourceSegment.camera, fallbackSegment.camera),
      anchorIds: anchors,
      microPromptMap,
    });
    const videoPromptZh = enforceSingleTakeVideoPrompt(
      stringOr(detail?.videoPromptZh ?? sourceSegment.videoPromptZh ?? sourceSegment.video_prompt_zh, fallbackSegment.videoPromptZh ?? fallbackSegment.videoPrompt),
      "zh",
    );
    const videoPromptEn = enforceSingleTakeVideoPrompt(
      stringOr(detail?.videoPromptEn ?? sourceSegment.videoPromptEn ?? sourceSegment.video_prompt_en, fallbackSegment.videoPromptEn ?? fallbackSegment.videoPrompt),
      "en",
    );
    return {
      segmentNo,
      startKeyframeNo: segmentNo,
      endKeyframeNo: segmentNo + 1,
      startTimeSeconds: timelineSegment.startTimeSeconds,
      endTimeSeconds: timelineSegment.endTimeSeconds,
      durationSeconds: timelineSegment.durationSeconds,
      boundaryMode: normalizeBoundaryMode(sourceSegment.boundaryMode ?? sourceSegment.boundary_mode) ?? timelineSegment.boundaryModeHint ?? fallbackSegment.boundaryMode ?? "continuous",
      purpose: stringOr(sourceSegment.purposeZh ?? sourceSegment.purpose_zh ?? sourceSegment.purpose, timelineSegment.purposeZh ?? fallbackSegment.purpose),
      purposeZh: stringOr(sourceSegment.purposeZh ?? sourceSegment.purpose_zh ?? sourceSegment.purpose, timelineSegment.purposeZh ?? fallbackSegment.purposeZh ?? fallbackSegment.purpose),
      purposeEn: stringOr(sourceSegment.purposeEn ?? sourceSegment.purpose_en, timelineSegment.purposeEn ?? fallbackSegment.purposeEn ?? ""),
      motion: stringOr(sourceSegment.motion, fallbackSegment.motion),
      camera: stringOr(sourceSegment.camera ?? sourceSegment.camera_movement, fallbackSegment.camera),
      subjectMotion: stringOr(sourceSegment.subjectMotion ?? sourceSegment.subject_motion, fallbackSegment.subjectMotion),
      environmentMotion: stringOr(sourceSegment.environmentMotion ?? sourceSegment.environment_motion, fallbackSegment.environmentMotion),
      videoPrompt: videoPromptEn,
      videoPromptZh,
      videoPromptEn,
      subtitle: stringOr(sourceSegment.subtitle, fallbackSegment.subtitle),
      outputMode: normalizeOutputMode(sourceSegment.outputMode ?? sourceSegment.output_mode) ?? fallbackSegment.outputMode ?? "mixed",
      ...storyTrace,
      constraints: normalizeConstraintArray(sourceSegment.constraints) ?? fallbackSegment.constraints,
      timedPrompts: fallbackSegment.timedPrompts,
      microShots,
      audioPlan: normalizeAudioPlan(sourceSegment.audioPlan ?? sourceSegment.audio_plan, fallbackSegment.audioPlan),
      negativePrompt: negative,
      negativePromptZh: stringOr(detail?.negativePromptZh ?? sourceSegment.negativePromptZh ?? sourceSegment.negative_prompt_zh, fallbackSegment.negativePromptZh ?? negative),
      negativePromptEn: stringOr(detail?.negativePromptEn ?? sourceSegment.negativePromptEn ?? sourceSegment.negative_prompt_en, fallbackSegment.negativePromptEn ?? negative),
      declaredAnchorIds,
      derivedAnchorIds,
      effectiveRequiredAnchorIds: anchors,
      excludedAnchors: segmentTarget?.excludedAnchors ?? [],
      usesConsistencyAnchors: anchors,
    };
  });

  const consistencyReferences = anchorsToConsistencyReferences(params.planningManifest, styleBible);
  const plan: OnePromptVideoPlan = {
    title: stringOr(source.title, params.fallback.title),
    logline: stringOr(source.logline, params.fallback.logline),
    durationSeconds: params.input.durationSeconds,
    aspectRatio: params.input.aspectRatio,
    keyframeCount: keyframes.length,
    segmentCount: segments.length,
    styleBible,
    planningManifest: params.planningManifest,
    consistencyManifest: params.planningManifest.consistencyManifest,
    timelineBlueprint: params.planningManifest.timelineBlueprint,
    narrativeEvents: extras.narrativeEvents,
    creativeStrategy: extras.creativeStrategy,
    storyBeats: extras.storyBeats,
    evidenceRegistry: extras.evidenceRegistry,
    assetContract: extras.assetContract,
    narrativeMicroRules: extras.narrativeMicroRules,
    shotGroupingPass: extras.shotGroupingPass,
    storyQualityReport: withStoryQualityWarnings(extras.storyQualityReport, storyWarnings),
    storySemanticReview: extras.storySemanticReview,
    anchorStateTimeline: extras.anchorStateTimeline,
    audioBible: extras.audioBible,
    candidateTimeline: extras.candidateTimeline,
    storyboardBrief: extras.storyboardBrief,
    segmentRenderDescriptions: extras.segmentRenderDescriptions,
    cameraGraph: extras.cameraGraph,
    sceneContracts: extras.sceneContracts,
    transitionReferencePlan: extras.transitionReferencePlan,
    finalTransitionPlan: extras.finalTransitionPlan,
    referenceSelectionOutputs: extras.referenceSelectionOutputs,
    promptDebugArtifacts: extras.promptDebugArtifacts,
    artifactMetadata: extras.artifactMetadata,
    generationQualityReports: extras.generationQualityReports,
    plannerWarnings: uniqueStrings(storyWarnings),
    promptDetailPlan: promptDetails,
    consistencyReferences,
    keyframes,
    segments,
  };
  plan.boundaryContracts = deriveCanonicalBoundaryContracts(plan);
  validateBoundaryContracts(plan, plan.boundaryContracts);
  plan.planningPhase = {
    semanticPlanning: "complete",
    boundaryPlanning: "semantic_draft",
    mediaConditionedPlanning: "pending_images",
    finalPromptCompilation: "deferred_to_generation",
    updatedAt: new Date().toISOString(),
  };
  return plan;
}

function normalizePlanStructureExtras(params: {
  planningRaw?: unknown;
  storyboardPlan: unknown;
  promptDetailPlan: VideoPromptDetailPlan;
  manifest: VideoPlanningManifest;
  shotGroupingEnabled?: boolean;
}): PlanStructureExtras {
  const warnings: string[] = [];
  const planningEnvelope = isRecord(params.planningRaw) ? params.planningRaw : {};
  const planningRoot = unwrapPlanRoot(params.planningRaw, "planning_manifest");
  const storyboardRoot = unwrapPlanRoot(params.storyboardPlan, "storyboard_plan");
  const promptRoot = unwrapPlanRoot(params.promptDetailPlan, "prompt_detail_plan");
  const anchorIds = new Set(params.manifest.consistencyManifest.anchors.map((anchor) => anchor.id));

  const creativeStrategy = normalizeCreativeStrategy(
    Object.keys(planningCreativeStrategySource(params.planningRaw)).length
      ? planningCreativeStrategySource(params.planningRaw)
      : firstDefined(readLoose(storyboardRoot, "creativeStrategy", "creative_strategy")),
    params.manifest,
    warnings,
  );
  const narrativeMicroRules = normalizeNarrativeMicroRules(firstDefined(
    readLoose(planningEnvelope, "narrativeMicroRules", "narrative_micro_rules"),
    readLoose(planningRoot, "narrativeMicroRules", "narrative_micro_rules"),
    readLoose(storyboardRoot, "narrativeMicroRules", "narrative_micro_rules"),
  ), warnings);
  const narrativeEvents = normalizeNarrativeEvents(
    firstDefined(
      readLoose(planningEnvelope, "narrativeEvents", "narrative_events"),
      readLoose(planningRoot, "narrativeEvents", "narrative_events"),
      readLoose(storyboardRoot, "narrativeEvents", "narrative_events"),
    ),
    { warnings, anchorIds },
  );
  const eventIds = new Set(narrativeEvents.map((event) => event.eventId));
  validateNarrativeEventReferences(narrativeEvents, warnings);
  const storyBeats = normalizeStoryBeats(
    firstDefined(
      readLoose(storyboardRoot, "storyBeats", "story_beats"),
      readLoose(planningEnvelope, "storyBeats", "story_beats"),
      readLoose(planningRoot, "storyBeats", "story_beats"),
    ),
    creativeStrategy,
    narrativeEvents,
    params.manifest.timelineBlueprint.segments,
    { warnings, anchorIds, eventIds },
  );
  const beatIds = new Set(storyBeats.map((beat) => beat.beatId));
  const evidenceRegistry = normalizeStoryEvidenceRegistry(
    readLoose(storyboardRoot, "evidenceRegistry", "evidence_registry"),
    beatIds,
    new Set(params.manifest.timelineBlueprint.segments.map((segment) => segment.segmentNo)),
    warnings,
  );
  const assetContractRaw = readLoose(storyboardRoot, "assetContract", "asset_contract");
  const assetContract = isRecord(assetContractRaw)
    ? assetContractRaw as unknown as VideoAssetContract
    : undefined;
  const shotGroupingPass = params.shotGroupingEnabled === false
    ? undefined
    : normalizeShotGroupingPass(
      firstDefined(
        readLoose(storyboardRoot, "shotGroupingPass", "shot_grouping_pass"),
        readLoose(planningEnvelope, "shotGroupingPass", "shot_grouping_pass"),
        readLoose(planningRoot, "shotGroupingPass", "shot_grouping_pass"),
      ),
      storyBeats,
      params.manifest.timelineBlueprint.segments,
      warnings,
    );
  if (params.shotGroupingEnabled === false) {
    warnings.push("shot grouping pass disabled by ONE_PROMPT_VIDEO_SHOT_GROUPING=off");
  }
  const anchorStateTimeline = normalizeAnchorStateTimeline(
    firstDefined(
      readLoose(planningEnvelope, "anchorStateTimeline", "anchor_state_timeline"),
      readLoose(planningRoot, "anchorStateTimeline", "anchor_state_timeline"),
      readLoose(storyboardRoot, "anchorStateTimeline", "anchor_state_timeline"),
    ),
    { warnings, anchorIds, eventIds },
  );
  const candidateTimeline = normalizeCandidateTimeline(
    firstDefined(
      readLoose(planningEnvelope, "candidateTimeline", "candidate_timeline"),
      readLoose(planningRoot, "candidateTimeline", "candidate_timeline"),
    ),
    params.manifest.timelineBlueprint.segments,
  );
  validateTimelineEventTrace(candidateTimeline, narrativeEvents, warnings);
  validateTimelineEventTrace(params.manifest.timelineBlueprint.segments, narrativeEvents, warnings);
  const storyboardBrief = normalizeStoryboardBrief(
    firstDefined(
      readLoose(storyboardRoot, "storyboardBrief", "storyboard_brief"),
      readLoose(storyboardRoot, "segmentsBrief", "segments_brief"),
    ),
    { warnings, anchorIds, eventIds, beatIds },
  );
  const cameraIds = new Set(storyboardBrief.map((brief) => brief.cameraId).filter(Boolean));
  const segmentRenderDescriptions = normalizeSegmentRenderDescriptions(
    firstDefined(
      readLoose(storyboardRoot, "segmentRenderDescriptions", "segment_render_descriptions"),
      readLoose(promptRoot, "segmentRenderDescriptions", "segment_render_descriptions"),
    ),
    { warnings, anchorIds },
  );
  validateSegmentRenderDescriptions(segmentRenderDescriptions, params.manifest.timelineBlueprint.segments, warnings);
  const normalizedCameraGraph = normalizeCameraGraph(
    firstDefined(
      readLoose(storyboardRoot, "cameraGraph", "camera_graph"),
      readLoose(promptRoot, "cameraGraph", "camera_graph"),
    ),
    { warnings, cameraIds },
  );
  const derivedCameraGraph = normalizedCameraGraph ?? deriveCameraGraphFromStoryboardBrief(storyboardBrief);
  const cameraGraph = derivedCameraGraph.cameras.length ? derivedCameraGraph : undefined;
  if (!normalizedCameraGraph && cameraGraph) {
    warnings.push("cameraGraph missing from Storyboard Artist; derived a conservative fallback from storyboardBrief");
  }
  const knownCameraIds = new Set([
    ...cameraIds,
    ...(cameraGraph?.cameras ?? []).map((camera) => camera.cameraId),
  ].filter(Boolean));
  for (const brief of storyboardBrief) {
    if (brief.cameraId && !knownCameraIds.has(brief.cameraId)) {
      warnings.push(`storyboardBrief segment ${brief.segmentNo} references missing camera ${brief.cameraId}`);
    }
  }
  const finalTransitionPlan = normalizeFinalTransitionPlan(
    firstDefined(
      readLoose(storyboardRoot, "finalTransitionPlan", "final_transition_plan"),
      readLoose(promptRoot, "finalTransitionPlan", "final_transition_plan"),
    ),
    { warnings, anchorIds },
  );
  const storyQualityReport = normalizeStoryQualityReport(
    firstDefined(
      readLoose(storyboardRoot, "storyQualityReport", "story_quality_report"),
      readLoose(promptRoot, "storyQualityReport", "story_quality_report"),
      readLoose(planningEnvelope, "storyQualityReport", "story_quality_report"),
    ),
    storyBeats,
    params.manifest.timelineBlueprint.segments,
    warnings,
  );
  const storySemanticReview = firstDefined(
    readLoose(storyboardRoot, "storySemanticReview", "story_semantic_review"),
    readLoose(promptRoot, "storySemanticReview", "story_semantic_review"),
  );
  return {
    narrativeEvents,
    creativeStrategy,
    storyBeats,
    evidenceRegistry,
    assetContract,
    narrativeMicroRules,
    shotGroupingPass,
    storyQualityReport,
    storySemanticReview: isRecord(storySemanticReview)
      ? storySemanticReview as unknown as VideoStorySemanticReview
      : undefined,
    anchorStateTimeline,
    audioBible: normalizeAudioBible(firstDefined(
      readLoose(planningEnvelope, "audioBible", "audio_bible"),
      readLoose(planningRoot, "audioBible", "audio_bible"),
    )),
    candidateTimeline,
    storyboardBrief,
    segmentRenderDescriptions,
    cameraGraph,
    sceneContracts: normalizeSceneContracts(
      firstDefined(
        readLoose(storyboardRoot, "sceneContracts", "scene_contracts"),
        readLoose(promptRoot, "sceneContracts", "scene_contracts"),
      ),
    ),
    transitionReferencePlan: normalizeUnknownArray(firstDefined(
      readLoose(storyboardRoot, "transitionReferencePlan", "transition_reference_plan"),
      readLoose(promptRoot, "transitionReferencePlan", "transition_reference_plan"),
    )),
    finalTransitionPlan,
    referenceSelectionOutputs: normalizeReferenceSelectionOutputs(
      firstDefined(
        readLoose(storyboardRoot, "referenceSelectionOutputs", "reference_selection_outputs"),
        readLoose(promptRoot, "referenceSelectionOutputs", "reference_selection_outputs"),
      ),
      { warnings },
    ),
    promptDebugArtifacts: normalizePromptDebugArtifacts(firstDefined(
      readLoose(storyboardRoot, "promptDebugArtifacts", "prompt_debug_artifacts"),
      readLoose(promptRoot, "promptDebugArtifacts", "prompt_debug_artifacts"),
    )),
    artifactMetadata: normalizeArtifactMetadata(firstDefined(
      readLoose(storyboardRoot, "artifactMetadata", "artifact_metadata"),
      readLoose(promptRoot, "artifactMetadata", "artifact_metadata"),
    )),
    generationQualityReports: normalizeGenerationQualityReports(firstDefined(
      readLoose(storyboardRoot, "generationQualityReports", "generation_quality_reports"),
      readLoose(promptRoot, "generationQualityReports", "generation_quality_reports"),
    )),
    warnings: uniqueStrings(warnings),
  };
}

function normalizeCreativeStrategy(value: unknown, manifest: VideoPlanningManifest, warnings: string[]): VideoCreativeStrategy {
  const raw = isRecord(value) ? value : {};
  if (!Object.keys(raw).length) warnings.push("storyDesign creativeStrategy missing; derived fallback from planning_manifest");
  const projectIntent = manifest.projectIntent ?? {};
  const storyStrategy = manifest.storyStrategy ?? {};
  const route = routeCreativeTemplate(raw, manifest, warnings);
  const definition = STORY_TEMPLATE_DEFINITIONS[route.templateId];
  const rawReturnToEventId = stringOr(raw.returnToEventId ?? raw.return_to_event_id, "");
  const chronologyPolicy = resolveChronologyHookPolicy({
    chronologyMode: normalizeChronologyMode(raw.chronologyMode ?? raw.chronology_mode),
    hookMode: normalizeHookMode(raw.hookMode ?? raw.hook_mode),
    hookRevealLevel: normalizeHookRevealLevel(raw.hookRevealLevel ?? raw.hook_reveal_level),
    requiresReturnPoint: Boolean(rawReturnToEventId),
  });
  for (const issue of chronologyPolicy.issues) warnings.push(`${issue.code}: ${issue.message}`);
  return {
    videoType: normalizeCreativeVideoType(raw.videoType ?? raw.video_type ?? projectIntent.videoType),
    videoCategory: route.videoCategory,
    templateId: route.templateId,
    templateReason: stringOr(raw.templateReason ?? raw.template_reason, ""),
    templateReasonZh: stringOr(raw.templateReasonZh ?? raw.template_reason_zh, definition.templateReasonZh),
    chronologyMode: chronologyPolicy.chronologyMode,
    hookMode: chronologyPolicy.hookMode,
    hookRevealLevel: chronologyPolicy.hookRevealLevel,
    hookEventIds: normalizeStringArray(raw.hookEventIds ?? raw.hook_event_ids) ?? [],
    conflictEventIds: normalizeStringArray(raw.conflictEventIds ?? raw.conflict_event_ids) ?? [],
    turningPointEventIds: normalizeStringArray(raw.turningPointEventIds ?? raw.turning_point_event_ids) ?? [],
    payoffEventIds: normalizeStringArray(raw.payoffEventIds ?? raw.payoff_event_ids) ?? [],
    ctaEventIds: normalizeStringArray(raw.ctaEventIds ?? raw.cta_event_ids) ?? [],
    returnToEventId: chronologyPolicy.requiresReturnPoint ? rawReturnToEventId : "",
    conversionGoal: stringOr(raw.conversionGoal ?? raw.conversion_goal, ""),
    conversionGoalZh: stringOr(raw.conversionGoalZh ?? raw.conversion_goal_zh, definition.conversionGoalZh),
    fallbackReason: stringOr(raw.fallbackReason ?? raw.fallback_reason, ""),
    fallbackReasonZh: stringOr(raw.fallbackReasonZh ?? raw.fallback_reason_zh, route.fallbackReasonZh ?? ""),
    audience: stringOr(raw.audience, ""),
    audienceZh: stringOr(raw.audienceZh ?? raw.audience_zh, projectIntent.targetViewerZh ?? ""),
    audienceEn: stringOr(raw.audienceEn ?? raw.audience_en, projectIntent.targetViewerEn ?? ""),
    corePromise: stringOr(raw.corePromise ?? raw.core_promise, ""),
    corePromiseZh: stringOr(raw.corePromiseZh ?? raw.core_promise_zh, projectIntent.primaryGoalZh ?? ""),
    corePromiseEn: stringOr(raw.corePromiseEn ?? raw.core_promise_en, projectIntent.primaryGoalEn ?? ""),
    hook: stringOr(raw.hook, ""),
    hookZh: stringOr(raw.hookZh ?? raw.hook_zh, storyStrategy.narrativeArcZh ?? ""),
    hookEn: stringOr(raw.hookEn ?? raw.hook_en, storyStrategy.narrativeArcEn ?? ""),
    conflict: stringOr(raw.conflict, ""),
    conflictZh: stringOr(raw.conflictZh ?? raw.conflict_zh, ""),
    conflictEn: stringOr(raw.conflictEn ?? raw.conflict_en, ""),
    turningPoint: stringOr(raw.turningPoint ?? raw.turning_point, ""),
    turningPointZh: stringOr(raw.turningPointZh ?? raw.turning_point_zh, ""),
    turningPointEn: stringOr(raw.turningPointEn ?? raw.turning_point_en, ""),
    payoff: stringOr(raw.payoff, ""),
    payoffZh: stringOr(raw.payoffZh ?? raw.payoff_zh, ""),
    payoffEn: stringOr(raw.payoffEn ?? raw.payoff_en, ""),
    cta: stringOr(raw.cta, ""),
    ctaZh: stringOr(raw.ctaZh ?? raw.cta_zh, ""),
    ctaEn: stringOr(raw.ctaEn ?? raw.cta_en, ""),
    emotionalArc: normalizeStringArray(raw.emotionalArc ?? raw.emotional_arc) ?? [],
    sellingPointIds: normalizeStringArray(raw.sellingPointIds ?? raw.selling_point_ids) ?? [],
    referenceUsageStrategy: stringOr(raw.referenceUsageStrategy ?? raw.reference_usage_strategy, ""),
    referenceUsageStrategyZh: stringOr(raw.referenceUsageStrategyZh ?? raw.reference_usage_strategy_zh, ""),
    risks: normalizeStringArray(raw.risks) ?? [],
    notes: normalizeStringArray(raw.notes) ?? [],
  };
}

function normalizeChronologyMode(value: unknown): NonNullable<VideoCreativeStrategy["chronologyMode"]> {
  const raw = String(value ?? "").trim();
  return raw === "flashforward_hook"
    || raw === "result_first"
    || raw === "problem_solution"
    || raw === "demonstration"
    ? raw
    : "chronological";
}

function normalizeHookMode(value: unknown): NonNullable<VideoCreativeStrategy["hookMode"]> {
  const raw = String(value ?? "").trim();
  return raw === "pain_point" || raw === "tease" || raw === "payoff_preview" ? raw : "curiosity";
}

function normalizeHookRevealLevel(value: unknown): NonNullable<VideoCreativeStrategy["hookRevealLevel"]> {
  const raw = String(value ?? "").trim();
  return raw === "none" || raw === "full" ? raw : "partial";
}

function routeCreativeTemplate(
  raw: Record<string, unknown>,
  manifest: VideoPlanningManifest,
  warnings: string[],
): { videoCategory: VideoCreativeCategory; templateId: VideoCreativeTemplateId; fallbackReasonZh?: string } {
  const requestedTemplate = normalizeCreativeTemplateId(raw.templateId ?? raw.template_id);
  const rawCategory = normalizeCreativeCategory(raw.videoCategory ?? raw.video_category);
  const videoType = normalizeCreativeVideoType(raw.videoType ?? raw.video_type ?? manifest.projectIntent?.videoType);
  const text = [
    rawCategory,
    videoType,
    raw.templateReason,
    raw.template_reason,
    raw.conversionGoal,
    raw.conversion_goal,
    raw.corePromise,
    raw.core_promise,
    raw.hook,
    raw.hook_zh,
    raw.conflict,
    raw.conflict_zh,
    raw.payoff,
    raw.payoff_zh,
    manifest.projectIntent?.videoType,
    manifest.projectIntent?.primaryGoalZh,
    manifest.projectIntent?.primaryGoalEn,
    manifest.storyStrategy?.narrativeArcZh,
    manifest.storyStrategy?.narrativeArcEn,
    ...(manifest.projectIntent?.successCriteria ?? []),
  ].filter(Boolean).join(" ").toLowerCase();
  const explicitCategory = rawCategory ?? categoryFromVideoType(videoType);
  const category = explicitCategory
    ?? (requestedTemplate ? defaultCategoryForTemplate(requestedTemplate) : classifyVideoCategoryFromText(text));
  if (requestedTemplate) {
    const resolved = resolveCategoryTemplateMapping({
      videoCategory: category,
      templateId: requestedTemplate,
      semanticText: text,
    });
    if (resolved.fallbackUsed) {
      const fallbackReasonZh = `分类与模板组合不合法，已按 ${category} 的确定性规则回退到 ${resolved.templateId}。`;
      for (const issue of resolved.issues) warnings.push(`${issue.code}: ${issue.message}`);
      return {
        videoCategory: resolved.videoCategory,
        templateId: resolved.templateId,
        fallbackReasonZh,
      };
    }
    return {
      videoCategory: resolved.videoCategory,
      templateId: resolved.templateId,
    };
  }
  const templateId = templateForCategory(category, text);
  if (templateId === "generic_brand_story" && !rawCategory && !videoType) {
    const fallbackReasonZh = "视频类型无法稳定判断，使用通用品牌故事模板，避免误套游戏、餐饮或电商语义。";
    warnings.push(`storyDesign template fallback: ${fallbackReasonZh}`);
    return { videoCategory: category, templateId, fallbackReasonZh };
  }
  return {
    videoCategory: category,
    templateId,
    fallbackReasonZh: templateId === "generic_brand_story" ? "未匹配到垂直行业模板，使用通用品牌故事模板。" : undefined,
  };
}

function normalizeNarrativeMicroRules(value: unknown, warnings: string[]): VideoNarrativeMicroRules {
  const raw = isRecord(value) ? value : {};
  if (!Object.keys(raw).length) warnings.push("storyDesign narrativeMicroRules missing; using non-blocking default rules");
  return {
    causalChainRequired: booleanOr(raw.causalChainRequired ?? raw.causal_chain_required, true),
    forbidSuddenOutcome: booleanOr(raw.forbidSuddenOutcome ?? raw.forbid_sudden_outcome, true),
    forbidReferenceOnlyAnimation: booleanOr(raw.forbidReferenceOnlyAnimation ?? raw.forbid_reference_only_animation, true),
    requireHookBeforeAssetShowcase: booleanOr(raw.requireHookBeforeAssetShowcase ?? raw.require_hook_before_asset_showcase, true),
    requirePayoffBeforeCta: booleanOr(raw.requirePayoffBeforeCta ?? raw.require_payoff_before_cta, true),
    requireReactionAfterTurningPoint: booleanOr(raw.requireReactionAfterTurningPoint ?? raw.require_reaction_after_turning_point, true),
    requireVisibleTriggerBeforeStateChange: booleanOr(raw.requireVisibleTriggerBeforeStateChange ?? raw.require_visible_trigger_before_state_change, true),
    requiredBeatFunctions: normalizeStoryFunctionArray(raw.requiredBeatFunctions ?? raw.required_beat_functions),
    forbiddenPatterns: normalizeStringArray(raw.forbiddenPatterns ?? raw.forbidden_patterns) ?? [],
    continuityRules: normalizeStringArray(raw.continuityRules ?? raw.continuity_rules) ?? [],
    ctaRules: normalizeStringArray(raw.ctaRules ?? raw.cta_rules) ?? [],
    notes: normalizeStringArray(raw.notes) ?? [],
  };
}

function normalizeStoryBeats(
  value: unknown,
  creativeStrategy: VideoCreativeStrategy,
  narrativeEvents: NarrativeEvent[],
  timelineSegments: VideoTimelineBlueprintSegment[],
  context: { warnings: string[]; anchorIds: Set<string>; eventIds: Set<string> },
): VideoStoryBeat[] {
  const records = arrayOfRecords(value);
  if (!records.length) context.warnings.push("storyDesign storyBeats missing; derived fallback beats from selected template and timeline source_event_ids");
  const sourceRecords: Record<string, unknown>[] = records.length
    ? records
    : fallbackStoryBeatRecordsForTemplate(creativeStrategy.templateId, timelineSegments);
  return sourceRecords.flatMap((item, index) => {
    const beatId = safeId(item.beatId ?? item.beat_id, `beat_${index + 1}`);
    const requiredAnchorIds = normalizeStringArray(item.requiredAnchorIds ?? item.required_anchor_ids) ?? [];
    for (const anchorId of requiredAnchorIds) {
      if (!context.anchorIds.has(anchorId)) context.warnings.push(`storyBeat ${beatId} references missing anchor ${anchorId}`);
    }
    const sourceEventIds = normalizeStringArray(item.sourceEventIds ?? item.source_event_ids) ?? [];
    for (const eventId of sourceEventIds) {
      if (context.eventIds.size && !context.eventIds.has(eventId)) context.warnings.push(`storyBeat ${beatId} references missing event ${eventId}`);
    }
    return [{
      beatId,
      order: numberFrom(item.order) || index + 1,
      title: stringOr(item.title, ""),
      titleZh: stringOr(item.titleZh ?? item.title_zh, ""),
      titleEn: stringOr(item.titleEn ?? item.title_en, ""),
      storyFunction: normalizeStoryFunction(item.storyFunction ?? item.story_function) ?? "custom",
      emotionalBeat: stringOr(item.emotionalBeat ?? item.emotional_beat, ""),
      emotionalBeatZh: stringOr(item.emotionalBeatZh ?? item.emotional_beat_zh, ""),
      emotionalBeatEn: stringOr(item.emotionalBeatEn ?? item.emotional_beat_en, ""),
      cause: stringOr(item.cause, ""),
      effect: stringOr(item.effect, ""),
      informationUnit: stringOr(item.informationUnit ?? item.information_unit, ""),
      keyEvidenceIds: normalizeStringArray(item.keyEvidenceIds ?? item.key_evidence_ids) ?? [],
      declaredAnchorIds: normalizeStringArray(item.declaredAnchorIds ?? item.declared_anchor_ids) ?? requiredAnchorIds,
      derivedAnchorIds: normalizeStringArray(item.derivedAnchorIds ?? item.derived_anchor_ids) ?? [],
      effectiveRequiredAnchorIds: normalizeStringArray(item.effectiveRequiredAnchorIds ?? item.effective_required_anchor_ids) ?? requiredAnchorIds,
      excludedAnchors: normalizeAnchorExclusions(item.excludedAnchors ?? item.anchor_exclusions),
      dependsOnBeatIds: normalizeStringArray(item.dependsOnBeatIds ?? item.depends_on_beat_ids) ?? [],
      evidenceFromBeatIds: normalizeStringArray(item.evidenceFromBeatIds ?? item.evidence_from_beat_ids) ?? [],
      resolvesConflictBeatId: stringOr(item.resolvesConflictBeatId ?? item.resolves_conflict_beat_id, ""),
      requiredAnchorIds,
      sourceEventIds,
      targetSegmentNos: normalizeNumberArray(item.targetSegmentNos ?? item.target_segment_nos),
      mustBeVisibleBeforeBeatIds: normalizeStringArray(item.mustBeVisibleBeforeBeatIds ?? item.must_be_visible_before_beat_ids) ?? [],
      actionContinuity: normalizeActionContinuity(item.actionContinuity ?? item.action_continuity),
      reactionBeat: stringOr(item.reactionBeat ?? item.reaction_beat, ""),
      powerShift: stringOr(item.powerShift ?? item.power_shift, ""),
      notes: normalizeStringArray(item.notes) ?? [],
    }];
  }).sort((a, b) => a.order - b.order).slice(0, 80);
}

function normalizeAnchorExclusions(value: unknown): NonNullable<VideoStoryBeat["excludedAnchors"]> {
  return arrayOfRecords(value).map((item) => ({
    anchorId: stringOr(item.anchorId ?? item.anchor_id, ""),
    reason: stringOr(item.reason ?? item.reasonZh ?? item.reason_zh, ""),
    visibility: stringOr(item.visibility ?? item.presence, ""),
    valid: booleanOr(item.valid, false),
  })).filter((item) => item.anchorId);
}

function normalizeStoryEvidenceRegistry(
  value: unknown,
  beatIds: Set<string>,
  segmentNos: Set<number>,
  warnings: string[],
): VideoStoryEvidence[] {
  return arrayOfRecords(value).flatMap((item, index) => {
    const evidenceId = safeId(item.evidenceId ?? item.evidence_id, `evidence_${index + 1}`);
    const introducedByBeatId = stringOr(item.introducedByBeatId ?? item.introduced_by_beat_id, "");
    const visibleInSegmentNos = normalizeNumberArray(item.visibleInSegmentNos ?? item.visible_in_segment_nos);
    if (!beatIds.has(introducedByBeatId)) warnings.push(`storyDesign evidence ${evidenceId} references missing beat ${introducedByBeatId}`);
    for (const segmentNo of visibleInSegmentNos) {
      if (!segmentNos.has(segmentNo)) warnings.push(`storyDesign evidence ${evidenceId} references missing segment ${segmentNo}`);
    }
    return [{
      evidenceId,
      description: stringOr(item.description, ""),
      introducedByBeatId,
      visibleInSegmentNos,
      anchorIds: normalizeStringArray(item.anchorIds ?? item.anchor_ids) ?? [],
    }];
  });
}

function fallbackStoryBeatRecordsForTemplate(
  templateId: VideoCreativeTemplateId | undefined,
  timelineSegments: VideoTimelineBlueprintSegment[],
): Record<string, unknown>[] {
  const definition = STORY_TEMPLATE_DEFINITIONS[templateId ?? "generic_brand_story"] ?? STORY_TEMPLATE_DEFINITIONS.generic_brand_story;
  const segmentCount = Math.max(1, timelineSegments.length);
  return definition.minimumBeats.map<Record<string, unknown>>((beat, index) => {
    const targetSegment = timelineSegments[Math.min(index, segmentCount - 1)] ?? timelineSegments[0];
    const segmentNo = targetSegment?.segmentNo ?? index + 1;
    return {
      beat_id: `beat_${index + 1}_${beat.storyFunction}`,
      order: index + 1,
      story_function: beat.storyFunction,
      title_zh: beat.titleZh,
      emotional_beat_zh: beat.titleZh,
      cause: beat.cause,
      effect: beat.effect,
      information_unit: beat.informationUnit || targetSegment?.purposeZh || targetSegment?.purposeEn || "",
      key_evidence_ids: targetSegment?.requiredAnchorIds ?? [],
      required_anchor_ids: targetSegment?.requiredAnchorIds ?? [],
      source_event_ids: targetSegment?.sourceEventIds ?? [],
      target_segment_nos: [segmentNo],
      action_continuity: beat.actionContinuity,
      reaction_beat: beat.reactionBeat ?? "",
      power_shift: beat.powerShift ?? "",
      notes: [`template:${templateId ?? "generic_brand_story"}`],
    };
  });
}

function normalizeShotGroupingPass(
  value: unknown,
  storyBeats: VideoStoryBeat[],
  timelineSegments: VideoTimelineBlueprintSegment[],
  warnings: string[],
): VideoShotGroupingPass {
  const raw = isRecord(value) ? value : {};
  if (!Object.keys(raw).length) warnings.push("storyDesign shotGroupingPass missing; derived fallback groups from storyBeats target segments");
  const beatIds = new Set(storyBeats.map((beat) => beat.beatId));
  const groupsRaw = arrayOfRecords(raw.groups);
  const derivedGrouping = deriveShotGroupingPass(storyBeats, timelineSegments);
  const groupSourceRecords: Record<string, unknown>[] = groupsRaw.length ? groupsRaw : derivedGrouping.groups;
  const groups = groupSourceRecords.flatMap((group, index) => {
    const beatIdsForGroup = normalizeStringArray(group.beatIds ?? group.beat_ids) ?? [];
    for (const beatId of beatIdsForGroup) {
      if (!beatIds.has(beatId)) warnings.push(`shotGroupingPass group ${index + 1} references missing story beat ${beatId}`);
    }
    return [{
      groupId: safeId(group.groupId ?? group.group_id, `group_${index + 1}`),
      beatIds: beatIdsForGroup,
      segmentNos: normalizeNumberArray(group.segmentNos ?? group.segment_nos),
      storyFunction: normalizeStoryFunction(group.storyFunction ?? group.story_function),
      reason: stringOr(group.reason, ""),
      reasonZh: stringOr(group.reasonZh ?? group.reason_zh, ""),
      continuousTakeRisk: normalizeRiskLevel(group.continuousTakeRisk ?? group.continuous_take_risk),
      splitRequired: booleanOr(group.splitRequired ?? group.split_required, false),
    }];
  }).slice(0, 80);
  const splitReasonsRaw = arrayOfRecords(raw.splitReasons ?? raw.split_reasons);
  const splitReasons = normalizeShotGroupingSplitReasons(splitReasonsRaw.length ? splitReasonsRaw : derivedGrouping.splitReasons, warnings);
  validateShotGroupingContinuity(groups, splitReasons, timelineSegments, warnings);
  return {
    strategy: stringOr(raw.strategy, derivedGrouping.strategy),
    strategyZh: stringOr(raw.strategyZh ?? raw.strategy_zh, derivedGrouping.strategyZh),
    sourceBeatIds: normalizeStringArray(raw.sourceBeatIds ?? raw.source_beat_ids) ?? storyBeats.map((beat) => beat.beatId),
    groups,
    splitReasons,
    warnings: normalizeStringArray(raw.warnings) ?? [],
  };
}

export function deriveShotGroupingPass(
  storyBeats: VideoStoryBeat[],
  timelineSegments: VideoTimelineBlueprintSegment[],
): {
  strategy: string;
  strategyZh: string;
  groups: Record<string, unknown>[];
  splitReasons: Record<string, unknown>[];
} {
  const ordered = [...timelineSegments].sort((a, b) => a.segmentNo - b.segmentNo);
  const groups: Record<string, unknown>[] = [];
  const splitReasons: Record<string, unknown>[] = [];
  let current: VideoTimelineBlueprintSegment[] = [];
  for (const segment of ordered) {
    if (!current.length) {
      current = [segment];
      continue;
    }
    const previous = current[current.length - 1];
    const decision = shouldSplitShotGroup(previous, segment, current, storyBeats);
    if (decision) {
      splitReasons.push({
        after_segment_no: previous.segmentNo,
        before_segment_no: segment.segmentNo,
        reason_code: decision.reasonCode,
        reason_zh: decision.reasonZh,
        merge_rejected: true,
      });
      groups.push(shotGroupRecordForSegments(current, storyBeats, groups.length + 1));
      current = [segment];
    } else {
      current.push(segment);
    }
  }
  if (current.length) groups.push(shotGroupRecordForSegments(current, storyBeats, groups.length + 1));
  return {
    strategy: "deterministic_adjacent_segment_grouping",
    strategyZh: "按叙事焦点、物理空间、连续动作链、情绪方向、主客观镜头匹配和 15 秒上限，对相邻微镜头/片段进行合并或切分标注。",
    groups,
    splitReasons,
  };
}

function shotGroupRecordForSegments(
  segments: VideoTimelineBlueprintSegment[],
  storyBeats: VideoStoryBeat[],
  index: number,
): Record<string, unknown> {
  const segmentNos = segments.map((segment) => segment.segmentNo);
  const beatIds = storyBeats
    .filter((beat) => beat.targetSegmentNos?.some((segmentNo) => segmentNos.includes(segmentNo)))
    .map((beat) => beat.beatId);
  const functions = segments.map((segment) => storyFunctionFromBeatRole(segment.beatRole)).filter(Boolean);
  const primaryFunction = functions.find((fn) => fn !== "custom") ?? functions[0] ?? "custom";
  const totalDuration = segments.reduce((sum, segment) => sum + segment.durationSeconds, 0);
  return {
    group_id: `shot_group_${index}`,
    beat_ids: uniqueStrings(beatIds),
    segment_nos: segmentNos,
    story_function: primaryFunction,
    reason_zh: describeShotGroupReason(segments, totalDuration),
    continuous_take_risk: totalDuration > 12 || segments.length > 2 ? "medium" : "low",
    split_required: false,
  };
}

function shouldSplitShotGroup(
  previous: VideoTimelineBlueprintSegment,
  next: VideoTimelineBlueprintSegment,
  currentGroup: VideoTimelineBlueprintSegment[],
  storyBeats: VideoStoryBeat[],
): ShotGroupingSplitReason | null {
  const mergedDuration = currentGroup.reduce((sum, segment) => sum + segment.durationSeconds, 0) + next.durationSeconds;
  if (mergedDuration > MAX_SEGMENT_SECONDS) return splitReason(previous, next, "duration_limit", `合并后 ${mergedDuration}s 超过 i2v 单段 ${MAX_SEGMENT_SECONDS}s 上限。`);
  const nextFunction = storyFunctionFromBeatRole(next.beatRole);
  const previousFunction = storyFunctionFromBeatRole(previous.beatRole);
  if (nextFunction === "cta" || isCtaTimelineSegment(next)) return splitReason(previous, next, "cta_enter", "CTA 进入，需要独立承接前面的利益点，避免和 payoff/证明动作混在同一连续镜头里。");
  if (nextFunction === "payoff" && previousFunction !== "payoff") return splitReason(previous, next, "payoff_state_change", "payoff 状态明显改变，需要让结果兑现成为清晰的新段落。");
  if (nextFunction === "conflict" && previousFunction !== "hook" && previousFunction !== "conflict") return splitReason(previous, next, "new_conflict_relation", "新的冲突关系出现，需要切出新的叙事焦点。");
  if (hasTimeJump(previous, next)) return splitReason(previous, next, "time_jump", "相邻段存在时间跳跃，不能作为同一连续动作链。");
  if (hasSpaceChange(previous, next)) return splitReason(previous, next, "space_change", "物理空间或硬一致性锚点变化明显，需要切分。");
  if (!hasCompatibleNarrativeFocus(previous, next, storyBeats)) return splitReason(previous, next, "narrative_focus_change", "相邻段叙事焦点不同，合并会削弱信息递进。");
  if (!hasCompatibleCameraView(previous, next)) return splitReason(previous, next, "camera_mismatch", "视线或主客观镜头关系不匹配，不适合作为同一连续镜头。");
  if (!hasCompatibleEmotionDirection(previous, next)) return splitReason(previous, next, "model_continuity_risk", "情绪方向或动作连续性不足，合并后容易让模型生成跳变。");
  return null;
}

function splitReason(
  previous: VideoTimelineBlueprintSegment,
  next: VideoTimelineBlueprintSegment,
  reasonCode: ShotGroupingSplitReason["reasonCode"],
  reasonZh: string,
): ShotGroupingSplitReason {
  return {
    afterSegmentNo: previous.segmentNo,
    beforeSegmentNo: next.segmentNo,
    reasonCode,
    reasonZh,
    mergeRejected: true,
  };
}

function normalizeShotGroupingSplitReasons(
  values: Record<string, unknown>[],
  warnings: string[],
): ShotGroupingSplitReason[] {
  return values.flatMap((item, index) => {
    const afterSegmentNo = numberFrom(item.afterSegmentNo ?? item.after_segment_no);
    const beforeSegmentNo = numberFrom(item.beforeSegmentNo ?? item.before_segment_no);
    const reasonCode = normalizeShotGroupingSplitReasonCode(item.reasonCode ?? item.reason_code);
    if (!afterSegmentNo || !beforeSegmentNo || !reasonCode) {
      warnings.push(`shotGroupingPass splitReason ${index + 1} is incomplete`);
      return [];
    }
    return [{
      afterSegmentNo,
      beforeSegmentNo,
      reasonCode,
      reasonZh: stringOr(item.reasonZh ?? item.reason_zh, ""),
      mergeRejected: booleanOr(item.mergeRejected ?? item.merge_rejected, true),
    }];
  }).slice(0, 80);
}

function validateShotGroupingContinuity(
  groups: NonNullable<VideoShotGroupingPass["groups"]>,
  splitReasons: ShotGroupingSplitReason[],
  timelineSegments: VideoTimelineBlueprintSegment[],
  warnings: string[],
): void {
  const segmentNos = new Set(timelineSegments.map((segment) => segment.segmentNo));
  const covered = new Set<number>();
  for (const group of groups) {
    const duration = group.segmentNos.reduce((sum, segmentNo) => {
      const segment = timelineSegments.find((item) => item.segmentNo === segmentNo);
      return sum + (segment?.durationSeconds ?? 0);
    }, 0);
    if (duration > MAX_SEGMENT_SECONDS) warnings.push(`shotGroupingPass group ${group.groupId} exceeds ${MAX_SEGMENT_SECONDS}s`);
    if (!group.reasonZh && !group.reason) warnings.push(`shotGroupingPass group ${group.groupId} lacks state-change reason`);
    for (const segmentNo of group.segmentNos) {
      if (!segmentNos.has(segmentNo)) warnings.push(`shotGroupingPass group ${group.groupId} references missing segment ${segmentNo}`);
      covered.add(segmentNo);
    }
  }
  for (const segmentNo of segmentNos) {
    if (!covered.has(segmentNo)) warnings.push(`shotGroupingPass does not cover segment ${segmentNo}`);
  }
  const splitPairs = new Set(splitReasons.map((item) => `${item.afterSegmentNo}:${item.beforeSegmentNo}`));
  for (let index = 1; index < timelineSegments.length; index += 1) {
    const prev = timelineSegments[index - 1];
    const next = timelineSegments[index];
    const sameGroup = groups.some((group) => group.segmentNos.includes(prev.segmentNo) && group.segmentNos.includes(next.segmentNo));
    if (!sameGroup && !splitPairs.has(`${prev.segmentNo}:${next.segmentNo}`)) {
      warnings.push(`shotGroupingPass missing splitReason between segment ${prev.segmentNo} and ${next.segmentNo}`);
    }
  }
}

function describeShotGroupReason(segments: VideoTimelineBlueprintSegment[], totalDuration: number): string {
  const first = segments[0];
  const last = segments[segments.length - 1] ?? first;
  if (!first || !last) return "";
  if (segments.length === 1) {
    return `单段执行：从“${first.purposeZh || first.beatRole || "当前状态"}”推进到本段结束状态，时长 ${totalDuration}s。`;
  }
  return `合并为同一连续执行单元：从“${first.purposeZh || first.beatRole || "起始状态"}”递进到“${last.purposeZh || last.beatRole || "结束状态"}”，总时长 ${totalDuration}s，不超过 ${MAX_SEGMENT_SECONDS}s。`;
}

function hasTimeJump(previous: VideoTimelineBlueprintSegment, next: VideoTimelineBlueprintSegment): boolean {
  const text = segmentGroupingText(previous, next);
  return /时间跳跃|隔天|之后|几小时|多年后|回忆|闪回|time jump|later|next day|flashback/i.test(text);
}

function isCtaTimelineSegment(segment: VideoTimelineBlueprintSegment): boolean {
  return /cta|call to action|下载|立即|购买|下单|预约|了解更多|继续观看|download|buy now|order now|book now|learn more/i.test(segmentGroupingText(segment));
}

function hasSpaceChange(previous: VideoTimelineBlueprintSegment, next: VideoTimelineBlueprintSegment): boolean {
  if (previous.boundaryModeHint === "hard_cut" || next.boundaryModeHint === "hard_cut") return true;
  const previousAnchors = new Set(previous.requiredAnchorIds ?? []);
  const nextAnchors = new Set(next.requiredAnchorIds ?? []);
  const hasAnchorSignal = previousAnchors.size > 0 || nextAnchors.size > 0;
  if (hasAnchorSignal && !setsOverlap(previousAnchors, nextAnchors)) return true;
  const text = segmentGroupingText(previous, next);
  return /空间变化|换场|新地点|室内到室外|外景|门店|厨房到餐桌|from .* to .*location|new location|space change/i.test(text);
}

function hasCompatibleNarrativeFocus(previous: VideoTimelineBlueprintSegment, next: VideoTimelineBlueprintSegment, storyBeats: VideoStoryBeat[]): boolean {
  const previousFunction = storyFunctionFromBeatRole(previous.beatRole);
  const nextFunction = storyFunctionFromBeatRole(next.beatRole);
  if (previousFunction === nextFunction) return true;
  const compatiblePairs = new Set([
    "hook:setup",
    "hook:conflict",
    "hook:proof",
    "setup:conflict",
    "setup:proof",
    "conflict:escalation",
    "escalation:turning_point",
    "turning_point:proof",
    "proof:reaction",
    "reaction:payoff",
  ]);
  if (compatiblePairs.has(`${previousFunction}:${nextFunction}`)) return true;
  const previousBeatIds = beatIdsForTimelineSegment(previous, storyBeats);
  const nextBeatIds = beatIdsForTimelineSegment(next, storyBeats);
  return setsOverlap(new Set(previousBeatIds), new Set(nextBeatIds));
}

function hasCompatibleCameraView(previous: VideoTimelineBlueprintSegment, next: VideoTimelineBlueprintSegment): boolean {
  if (previous.boundaryModeHint === "match_cut" || next.boundaryModeHint === "match_cut") return true;
  const text = segmentGroupingText(previous, next);
  if (/主观|第一视角|POV/i.test(previous.purposeZh ?? "") !== /主观|第一视角|POV/i.test(next.purposeZh ?? "")) return false;
  return !/反打|reverse shot|new camera setup|新机位|轴线改变|axis change/i.test(text);
}

function hasCompatibleEmotionDirection(previous: VideoTimelineBlueprintSegment, next: VideoTimelineBlueprintSegment): boolean {
  const previousFunction = storyFunctionFromBeatRole(previous.beatRole);
  const nextFunction = storyFunctionFromBeatRole(next.beatRole);
  if (previousFunction === "payoff" && nextFunction === "conflict") return false;
  if (previousFunction === "cta") return false;
  return true;
}

function beatIdsForTimelineSegment(segment: VideoTimelineBlueprintSegment, storyBeats: VideoStoryBeat[]): string[] {
  return storyBeats
    .filter((beat) => beat.targetSegmentNos?.includes(segment.segmentNo))
    .map((beat) => beat.beatId);
}

function segmentGroupingText(...segments: VideoTimelineBlueprintSegment[]): string {
  return segments.map((segment) => [
    segment.purposeZh,
    segment.purposeEn,
    segment.splitReasonZh,
    segment.subtitleIntentZh,
    segment.audioIntentZh,
    segment.beatRole,
    ...(segment.sourceEventIds ?? []),
    ...(segment.requiredAnchorIds ?? []),
  ].filter(Boolean).join(" ")).join(" ");
}

function setsOverlap<T>(a: Set<T>, b: Set<T>): boolean {
  for (const value of a) {
    if (b.has(value)) return true;
  }
  return false;
}

function normalizeShotGroupingSplitReasonCode(value: unknown): ShotGroupingSplitReason["reasonCode"] | undefined {
  const normalized = typeof value === "string" ? value.trim().toLowerCase().replace(/[-\s]+/g, "_") : value;
  if (
    normalized === "space_change" ||
    normalized === "time_jump" ||
    normalized === "new_conflict_relation" ||
    normalized === "payoff_state_change" ||
    normalized === "cta_enter" ||
    normalized === "duration_limit" ||
    normalized === "camera_mismatch" ||
    normalized === "narrative_focus_change" ||
    normalized === "model_continuity_risk"
  ) return normalized;
  return undefined;
}

function normalizeStoryQualityReport(
  value: unknown,
  storyBeats: VideoStoryBeat[],
  timelineSegments: VideoTimelineBlueprintSegment[],
  warnings: string[],
): VideoStoryQualityReport {
  const raw = isRecord(value) ? value : {};
  const issues: NonNullable<VideoStoryQualityReport["issues"]> = arrayOfRecords(raw.issues).map((issue) => ({
    code: safeId(issue.code, "story_quality_warning"),
    severity: issue.severity === "error" ? "error" : "warning",
    beatId: stringOr(issue.beatId ?? issue.beat_id, "") || undefined,
    segmentNo: numberFrom(issue.segmentNo ?? issue.segment_no) || undefined,
    messageZh: stringOr(issue.messageZh ?? issue.message_zh, ""),
    recommendationZh: stringOr(issue.recommendationZh ?? issue.recommendation_zh, ""),
  }));
  for (const warning of warnings.filter((item) => item.startsWith("storyDesign "))) {
    issues.push({
      code: "story_design_contract_warning",
      severity: "warning",
      messageZh: warning,
      recommendationZh: "当前阶段只记录 warning，不阻断生成；后续质量门禁阶段再决定是否重写。",
    });
  }
  validateStoryBeatCoverage(storyBeats, timelineSegments, issues);
  return {
    passed: booleanOr(raw.passed, !issues.some((issue) => issue.severity === "error")),
    score: numberFrom(raw.score),
    hookScore: numberFrom(raw.hookScore ?? raw.hook_score),
    causalityScore: numberFrom(raw.causalityScore ?? raw.causality_score),
    payoffScore: numberFrom(raw.payoffScore ?? raw.payoff_score),
    ctaScore: numberFrom(raw.ctaScore ?? raw.cta_score),
    continuityScore: numberFrom(raw.continuityScore ?? raw.continuity_score),
    issueCodes: normalizeStringArray(raw.issueCodes ?? raw.issue_codes) ?? issues.map((issue) => issue.code),
    issues,
    rewriteRequired: booleanOr(raw.rewriteRequired ?? raw.rewrite_required, false),
    rewriteFromStage: normalizeStoryRewriteStage(raw.rewriteFromStage ?? raw.rewrite_from_stage),
    summaryZh: stringOr(raw.summaryZh ?? raw.summary_zh, issues.length ? "剧情结构字段已接入，但部分字段由系统派生或缺失，当前仅记录 warning。" : "剧情结构字段完整。"),
  };
}

function normalizeSegmentStoryTrace(params: {
  sourceSegment: Record<string, unknown>;
  timelineSegment: VideoTimelineBlueprintSegment;
  storyboardBrief?: StoryboardBrief;
  storyBeats: VideoStoryBeat[];
  warnings: string[];
}): Pick<VideoPlanSegment, "linkedBeatIds" | "storyFunction" | "emotionalBeat" | "emotionalBeatZh" | "emotionalBeatEn" | "cause" | "effect" | "informationUnit" | "keyEvidenceIds" | "dependsOnBeatIds" | "evidenceFromBeatIds" | "resolvesConflictBeatId" | "actionContinuity" | "reactionBeat" | "powerShift"> {
  const linkedBeatIds = normalizeStringArray(params.sourceSegment.linkedBeatIds ?? params.sourceSegment.linked_beat_ids) ??
    params.storyboardBrief?.linkedBeatIds ??
    params.storyBeats.filter((beat) => beat.targetSegmentNos?.includes(params.timelineSegment.segmentNo)).map((beat) => beat.beatId);
  if (!linkedBeatIds.length) params.warnings.push(`storyDesign segment ${params.timelineSegment.segmentNo} has no linkedBeatIds`);
  const linkedBeats = params.storyBeats.filter((beat) => linkedBeatIds.includes(beat.beatId));
  const primaryBeat = linkedBeats[0];
  const storyFunction = normalizeStoryFunction(params.sourceSegment.storyFunction ?? params.sourceSegment.story_function) ??
    params.storyboardBrief?.storyFunction ??
    primaryBeat?.storyFunction ??
    storyFunctionFromBeatRole(params.timelineSegment.beatRole);
  const actionContinuity = normalizeActionContinuity(params.sourceSegment.actionContinuity ?? params.sourceSegment.action_continuity) ?? primaryBeat?.actionContinuity;
  if (!linkedBeatIds.length) {
    params.warnings.push(`storyDesign segment ${params.timelineSegment.segmentNo} will continue with non-blocking story trace warning`);
  }
  if ((storyFunction === "payoff" || storyFunction === "turning_point") && (!actionContinuity?.execution || !actionContinuity?.resultOrReaction)) {
    params.warnings.push(`storyDesign ${storyFunction} segment ${params.timelineSegment.segmentNo} lacks complete actionContinuity trigger/result`);
  }
  const reactionBeat = stringOr(params.sourceSegment.reactionBeat ?? params.sourceSegment.reaction_beat, primaryBeat?.reactionBeat ?? "");
  const powerShift = stringOr(params.sourceSegment.powerShift ?? params.sourceSegment.power_shift, primaryBeat?.powerShift ?? "");
  if ((storyFunction === "payoff" || storyFunction === "turning_point") && (!reactionBeat || !powerShift)) {
    params.warnings.push(`storyDesign ${storyFunction} segment ${params.timelineSegment.segmentNo} lacks reactionBeat or powerShift`);
  }
  return {
    linkedBeatIds,
    storyFunction,
    emotionalBeat: stringOr(params.sourceSegment.emotionalBeat ?? params.sourceSegment.emotional_beat, primaryBeat?.emotionalBeat ?? ""),
    emotionalBeatZh: stringOr(params.sourceSegment.emotionalBeatZh ?? params.sourceSegment.emotional_beat_zh, primaryBeat?.emotionalBeatZh ?? ""),
    emotionalBeatEn: stringOr(params.sourceSegment.emotionalBeatEn ?? params.sourceSegment.emotional_beat_en, primaryBeat?.emotionalBeatEn ?? ""),
    cause: stringOr(params.sourceSegment.cause, primaryBeat?.cause ?? ""),
    effect: stringOr(params.sourceSegment.effect, primaryBeat?.effect ?? ""),
    informationUnit: stringOr(params.sourceSegment.informationUnit ?? params.sourceSegment.information_unit, primaryBeat?.informationUnit ?? ""),
    keyEvidenceIds: normalizeStringArray(params.sourceSegment.keyEvidenceIds ?? params.sourceSegment.key_evidence_ids) ?? primaryBeat?.keyEvidenceIds ?? [],
    dependsOnBeatIds: normalizeStringArray(params.sourceSegment.dependsOnBeatIds ?? params.sourceSegment.depends_on_beat_ids) ?? primaryBeat?.dependsOnBeatIds ?? [],
    evidenceFromBeatIds: normalizeStringArray(params.sourceSegment.evidenceFromBeatIds ?? params.sourceSegment.evidence_from_beat_ids) ?? primaryBeat?.evidenceFromBeatIds ?? [],
    resolvesConflictBeatId: stringOr(params.sourceSegment.resolvesConflictBeatId ?? params.sourceSegment.resolves_conflict_beat_id, primaryBeat?.resolvesConflictBeatId ?? ""),
    actionContinuity,
    reactionBeat,
    powerShift,
  };
}

function withStoryQualityWarnings(report: VideoStoryQualityReport, warnings: string[]): VideoStoryQualityReport {
  const existing = report.issues ?? [];
  const existingMessages = new Set(existing.map((issue) => issue.messageZh).filter(Boolean));
  const warningIssues = warnings
    .filter((warning) => warning.startsWith("storyDesign "))
    .filter((warning) => !existingMessages.has(warning))
    .map((warning) => ({
      code: "story_design_contract_warning",
      severity: "warning" as const,
      messageZh: warning,
      recommendationZh: "当前阶段只记录 warning，不阻断生成；后续质量门禁阶段再决定是否重写。",
    }));
  const issues = [...existing, ...warningIssues];
  return {
    ...report,
    passed: report.passed ?? !issues.some((issue) => issue.severity === "error"),
    issueCodes: report.issueCodes?.length ? report.issueCodes : issues.map((issue) => issue.code),
    issues,
  };
}

function validateStoryBeatCoverage(
  storyBeats: VideoStoryBeat[],
  timelineSegments: VideoTimelineBlueprintSegment[],
  issues: NonNullable<VideoStoryQualityReport["issues"]>,
): void {
  for (const segment of timelineSegments) {
    if (!storyBeats.some((beat) => beat.targetSegmentNos?.includes(segment.segmentNo))) {
      issues.push({
        code: "story_beat_segment_trace_missing",
        severity: "warning",
        segmentNo: segment.segmentNo,
        messageZh: `片段 ${segment.segmentNo} 没有明确绑定 story beat。`,
        recommendationZh: "当前阶段不阻断生成；后续质量门禁阶段应要求重写 beat sheet 或 shot grouping。",
      });
    }
  }
  const payoffOrder = storyBeats.find((beat) => beat.storyFunction === "payoff")?.order;
  const triggerOrder = storyBeats.find((beat) => beat.storyFunction === "turning_point" || beat.storyFunction === "proof")?.order;
  if (payoffOrder && (!triggerOrder || triggerOrder >= payoffOrder)) {
    issues.push({
      code: "payoff_without_prior_trigger",
      severity: "warning",
      messageZh: "payoff 前没有明确的 turning point/proof 触发 beat，可能出现“突然赢了”。",
      recommendationZh: "后续 Planner 应补出可见触发动作，再进入 payoff。",
    });
  }
  for (const beat of storyBeats) {
    if ((beat.storyFunction === "payoff" || beat.storyFunction === "turning_point") && (!beat.actionContinuity?.execution || !beat.actionContinuity.resultOrReaction)) {
      issues.push({
        code: "payoff_or_turning_point_action_continuity_missing",
        severity: "warning",
        beatId: beat.beatId,
        messageZh: `${beat.storyFunction} beat 缺少完整 actionContinuity。`,
        recommendationZh: "补充 motivation_or_preparation、execution、result_or_reaction，避免结果突然发生。",
      });
    }
    if ((beat.storyFunction === "payoff" || beat.storyFunction === "turning_point") && (!beat.reactionBeat || !beat.powerShift)) {
      issues.push({
        code: "reaction_or_power_shift_missing",
        severity: "warning",
        beatId: beat.beatId,
        messageZh: `${beat.storyFunction} beat 缺少 reactionBeat 或 powerShift。`,
        recommendationZh: "补充角色/用户反应和力量关系变化，让爽点成立。",
      });
    }
  }
}

function normalizeNarrativeEvents(
  value: unknown,
  context: { warnings: string[]; anchorIds: Set<string> },
): NarrativeEvent[] {
  return arrayOfRecords(value).map((item, index) => {
    const eventId = safeId(item.eventId ?? item.event_id, `event_${index + 1}`);
    const requiredAnchorIds = normalizeStringArray(item.requiredAnchorIds ?? item.required_anchor_ids) ?? [];
    for (const anchorId of requiredAnchorIds) {
      if (!context.anchorIds.has(anchorId)) context.warnings.push(`narrativeEvent ${eventId} references missing anchor ${anchorId}`);
    }
    return {
      eventId,
      storyFunctions: normalizeStoryFunctionArray(item.storyFunctions ?? item.story_functions),
      dramaticGoal: stringOr(item.dramaticGoal ?? item.dramatic_goal, ""),
      participants: normalizeStringArray(item.participants) ?? [],
      locationId: safeId(item.locationId ?? item.location_id, ""),
      initialState: stringOr(item.initialState ?? item.initial_state, ""),
      action: stringOr(item.action, ""),
      resultingState: stringOr(item.resultingState ?? item.resulting_state, ""),
      requiredAnchorIds,
      previousEventIds: normalizeStringArray(item.previousEventIds ?? item.previous_event_ids) ?? [],
      mustBecomeSeparateSegment: booleanOr(item.mustBecomeSeparateSegment ?? item.must_become_separate_segment, false),
    };
  }).slice(0, 20);
}

function validateNarrativeEventReferences(events: NarrativeEvent[], warnings: string[]): void {
  const seen = new Set<string>();
  const all = new Set(events.map((event) => event.eventId));
  for (const event of events) {
    for (const previousEventId of event.previousEventIds) {
      if (!all.has(previousEventId)) {
        warnings.push(`narrativeEvent ${event.eventId} previousEventIds references missing event ${previousEventId}`);
      } else if (!seen.has(previousEventId)) {
        warnings.push(`narrativeEvent ${event.eventId} previousEventIds references non-earlier event ${previousEventId}`);
      }
    }
    seen.add(event.eventId);
  }
}

function normalizeAnchorStateTimeline(
  value: unknown,
  context: { warnings: string[]; anchorIds: Set<string>; eventIds: Set<string> },
): AnchorStateTimeline[] {
  return arrayOfRecords(value).flatMap((item) => {
    const anchorId = safeId(item.anchorId ?? item.anchor_id, "");
    if (!anchorId) return [];
    if (!context.anchorIds.has(anchorId)) context.warnings.push(`anchorStateTimeline references missing anchor ${anchorId}`);
    const seenSegmentPositions = new Map<number, string>();
    const states = arrayOfRecords(item.states).map((state) => {
      const eventId = safeId(state.eventId ?? state.event_id, "");
      const segmentNo = numberFrom(state.segmentNo ?? state.segment_no);
      if (eventId && context.eventIds.size && !context.eventIds.has(eventId)) {
        context.warnings.push(`anchorStateTimeline ${anchorId} references missing event ${eventId}`);
      }
      const holderAtStart = stringOr(state.holderAtStart ?? state.holder_at_start, "");
      const holderAtEnd = stringOr(state.holderAtEnd ?? state.holder_at_end, "");
      const visibleTransitionPath = stringOr(state.visibleTransitionPath ?? state.visible_transition_path, "");
      if (holderAtStart && holderAtEnd && holderAtStart !== holderAtEnd && !visibleTransitionPath) {
        context.warnings.push(`anchorStateTimeline ${anchorId} holder changes in segment ${segmentNo || eventId || "unknown"} without visibleTransitionPath`);
      }
      const positionSignature = [
        stringOr(state.startPosition ?? state.start_position, ""),
        stringOr(state.endPosition ?? state.end_position, ""),
      ].join(" -> ");
      if (segmentNo > 0) {
        const previous = seenSegmentPositions.get(segmentNo);
        if (previous && previous !== positionSignature) {
          context.warnings.push(`anchorStateTimeline ${anchorId} has conflicting positions in segment ${segmentNo}`);
        }
        seenSegmentPositions.set(segmentNo, positionSignature);
      }
      return {
        eventId: eventId || undefined,
        segmentNo,
        startState: stringOr(state.startState ?? state.start_state, ""),
        endState: stringOr(state.endState ?? state.end_state, ""),
        startPosition: stringOr(state.startPosition ?? state.start_position, ""),
        endPosition: stringOr(state.endPosition ?? state.end_position, ""),
        holderAtStart,
        holderAtEnd,
        visibleTransitionPath,
      };
    }).filter((state) => state.segmentNo > 0 || Boolean(state.eventId)).slice(0, 40);
    return [{
      anchorId,
      states,
    }];
  }).slice(0, 20);
}

function normalizeCandidateTimeline(value: unknown, fallback: VideoTimelineBlueprintSegment[]): VideoTimelineBlueprintSegment[] {
  const records = arrayOfRecords(value);
  if (!records.length) return fallback;
  return records.flatMap((item, index) => {
    const segmentNo = numberFrom(item.segmentNo ?? item.segment_no) || index + 1;
    const fallbackSegment = fallback.find((segment) => segment.segmentNo === segmentNo) ?? fallback[index];
    if (!fallbackSegment) return [];
    return [{
      segmentNo,
      endFrameRequirementLevel: normalizeEndFrameRequirementLevel(item.endFrameRequirementLevel ?? item.end_frame_requirement_level),
      videoPromptContract: readValidatedVideoPromptContract(item, segmentNo),
      startTimeSeconds: numberFrom(item.startTimeSeconds ?? item.start_time_seconds) || fallbackSegment.startTimeSeconds,
      endTimeSeconds: numberFrom(item.endTimeSeconds ?? item.end_time_seconds) || fallbackSegment.endTimeSeconds,
      durationSeconds: numberFrom(item.durationSeconds ?? item.duration_seconds) || fallbackSegment.durationSeconds,
      beatRole: normalizeBeatRole(item.beatRole ?? item.beat_role) ?? fallbackSegment.beatRole,
      purposeZh: stringOr(item.purposeZh ?? item.purpose_zh ?? item.purpose, fallbackSegment.purposeZh ?? ""),
      purposeEn: stringOr(item.purposeEn ?? item.purpose_en, fallbackSegment.purposeEn ?? ""),
      splitReasonZh: stringOr(item.splitReasonZh ?? item.split_reason_zh, fallbackSegment.splitReasonZh ?? ""),
      subtitleIntentZh: stringOr(item.subtitleIntentZh ?? item.subtitle_intent_zh, fallbackSegment.subtitleIntentZh ?? ""),
      audioIntentZh: stringOr(item.audioIntentZh ?? item.audio_intent_zh, fallbackSegment.audioIntentZh ?? ""),
      requiredAnchorIds: normalizeStringArray(item.requiredAnchorIds ?? item.required_anchor_ids) ?? fallbackSegment.requiredAnchorIds ?? [],
      sourceEventIds: normalizeStringArray(item.sourceEventIds ?? item.source_event_ids) ?? fallbackSegment.sourceEventIds ?? [],
      boundaryModeHint: normalizeBoundaryMode(item.boundaryModeHint ?? item.boundary_mode_hint) ?? fallbackSegment.boundaryModeHint,
    }];
  }).slice(0, 40);
}

function validateTimelineEventTrace(segments: VideoTimelineBlueprintSegment[], events: NarrativeEvent[], warnings: string[]): void {
  if (!events.length) return;
  const eventMap = new Map(events.map((event) => [event.eventId, event]));
  const coveredEventIds = new Set<string>();
  for (const segment of segments) {
    const sourceEventIds = segment.sourceEventIds ?? [];
    if (!sourceEventIds.length) {
      warnings.push(`timeline segment ${segment.segmentNo} has no source_event_ids`);
      continue;
    }
    for (const eventId of sourceEventIds) {
      const event = eventMap.get(eventId);
      if (!event) {
        warnings.push(`timeline segment ${segment.segmentNo} references missing source event ${eventId}`);
        continue;
      }
      coveredEventIds.add(eventId);
      if (event.mustBecomeSeparateSegment && sourceEventIds.length > 1 && !segment.splitReasonZh) {
        warnings.push(`must-separate event ${eventId} is merged in segment ${segment.segmentNo} without splitReasonZh`);
      }
    }
  }
  for (const event of events) {
    if (!coveredEventIds.has(event.eventId)) warnings.push(`narrativeEvent ${event.eventId} is not covered by candidate_timeline`);
  }
}

function normalizeStoryboardBrief(
  value: unknown,
  context: { warnings: string[]; anchorIds: Set<string>; eventIds: Set<string>; beatIds: Set<string> },
): StoryboardBrief[] {
  return arrayOfRecords(value).flatMap((item) => {
    const segmentNo = numberFrom(item.segmentNo ?? item.segment_no);
    if (!segmentNo) return [];
    const sourceEventIds = normalizeStringArray(item.sourceEventIds ?? item.source_event_ids) ?? [];
    const eventIds = normalizeStringArray(item.eventIds ?? item.event_ids) ?? sourceEventIds;
    const linkedBeatIds = normalizeStringArray(item.linkedBeatIds ?? item.linked_beat_ids) ?? [];
    const requiredAnchorIds = normalizeStringArray(item.requiredAnchorIds ?? item.required_anchor_ids) ?? [];
    const visibleAnchorIds = normalizeStringArray(item.visibleAnchorIds ?? item.visible_anchor_ids) ?? requiredAnchorIds;
    for (const eventId of eventIds) {
      if (context.eventIds.size && !context.eventIds.has(eventId)) context.warnings.push(`storyboardBrief segment ${segmentNo} references missing event ${eventId}`);
    }
    for (const anchorId of visibleAnchorIds) {
      if (!context.anchorIds.has(anchorId)) context.warnings.push(`storyboardBrief segment ${segmentNo} references missing anchor ${anchorId}`);
    }
    if (!linkedBeatIds.length) context.warnings.push(`storyboardBrief segment ${segmentNo} has no linked_beat_ids`);
    for (const beatId of linkedBeatIds) {
      if (context.beatIds.size && !context.beatIds.has(beatId)) context.warnings.push(`storyboardBrief segment ${segmentNo} references missing story beat ${beatId}`);
    }
    return [{
      segmentNo,
      eventIds,
      sourceEventIds,
      linkedBeatIds,
      storyFunction: normalizeStoryFunction(item.storyFunction ?? item.story_function),
      narrativeFunction: stringOr(item.narrativeFunction ?? item.narrative_function, ""),
      cameraId: safeId(item.cameraId ?? item.camera_id, `camera_${segmentNo}`),
      locationId: safeId(item.locationId ?? item.location_id, ""),
      visualDescZh: stringOr(item.visualDescZh ?? item.visual_desc_zh, ""),
      visualDescEn: stringOr(item.visualDescEn ?? item.visual_desc_en, ""),
      beatRole: normalizeBeatRole(item.beatRole ?? item.beat_role),
      requiredAnchorIds,
      separationReason: stringOr(item.separationReason ?? item.separation_reason, ""),
      visibleAnchorIds,
      purposeZh: stringOr(item.purposeZh ?? item.purpose_zh, ""),
      purposeEn: stringOr(item.purposeEn ?? item.purpose_en, ""),
    }];
  }).slice(0, 40);
}

function normalizeSegmentRenderDescriptions(
  value: unknown,
  context: { warnings: string[]; anchorIds: Set<string> },
): SegmentRenderDescription[] {
  return arrayOfRecords(value).flatMap((item) => {
    const segmentNo = numberFrom(item.segmentNo ?? item.segment_no);
    if (!segmentNo) return [];
    const visibleAnchorIds = normalizeStringArray(item.visibleAnchorIds ?? item.visible_anchor_ids ?? item.requiredAnchorIds ?? item.required_anchor_ids) ?? [];
    for (const anchorId of visibleAnchorIds) {
      if (!context.anchorIds.has(anchorId)) context.warnings.push(`segmentRenderDescription segment ${segmentNo} references missing anchor ${anchorId}`);
    }
    return [{
      segmentNo,
      videoPromptContract: readValidatedVideoPromptContract(item, segmentNo),
      startFrameContract: isRecord(item.startFrameContract) ? item.startFrameContract : isRecord(item.start_frame_contract) ? item.start_frame_contract : undefined,
      endFrameContract: isRecord(item.endFrameContract) ? item.endFrameContract : isRecord(item.end_frame_contract) ? item.end_frame_contract : undefined,
      motionContract: isRecord(item.motionContract) ? item.motionContract : isRecord(item.motion_contract) ? item.motion_contract : undefined,
      singleTakeContract: isRecord(item.singleTakeContract) ? item.singleTakeContract : isRecord(item.single_take_contract) ? item.single_take_contract : undefined,
      motionCheckpoints: normalizeMicroShotsForSegment({
        value: item.motionCheckpoints ?? item.motion_checkpoints,
        fallback: undefined,
        segmentNo,
        startSeconds: 0,
        durationSeconds: MAX_SEGMENT_SECONDS,
        segmentPurpose: "",
        segmentCamera: "",
        anchorIds: visibleAnchorIds,
        microPromptMap: new Map(),
      }),
      visibleAnchorIds,
      requiresCut: booleanOr(item.requiresCut ?? item.requires_cut, false),
      riskLevel: normalizeRiskLevel(item.riskLevel ?? item.risk_level),
      timelineChangeRequest: isRecord(item.timelineChangeRequest) ? item.timelineChangeRequest : isRecord(item.timeline_change_request) ? item.timeline_change_request : undefined,
      recommendedSplit: normalizeUnknownArray(item.recommendedSplit ?? item.recommended_split),
      warnings: normalizeStringArray(item.warnings) ?? [],
    }];
  }).slice(0, 40);
}

function readValidatedVideoPromptContract(
  value: unknown,
  segmentNo: number,
): SegmentRenderDescription["videoPromptContract"] {
  const contract = videoPromptContractFromUnknown(value);
  if (!contract) return undefined;
  try {
    validateVideoPromptContract(contract);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `segment ${segmentNo} returned an invalid video_prompt_contract: ${message}. Re-run the planning model; do not repair the contract in application code.`,
    );
  }
  return contract;
}

function validateSegmentRenderDescriptions(
  descriptions: SegmentRenderDescription[],
  timelineSegments: VideoTimelineBlueprintSegment[],
  warnings: string[],
): void {
  const bySegmentNo = new Map(descriptions.map((description) => [description.segmentNo, description]));
  for (const segment of timelineSegments) {
    const description = bySegmentNo.get(segment.segmentNo);
    if (!description) {
      warnings.push(`segmentRenderDescriptions missing segment ${segment.segmentNo}`);
      continue;
    }
    if (!description.startFrameContract) warnings.push(`segmentRenderDescriptions segment ${segment.segmentNo} missing start_frame_contract`);
    if (!description.endFrameContract) warnings.push(`segmentRenderDescriptions segment ${segment.segmentNo} missing end_frame_contract`);
    if (!description.motionContract) warnings.push(`segmentRenderDescriptions segment ${segment.segmentNo} missing motion_contract`);
    if (!description.singleTakeContract) warnings.push(`segmentRenderDescriptions segment ${segment.segmentNo} missing single_take_contract`);
  }
}

function normalizeCameraGraph(
  value: unknown,
  context: { warnings: string[]; cameraIds: Set<string> },
): CameraGraph | undefined {
  const source = isRecord(value) ? value : {};
  const cameras = arrayOfRecords(source.cameras ?? source.nodes).flatMap((item, index) => {
    const cameraId = safeId(item.cameraId ?? item.camera_id ?? item.id, `camera_${index + 1}`);
    if (!cameraId) return [];
    return [{
      cameraId,
      segmentNos: normalizeNumberArray(item.segmentNos ?? item.segment_nos ?? item.segments),
      sceneId: safeId(item.sceneId ?? item.scene_id, "") || undefined,
      locationId: safeId(item.locationId ?? item.location_id, ""),
      description: stringOr(item.description, ""),
      parentCameraId: safeId(item.parentCameraId ?? item.parent_camera_id, "") || undefined,
      parentSegmentNo: numberFrom(item.parentSegmentNo ?? item.parent_segment_no) || undefined,
      axisDescription: stringOr(item.axisDescription ?? item.axis_description, "") || undefined,
      framingRange: stringOr(item.framingRange ?? item.framing_range, "") || undefined,
      movementStyle: stringOr(item.movementStyle ?? item.movement_style, "") || undefined,
      spatialLayoutLock: stringOr(item.spatialLayoutLock ?? item.spatial_layout_lock, "") || undefined,
      relationToParent: item.relationToParent != null || item.relation_to_parent != null
        ? normalizeCameraRelation(item.relationToParent ?? item.relation_to_parent)
        : undefined,
      missingInfo: normalizeStringArray(item.missingInfo ?? item.missing_info),
      inheritanceReasonZh: stringOr(item.inheritanceReasonZh ?? item.inheritance_reason_zh, "") || undefined,
    }];
  });
  const known = new Set([...context.cameraIds, ...cameras.map((camera) => camera.cameraId)]);
  const relations = arrayOfRecords(source.relations ?? source.edges).flatMap((item) => {
    const fromCameraId = safeId(item.fromCameraId ?? item.from_camera_id ?? item.from, "");
    const toCameraId = safeId(item.toCameraId ?? item.to_camera_id ?? item.to, "");
    if (!fromCameraId || !toCameraId) return [];
    if (!known.has(fromCameraId)) context.warnings.push(`cameraGraph relation references missing camera ${fromCameraId}`);
    if (!known.has(toCameraId)) context.warnings.push(`cameraGraph relation references missing camera ${toCameraId}`);
    return [{
      fromCameraId,
      toCameraId,
      relation: normalizeCameraRelation(item.relation),
      reason: stringOr(item.reason, ""),
    }];
  });
  return cameras.length || relations.length ? { cameras, relations } : undefined;
}

function normalizeSceneContracts(value: unknown): VideoSceneContract[] {
  return arrayOfRecords(value).flatMap((item) => {
    const sceneId = safeId(item.sceneId ?? item.scene_id, "");
    const authorityRaw = isRecord(item.authority) ? item.authority : {};
    const kind = stringOr(authorityRaw.kind, "");
    const layoutAnchorId = safeId(item.layoutAnchorId ?? item.layout_anchor_id, "");
    if (!sceneId || (kind !== "scene_layout_asset" && kind !== "approved_root_boundary")) return [];
    const authority: VideoSceneContract["authority"] = kind === "approved_root_boundary"
      ? { kind, keyframeNo: numberFrom(authorityRaw.keyframeNo ?? authorityRaw.keyframe_no) }
      : { kind: "scene_layout_asset", anchorId: safeId(authorityRaw.anchorId ?? authorityRaw.anchor_id, layoutAnchorId) };
    return [{
      version: "scene-contract-v1",
      sceneId,
      displayNameZh: stringOr(item.displayNameZh ?? item.display_name_zh, "") || undefined,
      displayNameEn: stringOr(item.displayNameEn ?? item.display_name_en, "") || undefined,
      layoutAnchorId: layoutAnchorId || undefined,
      cameraIds: normalizeStringArray(item.cameraIds ?? item.camera_ids) ?? [],
      segmentNos: normalizeNumberArray(item.segmentNos ?? item.segment_nos),
      continuityMode: stringOr(item.continuityMode ?? item.continuity_mode, "") === "independent_setup"
        ? "independent_setup"
        : "single_space",
      spatialLayoutLock: stringOr(item.spatialLayoutLock ?? item.spatial_layout_lock, ""),
      cameraAxis: stringOr(item.cameraAxis ?? item.camera_axis, "") || undefined,
      fixedLandmarks: normalizeStringArray(item.fixedLandmarks ?? item.fixed_landmarks) ?? [],
      authority,
    }];
  });
}

function normalizeFinalTransitionPlan(
  value: unknown,
  context: { warnings: string[]; anchorIds: Set<string> },
): FinalTransitionPlan[] {
  return arrayOfRecords(value).flatMap((item) => {
    const fromSegmentNo = numberFrom(item.fromSegmentNo ?? item.from_segment_no);
    const toSegmentNo = numberFrom(item.toSegmentNo ?? item.to_segment_no);
    if (!fromSegmentNo || !toSegmentNo) return [];
    const matchAnchorId = safeId(item.matchAnchorId ?? item.match_anchor_id, "");
    if (matchAnchorId && !context.anchorIds.has(matchAnchorId)) {
      context.warnings.push(`finalTransitionPlan ${fromSegmentNo}->${toSegmentNo} references missing anchor ${matchAnchorId}`);
    }
    return [{
      fromSegmentNo,
      toSegmentNo,
      visualMode: normalizeFinalVisualMode(item.visualMode ?? item.visual_mode),
      audioMode: normalizeFinalAudioMode(item.audioMode ?? item.audio_mode),
      overlapSeconds: clamp(numberFrom(item.overlapSeconds ?? item.overlap_seconds), 0, 3),
      matchAnchorId: matchAnchorId || undefined,
      generatedBridgeRequired: booleanOr(item.generatedBridgeRequired ?? item.generated_bridge_required, false),
    }];
  }).slice(0, 40);
}

function normalizeReferenceSelectionOutputs(
  value: unknown,
  context: { warnings: string[] },
): ReferenceSelectionOutput[] {
  return arrayOfRecords(value).flatMap((item, index) => {
    const targetArtifactId = safeId(item.targetArtifactId ?? item.target_artifact_id, `target_${index + 1}`);
    const selectedArtifactIds = normalizeStringArray(item.selectedArtifactIds ?? item.selected_artifact_ids) ?? [];
    const candidates = arrayOfRecords(item.candidates).map((candidate) => ({
      artifactId: safeId(candidate.artifactId ?? candidate.artifact_id, ""),
      url: stringOr(candidate.url, "") || undefined,
      sourceType: normalizeReferenceSourceType(candidate.sourceType ?? candidate.source_type),
      quotaType: normalizeReferenceQuotaType(candidate.quotaType ?? candidate.quota_type),
      purpose: stringOr(candidate.purpose, ""),
      relevanceScore: normalizeScore(candidate.relevanceScore ?? candidate.relevance_score),
      conflictScore: normalizeScore(candidate.conflictScore ?? candidate.conflict_score),
      recencyScore: normalizeScore(candidate.recencyScore ?? candidate.recency_score),
      viewMatchScore: normalizeScore(candidate.viewMatchScore ?? candidate.view_match_score),
      finalScore: normalizeScore(candidate.finalScore ?? candidate.final_score),
      anchorId: stringOr(candidate.anchorId ?? candidate.anchor_id, "") || undefined,
      assetView: normalizeAssetView(candidate.assetView ?? candidate.asset_view),
      hardRequired: booleanOr(candidate.hardRequired ?? candidate.hard_required, false),
      conflictReasons: normalizeStringArray(candidate.conflictReasons ?? candidate.conflict_reasons) ?? [],
      detectedOrientation: normalizeReferenceOrientation(candidate.detectedOrientation ?? candidate.detected_orientation),
      selected: booleanOr(candidate.selected, false),
      rejectionReason: stringOr(candidate.rejectionReason ?? candidate.rejection_reason, ""),
      usageNote: stringOr(candidate.usageNote ?? candidate.usage_note, ""),
    })).filter((candidate) => candidate.artifactId).slice(0, 20);
    const selectedCandidateIds = new Set(candidates.filter((candidate) => candidate.selected).map((candidate) => candidate.artifactId));
    for (const artifactId of selectedArtifactIds) {
      if (candidates.length && !selectedCandidateIds.has(artifactId)) context.warnings.push(`referenceSelection ${targetArtifactId} selected missing candidate ${artifactId}`);
    }
    return [{
      targetArtifactId,
      targetType: normalizeReferenceTargetType(item.targetType ?? item.target_type),
      selectedArtifactIds,
      selectedReferenceUrls: normalizeStringArray(item.selectedReferenceUrls ?? item.selected_reference_urls) ?? [],
      candidates,
      usageNotes: normalizeStringArray(item.usageNotes ?? item.usage_notes) ?? [],
      finalTextPrompt: stringOr(item.finalTextPrompt ?? item.final_text_prompt, ""),
      targetOrientation: normalizeReferenceOrientation(item.targetOrientation ?? item.target_orientation),
      selectedView: normalizeAssetView(item.selectedView ?? item.selected_view),
      orientationFallbackReason: stringOr(item.orientationFallbackReason ?? item.orientation_fallback_reason, "") || undefined,
      selectionPolicyVersion: stringOr(item.selectionPolicyVersion ?? item.selection_policy_version, "") || undefined,
      warnings: normalizeStringArray(item.warnings) ?? [],
    }];
  }).slice(0, 80);
}

function normalizeAudioBible(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return {
    overallStrategyZh: stringOr(value.overallStrategyZh ?? value.overall_strategy_zh, ""),
    voiceConsistencyZh: stringOr(value.voiceConsistencyZh ?? value.voice_consistency_zh, ""),
    musicMoodZh: stringOr(value.musicMoodZh ?? value.music_mood_zh, ""),
    soundEffectRulesZh: stringOr(value.soundEffectRulesZh ?? value.sound_effect_rules_zh, ""),
  };
}

function normalizePromptDebugArtifacts(value: unknown): Record<string, PromptDebugArtifact> {
  if (!isRecord(value)) return {};
  const out: Record<string, PromptDebugArtifact> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue;
    const targetArtifactId = safeId(raw.targetArtifactId ?? raw.target_artifact_id ?? key, key);
    out[targetArtifactId] = {
      targetArtifactId,
      targetType: normalizeReferenceTargetType(raw.targetType ?? raw.target_type),
      compilerVersion: stringOr(raw.compilerVersion ?? raw.compiler_version, "v1"),
      inputs: isRecord(raw.inputs) ? raw.inputs : {},
      selectedReferenceUrls: normalizeStringArray(raw.selectedReferenceUrls ?? raw.selected_reference_urls) ?? [],
      referenceUsageNotes: normalizeStringArray(raw.referenceUsageNotes ?? raw.reference_usage_notes) ?? [],
      beforePrompt: stringOr(raw.beforePrompt ?? raw.before_prompt, ""),
      finalPrompt: stringOr(raw.finalPrompt ?? raw.final_prompt, ""),
      finalNegativePrompt: stringOr(raw.finalNegativePrompt ?? raw.final_negative_prompt, ""),
      rules: normalizeStringArray(raw.rules) ?? [],
      warnings: normalizeStringArray(raw.warnings) ?? [],
      createdAt: stringOr(raw.createdAt ?? raw.created_at, ""),
    };
  }
  return out;
}

function normalizeArtifactMetadata(value: unknown): Record<string, ArtifactMetadata> {
  if (!isRecord(value)) return {};
  const out: Record<string, ArtifactMetadata> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue;
    out[safeId(key, key)] = {
      artifactId: stringOr(raw.artifactId ?? raw.artifact_id, key),
      artifactType: stringOr(raw.artifactType ?? raw.artifact_type, "unknown"),
      producedByStage: stringOr(raw.producedByStage ?? raw.produced_by_stage, "unknown"),
      revision: Math.max(1, numberFrom(raw.revision) || 1),
      schemaVersion: stringOr(raw.schemaVersion ?? raw.schema_version, ""),
      plannerVersion: stringOr(raw.plannerVersion ?? raw.planner_version, ""),
      promptVersion: stringOr(raw.promptVersion ?? raw.prompt_version, ""),
      modelVersion: stringOr(raw.modelVersion ?? raw.model_version, ""),
      inputHash: stringOr(raw.inputHash ?? raw.input_hash, ""),
      dependsOn: normalizeStringArray(raw.dependsOn ?? raw.depends_on) ?? [],
      invalidatedByArtifactIds: normalizeStringArray(raw.invalidatedByArtifactIds ?? raw.invalidated_by_artifact_ids) ?? [],
      parentRevisionIds: normalizeStringArray(raw.parentRevisionIds ?? raw.parent_revision_ids) ?? [],
      userAccepted: booleanOr(raw.userAccepted ?? raw.user_accepted, false),
      status: normalizeArtifactStatus(raw.status),
      dirtyReason: stringOr(raw.dirtyReason ?? raw.dirty_reason, ""),
      retryFromStage: normalizeArtifactRetryFromStage(raw.retryFromStage ?? raw.retry_from_stage),
      updatedAt: stringOr(raw.updatedAt ?? raw.updated_at, ""),
    };
  }
  return out;
}

function normalizeGenerationQualityReports(value: unknown): GenerationQualityReport[] {
  return arrayOfRecords(value).flatMap((item) => {
    const assetId = safeId(item.assetId ?? item.asset_id, "");
    if (!assetId) return [];
    return [{
      assetId,
      identityScore: normalizeScore(item.identityScore ?? item.identity_score),
      layoutScore: normalizeScore(item.layoutScore ?? item.layout_score),
      promptAlignmentScore: normalizeScore(item.promptAlignmentScore ?? item.prompt_alignment_score),
      continuityScore: normalizeScore(item.continuityScore ?? item.continuity_score),
      singleTakeScore: item.singleTakeScore != null || item.single_take_score != null
        ? normalizeScore(item.singleTakeScore ?? item.single_take_score)
        : undefined,
      artifactIssues: normalizeStringArray(item.artifactIssues ?? item.artifact_issues) ?? [],
      passed: booleanOr(item.passed, false),
      retryInstruction: stringOr(item.retryInstruction ?? item.retry_instruction, ""),
    }];
  }).slice(0, 120);
}


function normalizePlanningManifest(raw: unknown, input: PlanVideoProjectInput, fallback: OnePromptVideoPlan): VideoPlanningManifest {
  const envelope = isRecord(raw) ? raw : {};
  const root = isRecord(envelope.planning_manifest) ? envelope.planning_manifest : envelope;
  const topLevelCandidateTimeline = readLoose(envelope, "candidateTimeline", "candidate_timeline");
  const timelineRaw = isRecord(root.timelineBlueprint)
    ? root.timelineBlueprint
    : isRecord(root.timeline_blueprint)
      ? root.timeline_blueprint
      : Array.isArray(topLevelCandidateTimeline)
        ? { segments: topLevelCandidateTimeline }
        : {};
  const bounds = segmentCountBounds(input.durationSeconds);
  const rawSegments = arrayOfRecords(timelineRaw.segments);
  const selectedCount = clamp(
    numberFrom(timelineRaw.segmentCount ?? timelineRaw.segment_count) || rawSegments.length || input.shotCount || fallback.segmentCount,
    bounds.min,
    bounds.max,
  );
  const timelineSegments = normalizeTimelineSegments(rawSegments, selectedCount, input.durationSeconds, fallback);
  const anchors = normalizeAnchors(
    isRecord(root.consistencyManifest)
      ? root.consistencyManifest.anchors
      : isRecord(root.consistency_manifest)
        ? root.consistency_manifest.anchors
        : isRecord(envelope.consistencyManifest)
          ? envelope.consistencyManifest.anchors
          : isRecord(envelope.consistency_manifest)
            ? envelope.consistency_manifest.anchors
        : [],
  );
  const projectIntent = isRecord(root.projectIntent) ? root.projectIntent : isRecord(root.project_intent) ? root.project_intent : {};
  const storyStrategy = isRecord(root.storyStrategy) ? root.storyStrategy : isRecord(root.story_strategy) ? root.story_strategy : {};
  const subtitlePolicyRaw = isRecord(root.subtitlePolicy) ? root.subtitlePolicy : isRecord(root.subtitle_policy) ? root.subtitle_policy : {};
  const globalStyle = isRecord(root.globalStyle) ? root.globalStyle : isRecord(root.global_style) ? root.global_style : {};
  return {
    projectIntent: {
      videoType: stringOr(projectIntent.videoType ?? projectIntent.video_type, ""),
      primaryGoalZh: stringOr(projectIntent.primaryGoalZh ?? projectIntent.primary_goal_zh, ""),
      primaryGoalEn: stringOr(projectIntent.primaryGoalEn ?? projectIntent.primary_goal_en, ""),
      targetViewerZh: stringOr(projectIntent.targetViewerZh ?? projectIntent.target_viewer_zh, ""),
      targetViewerEn: stringOr(projectIntent.targetViewerEn ?? projectIntent.target_viewer_en, ""),
      successCriteria: normalizeStringArray(projectIntent.successCriteria ?? projectIntent.success_criteria),
    },
    storyStrategy: {
      narrativeArcZh: stringOr(storyStrategy.narrativeArcZh ?? storyStrategy.narrative_arc_zh, ""),
      narrativeArcEn: stringOr(storyStrategy.narrativeArcEn ?? storyStrategy.narrative_arc_en, ""),
      recommendedSegmentDensity: normalizeSegmentDensity(storyStrategy.recommendedSegmentDensity ?? storyStrategy.recommended_segment_density),
      subtitleStrategyZh: stringOr(storyStrategy.subtitleStrategyZh ?? storyStrategy.subtitle_strategy_zh, ""),
      audioStrategyZh: stringOr(storyStrategy.audioStrategyZh ?? storyStrategy.audio_strategy_zh, ""),
    },
    subtitlePolicy: normalizeSubtitlePolicy(subtitlePolicyRaw, stringOr(storyStrategy.subtitleStrategyZh ?? storyStrategy.subtitle_strategy_zh, "")),
    timelineBlueprint: {
      segmentCount: timelineSegments.length,
      totalDurationSeconds: input.durationSeconds,
      segmentDurationMinSeconds: MIN_SEGMENT_SECONDS,
      segmentDurationMaxSeconds: MAX_SEGMENT_SECONDS,
      splitStrategyZh: stringOr(timelineRaw.splitStrategyZh ?? timelineRaw.split_strategy_zh, ""),
      segments: timelineSegments,
    },
    consistencyManifest: { anchors },
    globalStyle: {
      visualStyle: stringOr(globalStyle.visualStyle ?? globalStyle.visual_style, fallback.styleBible.visualStyle),
      colorPalette: stringOr(globalStyle.colorPalette ?? globalStyle.color_palette, fallback.styleBible.colorPalette),
      colorToneLock: stringOr(globalStyle.colorToneLock ?? globalStyle.color_tone_lock, fallback.styleBible.colorToneLock ?? fallback.styleBible.colorPalette),
      lightingToneLock: stringOr(globalStyle.lightingToneLock ?? globalStyle.lighting_tone_lock, fallback.styleBible.lightingToneLock ?? ""),
      negativePrompt: stringOr(globalStyle.negativePrompt ?? globalStyle.negative_prompt, fallback.styleBible.negativePrompt),
    },
    risks: arrayOfRecords(root.risks).map((risk) => ({
      type: stringOr(risk.type, ""),
      descriptionZh: stringOr(risk.descriptionZh ?? risk.description_zh, ""),
      mitigationZh: stringOr(risk.mitigationZh ?? risk.mitigation_zh, ""),
    })),
  };
}

function mergeRepairedAssetAnchors(
  manifest: VideoPlanningManifest,
  repairRaw: unknown,
): VideoPlanningManifest {
  const root = isRecord(repairRaw) ? repairRaw : {};
  const repaired = normalizeAnchors(
    root.anchors
      ?? (isRecord(root.consistency_manifest) ? root.consistency_manifest.anchors : undefined)
      ?? (isRecord(root.consistencyManifest) ? root.consistencyManifest.anchors : undefined),
  );
  const repairedById = new Map(repaired.map((anchor) => [anchor.id, anchor]));
  return {
    ...manifest,
    consistencyManifest: {
      anchors: manifest.consistencyManifest.anchors.map((anchor) => {
        const replacement = repairedById.get(anchor.id);
        if (!replacement) return anchor;
        return {
          ...anchor,
          assetImageContract: replacement.assetImageContract,
        };
      }),
    },
  };
}

function assetPromptDisplayZh(anchor: VideoConsistencyAnchor): string {
  const candidates = [
    anchor.imagePromptZh,
    anchor.descriptionZh,
    anchor.displayNameZh,
  ];
  return candidates.find((value) => isChinesePromptDisplayCopy(value))?.trim() ?? "";
}

function materializePlanningAssetImagePrompts(manifest: VideoPlanningManifest): VideoPlanningManifest {
  return {
    ...manifest,
    consistencyManifest: {
      anchors: manifest.consistencyManifest.anchors.map((anchor) => {
        if (!anchor.assetImageContract) return anchor;
        return {
          ...anchor,
          // English is the sole executable generation contract. Chinese is a
          // best-effort presentation field and is never validated as a gate.
          imagePromptZh: assetPromptDisplayZh(anchor),
          imagePromptEn: compileAssetImagePromptEn(anchor),
        };
      }),
    },
  };
}

export function assemblePlanningAssetSpecs(
  planningRaw: unknown,
  anchors: VideoConsistencyAnchor[],
): Record<string, unknown> {
  const envelope = isRecord(planningRaw) ? { ...planningRaw } : {};
  const existingTopLevelManifest = isRecord(envelope.consistency_manifest)
    ? envelope.consistency_manifest
    : isRecord(envelope.consistencyManifest)
      ? envelope.consistencyManifest
      : {};
  const planningManifest = isRecord(envelope.planning_manifest)
    ? { ...envelope.planning_manifest }
    : isRecord(envelope.planningManifest)
      ? { ...envelope.planningManifest }
      : {};
  const existingNestedManifest = isRecord(planningManifest.consistency_manifest)
    ? planningManifest.consistency_manifest
    : isRecord(planningManifest.consistencyManifest)
      ? planningManifest.consistencyManifest
      : {};
  return {
    ...envelope,
    consistency_manifest: {
      ...existingTopLevelManifest,
      anchors,
    },
    planning_manifest: {
      ...planningManifest,
      consistency_manifest: {
        ...existingNestedManifest,
        anchors,
      },
    },
  };
}

function assetVisualSpecFingerprint(
  anchor: VideoConsistencyAnchor,
  manifest: VideoPlanningManifest,
  input: PlanVideoProjectInput,
): string {
  return createHash("sha256").update(JSON.stringify({
    version: "asset-visual-spec-v3",
    userPrompt: input.userPrompt,
    aspectRatio: input.aspectRatio,
    anchor: {
      id: anchor.id,
      type: anchor.type,
      displayNameZh: anchor.displayNameZh,
      displayNameEn: anchor.displayNameEn,
      descriptionZh: anchor.descriptionZh,
      descriptionEn: anchor.descriptionEn,
      visualLock: anchor.visualLock,
      referenceStrength: anchor.referenceStrength,
    },
    globalStyle: manifest.globalStyle,
  })).digest("hex");
}

function normalizeDetailedAssetAnchor(
  baseAnchor: VideoConsistencyAnchor,
  raw: unknown,
): VideoConsistencyAnchor {
  const envelope = isRecord(raw) ? raw : {};
  const rawAnchor = isRecord(envelope.anchor)
    ? envelope.anchor
    : arrayOfRecords(envelope.anchors)[0] ?? envelope;
  const mergedManifest = mergeRepairedAssetAnchors({
    projectIntent: {
      videoType: "",
      primaryGoalZh: "",
      primaryGoalEn: "",
      targetViewerZh: "",
      targetViewerEn: "",
    },
    storyStrategy: {
      narrativeArcZh: "",
      narrativeArcEn: "",
      recommendedSegmentDensity: "medium",
      subtitleStrategyZh: "",
      audioStrategyZh: "",
    },
    timelineBlueprint: {
      segmentCount: 0,
      totalDurationSeconds: 0,
      segmentDurationMinSeconds: MIN_SEGMENT_SECONDS,
      segmentDurationMaxSeconds: MAX_SEGMENT_SECONDS,
      splitStrategyZh: "",
      segments: [],
    },
    consistencyManifest: { anchors: [baseAnchor] },
    globalStyle: {
      visualStyle: "",
      colorPalette: "",
      colorToneLock: "",
      lightingToneLock: "",
      negativePrompt: "",
    },
    risks: [],
  }, {
    anchors: [{
      ...baseAnchor,
      ...rawAnchor,
      id: baseAnchor.id,
      type: baseAnchor.type,
    }],
  });
  return materializePlanningAssetImagePrompts(mergedManifest).consistencyManifest.anchors[0];
}

async function detailPlanningAssetVisualSpecs(params: {
  input: PlanVideoProjectInput;
  modelName: string;
  planningManifest: VideoPlanningManifest;
  checkpoint: AliyunStoryboardPlannerCheckpoint;
  onCheckpoint?: (checkpoint: AliyunStoryboardPlannerCheckpoint) => Promise<void> | void;
}): Promise<VideoPlanningManifest> {
  const eligibility = params.planningManifest.consistencyManifest.anchors.map(
    assessAssetVisualSpecEligibility,
  );
  const preflightManifest: VideoPlanningManifest = {
    ...params.planningManifest,
    consistencyManifest: {
      ...params.planningManifest.consistencyManifest,
      anchors: eligibility.map((item) => item.anchor),
    },
  };
  const targets = eligibility.filter((item) => item.eligible).map((item) => item.anchor);
  const skipped = eligibility.filter((item) => !item.eligible);
  if (skipped.length) {
    const skippedIds = new Set(skipped.map((item) => item.anchor.id));
    params.checkpoint.assetVisualSpecsByAnchorId = Object.fromEntries(
      Object.entries(params.checkpoint.assetVisualSpecsByAnchorId ?? {})
        .filter(([anchorId]) => !skippedIds.has(anchorId)),
    );
    params.checkpoint.assetVisualSpecFingerprints = Object.fromEntries(
      Object.entries(params.checkpoint.assetVisualSpecFingerprints ?? {})
        .filter(([anchorId]) => !skippedIds.has(anchorId)),
    );
    await logOnePromptVideo("aliyun.storyboard.asset_visual_spec.skipped_ineligible", {
      skippedCount: skipped.length,
      billableCallCountAvoided: skipped.length,
      anchors: skipped.map((item) => ({
        anchorId: item.anchor.id,
        type: item.anchor.type,
        semanticRole: item.anchor.semanticRole,
        needsReferenceImage: item.anchor.needsReferenceImage,
        reason: item.reason,
      })),
    });
    await savePlannerCheckpoint(params.checkpoint, params.onCheckpoint);
  }
  if (!targets.length) {
    if (clearPlannerCheckpointFailureAfterStageSuccess(
      params.checkpoint,
      "asset_visual_spec",
    )) {
      await savePlannerCheckpoint(params.checkpoint, params.onCheckpoint);
    }
    return preflightManifest;
  }

  await reportPlannerProgress({
    stage: "asset_visual_spec",
    completedSegments: 0,
    totalSegments: targets.length,
    detailZh: `正在并行细化 ${targets.length} 个一致性资产的可执行视觉规格。`,
    detailEn: `Detailing executable visual specifications for ${targets.length} consistency assets in parallel.`,
  });
  let completed = 0;
  const batchController = new AbortController();
  const activeAnchorIds = new Set<string>();
  let batchFailure: { anchorId: string; error: unknown; cancelRequestedFor: string[] } | undefined;
  let detailed: VideoConsistencyAnchor[];
  try {
    detailed = await mapWithConcurrency(
      targets,
      assetVisualSpecConcurrency(),
      async (anchor) => {
        activeAnchorIds.add(anchor.id);
        try {
      throwIfBatchCancelled(`asset_visual_spec_${anchor.id}`, batchController.signal);
      const callGate = assessAssetVisualSpecEligibility(anchor);
      if (!callGate.eligible) {
        await logOnePromptVideo("aliyun.storyboard.asset_visual_spec.skipped_at_call_gate", {
          anchorId: callGate.anchor.id,
          type: callGate.anchor.type,
          semanticRole: callGate.anchor.semanticRole,
          needsReferenceImage: callGate.anchor.needsReferenceImage,
          reason: callGate.reason,
          billableCallCountAvoided: 1,
        });
        return callGate.anchor;
      }
      const fingerprint = assetVisualSpecFingerprint(
        callGate.anchor,
        preflightManifest,
        params.input,
      );
      const cachedRaw = params.checkpoint.assetVisualSpecFingerprints?.[anchor.id] === fingerprint
        ? params.checkpoint.assetVisualSpecsByAnchorId?.[anchor.id]
        : undefined;
      if (cachedRaw) {
        const cached = normalizeDetailedAssetAnchor(anchor, cachedRaw);
        const cachedIssues = [
          ...validatePlanningAssetImageContracts([cached]),
          ...validatePlanningAssetExecutionPrompts([cached]),
        ];
        if (cached.assetImageContract && !cachedIssues.length) {
          completed += 1;
          await reportPlannerProgress({
            stage: "asset_visual_spec",
            completedSegments: completed,
            totalSegments: targets.length,
            detailZh: `已复用资产 ${anchor.displayNameZh || anchor.id} 的视觉规格。`,
            detailEn: `Reused the visual specification for ${anchor.displayNameEn || anchor.id}.`,
          });
          return cached;
        }
      }

      let validationFeedback: AssetImageContractIssue[] = [];
      const raw = await runStoryboardStageWithRetry({
        stage: `asset_visual_spec_${anchor.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
        maxAttempts: assetVisualSpecMaxAttempts(),
        baseDelayMs: 0,
        signal: batchController.signal,
        run: async () => {
          const repairPlan = validationFeedback.length
            ? buildModelRepairPlan({
                targetStage: "asset_visual_spec_repair",
                issues: validationFeedback,
                scope: { kind: "anchors", anchorIds: [anchor.id] },
                preserveRules: [
                  "Preserve the anchor id, type, identity descriptions, visual lock, and reference strength.",
                  "Modify only asset_image_contract.",
                ],
              })
            : undefined;
          const result = await executeStructuredStage({
            stage: `asset_visual_spec_${anchor.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
            modelName: params.modelName,
            systemPrompt: validationFeedback.length
              ? `${ASSET_VISUAL_SPEC_DETAILER_SYSTEM_PROMPT}

The previous response failed deterministic validation. Return a complete corrected anchor.
Validation issues: ${formatAssetContractIssues(validationFeedback)}
${STRUCTURED_REPAIR_EXECUTION_RULES}`
              : ASSET_VISUAL_SPEC_DETAILER_SYSTEM_PROMPT,
            userContent: JSON.stringify({
              user_idea: params.input.userPrompt,
              aspect_ratio: params.input.aspectRatio,
              global_style: params.planningManifest.globalStyle,
              anchor,
              repair_plan: repairPlan,
            }),
            temperature: 0.15,
            maxTokens: 1400,
            signal: batchController.signal,
          });
          const candidate = normalizeDetailedAssetAnchor(anchor, result);
          validationFeedback = [
            ...validatePlanningAssetImageContracts([candidate]),
            ...validatePlanningAssetExecutionPrompts([candidate]),
          ];
          if (!candidate.assetImageContract) {
            validationFeedback = [{
              anchorId: anchor.id,
              field: "assetImageContract",
              message: "asset visual spec detailer did not return a structured contract",
            }];
          }
          if (validationFeedback.length) {
            throw new StoryboardStageError(
              `Asset ${anchor.id} visual specification is invalid: ${formatAssetContractIssues(validationFeedback)}`,
              { code: "contract_validation_error", retryable: true },
            );
          }
          return candidate;
        },
      });
      throwIfBatchCancelled(`asset_visual_spec_${anchor.id}`, batchController.signal);
      params.checkpoint.assetVisualSpecsByAnchorId = {
        ...(params.checkpoint.assetVisualSpecsByAnchorId ?? {}),
        [anchor.id]: raw as unknown as Record<string, unknown>,
      };
      params.checkpoint.assetVisualSpecFingerprints = {
        ...(params.checkpoint.assetVisualSpecFingerprints ?? {}),
        [anchor.id]: fingerprint,
      };
      await savePlannerCheckpoint(params.checkpoint, params.onCheckpoint);
      throwIfBatchCancelled(`asset_visual_spec_${anchor.id}`, batchController.signal);
      completed += 1;
      await reportPlannerProgress({
        stage: "asset_visual_spec",
        completedSegments: completed,
        totalSegments: targets.length,
        detailZh: `资产 ${anchor.displayNameZh || anchor.id} 的视觉规格已通过程序校验。`,
        detailEn: `The visual specification for ${anchor.displayNameEn || anchor.id} passed deterministic validation.`,
      });
      return raw;
        } catch (error) {
          if (!batchController.signal.aborted) {
            const cancelRequestedFor = [...activeAnchorIds]
              .filter((anchorId) => anchorId !== anchor.id);
            batchFailure = { anchorId: anchor.id, error, cancelRequestedFor };
            batchController.abort(new DOMException(
              `Asset visual specification ${anchor.id} failed; cancel peer requests.`,
              "AbortError",
            ));
            await logOnePromptVideo("aliyun.storyboard.asset_visual_spec.batch_cancel_requested", {
              failedAnchorId: anchor.id,
              cancelRequestedFor,
              error: errorForLog(error),
            }, "warn");
          }
          throw error;
        } finally {
          activeAnchorIds.delete(anchor.id);
        }
      },
    );
  } catch (error) {
    const rootFailure = batchFailure;
    if (rootFailure) {
      await logOnePromptVideo("aliyun.storyboard.asset_visual_spec.batch_cancel_settled", {
        failedAnchorId: rootFailure.anchorId,
        cancelRequestedFor: rootFailure.cancelRequestedFor,
        activeAnchorCountAfterSettlement: activeAnchorIds.size,
      }, "warn");
      throw rootFailure.error;
    }
    throw error;
  }
  const detailedById = new Map(detailed.map((anchor) => [anchor.id, anchor]));
  if (clearPlannerCheckpointFailureAfterStageSuccess(
    params.checkpoint,
    "asset_visual_spec",
  )) {
    await savePlannerCheckpoint(params.checkpoint, params.onCheckpoint);
  }
  return {
    ...preflightManifest,
    consistencyManifest: {
      ...preflightManifest.consistencyManifest,
      anchors: preflightManifest.consistencyManifest.anchors.map(
        (anchor) => detailedById.get(anchor.id) ?? anchor,
      ),
    },
  };
}

function formatAssetContractIssues(issues: AssetImageContractIssue[]): string {
  return issues
    .slice(0, 12)
    .map((issue) => `${issue.anchorId}.${issue.field}: ${issue.message}`)
    .join("；");
}

function normalizeSubtitlePolicy(raw: Record<string, unknown>, fallbackStrategyZh: string): NonNullable<VideoPlanningManifest["subtitlePolicy"]> {
  const contentRole = normalizeSubtitleContentRole(raw.contentRole ?? raw.content_role);
  const neededRaw = raw.needed ?? raw.needs_subtitles ?? raw.need_subtitles;
  const hasStrategy = Boolean(fallbackStrategyZh.trim());
  const needed = typeof neededRaw === "boolean" ? neededRaw : contentRole !== "none" || hasStrategy;
  return {
    needed,
    reasonZh: stringOr(raw.reasonZh ?? raw.reason_zh, needed ? fallbackStrategyZh : ""),
    contentRole: needed ? contentRole : "none",
    language: stringOr(raw.language, "zh-CN"),
    styleZh: stringOr(raw.styleZh ?? raw.style_zh, fallbackStrategyZh || "短句字幕，保持画面高级感"),
    timingStrategyZh: stringOr(raw.timingStrategyZh ?? raw.timing_strategy_zh, "跟随分镜节奏出现，每个分镜一条短字幕或留空"),
    placementZh: stringOr(raw.placementZh ?? raw.placement_zh, "默认底部居中，避开主体面部、产品和品牌留白区域"),
    maxCharsPerLine: clamp(numberFrom(raw.maxCharsPerLine ?? raw.max_chars_per_line) || 14, 8, 24),
    maxLines: clamp(numberFrom(raw.maxLines ?? raw.max_lines) || 2, 1, 3),
    avoidRegionsZh: normalizeStringArray(raw.avoidRegionsZh ?? raw.avoid_regions_zh),
    userEditable: typeof raw.userEditable === "boolean"
      ? raw.userEditable
      : typeof raw.user_editable === "boolean"
        ? raw.user_editable
        : true,
  };
}

function normalizeSubtitleContentRole(value: unknown): NonNullable<VideoPlanningManifest["subtitlePolicy"]>["contentRole"] {
  const raw = String(value ?? "").trim();
  if (!raw) return "none";
  const allowed = new Set(["none", "brand_slogan", "product_selling_points", "voiceover_caption", "dialogue_caption", "emotional_copy", "instructional_steps", "custom"]);
  return allowed.has(raw) ? raw as NonNullable<VideoPlanningManifest["subtitlePolicy"]>["contentRole"] : "custom";
}

function normalizeTimelineSegments(
  rawSegments: Record<string, unknown>[],
  count: number,
  totalSeconds: number,
  fallback: OnePromptVideoPlan,
): VideoTimelineBlueprintSegment[] {
  const durations = normalizeDurations(rawSegments, count, totalSeconds);
  let cursor = 0;
  return Array.from({ length: count }, (_, index) => {
    const segmentNo = index + 1;
    const raw = rawSegments.find((item) => numberFrom(item.segmentNo ?? item.segment_no) === segmentNo) ?? rawSegments[index] ?? {};
    const fallbackSegment = fallback.segments[index] ?? fallback.segments[fallback.segments.length - 1];
    const start = cursor;
    const duration = durations[index];
    const end = start + duration;
    cursor = end;
    const timingBudgetRaw = isRecord(raw.timingBudget)
      ? raw.timingBudget
      : isRecord(raw.timing_budget)
        ? raw.timing_budget
        : {};
    return {
      segmentNo,
      startTimeSeconds: start,
      endTimeSeconds: end,
      durationSeconds: duration,
      durationReasonZh: stringOr(raw.durationReasonZh ?? raw.duration_reason_zh, ""),
      minimumExecutableSeconds: numberFrom(raw.minimumExecutableSeconds ?? raw.minimum_executable_seconds) || undefined,
      preferredDurationSeconds: numberFrom(raw.preferredDurationSeconds ?? raw.preferred_duration_seconds) || undefined,
      maximumUsefulSeconds: numberFrom(raw.maximumUsefulSeconds ?? raw.maximum_useful_seconds) || undefined,
      timingBudget: Object.keys(timingBudgetRaw).length ? {
        setupSeconds: numberFrom(timingBudgetRaw.setupSeconds ?? timingBudgetRaw.setup_seconds),
        actionSeconds: numberFrom(timingBudgetRaw.actionSeconds ?? timingBudgetRaw.action_seconds),
        resultSeconds: numberFrom(timingBudgetRaw.resultSeconds ?? timingBudgetRaw.result_seconds),
      } : undefined,
      beatRole: normalizeBeatRole(raw.beatRole ?? raw.beat_role),
      purposeZh: stringOr(raw.purposeZh ?? raw.purpose_zh ?? raw.purpose, fallbackSegment.purposeZh ?? fallbackSegment.purpose),
      purposeEn: stringOr(raw.purposeEn ?? raw.purpose_en, fallbackSegment.purposeEn ?? ""),
      splitReasonZh: stringOr(raw.splitReasonZh ?? raw.split_reason_zh, ""),
      subtitleIntentZh: stringOr(raw.subtitleIntentZh ?? raw.subtitle_intent_zh, ""),
      audioIntentZh: stringOr(raw.audioIntentZh ?? raw.audio_intent_zh, ""),
      requiredAnchorIds: normalizeStringArray(raw.requiredAnchorIds ?? raw.required_anchor_ids) ?? [],
      sourceEventIds: normalizeStringArray(raw.sourceEventIds ?? raw.source_event_ids) ?? [],
      boundaryModeHint: normalizeBoundaryMode(raw.boundaryModeHint ?? raw.boundary_mode_hint),
    };
  });
}

function normalizeDurations(rawSegments: Record<string, unknown>[], count: number, totalSeconds: number): number[] {
  if (rawSegments.length !== count) {
    throw new Error(`Duration contract expected ${count} segments but received ${rawSegments.length}.`);
  }
  const durations = rawSegments.map((raw, index) => {
    const duration = strictInteger(raw.durationSeconds ?? raw.duration_seconds);
    if (duration === undefined || duration < MIN_SEGMENT_SECONDS || duration > MAX_SEGMENT_SECONDS) {
      throw new Error(`Segment ${index + 1} has no valid model-allocated duration.`);
    }
    return duration;
  });
  const allocatedTotal = durations.reduce((sum, value) => sum + value, 0);
  if (allocatedTotal !== totalSeconds) {
    throw new Error(`Model-allocated durations sum to ${allocatedTotal}; expected ${totalSeconds}.`);
  }
  return durations;
}

function normalizeAnchors(value: unknown): VideoConsistencyAnchor[] {
  return arrayOfRecords(value).flatMap((item, index) => {
    const type = normalizeAnchorType(item.type);
    if (!type) return [];
    const id = stringOr(item.id, `${type}_${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, "_");
    return [normalizeAnchorSemantics({
      id,
      type,
      displayNameZh: stringOr(item.displayNameZh ?? item.display_name_zh ?? item.display_name, ""),
      displayNameEn: stringOr(item.displayNameEn ?? item.display_name_en, ""),
      mustStayConsistent: item.mustStayConsistent === false || item.must_stay_consistent === false ? false : true,
      needsReferenceImage: item.needsReferenceImage === true || item.needs_reference_image === true,
      referenceStrength: normalizeReferenceStrength(item.referenceStrength ?? item.reference_strength),
      descriptionZh: stringOr(item.descriptionZh ?? item.description_zh, ""),
      descriptionEn: stringOr(item.descriptionEn ?? item.description_en, ""),
      visualLock: normalizeVisualLock(item.visualLock ?? item.visual_lock),
      appliesTo: normalizeAppliesTo(item.appliesTo ?? item.applies_to),
      userEditable: item.userEditable === false || item.user_editable === false ? false : true,
      imagePromptZh: stringOr(item.imagePromptZh ?? item.image_prompt_zh, ""),
      imagePromptEn: stringOr(item.imagePromptEn ?? item.image_prompt_en, ""),
      assetImageContract: normalizeAssetImageContract(item.assetImageContract ?? item.asset_image_contract),
      sourceEvidence: arrayOfRecords(item.sourceEvidence ?? item.source_evidence).flatMap((evidence) => {
        const sourceValue = stringOr(evidence.source, "planner");
        const source = sourceValue === "user_requirement"
          || sourceValue === "reference_fact"
          || sourceValue === "narrative_event"
          ? sourceValue
          : "planner";
        const text = stringOr(evidence.text, "");
        if (!text) return [];
        return [{
          source,
          text,
          eventIds: normalizeStringArray(evidence.eventIds ?? evidence.event_ids) ?? [],
        }];
      }),
      candidateCategory: normalizeAnchorCandidateCategory(item.candidateCategory ?? item.candidate_category),
      suggestedAsAnchor: booleanOr(item.suggestedAsAnchor ?? item.suggested_as_anchor, true),
      candidateReason: stringOr(item.candidateReason ?? item.candidate_reason ?? item.reason, ""),
      usedByEventIds: normalizeStringArray(item.usedByEventIds ?? item.used_by_event_ids) ?? [],
      reuseCount: Math.max(0, numberFrom(item.reuseCount ?? item.reuse_count)),
      lockDimensions: normalizeStringArray(item.lockDimensions ?? item.lock_dimensions) ?? [],
      admissionReason: stringOr(item.admissionReason ?? item.admission_reason, ""),
      admissionRule: stringOr(item.admissionRule ?? item.admission_rule, ""),
      admissionScore: numberFrom(item.admissionScore ?? item.admission_score),
      status: normalizeAnchorAdmissionStatus(item.status),
    })];
  }).slice(0, 12);
}

function normalizeAssetImageContract(value: unknown): VideoConsistencyAnchor["assetImageContract"] {
  if (!isRecord(value)) return undefined;
  const composition = isRecord(value.composition) ? value.composition : {};
  const environment = isRecord(value.environment) ? value.environment : {};
  const lighting = isRecord(value.lighting) ? value.lighting : {};
  const renderingStyle = isRecord(value.renderingStyle)
    ? value.renderingStyle
    : isRecord(value.rendering_style)
      ? value.rendering_style
      : {};
  const dimensionalityValue = stringOr(renderingStyle.dimensionality, "").toLowerCase();
  const dimensionality = dimensionalityValue === "2d"
    || dimensionalityValue === "2.5d"
    || dimensionalityValue === "3d"
    || dimensionalityValue === "mixed"
      ? dimensionalityValue
      : undefined;
  const authorityValue = stringOr(renderingStyle.authority, "").toLowerCase();
  const authority = authorityValue === "user_reference"
    || authorityValue === "global_style"
    || authorityValue === "planner"
      ? authorityValue
      : undefined;
  const contract: NonNullable<VideoConsistencyAnchor["assetImageContract"]> = {
    subjectCount: Math.max(0, Math.round(numberFrom(value.subjectCount ?? value.subject_count))),
    subjectDescription: stringOr(value.subjectDescription ?? value.subject_description, ""),
    composition: {
      framing: stringOr(composition.framing, ""),
      cameraAngle: stringOr(composition.cameraAngle ?? composition.camera_angle, ""),
      placement: stringOr(composition.placement, ""),
      occupancy: stringOr(composition.occupancy, ""),
    },
    environment: {
      background: stringOr(environment.background, ""),
      foreground: stringOr(environment.foreground, ""),
      midground: stringOr(environment.midground, ""),
      backgroundLayer: stringOr(environment.backgroundLayer ?? environment.background_layer, ""),
      spatialRelationships: normalizeStringArray(environment.spatialRelationships ?? environment.spatial_relationships),
    },
    lighting: {
      direction: stringOr(lighting.direction, ""),
      quality: stringOr(lighting.quality, ""),
      colorTemperature: stringOr(lighting.colorTemperature ?? lighting.color_temperature, ""),
    },
    renderingStyle: {
      medium: stringOr(renderingStyle.medium, ""),
      dimensionality,
      shading: stringOr(renderingStyle.shading, ""),
      edgeTreatment: stringOr(renderingStyle.edgeTreatment ?? renderingStyle.edge_treatment, ""),
      surfaceTreatment: stringOr(renderingStyle.surfaceTreatment ?? renderingStyle.surface_treatment, ""),
      depthTreatment: stringOr(renderingStyle.depthTreatment ?? renderingStyle.depth_treatment, ""),
      authority,
      forbiddenDrift: normalizeStringArray(renderingStyle.forbiddenDrift ?? renderingStyle.forbidden_drift),
    },
    palette: normalizeStringArray(value.palette),
    materialDetails: normalizeStringArray(value.materialDetails ?? value.material_details),
    intrinsicDetails: normalizeStringArray(value.intrinsicDetails ?? value.intrinsic_details),
    forbiddenElements: normalizeStringArray(value.forbiddenElements ?? value.forbidden_elements),
    acceptanceCriteria: normalizeStringArray(value.acceptanceCriteria ?? value.acceptance_criteria),
    playingCards: normalizePlayingCardContract(value.playingCards ?? value.playing_cards),
  };
  return contract;
}

function normalizeVisualLock(value: unknown): VideoConsistencyAnchor["visualLock"] {
  const source = isRecord(value) ? value : {};
  const lock = {
    shape: stringOr(source.shape, ""),
    material: stringOr(source.material, ""),
    color: stringOr(source.color, ""),
    markings: stringOr(source.markings, ""),
    scale: stringOr(source.scale, ""),
    state: stringOr(source.state, ""),
    forbiddenDrift: normalizeStringArray(source.forbiddenDrift ?? source.forbidden_drift),
  };
  return Object.values(lock).some(Boolean) ? lock : undefined;
}

function normalizePromptDetailPlan(raw: unknown): VideoPromptDetailPlan {
  const root = isRecord(raw) && isRecord(raw.prompt_detail_plan) ? raw.prompt_detail_plan : isRecord(raw) ? raw : {};
  return {
    keyframePrompts: arrayOfRecords(root.keyframePrompts ?? root.keyframe_prompts).flatMap((item) => {
      const keyframeNo = numberFrom(item.keyframeNo ?? item.keyframe_no);
      if (!keyframeNo) return [];
      return [{
        keyframeNo,
        imagePromptZh: stringOr(item.imagePromptZh ?? item.image_prompt_zh, ""),
        imagePromptEn: stringOr(item.imagePromptEn ?? item.image_prompt_en, ""),
        negativePromptZh: stringOr(item.negativePromptZh ?? item.negative_prompt_zh, ""),
        negativePromptEn: stringOr(item.negativePromptEn ?? item.negative_prompt_en, ""),
      }];
    }),
    segmentVideoPrompts: arrayOfRecords(root.segmentVideoPrompts ?? root.segment_video_prompts).flatMap((item) => {
      const segmentNo = numberFrom(item.segmentNo ?? item.segment_no);
      if (!segmentNo) return [];
      return [{
        segmentNo,
        videoPromptZh: stringOr(item.videoPromptZh ?? item.video_prompt_zh, ""),
        videoPromptEn: stringOr(item.videoPromptEn ?? item.video_prompt_en, ""),
        negativePromptZh: stringOr(item.negativePromptZh ?? item.negative_prompt_zh, ""),
        negativePromptEn: stringOr(item.negativePromptEn ?? item.negative_prompt_en, ""),
      }];
    }),
    microShotImagePrompts: arrayOfRecords(root.microShotImagePrompts ?? root.micro_shot_image_prompts).flatMap((item) => {
      const segmentNo = numberFrom(item.segmentNo ?? item.segment_no);
      const microShotNo = numberFrom(item.microShotNo ?? item.micro_shot_no);
      if (!segmentNo || !microShotNo) return [];
      return [{
        segmentNo,
        microShotNo,
        imagePromptZh: stringOr(item.imagePromptZh ?? item.image_prompt_zh, ""),
        imagePromptEn: stringOr(item.imagePromptEn ?? item.image_prompt_en, ""),
      }];
    }),
    generationNotes: normalizeStringArray(root.generationNotes ?? root.generation_notes),
  };
}

function normalizeStyleBible(value: unknown, manifest: VideoPlanningManifest, fallback: VideoStyleBible): VideoStyleBible {
  const source = isRecord(value) ? value : {};
  const anchors = manifest.consistencyManifest.anchors;
  const productLock = anchors
    .filter((anchor) => ["product", "prop", "task_object", "effect_state", "vehicle", "food"].includes(anchor.type))
    .map(anchorLockText)
    .filter(Boolean)
    .join("\n");
  const characterLock = anchors
    .filter((anchor) => anchor.type === "person")
    .map(anchorLockText)
    .filter(Boolean)
    .join("\n");
  return {
    visualStyle: stringOr(source.visualStyle ?? source.visual_style, manifest.globalStyle?.visualStyle || fallback.visualStyle),
    characterLock: stringOr(source.characterLock ?? source.character_lock, characterLock || fallback.characterLock),
    productLock: stringOr(source.productLock ?? source.product_lock, productLock || fallback.productLock || ""),
    colorPalette: stringOr(source.colorPalette ?? source.color_palette, manifest.globalStyle?.colorPalette || fallback.colorPalette),
    colorToneLock: stringOr(source.colorToneLock ?? source.color_tone_lock, manifest.globalStyle?.colorToneLock || fallback.colorToneLock || fallback.colorPalette),
    lightingToneLock: stringOr(source.lightingToneLock ?? source.lighting_tone_lock, manifest.globalStyle?.lightingToneLock || fallback.lightingToneLock || ""),
    negativePrompt: stringOr(source.negativePrompt ?? source.negative_prompt, manifest.globalStyle?.negativePrompt || fallback.negativePrompt),
    negativePromptZh: stringOr(source.negativePromptZh ?? source.negative_prompt_zh, fallback.negativePromptZh ?? ""),
    negativePromptEn: stringOr(source.negativePromptEn ?? source.negative_prompt_en, fallback.negativePromptEn ?? fallback.negativePrompt),
  };
}

function normalizeMicroShotsForSegment(params: {
  value: unknown;
  fallback: VideoMicroShot[] | undefined;
  segmentNo: number;
  startSeconds: number;
  durationSeconds: number;
  segmentPurpose: string;
  segmentCamera: string;
  anchorIds: string[];
  microPromptMap: Map<string, NonNullable<VideoPromptDetailPlan["microShotImagePrompts"]>[number]>;
}): VideoMicroShot[] | undefined {
  const items = arrayOfRecords(params.value).flatMap((item, index) => {
    const microShotNo = numberFrom(item.microShotNo ?? item.micro_shot_no) || index + 1;
    const localTimeSeconds = clamp(numberFrom(item.localTimeSeconds ?? item.local_time_seconds ?? item.startSeconds ?? item.start_seconds), 0, params.durationSeconds);
    const endSeconds = clamp(numberFrom(item.endSeconds ?? item.end_seconds) || localTimeSeconds, 0, params.durationSeconds);
    const detail = params.microPromptMap.get(`${params.segmentNo}:${microShotNo}`);
    const promptZh = enforceSameTakeMicroShotPrompt(stringOr(item.promptZh ?? item.prompt_zh ?? item.visualBeatZh ?? item.visual_beat_zh, ""), "zh");
    const promptEn = enforceSameTakeMicroShotPrompt(stringOr(item.promptEn ?? item.prompt_en ?? item.visualBeatEn ?? item.visual_beat_en, ""), "en");
    const imagePromptZh = enforceSameTakeMicroShotPrompt(stringOr(detail?.imagePromptZh ?? item.imagePromptZh ?? item.image_prompt_zh, ""), "zh");
    const imagePromptEn = enforceSameTakeMicroShotPrompt(stringOr(detail?.imagePromptEn ?? item.imagePromptEn ?? item.image_prompt_en, ""), "en");
    const sceneZh = stringOr(item.sceneZh ?? item.scene_zh, "");
    const sceneEn = stringOr(item.sceneEn ?? item.scene_en, "");
    const actionZh = stringOr(item.actionZh ?? item.action_zh, "");
    const actionEn = stringOr(item.actionEn ?? item.action_en, "");
    const cameraZh = stringOr(item.cameraZh ?? item.camera_zh, "");
    const cameraEn = stringOr(item.cameraEn ?? item.camera_en, "");
    const declaredAnchorIds = normalizeStringArray(item.usesConsistencyAnchors ?? item.uses_consistency_anchors) ?? [];
    const derivedAnchorIds = [...params.anchorIds];
    const anchors = uniqueStrings([...derivedAnchorIds, ...declaredAnchorIds]);
    return [{
      microShotNo,
      localTimeSeconds,
      endSeconds,
      absoluteTimeSeconds: params.startSeconds + localTimeSeconds,
      purpose: stringOr(item.purposeZh ?? item.purpose_zh ?? item.purpose, params.segmentPurpose),
      purposeZh: stringOr(item.purposeZh ?? item.purpose_zh, ""),
      purposeEn: stringOr(item.purposeEn ?? item.purpose_en, ""),
      scene: sceneZh || sceneEn || stringOr(item.scene, params.segmentPurpose),
      sceneZh,
      sceneEn,
      action: actionZh || actionEn || stringOr(item.action, promptZh || promptEn || params.segmentPurpose),
      actionZh,
      actionEn,
      camera: cameraZh || cameraEn || stringOr(item.camera, params.segmentCamera),
      cameraZh,
      cameraEn,
      referenceType: normalizeReferenceType(item.referenceType ?? item.reference_type) ?? (imagePromptZh || imagePromptEn ? "mixed" : "text"),
      imagePrompt: imagePromptEn,
      imagePromptZh,
      imagePromptEn,
      declaredAnchorIds,
      derivedAnchorIds,
      effectiveRequiredAnchorIds: anchors,
      excludedAnchors: [],
      usesConsistencyAnchors: anchors,
      prompt: promptEn || stringOr(item.prompt, ""),
      promptZh,
      promptEn,
    }];
  });
  const result = items.length ? items : params.fallback;
  return result?.length ? result.slice(0, 6).map((item, index) => ({
    ...item,
    microShotNo: index + 1,
    declaredAnchorIds: item.declaredAnchorIds ?? item.usesConsistencyAnchors ?? [],
    derivedAnchorIds: uniqueStrings([...(item.derivedAnchorIds ?? []), ...params.anchorIds]),
    effectiveRequiredAnchorIds: uniqueStrings([...(item.effectiveRequiredAnchorIds ?? []), ...(item.usesConsistencyAnchors ?? []), ...params.anchorIds]),
    usesConsistencyAnchors: uniqueStrings([...(item.effectiveRequiredAnchorIds ?? []), ...(item.usesConsistencyAnchors ?? []), ...params.anchorIds]),
  })) : undefined;
}

function anchorsToConsistencyReferences(manifest: VideoPlanningManifest, styleBible: VideoStyleBible): OnePromptVideoPlan["consistencyReferences"] {
  let hasPrimaryCharacter = false;
  let hasPrimaryScene = false;
  let nextCustomKeyframeNo = -100;
  const references = manifest.consistencyManifest.anchors.flatMap((anchor) => {
    if (!isHardConsistencyAnchor(anchor)) return [];
    const kind = consistencyReferenceKindForAnchor(anchor);
    const keyframeNo = (() => {
      if (kind === "character" && !hasPrimaryCharacter) {
        hasPrimaryCharacter = true;
        return -2;
      }
      if ((kind === "scene" || kind === "space_layout") && !hasPrimaryScene) {
        hasPrimaryScene = true;
        return -1;
      }
      const value = nextCustomKeyframeNo;
      nextCustomKeyframeNo -= 1;
      return value;
    })();
    const lock = anchorLockText(anchor);
    const displayPromptZh = assetPromptDisplayZh(anchor);
    const executablePromptEn = anchor.assetImageContract
      ? compileAssetImagePromptEn(anchor)
      : anchor.imagePromptEn || anchor.descriptionEn || lock;
    return [{
      kind,
      needed: true,
      keyframeNo,
      anchorId: anchor.id,
      frameId: `consistency_${anchor.id}`,
      purpose: anchor.displayNameZh || anchor.displayNameEn || anchor.id,
      purposeZh: anchor.displayNameZh || anchor.id,
      purposeEn: anchor.displayNameEn || anchor.id,
      scene: anchor.descriptionZh || anchor.descriptionEn || lock,
      characterState: kind === "character" ? lock : "",
      productState: kind !== "character" ? lock : styleBible.productLock ?? "",
      imagePrompt: executablePromptEn,
      imagePromptZh: displayPromptZh,
      imagePromptEn: executablePromptEn,
      negativePrompt: styleBible.negativePromptEn || styleBible.negativePrompt,
      negativePromptZh: styleBible.negativePromptZh,
      negativePromptEn: styleBible.negativePromptEn,
    }];
  });
  const seen = new Set<number>();
  return references.filter((reference) => {
    if (seen.has(reference.keyframeNo)) return false;
    seen.add(reference.keyframeNo);
    return true;
  });
}

function isHardConsistencyAnchor(anchor: VideoConsistencyAnchor): boolean {
  if (!isReferenceImageEligibleAnchor(anchor) || !isVisibleEvidenceAnchor(anchor)) return false;
  if (anchor.needsReferenceImage && anchor.referenceStrength === "hard") return true;
  return anchor.needsReferenceImage && [
    "person",
    "product",
    "brand_visual",
    "prop",
    "task_object",
    "vehicle",
    "food",
    "space_layout",
    "location",
  ].includes(anchor.type);
}

function consistencyReferenceKindForAnchor(anchor: VideoConsistencyAnchor): NonNullable<OnePromptVideoPlan["consistencyReferences"]>[number]["kind"] {
  if (anchor.type === "person") return "character";
  if (anchor.type === "location") return "scene";
  if (anchor.type === "product" || anchor.type === "task_object" || anchor.type === "effect_state") return "product";
  if (anchor.type === "brand_visual" || anchor.type === "style") return "brand_visual";
  if (anchor.type === "space_layout") return "space_layout";
  if (anchor.type === "vehicle") return "vehicle";
  if (anchor.type === "food") return "food";
  if (anchor.type === "prop") return "prop";
  return "custom";
}

function anchorsForBoundary(manifest: VideoPlanningManifest, keyframeNo: number): string[] {
  const ids = new Set<string>();
  for (const segment of manifest.timelineBlueprint.segments) {
    if (segment.segmentNo === keyframeNo || segment.segmentNo + 1 === keyframeNo) {
      for (const id of segment.requiredAnchorIds ?? []) ids.add(id);
    }
  }
  return [...ids];
}

function anchorLockText(anchor: VideoConsistencyAnchor): string {
  const lock = anchor.visualLock;
  return [
    anchor.displayNameEn || anchor.displayNameZh || anchor.id,
    anchor.descriptionEn || anchor.descriptionZh,
    lock?.shape ? `shape: ${lock.shape}` : "",
    lock?.material ? `material: ${lock.material}` : "",
    lock?.color ? `color: ${lock.color}` : "",
    lock?.markings ? `markings: ${lock.markings}` : "",
    lock?.scale ? `scale: ${lock.scale}` : "",
    lock?.state ? `state: ${lock.state}` : "",
    lock?.forbiddenDrift?.length ? `forbidden drift: ${lock.forbiddenDrift.join(", ")}` : "",
  ].filter(Boolean).join("; ");
}

function segmentCountBounds(totalSeconds: number): { min: number; max: number } {
  return {
    min: Math.max(1, Math.ceil(totalSeconds / MAX_SEGMENT_SECONDS)),
    max: Math.max(1, Math.floor(totalSeconds / MIN_SEGMENT_SECONDS)),
  };
}

function requireDashScopeApiKey(): string {
  const key = process.env.DASHSCOPE_API_KEY || process.env.BAILIAN_API_KEY || process.env.ALIYUN_API_KEY;
  if (!key) throw new Error("缺少 DASHSCOPE_API_KEY / BAILIAN_API_KEY / ALIYUN_API_KEY");
  return key;
}

function compatibleBaseUrl(): string {
  const raw = process.env.DASHSCOPE_COMPATIBLE_BASE_URL || process.env.ALIYUN_COMPATIBLE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1";
  return raw.replace(/\/$/, "");
}

function model(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function jsonStageTimeoutMs(): number {
  const raw = Number(process.env.ONE_PROMPT_VIDEO_JSON_STAGE_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_JSON_STAGE_TIMEOUT_MS;
  return Math.max(30000, Math.round(raw));
}

function jsonStageStreamingEnabled(): boolean {
  return process.env.ONE_PROMPT_VIDEO_JSON_STAGE_STREAM?.trim().toLowerCase() !== "false";
}

export function shouldStreamJsonStage(
  stage: string,
  streamingEnabled = jsonStageStreamingEnabled(),
): boolean {
  if (!streamingEnabled) return false;
  if (stage.startsWith("json_repair_")) return false;
  return stage !== "reference_fact_extractor";
}

type JsonStageReasoningPolicy = {
  enableThinking: boolean;
  thinkingBudget?: number;
};

/**
 * Keep deep reasoning for the creative decisions that establish the story, but
 * do not make every deterministic JSON compiler wait for a hidden reasoning
 * trace. Complex repair and critic stages retain a bounded reasoning budget.
 */
export function jsonStageReasoningPolicy(stage: string): JsonStageReasoningPolicy {
  if (
    /^(?:shot_decomposer_s\d+|prompt_detailer(?:_s\d+)?|json_repair|reference_fact_extractor|asset_prompt_contract_repair|asset_visual_spec_)/.test(stage)
  ) {
    return { enableThinking: false };
  }

  if (
    /(?:repair|replan|rewrite|semantic_critic)/.test(stage)
  ) {
    return {
      enableThinking: true,
      thinkingBudget: complexRepairThinkingBudget(),
    };
  }

  return { enableThinking: true };
}

function complexRepairThinkingBudget(): number {
  const raw = Number(process.env.ONE_PROMPT_VIDEO_COMPLEX_REPAIR_THINKING_BUDGET);
  if (!Number.isFinite(raw) || raw <= 0) return 512;
  return Math.max(64, Math.min(4096, Math.round(raw)));
}

function jsonStageStreamIdleTimeoutMs(): number {
  const raw = Number(process.env.ONE_PROMPT_VIDEO_JSON_STAGE_STREAM_IDLE_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return 90000;
  return Math.max(30000, Math.round(raw));
}

function jsonStageStreamMaxTimeoutMs(stage: string): number {
  const isSegmentStage = /(?:shot_decomposer|prompt_detailer)_s\d+|split_repair_s\d+_r\d+/.test(stage);
  const stageSpecificRaw = isSegmentStage
    ? Number(process.env.ONE_PROMPT_VIDEO_SEGMENT_STAGE_STREAM_MAX_TIMEOUT_MS)
    : Number.NaN;
  if (Number.isFinite(stageSpecificRaw) && stageSpecificRaw > 0) {
    return Math.max(jsonStageTimeoutMs(), Math.round(stageSpecificRaw));
  }
  if (isSegmentStage) return Math.max(jsonStageTimeoutMs(), 240000);
  const raw = Number(process.env.ONE_PROMPT_VIDEO_JSON_STAGE_STREAM_MAX_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return 600000;
  return Math.max(jsonStageTimeoutMs(), Math.round(raw));
}

function shotDecomposerRetryAttempts(): number {
  const raw = Number(process.env.ONE_PROMPT_VIDEO_SHOT_DECOMPOSER_RETRY_ATTEMPTS);
  if (!Number.isFinite(raw) || raw <= 0) return 3;
  return Math.max(1, Math.min(5, Math.round(raw)));
}

function shotDecomposerRetryBaseDelayMs(): number {
  const raw = Number(process.env.ONE_PROMPT_VIDEO_SHOT_DECOMPOSER_RETRY_BASE_DELAY_MS);
  if (!Number.isFinite(raw) || raw < 0) return 2000;
  return Math.min(30000, Math.round(raw));
}

function assetVisualSpecConcurrency(): number {
  const raw = Number(process.env.ONE_PROMPT_VIDEO_ASSET_VISUAL_SPEC_CONCURRENCY);
  if (!Number.isFinite(raw) || raw <= 0) return 5;
  return Math.max(1, Math.min(5, Math.round(raw)));
}

function assetVisualSpecMaxAttempts(): number {
  const raw = Number(process.env.ONE_PROMPT_VIDEO_ASSET_VISUAL_SPEC_MAX_ATTEMPTS);
  if (!Number.isFinite(raw) || raw <= 0) return 2;
  return Math.max(1, Math.min(3, Math.round(raw)));
}

function shotDecomposerConcurrency(): number {
  const raw = Number(process.env.ONE_PROMPT_VIDEO_SHOT_DECOMPOSER_CONCURRENCY);
  if (!Number.isFinite(raw) || raw <= 0) return 10;
  return Math.max(1, Math.min(10, Math.round(raw)));
}

function singleTakeMaxRevisions(targetedSegmentRepair: boolean): number {
  if (!isOnePromptVideoScriptQaEnabled()) return 0;
  const raw = Number(process.env.ONE_PROMPT_VIDEO_SINGLE_TAKE_MAX_REVISIONS);
  if (Number.isFinite(raw) && raw >= 0) return Math.max(0, Math.min(3, Math.round(raw)));
  return targetedSegmentRepair ? 2 : MAX_SINGLE_TAKE_REVISIONS;
}

function plannerInputSnapshot(input: PlanVideoProjectInput): Record<string, unknown> {
  return {
    userPrompt: input.userPrompt,
    aspectRatio: input.aspectRatio,
    durationSeconds: input.durationSeconds,
    shotCount: input.shotCount ?? null,
    stylePreset: input.stylePreset ?? "",
    referenceImageUrls: input.referenceImageUrls,
  };
}

function plannerInputFingerprint(input: PlanVideoProjectInput): string {
  return createHash("sha256")
    .update(JSON.stringify(plannerInputSnapshot(input)))
    .digest("hex");
}

function legacyPlannerInputFingerprint(input: PlanVideoProjectInput): string {
  return createHash("sha256").update(JSON.stringify({
    plannerContractRevision: STORYBOARD_PLANNER_CONTRACT_REVISION,
    ...plannerInputSnapshot(input),
  })).digest("hex");
}

function checkpointFailureStage(error: unknown): string {
  if (error instanceof PlanningArchitectRouteConflictError) return "planning_architect";
  if (isStructuredOutputSyntaxError(error)) {
    return error.stage as AliyunStoryboardProgressStage;
  }
  if (error instanceof StoryboardStageError && error.stage) {
    return error.stage as AliyunStoryboardProgressStage;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/资产图片合同|asset.*contract/i.test(message)) return "asset_prompt_contract_repair";
  if (/Strict JSON Schema|shot_decomposer|segment_render_descriptions|motion_contract|video_prompt_contract/i.test(message)) {
    return "shot_decomposer";
  }
  if (/timeline_replan|single.take|single_take/i.test(message)) return "single_take_audit";
  if (/切镜措辞|positive cut|prompt detail/i.test(message)) return "prompt_detailer";
  return "final_validation";
}

function checkpointFailureFingerprint(
  stage: string,
  error: unknown,
): { fingerprint: string; code: string } {
  const code = error instanceof StoryboardStageError
    ? error.code
    : isStructuredOutputSyntaxError(error)
      ? error.code
    : error instanceof Error
      ? error.name || "Error"
      : "UnknownError";
  const details = error instanceof StoryboardStageError && error.validationErrors?.length
    ? [...error.validationErrors].sort()
    : isStructuredOutputSyntaxError(error)
      ? [error.message, error.stage, error.classification]
    : [error instanceof Error ? error.message : String(error)];
  return {
    code,
    fingerprint: createHash("sha256")
      .update(JSON.stringify({ stage, code, details }))
      .digest("hex"),
  };
}

function clearCheckpointAfterPlanning(checkpoint: AliyunStoryboardPlannerCheckpoint): void {
  checkpoint.assetPromptRepairRaw = undefined;
  checkpoint.assetVisualSpecsByAnchorId = {};
  checkpoint.assetVisualSpecFingerprints = {};
  checkpoint.storyboardArtistPlan = undefined;
  checkpoint.storyContractReport = undefined;
  checkpoint.storySemanticReview = undefined;
  checkpoint.shotDecomposerSegmentPlans = {};
  checkpoint.approvedShotDecomposerSegmentPlans = {};
  checkpoint.promptDetailSegmentPlans = {};
  checkpoint.finalPromptRepairAttempts = 0;
  checkpoint.timelineReplanAttempts = 0;
  checkpoint.timelineChangeHistory = [];
}

function invalidatePlanningContentAfterRoute(
  checkpoint: AliyunStoryboardPlannerCheckpoint,
): void {
  checkpoint.planningCoreRaw = undefined;
  checkpoint.planningRaw = undefined;
  checkpoint.planningContractRepairState = undefined;
  clearCheckpointAfterPlanning(checkpoint);
  checkpoint.resumeFromStage = "planning_architect";
}

function failedSegmentNosFromError(error: unknown): number[] {
  const message = error instanceof Error ? error.message : String(error);
  const segmentNos = new Set<number>();
  for (const pattern of [
    /segment(?:_no)?[:\s=#-]*(\d+)/gi,
    /(?:镜头|片段)\s*(\d+)/g,
  ]) {
    for (const match of message.matchAll(pattern)) {
      const segmentNo = Number(match[1]);
      if (Number.isInteger(segmentNo) && segmentNo > 0) segmentNos.add(segmentNo);
    }
  }
  return [...segmentNos].sort((left, right) => left - right);
}

export interface ScopedPlannerFailureStage {
  raw: string;
  baseStage: string;
  segmentNo?: number;
}

export function parseScopedPlannerFailureStage(stage: string): ScopedPlannerFailureStage {
  const scoped = stage.match(/^(shot_decomposer|prompt_detailer)_s(\d+)$/);
  if (!scoped) return { raw: stage, baseStage: stage };
  return {
    raw: stage,
    baseStage: scoped[1],
    segmentNo: Number(scoped[2]),
  };
}

export function invalidatePlannerCheckpointAfterFailure(
  checkpoint: AliyunStoryboardPlannerCheckpoint,
  failedStage: string,
  error: unknown,
): AliyunStoryboardPlannerCheckpoint {
  const scopedStage = parseScopedPlannerFailureStage(String(failedStage));
  const stage = scopedStage.baseStage;
  const fingerprint = checkpointFailureFingerprint(scopedStage.raw, error);
  const sameFailure = checkpoint.lastFailure?.fingerprint === fingerprint.fingerprint;

  if (stage === "reference_fact_extractor") {
    checkpoint.referenceFactsRaw = undefined;
    checkpoint.referenceFactsFingerprint = undefined;
    checkpoint.planningCoreRaw = undefined;
    checkpoint.planningRaw = undefined;
    checkpoint.planningContractRepairState = undefined;
    clearCheckpointAfterPlanning(checkpoint);
    checkpoint.resumeFromStage = "reference_fact_extractor";
  } else if (
    stage === "planning_architect"
    || stage === "planning_duration_repair"
  ) {
    checkpoint.planningRaw = undefined;
    checkpoint.planningCoreRaw = undefined;
    checkpoint.planningContractRepairState = undefined;
    clearCheckpointAfterPlanning(checkpoint);
    checkpoint.resumeFromStage = "planning_architect";
  } else if (stage === "planning_contract_repair") {
    // The planning candidate, reference facts, and generated asset specs are
    // valid repair inputs. Preserve them and resume at the narrow contract
    // repair boundary instead of paying for Planning Architect again.
    checkpoint.storyboardArtistPlan = undefined;
    checkpoint.storyContractReport = undefined;
    checkpoint.storySemanticReview = undefined;
    checkpoint.shotDecomposerSegmentPlans = {};
    checkpoint.approvedShotDecomposerSegmentPlans = {};
    checkpoint.promptDetailSegmentPlans = {};
    checkpoint.finalPromptRepairAttempts = 0;
    checkpoint.timelineReplanAttempts = 0;
    checkpoint.timelineChangeHistory = [];
    checkpoint.resumeFromStage = "planning_contract_repair";
  } else if (
    stage === "asset_prompt_contract_gate"
    || stage === "asset_prompt_contract_repair"
    || stage === "asset_visual_spec"
  ) {
    // Keep the expensive planning candidate as repair input, but never reuse the
    // failed repair or any downstream output derived from it.
    clearCheckpointAfterPlanning(checkpoint);
    checkpoint.resumeFromStage = "asset_prompt_contract_repair";
  } else if (
    stage === "storyboard_artist"
    || stage === "story_contract_gate"
    || stage === "story_contract_repair"
    || stage === "story_semantic_critic"
    || stage === "story_semantic_repair"
  ) {
    checkpoint.storyboardArtistPlan = undefined;
    checkpoint.storyContractReport = undefined;
    checkpoint.storySemanticReview = undefined;
    checkpoint.shotDecomposerSegmentPlans = {};
    checkpoint.approvedShotDecomposerSegmentPlans = {};
    checkpoint.promptDetailSegmentPlans = {};
    checkpoint.finalPromptRepairAttempts = 0;
    checkpoint.timelineReplanAttempts = 0;
    checkpoint.timelineChangeHistory = [];
    checkpoint.resumeFromStage = "storyboard_artist";
  } else if (stage === "prompt_detailer") {
    if (scopedStage.segmentNo !== undefined) {
      delete checkpoint.promptDetailSegmentPlans?.[String(scopedStage.segmentNo)];
    } else {
      checkpoint.promptDetailSegmentPlans = {};
    }
    checkpoint.finalPromptRepairAttempts = 0;
    checkpoint.resumeFromStage = "prompt_detailer";
  } else if (stage === "shot_decomposer") {
    const failedSegmentNos = scopedStage.segmentNo === undefined
      ? failedSegmentNosFromError(error)
      : [scopedStage.segmentNo];
    if (failedSegmentNos.length) {
      for (const segmentNo of failedSegmentNos) {
        const key = String(segmentNo);
        delete checkpoint.shotDecomposerSegmentPlans?.[key];
        delete checkpoint.approvedShotDecomposerSegmentPlans?.[key];
        delete checkpoint.promptDetailSegmentPlans?.[key];
      }
    } else {
      checkpoint.shotDecomposerSegmentPlans = {};
      checkpoint.approvedShotDecomposerSegmentPlans = {};
      checkpoint.promptDetailSegmentPlans = {};
    }
    checkpoint.finalPromptRepairAttempts = 0;
    checkpoint.resumeFromStage = "shot_decomposer";
  } else if (stage === "final_validation") {
    const failedSegmentNos = failedSegmentNosFromError(error);
    for (const segmentNo of failedSegmentNos) {
      const key = String(segmentNo);
      delete checkpoint.shotDecomposerSegmentPlans?.[key];
      delete checkpoint.approvedShotDecomposerSegmentPlans?.[key];
      delete checkpoint.promptDetailSegmentPlans?.[key];
    }
    checkpoint.finalPromptRepairAttempts = 0;
    checkpoint.resumeFromStage = "shot_decomposer";
  } else {
    checkpoint.shotDecomposerSegmentPlans = {};
    checkpoint.approvedShotDecomposerSegmentPlans = {};
    checkpoint.promptDetailSegmentPlans = {};
    checkpoint.finalPromptRepairAttempts = 0;
    checkpoint.timelineReplanAttempts = 0;
    checkpoint.timelineChangeHistory = [];
    checkpoint.resumeFromStage = "shot_decomposer";
  }

  const invalidatedAt = new Date().toISOString();
  checkpoint.lastFailure = {
    ...fingerprint,
    stage: scopedStage.raw,
    count: sameFailure ? (checkpoint.lastFailure?.count ?? 1) + 1 : 1,
    invalidatedAt,
  };
  checkpoint.updatedAt = invalidatedAt;
  return checkpoint;
}

export function clearPlannerCheckpointFailureAfterStageSuccess(
  checkpoint: AliyunStoryboardPlannerCheckpoint,
  succeededStages: string | readonly string[],
): boolean {
  if (!checkpoint.lastFailure) return false;
  const stages = Array.isArray(succeededStages)
    ? succeededStages
    : [succeededStages];
  const completedAllStages = stages.includes("complete");
  if (
    !completedAllStages
    && !stages.some((stage) =>
      checkpoint.lastFailure?.stage === stage
      || checkpoint.lastFailure?.stage.startsWith(`${stage}_`)
    )
  ) {
    return false;
  }

  const failedStage = checkpoint.lastFailure.stage;
  checkpoint.lastFailure = undefined;
  if (
    completedAllStages
    || checkpoint.resumeFromStage === failedStage
    || stages.includes(String(checkpoint.resumeFromStage ?? ""))
  ) {
    checkpoint.resumeFromStage = undefined;
  }
  checkpoint.updatedAt = new Date().toISOString();
  return true;
}

function revalidatePlannerCheckpointForResume(params: {
  checkpoint: AliyunStoryboardPlannerCheckpoint;
  input: PlanVideoProjectInput;
  fallback: OnePromptVideoPlan;
}): { invalidated: boolean; issues: string[] } {
  const issues: string[] = [];
  let invalidated = false;

  if (params.checkpoint.planningRaw !== undefined) {
    const manifest = materializePlanningAssetImagePrompts(
      normalizePlanningManifest(params.checkpoint.planningRaw, params.input, params.fallback),
    );
    const assetIssues = [
      ...validatePlanningAssetImageContracts(manifest.consistencyManifest.anchors),
      ...validatePlanningAssetExecutionPrompts(manifest.consistencyManifest.anchors),
    ];
    if (assetIssues.length) {
      issues.push(...assetIssues.map((issue) => `${issue.anchorId}.${issue.field}: ${issue.message}`));
      invalidatePlannerCheckpointAfterFailure(
        params.checkpoint,
        "asset_prompt_contract_repair",
        new StoryboardStageError("Cached asset contract failed resume validation", {
          code: "contract_validation_error",
          retryable: false,
          stage: "asset_prompt_contract_repair",
          validationErrors: issues,
        }),
      );
      invalidated = true;
    }
  }

  for (const [segmentKey, plan] of Object.entries(params.checkpoint.shotDecomposerSegmentPlans ?? {})) {
    const segmentNo = Number(segmentKey);
    try {
      assertShotPlanVideoPromptContract(plan, segmentNo);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(`segment ${segmentNo}: ${message}`);
      delete params.checkpoint.shotDecomposerSegmentPlans?.[segmentKey];
      delete params.checkpoint.approvedShotDecomposerSegmentPlans?.[segmentKey];
      delete params.checkpoint.promptDetailSegmentPlans?.[segmentKey];
      params.checkpoint.resumeFromStage = "shot_decomposer";
      invalidated = true;
    }
  }

  for (const [segmentKey, plan] of Object.entries(params.checkpoint.approvedShotDecomposerSegmentPlans ?? {})) {
    const segmentNo = Number(segmentKey);
    try {
      assertShotPlanVideoPromptContract(plan, segmentNo);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(`approved segment ${segmentNo}: ${message}`);
      delete params.checkpoint.approvedShotDecomposerSegmentPlans?.[segmentKey];
      delete params.checkpoint.promptDetailSegmentPlans?.[segmentKey];
      params.checkpoint.resumeFromStage = "shot_decomposer";
      invalidated = true;
    }
  }

  if (invalidated) params.checkpoint.updatedAt = new Date().toISOString();
  return { invalidated, issues };
}

export function migrateCheckpointV12ToV13(
  checkpoint: Record<string, unknown>,
): Record<string, unknown> {
  const migrated = structuredClone(checkpoint);
  const stageOutputs = checkpointStageOutputs(migrated);
  return {
    ...migrated,
    version: 13,
    checkpointVersion: 13,
    plannerMode: checkpointPlannerMode(migrated),
    completedStages: inferCompletedCheckpointStages(migrated),
    stageOutputs,
    referenceFingerprint: checkpointReferenceFingerprint(migrated),
  };
}

export function migrateCheckpointV13ToV14(
  checkpoint: Record<string, unknown>,
): Record<string, unknown> {
  const migrated = structuredClone(checkpoint);
  hydrateLegacyCheckpointFields(migrated);
  const completedStages = inferCompletedCheckpointStages(migrated);
  const existingContracts = isRecord(migrated.contractVersions)
    ? migrated.contractVersions
    : {};
  const contractVersions = Object.fromEntries(
    PLANNER_CHECKPOINT_STAGE_ORDER.map((stage) => [
      stage,
      typeof existingContracts[stage] === "string"
        ? existingContracts[stage]
        : PLANNER_CHECKPOINT_CONTRACT_VERSIONS[stage],
    ]),
  );
  return {
    ...migrated,
    version: STORYBOARD_PLANNER_CHECKPOINT_VERSION,
    checkpointVersion: STORYBOARD_PLANNER_CHECKPOINT_VERSION,
    plannerMode: checkpointPlannerMode(migrated),
    completedStages,
    stageOutputs: checkpointStageOutputs(migrated),
    contractVersions,
    referenceFingerprint: checkpointReferenceFingerprint(migrated),
  };
}

function migrateCheckpointEnvelopeToV14(
  rawEnvelope: Record<string, unknown>,
  input: PlanVideoProjectInput,
): Record<string, unknown> {
  const declaredVersions = [
    numberFrom(rawEnvelope.checkpointVersion),
    numberFrom(rawEnvelope.version),
  ].filter((version) => version > 0);
  const fromVersion = declaredVersions.length
    ? Math.min(...declaredVersions)
    : 0;
  let migrated = structuredClone(rawEnvelope);
  if (fromVersion === 12) {
    migrated = migrateCheckpointV12ToV13(migrated);
    migrated = migrateCheckpointV13ToV14(migrated);
  } else if (fromVersion === 13) {
    migrated = migrateCheckpointV13ToV14(migrated);
  } else if (
    fromVersion === 14
    && hasV14CheckpointEnvelope(migrated)
  ) {
    hydrateLegacyCheckpointFields(migrated);
  } else {
    // Pre-envelope v14 and unknown historical versions are migrated by
    // inspecting concrete outputs. No stage is discarded solely because a
    // version number changed.
    migrated = migrateCheckpointV13ToV14({
      ...migrated,
      version: 13,
      checkpointVersion: 13,
    });
  }

  const originalSnapshot = isRecord(migrated.inputSnapshot)
    ? migrated.inputSnapshot
    : undefined;
  const nextSnapshot = plannerInputSnapshot(input);
  const nextFingerprint = plannerInputFingerprint(input);
  const nextReferenceFingerprint = plannerReferenceFingerprint(input);
  const priorCompleted = inferCompletedCheckpointStages(migrated);
  const reasons: string[] = [];
  let firstInvalidStage: PlannerCheckpointStage | undefined;

  const historicalMode = checkpointPlannerMode(migrated);
  if (historicalMode !== "split" && priorCompleted.length) {
    firstInvalidStage = earlierCheckpointStage(
      firstInvalidStage,
      "story_architect",
    );
    reasons.push(`planner_mode:${historicalMode}->split`);
  }

  const priorReferenceFingerprint = checkpointReferenceFingerprint(migrated);
  if (
    priorReferenceFingerprint
    && priorReferenceFingerprint !== nextReferenceFingerprint
  ) {
    firstInvalidStage = earlierCheckpointStage(
      firstInvalidStage,
      "reference_analysis",
    );
    reasons.push("reference_input_changed");
  }

  if (originalSnapshot) {
    if (!jsonValuesEqual(
      originalSnapshot.referenceImageUrls,
      nextSnapshot.referenceImageUrls,
    )) {
      firstInvalidStage = earlierCheckpointStage(
        firstInvalidStage,
        "reference_analysis",
      );
      if (!reasons.includes("reference_input_changed")) {
        reasons.push("reference_input_changed");
      }
    }
    const userCreativeChanged = !jsonValuesEqual(
      originalSnapshot.userPrompt,
      nextSnapshot.userPrompt,
    );
    if (userCreativeChanged) {
      firstInvalidStage = earlierCheckpointStage(
        firstInvalidStage,
        isRouteClassificationCheckpoint(migrated.routeClassification)
          && migrated.routeClassification.status === "manual_locked"
          && migrated.routeClassification.locked
          ? "story_architect"
          : "route_classification",
      );
      reasons.push(
        isRouteClassificationCheckpoint(migrated.routeClassification)
          && migrated.routeClassification.status === "manual_locked"
          && migrated.routeClassification.locked
          ? "user_creative_changed_route_manual_locked"
          : "user_creative_changed",
      );
    }
    const storyInputChanged = [
      "aspectRatio",
      "durationSeconds",
      "shotCount",
      "stylePreset",
    ].some((key) => !jsonValuesEqual(originalSnapshot[key], nextSnapshot[key]));
    if (storyInputChanged) {
      firstInvalidStage = earlierCheckpointStage(
        firstInvalidStage,
        "story_architect",
      );
      reasons.push("story_input_changed");
    }
  } else if (
    priorCompleted.length
    && typeof migrated.inputFingerprint === "string"
    && migrated.inputFingerprint !== nextFingerprint
    && migrated.inputFingerprint !== legacyPlannerInputFingerprint(input)
  ) {
    firstInvalidStage = earlierCheckpointStage(
      firstInvalidStage,
      "story_architect",
    );
    reasons.push("legacy_input_fingerprint_changed");
  }

  const storedContracts = isRecord(migrated.contractVersions)
    ? migrated.contractVersions
    : {};
  for (const stage of priorCompleted) {
    const stored = typeof storedContracts[stage] === "string"
      ? storedContracts[stage]
      : "";
    const current = PLANNER_CHECKPOINT_CONTRACT_VERSIONS[stage];
    if (stored && stored !== current) {
      firstInvalidStage = earlierCheckpointStage(firstInvalidStage, stage);
      reasons.push(`contract_version:${stage}:${stored}->${current}`);
    }
  }

  const invalidatedStages = firstInvalidStage
    ? invalidateCheckpointFromStage(migrated, firstInvalidStage)
    : [];
  const completedStages = inferCompletedCheckpointStages(migrated);
  const preservedStages = priorCompleted.filter((stage) =>
    completedStages.includes(stage)
  );
  const previousAudit = isRecord(migrated.migrationAudit)
    ? migrated.migrationAudit
    : undefined;
  const auditUnchanged = previousAudit?.fromVersion === fromVersion
    && previousAudit?.toVersion === STORYBOARD_PLANNER_CHECKPOINT_VERSION
    && jsonValuesEqual(previousAudit?.preservedStages, preservedStages)
    && jsonValuesEqual(previousAudit?.invalidatedStages, invalidatedStages)
    && jsonValuesEqual(previousAudit?.reasons, reasons);
  const migratedAt = auditUnchanged
    && typeof previousAudit?.migratedAt === "string"
    ? previousAudit.migratedAt
    : new Date().toISOString();
  migrated.version = STORYBOARD_PLANNER_CHECKPOINT_VERSION;
  migrated.checkpointVersion = STORYBOARD_PLANNER_CHECKPOINT_VERSION;
  migrated.plannerMode = "split";
  migrated.planningDecompositionMode = "split";
  migrated.inputFingerprint = nextFingerprint;
  migrated.inputSnapshot = nextSnapshot;
  migrated.completedStages = completedStages;
  migrated.stageOutputs = checkpointStageOutputs(migrated);
  migrated.contractVersions = { ...PLANNER_CHECKPOINT_CONTRACT_VERSIONS };
  migrated.referenceFingerprint = nextReferenceFingerprint;
  migrated.referenceFactsFingerprint = nextReferenceFingerprint;
  migrated.migrationAudit = {
    fromVersion,
    toVersion: STORYBOARD_PLANNER_CHECKPOINT_VERSION,
    preservedStages,
    invalidatedStages,
    reasons,
    migratedAt,
  };
  migrated.updatedAt = typeof migrated.updatedAt === "string"
    ? migrated.updatedAt
    : migratedAt;
  return migrated;
}

function hasV14CheckpointEnvelope(checkpoint: Record<string, unknown>): boolean {
  return checkpoint.checkpointVersion === STORYBOARD_PLANNER_CHECKPOINT_VERSION
    && checkpoint.plannerMode === "split"
    && Array.isArray(checkpoint.completedStages)
    && isRecord(checkpoint.stageOutputs)
    && isRecord(checkpoint.contractVersions)
    && typeof checkpoint.referenceFingerprint === "string";
}

function checkpointPlannerMode(checkpoint: Record<string, unknown>): string {
  if (
    typeof checkpoint.planningDecompositionMode === "string"
    && checkpoint.planningDecompositionMode !== "split"
  ) return checkpoint.planningDecompositionMode;
  if (typeof checkpoint.plannerMode === "string") return checkpoint.plannerMode;
  if (typeof checkpoint.planningDecompositionMode === "string") {
    return checkpoint.planningDecompositionMode;
  }
  return "split";
}

function checkpointReferenceFingerprint(
  checkpoint: Record<string, unknown>,
): string {
  if (typeof checkpoint.referenceFingerprint === "string") {
    return checkpoint.referenceFingerprint;
  }
  return typeof checkpoint.referenceFactsFingerprint === "string"
    ? checkpoint.referenceFactsFingerprint
    : "";
}

function plannerReferenceFingerprint(input: PlanVideoProjectInput): string {
  return input.referenceImageUrls?.length
    ? createHash("sha256")
      .update(JSON.stringify(input.referenceImageUrls))
      .digest("hex")
    : "";
}

function inferCompletedCheckpointStages(
  checkpoint: Record<string, unknown>,
): PlannerCheckpointStage[] {
  const completed = new Set<PlannerCheckpointStage>();
  if (checkpoint.referenceFactsRaw !== undefined) completed.add("reference_analysis");
  if (isRouteClassificationCheckpoint(checkpoint.routeClassification)) {
    completed.add("route_classification");
  }
  if (checkpoint.planningCoreRaw !== undefined) completed.add("story_architect");
  if (
    checkpoint.planningRaw !== undefined
    || hasRecordEntries(checkpoint.assetVisualSpecsByAnchorId)
  ) completed.add("asset_contract");
  if (isRecord(checkpoint.storyboardArtistPlan)) completed.add("storyboard_artist");
  if (
    isRecord(checkpoint.storyContractReport)
    || isRecord(checkpoint.storySemanticReview)
  ) completed.add("story_validation");
  if (
    hasRecordEntries(checkpoint.shotDecomposerSegmentPlans)
    || hasRecordEntries(checkpoint.approvedShotDecomposerSegmentPlans)
  ) completed.add("shot_decomposition");
  if (hasRecordEntries(checkpoint.promptDetailSegmentPlans)) {
    completed.add("prompt_compilation");
  }
  return PLANNER_CHECKPOINT_STAGE_ORDER.filter((stage) => completed.has(stage));
}

function checkpointStageOutputs(
  checkpoint: Record<string, unknown>,
): Partial<Record<PlannerCheckpointStage, unknown>> {
  const outputs: Partial<Record<PlannerCheckpointStage, unknown>> = {};
  if (checkpoint.referenceFactsRaw !== undefined) {
    outputs.reference_analysis = checkpoint.referenceFactsRaw;
  }
  if (isRouteClassificationCheckpoint(checkpoint.routeClassification)) {
    outputs.route_classification = checkpoint.routeClassification;
  }
  if (checkpoint.planningCoreRaw !== undefined) {
    outputs.story_architect = checkpoint.planningCoreRaw;
  }
  if (
    checkpoint.planningRaw !== undefined
    || hasRecordEntries(checkpoint.assetVisualSpecsByAnchorId)
  ) {
    outputs.asset_contract = {
      planningRaw: checkpoint.planningRaw,
      assetVisualSpecsByAnchorId: checkpoint.assetVisualSpecsByAnchorId,
      assetVisualSpecFingerprints: checkpoint.assetVisualSpecFingerprints,
      assetPromptRepairRaw: checkpoint.assetPromptRepairRaw,
    };
  }
  if (checkpoint.storyboardArtistPlan !== undefined) {
    outputs.storyboard_artist = checkpoint.storyboardArtistPlan;
  }
  if (
    checkpoint.storyContractReport !== undefined
    || checkpoint.storySemanticReview !== undefined
  ) {
    outputs.story_validation = {
      storyContractReport: checkpoint.storyContractReport,
      storySemanticReview: checkpoint.storySemanticReview,
    };
  }
  if (
    hasRecordEntries(checkpoint.shotDecomposerSegmentPlans)
    || hasRecordEntries(checkpoint.approvedShotDecomposerSegmentPlans)
  ) {
    outputs.shot_decomposition = {
      shotDecomposerSegmentPlans: checkpoint.shotDecomposerSegmentPlans,
      approvedShotDecomposerSegmentPlans:
        checkpoint.approvedShotDecomposerSegmentPlans,
    };
  }
  if (hasRecordEntries(checkpoint.promptDetailSegmentPlans)) {
    outputs.prompt_compilation = checkpoint.promptDetailSegmentPlans;
  }
  return outputs;
}

function hydrateLegacyCheckpointFields(checkpoint: Record<string, unknown>): void {
  if (!isRecord(checkpoint.stageOutputs)) return;
  if (
    checkpoint.referenceFactsRaw === undefined
    && checkpoint.stageOutputs.reference_analysis !== undefined
  ) checkpoint.referenceFactsRaw = checkpoint.stageOutputs.reference_analysis;
  if (
    checkpoint.routeClassification === undefined
    && isRouteClassificationCheckpoint(checkpoint.stageOutputs.route_classification)
  ) checkpoint.routeClassification = checkpoint.stageOutputs.route_classification;
  if (
    checkpoint.planningCoreRaw === undefined
    && checkpoint.stageOutputs.story_architect !== undefined
  ) checkpoint.planningCoreRaw = checkpoint.stageOutputs.story_architect;
  if (isRecord(checkpoint.stageOutputs.asset_contract)) {
    checkpoint.planningRaw ??= checkpoint.stageOutputs.asset_contract.planningRaw;
    checkpoint.assetVisualSpecsByAnchorId ??=
      checkpoint.stageOutputs.asset_contract.assetVisualSpecsByAnchorId;
    checkpoint.assetVisualSpecFingerprints ??=
      checkpoint.stageOutputs.asset_contract.assetVisualSpecFingerprints;
    checkpoint.assetPromptRepairRaw ??=
      checkpoint.stageOutputs.asset_contract.assetPromptRepairRaw;
  }
  if (
    checkpoint.storyboardArtistPlan === undefined
    && isRecord(checkpoint.stageOutputs.storyboard_artist)
  ) checkpoint.storyboardArtistPlan = checkpoint.stageOutputs.storyboard_artist;
  if (isRecord(checkpoint.stageOutputs.story_validation)) {
    checkpoint.storyContractReport ??=
      checkpoint.stageOutputs.story_validation.storyContractReport;
    checkpoint.storySemanticReview ??=
      checkpoint.stageOutputs.story_validation.storySemanticReview;
  }
  if (isRecord(checkpoint.stageOutputs.shot_decomposition)) {
    checkpoint.shotDecomposerSegmentPlans ??=
      checkpoint.stageOutputs.shot_decomposition.shotDecomposerSegmentPlans;
    checkpoint.approvedShotDecomposerSegmentPlans ??=
      checkpoint.stageOutputs.shot_decomposition.approvedShotDecomposerSegmentPlans;
  }
  if (
    checkpoint.promptDetailSegmentPlans === undefined
    && isRecord(checkpoint.stageOutputs.prompt_compilation)
  ) {
    checkpoint.promptDetailSegmentPlans =
      checkpoint.stageOutputs.prompt_compilation;
  }
}

function invalidateCheckpointFromStage(
  checkpoint: Record<string, unknown>,
  firstStage: PlannerCheckpointStage,
): PlannerCheckpointStage[] {
  const start = PLANNER_CHECKPOINT_STAGE_ORDER.indexOf(firstStage);
  const invalidated = PLANNER_CHECKPOINT_STAGE_ORDER
    .slice(start)
    .filter((stage) =>
      !(firstStage === "reference_analysis" && stage === "route_classification"));
  if (invalidated.includes("reference_analysis")) {
    checkpoint.referenceFactsRaw = undefined;
    checkpoint.referenceFactsFingerprint = undefined;
  }
  if (invalidated.includes("route_classification")) {
    checkpoint.routeClassification = undefined;
    checkpoint.approvedRouteContract = undefined;
  }
  if (invalidated.includes("story_architect")) {
    checkpoint.planningCoreRaw = undefined;
    checkpoint.planningContractRepairState = undefined;
  }
  if (invalidated.includes("asset_contract")) {
    checkpoint.planningRaw = undefined;
    checkpoint.assetPromptRepairRaw = undefined;
    checkpoint.assetVisualSpecsByAnchorId = {};
    checkpoint.assetVisualSpecFingerprints = {};
  }
  if (invalidated.includes("storyboard_artist")) {
    checkpoint.storyboardArtistPlan = undefined;
  }
  if (invalidated.includes("story_validation")) {
    checkpoint.storyContractReport = undefined;
    checkpoint.storySemanticReview = undefined;
  }
  if (invalidated.includes("shot_decomposition")) {
    checkpoint.shotDecomposerSegmentPlans = {};
    checkpoint.approvedShotDecomposerSegmentPlans = {};
    checkpoint.timelineReplanAttempts = 0;
    checkpoint.timelineChangeHistory = [];
  }
  if (invalidated.includes("prompt_compilation")) {
    checkpoint.promptDetailSegmentPlans = {};
    checkpoint.finalPromptRepairAttempts = 0;
  }
  checkpoint.resumeFromStage = checkpointResumeStage(firstStage);
  return [...invalidated];
}

function checkpointResumeStage(
  stage: PlannerCheckpointStage,
): AliyunStoryboardProgressStage {
  if (stage === "reference_analysis") return "reference_fact_extractor";
  if (stage === "route_classification") return "planning_architect";
  if (stage === "story_architect") return "planning_architect";
  if (stage === "asset_contract") return "asset_prompt_contract_repair";
  if (stage === "storyboard_artist" || stage === "story_validation") {
    return "storyboard_artist";
  }
  if (stage === "shot_decomposition") return "shot_decomposer";
  return "prompt_detailer";
}

function earlierCheckpointStage(
  current: PlannerCheckpointStage | undefined,
  candidate: PlannerCheckpointStage,
): PlannerCheckpointStage {
  if (!current) return candidate;
  return PLANNER_CHECKPOINT_STAGE_ORDER.indexOf(candidate)
    < PLANNER_CHECKPOINT_STAGE_ORDER.indexOf(current)
    ? candidate
    : current;
}

function hasRecordEntries(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length > 0;
}

function isRouteClassificationCheckpoint(
  value: unknown,
): value is RouteClassificationCheckpoint {
  return isRecord(value)
    && value.stage === "route_classification"
    && value.checkpointVersion === 1
    && value.stageContractVersion === ROUTE_CLASSIFICATION_STAGE_CONTRACT_VERSION
    && isRecord(value.routeContract)
    && value.routeContract.version === "planning-route-v1";
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function normalizeAliyunStoryboardPlannerCheckpoint(
  value: unknown,
  input: PlanVideoProjectInput,
): AliyunStoryboardPlannerCheckpoint {
  const fingerprint = plannerInputFingerprint(input);
  const inputSnapshot = plannerInputSnapshot(input);
  const referenceFactsFingerprint = plannerReferenceFingerprint(input);
  const rawEnvelope = isRecord(value) && isRecord(value.plannerCheckpoint)
    ? value.plannerCheckpoint
    : isRecord(value)
      ? value
      : {};
  const envelope = migrateCheckpointEnvelopeToV14(rawEnvelope, input);
  const migrateLegacyPlanningOutput = false;
  const segmentPlans = isRecord(envelope.shotDecomposerSegmentPlans)
    ? Object.fromEntries(Object.entries(envelope.shotDecomposerSegmentPlans).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1])))
    : {};
  const approvedSegmentPlans = isRecord(envelope.approvedShotDecomposerSegmentPlans)
    ? Object.fromEntries(Object.entries(envelope.approvedShotDecomposerSegmentPlans).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1])))
    : {};
  const promptDetailSegmentPlans = isRecord(envelope.promptDetailSegmentPlans)
    ? Object.fromEntries(Object.entries(envelope.promptDetailSegmentPlans).flatMap(([key, value]) => {
      if (!isRecord(value)) return [];
      return [[key, normalizePromptDetailPlan(value)]];
    }))
    : {};
  const assetVisualSpecsByAnchorId = isRecord(envelope.assetVisualSpecsByAnchorId)
    ? Object.fromEntries(
        Object.entries(envelope.assetVisualSpecsByAnchorId)
          .filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1])),
      )
    : {};
  const assetVisualSpecFingerprints = isRecord(envelope.assetVisualSpecFingerprints)
    ? Object.fromEntries(
        Object.entries(envelope.assetVisualSpecFingerprints)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : {};
  const structuredFailures = isRecord(envelope.structuredFailures)
    ? Object.fromEntries(
        Object.entries(envelope.structuredFailures).flatMap(([key, value]) => {
          if (
            !isRecord(value)
            || typeof value.stage !== "string"
            || typeof value.schemaVersion !== "string"
            || typeof value.issueFingerprint !== "string"
          ) return [];
          return [[key, {
            stage: value.stage,
            segment: Number.isInteger(value.segment) ? numberFrom(value.segment) : undefined,
            schemaVersion: value.schemaVersion,
            issueFingerprint: value.issueFingerprint,
            count: Math.max(1, numberFrom(value.count)),
            lastSeenAt: typeof value.lastSeenAt === "string"
              ? value.lastSeenAt
              : new Date().toISOString(),
            issues: Array.isArray(value.issues)
              ? value.issues.flatMap((issue) => {
                  if (
                    !isRecord(issue)
                    || typeof issue.path !== "string"
                    || typeof issue.code !== "string"
                    || typeof issue.kind !== "string"
                    || typeof issue.message !== "string"
                  ) return [];
                  return [{
                    path: issue.path,
                    code: issue.code,
                    kind: issue.kind as StructuredContractIssue["kind"],
                    message: issue.message,
                  }];
                })
              : undefined,
            candidatePreview: sanitizeStructuredCandidate(value.candidatePreview),
            systemic: value.systemic === true,
            affectedSegments: Array.isArray(value.affectedSegments)
              ? value.affectedSegments
                  .map(numberFrom)
                  .filter((segmentNo) => Number.isInteger(segmentNo) && segmentNo > 0)
              : undefined,
          } satisfies StructuredFailureState]];
        }),
      )
    : {};
  const normalizedContractVersions = isRecord(envelope.contractVersions)
    ? envelope.contractVersions
    : {};
  return {
    version: STORYBOARD_PLANNER_CHECKPOINT_VERSION,
    checkpointVersion: STORYBOARD_PLANNER_CHECKPOINT_VERSION,
    plannerMode: "split",
    inputFingerprint: fingerprint,
    inputSnapshot,
    completedStages: Array.isArray(envelope.completedStages)
      ? envelope.completedStages.filter(
          (stage): stage is PlannerCheckpointStage =>
            typeof stage === "string"
            && PLANNER_CHECKPOINT_STAGE_ORDER.includes(
              stage as PlannerCheckpointStage,
            ),
        )
      : inferCompletedCheckpointStages(envelope),
    stageOutputs: isRecord(envelope.stageOutputs)
      ? envelope.stageOutputs as Partial<Record<PlannerCheckpointStage, unknown>>
      : checkpointStageOutputs(envelope),
    contractVersions: Object.keys(normalizedContractVersions).length
      ? Object.fromEntries(
          PLANNER_CHECKPOINT_STAGE_ORDER.map((stage) => [
            stage,
            typeof normalizedContractVersions[stage] === "string"
              ? normalizedContractVersions[stage]
              : PLANNER_CHECKPOINT_CONTRACT_VERSIONS[stage],
          ]),
        ) as Record<PlannerCheckpointStage, string>
      : { ...PLANNER_CHECKPOINT_CONTRACT_VERSIONS },
    referenceFingerprint: typeof envelope.referenceFingerprint === "string"
      ? envelope.referenceFingerprint
      : referenceFactsFingerprint,
    migrationAudit: isRecord(envelope.migrationAudit)
      ? {
          fromVersion: numberFrom(envelope.migrationAudit.fromVersion),
          toVersion: STORYBOARD_PLANNER_CHECKPOINT_VERSION,
          preservedStages: Array.isArray(envelope.migrationAudit.preservedStages)
            ? envelope.migrationAudit.preservedStages.filter(
                (stage): stage is PlannerCheckpointStage =>
                  typeof stage === "string"
                  && PLANNER_CHECKPOINT_STAGE_ORDER.includes(
                    stage as PlannerCheckpointStage,
                  ),
              )
            : [],
          invalidatedStages: Array.isArray(envelope.migrationAudit.invalidatedStages)
            ? envelope.migrationAudit.invalidatedStages.filter(
                (stage): stage is PlannerCheckpointStage =>
                  typeof stage === "string"
                  && PLANNER_CHECKPOINT_STAGE_ORDER.includes(
                    stage as PlannerCheckpointStage,
                  ),
              )
            : [],
          reasons: Array.isArray(envelope.migrationAudit.reasons)
            ? envelope.migrationAudit.reasons.filter(
                (reason): reason is string => typeof reason === "string",
              )
            : [],
          migratedAt: typeof envelope.migrationAudit.migratedAt === "string"
            ? envelope.migrationAudit.migratedAt
            : new Date().toISOString(),
        }
      : undefined,
    referenceFactsRaw: envelope.referenceFactsRaw,
    referenceFactsFingerprint: typeof envelope.referenceFactsFingerprint === "string" ? envelope.referenceFactsFingerprint : undefined,
    routeClassification: isRouteClassificationCheckpoint(envelope.routeClassification)
      ? envelope.routeClassification
      : undefined,
    approvedRouteContract: isRouteClassificationCheckpoint(envelope.routeClassification)
      ? envelope.routeClassification.routeContract
      : isRecord(envelope.approvedRouteContract)
      && envelope.approvedRouteContract.version === "planning-route-v1"
      ? envelope.approvedRouteContract as ApprovedPlanningRouteContract
      : undefined,
    planningDecompositionMode: "split",
    planningCoreRaw: migrateLegacyPlanningOutput ? undefined : envelope.planningCoreRaw,
    assetVisualSpecsByAnchorId: migrateLegacyPlanningOutput ? {} : assetVisualSpecsByAnchorId,
    assetVisualSpecFingerprints: migrateLegacyPlanningOutput ? {} : assetVisualSpecFingerprints,
    planningRaw: migrateLegacyPlanningOutput ? undefined : envelope.planningRaw,
    assetPromptRepairRaw: migrateLegacyPlanningOutput ? undefined : envelope.assetPromptRepairRaw,
    storyboardArtistPlan: !migrateLegacyPlanningOutput && isRecord(envelope.storyboardArtistPlan)
      ? envelope.storyboardArtistPlan
      : undefined,
    storyContractReport: !migrateLegacyPlanningOutput && isRecord(envelope.storyContractReport)
      ? envelope.storyContractReport as unknown as StoryContractGateResult
      : undefined,
    storySemanticReview: !migrateLegacyPlanningOutput && isRecord(envelope.storySemanticReview)
      ? envelope.storySemanticReview as unknown as VideoStorySemanticReview
      : undefined,
    shotDecomposerSegmentPlans: migrateLegacyPlanningOutput ? {} : segmentPlans,
    approvedShotDecomposerSegmentPlans: migrateLegacyPlanningOutput ? {} : approvedSegmentPlans,
    promptDetailSegmentPlans: migrateLegacyPlanningOutput ? {} : promptDetailSegmentPlans,
    finalPromptRepairAttempts: migrateLegacyPlanningOutput
      ? 0
      : Math.max(0, numberFrom(envelope.finalPromptRepairAttempts)),
    timelineReplanAttempts: migrateLegacyPlanningOutput
      ? 0
      : Math.max(0, numberFrom(envelope.timelineReplanAttempts)),
    timelineChangeHistory: !migrateLegacyPlanningOutput && Array.isArray(envelope.timelineChangeHistory)
      ? envelope.timelineChangeHistory.filter(
        (item): item is TimelineChangeRequest =>
          isRecord(item)
          && typeof item.requestId === "string"
          && item.source === "single_take_audit"
          && item.changeType === "split_segment",
      ).slice(-10)
      : [],
    planningContractRepairState: !migrateLegacyPlanningOutput
      && isRecord(envelope.planningContractRepairState)
      && (
        envelope.planningContractRepairState.status === "repairing"
        || envelope.planningContractRepairState.status === "event_replan_required"
        || envelope.planningContractRepairState.status === "passed"
      )
      ? {
          status: envelope.planningContractRepairState.status,
          authority: envelope.planningContractRepairState.authority === "event"
            ? "event"
            : "legacy_migrated",
          attempts: Array.isArray(envelope.planningContractRepairState.attempts)
            ? envelope.planningContractRepairState.attempts
              .filter((item): item is PlanningContractRepairAttempt => isRecord(item)
                && Number.isInteger(item.attempt)
                && typeof item.issueFingerprint === "string"
                && typeof item.bindingFingerprintBefore === "string")
              .slice(-8)
            : [],
          currentIssues: Array.isArray(envelope.planningContractRepairState.currentIssues)
            ? envelope.planningContractRepairState.currentIssues
              .filter((item): item is PlanningNarrativeContractIssue => isRecord(item)
                && typeof item.code === "string"
                && typeof item.path === "string")
            : [],
          lastCandidateRaw: envelope.planningContractRepairState.lastCandidateRaw,
          updatedAt: typeof envelope.planningContractRepairState.updatedAt === "string"
            ? envelope.planningContractRepairState.updatedAt
            : new Date().toISOString(),
        }
      : undefined,
    resumeFromStage: typeof envelope.resumeFromStage === "string"
      ? envelope.resumeFromStage as AliyunStoryboardProgressStage
      : undefined,
    lastFailure: isRecord(envelope.lastFailure)
      && typeof envelope.lastFailure.fingerprint === "string"
      && typeof envelope.lastFailure.stage === "string"
      && typeof envelope.lastFailure.code === "string"
      ? {
          fingerprint: envelope.lastFailure.fingerprint,
          stage: envelope.lastFailure.stage,
          code: envelope.lastFailure.code,
          count: Math.max(1, numberFrom(envelope.lastFailure.count)),
          invalidatedAt: typeof envelope.lastFailure.invalidatedAt === "string"
            ? envelope.lastFailure.invalidatedAt
            : new Date().toISOString(),
        }
      : undefined,
    structuredFailures,
    updatedAt: typeof envelope.updatedAt === "string" ? envelope.updatedAt : new Date().toISOString(),
  };
}

async function savePlannerCheckpoint(
  checkpoint: AliyunStoryboardPlannerCheckpoint,
  onCheckpoint?: (checkpoint: AliyunStoryboardPlannerCheckpoint) => Promise<void> | void,
): Promise<void> {
  if (!onCheckpoint) return;
  synchronizeCheckpointV14Fields(checkpoint);
  checkpoint.updatedAt = new Date().toISOString();
  await onCheckpoint(structuredClone(checkpoint));
}

function synchronizeCheckpointV14Fields(
  checkpoint: AliyunStoryboardPlannerCheckpoint,
): void {
  const record = checkpoint as unknown as Record<string, unknown>;
  checkpoint.version = STORYBOARD_PLANNER_CHECKPOINT_VERSION;
  checkpoint.checkpointVersion = STORYBOARD_PLANNER_CHECKPOINT_VERSION;
  checkpoint.plannerMode = "split";
  checkpoint.planningDecompositionMode = "split";
  checkpoint.completedStages = inferCompletedCheckpointStages(record);
  checkpoint.stageOutputs = checkpointStageOutputs(record);
  checkpoint.contractVersions = { ...PLANNER_CHECKPOINT_CONTRACT_VERSIONS };
  checkpoint.referenceFingerprint =
    checkpoint.referenceFactsFingerprint || checkpoint.referenceFingerprint || "";
}

function serializePlannerCheckpointWriter(
  writer?: (checkpoint: AliyunStoryboardPlannerCheckpoint) => Promise<void> | void,
): ((checkpoint: AliyunStoryboardPlannerCheckpoint) => Promise<void>) | undefined {
  if (!writer) return undefined;
  let pending = Promise.resolve();
  return async (checkpoint) => {
    const snapshot = structuredClone(checkpoint);
    const write = pending.catch(() => undefined).then(() => writer(snapshot));
    pending = write.then(() => undefined, () => undefined);
    await write;
  };
}

async function reportPlannerProgress(progress: AliyunStoryboardProgressUpdate): Promise<void> {
  await plannerProgressStorage.getStore()?.onProgress?.(progress);
}

async function reportPlannerStageMetric(metric: AliyunStoryboardStageMetric): Promise<void> {
  await plannerProgressStorage.getStore()?.onStageMetric?.(metric);
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) };
  }
}

function extractChatContent(raw: unknown): string {
  if (!isRecord(raw) || !Array.isArray(raw.choices)) return "";
  const first = raw.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return "";
  return typeof first.message.content === "string" ? first.message.content.trim() : "";
}

function parseJsonObject(text: string): unknown {
  return JSON.parse(text.trim());
}

function extractError(raw: unknown): string | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.message === "string") return raw.message;
  if (typeof raw.error === "string") return raw.error;
  if (isRecord(raw.error) && typeof raw.error.message === "string") return raw.error.message;
  return undefined;
}

function summarizeRaw(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  return {
    requestId: raw.request_id ?? raw.requestId,
    code: raw.code,
    message: raw.message,
    error: raw.error,
    choices: Array.isArray(raw.choices) ? raw.choices.length : undefined,
  };
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function enforceSingleTakeVideoPrompt(prompt: string, lang: "zh" | "en"): string {
  const text = prompt.trim();
  const lower = text.toLowerCase();
  if (lang === "en") {
    const directive = "Single continuous unbroken take. Keep one uninterrupted visible action path in the same scene, preserving the camera axis family, lighting direction, color grade, subject identity, product identity, and prop layout from first frame to last frame.";
    return lower.includes("single continuous") || lower.includes("unbroken take")
      ? text
      : `${directive} ${text}`;
  }
  const directive = "单段一镜到底连续镜头：在同一场景内完成一条不中断的可见动作路径，从首帧到尾帧保持机位轴线、光线方向、色调、人物身份、产品身份和道具布局连续。";
  return text.includes("一镜到底") || text.includes("连续镜头")
    ? text
    : `${directive}${text}`;
}

function enforceSameTakeMicroShotPrompt(prompt: string, lang: "zh" | "en"): string {
  const text = prompt.trim();
  if (!text) return "";
  if (lang === "en") {
    const lower = text.toLowerCase();
    const directive = "Same continuous-take checkpoint, not a separate shot or scene: keep the same location, camera axis family, lighting direction, color tone, subject identity, product identity, prop layout, and composition continuity. ";
    return lower.includes("same continuous") || lower.includes("same-take")
      ? text
      : `${directive}${text}`;
  }
  const directive = "同一连续镜头内的检查点，不是单独镜头或新场景：保持同一地点、机位轴线、光线方向、色调、人物身份、产品身份、道具布局和构图连续。";
  return text.includes("同一连续") || text.includes("同镜头")
    ? text
    : `${directive}${text}`;
}

function unwrapPlanRoot(value: unknown, wrapperKey: string): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const wrapped = value[wrapperKey];
  return isRecord(wrapped) ? wrapped : value;
}

function readLoose(source: Record<string, unknown>, camelKey: string, snakeKey: string): unknown {
  return source[camelKey] ?? source[snakeKey];
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function safeId(value: unknown, fallback: string): string {
  const raw = stringOr(value, fallback).trim();
  return raw ? raw.replace(/[^a-zA-Z0-9_-]/g, "_") : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map(numberFrom).filter((item) => item > 0).slice(0, 80);
}

function normalizeScore(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).slice(0, 100);
}

function normalizeCameraRelation(value: unknown): CameraGraph["relations"][number]["relation"] {
  if (
    value === "same_camera_setup" ||
    value === "same_axis" ||
    value === "derived_reframe" ||
    value === "same_spatial_context" ||
    value === "same_subject_group" ||
    value === "alternate_view" ||
    value === "new_camera_setup"
  ) return value;
  return "same_spatial_context";
}

function normalizeFinalVisualMode(value: unknown): FinalTransitionPlan["visualMode"] {
  if (value === "hard_cut" || value === "match_cut" || value === "dissolve" || value === "fade_to_black" || value === "generated_bridge") return value;
  return "hard_cut";
}

function normalizeFinalAudioMode(value: unknown): FinalTransitionPlan["audioMode"] {
  if (value === "none" || value === "j_cut" || value === "l_cut" || value === "crossfade") return value;
  return "none";
}

function normalizeReferenceTargetType(value: unknown): ReferenceSelectionOutput["targetType"] {
  if (value === "keyframe" || value === "segment" || value === "micro_shot" || value === "consistency_reference" || value === "custom") return value;
  return "custom";
}

function normalizeReferenceSourceType(value: unknown): ReferenceSelectionOutput["candidates"][number]["sourceType"] {
  if (
    value === "hard_anchor" ||
    value === "user_upload" ||
    value === "recent_keyframe" ||
    value === "parent_camera" ||
    value === "transition_reference" ||
    value === "style_brand" ||
    value === "custom"
  ) return value;
  return undefined;
}

function normalizeReferenceQuotaType(value: unknown): ReferenceSelectionOutput["candidates"][number]["quotaType"] {
  if (value === "character" || value === "product" || value === "space_layout" || value === "style_brand") return value;
  return undefined;
}

function normalizeAssetView(value: unknown): VideoAssetView | undefined {
  if (value === "front" || value === "side" || value === "back" || value === "face_closeup" || value === "overview" || value === "single") return value;
  return undefined;
}

function normalizeReferenceOrientation(value: unknown): "front" | "side" | "back" | "unknown" {
  if (value === "front" || value === "side" || value === "back") return value;
  return "unknown";
}

function normalizeRiskLevel(value: unknown): NonNullable<SegmentRenderDescription["riskLevel"]> {
  if (value === "low" || value === "medium" || value === "high") return value;
  return "low";
}

function normalizeEndFrameRequirementLevel(value: unknown): NonNullable<SegmentRenderDescription["endFrameRequirementLevel"]> {
  if (value === "hard_exact" || value === "hard_semantic" || value === "soft_directional" || value === "editorial") return value;
  return "hard_semantic";
}

function normalizeArtifactStatus(value: unknown): ArtifactMetadata["status"] {
  if (value === "draft" || value === "dirty" || value === "approved" || value === "generating" || value === "ready" || value === "failed") return value;
  return "draft";
}

function normalizeArtifactRetryFromStage(value: unknown): ArtifactMetadata["retryFromStage"] {
  if (
    value === "stage1" ||
    value === "stage2a" ||
    value === "stage2b" ||
    value === "stage3" ||
    value === "reference_selector" ||
    value === "compiler" ||
    value === "generation" ||
    value === "composition" ||
    value === "manual"
  ) {
    return value;
  }
  return undefined;
}

function numberFrom(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim());
  return items.length ? items.slice(0, 20) : undefined;
}

function normalizeConstraintArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [item.trim()];
    if (!isRecord(item)) return [];
    const text = [
      stringOr(item.type, ""),
      stringOr(item.descriptionZh ?? item.description_zh ?? item.descriptionEn ?? item.description_en ?? item.description, ""),
    ].filter(Boolean).join(": ");
    return text ? [text] : [];
  });
  return items.length ? items.slice(0, 12) : undefined;
}

function normalizeAnchorType(value: unknown): VideoConsistencyAnchor["type"] | undefined {
  const normalized = typeof value === "string" ? value.trim().toLowerCase().replace(/[-\s]+/g, "_") : value;
  if (
    normalized === "person" ||
    normalized === "product" ||
    normalized === "prop" ||
    normalized === "location" ||
    normalized === "style" ||
    normalized === "brand_visual" ||
    normalized === "task_object" ||
    normalized === "effect_state" ||
    normalized === "vehicle" ||
    normalized === "food" ||
    normalized === "space_layout" ||
    normalized === "palette_mood" ||
    normalized === "graphic_backdrop" ||
    normalized === "custom"
  ) return normalized;
  if (normalized === "character" || normalized === "human" || normalized === "mascot") return "person";
  if (normalized === "scene" || normalized === "environment" || normalized === "background_environment") return "location";
  if (
    normalized === "text" ||
    normalized === "text_prop" ||
    normalized === "title" ||
    normalized === "game_title" ||
    normalized === "logo" ||
    normalized === "game_logo" ||
    normalized === "wordmark" ||
    normalized === "typography" ||
    normalized === "lettering"
  ) return "brand_visual";
  return undefined;
}

function normalizeAnchorCandidateCategory(
  value: unknown,
): VideoConsistencyAnchor["candidateCategory"] {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "core_subject"
    || normalized === "brand"
    || normalized === "scene"
    || normalized === "prop"
    || normalized === "decoration"
    || normalized === "style"
    || normalized === "custom"
    ? normalized
    : undefined;
}

function normalizeAnchorAdmissionStatus(
  value: unknown,
): VideoConsistencyAnchor["status"] {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "candidate"
    || normalized === "approved"
    || normalized === "event_local"
    || normalized === "discarded"
    ? normalized
    : undefined;
}

function normalizeReferenceStrength(value: unknown): VideoConsistencyAnchor["referenceStrength"] {
  if (value === "hard" || value === "medium" || value === "soft") return value;
  return "hard";
}

function normalizeAppliesTo(value: unknown): VideoConsistencyAnchor["appliesTo"] {
  if (!Array.isArray(value)) return ["keyframes", "segments", "micro_shots"];
  const items = value.filter((item): item is "keyframes" | "segments" | "micro_shots" => item === "keyframes" || item === "segments" || item === "micro_shots");
  return items.length ? items : ["keyframes", "segments", "micro_shots"];
}

function normalizeBeatRole(value: unknown): VideoTimelineBlueprintSegment["beatRole"] {
  if (value === "hook" || value === "setup" || value === "interaction" || value === "proof" || value === "payoff" || value === "ending" || value === "custom") return value;
  return "custom";
}

function normalizeStoryFunction(value: unknown): VideoStoryFunction | undefined {
  const normalized = typeof value === "string" ? value.trim().toLowerCase().replace(/[-\s]+/g, "_") : value;
  if (
    normalized === "hook" ||
    normalized === "setup" ||
    normalized === "conflict" ||
    normalized === "escalation" ||
    normalized === "turning_point" ||
    normalized === "proof" ||
    normalized === "payoff" ||
    normalized === "reaction" ||
    normalized === "cta" ||
    normalized === "cliffhanger" ||
    normalized === "ending" ||
    normalized === "transition" ||
    normalized === "custom"
  ) return normalized;
  if (normalized === "interaction") return "proof";
  return undefined;
}

function normalizeStoryFunctionArray(value: unknown): VideoStoryFunction[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeStoryFunction).filter((item): item is VideoStoryFunction => Boolean(item)).slice(0, 30);
}

function storyFunctionFromBeatRole(value: unknown): VideoStoryFunction {
  const beatRole = normalizeBeatRole(value);
  if (beatRole === "interaction") return "proof";
  if (beatRole === "hook" || beatRole === "setup" || beatRole === "proof" || beatRole === "payoff" || beatRole === "ending" || beatRole === "custom") return beatRole;
  return "custom";
}

function normalizeActionContinuity(value: unknown): VideoStoryTraceFields["actionContinuity"] | undefined {
  if (!isRecord(value)) return undefined;
  const motivationOrPreparation = stringOr(value.motivationOrPreparation ?? value.motivation_or_preparation, "");
  const execution = stringOr(value.execution, "");
  const resultOrReaction = stringOr(value.resultOrReaction ?? value.result_or_reaction, "");
  return motivationOrPreparation || execution || resultOrReaction
    ? { motivationOrPreparation, execution, resultOrReaction }
    : undefined;
}

function normalizeCreativeVideoType(value: unknown): VideoCreativeStrategy["videoType"] {
  const normalized = typeof value === "string" ? value.trim().toLowerCase().replace(/[-\s]+/g, "_") : value;
  if (
    normalized === "game_ad" ||
    normalized === "product_ad" ||
    normalized === "ecommerce_ad" ||
    normalized === "food_ad" ||
    normalized === "short_drama" ||
    normalized === "brand_film" ||
    normalized === "tutorial" ||
    normalized === "custom"
  ) return normalized;
  if (normalized === "game") return "game_ad";
  if (normalized === "product") return "product_ad";
  if (normalized === "ecommerce" || normalized === "e_commerce") return "ecommerce_ad";
  if (normalized === "food" || normalized === "restaurant") return "food_ad";
  return "custom";
}

function normalizeCreativeTemplateId(value: unknown): VideoCreativeTemplateId | undefined {
  const normalized = typeof value === "string" ? value.trim().toLowerCase().replace(/[-\s]+/g, "_") : value;
  if (
    normalized === "game_reversal" ||
    normalized === "game_bonus_payoff" ||
    normalized === "product_problem_solution" ||
    normalized === "ecommerce_offer_conversion" ||
    normalized === "food_sensory_reaction" ||
    normalized === "auto_performance_hero" ||
    normalized === "short_drama_conflict_twist" ||
    normalized === "generic_brand_story"
  ) return normalized;
  return undefined;
}

function normalizeCreativeCategory(value: unknown): VideoCreativeCategory | undefined {
  const normalized = typeof value === "string" ? value.trim().toLowerCase().replace(/[-\s]+/g, "_") : value;
  if (
    normalized === "game" ||
    normalized === "product" ||
    normalized === "ecommerce" ||
    normalized === "food" ||
    normalized === "auto" ||
    normalized === "short_drama" ||
    normalized === "brand" ||
    normalized === "tutorial" ||
    normalized === "custom"
  ) return normalized;
  if (normalized === "restaurant" || normalized === "catering") return "food";
  if (normalized === "car" || normalized === "vehicle" || normalized === "automotive") return "auto";
  if (normalized === "drama" || normalized === "shortfilm" || normalized === "short_film") return "short_drama";
  if (normalized === "e_commerce" || normalized === "shopping") return "ecommerce";
  return undefined;
}

function categoryFromVideoType(value: VideoCreativeStrategy["videoType"]): VideoCreativeCategory | undefined {
  if (value === "game_ad") return "game";
  if (value === "product_ad") return "product";
  if (value === "ecommerce_ad") return "ecommerce";
  if (value === "food_ad") return "food";
  if (value === "short_drama") return "short_drama";
  if (value === "brand_film") return "brand";
  if (value === "tutorial") return "tutorial";
  return undefined;
}

function classifyVideoCategoryFromText(text: string): VideoCreativeCategory {
  if (/(餐饮|餐厅|门店|出餐|食材|美食|顾客|汤|面|火锅|烧烤|咖啡|奶茶|restaurant|food|meal|chef|noodle|beef|coffee|drink shop)/i.test(text)) return "food";
  if (/(电商|下单|优惠|限时|折扣|购买|加购|购物车|包邮|order now|buy now|discount|offer|coupon|ecommerce|shop|cart)/i.test(text)) return "ecommerce";
  if (/(护肤|精华|面霜|口红|产品|卖点|使用前后|成分|功效|改善|证明|skincare|serum|cream|before and after|ingredient|product benefit)/i.test(text)) return "product";
  if (/(汽车|车型|试驾|驾驶|加速|操控|座舱|新能源|suv|sedan|car|vehicle|test drive|performance|driving)/i.test(text)) return "auto";
  if (/(剧情|短剧|人物关系|冲突|反转|悬念|误会|重逢|drama|conflict|twist|cliffhanger|reunion)/i.test(text)) return "short_drama";
  if (/(游戏|手游|棋牌|打牌|下注|bonus|jackpot|金币|倍率|排行榜|胜利|game|player|level|win|opponent|leaderboard)/i.test(text)) return "game";
  if (/(教程|教学|步骤|how to|tutorial|guide|step)/i.test(text)) return "tutorial";
  return "brand";
}

function templateForCategory(category: VideoCreativeCategory, text: string): VideoCreativeTemplateId {
  return deterministicTemplateForCategory(category, text);
}

function normalizeStoryRewriteStage(value: unknown): VideoStoryQualityReport["rewriteFromStage"] {
  if (
    value === "creative_strategy" ||
    value === "beat_sheet" ||
    value === "storyboard" ||
    value === "shot_grouping" ||
    value === "none"
  ) return value;
  return "none";
}

function normalizeSegmentDensity(value: unknown): NonNullable<VideoPlanningManifest["storyStrategy"]>["recommendedSegmentDensity"] {
  if (value === "low" || value === "medium" || value === "high") return value;
  return undefined;
}

function normalizeBoundaryMode(value: unknown): NonNullable<VideoPlanSegment["boundaryMode"]> | undefined {
  if (value === "continuous" || value === "hard_cut" || value === "dissolve" || value === "match_cut") return value;
  return undefined;
}

function normalizeOutputMode(value: unknown): NonNullable<VideoPlanSegment["outputMode"]> | undefined {
  if (value === "text" || value === "image" || value === "mixed") return value;
  return undefined;
}

function normalizeReferenceType(value: unknown): NonNullable<VideoMicroShot["referenceType"]> | undefined {
  if (value === "text" || value === "image_prompt" || value === "mixed") return value;
  if (value === "image") return "image_prompt";
  return undefined;
}

function normalizeFrameRole(value: unknown, keyframeNo: number, keyframeCount: number): NonNullable<VideoPlanKeyframe["frameRole"]> {
  if (value === "video_start" || value === "segment_start" || value === "segment_end" || value === "shared_boundary" || value === "video_end" || value === "internal_reference") return value;
  if (keyframeNo === 1) return "video_start";
  if (keyframeNo === keyframeCount) return "video_end";
  return "shared_boundary";
}

function normalizeAudioPlan(value: unknown, fallback: VideoAudioPlan | undefined): VideoAudioPlan | undefined {
  const source = isRecord(value) ? value : {};
  const mode = source.mode === "voiceover" || source.mode === "dialogue" || source.mode === "mixed" || source.mode === "silent" ? source.mode : "ambient";
  const strategyValue = source.strategy ?? source.generationStrategy ?? source.generation_strategy;
  const strategy = strategyValue === "native_ambience" || strategyValue === "native_full" || strategyValue === "post_only"
    ? strategyValue
    : fallback?.strategy ?? (mode === "silent" ? "post_only" : "native_ambience");
  const soundEffectsSource = Array.isArray(source.soundEffects)
    ? source.soundEffects
    : Array.isArray(source.sound_effects)
      ? source.sound_effects
      : [];
  const soundEffects = soundEffectsSource.filter(isRecord).flatMap((effect) => {
    const effectSource = stringOr(effect.source, "");
    const action = stringOr(effect.action, "");
    const description = stringOr(effect.description, "");
    if (!effectSource || !action || !description) return [];
    const timing = Number(effect.timingSeconds ?? effect.timing_seconds);
    return [{
      timingSeconds: Number.isFinite(timing) ? timing : undefined,
      source: effectSource,
      action,
      description,
    }];
  });
  const musicSource = isRecord(source.backgroundMusic)
    ? source.backgroundMusic
    : isRecord(source.background_music)
      ? source.background_music
      : undefined;
  const musicSourceMode = musicSource?.source;
  const backgroundMusic: VideoAudioPlan["backgroundMusic"] = musicSource && (
    musicSourceMode === "native"
    || musicSourceMode === "post"
    || musicSourceMode === "none"
  ) ? {
      source: musicSourceMode,
      style: stringOr(musicSource.style, ""),
      mood: stringOr(musicSource.mood, ""),
      intensity: stringOr(musicSource.intensity, ""),
    } : fallback?.backgroundMusic;
  return {
    mode,
    strategy,
    needsVoiceover: typeof source.needsVoiceover === "boolean"
      ? source.needsVoiceover
      : typeof source.needs_voiceover === "boolean"
        ? source.needs_voiceover
        : mode === "voiceover" || mode === "mixed",
    needsDialogue: typeof source.needsDialogue === "boolean"
      ? source.needsDialogue
      : typeof source.needs_dialogue === "boolean"
        ? source.needs_dialogue
        : mode === "dialogue" || mode === "mixed",
    language: stringOr(source.language, fallback?.language ?? ""),
    speaker: stringOr(source.speaker, fallback?.speaker ?? ""),
    voiceStyle: stringOr(source.voiceStyle ?? source.voice_style, fallback?.voiceStyle ?? ""),
    lines: normalizeStringArray(source.lines) ?? fallback?.lines,
    linesZh: normalizeStringArray(source.linesZh ?? source.lines_zh) ?? fallback?.linesZh,
    linesEn: normalizeStringArray(source.linesEn ?? source.lines_en) ?? fallback?.linesEn,
    exactTextRequired: typeof source.exactTextRequired === "boolean"
      ? source.exactTextRequired
      : typeof source.exact_text_required === "boolean"
        ? source.exact_text_required
        : fallback?.exactTextRequired,
    preserveNativeAudio: typeof source.preserveNativeAudio === "boolean"
      ? source.preserveNativeAudio
      : typeof source.preserve_native_audio === "boolean"
        ? source.preserve_native_audio
        : fallback?.preserveNativeAudio ?? strategy !== "post_only",
    soundEffects: soundEffects.length ? soundEffects : fallback?.soundEffects,
    backgroundMusic,
    rationale: stringOr(source.rationale ?? source.reason, fallback?.rationale ?? ""),
  };
}

function flattenNegative(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!isRecord(value)) return "";
  return [
    ...normalizeStringArray(value.textArtifacts ?? value.text_artifacts) ?? [],
    ...normalizeStringArray(value.anatomyArtifacts ?? value.anatomy_artifacts) ?? [],
    ...normalizeStringArray(value.renderingArtifacts ?? value.rendering_artifacts) ?? [],
    ...normalizeStringArray(value.contentExclusions ?? value.content_exclusions) ?? [],
  ].filter(Boolean).join(", ");
}
