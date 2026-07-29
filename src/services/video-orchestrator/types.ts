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
  | "palette_mood"
  | "graphic_backdrop"
  | "custom";

export interface VideoAssetImageContract {
  subjectCount?: number;
  subjectDescription?: string;
  composition?: {
    framing?: string;
    cameraAngle?: string;
    placement?: string;
    occupancy?: string;
  };
  environment?: {
    background?: string;
    foreground?: string;
    midground?: string;
    backgroundLayer?: string;
    spatialRelationships?: string[];
  };
  lighting?: {
    direction?: string;
    quality?: string;
    colorTemperature?: string;
  };
  renderingStyle?: {
    /** Concrete rendering medium such as stylized 3D CGI or flat vector illustration. */
    medium?: string;
    dimensionality?: "2d" | "2.5d" | "3d" | "mixed";
    shading?: string;
    edgeTreatment?: string;
    surfaceTreatment?: string;
    depthTreatment?: string;
    /** The strongest source that established this style contract. */
    authority?: "user_reference" | "global_style" | "planner";
    forbiddenDrift?: string[];
  };
  palette?: string[];
  materialDetails?: string[];
  intrinsicDetails?: string[];
  forbiddenElements?: string[];
  acceptanceCriteria?: string[];
  playingCards?: VideoPlayingCardContract;
}

export type VideoPlayingCardSuit = "spades" | "hearts" | "clubs" | "diamonds";
export type VideoPlayingCardRank = "A" | "K" | "Q" | "J" | "10" | "9" | "8" | "7" | "6" | "5" | "4" | "3" | "2";
export type VideoPlayingCardContractAuthority =
  | "user_edit"
  | "user_requirement"
  | "reference_fact"
  | "asset_contract"
  | "category_default";

export interface VideoPlayingCardContract {
  cards: Array<{
    rank: VideoPlayingCardRank;
    suit: VideoPlayingCardSuit;
    position: "left" | "right" | "center" | `index_${number}`;
  }>;
  face: "face_up" | "face_down";
  overlap: {
    mode: "none" | "percentage";
    percentage: number;
  };
  cameraAngle: "top_down_orthographic" | "top_down_perspective" | "front" | "low_angle";
  background: string;
  allowedMarkings: string[];
  fieldAuthority?: Partial<Record<
    "cards" | "face" | "overlap" | "cameraAngle" | "background" | "allowedMarkings",
    VideoPlayingCardContractAuthority
  >>;
}

export interface VideoConsistencyAnchor {
  id: string;
  type: VideoConsistencyAnchorType;
  displayNameZh?: string;
  displayNameEn?: string;
  mustStayConsistent: boolean;
  needsReferenceImage: boolean;
  referenceStrength?: "hard" | "medium" | "soft";
  semanticRole?: "identity" | "palette_mood" | "rendering_style" | "graphic_backdrop" | "physical_scene";
  referenceUsage?: {
    role?: "hard_identity" | "scene_layout" | "style_only" | "palette_only" | "graphic_backdrop";
    inherit?: string[];
    forbidInherit?: string[];
  };
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
  assetImageContract?: VideoAssetImageContract;
  /** Model-provided evidence; admission code treats this as input, not authority. */
  sourceEvidence?: Array<{
    source: "user_requirement" | "reference_fact" | "narrative_event" | "planner";
    text: string;
    eventIds?: string[];
  }>;
  candidateCategory?: "core_subject" | "brand" | "scene" | "prop" | "decoration" | "style" | "custom";
  suggestedAsAnchor?: boolean;
  candidateReason?: string;
  /** The following fields are recomputed by the deterministic admission pass. */
  usedByEventIds?: string[];
  reuseCount?: number;
  lockDimensions?: string[];
  admissionReason?: string;
  admissionRule?: string;
  admissionScore?: number;
  status?: "candidate" | "approved" | "event_local" | "discarded";
}

export interface VideoTimelineBlueprintSegment {
  segmentNo: number;
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
  durationReasonZh?: string;
  minimumExecutableSeconds?: number;
  preferredDurationSeconds?: number;
  maximumUsefulSeconds?: number;
  timingBudget?: {
    setupSeconds: number;
    actionSeconds: number;
    resultSeconds: number;
  };
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

export interface VideoAssetContractExclusion {
  anchorId: string;
  reason: string;
  visibility?: string;
  valid: boolean;
}

export interface VideoAssetContractTarget {
  targetType: "beat" | "segment" | "keyframe" | "micro_shot";
  targetId: string;
  segmentNo?: number;
  keyframeNo?: number;
  microShotNo?: number;
  declaredAnchorIds: string[];
  derivedAnchorIds: string[];
  effectiveRequiredAnchorIds: string[];
  excludedAnchors: VideoAssetContractExclusion[];
  expectedVisibleEntities: string[];
  derivationReasons: string[];
}

export interface VideoAssetContract {
  version: "asset-contract-v1";
  beatTargets: VideoAssetContractTarget[];
  segmentTargets: VideoAssetContractTarget[];
  boundaryTargets: VideoAssetContractTarget[];
  microShotTargets?: VideoAssetContractTarget[];
  referenceFactFingerprint?: string;
  issues: Array<{
    code: "UNJUSTIFIED_ANCHOR_EXCLUSION" | "REQUIRED_ANCHOR_COVERAGE_MISSING" | "ANCHOR_VISIBILITY_CONFLICT";
    targetId: string;
    anchorId?: string;
    messageZh: string;
  }>;
}

export interface VideoAssetDependencyFields {
  declaredAnchorIds?: string[];
  derivedAnchorIds?: string[];
  effectiveRequiredAnchorIds?: string[];
  excludedAnchors?: VideoAssetContractExclusion[];
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
    eventLocalElements?: Array<{
      id: string;
      sourceAnchorId: string;
      eventId: string;
      description: string;
      reason: string;
    }>;
    admissionDecisions?: Array<{
      anchorId: string;
      status: "approved" | "event_local" | "discarded";
      rule: string;
      score: number;
      reason: string;
      usedByEventIds: string[];
    }>;
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

export interface VideoPlanKeyframe extends VideoAssetDependencyFields {
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
  imagePromptEditContract?: ImagePromptEditContract;
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
  | "palette_mood"
  | "graphic_backdrop"
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
  imagePromptEditContract?: ImagePromptEditContract;
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

export interface VideoMicroShot extends VideoAssetDependencyFields {
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
  imageStatus?: "idle" | "pending" | "running" | "ready" | "failed";
  errorMessage?: string;
  usesConsistencyAnchors?: string[];
  prompt: string;
  promptZh?: string;
  promptEn?: string;
  planningSource?: "provisional" | "media_conditioned";
  sourceIntentMicroShotNo?: number;
  resolvedRevisionId?: string;
  resolvedAt?: string;
  startBoundaryImageUrl?: string;
  endBoundaryImageUrl?: string;
}

export interface ImagePromptEditContract {
  version: "image-prompt-edit-v1";
  lastEditedLocale: "zh" | "en";
  localizedDescription: { zh: string; en: string };
  subject: {
    count?: number;
    descriptionZh: string;
    descriptionEn: string;
  };
  composition: {
    framing: string;
    cameraAngle: string;
    placement: string;
    occupancy: string;
  };
  environment: {
    backgroundZh: string;
    backgroundEn: string;
    foreground: string;
    midground: string;
    backgroundLayer: string;
    spatialRelationships: string[];
  };
  lighting: {
    direction: string;
    quality: string;
    colorTemperature: string;
  };
  palette: string[];
  materialDetails: string[];
  intrinsicDetails: string[];
  forbiddenElements: string[];
  acceptanceCriteria: string[];
  creativeOverride: { zh: string; en: string };
}

export interface VideoAudioPlan {
  mode: "ambient" | "voiceover" | "dialogue" | "mixed" | "silent";
  strategy?: "native_ambience" | "native_full" | "post_only";
  needsVoiceover: boolean;
  needsDialogue: boolean;
  language?: string;
  speaker?: string;
  voiceStyle?: string;
  lines?: string[];
  linesZh?: string[];
  linesEn?: string[];
  exactTextRequired?: boolean;
  preserveNativeAudio?: boolean;
  soundEffects?: Array<{
    timingSeconds?: number;
    source: string;
    action: string;
    description: string;
  }>;
  backgroundMusic?: {
    source: "native" | "post" | "none";
    style?: string;
    mood?: string;
    intensity?: string;
  };
  rationale?: string;
}

export interface VideoPlanSegment extends VideoAssetDependencyFields {
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
  dependsOnBeatIds?: string[];
  evidenceFromBeatIds?: string[];
  resolvesConflictBeatId?: string;
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

export interface NarrativeEvent {
  eventId: string;
  /**
   * Authoritative story responsibilities carried by this event. Creative
   * strategy event bindings are derived from these roles for new plans.
   */
  storyFunctions?: VideoStoryFunction[];
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

export type VideoChronologyMode =
  | "chronological"
  | "flashforward_hook"
  | "result_first"
  | "problem_solution"
  | "demonstration";

export type VideoHookMode =
  | "pain_point"
  | "curiosity"
  | "tease"
  | "payoff_preview";

export type VideoHookRevealLevel = "none" | "partial" | "full";

export interface VideoCreativeStrategy {
  videoType?: "game_ad" | "product_ad" | "ecommerce_ad" | "food_ad" | "short_drama" | "brand_film" | "tutorial" | "custom";
  videoCategory?: VideoCreativeCategory;
  templateId?: VideoCreativeTemplateId;
  templateReason?: string;
  templateReasonZh?: string;
  chronologyMode?: VideoChronologyMode;
  hookMode?: VideoHookMode;
  hookRevealLevel?: VideoHookRevealLevel;
  hookEventIds?: string[];
  conflictEventIds?: string[];
  turningPointEventIds?: string[];
  payoffEventIds?: string[];
  ctaEventIds?: string[];
  returnToEventId?: string;
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
  dependsOnBeatIds?: string[];
  evidenceFromBeatIds?: string[];
  resolvesConflictBeatId?: string;
  actionContinuity?: {
    motivationOrPreparation?: string;
    execution?: string;
    resultOrReaction?: string;
  };
  reactionBeat?: string;
  powerShift?: string;
}

export interface VideoStoryBeat extends VideoAssetDependencyFields {
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
  dependsOnBeatIds?: string[];
  evidenceFromBeatIds?: string[];
  resolvesConflictBeatId?: string;
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

export interface VideoStoryEvidence {
  evidenceId: string;
  description?: string;
  introducedByBeatId: string;
  visibleInSegmentNos: number[];
  anchorIds?: string[];
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

export type VideoStorySemanticDimension =
  | "audience_fit"
  | "hook_strength"
  | "conflict_clarity"
  | "causal_coherence"
  | "escalation"
  | "turning_point_quality"
  | "payoff_strength"
  | "emotional_progression"
  | "selling_point_proof"
  | "cta_fit"
  | "reference_transformation"
  | "visual_storytelling"
  | "originality";

export interface VideoStorySemanticIssue {
  code: string;
  severity: "warning" | "error";
  confidence: number;
  dimension: VideoStorySemanticDimension;
  claimZh: string;
  evidenceEventIds: string[];
  evidenceBeatIds: string[];
  whyItHurtsZh: string;
  repairInstructionZh: string;
  rewriteFromStage: "creative_strategy" | "beat_sheet" | "storyboard";
}

export interface VideoStorySemanticStrength {
  claimZh: string;
  evidenceEventIds: string[];
  evidenceBeatIds: string[];
}

export interface VideoStorySemanticReview {
  passed: boolean;
  dimensionScores: Partial<Record<VideoStorySemanticDimension, number>>;
  issues: VideoStorySemanticIssue[];
  strengths: VideoStorySemanticStrength[];
  summaryZh: string;
  blockingIssueCodes: string[];
  invalidEvidenceReferences: string[];
  repairAttempts?: number;
  modelName?: string;
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
  endFrameRequirementLevel?: "hard_exact" | "hard_semantic" | "soft_directional" | "editorial";
  videoPromptContract?: VideoPromptContract;
  startFrameContract?: Record<string, unknown>;
  endFrameContract?: Record<string, unknown>;
  motionContract?: Record<string, unknown>;
  singleTakeContract?: Record<string, unknown>;
  motionCheckpoints?: VideoMicroShot[];
  resolvedMicroShots?: VideoMicroShot[];
  microShotRevisionId?: string;
  visibleAnchorIds: string[];
  requiresCut?: boolean;
  riskLevel?: "low" | "medium" | "high";
  timelineChangeRequest?: Record<string, unknown>;
  recommendedSplit?: unknown[];
  warnings?: string[];
}

export type VideoBoundaryContractStatus =
  | "semantic_draft"
  | "asset_bound"
  | "image_approved";

/**
 * The canonical, single-owner contract for one shared segment boundary.
 * Adjacent segments consume this record instead of independently rewriting
 * the same keyframe.
 */
export interface VideoBoundaryContract {
  version: "boundary-contract-v1";
  keyframeNo: number;
  timeSeconds: number;
  ownerSegmentNo: number;
  previousSegmentNo?: number;
  nextSegmentNo?: number;
  sourceEventIds: string[];
  linkedBeatIds: string[];
  requiredAnchorIds: string[];
  approvedAssetReferenceIds: string[];
  storyState: string;
  scene: string;
  cameraId?: string;
  characterState: string;
  productState: string;
  compositionIntent?: string;
  immutableFields: string[];
  forbiddenStoryStates: string[];
  status: VideoBoundaryContractStatus;
}

/** Pixel-grounded facts extracted only after the user approves a boundary image. */
export interface VideoObservedBoundaryFacts {
  version: "observed-boundary-facts-v1";
  keyframeNo: number;
  imageUrl: string;
  observedAt: string;
  observationModel?: string;
  contractPassed: boolean;
  scene: string;
  cameraView: string;
  composition: string;
  characterState: string;
  productState: string;
  anchorPositions: Record<string, string>;
  occlusions: string[];
  lighting: string;
  uncertainties: string[];
}

export interface VideoMediaConditionedSegmentPlan {
  version: "media-conditioned-segment-v1";
  segmentNo: number;
  startKeyframeNo: number;
  endKeyframeNo: number;
  startBoundaryImageUrl: string;
  endBoundaryImageUrl: string;
  startFrameContract: Record<string, unknown>;
  endFrameContract: Record<string, unknown>;
  motionContract: Record<string, unknown>;
  singleTakeContract: Record<string, unknown> & {
    physicallyReachable: boolean;
  };
  motionCheckpoints: VideoMicroShot[];
  resolvedMicroShots: VideoMicroShot[];
  microShotRevisionId: string;
  videoPromptContract: VideoPromptContract;
  planningStatus: "media_conditioned" | "media_conditioned_repaired" | "fallback";
  warnings: string[];
  refinedAt: string;
  modelName?: string;
}

export interface VideoPlanningPhaseState {
  semanticPlanning: "complete";
  boundaryPlanning: "semantic_draft" | "asset_bound" | "image_approved";
  mediaConditionedPlanning: "pending_images" | "complete" | "partial";
  finalPromptCompilation: "deferred_to_generation";
  updatedAt: string;
}

export type VideoPromptEvidenceType =
  | "user_input"
  | "story_contract"
  | "approved_end_frame"
  | "planner_artifact";

export interface VideoPromptEvidenceRef {
  /** Typed provenance pointer emitted by the model and verified by application code. */
  type: VideoPromptEvidenceType;
  id: string;
  /** Optional short quotation for human audit; never used to guess provenance. */
  quote?: string;
}

export interface VideoPromptTerminalRequirement {
  requirementId: string;
  priority: "hard" | "soft";
  observableFact: string;
  acceptanceCriteria: string;
  evidenceRefs: VideoPromptEvidenceRef[];
  /** Deterministically compiled from evidenceRefs. The model does not author this field. */
  source: "user" | "story_contract" | "approved_end_frame" | "planner";
  /** Preserves all provenances when one requirement is supported by multiple sources. */
  sources: Array<"user" | "story_contract" | "approved_end_frame" | "planner">;
}

export interface VideoPromptContract {
  version: "video-prompt-contract-v1";
  terminalRequirements: VideoPromptTerminalRequirement[];
  motionSteps: string[];
  preserveRequirements: string[];
  forbiddenOutcomes: string[];
  narrativeBoundary: string;
  shotIntent: string;
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
  /** Canonical physical scene contract. This is deliberately separate from palette/style anchors. */
  sceneId?: string;
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

export interface VideoSceneContract {
  version: "scene-contract-v1";
  sceneId: string;
  displayNameZh?: string;
  displayNameEn?: string;
  /** A physical location/space_layout anchor whose approved image is the spatial authority. */
  layoutAnchorId?: string;
  cameraIds: string[];
  segmentNos: number[];
  continuityMode: "single_space" | "independent_setup";
  spatialLayoutLock: string;
  cameraAxis?: string;
  fixedLandmarks: string[];
  /** Legacy projects may bind an already-approved boundary instead of regenerating an asset. */
  authority:
    | { kind: "scene_layout_asset"; anchorId: string }
    | { kind: "approved_root_boundary"; keyframeNo: number };
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
  compositeScore: number | null;
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
  policyVersion?: "quality-policy-v2" | "quality-policy-v3" | "quality-policy-v4" | "quality-policy-v5" | "quality-policy-v6" | "quality-policy-v7" | "quality-policy-v8" | "quality-policy-v9" | "quality-policy-v10";
  evaluationStatus?: "completed" | "partial" | "adjudication_required" | "technical_failed" | "reference_missing" | "unavailable" | "not_run";
  technicalError?: string;
  technicalRetryable?: boolean;
  /** Whether identity/product scores have an authoritative approved reference to compare against. */
  referenceComparable?: boolean;
  identityScoreApplicable?: boolean;
  productConsistencyScoreApplicable?: boolean;
  expectedAnchorIds?: string[];
  selectedReferenceCount?: number;
  missingReferenceAnchorIds?: string[];
  comparableChecks?: string[];
  /** Video review may be informative only and must not veto or auto-regenerate media. */
  advisoryOnly?: boolean;
  assetId: string;
  candidateId?: string;
  candidateNo?: number;
  mediaUrl?: string;
  identityScore: number | null;
  layoutScore: number | null;
  promptAlignmentScore: number | null;
  continuityScore: number | null;
  styleFidelityScore?: number | null;
  styleScoreApplicable?: boolean;
  singleTakeScore?: number | null;
  artifactIssues: string[];
  passed: boolean;
  retryInstruction?: string;
  endFrameSimilarityScore?: number | null;
  endFrameDecision?: "pass" | "retry_generation" | "return_stage_2b" | "manual_review" | "evaluation_failed";
  endFrameReasons?: string[];
  continuityRetryCount?: number;
  contentBased?: boolean;
  productInstanceCount?: number;
  personInstanceCount?: number;
  wrongTextDetected?: boolean;
  correctionActions?: GenerationCorrectionAction[];
  contractConflicts?: string[];
  suspectedContractConflicts?: string[];
  contractConflictsVerified?: boolean;
  issueLedger?: GenerationIssueLedgerEntry[];
  atomicRequirements?: AtomicVisualRequirement[];
  evidenceObservations?: VisualEvidenceObservation[];
  adjudicationRequired?: boolean;
  adjudicationPerformed?: boolean;
  adjudicationReason?: string;
  /** Legacy whole-image veto preserved for manual review without buying a second model call. */
  unsupportedModelVetoDetected?: boolean;
  resolvedIssueIds?: string[];
  openHardIssueIds?: string[];
  deferredVideoIssueResults?: DeferredVideoIssueResult[];
  resolvedDeferredVideoIssueIds?: string[];
  openDeferredVideoIssueIds?: string[];
  /** Image-stage findings carried forward as a human/on-demand video review checklist. */
  manualVideoQualityChecks?: DeferredVideoQualityCheck[];
  qualityDecision?: "pass" | "recommended" | "retry" | "blocked" | "review";
  hardFailureReasons?: string[];
  softSuggestions?: string[];
  firstFrameConsistencyScore?: number | null;
  checkpointOrderScore?: number | null;
  metadataIssues?: string[];
  userAccepted?: boolean;
  originalPassed?: boolean;
  retryFromStage?: "stage2b" | "stage3" | "reference_selector" | "generation" | "manual";
  evaluationModel?: string;
  evaluationDurationMs?: number;
  evaluationConfidence?: number;
  /** Visual-model suggestion only. The orchestration router makes the final decision. */
  suggestedRepairMode?: ImageRepairMode;
  suggestedCorrectionScope?: ImageCorrectionScope;
  suggestedBaselineUsable?: boolean;
  suggestedRepairReasonCodes?: string[];
  repairDecision?: ImageRepairDecision;
  displaySummaries?: Partial<Record<QualityDisplayLanguage, QualityDisplaySummary>>;
}

export type AtomicVisualRequirementDomain =
  | "identity"
  | "style"
  | "layout"
  | "brand_text"
  | "game_ui"
  | "narrative"
  | "anatomy"
  | "continuity"
  | "artifact";

export interface AtomicVisualRequirement {
  requirementId: string;
  domain: AtomicVisualRequirementDomain;
  target: string;
  severity: "hard" | "soft";
  authority: "approved_reference" | "structured_contract" | "frame_contract" | "planner_inference";
  appliesTo: "static_image" | "video" | "both";
  tolerance?: string;
  referenceAnchorIds?: string[];
}

export interface VisualEvidenceObservation {
  requirementId: string;
  status: "satisfied" | "violated" | "unknown" | "not_applicable";
  confidence: number;
  evidenceSource: "current_output" | "reference_only" | "unavailable";
  description?: string;
  observedText?: string;
  expectedText?: string;
  normalizedRegion?: {
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
  };
}

export interface DeferredVideoQualityCheck {
  sourceIssueId: string;
  sourceArtifactId: string;
  category: GenerationIssueLedgerEntry["category"];
  region?: string;
  requiredVideoCheck: string;
  expectedState?: string;
}

export interface DeferredVideoIssueResult {
  sourceIssueId: string;
  status: "resolved" | "open" | "unverifiable";
  evidence?: string;
  timeRange?: string;
}

export type ImageRepairMode =
  | "reevaluate_only"
  | "local_edit"
  | "guided_regenerate"
  | "full_regenerate"
  | "reference_reselect"
  | "contract_recompile"
  | "storyboard_replan"
  | "manual_review";

export type ImageCorrectionScope = "local" | "regional" | "global";

export type ImageRepairContextSection =
  | "minimal_contract"
  | "asset_locks"
  | "narrative_boundary"
  | "camera_graph"
  | "approved_references"
  | "full_original_prompt";

export interface ImageRepairDecision {
  mode: ImageRepairMode;
  reasonCodes: string[];
  baselineUsable: boolean;
  baselineCandidateId?: string;
  correctionScope: ImageCorrectionScope;
  editRegions: Array<{
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
  }>;
  preserve: string[];
  requiredContextSections: ImageRepairContextSection[];
  confidence: number;
  decidedBy: "deterministic_router";
  suggestedMode?: ImageRepairMode;
}

export type QualityDisplayLanguage = "zh" | "en";

export type QualityDisplayItemStatus =
  | "must_fix"
  | "improvement"
  | "satisfied"
  | "pending_review"
  | "blocked_input"
  | "technical_retry"
  // Kept for reading persisted v1/v2 reports.
  | "open"
  | "resolved"
  | "deferred";

export type QualityGateStatus =
  | "hard_fail"
  | "pass_with_advice"
  | "pass"
  | "pending_review"
  | "blocked_input"
  | "technical_retry";

export interface QualityDisplaySummaryItem {
  status: QualityDisplayItemStatus;
  text: string;
  requirementId?: string;
  confidence?: number;
}

export interface QualityDisplaySummary {
  version: "quality-summary-v1" | "quality-summary-v2" | "quality-summary-v3";
  lang: QualityDisplayLanguage;
  model: string;
  sourceHash: string;
  items: QualityDisplaySummaryItem[];
  gateStatus?: QualityGateStatus;
  /** Only evidence-backed hard visual failures may set this flag. */
  blocksQualityPass?: boolean;
  counts?: Partial<Record<Exclude<QualityDisplayItemStatus, "open" | "resolved" | "deferred">, number>>;
}

export interface GenerationIssueLedgerEntry {
  issueId: string;
  fingerprint: string;
  requirementId?: string;
  defectType?: string;
  category: "text_brand" | "game_ui" | "anatomy" | "identity" | "style" | "layout" | "continuity" | "artifact";
  region?: string;
  summary: string;
  target?: string;
  severity: "hard" | "soft" | "advisory";
  applicableStage: "static_image" | "video";
  status: "open" | "resolved" | "regressed" | "invalid_for_stage";
  firstSeenCandidateNo?: number;
  lastSeenCandidateNo?: number;
  occurrenceCount: number;
}

export interface GenerationCorrectionAction {
  region: string;
  element: string;
  observed: string;
  target: string;
  instruction: string;
  evidenceStatus?: "confirmed" | "uncertain";
  confidence?: number;
  normalizedRegion?: {
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
  };
  targetPoint?: {
    x: number;
    y: number;
  };
  executionParameters?: Record<string, unknown>;
  tolerance?: string;
  priority?: "required" | "recommended";
  sourceConstraint?: string;
  preserve?: string[];
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
  approvedRouteContract?: Record<string, unknown>;
  storyBeats?: VideoStoryBeat[];
  evidenceRegistry?: VideoStoryEvidence[];
  assetContract?: VideoAssetContract;
  narrativeMicroRules?: VideoNarrativeMicroRules;
  shotGroupingPass?: VideoShotGroupingPass;
  storyQualityReport?: VideoStoryQualityReport;
  storySemanticReview?: VideoStorySemanticReview;
  anchorStateTimeline?: AnchorStateTimeline[];
  audioBible?: Record<string, unknown>;
  assetLibrary?: VideoAssetLibrary;
  candidateTimeline?: VideoTimelineBlueprintSegment[];
  storyboardBrief?: StoryboardBrief[];
  segmentRenderDescriptions?: SegmentRenderDescription[];
  cameraGraph?: CameraGraph;
  sceneContracts?: VideoSceneContract[];
  transitionReferencePlan?: unknown[];
  transitionReferenceArtifacts?: TransitionReferenceArtifact[];
  finalTransitionPlan?: FinalTransitionPlan[];
  generatedBridgeArtifacts?: GeneratedBridgeArtifact[];
  referenceSelectionOutputs?: ReferenceSelectionOutput[];
  promptDebugArtifacts?: Record<string, PromptDebugArtifact>;
  artifactMetadata?: Record<string, ArtifactMetadata>;
  mediaRevisionHistory?: Record<string, VideoMediaRevision[]>;
  generationQualityReports?: GenerationQualityReport[];
  plannerWarnings?: string[];
  promptDetailPlan?: VideoPromptDetailPlan;
  boundaryContracts?: VideoBoundaryContract[];
  observedBoundaryFacts?: VideoObservedBoundaryFacts[];
  mediaConditionedSegmentPlans?: VideoMediaConditionedSegmentPlan[];
  planningPhase?: VideoPlanningPhaseState;
  consistencyReferences?: VideoConsistencyReference[];
  keyframes: VideoPlanKeyframe[];
  segments: VideoPlanSegment[];
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
  imagePromptEditContract?: ImagePromptEditContract;
  videoPrompt?: string;
  negativePrompt?: string;
  subtitle?: string;
  durationSeconds?: number;
  microShots?: VideoMicroShot[];
  audioPlan?: VideoAudioPlan;
  locked?: boolean;
}
