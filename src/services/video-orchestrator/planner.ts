import type {
  OnePromptVideoPlan,
  PlanVideoProjectInput,
  VideoAspectRatio,
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

const SHOT_TEMPLATES = [
  {
    purpose: "建立主题和视觉氛围",
    camera: "wide establishing shot, slow push-in",
    action: "主角或产品进入画面，环境信息清晰出现",
    subtitle: "故事从这一刻开始",
  },
  {
    purpose: "展示核心对象和情绪",
    camera: "medium shot, gentle lateral move",
    action: "主角与产品发生第一次互动，情绪自然建立",
    subtitle: "看见真正重要的细节",
  },
  {
    purpose: "强调产品或事件的关键卖点",
    camera: "close-up, controlled rack focus",
    action: "镜头聚焦关键动作、质感或效果变化",
    subtitle: "细节决定质感",
  },
  {
    purpose: "制造转折和记忆点",
    camera: "dynamic orbit shot, smooth handheld energy",
    action: "场景节奏增强，角色动作更明确",
    subtitle: "让画面有了情绪",
  },
  {
    purpose: "呈现结果和高级感",
    camera: "hero shot, slow tilt up",
    action: "主角或产品以最完整、最有吸引力的状态出现",
    subtitle: "好的状态自然被看见",
  },
  {
    purpose: "完成收束和行动号召",
    camera: "final lock-off shot, subtle zoom",
    action: "画面回到品牌、产品或主题，形成清晰结尾",
    subtitle: "现在就开始你的高光时刻",
  },
  {
    purpose: "补充场景层次",
    camera: "insert shot, slow pan",
    action: "展示环境、道具、质感或辅助信息",
    subtitle: "氛围让内容更可信",
  },
  {
    purpose: "强化最终印象",
    camera: "clean final close-up, soft push",
    action: "用简洁画面留下最后记忆点",
    subtitle: "把好印象留到最后",
  },
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
    characterLock: "keep the same main character, product identity, outfit, material, color, and lighting continuity across all shots",
    colorPalette: preset.colorPalette,
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
  };
}

function deriveTitle(prompt: string, stylePreset?: string): string {
  const cleaned = prompt.replace(/[，。！？,.!?]/g, " ").replace(/\s+/g, " ").trim();
  const prefix = cleaned.slice(0, 18) || "一句话成片";
  const suffix = stylePreset === "guofeng" ? "国风短片" : stylePreset === "product" ? "产品短片" : "30s 短片";
  return `${prefix} ${suffix}`;
}

function buildShot(
  input: PlanVideoProjectInput,
  styleBible: VideoStyleBible,
  shotNo: number,
  durationSeconds: number,
): VideoPlanShot {
  const template = SHOT_TEMPLATES[(shotNo - 1) % SHOT_TEMPLATES.length];
  const prompt = normalizeText(input.userPrompt, "制作一条高级感 30 秒短视频");
  const aspectHint =
    input.aspectRatio === "16:9"
      ? "horizontal 16:9 frame"
      : input.aspectRatio === "1:1"
        ? "square 1:1 frame"
        : "vertical 9:16 frame";
  const continuity = `Shot ${shotNo} of a coherent ${input.durationSeconds}s video.`;
  const base = `${continuity} ${aspectHint}. ${styleBible.visualStyle}. Theme: ${prompt}. Shot purpose: ${template.purpose}. Action: ${template.action}. Camera: ${template.camera}. Color palette: ${styleBible.colorPalette}.`;

  return {
    shotNo,
    durationSeconds,
    purpose: template.purpose,
    camera: template.camera,
    action: template.action,
    imagePrompt: `静态关键帧：${template.purpose}。画面主体围绕“${prompt}”，${template.action}。构图参考 ${template.camera}，保持${styleBible.colorPalette}，不要出现文字、水印或标识。`,
    imagePromptZh: `静态关键帧：${template.purpose}。画面主体围绕“${prompt}”，${template.action}。构图参考 ${template.camera}，保持${styleBible.colorPalette}，不要出现文字、水印或标识。`,
    imagePromptEn: `${base} Generate a polished static keyframe with no visible text, no logo, no watermark.`,
    videoPrompt: `视频运动：${template.action}。镜头采用 ${template.camera}，动作自然稳定，主体身份一致，节奏适合 ${durationSeconds} 秒片段。`,
    videoPromptZh: `视频运动：${template.action}。镜头采用 ${template.camera}，动作自然稳定，主体身份一致，节奏适合 ${durationSeconds} 秒片段。`,
    videoPromptEn: `${template.camera}. ${template.action}. Natural motion, stable subject identity, premium pacing, ${durationSeconds} seconds.`,
    subtitle: template.subtitle,
    negativePrompt: styleBible.negativePrompt,
  };
}

function distributeDurations(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  let rest = total - base * count;
  return Array.from({ length: count }, () => {
    const value = base + (rest > 0 ? 1 : 0);
    rest -= 1;
    return value;
  });
}

export function createVideoPlan(input: PlanVideoProjectInput): OnePromptVideoPlan {
  const durationSeconds = clampInt(input.durationSeconds, 15, 45);
  const shotCount = clampInt(input.shotCount, 4, 8);
  const aspectRatio = normalizeAspectRatio(input.aspectRatio);
  const prompt = normalizeText(input.userPrompt, "制作一条高级感 30 秒短视频");
  const styleBible = styleFromPreset(input.stylePreset);
  const durations = distributeDurations(durationSeconds, shotCount);

  const normalizedInput = {
    ...input,
    userPrompt: prompt,
    aspectRatio,
    durationSeconds,
    shotCount,
    referenceImageUrls: input.referenceImageUrls ?? [],
  };

  return {
    title: deriveTitle(prompt, input.stylePreset),
    logline: `围绕“${prompt}”自动拆解为 ${shotCount} 个可审核镜头，先确认脚本和关键帧，再进入视频生成。`,
    durationSeconds,
    aspectRatio,
    styleBible,
    shots: durations.map((duration, index) => buildShot(normalizedInput, styleBible, index + 1, duration)),
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
    durationSeconds: clampInt(typeof input.durationSeconds === "number" ? input.durationSeconds : 30, 15, 45),
    shotCount: clampInt(typeof input.shotCount === "number" ? input.shotCount : 6, 4, 8),
    stylePreset: typeof input.stylePreset === "string" ? input.stylePreset.trim() : "",
    referenceImageUrls: normalizeReferenceImageUrls(input.referenceImageUrls),
  };
}
