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
  sourceEventIds?: string[];
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

export type VideoConsistencyReferenceKind =
  | "character"
  | "scene"
  | "product"
  | "brand_visual"
  | "prop"
  | "vehicle"
  | "food"
  | "space_layout"
  | "custom";

export interface VideoConsistencyReference {
  kind: VideoConsistencyReferenceKind;
  needed: boolean;
  keyframeNo: number;
  anchorId?: string;
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

export interface NarrativeEvent {
  eventId: string;
  dramaticGoal: string;
  participants: string[];
  locationId: string;
  initialState: string;
  action: string;
  resultingState: string;
  requiredAnchorIds: string[];
  previousEventIds: string[];
  mustBecomeSeparateSegment: boolean;
}

export interface AnchorStateTimelineEntry {
  eventId?: string;
  segmentNo: number;
  startState: string;
  endState: string;
  startPosition: string;
  endPosition: string;
  holderAtStart?: string;
  holderAtEnd?: string;
  visibleTransitionPath: string;
}

export interface AnchorStateTimeline {
  anchorId: string;
  states: AnchorStateTimelineEntry[];
}

export interface StoryboardBrief {
  segmentNo: number;
  eventIds: string[];
  sourceEventIds?: string[];
  narrativeFunction: string;
  cameraId: string;
  locationId: string;
  visualDescZh?: string;
  visualDescEn?: string;
  beatRole?: VideoTimelineBlueprintSegment["beatRole"];
  requiredAnchorIds?: string[];
  separationReason?: string;
  visibleAnchorIds: string[];
  purposeZh?: string;
  purposeEn?: string;
}

export interface SegmentRenderDescription {
  segmentNo: number;
  startFrameContract?: Record<string, unknown>;
  endFrameContract?: Record<string, unknown>;
  motionContract?: Record<string, unknown>;
  singleTakeContract?: Record<string, unknown>;
  motionCheckpoints?: VideoMicroShot[];
  visibleAnchorIds: string[];
  requiresCut?: boolean;
  riskLevel?: "low" | "medium" | "high";
  timelineChangeRequest?: Record<string, unknown>;
  recommendedSplit?: unknown[];
  warnings?: string[];
}

export type CameraRelation =
  | "same_camera_setup"
  | "same_axis"
  | "derived_reframe"
  | "same_spatial_context"
  | "same_subject_group"
  | "alternate_view"
  | "new_camera_setup";

export interface CameraGraphNode {
  cameraId: string;
  segmentNos: number[];
  locationId?: string;
  description?: string;
}

export interface CameraGraphEdge {
  fromCameraId: string;
  toCameraId: string;
  relation: CameraRelation;
  reason?: string;
}

export interface CameraGraph {
  cameras: CameraGraphNode[];
  relations: CameraGraphEdge[];
}

export interface FinalTransitionPlan {
  fromSegmentNo: number;
  toSegmentNo: number;
  visualMode: "hard_cut" | "match_cut" | "dissolve" | "fade_to_black" | "generated_bridge";
  audioMode: "none" | "j_cut" | "l_cut" | "crossfade";
  overlapSeconds: number;
  matchAnchorId?: string;
  generatedBridgeRequired: boolean;
}

export interface ReferenceSelectionCandidate {
  artifactId: string;
  url?: string;
  sourceType?: "hard_anchor" | "user_upload" | "recent_keyframe" | "parent_camera" | "transition_reference" | "style_brand" | "custom";
  quotaType?: "character" | "product" | "space_layout" | "style_brand";
  purpose: string;
  relevanceScore: number;
  conflictScore: number;
  recencyScore: number;
  viewMatchScore: number;
  finalScore?: number;
  selected: boolean;
  rejectionReason?: string;
  usageNote?: string;
}

export interface ReferenceSelectionOutput {
  targetArtifactId: string;
  targetType: "keyframe" | "segment" | "micro_shot" | "consistency_reference" | "custom";
  selectedArtifactIds: string[];
  selectedReferenceUrls?: string[];
  candidates: ReferenceSelectionCandidate[];
  usageNotes?: string[];
  finalTextPrompt?: string;
  warnings?: string[];
}

export interface ArtifactMetadata {
  revision: number;
  schemaVersion: string;
  plannerVersion: string;
  promptVersion: string;
  modelVersion: string;
  inputHash: string;
  dependsOn: string[];
  status: "draft" | "dirty" | "approved" | "generating" | "ready" | "failed";
  dirtyReason?: string;
  retryFromStage?: "stage1" | "stage2a" | "stage2b" | "stage3" | "reference_selector" | "compiler" | "generation" | "composition" | "manual";
  updatedAt?: string;
}

export interface GenerationQualityReport {
  assetId: string;
  identityScore: number;
  layoutScore: number;
  promptAlignmentScore: number;
  continuityScore: number;
  singleTakeScore?: number;
  artifactIssues: string[];
  passed: boolean;
  retryInstruction?: string;
}

export interface PromptDebugArtifact {
  targetArtifactId: string;
  targetType: "keyframe" | "segment" | "micro_shot" | "consistency_reference" | "custom";
  compilerVersion: string;
  inputs: Record<string, unknown>;
  selectedReferenceUrls?: string[];
  referenceUsageNotes?: string[];
  beforePrompt?: string;
  finalPrompt: string;
  finalNegativePrompt?: string;
  rules: string[];
  warnings?: string[];
  createdAt: string;
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
  narrativeEvents?: NarrativeEvent[];
  anchorStateTimeline?: AnchorStateTimeline[];
  audioBible?: Record<string, unknown>;
  candidateTimeline?: VideoTimelineBlueprintSegment[];
  storyboardBrief?: StoryboardBrief[];
  segmentRenderDescriptions?: SegmentRenderDescription[];
  cameraGraph?: CameraGraph;
  transitionReferencePlan?: unknown[];
  finalTransitionPlan?: FinalTransitionPlan[];
  referenceSelectionOutputs?: ReferenceSelectionOutput[];
  promptDebugArtifacts?: Record<string, PromptDebugArtifact>;
  artifactMetadata?: Record<string, ArtifactMetadata>;
  generationQualityReports?: GenerationQualityReport[];
  plannerShadow?: Record<string, unknown>;
  plannerWarnings?: string[];
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
