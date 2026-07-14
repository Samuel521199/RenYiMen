export type VideoAspectRatio = "9:16" | "16:9" | "1:1";

export interface VideoStyleBible {
  visualStyle: string;
  characterLock: string;
  productLock?: string;
  colorPalette: string;
  negativePrompt: string;
}

export interface VideoPlanKeyframe {
  keyframeNo: number;
  timeSeconds: number;
  purpose: string;
  scene: string;
  characterState: string;
  productState: string;
  imagePrompt: string;
  imagePromptZh?: string;
  imagePromptEn?: string;
  negativePrompt: string;
}

export interface VideoPlanSegment {
  segmentNo: number;
  startKeyframeNo: number;
  endKeyframeNo: number;
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
  purpose: string;
  motion: string;
  camera: string;
  subjectMotion: string;
  environmentMotion: string;
  videoPrompt: string;
  videoPromptZh?: string;
  videoPromptEn?: string;
  subtitle: string;
  negativePrompt: string;
}

export interface VideoPlanShot {
  shotNo: number;
  durationSeconds: number;
  purpose: string;
  camera: string;
  action: string;
  imagePrompt: string;
  imagePromptZh?: string;
  imagePromptEn?: string;
  videoPrompt: string;
  videoPromptZh?: string;
  videoPromptEn?: string;
  subtitle: string;
  negativePrompt: string;
}

export interface OnePromptVideoPlan {
  title: string;
  logline: string;
  durationSeconds: number;
  aspectRatio: VideoAspectRatio;
  keyframeCount: number;
  segmentCount: number;
  styleBible: VideoStyleBible;
  keyframes: VideoPlanKeyframe[];
  segments: VideoPlanSegment[];
  /**
   * Compatibility view for older UI/API code. New logic should use
   * keyframes + segments.
   */
  shots: VideoPlanShot[];
}

export interface CreateVideoProjectInput {
  userPrompt: string;
  aspectRatio?: VideoAspectRatio;
  durationSeconds?: number;
  shotCount?: number;
  stylePreset?: string;
  referenceImageUrls?: string[];
}

export interface PlanVideoProjectInput {
  userPrompt: string;
  aspectRatio: VideoAspectRatio;
  durationSeconds: number;
  /** Segment count for the 30s keyframe workflow. Defaults to 6. */
  shotCount: number;
  stylePreset?: string;
  referenceImageUrls: string[];
}

export interface UpdateShotInput {
  locale?: "zh" | "en";
  purpose?: string;
  camera?: string;
  action?: string;
  imagePrompt?: string;
  videoPrompt?: string;
  negativePrompt?: string;
  subtitle?: string;
  durationSeconds?: number;
  locked?: boolean;
}
