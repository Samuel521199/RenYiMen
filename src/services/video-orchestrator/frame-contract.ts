import type { OnePromptVideoPlan, VideoPlanKeyframe } from "./types";

export function frameContractContainsMotionProcess(value: unknown): boolean {
  return /\b(moving|walking|running|turning|transitioning|from .+ to|while|during)\b|正在|走向|跑向|转身过程|从.+到.+过程|运动过程|移动过程/i.test(flatText(value));
}

/**
 * Endpoint contracts describe a still state. When a model accidentally writes a
 * transition into one, rebuild that endpoint from its already-normalized boundary
 * keyframe. The strict validator still runs afterwards and rejects the plan if the
 * boundary keyframe itself is not static.
 */
export function repairMotionfulEndpointContracts(plan: OnePromptVideoPlan): OnePromptVideoPlan {
  if (!plan.segmentRenderDescriptions?.length) return plan;

  const keyframes = new Map(plan.keyframes.map((keyframe) => [keyframe.keyframeNo, keyframe]));
  const segments = new Map(plan.segments.map((segment) => [segment.segmentNo, segment]));
  const repaired: string[] = [];
  const segmentRenderDescriptions = plan.segmentRenderDescriptions.map((description) => {
    const segment = segments.get(description.segmentNo);
    if (!segment) return description;

    const startKeyframe = keyframes.get(segment.startKeyframeNo);
    const endKeyframe = keyframes.get(segment.endKeyframeNo);
    const repairStart = Boolean(
      startKeyframe
      && description.startFrameContract
      && frameContractContainsMotionProcess(description.startFrameContract),
    );
    const repairEnd = Boolean(
      endKeyframe
      && description.endFrameContract
      && frameContractContainsMotionProcess(description.endFrameContract),
    );
    if (!repairStart && !repairEnd) return description;

    if (repairStart) repaired.push(`segment ${description.segmentNo} start frame -> KF${segment.startKeyframeNo}`);
    if (repairEnd) repaired.push(`segment ${description.segmentNo} end frame -> KF${segment.endKeyframeNo}`);
    return {
      ...description,
      startFrameContract: repairStart ? staticContractFromKeyframe(startKeyframe!) : description.startFrameContract,
      endFrameContract: repairEnd ? staticContractFromKeyframe(endKeyframe!) : description.endFrameContract,
    };
  });

  if (!repaired.length) return plan;
  return {
    ...plan,
    segmentRenderDescriptions,
    plannerWarnings: [
      ...(plan.plannerWarnings ?? []),
      `已用边界关键帧修正动态端帧合同：${repaired.join("；")}`,
    ],
  };
}

function staticContractFromKeyframe(keyframe: VideoPlanKeyframe): Record<string, unknown> {
  return {
    keyframeNo: keyframe.keyframeNo,
    timeSeconds: keyframe.timeSeconds,
    sceneState: staticizeEndpointText(keyframe.scene),
    characterState: staticizeEndpointText(keyframe.characterState),
    productState: staticizeEndpointText(keyframe.productState),
    usesConsistencyAnchors: keyframe.usesConsistencyAnchors ?? [],
    staticStateOnly: true,
  };
}

const NON_STANDARD_SYMBOL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\uFFFD]/g;

/** Strip replacement chars / control glyphs that image models render as broken HUD text. */
export function stripNonStandardPromptSymbols(value: string): string {
  return value.replace(NON_STANDARD_SYMBOL_PATTERN, "").replace(/\s+/g, " ").trim();
}

/**
 * Normalize timer/score HUD wording for game ads so generations use clean Arabic numerals
 * and guofeng-friendly UI framing instead of garbled or decorative symbols.
 */
export interface SanitizeGameVisualPromptOptions {
  /** Logo/brand/UI lock assets intentionally contain readable text; skip generic HUD anti-text rules. */
  brandVisual?: boolean;
}

export function sanitizeGameVisualPromptText(
  value: string,
  stylePreset?: string,
  options?: SanitizeGameVisualPromptOptions,
): string {
  let text = stripNonStandardPromptSymbols(value);
  if (!text) return text;

  text = text
    .replace(/(?:开始)?倒计时[:：]?\s*[\d:：.]+/gi, "倒计时显示为标准 MM:SS 阿拉伯数字（例如 00:30）")
    .replace(/\b(?:countdown|timer)\b[:：]?\s*[\d:：.]+/gi, "countdown timer in clean MM:SS Arabic numerals (for example 00:30)")
    .replace(/(?:得分|分数|比分)[:：]?\s*[\d,，.]+/g, "分数显示为标准阿拉伯数字计分板（例如 1280）")
    .replace(/\b(?:score|points)\b[:：]?\s*[\d,，.]+/gi, "score display with clean Arabic numerals (for example 1280)")
    .replace(/[★☆◆◇●○■□▲△▼▽♠♣♥♦]/g, "");

  if (options?.brandVisual) {
    return text.trim();
  }

  if (stylePreset === "guofeng") {
    text = `${text} 游戏 UI 采用国风质感：玉色/金色细框、简洁无衬线阿拉伯数字、禁止乱码符号与装饰性伪文字。`;
  } else if (/\b(game|score|timer|countdown|倒计时|分数|计分)\b/i.test(text)) {
    text = `${text} Game HUD uses clean sans-serif Arabic numerals only; no gibberish glyphs, corrupted letters, or decorative pseudo-text.`;
  }

  return text.trim();
}

export function staticizeEndpointText(value: string): string {
  return sanitizeGameVisualPromptText(
    value
    .replace(/从([^，。；]+?)到([^，。；]+?)(?:的)?过程/g, "$2的静态状态")
    .replace(/正在操作([^，。；]*)/g, "保持操作$1的姿势")
    .replace(/开始移动/g, "呈现启动后的布局")
    .replace(/开始倒计时/g, "显示标准 MM:SS 格式倒计时数值")
    .replace(/正在/g, "处于")
    .replace(/走向/g, "面向")
    .replace(/跑向/g, "面向")
    .replace(/转身过程/g, "转身后的姿态")
    .replace(/运动过程|移动过程/g, "运动后的静态状态")
    .replace(/\btransitioning\s+from\s+(.+?)\s+to\s+(.+?)(?=[,.;]|$)/gi, "in the resulting $2 state")
    .replace(/\bfrom\s+(.+?)\s+to\s+(.+?)(?=[,.;]|$)/gi, "in the final $2 state")
    .replace(/\bmoving\b/gi, "stationary")
    .replace(/\bwalking\b|\brunning\b/gi, "standing")
    .replace(/\bturning\b/gi, "facing the target direction")
    .replace(/\bwhile\b/gi, "with")
    .replace(/\bduring\b/gi, "at")
    .trim(),
  );
}

function flatText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flatText).join(" ");
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).map(flatText).join(" ");
  return "";
}
