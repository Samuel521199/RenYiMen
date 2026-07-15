import type {
  OnePromptVideoPlan,
  PlanVideoProjectInput,
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

const PLANNING_ARCHITECT_SYSTEM_PROMPT = `You are Planning Architect for a controllable AI video pipeline.

Return only valid JSON. No markdown, explanations, or comments.

Your only job in stage 1:
- Understand the user's video task.
- Decide which objects, states, visual rules, and task elements must stay consistent across the whole video.
- Decide whether this video needs editorial overlay subtitles, and if needed define their role, language, timing, placement, readability, and editability requirements.
- Decide the exact segment count, each segment's start/end/duration, and why each cut exists.
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
- The timeline_blueprint is a hard contract for later stages.

Return this JSON shape:
{
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

const STORYBOARD_WRITER_SYSTEM_PROMPT = `You are Storyboard Writer for a controllable AI video pipeline.

Return only valid JSON. No markdown, explanations, or comments.

Your only job in stage 2:
- Use planning_manifest as the source of truth.
- Follow planning_manifest.timeline_blueprint exactly for segment count, start time, end time, and duration.
- Generate boundary keyframes, segments, subtitles, audio_plan, and micro_shots.
- Follow planning_manifest.subtitle_policy. If subtitles are not needed, leave segment.subtitle empty. If subtitles are needed, generate concise editable overlay subtitles for each appropriate segment.
- Do not compile final generation prompts yet; write clear structured creative content.

Hard rules:
- keyframes.length must equal segments.length + 1.
- Segment N uses keyframe N as first frame and keyframe N+1 as last frame.
- Every keyframe, segment, and micro_shot must list uses_consistency_anchors.
- Do not change anchor identity, product shape, scene layout, brand visual rules, effect state, segment count, or segment durations.
- If the timeline is impossible, return timeline_change_request instead of silently changing it.
- Subtitles are editorial overlay copy. Do not ask generated images/videos to render text.
- Each segment must be written as a single continuous take from its start boundary keyframe to its end boundary keyframe. Do not describe internal cuts, dissolves, fades, montage edits, shot switches, or scene transitions inside a segment.
- For any segment, the start and end keyframes must look like two reachable moments within the same scene and camera setup family. They may change pose, product handling, camera distance, focus, or framing gradually, but not location, time period, environment, outfit, identity, or layout abruptly.
- micro_shots are internal same-take motion checkpoints, not extra clips, not extra scenes, and not edit points. Use text, image_prompt, or mixed only to describe reachable intermediate states inside the same continuous shot.
- All micro_shots in a segment must preserve the same location, camera axis family, lighting direction, color tone, subject identity, product identity, and prop layout. If this is impossible, the segment must be split earlier by planning_manifest, not solved by a hidden transition.

Return this JSON shape:
{
  "storyboard_plan": {
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
            "scene": "",
            "action": "",
            "camera": "",
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

const PROMPT_DETAILER_SYSTEM_PROMPT = `You are Prompt Detailer for a controllable AI video pipeline.

Return only valid JSON. No markdown, explanations, or comments.

Your only job in stage 3:
- Compile detailed generation prompts from the approved planning_manifest and storyboard_plan.
- Do not rewrite story, timeline, subtitles, audio plan, or micro-shot structure.
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

    const storyboardRaw = await callJsonStage({
      stage: "storyboard_writer",
      modelName: textModel,
      systemPrompt: STORYBOARD_WRITER_SYSTEM_PROMPT,
      userContent: JSON.stringify({
        user_idea: input.userPrompt,
        aspect_ratio: input.aspectRatio,
        duration_seconds: input.durationSeconds,
        planning_manifest: planningManifest,
        confirmed_anchor_images: [],
      }),
      temperature: 0.35,
    });
    const storyboardPlan = isRecord(storyboardRaw) && isRecord(storyboardRaw.storyboard_plan)
      ? storyboardRaw.storyboard_plan
      : storyboardRaw;

    const promptDetailRaw = await callJsonStage({
      stage: "prompt_detailer",
      modelName: textModel,
      systemPrompt: PROMPT_DETAILER_SYSTEM_PROMPT,
      userContent: JSON.stringify({
        planning_manifest: planningManifest,
        storyboard_plan: storyboardPlan,
        confirmed_anchor_images: [],
        confirmed_keyframe_images: [],
        user_edits: {},
      }),
      temperature: 0.25,
    });
    const promptDetailPlan = normalizePromptDetailPlan(promptDetailRaw);

    const plan = buildThreeStagePlan({
      input,
      fallback: createVideoPlan({ ...input, shotCount: planningManifest.timelineBlueprint.segmentCount }),
      planningManifest,
      storyboardPlan,
      promptDetailPlan,
    });

    await logOnePromptVideo("aliyun.storyboard.three_stage.parsed", {
      title: plan.title,
      anchorCount: plan.consistencyManifest?.anchors.length ?? 0,
      keyframeCount: plan.keyframes.length,
      segmentCount: plan.segments.length,
      segments: plan.segments.map((segment) => ({
        segmentNo: segment.segmentNo,
        durationSeconds: segment.durationSeconds,
        anchors: segment.usesConsistencyAnchors,
      })),
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
  const body = {
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
  const res = await fetch(`${compatibleBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireDashScopeApiKey()}`,
    },
    body: JSON.stringify(body),
  });
  const raw = await safeJson(res);
  await logOnePromptVideo(`aliyun.storyboard.${params.stage}.response`, {
    httpStatus: res.status,
    ok: res.ok,
    rawSummary: summarizeRaw(raw),
  }, res.ok ? "info" : "error");
  if (!res.ok) throw new Error(extractError(raw) || `Aliyun storyboard ${params.stage} failed HTTP ${res.status}`);
  const content = extractChatContent(raw);
  if (!content) throw new Error(`Aliyun storyboard ${params.stage} returned empty content`);
  return parseJsonObject(content);
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

function buildThreeStagePlan(params: {
  input: PlanVideoProjectInput;
  fallback: OnePromptVideoPlan;
  planningManifest: VideoPlanningManifest;
  storyboardPlan: unknown;
  promptDetailPlan: VideoPromptDetailPlan;
}): OnePromptVideoPlan {
  const source = isRecord(params.storyboardPlan) ? params.storyboardPlan : {};
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
    storyboardPlan: source,
    promptDetailPlan: promptDetails,
    consistencyReferences,
    keyframes,
    segments,
    shots,
  };
}

function normalizePlanningManifest(raw: unknown, input: PlanVideoProjectInput, fallback: OnePromptVideoPlan): VideoPlanningManifest {
  const root = isRecord(raw) && isRecord(raw.planning_manifest) ? raw.planning_manifest : isRecord(raw) ? raw : {};
  const timelineRaw = isRecord(root.timelineBlueprint) ? root.timelineBlueprint : isRecord(root.timeline_blueprint) ? root.timeline_blueprint : {};
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
    const anchors = normalizeStringArray(item.usesConsistencyAnchors ?? item.uses_consistency_anchors) ?? params.anchorIds;
    return [{
      microShotNo,
      localTimeSeconds,
      endSeconds,
      absoluteTimeSeconds: params.startSeconds + localTimeSeconds,
      purpose: stringOr(item.purposeZh ?? item.purpose_zh ?? item.purpose, params.segmentPurpose),
      purposeZh: stringOr(item.purposeZh ?? item.purpose_zh, ""),
      purposeEn: stringOr(item.purposeEn ?? item.purpose_en, ""),
      scene: stringOr(item.scene, params.segmentPurpose),
      action: stringOr(item.action ?? item.action_zh ?? item.action_en, promptZh || promptEn || params.segmentPurpose),
      camera: stringOr(item.camera, params.segmentCamera),
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
  const references = manifest.consistencyManifest.anchors.flatMap((anchor) => {
    if (!anchor.needsReferenceImage) return [];
    const isCharacter = anchor.type === "person";
    const isScene = anchor.type === "location" || anchor.type === "space_layout";
    if (!isCharacter && !isScene) return [];
    const kind = isCharacter ? "character" as const : "scene" as const;
    const keyframeNo = isCharacter ? -2 : -1;
    const lock = anchorLockText(anchor);
    return [{
      kind,
      needed: true,
      keyframeNo,
      frameId: `consistency_${anchor.id}`,
      purpose: anchor.displayNameZh || anchor.displayNameEn || anchor.id,
      purposeZh: anchor.displayNameZh || anchor.id,
      purposeEn: anchor.displayNameEn || anchor.id,
      scene: anchor.descriptionZh || anchor.descriptionEn || lock,
      characterState: isCharacter ? lock : "",
      productState: !isCharacter ? lock : styleBible.productLock ?? "",
      imagePrompt: anchor.imagePromptZh || anchor.descriptionZh || lock,
      imagePromptZh: anchor.imagePromptZh || anchor.descriptionZh || lock,
      imagePromptEn: anchor.imagePromptEn || anchor.descriptionEn || lock,
      negativePrompt: styleBible.negativePrompt,
      negativePromptZh: styleBible.negativePromptZh,
      negativePromptEn: styleBible.negativePromptEn,
    }];
  });
  const seen = new Set<string>();
  return references.filter((reference) => {
    if (seen.has(reference.kind)) return false;
    seen.add(reference.kind);
    return true;
  });
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
  if (
    value === "person" ||
    value === "product" ||
    value === "prop" ||
    value === "location" ||
    value === "style" ||
    value === "brand_visual" ||
    value === "task_object" ||
    value === "effect_state" ||
    value === "vehicle" ||
    value === "food" ||
    value === "space_layout" ||
    value === "custom"
  ) return value;
  if (value === "character" || value === "human") return "person";
  if (value === "scene" || value === "environment") return "location";
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
