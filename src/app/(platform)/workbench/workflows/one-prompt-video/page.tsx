"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode, TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Clapperboard,
  Download,
  FileText,
  FolderOpen,
  ImageIcon,
  Languages,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Undo2,
  Unlock,
  X,
} from "lucide-react";
import { useLanguage } from "@workbench/lib/LanguageContext";

type ProjectStatus =
  | "DRAFT"
  | "PLANNING"
  | "PLAN_REVIEW"
  | "IMAGE_GENERATING"
  | "IMAGE_REVIEW"
  | "MICRO_SHOT_REVIEW"
  | "CLIP_GENERATING"
  | "CLIP_REVIEW"
  | "COMPOSING"
  | "FINAL_REVIEW"
  | "DONE"
  | "FAILED";

type ShotStatus =
  | "SCRIPT_READY"
  | "IMAGE_PENDING"
  | "IMAGE_RUNNING"
  | "IMAGE_READY"
  | "IMAGE_APPROVED"
  | "CLIP_PENDING"
  | "CLIP_RUNNING"
  | "CLIP_READY"
  | "CLIP_APPROVED"
  | "FAILED";

type AspectRatio = "9:16" | "16:9" | "1:1";
type PageLang = "zh" | "en";
type ProjectView = "assets" | "frames" | "clips" | "final";
type WorkflowStageKey = "PLAN_REVIEW" | "ASSET_LIBRARY_REVIEW" | "IMAGE_REVIEW" | "MICRO_SHOT_REVIEW" | "CLIP_REVIEW" | "FINAL_REVIEW";
type RollbackTarget = "PLAN_REVIEW" | "ASSET_LIBRARY_REVIEW" | "IMAGE_REVIEW" | "MICRO_SHOT_REVIEW" | "CLIP_REVIEW";
type OptimisticProgressPhase = "creating" | "understanding" | "storyboard" | "prompts" | "waiting" | "done" | "failed" | "stopped";

interface OptimisticProgress {
  active: boolean;
  phase: OptimisticProgressPhase;
  percent: number;
  startedAt: number;
}

interface WorkflowProgressView {
  percent: number;
  title: string;
  detail: string;
  tone: "running" | "success" | "failed" | "idle";
}

interface PlannerProgress {
  taskId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage: "queued" | "planning_architect" | "storyboard_artist" | "shot_decomposer" | "single_take_audit" | "split_repair" | "json_repair" | "prompt_detailer" | "story_quality_gate" | "complete" | "failed";
  completedSteps: number;
  totalSteps: number;
  currentSegmentNo?: number;
  completedSegments: number;
  totalSegments: number;
  attempt?: number;
  detailZh: string;
  detailEn: string;
  startedAt: string;
  updatedAt: string;
  metrics: {
    jsonRepairCount: number;
    jsonRepairDurationMs: number;
    singleTakeRepairCount: number;
    singleTakeRepairDurationMs: number;
  };
}

interface TimedPrompt {
  timeSeconds: number;
  startSeconds?: number;
  endSeconds?: number;
  prompt: string;
  promptZh?: string;
  promptEn?: string;
}

interface MicroShot {
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
  prompt: string;
  promptZh?: string;
  promptEn?: string;
}

interface AudioPlan {
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

interface VideoShot {
  id: string;
  shotNo: number;
  status: ShotStatus;
  durationSeconds: number;
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
  boundaryMode?: "continuous" | "hard_cut" | "dissolve" | "match_cut" | string;
  outputMode?: string;
  constraints?: string[];
  timedPrompts?: TimedPrompt[];
  microShots?: MicroShot[];
  audioPlan?: AudioPlan;
  negativePrompt: string;
  negativePromptZh?: string;
  negativePromptEn?: string;
  subtitle: string;
  imageUrl?: string | null;
  endImageUrl?: string | null;
  clipUrl?: string | null;
  qualityScore?: number | null;
  errorMessage?: string | null;
  locked: boolean;
  startKeyframeNo?: number;
  endKeyframeNo?: number;
  startTimeSeconds?: number;
  endTimeSeconds?: number;
}

interface VideoKeyframe {
  id: string;
  keyframeNo: number;
  timeSeconds: number;
  status: ShotStatus;
  purpose: string;
  purposeZh?: string;
  purposeEn?: string;
  imagePrompt: string;
  imagePromptZh?: string;
  imagePromptEn?: string;
  negativePrompt?: string;
  negativePromptZh?: string;
  negativePromptEn?: string;
  imageUrl?: string | null;
  errorMessage?: string | null;
  locked: boolean;
  anchorId?: string;
  assetView?: "front" | "side" | "back" | "face_closeup" | "overview" | "single" | string;
  sourceArtifactId?: string;
  viewGenerationMode?: "primary" | "derived_from_front" | string;
}

interface VideoSegment {
  id: string;
  segmentNo: number;
  status: ShotStatus;
  startKeyframeNo: number;
  endKeyframeNo: number;
  durationSeconds: number;
  boundaryMode?: "continuous" | "hard_cut" | "dissolve" | "match_cut" | string;
  purpose?: string;
  purposeZh?: string;
  purposeEn?: string;
  motion?: string;
  camera?: string;
  videoPrompt?: string;
  negativePrompt?: string;
  negativePromptZh?: string;
  negativePromptEn?: string;
  subtitle?: string;
  clipUrl?: string | null;
}

interface VideoProject {
  id: string;
  status: ProjectStatus;
  title: string;
  userPrompt: string;
  referenceImageUrls: string[];
  aspectRatio: AspectRatio;
  durationSeconds: number;
  stylePreset: string;
  finalVideoUrl?: string | null;
  errorMessage?: string | null;
  updatedAt: string;
  keyframes?: VideoKeyframe[];
  segments?: VideoSegment[];
  shots: VideoShot[];
  generationCandidates?: GenerationCandidate[];
  plannerProgress?: PlannerProgress;
  planDebug?: PlanDebugData;
}

interface GenerationCandidate {
  id: string;
  artifactId: string;
  targetId: string;
  kind: "keyframe_image" | "micro_shot_image" | "segment_video" | string;
  batchId: string;
  candidateNo: number;
  mediaUrl?: string | null;
  status: string;
  compositeScore?: number | null;
  passed?: boolean | null;
  selected: boolean;
  userAccepted: boolean;
  retryInstruction?: string | null;
  qualityReport?: GenerationQualityReport | null;
  metadata?: { segmentNo?: number; microShotNo?: number; [key: string]: unknown } | null;
}

interface PlanDebugData {
  narrativeEvents?: unknown[];
  creativeStrategy?: CreativeStrategyData;
  storyBeats?: StoryBeatData[];
  narrativeMicroRules?: Record<string, unknown>;
  shotGroupingPass?: ShotGroupingPassData;
  consistencyAnchors?: unknown[];
  anchorStateTimeline?: unknown[];
  segmentRenderDescriptions?: unknown[];
  finalTransitionPlan?: unknown[];
  transitionReferenceArtifacts?: TransitionReferenceArtifact[];
  generatedBridgeArtifacts?: GeneratedBridgeArtifact[];
  audioBible?: Record<string, unknown>;
  mediaRevisionHistory?: Record<string, MediaRevision[]>;
  referenceSelectionOutputs?: ReferenceSelectionOutput[];
  promptDebugArtifacts?: Record<string, PromptDebugArtifact>;
  artifactMetadata?: Record<string, ArtifactMetadata>;
  generationQualityReports?: GenerationQualityReport[];
  storyQualityReport?: StoryQualityReport;
  plannerShadow?: Record<string, unknown>;
  plannerWarnings?: unknown[];
}

interface CreativeStrategyData {
  videoCategory?: string;
  templateId?: string;
  templateReason?: string;
  conversionGoal?: string;
  hook?: string;
  conflict?: string;
  turningPoint?: string;
  payoff?: string;
  cta?: string;
  [key: string]: unknown;
}

interface StoryBeatData {
  id?: string;
  beatId?: string;
  beatType?: string;
  type?: string;
  label?: string;
  title?: string;
  storyMoment?: string;
  description?: string;
  descriptionZh?: string;
  descriptionEn?: string;
  function?: string;
  storyFunction?: string;
  emotionalBeat?: string;
  cause?: string;
  effect?: string;
  requiredEvidence?: string[];
  keyEvidenceIds?: string[];
  [key: string]: unknown;
}

interface ShotGroupingPassData {
  groups?: unknown[];
  splitReasons?: unknown[];
  [key: string]: unknown;
}

interface NarrativeSkeletonDraft {
  creativeStrategy: CreativeStrategyData;
  storyBeats: StoryBeatData[];
  storyQualityReport?: StoryQualityReport;
  shotGroupingPass?: ShotGroupingPassData;
}

interface StoryQualityReport {
  passed?: boolean;
  score?: number;
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
  rewriteFromStage?: "creative_strategy" | "beat_sheet" | "storyboard" | "shot_grouping" | "none" | string;
  summaryZh?: string;
}

interface TransitionReferenceArtifact {
  id: string;
  fromCameraId?: string;
  toCameraId: string;
  fromSegmentNo?: number;
  toSegmentNo: number;
  relation: string;
  mode: "short" | "full";
  inheritanceScope: string[];
  reasonZh: string;
  status: string;
  parentKeyframeNo?: number;
  videoUrl?: string;
  frameCandidates?: Array<{ id: string; url: string; compositeScore: number; passed: boolean; selected?: boolean }>;
  selectedFrameUrl?: string;
  locked?: boolean;
  errorMessage?: string;
}

interface GeneratedBridgeArtifact {
  id: string;
  fromSegmentNo: number;
  toSegmentNo: number;
  status: string;
  durationSeconds: number;
  selectedVideoUrl?: string;
  locked?: boolean;
  errorMessage?: string;
}

type MediaRevisionKind = "keyframe_image" | "micro_shot_image" | "segment_clip" | "transition_reference" | "generated_bridge" | "final_video";

interface MediaRevision {
  id: string;
  kind: MediaRevisionKind;
  targetId: string;
  url: string;
  createdAt: string;
  microShotNo?: number;
}

interface ReferenceSelectionOutput {
  targetArtifactId?: string;
  targetType?: string;
  selectedArtifactIds?: string[];
  selectedReferenceUrls?: string[];
  candidates?: ReferenceSelectionCandidateView[];
  usageNotes?: string[];
  finalTextPrompt?: string;
  warnings?: string[];
  targetOrientation?: string;
  selectedView?: string;
  orientationFallback?: string;
  policyVersion?: string;
}

interface ReferenceSelectionCandidateView {
  artifactId?: string;
  url?: string;
  sourceType?: string;
  quotaType?: string;
  purpose?: string;
  relevanceScore?: number;
  conflictScore?: number;
  recencyScore?: number;
  viewMatchScore?: number;
  finalScore?: number;
  anchorId?: string;
  assetView?: string;
  detectedOrientation?: string;
  hardRequired?: boolean;
  selected?: boolean;
  rejectionReason?: string;
  conflictReasons?: string[];
  usageNote?: string;
  [key: string]: unknown;
}

interface PromptDebugArtifact {
  targetArtifactId?: string;
  targetType?: string;
  beforePrompt?: string;
  finalPrompt?: string;
  finalNegativePrompt?: string;
  selectedReferenceUrls?: string[];
  referenceUsageNotes?: string[];
  rules?: string[];
  warnings?: string[];
  inputs?: Record<string, unknown>;
  createdAt?: string;
}

interface ArtifactMetadata {
  artifactId?: string;
  artifactType?: string;
  producedByStage?: string;
  revision?: number;
  status?: string;
  dirtyReason?: string;
  retryFromStage?: string;
  updatedAt?: string;
  dependsOn?: string[];
  invalidatedByArtifactIds?: string[];
  parentRevisionIds?: string[];
  userAccepted?: boolean;
  [key: string]: unknown;
}

interface GenerationQualityReport {
  assetId: string;
  identityScore: number;
  layoutScore: number;
  promptAlignmentScore: number;
  continuityScore: number;
  singleTakeScore?: number;
  artifactIssues: string[];
  passed: boolean;
  contentBased?: boolean;
  userAccepted?: boolean;
  wrongTextDetected?: boolean;
  retryInstruction?: string;
}

type DebugTab = "events" | "anchors" | "states" | "references" | "prompts" | "audit";
type EditableDebugSection = "events" | "anchors" | "states";

interface ApiResponse {
  ok: boolean;
  error?: string;
  project?: VideoProject;
  projects?: VideoProject[];
}

type Copy = {
  title: string;
  defaultPrompt: string;
  updated: string;
  projects: string;
  newProject: string;
  noProjects: string;
  activeProject: string;
  setupPanel: string;
  setupPanelHint: string;
  collapseSetup: string;
  expandSetup: string;
  referenceImages: string;
  uploadReference: string;
  uploadingReference: string;
  referenceImageHint: string;
  removeReference: string;
  renameProject: string;
  deleteProject: string;
  saveProject: string;
  cancel: string;
  saveKeyframe: string;
  projectRenamed: string;
  projectDeleted: string;
  deleteProjectConfirm: string;
  generatePlan: string;
  generating: string;
  stopGeneration: string;
  stoppingGeneration: string;
  generationStopped: string;
  resumeGeneration: string;
  continueBoundaryFrames: string;
  resumeStarted: string;
  approveScript: string;
  approveAssets: string;
  approveFrames: string;
  approveReference: string;
  approveMicroShots: string;
  approveClips: string;
  confirmFinal: string;
  recomposeFinal: string;
  rollback: string;
  rollbackTo: string;
  rollbackConfirm: string;
  rollbackDone: string;
  shots: string;
  assetLibrary: string;
  assetLibraryHint: string;
  frames: string;
  boundaryFrameHint: string;
  autoShotPlan: string;
  segmentDurationPolicy: string;
  totalDuration: string;
  totalDurationHint: string;
  duration: string;
  boundaryMode: string;
  outputMode: string;
  constraints: string;
  timedPrompts: string;
  microShots: string;
  microShot: string;
  microShotHint: string;
  addMicroShot: string;
  generateMicroShotImage: string;
  regenerateMicroShotImage: string;
  microShotImageHint: string;
  microShotImageRunning: string;
  microShotImageFailed: string;
  audioPlan: string;
  spokenLines: string;
  referenceType: string;
  microShotTime: string;
  microShotTimeHint: string;
  scene: string;
  prompt: string;
  shot: string;
  noShot: string;
  untitled: string;
  purpose: string;
  action: string;
  camera: string;
  subtitle: string;
  subtitleHint: string;
  imagePrompt: string;
  videoPrompt: string;
  negativePrompt: string;
  clipPreview: string;
  keyframePreview: string;
  finalVideo: string;
  preview: string;
  previewSize: string;
  ready: string;
  pending: string;
  finalVideoNotReady: string;
  firstLastFrameClips: string;
  downloadClip: string;
  saveShot: string;
  editShot: string;
  regenerate: string;
  undo: string;
  undoChanges: string;
  rollbackMedia: string;
  rollbackMediaConfirm: string;
  mediaRolledBack: string;
  languageButton: string;
  planned: string;
  saved: (shotNo: number) => string;
  keyframesReady: string;
  keyframeRegenerated: string;
  referenceApproved: string;
  changesSaved: string;
  framesApproved: string;
  microShotsApproved: string;
  clipsComposed: string;
  finalApproved: string;
  loadFailed: string;
  createFailed: string;
  planFailed: string;
  saveFailed: string;
  uploadReferenceFailed: string;
  keyframeFailed: string;
  regenerateFailed: string;
  lockFailed: string;
  approveFailed: string;
  actionFailed: string;
  emptyServer: string;
  nonJsonServer: string;
  requestFailed: (status: number) => string;
  customStyle: string;
  customStylePlaceholder: string;
  styles: Record<string, string>;
  status: Record<ProjectStatus, string>;
  shotStatus: Record<ShotStatus, string>;
  stages: Record<string, string>;
  rollbackTargets: Record<RollbackTarget, string>;
};

const TEXT: Record<PageLang, Copy> = {
  zh: {
    title: "\u4e00\u53e5\u8bdd\u6210\u7247\u5de5\u4f5c\u53f0",
    defaultPrompt: "\u505a\u4e00\u6761 30 \u79d2\u56fd\u98ce\u62a4\u80a4\u54c1\u5e7f\u544a\uff0c\u4e3b\u89d2\u5728\u6e05\u6668\u5ead\u9662\u4f7f\u7528\u4ea7\u54c1\uff0c\u8d28\u611f\u9ad8\u7ea7\u3002",
    updated: "\u66f4\u65b0",
    projects: "\u9879\u76ee",
    newProject: "\u65b0\u5efa\u9879\u76ee",
    noProjects: "\u6682\u65e0\u9879\u76ee",
    activeProject: "\u5f53\u524d",
    setupPanel: "\u521b\u4f5c\u5165\u53e3",
    setupPanelHint: "项目、提示词、参考图和生成设置",
    collapseSetup: "收起",
    expandSetup: "展开",
    referenceImages: "\u8f85\u52a9\u53c2\u8003\u56fe",
    uploadReference: "\u4e0a\u4f20\u53c2\u8003\u56fe",
    uploadingReference: "\u4e0a\u4f20\u4e2d",
    referenceImageHint: "\u53ef\u4e0a\u4f20\u4ea7\u54c1\u3001\u4eba\u7269\u3001\u573a\u666f\u6216\u98ce\u683c\u53c2\u8003\u56fe\uff0c\u6700\u591a 4 \u5f20\uff0c\u751f\u6210\u5206\u955c\u65f6\u4f1a\u4e00\u8d77\u7ed9\u5927\u6a21\u578b\u7406\u89e3\u3002",
    removeReference: "\u79fb\u9664\u53c2\u8003\u56fe",
    renameProject: "\u91cd\u547d\u540d",
    deleteProject: "\u5220\u9664",
    saveProject: "\u4fdd\u5b58",
    cancel: "\u53d6\u6d88",
    saveKeyframe: "\u4fdd\u5b58\u4fee\u6539",
    projectRenamed: "\u9879\u76ee\u5df2\u91cd\u547d\u540d",
    projectDeleted: "\u9879\u76ee\u5df2\u5220\u9664",
    deleteProjectConfirm: "\u786e\u5b9a\u5220\u9664\u8fd9\u4e2a\u9879\u76ee\u5417\uff1f\u5df2\u751f\u6210\u7684\u5206\u955c\u3001\u56fe\u7247\u548c\u7247\u6bb5\u8bb0\u5f55\u4f1a\u4e00\u8d77\u79fb\u9664\u3002",
    generatePlan: "\u751f\u6210\u5206\u955c\u8ba1\u5212",
    generating: "\u751f\u6210\u4e2d",
    stopGeneration: "\u505c\u6b62\u751f\u6210",
    stoppingGeneration: "停止中",
    generationStopped: "已停止生成",
    resumeGeneration: "\u7ee7\u7eed\u751f\u6210",
    continueBoundaryFrames: "\u7ee7\u7eed\u751f\u6210\u5173\u952e\u5e27",
    resumeStarted: "\u5df2\u7ee7\u7eed\u5f53\u524d\u9636\u6bb5",
    approveScript: "\u786e\u8ba4\u811a\u672c",
    approveAssets: "确认资产库",
    approveFrames: "\u786e\u8ba4\u8fb9\u754c\u53c2\u8003\u5e27",
    approveReference: "\u786e\u8ba4\u53c2\u8003\u56fe",
    approveMicroShots: "\u786e\u8ba4\u5185\u90e8\u5b50\u5206\u955c",
    approveClips: "\u786e\u8ba4\u7247\u6bb5\u5e76\u5408\u6210",
    confirmFinal: "\u786e\u8ba4\u6210\u7247",
    recomposeFinal: "\u91cd\u65b0\u5408\u6210\u6210\u7247",
    rollback: "\u56de\u9000",
    rollbackTo: "\u56de\u9000\u5230",
    rollbackConfirm: "\u786e\u5b9a\u8981\u56de\u9000\u5230\u9009\u4e2d\u9636\u6bb5\u5417\uff1f\u9009\u4e2d\u9636\u6bb5\u4e4b\u540e\u7684\u751f\u6210\u7ed3\u679c\u53ef\u80fd\u4f1a\u88ab\u6e05\u7a7a\u6216\u89e3\u9501\u3002",
    rollbackDone: "\u5df2\u56de\u9000\u5230\u9009\u4e2d\u9636\u6bb5",
    shots: "\u955c\u5934",
    assetLibrary: "资产库",
    assetLibraryHint: "人物、场景、产品等固定资产先在这里确认；人物资产包含正面、侧面和背面视角。",
    frames: "\u8fb9\u754c\u53c2\u8003\u5e27",
    boundaryFrameHint: "\u9759\u6001\u9996\u5c3e\u5e27\u53c2\u8003\u56fe\uff0c\u4e0d\u662f\u89c6\u9891\u65f6\u957f",
    autoShotPlan: "AI \u81ea\u52a8\u62c6\u955c",
    segmentDurationPolicy: "\u6bcf\u6bb5 3-15s",
    totalDuration: "\u603b\u65f6\u957f",
    totalDurationHint: "\u6210\u7247\u603b\u65f6\u957f\uff0c\u9ed8\u8ba4 30s",
    duration: "\u65f6\u957f",
    boundaryMode: "\u8fb9\u754c\u8f6c\u573a",
    outputMode: "\u8f93\u51fa\u7ea6\u675f",
    constraints: "\u9650\u5236",
    timedPrompts: "\u65f6\u95f4\u70b9\u63d0\u793a",
    microShots: "\u7247\u6bb5\u5185\u90e8\u5b50\u5206\u955c",
    microShot: "\u5b50\u5206\u955c",
    microShotHint: "\u7528\u4e8e\u9650\u5236\u8fd9\u4e00\u6bb5\u89c6\u9891\u5185\u90e8\u7684\u573a\u666f\u3001\u52a8\u4f5c\u3001\u955c\u5934\u548c\u53ef\u9009\u53c2\u8003\u56fe Prompt\uff0c\u4e0d\u662f\u989d\u5916\u89c6\u9891\u7247\u6bb5",
    addMicroShot: "\u6dfb\u52a0\u5b50\u5206\u955c",
    generateMicroShotImage: "\u751f\u6210\u53c2\u8003\u56fe",
    regenerateMicroShotImage: "\u91cd\u751f\u6210\u53c2\u8003\u56fe",
    microShotImageHint: "\u9009\u62e9 image_prompt / mixed \u540e\uff0c\u53ef\u5c06\u56fe\u7247 Prompt \u751f\u6210\u4e3a\u53ef\u9884\u89c8\u7684\u5185\u90e8\u53c2\u8003\u56fe",
    microShotImageRunning: "\u53c2\u8003\u56fe\u751f\u6210\u4e2d",
    microShotImageFailed: "\u53c2\u8003\u56fe\u751f\u6210\u5931\u8d25",
    audioPlan: "\u58f0\u97f3\u89c4\u5212",
    spokenLines: "\u53f0\u8bcd/\u65c1\u767d",
    referenceType: "\u53c2\u8003\u7c7b\u578b",
    microShotTime: "\u955c\u5934\u5185\u65f6\u95f4\u70b9\uff08\u79d2\uff09",
    microShotTimeHint: "\u4ece\u5f53\u524d\u955c\u5934\u5f00\u5934\u7b97\uff1a0=\u5f00\u5934\uff0c3=\u7b2c3\u79d2",
    scene: "\u573a\u666f",
    prompt: "Prompt",
    shot: "\u955c\u5934",
    noShot: "\u6682\u65e0\u9009\u4e2d\u955c\u5934",
    untitled: "\u672a\u547d\u540d\u9879\u76ee",
    purpose: "\u955c\u5934\u76ee\u7684",
    action: "\u52a8\u4f5c\u8bf4\u660e",
    camera: "\u8fd0\u955c",
    subtitle: "\u5b57\u5e55",
    subtitleHint: "\u53ef\u81ea\u5b9a\u4e49\u4fee\u6539\uff0c\u7528\u4e8e\u540e\u671f\u53e0\u52a0/\u5ba1\u6838\uff1b\u5efa\u8bae 8-18 \u5b57\uff0c\u6700\u591a 24 \u5b57",
    imagePrompt: "\u56fe\u7247 Prompt",
    videoPrompt: "\u89c6\u9891 Prompt",
    negativePrompt: "\u53cd\u5411\u63d0\u793a\u8bcd\uff08\u907f\u514d\u51fa\u73b0\uff09",
    clipPreview: "\u5206\u955c\u7247\u6bb5",
    keyframePreview: "\u8fb9\u754c\u53c2\u8003\u5e27",
    finalVideo: "\u6700\u7ec8\u6210\u7247",
    preview: "\u9884\u89c8",
    previewSize: "\u9884\u89c8\u5927\u5c0f",
    ready: "\u5df2\u5b8c\u6210",
    pending: "\u5f85\u5904\u7406",
    finalVideoNotReady: "\u6700\u7ec8\u6210\u7247\u5c1a\u672a\u751f\u6210\u3002",
    firstLastFrameClips: "\u9996\u5c3e\u5e27\u5206\u955c\u7247\u6bb5",
    downloadClip: "\u4e0b\u8f7d\u5206\u955c\u89c6\u9891",
    saveShot: "\u4fdd\u5b58\u955c\u5934",
    editShot: "编辑镜头",
    regenerate: "\u91cd\u751f\u6210",
    undo: "撤销",
    undoChanges: "撤销修改",
    rollbackMedia: "回退上一版本",
    rollbackMediaConfirm: "确定回退到上一个已生成版本吗？当前图片或视频将被替换。",
    mediaRolledBack: "已回退到上一版本",
    languageButton: "EN",
    planned: "\u5206\u955c\u811a\u672c\u5df2\u751f\u6210",
    saved: (shotNo) => `\u955c\u5934 ${shotNo} \u5df2\u4fdd\u5b58`,
    keyframesReady: "\u8fb9\u754c\u53c2\u8003\u5e27\u751f\u6210\u4efb\u52a1\u5df2\u63d0\u4ea4\uff0c\u6b63\u5728\u8f6e\u8be2\u7ed3\u679c",
    keyframeRegenerated: "\u8fb9\u754c\u53c2\u8003\u5e27\u5df2\u91cd\u751f\u6210",
    referenceApproved: "\u53c2\u8003\u56fe\u5df2\u786e\u8ba4",
    changesSaved: "\u4fee\u6539\u5df2\u4fdd\u5b58",
    framesApproved: "\u8fb9\u754c\u53c2\u8003\u5e27\u5df2\u786e\u8ba4\uff0c\u8bf7\u5ba1\u6838\u5185\u90e8\u5b50\u5206\u955c\u6587\u5b57\u548c\u53c2\u8003\u56fe",
    microShotsApproved: "\u5185\u90e8\u5b50\u5206\u955c\u5df2\u786e\u8ba4\uff0c\u89c6\u9891\u7247\u6bb5\u751f\u6210\u4efb\u52a1\u5df2\u63d0\u4ea4",
    clipsComposed: "\u7247\u6bb5\u5df2\u786e\u8ba4\uff0c\u6210\u7247\u5df2\u5408\u6210",
    finalApproved: "\u6210\u7247\u5df2\u786e\u8ba4\uff0c\u9879\u76ee\u5df2\u5b8c\u6210",
    loadFailed: "\u9879\u76ee\u52a0\u8f7d\u5931\u8d25",
    createFailed: "\u9879\u76ee\u521b\u5efa\u5931\u8d25",
    planFailed: "\u5206\u955c\u89c4\u5212\u5931\u8d25",
    saveFailed: "\u4fdd\u5b58\u5931\u8d25",
    uploadReferenceFailed: "\u53c2\u8003\u56fe\u4e0a\u4f20\u5931\u8d25",
    keyframeFailed: "\u8fb9\u754c\u53c2\u8003\u5e27\u751f\u6210\u5931\u8d25",
    regenerateFailed: "\u91cd\u751f\u6210\u5931\u8d25",
    lockFailed: "\u9501\u5b9a\u72b6\u6001\u66f4\u65b0\u5931\u8d25",
    approveFailed: "\u786e\u8ba4\u5931\u8d25",
    actionFailed: "\u64cd\u4f5c\u5931\u8d25",
    emptyServer: "\u670d\u52a1\u7aef\u8fd4\u56de\u4e3a\u7a7a",
    nonJsonServer: "\u670d\u52a1\u7aef\u8fd4\u56de\u4e86\u975e JSON \u5185\u5bb9",
    requestFailed: (status) => `\u8bf7\u6c42\u5931\u8d25 ${status}`,
    customStyle: "\u81ea\u5b9a\u4e49\u98ce\u683c",
    customStylePlaceholder: "\u4f8b\uff1a\u590d\u53e4\u6e2f\u98ce\u3001\u624b\u6301\u7eaa\u5f55\u7247\u3001\u9ad8\u9971\u548c\u6e38\u620f\u5ba3\u4f20\u7247",
    styles: {
      cinematic: "\u7535\u5f71\u5e7f\u544a",
      product: "\u4ea7\u54c1\u5c55\u793a",
      guofeng: "\u56fd\u98ce\u8d28\u611f",
      short_drama: "\u77ed\u5267\u53d9\u4e8b",
      ecommerce: "\u7535\u5546\u79cd\u8349",
    },
    status: {
      DRAFT: "\u8349\u7a3f",
      PLANNING: "\u89c4\u5212\u4e2d",
      PLAN_REVIEW: "\u811a\u672c\u5ba1\u6838",
      IMAGE_GENERATING: "\u8fb9\u754c\u5e27\u751f\u6210",
      IMAGE_REVIEW: "\u8fb9\u754c\u5e27\u5ba1\u6838",
      MICRO_SHOT_REVIEW: "\u5b50\u5206\u955c\u5ba1\u6838",
      CLIP_GENERATING: "\u89c6\u9891\u751f\u6210",
      CLIP_REVIEW: "\u7247\u6bb5\u5ba1\u6838",
      COMPOSING: "\u5408\u6210\u4e2d",
      FINAL_REVIEW: "\u6210\u7247\u5ba1\u6838",
      DONE: "\u5df2\u5b8c\u6210",
      FAILED: "\u5931\u8d25",
    },
    shotStatus: {
      SCRIPT_READY: "\u811a\u672c",
      IMAGE_PENDING: "\u5f85\u51fa\u56fe",
      IMAGE_RUNNING: "\u51fa\u56fe\u4e2d",
      IMAGE_READY: "\u5f85\u5ba1\u6838",
      IMAGE_APPROVED: "\u5df2\u9501\u5b9a",
      CLIP_PENDING: "\u5f85\u89c6\u9891",
      CLIP_RUNNING: "\u89c6\u9891\u4e2d",
      CLIP_READY: "\u7247\u6bb5\u5c31\u7eea",
      CLIP_APPROVED: "\u7247\u6bb5\u9501\u5b9a",
      FAILED: "\u5931\u8d25",
    },
    stages: {
      PLAN_REVIEW: "\u811a\u672c",
      ASSET_LIBRARY_REVIEW: "\u8d44\u4ea7\u5e93",
      IMAGE_REVIEW: "\u8fb9\u754c\u5e27",
      MICRO_SHOT_REVIEW: "\u5b50\u5206\u955c",
      CLIP_REVIEW: "\u7247\u6bb5",
      FINAL_REVIEW: "\u6210\u7247",
    },
    rollbackTargets: {
      PLAN_REVIEW: "\u811a\u672c\u5ba1\u6838",
      ASSET_LIBRARY_REVIEW: "\u8d44\u4ea7\u5e93\u5ba1\u6838",
      IMAGE_REVIEW: "\u53c2\u8003\u56fe\u5ba1\u6838",
      MICRO_SHOT_REVIEW: "\u5185\u90e8\u5b50\u5206\u955c\u5ba1\u6838",
      CLIP_REVIEW: "\u7247\u6bb5\u5ba1\u6838",
    },
  },
  en: {
    title: "One Prompt Video Studio",
    defaultPrompt: "Create a 30-second premium guofeng skincare ad. The main character uses the product in a quiet morning courtyard.",
    updated: "Updated",
    projects: "Projects",
    newProject: "New project",
    noProjects: "No projects",
    activeProject: "Active",
    setupPanel: "Creation setup",
    setupPanelHint: "Projects, prompt, references, and generation settings",
    collapseSetup: "Collapse",
    expandSetup: "Expand",
    referenceImages: "Reference images",
    uploadReference: "Upload references",
    uploadingReference: "Uploading",
    referenceImageHint: "Upload product, character, scene, or style references. Up to 4 images will be passed to the storyboard model.",
    removeReference: "Remove reference",
    renameProject: "Rename",
    deleteProject: "Delete",
    saveProject: "Save",
    cancel: "Cancel",
    saveKeyframe: "Save changes",
    projectRenamed: "Project renamed",
    projectDeleted: "Project deleted",
    deleteProjectConfirm: "Delete this project? Storyboard, frame, and clip records will be removed.",
    generatePlan: "Generate plan",
    generating: "Generating",
    stopGeneration: "Stop generation",
    stoppingGeneration: "Stopping",
    generationStopped: "Generation stopped",
    resumeGeneration: "Resume generation",
    continueBoundaryFrames: "Continue keyframes",
    resumeStarted: "Resumed the current stage",
    approveScript: "Approve script",
    approveAssets: "Approve asset library",
    approveFrames: "Approve boundary frames",
    approveReference: "Approve reference",
    approveMicroShots: "Approve internal micro-shots",
    approveClips: "Approve clips and compose",
    confirmFinal: "Approve final",
    recomposeFinal: "Recompose final",
    rollback: "Rollback",
    rollbackTo: "Rollback to",
    rollbackConfirm: "Rollback to the selected stage? Outputs after that stage may be cleared or unlocked.",
    rollbackDone: "Rolled back to the selected stage",
    shots: "Shots",
    assetLibrary: "Asset library",
    assetLibraryHint: "Confirm fixed people, scenes, products, and props here first. Person assets include front, side, and back views.",
    frames: "boundary frames",
    boundaryFrameHint: "Static first/end-frame reference images, not video durations",
    autoShotPlan: "AI decides shots",
    segmentDurationPolicy: "3-15s per clip",
    totalDuration: "Total duration",
    totalDurationHint: "Final video duration, default 30s",
    duration: "Duration",
    boundaryMode: "Boundary mode",
    outputMode: "Output mode",
    constraints: "Constraints",
    timedPrompts: "Timed prompts",
    microShots: "Internal micro-shots",
    microShot: "Micro-shot",
    microShotHint: "Controls scene, action, camera, and optional reference-image prompts inside this one video segment. These are not extra video clips.",
    addMicroShot: "Add micro-shot",
    generateMicroShotImage: "Generate reference image",
    regenerateMicroShotImage: "Regenerate reference image",
    microShotImageHint: "Choose image_prompt or mixed to turn the image prompt into a previewable internal reference image.",
    microShotImageRunning: "Reference image generating",
    microShotImageFailed: "Reference image failed",
    audioPlan: "Audio plan",
    spokenLines: "Spoken lines",
    referenceType: "Reference type",
    microShotTime: "Time in this shot (s)",
    microShotTimeHint: "Count from this shot start: 0 = beginning, 3 = second 3",
    scene: "Scene",
    prompt: "Prompt",
    shot: "Shot",
    noShot: "No shot selected",
    untitled: "Untitled project",
    purpose: "Purpose",
    action: "Action",
    camera: "Camera",
    subtitle: "Subtitle",
    subtitleHint: "Custom editable overlay copy for review/composition. Aim for 3-8 words, max 72 characters.",
    imagePrompt: "Image prompt",
    videoPrompt: "Video prompt",
    negativePrompt: "Negative prompt",
    clipPreview: "Clip preview",
    keyframePreview: "Boundary frame",
    finalVideo: "Final video",
    preview: "Preview",
    previewSize: "Preview size",
    ready: "ready",
    pending: "pending",
    finalVideoNotReady: "Final video is not ready yet.",
    firstLastFrameClips: "first-last-frame clips",
    downloadClip: "Download clip",
    saveShot: "Save shot",
    editShot: "Edit shot",
    regenerate: "Regenerate",
    undo: "Undo",
    undoChanges: "Undo changes",
    rollbackMedia: "Restore previous version",
    rollbackMediaConfirm: "Restore the previous generated version? The current image or video will be replaced.",
    mediaRolledBack: "Previous version restored",
    languageButton: "\u4e2d\u6587",
    planned: "Storyboard plan generated",
    saved: (shotNo) => `Shot ${shotNo} saved`,
    keyframesReady: "Boundary reference frame generation tasks submitted. Polling results.",
    keyframeRegenerated: "Boundary reference frame regenerated",
    referenceApproved: "Reference approved",
    changesSaved: "Changes saved",
    framesApproved: "Boundary reference frames approved. Review internal micro-shot text and reference images next.",
    microShotsApproved: "Internal micro-shots approved. Clip generation tasks submitted.",
    clipsComposed: "Clips approved. Final video composed.",
    finalApproved: "Final approved. Project is complete.",
    loadFailed: "Load failed",
    createFailed: "Create failed",
    planFailed: "Plan failed",
    saveFailed: "Save failed",
    uploadReferenceFailed: "Reference image upload failed",
    keyframeFailed: "Boundary reference frame generation failed",
    regenerateFailed: "Regenerate failed",
    lockFailed: "Lock update failed",
    approveFailed: "Approve failed",
    actionFailed: "Action failed",
    emptyServer: "Empty server response",
    nonJsonServer: "Server returned a non-JSON response",
    requestFailed: (status) => `Request failed ${status}`,
    customStyle: "Custom style",
    customStylePlaceholder: "e.g. retro Hong Kong cinema, handheld documentary, saturated game trailer",
    styles: {
      cinematic: "Cinematic ad",
      product: "Product",
      guofeng: "Guofeng",
      short_drama: "Short drama",
      ecommerce: "E-commerce",
    },
    status: {
      DRAFT: "Draft",
      PLANNING: "Planning",
      PLAN_REVIEW: "Script review",
      IMAGE_GENERATING: "Boundary frames",
      IMAGE_REVIEW: "Boundary frame review",
      MICRO_SHOT_REVIEW: "Micro-shot review",
      CLIP_GENERATING: "Clips",
      CLIP_REVIEW: "Clip review",
      COMPOSING: "Composing",
      FINAL_REVIEW: "Final review",
      DONE: "Done",
      FAILED: "Failed",
    },
    shotStatus: {
      SCRIPT_READY: "Script",
      IMAGE_PENDING: "Image pending",
      IMAGE_RUNNING: "Image running",
      IMAGE_READY: "Image ready",
      IMAGE_APPROVED: "Locked",
      CLIP_PENDING: "Clip pending",
      CLIP_RUNNING: "Clip running",
      CLIP_READY: "Clip ready",
      CLIP_APPROVED: "Clip locked",
      FAILED: "Failed",
    },
    stages: {
      PLAN_REVIEW: "Script",
      ASSET_LIBRARY_REVIEW: "Assets",
      IMAGE_REVIEW: "Frames",
      MICRO_SHOT_REVIEW: "Micro-shots",
      CLIP_REVIEW: "Clips",
      FINAL_REVIEW: "Final",
    },
    rollbackTargets: {
      PLAN_REVIEW: "Script review",
      ASSET_LIBRARY_REVIEW: "Asset library review",
      IMAGE_REVIEW: "Reference image review",
      MICRO_SHOT_REVIEW: "Internal micro-shot review",
      CLIP_REVIEW: "Clip review",
    },
  },
};

const STAGES = [
  { key: "PLAN_REVIEW", icon: FileText },
  { key: "ASSET_LIBRARY_REVIEW", icon: FolderOpen },
  { key: "IMAGE_REVIEW", icon: ImageIcon },
  { key: "MICRO_SHOT_REVIEW", icon: FileText },
  { key: "CLIP_REVIEW", icon: Clapperboard },
  { key: "FINAL_REVIEW", icon: Check },
] satisfies Array<{ key: WorkflowStageKey; icon: typeof FileText }>;

const DEFAULT_PROMPTS = [TEXT.zh.defaultPrompt, TEXT.en.defaultPrompt];
const PROJECT_STORAGE_KEY = "one-prompt-video-active-project-id";
const SETUP_PANEL_COLLAPSED_STORAGE_KEY = "one-prompt-video-setup-panel-collapsed";
const WORKFLOW_PROGRESS_COLLAPSED_STORAGE_KEY = "one-prompt-video-workflow-progress-collapsed";
const DETAIL_PANEL_WIDTH_STORAGE_KEY = "one-prompt-video-detail-panel-width";
const DETAIL_PREVIEW_HEIGHT_STORAGE_KEY = "one-prompt-video-detail-preview-height";
const CUSTOM_STYLE_VALUE = "__custom";
const KNOWN_STYLE_PRESETS = new Set(["cinematic", "product", "guofeng", "short_drama", "ecommerce"]);
const MANUAL_STOP_MESSAGE = "Generation stopped by user";
const DETAIL_PANEL_MIN_WIDTH = 280;
const DETAIL_PANEL_MAX_WIDTH = 720;
const DETAIL_PREVIEW_MIN_HEIGHT = 180;
const DETAIL_PREVIEW_MAX_HEIGHT = 760;
const RUNNING_PROJECT_STATUSES: ProjectStatus[] = ["PLANNING", "IMAGE_GENERATING", "CLIP_GENERATING", "COMPOSING"];

function clampProjectDuration(value: number): number {
  if (!Number.isFinite(value)) return 30;
  return Math.max(3, Math.min(180, Math.round(value)));
}

function clampDetailPanelWidth(value: number): number {
  if (!Number.isFinite(value)) return 360;
  return Math.max(DETAIL_PANEL_MIN_WIDTH, Math.min(DETAIL_PANEL_MAX_WIDTH, Math.round(value)));
}

function clampDetailPreviewHeight(value: number): number {
  if (!Number.isFinite(value)) return 360;
  return Math.max(DETAIL_PREVIEW_MIN_HEIGHT, Math.min(DETAIL_PREVIEW_MAX_HEIGHT, Math.round(value)));
}

function isManualStopError(errorMessage?: string | null): boolean {
  return errorMessage === MANUAL_STOP_MESSAGE;
}

function isManualStopProject(project?: Pick<VideoProject, "status" | "errorMessage"> | null): boolean {
  return Boolean(project && project.status === "FAILED" && isManualStopError(project.errorMessage));
}

function shotStatusLabel(status: ShotStatus, errorMessage: string | null | undefined, copy: Copy): string {
  return status === "FAILED" && isManualStopError(errorMessage) ? copy.generationStopped : copy.shotStatus[status];
}

function formatProgressPercent(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export default function OnePromptVideoPage() {
  const { lang, toggleLang } = useLanguage();
  const pageLang: PageLang = lang === "en" ? "en" : "zh";
  const copy = TEXT[pageLang];
  const [prompt, setPrompt] = useState(copy.defaultPrompt);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [durationSeconds, setDurationSeconds] = useState(30);
  const [stylePreset, setStylePreset] = useState("guofeng");
  const [customStylePreset, setCustomStylePreset] = useState("");
  const [referenceImageUrls, setReferenceImageUrls] = useState<string[]>([]);
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [editingProjectId, setEditingProjectId] = useState("");
  const [deletingProjectId, setDeletingProjectId] = useState("");
  const [editingTitle, setEditingTitle] = useState("");
  const [project, setProject] = useState<VideoProject | null>(null);
  const [selectedShotId, setSelectedShotId] = useState("");
  const [selectedKeyframeId, setSelectedKeyframeId] = useState("");
  const [previewKeyframeId, setPreviewKeyframeId] = useState("");
  const [previewMicroShot, setPreviewMicroShot] = useState<{ title: string; imageUrl: string; imagePrompt: string } | null>(null);
  const [projectView, setProjectView] = useState<ProjectView>("clips");
  const [draft, setDraft] = useState<Partial<VideoShot>>({});
  const [keyframeDraft, setKeyframeDraft] = useState<Partial<VideoKeyframe>>({});
  const [loading, setLoading] = useState(false);
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [planningProjectIds, setPlanningProjectIds] = useState<string[]>([]);
  const [uploadingReferences, setUploadingReferences] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [optimisticProgress, setOptimisticProgress] = useState<OptimisticProgress | null>(null);
  const [progressNow, setProgressNow] = useState(() => Date.now());
  const [generationAbortController, setGenerationAbortController] = useState<AbortController | null>(null);
  const [generationProjectId, setGenerationProjectId] = useState("");
  const [stoppingGeneration, setStoppingGeneration] = useState(false);
  const [setupPanelCollapsed, setSetupPanelCollapsed] = useState(false);
  const [workflowProgressCollapsed, setWorkflowProgressCollapsed] = useState(false);
  const [shotEditorOpen, setShotEditorOpen] = useState(false);
  const [microShotHelpOpen, setMicroShotHelpOpen] = useState<"detail" | "modal" | null>(null);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [debugTab, setDebugTab] = useState<DebugTab>("events");
  const [debugDraft, setDebugDraft] = useState<Record<EditableDebugSection, string>>({
    events: "[]",
    anchors: "[]",
    states: "[]",
  });
  const [detailPanelWidth, setDetailPanelWidth] = useState(360);
  const [detailPreviewHeight, setDetailPreviewHeight] = useState(360);
  const [resizingDetailPanel, setResizingDetailPanel] = useState(false);
  const projectLayoutRef = useRef<HTMLElement | null>(null);
  const detailPanelRef = useRef<HTMLElement | null>(null);
  const selectedProjectIdRef = useRef("");

  const selectedShot = useMemo(
    () => project?.shots.find((shot) => shot.id === selectedShotId) ?? project?.shots[0],
    [project, selectedShotId],
  );
  const selectedKeyframe = useMemo(
    () => project?.keyframes?.find((keyframe) => keyframe.id === selectedKeyframeId),
    [project?.keyframes, selectedKeyframeId],
  );
  const previewKeyframe = useMemo(
    () => project?.keyframes?.find((keyframe) => keyframe.id === previewKeyframeId),
    [project?.keyframes, previewKeyframeId],
  );
  const keyframeByNo = useMemo(
    () => new Map((project?.keyframes ?? []).map((keyframe) => [keyframe.keyframeNo, keyframe])),
    [project?.keyframes],
  );
  const selectedStartKeyframe = selectedShot?.startKeyframeNo ? keyframeByNo.get(selectedShot.startKeyframeNo) : undefined;
  const selectedEndKeyframe = selectedShot?.endKeyframeNo ? keyframeByNo.get(selectedShot.endKeyframeNo) : undefined;
  const debugCopy = DEBUG_COPY[pageLang];
  const debugContext = useMemo(
    () => buildDebugContext(project, selectedShot, selectedKeyframe),
    [project, selectedKeyframe, selectedShot],
  );
  const currentReferenceSelections = useMemo(
    () => currentReferenceDebugItems(project?.planDebug, debugContext.targetIds),
    [debugContext.targetIds, project?.planDebug],
  );
  const currentPromptDebugArtifacts = useMemo(
    () => currentPromptDebugItems(project?.planDebug, debugContext.targetIds),
    [debugContext.targetIds, project?.planDebug],
  );
  const currentDirtyArtifacts = useMemo(
    () => currentArtifactMetadata(project?.planDebug, debugContext.targetIds),
    [debugContext.targetIds, project?.planDebug],
  );
  const currentQualityReports = useMemo(
    () => currentGenerationQualityReports(project?.planDebug, debugContext.targetIds),
    [debugContext.targetIds, project?.planDebug],
  );
  const assetKeyframes = useMemo(
    () => project?.keyframes?.filter((keyframe) => keyframe.keyframeNo < 0) ?? [],
    [project?.keyframes],
  );
  const boundaryKeyframes = useMemo(
    () => project?.keyframes?.filter((keyframe) => keyframe.keyframeNo > 0) ?? [],
    [project?.keyframes],
  );
  const orderedAssetKeyframes = useMemo(
    () => [...assetKeyframes].sort((a, b) => assetKeyframeSortRank(a) - assetKeyframeSortRank(b)),
    [assetKeyframes],
  );
  const orderedBoundaryKeyframes = useMemo(
    () => [...boundaryKeyframes].sort((a, b) => a.keyframeNo - b.keyframeNo),
    [boundaryKeyframes],
  );
  const keyframeTotal = project?.keyframes?.length || project?.shots.length || 0;
  const assetTotal = assetKeyframes.length;
  const boundaryTotal = boundaryKeyframes.length || project?.shots.length || 0;
  const previewTotalDuration = project?.durationSeconds ?? previewKeyframe?.timeSeconds ?? 30;
  const segmentTotal = project?.segments?.length || project?.shots.length || 0;
  const completeImages = project?.keyframes?.length
    ? project.keyframes.filter((keyframe) => Boolean(keyframe.imageUrl)).length
    : project?.shots.filter((shot) => Boolean(shot.imageUrl)).length ?? 0;
  const completeAssets = assetKeyframes.filter((keyframe) => Boolean(keyframe.imageUrl) && (keyframe.locked || keyframe.status === "IMAGE_APPROVED")).length;
  const completeBoundaryImages = boundaryKeyframes.length
    ? boundaryKeyframes.filter((keyframe) => Boolean(keyframe.imageUrl)).length
    : project?.shots.filter((shot) => Boolean(shot.imageUrl)).length ?? 0;
  const completeClips = project?.segments?.length
    ? project.segments.filter((segment) => Boolean(segment.clipUrl) || segment.status === "CLIP_READY" || segment.status === "CLIP_APPROVED").length
    : project?.shots.filter((shot) => Boolean(shot.clipUrl) || shot.status === "CLIP_READY" || shot.status === "CLIP_APPROVED").length ?? 0;
  const microShotImageStats = project ? microShotImageProgress(project) : { required: 0, ready: 0, running: 0, failed: 0, missing: 0 };
  const consistencyKeyframes = assetKeyframes;
  const consistencyKeyframesApproved = consistencyKeyframes.every((keyframe) => Boolean(keyframe.imageUrl) && (keyframe.locked || keyframe.status === "IMAGE_APPROVED"));
  const consistencyKeyframesReady = consistencyKeyframes.length > 0 && consistencyKeyframes.every((keyframe) => Boolean(keyframe.imageUrl));
  const hasUnsavedKeyframeChanges = Boolean(
    selectedKeyframe &&
    (keyframeFieldChanged("purpose") || keyframeFieldChanged("imagePrompt") || keyframeFieldChanged("negativePrompt")),
  );
  const hasPendingBoundaryKeyframes = boundaryKeyframes.some((keyframe) => !keyframe.imageUrl);
  const keyframesApproved = Boolean(project?.keyframes?.length && project.keyframes.every((keyframe) => keyframe.status === "IMAGE_APPROVED" || keyframe.locked));
  const effectiveProjectStatus = project ? effectiveReviewStatus(project.status, keyframesApproved) : null;
  const activeWorkflowStage = project
    ? workflowStageForProject(project.status, effectiveProjectStatus, assetTotal, consistencyKeyframesApproved)
    : null;
  const runningProjectIds = useMemo(
    () => Array.from(new Set([
      ...projects
        .filter((item) => RUNNING_PROJECT_STATUSES.includes(item.status) || hasRunningMicroShotImage(item))
        .map((item) => item.id),
      ...planningProjectIds,
    ])),
    [planningProjectIds, projects],
  );
  const canApproveScript = Boolean(project && project.shots.length > 0 && project.status === "PLAN_REVIEW");
  const canApproveAssets = Boolean(project && (project.status === "IMAGE_REVIEW" || project.status === "FAILED") && consistencyKeyframesReady && !consistencyKeyframesApproved);
  const canContinueBoundaryFrames = Boolean(project && project.status === "IMAGE_REVIEW" && hasPendingBoundaryKeyframes && consistencyKeyframesApproved);
  const canApproveFrames = Boolean(project && keyframeTotal > 0 && completeImages === keyframeTotal && project.status === "IMAGE_REVIEW" && !keyframesApproved);
  const canApproveMicroShots = Boolean(project && effectiveProjectStatus === "MICRO_SHOT_REVIEW" && microShotImageStats.running === 0 && microShotImageStats.failed === 0 && microShotImageStats.missing === 0);
  const canApproveClips = Boolean(project && segmentTotal > 0 && completeClips === segmentTotal && project.status === "CLIP_REVIEW");
  const canConfirmFinal = Boolean(project && project.status === "FINAL_REVIEW");
  const rollbackOptions = useMemo(
    () => effectiveProjectStatus ? rollbackTargetsForStatus(effectiveProjectStatus, consistencyKeyframesApproved) : [],
    [consistencyKeyframesApproved, effectiveProjectStatus],
  );
  const canStopGeneration = Boolean(
    generationAbortController ||
    optimisticProgress?.active ||
    (project && RUNNING_PROJECT_STATUSES.includes(project.status)),
  );
  const planGenerationBusy = Boolean(
    creatingPlan ||
    project?.status === "PLANNING",
  );
  const canPlanSelectedDraft = project?.status === "DRAFT";
  const effectiveStylePreset = useMemo(
    () => (stylePreset === CUSTOM_STYLE_VALUE ? customStylePreset.trim() : stylePreset),
    [customStylePreset, stylePreset],
  );
  const canCreateAndPlan = !creatingPlan && prompt.trim().length >= 4 && effectiveStylePreset.length > 0 && (!project || canPlanSelectedDraft);
  const workflowProgress = useMemo(() => {
    if (optimisticProgress) {
      const next = estimatePlanningProgress(progressNow - optimisticProgress.startedAt);
      return optimisticWorkflowProgressView({
        ...optimisticProgress,
        phase: next.phase,
        percent: Math.max(optimisticProgress.percent, next.percent),
      }, pageLang);
    }
    if (!project || !effectiveProjectStatus) return null;
    if (effectiveProjectStatus === "PLANNING") {
      return plannerWorkflowProgressView(project.plannerProgress, pageLang);
    }
    return projectWorkflowProgressView(project, projectProgress(project, effectiveProjectStatus), pageLang, effectiveProjectStatus);
  }, [effectiveProjectStatus, optimisticProgress, pageLang, progressNow, project]);
  const workflowProgressBarClass =
    workflowProgress?.tone === "failed"
      ? "bg-red-400"
      : workflowProgress?.tone === "success"
        ? "bg-emerald-400"
        : "bg-cyan-400";
  const workflowProgressBorderClass =
    workflowProgress?.tone === "failed"
      ? "border-red-400/25 bg-red-400/10"
      : workflowProgress?.tone === "success"
        ? "border-emerald-400/25 bg-emerald-400/10"
        : "border-cyan-400/25 bg-cyan-400/10";

  useEffect(() => {
    setPrompt((current) => (DEFAULT_PROMPTS.includes(current) ? copy.defaultPrompt : current));
  }, [copy.defaultPrompt]);

  useEffect(() => {
    setDebugDraft({
      events: prettyDebugJson(project?.planDebug?.narrativeEvents ?? []),
      anchors: prettyDebugJson(project?.planDebug?.consistencyAnchors ?? []),
      states: prettyDebugJson(project?.planDebug?.anchorStateTimeline ?? []),
    });
  }, [project?.planDebug]);

  useEffect(() => {
    void loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setSetupPanelCollapsed(window.localStorage.getItem(SETUP_PANEL_COLLAPSED_STORAGE_KEY) === "true");
    setWorkflowProgressCollapsed(window.localStorage.getItem(WORKFLOW_PROGRESS_COLLAPSED_STORAGE_KEY) === "true");
    const saved = Number(window.localStorage.getItem(DETAIL_PANEL_WIDTH_STORAGE_KEY));
    if (Number.isFinite(saved) && saved > 0) setDetailPanelWidth(clampDetailPanelWidth(saved));
    const savedPreviewHeight = Number(window.localStorage.getItem(DETAIL_PREVIEW_HEIGHT_STORAGE_KEY));
    if (Number.isFinite(savedPreviewHeight) && savedPreviewHeight > 0) {
      setDetailPreviewHeight(clampDetailPreviewHeight(savedPreviewHeight));
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SETUP_PANEL_COLLAPSED_STORAGE_KEY, String(setupPanelCollapsed));
  }, [setupPanelCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(WORKFLOW_PROGRESS_COLLAPSED_STORAGE_KEY, String(workflowProgressCollapsed));
  }, [workflowProgressCollapsed]);

  useEffect(() => {
    if (!resizingDetailPanel) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onPointerMove(event: PointerEvent) {
      const rect = projectLayoutRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDetailPanelWidth(clampDetailPanelWidth(rect.right - event.clientX));
    }

    function onPointerUp() {
      setResizingDetailPanel(false);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [resizingDetailPanel]);

  useEffect(() => {
    window.localStorage.setItem(DETAIL_PANEL_WIDTH_STORAGE_KEY, String(detailPanelWidth));
  }, [detailPanelWidth]);

  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  useEffect(() => {
    if (!optimisticProgress?.active && effectiveProjectStatus !== "PLANNING") return;
    const timer = window.setInterval(() => {
      setProgressNow(Date.now());
      setOptimisticProgress((current) => {
        if (!current?.active) return current;
        const next = estimatePlanningProgress(Date.now() - current.startedAt);
        return {
          ...current,
          phase: next.phase,
          percent: Math.max(current.percent, next.percent),
        };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [effectiveProjectStatus, optimisticProgress?.active]);

  useEffect(() => {
    if (!project?.shots.length) return;
    if (!selectedShotId || !project.shots.some((shot) => shot.id === selectedShotId)) {
      setSelectedShotId(project.shots[0].id);
    }
  }, [project, selectedShotId]);

  useEffect(() => {
    if (!selectedKeyframeId) return;
    if (!project?.keyframes?.some((keyframe) => keyframe.id === selectedKeyframeId)) {
      setSelectedKeyframeId("");
    }
  }, [project, selectedKeyframeId]);

  useEffect(() => {
    if (!previewKeyframeId) return;
    if (!project?.keyframes?.some((keyframe) => keyframe.id === previewKeyframeId)) {
      setPreviewKeyframeId("");
    }
  }, [project, previewKeyframeId]);

  useEffect(() => {
    if (!previewKeyframeId) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setPreviewKeyframeId("");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewKeyframeId]);

  useEffect(() => {
    if (!previewMicroShot) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setPreviewMicroShot(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewMicroShot]);

  useEffect(() => {
    if (!shotEditorOpen) return;
    if (!selectedShot) {
      setShotEditorOpen(false);
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setShotEditorOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedShot, shotEditorOpen]);

  useEffect(() => {
    if (!selectedShot) return;
    setDraft({
      purpose: localizedShotPurpose(selectedShot, pageLang),
      camera: selectedShot.camera,
      action: selectedShot.action,
      imagePrompt: localizedShotPrompt(selectedShot, "image", pageLang),
      videoPrompt: localizedShotPrompt(selectedShot, "video", pageLang),
      negativePrompt: localizedShotNegativePrompt(selectedShot, pageLang),
      subtitle: selectedShot.subtitle,
      durationSeconds: selectedShot.durationSeconds,
      microShots: selectedShot.microShots ?? [],
    });
  }, [selectedShot, pageLang]);

  useEffect(() => {
    if (!selectedKeyframe) return;
    setKeyframeDraft({
      purpose: localizedKeyframePurpose(selectedKeyframe, pageLang),
      imagePrompt: localizedKeyframeImagePrompt(selectedKeyframe, pageLang),
      negativePrompt: localizedKeyframeNegativePrompt(selectedKeyframe, pageLang),
    });
  }, [selectedKeyframe, pageLang]);

  const rememberProject = useCallback((nextProject: VideoProject) => {
    setProjects((current) => sortProjects(upsertProject(current, nextProject)));
    setProject((current) => {
      if (current?.id === nextProject.id || selectedProjectId === nextProject.id) return nextProject;
      return current;
    });
  }, [selectedProjectId]);

  const syncProject = useCallback(async (projectId: string, options?: { silent?: boolean }) => {
    try {
      const res = await fetchJson(`/api/video-projects/${projectId}/sync`, copy, { method: "POST" });
      if (res.project) rememberProject(res.project);
    } catch (err) {
      if (!options?.silent) setError(err instanceof Error ? err.message : copy.actionFailed);
    }
  }, [copy, rememberProject]);

  useEffect(() => {
    if (!runningProjectIds.length) return;
    const timer = window.setInterval(() => {
      for (const projectId of runningProjectIds) void syncProject(projectId, { silent: projectId !== selectedProjectId });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [runningProjectIds, selectedProjectId, syncProject]);

  useEffect(() => {
    if (!optimisticProgress?.active || !generationProjectId || project?.id !== generationProjectId) return;
    // The resume request may spend time selecting references before the server
    // returns the new project status. Keep the optimistic progress visible
    // instead of immediately restoring the stale FAILED/stopped banner.
    if (loading) return;
    if (project && !RUNNING_PROJECT_STATUSES.includes(project.status) && !hasRunningMicroShotImage(project)) {
      setGenerationAbortController(null);
      setGenerationProjectId("");
      setOptimisticProgress(null);
    }
  }, [generationProjectId, loading, optimisticProgress?.active, project]);

  async function loadProjects() {
    try {
      const res = await fetchJson("/api/video-projects", copy);
      const nextProjects = sortProjects(res.projects ?? []);
      setProjects(nextProjects);
      if (!nextProjects.length) return;
      const storedId = typeof window !== "undefined" ? window.localStorage.getItem(PROJECT_STORAGE_KEY) || "" : "";
      const active = nextProjects.find((item) => item.id === storedId) ?? nextProjects[0];
      activateProject(active);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.loadFailed);
    }
  }

  function activateProject(nextProject: VideoProject) {
    const nextView = projectViewForStatus(nextProject.status);
    const firstAssetKeyframe = nextProject.keyframes?.filter((keyframe) => keyframe.keyframeNo < 0).sort((a, b) => assetKeyframeSortRank(a) - assetKeyframeSortRank(b))[0];
    const firstBoundaryKeyframe = nextProject.keyframes?.filter((keyframe) => keyframe.keyframeNo > 0).sort((a, b) => a.keyframeNo - b.keyframeNo)[0];
    setSelectedProjectId(nextProject.id);
    setProject(nextProject);
    setSelectedShotId(nextView === "clips" ? nextProject.shots[0]?.id ?? "" : "");
    setSelectedKeyframeId(nextView === "assets" ? firstAssetKeyframe?.id ?? "" : nextView === "frames" ? firstBoundaryKeyframe?.id ?? "" : "");
    setShotEditorOpen(false);
    setProjectView(nextView);
    setPrompt(nextProject.userPrompt);
    setReferenceImageUrls(nextProject.referenceImageUrls ?? []);
    setAspectRatio(nextProject.aspectRatio);
    setDurationSeconds(nextProject.durationSeconds || 30);
    const projectStylePreset = nextProject.stylePreset || "cinematic";
    if (KNOWN_STYLE_PRESETS.has(projectStylePreset)) {
      setStylePreset(projectStylePreset);
      setCustomStylePreset("");
    } else {
      setStylePreset(CUSTOM_STYLE_VALUE);
      setCustomStylePreset(projectStylePreset);
    }
    if (typeof window !== "undefined") window.localStorage.setItem(PROJECT_STORAGE_KEY, nextProject.id);
    void syncProject(nextProject.id, { silent: true });
  }

  function selectShot(shotId: string) {
    setProjectView("clips");
    setSelectedShotId(shotId);
    setSelectedKeyframeId("");
  }

  function selectKeyframe(keyframeId: string) {
    const keyframe = project?.keyframes?.find((item) => item.id === keyframeId);
    setProjectView(keyframe && keyframe.keyframeNo < 0 ? "assets" : "frames");
    setSelectedKeyframeId(keyframeId);
    setSelectedShotId("");
    setShotEditorOpen(false);
  }

  function previewDetailHeight(height: number) {
    const next = clampDetailPreviewHeight(height);
    detailPanelRef.current?.style.setProperty("--detail-preview-height", `${next}px`);
  }

  function commitDetailHeight(height: number) {
    const next = clampDetailPreviewHeight(height);
    detailPanelRef.current?.style.setProperty("--detail-preview-height", `${next}px`);
    setDetailPreviewHeight(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DETAIL_PREVIEW_HEIGHT_STORAGE_KEY, String(next));
    }
  }

  function openShotEditor(shotId: string) {
    selectShot(shotId);
    setShotEditorOpen(true);
  }

  function beginEditProject(nextProject: VideoProject) {
    setEditingProjectId(nextProject.id);
    setEditingTitle(nextProject.title || nextProject.userPrompt.slice(0, 32));
  }

  function cancelEditProject() {
    setEditingProjectId("");
    setEditingTitle("");
  }

  async function saveProjectTitle(projectId: string) {
    const title = editingTitle.trim();
    await runAction(async () => {
      const res = await fetchJson(`/api/video-projects/${projectId}`, copy, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
      if (!res.project) throw new Error(copy.saveFailed);
      rememberProject(res.project);
      cancelEditProject();
      setMessage(copy.projectRenamed);
    });
  }

  async function deleteProject(projectId: string) {
    if (deletingProjectId) return;
    if (typeof window !== "undefined" && !window.confirm(copy.deleteProjectConfirm)) return;
    setDeletingProjectId(projectId);
    setError("");
    setMessage("");
    try {
      await fetchJson(`/api/video-projects/${projectId}`, copy, { method: "DELETE" });
      const remainingProjects = sortProjects(projects.filter((item) => item.id !== projectId));
      setProjects(remainingProjects);
      cancelEditProject();
      if (selectedProjectId === projectId) {
        const nextProject = remainingProjects[0];
        if (nextProject) {
          activateProject(nextProject);
        } else {
          setSelectedProjectId("");
          setProject(null);
          setSelectedShotId("");
          setSelectedKeyframeId("");
          setShotEditorOpen(false);
          setDraft({});
          setKeyframeDraft({});
          setPrompt(copy.defaultPrompt);
          setReferenceImageUrls([]);
          setAspectRatio("9:16");
          setDurationSeconds(30);
          setStylePreset("guofeng");
          setCustomStylePreset("");
          if (typeof window !== "undefined") window.localStorage.removeItem(PROJECT_STORAGE_KEY);
        }
      }
      setMessage(copy.projectDeleted);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.actionFailed);
    } finally {
      setDeletingProjectId("");
    }
  }

  function startNewProject() {
    setSelectedProjectId("");
    setProject(null);
    setSelectedShotId("");
    setSelectedKeyframeId("");
    setShotEditorOpen(false);
    setDraft({});
    setKeyframeDraft({});
    cancelEditProject();
    setPrompt(copy.defaultPrompt);
    setReferenceImageUrls([]);
    setAspectRatio("9:16");
    setDurationSeconds(30);
    setStylePreset("guofeng");
    setCustomStylePreset("");
    setError("");
    setMessage("");
    setOptimisticProgress(null);
    if (typeof window !== "undefined") window.localStorage.removeItem(PROJECT_STORAGE_KEY);
  }

  async function uploadReferenceImages(files: FileList | null) {
    if (!files?.length) return;
    const remaining = Math.max(0, 4 - referenceImageUrls.length);
    const images = Array.from(files).filter((file) => file.type.startsWith("image/")).slice(0, remaining);
    if (!images.length) return;
    setUploadingReferences(true);
    setError("");
    setMessage("");
    try {
      const uploaded: string[] = [];
      for (const file of images) {
        uploaded.push(await uploadReferenceImage(file));
      }
      setReferenceImageUrls((current) => [...current, ...uploaded].slice(0, 4));
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.uploadReferenceFailed);
    } finally {
      setUploadingReferences(false);
    }
  }

  function removeReferenceImage(url: string) {
    setReferenceImageUrls((current) => current.filter((item) => item !== url));
  }

  async function createAndPlan() {
    if (!canCreateAndPlan) return;
    setCreatingPlan(true);
    setError("");
    setMessage("");
    const startedAt = Date.now();
    setProgressNow(startedAt);
    setOptimisticProgress({ active: true, phase: "creating", percent: 3, startedAt });
    try {
      const totalDurationSeconds = clampProjectDuration(durationSeconds);
      const planPayload = {
        userPrompt: prompt,
        aspectRatio,
        durationSeconds: totalDurationSeconds,
        stylePreset: effectiveStylePreset,
        referenceImageUrls,
      };
      const created = project?.status === "DRAFT"
        ? { project }
        : await fetchJson("/api/video-projects", copy, {
          method: "POST",
          body: JSON.stringify(planPayload),
        });
      if (!created.project) throw new Error(copy.createFailed);
      const planningProject: VideoProject = { ...created.project, status: "PLANNING", errorMessage: null };
      setPlanningProjectIds((current) => current.includes(planningProject.id) ? current : [...current, planningProject.id]);
      rememberProject(planningProject);
      activateProject(planningProject);
      setMessage(copy.generating);
      void planProjectInBackground(planningProject.id, planPayload);
    } catch (err) {
      setOptimisticProgress(null);
      setError(err instanceof Error ? err.message : copy.createFailed);
    } finally {
      setCreatingPlan(false);
    }
  }

  async function planProjectInBackground(projectId: string, planPayload: {
    userPrompt: string;
    aspectRatio: AspectRatio;
    durationSeconds: number;
    stylePreset: string;
    referenceImageUrls: string[];
  }) {
    try {
      const planned = await fetchJson(`/api/video-projects/${projectId}/plan`, copy, {
        method: "POST",
        body: JSON.stringify(planPayload),
      });
      if (!planned.project) throw new Error(copy.planFailed);
      rememberProject(planned.project);
      setOptimisticProgress(null);
      if (selectedProjectIdRef.current === projectId) {
        setMessage(planned.project.status === "PLANNING" ? copy.generating : copy.planned);
      }
    } catch (planError) {
      try {
        const synced = await fetchJson(`/api/video-projects/${projectId}/sync`, copy, { method: "POST" });
        if (synced.project) {
          rememberProject(synced.project);
          if (synced.project.status === "PLANNING" || synced.project.status === "PLAN_REVIEW") return;
        }
      } catch {
        // Keep the original planning error visible below.
      }
      setOptimisticProgress(null);
      if (selectedProjectIdRef.current === projectId) setError(planError instanceof Error ? planError.message : copy.planFailed);
    } finally {
      setPlanningProjectIds((current) => current.filter((id) => id !== projectId));
    }
  }

  async function stopGeneration() {
    const projectId = project?.id || generationProjectId || "";
    if (!projectId) return;
    setStoppingGeneration(true);
    if (generationProjectId === projectId) generationAbortController?.abort();
    setOptimisticProgress(null);
    setPlanningProjectIds((current) => current.filter((id) => id !== projectId));
    try {
      if (projectId) {
        const res = await fetchJson(`/api/video-projects/${projectId}/cancel`, copy, { method: "POST" });
        if (res.project) {
          rememberProject(res.project);
          if (project?.id === res.project.id || selectedProjectId === res.project.id || generationProjectId === res.project.id) activateProject(res.project);
        }
      }
      setMessage(copy.generationStopped);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.actionFailed);
    } finally {
      setStoppingGeneration(false);
      setLoading(false);
      if (generationProjectId === projectId) {
        setGenerationAbortController(null);
        setGenerationProjectId("");
      }
    }
  }

  async function resumeProject() {
    if (!project) return;
    const controller = new AbortController();
    const requiresFullReplan =
      project.status === "FAILED" &&
      project.shots.length === 0 &&
      (project.keyframes?.length ?? 0) === 0 &&
      (project.segments?.length ?? 0) === 0;
    if (requiresFullReplan) {
      const projectId = project.id;
      const planningProject: VideoProject = { ...project, status: "PLANNING", errorMessage: null };
      setError("");
      setMessage(copy.resumeStarted);
      setGenerationAbortController(controller);
      setGenerationProjectId(projectId);
      setStoppingGeneration(false);
      setPlanningProjectIds((current) => current.includes(projectId) ? current : [...current, projectId]);
      setOptimisticProgress({ active: true, phase: "waiting", percent: Math.max(workflowProgress?.percent ?? 8, 10), startedAt: Date.now() });
      rememberProject(planningProject);
      activateProject(planningProject);
      void resumePlanningProjectInBackground(projectId, controller);
      return;
    }
    let resumedRunning = false;
    setGenerationAbortController(controller);
    setGenerationProjectId(project.id);
    setStoppingGeneration(false);
    setOptimisticProgress({ active: true, phase: "waiting", percent: Math.max(workflowProgress?.percent ?? 8, 10), startedAt: Date.now() - 110000 });
    await runAction(async () => {
      const res = await fetchJson(`/api/video-projects/${project.id}/resume`, copy, {
        method: "POST",
        signal: controller.signal,
      });
      if (!res.project) throw new Error(copy.actionFailed);
      rememberProject(res.project);
      activateProject(res.project);
      setProjectView(projectViewForStatus(res.project.status));
      resumedRunning = RUNNING_PROJECT_STATUSES.includes(res.project.status);
      if (!resumedRunning) {
        setOptimisticProgress(null);
        setGenerationAbortController(null);
        setGenerationProjectId("");
      }
      setMessage(copy.resumeStarted);
    });
    if (!resumedRunning && !controller.signal.aborted) {
      setGenerationAbortController(null);
      setGenerationProjectId("");
      setOptimisticProgress((current) => current?.phase === "stopped" ? current : null);
    }
  }

  async function resumePlanningProjectInBackground(projectId: string, controller: AbortController) {
    try {
      const res = await fetchJson(`/api/video-projects/${projectId}/resume`, copy, {
        method: "POST",
        signal: controller.signal,
      });
      if (!res.project) throw new Error(copy.actionFailed);
      rememberProject(res.project);
      setOptimisticProgress(null);
      if (selectedProjectIdRef.current === projectId) setMessage(copy.resumeStarted);
    } catch (resumeError) {
      if (resumeError instanceof DOMException && resumeError.name === "AbortError") {
        if (selectedProjectIdRef.current === projectId) setMessage(copy.generationStopped);
      } else {
        try {
          await syncProject(projectId, { silent: true });
        } catch {
          // Keep the original resume error visible below.
        }
        setOptimisticProgress(null);
        if (selectedProjectIdRef.current === projectId) {
          setError(resumeError instanceof Error ? resumeError.message : copy.actionFailed);
        }
      }
    } finally {
      setPlanningProjectIds((current) => current.filter((id) => id !== projectId));
      setGenerationAbortController((current) => current === controller ? null : current);
      setGenerationProjectId((current) => current === projectId ? "" : current);
    }
  }

  function updateDraftMicroShot(index: number, patch: Partial<MicroShot>) {
    setDraft((current) => {
      const items = [...((current.microShots as MicroShot[] | undefined) ?? [])];
      const existing = items[index];
      if (!existing) return current;
      items[index] = { ...existing, ...patch };
      return { ...current, microShots: items };
    });
  }

  function undoKeyframeField(field: "purpose" | "imagePrompt" | "negativePrompt") {
    if (!selectedKeyframe) return;
    const value = field === "purpose"
      ? localizedKeyframePurpose(selectedKeyframe, pageLang)
      : field === "imagePrompt"
        ? localizedKeyframeImagePrompt(selectedKeyframe, pageLang)
        : localizedKeyframeNegativePrompt(selectedKeyframe, pageLang);
    setKeyframeDraft((current) => ({ ...current, [field]: value }));
  }

  function keyframeFieldChanged(field: "purpose" | "imagePrompt" | "negativePrompt"): boolean {
    if (!selectedKeyframe) return false;
    const original = field === "purpose"
      ? localizedKeyframePurpose(selectedKeyframe, pageLang)
      : field === "imagePrompt"
        ? localizedKeyframeImagePrompt(selectedKeyframe, pageLang)
        : localizedKeyframeNegativePrompt(selectedKeyframe, pageLang);
    return String(keyframeDraft[field] ?? "") !== original;
  }

  function originalShotDraftValue(field: "durationSeconds" | "purpose" | "action" | "camera" | "subtitle" | "videoPrompt"): string | number {
    if (!selectedShot) return "";
    if (field === "purpose") return localizedShotPurpose(selectedShot, pageLang);
    if (field === "videoPrompt") return localizedShotPrompt(selectedShot, "video", pageLang);
    return selectedShot[field] ?? "";
  }

  function undoShotField(field: "durationSeconds" | "purpose" | "action" | "camera" | "subtitle" | "videoPrompt") {
    setDraft((current) => ({ ...current, [field]: originalShotDraftValue(field) }));
  }

  function shotFieldChanged(field: "durationSeconds" | "purpose" | "action" | "camera" | "subtitle" | "videoPrompt"): boolean {
    return String(draft[field] ?? "") !== String(originalShotDraftValue(field));
  }

  function undoDraftMicroShot(index: number) {
    const current = ((draft.microShots as MicroShot[] | undefined) ?? [])[index];
    if (!current) return;
    const original = selectedShot?.microShots?.find((item) => item.microShotNo === current.microShotNo);
    if (!original) {
      removeDraftMicroShot(index);
      return;
    }
    setDraft((value) => {
      const items = [...((value.microShots as MicroShot[] | undefined) ?? [])];
      items[index] = original;
      return { ...value, microShots: items };
    });
  }

  function microShotChanged(index: number): boolean {
    const current = ((draft.microShots as MicroShot[] | undefined) ?? [])[index];
    if (!current) return false;
    const original = selectedShot?.microShots?.find((item) => item.microShotNo === current.microShotNo);
    return !original || JSON.stringify(current) !== JSON.stringify(original);
  }

  function addDraftMicroShot() {
    setDraft((current) => {
      const items = [...((current.microShots as MicroShot[] | undefined) ?? [])];
      const duration = Number(current.durationSeconds ?? selectedShot?.durationSeconds ?? 3);
      const localTimeSeconds = Math.max(0, Math.min(duration, items.length ? Math.round(duration / 2) : 0));
      items.push({
        microShotNo: items.length + 1,
        localTimeSeconds,
        absoluteTimeSeconds: (selectedShot?.startTimeSeconds ?? 0) + localTimeSeconds,
        purpose: "",
        scene: "",
        action: "",
        camera: "",
        referenceType: "mixed",
        imagePrompt: "",
        prompt: "",
      });
      return { ...current, microShots: items };
    });
  }

  function removeDraftMicroShot(index: number) {
    setDraft((current) => ({
      ...current,
      microShots: ((current.microShots as MicroShot[] | undefined) ?? [])
        .filter((_, itemIndex) => itemIndex !== index)
        .map((item, itemIndex) => ({ ...item, microShotNo: itemIndex + 1 })),
    }));
  }

  async function saveShot() {
    if (!project || !selectedShot) return;
    if (!confirmArtifactImpact(project, [`segment:${selectedShot.shotNo}`], pageLang)) return;
    await runAction(async () => {
      const res = await fetchJson(`/api/video-projects/${project.id}/shots/${selectedShot.id}`, copy, {
        method: "PATCH",
        body: JSON.stringify({
          purpose: draft.purpose,
          camera: draft.camera,
          action: draft.action,
          videoPrompt: draft.videoPrompt,
          negativePrompt: draft.negativePrompt,
          subtitle: draft.subtitle,
          durationSeconds: draft.durationSeconds,
          microShots: draft.microShots,
          locale: pageLang,
        }),
      });
      if (!res.project) throw new Error(copy.saveFailed);
      rememberProject(res.project);
      setMessage(copy.saved(selectedShot.shotNo));
    });
  }

  async function generateMicroShotImage(index: number) {
    if (!project || !selectedShot) return;
    const microShot = ((draft.microShots as MicroShot[] | undefined) ?? [])[index];
    if (!microShot) return;
    await runAction(async () => {
      const res = await fetchJson(
        `/api/video-projects/${project.id}/shots/${selectedShot.id}/micro-shots/${index + 1}/image`,
        copy,
        {
          method: "POST",
          body: JSON.stringify({
            locale: pageLang,
            microShot: {
              ...microShot,
              microShotNo: index + 1,
            },
          }),
        },
      );
      if (!res.project) throw new Error(copy.regenerateFailed);
      rememberProject(res.project);
      setMessage(copy.microShotImageRunning);
    });
  }

  async function saveKeyframe() {
    if (!project || !selectedKeyframe || !hasUnsavedKeyframeChanges) return;
    const targetId = selectedKeyframe.keyframeNo < 0 ? `consistency_reference:${selectedKeyframe.keyframeNo}` : `keyframe:${selectedKeyframe.keyframeNo}`;
    if (!confirmArtifactImpact(project, [`${targetId}:prompt`, `${targetId}:image`], pageLang)) return;
    await runAction(async () => {
      const res = await fetchJson(`/api/video-projects/${project.id}/shots/${selectedKeyframe.id}`, copy, {
        method: "PATCH",
        body: JSON.stringify({ ...keyframeDraft, locale: pageLang }),
      });
      if (!res.project) throw new Error(copy.saveFailed);
      const updatedKeyframe = res.project.keyframes?.find((keyframe: VideoKeyframe) => keyframe.id === selectedKeyframe.id);
      rememberProject(res.project);
      if (updatedKeyframe) {
        setSelectedKeyframeId(updatedKeyframe.id);
        setKeyframeDraft({
          purpose: localizedKeyframePurpose(updatedKeyframe, pageLang),
          imagePrompt: localizedKeyframeImagePrompt(updatedKeyframe, pageLang),
          negativePrompt: localizedKeyframeNegativePrompt(updatedKeyframe, pageLang),
        });
      }
      setMessage(copy.changesSaved);
    });
  }

  async function saveDebugSection(section: EditableDebugSection) {
    if (!project) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(debugDraft[section]);
    } catch {
      setError(debugCopy.invalidJson);
      return;
    }
    if (!Array.isArray(parsed)) {
      setError(debugCopy.arrayRequired);
      return;
    }
    const impactRoot = section === "events" ? "planning:narrative_events" : section === "anchors" ? "planning:consistency_manifest" : "planning:anchor_state_timeline";
    if (!confirmArtifactImpact(project, [impactRoot], pageLang)) return;
    const planDebugPatch =
      section === "events"
        ? { narrativeEvents: parsed }
        : section === "anchors"
          ? { consistencyAnchors: parsed }
          : { anchorStateTimeline: parsed };

    await runAction(async () => {
      const res = await fetchJson(`/api/video-projects/${project.id}`, copy, {
        method: "PATCH",
        body: JSON.stringify({ planDebugPatch }),
      });
      if (!res.project) throw new Error(copy.saveFailed);
      rememberProject(res.project);
      setMessage(debugCopy.saved);
    });
  }

  async function saveNarrativeSkeleton(draftValue: NarrativeSkeletonDraft) {
    if (!project) return;
    if (!confirmArtifactImpact(project, ["planning:creative_strategy", "planning:story_beats", "planning:shot_grouping_pass"], pageLang)) return;
    await runAction(async () => {
      const res = await fetchJson(`/api/video-projects/${project.id}`, copy, {
        method: "PATCH",
        body: JSON.stringify({
          planDebugPatch: {
            creativeStrategy: draftValue.creativeStrategy,
            storyBeats: draftValue.storyBeats,
            storyQualityReport: draftValue.storyQualityReport,
            shotGroupingPass: draftValue.shotGroupingPass,
          },
        }),
      });
      if (!res.project) throw new Error(copy.saveFailed);
      rememberProject(res.project);
      setMessage(pageLang === "zh" ? "剧情骨架已保存；资产库、边界帧、子分镜和视频片段已标记为需要重跑。" : "Narrative skeleton saved; assets, boundary frames, micro-shots, and clips were marked dirty.");
    });
  }

  function originalDebugSection(section: EditableDebugSection): string {
    const value = section === "events"
      ? project?.planDebug?.narrativeEvents
      : section === "anchors"
        ? project?.planDebug?.consistencyAnchors
        : project?.planDebug?.anchorStateTimeline;
    return prettyDebugJson(value ?? []);
  }

  function undoDebugSection(section: EditableDebugSection) {
    setDebugDraft((current) => ({ ...current, [section]: originalDebugSection(section) }));
  }

  async function approvePlan() {
    if (!project) return;
    await runAction(async () => {
      const res = await fetchJson(`/api/video-projects/${project.id}/approve-plan`, copy, { method: "POST" });
      if (!res.project) throw new Error(copy.keyframeFailed);
      rememberProject(res.project);
      setMessage(copy.keyframesReady);
    });
  }

  async function regenerateImage(shotId: string) {
    if (!project) return;
    if (selectedKeyframe?.id === shotId && hasUnsavedKeyframeChanges) {
      const targetId = selectedKeyframe.keyframeNo < 0 ? `consistency_reference:${selectedKeyframe.keyframeNo}` : `keyframe:${selectedKeyframe.keyframeNo}`;
      if (!confirmArtifactImpact(project, [`${targetId}:prompt`, `${targetId}:image`], pageLang)) return;
    }
    await runAction(async () => {
      if (selectedKeyframe?.id === shotId && hasUnsavedKeyframeChanges) {
        const saved = await fetchJson(`/api/video-projects/${project.id}/shots/${shotId}`, copy, {
          method: "PATCH",
          body: JSON.stringify({ ...keyframeDraft, locale: pageLang }),
        });
        if (!saved.project) throw new Error(copy.saveFailed);
      }
      const res = await fetchJson(`/api/video-projects/${project.id}/shots/${shotId}/image`, copy, { method: "POST" });
      if (!res.project) throw new Error(copy.regenerateFailed);
      rememberProject(res.project);
      setMessage(copy.keyframeRegenerated);
    });
  }

  async function regenerateClip(shotId: string) {
    if (!project) return;
    if (selectedShot?.id === shotId && !confirmArtifactImpact(project, [`segment:${selectedShot.shotNo}:prompt`], pageLang)) return;
    await runAction(async () => {
      if (selectedShot?.id === shotId) {
        const saved = await fetchJson(`/api/video-projects/${project.id}/shots/${shotId}`, copy, {
          method: "PATCH",
          body: JSON.stringify({
            purpose: draft.purpose,
            camera: draft.camera,
            action: draft.action,
            videoPrompt: draft.videoPrompt,
            negativePrompt: draft.negativePrompt,
            subtitle: draft.subtitle,
            durationSeconds: draft.durationSeconds,
            microShots: draft.microShots,
            locale: pageLang,
          }),
        });
        if (!saved.project) throw new Error(copy.saveFailed);
      }
      const res = await fetchJson(`/api/video-projects/${project.id}/shots/${shotId}/clip`, copy, { method: "POST" });
      if (!res.project) throw new Error(copy.regenerateFailed);
      rememberProject(res.project);
      setProjectView("clips");
      setMessage(copy.resumeStarted);
    });
  }

  async function rollbackMedia(kind: MediaRevisionKind, targetId: string, microShotNo?: number) {
    if (!project) return;
    if (typeof window !== "undefined" && !window.confirm(copy.rollbackMediaConfirm)) return;
    await runAction(async () => {
      const res = await fetchJson(`/api/video-projects/${project.id}/media-revisions/rollback`, copy, {
        method: "POST",
        body: JSON.stringify({ kind, targetId, microShotNo }),
      });
      if (!res.project) throw new Error(copy.actionFailed);
      rememberProject(res.project);
      setMessage(copy.mediaRolledBack);
    });
  }

  async function chooseGenerationCandidate(candidate: GenerationCandidate) {
    if (!project) return;
    const acceptFailed = candidate.passed !== true;
    if (acceptFailed && typeof window !== "undefined" && !window.confirm(pageLang === "zh" ? "该候选未通过视觉质量检查。仍要人工接受并切换到它吗？原始 passed=false 会保留。" : "This candidate failed visual quality review. Accept it manually and switch anyway? The original passed=false will be retained.")) return;
    await runAction(async () => {
      const res = await fetchJson(`/api/video-projects/${project.id}/generation-candidates/${candidate.id}/select`, copy, {
        method: "POST",
        body: JSON.stringify({ acceptFailed }),
      });
      if (!res.project) throw new Error(copy.actionFailed);
      rememberProject(res.project);
      setMessage(pageLang === "zh" ? "已切换生成候选" : "Generation candidate selected");
    });
  }

  async function toggleLock(shot: Pick<VideoShot | VideoKeyframe, "id" | "locked">) {
    if (!project) return;
    await runAction(async () => {
      const res = await fetchJson(`/api/video-projects/${project.id}/shots/${shot.id}`, copy, {
        method: "PATCH",
        body: JSON.stringify({ locked: !shot.locked }),
      });
      if (!res.project) throw new Error(copy.lockFailed);
      rememberProject(res.project);
      setMessage(shot.locked ? copy.updated : copy.referenceApproved);
    });
  }

  async function approveImages() {
    if (!project) return;
    await runAction(async () => {
      const res = await fetchJson(`/api/video-projects/${project.id}/approve-images`, copy, { method: "POST" });
      if (!res.project) throw new Error(copy.approveFailed);
      rememberProject(res.project);
      setMessage(copy.framesApproved);
    });
  }

  async function approveAssets() {
    if (!project) return;
    await runAction(async () => {
      const res = await fetchJson(`/api/video-projects/${project.id}/approve-assets`, copy, { method: "POST" });
      if (!res.project) throw new Error(copy.approveFailed);
      rememberProject(res.project);
      setProjectView("frames");
      setSelectedKeyframeId(res.project.keyframes?.find((keyframe: VideoKeyframe) => keyframe.keyframeNo > 0)?.id ?? "");
      setMessage(copy.referenceApproved);
    });
  }

  async function approveMicroShots() {
    if (!project) return;
    await runAction(async () => {
      const res = await fetchJson(`/api/video-projects/${project.id}/approve-micro-shots`, copy, { method: "POST" });
      if (!res.project) throw new Error(copy.approveFailed);
      rememberProject(res.project);
      setMessage(copy.microShotsApproved);
    });
  }

  async function approveClips() {
    if (!project) return;
    await runAction(async () => {
      const res = await fetchJson(`/api/video-projects/${project.id}/compose`, copy, { method: "POST" });
      if (!res.project) throw new Error(copy.approveFailed);
      rememberProject(res.project);
      setMessage(copy.clipsComposed);
    });
  }

  async function recomposeFinalVideo() {
    if (!project) return;
    await runAction(async () => {
      const res = await fetchJson(`/api/video-projects/${project.id}/compose`, copy, { method: "POST" });
      if (!res.project) throw new Error(copy.approveFailed);
      rememberProject(res.project);
      setProjectView("final");
      setMessage(copy.clipsComposed);
    });
  }

  async function confirmFinal() {
    if (!project) return;
    await runAction(async () => {
      const res = await fetchJson(`/api/video-projects/${project.id}/finish`, copy, { method: "POST" });
      if (!res.project) throw new Error(copy.approveFailed);
      rememberProject(res.project);
      setMessage(copy.finalApproved);
    });
  }

  async function rollbackProject(targetStatus: RollbackTarget) {
    if (!project || !rollbackOptions.includes(targetStatus)) return;
    if (!window.confirm(`${copy.rollbackConfirm}\n\n${copy.rollbackTo}: ${copy.rollbackTargets[targetStatus]}`)) return;
    await runAction(async () => {
      const res = await fetchJson(`/api/video-projects/${project.id}/rollback`, copy, {
        method: "POST",
        body: JSON.stringify({ targetStatus }),
      });
      if (!res.project) throw new Error(copy.approveFailed);
      rememberProject(res.project);
      setProjectView(projectViewForStatus(res.project.status));
      setSelectedShotId(res.project.shots[0]?.id ?? "");
      setSelectedKeyframeId(res.project.keyframes?.[0]?.id ?? "");
      setMessage(copy.rollbackDone);
    });
  }

  async function runAction(action: () => Promise<void>) {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setMessage(copy.generationStopped);
      } else {
        setError(err instanceof Error ? err.message : copy.actionFailed);
      }
    } finally {
      setLoading(false);
    }
  }

  const primaryStageAction: {
    label: string;
    icon: ReactNode;
    onClick: () => void;
    className: string;
  } | null = (() => {
    if (!project) return null;
    if (canApproveAssets) {
      return {
        label: copy.approveAssets,
        icon: <FolderOpen className="h-4 w-4" />,
        onClick: approveAssets,
        className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/15",
      };
    }
    if (project.status === "FAILED") {
      return {
        label: copy.resumeGeneration,
        icon: <RefreshCw className="h-4 w-4" />,
        onClick: resumeProject,
        className: "border-amber-300/30 bg-amber-300/10 text-amber-100 hover:bg-amber-300/15",
      };
    }
    if (canApproveScript) {
      return {
        label: copy.approveScript,
        icon: <ImageIcon className="h-4 w-4" />,
        onClick: approvePlan,
        className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/15",
      };
    }
    if (canContinueBoundaryFrames) {
      return {
        label: copy.continueBoundaryFrames,
        icon: <RefreshCw className="h-4 w-4" />,
        onClick: resumeProject,
        className: "border-cyan-400/30 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/15",
      };
    }
    if (canApproveFrames) {
      return {
        label: copy.approveFrames,
        icon: <Check className="h-4 w-4" />,
        onClick: approveImages,
        className: "border-cyan-400/30 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/15",
      };
    }
    if (canApproveMicroShots) {
      return {
        label: copy.approveMicroShots,
        icon: <ImageIcon className="h-4 w-4" />,
        onClick: approveMicroShots,
        className: "border-fuchsia-300/30 bg-fuchsia-300/10 text-fuchsia-100 hover:bg-fuchsia-300/15",
      };
    }
    if (canApproveClips) {
      return {
        label: copy.approveClips,
        icon: <Clapperboard className="h-4 w-4" />,
        onClick: approveClips,
        className: "border-cyan-400/30 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/15",
      };
    }
    if (canConfirmFinal && project.status !== "DONE") {
      return {
        label: copy.confirmFinal,
        icon: <Check className="h-4 w-4" />,
        onClick: confirmFinal,
        className: "border-amber-300/30 bg-amber-300/10 text-amber-100 hover:bg-amber-300/15",
      };
    }
    return null;
  })();

  return (
    <div className="one-prompt-video-workbench min-h-full bg-[#070b16] text-slate-100">
      <div className="mx-auto flex max-w-[1480px] flex-col gap-4 px-4 py-5 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-white/10 bg-slate-950/80 px-4 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200">
              <Sparkles className="h-3.5 w-3.5" />
              ONE_PROMPT_30S_VIDEO
            </div>
            <h1 className="text-2xl font-semibold tracking-normal text-white">{copy.title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button
              type="button"
              onClick={toggleLang}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 text-sm font-medium text-slate-200 hover:border-cyan-400/30 hover:bg-white/[0.08]"
            >
              <Languages className="h-4 w-4" />
              {copy.languageButton}
            </button>
          </div>
        </header>

        <section className="overflow-hidden rounded-md border border-white/10 bg-slate-950/70 shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-white">{copy.setupPanel}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSetupPanelCollapsed((value) => !value)}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 text-sm font-medium text-slate-200 hover:border-cyan-400/30 hover:bg-white/[0.08]"
            >
              {setupPanelCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              {setupPanelCollapsed ? copy.expandSetup : copy.collapseSetup}
            </button>
          </div>

          {!setupPanelCollapsed && (
          <div className="grid gap-4 border-t border-white/10 p-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <section className="space-y-3 rounded-md border border-white/10 bg-slate-950/70 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 text-sm font-medium text-slate-300">
              <FolderOpen className="h-4 w-4 text-cyan-300" />
              {copy.projects}
              <span className="rounded-md border border-white/10 px-2 py-0.5 text-xs text-slate-500">{projects.length}</span>
            </div>
            <button
              type="button"
              onClick={startNewProject}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 text-sm font-medium text-slate-200 hover:border-cyan-400/30 hover:bg-white/[0.08]"
            >
              <Plus className="h-4 w-4" />
              {copy.newProject}
            </button>
          </div>
          {projects.length ? (
            <div className="subtle-scrollbar grid max-h-[360px] min-w-0 gap-2 overflow-y-auto overflow-x-hidden pr-1">
              {projects.map((item) => {
                const progress = projectProgress(item);
                const active = item.id === project?.id;
                const editing = editingProjectId === item.id;
                return (
                  <div
                    key={item.id}
                    className={`group relative min-w-0 rounded-md border px-3 py-3 transition ${active ? "border-cyan-400/60 bg-cyan-400/10 shadow-[0_0_0_1px_rgba(34,211,238,0.08)]" : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]"}`}
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      {editing ? (
                        <input
                          value={editingTitle}
                          onChange={(event) => setEditingTitle(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void saveProjectTitle(item.id);
                            if (event.key === "Escape") cancelEditProject();
                          }}
                          className="min-w-0 flex-1 rounded-md border border-cyan-400/40 bg-slate-950 px-2 py-1.5 text-sm font-semibold text-white outline-none"
                          autoFocus
                        />
                      ) : (
                        <button type="button" onClick={() => activateProject(item)} className="block min-w-0 flex-1 overflow-hidden text-left">
                          <p className="block w-full truncate text-sm font-semibold text-white">{item.title || copy.untitled}</p>
                        </button>
                      )}
                      <div
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                        className={`relative z-30 -mt-1 flex shrink-0 items-center gap-1 rounded-md border border-white/10 bg-slate-950/90 p-1 shadow-[0_8px_22px_rgba(0,0,0,0.28)] backdrop-blur transition ${editing ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}
                      >
                        {editing ? (
                          <>
                            <button type="button" onClick={(event) => { event.stopPropagation(); void saveProjectTitle(item.id); }} disabled={loading} title={copy.saveProject} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-emerald-200 hover:bg-emerald-400/10 disabled:opacity-50">
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" onClick={(event) => { event.stopPropagation(); cancelEditProject(); }} disabled={loading} title={copy.cancel} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white/[0.06] disabled:opacity-50">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); beginEditProject(item); }} disabled={loading || Boolean(deletingProjectId)} title={copy.renameProject} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-300 hover:bg-white/[0.08] disabled:opacity-50">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void deleteProject(item.id); }} disabled={Boolean(deletingProjectId)} title={copy.deleteProject} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-300 hover:bg-red-400/10 hover:text-red-200 disabled:opacity-50">
                              {deletingProjectId === item.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-cyan-400" style={{ width: `${progress.percent}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-white/10 px-4 py-4 text-sm text-slate-500">{copy.noProjects}</div>
          )}
        </section>

        <section className="grid gap-3 rounded-md border border-white/10 bg-slate-950/70 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.22)] lg:grid-cols-[minmax(0,1fr)_220px_130px_140px]">
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} className="min-h-24 resize-none rounded-md border border-white/10 bg-slate-900/90 px-4 py-3 text-sm leading-6 text-slate-100 outline-none transition focus:border-cyan-400 focus:bg-slate-900" />
          <div className="space-y-2">
            <select value={stylePreset} onChange={(event) => setStylePreset(event.target.value)} className="h-11 w-full rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400">
              {Object.entries(copy.styles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              <option value={CUSTOM_STYLE_VALUE}>{copy.customStyle}</option>
            </select>
            {stylePreset === CUSTOM_STYLE_VALUE && (
              <input
                value={customStylePreset}
                onChange={(event) => setCustomStylePreset(event.target.value)}
                placeholder={copy.customStylePlaceholder}
                className="h-11 w-full rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-400"
              />
            )}
          </div>
          <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as AspectRatio)} className="h-11 rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400">
            <option value="9:16">9:16</option>
            <option value="16:9">16:9</option>
            <option value="1:1">1:1</option>
          </select>
          <label className="flex h-11 items-center gap-2 rounded-md border border-white/10 bg-slate-900 px-3 transition focus-within:border-cyan-400">
            <span className="shrink-0 text-xs text-slate-500">{copy.totalDuration}</span>
            <input
              type="number"
              min={3}
              max={180}
              step={1}
              value={durationSeconds}
              onChange={(event) => setDurationSeconds(Number(event.target.value))}
              onBlur={() => setDurationSeconds((value) => clampProjectDuration(value))}
              title={copy.totalDurationHint}
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none"
            />
            <span className="text-xs text-slate-500">s</span>
          </label>
          <div className="space-y-3 rounded-md border border-white/10 bg-white/[0.03] p-3 lg:col-span-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-200">{copy.referenceImages}</p>
                <p className="mt-1 text-xs text-slate-500">{copy.referenceImageHint}</p>
              </div>
              <label className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-white/10 px-3 text-sm font-medium text-slate-200 hover:border-cyan-400/30 hover:bg-white/[0.08] ${referenceImageUrls.length >= 4 || uploadingReferences ? "pointer-events-none opacity-50" : "bg-white/[0.04]"}`}>
                {uploadingReferences ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                {uploadingReferences ? copy.uploadingReference : copy.uploadReference}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  disabled={referenceImageUrls.length >= 4 || uploadingReferences}
                  onChange={(event) => {
                    void uploadReferenceImages(event.target.files);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
            {referenceImageUrls.length > 0 && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {referenceImageUrls.map((url) => (
                  <div key={url} className="group relative overflow-hidden rounded-md border border-white/10 bg-slate-900">
                    <img src={previewImageSrc(url)} alt={copy.referenceImages} className="h-28 w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeReferenceImage(url)}
                      title={copy.removeReference}
                      className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md border border-black/30 bg-black/60 text-white opacity-90 hover:bg-red-500"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3 lg:col-span-4">
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={createAndPlan} disabled={!canCreateAndPlan} className="inline-flex h-10 items-center gap-2 rounded-md bg-cyan-400 px-4 text-sm font-semibold text-slate-950 shadow-[0_12px_30px_rgba(34,211,238,0.18)] hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60">
                {planGenerationBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {planGenerationBusy ? copy.generating : copy.generatePlan}
              </button>
            </div>
          </div>
        </section>
          </div>
          )}
        </section>

        {workflowProgress && (
          <section className={`rounded-md border text-sm shadow-[0_12px_40px_rgba(0,0,0,0.18)] transition-all duration-300 ${workflowProgressCollapsed ? "border-white/10 bg-slate-950/70 px-3 py-2" : `px-4 py-3 ${workflowProgressBorderClass}`}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-white">{workflowProgress.title}</p>
                {!workflowProgressCollapsed && <p className="mt-1 text-xs text-slate-400">{workflowProgress.detail}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {canStopGeneration && (
                  <button type="button" onClick={stopGeneration} disabled={stoppingGeneration} className={`inline-flex h-8 items-center gap-2 rounded-md border border-red-300/30 bg-red-400/10 text-xs font-semibold text-red-100 hover:bg-red-400/15 disabled:cursor-not-allowed disabled:opacity-60 ${workflowProgressCollapsed ? "w-8 justify-center px-0" : "px-3"}`} title={copy.stopGeneration}>
                    {stoppingGeneration ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                    {!workflowProgressCollapsed && (stoppingGeneration ? copy.stoppingGeneration : copy.stopGeneration)}
                  </button>
                )}
                <span className="rounded-md border border-white/10 bg-black/20 px-2.5 py-1 text-sm font-semibold text-white">
                  {formatProgressPercent(workflowProgress.percent)}%
                </span>
                <button
                  type="button"
                  onClick={() => setWorkflowProgressCollapsed((current) => !current)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-black/10 text-slate-300 transition hover:border-cyan-300/40 hover:bg-cyan-300/10 hover:text-white"
                  title={workflowProgressCollapsed ? copy.expandSetup : copy.collapseSetup}
                  aria-label={workflowProgressCollapsed ? copy.expandSetup : copy.collapseSetup}
                >
                  {workflowProgressCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            {!workflowProgressCollapsed && (
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/30">
                <div
                  className={`h-full rounded-full transition-all duration-1000 ease-linear ${workflowProgressBarClass} ${workflowProgress.tone === "running" ? "animate-pulse" : ""}`}
                  style={{ width: `${workflowProgress.percent}%` }}
                />
              </div>
            )}
          </section>
        )}

        {(error || (project?.errorMessage && !isManualStopProject(project))) && (
          <div className="rounded-md border border-white/10 bg-slate-900 px-4 py-3 text-sm">
            {error && <p className="text-red-300">{error}</p>}
            {project?.errorMessage && project.errorMessage !== error && !isManualStopProject(project) && <p className="text-amber-300">{project.errorMessage}</p>}
          </div>
        )}

        {project && (
          <section ref={projectLayoutRef} className="grid grid-cols-1 gap-5 rounded-md border border-white/10 bg-slate-950/70 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.24)] xl:flex xl:items-start">
            <main className="min-w-0 space-y-5 xl:flex-1">
              <div className="rounded-md border border-white/10 bg-white/[0.025] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-white">{project.title || copy.untitled}</h2>
                  <p className="mt-1 text-sm text-slate-500">{project.durationSeconds}s / {project.aspectRatio} / {keyframeTotal} {copy.frames} / {segmentTotal} {copy.shots}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setDebugPanelOpen((current) => !current)}
                    className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium transition ${
                      debugPanelOpen
                        ? "border-fuchsia-300/45 bg-fuchsia-300/10 text-fuchsia-100"
                        : "border-white/10 bg-slate-950/50 text-slate-300 hover:border-fuchsia-300/35 hover:bg-white/[0.06]"
                    }`}
                  >
                    <CircleHelp className="h-4 w-4" />
                    {debugCopy.debug}
                  </button>
                  {primaryStageAction && (
                    <button
                      type="button"
                      onClick={primaryStageAction.onClick}
                      disabled={loading}
                      aria-busy={loading}
                      className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium disabled:opacity-50 ${primaryStageAction.className}`}
                    >
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : primaryStageAction.icon}
                      {primaryStageAction.label}
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-3">
                {([
                  { key: "assets" as const, label: copy.assetLibrary, meta: `${completeAssets}/${assetTotal}` },
                  { key: "frames" as const, label: copy.frames, meta: `${completeBoundaryImages}/${boundaryTotal}` },
                  { key: "clips" as const, label: copy.shots, meta: `${completeClips}/${segmentTotal}` },
      { key: "final" as const, label: copy.finalVideo, meta: project.finalVideoUrl ? copy.ready : copy.pending },
                ]).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setProjectView(item.key);
                      if (item.key === "assets") {
                        setSelectedKeyframeId(orderedAssetKeyframes[0]?.id ?? "");
                        setSelectedShotId("");
                      } else if (item.key === "frames") {
                        setSelectedKeyframeId(orderedBoundaryKeyframes[0]?.id ?? "");
                        setSelectedShotId("");
                      } else {
                        setSelectedKeyframeId("");
                      }
                    }}
                    className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium transition ${
                      projectView === item.key
                        ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-100"
                        : "border-white/10 bg-slate-950/50 text-slate-400 hover:border-white/20 hover:bg-white/[0.06]"
                    }`}
                  >
                    <span>{item.label}</span>
                    <span className="rounded bg-black/20 px-1.5 py-0.5 text-[11px] text-slate-400">{item.meta}</span>
                  </button>
                ))}
              </div>
              </div>

              {debugPanelOpen && (
                <PlanDebugPanel
                  lang={pageLang}
                  labels={debugCopy}
                  project={project}
                  activeTab={debugTab}
                  onTabChange={setDebugTab}
                  draft={debugDraft}
                  onDraftChange={(section, value) => setDebugDraft((current) => ({ ...current, [section]: value }))}
                  onSaveSection={saveDebugSection}
                  onUndoSection={undoDebugSection}
                  contextTitle={debugContext.title}
                  referenceSelections={currentReferenceSelections}
                  promptArtifacts={currentPromptDebugArtifacts}
                  dirtyArtifacts={currentDirtyArtifacts}
                  qualityReports={currentQualityReports}
                  selectedSegmentDescription={debugContext.segmentDescription}
                  projectError={project.errorMessage}
                  loading={loading}
                />
              )}

              {projectView === "final" && project.finalVideoUrl && (
                <section className="space-y-3 rounded-md border border-emerald-400/20 bg-emerald-400/5 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-emerald-100">
                    <Clapperboard className="h-4 w-4" />
                    {copy.finalVideo}
                  </div>
                  <div className={`mx-auto overflow-hidden rounded-md border border-white/10 bg-black ${finalVideoPreviewClass(project.aspectRatio)}`}>
                    <video src={project.finalVideoUrl} controls playsInline preload="metadata" className="h-full w-full object-contain" />
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {hasMediaRevision(project, "final_video", "final") && (
                      <button type="button" onClick={() => rollbackMedia("final_video", "final")} disabled={loading} className="inline-flex h-9 items-center gap-2 rounded-md border border-amber-300/30 bg-amber-300/10 px-3 text-sm font-medium text-amber-100 hover:bg-amber-300/15 disabled:opacity-50">
                        <Undo2 className="h-4 w-4" /> {copy.rollbackMedia}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={recomposeFinalVideo}
                      disabled={loading}
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-3 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/15 disabled:opacity-50"
                    >
                      <RefreshCw className="h-4 w-4" />
                      {copy.recomposeFinal}
                    </button>
                  </div>
                </section>
              )}

              {projectView === "final" && !project.finalVideoUrl && (
                <section className="rounded-md border border-white/10 bg-white/[0.03] px-4 py-12 text-center text-sm text-slate-500">
                  {copy.finalVideoNotReady}
                </section>
              )}

              {projectView === "assets" && orderedAssetKeyframes.length ? (
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-slate-200">{copy.assetLibrary} {completeAssets}/{assetTotal}</h3>
                    <span className="text-xs text-slate-500">{copy.assetLibraryHint}</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {orderedAssetKeyframes.map((keyframe) => (
                      <div key={keyframe.id} className={`overflow-hidden rounded-md border bg-white/[0.03] transition ${selectedKeyframe?.id === keyframe.id ? "border-cyan-400/60 shadow-[0_0_0_1px_rgba(34,211,238,0.08)]" : "border-white/10 hover:border-white/20"}`}>
                        <button
                          type="button"
                          onClick={() => {
                            selectKeyframe(keyframe.id);
                            if (keyframe.imageUrl) setPreviewKeyframeId(keyframe.id);
                          }}
                          className={`relative block w-full bg-slate-900 text-left ${aspectClass(project.aspectRatio)}`}
                        >
                          {keyframe.imageUrl ? (
                            <img src={previewImageSrc(keyframe.imageUrl)} alt={safeBoundaryFrameLabel(keyframe, project.durationSeconds, pageLang)} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-sm text-slate-600">{safeBoundaryFrameShortLabel(keyframe, project.durationSeconds, pageLang)}</div>
                          )}
                          <span className="absolute left-2 top-2 rounded-md border border-black/30 bg-black/60 px-2 py-1 text-[11px] font-medium text-white">
                            {safeBoundaryFrameLabel(keyframe, project.durationSeconds, pageLang)}
                          </span>
                          <span className="absolute right-2 top-2 rounded-md border border-black/30 bg-black/60 px-2 py-1 text-[11px] text-white">
                            {shotStatusLabel(keyframe.status, keyframe.errorMessage, copy)}
                          </span>
                          {keyframe.imageUrl && (
                            <span className="absolute bottom-2 right-2 rounded-md border border-black/30 bg-black/60 px-2 py-1 text-[11px] text-white">
                              {copy.preview}
                            </span>
                          )}
                        </button>
                        <div className="space-y-2 px-3 py-3">
                          <button
                            type="button"
                            onClick={() => selectKeyframe(keyframe.id)}
                            className="block w-full space-y-2 rounded-md p-1 text-left outline-none transition hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-cyan-400/70"
                          >
                            <p className="text-sm font-semibold text-white">{localizedKeyframePurpose(keyframe, pageLang)}</p>
                            <p className="line-clamp-2 text-xs leading-5 text-slate-400">{localizedKeyframeImagePrompt(keyframe, pageLang)}</p>
                          </button>
                          {keyframe.imageUrl && !keyframe.locked && keyframe.status !== "IMAGE_APPROVED" && (
                            <button type="button" onClick={() => toggleLock(keyframe)} disabled={loading} className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-400/10 text-xs font-medium text-emerald-100 hover:bg-emerald-400/15 disabled:opacity-50">
                              <Check className="h-3.5 w-3.5" /> {copy.approveReference}
                            </button>
                          )}
                          <button type="button" onClick={() => regenerateImage(keyframe.id)} disabled={loading || Boolean(personDerivedViewWaitReason(keyframe, orderedAssetKeyframes, pageLang))} className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-white/10 text-xs text-slate-300 hover:bg-white/[0.06] disabled:opacity-50">
                            <RefreshCw className="h-3.5 w-3.5" /> {copy.regenerate}
                          </button>
                          {hasMediaRevision(project, "keyframe_image", keyframe.id) && (
                            <button type="button" onClick={() => rollbackMedia("keyframe_image", keyframe.id)} disabled={loading} className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-amber-300/25 bg-amber-300/5 text-xs text-amber-100 hover:bg-amber-300/10 disabled:opacity-50">
                              <Undo2 className="h-3.5 w-3.5" /> {copy.rollbackMedia}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {projectView === "frames" && orderedBoundaryKeyframes.length ? (
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-slate-200">{copy.frames} {completeBoundaryImages}/{boundaryTotal}</h3>
                    <span className="text-xs text-slate-500">{copy.boundaryFrameHint}</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {orderedBoundaryKeyframes.map((keyframe) => (
                      <div key={keyframe.id} className={`overflow-hidden rounded-md border bg-white/[0.03] transition ${selectedKeyframe?.id === keyframe.id ? "border-cyan-400/60 shadow-[0_0_0_1px_rgba(34,211,238,0.08)]" : "border-white/10 hover:border-white/20"}`}>
                        <button
                          type="button"
                          onClick={() => {
                            selectKeyframe(keyframe.id);
                            if (keyframe.imageUrl) setPreviewKeyframeId(keyframe.id);
                          }}
                          className={`relative block w-full bg-slate-900 text-left ${aspectClass(project.aspectRatio)}`}
                        >
                          {keyframe.imageUrl ? (
                            <img src={previewImageSrc(keyframe.imageUrl)} alt={safeBoundaryFrameLabel(keyframe, project.durationSeconds, pageLang)} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-sm text-slate-600">{safeBoundaryFrameShortLabel(keyframe, project.durationSeconds, pageLang)}</div>
                          )}
                          <span className="absolute left-2 top-2 rounded-md border border-black/30 bg-black/60 px-2 py-1 text-[11px] font-medium text-white">
                            {safeBoundaryFrameLabel(keyframe, project.durationSeconds, pageLang)}
                          </span>
                          <span className="absolute right-2 top-2 rounded-md border border-black/30 bg-black/60 px-2 py-1 text-[11px] text-white">
                            {shotStatusLabel(keyframe.status, keyframe.errorMessage, copy)}
                          </span>
                          {keyframe.imageUrl && (
                            <span className="absolute bottom-2 right-2 rounded-md border border-black/30 bg-black/60 px-2 py-1 text-[11px] text-white">
                              {copy.preview}
                            </span>
                          )}
                        </button>
                        <div className="space-y-2 px-3 py-3">
                          <button
                            type="button"
                            onClick={() => selectKeyframe(keyframe.id)}
                            className="block w-full space-y-2 rounded-md p-1 text-left outline-none transition hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-cyan-400/70"
                          >
                            <p className="text-sm font-semibold text-white">{localizedKeyframePurpose(keyframe, pageLang)}</p>
                            <p className="line-clamp-2 text-xs leading-5 text-slate-400">{localizedKeyframeImagePrompt(keyframe, pageLang)}</p>
                          </button>
                          {keyframe.keyframeNo < 0 && keyframe.imageUrl && !keyframe.locked && keyframe.status !== "IMAGE_APPROVED" && (
                            <button type="button" onClick={() => toggleLock(keyframe)} disabled={loading} className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-400/10 text-xs font-medium text-emerald-100 hover:bg-emerald-400/15 disabled:opacity-50">
                              <Check className="h-3.5 w-3.5" /> {copy.approveReference}
                            </button>
                          )}
                          <button type="button" onClick={() => regenerateImage(keyframe.id)} disabled={loading} className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-white/10 text-xs text-slate-300 hover:bg-white/[0.06] disabled:opacity-50">
                            <RefreshCw className="h-3.5 w-3.5" /> {copy.regenerate}
                          </button>
                          {hasMediaRevision(project, "keyframe_image", keyframe.id) && (
                            <button type="button" onClick={() => rollbackMedia("keyframe_image", keyframe.id)} disabled={loading} className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-amber-300/25 bg-amber-300/5 text-xs text-amber-100 hover:bg-amber-300/10 disabled:opacity-50">
                              <Undo2 className="h-3.5 w-3.5" /> {copy.rollbackMedia}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {projectView === "clips" && (
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-200">{copy.shots} {completeClips}/{segmentTotal}</h3>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {project.shots.map((shot) => (
                  <div
                    key={shot.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectShot(shot.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectShot(shot.id);
                      }
                    }}
                    className={`overflow-hidden rounded-md border bg-white/[0.03] outline-none transition ${
                      selectedShot?.id === shot.id && !selectedKeyframe
                        ? "border-cyan-400/60 ring-1 ring-cyan-400/30"
                        : "border-white/10 hover:border-cyan-400/35 focus-visible:border-cyan-400/60"
                    }`}
                  >
                    <div className={`relative bg-slate-900 ${aspectClass(project.aspectRatio)}`}>
                      {shot.clipUrl ? (
                        <video src={shot.clipUrl} controls playsInline preload="metadata" poster={shot.imageUrl || undefined} className="h-full w-full object-cover" />
                      ) : (
                        <button type="button" onClick={() => selectShot(shot.id)} className="flex h-full w-full flex-col items-center justify-center gap-2 text-sm text-slate-500">
                          <Clapperboard className="h-5 w-5" />
                          <span>{copy.shot} {String(shot.shotNo).padStart(2, "0")}</span>
                        </button>
                      )}
                    </div>
                    <div className="space-y-2 px-3 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-white">{copy.shot} {String(shot.shotNo).padStart(2, "0")}</p>
                        <span className="text-xs text-slate-500">{shot.durationSeconds}s</span>
                      </div>
                      <p className="line-clamp-2 min-h-10 text-sm leading-5 text-slate-300">{localizedShotPurpose(shot, pageLang)}</p>
                    </div>
                  </div>
                ))}
                </div>
              </section>
              )}
            </main>

            <button
              type="button"
              aria-label={pageLang === "en" ? "Resize details panel" : "调整详情面板宽度"}
              title={pageLang === "en" ? "Drag to resize the details panel" : "拖动调整右侧详情面板宽度"}
              onPointerDown={(event) => {
                event.preventDefault();
                setResizingDetailPanel(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  setDetailPanelWidth((width) => clampDetailPanelWidth(width + 24));
                } else if (event.key === "ArrowRight") {
                  event.preventDefault();
                  setDetailPanelWidth((width) => clampDetailPanelWidth(width - 24));
                } else if (event.key === "Home") {
                  event.preventDefault();
                  setDetailPanelWidth(DETAIL_PANEL_MIN_WIDTH);
                } else if (event.key === "End") {
                  event.preventDefault();
                  setDetailPanelWidth(DETAIL_PANEL_MAX_WIDTH);
                }
              }}
              className={`hidden self-stretch px-1 outline-none xl:flex xl:w-3 xl:shrink-0 xl:cursor-col-resize xl:items-stretch xl:justify-center ${resizingDetailPanel ? "text-cyan-200" : "text-slate-700 hover:text-cyan-300 focus-visible:text-cyan-300"}`}
            >
              <span className={`my-1 w-px rounded-full bg-current ${resizingDetailPanel ? "shadow-[0_0_0_3px_rgba(34,211,238,0.18)]" : ""}`} />
            </button>

            <aside
              ref={detailPanelRef}
              className="w-full rounded-md border border-white/10 bg-white/[0.025] p-4 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:w-[var(--detail-panel-width)] xl:shrink-0 xl:overflow-y-auto"
              style={{
                "--detail-panel-width": `${detailPanelWidth}px`,
                "--detail-preview-height": `${detailPreviewHeight}px`,
              } as CSSProperties}
            >
              <div className="mb-4 space-y-3 border-b border-white/10 pb-4">
                <div className="grid grid-cols-6 gap-1.5">
                  {STAGES.map((stage) => {
                    const Icon = stage.icon;
                    const active = stage.key === activeWorkflowStage;
                    const rollbackTargetForStage = toRollbackTarget(stage.key);
                    const canRollbackToStage = Boolean(rollbackTargetForStage && rollbackOptions.includes(rollbackTargetForStage));
                    const canApproveAssetStage = stage.key === "ASSET_LIBRARY_REVIEW" && canApproveAssets;
                    const stageContent = (
                      <>
                        <Icon className={`mb-1 h-4 w-4 transition-opacity duration-150 ${canRollbackToStage ? "group-hover:opacity-0" : ""}`} />
                        <span className={`transition-opacity duration-150 ${canRollbackToStage ? "group-hover:opacity-0" : ""}`}>{copy.stages[stage.key]}</span>
                        {canRollbackToStage && (
                          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-semibold text-amber-100 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                            {copy.rollback}
                          </span>
                        )}
                      </>
                    );
                    const stageClass = `group relative flex h-14 flex-col items-center justify-center rounded-md border text-[11px] transition ${
                      canApproveAssetStage
                        ? "border-emerald-400/45 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/15"
                        : active
                        ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-100"
                        : canRollbackToStage
                          ? "border-white/10 bg-slate-950/50 text-slate-500 hover:border-amber-300/45 hover:bg-amber-300/10 hover:text-amber-100"
                          : "border-white/10 bg-slate-950/50 text-slate-500"
                    }`;
                    if (canApproveAssetStage) {
                      return (
                        <button
                          key={stage.key}
                          type="button"
                          onClick={approveAssets}
                          disabled={loading}
                          title={copy.approveAssets}
                          className={`${stageClass} disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          {stageContent}
                        </button>
                      );
                    }
                    if (canRollbackToStage && rollbackTargetForStage) {
                      return (
                        <button
                          key={stage.key}
                          type="button"
                          onClick={() => rollbackProject(rollbackTargetForStage)}
                          disabled={loading}
                          title={`${copy.rollbackTo}: ${copy.rollbackTargets[rollbackTargetForStage]}`}
                          className={`${stageClass} disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          {stageContent}
                        </button>
                      );
                    }
                    return (
                      <div key={stage.key} className={stageClass}>
                        {stageContent}
                      </div>
                    );
                  })}
                </div>
                <div className="space-y-2 rounded-md border border-white/10 bg-slate-950/50 p-3">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>{copy.assetLibrary}</span>
                    <span>{completeAssets}/{assetTotal}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-emerald-400" style={{ width: `${assetTotal ? (completeAssets / assetTotal) * 100 : 0}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>{copy.frames}</span>
                    <span>{completeBoundaryImages}/{boundaryTotal}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-cyan-400" style={{ width: `${boundaryTotal ? (completeBoundaryImages / boundaryTotal) * 100 : 0}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>{copy.shots}</span>
                    <span>{completeClips}/{segmentTotal}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-emerald-400" style={{ width: `${segmentTotal ? (completeClips / segmentTotal) * 100 : 0}%` }} />
                  </div>
                </div>
              </div>
              {selectedKeyframe ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-white">{safeBoundaryFrameLabel(selectedKeyframe, project.durationSeconds, pageLang)}</h3>
                    <span className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-400">{shotStatusLabel(selectedKeyframe.status, selectedKeyframe.errorMessage, copy)}</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-medium text-slate-500">{copy.keyframePreview}</p>
                      <PreviewSizeControl
                        label={copy.previewSize}
                        value={detailPreviewHeight}
                        onPreview={previewDetailHeight}
                        onCommit={commitDetailHeight}
                      />
                    </div>
                    <div className="h-[var(--detail-preview-height)] overflow-hidden rounded-md border border-white/10 bg-slate-900">
                      {selectedKeyframe.imageUrl ? (
                        <button type="button" onClick={() => setPreviewKeyframeId(selectedKeyframe.id)} className="block h-full w-full">
                          <img src={previewImageSrc(selectedKeyframe.imageUrl)} alt={safeBoundaryFrameLabel(selectedKeyframe, project.durationSeconds, pageLang)} className="h-full w-full object-contain" />
                        </button>
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm text-slate-600">{safeBoundaryFrameShortLabel(selectedKeyframe, project.durationSeconds, pageLang)}</div>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">{selectedKeyframe.keyframeNo < 0 ? copy.assetLibraryHint : copy.boundaryFrameHint}</p>
                  </div>
                  <GenerationCandidatePicker
                    candidates={(project.generationCandidates ?? []).filter((candidate) => candidate.targetId === selectedKeyframe.id && candidate.kind === "keyframe_image")}
                    lang={pageLang}
                    loading={loading}
                    onSelect={chooseGenerationCandidate}
                    onRetry={() => regenerateImage(selectedKeyframe.id)}
                  />
                  <Field label={copy.purpose} onUndo={() => undoKeyframeField("purpose")} canUndo={keyframeFieldChanged("purpose")} undoLabel={copy.undo}><AutoResizeTextarea minRows={2} maxRows={5} value={String(keyframeDraft.purpose ?? "")} onChange={(event) => setKeyframeDraft((current) => ({ ...current, purpose: event.target.value }))} className="w-full resize-none rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" /></Field>
                  <Field label={copy.imagePrompt} onUndo={() => undoKeyframeField("imagePrompt")} canUndo={keyframeFieldChanged("imagePrompt")} undoLabel={copy.undo}><AutoResizeTextarea minRows={3} maxRows={10} value={String(keyframeDraft.imagePrompt ?? "")} onChange={(event) => setKeyframeDraft((current) => ({ ...current, imagePrompt: event.target.value }))} className="w-full resize-none rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" /></Field>
                  <Field label={copy.negativePrompt} onUndo={() => undoKeyframeField("negativePrompt")} canUndo={keyframeFieldChanged("negativePrompt")} undoLabel={copy.undo}><AutoResizeTextarea minRows={2} maxRows={7} value={String(keyframeDraft.negativePrompt ?? "")} onChange={(event) => setKeyframeDraft((current) => ({ ...current, negativePrompt: event.target.value }))} className="w-full resize-none rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" /></Field>
                  {selectedKeyframe.keyframeNo < 0 && selectedKeyframe.imageUrl && !selectedKeyframe.locked && selectedKeyframe.status !== "IMAGE_APPROVED" && (
                    <button type="button" onClick={() => toggleLock(selectedKeyframe)} disabled={loading} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-emerald-400/30 bg-emerald-400/10 text-sm font-semibold text-emerald-100 hover:bg-emerald-400/15 disabled:opacity-50">
                      <Check className="h-4 w-4" /> {copy.approveReference}
                    </button>
                  )}
                  {selectedKeyframe.keyframeNo >= 0 && selectedKeyframe.imageUrl && !selectedKeyframe.locked && selectedKeyframe.status !== "IMAGE_APPROVED" && (
                    <button type="button" onClick={() => toggleLock(selectedKeyframe)} disabled={loading} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-violet-400/30 bg-violet-400/10 text-sm font-semibold text-violet-100 hover:bg-violet-400/15 disabled:opacity-50">
                      <Check className="h-4 w-4" /> {pageLang === "zh" ? "锁定为父机位空间参考" : "Lock as parent-camera layout reference"}
                    </button>
                  )}
                  {hasUnsavedKeyframeChanges && (
                    <ArtifactImpactPreview
                      planDebug={project.planDebug}
                      rootIds={[
                        `${selectedKeyframe.keyframeNo < 0 ? `consistency_reference:${selectedKeyframe.keyframeNo}` : `keyframe:${selectedKeyframe.keyframeNo}`}:prompt`,
                        `${selectedKeyframe.keyframeNo < 0 ? `consistency_reference:${selectedKeyframe.keyframeNo}` : `keyframe:${selectedKeyframe.keyframeNo}`}:image`,
                      ]}
                      lang={pageLang}
                    />
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={saveKeyframe}
                      disabled={loading || !hasUnsavedKeyframeChanges}
                      className={`inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md text-sm font-semibold transition disabled:cursor-not-allowed ${
                        hasUnsavedKeyframeChanges
                          ? "bg-cyan-500 text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
                          : "border border-white/10 bg-slate-900/70 text-slate-500"
                      }`}
                    >
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      {copy.saveKeyframe}
                    </button>
                    <button type="button" onClick={() => regenerateImage(selectedKeyframe.id)} disabled={loading || Boolean(personDerivedViewWaitReason(selectedKeyframe, orderedAssetKeyframes, pageLang))} className="inline-flex h-10 w-12 items-center justify-center rounded-md border border-white/10 text-slate-300 hover:bg-white/[0.06] disabled:opacity-50"><RefreshCw className="h-4 w-4" /></button>
                  </div>
                  {personDerivedViewWaitReason(selectedKeyframe, orderedAssetKeyframes, pageLang) && (
                    <p className="rounded-md border border-amber-300/20 bg-amber-300/5 px-3 py-2 text-xs leading-5 text-amber-100">{personDerivedViewWaitReason(selectedKeyframe, orderedAssetKeyframes, pageLang)}</p>
                  )}
                  {hasMediaRevision(project, "keyframe_image", selectedKeyframe.id) && (
                    <button type="button" onClick={() => rollbackMedia("keyframe_image", selectedKeyframe.id)} disabled={loading} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-amber-300/25 bg-amber-300/5 text-sm text-amber-100 hover:bg-amber-300/10 disabled:opacity-50">
                      <Undo2 className="h-4 w-4" /> {copy.rollbackMedia}
                    </button>
                  )}
                </div>
              ) : Boolean(selectedShot) ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-white">{copy.shot} {String(selectedShot!.shotNo).padStart(2, "0")}</h3>
                    <span className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-400">{shotStatusLabel(selectedShot!.status, selectedShot!.errorMessage, copy)}</span>
                  </div>
                  <div className="space-y-2">
                    <div className="h-[220px] overflow-hidden rounded-md border border-white/10 bg-slate-900">
                      {selectedShot!.clipUrl ? (
                        <video src={selectedShot!.clipUrl} controls playsInline preload="metadata" poster={selectedShot!.imageUrl || undefined} className="h-full w-full object-contain" />
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-600">
                          <Clapperboard className="h-5 w-5" />
                          <span>{copy.clipPreview}</span>
                        </div>
                      )}
                    </div>
                    {selectedShot!.startKeyframeNo && selectedShot!.endKeyframeNo && (
                      <p className="text-xs text-slate-500">{safeBoundaryRangeLabel(selectedShot!, keyframeByNo, project.durationSeconds, pageLang)}</p>
                    )}
                  </div>
                  <GenerationCandidatePicker
                    candidates={(project.generationCandidates ?? []).filter((candidate) => candidate.targetId === selectedShot!.id && candidate.kind === "segment_video")}
                    lang={pageLang}
                    loading={loading}
                    onSelect={chooseGenerationCandidate}
                    onRetry={() => regenerateClip(selectedShot!.id)}
                  />
                  <p className="text-sm leading-6 text-slate-300">{localizedShotPurpose(selectedShot!, pageLang)}</p>
                  <button
                    type="button"
                    onClick={() => openShotEditor(selectedShot!.id)}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-cyan-500 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
                  >
                    <Pencil className="h-4 w-4" />
                    {copy.editShot}
                  </button>
                  <button
                    type="button"
                    onClick={() => regenerateClip(selectedShot!.id)}
                    disabled={loading || !selectedShot!.startKeyframeNo || !selectedShot!.endKeyframeNo}
                    className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.03] text-sm font-medium text-slate-300 hover:bg-white/[0.06] disabled:opacity-50"
                  >
                    <RefreshCw className="h-4 w-4" />
                    {copy.regenerate}
                  </button>
                  {hasMediaRevision(project, "segment_clip", selectedShot!.id) && (
                    <button type="button" onClick={() => rollbackMedia("segment_clip", selectedShot!.id)} disabled={loading} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-amber-300/25 bg-amber-300/5 text-sm text-amber-100 hover:bg-amber-300/10 disabled:opacity-50">
                      <Undo2 className="h-4 w-4" /> {copy.rollbackMedia}
                    </button>
                  )}
                </div>
              ) : (false as boolean) && selectedShot ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-white">{copy.shot} {String(selectedShot.shotNo).padStart(2, "0")}</h3>
                    <span className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-400">{shotStatusLabel(selectedShot.status, selectedShot.errorMessage, copy)}</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-medium text-slate-500">{selectedShot.clipUrl ? copy.clipPreview : copy.videoPrompt}</p>
                      <PreviewSizeControl
                        label={copy.previewSize}
                        value={detailPreviewHeight}
                        onPreview={previewDetailHeight}
                        onCommit={commitDetailHeight}
                      />
                    </div>
                    <div className="h-[var(--detail-preview-height)] overflow-hidden rounded-md border border-white/10 bg-slate-900">
                      {selectedShot.clipUrl ? (
                        <video src={selectedShot.clipUrl} controls playsInline preload="metadata" poster={selectedShot.imageUrl || undefined} className="h-full w-full object-contain" />
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-600">
                          <Clapperboard className="h-5 w-5" />
                          <span>{copy.clipPreview}</span>
                        </div>
                      )}
                    </div>
                    {selectedShot.startKeyframeNo && selectedShot.endKeyframeNo && (
                      <p className="text-xs text-slate-500">{safeBoundaryRangeLabel(selectedShot, keyframeByNo, project.durationSeconds, pageLang)}</p>
                    )}
                    {(selectedStartKeyframe || selectedEndKeyframe) && (
                      <div className="grid grid-cols-2 gap-2">
                        {[selectedStartKeyframe, selectedEndKeyframe].map((keyframe) => (
                          <div key={keyframe?.id ?? "empty"} className="overflow-hidden rounded-md border border-white/10 bg-slate-900">
                            <div className={`relative ${aspectClass(project.aspectRatio)}`}>
                              {keyframe?.imageUrl ? (
                                <img src={previewImageSrc(keyframe.imageUrl)} alt={safeBoundaryFrameLabel(keyframe, project.durationSeconds, pageLang)} className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full items-center justify-center text-xs text-slate-600">KF</div>
                              )}
                              {keyframe && (
                                <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                                  {safeBoundaryFrameShortLabel(keyframe, project.durationSeconds, pageLang)}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {selectedShot.clipUrl && (
                      <a href={shotClipDownloadUrl(project.id, selectedShot.id)} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-cyan-400/30 bg-cyan-400/10 text-sm font-medium text-cyan-100 hover:bg-cyan-400/15">
                        <Download className="h-4 w-4" />
                        {copy.downloadClip}
                      </a>
                    )}
                    <div className="space-y-2 rounded-md border border-white/10 bg-white/[0.03] p-3">
                      <div className="flex flex-wrap gap-1.5">
                        {selectedShot.boundaryMode && (
                          <span className="rounded-md border border-indigo-300/20 bg-indigo-300/10 px-2 py-1 text-[11px] text-indigo-100/80">
                            {copy.boundaryMode}: {selectedShot.boundaryMode}
                          </span>
                        )}
                        {selectedShot.outputMode && (
                          <span className="rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[11px] text-cyan-100">
                            {copy.outputMode}: {selectedShot.outputMode}
                          </span>
                        )}
                        <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-slate-400">
                          {copy.segmentDurationPolicy}
                        </span>
                      </div>
                      {Boolean(selectedShot.constraints?.length) && (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-slate-500">{copy.constraints}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {selectedShot.constraints?.map((constraint) => (
                              <span key={constraint} className="rounded-md border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-[11px] text-emerald-100/80">
                                {constraint}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {Boolean(selectedShot.timedPrompts?.length) && (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-slate-500">{copy.timedPrompts}</p>
                          {selectedShot.timedPrompts?.map((item) => (
                            <p key={`${item.timeSeconds}-${item.prompt}`} className="text-xs leading-5 text-amber-100/75">
                              {timedPromptRangeLabel(item)}: {localizedTimedPrompt(item, pageLang)}
                            </p>
                          ))}
                        </div>
                      )}
                      {selectedShot.audioPlan && (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-slate-500">{copy.audioPlan}</p>
                          <p className="text-xs leading-5 text-amber-100/75">{localizedAudioPlanSummary(selectedShot.audioPlan, pageLang)}</p>
                          {audioPlanLines(selectedShot.audioPlan, pageLang).length > 0 && (
                            <div className="space-y-1">
                              <p className="text-[11px] font-medium text-slate-500">{copy.spokenLines}</p>
                              {audioPlanLines(selectedShot.audioPlan, pageLang).map((line) => (
                                <p key={line} className="text-xs leading-5 text-slate-300">{line}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <section className="space-y-3 rounded-md border border-fuchsia-300/15 bg-fuchsia-300/[0.04] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="relative inline-flex items-center gap-1.5">
                        <p className="text-sm font-semibold text-fuchsia-100">{copy.microShots}</p>
                        <MicroShotHelpButton
                          copy={copy}
                          lang={pageLang}
                          open={microShotHelpOpen === "detail"}
                          onToggle={() => setMicroShotHelpOpen((current) => current === "detail" ? null : "detail")}
                        />
                      </div>
                      <button type="button" onClick={addDraftMicroShot} className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-fuchsia-300/20 px-2 text-xs text-fuchsia-100 hover:bg-fuchsia-300/10">
                        <Plus className="h-3.5 w-3.5" /> {copy.addMicroShot}
                      </button>
                    </div>
                    <div className="space-y-3">
                      {((draft.microShots as MicroShot[] | undefined) ?? []).map((item, index) => (
                        <div key={`${item.microShotNo}-${index}`} className="space-y-2 rounded-md border border-white/10 bg-slate-950/60 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-slate-200">{copy.microShot} {String(index + 1).padStart(2, "0")}</p>
                            <div className="flex items-center gap-1">
                              <button type="button" onClick={() => undoDraftMicroShot(index)} disabled={!microShotChanged(index)} title={copy.undoChanges} className="inline-flex h-7 items-center gap-1 rounded-md border border-white/10 px-2 text-[11px] text-slate-300 hover:bg-white/[0.06] disabled:pointer-events-none disabled:opacity-30">
                                <Undo2 className="h-3 w-3" /> {copy.undo}
                              </button>
                              <button type="button" onClick={() => removeDraftMicroShot(index)} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-slate-400 hover:bg-white/[0.06]">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                          <div className="grid grid-cols-[minmax(140px,0.5fr)_minmax(0,1fr)] gap-2">
                            <label className="space-y-1">
                              <span className="text-[11px] text-slate-500">{copy.microShotTime}</span>
                              <input
                                type="number"
                                min={0}
                                max={Number(draft.durationSeconds ?? selectedShot.durationSeconds)}
                                step={1}
                                value={Number(item.localTimeSeconds ?? 0)}
                                onChange={(event) => updateDraftMicroShot(index, { localTimeSeconds: Number(event.target.value) })}
                                title={copy.microShotTimeHint}
                                aria-label={copy.microShotTime}
                                className="w-full rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-fuchsia-300"
                              />
                            </label>
                            <label className="space-y-1">
                              <span className="text-[11px] text-slate-500">{copy.referenceType}</span>
                              <select
                                value={item.referenceType ?? "mixed"}
                                onChange={(event) => updateDraftMicroShot(index, { referenceType: event.target.value as MicroShot["referenceType"] })}
                                className="w-full rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-fuchsia-300"
                              >
                                <option value="text">text</option>
                                <option value="image_prompt">image_prompt</option>
                                <option value="mixed">mixed</option>
                              </select>
                            </label>
                          </div>
                          {item.referenceType !== "text" && (
                            <div className="space-y-2 rounded-md border border-cyan-300/15 bg-cyan-300/[0.04] p-2">
                              <div className="flex items-center justify-end gap-2">
                                {hasMediaRevision(project, "micro_shot_image", selectedShot!.id, item.microShotNo) && (
                                  <button type="button" onClick={() => rollbackMedia("micro_shot_image", selectedShot!.id, item.microShotNo)} disabled={loading} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-300/25 bg-amber-300/5 px-2 text-xs text-amber-100 hover:bg-amber-300/10 disabled:opacity-50">
                                    <Undo2 className="h-3.5 w-3.5" /> {copy.rollbackMedia}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => generateMicroShotImage(index)}
                                  disabled={
                                    loading ||
                                    item.imageStatus === "running" ||
                                    !localizedMicroShotImagePrompt(item, pageLang).trim()
                                  }
                                  className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-cyan-300/20 px-2 text-xs text-cyan-100 hover:bg-cyan-300/10 disabled:opacity-50"
                                >
                                  {item.imageStatus === "running"
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    : item.imageUrl
                                      ? <RefreshCw className="h-3.5 w-3.5" />
                                      : <ImageIcon className="h-3.5 w-3.5" />}
                                  {item.imageUrl ? copy.regenerateMicroShotImage : copy.generateMicroShotImage}
                                </button>
                              </div>
                              {item.imageStatus === "running" && (
                                <p className="text-xs text-cyan-100/75">{copy.microShotImageRunning}</p>
                              )}
                              {item.imageStatus === "failed" && (
                                <p className="text-xs text-rose-200">{item.errorMessage || copy.microShotImageFailed}</p>
                              )}
                              <GenerationCandidatePicker candidates={(project.generationCandidates ?? []).filter((candidate) => candidate.targetId === selectedShot!.id && candidate.kind === "micro_shot_image" && Number(candidate.metadata?.microShotNo) === item.microShotNo)} lang={pageLang} loading={loading} onSelect={chooseGenerationCandidate} onRetry={() => generateMicroShotImage(index)} />
                              {item.imageUrl && (
                                <button
                                  type="button"
                                  onClick={() => setPreviewMicroShot({
                                    title: `${copy.microShot} ${index + 1}`,
                                    imageUrl: item.imageUrl!,
                                    imagePrompt: localizedMicroShotImagePrompt(item, pageLang),
                                  })}
                                  className="block w-full overflow-hidden rounded-md border border-white/10 bg-slate-950 outline-none transition hover:border-cyan-300/45 focus-visible:ring-2 focus-visible:ring-cyan-300/60"
                                >
                                  <img src={previewImageSrc(item.imageUrl)} alt={`${copy.microShot} ${index + 1}`} className="max-h-52 w-full object-contain" />
                                </button>
                              )}
                            </div>
                          )}
                          <Field label={copy.purpose}><input value={localizedMicroShotPurpose(item, pageLang)} onChange={(event) => updateDraftMicroShot(index, pageLang === "en" ? { purposeEn: event.target.value, purpose: event.target.value } : { purposeZh: event.target.value, purpose: event.target.value })} className="w-full rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-fuchsia-300" /></Field>
                          <Field label={copy.scene}><AutoResizeTextarea minRows={2} maxRows={5} value={localizedMicroShotScene(item, pageLang)} onChange={(event) => updateDraftMicroShot(index, pageLang === "en" ? { sceneEn: event.target.value, scene: event.target.value } : { sceneZh: event.target.value, scene: event.target.value })} className="w-full resize-none rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-fuchsia-300" /></Field>
                          <Field label={copy.action}><AutoResizeTextarea minRows={2} maxRows={5} value={localizedMicroShotAction(item, pageLang)} onChange={(event) => updateDraftMicroShot(index, pageLang === "en" ? { actionEn: event.target.value, action: event.target.value } : { actionZh: event.target.value, action: event.target.value })} className="w-full resize-none rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-fuchsia-300" /></Field>
                          <Field label={copy.imagePrompt}><AutoResizeTextarea minRows={2} maxRows={7} value={localizedMicroShotImagePrompt(item, pageLang)} onChange={(event) => updateDraftMicroShot(index, pageLang === "en" ? { imagePromptEn: event.target.value, imagePrompt: event.target.value } : { imagePromptZh: event.target.value, imagePrompt: event.target.value })} className="w-full resize-none rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-fuchsia-300" /></Field>
                        </div>
                      ))}
                    </div>
                  </section>
                  <Field label={`${copy.duration} (${copy.segmentDurationPolicy})`} onUndo={() => undoShotField("durationSeconds")} canUndo={shotFieldChanged("durationSeconds")} undoLabel={copy.undo}>
                    <input
                      type="number"
                      min={3}
                      max={15}
                      step={1}
                      value={Number(draft.durationSeconds ?? selectedShot.durationSeconds)}
                      onChange={(event) => setDraft((current) => ({ ...current, durationSeconds: Number(event.target.value) }))}
                      className="w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400"
                    />
                  </Field>
                  <Field label={copy.purpose} onUndo={() => undoShotField("purpose")} canUndo={shotFieldChanged("purpose")} undoLabel={copy.undo}><AutoResizeTextarea minRows={2} maxRows={6} value={String(draft.purpose ?? "")} onChange={(event) => setDraft((current) => ({ ...current, purpose: event.target.value }))} className="w-full resize-none rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" /></Field>
                  <Field label={copy.action} onUndo={() => undoShotField("action")} canUndo={shotFieldChanged("action")} undoLabel={copy.undo}><AutoResizeTextarea minRows={2} maxRows={6} value={String(draft.action ?? "")} onChange={(event) => setDraft((current) => ({ ...current, action: event.target.value }))} className="w-full resize-none rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" /></Field>
                  <Field label={copy.camera} onUndo={() => undoShotField("camera")} canUndo={shotFieldChanged("camera")} undoLabel={copy.undo}><input value={String(draft.camera ?? "")} onChange={(event) => setDraft((current) => ({ ...current, camera: event.target.value }))} className="w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" /></Field>
                  <Field label={copy.subtitle} onUndo={() => undoShotField("subtitle")} canUndo={shotFieldChanged("subtitle")} undoLabel={copy.undo}>
                    <AutoResizeTextarea
                      minRows={2}
                      maxRows={4}
                      maxLength={subtitleLimitForLang(pageLang)}
                      value={String(draft.subtitle ?? "")}
                      onChange={(event) => setDraft((current) => ({ ...current, subtitle: event.target.value }))}
                      className="w-full resize-none rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400"
                    />
                    <div className="flex items-center justify-end text-[11px] leading-5 text-slate-500">
                      <span className="shrink-0">{String(draft.subtitle ?? "").length}/{subtitleLimitForLang(pageLang)}</span>
                    </div>
                  </Field>
                  <Field label={copy.videoPrompt} onUndo={() => undoShotField("videoPrompt")} canUndo={shotFieldChanged("videoPrompt")} undoLabel={copy.undo}><AutoResizeTextarea minRows={3} maxRows={10} value={String(draft.videoPrompt ?? "")} onChange={(event) => setDraft((current) => ({ ...current, videoPrompt: event.target.value }))} className="w-full resize-none rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" /></Field>
                  <button type="button" onClick={saveShot} disabled={loading} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-cyan-500 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"><Save className="h-4 w-4" /> {copy.saveShot}</button>
                </div>
              ) : <div className="py-12 text-center text-sm text-slate-500">{copy.noShot}</div>}
            </aside>
          </section>
        )}
      </div>

      {project && selectedShot && shotEditorOpen && typeof document !== "undefined" && createPortal(
        <div className="one-prompt-video-workbench fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-3 sm:p-4" role="dialog" aria-modal="true" onClick={() => setShotEditorOpen(false)}>
          <div className="flex h-[calc(100dvh-1.5rem)] w-full max-w-7xl flex-col overflow-hidden rounded-md border border-cyan-400/25 bg-slate-950 shadow-2xl shadow-cyan-950/30 sm:h-[calc(100dvh-2rem)]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold text-white">{copy.editShot} {String(selectedShot.shotNo).padStart(2, "0")}</h3>
                  <span className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-400">{shotStatusLabel(selectedShot.status, selectedShot.errorMessage, copy)}</span>
                  <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-slate-400">{selectedShot.durationSeconds}s</span>
                </div>
                {selectedShot.startKeyframeNo && selectedShot.endKeyframeNo && (
                  <p className="mt-1 text-xs text-cyan-200/80">{safeBoundaryRangeLabel(selectedShot, keyframeByNo, project.durationSeconds, pageLang)}</p>
                )}
              </div>
              <button type="button" onClick={() => setShotEditorOpen(false)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-slate-200 hover:bg-white/[0.08]">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[380px_minmax(0,1fr)]">
              <aside className="subtle-scrollbar min-h-0 overflow-y-auto border-b border-white/10 bg-slate-950/70 p-4 lg:border-b-0 lg:border-r">
                <div className="space-y-3">
                  <div className="overflow-hidden rounded-md border border-white/10 bg-slate-900">
                    <div className={`relative ${aspectClass(project.aspectRatio)}`}>
                      {selectedShot.clipUrl ? (
                        <video src={selectedShot.clipUrl} controls playsInline preload="metadata" poster={selectedShot.imageUrl || undefined} className="h-full w-full object-contain" />
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-600">
                          <Clapperboard className="h-5 w-5" />
                          <span>{copy.clipPreview}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  {selectedShot.clipUrl && (
                    <a href={shotClipDownloadUrl(project.id, selectedShot.id)} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-cyan-400/30 bg-cyan-400/10 text-sm font-medium text-cyan-100 hover:bg-cyan-400/15">
                      <Download className="h-4 w-4" />
                      {copy.downloadClip}
                    </a>
                  )}
                  {(selectedStartKeyframe || selectedEndKeyframe) && (
                    <div className="grid grid-cols-2 gap-2">
                      {[selectedStartKeyframe, selectedEndKeyframe].map((keyframe) => (
                        <button
                          key={keyframe?.id ?? "empty"}
                          type="button"
                          onClick={() => keyframe?.imageUrl && setPreviewKeyframeId(keyframe.id)}
                          className="overflow-hidden rounded-md border border-white/10 bg-slate-900 text-left"
                        >
                          <div className={`relative ${aspectClass(project.aspectRatio)}`}>
                            {keyframe?.imageUrl ? (
                              <img src={previewImageSrc(keyframe.imageUrl)} alt={safeBoundaryFrameLabel(keyframe, project.durationSeconds, pageLang)} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full items-center justify-center text-xs text-slate-600">KF</div>
                            )}
                            {keyframe && (
                              <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                                {safeBoundaryFrameShortLabel(keyframe, project.durationSeconds, pageLang)}
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="space-y-2 rounded-md border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex flex-wrap gap-1.5">
                      {selectedShot.boundaryMode && (
                        <span className="rounded-md border border-indigo-300/20 bg-indigo-300/10 px-2 py-1 text-[11px] text-indigo-100/80">
                          {copy.boundaryMode}: {selectedShot.boundaryMode}
                        </span>
                      )}
                      {selectedShot.outputMode && (
                        <span className="rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[11px] text-cyan-100">
                          {copy.outputMode}: {selectedShot.outputMode}
                        </span>
                      )}
                      <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-slate-400">
                        {copy.segmentDurationPolicy}
                      </span>
                    </div>
                    {Boolean(selectedShot.constraints?.length) && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-slate-500">{copy.constraints}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {selectedShot.constraints?.map((constraint) => (
                            <span key={constraint} className="rounded-md border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-[11px] text-emerald-100/80">
                              {constraint}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {selectedShot.audioPlan && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-slate-500">{copy.audioPlan}</p>
                        <p className="text-xs leading-5 text-amber-100/75">{localizedAudioPlanSummary(selectedShot.audioPlan, pageLang)}</p>
                        {audioPlanLines(selectedShot.audioPlan, pageLang).length > 0 && (
                          <div className="space-y-1">
                            <p className="text-[11px] font-medium text-slate-500">{copy.spokenLines}</p>
                            {audioPlanLines(selectedShot.audioPlan, pageLang).map((line) => (
                              <p key={line} className="text-xs leading-5 text-slate-300">{line}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </aside>

              <section className="subtle-scrollbar min-h-0 overflow-y-auto p-4 pb-0">
                <div className="grid gap-4 xl:grid-cols-2">
                  <Field label={`${copy.duration} (${copy.segmentDurationPolicy})`} onUndo={() => undoShotField("durationSeconds")} canUndo={shotFieldChanged("durationSeconds")} undoLabel={copy.undo}>
                    <input
                      type="number"
                      min={3}
                      max={15}
                      step={1}
                      value={Number(draft.durationSeconds ?? selectedShot.durationSeconds)}
                      onChange={(event) => setDraft((current) => ({ ...current, durationSeconds: Number(event.target.value) }))}
                      className="w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400"
                    />
                  </Field>
                  <Field label={copy.camera} onUndo={() => undoShotField("camera")} canUndo={shotFieldChanged("camera")} undoLabel={copy.undo}>
                    <input value={String(draft.camera ?? "")} onChange={(event) => setDraft((current) => ({ ...current, camera: event.target.value }))} className="w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" />
                  </Field>
                  <Field label={copy.purpose} onUndo={() => undoShotField("purpose")} canUndo={shotFieldChanged("purpose")} undoLabel={copy.undo}>
                    <AutoResizeTextarea minRows={2} maxRows={6} value={String(draft.purpose ?? "")} onChange={(event) => setDraft((current) => ({ ...current, purpose: event.target.value }))} className="w-full resize-none rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" />
                  </Field>
                  <Field label={copy.action} onUndo={() => undoShotField("action")} canUndo={shotFieldChanged("action")} undoLabel={copy.undo}>
                    <AutoResizeTextarea minRows={2} maxRows={6} value={String(draft.action ?? "")} onChange={(event) => setDraft((current) => ({ ...current, action: event.target.value }))} className="w-full resize-none rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" />
                  </Field>
                  <div className="xl:col-span-2">
                    <Field label={copy.subtitle} onUndo={() => undoShotField("subtitle")} canUndo={shotFieldChanged("subtitle")} undoLabel={copy.undo}>
                      <AutoResizeTextarea
                        minRows={2}
                        maxRows={4}
                        maxLength={subtitleLimitForLang(pageLang)}
                        value={String(draft.subtitle ?? "")}
                        onChange={(event) => setDraft((current) => ({ ...current, subtitle: event.target.value }))}
                        className="w-full resize-none rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400"
                      />
                      <div className="flex items-center justify-end text-[11px] leading-5 text-slate-500">
                        <span className="shrink-0">{String(draft.subtitle ?? "").length}/{subtitleLimitForLang(pageLang)}</span>
                      </div>
                    </Field>
                  </div>
                  <div className="xl:col-span-2">
                    <Field label={copy.videoPrompt} onUndo={() => undoShotField("videoPrompt")} canUndo={shotFieldChanged("videoPrompt")} undoLabel={copy.undo}>
                      <AutoResizeTextarea minRows={3} maxRows={10} value={String(draft.videoPrompt ?? "")} onChange={(event) => setDraft((current) => ({ ...current, videoPrompt: event.target.value }))} className="w-full resize-none rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" />
                    </Field>
                  </div>
                </div>

                <section className="mt-4 space-y-3 rounded-md border border-fuchsia-300/15 bg-fuchsia-300/[0.04] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="relative inline-flex items-center gap-1.5">
                      <p className="text-sm font-semibold text-fuchsia-100">{copy.microShots}</p>
                      <MicroShotHelpButton
                        copy={copy}
                        lang={pageLang}
                        open={microShotHelpOpen === "modal"}
                        onToggle={() => setMicroShotHelpOpen((current) => current === "modal" ? null : "modal")}
                      />
                    </div>
                    <button type="button" onClick={addDraftMicroShot} className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-fuchsia-300/20 px-2 text-xs text-fuchsia-100 hover:bg-fuchsia-300/10">
                      <Plus className="h-3.5 w-3.5" /> {copy.addMicroShot}
                    </button>
                  </div>
                  <div className="grid gap-3 xl:grid-cols-2">
                    {((draft.microShots as MicroShot[] | undefined) ?? []).map((item, index) => (
                      <div key={`${item.microShotNo}-${index}`} className="space-y-2 rounded-md border border-white/10 bg-slate-950/60 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-slate-200">{copy.microShot} {String(index + 1).padStart(2, "0")}</p>
                          <div className="flex items-center gap-1">
                            <button type="button" onClick={() => undoDraftMicroShot(index)} disabled={!microShotChanged(index)} title={copy.undoChanges} className="inline-flex h-7 items-center gap-1 rounded-md border border-white/10 px-2 text-[11px] text-slate-300 hover:bg-white/[0.06] disabled:pointer-events-none disabled:opacity-30">
                              <Undo2 className="h-3 w-3" /> {copy.undo}
                            </button>
                            <button type="button" onClick={() => removeDraftMicroShot(index)} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-slate-400 hover:bg-white/[0.06]">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-[minmax(140px,0.5fr)_minmax(0,1fr)] gap-2">
                          <label className="space-y-1">
                            <span className="text-[11px] text-slate-500">{copy.microShotTime}</span>
                            <input
                              type="number"
                              min={0}
                              max={Number(draft.durationSeconds ?? selectedShot.durationSeconds)}
                              step={1}
                              value={Number(item.localTimeSeconds ?? 0)}
                              onChange={(event) => updateDraftMicroShot(index, { localTimeSeconds: Number(event.target.value) })}
                              title={copy.microShotTimeHint}
                              aria-label={copy.microShotTime}
                              className="w-full rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-fuchsia-300"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-[11px] text-slate-500">{copy.referenceType}</span>
                            <select
                              value={item.referenceType ?? "mixed"}
                              onChange={(event) => updateDraftMicroShot(index, { referenceType: event.target.value as MicroShot["referenceType"] })}
                              className="w-full rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-fuchsia-300"
                            >
                              <option value="text">text</option>
                              <option value="image_prompt">image_prompt</option>
                              <option value="mixed">mixed</option>
                            </select>
                          </label>
                        </div>
                        {item.referenceType !== "text" && (
                          <div className="space-y-2 rounded-md border border-cyan-300/15 bg-cyan-300/[0.04] p-2">
                            <div className="flex items-center justify-end gap-2">
                              {hasMediaRevision(project, "micro_shot_image", selectedShot.id, item.microShotNo) && (
                                <button type="button" onClick={() => rollbackMedia("micro_shot_image", selectedShot.id, item.microShotNo)} disabled={loading} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-300/25 bg-amber-300/5 px-2 text-xs text-amber-100 hover:bg-amber-300/10 disabled:opacity-50">
                                  <Undo2 className="h-3.5 w-3.5" /> {copy.rollbackMedia}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => generateMicroShotImage(index)}
                                disabled={loading || item.imageStatus === "running" || !localizedMicroShotImagePrompt(item, pageLang).trim()}
                                className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-cyan-300/20 px-2 text-xs text-cyan-100 hover:bg-cyan-300/10 disabled:opacity-50"
                              >
                                {item.imageStatus === "running"
                                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  : item.imageUrl
                                    ? <RefreshCw className="h-3.5 w-3.5" />
                                    : <ImageIcon className="h-3.5 w-3.5" />}
                                {item.imageUrl ? copy.regenerateMicroShotImage : copy.generateMicroShotImage}
                              </button>
                            </div>
                            {item.imageStatus === "running" && <p className="text-xs text-cyan-100/75">{copy.microShotImageRunning}</p>}
                            {item.imageStatus === "failed" && <p className="text-xs text-rose-200">{item.errorMessage || copy.microShotImageFailed}</p>}
                            <GenerationCandidatePicker candidates={(project.generationCandidates ?? []).filter((candidate) => candidate.targetId === selectedShot.id && candidate.kind === "micro_shot_image" && Number(candidate.metadata?.microShotNo) === item.microShotNo)} lang={pageLang} loading={loading} onSelect={chooseGenerationCandidate} onRetry={() => generateMicroShotImage(index)} />
                            {item.imageUrl && (
                              <button
                                type="button"
                                onClick={() => setPreviewMicroShot({
                                  title: `${copy.microShot} ${index + 1}`,
                                  imageUrl: item.imageUrl!,
                                  imagePrompt: localizedMicroShotImagePrompt(item, pageLang),
                                })}
                                className="block w-full overflow-hidden rounded-md border border-white/10 bg-slate-950 outline-none transition hover:border-cyan-300/45 focus-visible:ring-2 focus-visible:ring-cyan-300/60"
                              >
                                <img src={previewImageSrc(item.imageUrl)} alt={`${copy.microShot} ${index + 1}`} className="max-h-52 w-full object-contain" />
                              </button>
                            )}
                          </div>
                        )}
                        <Field label={copy.purpose}><input value={localizedMicroShotPurpose(item, pageLang)} onChange={(event) => updateDraftMicroShot(index, pageLang === "en" ? { purposeEn: event.target.value, purpose: event.target.value } : { purposeZh: event.target.value, purpose: event.target.value })} className="w-full rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-fuchsia-300" /></Field>
                        <Field label={copy.scene}><AutoResizeTextarea minRows={2} maxRows={5} value={localizedMicroShotScene(item, pageLang)} onChange={(event) => updateDraftMicroShot(index, pageLang === "en" ? { sceneEn: event.target.value, scene: event.target.value } : { sceneZh: event.target.value, scene: event.target.value })} className="w-full resize-none rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-fuchsia-300" /></Field>
                        <Field label={copy.action}><AutoResizeTextarea minRows={2} maxRows={5} value={localizedMicroShotAction(item, pageLang)} onChange={(event) => updateDraftMicroShot(index, pageLang === "en" ? { actionEn: event.target.value, action: event.target.value } : { actionZh: event.target.value, action: event.target.value })} className="w-full resize-none rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-fuchsia-300" /></Field>
                        <Field label={copy.imagePrompt}><AutoResizeTextarea minRows={2} maxRows={7} value={localizedMicroShotImagePrompt(item, pageLang)} onChange={(event) => updateDraftMicroShot(index, pageLang === "en" ? { imagePromptEn: event.target.value, imagePrompt: event.target.value } : { imagePromptZh: event.target.value, imagePrompt: event.target.value })} className="w-full resize-none rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-fuchsia-300" /></Field>
                      </div>
                    ))}
                  </div>
                </section>

                <div className="sticky bottom-0 -mx-4 mt-4 flex justify-end gap-2 border-t border-white/10 bg-slate-950/95 px-4 py-3">
                  <button type="button" onClick={() => setShotEditorOpen(false)} className="inline-flex h-10 items-center justify-center rounded-md border border-white/10 px-4 text-sm font-medium text-slate-200 hover:bg-white/[0.06]">
                    {copy.cancel}
                  </button>
                  <button type="button" onClick={saveShot} disabled={loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-cyan-500 px-4 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60">
                    <Save className="h-4 w-4" /> {copy.saveShot}
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {previewKeyframe?.imageUrl && typeof document !== "undefined" && createPortal(
        <div className="one-prompt-video-workbench fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 p-4" role="dialog" aria-modal="true" onClick={() => setPreviewKeyframeId("")}>
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col gap-3" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-slate-950/95 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">{safeBoundaryFrameLabel(previewKeyframe, previewTotalDuration, pageLang)}</p>
                <p className="truncate text-xs text-slate-400">{localizedKeyframePurpose(previewKeyframe, pageLang)}</p>
              </div>
              <button type="button" onClick={() => setPreviewKeyframeId("")} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-slate-200 hover:bg-white/[0.08]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="flex min-h-0 items-center justify-center overflow-hidden rounded-md border border-white/10 bg-black">
                <img src={previewImageSrc(previewKeyframe.imageUrl)} alt={safeBoundaryFrameLabel(previewKeyframe, previewTotalDuration, pageLang)} className="max-h-[78vh] max-w-full object-contain" />
              </div>
              <aside className="subtle-scrollbar max-h-[78vh] overflow-y-auto rounded-md border border-white/10 bg-slate-950/95 p-3">
                <p className="text-xs font-medium text-slate-500">{copy.imagePrompt}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">{localizedKeyframeImagePrompt(previewKeyframe, pageLang)}</p>
                {previewKeyframe.negativePrompt && (
                  <>
                    <p className="mt-4 text-xs font-medium text-slate-500">{copy.negativePrompt}</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-400">{localizedKeyframeNegativePrompt(previewKeyframe, pageLang)}</p>
                  </>
                )}
              </aside>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {previewMicroShot && typeof document !== "undefined" && createPortal(
        <div className="one-prompt-video-workbench fixed inset-0 z-[10000] flex items-center justify-center bg-black/85 p-4" role="dialog" aria-modal="true" onClick={() => setPreviewMicroShot(null)}>
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col gap-3" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-slate-950/95 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">{previewMicroShot.title}</p>
                <p className="truncate text-xs text-slate-400">{copy.microShots}</p>
              </div>
              <button type="button" onClick={() => setPreviewMicroShot(null)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-slate-200 hover:bg-white/[0.08]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="flex min-h-0 items-center justify-center overflow-hidden rounded-md border border-white/10 bg-black">
                <img src={previewImageSrc(previewMicroShot.imageUrl)} alt={previewMicroShot.title} className="max-h-[78vh] max-w-full object-contain" />
              </div>
              <aside className="subtle-scrollbar max-h-[78vh] overflow-y-auto rounded-md border border-white/10 bg-slate-950/95 p-3">
                <p className="text-xs font-medium text-slate-500">{copy.imagePrompt}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">{previewMicroShot.imagePrompt}</p>
              </aside>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function LegacyNarrativeSkeletonJsonReview({
  lang,
  project,
  report,
  blocking,
  loading,
  onSave,
}: {
  lang: "zh" | "en";
  project: VideoProject;
  report?: StoryQualityReport;
  blocking: boolean;
  loading: boolean;
  onSave: (draft: NarrativeSkeletonDraft) => Promise<void>;
}) {
  const [strategyText, setStrategyText] = useState(() => prettyDebugJson(project.planDebug?.creativeStrategy ?? {}));
  const [beatsText, setBeatsText] = useState(() => prettyDebugJson(project.planDebug?.storyBeats ?? []));
  const [parseError, setParseError] = useState("");

  useEffect(() => {
    setStrategyText(prettyDebugJson(project.planDebug?.creativeStrategy ?? {}));
    setBeatsText(prettyDebugJson(project.planDebug?.storyBeats ?? []));
    setParseError("");
  }, [project.id, project.planDebug?.creativeStrategy, project.planDebug?.storyBeats]);

  async function save() {
    try {
      const creativeStrategy = JSON.parse(strategyText) as CreativeStrategyData;
      const storyBeats = JSON.parse(beatsText) as StoryBeatData[];
      if (!creativeStrategy || Array.isArray(creativeStrategy) || typeof creativeStrategy !== "object") throw new Error(lang === "zh" ? "创意策略必须是 JSON 对象。" : "Creative strategy must be a JSON object.");
      if (!Array.isArray(storyBeats)) throw new Error(lang === "zh" ? "剧情节拍必须是 JSON 数组。" : "Story beats must be a JSON array.");
      setParseError("");
      await onSave({ creativeStrategy, storyBeats, storyQualityReport: report, shotGroupingPass: project.planDebug?.shotGroupingPass });
    } catch (error) {
      setParseError(error instanceof Error ? error.message : (lang === "zh" ? "JSON 格式错误。" : "Invalid JSON."));
    }
  }

  return (
    <section className={`space-y-4 rounded-md border p-4 ${blocking ? "border-amber-300/30 bg-amber-300/5" : "border-white/10 bg-slate-950/45"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">{lang === "zh" ? "剧情骨架审核" : "Narrative skeleton review"}</h3>
          <p className="mt-1 text-xs text-slate-400">
            {lang === "zh" ? `质量评分：${report?.score ?? "-"} · ${blocking ? "需要修正后才能确认脚本" : "可以继续审核"}` : `Quality score: ${report?.score ?? "-"} · ${blocking ? "Fix before script approval" : "Ready for review"}`}
          </p>
        </div>
        <button type="button" onClick={save} disabled={loading} className="inline-flex h-9 items-center gap-2 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-3 text-sm font-medium text-cyan-100 hover:bg-cyan-400/15 disabled:opacity-50">
          <Save className="h-4 w-4" /> {lang === "zh" ? "保存剧情骨架" : "Save skeleton"}
        </button>
      </div>
      {report?.summaryZh && <p className="rounded border border-white/10 bg-black/20 px-3 py-2 text-xs leading-5 text-slate-300">{report.summaryZh}</p>}
      <div className="grid gap-3 lg:grid-cols-2">
        <Field label={lang === "zh" ? "创意策略（JSON）" : "Creative strategy (JSON)"}>
          <AutoResizeTextarea minRows={9} maxRows={24} value={strategyText} onChange={(event) => setStrategyText(event.target.value)} className="w-full resize-none rounded-md border border-white/10 bg-slate-950 px-3 py-2 font-mono text-xs leading-5 text-slate-200 outline-none focus:border-cyan-400/50" />
        </Field>
        <Field label={lang === "zh" ? "剧情节拍（JSON）" : "Story beats (JSON)"}>
          <AutoResizeTextarea minRows={9} maxRows={24} value={beatsText} onChange={(event) => setBeatsText(event.target.value)} className="w-full resize-none rounded-md border border-white/10 bg-slate-950 px-3 py-2 font-mono text-xs leading-5 text-slate-200 outline-none focus:border-cyan-400/50" />
        </Field>
      </div>
      {report?.issues?.length ? (
        <div className="space-y-1.5">
          {report.issues.map((issue, index) => <p key={`${issue.code}-${index}`} className="text-xs text-amber-100/90">{issue.code}: {issue.messageZh ?? issue.recommendationZh ?? "-"}</p>)}
        </div>
      ) : null}
      {parseError && <p className="text-xs text-rose-300">{parseError}</p>}
    </section>
  );
}

function GenerationCandidatePicker({ candidates, lang, loading, onSelect, onRetry }: {
  candidates: GenerationCandidate[];
  lang: "zh" | "en";
  loading: boolean;
  onSelect: (candidate: GenerationCandidate) => void;
  onRetry?: (retryInstruction: string) => void;
}) {
  if (!candidates.length) return null;
  return (
    <div className="space-y-2 rounded-md border border-cyan-400/15 bg-cyan-400/[0.03] p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-cyan-100">{lang === "zh" ? "生成候选与质量择优" : "Generation candidates and quality"}</p>
        <span className="text-[11px] text-slate-500">{lang === "zh" ? "系统择优，用户可改选" : "Auto-selected; manual override available"}</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(6.75rem,1fr))] gap-2">
        {candidates.map((candidate) => {
          const report = candidate.qualityReport;
          const isVideo = candidate.kind === "segment_video";
          const statusText = candidate.userAccepted && candidate.passed === false
            ? (lang === "zh" ? "系统未通过 · 用户接受" : "System failed · user accepted")
            : candidate.passed === true
              ? (lang === "zh" ? "系统通过" : "System passed")
              : candidate.passed === false
                ? (lang === "zh" ? "系统未通过" : "System failed")
                : candidate.selected ? (lang === "zh" ? "当前候选" : "Selected") : candidate.status;
          return (
            <div key={candidate.id} className={`overflow-hidden rounded-md border ${candidate.selected ? "border-emerald-400/60" : candidate.passed === false ? "border-rose-400/20" : "border-white/10"} bg-slate-950/70`}>
              <div className="aspect-[9/12] bg-black/30">
                {candidate.mediaUrl ? (isVideo
                  ? <video src={candidate.mediaUrl} controls playsInline preload="metadata" className="h-full w-full object-contain" />
                  : <img src={previewImageSrc(candidate.mediaUrl)} alt={`candidate ${candidate.candidateNo}`} className="h-full w-full object-contain" />
                ) : <div className="flex h-full items-center justify-center text-xs text-slate-600">{candidate.status}</div>}
              </div>
              <div className="space-y-1.5 p-2">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-slate-300">#{candidate.candidateNo} · {candidate.compositeScore == null ? "—" : candidate.compositeScore.toFixed(1)}</span>
                  <span className={candidate.passed === true ? "text-emerald-300" : candidate.passed === false ? "text-amber-300" : "text-slate-500"}>{statusText}</span>
                </div>
                {report && <div className="grid grid-cols-2 gap-x-2 gap-y-1 rounded border border-white/5 bg-black/15 p-1.5 text-[10px] text-slate-400">
                  <span>identity {formatQualityScore(report.identityScore)}</span><span>layout {formatQualityScore(report.layoutScore)}</span>
                  <span>prompt {formatQualityScore(report.promptAlignmentScore)}</span><span>continuity {formatQualityScore(report.continuityScore)}</span>
                  {typeof report.singleTakeScore === "number" && <span>single-take {formatQualityScore(report.singleTakeScore)}</span>}
                </div>}
                {!candidate.selected && candidate.mediaUrl && report ? <button type="button" disabled={loading} onClick={() => onSelect(candidate)} className={`h-7 w-full rounded text-[11px] disabled:opacity-50 ${candidate.passed === true ? "bg-cyan-500 text-slate-950" : "border border-amber-300/25 text-amber-100"}`}>
                  {candidate.passed === true ? (lang === "zh" ? "采用" : "Use") : (lang === "zh" ? "仍然采用" : "Use anyway")}
                </button> : null}
                {report?.retryInstruction && onRetry ? <button type="button" disabled={loading} onClick={() => onRetry(report.retryInstruction!)} className="inline-flex h-7 w-full items-center justify-center gap-1.5 rounded border border-cyan-300/20 text-[11px] text-cyan-100 hover:bg-cyan-300/10 disabled:opacity-50"><RefreshCw className="h-3 w-3" /> {lang === "zh" ? "优化重试" : "Retry"}</button> : null}
                {candidate.userAccepted ? <p className="text-[10px] text-amber-300">{lang === "zh" ? "已保留原始 passed=false，仅记录 userAccepted=true" : "Original passed=false is preserved; userAccepted=true recorded"}</p> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatQualityScore(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) : "-";
}

function Field({
  label,
  children,
  onUndo,
  canUndo = false,
  undoLabel = "Undo",
}: {
  label: string;
  children: ReactNode;
  onUndo?: () => void;
  canUndo?: boolean;
  undoLabel?: string;
}) {
  return (
    <div className="block space-y-1.5 [&_input]:transition [&_textarea]:transition [&_select]:transition">
      <div className="flex min-h-5 items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-400">{label}</span>
        {onUndo && (
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title={undoLabel}
            aria-label={undoLabel}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/10 text-slate-300 hover:bg-white/[0.06] disabled:pointer-events-none disabled:opacity-30"
          >
            <Undo2 className="h-3 w-3" />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function AutoResizeTextarea({
  minRows = 2,
  maxRows = 8,
  className,
  onChange,
  value,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  minRows?: number;
  maxRows?: number;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const resize = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const style = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(style.lineHeight) || 20;
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
    const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
    const borderBottom = Number.parseFloat(style.borderBottomWidth) || 0;
    const chromeHeight = paddingTop + paddingBottom + borderTop + borderBottom;
    const minHeight = Math.ceil(lineHeight * minRows + chromeHeight);
    const maxHeight = Math.ceil(lineHeight * maxRows + chromeHeight);
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [maxRows, minRows]);

  useEffect(() => {
    resize();
  }, [resize, value]);

  return (
    <textarea
      {...props}
      ref={textareaRef}
      value={value}
      rows={minRows}
      onChange={(event) => {
        onChange?.(event);
        window.requestAnimationFrame(resize);
      }}
      className={className}
    />
  );
}

function mediaRevisionKey(kind: MediaRevisionKind, targetId: string, microShotNo?: number): string {
  return kind === "micro_shot_image"
    ? `${kind}:${targetId}:${Number(microShotNo)}`
    : `${kind}:${targetId}`;
}

function hasMediaRevision(project: VideoProject | null, kind: MediaRevisionKind, targetId: string, microShotNo?: number): boolean {
  return Boolean(project?.planDebug?.mediaRevisionHistory?.[mediaRevisionKey(kind, targetId, microShotNo)]?.length);
}

function PreviewSizeControl({
  label,
  value,
  onPreview,
  onCommit,
}: {
  label: string;
  value: number;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const [draftValue, setDraftValue] = useState(value);
  const frameRef = useRef<number | null>(null);
  const latestValueRef = useRef(value);

  useEffect(() => {
    setDraftValue(value);
    latestValueRef.current = value;
  }, [value]);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, []);

  function preview(nextValue: number) {
    const next = clampDetailPreviewHeight(nextValue);
    latestValueRef.current = next;
    setDraftValue(next);
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      onPreview(latestValueRef.current);
    });
  }

  function commit(nextValue: number) {
    const next = clampDetailPreviewHeight(nextValue);
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    setDraftValue(next);
    onCommit(next);
  }

  return (
    <label className="flex min-w-[150px] items-center gap-2 text-[11px] text-slate-500">
      <span className="shrink-0">{label}</span>
      <input
        type="range"
        min={DETAIL_PREVIEW_MIN_HEIGHT}
        max={DETAIL_PREVIEW_MAX_HEIGHT}
        step={20}
        value={draftValue}
        onInput={(event) => preview(Number(event.currentTarget.value))}
        onPointerUp={(event) => commit(Number(event.currentTarget.value))}
        onPointerCancel={(event) => commit(Number(event.currentTarget.value))}
        onBlur={(event) => commit(Number(event.currentTarget.value))}
        onKeyUp={(event) => commit(Number(event.currentTarget.value))}
        className="flex-1"
      />
    </label>
  );
}

function subtitleLimitForLang(lang: PageLang): number {
  return lang === "en" ? 72 : 24;
}

function previewImageSrc(url?: string | null): string {
  const value = String(url ?? "").trim();
  if (!value || value.startsWith("/") || value.startsWith("data:")) return value;
  return `/api/download-external-image?url=${encodeURIComponent(value)}`;
}

function MicroShotHelpButton({
  copy,
  lang,
  open,
  onToggle,
}: {
  copy: Copy;
  lang: PageLang;
  open: boolean;
  onToggle: () => void;
}) {
  const items = lang === "en"
    ? [
        ["What it is", copy.microShotHint],
        ["Time", copy.microShotTimeHint],
        ["Reference type", "text only constrains by words; image_prompt generates a previewable reference image; mixed uses both text and image control."],
        ["Purpose", "The role of this checkpoint inside the current shot."],
        ["Scene", "The visual state or environment at this moment."],
        ["Action", "The subject or camera action that should be visible at this checkpoint."],
        ["Image Prompt", copy.microShotImageHint],
      ]
    : [
        ["是什么", copy.microShotHint],
        ["时间点", copy.microShotTimeHint],
        ["参考类型", "text 只做文字约束；image_prompt 会生成可预览的内部参考图；mixed 同时使用文字和图片约束。"],
        ["镜头目的", "说明这个检查点在当前镜头内部承担的作用。"],
        ["场景", "描述这个时间点的画面状态或环境。"],
        ["动作说明", "描述人物、产品、镜头在这个检查点应该呈现的动作。"],
        ["图片 Prompt", copy.microShotImageHint],
      ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-label={lang === "en" ? "Micro-shot help" : "\u5b50\u5206\u955c\u8bf4\u660e"}
        className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px] transition ${open ? "border-fuchsia-300/60 bg-fuchsia-300/15 text-fuchsia-100" : "border-white/15 text-slate-400 hover:border-fuchsia-300/45 hover:text-fuchsia-100"}`}
      >
        <CircleHelp className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute left-0 top-7 z-50 w-[340px] max-w-[calc(100vw-3rem)] rounded-md border border-fuchsia-300/25 bg-slate-950/95 p-3 text-xs shadow-[0_18px_50px_rgba(0,0,0,0.42)] backdrop-blur">
          <p className="mb-2 text-sm font-semibold text-fuchsia-100">{copy.microShots}</p>
          <div className="space-y-2">
            {items.map(([title, body]) => (
              <div key={title}>
                <p className="font-medium text-slate-200">{title}</p>
                <p className="mt-0.5 leading-5 text-slate-400">{body}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NarrativeSkeletonReview({
  lang,
  project,
  report,
  blocking,
  loading,
  onSave,
}: {
  lang: PageLang;
  project: VideoProject;
  report?: StoryQualityReport;
  blocking: boolean;
  loading: boolean;
  onSave: (draft: NarrativeSkeletonDraft) => Promise<void>;
}) {
  const labels = narrativeSkeletonLabels(lang);
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState<NarrativeSkeletonDraft>(() => narrativeDraftFromProject(project));
  const original = useMemo(() => narrativeDraftFromProject(project), [project]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(original);
  const strategy = draft.creativeStrategy;
  const beats = draft.storyBeats;
  const qualityReport = draft.storyQualityReport ?? report;
  const issues = qualityReport?.issues ?? [];
  const shotBindings = buildShotBeatBindings(project);
  const groupingGroups = Array.isArray(draft.shotGroupingPass?.groups) ? draft.shotGroupingPass?.groups ?? [] : [];
  const splitReasons = Array.isArray(draft.shotGroupingPass?.splitReasons) ? draft.shotGroupingPass?.splitReasons ?? [] : [];

  useEffect(() => {
    setDraft(narrativeDraftFromProject(project));
  }, [project]);

  function updateStrategyField(key: keyof CreativeStrategyData, value: string) {
    setDraft((current) => ({
      ...current,
      creativeStrategy: {
        ...current.creativeStrategy,
        [key]: value,
      },
      storyQualityReport: markStoryQualityManuallyEdited(current.storyQualityReport ?? report),
    }));
  }

  function updateBeat(index: number, key: keyof StoryBeatData, value: string) {
    setDraft((current) => ({
      ...current,
      storyBeats: current.storyBeats.map((beat, beatIndex) => beatIndex === index ? { ...beat, [key]: value } : beat),
      storyQualityReport: markStoryQualityManuallyEdited(current.storyQualityReport ?? report),
    }));
  }

  async function save() {
    await onSave(draft);
  }

  return (
    <section className={`rounded-md border p-4 ${blocking ? "border-amber-300/25 bg-amber-300/10" : "border-cyan-300/20 bg-cyan-300/[0.035]"}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-white">{labels.title}</p>
            <span className={`rounded px-2 py-0.5 text-[11px] ${blocking ? "bg-amber-300/15 text-amber-100" : "bg-emerald-300/10 text-emerald-100"}`}>
              {blocking ? labels.blocked : labels.passable}
            </span>
            {typeof qualityReport?.score === "number" && (
              <span className="rounded bg-black/20 px-2 py-0.5 text-[11px] text-slate-300">score {qualityReport.score}</span>
            )}
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-400">{labels.hint}</p>
        </div>
        {open ? <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />}
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          {blocking && (
            <div className="rounded-md border border-amber-300/25 bg-black/15 p-3 text-xs leading-5 text-amber-100">
              <p className="font-semibold">{labels.blockReason}</p>
              <p className="mt-1">{labels.blockHint}</p>
              <div className="mt-2 space-y-1">
                {(qualityReport?.rewriteReasons?.length ? qualityReport.rewriteReasons : issues.map((issue) => issue.messageZh || issue.code)).slice(0, 5).map((item, index) => (
                  <p key={`${item}-${index}`}>- {item}</p>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-3 lg:grid-cols-4">
            <NarrativeInfoCard label={labels.videoCategory} value={stringField(strategy.videoCategory)} />
            <NarrativeInfoCard label={labels.templateId} value={stringField(strategy.templateId)} />
            <NarrativeInfoCard label={labels.conversionGoal} value={stringField(strategy.conversionGoal)} />
            <NarrativeInfoCard label={labels.templateReason} value={stringField(strategy.templateReason)} wide />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {([
              ["hook", labels.hook],
              ["conflict", labels.conflict],
              ["turningPoint", labels.turningPoint],
              ["payoff", labels.payoff],
              ["cta", labels.cta],
              ["conversionGoal", labels.conversionGoal],
            ] as Array<[keyof CreativeStrategyData, string]>).map(([key, label]) => (
              <Field key={String(key)} label={label}>
                <AutoResizeTextarea
                  minRows={2}
                  maxRows={5}
                  value={stringField(strategy[key])}
                  onChange={(event) => updateStrategyField(key, event.target.value)}
                  className="w-full resize-none rounded-md border border-white/10 bg-slate-950/70 px-3 py-2 text-sm leading-5 text-slate-100 outline-none focus:border-cyan-300/60"
                />
              </Field>
            ))}
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-white">{labels.beats}</p>
              <span className="text-xs text-slate-500">{beats.length} beats</span>
            </div>
            {beats.length ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {beats.map((beat, index) => (
                  <div key={`${beatKey(beat)}-${index}`} className="rounded-md border border-white/10 bg-slate-950/55 p-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="rounded bg-cyan-300/10 px-2 py-0.5 text-[11px] font-medium text-cyan-100">{beatKey(beat) || `beat-${index + 1}`}</span>
                      <span className="rounded bg-black/20 px-2 py-0.5 text-[11px] text-slate-400">{stringField(beat.beatType ?? beat.type ?? beat.storyFunction ?? beat.function) || labels.unknown}</span>
                    </div>
                    <div className="space-y-3">
                      <Field label={labels.storyMoment}>
                        <AutoResizeTextarea minRows={2} maxRows={5} value={beatPrimaryText(beat)} onChange={(event) => updateBeat(index, preferredBeatTextKey(beat), event.target.value)} className="w-full resize-none rounded-md border border-white/10 bg-slate-950/70 px-3 py-2 text-sm leading-5 text-slate-100 outline-none focus:border-cyan-300/60" />
                      </Field>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label={labels.cause}>
                          <AutoResizeTextarea minRows={1} maxRows={4} value={stringField(beat.cause)} onChange={(event) => updateBeat(index, "cause", event.target.value)} className="w-full resize-none rounded-md border border-white/10 bg-slate-950/70 px-3 py-2 text-xs leading-5 text-slate-100 outline-none focus:border-cyan-300/60" />
                        </Field>
                        <Field label={labels.effect}>
                          <AutoResizeTextarea minRows={1} maxRows={4} value={stringField(beat.effect)} onChange={(event) => updateBeat(index, "effect", event.target.value)} className="w-full resize-none rounded-md border border-white/10 bg-slate-950/70 px-3 py-2 text-xs leading-5 text-slate-100 outline-none focus:border-cyan-300/60" />
                        </Field>
                      </div>
                      {Array.isArray(beat.keyEvidenceIds) && beat.keyEvidenceIds.length > 0 && (
                        <DebugTextList title={labels.keyEvidence} items={beat.keyEvidenceIds.map(String)} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-white/10 bg-slate-950/50 px-3 py-6 text-center text-sm text-slate-500">{labels.emptyBeats}</p>
            )}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-md border border-white/10 bg-slate-950/55 p-3">
              <p className="text-sm font-semibold text-white">{labels.shotBindings}</p>
              {shotBindings.length ? (
                <div className="mt-3 space-y-2">
                  {shotBindings.map((item) => (
                    <div key={item.shotNo} className="rounded-md border border-white/10 bg-white/[0.03] p-2 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-cyan-100">{labels.shot} {String(item.shotNo).padStart(2, "0")}</span>
                        <span className="rounded bg-black/20 px-1.5 py-0.5 text-slate-400">{item.linkedBeatIds.join(", ") || labels.noBeat}</span>
                      </div>
                      {item.storyFunction && <p className="mt-1 text-slate-400">{item.storyFunction}</p>}
                      {item.emotionalBeat && <p className="mt-1 text-slate-500">{item.emotionalBeat}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-500">{labels.noBindings}</p>
              )}
            </div>

            <div className="space-y-3">
              <div className={`rounded-md border p-3 ${blocking ? "border-amber-300/25 bg-amber-300/10" : "border-emerald-300/20 bg-emerald-300/5"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-white">{labels.qualityReport}</p>
                  <span className="rounded bg-black/20 px-1.5 py-0.5 text-xs text-slate-300">score {qualityReport?.score ?? "-"}</span>
                </div>
                {issues.length ? (
                  <div className="mt-3 space-y-2">
                    {issues.slice(0, 6).map((issue, index) => (
                      <div key={`${issue.code}-${index}`} className="rounded-md border border-white/10 bg-black/15 p-2 text-xs leading-5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className={issue.severity === "error" ? "text-amber-100" : "text-slate-200"}>{issue.messageZh || issue.code}</span>
                          <span className="rounded bg-black/20 px-1.5 py-0.5 text-slate-500">{issue.code}</span>
                        </div>
                        {issue.recommendationZh && <p className="mt-1 text-slate-400">{issue.recommendationZh}</p>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">{labels.noIssues}</p>
                )}
              </div>

              <div className="rounded-md border border-white/10 bg-slate-950/55 p-3">
                <p className="text-sm font-semibold text-white">{labels.shotGrouping}</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <DebugObjectList title={labels.groups} items={groupingGroups.filter(isPlainRecord)} />
                  <DebugObjectList title={labels.splitReasons} items={splitReasons.filter(isPlainRecord)} />
                </div>
                {!groupingGroups.length && !splitReasons.length && <p className="mt-3 text-sm text-slate-500">{labels.emptyGrouping}</p>}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
            <p className="text-xs leading-5 text-slate-500">{labels.dirtyHint}</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setDraft(original)} disabled={!dirty || loading} className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-xs font-medium text-slate-300 hover:bg-white/[0.06] disabled:pointer-events-none disabled:opacity-35">
                <Undo2 className="h-3.5 w-3.5" />
                {labels.undo}
              </button>
              <button type="button" onClick={save} disabled={!dirty || loading} className="inline-flex h-9 items-center gap-2 rounded-md border border-cyan-300/30 bg-cyan-300/10 px-3 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/15 disabled:pointer-events-none disabled:opacity-35">
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {dirty ? labels.save : labels.saved}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function NarrativeInfoCard({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`rounded-md border border-white/10 bg-slate-950/55 p-3 ${wide ? "lg:col-span-1" : ""}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 line-clamp-2 text-sm leading-5 text-slate-200">{value || "-"}</p>
    </div>
  );
}

const DEBUG_COPY = {
  zh: {
    debug: "调试",
    context: "当前对象",
    events: "事件层",
    anchors: "一致性",
    states: "动态状态",
    references: "参考图选择",
    prompts: "Prompt 编译",
    audit: "一镜到底审计",
    save: "保存",
    undo: "撤销",
    saved: "调试信息已保存，相关局部产物已标记为需要重跑。",
    invalidJson: "JSON 格式不正确，请检查逗号、括号和引号。",
    arrayRequired: "这里必须保存为数组 JSON。",
    empty: "暂无记录",
    selectedRefs: "已选参考图",
    candidates: "候选参考图",
    usageNotes: "使用说明",
    finalPrompt: "最终 Prompt",
    beforePrompt: "编译前",
    negativePrompt: "负向 Prompt",
    rules: "规则",
    warnings: "警告",
    dirty: "局部变更追踪",
    blockReason: "阻止生成原因",
    segmentContract: "镜头执行合同",
    jsonTip: "短期版本使用 JSON 编辑；保存后只标记相关链路 dirty，不会覆盖已锁定资产。",
  },
  en: {
    debug: "Debug",
    context: "Current target",
    events: "Events",
    anchors: "Consistency",
    states: "State Timeline",
    references: "References",
    prompts: "Prompt Compiler",
    audit: "Single-take Audit",
    save: "Save",
    undo: "Undo",
    saved: "Debug data saved. Affected local artifacts were marked dirty.",
    invalidJson: "Invalid JSON. Check commas, brackets, and quotes.",
    arrayRequired: "This section must be saved as a JSON array.",
    empty: "No records yet",
    selectedRefs: "Selected references",
    candidates: "Reference candidates",
    usageNotes: "Usage notes",
    finalPrompt: "Final prompt",
    beforePrompt: "Before compile",
    negativePrompt: "Negative prompt",
    rules: "Rules",
    warnings: "Warnings",
    dirty: "Local dirty tracking",
    blockReason: "Generation block reason",
    segmentContract: "Segment execution contract",
    jsonTip: "Short-term editor uses JSON. Saving marks only affected downstream artifacts dirty and does not overwrite locked assets.",
  },
} as const;

type DebugLabels = Record<keyof typeof DEBUG_COPY.zh, string>;

interface DebugContext {
  title: string;
  targetIds: string[];
  segmentDescription?: Record<string, unknown>;
}

function PlanDebugPanel({
  lang,
  labels,
  project,
  activeTab,
  onTabChange,
  draft,
  onDraftChange,
  onSaveSection,
  onUndoSection,
  contextTitle,
  referenceSelections,
  promptArtifacts,
  dirtyArtifacts,
  selectedSegmentDescription,
  projectError,
  loading,
  qualityReports,
}: {
  lang: PageLang;
  labels: DebugLabels;
  project: VideoProject;
  activeTab: DebugTab;
  onTabChange: (tab: DebugTab) => void;
  draft: Record<EditableDebugSection, string>;
  onDraftChange: (section: EditableDebugSection, value: string) => void;
  onSaveSection: (section: EditableDebugSection) => void;
  onUndoSection: (section: EditableDebugSection) => void;
  contextTitle: string;
  referenceSelections: ReferenceSelectionOutput[];
  promptArtifacts: PromptDebugArtifact[];
  dirtyArtifacts: Array<{ id: string; metadata: ArtifactMetadata }>;
  qualityReports: GenerationQualityReport[];
  selectedSegmentDescription?: Record<string, unknown>;
  projectError?: string | null;
  loading: boolean;
}) {
  const tabs: Array<{ key: DebugTab; label: string }> = [
    { key: "events", label: labels.events },
    { key: "anchors", label: labels.anchors },
    { key: "states", label: labels.states },
    { key: "references", label: labels.references },
    { key: "prompts", label: labels.prompts },
    { key: "audit", label: labels.audit },
  ];
  return (
    <section className="rounded-md border border-fuchsia-300/20 bg-fuchsia-300/[0.035] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-fuchsia-100">{labels.debug}</p>
          <p className="mt-1 text-xs text-slate-400">{labels.context}: {contextTitle}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange(tab.key)}
              className={`h-8 rounded-md border px-2.5 text-xs font-medium transition ${
                activeTab === tab.key
                  ? "border-fuchsia-300/45 bg-fuchsia-300/15 text-fuchsia-100"
                  : "border-white/10 bg-slate-950/50 text-slate-400 hover:border-white/20 hover:bg-white/[0.06]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {(activeTab === "events" || activeTab === "anchors" || activeTab === "states") && (
        <DebugJsonEditor
          section={activeTab}
          labels={labels}
          value={draft[activeTab]}
          onChange={(value) => onDraftChange(activeTab, value)}
          onSave={() => onSaveSection(activeTab)}
          onUndo={() => onUndoSection(activeTab)}
          canUndo={draft[activeTab] !== (activeTab === "events" ? prettyDebugJson(project.planDebug?.narrativeEvents ?? []) : activeTab === "anchors" ? prettyDebugJson(project.planDebug?.consistencyAnchors ?? []) : prettyDebugJson(project.planDebug?.anchorStateTimeline ?? []))}
          loading={loading}
        />
      )}

      {activeTab === "references" && (
        <div className="mt-4 space-y-3">
          {referenceSelections.length ? referenceSelections.map((item, index) => (
            <div key={`${item.targetArtifactId ?? index}`} className="rounded-md border border-white/10 bg-slate-950/60 p-3">
              <DebugMetaHeader title={String(item.targetArtifactId ?? item.targetType ?? `reference-${index + 1}`)} subtitle={item.targetType} />
              {(item.targetOrientation || item.selectedView || item.orientationFallback || item.policyVersion) && (
                <p className="mt-2 text-[11px] leading-5 text-slate-400">
                  {item.targetOrientation ? `target orientation: ${item.targetOrientation} · ` : ""}
                  {item.selectedView ? `selected view: ${item.selectedView} · ` : ""}
                  {item.orientationFallback ? `fallback: ${item.orientationFallback} · ` : ""}
                  {item.policyVersion ? `policy: ${item.policyVersion}` : ""}
                </p>
              )}
              <DebugImageStrip title={labels.selectedRefs} urls={item.selectedReferenceUrls ?? []} />
              <DebugTextList title={labels.usageNotes} items={item.usageNotes ?? []} />
              <ReferenceSelectorCandidateGrid candidates={item.candidates ?? []} lang={lang} />
              {item.finalTextPrompt && <DebugPromptBlock title={labels.finalPrompt} value={item.finalTextPrompt} />}
              <DebugTextList title={labels.warnings} items={item.warnings ?? []} tone="warning" />
            </div>
          )) : <DebugEmpty labels={labels} />}
        </div>
      )}

      {activeTab === "prompts" && (
        <div className="mt-4 space-y-3">
          {promptArtifacts.length ? promptArtifacts.map((artifact, index) => (
            <div key={`${artifact.targetArtifactId ?? index}`} className="rounded-md border border-white/10 bg-slate-950/60 p-3">
              <DebugMetaHeader title={String(artifact.targetArtifactId ?? `prompt-${index + 1}`)} subtitle={artifact.targetType} />
              <DebugImageStrip title={labels.selectedRefs} urls={artifact.selectedReferenceUrls ?? []} />
              <DebugTextList title={labels.usageNotes} items={artifact.referenceUsageNotes ?? []} />
              <DebugPromptBlock title={labels.beforePrompt} value={artifact.beforePrompt} />
              <DebugPromptBlock title={labels.finalPrompt} value={artifact.finalPrompt} />
              <DebugPromptBlock title={labels.negativePrompt} value={artifact.finalNegativePrompt} />
              <DebugTextList title={labels.rules} items={artifact.rules ?? []} />
              <DebugTextList title={labels.warnings} items={artifact.warnings ?? []} tone="warning" />
            </div>
          )) : <DebugEmpty labels={labels} />}
        </div>
      )}

      {activeTab === "audit" && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="rounded-md border border-white/10 bg-slate-950/60 p-3">
            <p className="text-sm font-semibold text-white">{labels.segmentContract}</p>
            {selectedSegmentDescription ? (
              <pre className="mt-3 max-h-80 overflow-auto rounded-md border border-white/10 bg-black/20 p-3 text-xs leading-5 text-slate-300">{prettyDebugJson(pickAuditFields(selectedSegmentDescription))}</pre>
            ) : (
              <p className="mt-3 text-sm text-slate-500">{labels.empty}</p>
            )}
            {Boolean(project.planDebug?.finalTransitionPlan?.length) && (
              <DebugPromptBlock title={lang === "en" ? "Final transition plan" : "最终转场计划"} value={prettyDebugJson(project.planDebug?.finalTransitionPlan)} />
            )}
            {project.planDebug?.audioBible && Object.keys(project.planDebug.audioBible).length > 0 && (
              <DebugPromptBlock title="Audio Bible" value={prettyDebugJson(project.planDebug.audioBible)} />
            )}
            {project.planDebug?.plannerShadow && Object.keys(project.planDebug.plannerShadow).length > 0 && (
              <DebugPromptBlock title={lang === "en" ? "Planner shadow output" : "Planner shadow 输出"} value={prettyDebugJson(project.planDebug.plannerShadow)} />
            )}
          </div>
          <div className="space-y-3">
            {project.planDebug?.storyQualityReport && (
              <div className={`rounded-md border p-3 ${project.planDebug.storyQualityReport.rewriteRequired ? "border-amber-300/25 bg-amber-300/10" : "border-emerald-300/20 bg-emerald-300/5"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-white">{lang === "en" ? "Story quality report" : "剧情质量报告"}</p>
                  <span className="rounded bg-black/20 px-1.5 py-0.5 text-xs text-slate-300">score {project.planDebug.storyQualityReport.score ?? "-"}</span>
                </div>
                {project.planDebug.storyQualityReport.rewriteRequired && (
                  <p className="mt-2 text-xs leading-5 text-amber-100/85">
                    {lang === "en" ? "Auto rewrite exhausted. Review the layer and issues below before approving the plan." : "自动重写已用尽。确认方案前，请检查下方失败层级和具体问题。"}
                  </p>
                )}
                <pre className="mt-3 max-h-64 overflow-auto rounded-md border border-white/10 bg-black/20 p-3 text-xs leading-5 text-slate-300">{prettyDebugJson(project.planDebug.storyQualityReport)}</pre>
              </div>
            )}
            <div className="rounded-md border border-white/10 bg-slate-950/60 p-3">
              <p className="text-sm font-semibold text-white">{lang === "en" ? "Quality reports" : "质量报告"}</p>
              {qualityReports.length ? (
                <div className="mt-3 space-y-2">
                  {qualityReports.map((report) => (
                    <div key={report.assetId} className={`rounded-md border p-2 text-xs ${report.passed ? "border-emerald-300/20 bg-emerald-300/5" : "border-amber-300/25 bg-amber-300/10"}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-cyan-100">{report.assetId}</span>
                        <span className={`rounded px-1.5 py-0.5 ${report.passed ? "bg-emerald-300/10 text-emerald-100" : "bg-amber-300/10 text-amber-100"}`}>
                          {report.passed
                            ? (lang === "zh" ? "系统通过" : "System passed")
                            : report.userAccepted
                              ? (lang === "zh" ? "系统未通过 · 用户接受" : "System failed · user accepted")
                              : (lang === "zh" ? "系统未通过" : "System failed")}
                        </span>
                      </div>
                      <p className="mt-1 text-slate-400">
                        identity {report.identityScore} / layout {report.layoutScore} / prompt {report.promptAlignmentScore} / continuity {report.continuityScore}
                        {typeof report.singleTakeScore === "number" ? ` / single-take ${report.singleTakeScore}` : ""}
                      </p>
                      {report.artifactIssues.length > 0 && <p className="mt-1 leading-5 text-slate-300">{report.artifactIssues.join("; ")}</p>}
                      {report.retryInstruction && <p className="mt-1 leading-5 text-amber-100/80">{report.retryInstruction}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-500">{labels.empty}</p>
              )}
            </div>
            {(projectError || project.status === "FAILED") && (
              <div className="rounded-md border border-amber-300/25 bg-amber-300/10 p-3">
                <p className="text-sm font-semibold text-amber-100">{labels.blockReason}</p>
                <p className="mt-2 text-sm leading-6 text-amber-100/80">{projectError || project.status}</p>
              </div>
            )}
            <div className="rounded-md border border-white/10 bg-slate-950/60 p-3">
              <p className="text-sm font-semibold text-white">{labels.dirty}</p>
              {dirtyArtifacts.length ? (
                <div className="mt-3 space-y-2">
                  {dirtyArtifacts.map(({ id, metadata }) => (
                    <div key={id} className="rounded-md border border-white/10 bg-white/[0.03] p-2 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-cyan-100">{id}</span>
                        <span className="rounded bg-black/20 px-1.5 py-0.5 text-slate-400">{metadata.status ?? "unknown"} r{metadata.revision ?? 1}</span>
                      </div>
                      {(metadata.artifactType || metadata.producedByStage) && <p className="mt-1 text-slate-500">{metadata.artifactType ?? "artifact"} · produced by {metadata.producedByStage ?? "unknown"}</p>}
                      {metadata.retryFromStage && <p className="mt-1 text-slate-500">retry: {metadata.retryFromStage}</p>}
                      {metadata.invalidatedByArtifactIds?.length ? <p className="mt-1 leading-5 text-amber-100/70">invalidated by: {metadata.invalidatedByArtifactIds.join(", ")}</p> : null}
                      {metadata.parentRevisionIds?.length ? <p className="mt-1 leading-5 text-slate-500">parent revisions: {metadata.parentRevisionIds.join(", ")}</p> : null}
                      {metadata.userAccepted ? <p className="mt-1 text-emerald-200/80">user fixed: automatic resume will preserve this active media</p> : null}
                      {metadata.dirtyReason && <p className="mt-1 leading-5 text-slate-400">{metadata.dirtyReason}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-500">{labels.empty}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function DebugJsonEditor({
  section,
  labels,
  value,
  onChange,
  onSave,
  onUndo,
  canUndo,
  loading,
}: {
  section: EditableDebugSection;
  labels: DebugLabels;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onUndo: () => void;
  canUndo: boolean;
  loading: boolean;
}) {
  const title = section === "events" ? labels.events : section === "anchors" ? labels.anchors : labels.states;
  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="mt-1 text-xs text-slate-500">{labels.jsonTip}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onUndo} disabled={!canUndo} className="inline-flex h-8 items-center gap-2 rounded-md border border-white/10 px-3 text-xs font-medium text-slate-300 hover:bg-white/[0.06] disabled:pointer-events-none disabled:opacity-30">
            <Undo2 className="h-3.5 w-3.5" /> {labels.undo}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={loading}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-cyan-300/30 bg-cyan-300/10 px-3 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/15 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {labels.save}
          </button>
        </div>
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        className="min-h-72 w-full rounded-md border border-white/10 bg-slate-950/70 p-3 font-mono text-xs leading-5 text-slate-200 outline-none transition focus:border-fuchsia-300/50"
      />
    </div>
  );
}

function DebugMetaHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-semibold text-cyan-100">{title}</p>
      {subtitle && <span className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-slate-400">{subtitle}</span>}
    </div>
  );
}

function DebugImageStrip({ title, urls }: { title: string; urls: string[] }) {
  if (!urls.length) return null;
  return (
    <div className="mt-3">
      <p className="mb-2 text-xs font-medium text-slate-400">{title}</p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {urls.map((url) => (
          <img key={url} src={previewImageSrc(url)} alt={title} className="h-20 w-16 shrink-0 rounded-md border border-white/10 object-cover" />
        ))}
      </div>
    </div>
  );
}

function DebugTextList({ title, items, tone }: { title: string; items: string[]; tone?: "warning" }) {
  const safeItems = items.filter(Boolean);
  if (!safeItems.length) return null;
  return (
    <div className="mt-3">
      <p className={`mb-1 text-xs font-medium ${tone === "warning" ? "text-amber-200" : "text-slate-400"}`}>{title}</p>
      <div className="space-y-1">
        {safeItems.map((item, index) => (
          <p key={`${item}-${index}`} className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-xs leading-5 text-slate-300">{item}</p>
        ))}
      </div>
    </div>
  );
}

function DebugObjectList({ title, items }: { title: string; items: Array<Record<string, unknown>> }) {
  if (!items.length) return null;
  return (
    <div className="mt-3">
      <p className="mb-1 text-xs font-medium text-slate-400">{title}</p>
      <div className="grid gap-2 lg:grid-cols-2">
        {items.slice(0, 8).map((item, index) => (
          <pre key={index} className="max-h-40 overflow-auto rounded-md border border-white/10 bg-black/20 p-2 text-[11px] leading-4 text-slate-400">{prettyDebugJson(item)}</pre>
        ))}
      </div>
    </div>
  );
}

function ReferenceSelectorCandidateGrid({ candidates, lang }: { candidates: ReferenceSelectionCandidateView[]; lang: PageLang }) {
  if (!candidates.length) return null;
  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs font-medium text-slate-400">{lang === "zh" ? "全部候选与选择依据" : "All candidates and selection rationale"}</p>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {candidates.map((candidate, index) => {
          const rejected = !candidate.selected && Boolean(candidate.rejectionReason || candidate.conflictReasons?.length);
          return (
            <div key={`${candidate.artifactId ?? "candidate"}-${index}`} className={`overflow-hidden rounded-md border bg-black/20 ${candidate.selected ? "border-emerald-300/40" : rejected ? "border-rose-300/20" : "border-white/10"}`}>
              <div className="relative aspect-video bg-slate-950/80">
                {candidate.url ? <img src={previewImageSrc(candidate.url)} alt={candidate.artifactId ?? `reference candidate ${index + 1}`} className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center text-[11px] text-slate-600">{lang === "zh" ? "无缩略图" : "No thumbnail"}</div>}
                <span className={`absolute right-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] ${candidate.selected ? "bg-emerald-400/90 text-slate-950" : rejected ? "bg-rose-400/80 text-white" : "bg-slate-950/80 text-slate-300"}`}>
                  {candidate.selected ? (lang === "zh" ? "已选中" : "Selected") : rejected ? (lang === "zh" ? "已淘汰" : "Rejected") : (lang === "zh" ? "候选" : "Candidate")}
                </span>
                {candidate.hardRequired && <span className="absolute left-1.5 top-1.5 rounded bg-cyan-400/90 px-1.5 py-0.5 text-[10px] font-semibold text-slate-950">hard anchor</span>}
              </div>
              <div className="space-y-1.5 p-2 text-[10px] leading-4">
                <p className="break-all font-medium text-cyan-100">{candidate.artifactId ?? `candidate-${index + 1}`}</p>
                <p className="text-slate-400">{candidate.purpose || candidate.quotaType || candidate.sourceType || "—"}</p>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1 rounded border border-white/5 bg-white/[0.02] p-1.5 text-slate-400">
                  <span>relevance {formatReferenceScore(candidate.relevanceScore)}</span>
                  <span>view {formatReferenceScore(candidate.viewMatchScore)}</span>
                  <span>recency {formatReferenceScore(candidate.recencyScore)}</span>
                  <span>conflict {formatReferenceScore(candidate.conflictScore)}</span>
                  <span className="col-span-2 font-medium text-cyan-100">final {formatReferenceScore(candidate.finalScore)}</span>
                </div>
                {(candidate.assetView || candidate.detectedOrientation) && <p className="text-slate-400">{lang === "zh" ? "人物朝向 / 选用视图" : "Orientation / selected view"}: {candidate.detectedOrientation ?? "unknown"} / {candidate.assetView ?? "unknown"}</p>}
                {candidate.rejectionReason && <p className="rounded bg-rose-300/5 px-1.5 py-1 text-rose-200/80">{lang === "zh" ? "淘汰原因" : "Rejection"}: {candidate.rejectionReason}</p>}
                {candidate.conflictReasons?.length ? <p className="text-rose-200/70">{candidate.conflictReasons.join("；")}</p> : null}
                {candidate.usageNote && <p className="rounded bg-cyan-300/5 px-1.5 py-1 text-cyan-100/75">usage: {candidate.usageNote}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatReferenceScore(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : "-";
}

function DebugPromptBlock({ title, value }: { title: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="mt-3">
      <p className="mb-1 text-xs font-medium text-slate-400">{title}</p>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-white/10 bg-black/20 p-3 text-xs leading-5 text-slate-300">{value}</pre>
    </div>
  );
}

function DebugEmpty({ labels }: { labels: DebugLabels }) {
  return <p className="mt-4 rounded-md border border-white/10 bg-slate-950/50 px-3 py-8 text-center text-sm text-slate-500">{labels.empty}</p>;
}

function sortProjects(items: VideoProject[]): VideoProject[] {
  return [...items].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function upsertProject(items: VideoProject[], nextProject: VideoProject): VideoProject[] {
  const exists = items.some((item) => item.id === nextProject.id);
  if (!exists) return [nextProject, ...items];
  return items.map((item) => (item.id === nextProject.id ? nextProject : item));
}

function prettyDebugJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function narrativeSkeletonLabels(lang: PageLang) {
  return lang === "en"
    ? {
        title: "Narrative skeleton review",
        hint: "Review the ad/story logic before asset generation: category, template, hook, conflict, payoff, CTA, beat binding, quality report, and shot grouping.",
        passable: "Ready to approve",
        blocked: "Needs fix",
        blockReason: "Script approval is blocked",
        blockHint: "The story quality report still has hard failures. Edit and save the skeleton, or run the rewrite flow before moving to the asset library.",
        videoCategory: "Video type",
        templateId: "Template",
        templateReason: "Template reason",
        conversionGoal: "Conversion goal",
        hook: "Hook",
        conflict: "Conflict",
        turningPoint: "Turning point",
        payoff: "Payoff",
        cta: "CTA",
        beats: "Beat sheet",
        storyMoment: "Story moment",
        cause: "Cause",
        effect: "Effect",
        keyEvidence: "Key evidence",
        shotBindings: "Shot → beat binding",
        shot: "Shot",
        noBeat: "No beat",
        noBindings: "No shot binding data yet.",
        qualityReport: "Story Quality Report",
        noIssues: "No quality issues reported.",
        shotGrouping: "Shot Grouping Pass",
        groups: "Groups",
        splitReasons: "Split reasons",
        emptyGrouping: "No grouping pass data yet.",
        emptyBeats: "No story beats yet.",
        dirtyHint: "Saving marks asset library, boundary frames, micro-shots, clips, and final composition dirty so old media will not be silently reused.",
        save: "Save skeleton",
        saved: "Saved",
        undo: "Undo",
        unknown: "unknown",
      }
    : {
        title: "剧情骨架审核",
        hint: "在生成资产库之前先审核故事逻辑：视频类型、创意模板、Hook、冲突、转折、爽点、CTA、镜头绑定、质量报告和镜头合并。",
        passable: "可确认",
        blocked: "需修改",
        blockReason: "暂不能确认脚本",
        blockHint: "剧情质量报告仍有硬失败。请先修改并保存剧情骨架，或触发重写后再进入资产库。",
        videoCategory: "视频类型",
        templateId: "创意模板",
        templateReason: "模板理由",
        conversionGoal: "转化目标",
        hook: "Hook",
        conflict: "Conflict / 冲突",
        turningPoint: "Turning Point / 转折",
        payoff: "Payoff / 爽点",
        cta: "CTA",
        beats: "剧情 Beat Sheet",
        storyMoment: "剧情节点",
        cause: "原因",
        effect: "结果",
        keyEvidence: "关键证据",
        shotBindings: "镜头绑定的 beat",
        shot: "镜头",
        noBeat: "未绑定",
        noBindings: "暂无镜头绑定数据。",
        qualityReport: "Story Quality Report",
        noIssues: "暂无质量问题。",
        shotGrouping: "Shot Grouping Pass",
        groups: "合并组",
        splitReasons: "切分原因",
        emptyGrouping: "暂无镜头合并数据。",
        emptyBeats: "暂无剧情 beat。",
        dirtyHint: "保存后会把资产库、边界帧、子分镜、视频片段和最终合成都标记为 dirty，避免继续复用旧图旧视频。",
        save: "保存剧情骨架",
        saved: "已保存",
        undo: "撤销",
        unknown: "未知",
      };
}

function narrativeDraftFromProject(project: VideoProject): NarrativeSkeletonDraft {
  return {
    creativeStrategy: clonePlainRecord(project.planDebug?.creativeStrategy),
    storyBeats: (project.planDebug?.storyBeats ?? []).filter(isPlainRecord).map((beat) => ({ ...beat })),
    storyQualityReport: project.planDebug?.storyQualityReport ? { ...project.planDebug.storyQualityReport } : undefined,
    shotGroupingPass: project.planDebug?.shotGroupingPass ? clonePlainRecord(project.planDebug.shotGroupingPass) : undefined,
  };
}

function clonePlainRecord<T extends Record<string, unknown>>(value: T | undefined): T {
  if (!isPlainRecord(value)) return {} as T;
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return { ...value };
  }
}

function stringField(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function beatKey(beat: StoryBeatData): string {
  return stringField(beat.beatId ?? beat.id);
}

function preferredBeatTextKey(beat: StoryBeatData): keyof StoryBeatData {
  if (typeof beat.storyMoment === "string") return "storyMoment";
  if (typeof beat.descriptionZh === "string") return "descriptionZh";
  if (typeof beat.description === "string") return "description";
  if (typeof beat.title === "string") return "title";
  return "storyMoment";
}

function beatPrimaryText(beat: StoryBeatData): string {
  return stringField(beat[preferredBeatTextKey(beat)]);
}

function markStoryQualityManuallyEdited(report?: StoryQualityReport): StoryQualityReport | undefined {
  if (!report) return undefined;
  return {
    ...report,
    passed: false,
    rewriteRequired: true,
    summaryZh: "用户已手动修改剧情骨架，请重新审核或重写后再确认脚本。",
    issueCodes: Array.from(new Set([...(report.issueCodes ?? []), "manual_story_edit_requires_review"])),
    issues: [
      ...(report.issues ?? []),
      {
        code: "manual_story_edit_requires_review",
        severity: "error",
        messageZh: "剧情骨架已被手动修改，需要重新审核后再进入资产库。",
        recommendationZh: "保存修改后触发重写或重新进行质量审核。",
      },
    ],
  };
}

function buildShotBeatBindings(project: VideoProject): Array<{ shotNo: number; linkedBeatIds: string[]; storyFunction?: string; emotionalBeat?: string }> {
  const descriptionByNo = new Map<number, Record<string, unknown>>();
  for (const item of project.planDebug?.segmentRenderDescriptions ?? []) {
    if (!isPlainRecord(item)) continue;
    const no = Number(item.segmentNo ?? item.segment_no ?? item.shotNo ?? item.shot_no ?? item.sequence);
    if (Number.isFinite(no)) descriptionByNo.set(no, item);
  }
  return project.shots.map((shot) => {
    const source = descriptionByNo.get(shot.shotNo) ?? (shot as unknown as Record<string, unknown>);
    return {
      shotNo: shot.shotNo,
      linkedBeatIds: readStringArray(source.linkedBeatIds ?? source.linked_beat_ids ?? source.beatIds ?? source.beat_ids),
      storyFunction: stringField(source.storyFunction ?? source.story_function),
      emotionalBeat: stringField(source.emotionalBeat ?? source.emotional_beat),
    };
  });
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringField(item)).filter(Boolean);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function buildDebugContext(
  project: VideoProject | null,
  selectedShot?: VideoShot,
  selectedKeyframe?: VideoKeyframe,
): DebugContext {
  if (!project) return { title: "", targetIds: [] };
  if (selectedKeyframe) {
    const id = selectedKeyframe.keyframeNo < 0
      ? `consistency_reference:${selectedKeyframe.keyframeNo}`
      : `keyframe:${selectedKeyframe.keyframeNo}`;
    return {
      title: selectedKeyframe.keyframeNo < 0 ? `consistency ${selectedKeyframe.keyframeNo}` : `keyframe ${selectedKeyframe.keyframeNo}`,
      targetIds: [id, `keyframe:${selectedKeyframe.keyframeNo}`, `${id}:prompt`, `${id}:image`],
    };
  }
  if (selectedShot) {
    const ids = [
      `segment:${selectedShot.shotNo}`,
      `segment:${selectedShot.shotNo}:prompt`,
      `segment:${selectedShot.shotNo}:video`,
      `segment:${selectedShot.shotNo}:subtitle`,
      `segment:${selectedShot.shotNo}:micro_shots`,
      ...(selectedShot.startKeyframeNo ? [`keyframe:${selectedShot.startKeyframeNo}`] : []),
      ...(selectedShot.endKeyframeNo ? [`keyframe:${selectedShot.endKeyframeNo}`] : []),
      ...((selectedShot.microShots ?? []).flatMap((item) => [
        `segment:${selectedShot.shotNo}:micro_shot:${item.microShotNo}`,
        `segment:${selectedShot.shotNo}:micro_shot:${item.microShotNo}:image`,
      ])),
    ];
    return {
      title: `segment ${selectedShot.shotNo}`,
      targetIds: ids,
      segmentDescription: segmentRenderDescriptionByNo(project.planDebug, selectedShot.shotNo),
    };
  }
  return { title: project.title, targetIds: [] };
}

function segmentRenderDescriptionByNo(planDebug: PlanDebugData | undefined, segmentNo: number): Record<string, unknown> | undefined {
  for (const item of planDebug?.segmentRenderDescriptions ?? []) {
    if (!isPlainRecord(item)) continue;
    const n = Number(item.segmentNo ?? item.segment_no ?? item.shotNo ?? item.shot_no ?? item.sequence);
    if (n === segmentNo) return item;
  }
  return undefined;
}

function currentReferenceDebugItems(planDebug: PlanDebugData | undefined, targetIds: string[]): ReferenceSelectionOutput[] {
  const targetSet = new Set(targetIds);
  return (planDebug?.referenceSelectionOutputs ?? []).filter((item) => {
    const target = item.targetArtifactId ?? (item as Record<string, unknown>).target_artifact_id;
    return typeof target === "string" && targetSet.has(target);
  });
}

function currentPromptDebugItems(planDebug: PlanDebugData | undefined, targetIds: string[]): PromptDebugArtifact[] {
  const targetSet = new Set(targetIds);
  return Object.values(planDebug?.promptDebugArtifacts ?? {}).filter((item) => {
    const target = item.targetArtifactId ?? (item as Record<string, unknown>).target_artifact_id;
    return typeof target === "string" && targetSet.has(target);
  });
}

function currentArtifactMetadata(planDebug: PlanDebugData | undefined, targetIds: string[]): Array<{ id: string; metadata: ArtifactMetadata }> {
  const targetSet = new Set(targetIds);
  return Object.entries(planDebug?.artifactMetadata ?? {})
    .filter(([id]) => targetSet.has(id))
    .map(([id, metadata]) => ({ id, metadata }));
}

function dependentArtifactIds(planDebug: PlanDebugData | undefined, rootIds: string[]): string[] {
  const metadata = planDebug?.artifactMetadata ?? {};
  const selected = new Set(rootIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [artifactId, item] of Object.entries(metadata)) {
      if (selected.has(artifactId)) continue;
      if ((item.dependsOn ?? []).some((dependencyId) => selected.has(dependencyId))) {
        selected.add(artifactId);
        changed = true;
      }
    }
  }
  return [...selected].filter((artifactId) => !rootIds.includes(artifactId));
}

function visibleImpactArtifactIds(planDebug: PlanDebugData | undefined, rootIds: string[]): string[] {
  return dependentArtifactIds(planDebug, rootIds).filter((artifactId) =>
    artifactId === "final_video" ||
    artifactId.startsWith("transition_reference:") ||
    artifactId.startsWith("generated_bridge:") ||
    artifactId.endsWith(":image") ||
    artifactId.endsWith(":video")
  );
}

function artifactImpactLabel(artifactId: string, lang: PageLang): string {
  if (artifactId === "final_video") return lang === "en" ? "Final video" : "最终成片";
  const keyframe = artifactId.match(/^keyframe:(-?\d+):image$/);
  if (keyframe) return lang === "en" ? `Keyframe KF${keyframe[1]}` : `关键帧 KF${keyframe[1]}`;
  const consistency = artifactId.match(/^consistency_reference:(-?\d+):image$/);
  if (consistency) return lang === "en" ? `Asset view ${consistency[1]}` : `人物/资产视图 ${consistency[1]}`;
  const micro = artifactId.match(/^segment:(\d+):micro_shot:(\d+):image$/);
  if (micro) return lang === "en" ? `Checkpoint S${micro[1]}.${micro[2]}` : `子分镜参考图 S${micro[1]}.${micro[2]}`;
  const segment = artifactId.match(/^segment:(\d+):video$/);
  if (segment) return lang === "en" ? `Video Segment ${segment[1]}` : `视频 Segment ${segment[1]}`;
  if (artifactId.startsWith("transition_reference:")) return lang === "en" ? `Transition reference ${artifactId.split(":").slice(1).join("/")}` : `机位过渡参考 ${artifactId.split(":").slice(1).join("/")}`;
  if (artifactId.startsWith("generated_bridge:")) return lang === "en" ? `Generated bridge ${artifactId.split(":").slice(1).join("→")}` : `成片桥接 ${artifactId.split(":").slice(1).join("→")}`;
  return artifactId;
}

function ArtifactImpactPreview({ planDebug, rootIds, lang }: { planDebug: PlanDebugData | undefined; rootIds: string[]; lang: PageLang }) {
  const impacted = visibleImpactArtifactIds(planDebug, rootIds);
  if (!impacted.length) return null;
  return (
    <div className="rounded-md border border-amber-300/20 bg-amber-300/5 px-3 py-2 text-xs leading-5 text-amber-100/85">
      <p className="font-medium">{lang === "zh" ? "保存后将标记为失效（旧版本不会删除）：" : "Saving will mark these dirty (old revisions are preserved):"}</p>
      <ul className="mt-1 list-inside list-disc text-amber-100/70">
        {impacted.slice(0, 6).map((artifactId) => <li key={artifactId}>{artifactImpactLabel(artifactId, lang)}</li>)}
        {impacted.length > 6 && <li>{lang === "zh" ? `另有 ${impacted.length - 6} 项` : `${impacted.length - 6} more`}</li>}
      </ul>
    </div>
  );
}

function confirmArtifactImpact(project: VideoProject, rootIds: string[], lang: PageLang): boolean {
  if (typeof window === "undefined") return true;
  const impacted = visibleImpactArtifactIds(project.planDebug, rootIds);
  if (!impacted.length) return true;
  const shown = impacted.slice(0, 14).map((artifactId) => `- ${artifactImpactLabel(artifactId, lang)}`);
  if (impacted.length > shown.length) shown.push(lang === "en" ? `- and ${impacted.length - shown.length} more artifacts` : `- 以及另外 ${impacted.length - shown.length} 个产物`);
  const title = lang === "en"
    ? "This edit will mark the following artifacts dirty (old versions will be preserved):"
    : "本次修改将使以下产物失效（旧版本会保留，不会删除）：";
  const footer = lang === "en" ? "\nContinue saving?" : "\n确认后只标记 dirty，是否继续保存？";
  return window.confirm(`${title}\n${shown.join("\n")}${footer}`);
}

function currentGenerationQualityReports(planDebug: PlanDebugData | undefined, targetIds: string[]): GenerationQualityReport[] {
  const targetSet = new Set(targetIds);
  return (planDebug?.generationQualityReports ?? []).filter((report) => targetSet.has(report.assetId));
}

function pickAuditFields(description: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    "segmentNo",
    "segment_no",
    "riskLevel",
    "risk_level",
    "requiresCut",
    "requires_cut",
    "timelineChangeRequest",
    "timeline_change_request",
    "recommendedSplit",
    "recommended_split",
    "startFrameContract",
    "start_frame_contract",
    "endFrameContract",
    "end_frame_contract",
    "motionContract",
    "motion_contract",
    "singleTakeContract",
    "single_take_contract",
    "motionCheckpoints",
    "motion_checkpoints",
  ];
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (description[key] !== undefined) picked[key] = description[key];
  }
  return Object.keys(picked).length ? picked : description;
}

function aspectClass(aspectRatio: AspectRatio): string {
  if (aspectRatio === "16:9") return "aspect-video";
  if (aspectRatio === "1:1") return "aspect-square";
  return "aspect-[9/16]";
}

function finalVideoPreviewClass(aspectRatio: AspectRatio): string {
  if (aspectRatio === "16:9") return "aspect-video w-full max-w-3xl";
  if (aspectRatio === "1:1") return "aspect-square w-full max-w-[520px]";
  return "aspect-[9/16] w-full max-w-[360px]";
}

function shotClipDownloadUrl(projectId: string, shotId: string): string {
  return `/api/video-projects/${encodeURIComponent(projectId)}/shots/${encodeURIComponent(shotId)}/download`;
}

function localizedShotPrompt(shot: VideoShot, kind: "image" | "video", lang: PageLang): string {
  if (kind === "image") {
    return lang === "en"
      ? shot.imagePromptEn || shot.imagePrompt
      : shot.imagePromptZh || shot.imagePrompt;
  }
  return lang === "en"
    ? shot.videoPromptEn || shot.videoPrompt
    : shot.videoPromptZh || shot.videoPrompt;
}

function localizedShotPurpose(shot: VideoShot, lang: PageLang): string {
  if (lang === "en") return shot.purposeEn || titleFromPrompt(shot.videoPromptEn || shot.videoPrompt || shot.purpose, `Shot ${shot.shotNo}`);
  return shot.purposeZh || shot.purpose;
}

function localizedKeyframePurpose(keyframe: VideoKeyframe, lang: PageLang): string {
  if (lang === "en") return keyframe.purposeEn || titleFromPrompt(keyframe.imagePromptEn || keyframe.imagePrompt || keyframe.purpose, `Boundary frame ${keyframe.keyframeNo}`);
  return keyframe.purposeZh || keyframe.purpose;
}

function localizedMicroShotPurpose(microShot: MicroShot, lang: PageLang): string {
  if (lang === "en") return microShot.purposeEn || titleFromPrompt(languageSafeText(microShot.purpose, "en") || microShot.promptEn || microShot.imagePromptEn || "", `Micro-shot ${microShot.microShotNo}`);
  return microShot.purposeZh || languageSafeText(microShot.purpose, "zh") || microShot.promptZh || microShot.imagePromptZh || "";
}

function titleFromPrompt(text: string, fallback: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return fallback;
  const purposeMatch = cleaned.match(/\bPurpose:\s*([^.;。]+)/i);
  const source = purposeMatch?.[1]?.trim() || cleaned.split(/[.;。]/)[0]?.trim() || fallback;
  return source.length > 96 ? `${source.slice(0, 93)}...` : source;
}

function localizedShotNegativePrompt(shot: VideoShot, lang: PageLang): string {
  return localizedNegativePrompt(
    shot.negativePrompt,
    lang,
    shot.negativePromptZh,
    shot.negativePromptEn,
  );
}

function localizedKeyframeImagePrompt(keyframe: VideoKeyframe, lang: PageLang): string {
  return lang === "en"
    ? keyframe.imagePromptEn || keyframe.imagePrompt
    : keyframe.imagePromptZh || keyframe.imagePrompt;
}

function localizedKeyframeNegativePrompt(keyframe: VideoKeyframe, lang: PageLang): string {
  return localizedNegativePrompt(
    keyframe.negativePrompt ?? "",
    lang,
    keyframe.negativePromptZh,
    keyframe.negativePromptEn,
  );
}

function localizedNegativePrompt(base: string, lang: PageLang, zh?: string, en?: string): string {
  if (lang === "en") return en || base;
  return zh || translateNegativePromptToZh(base);
}

function translateNegativePromptToZh(prompt: string): string {
  const dictionary: Record<string, string> = {
    text: "??",
    subtitles: "??",
    captions: "??",
    logos: "??",
    watermarks: "??",
    watermark: "??",
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
    blurry: "??",
    "duplicated body": "身体重复",
  };
  return prompt
    .split(/[,?]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => dictionary[item.toLowerCase()] ?? item)
    .join("?");
}

function localizedTimedPrompt(prompt: TimedPrompt, lang: PageLang): string {
  return lang === "en" ? prompt.promptEn || prompt.prompt : prompt.promptZh || prompt.prompt;
}

function timedPromptRangeLabel(prompt: TimedPrompt): string {
  if (typeof prompt.startSeconds === "number" && typeof prompt.endSeconds === "number") {
    return `${prompt.startSeconds}-${prompt.endSeconds}s`;
  }
  return `${prompt.timeSeconds}s`;
}

function localizedMicroShotPrompt(microShot: MicroShot, lang: PageLang): string {
  return lang === "en"
    ? microShot.promptEn || languageSafeText(microShot.prompt, "en") || localizedMicroShotAction(microShot, lang) || localizedMicroShotPurpose(microShot, lang)
    : microShot.promptZh || languageSafeText(microShot.prompt, "zh") || localizedMicroShotAction(microShot, lang) || localizedMicroShotPurpose(microShot, lang);
}

function localizedMicroShotScene(microShot: MicroShot, lang: PageLang): string {
  return lang === "en"
    ? microShot.sceneEn || languageSafeText(microShot.scene, "en") || microShot.promptEn || microShot.purposeEn || ""
    : microShot.sceneZh || languageSafeText(microShot.scene, "zh") || microShot.promptZh || microShot.purposeZh || "";
}

function localizedMicroShotAction(microShot: MicroShot, lang: PageLang): string {
  return lang === "en"
    ? microShot.actionEn || languageSafeText(microShot.action, "en") || microShot.promptEn || microShot.purposeEn || ""
    : microShot.actionZh || languageSafeText(microShot.action, "zh") || microShot.promptZh || microShot.purposeZh || "";
}

function localizedMicroShotImagePrompt(microShot: MicroShot, lang: PageLang): string {
  return lang === "en"
    ? microShot.imagePromptEn || languageSafeText(microShot.imagePrompt, "en") || ""
    : microShot.imagePromptZh || languageSafeText(microShot.imagePrompt, "zh") || "";
}

function languageSafeText(text: string | undefined, lang: PageLang): string {
  const value = String(text ?? "").trim();
  if (!value) return "";
  const cjk = /[\u3400-\u9fff]/.test(value);
  return lang === "zh" ? (cjk ? value : "") : (cjk ? "" : value);
}

function audioPlanLines(audioPlan: AudioPlan, lang: PageLang): string[] {
  const preferred = lang === "en" ? audioPlan.linesEn : audioPlan.linesZh;
  return (preferred?.length ? preferred : audioPlan.lines?.length ? audioPlan.lines : lang === "en" ? audioPlan.linesZh : audioPlan.linesEn) ?? [];
}

function localizedAudioPlanSummary(audioPlan: AudioPlan, lang: PageLang): string {
  const lines = audioPlanLines(audioPlan, lang);
  const speech = lines.length
    ? lines.slice(0, 2).join(" / ")
    : lang === "en"
      ? "no spoken lines"
      : "no spoken lines";
  const voice = [audioPlan.speaker, audioPlan.voiceStyle, audioPlan.language].filter(Boolean).join(" / ");
  const reason = audioPlan.rationale ? ` - ${audioPlan.rationale}` : "";
  return [audioPlan.mode, voice, speech].filter(Boolean).join(" | ") + reason;
}

function boundaryFrameLabel(frame: VideoKeyframe, totalSeconds: number, lang: PageLang): string {
  const consistencyLabel = consistencyFrameLabel(frame, lang);
  if (consistencyLabel) return consistencyLabel;
  if (frame.keyframeNo === 1) return lang === "en" ? "First-frame reference" : "首帧参考图";
  if (frame.timeSeconds >= totalSeconds) return lang === "en" ? "End-frame reference" : "尾帧参考图";
  return lang === "en"
    ? `Boundary frame ${String(frame.keyframeNo).padStart(2, "0")}`
    : `边界帧 ${String(frame.keyframeNo).padStart(2, "0")}`;
}

function boundaryFrameShortLabel(frame: VideoKeyframe | undefined, totalSeconds: number, lang: PageLang): string {
  if (!frame) return lang === "en" ? "Frame" : "参考帧";
  const consistencyLabel = consistencyFrameShortLabel(frame, lang);
  if (consistencyLabel) return consistencyLabel;
  if (frame.keyframeNo === 1) return lang === "en" ? "First" : "??";
  if (frame.timeSeconds >= totalSeconds) return lang === "en" ? "End" : "??";
  return lang === "en" ? `F${String(frame.keyframeNo).padStart(2, "0")}` : `??${String(frame.keyframeNo).padStart(2, "0")}`;
}

function safeBoundaryFrameLabel(frame: VideoKeyframe, totalSeconds: number, lang: PageLang): string {
  return boundaryFrameLabel(frame, totalSeconds, lang);
}

function safeBoundaryFrameShortLabel(frame: VideoKeyframe | undefined, totalSeconds: number, lang: PageLang): string {
  return boundaryFrameShortLabel(frame, totalSeconds, lang);
}

function consistencyFrameLabel(frame: VideoKeyframe, lang: PageLang): string {
  if (frame.keyframeNo <= -1000) return localizedKeyframePurpose(frame, lang);
  if (frame.keyframeNo === -2) return lang === "en" ? "Character consistency reference" : "人物一致性参考图";
  if (frame.keyframeNo === -1) return lang === "en" ? "Scene consistency reference" : "场景一致性参考图";
  return "";
}

function consistencyFrameShortLabel(frame: VideoKeyframe, lang: PageLang): string {
  if (frame.keyframeNo <= -1000) return assetViewShortLabel(frame, lang);
  if (frame.keyframeNo === -2) return lang === "en" ? "Character" : "人物参考";
  if (frame.keyframeNo === -1) return lang === "en" ? "Scene" : "场景参考";
  return "";
}

function personDerivedViewWaitReason(frame: VideoKeyframe, assetFrames: VideoKeyframe[], lang: PageLang): string {
  const derived = frame.viewGenerationMode === "derived_from_front" || frame.assetView === "side" || frame.assetView === "back";
  if (!derived || !frame.anchorId) return "";
  const front = assetFrames.find((candidate) => candidate.anchorId === frame.anchorId && candidate.assetView === "front");
  if (front?.imageUrl && (front.locked || front.status === "IMAGE_APPROVED")) return "";
  return lang === "en"
    ? "Waiting for the front view to be generated, approved, and locked. This view will inherit identity from that approved front revision."
    : "请先生成、批准并锁定正面图；该视图将以批准的正面版本作为人物身份参考。";
}

function assetKeyframeSortRank(frame: VideoKeyframe): number {
  const text = `${frame.purpose} ${frame.purposeZh ?? ""} ${frame.purposeEn ?? ""} ${frame.imagePrompt ?? ""}`.toLowerCase();
  const group = text.includes("scene") || text.includes("场景") || text.includes("overview") || text.includes("总览")
    ? 200
    : text.includes("product") || text.includes("产品")
      ? 300
      : text.includes("prop") || text.includes("道具")
        ? 400
        : 100;
  const view = text.includes("front") || text.includes("正面")
    ? 1
    : text.includes("side") || text.includes("侧面")
      ? 2
      : text.includes("back") || text.includes("背面")
        ? 3
        : 9;
  return group + view + Math.abs(frame.keyframeNo) / 10000;
}

function assetViewShortLabel(frame: VideoKeyframe, lang: PageLang): string {
  const text = `${frame.purpose} ${frame.purposeZh ?? ""} ${frame.purposeEn ?? ""} ${frame.imagePrompt ?? ""}`.toLowerCase();
  if (text.includes("front") || text.includes("正面")) return lang === "en" ? "Front" : "正面";
  if (text.includes("side") || text.includes("侧面")) return lang === "en" ? "Side" : "侧面";
  if (text.includes("back") || text.includes("背面")) return lang === "en" ? "Back" : "背面";
  if (text.includes("overview") || text.includes("总览")) return lang === "en" ? "Overview" : "总览";
  return lang === "en" ? "Asset" : "资产";
}

function safeBoundaryRangeLabel(
  shot: Pick<VideoShot, "startKeyframeNo" | "endKeyframeNo">,
  keyframeByNo: Map<number, VideoKeyframe>,
  totalSeconds: number,
  lang: PageLang,
): string {
  const start = shot.startKeyframeNo ? keyframeByNo.get(shot.startKeyframeNo) : undefined;
  const end = shot.endKeyframeNo ? keyframeByNo.get(shot.endKeyframeNo) : undefined;
  return `${safeBoundaryFrameShortLabel(start, totalSeconds, lang)} -> ${safeBoundaryFrameShortLabel(end, totalSeconds, lang)}`;
}

function plannerWorkflowProgressView(progress: PlannerProgress | undefined, lang: PageLang): WorkflowProgressView {
  if (!progress) {
    return {
      percent: 2,
      title: lang === "en" ? "Planning job queued" : "剧本规划任务已入队",
      detail: lang === "en" ? "Waiting for the background planner to report its first real stage." : "正在等待后台规划器上报第一个真实阶段。",
      tone: "running",
    };
  }
  const total = Math.max(1, progress.totalSteps);
  const completed = Math.max(0, Math.min(total, progress.completedSteps));
  const remaining = Math.max(0, total - completed);
  const percent = progress.status === "completed" || progress.stage === "complete"
    ? 100
    : Math.min(98, 5 + (completed / total) * 90);
  const titles: Record<PlannerProgress["stage"], { zh: string; en: string }> = {
    queued: { zh: "剧本规划任务已入队", en: "Planning job queued" },
    planning_architect: { zh: "正在理解创意与规划时间轴", en: "Understanding the brief and timeline" },
    storyboard_artist: { zh: "正在设计剧情节拍与广告因果", en: "Designing story beats and ad causality" },
    shot_decomposer: { zh: "正在拆解可执行视频片段", en: "Decomposing executable video segments" },
    single_take_audit: { zh: "正在执行一镜到底审计", en: "Running single-take audit" },
    split_repair: { zh: "正在修复高风险镜头结构", en: "Repairing high-risk shot structure" },
    json_repair: { zh: "正在修复模型 JSON 结构", en: "Repairing model JSON structure" },
    prompt_detailer: { zh: "正在编译图片和视频提示词", en: "Compiling image and video prompts" },
    story_quality_gate: { zh: "正在执行剧情质量校验", en: "Running story quality validation" },
    complete: { zh: "分镜计划已完成", en: "Storyboard plan complete" },
    failed: { zh: "分镜计划生成失败", en: "Storyboard planning failed" },
  };
  const baseDetail = lang === "en" ? progress.detailEn : progress.detailZh;
  const stepDetail = lang === "en"
    ? `${completed}/${total} real steps complete; ${remaining} remaining.`
    : `真实进度：已完成 ${completed}/${total} 步，剩余 ${remaining} 步。`;
  const repairParts = [
    progress.metrics.jsonRepairCount > 0
      ? (lang === "en" ? `JSON repairs: ${progress.metrics.jsonRepairCount}` : `JSON 修复：${progress.metrics.jsonRepairCount} 次`)
      : "",
    progress.metrics.singleTakeRepairCount > 0
      ? (lang === "en" ? `single-take repairs: ${progress.metrics.singleTakeRepairCount}` : `一镜到底修复：${progress.metrics.singleTakeRepairCount} 次`)
      : "",
  ].filter(Boolean);
  return {
    percent,
    title: titles[progress.stage]?.[lang] ?? titles.queued[lang],
    detail: [baseDetail, stepDetail, repairParts.join(lang === "en" ? "; " : "；")].filter(Boolean).join(" "),
    tone: progress.status === "failed" || progress.stage === "failed" ? "failed" : progress.status === "completed" ? "success" : "running",
  };
}

function estimatePlanningProgress(elapsedMs: number): Pick<OptimisticProgress, "phase" | "percent"> {
  const seconds = Math.max(0, elapsedMs / 1000);
  if (seconds < 3) return { phase: "creating", percent: 3 + seconds * 4 };
  if (seconds < 18) return { phase: "understanding", percent: 15 + (seconds - 3) * 2.2 };
  if (seconds < 55) return { phase: "storyboard", percent: 48 + (seconds - 18) * 0.75 };
  if (seconds < 110) return { phase: "prompts", percent: 75 + (seconds - 55) * 0.22 };

  const waitingSeconds = seconds - 110;
  const slowCurve = 87 + waitingSeconds * 0.012 + Math.log1p(waitingSeconds) * 0.55;
  return { phase: "waiting", percent: Math.min(99.2, slowCurve) };
}

function optimisticWorkflowProgressView(progress: OptimisticProgress, lang: PageLang): WorkflowProgressView {
  const text: Record<OptimisticProgressPhase, { zh: [string, string]; en: [string, string]; tone: WorkflowProgressView["tone"] }> = {
    creating: {
      zh: ["\u6b63\u5728\u521b\u5efa\u9879\u76ee", "\u5df2\u63d0\u4ea4\u521b\u4f5c\u9700\u6c42\uff0c\u6b63\u5728\u51c6\u5907\u8fdb\u5165\u5267\u672c\u62c6\u89e3\u3002"],
      en: ["Creating project", "The request is submitted and the storyboard planner is warming up."],
      tone: "running",
    },
    understanding: {
      zh: ["\u5927\u6a21\u578b\u6b63\u5728\u7406\u89e3\u9700\u6c42", "\u6b63\u5728\u8bc6\u522b\u4e3b\u9898\u3001\u4eba\u7269\u3001\u573a\u666f\u53c2\u8003\u3001\u8272\u8c03\u9501\u548c\u753b\u5e45\u7ea6\u675f\u3002"],
      en: ["Understanding brief", "Reading the theme, references, tone locks, and aspect ratio constraints."],
      tone: "running",
    },
    storyboard: {
      zh: ["\u6b63\u5728\u62c6\u89e3\u5267\u672c\u4e0e\u8fb9\u754c\u5173\u952e\u5e27", "\u89c4\u5212\u9996\u5c3e\u5e27\u65f6\u95f4\u7ebf\u3001\u955c\u5934\u6570\u91cf\u548c\u6bcf\u6bb5\u53d9\u4e8b\u8282\u62cd\u3002"],
      en: ["Splitting script and boundary frames", "Planning the first-last-frame timeline, segment count, and story beats."],
      tone: "running",
    },
    prompts: {
      zh: ["\u6b63\u5728\u751f\u6210\u7ed3\u6784\u5316\u63d0\u793a\u8bcd", "\u6574\u7406\u56fe\u7247 Prompt\u3001\u89c6\u9891 Prompt\u3001\u8d1f\u5411\u7ea6\u675f\u548c\u8fde\u7eed\u6027\u9501\u5b9a\u3002"],
      en: ["Building structured prompts", "Preparing image prompts, video prompts, negative constraints, and continuity locks."],
      tone: "running",
    },
    waiting: {
      zh: ["\u7b49\u5f85\u6a21\u578b\u8fd4\u56de\u5b8c\u6574\u7ed3\u679c", "\u590d\u6742\u9700\u6c42\u53ef\u80fd\u4f1a\u591a\u7b49\u4e00\u4f1a\u513f\uff0c\u8fd4\u56de\u540e\u4f1a\u81ea\u52a8\u8fdb\u5165\u5ba1\u6838\u3002"],
      en: ["Waiting for the model result", "Complex briefs can take longer. The review stage will open automatically when it returns."],
      tone: "running",
    },
    done: {
      zh: ["\u5206\u955c\u8ba1\u5212\u5df2\u5b8c\u6210", "\u5df2\u62ff\u5230\u5927\u6a21\u578b\u8fd4\u56de\u7684\u5206\u955c\u3001\u5173\u952e\u5e27\u548c\u7247\u6bb5\u63d0\u793a\u8bcd\u3002"],
      en: ["Storyboard plan complete", "The model returned the storyboard, keyframes, and segment prompts."],
      tone: "success",
    },
    stopped: {
      zh: ["\u751f\u6210\u5df2\u505c\u6b62", "\u4f60\u5df2\u624b\u52a8\u505c\u6b62\u672c\u6b21\u751f\u6210\uff0c\u53ef\u4ee5\u8c03\u6574\u5185\u5bb9\u540e\u91cd\u65b0\u751f\u6210\u3002"],
      en: ["Generation stopped", "You stopped this generation. Adjust the brief and generate again when ready."],
      tone: "idle",
    },
    failed: {
      zh: ["\u5206\u955c\u8ba1\u5212\u751f\u6210\u5931\u8d25", "\u8bf7\u67e5\u770b\u4e0b\u65b9\u9519\u8bef\u4fe1\u606f\uff0c\u4fee\u6b63\u540e\u53ef\u4ee5\u91cd\u65b0\u751f\u6210\u3002"],
      en: ["Storyboard planning failed", "Check the error below, then adjust and try again."],
      tone: "failed",
    },
  };
  const item = text[progress.phase];
  const [title, detail] = lang === "en" ? item.en : item.zh;
  return { percent: Math.max(0, Math.min(100, Math.round(progress.percent * 10) / 10)), title, detail, tone: item.tone };
}

function projectWorkflowProgressView(
  project: VideoProject,
  progress: ReturnType<typeof projectProgress>,
  lang: PageLang,
  status: ProjectStatus = project.status,
): WorkflowProgressView {
  if (isManualStopProject(project)) {
    return lang === "en"
      ? { percent: progress.percent, title: "Generation stopped", detail: "You stopped this generation. Adjust the brief and generate again when ready.", tone: "idle" }
      : { percent: progress.percent, title: "\u751f\u6210\u5df2\u505c\u6b62", detail: "\u4f60\u5df2\u624b\u52a8\u505c\u6b62\u672c\u6b21\u751f\u6210\uff0c\u53ef\u4ee5\u8c03\u6574\u5185\u5bb9\u540e\u91cd\u65b0\u751f\u6210\u3002", tone: "idle" };
  }
  const zh: Record<ProjectStatus, [string, string, WorkflowProgressView["tone"]]> = {
    DRAFT: ["\u7b49\u5f85\u5f00\u59cb", "\u586b\u5199\u4e00\u53e5\u8bdd\u9700\u6c42\u540e\u5373\u53ef\u751f\u6210\u5206\u955c\u8ba1\u5212\u3002", "idle"],
    PLANNING: ["\u6b63\u5728\u751f\u6210\u5206\u955c\u8ba1\u5212", "\u5927\u6a21\u578b\u6b63\u5728\u62c6\u89e3\u5267\u672c\u3001\u5173\u952e\u5e27\u548c\u7247\u6bb5\u63d0\u793a\u8bcd\u3002", "running"],
    PLAN_REVIEW: ["\u5206\u955c\u8ba1\u5212\u5f85\u5ba1\u6838", `${project.shots.length} \u4e2a\u955c\u5934\u5df2\u5c31\u7eea\uff0c\u8bf7\u5148\u786e\u8ba4\u811a\u672c\u4e0e\u5173\u952e\u5e27\u89c4\u5212\u3002`, "idle"],
    IMAGE_GENERATING: ["\u6b63\u5728\u751f\u6210\u8fb9\u754c\u53c2\u8003\u5e27", `${progress.images}/${progress.imageTotal} \u5f20\u5173\u952e\u5e27\u56fe\u7247\u5df2\u5b8c\u6210\u3002`, "running"],
    IMAGE_REVIEW: ["\u5173\u952e\u5e27\u5f85\u5ba1\u6838", `${progress.images}/${progress.imageTotal} \u5f20\u5173\u952e\u5e27\u56fe\u7247\u5df2\u5b8c\u6210\uff0c\u8bf7\u786e\u8ba4\u540e\u8fdb\u5165\u5185\u90e8\u5b50\u5206\u955c\u5ba1\u6838\u3002`, "idle"],
    MICRO_SHOT_REVIEW: ["\u5185\u90e8\u5b50\u5206\u955c\u5f85\u5ba1\u6838", "\u8bf7\u786e\u8ba4\u6bcf\u4e2a\u7247\u6bb5\u5185\u90e8\u5b50\u5206\u955c\u7684\u6587\u5b57\u548c\u53c2\u8003\u56fe\uff0c\u5b8c\u6210\u540e\u518d\u751f\u6210\u89c6\u9891\u7247\u6bb5\u3002", "idle"],
    CLIP_GENERATING: ["\u6b63\u5728\u751f\u6210\u5206\u955c\u89c6\u9891\u7247\u6bb5", `${progress.clips}/${progress.clipTotal} \u6bb5\u89c6\u9891\u7247\u6bb5\u5df2\u5b8c\u6210\u3002`, "running"],
    CLIP_REVIEW: ["\u7247\u6bb5\u5f85\u5ba1\u6838", `${progress.clips}/${progress.clipTotal} \u6bb5\u89c6\u9891\u7247\u6bb5\u5df2\u5b8c\u6210\uff0c\u8bf7\u786e\u8ba4\u540e\u5408\u6210\u6210\u7247\u3002`, "idle"],
    COMPOSING: ["\u6b63\u5728\u5408\u6210\u6700\u7ec8\u6210\u7247", "\u6b63\u5728\u62fc\u63a5\u6240\u6709\u5206\u955c\u7247\u6bb5\u5e76\u5904\u7406\u8f6c\u573a\u4e0e\u58f0\u97f3\u3002", "running"],
    FINAL_REVIEW: ["\u6700\u7ec8\u6210\u7247\u5f85\u786e\u8ba4", "\u6210\u7247\u5df2\u751f\u6210\uff0c\u8bf7\u9884\u89c8\u786e\u8ba4\u3002", "idle"],
    DONE: ["\u6210\u7247\u5df2\u5b8c\u6210", "\u8fd9\u4e2a\u9879\u76ee\u5df2\u7ecf\u5b8c\u6210\uff0c\u53ef\u4ee5\u4e0b\u8f7d\u6216\u7ee7\u7eed\u65b0\u5efa\u9879\u76ee\u3002", "success"],
    FAILED: ["\u4efb\u52a1\u5931\u8d25", "\u8bf7\u67e5\u770b\u9519\u8bef\u4fe1\u606f\uff0c\u4fee\u6539\u540e\u91cd\u65b0\u53d1\u8d77\u5bf9\u5e94\u6b65\u9aa4\u3002", "failed"],
  };
  const en: Record<ProjectStatus, [string, string, WorkflowProgressView["tone"]]> = {
    DRAFT: ["Ready to start", "Enter a one-line brief to generate the storyboard plan.", "idle"],
    PLANNING: ["Planning storyboard", "The model is splitting the script, keyframes, and segment prompts.", "running"],
    PLAN_REVIEW: ["Storyboard awaiting review", `${project.shots.length} shots are ready. Review the script and keyframe plan first.`, "idle"],
    IMAGE_GENERATING: ["Generating boundary reference frames", `${progress.images}/${progress.imageTotal} keyframe images are ready.`, "running"],
    IMAGE_REVIEW: ["Keyframes awaiting review", `${progress.images}/${progress.imageTotal} keyframe images are ready. Approve them to review internal micro-shots.`, "idle"],
    MICRO_SHOT_REVIEW: ["Internal micro-shots awaiting review", "Review the internal micro-shot text and generated reference images before generating video clips.", "idle"],
    CLIP_GENERATING: ["Generating video clips", `${progress.clips}/${progress.clipTotal} clips are ready.`, "running"],
    CLIP_REVIEW: ["Clips awaiting review", `${progress.clips}/${progress.clipTotal} clips are ready. Approve them to compose the final video.`, "idle"],
    COMPOSING: ["Composing final video", "Joining all clips and applying transitions and audio.", "running"],
    FINAL_REVIEW: ["Final video awaiting review", "The final video is ready for preview.", "idle"],
    DONE: ["Final video complete", "This project is complete and ready to download.", "success"],
    FAILED: ["Task failed", "Check the error message, then retry the relevant step.", "failed"],
  };
  const [title, detail, tone] = lang === "en" ? en[status] : zh[status];
  return { percent: progress.percent, title, detail, tone };
}

function projectProgress(project: VideoProject, status: ProjectStatus = project.status): { images: number; clips: number; imageTotal: number; clipTotal: number; percent: number } {
  const imageTotal = project.keyframes?.length || project.shots.length;
  const clipTotal = project.segments?.length || project.shots.length;
  const safeImageTotal = Math.max(1, imageTotal);
  const safeClipTotal = Math.max(1, clipTotal);
  const images = project.keyframes?.length
    ? project.keyframes.filter((keyframe) => Boolean(keyframe.imageUrl)).length
    : project.shots.filter((shot) => Boolean(shot.imageUrl)).length;
  const clips = project.segments?.length
    ? project.segments.filter((segment) => Boolean(segment.clipUrl) || segment.status === "CLIP_READY" || segment.status === "CLIP_APPROVED").length
    : project.shots.filter((shot) => Boolean(shot.clipUrl) || shot.status === "CLIP_READY" || shot.status === "CLIP_APPROVED").length;
  const stageWeight: Record<ProjectStatus, number> = {
    DRAFT: 0,
    PLANNING: 5,
    PLAN_REVIEW: 15,
    IMAGE_GENERATING: 20 + (images / safeImageTotal) * 25,
    IMAGE_REVIEW: 50,
    MICRO_SHOT_REVIEW: 54,
    CLIP_GENERATING: 55 + (clips / safeClipTotal) * 30,
    CLIP_REVIEW: 86,
    COMPOSING: 92,
    FINAL_REVIEW: 97,
    DONE: 100,
    FAILED: Math.max(10, Math.round(((images / safeImageTotal + clips / safeClipTotal) / 2) * 85)),
  };
  return { images, clips, imageTotal, clipTotal, percent: Math.round(stageWeight[status] ?? 0) };
}

function effectiveReviewStatus(status: ProjectStatus, keyframesApproved: boolean): ProjectStatus {
  if (status === "IMAGE_REVIEW" && keyframesApproved) return "MICRO_SHOT_REVIEW";
  return status;
}

function workflowStageForProject(
  status: ProjectStatus,
  effectiveStatus: ProjectStatus | null,
  assetTotal: number,
  assetsApproved: boolean,
): WorkflowStageKey | null {
  if (effectiveStatus === "FINAL_REVIEW" || effectiveStatus === "DONE") return "FINAL_REVIEW";
  if (effectiveStatus === "CLIP_REVIEW" || effectiveStatus === "CLIP_GENERATING" || effectiveStatus === "COMPOSING") return "CLIP_REVIEW";
  if (effectiveStatus === "MICRO_SHOT_REVIEW") return "MICRO_SHOT_REVIEW";
  if (status === "IMAGE_GENERATING" || status === "IMAGE_REVIEW") {
    return assetTotal > 0 && !assetsApproved ? "ASSET_LIBRARY_REVIEW" : "IMAGE_REVIEW";
  }
  if (effectiveStatus === "PLAN_REVIEW") return "PLAN_REVIEW";
  return null;
}

function projectViewForStatus(status: ProjectStatus): ProjectView {
  if (status === "FINAL_REVIEW" || status === "DONE") return "final";
  if (status === "CLIP_REVIEW" || status === "CLIP_GENERATING" || status === "COMPOSING" || status === "MICRO_SHOT_REVIEW") return "clips";
  return "assets";
}

function rollbackTargetsForStatus(status: ProjectStatus, assetsApproved: boolean): RollbackTarget[] {
  const targets: RollbackTarget[] = [];
  const stageOrder = rollbackStageOrder(status, assetsApproved);
  if (stageOrder > 1) targets.push("PLAN_REVIEW");
  if (stageOrder > 2) targets.push("ASSET_LIBRARY_REVIEW");
  if (stageOrder > 3) targets.push("IMAGE_REVIEW");
  if (stageOrder > 4) targets.push("MICRO_SHOT_REVIEW");
  if (stageOrder > 5) targets.push("CLIP_REVIEW");
  return targets;
}

function toRollbackTarget(stage: WorkflowStageKey): RollbackTarget | null {
  if (stage === "PLAN_REVIEW" || stage === "ASSET_LIBRARY_REVIEW" || stage === "IMAGE_REVIEW" || stage === "MICRO_SHOT_REVIEW" || stage === "CLIP_REVIEW") {
    return stage;
  }
  return null;
}

function rollbackStageOrder(status: ProjectStatus, assetsApproved: boolean): number {
  if (status === "PLAN_REVIEW") return 1;
  if (status === "IMAGE_GENERATING" || status === "IMAGE_REVIEW") return assetsApproved ? 3 : 2;
  if (status === "MICRO_SHOT_REVIEW") return 4;
  if (status === "CLIP_GENERATING" || status === "CLIP_REVIEW") return 5;
  if (status === "COMPOSING" || status === "FINAL_REVIEW") return 6;
  if (status === "DONE" || status === "FAILED") return 7;
  return 0;
}

function hasRunningMicroShotImage(project: VideoProject): boolean {
  return project.shots.some((shot) => shot.microShots?.some((item) => item.imageStatus === "running" && Boolean(item.imageTaskId)));
}

function microShotImageProgress(project: VideoProject): { required: number; ready: number; running: number; failed: number; missing: number } {
  const items = project.shots.flatMap((shot) => shot.microShots ?? []).filter((item) => item.referenceType === "image_prompt" || item.referenceType === "mixed");
  const ready = items.filter((item) => Boolean(item.imageUrl)).length;
  const running = items.filter((item) => item.imageStatus === "running" && Boolean(item.imageTaskId)).length;
  const failed = items.filter((item) => item.imageStatus === "failed").length;
  return {
    required: items.length,
    ready,
    running,
    failed,
    missing: items.length - ready - running - failed,
  };
}

async function fetchJson(path: string, copy: Copy, init?: RequestInit): Promise<ApiResponse> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let json: ApiResponse;
  try {
    json = text ? (JSON.parse(text) as ApiResponse) : { ok: false, error: copy.emptyServer };
  } catch {
    json = { ok: false, error: text.slice(0, 240) || copy.nonJsonServer };
  }
  if (!res.ok || !json.ok) throw new Error(json.error || copy.requestFailed(res.status));
  return json;
}

async function uploadReferenceImage(file: File): Promise<string> {
  const presignRes = await fetch("/api/upload/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType: file.type || "application/octet-stream" }),
  });
  const presignText = await presignRes.text();
  let presignJson: { uploadUrl?: string; publicUrl?: string; error?: string };
  try {
    presignJson = presignText ? JSON.parse(presignText) : {};
  } catch {
    presignJson = { error: presignText.slice(0, 240) };
  }
  if (!presignRes.ok || !presignJson.uploadUrl || !presignJson.publicUrl) {
    throw new Error(presignJson.error || `Upload presign failed ${presignRes.status}`);
  }

  const uploadRes = await fetch(presignJson.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!uploadRes.ok) throw new Error(`Upload failed ${uploadRes.status}`);
  return presignJson.publicUrl;
}
