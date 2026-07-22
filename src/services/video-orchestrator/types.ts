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

export type VideoAssetCategory =
  | "person"
  | "scene"
  | "product"
  | "prop"
  | "brand_visual"
  | "style"
  | "custom";

export type VideoAssetView =
  | "front"
  | "side"
  | "back"
  | "face_closeup"
  | "overview"
  | "single";

export interface VideoAssetLibraryItem {
  assetId: string;
  category: VideoAssetCategory;
  view: VideoAssetView;
  keyframeNo: number;
  anchorId?: string;
  displayNameZh?: string;
  displayNameEn?: string;
  descriptionZh?: string;
  descriptionEn?: string;
  required: boolean;
  sourceView?: "front";
  sourceArtifactId?: string;
  orientation?: "front" | "side" | "back" | "unknown";
  viewGenerationMode?: "primary" | "derived_from_front";
}

export interface VideoAssetLibrary {
  items: VideoAssetLibraryItem[];
}

export interface VideoConsistencyReference {
  kind: VideoConsistencyReferenceKind;
  needed: boolean;
  keyframeNo: number;
  anchorId?: string;
  frameId?: string;
  assetId?: string;
  assetCategory?: VideoAssetCategory;
  assetView?: VideoAssetView;
  sourceView?: "front";
  sourceArtifactId?: string;
  orientation?: "front" | "side" | "back" | "unknown";
  viewGenerationMode?: "primary" | "derived_from_front";
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
  linkedBeatIds?: string[];
  storyFunction?: VideoStoryFunction;
  emotionalBeat?: string;
  emotionalBeatZh?: string;
  emotionalBeatEn?: string;
  cause?: string;
  effect?: string;
  informationUnit?: string;
  keyEvidenceIds?: string[];
  actionContinuity?: VideoStoryTraceFields["actionContinuity"];
  reactionBeat?: string;
  powerShift?: string;
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
  linkedBeatIds?: string[];
  storyFunction?: VideoStoryFunction;
  emotionalBeat?: string;
  emotionalBeatZh?: string;
  emotionalBeatEn?: string;
  cause?: string;
  effect?: string;
  informationUnit?: string;
  keyEvidenceIds?: string[];
  actionContinuity?: VideoStoryTraceFields["actionContinuity"];
  reactionBeat?: string;
  powerShift?: string;
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

export type VideoCreativeCategory =
  | "game"
  | "product"
  | "ecommerce"
  | "food"
  | "auto"
  | "short_drama"
  | "brand"
  | "tutorial"
  | "custom";

export type VideoCreativeTemplateId =
  | "game_reversal"
  | "game_bonus_payoff"
  | "product_problem_solution"
  | "ecommerce_offer_conversion"
  | "food_sensory_reaction"
  | "auto_performance_hero"
  | "short_drama_conflict_twist"
  | "generic_brand_story";

export interface VideoCreativeStrategy {
  videoType?: "game_ad" | "product_ad" | "ecommerce_ad" | "food_ad" | "short_drama" | "brand_film" | "tutorial" | "custom";
  videoCategory?: VideoCreativeCategory;
  templateId?: VideoCreativeTemplateId;
  templateReason?: string;
  templateReasonZh?: string;
  conversionGoal?: string;
  conversionGoalZh?: string;
  fallbackReason?: string;
  fallbackReasonZh?: string;
  audience?: string;
  audienceZh?: string;
  audienceEn?: string;
  corePromise?: string;
  corePromiseZh?: string;
  corePromiseEn?: string;
  hook?: string;
  hookZh?: string;
  hookEn?: string;
  conflict?: string;
  conflictZh?: string;
  conflictEn?: string;
  turningPoint?: string;
  turningPointZh?: string;
  turningPointEn?: string;
  payoff?: string;
  payoffZh?: string;
  payoffEn?: string;
  cta?: string;
  ctaZh?: string;
  ctaEn?: string;
  emotionalArc?: string[];
  sellingPointIds?: string[];
  referenceUsageStrategy?: string;
  referenceUsageStrategyZh?: string;
  risks?: string[];
  notes?: string[];
}

export type VideoStoryFunction =
  | "hook"
  | "setup"
  | "conflict"
  | "escalation"
  | "turning_point"
  | "proof"
  | "payoff"
  | "reaction"
  | "cta"
  | "cliffhanger"
  | "ending"
  | "transition"
  | "custom";

export interface VideoStoryTraceFields {
  linkedBeatIds?: string[];
  storyFunction?: VideoStoryFunction;
  emotionalBeat?: string;
  emotionalBeatZh?: string;
  emotionalBeatEn?: string;
  cause?: string;
  effect?: string;
  informationUnit?: string;
  keyEvidenceIds?: string[];
  actionContinuity?: {
    motivationOrPreparation?: string;
    execution?: string;
    resultOrReaction?: string;
  };
  reactionBeat?: string;
  powerShift?: string;
}

export interface VideoStoryBeat {
  beatId: string;
  order: number;
  title?: string;
  titleZh?: string;
  titleEn?: string;
  storyFunction: VideoStoryFunction;
  emotionalBeat?: string;
  emotionalBeatZh?: string;
  emotionalBeatEn?: string;
  cause?: string;
  effect?: string;
  informationUnit?: string;
  keyEvidenceIds?: string[];
  requiredAnchorIds?: string[];
  sourceEventIds?: string[];
  targetSegmentNos?: number[];
  mustBeVisibleBeforeBeatIds?: string[];
  actionContinuity?: {
    motivationOrPreparation?: string;
    execution?: string;
    resultOrReaction?: string;
  };
  reactionBeat?: string;
  powerShift?: string;
  notes?: string[];
}

export interface VideoNarrativeMicroRules {
  causalChainRequired?: boolean;
  forbidSuddenOutcome?: boolean;
  forbidReferenceOnlyAnimation?: boolean;
  requireHookBeforeAssetShowcase?: boolean;
  requirePayoffBeforeCta?: boolean;
  requireReactionAfterTurningPoint?: boolean;
  requireVisibleTriggerBeforeStateChange?: boolean;
  requiredBeatFunctions?: VideoStoryFunction[];
  forbiddenPatterns?: string[];
  continuityRules?: string[];
  ctaRules?: string[];
  notes?: string[];
}

export interface VideoShotGroupingPass {
  strategy?: string;
  strategyZh?: string;
  sourceBeatIds?: string[];
  groups?: Array<{
    groupId: string;
    beatIds: string[];
    segmentNos: number[];
    storyFunction?: VideoStoryFunction;
    reason?: string;
    reasonZh?: string;
    continuousTakeRisk?: "low" | "medium" | "high";
    splitRequired?: boolean;
  }>;
  splitReasons?: Array<{
    afterSegmentNo: number;
    beforeSegmentNo: number;
    reasonCode:
      | "space_change"
      | "time_jump"
      | "new_conflict_relation"
      | "payoff_state_change"
      | "cta_enter"
      | "duration_limit"
      | "camera_mismatch"
      | "narrative_focus_change"
      | "model_continuity_risk";
    reasonZh?: string;
    mergeRejected?: boolean;
  }>;
  warnings?: string[];
}

export interface VideoStoryQualityReport {
  passed?: boolean;
  score?: number;
  hookScore?: number;
  causalityScore?: number;
  payoffScore?: number;
  ctaScore?: number;
  continuityScore?: number;
  riskScores?: Record<string, number>;
  issueCodes?: string[];
  issues?: Array<{
    code: string;
    severity: "warning" | "error";
    beatId?: string;
    segmentNo?: number;
    messageZh?: string;
    recommendationZh?: string;
  }>;
  rewriteRequired?: boolean;
  autoRewriteAttempts?: number;
  rewriteReasons?: string[];
  rewriteFromStage?: "creative_strategy" | "beat_sheet" | "storyboard" | "shot_grouping" | "none";
  summaryZh?: string;
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
  linkedBeatIds?: string[];
  storyFunction?: VideoStoryFunction;
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
  parentCameraId?: string;
  parentSegmentNo?: number;
  axisDescription?: string;
  framingRange?: string;
  movementStyle?: string;
  spatialLayoutLock?: string;
  relationToParent?: CameraRelation;
  missingInfo?: string[];
  inheritanceReasonZh?: string;
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

export interface PlanValidationIssue {
  code: string;
  severity: "warning" | "error";
  artifactId?: string;
  messageZh: string;
  retryFromStage?: string;
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

export interface TransitionReferenceFrameCandidate {
  id: string;
  url: string;
  timestampFraction: number;
  compositeScore: number;
  passed: boolean;
  selected?: boolean;
  qualityReport: GenerationQualityReport;
}

export interface TransitionReferenceArtifact {
  id: string;
  fromCameraId?: string;
  toCameraId: string;
  fromSegmentNo?: number;
  toSegmentNo: number;
  relation: CameraRelation;
  mode: "short" | "full";
  inheritanceScope: string[];
  reasonZh: string;
  status: "planned" | "waiting_parent" | "video_running" | "evaluating_frames" | "ready_for_review" | "approved" | "failed";
  parentKeyframeNo?: number;
  parentKeyframeUrl?: string;
  videoTaskId?: string;
  videoUrl?: string;
  frameCandidates?: TransitionReferenceFrameCandidate[];
  selectedFrameUrl?: string;
  locked?: boolean;
  errorMessage?: string;
  updatedAt: string;
}

export interface GeneratedBridgeArtifact {
  id: string;
  fromSegmentNo: number;
  toSegmentNo: number;
  status: "planned" | "running" | "ready_for_review" | "approved" | "failed";
  prompt?: string;
  durationSeconds: number;
  selectedVideoUrl?: string;
  locked?: boolean;
  errorMessage?: string;
  updatedAt: string;
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
  anchorId?: string;
  assetView?: VideoAssetView;
  hardRequired?: boolean;
  conflictReasons?: string[];
  detectedOrientation?: "front" | "side" | "back" | "unknown";
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
  targetOrientation?: "front" | "side" | "back" | "unknown";
  selectedView?: VideoAssetView;
  orientationFallbackReason?: string;
  selectionPolicyVersion?: string;
  warnings?: string[];
}

export interface ArtifactMetadata {
  artifactId: string;
  artifactType: string;
  producedByStage: string;
  revision: number;
  schemaVersion: string;
  plannerVersion: string;
  promptVersion: string;
  modelVersion: string;
  inputHash: string;
  dependsOn: string[];
  invalidatedByArtifactIds?: string[];
  parentRevisionIds?: string[];
  userAccepted?: boolean;
  status: "draft" | "dirty" | "approved" | "generating" | "ready" | "failed";
  dirtyReason?: string;
  retryFromStage?: "stage1" | "stage2a" | "stage2b" | "stage3" | "reference_selector" | "compiler" | "generation" | "composition" | "manual";
  updatedAt?: string;
}

export type VideoMediaRevisionKind = "keyframe_image" | "micro_shot_image" | "segment_clip" | "transition_reference" | "generated_bridge" | "final_video";

export interface VideoMediaRevision {
  id: string;
  kind: VideoMediaRevisionKind;
  targetId: string;
  url: string;
  createdAt: string;
  segmentNo?: number;
  microShotNo?: number;
}

export interface RollbackVideoMediaInput {
  kind: VideoMediaRevisionKind;
  targetId: string;
  microShotNo?: number;
}

export interface GenerationQualityReport {
  assetId: string;
  candidateId?: string;
  candidateNo?: number;
  mediaUrl?: string;
  identityScore: number;
  layoutScore: number;
  promptAlignmentScore: number;
  continuityScore: number;
  singleTakeScore?: number;
  artifactIssues: string[];
  passed: boolean;
  retryInstruction?: string;
  endFrameSimilarityScore?: number;
  endFrameDecision?: "pass" | "retry_generation" | "return_stage_2b" | "evaluation_failed";
  endFrameReasons?: string[];
  continuityRetryCount?: number;
  contentBased?: boolean;
  productInstanceCount?: number;
  personInstanceCount?: number;
  wrongTextDetected?: boolean;
  firstFrameConsistencyScore?: number;
  checkpointOrderScore?: number;
  metadataIssues?: string[];
  userAccepted?: boolean;
  originalPassed?: boolean;
  retryFromStage?: "stage2b" | "stage3" | "generation" | "manual";
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
  creativeStrategy?: VideoCreativeStrategy;
  storyBeats?: VideoStoryBeat[];
  narrativeMicroRules?: VideoNarrativeMicroRules;
  shotGroupingPass?: VideoShotGroupingPass;
  storyQualityReport?: VideoStoryQualityReport;
  anchorStateTimeline?: AnchorStateTimeline[];
  audioBible?: Record<string, unknown>;
  assetLibrary?: VideoAssetLibrary;
  candidateTimeline?: VideoTimelineBlueprintSegment[];
  storyboardBrief?: StoryboardBrief[];
  segmentRenderDescriptions?: SegmentRenderDescription[];
  cameraGraph?: CameraGraph;
  transitionReferencePlan?: unknown[];
  transitionReferenceArtifacts?: TransitionReferenceArtifact[];
  finalTransitionPlan?: FinalTransitionPlan[];
  generatedBridgeArtifacts?: GeneratedBridgeArtifact[];
  referenceSelectionOutputs?: ReferenceSelectionOutput[];
  promptDebugArtifacts?: Record<string, PromptDebugArtifact>;
  artifactMetadata?: Record<string, ArtifactMetadata>;
  mediaRevisionHistory?: Record<string, VideoMediaRevision[]>;
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
