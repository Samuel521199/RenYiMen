import type {
  OnePromptVideoPlan,
  PlanVideoProjectInput,
  VideoAspectRatio,
  VideoMicroShot,
  VideoPlanKeyframe,
  VideoPlanSegment,
  VideoPlanShot,
  VideoStyleBible,
} from "./types";

const DEFAULT_NEGATIVE_PROMPT =
  "watermark, random text, logo distortion, extra fingers, deformed face, low quality, blurry, duplicated body";
const DEFAULT_NEGATIVE_PROMPT_ZH =
  "水印，随机文字，标志变形，多余手指，脸部变形，低质量，模糊，身体重复";
const MIN_SEGMENT_SECONDS = 3;
const MAX_SEGMENT_SECONDS = 15;
const DEFAULT_PROJECT_DURATION_SECONDS = 30;
const MAX_PROJECT_DURATION_SECONDS = 180;

const STYLE_PRESETS: Record<string, Pick<VideoStyleBible, "visualStyle" | "colorPalette">> = {
  cinematic: {
    visualStyle: "cinematic advertising film, premium lighting, controlled composition, realistic detail",
    colorPalette: "deep black, soft gold, clean neutral highlights",
  },
  product: {
    visualStyle: "premium product commercial, macro details, clean studio lighting, elegant motion",
    colorPalette: "brand-friendly neutrals, polished highlights, clear product colors",
  },
  short_drama: {
    visualStyle: "short drama style, expressive character acting, clear story beat, cinematic realism",
    colorPalette: "natural skin tones, warm interior light, high contrast accents",
  },
  guofeng: {
    visualStyle: "modern Chinese aesthetic, elegant courtyard, silk textures, soft morning light",
    colorPalette: "jade green, ivory white, warm gold, ink black",
  },
  ecommerce: {
    visualStyle: "social commerce video, clean product visibility, bright lifestyle scene, persuasive pacing",
    colorPalette: "bright white, product color accents, fresh daylight",
  },
};

const KEYFRAME_PURPOSES = [
  "建立场景与整体氛围",
  "主角或核心产品正式出现",
  "建立人与产品的第一次互动",
  "突出关键卖点或情绪转折",
  "呈现效果、质感或事件推进",
  "强化品牌记忆点和完成感",
  "收束主题并形成最终印象",
];

const SEGMENT_PURPOSES = [
  "从环境建立过渡到主体出现",
  "从主体出现过渡到互动发生",
  "从互动动作过渡到关键卖点",
  "从卖点展示过渡到效果呈现",
  "从效果呈现过渡到品牌记忆点",
  "从品牌记忆点过渡到最终收束画面",
];

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeDurationSeconds(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : DEFAULT_PROJECT_DURATION_SECONDS;
  return clampInt(numeric, MIN_SEGMENT_SECONDS, MAX_PROJECT_DURATION_SECONDS);
}

function segmentCountBounds(totalSeconds: number): { min: number; max: number } {
  return {
    min: Math.max(1, Math.ceil(totalSeconds / MAX_SEGMENT_SECONDS)),
    max: Math.max(1, Math.floor(totalSeconds / MIN_SEGMENT_SECONDS)),
  };
}

function normalizeFallbackSegmentCount(value: unknown, totalSeconds: number): number {
  const bounds = segmentCountBounds(totalSeconds);
  const numeric = typeof value === "number" ? value : Math.round(totalSeconds / 5);
  return clampInt(numeric, bounds.min, bounds.max);
}

function normalizeAspectRatio(value: string | undefined): VideoAspectRatio {
  return value === "16:9" || value === "1:1" ? value : "9:16";
}

function normalizeText(value: string, fallback: string, maxLength = 2000): string {
  const text = value.replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, maxLength);
}

function normalizeReferenceImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\//i.test(item))
    .slice(0, 4);
}

function styleFromPreset(stylePreset?: string): VideoStyleBible {
  const preset = stylePreset && STYLE_PRESETS[stylePreset] ? STYLE_PRESETS[stylePreset] : STYLE_PRESETS.cinematic;
  return {
    visualStyle: preset.visualStyle,
    characterLock: "single main character identity lock: preserve the exact same face shape, facial features, approximate age, gender presentation, hairstyle, hair color, outfit, body type, skin tone, and distinctive accessories across every boundary reference image and every video segment",
    productLock: "keep the same product shape, material, label area, color, and premium finish",
    colorPalette: preset.colorPalette,
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    negativePromptZh: DEFAULT_NEGATIVE_PROMPT_ZH,
    negativePromptEn: DEFAULT_NEGATIVE_PROMPT,
  };
}

function aspectHint(aspectRatio: VideoAspectRatio): string {
  if (aspectRatio === "16:9") return "horizontal 16:9 frame";
  if (aspectRatio === "1:1") return "square 1:1 frame";
  return "vertical 9:16 frame";
}

function deriveTitle(prompt: string, stylePreset?: string): string {
  const cleaned = prompt.replace(/[，。！？,.!?]/g, " ").replace(/\s+/g, " ").trim();
  const prefix = cleaned.slice(0, 18) || "一句话成片";
  const suffix = stylePreset === "guofeng" ? "国风短片" : stylePreset === "product" ? "产品短片" : "30s 短片";
  return `${prefix} ${suffix}`;
}

function keyframeTimes(total: number, segmentCount: number): number[] {
  return Array.from({ length: segmentCount + 1 }, (_, index) => Math.round((total / segmentCount) * index));
}

function buildKeyframes(input: PlanVideoProjectInput, styleBible: VideoStyleBible, prompt: string): VideoPlanKeyframe[] {
  const times = keyframeTimes(input.durationSeconds, input.shotCount);
  return times.map((timeSeconds, index) => {
    const keyframeNo = index + 1;
    const purpose = KEYFRAME_PURPOSES[index] ?? `边界参考帧 ${keyframeNo}`;
    const baseEn = [
      `Static boundary reference frame ${keyframeNo}; timeline position T+${timeSeconds}s is metadata only, not an image or video duration.`,
      aspectHint(input.aspectRatio),
      styleBible.visualStyle,
      `Theme: ${prompt}.`,
      `Purpose: ${purpose}.`,
      `Maintain continuity: ${styleBible.characterLock}.`,
      `Product continuity: ${styleBible.productLock}.`,
      `Color palette: ${styleBible.colorPalette}.`,
      "Create exactly one polished still image for first-and-last-frame video generation. No visible text, captions, watermark, UI, or logo artifacts.",
    ].join(" ");
    const zh = `第 ${keyframeNo} 个边界参考帧，时间轴位置 T+${timeSeconds}s 仅作为首尾帧衔接参考，不是生成时长。目的：${purpose}。围绕“${prompt}”生成一张可作为视频段边界的静态画面，保持人物、产品、场景、光线和风格连续。不要出现文字、水印或错误标识。`;
    return {
      keyframeNo,
      timeSeconds,
      purpose,
      scene: purpose,
      characterState: keyframeNo === 1 ? "主体尚未完全进入或处于建立氛围阶段" : "主体状态自然推进，身份保持一致",
      productState: keyframeNo <= 2 ? "产品逐步出现并建立识别" : "产品形态、材质和颜色保持一致",
      imagePrompt: zh,
      imagePromptZh: zh,
      imagePromptEn: baseEn,
      negativePrompt: styleBible.negativePrompt,
      negativePromptZh: styleBible.negativePromptZh ?? DEFAULT_NEGATIVE_PROMPT_ZH,
      negativePromptEn: styleBible.negativePromptEn ?? styleBible.negativePrompt,
    };
  });
}

function buildSegments(input: PlanVideoProjectInput, styleBible: VideoStyleBible, prompt: string): VideoPlanSegment[] {
  const times = keyframeTimes(input.durationSeconds, input.shotCount);
  return Array.from({ length: input.shotCount }, (_, index) => {
    const segmentNo = index + 1;
    const startTimeSeconds = times[index];
    const endTimeSeconds = times[index + 1];
    const durationSeconds = endTimeSeconds - startTimeSeconds;
    const purpose = SEGMENT_PURPOSES[index] ?? `片段 ${segmentNo}`;
    const camera = index === 0 ? "slow push-in, gentle parallax" : index === 5 ? "final subtle zoom and stable lock-off" : "smooth cinematic camera movement";
    const subjectMotion = "natural subject motion with stable identity and consistent product handling";
    const environmentMotion = "subtle ambient motion, soft fabric movement, gentle light and atmosphere changes";
    const microShots = buildFallbackMicroShots({
      segmentNo,
      startTimeSeconds,
      durationSeconds,
      purpose,
      camera,
      prompt,
    });
    const videoPromptEn = [
      `Create segment ${segmentNo}, a smooth ${durationSeconds}-second transition from boundary reference frame ${segmentNo} to boundary reference frame ${segmentNo + 1}.`,
      `Theme: ${prompt}.`,
      `Purpose: ${purpose}.`,
      `Camera: ${camera}.`,
      `Subject motion: ${subjectMotion}.`,
      `Environment motion: ${environmentMotion}.`,
      "The first video frame must match the start boundary reference image and the last video frame must match the end boundary reference image.",
      "Keep character, product, location, lighting, and style consistent. No sudden cuts, no identity drift, no visible text or watermark.",
    ].join(" ");
    const videoPromptZh = `片段 ${segmentNo}，从边界参考帧 ${segmentNo} 平滑过渡到边界参考帧 ${segmentNo + 1}，时长 ${durationSeconds} 秒。目的：${purpose}。运镜：${camera}。主体动作自然，环境轻微运动，首帧贴合起始参考图，尾帧贴合结束参考图，保持人物、产品、场景和光线一致。`;
    return {
      segmentNo,
      startKeyframeNo: segmentNo,
      endKeyframeNo: segmentNo + 1,
      startTimeSeconds,
      endTimeSeconds,
      durationSeconds,
      boundaryMode: "continuous",
      purpose,
      motion: `${subjectMotion}; ${environmentMotion}`,
      camera,
      subjectMotion,
      environmentMotion,
      videoPrompt: videoPromptZh,
      videoPromptZh,
      videoPromptEn,
      subtitle: "",
      outputMode: "mixed",
      constraints: [
        "Keep the start frame and end frame visually consistent with the boundary reference images.",
        "Keep scene, subject identity, product appearance, lighting, and camera style continuous.",
      ],
      timedPrompts: microShots.map((item) => ({
        timeSeconds: item.absoluteTimeSeconds,
        prompt: item.prompt,
        promptZh: item.promptZh,
        promptEn: item.promptEn,
      })),
      microShots,
      audioPlan: {
        mode: "ambient",
        needsVoiceover: false,
        needsDialogue: false,
        rationale: "Fallback plan keeps ambient/background sound unless the storyboard model decides speech is needed.",
      },
      negativePrompt: styleBible.negativePrompt,
      negativePromptZh: styleBible.negativePromptZh ?? DEFAULT_NEGATIVE_PROMPT_ZH,
      negativePromptEn: styleBible.negativePromptEn ?? styleBible.negativePrompt,
    };
  });
}

function buildFallbackMicroShots(params: {
  segmentNo: number;
  startTimeSeconds: number;
  durationSeconds: number;
  purpose: string;
  camera: string;
  prompt: string;
}): VideoMicroShot[] {
  const localTimes = params.durationSeconds >= 8
    ? [0, Math.round(params.durationSeconds / 2), params.durationSeconds]
    : [0, params.durationSeconds];
  return localTimes.map((localTimeSeconds, index) => {
    const microShotNo = index + 1;
    const phase = index === 0
      ? "setup the scene and match the start boundary frame"
      : index === localTimes.length - 1
        ? "resolve the action and match the end boundary frame"
        : "develop the core action beat";
    const promptEn = [
      `Segment ${params.segmentNo} internal beat ${microShotNo} at +${localTimeSeconds}s.`,
      phase,
      `Theme: ${params.prompt}.`,
      `Segment purpose: ${params.purpose}.`,
      `Camera: ${params.camera}.`,
      "Use this as an internal control point, not as an extra video clip.",
    ].join(" ");
    const promptZh = `片段 ${params.segmentNo} 的内部子分镜 ${microShotNo}，局部时间 +${localTimeSeconds}s，用于限制本片段内部画面和动作，不是额外视频片段。`;
    return {
      microShotNo,
      localTimeSeconds,
      absoluteTimeSeconds: params.startTimeSeconds + localTimeSeconds,
      purpose: phase,
      scene: params.purpose,
      action: phase,
      camera: params.camera,
      referenceType: index === 1 ? "mixed" : "text",
      imagePrompt: promptZh,
      imagePromptZh: promptZh,
      imagePromptEn: promptEn,
      prompt: promptZh,
      promptZh,
      promptEn,
    };
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
}

export function createVideoPlan(input: PlanVideoProjectInput): OnePromptVideoPlan {
  const durationSeconds = normalizeDurationSeconds(input.durationSeconds);
  const aspectRatio = normalizeAspectRatio(input.aspectRatio);
  const shotCount = normalizeFallbackSegmentCount(input.shotCount, durationSeconds);
  const prompt = normalizeText(input.userPrompt, "制作一条高级感 30 秒短视频");
  const styleBible = styleFromPreset(input.stylePreset);
  const normalizedInput = { ...input, userPrompt: prompt, aspectRatio, durationSeconds, shotCount };
  const keyframes = buildKeyframes(normalizedInput, styleBible, prompt);
  const segments = buildSegments(normalizedInput, styleBible, prompt);

  return {
    title: deriveTitle(prompt, input.stylePreset),
    logline: `围绕“${prompt}”规划 ${keyframes.length} 张静态边界参考帧和 ${segments.length} 段首尾帧视频片段，合成 ${durationSeconds}s 成片。`,
    durationSeconds,
    aspectRatio,
    keyframeCount: keyframes.length,
    segmentCount: segments.length,
    styleBible,
    keyframes,
    segments,
    shots: segmentsToCompatShots(keyframes, segments),
  };
}

export function normalizePlanInput(input: {
  userPrompt?: unknown;
  aspectRatio?: unknown;
  durationSeconds?: unknown;
  shotCount?: unknown;
  stylePreset?: unknown;
  referenceImageUrls?: unknown;
}): PlanVideoProjectInput {
  const durationSeconds = normalizeDurationSeconds(input.durationSeconds);
  return {
    userPrompt: normalizeText(typeof input.userPrompt === "string" ? input.userPrompt : "", "制作一条高级感 30 秒短视频"),
    aspectRatio: normalizeAspectRatio(typeof input.aspectRatio === "string" ? input.aspectRatio : undefined),
    durationSeconds,
    shotCount: normalizeFallbackSegmentCount(input.shotCount, durationSeconds),
    stylePreset: typeof input.stylePreset === "string" ? input.stylePreset.trim() : "",
    referenceImageUrls: normalizeReferenceImageUrls(input.referenceImageUrls),
  };
}
