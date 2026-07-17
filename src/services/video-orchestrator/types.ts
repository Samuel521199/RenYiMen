export type VideoAspectRatio = "9:16" | "16:9" | "1:1";

export interface VideoStyleBible {
  visualStyle: string;
  characterLock: string;
  productLock?: string;
  colorPalette: string;
  colorToneLock?: string;
  lightingToneLock?: string;
  negativePrompt: string;
  negativePromptZh?: string;
  negativePromptEn?: string;
}

export type VideoConsistencyAnchorType =
  | "person"
  | "product"
  | "prop"
  | "location"
  | "style"
  | "brand_visual"
  | "task_object"
  | "effect_state"
  | "vehicle"
  | "food"
  | "space_layout"
  | "custom";

export interface VideoConsistencyAnchor {
  id: string;
  type: VideoConsistencyAnchorType;
  displayNameZh?: string;
  displayNameEn?: string;
  mustStayConsistent: boolean;
  needsReferenceImage: boolean;
  referenceStrength?: "hard" | "medium" | "soft";
  descriptionZh?: string;
  descriptionEn?: string;
  visualLock?: {
    shape?: string;
    material?: string;
    color?: string;
    markings?: string;
    scale?: string;
    state?: string;
    forbiddenDrift?: string[];
  };
  appliesTo?: Array<"keyframes" | "segments" | "micro_shots">;
  userEditable?: boolean;
  imagePromptZh?: string;
  imagePromptEn?: string;
}

export interface VideoTimelineBlueprintSegment {
  segmentNo: number;
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
  beatRole?: "hook" | "setup" | "interaction" | "proof" | "payoff" | "ending" | "custom";
  purposeZh?: string;
  purposeEn?: string;
  splitReasonZh?: string;
  subtitleIntentZh?: string;
  audioIntentZh?: string;
  requiredAnchorIds?: string[];
  boundaryModeHint?: "continuous" | "hard_cut" | "dissolve" | "match_cut";
}

export interface VideoSubtitlePolicy {
  needed: boolean;
  reasonZh?: string;
  contentRole?: "none" | "brand_slogan" | "product_selling_points" | "voiceover_caption" | "dialogue_caption" | "emotional_copy" | "instructional_steps" | "custom";
  language?: string;
  styleZh?: string;
  timingStrategyZh?: string;
  placementZh?: string;
  maxCharsPerLine?: number;
  maxLines?: number;
  avoidRegionsZh?: string[];
  userEditable?: boolean;
}

export interface VideoPlanningManifest {
  projectIntent?: {
    videoType?: string;
    primaryGoalZh?: string;
    primaryGoalEn?: string;
    targetViewerZh?: string;
    targetViewerEn?: string;
    successCriteria?: string[];
  };
  storyStrategy?: {
    narrativeArcZh?: string;
    narrativeArcEn?: string;
    recommendedSegmentDensity?: "low" | "medium" | "high";
    subtitleStrategyZh?: string;
    audioStrategyZh?: string;
  };
  subtitlePolicy?: VideoSubtitlePolicy;
  timelineBlueprint: {
    segmentCount: number;
    totalDurationSeconds: number;
    segmentDurationMinSeconds: number;
    segmentDurationMaxSeconds: number;
    splitStrategyZh?: string;
    segments: VideoTimelineBlueprintSegment[];
  };
  consistencyManifest: {
    anchors: VideoConsistencyAnchor[];
  };
  globalStyle?: {
    visualStyle?: string;
    colorPalette?: string;
    colorToneLock?: string;
    lightingToneLock?: string;
    negativePrompt?: string;
  };
  risks?: Array<{
    type?: string;
    descriptionZh?: string;
    mitigationZh?: string;
  }>;
}

export interface VideoPromptDetailPlan {
  keyframePrompts?: Array<{
    keyframeNo: number;
    imagePromptZh?: string;
    imagePromptEn?: string;
    negativePromptZh?: string;
    negativePromptEn?: string;
  }>;
  segmentVideoPrompts?: Array<{
    segmentNo: number;
    videoPromptZh?: string;
    videoPromptEn?: string;
    negativePromptZh?: string;
    negativePromptEn?: string;
  }>;
  microShotImagePrompts?: Array<{
    segmentNo: number;
    microShotNo: number;
    imagePromptZh?: string;
    imagePromptEn?: string;
  }>;
  negativePromptGroups?: VideoNegativePromptGroups[];
  generationNotes?: string[];
}

export interface VideoPlanKeyframe {
  keyframeNo: number;
  frameId?: string;
  frameRole?: "video_start" | "segment_start" | "segment_end" | "shared_boundary" | "video_end" | "internal_reference";
  timeSeconds: number;
  purpose: string;
  purposeZh?: string;
  purposeEn?: string;
  scene: string;
  characterState: string;
  productState: string;
  frameDesign?: VideoFrameDesign;
  imagePrompt: string;
  imagePromptZh?: string;
  imagePromptEn?: string;
  negativePromptGroups?: VideoNegativePromptGroups;
  negativePrompt: string;
  negativePromptZh?: string;
  negativePromptEn?: string;
  usesConsistencyAnchors?: string[];
}

export type VideoConsistencyReferenceKind = "character" | "scene";

export interface VideoConsistencyReference {
  kind: VideoConsistencyReferenceKind;
  needed: boolean;
  keyframeNo: number;
  frameId?: string;
  purpose: string;
  purposeZh?: string;
  purposeEn?: string;
  scene: string;
  characterState: string;
  productState: string;
  imagePrompt: string;
  imagePromptZh?: string;
  imagePromptEn?: string;
  negativePromptGroups?: VideoNegativePromptGroups;
  negativePrompt: string;
  negativePromptZh?: string;
  negativePromptEn?: string;
}

export interface VideoFrameDesign {
  subject?: {
    identity?: string;
    appearance?: string;
    clothing?: string;
    staticPose?: string;
    facialExpression?: string;
  };
  productOrProp?: {
    appearance?: string;
    state?: string;
    position?: string;
  };
  environment?: {
    location?: string;
    timeOfDay?: string;
    weather?: string;
    backgroundElements?: string;
    environmentState?: string;
  };
  composition?: {
    shotSize?: string;
    cameraAngle?: string;
    subjectPosition?: string;
    propPosition?: string;
    foreground?: string;
    background?: string;
    aspectRatio?: VideoAspectRatio;
  };
  lighting?: {
    direction?: string;
    quality?: string;
    contrast?: string;
    colorTemperature?: string;
  };
  rendering?: {
    lens?: string;
    depthOfField?: string;
    visualStyle?: string;
    texture?: string;
  };
  spatialRelationships?: string[];
  continuityLocks?: string[];
}

export interface VideoNegativePromptGroups {
  textArtifacts?: string[];
  anatomyArtifacts?: string[];
  renderingArtifacts?: string[];
  contentExclusions?: string[];
}

export interface VideoTimedPrompt {
  timeSeconds: number;
  startSeconds?: number;
  endSeconds?: number;
  prompt: string;
  promptZh?: string;
  promptEn?: string;
}

export interface VideoMicroShot {
  microShotNo: number;
  localTimeSeconds: number;
  endSeconds?: number;
  absoluteTimeSeconds: number;
  purpose: string;
  purposeZh?: string;
  purposeEn?: string;
  scene: string;
  sceneZh?: string;
  sceneEn?: string;
  action: string;
  actionZh?: string;
  actionEn?: string;
  camera?: string;
  cameraZh?: string;
  cameraEn?: string;
  referenceType?: "text" | "image_prompt" | "mixed";
  imagePrompt?: string;
  imagePromptZh?: string;
  imagePromptEn?: string;
  imageUrl?: string;
  imageTaskId?: string;
  imageStatus?: "idle" | "pending" | "running" | "ready" | "failed";
  errorMessage?: string;
  usesConsistencyAnchors?: string[];
  prompt: string;
  promptZh?: string;
  promptEn?: string;
}

export interface VideoAudioPlan {
  mode: "ambient" | "voiceover" | "dialogue" | "mixed" | "silent";
  needsVoiceover: boolean;
  needsDialogue: boolean;
  language?: string;
  speaker?: string;
  voiceStyle?: string;
  lines?: string[];
  linesZh?: string[];
  linesEn?: string[];
  rationale?: string;
}

export interface VideoPlanSegment {
  segmentNo: number;
  startKeyframeNo: number;
  endKeyframeNo: number;
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
  boundaryMode?: "continuous" | "hard_cut" | "dissolve" | "match_cut";
  purpose: string;
  purposeZh?: string;
  purposeEn?: string;
  motion: string;
  camera: string;
  subjectMotion: string;
  environmentMotion: string;
  videoPrompt: string;
  videoPromptZh?: string;
  videoPromptEn?: string;
  subtitle: string;
  outputMode?: "text" | "image" | "mixed";
  constraints?: string[];
  timedPrompts?: VideoTimedPrompt[];
  microShots?: VideoMicroShot[];
  audioPlan?: VideoAudioPlan;
  negativePrompt: string;
  negativePromptZh?: string;
  negativePromptEn?: string;
  usesConsistencyAnchors?: string[];
}

export interface VideoPlanShot {
  shotNo: number;
  durationSeconds: number;
  boundaryMode?: "continuous" | "hard_cut" | "dissolve" | "match_cut";
  purpose: string;
  purposeZh?: string;
  purposeEn?: string;
  camera: string;
  action: string;
  imagePrompt: string;
  imagePromptZh?: string;
  imagePromptEn?: string;
  videoPrompt: string;
  videoPromptZh?: string;
  videoPromptEn?: string;
  outputMode?: "text" | "image" | "mixed";
  constraints?: string[];
  timedPrompts?: VideoTimedPrompt[];
  microShots?: VideoMicroShot[];
  audioPlan?: VideoAudioPlan;
  subtitle: string;
  negativePrompt: string;
  negativePromptZh?: string;
  negativePromptEn?: string;
  usesConsistencyAnchors?: string[];
}

export interface OnePromptVideoPlan {
  title: string;
  logline: string;
  durationSeconds: number;
  aspectRatio: VideoAspectRatio;
  keyframeCount: number;
  segmentCount: number;
  styleBible: VideoStyleBible;
  planningManifest?: VideoPlanningManifest;
  consistencyManifest?: VideoPlanningManifest["consistencyManifest"];
  timelineBlueprint?: VideoPlanningManifest["timelineBlueprint"];
  storyboardPlan?: unknown;
  promptDetailPlan?: VideoPromptDetailPlan;
  consistencyReferences?: VideoConsistencyReference[];
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
  /** Optional fallback segment count only. The storyboard model chooses the final count. */
  shotCount?: number;
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
  microShots?: VideoMicroShot[];
  audioPlan?: VideoAudioPlan;
  locked?: boolean;
}
