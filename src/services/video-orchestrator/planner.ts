import type {
  OnePromptVideoPlan,
  PlanVideoProjectInput,
  VideoAspectRatio,
  VideoPlanKeyframe,
  VideoPlanSegment,
  VideoPlanShot,
  VideoStyleBible,
} from "./types";

const DEFAULT_NEGATIVE_PROMPT =
  "watermark, random text, logo distortion, extra fingers, deformed face, low quality, blurry, duplicated body";

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
    characterLock: "keep the same main character identity, face, outfit, hairstyle, product identity, location, lighting, and visual style across all keyframes",
    productLock: "keep the same product shape, material, label area, color, and premium finish",
    colorPalette: preset.colorPalette,
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
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
    const purpose = KEYFRAME_PURPOSES[index] ?? `关键帧 ${keyframeNo}`;
    const baseEn = [
      `Keyframe ${keyframeNo} at ${timeSeconds}s of a coherent 30s video.`,
      aspectHint(input.aspectRatio),
      styleBible.visualStyle,
      `Theme: ${prompt}.`,
      `Purpose: ${purpose}.`,
      `Maintain continuity: ${styleBible.characterLock}.`,
      `Product continuity: ${styleBible.productLock}.`,
      `Color palette: ${styleBible.colorPalette}.`,
      "Create a polished static boundary frame for first-and-last-frame video generation. No visible text, captions, watermark, UI, or logo artifacts.",
    ].join(" ");
    const zh = `第 ${keyframeNo} 个关键帧，时间点 ${timeSeconds}s。目的：${purpose}。围绕“${prompt}”生成一个可作为视频段边界的静态画面，保持人物、产品、场景、光线和风格连续。不要出现文字、水印或错误标识。`;
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
    const videoPromptEn = [
      `Create segment ${segmentNo}, a smooth ${durationSeconds}-second transition from keyframe ${segmentNo} to keyframe ${segmentNo + 1}.`,
      `Theme: ${prompt}.`,
      `Purpose: ${purpose}.`,
      `Camera: ${camera}.`,
      `Subject motion: ${subjectMotion}.`,
      `Environment motion: ${environmentMotion}.`,
      "The first frame must match the start keyframe and the last frame must match the end keyframe.",
      "Keep character, product, location, lighting, and style consistent. No sudden cuts, no identity drift, no visible text or watermark.",
    ].join(" ");
    const videoPromptZh = `片段 ${segmentNo}，从关键帧 ${segmentNo} 平滑过渡到关键帧 ${segmentNo + 1}，时长 ${durationSeconds} 秒。目的：${purpose}。运镜：${camera}。主体动作自然，环境轻微运动，首帧贴合起始关键帧，尾帧贴合结束关键帧，保持人物、产品、场景和光线一致。`;
    return {
      segmentNo,
      startKeyframeNo: segmentNo,
      endKeyframeNo: segmentNo + 1,
      startTimeSeconds,
      endTimeSeconds,
      durationSeconds,
      purpose,
      motion: `${subjectMotion}; ${environmentMotion}`,
      camera,
      subjectMotion,
      environmentMotion,
      videoPrompt: videoPromptZh,
      videoPromptZh,
      videoPromptEn,
      subtitle: "",
      negativePrompt: styleBible.negativePrompt,
    };
  });
}

function segmentsToCompatShots(keyframes: VideoPlanKeyframe[], segments: VideoPlanSegment[]): VideoPlanShot[] {
  return segments.map((segment) => {
    const start = keyframes[segment.startKeyframeNo - 1];
    return {
      shotNo: segment.segmentNo,
      durationSeconds: segment.durationSeconds,
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
    };
  });
}

export function createVideoPlan(input: PlanVideoProjectInput): OnePromptVideoPlan {
  const durationSeconds = 30;
  const aspectRatio = normalizeAspectRatio(input.aspectRatio);
  const shotCount = clampInt(input.shotCount, 2, 10);
  const prompt = normalizeText(input.userPrompt, "制作一条高级感 30 秒短视频");
  const styleBible = styleFromPreset(input.stylePreset);
  const normalizedInput = { ...input, userPrompt: prompt, aspectRatio, durationSeconds, shotCount };
  const keyframes = buildKeyframes(normalizedInput, styleBible, prompt);
  const segments = buildSegments(normalizedInput, styleBible, prompt);

  return {
    title: deriveTitle(prompt, input.stylePreset),
    logline: `围绕“${prompt}”规划 7 个时间轴关键帧和 6 段首尾帧视频片段，先审核关键帧，再生成视频段并合成 30s 成片。`,
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
  return {
    userPrompt: normalizeText(typeof input.userPrompt === "string" ? input.userPrompt : "", "制作一条高级感 30 秒短视频"),
    aspectRatio: normalizeAspectRatio(typeof input.aspectRatio === "string" ? input.aspectRatio : undefined),
    durationSeconds: 30,
    shotCount: clampInt(typeof input.shotCount === "number" ? input.shotCount : 6, 2, 10),
    stylePreset: typeof input.stylePreset === "string" ? input.stylePreset.trim() : "",
    referenceImageUrls: normalizeReferenceImageUrls(input.referenceImageUrls),
  };
}
