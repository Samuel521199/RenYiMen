import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  AnchorStateTimeline,
  ArtifactMetadata,
  CameraGraph,
  FinalTransitionPlan,
  GenerationQualityReport,
  NarrativeEvent,
  OnePromptVideoPlan,
  PlanVideoProjectInput,
  PromptDebugArtifact,
  ReferenceSelectionOutput,
  SegmentRenderDescription,
  StoryboardBrief,
  VideoAspectRatio,
  VideoAssetView,
  VideoAudioPlan,
  VideoConsistencyAnchor,
  VideoCreativeCategory,
  VideoCreativeStrategy,
  VideoCreativeTemplateId,
  VideoMicroShot,
  VideoNarrativeMicroRules,
  VideoPlanKeyframe,
  VideoPlanningManifest,
  VideoPlanSegment,
  VideoPlanShot,
  VideoPromptDetailPlan,
  VideoStyleBible,
  VideoStoryBeat,
  VideoStoryFunction,
  VideoStoryQualityReport,
  VideoStoryTraceFields,
  VideoShotGroupingPass,
  VideoTimelineBlueprintSegment,
} from "./types";
import { createVideoPlan } from "./planner";
import { errorForLog, logOnePromptVideo } from "./logger";
import { assertPlanValidForGeneration } from "./plan-validator";
import { repairMotionfulEndpointContracts } from "./frame-contract";
import { auditSingleTakePlan } from "./single-take-audit";
import { decideStoryRewrite, markStoryRewriteRequired, withStoryQualityGate, type StoryRewriteDecision } from "./story-quality-gate";
import {
  readStoryRolloutConfig,
  shouldAttemptStoryRewrite,
  shouldEnableShotGrouping,
  shouldEvaluateStoryQuality,
  shouldRequireStoryQualityReview,
  type OnePromptVideoStoryRolloutConfig,
} from "./story-rollout-config";
import {
  StoryboardStageError,
  runStoryboardStageWithRetry,
} from "./storyboard-stage-retry";

const MIN_SEGMENT_SECONDS = 3;
const MAX_SEGMENT_SECONDS = 15;
const MAX_SINGLE_TAKE_REVISIONS = 3;
const MAX_STORY_QUALITY_REWRITES = 2;
const MAX_JSON_REPAIR_INPUT_CHARS = 60000;
const DEFAULT_JSON_STAGE_TIMEOUT_MS = 180000;

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

const JSON_REPAIR_SYSTEM_PROMPT = `You are a strict JSON repair tool.

Return only valid JSON. No markdown, explanations, comments, or extra text.

Your job:
- Fix syntax errors in the provided JSON-like text.
- Preserve all semantic content, keys, arrays, objects, strings, numbers, and booleans as much as possible.
- Do not invent new story content.
- Do not translate values.
- If a value is truncated or impossible to recover, close the nearest valid object/array conservatively.
- Output one complete JSON object.`;

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
  narrativeMicroRules: VideoNarrativeMicroRules;
  shotGroupingPass?: VideoShotGroupingPass;
  storyQualityReport: VideoStoryQualityReport;
  anchorStateTimeline: AnchorStateTimeline[];
  audioBible: Record<string, unknown>;
  candidateTimeline: VideoTimelineBlueprintSegment[];
  storyboardBrief: StoryboardBrief[];
  segmentRenderDescriptions: SegmentRenderDescription[];
  cameraGraph?: CameraGraph;
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
- First output creative_strategy before narrative_events. Decide video_category, template_id, template_reason, conversion_goal, viewer promise, hook, conflict, turning point, payoff, CTA, and how references should be used as assets rather than as a finished storyboard.
- Route the task to exactly one initial template_id: game_reversal, game_bonus_payoff, product_problem_solution, ecommerce_offer_conversion, food_sensory_reaction, auto_performance_hero, short_drama_conflict_twist, or generic_brand_story.
- Do not use game-only semantics such as bonus, jackpot, opponent shock, cards, coins, leaderboard, or win streak unless video_category is game.
- If category is uncertain, choose generic_brand_story and write fallback_reason_zh.
- First decompose the task into narrative_events before deciding the segment timeline.
- Output narrative_micro_rules so later stages know which story failures to avoid, especially sudden outcome, reference-only animation, missing visible trigger, and CTA before payoff.
- Decide which objects, states, visual rules, and task elements must stay consistent across the whole video.
- For every consistency anchor, separate static visual locks from dynamic state changes across the story.
- Output anchor_state_timeline so later stages can distinguish legal state evolution from identity drift.
- Decide whether this video needs editorial overlay subtitles, and if needed define their role, language, timing, placement, readability, and editability requirements.
- Derive candidate_timeline and planning_manifest.timeline_blueprint from narrative_events. Do not invent segment boundaries without event reasons.
- Do not write detailed keyframes, video prompts, image prompts, or micro-shot prompts.

Hard rules:
- Every segment duration must be 3-15 seconds.
- Total segment duration must equal duration_seconds exactly.
- Segment count must be between segment_count_min and segment_count_max.
- Do not default to 6 segments for 30 seconds. Choose by task complexity, information rhythm, subtitle rhythm, action continuity, scene changes, and generation continuity risk.
- Every segment must be generatable as one continuous unbroken camera take. A segment is not a montage container.
- If a beat requires a location change, environment replacement, large time jump, major camera setup change, major composition reset, subject teleport, product state discontinuity, or dissolve-like transformation, create a new segment boundary instead of putting that change inside one segment.
- Start and end boundary frames of the same segment must be compatible as two moments from the same continuous shot: same location logic, same camera axis family, same subject/product identity, same lighting direction, and no impossible scene jump.
- Identify consistency anchors dynamically. Do not assume every task has a product. Anchors may be person, product, prop, location, style, brand_visual, task_object, effect_state, vehicle, food, space_layout, or custom.
- A consistency-anchor image prompt is an asset-sheet prompt, not a narrative keyframe. Keep identity/appearance facts, but remove story actions, screen positions, title interactions, scene decoration, and event-specific composition.
- For a person anchor, image_prompt_zh/image_prompt_en must request exactly one character, one requested view, centered and clearly visible on a plain white or light-neutral studio background. It must explicitly forbid scenery, decorative backgrounds, text, titles, logos, UI, frames, collages, and duplicate people.
- Reference images may contain a finished poster or advertisement. Extract the anchor's stable identity only; never copy the reference image's background, typography, logo placement, framing, or full composition into a person asset prompt.
- Scene/location anchors may describe the environment. Brand-visual anchors may describe approved logos or typography. Do not leak those elements into person, prop, or product asset prompts unless they are an intrinsic part of that asset.
- Every narrative_event must include event_id, dramatic_goal, participants, location_id, initial_state, action, resulting_state, required_anchor_ids, previous_event_ids, and must_become_separate_segment.
- previous_event_ids must only reference earlier narrative_events.
- required_anchor_ids must exist in consistency_manifest. If you discover a needed anchor, add it to consistency_manifest before referencing it.
- Every candidate_timeline segment and every planning_manifest.timeline_blueprint segment must include source_event_ids.
- If any source event has must_become_separate_segment=true, do not merge it with unrelated events unless split_reason_zh explicitly explains why this remains a single continuous take.
- anchor_state_timeline must record each dynamic anchor's anchor_id and states with segment_no or event_id, start_state, end_state, start_position, end_position, holder_at_start, holder_at_end, and visible_transition_path.
- A product/prop cannot occupy two mutually exclusive places at the same time unless consistency_manifest explicitly defines multiple instances.
- Holder changes must have a visible_transition_path or an event explanation.
- The timeline_blueprint is a hard contract for later stages.

Return this JSON shape:
{
  "creative_strategy": {
    "video_type": "game_ad | product_ad | ecommerce_ad | food_ad | short_drama | brand_film | tutorial | custom",
    "video_category": "game | product | ecommerce | food | auto | short_drama | brand | tutorial | custom",
    "template_id": "game_reversal | game_bonus_payoff | product_problem_solution | ecommerce_offer_conversion | food_sensory_reaction | auto_performance_hero | short_drama_conflict_twist | generic_brand_story",
    "template_reason_zh": "",
    "conversion_goal_zh": "",
    "fallback_reason_zh": "",
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
  "consistency_manifest": {
    "anchors": []
  },
  "narrative_events": [
    {
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
    }
  ],
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
          "image_prompt_zh": "",
          "image_prompt_en": ""
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

const STORYBOARD_ARTIST_SYSTEM_PROMPT = `You are Storyboard Artist for a controllable AI video pipeline.

Return only valid JSON. No markdown, explanations, or comments.

Your only job in stage 2A:
- Use planning_manifest as the source of truth.
- Use creative_strategy and narrative_micro_rules as story quality constraints.
- Create a concise whole-story storyboard brief for each segment.
- Create story_beats before or alongside storyboard_brief. Each story beat must explain story_function, emotional_beat, cause, effect, information_unit, key_evidence_ids, and required_anchor_ids.
- Create shot_grouping_pass that maps story_beats to segment numbers, merges adjacent micro-beats only when they share narrative focus, physical space, continuous action chain, emotion direction, and compatible POV/objective camera relation, and explains why each beat group can be executed as one continuous i2v segment.
- Draft camera_graph and final_transition_plan.
- Keep output short and structural.

Hard rules:
- Do not output final prompts.
- Do not output complete image prompts.
- Do not output complete video prompts.
- Do not output detailed checkpoint prompts.
- Do not rewrite planning_manifest.timeline_blueprint.
- Every storyboard_brief item must include linked_beat_ids and story_function.
- shot_grouping_pass.groups must never exceed 15 seconds total duration.
- shot_grouping_pass.split_reasons is required for every adjacent segment pair that is not in the same group.
- Always split for space changes, time jumps, new conflict relationship, obvious payoff state change, or CTA entry.
- Each storyboard_brief item must include segment_no, source_event_ids, camera_id, visual_desc_zh, visual_desc_en, beat_role, required_anchor_ids, location_id, and separation_reason.
- Every new_camera_setup must either create a transition_reference_plan item for its target camera/segment or put an explicit no-inheritance explanation in inheritance_reason_zh. Never leave missing_info unresolved.
- Every alternate_view must include axis_description and spatial_layout_lock. If either is missing, the hard audit reason is alternate_view_axis_or_left_right_lock_missing.
- Evaluate transition-reference need for every alternate_view, derived_reframe whose parent frame cannot directly supply the target framing, and new setup inheriting layout, light, or positions. Use mode=short when an approved parent frame is sufficient; use mode=full when a generated camera move and extracted target-view frame are required.
- A transition reference is generation-only scene-layout evidence and never enters the final edit. A generated_bridge is an independent final-edit clip. Never reuse one artifact or approval state for both concepts.

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
        "required_anchor_ids": [],
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
        "location_id": "",
        "separation_reason": ""
      }
    ],
    "camera_graph": {
      "cameras": [
        {
          "camera_id": "camera_01",
          "segment_nos": [1],
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

const SHOT_DECOMPOSER_SYSTEM_PROMPT = `You are Shot Decomposer for a controllable AI video pipeline.

Return only valid JSON. No markdown, explanations, or comments.

Your only job in stage 2B:
- Use planning_manifest and storyboard_artist_plan as the source of truth.
- Use story_beats and shot_grouping_pass as the source of truth for story causality.
- Follow planning_manifest.timeline_blueprint exactly for segment count, start time, end time, and duration.
- Convert every storyboard brief into executable start/end frame contracts, motion contracts, single-take contracts, boundary keyframe descriptions, segment descriptions, subtitles, audio_plan, and same-take motion checkpoints.
- Follow planning_manifest.subtitle_policy. If subtitles are not needed, leave segment.subtitle empty. If subtitles are needed, generate concise editable overlay subtitles for each appropriate segment.
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
- Every segment must include linked_beat_ids, story_function, emotional_beat, cause, effect, information_unit, and key_evidence_ids. Do not leave linked_beat_ids empty.
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
        "visible_anchor_ids": [],
        "start_frame_contract": {},
        "end_frame_contract": {},
        "motion_contract": {},
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
          "needs_voiceover": false,
          "needs_dialogue": false,
          "language": "",
          "speaker": "",
          "voice_style": "",
          "lines_zh": [],
          "lines_en": [],
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

Return only valid JSON. No markdown, explanations, or comments.

Your job:
- Decompose only the target segment specified by target_segment_no.
- Use planning_manifest_summary, target_timeline_segment, storyboard_context, and consistency anchors as the source of truth.
- Do not rewrite story, segment timing, segment count, camera graph, anchor identity, product identity, or style rules.
- Write this segment as one continuous unbroken camera take from keyframe N to keyframe N+1.
- Do not describe internal cuts, dissolves, fades, montage edits, shot switches, or scene transitions inside the segment.
- The start and end keyframes must be reachable moments in the same scene and camera setup family.
- Include concise bilingual fields for user-visible text.
- Subtitles are editorial overlay copy. Do not ask generated images/videos to render text.
- Use target_story_beats and target_shot_group to preserve story causality.
- The target segment must include linked_beat_ids, story_function, emotional_beat, cause, effect, information_unit, and key_evidence_ids. Do not leave linked_beat_ids empty.
- If the target segment contains a complex action, state action_continuity with motivation_or_preparation, execution, and result_or_reaction.
- If story_function is payoff or turning_point, include reaction_beat and power_shift.

Return this JSON shape, containing only the target segment, its render description, and keyframes N/N+1:
{
  "shot_decomposer_plan": {
    "segment_render_descriptions": [
      {
        "segment_no": 1,
        "visible_anchor_ids": [],
        "start_frame_contract": {},
        "end_frame_contract": {},
        "motion_contract": {},
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
        "frame_role": "segment_start | segment_end | video_start | video_end | shared_boundary",
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
          "needs_voiceover": false,
          "needs_dialogue": false,
          "language": "",
          "speaker": "",
          "voice_style": "",
          "lines_zh": [],
          "lines_en": [],
          "rationale": ""
        },
        "output_mode": "mixed",
        "linked_beat_ids": ["beat_1"],
        "story_function": "hook | setup | conflict | escalation | turning_point | proof | payoff | reaction | cta | cliffhanger | ending | transition | custom",
        "emotional_beat_zh": "",
        "cause": "",
        "effect": "",
        "information_unit": "",
        "key_evidence_ids": [],
        "action_continuity": {
          "motivation_or_preparation": "",
          "execution": "",
          "result_or_reaction": ""
        },
        "reaction_beat": "",
        "power_shift": "",
        "constraints": [],
        "timed_prompts": [],
        "micro_shots": [],
        "uses_consistency_anchors": [],
        "negative_prompt": ""
      }
    ]
  }
}`;

const SPLIT_REPAIR_SYSTEM_PROMPT = `You are Single-Take Split Repair for a controllable AI video pipeline.

Return only valid JSON. No markdown, explanations, or comments.

Your job:
- Repair shot_decomposer_plan so every segment is executable as one continuous unbroken camera take.
- Preserve planning_manifest.timeline_blueprint segment count, segment numbers, start/end/duration, narrative_events, anchors, and storyboard_artist_plan unless the audit says the segment cannot be repaired.
- Prefer simplifying action, reducing camera movement, clarifying product/prop paths, merging excessive checkpoints, and making start/end frame contracts physically reachable.
- Do not hide cuts inside wording. If a segment still requires a cut, keep requires_cut=true, risk_level=high, and explain why with recommended_split.
- Do not output final image or video prompts.

Return this JSON shape:
{
  "shot_decomposer_plan": {
    "title": "",
    "logline": "",
    "style_bible": {},
    "segment_render_descriptions": [],
    "keyframes": [],
    "segments": []
  },
  "repair_notes": []
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
  errorMessage?: string;
};

export interface AliyunStoryboardPlannerCheckpoint {
  version: 1;
  inputFingerprint: string;
  planningRaw?: unknown;
  storyboardArtistPlan?: Record<string, unknown>;
  shotDecomposerSegmentPlans?: Record<string, Record<string, unknown>>;
  updatedAt: string;
}

export type AliyunStoryboardProgressStage =
  | "queued"
  | "planning_architect"
  | "storyboard_artist"
  | "shot_decomposer"
  | "single_take_audit"
  | "split_repair"
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
  };
}

interface AliyunStoryboardPlannerOptions {
  checkpoint?: unknown;
  onCheckpoint?: (checkpoint: AliyunStoryboardPlannerCheckpoint) => Promise<void> | void;
  onProgress?: (progress: AliyunStoryboardProgressUpdate) => Promise<void> | void;
}

const plannerProgressStorage = new AsyncLocalStorage<{
  onProgress?: (progress: AliyunStoryboardProgressUpdate) => Promise<void> | void;
}>();

export async function createAliyunStoryboardPlan(
  input: PlanVideoProjectInput,
  options: AliyunStoryboardPlannerOptions = {},
): Promise<OnePromptVideoPlan> {
  return plannerProgressStorage.run({ onProgress: options.onProgress }, () => createAliyunStoryboardPlanInternal(input, options));
}

async function createAliyunStoryboardPlanInternal(
  input: PlanVideoProjectInput,
  options: AliyunStoryboardPlannerOptions,
): Promise<OnePromptVideoPlan> {
  const referenceImageUrls = input.referenceImageUrls.slice(0, 4);
  const fallback = createVideoPlan(input);
  const visionModel = referenceImageUrls.length
    ? model("ALIYUN_STORYBOARD_VISION_MODEL", "qwen-vl-max")
    : model("ALIYUN_STORYBOARD_MODEL", "qwen3.7-plus");
  const textModel = model("ALIYUN_STORYBOARD_MODEL", "qwen3.7-plus");
  const checkpoint = normalizeAliyunStoryboardPlannerCheckpoint(options.checkpoint, input);

  await logOnePromptVideo("aliyun.storyboard.three_stage.start", {
    promptLength: input.userPrompt.length,
    aspectRatio: input.aspectRatio,
    durationSeconds: input.durationSeconds,
    referenceImageCount: referenceImageUrls.length,
  });

  try {
    await reportPlannerProgress({
      stage: "planning_architect",
      completedSteps: 0,
      totalSteps: 4,
      detailZh: "正在理解创意、参考图、广告目标和时间轴约束。",
      detailEn: "Understanding the brief, references, campaign goal, and timeline constraints.",
    });
    const planningRaw = checkpoint.planningRaw ?? await callJsonStage({
        stage: "planning_architect",
        modelName: visionModel,
        systemPrompt: PLANNING_ARCHITECT_SYSTEM_PROMPT,
        userContent: buildPlanningArchitectContent(input, referenceImageUrls),
        temperature: 0.25,
      });
    if (checkpoint.planningRaw === undefined) {
      checkpoint.planningRaw = planningRaw;
      await savePlannerCheckpoint(checkpoint, options.onCheckpoint);
    } else {
      await logOnePromptVideo("aliyun.storyboard.planning_architect.checkpoint_reused", {
        inputFingerprint: checkpoint.inputFingerprint,
      });
    }
    const planningManifest = normalizePlanningManifest(planningRaw, input, fallback);
    const totalSegments = planningManifest.timelineBlueprint.segments.length;
    const totalPlanningSteps = totalSegments + 4;
    await reportPlannerProgress({
      stage: "storyboard_artist",
      completedSteps: 1,
      totalSteps: totalPlanningSteps,
      totalSegments,
      detailZh: `规划架构已完成，正在设计剧情节拍、冲突、转折和 CTA；后续需要拆解 ${totalSegments} 个片段。`,
      detailEn: `Planning architecture is complete. Designing story beats, conflict, payoff, and CTA before decomposing ${totalSegments} segments.`,
    });
    const planningStoryDesignBase = storyDesignStageContext(planningRaw);
    const planningStoryDesignContext: Record<string, unknown> = {
      ...planningStoryDesignBase,
      creative_strategy: normalizeCreativeStrategy(planningStoryDesignBase.creative_strategy, planningManifest, []),
    };
    await logOnePromptVideo("aliyun.storyboard.planning_architect.parsed", {
      planningRaw,
      planningManifest,
      storyDesignContext: planningStoryDesignContext,
    });

    let storyboardArtistPlan = checkpoint.storyboardArtistPlan;
    if (!storyboardArtistPlan) {
      const storyboardArtistRaw = await callJsonStage({
        stage: "storyboard_artist",
        modelName: textModel,
        systemPrompt: STORYBOARD_ARTIST_SYSTEM_PROMPT,
        userContent: JSON.stringify({
          user_idea: input.userPrompt,
          aspect_ratio: input.aspectRatio,
          duration_seconds: input.durationSeconds,
          planning_manifest: planningManifest,
          story_design_context: planningStoryDesignContext,
          confirmed_anchor_images: [],
        }),
        temperature: 0.3,
      });
      storyboardArtistPlan = unwrapPlanRoot(storyboardArtistRaw, "storyboard_artist_plan");
      checkpoint.storyboardArtistPlan = storyboardArtistPlan;
      await savePlannerCheckpoint(checkpoint, options.onCheckpoint);
    } else {
      await logOnePromptVideo("aliyun.storyboard.storyboard_artist.checkpoint_reused", {
        inputFingerprint: checkpoint.inputFingerprint,
      });
    }
    await logOnePromptVideo("aliyun.storyboard.storyboard_artist.parsed", {
      storyboardArtistPlan,
    });
    await reportPlannerProgress({
      stage: "shot_decomposer",
      completedSteps: 2,
      totalSteps: totalPlanningSteps,
      completedSegments: 0,
      totalSegments,
      detailZh: `剧情设计已完成，开始拆解 ${totalSegments} 个可执行视频片段。`,
      detailEn: `Story design is complete. Decomposing ${totalSegments} executable video segments.`,
    });

    let shotDecomposerPlan = await createShotDecomposerPlan({
      input,
      modelName: textModel,
      planningManifest,
      storyboardArtistPlan,
      storyDesignContext: {
        ...planningStoryDesignContext,
        story_beats: readLoose(storyboardArtistPlan, "storyBeats", "story_beats") ?? planningStoryDesignContext.story_beats,
        shot_grouping_pass: readLoose(storyboardArtistPlan, "shotGroupingPass", "shot_grouping_pass") ?? planningStoryDesignContext.shot_grouping_pass,
      },
      checkpoint,
      onCheckpoint: options.onCheckpoint,
    });
    await logOnePromptVideo("aliyun.storyboard.shot_decomposer.parsed", {
      shotDecomposerPlan,
    });
    shotDecomposerPlan = await repairShotDecomposerPlanUntilSingleTake({
      input,
      modelName: textModel,
      planningManifest,
      storyboardArtistPlan,
      storyDesignContext: {
        ...planningStoryDesignContext,
        story_beats: readLoose(storyboardArtistPlan, "storyBeats", "story_beats") ?? planningStoryDesignContext.story_beats,
        shot_grouping_pass: readLoose(storyboardArtistPlan, "shotGroupingPass", "shot_grouping_pass") ?? planningStoryDesignContext.shot_grouping_pass,
      },
      shotDecomposerPlan,
    });
    await reportPlannerProgress({
      stage: "prompt_detailer",
      completedSteps: totalSegments + 3,
      totalSteps: totalPlanningSteps,
      completedSegments: totalSegments,
      totalSegments,
      detailZh: "分镜和一镜到底检查已完成，正在编译图片、视频和负面提示词。",
      detailEn: "Shot decomposition and single-take audit are complete. Compiling image, video, and negative prompts.",
    });
    let storyboardPlan = mergeStage2Plans(storyboardArtistPlan, shotDecomposerPlan);

    const promptDetailRaw = await callJsonStage({
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
    let promptDetailPlan = normalizePromptDetailPlan(promptDetailRaw);
    await logOnePromptVideo("aliyun.storyboard.prompt_detailer.parsed", {
      promptDetailRaw,
      promptDetailPlan,
    });
    await reportPlannerProgress({
      stage: "story_quality_gate",
      completedSteps: totalSegments + 3,
      totalSteps: totalPlanningSteps,
      completedSegments: totalSegments,
      totalSegments,
      detailZh: "提示词已完成，正在执行剧情质量和结构校验。",
      detailEn: "Prompts are complete. Running story quality and structural validation.",
    });

    const storyRolloutConfig = readStoryRolloutConfig();
    await logOnePromptVideo("story_rollout.config", { ...storyRolloutConfig });

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
    if (shouldAttemptStoryRewrite(storyRolloutConfig)) {
      const storyRewriteResult = await rewriteStoryPlanUntilQualityPass({
        input,
        modelName: textModel,
        planningRaw,
        planningManifest,
        fallback: planFallback,
        storyboardPlan,
        promptDetailPlan,
        plan,
        rolloutConfig: storyRolloutConfig,
      });
      plan = storyRewriteResult.plan;
      storyboardPlan = storyRewriteResult.storyboardPlan;
      promptDetailPlan = storyRewriteResult.promptDetailPlan;
    } else {
      plan = finalizeStoryQualityRollout(plan, storyRolloutConfig, 0, decideStoryRewrite(plan.storyQualityReport));
      await logOnePromptVideo("story_quality_rewrite.skipped", {
        storyGateMode: storyRolloutConfig.storyGateMode,
        storyRewriteMax: storyRolloutConfig.storyRewriteMax,
        score: plan.storyQualityReport?.score,
        issueCodes: plan.storyQualityReport?.issueCodes ?? [],
      }, decideStoryRewrite(plan.storyQualityReport).shouldRewrite ? "warn" : "info");
    }
    plan = repairMotionfulEndpointContracts(plan);
    const validationIssues = assertPlanValidForGeneration(plan, { stage: "planning" });

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
    return plan;
  } catch (error) {
    await logOnePromptVideo("aliyun.storyboard.three_stage.error", errorForLog(error), "error");
    throw error;
  }
}

async function callJsonStage(params: {
  stage: string;
  modelName: string;
  systemPrompt: string;
  userContent: ChatContent;
  temperature: number;
}): Promise<unknown> {
  const startedAt = Date.now();
  const body: Record<string, unknown> = {
    model: params.modelName,
    messages: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.userContent },
    ],
    temperature: params.temperature,
    response_format: { type: "json_object" },
  };
  await logOnePromptVideo(`aliyun.storyboard.${params.stage}.request`, {
    model: params.modelName,
    baseUrl: compatibleBaseUrl(),
  });
  const result = await fetchJsonStageContent(params.stage, body);
  await logOnePromptVideo(`aliyun.storyboard.${params.stage}.response`, {
    httpStatus: result.httpStatus,
    ok: result.ok,
    durationMs: Date.now() - startedAt,
    rawSummary: result.rawSummary,
  }, result.ok ? "info" : "error");
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
  try {
    return parseJsonObject(content);
  } catch (parseError) {
    await logOnePromptVideo(`aliyun.storyboard.${params.stage}.json_parse.failed`, {
      error: errorForLog(parseError),
      contentLength: content.length,
      contentPreview: content.slice(0, 1200),
    }, "warn");
    if (params.stage.startsWith("json_repair")) throw parseError;
    return repairJsonStageContent({
      stage: params.stage,
      modelName: model("ALIYUN_STORYBOARD_MODEL", params.modelName),
      content,
      parseError,
    });
  }
}

async function fetchJsonStage(stage: string, body: Record<string, unknown>): Promise<Response> {
  const timeoutMs = jsonStageTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${compatibleBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${requireDashScopeApiKey()}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
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
  }
}

async function fetchJsonStageContent(stage: string, body: Record<string, unknown>): Promise<JsonStageContentResult> {
  if (jsonStageStreamingEnabled()) return fetchJsonStageContentStream(stage, body);
  const startedAt = Date.now();
  const res = await fetchJsonStage(stage, body);
  const raw = await safeJson(res);
  return {
    httpStatus: res.status,
    ok: res.ok,
    durationMs: Date.now() - startedAt,
    content: res.ok ? extractChatContent(raw) : "",
    rawSummary: summarizeRaw(raw),
    errorMessage: extractError(raw),
  };
}

async function fetchJsonStageContentStream(stage: string, body: Record<string, unknown>): Promise<JsonStageContentResult> {
  const startedAt = Date.now();
  const firstChunkTimeoutMs = jsonStageTimeoutMs();
  const idleTimeoutMs = jsonStageStreamIdleTimeoutMs();
  const maxStreamMs = jsonStageStreamMaxTimeoutMs();
  const controller = new AbortController();
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

  try {
    const res = await fetch(`${compatibleBaseUrl()}/chat/completions`, {
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
        errorMessage: extractError(raw),
      };
    }
    if (!res.body) throw new Error(`Aliyun storyboard ${stage} stream returned empty body`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const contentParts: string[] = [];
    let buffer = "";
    let chunkCount = 0;
    let firstChunkMs: number | undefined;
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
      let raw: unknown;
      try {
        raw = JSON.parse(data);
      } catch {
        return;
      }
      if (isRecord(raw) && raw.usage) usage = raw.usage;
      const choices = isRecord(raw) && Array.isArray(raw.choices) ? raw.choices : [];
      for (const choice of choices) {
        if (!isRecord(choice)) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const delta = isRecord(choice.delta) ? choice.delta : undefined;
        const message = isRecord(choice.message) ? choice.message : undefined;
        const piece = typeof delta?.content === "string"
          ? delta.content
          : typeof message?.content === "string"
            ? message.content
            : "";
        if (piece) {
          contentParts.push(piece);
          chunkCount += 1;
          if (firstChunkMs === undefined) firstChunkMs = Date.now() - startedAt;
        }
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
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

    const content = contentParts.join("").trim();
    return {
      httpStatus: res.status,
      ok: true,
      durationMs: Date.now() - startedAt,
      content,
      rawSummary: {
        stream: true,
        chunkCount,
        contentLength: content.length,
        firstChunkMs,
        finishReason,
        usage,
      },
    };
  } catch (error) {
    if (idleTimeout) clearTimeout(idleTimeout);
    clearTimeout(maxTimeout);
    if (error instanceof Error && error.name === "AbortError") {
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
  }
}

async function repairJsonStageContent(params: {
  stage: string;
  modelName: string;
  content: string;
  parseError: unknown;
}): Promise<unknown> {
  const startedAt = Date.now();
  const repairContent = JSON.stringify({
    stage: params.stage,
    parse_error: errorForLog(params.parseError),
    json_like_text: params.content.slice(0, MAX_JSON_REPAIR_INPUT_CHARS),
  });
  const body = {
    model: params.modelName,
    messages: [
      { role: "system", content: JSON_REPAIR_SYSTEM_PROMPT },
      { role: "user", content: repairContent },
    ],
    temperature: 0,
    response_format: { type: "json_object" },
  };
  await logOnePromptVideo(`aliyun.storyboard.${params.stage}.json_repair.request`, {
    model: params.modelName,
    contentLength: params.content.length,
  }, "warn");
  await reportPlannerProgress({
    stage: "json_repair",
    detailZh: `${params.stage} 返回的 JSON 不完整，正在执行结构修复。`,
    detailEn: `${params.stage} returned invalid JSON. Repairing its structure.`,
    metricsDelta: { jsonRepairCount: 1 },
  });
  const result = await fetchJsonStageContent(`json_repair_${params.stage}`, body);
  const repairDurationMs = Date.now() - startedAt;
  await logOnePromptVideo(`aliyun.storyboard.${params.stage}.json_repair.response`, {
    httpStatus: result.httpStatus,
    ok: result.ok,
    durationMs: repairDurationMs,
    rawSummary: result.rawSummary,
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
  const repaired = parseJsonObject(repairedContent);
  await logOnePromptVideo(`aliyun.storyboard.${params.stage}.json_repair.success`, {
    repairedContentLength: repairedContent.length,
  });
  return repaired;
}

function buildPlanningArchitectContent(input: PlanVideoProjectInput, referenceImageUrls: string[]): ChatContent {
  const bounds = segmentCountBounds(input.durationSeconds);
  const payload = JSON.stringify({
    user_idea: input.userPrompt,
    aspect_ratio: input.aspectRatio,
    duration_seconds: input.durationSeconds,
    style_preset: input.stylePreset,
    segment_count_min: bounds.min,
    segment_count_max: bounds.max,
    segment_duration_min_seconds: MIN_SEGMENT_SECONDS,
    segment_duration_max_seconds: MAX_SEGMENT_SECONDS,
    reference_images: referenceImageUrls.map((url, index) => ({
      index: index + 1,
      url,
      instruction: "Extract only stable visual facts needed for task understanding, timeline planning, and consistency anchors.",
    })),
  });
  if (!referenceImageUrls.length) return payload;
  return [
    { type: "text", text: payload },
    ...referenceImageUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
  ];
}

function storyDesignStageContext(source: unknown): Record<string, unknown> {
  const envelope = isRecord(source) ? source : {};
  const root = unwrapPlanRoot(source, "planning_manifest");
  return {
    creative_strategy: readLoose(envelope, "creativeStrategy", "creative_strategy") ?? readLoose(root, "creativeStrategy", "creative_strategy") ?? {},
    narrative_micro_rules: readLoose(envelope, "narrativeMicroRules", "narrative_micro_rules") ?? readLoose(root, "narrativeMicroRules", "narrative_micro_rules") ?? {},
    story_beats: readLoose(envelope, "storyBeats", "story_beats") ?? readLoose(root, "storyBeats", "story_beats") ?? [],
    shot_grouping_pass: readLoose(envelope, "shotGroupingPass", "shot_grouping_pass") ?? readLoose(root, "shotGroupingPass", "shot_grouping_pass") ?? {},
  };
}

async function createShotDecomposerPlan(params: {
  input: PlanVideoProjectInput;
  modelName: string;
  planningManifest: VideoPlanningManifest;
  storyboardArtistPlan: Record<string, unknown>;
  storyDesignContext: Record<string, unknown>;
  checkpoint: AliyunStoryboardPlannerCheckpoint;
  onCheckpoint?: (checkpoint: AliyunStoryboardPlannerCheckpoint) => Promise<void> | void;
}): Promise<Record<string, unknown>> {
  if (shotDecomposerMode() === "whole") {
    return callWholeShotDecomposerPlan(params);
  }

  const timelineSegments = params.planningManifest.timelineBlueprint.segments;
  if (timelineSegments.length <= 1) {
    return callWholeShotDecomposerPlan(params);
  }

  const concurrency = shotDecomposerConcurrency();
  await logOnePromptVideo("aliyun.storyboard.shot_decomposer.segmented.start", {
    segmentCount: timelineSegments.length,
    concurrency,
    model: params.modelName,
  });

  let completedSegments = 0;
  const segmentPlans = await mapWithConcurrency(timelineSegments, concurrency, async (segment) => {
    const stage = `shot_decomposer_s${segment.segmentNo}`;
    const checkpointKey = String(segment.segmentNo);
    let plan = params.checkpoint.shotDecomposerSegmentPlans?.[checkpointKey];
    if (!plan) {
      const raw = await runStoryboardStageWithRetry({
        stage,
        maxAttempts: shotDecomposerRetryAttempts(),
        baseDelayMs: shotDecomposerRetryBaseDelayMs(),
        run: () => callJsonStage({
          stage,
          modelName: params.modelName,
          systemPrompt: SHOT_DECOMPOSER_SEGMENT_SYSTEM_PROMPT,
          userContent: buildShotDecomposerSegmentContent({
            ...params,
            segment,
          }),
          temperature: 0.28,
        }),
        onRetry: async ({ attempt, nextAttempt, delayMs, error }) => {
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
            completedSteps: 2 + completedSegments,
            totalSteps: timelineSegments.length + 4,
            currentSegmentNo: segment.segmentNo,
            completedSegments,
            totalSegments: timelineSegments.length,
            attempt: nextAttempt,
            detailZh: `第 ${segment.segmentNo} 段上游请求超时，${Math.round(delayMs / 1000)} 秒后进行第 ${nextAttempt} 次尝试；已完成 ${completedSegments}/${timelineSegments.length} 段。`,
            detailEn: `Segment ${segment.segmentNo} timed out upstream. Attempt ${nextAttempt} starts in ${Math.round(delayMs / 1000)}s; ${completedSegments}/${timelineSegments.length} segments are complete.`,
          });
        },
      });
      plan = unwrapPlanRoot(raw, "shot_decomposer_plan");
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
    await logOnePromptVideo("aliyun.storyboard.shot_decomposer.segment.parsed", {
      segmentNo: segment.segmentNo,
      keyframeCount: arrayOfRecords(plan.keyframes).length,
      segmentCount: arrayOfRecords(plan.segments).length,
      renderDescriptionCount: arrayOfRecords(plan.segment_render_descriptions ?? plan.segmentRenderDescriptions).length,
    });
    completedSegments += 1;
    await reportPlannerProgress({
      stage: "shot_decomposer",
      completedSteps: 2 + completedSegments,
      totalSteps: timelineSegments.length + 4,
      currentSegmentNo: segment.segmentNo,
      completedSegments,
      totalSegments: timelineSegments.length,
      detailZh: `已完成 ${completedSegments}/${timelineSegments.length} 个片段，刚完成第 ${segment.segmentNo} 段。`,
      detailEn: `Completed ${completedSegments}/${timelineSegments.length} segments; segment ${segment.segmentNo} just finished.`,
    });
    return plan;
  });

  const merged = mergeShotDecomposerSegmentPlans({
    storyboardArtistPlan: params.storyboardArtistPlan,
    planningManifest: params.planningManifest,
    segmentPlans,
  });
  await logOnePromptVideo("aliyun.storyboard.shot_decomposer.segmented.merged", {
    segmentCount: arrayOfRecords(merged.segments).length,
    keyframeCount: arrayOfRecords(merged.keyframes).length,
    renderDescriptionCount: arrayOfRecords(merged.segment_render_descriptions ?? merged.segmentRenderDescriptions).length,
  });
  return merged;
}

async function callWholeShotDecomposerPlan(params: {
  input: PlanVideoProjectInput;
  modelName: string;
  planningManifest: VideoPlanningManifest;
  storyboardArtistPlan: Record<string, unknown>;
  storyDesignContext: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const shotDecomposerRaw = await callJsonStage({
    stage: "shot_decomposer",
    modelName: params.modelName,
    systemPrompt: SHOT_DECOMPOSER_SYSTEM_PROMPT,
    userContent: JSON.stringify({
      user_idea: params.input.userPrompt,
      aspect_ratio: params.input.aspectRatio,
      duration_seconds: params.input.durationSeconds,
      planning_manifest: params.planningManifest,
      story_design_context: params.storyDesignContext,
      storyboard_artist_plan: params.storyboardArtistPlan,
      confirmed_anchor_images: [],
    }),
    temperature: 0.32,
  });
  return unwrapPlanRoot(shotDecomposerRaw, "shot_decomposer_plan");
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
  const finalTransitionPlan = arrayOfRecords(readLoose(params.storyboardArtistPlan, "finalTransitionPlan", "final_transition_plan"))
    .filter((item) => numberFrom(item.fromSegmentNo ?? item.from_segment_no) === segmentNo || numberFrom(item.toSegmentNo ?? item.to_segment_no) === segmentNo);

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
    story_design_context: params.storyDesignContext,
    storyboard_context: {
      title: params.storyboardArtistPlan.title,
      logline: params.storyboardArtistPlan.logline,
      style_bible: readLoose(params.storyboardArtistPlan, "styleBible", "style_bible"),
      target_storyboard_brief: targetStoryboardBrief,
      adjacent_storyboard_brief: adjacentStoryboardBrief,
      camera_graph: readLoose(params.storyboardArtistPlan, "cameraGraph", "camera_graph"),
      relevant_final_transition_plan: finalTransitionPlan,
      target_story_beats: targetStoryBeats,
      target_shot_group: targetShotGroup,
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

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  }));
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

    const rewriteRaw = await callJsonStage({
      stage: `story_quality_rewrite_${attempt + 1}_${decision.stage}`,
      modelName: params.modelName,
      systemPrompt: STORY_QUALITY_REWRITE_SYSTEM_PROMPT,
      userContent: buildStoryQualityRewriteContent({
        input: params.input,
        planningManifest: params.planningManifest,
        storyboardPlan: currentStoryboardPlan,
        promptDetailPlan: currentPromptDetailPlan,
        plan: currentPlan,
        decision,
        attempt: attempt + 1,
        maxAttempts,
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
  config: OnePromptVideoStoryRolloutConfig,
): OnePromptVideoPlan {
  if (shouldEvaluateStoryQuality(config)) return withStoryQualityGate(plan);
  return {
    ...plan,
    plannerWarnings: uniqueStrings([
      ...(plan.plannerWarnings ?? []),
      "story quality gate disabled by ONE_PROMPT_VIDEO_STORY_GATE=off",
    ]),
  };
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

async function repairShotDecomposerPlanUntilSingleTake(params: {
  input: PlanVideoProjectInput;
  modelName: string;
  planningManifest: VideoPlanningManifest;
  storyboardArtistPlan: Record<string, unknown>;
  storyDesignContext: Record<string, unknown>;
  shotDecomposerPlan: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  let currentPlan = params.shotDecomposerPlan;
  for (let revision = 0; revision <= MAX_SINGLE_TAKE_REVISIONS; revision += 1) {
    await reportPlannerProgress({
      stage: "single_take_audit",
      attempt: revision + 1,
      detailZh: revision === 0 ? "正在检查每个片段能否一镜到底执行。" : `正在复核第 ${revision} 轮一镜到底修复结果。`,
      detailEn: revision === 0 ? "Auditing whether every segment is executable as one continuous take." : `Reviewing single-take repair round ${revision}.`,
    });
    const audit = auditSingleTakePlan({
      ...params.storyboardArtistPlan,
      ...currentPlan,
      durationSeconds: params.input.durationSeconds,
      cameraGraph: params.storyboardArtistPlan.cameraGraph ?? params.storyboardArtistPlan.camera_graph,
      storyboardBrief: params.storyboardArtistPlan.storyboardBrief ?? params.storyboardArtistPlan.storyboard_brief,
      segments: currentPlan.segments,
      segmentRenderDescriptions: currentPlan.segmentRenderDescriptions ?? currentPlan.segment_render_descriptions,
    }, params.planningManifest.timelineBlueprint.segments.map((segment) => segment.segmentNo));
    await logOnePromptVideo("single_take_audit.result", {
      revision,
      passed: audit.passed,
      issues: audit.issues,
    }, audit.passed ? "info" : "warn");
    if (audit.passed) return currentPlan;
    if (revision >= MAX_SINGLE_TAKE_REVISIONS) {
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
    const repairRaw = await callJsonStage({
      stage: `split_repair_${revision + 1}`,
      modelName: params.modelName,
      systemPrompt: SPLIT_REPAIR_SYSTEM_PROMPT,
      userContent: JSON.stringify({
        user_idea: params.input.userPrompt,
        aspect_ratio: params.input.aspectRatio,
        duration_seconds: params.input.durationSeconds,
        planning_manifest: params.planningManifest,
        story_design_context: params.storyDesignContext,
        storyboard_artist_plan: params.storyboardArtistPlan,
        shot_decomposer_plan: currentPlan,
        single_take_audit_issues: audit.issues,
        revision: revision + 1,
        max_revisions: MAX_SINGLE_TAKE_REVISIONS,
      }),
      temperature: 0.2,
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
    currentPlan = Object.keys(repairedPlan).length ? repairedPlan : unwrapPlanRoot(repairRaw, "shot_decomposer_plan");
    await logOnePromptVideo("split_repair.result", {
      revision: revision + 1,
      repairNotes: isRecord(repairRaw) ? repairRaw.repair_notes ?? repairRaw.repairNotes : undefined,
      segmentCount: arrayOfRecords(currentPlan.segments).length,
      renderDescriptionCount: arrayOfRecords(currentPlan.segment_render_descriptions ?? currentPlan.segmentRenderDescriptions).length,
    });
  }
  return currentPlan;
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
    const anchors = normalizeStringArray(sourceFrame.usesConsistencyAnchors ?? sourceFrame.uses_consistency_anchors) ??
      anchorsForBoundary(params.planningManifest, keyframeNo);
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
      imagePrompt: stringOr(detail?.imagePromptZh ?? sourceFrame.imagePromptZh ?? sourceFrame.image_prompt_zh ?? sourceFrame.imagePrompt ?? sourceFrame.image_prompt, fallbackFrame.imagePrompt),
      imagePromptZh: stringOr(detail?.imagePromptZh ?? sourceFrame.imagePromptZh ?? sourceFrame.image_prompt_zh, fallbackFrame.imagePromptZh ?? fallbackFrame.imagePrompt),
      imagePromptEn: stringOr(detail?.imagePromptEn ?? sourceFrame.imagePromptEn ?? sourceFrame.image_prompt_en, fallbackFrame.imagePromptEn ?? fallbackFrame.imagePrompt),
      negativePromptGroups: isRecord(sourceFrame.negativePrompt ?? sourceFrame.negative_prompt) ? sourceFrame.negativePrompt as VideoPlanKeyframe["negativePromptGroups"] : fallbackFrame.negativePromptGroups,
      negativePrompt: negative,
      negativePromptZh: stringOr(detail?.negativePromptZh ?? sourceFrame.negativePromptZh ?? sourceFrame.negative_prompt_zh, fallbackFrame.negativePromptZh ?? negative),
      negativePromptEn: stringOr(detail?.negativePromptEn ?? sourceFrame.negativePromptEn ?? sourceFrame.negative_prompt_en, fallbackFrame.negativePromptEn ?? negative),
      usesConsistencyAnchors: anchors,
    };
  });

  const segments: VideoPlanSegment[] = timeline.segments.map((timelineSegment, index) => {
    const segmentNo = timelineSegment.segmentNo;
    const sourceSegment = segmentsRaw.find((item) => numberFrom(item.segmentNo ?? item.segment_no) === segmentNo) ?? segmentsRaw[index] ?? {};
    const fallbackSegment = params.fallback.segments[index] ?? params.fallback.segments[params.fallback.segments.length - 1];
    const detail = segmentPromptMap.get(segmentNo);
    const anchors = normalizeStringArray(sourceSegment.usesConsistencyAnchors ?? sourceSegment.uses_consistency_anchors) ??
      timelineSegment.requiredAnchorIds ?? [];
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
      videoPrompt: videoPromptZh,
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
      usesConsistencyAnchors: anchors,
    };
  });

  const consistencyReferences = anchorsToConsistencyReferences(params.planningManifest, styleBible);
  const shots = segmentsToCompatShots(keyframes, segments);
  return {
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
    narrativeMicroRules: extras.narrativeMicroRules,
    shotGroupingPass: extras.shotGroupingPass,
    storyQualityReport: withStoryQualityWarnings(extras.storyQualityReport, storyWarnings),
    anchorStateTimeline: extras.anchorStateTimeline,
    audioBible: extras.audioBible,
    candidateTimeline: extras.candidateTimeline,
    storyboardBrief: extras.storyboardBrief,
    segmentRenderDescriptions: extras.segmentRenderDescriptions,
    cameraGraph: extras.cameraGraph,
    transitionReferencePlan: extras.transitionReferencePlan,
    finalTransitionPlan: extras.finalTransitionPlan,
    referenceSelectionOutputs: extras.referenceSelectionOutputs,
    promptDebugArtifacts: extras.promptDebugArtifacts,
    artifactMetadata: extras.artifactMetadata,
    generationQualityReports: extras.generationQualityReports,
    plannerWarnings: uniqueStrings(storyWarnings),
    storyboardPlan: source,
    promptDetailPlan: promptDetails,
    consistencyReferences,
    keyframes,
    segments,
    shots,
  };
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

  const creativeStrategy = normalizeCreativeStrategy(firstDefined(
    readLoose(planningEnvelope, "creativeStrategy", "creative_strategy"),
    readLoose(planningRoot, "creativeStrategy", "creative_strategy"),
    readLoose(storyboardRoot, "creativeStrategy", "creative_strategy"),
  ), params.manifest, warnings);
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
  const cameraGraph = normalizeCameraGraph(
    firstDefined(
      readLoose(storyboardRoot, "cameraGraph", "camera_graph"),
      readLoose(promptRoot, "cameraGraph", "camera_graph"),
    ),
    { warnings, cameraIds },
  );
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
  return {
    narrativeEvents,
    creativeStrategy,
    storyBeats,
    narrativeMicroRules,
    shotGroupingPass,
    storyQualityReport,
    anchorStateTimeline,
    audioBible: normalizeAudioBible(firstDefined(
      readLoose(planningEnvelope, "audioBible", "audio_bible"),
      readLoose(planningRoot, "audioBible", "audio_bible"),
    )),
    candidateTimeline,
    storyboardBrief,
    segmentRenderDescriptions,
    cameraGraph,
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
  return {
    videoType: normalizeCreativeVideoType(raw.videoType ?? raw.video_type ?? projectIntent.videoType),
    videoCategory: route.videoCategory,
    templateId: route.templateId,
    templateReason: stringOr(raw.templateReason ?? raw.template_reason, ""),
    templateReasonZh: stringOr(raw.templateReasonZh ?? raw.template_reason_zh, definition.templateReasonZh),
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

function routeCreativeTemplate(
  raw: Record<string, unknown>,
  manifest: VideoPlanningManifest,
  warnings: string[],
): { videoCategory: VideoCreativeCategory; templateId: VideoCreativeTemplateId; fallbackReasonZh?: string } {
  const requestedTemplate = normalizeCreativeTemplateId(raw.templateId ?? raw.template_id);
  if (requestedTemplate) {
    return {
      videoCategory: STORY_TEMPLATE_DEFINITIONS[requestedTemplate].videoCategory,
      templateId: requestedTemplate,
    };
  }
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
  const category = rawCategory ?? categoryFromVideoType(videoType) ?? classifyVideoCategoryFromText(text);
  const templateId = templateForCategory(category, text);
  if (templateId === "generic_brand_story" && !rawCategory && !videoType) {
    const fallbackReasonZh = "视频类型无法稳定判断，使用通用品牌故事模板，避免误套游戏、餐饮或电商语义。";
    warnings.push(`storyDesign template fallback: ${fallbackReasonZh}`);
    return { videoCategory: "brand", templateId, fallbackReasonZh };
  }
  return {
    videoCategory: STORY_TEMPLATE_DEFINITIONS[templateId].videoCategory,
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
}): Pick<VideoPlanSegment, "linkedBeatIds" | "storyFunction" | "emotionalBeat" | "emotionalBeatZh" | "emotionalBeatEn" | "cause" | "effect" | "informationUnit" | "keyEvidenceIds" | "actionContinuity" | "reactionBeat" | "powerShift"> {
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
    return {
      segmentNo,
      startTimeSeconds: start,
      endTimeSeconds: end,
      durationSeconds: duration,
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
  const durations = Array.from({ length: count }, (_, index) => {
    const raw = rawSegments[index] ?? {};
    const explicit = numberFrom(raw.durationSeconds ?? raw.duration_seconds);
    const start = numberFrom(raw.startTimeSeconds ?? raw.start_time_seconds);
    const end = numberFrom(raw.endTimeSeconds ?? raw.end_time_seconds);
    const value = explicit || (end > start ? end - start : 0) || Math.round(totalSeconds / count);
    return clamp(value, MIN_SEGMENT_SECONDS, MAX_SEGMENT_SECONDS);
  });
  let diff = totalSeconds - durations.reduce((sum, value) => sum + value, 0);
  let guard = 0;
  while (diff !== 0 && guard++ < 1000) {
    let changed = false;
    for (let index = 0; index < durations.length && diff !== 0; index += 1) {
      if (diff > 0 && durations[index] < MAX_SEGMENT_SECONDS) {
        durations[index] += 1;
        diff -= 1;
        changed = true;
      } else if (diff < 0 && durations[index] > MIN_SEGMENT_SECONDS) {
        durations[index] -= 1;
        diff += 1;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return durations.reduce((sum, value) => sum + value, 0) === totalSeconds
    ? durations
    : distributeDurations(totalSeconds, count);
}

function distributeDurations(totalSeconds: number, count: number): number[] {
  const durations = Array.from({ length: count }, () => MIN_SEGMENT_SECONDS);
  let remaining = totalSeconds - durations.reduce((sum, value) => sum + value, 0);
  let index = 0;
  while (remaining > 0 && index < durations.length * MAX_SEGMENT_SECONDS) {
    const target = index % durations.length;
    if (durations[target] < MAX_SEGMENT_SECONDS) {
      durations[target] += 1;
      remaining -= 1;
    }
    index += 1;
  }
  return durations;
}

function normalizeAnchors(value: unknown): VideoConsistencyAnchor[] {
  return arrayOfRecords(value).flatMap((item, index) => {
    const type = normalizeAnchorType(item.type);
    if (!type) return [];
    const id = stringOr(item.id, `${type}_${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, "_");
    return [{
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
    }];
  }).slice(0, 12);
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
    const anchors = normalizeStringArray(item.usesConsistencyAnchors ?? item.uses_consistency_anchors) ?? params.anchorIds;
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
      imagePrompt: imagePromptZh || imagePromptEn,
      imagePromptZh,
      imagePromptEn,
      usesConsistencyAnchors: anchors,
      prompt: stringOr(item.prompt, promptZh || promptEn),
      promptZh,
      promptEn,
    }];
  });
  const result = items.length ? items : params.fallback;
  return result?.length ? result.slice(0, 6).map((item, index) => ({
    ...item,
    microShotNo: index + 1,
    usesConsistencyAnchors: item.usesConsistencyAnchors?.length ? item.usesConsistencyAnchors : params.anchorIds,
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
      imagePrompt: anchor.imagePromptZh || anchor.descriptionZh || lock,
      imagePromptZh: anchor.imagePromptZh || anchor.descriptionZh || lock,
      imagePromptEn: anchor.imagePromptEn || anchor.descriptionEn || lock,
      negativePrompt: styleBible.negativePrompt,
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

function segmentsToCompatShots(keyframes: VideoPlanKeyframe[], segments: VideoPlanSegment[]): VideoPlanShot[] {
  return segments.map((segment) => {
    const start = keyframes[segment.startKeyframeNo - 1];
    return {
      shotNo: segment.segmentNo,
      durationSeconds: segment.durationSeconds,
      boundaryMode: segment.boundaryMode,
      purpose: segment.purpose,
      purposeZh: segment.purposeZh,
      purposeEn: segment.purposeEn,
      camera: segment.camera,
      action: segment.motion,
      imagePrompt: start?.imagePrompt ?? "",
      imagePromptZh: start?.imagePromptZh ?? start?.imagePrompt ?? "",
      imagePromptEn: start?.imagePromptEn ?? start?.imagePrompt ?? "",
      videoPrompt: segment.videoPrompt,
      videoPromptZh: segment.videoPromptZh,
      videoPromptEn: segment.videoPromptEn,
      outputMode: segment.outputMode,
      linkedBeatIds: segment.linkedBeatIds,
      storyFunction: segment.storyFunction,
      emotionalBeat: segment.emotionalBeat,
      emotionalBeatZh: segment.emotionalBeatZh,
      emotionalBeatEn: segment.emotionalBeatEn,
      cause: segment.cause,
      effect: segment.effect,
      informationUnit: segment.informationUnit,
      keyEvidenceIds: segment.keyEvidenceIds,
      actionContinuity: segment.actionContinuity,
      reactionBeat: segment.reactionBeat,
      powerShift: segment.powerShift,
      constraints: segment.constraints,
      timedPrompts: segment.timedPrompts,
      microShots: segment.microShots,
      audioPlan: segment.audioPlan,
      subtitle: segment.subtitle,
      negativePrompt: segment.negativePrompt,
      negativePromptZh: segment.negativePromptZh,
      negativePromptEn: segment.negativePromptEn,
      usesConsistencyAnchors: segment.usesConsistencyAnchors,
    };
  });
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

function jsonStageStreamIdleTimeoutMs(): number {
  const raw = Number(process.env.ONE_PROMPT_VIDEO_JSON_STAGE_STREAM_IDLE_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return 90000;
  return Math.max(30000, Math.round(raw));
}

function jsonStageStreamMaxTimeoutMs(): number {
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

function shotDecomposerMode(): "segment" | "whole" {
  return process.env.ONE_PROMPT_VIDEO_SHOT_DECOMPOSER_MODE?.trim().toLowerCase() === "whole" ? "whole" : "segment";
}

function shotDecomposerConcurrency(): number {
  const raw = Number(process.env.ONE_PROMPT_VIDEO_SHOT_DECOMPOSER_CONCURRENCY);
  if (!Number.isFinite(raw) || raw <= 0) return 2;
  return Math.max(1, Math.min(4, Math.round(raw)));
}

function plannerInputFingerprint(input: PlanVideoProjectInput): string {
  return createHash("sha256").update(JSON.stringify({
    userPrompt: input.userPrompt,
    aspectRatio: input.aspectRatio,
    durationSeconds: input.durationSeconds,
    shotCount: input.shotCount ?? null,
    stylePreset: input.stylePreset ?? "",
    referenceImageUrls: input.referenceImageUrls,
  })).digest("hex");
}

export function normalizeAliyunStoryboardPlannerCheckpoint(
  value: unknown,
  input: PlanVideoProjectInput,
): AliyunStoryboardPlannerCheckpoint {
  const fingerprint = plannerInputFingerprint(input);
  const envelope = isRecord(value) && isRecord(value.plannerCheckpoint)
    ? value.plannerCheckpoint
    : isRecord(value)
      ? value
      : {};
  if (envelope.version !== 1 || envelope.inputFingerprint !== fingerprint) {
    return {
      version: 1,
      inputFingerprint: fingerprint,
      shotDecomposerSegmentPlans: {},
      updatedAt: new Date().toISOString(),
    };
  }
  const segmentPlans = isRecord(envelope.shotDecomposerSegmentPlans)
    ? Object.fromEntries(Object.entries(envelope.shotDecomposerSegmentPlans).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1])))
    : {};
  return {
    version: 1,
    inputFingerprint: fingerprint,
    planningRaw: envelope.planningRaw,
    storyboardArtistPlan: isRecord(envelope.storyboardArtistPlan) ? envelope.storyboardArtistPlan : undefined,
    shotDecomposerSegmentPlans: segmentPlans,
    updatedAt: typeof envelope.updatedAt === "string" ? envelope.updatedAt : new Date().toISOString(),
  };
}

async function savePlannerCheckpoint(
  checkpoint: AliyunStoryboardPlannerCheckpoint,
  onCheckpoint?: (checkpoint: AliyunStoryboardPlannerCheckpoint) => Promise<void> | void,
): Promise<void> {
  if (!onCheckpoint) return;
  checkpoint.updatedAt = new Date().toISOString();
  await onCheckpoint(structuredClone(checkpoint));
}

async function reportPlannerProgress(progress: AliyunStoryboardProgressUpdate): Promise<void> {
  await plannerProgressStorage.getStore()?.onProgress?.(progress);
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
  let trimmed = text.trim();
  const fence = String.fromCharCode(96, 96, 96);
  if (trimmed.startsWith(fence)) {
    trimmed = trimmed.slice(fence.length).trimStart();
    if (/^[a-zA-Z]+/.test(trimmed)) trimmed = trimmed.replace(/^[a-zA-Z]+/, "").trimStart();
    if (trimmed.endsWith(fence)) trimmed = trimmed.slice(0, -fence.length).trimEnd();
    trimmed = trimmed.trim();
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("三阶段剧本拆解未返回合法 JSON");
  }
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
    const directive = "Single continuous unbroken take: no internal cuts, jump cuts, fades, dissolves, crossfades, montage edits, ghost overlays, scene swaps, teleportation, or hard visual transitions inside this clip. Keep the same scene, camera axis family, lighting direction, color grade, subject identity, product identity, and prop layout from first frame to last frame.";
    return lower.includes("single continuous") || lower.includes("unbroken take")
      ? text
      : `${directive} ${text}`;
  }
  const directive = "单段一镜到底连续镜头：段内禁止切镜、跳切、淡入淡出、叠化、交叉溶解、蒙太奇、幽灵重影、场景替换、人物/产品瞬移或硬转场；从首帧到尾帧保持同一场景、机位轴线、光线方向、色调、人物身份、产品身份和道具布局连续。";
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
  if (category === "game") {
    return /(bonus|jackpot|金币|倍率|奖励|爆奖|bonus|reward|multiplier)/i.test(text) ? "game_bonus_payoff" : "game_reversal";
  }
  if (category === "product") return "product_problem_solution";
  if (category === "ecommerce") return "ecommerce_offer_conversion";
  if (category === "food") return "food_sensory_reaction";
  if (category === "auto") return "auto_performance_hero";
  if (category === "short_drama") return "short_drama_conflict_twist";
  return "generic_brand_story";
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
  return {
    mode,
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
