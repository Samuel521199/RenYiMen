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
  VideoAudioPlan,
  VideoConsistencyAnchor,
  VideoMicroShot,
  VideoPlanKeyframe,
  VideoPlanningManifest,
  VideoPlanSegment,
  VideoPlanShot,
  VideoPromptDetailPlan,
  VideoStyleBible,
  VideoTimelineBlueprintSegment,
} from "./types";
import { createVideoPlan } from "./planner";
import { errorForLog, logOnePromptVideo } from "./logger";

const MIN_SEGMENT_SECONDS = 3;
const MAX_SEGMENT_SECONDS = 15;
const MAX_SINGLE_TAKE_REVISIONS = 3;
const MAX_JSON_REPAIR_INPUT_CHARS = 60000;
const DEFAULT_JSON_STAGE_TIMEOUT_MS = 180000;

const JSON_REPAIR_SYSTEM_PROMPT = `You are a strict JSON repair tool.

Return only valid JSON. No markdown, explanations, comments, or extra text.

Your job:
- Fix syntax errors in the provided JSON-like text.
- Preserve all semantic content, keys, arrays, objects, strings, numbers, and booleans as much as possible.
- Do not invent new story content.
- Do not translate values.
- If a value is truncated or impossible to recover, close the nearest valid object/array conservatively.
- Output one complete JSON object.`;

type PlanStructureExtras = {
  narrativeEvents: NarrativeEvent[];
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

const PLANNING_ARCHITECT_SYSTEM_PROMPT = `You are Planning Architect for a controllable AI video pipeline.

Return only valid JSON. No markdown, explanations, or comments.

Your only job in stage 1:
- Understand the user's video task.
- First decompose the task into narrative_events before deciding the segment timeline.
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
- Create a concise whole-story storyboard brief for each segment.
- Draft camera_graph and final_transition_plan.
- Keep output short and structural.

Hard rules:
- Do not output final prompts.
- Do not output complete image prompts.
- Do not output complete video prompts.
- Do not output detailed checkpoint prompts.
- Do not rewrite planning_manifest.timeline_blueprint.
- Each storyboard_brief item must include segment_no, source_event_ids, camera_id, visual_desc_zh, visual_desc_en, beat_role, required_anchor_ids, location_id, and separation_reason.

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
    "storyboard_brief": [
      {
        "segment_no": 1,
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
          "description": ""
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
- Each segment must be written as a single continuous take from its start boundary keyframe to its end boundary keyframe. Do not describe internal cuts, dissolves, fades, montage edits, shot switches, or scene transitions inside a segment.
- For any segment, the start and end keyframes must look like two reachable moments within the same scene and camera setup family. They may change pose, product handling, camera distance, focus, or framing gradually, but not location, time period, environment, outfit, identity, or layout abruptly.
- micro_shots are internal same-take motion checkpoints, not extra clips, not extra scenes, and not edit points. Use text, image_prompt, or mixed only to describe reachable intermediate states inside the same continuous shot.
- All micro_shots in a segment must preserve the same location, camera axis family, lighting direction, color tone, subject identity, product identity, and prop layout. If this is impossible, flag the segment as high risk.
- Every user-visible micro_shot field must be bilingual. Fill scene_zh/action_zh/camera_zh/prompt_zh in Chinese only, and scene_en/action_en/camera_en/prompt_en in English only. Do not mix Chinese and English inside the same language field.

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
- Respect storyboard_brief, camera_graph, final_transition_plan, segment_render_descriptions, start/end frame contracts, motion contracts, and single_take_contracts.
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

export async function createAliyunStoryboardPlan(input: PlanVideoProjectInput): Promise<OnePromptVideoPlan> {
  const referenceImageUrls = input.referenceImageUrls.slice(0, 4);
  const fallback = createVideoPlan(input);
  const visionModel = referenceImageUrls.length
    ? model("ALIYUN_STORYBOARD_VISION_MODEL", "qwen-vl-max")
    : model("ALIYUN_STORYBOARD_MODEL", "qwen3.7-plus");
  const textModel = model("ALIYUN_STORYBOARD_MODEL", "qwen3.7-plus");

  await logOnePromptVideo("aliyun.storyboard.three_stage.start", {
    promptLength: input.userPrompt.length,
    aspectRatio: input.aspectRatio,
    durationSeconds: input.durationSeconds,
    referenceImageCount: referenceImageUrls.length,
  });

  try {
    const planningRaw = await callJsonStage({
      stage: "planning_architect",
      modelName: visionModel,
      systemPrompt: PLANNING_ARCHITECT_SYSTEM_PROMPT,
      userContent: buildPlanningArchitectContent(input, referenceImageUrls),
      temperature: 0.25,
    });
    const planningManifest = normalizePlanningManifest(planningRaw, input, fallback);
    await logOnePromptVideo("aliyun.storyboard.planning_architect.parsed", {
      planningRaw,
      planningManifest,
    });

    const storyboardArtistRaw = await callJsonStage({
      stage: "storyboard_artist",
      modelName: textModel,
      systemPrompt: STORYBOARD_ARTIST_SYSTEM_PROMPT,
      userContent: JSON.stringify({
        user_idea: input.userPrompt,
        aspect_ratio: input.aspectRatio,
        duration_seconds: input.durationSeconds,
        planning_manifest: planningManifest,
        confirmed_anchor_images: [],
      }),
      temperature: 0.3,
    });
    const storyboardArtistPlan = unwrapPlanRoot(storyboardArtistRaw, "storyboard_artist_plan");
    await logOnePromptVideo("aliyun.storyboard.storyboard_artist.parsed", {
      storyboardArtistPlan,
    });

    let shotDecomposerPlan = await createShotDecomposerPlan({
      input,
      modelName: textModel,
      planningManifest,
      storyboardArtistPlan,
    });
    await logOnePromptVideo("aliyun.storyboard.shot_decomposer.parsed", {
      shotDecomposerPlan,
    });
    shotDecomposerPlan = await repairShotDecomposerPlanUntilSingleTake({
      input,
      modelName: textModel,
      planningManifest,
      storyboardArtistPlan,
      shotDecomposerPlan,
    });
    const storyboardPlan = mergeStage2Plans(storyboardArtistPlan, shotDecomposerPlan);

    const promptDetailRaw = await callJsonStage({
      stage: "prompt_detailer",
      modelName: textModel,
      systemPrompt: PROMPT_DETAILER_SYSTEM_PROMPT,
      userContent: JSON.stringify({
        planning_manifest: planningManifest,
        storyboard_plan: storyboardPlan,
        storyboard_artist_plan: storyboardArtistPlan,
        shot_decomposer_plan: shotDecomposerPlan,
        confirmed_anchor_images: [],
        confirmed_keyframe_images: [],
        user_edits: {},
      }),
      temperature: 0.25,
    });
    const promptDetailPlan = normalizePromptDetailPlan(promptDetailRaw);
    await logOnePromptVideo("aliyun.storyboard.prompt_detailer.parsed", {
      promptDetailRaw,
      promptDetailPlan,
    });

    const plan = buildThreeStagePlan({
      input,
      fallback: createVideoPlan({ ...input, shotCount: planningManifest.timelineBlueprint.segmentCount }),
      planningRaw,
      planningManifest,
      storyboardPlan,
      promptDetailPlan,
    });

    await logOnePromptVideo("aliyun.storyboard.three_stage.parsed", {
      title: plan.title,
      planningManifest: plan.planningManifest,
      narrativeEvents: plan.narrativeEvents,
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
  if (!result.ok) throw new Error(result.errorMessage || `Aliyun storyboard ${params.stage} failed HTTP ${result.httpStatus}`);
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
      throw new Error(`三阶段脚本拆解 ${stage} 请求超过 ${Math.round(timeoutMs / 1000)} 秒未返回，已停止生成。请稍后重试，或检查 DASHSCOPE/百炼网络与额度。`);
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
      throw new Error(`三阶段脚本拆解 ${stage} 流式请求超时（${abortReason}），已停止生成。请稍后重试，或检查 DASHSCOPE/百炼网络与额度。`);
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
  const result = await fetchJsonStageContent(`json_repair_${params.stage}`, body);
  await logOnePromptVideo(`aliyun.storyboard.${params.stage}.json_repair.response`, {
    httpStatus: result.httpStatus,
    ok: result.ok,
    durationMs: Date.now() - startedAt,
    rawSummary: result.rawSummary,
  }, result.ok ? "info" : "error");
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

async function createShotDecomposerPlan(params: {
  input: PlanVideoProjectInput;
  modelName: string;
  planningManifest: VideoPlanningManifest;
  storyboardArtistPlan: Record<string, unknown>;
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

  const segmentPlans = await mapWithConcurrency(timelineSegments, concurrency, async (segment) => {
    const raw = await callJsonStage({
      stage: `shot_decomposer_s${segment.segmentNo}`,
      modelName: params.modelName,
      systemPrompt: SHOT_DECOMPOSER_SEGMENT_SYSTEM_PROMPT,
      userContent: buildShotDecomposerSegmentContent({
        ...params,
        segment,
      }),
      temperature: 0.28,
    });
    const plan = unwrapPlanRoot(raw, "shot_decomposer_plan");
    await logOnePromptVideo("aliyun.storyboard.shot_decomposer.segment.parsed", {
      segmentNo: segment.segmentNo,
      keyframeCount: arrayOfRecords(plan.keyframes).length,
      segmentCount: arrayOfRecords(plan.segments).length,
      renderDescriptionCount: arrayOfRecords(plan.segment_render_descriptions ?? plan.segmentRenderDescriptions).length,
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
  segment: VideoTimelineBlueprintSegment;
}): string {
  const segmentNo = params.segment.segmentNo;
  const timelineSegments = params.planningManifest.timelineBlueprint.segments;
  const adjacentTimelineSegments = timelineSegments.filter((item) => Math.abs(item.segmentNo - segmentNo) <= 1);
  const storyboardBrief = arrayOfRecords(readLoose(params.storyboardArtistPlan, "storyboardBrief", "storyboard_brief"));
  const targetStoryboardBrief = storyboardBrief.find((item) => numberFrom(item.segmentNo ?? item.segment_no) === segmentNo) ?? {};
  const adjacentStoryboardBrief = storyboardBrief.filter((item) => Math.abs(numberFrom(item.segmentNo ?? item.segment_no) - segmentNo) <= 1);
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
    storyboard_context: {
      title: params.storyboardArtistPlan.title,
      logline: params.storyboardArtistPlan.logline,
      style_bible: readLoose(params.storyboardArtistPlan, "styleBible", "style_bible"),
      target_storyboard_brief: targetStoryboardBrief,
      adjacent_storyboard_brief: adjacentStoryboardBrief,
      camera_graph: readLoose(params.storyboardArtistPlan, "cameraGraph", "camera_graph"),
      relevant_final_transition_plan: finalTransitionPlan,
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
    camera_graph: readLoose(storyboardArtistPlan, "cameraGraph", "camera_graph") ?? {},
    final_transition_plan: readLoose(storyboardArtistPlan, "finalTransitionPlan", "final_transition_plan") ?? [],
    segment_render_descriptions: readLoose(shotDecomposerPlan, "segmentRenderDescriptions", "segment_render_descriptions") ?? [],
    keyframes: readLoose(shotDecomposerPlan, "keyframes", "keyframes") ?? [],
    segments: readLoose(shotDecomposerPlan, "segments", "segments") ?? [],
    consistency_references: readLoose(shotDecomposerPlan, "consistencyReferences", "consistency_references") ?? [],
  };
}

async function repairShotDecomposerPlanUntilSingleTake(params: {
  input: PlanVideoProjectInput;
  modelName: string;
  planningManifest: VideoPlanningManifest;
  storyboardArtistPlan: Record<string, unknown>;
  shotDecomposerPlan: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  let currentPlan = params.shotDecomposerPlan;
  for (let revision = 0; revision <= MAX_SINGLE_TAKE_REVISIONS; revision += 1) {
    const audit = auditShotDecomposerPlan(currentPlan, params.planningManifest);
    await logOnePromptVideo("single_take_audit.result", {
      revision,
      passed: audit.passed,
      issues: audit.issues,
    }, audit.passed ? "info" : "warn");
    if (audit.passed) return currentPlan;
    if (revision >= MAX_SINGLE_TAKE_REVISIONS) {
      throw new Error(singleTakeAuditErrorMessage(audit.issues));
    }

    const repairRaw = await callJsonStage({
      stage: `split_repair_${revision + 1}`,
      modelName: params.modelName,
      systemPrompt: SPLIT_REPAIR_SYSTEM_PROMPT,
      userContent: JSON.stringify({
        user_idea: params.input.userPrompt,
        aspect_ratio: params.input.aspectRatio,
        duration_seconds: params.input.durationSeconds,
        planning_manifest: params.planningManifest,
        storyboard_artist_plan: params.storyboardArtistPlan,
        shot_decomposer_plan: currentPlan,
        single_take_audit_issues: audit.issues,
        revision: revision + 1,
        max_revisions: MAX_SINGLE_TAKE_REVISIONS,
      }),
      temperature: 0.2,
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

function auditShotDecomposerPlan(plan: Record<string, unknown>, manifest: VideoPlanningManifest): { passed: boolean; issues: Array<Record<string, unknown>> } {
  const issues: Array<Record<string, unknown>> = [];
  const descriptions = arrayOfRecords(plan.segment_render_descriptions ?? plan.segmentRenderDescriptions);
  const descriptionsBySegment = new Map(descriptions.map((item) => [numberFrom(item.segmentNo ?? item.segment_no), item]));
  for (const segment of manifest.timelineBlueprint.segments) {
    const description = descriptionsBySegment.get(segment.segmentNo);
    if (!description) {
      issues.push({
        segmentNo: segment.segmentNo,
        severity: "high",
        reason: "segment_render_description_missing",
        instruction: "Return start/end frame contracts, motion contract, single-take contract, and motion checkpoints for this segment.",
      });
      continue;
    }
    const startFrame = description.startFrameContract ?? description.start_frame_contract;
    const endFrame = description.endFrameContract ?? description.end_frame_contract;
    const motion = description.motionContract ?? description.motion_contract;
    const singleTake = description.singleTakeContract ?? description.single_take_contract;
    const checkpoints = arrayOfRecords(description.motionCheckpoints ?? description.motion_checkpoints);
    const recommendedSplit = normalizeUnknownArray(description.recommendedSplit ?? description.recommended_split);
    const baseIssue = {
      segmentNo: segment.segmentNo,
      recommendedSplit,
      instruction: "Repair this segment so it is one continuous take. If impossible, keep requires_cut=true and explain recommended_split.",
    };
    if (!isRecord(startFrame)) issues.push({ ...baseIssue, severity: "high", reason: "start_frame_contract_missing" });
    if (!isRecord(endFrame)) issues.push({ ...baseIssue, severity: "high", reason: "end_frame_contract_missing" });
    if (!isRecord(motion)) issues.push({ ...baseIssue, severity: "high", reason: "motion_contract_missing" });
    if (!isRecord(singleTake)) issues.push({ ...baseIssue, severity: "high", reason: "single_take_contract_missing" });
    if (truthyFlag(description.requiresCut ?? description.requires_cut)) issues.push({ ...baseIssue, severity: "high", reason: "requires_cut_true" });
    if (String(description.riskLevel ?? description.risk_level ?? "").toLowerCase() === "high") issues.push({ ...baseIssue, severity: "high", reason: "risk_level_high" });
    if (isRecord(singleTake)) {
      if (truthyFlag(singleTake.requiresCut ?? singleTake.requires_cut)) issues.push({ ...baseIssue, severity: "high", reason: "single_take_contract_requires_cut" });
      if (String(singleTake.riskLevel ?? singleTake.risk_level ?? "").toLowerCase() === "high") issues.push({ ...baseIssue, severity: "high", reason: "single_take_contract_high_risk" });
      if (singleTake.physicallyReachable === false || singleTake.physically_reachable === false) issues.push({ ...baseIssue, severity: "high", reason: "physically_unreachable" });
    }
    if (checkpoints.length > 4) issues.push({ ...baseIssue, severity: "medium", reason: "too_many_motion_checkpoints", checkpointCount: checkpoints.length });
    if (containsInternalCutLanguage([description, startFrame, endFrame, motion, singleTake, checkpoints])) {
      issues.push({ ...baseIssue, severity: "high", reason: "internal_cut_language_detected" });
    }
  }
  return {
    passed: !issues.some((issue) => issue.severity === "high"),
    issues,
  };
}

function singleTakeAuditErrorMessage(issues: Array<Record<string, unknown>>): string {
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
}): OnePromptVideoPlan {
  const source = isRecord(params.storyboardPlan) ? params.storyboardPlan : {};
  const extras = normalizePlanStructureExtras({
    planningRaw: params.planningRaw,
    storyboardPlan: params.storyboardPlan,
    promptDetailPlan: params.promptDetailPlan,
    manifest: params.planningManifest,
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
    plannerWarnings: extras.warnings,
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
}): PlanStructureExtras {
  const warnings: string[] = [];
  const planningEnvelope = isRecord(params.planningRaw) ? params.planningRaw : {};
  const planningRoot = unwrapPlanRoot(params.planningRaw, "planning_manifest");
  const storyboardRoot = unwrapPlanRoot(params.storyboardPlan, "storyboard_plan");
  const promptRoot = unwrapPlanRoot(params.promptDetailPlan, "prompt_detail_plan");
  const anchorIds = new Set(params.manifest.consistencyManifest.anchors.map((anchor) => anchor.id));

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
    { warnings, anchorIds, eventIds },
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
  return {
    narrativeEvents,
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
  context: { warnings: string[]; anchorIds: Set<string>; eventIds: Set<string> },
): StoryboardBrief[] {
  return arrayOfRecords(value).flatMap((item) => {
    const segmentNo = numberFrom(item.segmentNo ?? item.segment_no);
    if (!segmentNo) return [];
    const sourceEventIds = normalizeStringArray(item.sourceEventIds ?? item.source_event_ids) ?? [];
    const eventIds = normalizeStringArray(item.eventIds ?? item.event_ids) ?? sourceEventIds;
    const requiredAnchorIds = normalizeStringArray(item.requiredAnchorIds ?? item.required_anchor_ids) ?? [];
    const visibleAnchorIds = normalizeStringArray(item.visibleAnchorIds ?? item.visible_anchor_ids) ?? requiredAnchorIds;
    for (const eventId of eventIds) {
      if (context.eventIds.size && !context.eventIds.has(eventId)) context.warnings.push(`storyboardBrief segment ${segmentNo} references missing event ${eventId}`);
    }
    for (const anchorId of visibleAnchorIds) {
      if (!context.anchorIds.has(anchorId)) context.warnings.push(`storyboardBrief segment ${segmentNo} references missing anchor ${anchorId}`);
    }
    return [{
      segmentNo,
      eventIds,
      sourceEventIds,
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
      revision: Math.max(1, numberFrom(raw.revision) || 1),
      schemaVersion: stringOr(raw.schemaVersion ?? raw.schema_version, ""),
      plannerVersion: stringOr(raw.plannerVersion ?? raw.planner_version, ""),
      promptVersion: stringOr(raw.promptVersion ?? raw.prompt_version, ""),
      modelVersion: stringOr(raw.modelVersion ?? raw.model_version, ""),
      inputHash: stringOr(raw.inputHash ?? raw.input_hash, ""),
      dependsOn: normalizeStringArray(raw.dependsOn ?? raw.depends_on) ?? [],
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

function shotDecomposerMode(): "segment" | "whole" {
  return process.env.ONE_PROMPT_VIDEO_SHOT_DECOMPOSER_MODE?.trim().toLowerCase() === "whole" ? "whole" : "segment";
}

function shotDecomposerConcurrency(): number {
  const raw = Number(process.env.ONE_PROMPT_VIDEO_SHOT_DECOMPOSER_CONCURRENCY);
  if (!Number.isFinite(raw) || raw <= 0) return 2;
  return Math.max(1, Math.min(4, Math.round(raw)));
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

function truthyFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return /^(true|yes|1|requires_cut|high)$/i.test(value.trim());
  if (typeof value === "number") return value > 0;
  return false;
}

function containsInternalCutLanguage(value: unknown): boolean {
  const text = JSON.stringify(value ?? "").toLowerCase();
  return /\b(cut to|jump cut|hard cut|dissolve|fade out|fade in|crossfade|montage|switch to|scene transition|new shot|another shot|shot change)\b/.test(text) ||
    /切到|切镜|跳切|转场|叠化|淡入|淡出|蒙太奇|换镜头|镜头切换|场景切换/.test(text);
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
