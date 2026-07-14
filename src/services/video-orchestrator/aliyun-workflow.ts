import crypto from "crypto";
import type { OnePromptVideoPlan, PlanVideoProjectInput, VideoAspectRatio } from "./types";
import { createVideoPlan } from "./planner";
import { errorForLog, logOnePromptVideo } from "./logger";

const DASHSCOPE_DEFAULT_BASE = "https://dashscope.aliyuncs.com";
const IMAGE_PATH = "/api/v1/services/aigc/image-generation/generation";
const VIDEO_PATH = "/api/v1/services/aigc/video-generation/video-synthesis";
const MIN_SEGMENT_SECONDS = 3;
const MAX_SEGMENT_SECONDS = 15;
const STORYBOARD_SYSTEM_PROMPT = `You are a senior commercial video director and AI storyboard prompt engineer.

Create a two-level controllable first-and-last-frame video plan based on the user's structured request and the provided duration_seconds.

Return only valid JSON. No markdown, no explanations, no comments.

Core principle:
- Let the model decide the creative structure; let the program decide mathematical correctness.
- Segment count is not fixed and must not be inferred from any example numbers.
- Do not default to 6 segments or 7 keyframes.
- The output arrays are the source of truth: segment_count is derived from segments.length, keyframe_count is derived from keyframes.length, and keyframes.length must equal segments.length + 1.
- Do not output segment_count, keyframe_count, total_duration_seconds, duration_valid, keyframe_count_valid, or any validation object. The backend derives and validates these fields.

Segment selection rules:
- Choose the number of segments based on narrative beats, scene changes, action continuity, emotional rhythm, and whether the content can be generated naturally as one continuous 3-15 second clip.
- Create a new segment only when at least one of the following changes materially: location or environment, time period, narrative beat, subject or primary action, camera setup, emotional state, required generation model behavior, or continuity would be better handled by a cut than by one continuous shot.
- Do not create a new segment for a minor gesture, small camera adjustment, or a continuous action that can be completed naturally within one 3-15 second clip.
- The segment count must be between segment_count_min and segment_count_max from the user payload.
- The actual maximum number of segments is also limited by floor(duration_seconds / segment_duration_min_seconds).
- The actual minimum number of segments is also limited by ceil(duration_seconds / segment_duration_max_seconds).
- Every segment duration must be between 3 and 15 seconds because the video model supports only 3-15s clips.
- Total segment duration must equal exactly duration_seconds.

Timeline and keyframe rules:
- Keyframes are static boundary reference images, not video clips, not shot midpoint frames, and not duration-based generation requests.
- Keyframe 1 is the still first-frame reference at 0s; the final keyframe is the still end-frame reference at duration_seconds.
- 0s and duration_seconds are only timeline metadata for placing still boundary references, never image generation duration and never segment duration.
- Segment duration is end_time_seconds - start_time_seconds and every segment duration_seconds must be >= 3 and <= 15.
- The start_time_seconds/end_time_seconds sequence must be continuous: segment 1 starts at 0, each next segment starts at the previous segment's end, and the final segment ends at duration_seconds.
- Segment N uses keyframe N as first frame and keyframe N+1 as last frame.
- Every interior keyframe is shared by two adjacent segments. It must represent a valid ending state for the previous segment and a valid starting state for the next segment.
- Do not create contradictory actions, camera positions, character poses, prop states, or emotional states around a shared keyframe.

Boundary mode rules:
- Every segment must return boundary_mode as one of: "continuous", "hard_cut", "dissolve", "match_cut".
- "continuous" means the previous and next segment should feel visually continuous around the shared keyframe.
- "hard_cut" means the boundary is an intentional edit; the shared keyframe should still be a valid static bridge, but natural motion continuity is not required.
- "dissolve" means the boundary supports a soft temporal or emotional transition.
- "match_cut" means composition, pose, shape, or motion direction should rhyme across a scene or subject change.
- Use hard_cut, dissolve, or match_cut for meaningful changes such as indoor/outdoor, day/night, memory/reality, or subject switches. Do not force every boundary to be a continuous long-take.

Visual continuity rules:
- If reference images are provided, treat them as identity and visual continuity references. Extract stable character, clothing, prop, product, environment, mood, and style attributes into continuity locks.
- Do not describe or reproduce irrelevant background details from reference images unless requested.
- Do not invent conflicting product details.
- Maintain strict continuity of character identity, face, age, hairstyle, clothing, props, product identity, location logic, architecture, lighting, time of day, weather, and visual style unless a boundary_mode intentionally changes them.
- If the video has one main person, all keyframes and segments must depict the exact same person. Do not vary face shape, age, ethnicity, hairstyle, hair color, outfit, body type, skin tone, or distinctive accessories unless the user explicitly asks for a change.
- Before writing keyframe prompts, define a stable character identity lock in characters[0].consistency_prompt and style_bible.character_lock. This lock must include invariant face description, approximate age, gender presentation, hairstyle, hair color, outfit, body type, skin tone, and any distinctive accessories.
- Every image_prompt_zh and image_prompt_en for a keyframe that contains the main person must explicitly include the same character identity lock. Do not replace it with vague words such as "same woman" or "the protagonist" only.
- If a reference image shows the character, use it as the primary identity lock. Preserve that visible face, hairstyle, outfit, body type, and age across all generated boundary reference images.
- When a scene or time changes, change only environment, pose, action, camera, and lighting. The person identity must remain unchanged.
- Add a character_identity constraint to every segment when the same person appears, and keep it consistent across all segments.

Structured keyframe image design rules:
- For every keyframe, return frame_id, frame_role, timeline_second, frame_design, and negative_prompt as structured data.
- Do not treat image_prompt_zh or image_prompt_en as the source of truth. The backend assembles final image prompts from frame_design, style_bible, character locks, product locks, environment locks, and negative_prompt groups.
- frame_role must describe the image function: "video_start", "segment_start", "segment_end", "shared_boundary", "video_end", or "internal_reference".
- Use "video_start" for keyframe 1, "video_end" for the final keyframe, and "shared_boundary" for interior keyframes that are both previous segment end and next segment start.
- A segment_start frame must show a stable pose that can naturally continue into the segment action, leave motion space, and avoid completed end-state actions.
- A segment_end or video_end frame must show the clear static end state of the previous action and remain compatible with the next cut or boundary mode.
- frame_design.subject describes who is visible and their current static state only: identity, appearance, clothing, static_pose, and facial_expression.
- frame_design.product_or_prop describes current appearance, state, and position of product or props.
- frame_design.environment describes location, time_of_day, weather, background_elements, and environment_state.
- frame_design.spatial_relationships must separately describe where subject, product, foreground, and background sit relative to each other, including what must remain unobstructed.
- frame_design.composition must split shot_size, camera_angle, subject_position, prop_position, foreground, background, and aspect_ratio.
- frame_design.lighting must split direction, quality, contrast, and color_temperature.
- frame_design.rendering must split lens, depth_of_field, visual_style, and texture. Abstract style words must be converted into visible features such as color relation, light ratio, material reflection, negative space, focal length, and environment layers.
- frame_design.continuity_locks must list only non-negotiable identity, product, environment, and style locks inherited by this frame.
- Image design must describe a still moment only. Never include camera movement, temporal progression, or motion verbs such as walking, slowly raising, moving through, drifting fog, fluttering clothing, or entering the frame. Convert them to visible static results such as one foot slightly forward, head slightly turned, right hand paused above product, clothing naturally spread.
- Do not include visible text, subtitles, unintended logos, watermarks, UI, captions, signs, or typography in generated images. Preserve only approved product markings if explicitly required.
- negative_prompt must be a categorized object with text_artifacts, anatomy_artifacts, rendering_artifacts, and content_exclusions. Avoid overbroad exclusions such as "modern objects" when the product itself may be modern.

Video prompt rules:
- video_prompt_zh and video_prompt_en describe the transition from the start boundary reference image to the end boundary reference image, including subject motion, environment motion, camera movement, and pacing.
- They must include motion speed, amplitude, and stability.
- Convert abstract emotions into visible facial expressions, posture, gestures, composition, lighting, or action.
- Do not introduce unnecessary characters, props, locations, or plot events.
- Subtitle may be empty and must be short enough to read within the segment duration.

Audio and speech decision rules:
- For every segment, actively decide whether the story benefits from voiceover, character dialogue, both, only ambient/background sound, or silence.
- Return audio_plan for every segment. This is a creative decision, not an audio file.
- Do not force Chinese voiceover. Choose language, speaker, and voice style only when the story, ad format, or user request benefits from speech.
- If speech is not needed, explain briefly in rationale and set mode to "ambient" or "silent".
- If speech is needed, provide concise speakable lines in lines_zh and/or lines_en, plus speaker and voice_style.
- When audio_plan includes voiceover or dialogue, video_prompt_en must include a clear instruction that the generated video should contain that voice/dialogue if the video model supports audio.
- Avoid over-talking. Speech should support narrative clarity, emotional rhythm, product selling point, or character motivation.

Second-level control rules:
- For every segment, return micro_shots. micro_shots describe internal narrative beats for the user/director. They are not extra video clips and not global boundary keyframes.
- micro_shots.length may vary by segment complexity. Use 1-4 micro_shots. A simple 3s segment may have 1-2; a 10-15s segment should usually have 2-4.
- micro_shots use start_seconds/end_seconds measured relative to the segment start. They may also include local_time_seconds for compatibility.
- timed_prompts are model-facing generation instructions tied to concrete time ranges or moments. Use them only when fixed-time generation cues are needed; do not repeat every micro_shot automatically.
- constraints store only rules that must not be broken, such as character_identity, prop_state, camera_axis, composition_lock, continuity_lock, start_state, or end_state. Do not repeat the full action description in constraints.
- For each segment, decide whether its generation constraint is mainly text, image, or mixed and return output_mode as "text", "image", or "mixed".
- Every boundary reference image and every segment video must be independently editable and generatable.
- Use Chinese for all *_zh fields and user-facing descriptions.
- Use English for all *_en fields and generation prompts.

Return this exact JSON shape. The arrays may contain any valid count within the provided bounds. Do not include derived count or validation fields:

{
  "title": "",
  "logline": "",
  "aspect_ratio": "16:9",
  "visual_style": "",
  "characters": [
    {
      "id": "char_01",
      "name": "",
      "appearance": "",
      "clothing": "",
      "consistency_prompt": ""
    }
  ],
  "style_bible": {
    "visual_style": "",
    "character_lock": "",
    "product_lock": "",
    "color_palette": "",
    "negative_prompt": ""
  },
  "keyframes": [
    {
      "frame_id": "kf_01",
      "frame_role": "video_start",
      "keyframe_no": 1,
      "time_seconds": 0,
      "timeline_second": 0,
      "purpose": "",
      "scene": "",
      "character_state": "",
      "product_state": "",
      "frame_design": {
        "subject": {
          "identity": "",
          "appearance": "",
          "clothing": "",
          "static_pose": "",
          "facial_expression": ""
        },
        "product_or_prop": {
          "appearance": "",
          "state": "",
          "position": ""
        },
        "environment": {
          "location": "",
          "time_of_day": "",
          "weather": "",
          "background_elements": "",
          "environment_state": ""
        },
        "spatial_relationships": [
          ""
        ],
        "composition": {
          "shot_size": "",
          "camera_angle": "",
          "subject_position": "",
          "prop_position": "",
          "foreground": "",
          "background": "",
          "aspect_ratio": "16:9"
        },
        "lighting": {
          "direction": "",
          "quality": "",
          "contrast": "",
          "color_temperature": ""
        },
        "rendering": {
          "lens": "",
          "depth_of_field": "",
          "visual_style": "",
          "texture": ""
        },
        "continuity_locks": [
          ""
        ]
      },
      "description_zh": "",
      "generation_prompt_en": "",
      "negative_prompt": {
        "text_artifacts": [
          "unintended text",
          "subtitles",
          "watermarks",
          "UI",
          "fabricated brand text"
        ],
        "anatomy_artifacts": [
          "deformed hands",
          "extra fingers",
          "malformed anatomy"
        ],
        "rendering_artifacts": [
          "harsh lighting",
          "oversaturated colors",
          "low detail",
          "blurred subject"
        ],
        "content_exclusions": [
          "unapproved modern objects",
          "unintended logos"
        ]
      }
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
      "purpose": "",
      "motion": "",
      "camera": "",
      "subject_motion": "",
      "environment_motion": "",
      "video_prompt_zh": "",
      "video_prompt_en": "",
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
      "constraints": [
        {
          "type": "continuity_lock",
          "description_zh": "",
          "description_en": ""
        }
      ],
      "timed_prompts": [
        {
          "start_seconds": 0,
          "end_seconds": 3,
          "prompt_zh": "",
          "prompt_en": ""
        }
      ],
      "micro_shots": [
        {
          "micro_shot_no": 1,
          "start_seconds": 0,
          "end_seconds": 3,
          "visual_beat_zh": "",
          "visual_beat_en": "",
          "action_zh": "",
          "action_en": "",
          "camera": "",
          "reference_type": "text",
          "image_prompt_zh": "",
          "image_prompt_en": ""
        }
      ],
      "negative_prompt": ""
    }
  ]
}`;

type DashScopeTaskStatus = "pending" | "running" | "succeeded" | "failed";

export interface DashScopeTaskResult {
  status: DashScopeTaskStatus;
  resultUrl?: string;
  errorMessage?: string;
  raw?: unknown;
}

export interface ImsJobResult {
  status: "running" | "succeeded" | "failed";
  mediaUrl?: string;
  errorMessage?: string;
  raw?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function requireDashScopeApiKey(): string {
  const key =
    process.env.DASHSCOPE_API_KEY?.trim() ||
    process.env.BAILIAN_API_KEY?.trim() ||
    process.env.ALIBABA_CLOUD_API_KEY?.trim() ||
    "";
  if (!key) throw new Error("未配置 DASHSCOPE_API_KEY 或 BAILIAN_API_KEY，无法调用阿里云百炼");
  return key;
}

function dashScopeBaseUrl(): string {
  return (process.env.DASHSCOPE_BASE_URL || DASHSCOPE_DEFAULT_BASE).replace(/\/$/, "");
}

function compatibleBaseUrl(): string {
  const fromEnv = process.env.DASHSCOPE_COMPAT_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return `${dashScopeBaseUrl()}/compatible-mode/v1`;
}

function model(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function imageSizeFromAspectRatio(aspectRatio: VideoAspectRatio): string {
  if (aspectRatio === "16:9") return "1536*864";
  if (aspectRatio === "1:1") return "1024*1024";
  return "864*1536";
}

function supportsLastFrameMedia(modelName: string): boolean {
  const model = modelName.trim().toLowerCase();
  if (model.includes("happyhorse")) return false;
  return model.includes("wan2.7") || model.includes("wanx");
}

function supportsOrderedFrameReferences(modelName: string): boolean {
  return false;
}

export async function createAliyunStoryboardPlan(input: PlanVideoProjectInput): Promise<OnePromptVideoPlan> {
  const fallback = createVideoPlan(input);
  const referenceImageUrls = input.referenceImageUrls.slice(0, 4);
  const storyboardModel = referenceImageUrls.length
    ? model("ALIYUN_STORYBOARD_VISION_MODEL", "qwen-vl-max-latest")
    : model("ALIYUN_STORYBOARD_MODEL", "qwen3.7-plus");
  const body = {
    model: storyboardModel,
    messages: [
      {
        role: "system",
        content: STORYBOARD_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: buildStoryboardUserContent(input, referenceImageUrls),
      },
    ],
    temperature: 0.4,
    response_format: { type: "json_object" },
  };

  await logOnePromptVideo("aliyun.storyboard.request", {
    model: storyboardModel,
    baseUrl: compatibleBaseUrl(),
    promptLength: input.userPrompt.length,
    aspectRatio: input.aspectRatio,
    durationSeconds: input.durationSeconds,
    fallbackSegmentCount: input.shotCount,
    stylePreset: input.stylePreset,
    referenceImageCount: referenceImageUrls.length,
  });
  try {
    const res = await fetch(`${compatibleBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${requireDashScopeApiKey()}`,
      },
      body: JSON.stringify(body),
    });
    const raw = await safeJson(res);
    await logOnePromptVideo("aliyun.storyboard.response", {
      httpStatus: res.status,
      ok: res.ok,
      rawSummary: summarizeRaw(raw),
    }, res.ok ? "info" : "error");
    if (!res.ok) throw new Error(extractError(raw) || `百炼分镜规划失败 HTTP ${res.status}`);
    const content = extractChatContent(raw);
    if (!content) throw new Error("百炼分镜规划返回为空");
    const parsed = parseJsonObject(content);
    const plan = normalizeModelPlan(parsed, fallback, input);
    await logOnePromptVideo("aliyun.storyboard.parsed", {
      title: plan.title,
      keyframeCount: plan.keyframes.length,
      segmentCount: plan.segments.length,
      segments: plan.segments.map((segment) => ({
        segmentNo: segment.segmentNo,
        durationSeconds: segment.durationSeconds,
        startKeyframeNo: segment.startKeyframeNo,
        endKeyframeNo: segment.endKeyframeNo,
        videoPromptLength: (segment.videoPromptEn ?? segment.videoPrompt).length,
      })),
    });
    return plan;
  } catch (error) {
    await logOnePromptVideo("aliyun.storyboard.error", errorForLog(error), "error");
    throw error;
  }
}

function buildStoryboardUserContent(
  input: PlanVideoProjectInput,
  referenceImageUrls: string[],
): string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> {
  const effectiveMinSegments = Math.max(1, Math.ceil(input.durationSeconds / MAX_SEGMENT_SECONDS));
  const effectiveMaxSegments = Math.max(effectiveMinSegments, Math.floor(input.durationSeconds / MIN_SEGMENT_SECONDS));
  const payload = JSON.stringify({
    user_idea: input.userPrompt,
    aspect_ratio: input.aspectRatio,
    duration_seconds: input.durationSeconds,
    style_preset: input.stylePreset,
    segment_count_policy: {
      mode: "model_decides",
      segment_count_min: effectiveMinSegments,
      segment_count_max: effectiveMaxSegments,
      segment_duration_min_seconds: MIN_SEGMENT_SECONDS,
      segment_duration_max_seconds: MAX_SEGMENT_SECONDS,
      choose_new_segment_when_material_change_in: [
        "location_or_environment",
        "time_period",
        "narrative_beat",
        "subject_or_primary_action",
        "camera_setup",
        "emotional_state",
        "generation_model_behavior",
        "continuity_better_handled_by_cut",
      ],
      do_not_split_for: [
        "minor_gesture",
        "small_camera_adjustment",
        "continuous_action_that_fits_one_clip",
      ],
    },
    constraints: {
      exact_total_duration: true,
      total_duration_is_user_defined: true,
      no_fixed_30_second_assumption: true,
      keyframes_are_timeline_boundaries: true,
      segments_use_adjacent_keyframes_as_first_and_last_frames: true,
      keyframe_count_equals_segment_count_plus_one: true,
      segment_duration_formula: "duration_seconds = end_time_seconds - start_time_seconds",
      continuous_timeline_required: true,
      two_level_storyboard_required: true,
      each_segment_must_include_micro_shots: true,
      micro_shots_are_internal_controls_not_extra_clips: true,
      micro_shots_use_relative_time_inside_segment: true,
      timed_prompts_are_model_facing_fixed_time_generation_cues: true,
      constraints_are_non_breakable_rules_only: true,
      model_should_choose_segment_count_by_story_rhythm: true,
      display_prompt_languages: ["zh", "en"],
      generation_prompt_language: "en",
      no_visible_text_in_images: true,
      maintain_character_continuity: true,
      if_single_main_person_keep_exact_same_identity_across_all_images: true,
      every_person_image_prompt_must_include_character_identity_lock: true,
      character_identity_lock_must_include_face_age_hair_outfit_body_skin_accessories: true,
      maintain_location_continuity: true,
      interior_keyframe_shared_by_adjacent_segments: true,
      every_segment_must_return_boundary_mode: true,
      every_keyframe_must_return_frame_design: true,
      final_image_prompt_is_assembled_by_backend: true,
      image_design_must_be_static_not_motion: true,
      split_camera_language_into_shot_size_camera_angle_composition_lens_depth_of_field: true,
      split_negative_prompt_into_categories: true,
      prompt_aspect_ratio_is_composition_hint_api_controls_real_size: true,
    },
    keyframe_design_schema_instruction: {
      source_of_truth: "frame_design",
      generation_prompt_policy: "Backend assembles final image prompt from structured fields. Do not rely on a flat keyword prompt.",
      required_frame_roles: ["video_start", "segment_start", "segment_end", "shared_boundary", "video_end", "internal_reference"],
      positive_prompt_order: [
        "frame_role",
        "subject_identity_and_static_state",
        "product_or_prop_state",
        "environment_state",
        "spatial_relationships",
        "shot_size_camera_angle_composition",
        "lighting_color_materials",
        "lens_depth_of_field",
        "visual_style_as_visible_features",
        "continuity_locks",
      ],
      negative_prompt_categories: [
        "text_artifacts",
        "anatomy_artifacts",
        "rendering_artifacts",
        "content_exclusions",
      ],
    },
    derived_fields_not_required_from_model: [
      "segment_count",
      "keyframe_count",
      "total_duration_seconds",
      "duration_valid",
      "validation",
    ],
    reference_images: referenceImageUrls.map((url, index) => ({
      index: index + 1,
      role: "general_visual_reference",
      url,
      instruction: "Extract stable character, clothing, prop, product, environment, mood, and style attributes. Ignore irrelevant background details unless requested.",
    })),
    reference_image_count: referenceImageUrls.length,
    reference_image_instruction: referenceImageUrls.length
      ? "Analyze the attached reference images first. Use visible product, character, color, texture, scene, and mood details as hard visual references for the storyboard and generation prompts."
      : undefined,
  });
  if (!referenceImageUrls.length) return payload;
  return [
    { type: "text", text: payload },
    ...referenceImageUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
  ];
}

export async function submitAliyunImageTask(params: {
  prompt: string;
  negativePrompt?: string;
  aspectRatio: VideoAspectRatio;
  seed?: number;
}): Promise<string> {
  const imageModel = model("ALIYUN_IMAGE_MODEL", "wan2.7-image-pro");
  const supportsNegativePrompt = process.env.ALIYUN_IMAGE_SUPPORTS_NEGATIVE_PROMPT?.trim().toLowerCase() === "true";
  const finalPrompt = supportsNegativePrompt || !params.negativePrompt
    ? params.prompt
    : `${params.prompt}\nAvoid: ${params.negativePrompt}`;
  const body = {
    model: imageModel,
    input: {
      messages: [
        {
          role: "user",
          content: [{ text: finalPrompt.slice(0, 5000) }],
        },
      ],
    },
    parameters: {
      size: imageSizeFromAspectRatio(params.aspectRatio),
      n: 1,
      watermark: false,
      thinking_mode: true,
      ...(supportsNegativePrompt && params.negativePrompt ? { negative_prompt: params.negativePrompt.slice(0, 1500) } : {}),
      ...(params.seed != null ? { seed: params.seed } : {}),
    },
  };
  await logOnePromptVideo("aliyun.image.submit.prepare", {
    model: imageModel,
    aspectRatio: params.aspectRatio,
    size: imageSizeFromAspectRatio(params.aspectRatio),
    promptLength: finalPrompt.length,
    negativePromptLength: params.negativePrompt?.length ?? 0,
    supportsNegativePrompt,
    seed: params.seed,
  });
  return submitDashScopeAsync(IMAGE_PATH, body, "阿里云万相图片生成");
}

export async function submitAliyunImageToVideoTask(params: {
  imageUrl: string;
  lastFrameUrl?: string;
  prompt: string;
  durationSeconds: number;
}): Promise<string> {
  const i2vModel = model("ALIYUN_I2V_MODEL", "wan2.7-i2v-2026-04-25");
  const shouldSendTypedLastFrame = Boolean(params.lastFrameUrl && supportsLastFrameMedia(i2vModel));
  const shouldSendOrderedFrameReference = Boolean(params.lastFrameUrl && supportsOrderedFrameReferences(i2vModel));
  const prompt = params.prompt;
  const body = {
    model: i2vModel,
    input: {
      prompt: prompt.slice(0, 5000),
      media: [
        {
          type: "first_frame",
          url: params.imageUrl,
        },
        ...(shouldSendTypedLastFrame
          ? [
              {
                type: "last_frame",
                url: params.lastFrameUrl,
              },
            ]
          : []),
      ],
    },
    parameters: {
      resolution: process.env.ALIYUN_I2V_RESOLUTION?.trim() || "720P",
      duration: clamp(params.durationSeconds, MIN_SEGMENT_SECONDS, MAX_SEGMENT_SECONDS),
      prompt_extend: true,
      watermark: false,
    },
  };
  await logOnePromptVideo("aliyun.i2v.submit.prepare", {
    model: i2vModel,
    imageUrl: params.imageUrl,
    lastFrameUrl: params.lastFrameUrl,
    lastFrameMode: shouldSendTypedLastFrame ? "last_frame" : shouldSendOrderedFrameReference ? "ordered_reference_disabled" : "none",
    promptLength: prompt.length,
    durationSeconds: params.durationSeconds,
    resolution: process.env.ALIYUN_I2V_RESOLUTION?.trim() || "720P",
  });
  return submitDashScopeAsync(VIDEO_PATH, body, "阿里云万相图生视频");
}

export async function queryDashScopeTask(taskId: string): Promise<DashScopeTaskResult> {
  await logOnePromptVideo("dashscope.task.query.request", { taskId });
  try {
    const res = await fetch(`${dashScopeBaseUrl()}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${requireDashScopeApiKey()}` },
    });
    const raw = await safeJson(res);
    if (!res.ok) {
      const failed = { status: "failed" as const, errorMessage: extractError(raw) || `DashScope 查询失败 HTTP ${res.status}`, raw };
      await logOnePromptVideo("dashscope.task.query.response", {
        taskId,
        httpStatus: res.status,
        status: failed.status,
        errorMessage: failed.errorMessage,
        rawSummary: summarizeRaw(raw),
      }, "error");
      return failed;
    }
    const output = isRecord(raw) && isRecord(raw.output) ? raw.output : undefined;
    const status = String(output?.task_status || "").toUpperCase();
    if (status === "SUCCEEDED") {
      const resultUrl = extractResultUrl(raw);
      const result = resultUrl
        ? { status: "succeeded" as const, resultUrl, raw }
        : { status: "failed" as const, errorMessage: "DashScope 任务成功但未解析到结果 URL", raw };
      await logOnePromptVideo("dashscope.task.query.response", {
        taskId,
        httpStatus: res.status,
        upstreamStatus: status,
        status: result.status,
        resultUrl: result.status === "succeeded" ? result.resultUrl : undefined,
        errorMessage: result.status === "failed" ? result.errorMessage : undefined,
      }, result.status === "failed" ? "error" : "info");
      return result;
    }
    if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
      const result = { status: "failed" as const, errorMessage: extractError(raw) || `DashScope 任务状态 ${status}`, raw };
      await logOnePromptVideo("dashscope.task.query.response", {
        taskId,
        httpStatus: res.status,
        upstreamStatus: status,
        status: result.status,
        errorMessage: result.errorMessage,
        rawSummary: summarizeRaw(raw),
      }, "error");
      return result;
    }
    const result = { status: status === "RUNNING" ? "running" as const : "pending" as const, raw };
    await logOnePromptVideo("dashscope.task.query.response", {
      taskId,
      httpStatus: res.status,
      upstreamStatus: status,
      status: result.status,
    });
    return result;
  } catch (error) {
    await logOnePromptVideo("dashscope.task.query.error", { taskId, ...errorForLog(error) }, "error");
    throw error;
  }
}

export async function submitImsComposeJob(params: {
  projectId: string;
  title: string;
  clipUrls: string[];
  aspectRatio: VideoAspectRatio;
}): Promise<string> {
  if (!params.clipUrls.length) throw new Error("没有可合成的视频片段");
  const outputMediaConfig = buildImsOutputMediaConfig(params.projectId, params.aspectRatio);
  await logOnePromptVideo("ims.compose.submit.prepare", {
    projectId: params.projectId,
    title: params.title,
    clipCount: params.clipUrls.length,
    aspectRatio: params.aspectRatio,
    outputMediaConfig,
  });
  const timeline = {
    VideoTracks: [
      {
        VideoTrackClips: params.clipUrls.map((url) => ({
          MediaURL: url,
          Out: 15,
          AdaptMode: "Cover",
        })),
      },
    ],
  };
  const raw = await callAliyunIce("SubmitMediaProducingJob", {
    Timeline: JSON.stringify(timeline),
    OutputMediaTarget: process.env.ALIYUN_IMS_OUTPUT_TARGET?.trim() || "oss-object",
    OutputMediaConfig: JSON.stringify(outputMediaConfig),
    ProjectMetadata: JSON.stringify({ Title: params.title || "one-prompt-video" }),
    Source: "OPENAPI",
    ClientToken: crypto.createHash("sha1").update(`${params.projectId}-${Date.now()}`).digest("hex").slice(0, 32),
  });
  const jobId = isRecord(raw) && typeof raw.JobId === "string" ? raw.JobId : "";
  if (!jobId) throw new Error(extractError(raw) || "IMS 合成任务提交后未返回 JobId");
  await logOnePromptVideo("ims.compose.submit.success", {
    projectId: params.projectId,
    jobId,
    rawSummary: summarizeRaw(raw),
  });
  return jobId;
}

export async function queryImsComposeJob(jobId: string): Promise<ImsJobResult> {
  await logOnePromptVideo("ims.compose.query.request", { jobId });
  const raw = await callAliyunIce("GetMediaProducingJob", { JobId: jobId });
  const job = isRecord(raw) && isRecord(raw.MediaProducingJob) ? raw.MediaProducingJob : undefined;
  const status = String(job?.Status || "").toLowerCase();
  if (status === "success") {
    const mediaUrl = typeof job?.MediaURL === "string" ? job.MediaURL : undefined;
    await logOnePromptVideo("ims.compose.query.response", { jobId, upstreamStatus: status, status: "succeeded", mediaUrl });
    return { status: "succeeded", mediaUrl, raw };
  }
  if (status === "failed") {
    const result = { status: "failed" as const, errorMessage: extractError(job) || "IMS 合成失败", raw };
    await logOnePromptVideo("ims.compose.query.response", { jobId, upstreamStatus: status, status: result.status, errorMessage: result.errorMessage, rawSummary: summarizeRaw(raw) }, "error");
    return result;
  }
  await logOnePromptVideo("ims.compose.query.response", { jobId, upstreamStatus: status, status: "running" });
  return { status: "running", raw };
}

async function submitDashScopeAsync(path: string, body: unknown, label: string): Promise<string> {
  await logOnePromptVideo("dashscope.task.submit.request", {
    label,
    path,
    model: isRecord(body) && typeof body.model === "string" ? body.model : undefined,
  });
  try {
    const res = await fetch(`${dashScopeBaseUrl()}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
        Authorization: `Bearer ${requireDashScopeApiKey()}`,
      },
      body: JSON.stringify(body),
    });
    const raw = await safeJson(res);
    const output = isRecord(raw) && isRecord(raw.output) ? raw.output : undefined;
    const taskId = typeof output?.task_id === "string" ? output.task_id : "";
    await logOnePromptVideo("dashscope.task.submit.response", {
      label,
      path,
      httpStatus: res.status,
      ok: res.ok,
      taskId,
      rawSummary: summarizeRaw(raw),
    }, res.ok && taskId ? "info" : "error");
    if (!res.ok) throw new Error(extractError(raw) || `${label}提交失败 HTTP ${res.status}`);
    if (!taskId) throw new Error(extractError(raw) || `${label}提交后未返回 task_id`);
    return taskId;
  } catch (error) {
    await logOnePromptVideo("dashscope.task.submit.error", { label, path, ...errorForLog(error) }, "error");
    throw error;
  }
}

function buildImsOutputMediaConfig(projectId: string, aspectRatio: VideoAspectRatio): Record<string, unknown> {
  const target = process.env.ALIYUN_IMS_OUTPUT_TARGET?.trim() || "oss-object";
  const width = aspectRatio === "16:9" ? 1280 : aspectRatio === "1:1" ? 1080 : 720;
  const height = aspectRatio === "16:9" ? 720 : aspectRatio === "1:1" ? 1080 : 1280;
  if (target === "vod-media") {
    const storageLocation = process.env.ALIYUN_IMS_VOD_STORAGE_LOCATION?.trim();
    if (!storageLocation) throw new Error("ALIYUN_IMS_VOD_STORAGE_LOCATION 未配置，无法输出到 VOD");
    return {
      StorageLocation: storageLocation,
      FileName: `${projectId}.mp4`,
      Width: width,
      Height: height,
      Bitrate: 3000,
      VodTemplateGroupId: process.env.ALIYUN_IMS_VOD_TEMPLATE_GROUP_ID?.trim() || "VOD_NO_TRANSCODE",
    };
  }

  const template = process.env.ALIYUN_IMS_OUTPUT_MEDIA_URL_TEMPLATE?.trim();
  const fixed = process.env.ALIYUN_IMS_OUTPUT_MEDIA_URL?.trim();
  const mediaUrl = template
    ? template.replace(/\{projectId\}/g, projectId).replace(/\{timestamp\}/g, String(Date.now()))
    : fixed;
  if (!mediaUrl) {
    throw new Error("ALIYUN_IMS_OUTPUT_MEDIA_URL_TEMPLATE 未配置，无法提交 IMS 合成输出");
  }
  return { MediaURL: mediaUrl, Width: width, Height: height, Bitrate: 3000 };
}

async function callAliyunIce(action: string, params: Record<string, string>): Promise<unknown> {
  const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID?.trim();
  const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET?.trim();
  if (!accessKeyId || !accessKeySecret) {
    throw new Error("未配置 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET，无法调用 IMS");
  }
  const regionId = process.env.ALIYUN_IMS_REGION?.trim() || "cn-shanghai";
  const endpoint = process.env.ALIYUN_IMS_ENDPOINT?.trim() || `https://ice.${regionId}.aliyuncs.com/`;
  const common: Record<string, string> = {
    Action: action,
    Version: "2020-11-09",
    Format: "JSON",
    AccessKeyId: accessKeyId,
    SignatureMethod: "HMAC-SHA1",
    SignatureVersion: "1.0",
    SignatureNonce: crypto.randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    RegionId: regionId,
    ...params,
  };
  const canonical = Object.keys(common)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(common[key])}`)
    .join("&");
  const stringToSign = `GET&%2F&${percentEncode(canonical)}`;
  const signature = crypto.createHmac("sha1", `${accessKeySecret}&`).update(stringToSign).digest("base64");
  const url = `${endpoint.replace(/\/$/, "")}/?${canonical}&Signature=${percentEncode(signature)}`;
  await logOnePromptVideo("ims.call.request", {
    action,
    regionId,
    endpoint,
    paramKeys: Object.keys(params),
  });
  try {
    const res = await fetch(url);
    const raw = await safeJson(res);
    const failed = !res.ok || (isRecord(raw) && (raw.Code || raw.Message) && !raw.JobId && !raw.MediaProducingJob);
    await logOnePromptVideo("ims.call.response", {
      action,
      httpStatus: res.status,
      ok: !failed,
      rawSummary: summarizeRaw(raw),
    }, failed ? "error" : "info");
    if (failed) {
      const message = extractError(raw) || `IMS ${action} 失败 HTTP ${res.status}`;
      const requestId = isRecord(raw) && typeof raw.RequestId === "string" ? raw.RequestId : undefined;
      const troubleshootUrl = deepFindUrl(raw);
      const permissionHint =
        isRecord(raw) && raw.Code === "Forbidden"
          ? "请给当前 ALIYUN_ACCESS_KEY_ID 对应的 RAM 用户添加 AliyunICEFullAccess，或至少授权 ice:SubmitMediaProducingJob / ice:GetMediaProducingJob。"
          : "";
      throw new Error(
        [message, requestId ? `RequestId=${requestId}` : "", permissionHint, troubleshootUrl ? `Troubleshoot=${troubleshootUrl}` : ""]
          .filter(Boolean)
          .join(" "),
      );
    }
    return raw;
  } catch (error) {
    const detail = errorForLog(error);
    await logOnePromptVideo("ims.call.error", { action, endpoint, regionId, ...detail }, "error");
    throw new Error(`IMS ${action} 请求失败：${String(detail.message || "网络异常")}（endpoint=${endpoint} region=${regionId}）`);
  }
}

function percentEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/\+/g, "%20")
    .replace(/\*/g, "%2A")
    .replace(/%7E/g, "~");
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
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("百炼分镜规划未返回合法 JSON");
  }
}

function normalizeModelPlan(raw: unknown, fallback: OnePromptVideoPlan, input: PlanVideoProjectInput): OnePromptVideoPlan {
  const plan = isRecord(raw) ? raw : {};
  const keyframesRaw = Array.isArray(plan.keyframes) ? plan.keyframes : [];
  const segmentsRaw = Array.isArray(plan.segments) ? plan.segments : [];
  const segmentBounds = segmentCountBounds(input.durationSeconds);
  const modelSegmentCount = segmentsRaw.length;
  const fallbackSegmentCount = input.shotCount || fallback.segmentCount || fallback.segments.length || 6;
  const segmentCount = clamp(Number.isFinite(modelSegmentCount) && modelSegmentCount > 0 ? modelSegmentCount : fallbackSegmentCount, segmentBounds.min, segmentBounds.max);
  const keyframeCount = segmentCount + 1;
  const durations = normalizeSegmentDurations(segmentsRaw, fallback.segments, segmentCount, input.durationSeconds);
  const boundaryTimes = durations.reduce<number[]>((times, duration) => {
    times.push(times[times.length - 1] + duration);
    return times;
  }, [0]);
  const firstCharacter = Array.isArray(plan.characters) && isRecord(plan.characters[0]) ? plan.characters[0] : undefined;
  const rawStyleBible = isRecord(plan.styleBible)
    ? plan.styleBible
    : isRecord(plan.style_bible)
      ? plan.style_bible
      : undefined;
  const styleBible = rawStyleBible
    ? {
        visualStyle: stringOr(rawStyleBible.visualStyle ?? rawStyleBible.visual_style, fallback.styleBible.visualStyle),
        characterLock: stringOr(rawStyleBible.characterLock ?? rawStyleBible.character_lock, fallback.styleBible.characterLock),
        productLock: stringOr(rawStyleBible.productLock ?? rawStyleBible.product_lock, fallback.styleBible.productLock ?? ""),
        colorPalette: stringOr(rawStyleBible.colorPalette ?? rawStyleBible.color_palette, fallback.styleBible.colorPalette),
        negativePrompt: stringOr(rawStyleBible.negativePrompt ?? rawStyleBible.negative_prompt, fallback.styleBible.negativePrompt),
        negativePromptZh: stringOr(rawStyleBible.negativePromptZh ?? rawStyleBible.negative_prompt_zh, fallback.styleBible.negativePromptZh ?? toChineseNegativePrompt(fallback.styleBible.negativePrompt)),
        negativePromptEn: stringOr(rawStyleBible.negativePromptEn ?? rawStyleBible.negative_prompt_en, fallback.styleBible.negativePromptEn ?? fallback.styleBible.negativePrompt),
      }
    : {
        visualStyle: stringOr(plan.visual_style, fallback.styleBible.visualStyle),
        characterLock: stringOr(firstCharacter?.consistency_prompt, fallback.styleBible.characterLock),
        productLock: fallback.styleBible.productLock,
        colorPalette: fallback.styleBible.colorPalette,
        negativePrompt: fallback.styleBible.negativePrompt,
        negativePromptZh: fallback.styleBible.negativePromptZh ?? toChineseNegativePrompt(fallback.styleBible.negativePrompt),
        negativePromptEn: fallback.styleBible.negativePromptEn ?? fallback.styleBible.negativePrompt,
      };
  const keyframes = Array.from({ length: keyframeCount }, (_, index) => {
    const keyframeNo = index + 1;
    const source = isRecord(keyframesRaw[index]) ? keyframesRaw[index] : {};
    const fb = fallback.keyframes[index] ?? fallback.keyframes[fallback.keyframes.length - 1];
    const frameRole = normalizeFrameRole(source.frameRole ?? source.frame_role, keyframeNo, keyframeCount);
    const frameDesign = normalizeFrameDesign(source.frameDesign ?? source.frame_design, fb.frameDesign, input.aspectRatio);
    const negativePromptGroups = normalizeNegativePromptGroups(source.negativePrompt ?? source.negative_prompt, fb.negativePromptGroups);
    const negativePrompt = flattenNegativePromptGroups(negativePromptGroups) || stringOr(source.negativePrompt ?? source.negative_prompt, fb.negativePrompt);
    const negativePromptEn = stringOr(source.negativePromptEn ?? source.negative_prompt_en ?? source.negativePrompt ?? source.negative_prompt, fb.negativePromptEn ?? negativePrompt);
    const negativePromptZh = stringOr(source.negativePromptZh ?? source.negative_prompt_zh, fb.negativePromptZh ?? toChineseNegativePrompt(negativePrompt));
    const assembledPromptEn = assembleFrameDesignPrompt({
      frameRole,
      frameDesign,
      styleBible,
      aspectRatio: input.aspectRatio,
      fallback: stringOr(source.generationPromptEn ?? source.generation_prompt_en ?? source.imagePromptEn ?? source.image_prompt_en ?? source.imagePrompt ?? source.image_prompt, fb.imagePromptEn ?? fb.imagePrompt),
      language: "en",
    });
    const assembledPromptZh = assembleFrameDesignPrompt({
      frameRole,
      frameDesign,
      styleBible,
      aspectRatio: input.aspectRatio,
      fallback: stringOr(source.descriptionZh ?? source.description_zh ?? source.imagePromptZh ?? source.image_prompt_zh ?? source.imagePrompt ?? source.image_prompt, fb.imagePromptZh ?? fb.imagePrompt),
      language: "zh",
    });
    return {
      frameId: stringOr(source.frameId ?? source.frame_id, `kf_${String(keyframeNo).padStart(2, "0")}`),
      frameRole,
      keyframeNo,
      timeSeconds: boundaryTimes[index] ?? input.durationSeconds,
      purpose: stringOr(source.purpose, fb.purpose),
      scene: stringOr(source.scene ?? source.scene_description, fb.scene),
      characterState: stringOr(source.characterState ?? source.character_state, fb.characterState),
      productState: stringOr(source.productState ?? source.product_state, fb.productState),
      frameDesign,
      imagePrompt: assembledPromptZh,
      imagePromptZh: assembledPromptZh,
      imagePromptEn: assembledPromptEn,
      negativePromptGroups,
      negativePrompt,
      negativePromptZh,
      negativePromptEn,
    };
  });
  const segments = Array.from({ length: segmentCount }, (_, index) => {
    const segmentNo = index + 1;
    const source = isRecord(segmentsRaw[index]) ? segmentsRaw[index] : {};
    const fb = fallback.segments[index] ?? fallback.segments[fallback.segments.length - 1];
    const negativePrompt = stringOr(source.negativePrompt ?? source.negative_prompt, fb.negativePrompt);
    const negativePromptEn = stringOr(source.negativePromptEn ?? source.negative_prompt_en ?? source.negativePrompt ?? source.negative_prompt, fb.negativePromptEn ?? negativePrompt);
    const negativePromptZh = stringOr(source.negativePromptZh ?? source.negative_prompt_zh, fb.negativePromptZh ?? toChineseNegativePrompt(negativePrompt));
    return {
      segmentNo,
      startKeyframeNo: segmentNo,
      endKeyframeNo: segmentNo + 1,
      startTimeSeconds: boundaryTimes[index] ?? 0,
      endTimeSeconds: boundaryTimes[index + 1] ?? input.durationSeconds,
      durationSeconds: durations[index] ?? MIN_SEGMENT_SECONDS,
      boundaryMode: normalizeBoundaryMode(source.boundaryMode ?? source.boundary_mode) ?? fb.boundaryMode ?? "continuous",
      purpose: stringOr(source.purpose, fb.purpose),
      motion: stringOr(source.motion, fb.motion),
      camera: stringOr(source.camera ?? source.camera_movement, fb.camera),
      subjectMotion: stringOr(source.subjectMotion ?? source.subject_motion, fb.subjectMotion),
      environmentMotion: stringOr(source.environmentMotion ?? source.environment_motion, fb.environmentMotion),
      videoPrompt: stringOr(source.videoPromptZh ?? source.video_prompt_zh ?? source.videoPrompt ?? source.video_prompt, fb.videoPromptZh ?? fb.videoPrompt),
      videoPromptZh: stringOr(source.videoPromptZh ?? source.video_prompt_zh ?? source.videoPrompt ?? source.video_prompt, fb.videoPromptZh ?? fb.videoPrompt),
      videoPromptEn: stringOr(source.videoPromptEn ?? source.video_prompt_en ?? source.videoPrompt ?? source.video_prompt, fb.videoPromptEn ?? fb.videoPrompt),
      subtitle: stringOr(source.subtitle ?? source.narration ?? source.dialogue, fb.subtitle),
      outputMode: normalizeOutputMode(source.outputMode ?? source.output_mode),
      constraints: normalizeConstraintArray(source.constraints),
      timedPrompts: normalizeTimedPrompts(source.timedPrompts ?? source.timed_prompts, boundaryTimes[index] ?? 0, boundaryTimes[index + 1] ?? input.durationSeconds),
      microShots: normalizeMicroShots(
        source.microShots ?? source.micro_shots ?? source.internalStoryboard ?? source.internal_storyboard ?? source.subShots ?? source.sub_shots,
        fb.microShots,
        segmentNo,
        boundaryTimes[index] ?? 0,
        durations[index] ?? MIN_SEGMENT_SECONDS,
        stringOr(source.purpose, fb.purpose),
        stringOr(source.camera ?? source.camera_movement, fb.camera),
      ),
      audioPlan: normalizeAudioPlan(source.audioPlan ?? source.audio_plan, fb.audioPlan),
      negativePrompt,
      negativePromptZh,
      negativePromptEn,
    };
  });
  const shots = segments.map((segment) => {
    const start = keyframes[segment.startKeyframeNo - 1];
    return {
      shotNo: segment.segmentNo,
      durationSeconds: segment.durationSeconds,
      boundaryMode: segment.boundaryMode,
      purpose: segment.purpose,
      camera: segment.camera,
      action: segment.motion,
      imagePrompt: start?.imagePrompt ?? "",
      imagePromptZh: start?.imagePromptZh ?? start?.imagePrompt ?? "",
      imagePromptEn: start?.imagePromptEn ?? start?.imagePrompt ?? "",
      videoPrompt: segment.videoPrompt,
      videoPromptZh: segment.videoPromptZh,
      videoPromptEn: segment.videoPromptEn,
      subtitle: segment.subtitle,
      negativePrompt: segment.negativePrompt,
      negativePromptZh: segment.negativePromptZh,
      negativePromptEn: segment.negativePromptEn,
      outputMode: segment.outputMode,
      constraints: segment.constraints,
      timedPrompts: segment.timedPrompts,
      microShots: segment.microShots,
      audioPlan: segment.audioPlan,
    };
  });
  return {
    title: stringOr(plan.title, fallback.title),
    logline: stringOr(plan.logline, fallback.logline),
    durationSeconds: input.durationSeconds,
    aspectRatio: input.aspectRatio,
    keyframeCount: keyframes.length,
    segmentCount: segments.length,
    styleBible,
    keyframes,
    segments,
    shots,
  };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function toChineseNegativePrompt(prompt: string): string {
  const dictionary: Record<string, string> = {
    text: "文字",
    subtitles: "字幕",
    captions: "字幕",
    logos: "标志",
    logo: "标志",
    watermarks: "水印",
    watermark: "水印",
    ui: "界面元素",
    "modern objects": "现代物件",
    "harsh lighting": "刺眼光线",
    "oversaturated colors": "颜色过饱和",
    "deformed hands": "手部变形",
    "extra fingers": "多余手指",
    "random text": "随机文字",
    "logo distortion": "标志变形",
    "deformed face": "脸部变形",
    "low quality": "低质量",
    blurry: "模糊",
    "duplicated body": "身体重复",
  };
  return prompt
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => dictionary[item.toLowerCase()] ?? item)
    .join("，");
}

function normalizeFrameRole(value: unknown, keyframeNo: number, keyframeCount: number): NonNullable<OnePromptVideoPlan["keyframes"][number]["frameRole"]> {
  if (
    value === "video_start" ||
    value === "segment_start" ||
    value === "segment_end" ||
    value === "shared_boundary" ||
    value === "video_end" ||
    value === "internal_reference"
  ) {
    return value;
  }
  if (keyframeNo === 1) return "video_start";
  if (keyframeNo === keyframeCount) return "video_end";
  return "shared_boundary";
}

function normalizeFrameDesign(
  value: unknown,
  fallback: OnePromptVideoPlan["keyframes"][number]["frameDesign"],
  aspectRatio: VideoAspectRatio,
): OnePromptVideoPlan["keyframes"][number]["frameDesign"] {
  const source = isRecord(value) ? value : {};
  const subject = normalizeNamedRecord(source.subject, fallback?.subject, [
    ["identity", "identity"],
    ["appearance", "appearance"],
    ["clothing", "clothing"],
    ["staticPose", "static_pose"],
    ["facialExpression", "facial_expression"],
  ]);
  const productOrProp = normalizeNamedRecord(source.productOrProp ?? source.product_or_prop, fallback?.productOrProp, [
    ["appearance", "appearance"],
    ["state", "state"],
    ["position", "position"],
  ]);
  const environment = normalizeNamedRecord(source.environment, fallback?.environment, [
    ["location", "location"],
    ["timeOfDay", "time_of_day"],
    ["weather", "weather"],
    ["backgroundElements", "background_elements"],
    ["environmentState", "environment_state"],
  ]);
  const composition = normalizeNamedRecord(source.composition, fallback?.composition, [
    ["shotSize", "shot_size"],
    ["cameraAngle", "camera_angle"],
    ["subjectPosition", "subject_position"],
    ["propPosition", "prop_position"],
    ["foreground", "foreground"],
    ["background", "background"],
    ["aspectRatio", "aspect_ratio"],
  ]);
  const lighting = normalizeNamedRecord(source.lighting, fallback?.lighting, [
    ["direction", "direction"],
    ["quality", "quality"],
    ["contrast", "contrast"],
    ["colorTemperature", "color_temperature"],
  ]);
  const rendering = normalizeNamedRecord(source.rendering, fallback?.rendering, [
    ["lens", "lens"],
    ["depthOfField", "depth_of_field"],
    ["visualStyle", "visual_style"],
    ["texture", "texture"],
  ]);
  return {
    subject,
    productOrProp,
    environment,
    spatialRelationships: normalizeStringArray(source.spatialRelationships ?? source.spatial_relationships) ?? fallback?.spatialRelationships,
    composition: {
      ...(composition ?? {}),
      aspectRatio: normalizeAspectRatio(composition?.aspectRatio) ?? fallback?.composition?.aspectRatio ?? aspectRatio,
    },
    lighting,
    rendering,
    continuityLocks: normalizeStringArray(source.continuityLocks ?? source.continuity_locks) ?? fallback?.continuityLocks,
  };
}

function normalizeNamedRecord(
  value: unknown,
  fallback: Record<string, string | undefined> | undefined,
  fields: Array<[string, string]>,
): Record<string, string> | undefined {
  const source = isRecord(value) ? value : {};
  const result: Record<string, string> = {};
  for (const [camelKey, snakeKey] of fields) {
    const fallbackValue = typeof fallback?.[camelKey] === "string" ? fallback[camelKey] : "";
    const text = stringOr(source[camelKey] ?? source[snakeKey], fallbackValue || "");
    if (text) result[camelKey] = text;
  }
  return Object.keys(result).length ? result : undefined;
}

function normalizeAspectRatio(value: unknown): VideoAspectRatio | undefined {
  return value === "9:16" || value === "16:9" || value === "1:1" ? value : undefined;
}

function normalizeNegativePromptGroups(
  value: unknown,
  fallback: OnePromptVideoPlan["keyframes"][number]["negativePromptGroups"],
): OnePromptVideoPlan["keyframes"][number]["negativePromptGroups"] {
  if (isRecord(value)) {
    return {
      textArtifacts: normalizeStringArray(value.textArtifacts ?? value.text_artifacts) ?? fallback?.textArtifacts,
      anatomyArtifacts: normalizeStringArray(value.anatomyArtifacts ?? value.anatomy_artifacts) ?? fallback?.anatomyArtifacts,
      renderingArtifacts: normalizeStringArray(value.renderingArtifacts ?? value.rendering_artifacts) ?? fallback?.renderingArtifacts,
      contentExclusions: normalizeStringArray(value.contentExclusions ?? value.content_exclusions) ?? fallback?.contentExclusions,
    };
  }
  if (typeof value === "string" && value.trim()) {
    return { ...fallback, renderingArtifacts: [value.trim(), ...(fallback?.renderingArtifacts ?? [])].slice(0, 8) };
  }
  return fallback ?? {
    textArtifacts: ["unintended text", "subtitles", "watermarks", "UI", "fabricated brand text"],
    anatomyArtifacts: ["deformed hands", "extra fingers", "malformed anatomy"],
    renderingArtifacts: ["harsh lighting", "oversaturated colors", "low detail", "blurred subject"],
    contentExclusions: ["unapproved modern objects", "unintended logos"],
  };
}

function flattenNegativePromptGroups(groups: OnePromptVideoPlan["keyframes"][number]["negativePromptGroups"]): string {
  if (!groups) return "";
  return [
    ...(groups.textArtifacts ?? []),
    ...(groups.anatomyArtifacts ?? []),
    ...(groups.renderingArtifacts ?? []),
    ...(groups.contentExclusions ?? []),
  ].filter(Boolean).join(", ");
}

function assembleFrameDesignPrompt(params: {
  frameRole: string;
  frameDesign: OnePromptVideoPlan["keyframes"][number]["frameDesign"];
  styleBible: OnePromptVideoPlan["styleBible"];
  aspectRatio: VideoAspectRatio;
  fallback: string;
  language: "zh" | "en";
}): string {
  const design = params.frameDesign;
  if (!design) return params.fallback;
  const roleText = params.language === "zh"
    ? `静态边界参考帧，帧角色：${params.frameRole}`
    : `Static boundary reference frame, frame role: ${params.frameRole}`;
  const parts = [
    roleText,
    joinRecordValues("Subject", design.subject),
    joinRecordValues("Product or prop", design.productOrProp),
    joinRecordValues("Environment", design.environment),
    design.spatialRelationships?.length ? `Spatial relationships: ${design.spatialRelationships.join("; ")}` : "",
    joinRecordValues("Composition", design.composition),
    joinRecordValues("Lighting", design.lighting),
    joinRecordValues("Rendering", design.rendering),
    params.styleBible.characterLock ? `Global character lock: ${params.styleBible.characterLock}` : "",
    params.styleBible.productLock ? `Global product lock: ${params.styleBible.productLock}` : "",
    params.styleBible.visualStyle ? `Global visual style: ${params.styleBible.visualStyle}` : "",
    design.continuityLocks?.length ? `Continuity locks: ${design.continuityLocks.join("; ")}` : "",
    `Aspect ratio parameter: ${params.aspectRatio}; composition optimized for ${params.aspectRatio}.`,
    "Still image only: no camera movement, no temporal progression, no motion process.",
  ].filter(Boolean);
  return parts.length > 1 ? parts.join(", ") : params.fallback;
}

function joinRecordValues(label: string, value: Record<string, unknown> | undefined): string {
  if (!value) return "";
  const text = Object.values(value).filter((item): item is string => typeof item === "string" && Boolean(item.trim())).join("; ");
  return text ? `${label}: ${text}` : "";
}

function segmentCountBounds(totalSeconds: number): { min: number; max: number } {
  return {
    min: Math.max(1, Math.ceil(totalSeconds / MAX_SEGMENT_SECONDS)),
    max: Math.max(1, Math.floor(totalSeconds / MIN_SEGMENT_SECONDS)),
  };
}

function normalizeSegmentDurations(
  segmentsRaw: unknown[],
  fallbackSegments: OnePromptVideoPlan["segments"],
  count: number,
  totalSeconds: number,
): number[] {
  const durations = Array.from({ length: count }, (_, index) => {
    const source = isRecord(segmentsRaw[index]) ? segmentsRaw[index] : {};
    const rawDuration = Number(source.durationSeconds ?? source.duration_seconds);
    const start = Number(source.startTimeSeconds ?? source.start_time_seconds);
    const end = Number(source.endTimeSeconds ?? source.end_time_seconds);
    const fallbackDuration = fallbackSegments[index]?.durationSeconds ?? totalSeconds / count;
    const duration = Number.isFinite(rawDuration) && rawDuration > 0
      ? rawDuration
      : Number.isFinite(start) && Number.isFinite(end) && end > start
        ? end - start
        : fallbackDuration;
    return clamp(duration, MIN_SEGMENT_SECONDS, MAX_SEGMENT_SECONDS);
  });

  let diff = totalSeconds - durations.reduce((sum, value) => sum + value, 0);
  let guard = 0;
  while (diff !== 0 && guard++ < 1000) {
    let changed = false;
    for (let index = 0; index < durations.length && diff !== 0; index += 1) {
      if (diff > 0) {
        const add = Math.min(diff, MAX_SEGMENT_SECONDS - durations[index]);
        if (add > 0) {
          durations[index] += add;
          diff -= add;
          changed = true;
        }
      } else {
        const remove = Math.min(-diff, durations[index] - MIN_SEGMENT_SECONDS);
        if (remove > 0) {
          durations[index] -= remove;
          diff += remove;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  const normalizedTotal = durations.reduce((sum, value) => sum + value, 0);
  return normalizedTotal === totalSeconds ? durations : distributeSegmentDurations(totalSeconds, count);
}

function distributeSegmentDurations(totalSeconds: number, count: number): number[] {
  const base = clamp(Math.floor(totalSeconds / count), MIN_SEGMENT_SECONDS, MAX_SEGMENT_SECONDS);
  const durations = Array.from({ length: count }, () => base);
  let diff = totalSeconds - durations.reduce((sum, value) => sum + value, 0);
  let index = 0;
  while (diff > 0 && index < durations.length * 2) {
    const target = index % durations.length;
    if (durations[target] < MAX_SEGMENT_SECONDS) {
      durations[target] += 1;
      diff -= 1;
    }
    index += 1;
  }
  index = durations.length - 1;
  while (diff < 0 && index >= -durations.length) {
    const target = ((index % durations.length) + durations.length) % durations.length;
    if (durations[target] > MIN_SEGMENT_SECONDS) {
      durations[target] -= 1;
      diff += 1;
    }
    index -= 1;
  }
  return durations;
}

function normalizeOutputMode(value: unknown): "text" | "image" | "mixed" | undefined {
  if (value === "text" || value === "image" || value === "mixed") return value;
  return undefined;
}

function normalizeBoundaryMode(value: unknown): "continuous" | "hard_cut" | "dissolve" | "match_cut" | undefined {
  if (value === "continuous" || value === "hard_cut" || value === "dissolve" || value === "match_cut") return value;
  return undefined;
}

function normalizeAudioMode(value: unknown): "ambient" | "voiceover" | "dialogue" | "mixed" | "silent" {
  if (value === "ambient" || value === "voiceover" || value === "dialogue" || value === "mixed" || value === "silent") return value;
  return "ambient";
}

function normalizeAudioPlan(
  value: unknown,
  fallback: OnePromptVideoPlan["segments"][number]["audioPlan"],
): OnePromptVideoPlan["segments"][number]["audioPlan"] {
  const source = isRecord(value) ? value : {};
  const mode = normalizeAudioMode(source.mode ?? fallback?.mode);
  const linesZh = normalizeStringArray(source.linesZh ?? source.lines_zh ?? source.voiceoverZh ?? source.voiceover_zh);
  const linesEn = normalizeStringArray(source.linesEn ?? source.lines_en ?? source.voiceoverEn ?? source.voiceover_en);
  const lines = normalizeStringArray(source.lines) ?? linesZh ?? linesEn ?? fallback?.lines;
  const needsVoiceover = typeof source.needsVoiceover === "boolean"
    ? source.needsVoiceover
    : typeof source.needs_voiceover === "boolean"
      ? source.needs_voiceover
      : mode === "voiceover" || mode === "mixed";
  const needsDialogue = typeof source.needsDialogue === "boolean"
    ? source.needsDialogue
    : typeof source.needs_dialogue === "boolean"
      ? source.needs_dialogue
      : mode === "dialogue" || mode === "mixed";
  return {
    mode,
    needsVoiceover,
    needsDialogue,
    language: stringOr(source.language, fallback?.language ?? ""),
    speaker: stringOr(source.speaker, fallback?.speaker ?? ""),
    voiceStyle: stringOr(source.voiceStyle ?? source.voice_style, fallback?.voiceStyle ?? ""),
    lines,
    linesZh: linesZh ?? fallback?.linesZh,
    linesEn: linesEn ?? fallback?.linesEn,
    rationale: stringOr(source.rationale ?? source.reason, fallback?.rationale ?? ""),
  };
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim());
  return items.length ? items.slice(0, 8) : undefined;
}

function normalizeConstraintArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [item.trim()];
    if (!isRecord(item)) return [];
    const type = stringOr(item.type, "");
    const zh = stringOr(item.descriptionZh ?? item.description_zh, "");
    const en = stringOr(item.descriptionEn ?? item.description_en ?? item.description, "");
    const text = [type, zh || en].filter(Boolean).join(": ");
    return text ? [text] : [];
  });
  return items.length ? items.slice(0, 8) : undefined;
}

function normalizeTimedPrompts(value: unknown, startSeconds: number, endSeconds: number): OnePromptVideoPlan["segments"][number]["timedPrompts"] {
  if (!Array.isArray(value)) return undefined;
  const items = value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const localStart = Number(item.startSeconds ?? item.start_seconds);
    const localEnd = Number(item.endSeconds ?? item.end_seconds);
    const rawTime = Number(item.timeSeconds ?? item.time_seconds);
    const startOffset = Number.isFinite(localStart) ? clamp(localStart, 0, endSeconds - startSeconds) : undefined;
    const endOffset = Number.isFinite(localEnd) ? clamp(localEnd, 0, endSeconds - startSeconds) : undefined;
    const timeSeconds = Number.isFinite(rawTime)
      ? clamp(rawTime, startSeconds, endSeconds)
      : startSeconds + (startOffset ?? 0);
    const promptZh = stringOr(item.promptZh ?? item.prompt_zh, "");
    const promptEn = stringOr(item.promptEn ?? item.prompt_en, "");
    const prompt = stringOr(item.prompt, promptZh || promptEn);
    if (!prompt && !promptZh && !promptEn) return [];
    return [{ timeSeconds, startSeconds: startOffset, endSeconds: endOffset, prompt, promptZh, promptEn }];
  });
  return items.length ? items.slice(0, 8) : undefined;
}

function normalizeMicroShots(
  value: unknown,
  fallback: OnePromptVideoPlan["segments"][number]["microShots"],
  segmentNo: number,
  startSeconds: number,
  durationSeconds: number,
  segmentPurpose: string,
  segmentCamera: string,
): OnePromptVideoPlan["segments"][number]["microShots"] {
  const rawItems = Array.isArray(value) ? value : [];
  const items = rawItems.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const microShotNo = clamp(Number(item.microShotNo ?? item.micro_shot_no ?? item.shotNo ?? item.shot_no ?? index + 1), 1, 12);
    const localTimeSeconds = clamp(Number(item.localTimeSeconds ?? item.local_time_seconds ?? item.startSeconds ?? item.start_seconds ?? item.offset_seconds ?? 0), 0, durationSeconds);
    const endSeconds = clamp(Number(item.endSeconds ?? item.end_seconds ?? localTimeSeconds), 0, durationSeconds);
    const absoluteRaw = Number(item.absoluteTimeSeconds ?? item.absolute_time_seconds);
    const absoluteTimeSeconds = Number.isFinite(absoluteRaw)
      ? clamp(absoluteRaw, startSeconds, startSeconds + durationSeconds)
      : startSeconds + localTimeSeconds;
    const promptZh = stringOr(item.promptZh ?? item.prompt_zh ?? item.visualBeatZh ?? item.visual_beat_zh ?? item.actionZh ?? item.action_zh, "");
    const promptEn = stringOr(item.promptEn ?? item.prompt_en ?? item.visualBeatEn ?? item.visual_beat_en ?? item.actionEn ?? item.action_en, "");
    const imagePromptZh = stringOr(item.imagePromptZh ?? item.image_prompt_zh, "");
    const imagePromptEn = stringOr(item.imagePromptEn ?? item.image_prompt_en, "");
    const purpose = stringOr(item.purpose ?? item.visualBeatZh ?? item.visual_beat_zh ?? item.visualBeatEn ?? item.visual_beat_en, segmentPurpose);
    const scene = stringOr(item.scene ?? item.scene_limit, segmentPurpose);
    const action = stringOr(item.action ?? item.actionZh ?? item.action_zh ?? item.actionEn ?? item.action_en ?? item.action_limit, promptZh || promptEn || purpose);
    const prompt = stringOr(item.prompt, promptZh || promptEn || action);
    if (!prompt && !purpose && !scene && !action && !imagePromptZh && !imagePromptEn) return [];
    return [{
      microShotNo,
      localTimeSeconds,
      endSeconds,
      absoluteTimeSeconds,
      purpose,
      scene,
      action,
      camera: stringOr(item.camera ?? item.camera_limit, segmentCamera),
      referenceType: normalizeReferenceType(item.referenceType ?? item.reference_type),
      imagePrompt: stringOr(item.imagePrompt ?? item.image_prompt, imagePromptZh || imagePromptEn),
      imagePromptZh,
      imagePromptEn,
      prompt,
      promptZh,
      promptEn,
    }];
  });
  const normalized = items.length ? items : fallback;
  return normalized?.length ? normalized.slice(0, 6).map((item, index) => ({
    ...item,
    microShotNo: index + 1,
    localTimeSeconds: clamp(item.localTimeSeconds, 0, durationSeconds),
    endSeconds: typeof item.endSeconds === "number" ? clamp(item.endSeconds, 0, durationSeconds) : undefined,
    absoluteTimeSeconds: clamp(item.absoluteTimeSeconds, startSeconds, startSeconds + durationSeconds),
  })) : undefined;
}

function normalizeReferenceType(value: unknown): "text" | "image_prompt" | "mixed" | undefined {
  if (value === "text" || value === "image_prompt" || value === "mixed") return value;
  if (value === "image") return "image_prompt";
  return undefined;
}

function extractResultUrl(raw: unknown): string | undefined {
  const output = isRecord(raw) && isRecord(raw.output) ? raw.output : undefined;
  if (typeof output?.video_url === "string") return output.video_url;
  if (Array.isArray(output?.choices)) {
    for (const choice of output.choices) {
      if (!isRecord(choice) || !isRecord(choice.message) || !Array.isArray(choice.message.content)) continue;
      for (const item of choice.message.content) {
        if (!isRecord(item)) continue;
        if (typeof item.image === "string") return item.image;
        if (typeof item.video === "string") return item.video;
      }
    }
  }
  return deepFindUrl(raw);
}

function deepFindUrl(value: unknown): string | undefined {
  const stack = [value];
  let steps = 0;
  while (stack.length && steps++ < 500) {
    const current = stack.shift();
    if (typeof current === "string" && /^https?:\/\//i.test(current)) return current;
    if (Array.isArray(current)) stack.push(...current);
    else if (isRecord(current)) stack.push(...Object.values(current));
  }
  return undefined;
}

function extractError(raw: unknown): string | undefined {
  if (!isRecord(raw)) return undefined;
  const output = isRecord(raw.output) ? raw.output : raw;
  const code = typeof output.Code === "string" ? output.Code : typeof output.code === "string" ? output.code : "";
  const msg = typeof output.Message === "string" ? output.Message : typeof output.message === "string" ? output.message : "";
  if (code && msg) return `${code}: ${msg}`;
  return msg || code || undefined;
}

function summarizeRaw(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const output = isRecord(raw.output) ? raw.output : undefined;
  return {
    requestId: raw.request_id || raw.RequestId,
    code: raw.code || raw.Code,
    message: raw.message || raw.Message,
    taskId: output?.task_id,
    taskStatus: output?.task_status,
    jobId: raw.JobId,
    hasMediaProducingJob: Boolean(raw.MediaProducingJob),
    resultUrl: extractResultUrl(raw),
  };
}
