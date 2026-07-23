import { Prisma, VideoProjectStatus, VideoShotStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { consumeUserBalanceInTransaction } from "@/lib/billing";
import { createVideoPlan, normalizePlanInput } from "./planner";
import { buildImageGenerationQualityReport, buildVideoGenerationQualityReport } from "./quality-judge";
import {
  queryDashScopeTask,
  queryImsComposeJob,
  prepareAliyunImagePrompt,
  submitAliyunImageTask,
  submitAliyunImageToVideoTask,
} from "./aliyun-workflow";
import {
  createAliyunStoryboardPlan,
  type AliyunStoryboardPlannerCheckpoint,
  type AliyunStoryboardProgressStage,
  type AliyunStoryboardProgressUpdate,
} from "./three-stage-planner";
import { decideStoryRewrite, markStoryRewriteRequired, withStoryQualityGate } from "./story-quality-gate";
import { readStoryRolloutConfig, shouldEvaluateStoryQuality, shouldRequireStoryQualityReview } from "./story-rollout-config";
import { errorForLog, logOnePromptVideo } from "./logger";
import { composeVideoClipsLocally } from "./local-compose";
import { isTemporaryDashScopeUrl, persistRemoteMediaToOss } from "./oss-media";
import { appendProjectStageLog, writeProjectOverviewLog, writeScriptBreakdownLog, writeStageErrorLog } from "./stage-logger";
import type { ArtifactMetadata, CameraRelation, CreateVideoProjectInput, FinalTransitionPlan, GeneratedBridgeArtifact, GenerationQualityReport, OnePromptVideoPlan, PlanVideoProjectInput, PromptDebugArtifact, ReferenceSelectionOutput, RollbackVideoMediaInput, TransitionReferenceArtifact, TransitionReferenceFrameCandidate, UpdateShotInput, VideoAssetCategory, VideoAssetLibrary, VideoAssetLibraryItem, VideoAssetView, VideoConsistencyAnchor, VideoConsistencyReference, VideoMediaRevision, VideoMicroShot } from "./types";
import { detectReferenceOrientation, referenceRecencyScore, referenceViewMatchScore, selectReferenceCandidates, type ReferenceOrientation, type SelectableReferenceCandidate, REFERENCE_SELECTION_POLICY_VERSION } from "./reference-selector";
import { enrichReferenceCandidatesWithVision } from "./reference-vision-evaluator";
import { readCameraGraph, resolveCameraInheritanceContext } from "./camera-graph";
import { assertPlanValidForGeneration as assertPlanValidForGenerationV2 } from "./plan-validator";
import { sanitizeGameVisualPromptText, stripNonStandardPromptSymbols } from "./frame-contract";
import { evaluateEndFrameContinuity } from "./end-frame-continuity";
import { evaluateGeneratedImageQuality, evaluateGeneratedVideoQuality, extractVideoFrameDataUrls, generationQualityCompositeScore, isTechnicalQualityEvaluationFailure, normalizeImageQualityResponse } from "./generation-quality-evaluator";
import { createOnePromptRolloutSnapshot, legacyReferenceSelection, onePromptRolloutEnabled } from "./rollout-flags";
import { hydratePlanArtifactsFromTables, mirrorPlanArtifactsToTables } from "./plan-artifact-store";
import { buildAuthoritativeVisualContract, repairNegativePromptAgainstVisualContract, repairPromptAgainstVisualContract, type AuthoritativeVisualContract } from "./visual-quality-contract";
import { ONE_PROMPT_MAX_REFERENCE_IMAGES } from "@/lib/one-prompt-video-limits";

const PROJECT_INCLUDE = {
  shots: { orderBy: { shotNo: "asc" as const } },
  keyframes: { orderBy: { keyframeNo: "asc" as const } },
  segments: { orderBy: { segmentNo: "asc" as const } },
  generationCandidates: { orderBy: [{ createdAt: "desc" as const }, { candidateNo: "asc" as const }] },
};

const DEFAULT_IMAGE_TASK_CONCURRENCY = 3;
const DEFAULT_CLIP_TASK_CONCURRENCY = 2;
const MAX_UPSTREAM_TASK_CONCURRENCY = 5;
const DEFAULT_GENERATION_CANDIDATE_COUNT = 2;
type OnePromptPlannerArch = "v1" | "v2_shadow" | "v2";

export interface VideoPlanningProgress {
  taskId: string;
  workerId?: string;
  heartbeatAt?: string;
  leaseExpiresAt?: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage: AliyunStoryboardProgressStage;
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

const planningRuntime = globalThis as typeof globalThis & {
  onePromptVideoPlanningRuns?: Map<string, Promise<void>>;
  onePromptVideoPlanningWorkerId?: string;
  onePromptVideoMicroShotSubmissionRuns?: Map<string, Promise<void>>;
};
const planningRuns = planningRuntime.onePromptVideoPlanningRuns ?? new Map<string, Promise<void>>();
planningRuntime.onePromptVideoPlanningRuns = planningRuns;
const microShotSubmissionRuns = planningRuntime.onePromptVideoMicroShotSubmissionRuns ?? new Map<string, Promise<void>>();
planningRuntime.onePromptVideoMicroShotSubmissionRuns = microShotSubmissionRuns;
const planningWorkerId = planningRuntime.onePromptVideoPlanningWorkerId ?? randomUUID();
planningRuntime.onePromptVideoPlanningWorkerId = planningWorkerId;
const PLANNING_LEASE_MS = 90000;
const PLANNING_HEARTBEAT_MS = 30000;

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

function onePromptPlannerArch(): OnePromptPlannerArch {
  const raw = (process.env.ONE_PROMPT_VIDEO_PLANNER_ARCH || "v2").trim().toLowerCase();
  if (raw === "v1" || raw === "legacy") return "v1";
  if (raw === "v2_shadow" || raw === "shadow") return "v2_shadow";
  return "v2";
}

function imageTaskConcurrency(): number {
  return Math.max(1, Math.min(MAX_UPSTREAM_TASK_CONCURRENCY, envInt("ONE_PROMPT_VIDEO_IMAGE_CONCURRENCY", DEFAULT_IMAGE_TASK_CONCURRENCY)));
}

function clipTaskConcurrency(): number {
  return Math.max(1, Math.min(MAX_UPSTREAM_TASK_CONCURRENCY, envInt("ONE_PROMPT_VIDEO_CLIP_CONCURRENCY", DEFAULT_CLIP_TASK_CONCURRENCY)));
}

function isManuallyStopped(project: Pick<VideoProjectWithShots, "status" | "errorMessage">): boolean {
  return project.status === VideoProjectStatus.FAILED && project.errorMessage === MANUAL_STOP_MESSAGE;
}

const CHARACTER_CONSISTENCY_KEYFRAME_NO = -2;
const SCENE_CONSISTENCY_KEYFRAME_NO = -1;
const ASSET_LIBRARY_KEYFRAME_BASE = -1000;
const DEMO_PROJECT_TITLE = "Tongits King: Joyful Arena";
const DEMO_PROJECT_SOURCE_IDS = ["cmrlwfpz10001tvu4g80aou8c", "cmrlur1ue0001tvw42u6de3yr"];
const DEMO_PROJECT_PROMPT = "Create a 30s game ad with strong visual polish and consistent characters throughout.";
const DEMO_PROJECT_FINAL_VIDEO_URL = "/demo/tongits/final.mp4";
const ONE_PROMPT_VIDEO_COST_CREDITS = 5000;
const MANUAL_STOP_MESSAGE = "Generation stopped by user";

export type VideoProjectWithShots = Prisma.VideoProjectGetPayload<{
  include: typeof PROJECT_INCLUDE;
}>;

type ReferenceQuotaType = NonNullable<ReferenceSelectionOutput["candidates"][number]["quotaType"]>;
type ReferenceSourceType = NonNullable<ReferenceSelectionOutput["candidates"][number]["sourceType"]>;

type ReferenceCandidateDraft = {
  artifactId: string;
  url: string;
  sourceType: ReferenceSourceType;
  quotaType: ReferenceQuotaType;
  purpose: string;
  relevanceScore: number;
  conflictScore: number;
  recencyScore: number;
  viewMatchScore: number;
  usageNote: string;
  anchorId?: string;
  assetView?: VideoAssetView;
  hardRequired?: boolean;
  conflictReasons?: string[];
  detectedOrientation?: ReferenceOrientation;
};

type CompiledPrompt = {
  prompt: string;
  negativePrompt?: string;
  referenceImageUrls?: string[];
  debugArtifact: PromptDebugArtifact;
};

type NarrativePromptContext = {
  linkedBeatIds: string[];
  linkedBeatId?: string;
  storyFunction?: string;
  storyMoment?: string;
  cause?: string;
  effect?: string;
  informationUnit?: string;
  keyEvidenceIds: string[];
  requiredVisibleEvidence: string[];
  forbiddenEvidence: string[];
  narrativeStateBefore?: string;
  narrativeStateAfter?: string;
  actionContinuity?: Record<string, unknown>;
  reactionBeat?: string;
  powerShift?: string;
};

type PlanDebugPatch = {
  narrativeEvents?: unknown;
  consistencyAnchors?: unknown;
  anchorStateTimeline?: unknown;
  creativeStrategy?: unknown;
  storyBeats?: unknown;
  storyQualityReport?: unknown;
  shotGroupingPass?: unknown;
  audioBible?: unknown;
};

type ArtifactRetryFromStage = NonNullable<ArtifactMetadata["retryFromStage"]>;

export function serializeVideoProject(project: VideoProjectWithShots) {
  const planShots = readPlanShotMap(project.planJson);
  const planKeyframes = readPlanKeyframeMap(project.planJson);
  const planConsistencyReferences = readPlanConsistencyReferenceMap(project.planJson);
  const planSegments = readPlanSegmentMap(project.planJson);
  const keyframes = "keyframes" in project ? project.keyframes : [];
  const segments = "segments" in project ? project.segments : [];
  const keyframeMap = new Map(keyframes.map((frame) => [frame.keyframeNo, frame]));
  const selectedMicroShotCandidates = new Map(
    project.generationCandidates
      .filter((candidate) => candidate.kind === "micro_shot_image" && candidate.selected && Boolean(candidate.mediaUrl))
      .map((candidate) => [candidate.artifactId, candidate]),
  );
  const compatShots = segments.length
    ? segments.map((segment) => serializeSegmentAsShot(segment, keyframeMap, planShots, selectedMicroShotCandidates))
    : project.shots.map((shot) => ({
        ...shot,
        purposeZh: readPlanShotString(planShots.get(shot.shotNo), ["purposeZh", "purpose_zh"]) || shot.purpose,
        purposeEn: readPlanShotString(planShots.get(shot.shotNo), ["purposeEn", "purpose_en"]) || titleFromPrompt(readPlanShotString(planShots.get(shot.shotNo), ["videoPromptEn", "video_prompt_en"]) || shot.videoPrompt, `Shot ${shot.shotNo}`),
        imagePromptZh: readPlanShotString(planShots.get(shot.shotNo), ["imagePromptZh", "image_prompt_zh"]) || shot.imagePrompt,
        imagePromptEn: readPlanShotString(planShots.get(shot.shotNo), ["imagePromptEn", "image_prompt_en"]) || shot.imagePrompt,
        videoPromptZh: readPlanShotString(planShots.get(shot.shotNo), ["videoPromptZh", "video_prompt_zh"]) || shot.videoPrompt,
        videoPromptEn: readPlanShotString(planShots.get(shot.shotNo), ["videoPromptEn", "video_prompt_en"]) || shot.videoPrompt,
        negativePromptZh: readPlanShotString(planShots.get(shot.shotNo), ["negativePromptZh", "negative_prompt_zh"]) || toChineseNegativePrompt(shot.negativePrompt),
        negativePromptEn: readPlanShotString(planShots.get(shot.shotNo), ["negativePromptEn", "negative_prompt_en"]) || shot.negativePrompt,
        boundaryMode: readPlanBoundaryMode(planShots.get(shot.shotNo)),
        outputMode: readPlanShotString(planShots.get(shot.shotNo), ["outputMode", "output_mode"]),
        constraints: readPlanStringArray(planShots.get(shot.shotNo), ["constraints"]),
        timedPrompts: readPlanTimedPrompts(planShots.get(shot.shotNo)),
        microShots: readPlanMicroShots(planShots.get(shot.shotNo)),
        audioPlan: readPlanAudioPlan(planShots.get(shot.shotNo)),
        createdAt: shot.createdAt.toISOString(),
        updatedAt: shot.updatedAt.toISOString(),
      }));
  return {
    ...project,
    referenceImageUrls: jsonStringArray(project.referenceImageUrls),
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    keyframes: keyframes.map((frame) => ({
      ...frame,
      anchorId: readPlanShotString(planKeyframes.get(frame.keyframeNo) ?? planConsistencyReferences.get(frame.keyframeNo), ["anchorId", "anchor_id"]),
      assetView: readPlanShotString(planKeyframes.get(frame.keyframeNo) ?? planConsistencyReferences.get(frame.keyframeNo), ["assetView", "asset_view"]),
      sourceArtifactId: readPlanShotString(planKeyframes.get(frame.keyframeNo) ?? planConsistencyReferences.get(frame.keyframeNo), ["sourceArtifactId", "source_artifact_id"]),
      viewGenerationMode: readPlanShotString(planKeyframes.get(frame.keyframeNo) ?? planConsistencyReferences.get(frame.keyframeNo), ["viewGenerationMode", "view_generation_mode"]),
      purposeZh: readPlanShotString(planKeyframes.get(frame.keyframeNo) ?? planConsistencyReferences.get(frame.keyframeNo), ["purposeZh", "purpose_zh"]) || frame.purpose,
      purposeEn: readPlanShotString(planKeyframes.get(frame.keyframeNo) ?? planConsistencyReferences.get(frame.keyframeNo), ["purposeEn", "purpose_en"]) || titleFromPrompt(readPlanShotString(planKeyframes.get(frame.keyframeNo) ?? planConsistencyReferences.get(frame.keyframeNo), ["imagePromptEn", "image_prompt_en"]) || frame.imagePrompt, `Boundary frame ${frame.keyframeNo}`),
      imagePromptZh: readPlanShotString(planKeyframes.get(frame.keyframeNo) ?? planConsistencyReferences.get(frame.keyframeNo), ["imagePromptZh", "image_prompt_zh"]) || frame.imagePrompt,
      imagePromptEn: readPlanShotString(planKeyframes.get(frame.keyframeNo) ?? planConsistencyReferences.get(frame.keyframeNo), ["imagePromptEn", "image_prompt_en"]) || frame.imagePrompt,
      negativePromptZh: readPlanShotString(planKeyframes.get(frame.keyframeNo) ?? planConsistencyReferences.get(frame.keyframeNo), ["negativePromptZh", "negative_prompt_zh"]) || toChineseNegativePrompt(frame.negativePrompt),
      negativePromptEn: readPlanShotString(planKeyframes.get(frame.keyframeNo) ?? planConsistencyReferences.get(frame.keyframeNo), ["negativePromptEn", "negative_prompt_en"]) || frame.negativePrompt,
      createdAt: frame.createdAt.toISOString(),
      updatedAt: frame.updatedAt.toISOString(),
    })),
    segments: segments.map((segment) => ({
      ...segment,
      purposeZh: readPlanShotString(planSegments.get(segment.segmentNo), ["purposeZh", "purpose_zh"]) || segment.purpose,
      purposeEn: readPlanShotString(planSegments.get(segment.segmentNo), ["purposeEn", "purpose_en"]) || titleFromPrompt(readPlanShotString(planSegments.get(segment.segmentNo), ["videoPromptEn", "video_prompt_en"]) || segment.videoPrompt, `Segment ${segment.segmentNo}`),
      negativePromptZh: readPlanShotString(planSegments.get(segment.segmentNo), ["negativePromptZh", "negative_prompt_zh"]) || toChineseNegativePrompt(segment.negativePrompt),
      negativePromptEn: readPlanShotString(planSegments.get(segment.segmentNo), ["negativePromptEn", "negative_prompt_en"]) || segment.negativePrompt,
      createdAt: segment.createdAt.toISOString(),
      updatedAt: segment.updatedAt.toISOString(),
    })),
    generationCandidates: project.generationCandidates.map((candidate) => ({
      ...candidate,
      createdAt: candidate.createdAt.toISOString(),
      updatedAt: candidate.updatedAt.toISOString(),
    })),
    shots: compatShots,
    plannerProgress: readVideoPlanningProgress(project.planJson),
    planDebug: extractPlanDebug(project.planJson),
  };
}

function readVideoPlanningProgress(planJson: Prisma.JsonValue | null | undefined): VideoPlanningProgress | undefined {
  if (!isRecord(planJson) || !isRecord(planJson.plannerProgress)) return undefined;
  const raw = planJson.plannerProgress;
  const metrics = isRecord(raw.metrics) ? raw.metrics : {};
  if (typeof raw.taskId !== "string" || typeof raw.stage !== "string" || typeof raw.status !== "string") return undefined;
  return {
    taskId: raw.taskId,
    workerId: typeof raw.workerId === "string" ? raw.workerId : undefined,
    heartbeatAt: typeof raw.heartbeatAt === "string" ? raw.heartbeatAt : undefined,
    leaseExpiresAt: typeof raw.leaseExpiresAt === "string" ? raw.leaseExpiresAt : undefined,
    status: raw.status === "queued" || raw.status === "completed" || raw.status === "failed" || raw.status === "cancelled" ? raw.status : "running",
    stage: raw.stage as AliyunStoryboardProgressStage,
    completedSteps: Math.max(0, planningNumber(raw.completedSteps)),
    totalSteps: Math.max(1, planningNumber(raw.totalSteps) || 4),
    currentSegmentNo: planningNumber(raw.currentSegmentNo) || undefined,
    completedSegments: Math.max(0, planningNumber(raw.completedSegments)),
    totalSegments: Math.max(0, planningNumber(raw.totalSegments)),
    attempt: planningNumber(raw.attempt) || undefined,
    detailZh: typeof raw.detailZh === "string" ? raw.detailZh : "正在准备剧本规划任务。",
    detailEn: typeof raw.detailEn === "string" ? raw.detailEn : "Preparing the storyboard planning task.",
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    metrics: {
      jsonRepairCount: Math.max(0, planningNumber(metrics.jsonRepairCount)),
      jsonRepairDurationMs: Math.max(0, planningNumber(metrics.jsonRepairDurationMs)),
      singleTakeRepairCount: Math.max(0, planningNumber(metrics.singleTakeRepairCount)),
      singleTakeRepairDurationMs: Math.max(0, planningNumber(metrics.singleTakeRepairDurationMs)),
    },
  };
}

function planningNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function serializeSegmentAsShot(
  segment: VideoProjectWithShots["segments"][number],
  keyframeMap: Map<number, VideoProjectWithShots["keyframes"][number]>,
  planShots: Map<number, Record<string, unknown>>,
  selectedMicroShotCandidates: Map<string, VideoProjectWithShots["generationCandidates"][number]>,
) {
  const start = keyframeMap.get(segment.startKeyframeNo);
  const end = keyframeMap.get(segment.endKeyframeNo);
  const planShot = planShots.get(segment.segmentNo);
  return {
    id: segment.id,
    shotNo: segment.segmentNo,
    status: segment.status,
    durationSeconds: segment.durationSeconds,
    purpose: segment.purpose,
    purposeZh: readPlanShotString(planShot, ["purposeZh", "purpose_zh"]) || segment.purpose,
    purposeEn: readPlanShotString(planShot, ["purposeEn", "purpose_en"]) || titleFromPrompt(readPlanShotString(planShot, ["videoPromptEn", "video_prompt_en"]) || segment.videoPrompt, `Segment ${segment.segmentNo}`),
    camera: segment.camera,
    action: segment.motion,
    imagePrompt: start?.imagePrompt ?? "",
    imagePromptZh: start?.imagePrompt ?? "",
    imagePromptEn: readPlanShotString(planShot, ["imagePromptEn", "image_prompt_en"]) || start?.imagePrompt || "",
    videoPrompt: segment.videoPrompt,
    videoPromptZh: readPlanShotString(planShot, ["videoPromptZh", "video_prompt_zh"]) || segment.videoPrompt,
    videoPromptEn: readPlanShotString(planShot, ["videoPromptEn", "video_prompt_en"]) || segment.videoPrompt,
    boundaryMode: readPlanBoundaryMode(planShot),
    outputMode: readPlanShotString(planShot, ["outputMode", "output_mode"]),
    constraints: readPlanStringArray(planShot, ["constraints"]),
    timedPrompts: readPlanTimedPrompts(planShot),
    microShots: readPlanMicroShots(planShot).map((microShot) => {
      const selected = selectedMicroShotCandidates.get(imageArtifactIdForMicroShot(segment.segmentNo, microShot.microShotNo));
      return selected?.mediaUrl
        ? { ...microShot, imageUrl: selected.mediaUrl, imageTaskId: "", imageStatus: "ready" as const, errorMessage: "" }
        : microShot;
    }),
    audioPlan: readPlanAudioPlan(planShot),
    negativePrompt: segment.negativePrompt,
    negativePromptZh: readPlanShotString(planShot, ["negativePromptZh", "negative_prompt_zh"]) || toChineseNegativePrompt(segment.negativePrompt),
    negativePromptEn: readPlanShotString(planShot, ["negativePromptEn", "negative_prompt_en"]) || segment.negativePrompt,
    subtitle: segment.subtitle,
    imageUrl: start?.imageUrl ?? null,
    endImageUrl: end?.imageUrl ?? null,
    clipUrl: segment.clipUrl,
    qualityScore: segment.qualityScore,
    errorMessage: segment.errorMessage,
    locked: segment.locked,
    startKeyframeNo: segment.startKeyframeNo,
    endKeyframeNo: segment.endKeyframeNo,
    startTimeSeconds: segment.startTimeSeconds,
    endTimeSeconds: segment.endTimeSeconds,
    createdAt: segment.createdAt.toISOString(),
    updatedAt: segment.updatedAt.toISOString(),
  };
}

function extractPlanDebug(planJson: Prisma.JsonValue | null): Record<string, unknown> {
  const plan = isRecord(planJson) ? planJson : {};
  const planningManifest = isRecord(plan.planningManifest)
    ? plan.planningManifest
    : isRecord(plan.planning_manifest)
      ? plan.planning_manifest
      : {};
  const consistencyManifest = isRecord(plan.consistencyManifest)
    ? plan.consistencyManifest
    : isRecord(plan.consistency_manifest)
      ? plan.consistency_manifest
      : isRecord(planningManifest.consistencyManifest)
        ? planningManifest.consistencyManifest
        : isRecord(planningManifest.consistency_manifest)
          ? planningManifest.consistency_manifest
          : {};
  return {
    narrativeEvents: Array.isArray(plan.narrativeEvents)
      ? plan.narrativeEvents
      : Array.isArray(plan.narrative_events)
        ? plan.narrative_events
        : [],
    creativeStrategy: isRecord(plan.creativeStrategy)
      ? plan.creativeStrategy
      : isRecord(plan.creative_strategy)
        ? plan.creative_strategy
        : {},
    storyBeats: Array.isArray(plan.storyBeats)
      ? plan.storyBeats
      : Array.isArray(plan.story_beats)
        ? plan.story_beats
        : [],
    narrativeMicroRules: isRecord(plan.narrativeMicroRules)
      ? plan.narrativeMicroRules
      : isRecord(plan.narrative_micro_rules)
        ? plan.narrative_micro_rules
        : {},
    shotGroupingPass: isRecord(plan.shotGroupingPass)
      ? plan.shotGroupingPass
      : isRecord(plan.shot_grouping_pass)
        ? plan.shot_grouping_pass
        : {},
    storyQualityReport: isRecord(plan.storyQualityReport)
      ? plan.storyQualityReport
      : isRecord(plan.story_quality_report)
        ? plan.story_quality_report
        : {},
    consistencyAnchors: isRecord(consistencyManifest) && Array.isArray(consistencyManifest.anchors) ? consistencyManifest.anchors : [],
    anchorStateTimeline: Array.isArray(plan.anchorStateTimeline)
      ? plan.anchorStateTimeline
      : Array.isArray(plan.anchor_state_timeline)
        ? plan.anchor_state_timeline
        : [],
    segmentRenderDescriptions: Array.isArray(plan.segmentRenderDescriptions)
      ? plan.segmentRenderDescriptions
      : Array.isArray(plan.segment_render_descriptions)
        ? plan.segment_render_descriptions
        : [],
    finalTransitionPlan: Array.isArray(plan.finalTransitionPlan)
      ? plan.finalTransitionPlan
      : Array.isArray(plan.final_transition_plan)
        ? plan.final_transition_plan
        : [],
    transitionReferenceArtifacts: Array.isArray(plan.transitionReferenceArtifacts)
      ? plan.transitionReferenceArtifacts
      : Array.isArray(plan.transition_reference_artifacts) ? plan.transition_reference_artifacts : [],
    generatedBridgeArtifacts: Array.isArray(plan.generatedBridgeArtifacts)
      ? plan.generatedBridgeArtifacts
      : Array.isArray(plan.generated_bridge_artifacts) ? plan.generated_bridge_artifacts : [],
    audioBible: isRecord(plan.audioBible)
      ? plan.audioBible
      : isRecord(plan.audio_bible)
        ? plan.audio_bible
        : {},
    assetLibrary: isRecord(plan.assetLibrary)
      ? plan.assetLibrary
      : isRecord(plan.asset_library)
        ? plan.asset_library
        : {},
    referenceSelectionOutputs: Array.isArray(plan.referenceSelectionOutputs)
      ? plan.referenceSelectionOutputs
      : Array.isArray(plan.reference_selection_outputs)
        ? plan.reference_selection_outputs
        : [],
    promptDebugArtifacts: isRecord(plan.promptDebugArtifacts)
      ? plan.promptDebugArtifacts
      : isRecord(plan.prompt_debug_artifacts)
        ? plan.prompt_debug_artifacts
        : {},
    artifactMetadata: isRecord(plan.artifactMetadata)
      ? plan.artifactMetadata
      : isRecord(plan.artifact_metadata)
        ? plan.artifact_metadata
        : {},
    mediaRevisionHistory: isRecord(plan.mediaRevisionHistory)
      ? plan.mediaRevisionHistory
      : isRecord(plan.media_revision_history)
        ? plan.media_revision_history
        : {},
    generationQualityReports: Array.isArray(plan.generationQualityReports)
      ? plan.generationQualityReports
      : Array.isArray(plan.generation_quality_reports)
        ? plan.generation_quality_reports
        : [],
    plannerShadow: isRecord(plan.plannerShadow)
      ? plan.plannerShadow
      : isRecord(plan.planner_shadow)
        ? plan.planner_shadow
        : {},
    plannerWarnings: Array.isArray(plan.plannerWarnings)
      ? plan.plannerWarnings
      : Array.isArray(plan.planner_warnings)
        ? plan.planner_warnings
        : [],
  };
}

function jsonStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertPlanValidForGeneration(...args: Parameters<typeof assertPlanValidForGenerationV2>): void {
  if (!onePromptRolloutEnabled("ONE_PROMPT_STRICT_VALIDATION")) return;
  assertPlanValidForGenerationV2(...args);
}

function imageCandidateCount(): number {
  // Images use a cost-saving short-circuit strategy: generate one candidate,
  // evaluate it, and only submit another attempt when it fails.
  return Math.max(1, Math.min(4, envInt("ONE_PROMPT_IMAGE_CANDIDATE_COUNT", 1)));
}

function videoCandidateCount(): number {
  return Math.max(1, Math.min(4, envInt("ONE_PROMPT_VIDEO_CANDIDATE_COUNT", DEFAULT_GENERATION_CANDIDATE_COUNT)));
}

function generationMaxRetries(): number {
  return Math.max(0, Math.min(4, envInt("ONE_PROMPT_GENERATION_MAX_RETRIES", 2)));
}

const QUALITY_EVALUATION_LEASE_MS = 5 * 60 * 1000;

function qualityEvaluationsPerSync(): number {
  const value = Number(process.env.ONE_PROMPT_GENERATION_QUALITY_EVALUATIONS_PER_SYNC);
  return Number.isFinite(value) && value >= 1 ? Math.min(4, Math.round(value)) : 2;
}

function qualityTechnicalRetryCycles(): number {
  const value = Number(process.env.ONE_PROMPT_GENERATION_QUALITY_RETRY_CYCLES);
  return Number.isFinite(value) && value >= 1 ? Math.min(4, Math.round(value)) : 2;
}

function qualityTechnicalRetryDelayMs(attempt: number): number {
  const base = Number(process.env.ONE_PROMPT_GENERATION_QUALITY_CYCLE_RETRY_DELAY_MS);
  const safeBase = Number.isFinite(base) && base >= 1000 ? Math.min(60000, Math.round(base)) : 5000;
  return safeBase * Math.max(1, Math.min(4, attempt));
}

type CandidateKind = "keyframe_image" | "micro_shot_image" | "segment_video";

type CandidateAttemptRecord = {
  artifactId: string;
  batchId: string;
  status: string;
  metadata: Prisma.JsonValue | null;
};

type RetryBudgetCandidate = CandidateAttemptRecord & {
  mediaUrl?: string | null;
  qualityReport?: Prisma.JsonValue | null;
};

export function generationQualityAttemptsUsed(candidates: RetryBudgetCandidate[]): number {
  const attempts = new Set<number>();
  for (const candidate of candidates) {
    if (!candidate.mediaUrl || !candidate.qualityReport || !isRecord(candidate.qualityReport)) continue;
    const report = candidate.qualityReport as unknown as GenerationQualityReport;
    if (isTechnicalQualityEvaluationFailure(report)) continue;
    attempts.add(Math.max(1, Number(candidateMetadata(candidate.metadata).attempt) || 1));
  }
  return attempts.size;
}

export function generationTransportAttemptsUsed(candidates: RetryBudgetCandidate[]): number {
  const attempts = new Map<number, RetryBudgetCandidate[]>();
  for (const candidate of candidates) {
    const attempt = Math.max(1, Number(candidateMetadata(candidate.metadata).attempt) || 1);
    attempts.set(attempt, [...(attempts.get(attempt) ?? []), candidate]);
  }
  return [...attempts.values()].filter((items) =>
    items.length > 0 && items.every((item) => item.status === "failed" && !item.mediaUrl),
  ).length;
}

export function nextGenerationCandidateAttempt(
  candidates: CandidateAttemptRecord[],
  artifactId: string,
  requestedRetryCycleId?: string,
): { attempt: number; retryCycleId: string } {
  if (requestedRetryCycleId) return { attempt: 1, retryCycleId: requestedRetryCycleId };
  const artifactCandidates = candidates.filter((item) => item.artifactId === artifactId);
  if (!artifactCandidates.length) return { attempt: 1, retryCycleId: randomUUID() };
  const latestBatchId = artifactCandidates[0].batchId;
  const latestBatch = artifactCandidates.filter((item) => item.batchId === latestBatchId);
  const latestMetadata = candidateMetadata(latestBatch[0]?.metadata ?? null);
  const retryCycleId = typeof latestMetadata.retryCycleId === "string" ? latestMetadata.retryCycleId : "";
  const startsNewCycle = !retryCycleId || latestBatch.some((item) => item.status === "selected" || item.status === "recommended" || item.status === "cancelled");
  if (startsNewCycle) return { attempt: 1, retryCycleId: randomUUID() };
  const previousAttempt = Math.max(1, Number(latestMetadata.attempt) || 1);
  return { attempt: previousAttempt + 1, retryCycleId };
}

function cleanInputJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function createImageCandidateBatch(params: {
  project: VideoProjectWithShots;
  artifactId: string;
  targetId: string;
  kind: Exclude<CandidateKind, "segment_video">;
  prompt: string;
  negativePrompt?: string;
  referenceImageUrls: string[];
  metadata: Record<string, unknown>;
  seedBase?: number;
  candidateCount?: number;
}): Promise<string> {
  const batchId = randomUUID();
  const requestedRetryCycleId = typeof params.metadata.retryCycleId === "string" ? params.metadata.retryCycleId : undefined;
  const { attempt, retryCycleId } = nextGenerationCandidateAttempt(params.project.generationCandidates, params.artifactId, requestedRetryCycleId);
  const historicalCandidateCount = await prisma.videoGenerationCandidate.count({
    where: { projectId: params.project.id, artifactId: params.artifactId },
  });
  const candidateCount = Math.max(1, Math.min(4, params.candidateCount ?? imageCandidateCount()));
  const referenceUsageNotes = Array.isArray(params.metadata.referenceUsageNotes)
    ? params.metadata.referenceUsageNotes.filter((item): item is string => typeof item === "string")
    : [];
  let firstTaskId = "";
  for (let localCandidateNo = 1; localCandidateNo <= candidateCount; localCandidateNo += 1) {
    const candidateNo = historicalCandidateCount + localCandidateNo;
    const submittedPrompt = prepareAliyunImagePrompt(
      params.prompt,
      params.negativePrompt,
      params.referenceImageUrls,
      referenceUsageNotes,
    );
    try {
      const taskId = await submitAliyunImageTask({
        prompt: params.prompt,
        negativePrompt: params.negativePrompt,
        referenceImageUrls: params.referenceImageUrls,
        referenceUsageNotes,
        aspectRatio: params.project.aspectRatio as "9:16" | "16:9" | "1:1",
        seed: Math.abs((params.seedBase ?? Date.now()) + candidateNo * 7919) % 2147483647,
      });
      if (!firstTaskId) firstTaskId = taskId;
      await prisma.videoGenerationCandidate.create({ data: { projectId: params.project.id, artifactId: params.artifactId, targetId: params.targetId, kind: params.kind, batchId, candidateNo, taskId, status: "running", prompt: submittedPrompt, negativePrompt: params.negativePrompt ?? "", metadata: cleanInputJson({ ...params.metadata, attempt, retryCycleId, historicalCandidateCount, sourcePrompt: params.prompt, submittedPromptCompacted: submittedPrompt !== params.prompt }) } });
    } catch (error) {
      await prisma.videoGenerationCandidate.create({ data: { projectId: params.project.id, artifactId: params.artifactId, targetId: params.targetId, kind: params.kind, batchId, candidateNo, status: "failed", prompt: submittedPrompt, negativePrompt: params.negativePrompt ?? "", errorMessage: error instanceof Error ? error.message : String(error), metadata: cleanInputJson({ ...params.metadata, attempt, retryCycleId, historicalCandidateCount, sourcePrompt: params.prompt, submittedPromptCompacted: submittedPrompt !== params.prompt }) } });
    }
  }
  if (!firstTaskId) throw new Error("All image candidate submissions failed");
  return firstTaskId;
}

async function createVideoCandidateBatch(params: {
  project: VideoProjectWithShots;
  segment: VideoProjectWithShots["segments"][number];
  prompt: string;
  startFrameUrl: string;
  endFrameUrl: string;
  metadata: Record<string, unknown>;
}): Promise<string> {
  const artifactId = videoArtifactIdForSegmentNo(params.segment.segmentNo);
  const batchId = randomUUID();
  const requestedRetryCycleId = typeof params.metadata.retryCycleId === "string" ? params.metadata.retryCycleId : undefined;
  const { attempt, retryCycleId } = nextGenerationCandidateAttempt(params.project.generationCandidates, artifactId, requestedRetryCycleId);
  let firstTaskId = "";
  for (let candidateNo = 1; candidateNo <= videoCandidateCount(); candidateNo += 1) {
    try {
      const taskId = await submitAliyunImageToVideoTask({
        imageUrl: params.startFrameUrl,
        lastFrameUrl: params.endFrameUrl,
        prompt: params.prompt,
        durationSeconds: params.segment.durationSeconds,
      });
      if (!firstTaskId) firstTaskId = taskId;
      await prisma.videoGenerationCandidate.create({ data: { projectId: params.project.id, artifactId, targetId: params.segment.id, kind: "segment_video", batchId, candidateNo, taskId, status: "running", prompt: params.prompt, negativePrompt: params.segment.negativePrompt, metadata: cleanInputJson({ ...params.metadata, attempt, retryCycleId, durationSeconds: params.segment.durationSeconds, startFrameUrl: params.startFrameUrl, endFrameUrl: params.endFrameUrl, videoModel: "happyhorse-1.1-i2v", endFrameConstraintMode: "strong_prompt_target_and_visual_check", endFramePromptEnforced: true }) } });
    } catch (error) {
      await prisma.videoGenerationCandidate.create({ data: { projectId: params.project.id, artifactId, targetId: params.segment.id, kind: "segment_video", batchId, candidateNo, status: "failed", prompt: params.prompt, negativePrompt: params.segment.negativePrompt, errorMessage: error instanceof Error ? error.message : String(error), metadata: cleanInputJson({ ...params.metadata, attempt, retryCycleId, durationSeconds: params.segment.durationSeconds, startFrameUrl: params.startFrameUrl, endFrameUrl: params.endFrameUrl }) } });
    }
  }
  if (!firstTaskId) throw new Error("All video candidate submissions failed");
  return firstTaskId;
}

function planRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function segmentNoForBoundaryKeyframe(planJson: Prisma.JsonValue | null, keyframeNo: number): number {
  const segments = [...readPlanSegmentMap(planJson).values()];
  const exactStart = segments.find((segment) => Number(segment.startKeyframeNo ?? segment.start_keyframe_no) === keyframeNo);
  if (exactStart) return Number(exactStart.segmentNo ?? exactStart.segment_no ?? 1);
  const exactEnd = segments.find((segment) => Number(segment.endKeyframeNo ?? segment.end_keyframe_no) === keyframeNo);
  return exactEnd ? Number(exactEnd.segmentNo ?? exactEnd.segment_no ?? 1) : Math.max(1, keyframeNo);
}

function readPlanShotMap(planJson: Prisma.JsonValue | null): Map<number, Record<string, unknown>> {
  const plan = isRecord(planJson) ? planJson : {};
  const shots = Array.isArray(plan.shots) ? plan.shots : [];
  const map = new Map<number, Record<string, unknown>>();
  for (const shot of shots) {
    if (!isRecord(shot)) continue;
    const n = Number(shot.shotNo ?? shot.shot_no ?? shot.sequence);
    if (Number.isInteger(n) && n > 0) map.set(n, shot);
  }
  return map;
}

function readPlanKeyframeMap(planJson: Prisma.JsonValue | null): Map<number, Record<string, unknown>> {
  const plan = isRecord(planJson) ? planJson : {};
  const keyframes = Array.isArray(plan.keyframes) ? plan.keyframes : [];
  const map = new Map<number, Record<string, unknown>>();
  for (const keyframe of keyframes) {
    if (!isRecord(keyframe)) continue;
    const n = Number(keyframe.keyframeNo ?? keyframe.keyframe_no ?? keyframe.sequence);
    if (Number.isInteger(n) && n > 0) map.set(n, keyframe);
  }
  return map;
}

function readPlanConsistencyReferenceMap(planJson: Prisma.JsonValue | null): Map<number, Record<string, unknown>> {
  const plan = isRecord(planJson) ? planJson : {};
  const references = Array.isArray(plan.consistencyReferences)
    ? plan.consistencyReferences
    : Array.isArray(plan.consistency_references)
      ? plan.consistency_references
      : [];
  const map = new Map<number, Record<string, unknown>>();
  for (const reference of references) {
    if (!isRecord(reference)) continue;
    const kind = String(reference.kind ?? "").toLowerCase();
    const explicitNo = Number(reference.keyframeNo ?? reference.keyframe_no);
    const n = Number.isInteger(explicitNo)
      ? explicitNo
      : kind === "character"
        ? CHARACTER_CONSISTENCY_KEYFRAME_NO
        : kind === "scene"
          ? SCENE_CONSISTENCY_KEYFRAME_NO
          : 0;
    if (n < 0) map.set(n, reference);
  }
  return map;
}

function readPlanSegmentMap(planJson: Prisma.JsonValue | null): Map<number, Record<string, unknown>> {
  const plan = isRecord(planJson) ? planJson : {};
  const segments = Array.isArray(plan.segments) ? plan.segments : [];
  const map = new Map<number, Record<string, unknown>>();
  for (const segment of segments) {
    if (!isRecord(segment)) continue;
    const n = Number(segment.segmentNo ?? segment.segment_no ?? segment.shotNo ?? segment.shot_no ?? segment.sequence);
    if (Number.isInteger(n) && n > 0) map.set(n, segment);
  }
  return map;
}

function readPlanSegmentRenderDescriptionMap(planJson: Prisma.JsonValue | null): Map<number, Record<string, unknown>> {
  const plan = isRecord(planJson) ? planJson : {};
  const descriptions = Array.isArray(plan.segmentRenderDescriptions)
    ? plan.segmentRenderDescriptions
    : Array.isArray(plan.segment_render_descriptions)
      ? plan.segment_render_descriptions
      : [];
  const map = new Map<number, Record<string, unknown>>();
  for (const description of descriptions) {
    if (!isRecord(description)) continue;
    const n = Number(description.segmentNo ?? description.segment_no ?? description.shotNo ?? description.shot_no ?? description.sequence);
    if (Number.isInteger(n) && n > 0) map.set(n, description);
  }
  return map;
}

function readFinalTransitionPlan(planJson: Prisma.JsonValue | null): FinalTransitionPlan[] {
  const plan = isRecord(planJson) ? planJson : {};
  const raw = Array.isArray(plan.finalTransitionPlan)
    ? plan.finalTransitionPlan
    : Array.isArray(plan.final_transition_plan)
      ? plan.final_transition_plan
      : [];
  return raw.flatMap((item) => {
    if (!isRecord(item)) return [];
    const fromSegmentNo = Number(item.fromSegmentNo ?? item.from_segment_no);
    const toSegmentNo = Number(item.toSegmentNo ?? item.to_segment_no);
    if (!Number.isInteger(fromSegmentNo) || !Number.isInteger(toSegmentNo)) return [];
    return [{
      fromSegmentNo,
      toSegmentNo,
      visualMode: normalizeComposeVisualMode(item.visualMode ?? item.visual_mode),
      audioMode: normalizeComposeAudioMode(item.audioMode ?? item.audio_mode),
      overlapSeconds: Math.max(0, Number(item.overlapSeconds ?? item.overlap_seconds) || 0),
      matchAnchorId: typeof item.matchAnchorId === "string"
        ? item.matchAnchorId
        : typeof item.match_anchor_id === "string"
          ? item.match_anchor_id
          : undefined,
      generatedBridgeRequired: Boolean(item.generatedBridgeRequired ?? item.generated_bridge_required),
    }];
  });
}

export function readAudioBible(planJson: Prisma.JsonValue | null): Record<string, unknown> | undefined {
  const plan = isRecord(planJson) ? planJson : {};
  const audioBible = isRecord(plan.audioBible)
    ? plan.audioBible
    : isRecord(plan.audio_bible)
      ? plan.audio_bible
      : undefined;
  if (!audioBible) return undefined;
  const mode = String(audioBible.mode ?? audioBible.audioMode ?? audioBible.audio_mode ?? "").trim().toLowerCase();
  const postProductionMode = ["postproduction", "post_production", "post-production", "unified_mix", "audio_post", "voiceover", "dialogue", "mixed"].includes(mode)
    || Boolean(audioBible.bgmUrl ?? audioBible.bgm_url ?? audioBible.ttsUrl ?? audioBible.tts_url ?? audioBible.sfxUrl ?? audioBible.sfx_url);
  return {
    ...audioBible,
    stripSourceAudio: onePromptRolloutEnabled("ONE_PROMPT_UNIFIED_AUDIO_MIX") && postProductionMode
      ? true
      : audioBible.stripSourceAudio ?? audioBible.strip_source_audio ?? false,
    loudnorm: audioBible.loudnorm ?? audioBible.loudNorm ?? audioBible.loudnessNormalization ?? audioBible.loudness_normalization ?? true,
  };
}

function transitionReferenceMode(): "short" | "full" {
  return process.env.ONE_PROMPT_TRANSITION_REFERENCE_MODE?.trim().toLowerCase() === "full" ? "full" : "short";
}

function transitionReferenceArtifactsFromPlan(planJson: Prisma.JsonValue | null): TransitionReferenceArtifact[] {
  const plan = planRecord(planJson);
  const values = Array.isArray(plan.transitionReferenceArtifacts)
    ? plan.transitionReferenceArtifacts
    : Array.isArray(plan.transition_reference_artifacts) ? plan.transition_reference_artifacts : [];
  return values.filter(isRecord) as unknown as TransitionReferenceArtifact[];
}

function generatedBridgeArtifactsFromPlan(planJson: Prisma.JsonValue | null): GeneratedBridgeArtifact[] {
  const plan = planRecord(planJson);
  const values = Array.isArray(plan.generatedBridgeArtifacts)
    ? plan.generatedBridgeArtifacts
    : Array.isArray(plan.generated_bridge_artifacts) ? plan.generated_bridge_artifacts : [];
  return values.filter(isRecord) as unknown as GeneratedBridgeArtifact[];
}

function materializeTransitionProductionArtifacts(plan: OnePromptVideoPlan, previousPlanJson?: Prisma.JsonValue | null): void {
  if (!onePromptRolloutEnabled("ONE_PROMPT_TRANSITION_REFERENCE")) return;
  const source = plan as unknown as Record<string, unknown>;
  const graph = readCameraGraph(plan.cameraGraph ?? source.camera_graph);
  const rawRequests = (Array.isArray(plan.transitionReferencePlan) ? plan.transitionReferencePlan : Array.isArray(source.transition_reference_plan) ? source.transition_reference_plan : []).filter(isRecord);
  const previousTransitions = new Map(transitionReferenceArtifactsFromPlan(previousPlanJson ?? null).map((item) => [item.id, item]));
  const segments = new Map(plan.segments.map((segment) => [segment.segmentNo, segment]));
  const now = new Date().toISOString();
  const artifacts: TransitionReferenceArtifact[] = [];
  for (const node of graph.cameras) {
    const relationEdge = graph.relations.find((edge) => edge.toCameraId === node.cameraId);
    const relation = node.relationToParent ?? relationEdge?.relation;
    if (!relation || !node.segmentNos.length) continue;
    const toSegmentNo = Math.min(...node.segmentNos);
    const request = rawRequests.find((item) => readPlanShotString(item, ["toCameraId", "to_camera_id", "cameraId", "camera_id"]) === node.cameraId || Number(item.toSegmentNo ?? item.to_segment_no ?? item.segmentNo ?? item.segment_no) === toSegmentNo);
    const explicitlyNoInheritance = /无需继承|不继承|no[ _-]?inheritance|independent setup/i.test(node.inheritanceReasonZh ?? "") && !request;
    const derivedNeedsHelp = relation === "derived_reframe" && (Boolean(request) || Boolean(node.missingInfo?.length) || /reframe|构图|framing/i.test(node.framingRange ?? ""));
    const triggered = Boolean(request) || relation === "alternate_view" || derivedNeedsHelp || (relation === "new_camera_setup" && !explicitlyNoInheritance);
    if (!triggered) continue;
    const parentCameraId = node.parentCameraId ?? relationEdge?.fromCameraId;
    const parent = graph.cameras.find((item) => item.cameraId === parentCameraId);
    const fromSegmentNo = node.parentSegmentNo ?? parent?.segmentNos.at(-1);
    const parentSegment = fromSegmentNo ? segments.get(fromSegmentNo) : undefined;
    const parentKeyframeNo = parentSegment?.startKeyframeNo ?? parentSegment?.endKeyframeNo;
    const id = `transition_reference:${node.cameraId}:${toSegmentNo}`;
    const previous = previousTransitions.get(id);
    const modeValue = readPlanShotString(request, ["mode", "productionMode", "production_mode"]);
    const mode = modeValue === "full" || modeValue === "short" ? modeValue : transitionReferenceMode();
    const inheritanceScope = relation === "alternate_view"
      ? ["space_layout", "composition", "lighting", "axis_and_left_right"]
      : relation === "new_camera_setup"
        ? ["space_layout", "composition", "lighting", "subject_positions"]
        : ["space_layout", "composition", "lighting"];
    artifacts.push(previous ? { ...previous, relation, mode, inheritanceScope, reasonZh: readPlanShotString(request, ["reasonZh", "reason_zh", "reason", "purpose"]) || previous.reasonZh, parentKeyframeNo, updatedAt: now } : {
      id, fromCameraId: parentCameraId, toCameraId: node.cameraId, fromSegmentNo, toSegmentNo, relation, mode, inheritanceScope,
      reasonZh: readPlanShotString(request, ["reasonZh", "reason_zh", "reason", "purpose"]) || `${relation} 新机位需要继承父机位的空间、构图和光线信息。`,
      status: parentKeyframeNo !== undefined ? "waiting_parent" : "planned", parentKeyframeNo, locked: false, updatedAt: now,
    });
  }
  plan.transitionReferenceArtifacts = artifacts;

  const previousBridges = new Map(generatedBridgeArtifactsFromPlan(previousPlanJson ?? null).map((item) => [item.id, item]));
  plan.generatedBridgeArtifacts = readFinalTransitionPlan(source as Prisma.JsonValue).flatMap((transition) => {
    if (transition.visualMode !== "generated_bridge" && !transition.generatedBridgeRequired) return [];
    const id = `generated_bridge:${transition.fromSegmentNo}:${transition.toSegmentNo}`;
    const previous = previousBridges.get(id);
    return [previous ?? { id, fromSegmentNo: transition.fromSegmentNo, toSegmentNo: transition.toSegmentNo, status: "planned" as const, durationSeconds: 3, locked: false, updatedAt: now }];
  });
}

function normalizeComposeVisualMode(value: unknown): FinalTransitionPlan["visualMode"] {
  if (value === "hard_cut" || value === "match_cut" || value === "dissolve" || value === "fade_to_black" || value === "generated_bridge") return value;
  return "dissolve";
}

function normalizeComposeAudioMode(value: unknown): FinalTransitionPlan["audioMode"] {
  if (value === "none" || value === "j_cut" || value === "l_cut" || value === "crossfade") return value;
  return "crossfade";
}

async function createPlanForPlannerArch(
  input: PlanVideoProjectInput,
  context: { userId: string; projectId: string },
  plannerOptions?: {
    checkpoint?: unknown;
    onCheckpoint?: (checkpoint: AliyunStoryboardPlannerCheckpoint) => Promise<void> | void;
    onProgress?: (progress: AliyunStoryboardProgressUpdate) => Promise<void> | void;
  },
): Promise<OnePromptVideoPlan> {
  const arch = onePromptPlannerArch();
  await logOnePromptVideo("project.plan.arch.selected", {
    ...context,
    arch,
  });

  if (arch === "v1") {
    return withPlannerArchMetadata(
      createVideoPlan(input),
      "v1",
      "ONE_PROMPT_VIDEO_PLANNER_ARCH=v1: local legacy planner drives generation.",
    );
  }

  if (arch === "v2_shadow") {
    const localPlan = createVideoPlan(input);
    try {
      const shadowPlan = await createAliyunStoryboardPlan(input, plannerOptions);
      await logOnePromptVideo("project.plan.arch.shadow_success", {
        ...context,
        localSegmentCount: localPlan.segmentCount,
        shadowSegmentCount: shadowPlan.segmentCount,
        shadowWarningCount: shadowPlan.plannerWarnings?.length ?? 0,
      });
      return mergeShadowPlannerPlan(localPlan, shadowPlan);
    } catch (error) {
      await logOnePromptVideo("project.plan.arch.shadow_failed_continue_local", {
        ...context,
        ...errorForLog(error),
      }, "warn");
      return withPlannerArchMetadata(
        localPlan,
        "v2_shadow",
        `ONE_PROMPT_VIDEO_PLANNER_ARCH=v2_shadow: new planner failed, local v1 plan drives generation. ${error instanceof Error ? error.message : "Unknown planner error"}`,
      );
    }
  }

  return withPlannerArchMetadata(await createAliyunStoryboardPlan(input, plannerOptions), "v2");
}

function withPlannerArchMetadata(plan: OnePromptVideoPlan, arch: OnePromptPlannerArch, warning?: string): OnePromptVideoPlan {
  return {
    ...plan,
    plannerWarnings: [
      ...(warning ? [warning] : []),
      ...(plan.plannerWarnings ?? []),
    ],
    artifactMetadata: {
      ...(plan.artifactMetadata ?? {}),
      planning: {
        artifactId: "planning",
        artifactType: "planning_contract",
        producedByStage: "stage1",
        revision: 1,
        schemaVersion: "planJson",
        plannerVersion: arch,
        promptVersion: arch,
        modelVersion: arch === "v2" ? "dashscope" : arch === "v2_shadow" ? "local+dashscope-shadow" : "local",
        inputHash: "",
        dependsOn: [],
        status: "ready",
        retryFromStage: "stage1",
      },
    },
  };
}

function mergeShadowPlannerPlan(localPlan: OnePromptVideoPlan, shadowPlan: OnePromptVideoPlan): OnePromptVideoPlan {
  return withPlannerArchMetadata({
    ...localPlan,
    plannerShadow: {
      planningManifest: shadowPlan.planningManifest,
      narrativeEvents: shadowPlan.narrativeEvents,
      anchorStateTimeline: shadowPlan.anchorStateTimeline,
      consistencyManifest: shadowPlan.consistencyManifest,
      timelineBlueprint: shadowPlan.timelineBlueprint,
      candidateTimeline: shadowPlan.candidateTimeline,
      storyboardBrief: shadowPlan.storyboardBrief,
      segmentRenderDescriptions: shadowPlan.segmentRenderDescriptions,
      cameraGraph: shadowPlan.cameraGraph,
      transitionReferencePlan: shadowPlan.transitionReferencePlan,
      finalTransitionPlan: shadowPlan.finalTransitionPlan,
      referenceSelectionOutputs: shadowPlan.referenceSelectionOutputs,
      promptDebugArtifacts: shadowPlan.promptDebugArtifacts,
      generationQualityReports: shadowPlan.generationQualityReports,
      audioBible: shadowPlan.audioBible,
      keyframeCount: shadowPlan.keyframeCount,
      segmentCount: shadowPlan.segmentCount,
      title: shadowPlan.title,
      logline: shadowPlan.logline,
    },
    plannerWarnings: [
      "ONE_PROMPT_VIDEO_PLANNER_ARCH=v2_shadow: v2 planner output is recorded for debugging; local v1 keyframes, segments, and shots drive generation.",
      ...(shadowPlan.plannerWarnings ?? []).map((warning) => `shadow: ${warning}`),
      ...(localPlan.plannerWarnings ?? []),
    ],
    artifactMetadata: {
      ...(localPlan.artifactMetadata ?? {}),
    },
  }, "v2_shadow");
}

function ensureProjectAssetLibrary(plan: OnePromptVideoPlan, input: PlanVideoProjectInput): OnePromptVideoPlan {
  const anchors = assetLibraryAnchorsForPlan(plan, input);
  const existingReferences = plan.consistencyReferences ?? [];
  const items: VideoAssetLibraryItem[] = [];
  const references: VideoConsistencyReference[] = [];
  let offset = 0;

  for (const anchor of anchors) {
    const category = assetCategoryForAnchor(anchor);
    const views = assetViewsForCategory(category);
    const baseReference = findBaseConsistencyReference(existingReferences, anchor, category);
    for (const view of views) {
      const keyframeNo = ASSET_LIBRARY_KEYFRAME_BASE - offset;
      offset += 1;
      const assetId = `${anchor.id || category}:${view}`;
      const item: VideoAssetLibraryItem = {
        assetId,
        category,
        view,
        keyframeNo,
        anchorId: anchor.id,
        displayNameZh: assetDisplayName(anchor, category, view, "zh"),
        displayNameEn: assetDisplayName(anchor, category, view, "en"),
        descriptionZh: anchor.descriptionZh,
        descriptionEn: anchor.descriptionEn,
        required: true,
        sourceView: category === "person" && view !== "front" ? "front" : undefined,
        sourceArtifactId: category === "person" && view !== "front" ? `${anchor.id || category}:front` : undefined,
        orientation: category === "person" && (view === "front" || view === "side" || view === "back") ? view : "unknown",
        viewGenerationMode: onePromptRolloutEnabled("ONE_PROMPT_THREE_VIEW_DERIVATION") && category === "person" && view !== "front" ? "derived_from_front" : "primary",
      };
      items.push(item);
      references.push(buildAssetConsistencyReference({
        item,
        anchor,
        baseReference,
        userPrompt: input.userPrompt,
        negativePrompt: plan.styleBible.negativePrompt,
        negativePromptZh: plan.styleBible.negativePromptZh,
        negativePromptEn: plan.styleBible.negativePromptEn,
      }));
    }
  }

  const assetLibrary: VideoAssetLibrary = { items };
  const nextConsistencyManifest = {
    anchors,
  };
  return {
    ...plan,
    consistencyManifest: nextConsistencyManifest,
    planningManifest: plan.planningManifest
      ? {
          ...plan.planningManifest,
          consistencyManifest: nextConsistencyManifest,
        }
      : plan.planningManifest,
    assetLibrary,
    consistencyReferences: references,
  };
}

function approvedConsistencyAssetsForReplan(
  project: VideoProjectWithShots | null,
  nextReferences: VideoConsistencyReference[],
): Map<number, VideoProjectWithShots["keyframes"][number]> {
  const preserved = new Map<number, VideoProjectWithShots["keyframes"][number]>();
  if (!project) return preserved;
  const previousReferenceMap = readPlanConsistencyReferenceMap(project.planJson);
  for (const nextReference of nextReferences) {
    const nextAssetId = nextReference.assetId || "";
    const nextAnchorId = nextReference.anchorId || "";
    const nextView = nextReference.assetView || "";
    const previousEntry = [...previousReferenceMap.entries()].find(([, previous]) => {
      const previousAssetId = readPlanShotString(previous, ["assetId", "asset_id"]);
      if (nextAssetId && previousAssetId === nextAssetId) return true;
      return Boolean(
        nextAnchorId && nextView &&
        anchorIdForConsistencyReference(previous) === nextAnchorId &&
        readPlanShotString(previous, ["assetView", "asset_view"]) === nextView,
      );
    });
    if (!previousEntry) continue;
    const previousKeyframe = project.keyframes.find((keyframe) => keyframe.keyframeNo === previousEntry[0]);
    if (previousKeyframe && isApprovedConsistencyReference(previousKeyframe)) {
      preserved.set(nextReference.keyframeNo, previousKeyframe);
    }
  }
  return preserved;
}

function assetLibraryAnchorsForPlan(plan: OnePromptVideoPlan, input: PlanVideoProjectInput): VideoConsistencyAnchor[] {
  const manifestAnchors = plan.consistencyManifest?.anchors?.length
    ? plan.consistencyManifest.anchors
    : plan.planningManifest?.consistencyManifest?.anchors ?? [];
  const anchors = manifestAnchors.filter((anchor) => anchor.mustStayConsistent || anchor.needsReferenceImage);
  if (anchors.length) return anchors.map(normalizeAssetAnchor);
  return [
    {
      id: "main-character",
      type: "person",
      displayNameZh: "主要人物",
      displayNameEn: "Main character",
      mustStayConsistent: true,
      needsReferenceImage: true,
      referenceStrength: "hard",
      descriptionZh: plan.styleBible.characterLock || input.userPrompt,
      descriptionEn: plan.styleBible.characterLock || input.userPrompt,
      appliesTo: ["keyframes", "segments", "micro_shots"],
      userEditable: true,
      imagePromptZh: plan.styleBible.characterLock || input.userPrompt,
      imagePromptEn: plan.styleBible.characterLock || input.userPrompt,
    },
    {
      id: "main-scene",
      type: "location",
      displayNameZh: "主要场景",
      displayNameEn: "Main scene",
      mustStayConsistent: true,
      needsReferenceImage: true,
      referenceStrength: "medium",
      descriptionZh: input.userPrompt,
      descriptionEn: input.userPrompt,
      appliesTo: ["keyframes", "segments", "micro_shots"],
      userEditable: true,
    },
  ];
}

function normalizeAssetAnchor(anchor: VideoConsistencyAnchor): VideoConsistencyAnchor {
  return {
    ...anchor,
    id: anchor.id || `${anchor.type || "asset"}-${Math.abs(JSON.stringify(anchor).length)}`,
    mustStayConsistent: anchor.mustStayConsistent ?? true,
    needsReferenceImage: anchor.needsReferenceImage ?? true,
  };
}

function assetCategoryForAnchor(anchor: VideoConsistencyAnchor): VideoAssetCategory {
  if (anchor.type === "person") return "person";
  if (anchor.type === "location" || anchor.type === "space_layout") return "scene";
  if (anchor.type === "product" || anchor.type === "task_object" || anchor.type === "food" || anchor.type === "vehicle") return "product";
  if (anchor.type === "prop") return "prop";
  if (anchor.type === "brand_visual") return "brand_visual";
  if (anchor.type === "style" || anchor.type === "effect_state") return "style";
  return "custom";
}

function assetViewsForCategory(category: VideoAssetCategory): VideoAssetView[] {
  if (category === "person") return ["front", "side", "back"];
  if (category === "scene") return ["overview"];
  return ["single"];
}

function findBaseConsistencyReference(
  references: VideoConsistencyReference[],
  anchor: VideoConsistencyAnchor,
  category: VideoAssetCategory,
): VideoConsistencyReference | undefined {
  return references.find((reference) => reference.anchorId === anchor.id) ??
    references.find((reference) => assetCategoryForReferenceKind(reference.kind) === category) ??
    references[0];
}

function assetCategoryForReferenceKind(kind: VideoConsistencyReference["kind"]): VideoAssetCategory {
  if (kind === "character") return "person";
  if (kind === "scene" || kind === "space_layout") return "scene";
  if (kind === "product" || kind === "vehicle" || kind === "food") return "product";
  if (kind === "prop") return "prop";
  if (kind === "brand_visual") return "brand_visual";
  return "custom";
}

function assetReferenceKindForCategory(category: VideoAssetCategory): VideoConsistencyReference["kind"] {
  if (category === "person") return "character";
  if (category === "scene") return "scene";
  if (category === "product") return "product";
  if (category === "prop") return "prop";
  if (category === "brand_visual") return "brand_visual";
  return "custom";
}

function assetDisplayName(anchor: VideoConsistencyAnchor, category: VideoAssetCategory, view: VideoAssetView, lang: "zh" | "en"): string {
  const base = lang === "en"
    ? anchor.displayNameEn || anchor.displayNameZh || anchor.id || category
    : anchor.displayNameZh || anchor.displayNameEn || anchor.id || category;
  const viewName = assetViewName(view, lang);
  return `${base} ${viewName}`;
}

function assetViewName(view: VideoAssetView, lang: "zh" | "en"): string {
  if (lang === "en") {
    if (view === "front") return "front view";
    if (view === "side") return "side view";
    if (view === "back") return "back view";
    if (view === "face_closeup") return "face close-up";
    if (view === "overview") return "overview";
    return "reference";
  }
  if (view === "front") return "正面";
  if (view === "side") return "侧面";
  if (view === "back") return "背面";
  if (view === "face_closeup") return "脸部特写";
  if (view === "overview") return "总览";
  return "参考";
}

function buildAssetConsistencyReference(params: {
  item: VideoAssetLibraryItem;
  anchor: VideoConsistencyAnchor;
  baseReference?: VideoConsistencyReference;
  userPrompt: string;
  negativePrompt: string;
  negativePromptZh?: string;
  negativePromptEn?: string;
}): VideoConsistencyReference {
  const category = params.item.category;
  const view = params.item.view;
  const anchorPromptZh = params.anchor.imagePromptZh || params.anchor.descriptionZh || params.baseReference?.imagePromptZh || params.baseReference?.imagePrompt || params.userPrompt;
  const anchorPromptEn = params.anchor.imagePromptEn || params.anchor.descriptionEn || params.baseReference?.imagePromptEn || params.baseReference?.imagePrompt || params.userPrompt;
  const viewInstructionEn = assetViewPromptInstruction(category, view, "en");
  const viewInstructionZh = assetViewPromptInstruction(category, view, "zh");
  const commonRulesEn = "Clean asset-library reference image on a plain white or light neutral background, one asset only, no storyboard panels, no split screen, no labels, no captions, no UI, no watermark.";
  const commonRulesZh = "资产库参考图，白色或浅色纯净背景，只展示一个资产，不要分镜拼图、不要多宫格、不要标签文字、字幕、UI 或水印。";
  return {
    kind: assetReferenceKindForCategory(category),
    needed: true,
    keyframeNo: params.item.keyframeNo,
    anchorId: params.anchor.id,
    frameId: params.item.assetId,
    assetId: params.item.assetId,
    assetCategory: category,
    assetView: view,
    sourceView: params.item.sourceView,
    sourceArtifactId: params.item.sourceArtifactId,
    orientation: params.item.orientation,
    viewGenerationMode: params.item.viewGenerationMode,
    purpose: params.item.displayNameZh || params.item.displayNameEn || params.item.assetId,
    purposeZh: params.item.displayNameZh,
    purposeEn: params.item.displayNameEn,
    scene: params.baseReference?.scene || "clean asset library reference background",
    characterState: category === "person" ? `${params.item.displayNameEn || params.item.assetId}: ${viewInstructionEn}` : params.baseReference?.characterState || "",
    productState: category !== "person" ? `${params.item.displayNameEn || params.item.assetId}: ${viewInstructionEn}` : params.baseReference?.productState || "",
    imagePrompt: `${viewInstructionZh}\n${anchorPromptZh}\n${commonRulesZh}`,
    imagePromptZh: `${viewInstructionZh}\n${anchorPromptZh}\n${commonRulesZh}`,
    imagePromptEn: `${viewInstructionEn}\n${anchorPromptEn}\n${commonRulesEn}`,
    negativePrompt: params.baseReference?.negativePrompt || params.negativePrompt,
    negativePromptZh: params.baseReference?.negativePromptZh || params.negativePromptZh || params.negativePrompt,
    negativePromptEn: params.baseReference?.negativePromptEn || params.negativePromptEn || params.negativePrompt,
  };
}

function assetViewPromptInstruction(category: VideoAssetCategory, view: VideoAssetView, lang: "zh" | "en"): string {
  if (lang === "en") {
    if (category === "person" && view === "front") return "Full-body character reference, exact front view, standing neutral pose, face clearly visible, same outfit, hairstyle, body proportions, and accessories.";
    if (category === "person" && view === "side") return "Full-body character reference, exact left side profile view, standing neutral pose, same outfit, hairstyle silhouette, body proportions, and accessories.";
    if (category === "person" && view === "back") return "Full-body character reference, exact back view, standing neutral pose, same outfit back details, hairstyle from behind, body proportions, and accessories.";
    if (category === "scene") return "Reusable scene/location reference, wide establishing overview, fixed layout, lighting direction, color palette, main background structures, and spatial relationships.";
    return "Reusable single asset reference, centered view, clear shape, material, color, markings, scale cues, and distinctive details.";
  }
  if (category === "person" && view === "front") return "人物全身设定参考，严格正面视角，中性站姿，脸部清楚，同一套服装、发型、体型比例和配饰。";
  if (category === "person" && view === "side") return "人物全身设定参考，严格侧面视角，中性站姿，同一套服装、发型轮廓、体型比例和配饰。";
  if (category === "person" && view === "back") return "人物全身设定参考，严格背面视角，中性站姿，清楚展示服装背面细节、背后发型、体型比例和配饰。";
  if (category === "scene") return "可复用场景/空间参考图，广角总览，固定空间布局、光线方向、色彩氛围、主要背景结构和空间关系。";
  return "可复用单体资产参考图，居中展示，清楚呈现形状、材质、颜色、标记、比例和识别细节。";
}

function applyPlanDebugPatch(plan: Record<string, unknown>, patch: PlanDebugPatch): void {
  const dirtyIds: string[] = [];
  if (Array.isArray(patch.narrativeEvents)) {
    plan.narrativeEvents = patch.narrativeEvents;
    delete plan.narrative_events;
    dirtyIds.push("planning:narrative_events", "planning:timeline");
  }
  if (Array.isArray(patch.anchorStateTimeline)) {
    plan.anchorStateTimeline = patch.anchorStateTimeline;
    delete plan.anchor_state_timeline;
    dirtyIds.push("planning:anchor_state_timeline");
  }
  if (Array.isArray(patch.consistencyAnchors)) {
    const nextManifest = consistencyManifestRecordForMutation(plan);
    nextManifest.anchors = patch.consistencyAnchors;
    plan.consistencyManifest = nextManifest;
    delete plan.consistency_manifest;
    const planningManifest = isRecord(plan.planningManifest)
      ? plan.planningManifest
      : isRecord(plan.planning_manifest)
        ? plan.planning_manifest
        : undefined;
    if (isRecord(planningManifest)) {
      planningManifest.consistencyManifest = nextManifest;
      delete planningManifest.consistency_manifest;
      plan.planningManifest = planningManifest;
      delete plan.planning_manifest;
    }
    dirtyIds.push("planning:consistency_manifest", "anchors:hard_locks");
  }
  if (isRecord(patch.creativeStrategy)) {
    plan.creativeStrategy = patch.creativeStrategy;
    delete plan.creative_strategy;
    dirtyIds.push("planning:creative_strategy", "storyboard:brief", "planning:timeline", "planning:consistency_manifest");
  }
  if (Array.isArray(patch.storyBeats)) {
    plan.storyBeats = patch.storyBeats;
    delete plan.story_beats;
    dirtyIds.push("planning:story_beats", "storyboard:brief", "planning:timeline", "planning:consistency_manifest");
  }
  if (isRecord(patch.storyQualityReport)) {
    plan.storyQualityReport = patch.storyQualityReport;
    delete plan.story_quality_report;
  }
  if (isRecord(patch.shotGroupingPass)) {
    plan.shotGroupingPass = patch.shotGroupingPass;
    delete plan.shot_grouping_pass;
    dirtyIds.push("planning:shot_grouping_pass", "storyboard:brief", "planning:consistency_manifest");
  }
  if (isRecord(patch.audioBible)) {
    plan.audioBible = patch.audioBible;
    delete plan.audio_bible;
    dirtyIds.push("audio_bible");
  }
  if (dirtyIds.length) markPlanArtifactsDirty(plan, dirtyIds, "User edited story skeleton; asset library, boundary frames, micro-shots, video clips, and final composition must be regenerated before reuse.");
}

function consistencyManifestRecordForMutation(plan: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(plan.consistencyManifest)) return { ...plan.consistencyManifest };
  if (isRecord(plan.consistency_manifest)) return { ...plan.consistency_manifest };
  const planningManifest = isRecord(plan.planningManifest)
    ? plan.planningManifest
    : isRecord(plan.planning_manifest)
      ? plan.planning_manifest
      : undefined;
  if (isRecord(planningManifest?.consistencyManifest)) return { ...planningManifest.consistencyManifest };
  if (isRecord(planningManifest?.consistency_manifest)) return { ...planningManifest.consistency_manifest };
  return { anchors: [] };
}

export function markPlanArtifactsDirty(plan: Record<string, unknown>, artifactIds: string[], dirtyReason: string): void {
  const metadata = ensurePlanArtifactMetadata(plan);
  const roots = uniqueStrings(artifactIds);
  const dirtyIds = onePromptRolloutEnabled("ONE_PROMPT_ARTIFACT_GRAPH_V2") ? collectDependentArtifactIds(metadata, roots) : roots;
  const dirtySet = new Set(dirtyIds);
  const now = new Date().toISOString();
  for (const artifactId of dirtyIds) {
    const previous = metadata[artifactId] ?? defaultArtifactMetadata(artifactId);
    metadata[artifactId] = {
      ...previous,
      status: "dirty",
      dirtyReason,
      invalidatedByArtifactIds: uniqueStrings([...(previous.invalidatedByArtifactIds ?? []), ...roots]),
      retryFromStage: deriveRetryFromDependencyGraph(metadata, artifactId, dirtySet),
      updatedAt: now,
    };
  }
  plan.artifactMetadata = metadata;
  delete plan.artifact_metadata;
}

export function ensurePlanArtifactMetadata(plan: Record<string, unknown>): Record<string, ArtifactMetadata> {
  const existing = isRecord(plan.artifactMetadata)
    ? plan.artifactMetadata
    : isRecord(plan.artifact_metadata)
      ? plan.artifact_metadata
      : {};
  const metadata: Record<string, ArtifactMetadata> = {};
  for (const [artifactId, value] of Object.entries(existing)) {
    if (!isRecord(value)) continue;
    metadata[artifactId] = normalizeArtifactMetadataEntry(artifactId, value);
  }
  if (!onePromptRolloutEnabled("ONE_PROMPT_ARTIFACT_GRAPH_V2")) {
    plan.artifactMetadata = metadata;
    delete plan.artifact_metadata;
    return metadata;
  }
  for (const [artifactId, seed] of Object.entries(buildArtifactDependencySeed(plan))) {
    const previous = metadata[artifactId];
    metadata[artifactId] = {
      ...(previous ?? defaultArtifactMetadata(artifactId)),
      artifactId,
      artifactType: previous?.artifactType || artifactTypeForId(artifactId),
      producedByStage: previous?.producedByStage || producedByStageForId(artifactId),
      dependsOn: uniqueStrings([...(previous?.dependsOn ?? []), ...seed.dependsOn]),
      retryFromStage: previous?.retryFromStage ?? seed.retryFromStage ?? inferRetryFromArtifactId(artifactId),
      status: previous?.status ?? seed.status ?? "draft",
    };
  }
  plan.artifactMetadata = metadata;
  delete plan.artifact_metadata;
  return metadata;
}

function normalizeArtifactMetadataEntry(artifactId: string, value: Record<string, unknown>): ArtifactMetadata {
  const status = value.status === "draft" || value.status === "dirty" || value.status === "approved" || value.status === "generating" || value.status === "ready" || value.status === "failed"
    ? value.status
    : "draft";
  const retryFromStage = normalizeRetryFromStage(value.retryFromStage ?? value.retry_from_stage) ?? inferRetryFromArtifactId(artifactId);
  return {
    artifactId: typeof value.artifactId === "string" ? value.artifactId : typeof value.artifact_id === "string" ? value.artifact_id : artifactId,
    artifactType: typeof value.artifactType === "string" ? value.artifactType : typeof value.artifact_type === "string" ? value.artifact_type : artifactTypeForId(artifactId),
    producedByStage: typeof value.producedByStage === "string" ? value.producedByStage : typeof value.produced_by_stage === "string" ? value.produced_by_stage : producedByStageForId(artifactId),
    revision: Math.max(1, Number(value.revision) || 1),
    schemaVersion: typeof value.schemaVersion === "string" ? value.schemaVersion : typeof value.schema_version === "string" ? value.schema_version : "plan-json",
    plannerVersion: typeof value.plannerVersion === "string" ? value.plannerVersion : typeof value.planner_version === "string" ? value.planner_version : "unknown",
    promptVersion: typeof value.promptVersion === "string" ? value.promptVersion : typeof value.prompt_version === "string" ? value.prompt_version : "unknown",
    modelVersion: typeof value.modelVersion === "string" ? value.modelVersion : typeof value.model_version === "string" ? value.model_version : "unknown",
    inputHash: typeof value.inputHash === "string" ? value.inputHash : typeof value.input_hash === "string" ? value.input_hash : "",
    dependsOn: uniqueStrings(Array.isArray(value.dependsOn) ? value.dependsOn : Array.isArray(value.depends_on) ? value.depends_on : []),
    invalidatedByArtifactIds: uniqueStrings(Array.isArray(value.invalidatedByArtifactIds) ? value.invalidatedByArtifactIds : Array.isArray(value.invalidated_by_artifact_ids) ? value.invalidated_by_artifact_ids : []),
    parentRevisionIds: uniqueStrings(Array.isArray(value.parentRevisionIds) ? value.parentRevisionIds : Array.isArray(value.parent_revision_ids) ? value.parent_revision_ids : []),
    userAccepted: value.userAccepted === true || value.user_accepted === true,
    status,
    dirtyReason: typeof value.dirtyReason === "string" ? value.dirtyReason : typeof value.dirty_reason === "string" ? value.dirty_reason : undefined,
    retryFromStage,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : typeof value.updated_at === "string" ? value.updated_at : undefined,
  };
}

function defaultArtifactMetadata(artifactId: string): ArtifactMetadata {
  return {
    artifactId,
    artifactType: artifactTypeForId(artifactId),
    producedByStage: producedByStageForId(artifactId),
    revision: 1,
    schemaVersion: "plan-json",
    plannerVersion: "unknown",
    promptVersion: "unknown",
    modelVersion: "unknown",
    inputHash: "",
    dependsOn: [],
    status: "draft",
    retryFromStage: inferRetryFromArtifactId(artifactId),
  };
}

function collectDependentArtifactIds(metadata: Record<string, ArtifactMetadata>, artifactIds: string[]): string[] {
  const selected = new Set(uniqueStrings(artifactIds));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [candidateId, item] of Object.entries(metadata)) {
      if (selected.has(candidateId)) continue;
      if ((item.dependsOn ?? []).some((dependency) => selected.has(dependency))) {
        selected.add(candidateId);
        changed = true;
      }
    }
  }
  return [...selected];
}

function setPlanArtifactStatus(plan: Record<string, unknown>, artifactIds: string[], status: ArtifactMetadata["status"], options?: { dirtyReason?: string; retryFromStage?: ArtifactRetryFromStage; parentRevisionIds?: string[]; userAccepted?: boolean }): void {
  const metadata = ensurePlanArtifactMetadata(plan);
  const now = new Date().toISOString();
  for (const artifactId of uniqueStrings(artifactIds)) {
    const previous = metadata[artifactId] ?? defaultArtifactMetadata(artifactId);
    metadata[artifactId] = {
      ...previous,
      revision: Math.max(1, Number(previous.revision) || 1) + (options?.parentRevisionIds?.length ? 1 : 0),
      status,
      dirtyReason: status === "dirty" ? options?.dirtyReason ?? previous.dirtyReason : undefined,
      invalidatedByArtifactIds: status === "dirty" ? previous.invalidatedByArtifactIds : [],
      parentRevisionIds: uniqueStrings([...(previous.parentRevisionIds ?? []), ...(options?.parentRevisionIds ?? [])]),
      userAccepted: options?.userAccepted ?? (status === "approved" ? true : previous.userAccepted),
      retryFromStage: options?.retryFromStage ?? previous.retryFromStage ?? inferRetryFromArtifactId(artifactId),
      updatedAt: now,
    };
  }
  plan.artifactMetadata = metadata;
  delete plan.artifact_metadata;
}

async function updateProjectArtifactStatus(projectId: string, artifactIds: string[], status: ArtifactMetadata["status"], options?: { dirtyReason?: string; retryFromStage?: ArtifactRetryFromStage; parentRevisionIds?: string[]; userAccepted?: boolean }): Promise<void> {
  const project = await prisma.videoProject.findUnique({ where: { id: projectId } });
  if (!project?.planJson) return;
  const plan = cloneJsonRecord(project.planJson);
  setPlanArtifactStatus(plan, artifactIds, status, options);
  await prisma.videoProject.update({
    where: { id: projectId },
    data: { planJson: plan as Prisma.InputJsonValue },
  });
  await mirrorPlanArtifactsToTables(projectId, plan);
}

async function saveGenerationQualityReport(projectId: string, report: GenerationQualityReport): Promise<void> {
  const project = await prisma.videoProject.findUnique({ where: { id: projectId } });
  if (!project?.planJson) return;
  const plan = cloneJsonRecord(project.planJson);
  const existing = Array.isArray(plan.generationQualityReports)
    ? plan.generationQualityReports
    : Array.isArray(plan.generation_quality_reports)
      ? plan.generation_quality_reports
      : [];
  const reportJson = cleanInputJson(report as unknown as Record<string, unknown>);
  plan.generationQualityReports = [
    ...existing.filter((item) => {
      if (!isRecord(item)) return true;
      if (report.candidateId) return (item.candidateId ?? item.candidate_id) !== report.candidateId;
      return (item.assetId ?? item.asset_id) !== report.assetId || Boolean(item.candidateId ?? item.candidate_id);
    }),
    reportJson,
  ].slice(-160);
  delete plan.generation_quality_reports;
  const technicalFailure = isTechnicalQualityEvaluationFailure(report);
  setPlanArtifactStatus(plan, [report.assetId], technicalFailure ? "generating" : report.passed ? "ready" : "failed", {
    dirtyReason: report.passed || technicalFailure ? undefined : report.retryInstruction || report.artifactIssues.join("; "),
    retryFromStage: report.retryFromStage === "stage2b"
      ? "stage2b"
      : report.retryFromStage === "stage3"
        ? "stage3"
        : report.retryFromStage === "manual"
          ? "manual"
          : report.endFrameDecision === "return_stage_2b"
            ? "stage2b"
            : inferRetryFromArtifactId(report.assetId),
  });
  await prisma.videoProject.update({
    where: { id: projectId },
    data: { planJson: plan as Prisma.InputJsonValue },
  });
  await mirrorPlanArtifactsToTables(projectId, plan);
  await logOnePromptVideo("generation_quality.report", {
    projectId,
    assetId: report.assetId,
    passed: report.passed,
    identityScore: report.identityScore,
    layoutScore: report.layoutScore,
    promptAlignmentScore: report.promptAlignmentScore,
    continuityScore: report.continuityScore,
    singleTakeScore: report.singleTakeScore,
    artifactIssues: report.artifactIssues,
    correctionActions: report.correctionActions,
    contractConflicts: report.contractConflicts,
    retryInstruction: report.retryInstruction,
    endFrameDecision: report.endFrameDecision,
    endFrameSimilarityScore: report.endFrameSimilarityScore,
    continuityRetryCount: report.continuityRetryCount,
    candidateId: report.candidateId,
    candidateNo: report.candidateNo,
    contentBased: report.contentBased,
    retryFromStage: report.retryFromStage,
    userAccepted: report.userAccepted,
    evaluationModel: report.evaluationModel,
    evaluationDurationMs: report.evaluationDurationMs,
  }, report.passed ? "info" : "warn");
}

function deriveRetryFromDependencyGraph(metadata: Record<string, ArtifactMetadata>, artifactId: string, dirtySet: Set<string>): ArtifactRetryFromStage {
  const order: ArtifactRetryFromStage[] = ["stage1", "stage2a", "stage2b", "stage3", "reference_selector", "compiler", "generation", "composition", "manual"];
  const candidates = [inferRetryFromArtifactId(artifactId)];
  const visited = new Set<string>();
  const visit = (currentId: string) => {
    if (visited.has(currentId)) return;
    visited.add(currentId);
    for (const dependencyId of metadata[currentId]?.dependsOn ?? []) {
      if (!dirtySet.has(dependencyId)) continue;
      candidates.push(metadata[dependencyId]?.retryFromStage ?? inferRetryFromArtifactId(dependencyId));
      visit(dependencyId);
    }
  };
  visit(artifactId);
  return candidates.sort((left, right) => order.indexOf(left) - order.indexOf(right))[0] ?? inferRetryFromArtifactId(artifactId);
}

export function buildArtifactDependencySeed(plan: Record<string, unknown>): Record<string, { dependsOn: string[]; retryFromStage?: ArtifactRetryFromStage; status?: ArtifactMetadata["status"] }> {
  const seed: Record<string, { dependsOn: string[]; retryFromStage?: ArtifactRetryFromStage; status?: ArtifactMetadata["status"] }> = {};
  const add = (artifactId: string, dependsOn: string[] = [], retryFromStage?: ArtifactRetryFromStage, status?: ArtifactMetadata["status"]) => {
    if (!artifactId) return;
    const previous = seed[artifactId];
    seed[artifactId] = {
      dependsOn: uniqueStrings([...(previous?.dependsOn ?? []), ...dependsOn]),
      retryFromStage: previous?.retryFromStage ?? retryFromStage ?? inferRetryFromArtifactId(artifactId),
      status: previous?.status ?? status,
    };
  };

  add("planning:narrative_events", [], "stage1");
  add("planning:creative_strategy", [], "stage1");
  add("planning:story_beats", ["planning:creative_strategy"], "stage2a");
  add("planning:shot_grouping_pass", ["planning:story_beats"], "stage2a");
  add("planning:timeline", ["planning:narrative_events"], "stage2a");
  add("planning:consistency_manifest", [], "stage1");
  add("planning:anchor_state_timeline", ["planning:narrative_events", "planning:consistency_manifest", "planning:story_beats"], "stage1");
  add("storyboard:brief", ["planning:timeline", "planning:narrative_events", "planning:creative_strategy", "planning:story_beats", "planning:shot_grouping_pass"], "stage2a");
  add("camera_graph", ["storyboard:brief"], "stage2a");
  add("prompt_compiler", [], "compiler", "ready");
  add("audio_bible", ["planning:creative_strategy", "storyboard:brief"], "stage1");
  add("audio:bgm", ["audio_bible"], "generation");
  add("audio:tts", ["audio_bible", "planning:timeline"], "generation");
  add("audio:sfx", ["audio_bible", "storyboard:brief"], "generation");
  add("audio:final_mix", ["audio:bgm", "audio:tts", "audio:sfx"], "composition");

  const graph = readCameraGraph(plan.cameraGraph ?? plan.camera_graph);
  for (const camera of graph.cameras) add(`camera:${camera.cameraId}`, ["camera_graph", "storyboard:brief"], "stage2a");

  for (const transition of transitionReferenceArtifactsFromPlan(plan as unknown as Prisma.JsonValue)) {
    add(transition.id, [`camera:${transition.toCameraId}`, transition.parentKeyframeNo !== undefined ? `keyframe:${transition.parentKeyframeNo}:image` : "storyboard:brief"], "generation", transition.locked ? "approved" : transition.status === "failed" ? "failed" : transition.status === "video_running" || transition.status === "evaluating_frames" ? "generating" : "draft");
  }
  for (const bridge of generatedBridgeArtifactsFromPlan(plan as unknown as Prisma.JsonValue)) {
    add(bridge.id, [`segment:${bridge.fromSegmentNo}:video`, `segment:${bridge.toSegmentNo}:video`, "final_transition_plan"], "generation", bridge.locked ? "approved" : bridge.status === "failed" ? "failed" : bridge.status === "running" ? "generating" : "draft");
  }

  for (const anchor of consistencyAnchorsFromPlan(plan)) {
    add(`anchor:${anchor.id}`, ["planning:consistency_manifest"], "stage1");
  }

  const consistencyReferences = consistencyReferencesFromPlan(plan);
  for (const reference of consistencyReferences) {
    const referenceId = `consistency_reference:${reference.keyframeNo}`;
    const sourceDependency = reference.sourceArtifactId
      ? consistencyReferences.find((candidate) => candidate.assetId === reference.sourceArtifactId)
      : undefined;
    add(referenceId, [
      "planning:consistency_manifest",
      ...(sourceDependency ? [`consistency_reference:${sourceDependency.keyframeNo}:image`] : []),
    ], "generation");
    add(`${referenceId}:reference_selection`, [referenceId], "reference_selector");
    add(`${referenceId}:prompt`, [referenceId, `${referenceId}:reference_selection`, "prompt_compiler"], "compiler");
    add(`${referenceId}:image`, [`${referenceId}:prompt`], "generation");
  }

  const keyframes = keyframesFromPlan(plan);
  for (const keyframe of keyframes) {
    const keyframeId = keyframe.keyframeNo < 0 ? `consistency_reference:${keyframe.keyframeNo}` : `keyframe:${keyframe.keyframeNo}`;
    const anchorDeps = keyframe.anchorIds.map((anchorId) => `anchor:${anchorId}`);
    add(keyframeId, ["planning:timeline", "planning:anchor_state_timeline", ...anchorDeps], "generation");
    const identityImageDeps = consistencyReferences
      .filter((reference) => keyframe.anchorIds.includes(reference.assetId ?? "") || keyframe.anchorIds.includes(reference.sourceArtifactId ?? ""))
      .map((reference) => `consistency_reference:${reference.keyframeNo}:image`);
    const transitionDeps = transitionReferenceArtifactsFromPlan(plan as unknown as Prisma.JsonValue)
      .filter((transition) => segmentsFromPlan(plan).find((segment) => segment.segmentNo === transition.toSegmentNo)?.startKeyframeNo === keyframe.keyframeNo)
      .map((transition) => transition.id);
    add(`${keyframeId}:reference_selection`, [keyframeId, "camera_graph", ...anchorDeps, ...identityImageDeps, ...transitionDeps], "reference_selector");
    add(`${keyframeId}:prompt`, [keyframeId, `${keyframeId}:reference_selection`, "prompt_compiler"], "compiler");
    add(`${keyframeId}:image`, [`${keyframeId}:prompt`], "generation");
  }

  const segments = segmentsFromPlan(plan);
  const renderDescriptionIds: string[] = [];
  for (const segment of segments) {
    const segmentId = `segment:${segment.segmentNo}`;
    const startKeyframeId = segment.startKeyframeNo !== undefined ? `keyframe:${segment.startKeyframeNo}:image` : "";
    const endKeyframeId = segment.endKeyframeNo !== undefined ? `keyframe:${segment.endKeyframeNo}:image` : "";
    const anchorDeps = segment.anchorIds.map((anchorId) => `anchor:${anchorId}`);
    add(segmentId, ["storyboard:brief", "planning:anchor_state_timeline", "camera_graph", ...anchorDeps], "stage2b");
    const renderDescriptionId = `${segmentId}:render_description`;
    renderDescriptionIds.push(renderDescriptionId);
    add(renderDescriptionId, ["storyboard:brief", segmentId], "stage2b");
    add(`${segmentId}:subtitle`, [segmentId], "stage3");
    add(`${segmentId}:micro_shots`, [segmentId, ...anchorDeps], "stage2b");

    for (const microShot of segment.microShots) {
      const microShotId = `${segmentId}:micro_shot:${microShot.microShotNo}`;
      const microAnchorDeps = microShot.anchorIds.length ? microShot.anchorIds.map((anchorId) => `anchor:${anchorId}`) : anchorDeps;
      add(microShotId, [`${segmentId}:micro_shots`, ...microAnchorDeps], "stage2b");
      add(`${microShotId}:reference_selection`, [microShotId, "camera_graph", ...microAnchorDeps], "reference_selector");
      add(`${microShotId}:prompt`, [microShotId, `${microShotId}:reference_selection`, "prompt_compiler"], "compiler");
      add(`${microShotId}:image`, [`${microShotId}:prompt`], "generation");
    }

    add(`${segmentId}:reference_selection`, [segmentId, "camera_graph", ...anchorDeps], "reference_selector");
    add(`${segmentId}:prompt`, [
      renderDescriptionId,
      `${segmentId}:micro_shots`,
      `${segmentId}:subtitle`,
      `${segmentId}:reference_selection`,
      "prompt_compiler",
      ...(startKeyframeId ? [startKeyframeId] : []),
      ...(endKeyframeId ? [endKeyframeId] : []),
      ...segment.microShots.map((microShot) => `${segmentId}:micro_shot:${microShot.microShotNo}:image`),
    ], "compiler");
    add(`${segmentId}:video`, [`${segmentId}:prompt`, ...(startKeyframeId ? [startKeyframeId] : [])], "generation");
  }

  add("final_transition_plan", ["storyboard:brief", "camera_graph", ...renderDescriptionIds], "stage2a");

  if (segments.length) {
    add("final_video", [
      "final_transition_plan",
      "audio:final_mix",
      ...segments.map((segment) => `segment:${segment.segmentNo}:video`),
    ], "composition");
  }

  return seed;
}

function consistencyAnchorsFromPlan(plan: Record<string, unknown>): Array<{ id: string; referenceStrength?: string; needsReferenceImage?: boolean; type?: string }> {
  const directManifest = isRecord(plan.consistencyManifest)
    ? plan.consistencyManifest
    : isRecord(plan.consistency_manifest)
      ? plan.consistency_manifest
      : undefined;
  const planningManifest = isRecord(plan.planningManifest)
    ? plan.planningManifest
    : isRecord(plan.planning_manifest)
      ? plan.planning_manifest
      : undefined;
  const manifest = directManifest ??
    (isRecord(planningManifest?.consistencyManifest)
      ? planningManifest.consistencyManifest
      : isRecord(planningManifest?.consistency_manifest)
        ? planningManifest.consistency_manifest
        : undefined);
  const anchors = Array.isArray(manifest?.anchors) ? manifest.anchors : [];
  return anchors.flatMap((anchor, index) => {
    if (!isRecord(anchor)) return [];
    const id = typeof anchor.id === "string" && anchor.id.trim() ? anchor.id.trim() : `anchor_${index + 1}`;
    return [{
      id,
      referenceStrength: readPlanShotString(anchor, ["referenceStrength", "reference_strength"]),
      needsReferenceImage: typeof anchor.needsReferenceImage === "boolean"
        ? anchor.needsReferenceImage
        : typeof anchor.needs_reference_image === "boolean"
          ? anchor.needs_reference_image
          : undefined,
      type: readPlanShotString(anchor, ["type"]),
    }];
  });
}

function latestGenerationQualityReport(planJson: Prisma.JsonValue | null, assetId: string): GenerationQualityReport | undefined {
  const plan = planRecord(planJson);
  const reports = Array.isArray(plan.generationQualityReports)
    ? plan.generationQualityReports
    : Array.isArray(plan.generation_quality_reports)
      ? plan.generation_quality_reports
      : [];
  const value = [...reports].reverse().find((item) => isRecord(item) && (item.assetId ?? item.asset_id) === assetId);
  return value && isRecord(value) ? value as unknown as GenerationQualityReport : undefined;
}

function generationQualityReportForActiveMedia(
  planJson: Prisma.JsonValue | null,
  assetId: string,
  mediaUrl: string,
): GenerationQualityReport | undefined {
  const plan = planRecord(planJson);
  const reports = Array.isArray(plan.generationQualityReports)
    ? plan.generationQualityReports
    : Array.isArray(plan.generation_quality_reports)
      ? plan.generation_quality_reports
      : [];
  const value = [...reports].reverse().find((item) =>
    isRecord(item)
    && (item.assetId ?? item.asset_id) === assetId
    && (item.mediaUrl ?? item.media_url) === mediaUrl
  );
  return value && isRecord(value) ? value as unknown as GenerationQualityReport : undefined;
}

function maxEndFrameContinuityRetries(): number {
  const value = Number(process.env.ONE_PROMPT_END_FRAME_MAX_RETRIES);
  return Number.isFinite(value) ? Math.max(0, Math.min(4, Math.round(value))) : 2;
}

async function markProjectArtifactsDirty(projectId: string, artifactIds: string[], dirtyReason: string): Promise<void> {
  const project = await prisma.videoProject.findUnique({ where: { id: projectId } });
  if (!project?.planJson) return;
  const plan = cloneJsonRecord(project.planJson);
  markPlanArtifactsDirty(plan, artifactIds, dirtyReason);
  await prisma.videoProject.update({
    where: { id: projectId },
    data: { planJson: plan as Prisma.InputJsonValue },
  });
}

function hardReferenceAnchorIds(planJson: Prisma.JsonValue | null): Set<string> {
  const plan = isRecord(planJson) ? planJson : {};
  return new Set(
    consistencyAnchorsFromPlan(plan)
      .filter((anchor) => anchor.referenceStrength === "hard" && anchor.needsReferenceImage !== false)
      .map((anchor) => anchor.id),
  );
}

function consistencyReferencesFromPlan(plan: Record<string, unknown>): Array<{ keyframeNo: number; assetId?: string; sourceArtifactId?: string; assetView?: string; assetCategory?: string }> {
  const references = Array.isArray(plan.consistencyReferences)
    ? plan.consistencyReferences
    : Array.isArray(plan.consistency_references)
      ? plan.consistency_references
      : [];
  return references.flatMap((reference) => {
    if (!isRecord(reference)) return [];
    const keyframeNo = Number(reference.keyframeNo ?? reference.keyframe_no);
    return Number.isInteger(keyframeNo) ? [{
      keyframeNo,
      assetId: readPlanShotString(reference, ["assetId", "asset_id"]),
      sourceArtifactId: readPlanShotString(reference, ["sourceArtifactId", "source_artifact_id"]),
      assetView: readPlanShotString(reference, ["assetView", "asset_view", "orientation"]),
      assetCategory: readPlanShotString(reference, ["assetCategory", "asset_category", "category"]),
    }] : [];
  });
}

function keyframesFromPlan(plan: Record<string, unknown>): Array<{ keyframeNo: number; anchorIds: string[] }> {
  const keyframes = Array.isArray(plan.keyframes) ? plan.keyframes : [];
  return keyframes.flatMap((keyframe) => {
    if (!isRecord(keyframe)) return [];
    const keyframeNo = Number(keyframe.keyframeNo ?? keyframe.keyframe_no);
    if (!Number.isInteger(keyframeNo)) return [];
    return [{
      keyframeNo,
      anchorIds: readPlanStringArray(keyframe, ["usesConsistencyAnchors", "uses_consistency_anchors", "requiredAnchorIds", "required_anchor_ids"]),
    }];
  });
}

function segmentsFromPlan(plan: Record<string, unknown>): Array<{ segmentNo: number; startKeyframeNo?: number; endKeyframeNo?: number; anchorIds: string[]; microShots: Array<{ microShotNo: number; anchorIds: string[] }> }> {
  const segments = Array.isArray(plan.segments) ? plan.segments : [];
  return segments.flatMap((segment) => {
    if (!isRecord(segment)) return [];
    const segmentNo = Number(segment.segmentNo ?? segment.segment_no ?? segment.shotNo ?? segment.shot_no);
    if (!Number.isInteger(segmentNo) || segmentNo <= 0) return [];
    const startKeyframeNo = Number(segment.startKeyframeNo ?? segment.start_keyframe_no);
    const endKeyframeNo = Number(segment.endKeyframeNo ?? segment.end_keyframe_no);
    const anchorIds = readPlanStringArray(segment, ["usesConsistencyAnchors", "uses_consistency_anchors", "requiredAnchorIds", "required_anchor_ids"]);
    const microShots = readPlanMicroShots(segment).map((microShot) => ({
      microShotNo: microShot.microShotNo,
      anchorIds: microShot.usesConsistencyAnchors ?? [],
    }));
    return [{
      segmentNo,
      startKeyframeNo: Number.isInteger(startKeyframeNo) ? startKeyframeNo : undefined,
      endKeyframeNo: Number.isInteger(endKeyframeNo) ? endKeyframeNo : undefined,
      anchorIds,
      microShots,
    }];
  });
}

function inferRetryFromArtifactId(artifactId: string): ArtifactRetryFromStage {
  if (artifactId === "audio_bible") return "stage1";
  if (artifactId.startsWith("audio:")) return artifactId === "audio:final_mix" ? "composition" : "generation";
  if (artifactId.startsWith("planning:narrative_events") || artifactId.startsWith("planning:consistency_manifest") || artifactId.startsWith("planning:anchor_state_timeline") || artifactId.startsWith("anchor:")) return "stage1";
  if (artifactId.startsWith("planning:timeline") || artifactId.startsWith("storyboard:brief") || artifactId === "camera_graph" || artifactId.startsWith("camera:") || artifactId === "final_transition_plan") return "stage2a";
  if (artifactId.includes(":micro_shots") || artifactId.includes(":render_description") || /^segment:\d+$/.test(artifactId)) return "stage2b";
  if (artifactId.includes(":reference_selection")) return "reference_selector";
  if (artifactId.includes(":prompt") || artifactId === "prompt_compiler" || artifactId.includes(":subtitle")) return "compiler";
  if (artifactId === "final_video") return "composition";
  if (artifactId.includes(":image") || artifactId.includes(":video") || artifactId.startsWith("keyframe:") || artifactId.startsWith("consistency_reference:")) return "generation";
  return "manual";
}

function artifactTypeForId(artifactId: string): string {
  if (artifactId === "final_video") return "final_compose";
  if (artifactId === "audio_bible") return "audio_bible";
  if (artifactId.startsWith("audio:")) return artifactId.slice("audio:".length);
  if (artifactId.startsWith("camera:")) return "camera_node";
  if (artifactId.startsWith("transition_reference:")) return "transition_reference";
  if (artifactId.startsWith("generated_bridge:")) return "generated_bridge";
  if (artifactId.includes(":reference_selection")) return "reference_selection";
  if (artifactId.includes(":render_description")) return "segment_render_description";
  if (artifactId.includes(":prompt")) return "compiled_prompt";
  if (artifactId.endsWith(":image")) return "image";
  if (artifactId.endsWith(":video")) return "video";
  if (artifactId.startsWith("planning:") || artifactId === "storyboard:brief" || artifactId === "camera_graph" || artifactId === "final_transition_plan") return "planning_contract";
  if (artifactId.startsWith("anchor:")) return "consistency_anchor";
  return artifactId.split(":").at(-1) || "artifact";
}

function producedByStageForId(artifactId: string): string {
  const retry = inferRetryFromArtifactId(artifactId);
  if (artifactId === "audio_bible") return "stage1";
  if (artifactId.startsWith("audio:")) return artifactId === "audio:final_mix" ? "composition" : "audio_generation";
  return retry;
}

function referenceSelectionArtifactId(targetArtifactId: string): string {
  return `${targetArtifactId}:reference_selection`;
}

function promptArtifactIdForTarget(targetArtifactId: string): string {
  return `${targetArtifactId}:prompt`;
}

function keyframeTargetArtifactId(keyframeNo: number): string {
  return keyframeNo < 0 ? `consistency_reference:${keyframeNo}` : `keyframe:${keyframeNo}`;
}

function imageArtifactIdForKeyframeNo(keyframeNo: number): string {
  return `${keyframeTargetArtifactId(keyframeNo)}:image`;
}

function imageArtifactIdForMicroShot(segmentNo: number, microShotNo: number): string {
  return `segment:${segmentNo}:micro_shot:${microShotNo}:image`;
}

function videoArtifactIdForSegmentNo(segmentNo: number): string {
  return `segment:${segmentNo}:video`;
}

function approvedMicroShotImageArtifactIds(project: VideoProjectWithShots): string[] {
  const planSegments = readPlanSegmentMap(project.planJson);
  const selectedArtifactIds = new Set(
    project.generationCandidates
      .filter((candidate) => candidate.kind === "micro_shot_image" && candidate.selected && Boolean(candidate.mediaUrl))
      .map((candidate) => candidate.artifactId),
  );
  return project.segments.flatMap((segment) => {
    const microShots = readPlanMicroShots(planSegments.get(segment.segmentNo));
    return microShots
      .filter((microShot) =>
        Boolean(microShot.imageUrl)
        || selectedArtifactIds.has(imageArtifactIdForMicroShot(segment.segmentNo, microShot.microShotNo))
      )
      .map((microShot) => imageArtifactIdForMicroShot(segment.segmentNo, microShot.microShotNo));
  });
}

function selectedReferenceUrlsForPromptTarget(planJson: Prisma.JsonValue | null, targetArtifactId: string): string[] {
  const plan = isRecord(planJson) ? planJson : {};
  const debugArtifacts = isRecord(plan.promptDebugArtifacts)
    ? plan.promptDebugArtifacts
    : isRecord(plan.prompt_debug_artifacts)
      ? plan.prompt_debug_artifacts
      : {};
  const artifact = isRecord(debugArtifacts[targetArtifactId]) ? debugArtifacts[targetArtifactId] : undefined;
  return readPlanStringArray(artifact, ["selectedReferenceUrls", "selected_reference_urls"]);
}

function normalizeRetryFromStage(value: unknown): ArtifactRetryFromStage | undefined {
  if (
    value === "stage1" ||
    value === "stage2a" ||
    value === "stage2b" ||
    value === "stage3" ||
    value === "reference_selector" ||
    value === "compiler" ||
    value === "generation" ||
    value === "composition" ||
    value === "manual"
  ) {
    return value;
  }
  return undefined;
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim()))];
}

function markPlanArtifactsDirtyForShotUpdate(
  plan: Record<string, unknown>,
  project: VideoProjectWithShots,
  localizedUpdate?: {
    shotId: string;
    locale?: "zh" | "en";
    microShots?: UpdateShotInput["microShots"];
    purposeUpdated?: boolean;
    imagePromptUpdated?: boolean;
    negativePromptUpdated?: boolean;
  },
): void {
  if (!localizedUpdate?.shotId) return;
  if (!localizedUpdate.purposeUpdated && !localizedUpdate.imagePromptUpdated && !localizedUpdate.negativePromptUpdated && !localizedUpdate.microShots) return;
  const artifactIds: string[] = [];
  const segment = project.segments.find((item) => item.id === localizedUpdate.shotId);
  const keyframe = project.keyframes.find((item) => item.id === localizedUpdate.shotId);
  const legacyShot = project.shots.find((item) => item.id === localizedUpdate.shotId);

  if (segment) {
    artifactIds.push(
      `segment:${segment.segmentNo}`,
      `segment:${segment.segmentNo}:prompt`,
      `segment:${segment.segmentNo}:subtitle`,
    );
    if (localizedUpdate.imagePromptUpdated) artifactIds.push(`keyframe:${segment.startKeyframeNo}:prompt`);
    if (localizedUpdate.microShots) artifactIds.push(`segment:${segment.segmentNo}:micro_shots`);
  } else if (keyframe) {
    artifactIds.push(keyframe.keyframeNo < 0 ? `consistency_reference:${keyframe.keyframeNo}` : `keyframe:${keyframe.keyframeNo}`);
    if (keyframe.keyframeNo < 0) artifactIds.push("anchors:hard_locks", imageArtifactIdForKeyframeNo(keyframe.keyframeNo));
    else artifactIds.push(`keyframe:${keyframe.keyframeNo}:prompt`);
  } else if (legacyShot) {
    artifactIds.push(`shot:${legacyShot.shotNo}`, `shot:${legacyShot.shotNo}:prompt`);
    if (localizedUpdate.microShots) artifactIds.push(`shot:${legacyShot.shotNo}:micro_shots`);
  }

  if (artifactIds.length) {
    markPlanArtifactsDirty(
      plan,
      artifactIds,
      "User edited this asset in review UI; regenerate only affected downstream artifacts before reuse.",
    );
  }
}

function readPlanShotString(shot: Record<string, unknown> | undefined, keys: string[]): string {
  if (!shot) return "";
  for (const key of keys) {
    const value = shot[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function titleFromPrompt(text: string, fallback: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return fallback;
  const purposeMatch = cleaned.match(/\bPurpose:\s*([^.;]+)/i);
  const source = purposeMatch?.[1]?.trim() || cleaned.split(/[.;]/)[0]?.trim() || fallback;
  return source.length > 96 ? `${source.slice(0, 93)}...` : source;
}

function toChineseNegativePrompt(prompt: string): string {
  return prompt;
}
function readPlanStringArray(shot: Record<string, unknown> | undefined, keys: string[]): string[] {
  if (!shot) return [];
  for (const key of keys) {
    const value = shot[key];
    if (!Array.isArray(value)) continue;
    return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim());
  }
  return [];
}

function readPlanTimedPrompts(shot: Record<string, unknown> | undefined): Array<{ timeSeconds: number; startSeconds?: number; endSeconds?: number; prompt: string; promptZh?: string; promptEn?: string }> {
  const value = shot?.timedPrompts ?? shot?.timed_prompts;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const startSecondsRaw = Number(item.startSeconds ?? item.start_seconds);
    const endSecondsRaw = Number(item.endSeconds ?? item.end_seconds);
    const timeSeconds = Number(item.timeSeconds ?? item.time_seconds ?? startSecondsRaw);
    const promptZh = readPlanShotString(item, ["promptZh", "prompt_zh"]);
    const promptEn = readPlanShotString(item, ["promptEn", "prompt_en"]);
    const prompt = readPlanShotString(item, ["prompt"]) || promptZh || promptEn;
    if (!Number.isFinite(timeSeconds) || !prompt) return [];
    return [{
      timeSeconds,
      startSeconds: Number.isFinite(startSecondsRaw) ? startSecondsRaw : undefined,
      endSeconds: Number.isFinite(endSecondsRaw) ? endSecondsRaw : undefined,
      prompt,
      promptZh,
      promptEn,
    }];
  });
}

function readPlanOutputMode(shot: Record<string, unknown> | undefined): "text" | "image" | "mixed" | undefined {
  const value = readPlanShotString(shot, ["outputMode", "output_mode"]);
  return value === "text" || value === "image" || value === "mixed" ? value : undefined;
}

function readPlanBoundaryMode(shot: Record<string, unknown> | undefined): "continuous" | "hard_cut" | "dissolve" | "match_cut" | undefined {
  const value = readPlanShotString(shot, ["boundaryMode", "boundary_mode"]);
  return value === "continuous" || value === "hard_cut" || value === "dissolve" || value === "match_cut" ? value : undefined;
}

function consistencyReferenceKindForPlan(
  reference: Record<string, unknown> | undefined,
  keyframeNo: number,
): VideoConsistencyReference["kind"] {
  const value = readPlanShotString(reference, ["kind"]);
  if (
    value === "character" ||
    value === "scene" ||
    value === "product" ||
    value === "brand_visual" ||
    value === "prop" ||
    value === "vehicle" ||
    value === "food" ||
    value === "space_layout" ||
    value === "custom"
  ) return value;
  if (keyframeNo === CHARACTER_CONSISTENCY_KEYFRAME_NO) return "character";
  if (keyframeNo === SCENE_CONSISTENCY_KEYFRAME_NO) return "scene";
  return "custom";
}

function readPlanAudioPlan(shot: Record<string, unknown> | undefined): {
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
} | undefined {
  const raw = shot?.audioPlan ?? shot?.audio_plan;
  if (!isRecord(raw)) return undefined;
  const modeRaw = raw.mode;
  const mode = modeRaw === "voiceover" || modeRaw === "dialogue" || modeRaw === "mixed" || modeRaw === "silent" || modeRaw === "ambient"
    ? modeRaw
    : "ambient";
  const linesZh = readPlanStringArray(raw, ["linesZh", "lines_zh"]);
  const linesEn = readPlanStringArray(raw, ["linesEn", "lines_en"]);
  const lines = readPlanStringArray(raw, ["lines"]);
  return {
    mode,
    needsVoiceover: typeof raw.needsVoiceover === "boolean" ? raw.needsVoiceover : typeof raw.needs_voiceover === "boolean" ? raw.needs_voiceover : mode === "voiceover" || mode === "mixed",
    needsDialogue: typeof raw.needsDialogue === "boolean" ? raw.needsDialogue : typeof raw.needs_dialogue === "boolean" ? raw.needs_dialogue : mode === "dialogue" || mode === "mixed",
    language: readPlanShotString(raw, ["language"]),
    speaker: readPlanShotString(raw, ["speaker"]),
    voiceStyle: readPlanShotString(raw, ["voiceStyle", "voice_style"]),
    lines,
    linesZh,
    linesEn,
    rationale: readPlanShotString(raw, ["rationale", "reason"]),
  };
}

function readPlanMicroShots(shot: Record<string, unknown> | undefined): VideoMicroShot[] {
  const value = shot?.microShots ?? shot?.micro_shots ?? shot?.internalStoryboard ?? shot?.internal_storyboard ?? shot?.subShots ?? shot?.sub_shots;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const localTimeSeconds = Number(item.localTimeSeconds ?? item.local_time_seconds ?? item.startSeconds ?? item.start_seconds ?? item.offset_seconds ?? 0);
    const endSeconds = Number(item.endSeconds ?? item.end_seconds);
    const absoluteTimeSeconds = Number(item.absoluteTimeSeconds ?? item.absolute_time_seconds ?? localTimeSeconds);
    const purpose = readPlanShotString(item, ["purpose"]);
    const scene = readPlanShotString(item, ["scene", "scene_limit"]);
    const sceneZh = readPlanShotString(item, ["sceneZh", "scene_zh"]);
    const sceneEn = readPlanShotString(item, ["sceneEn", "scene_en"]);
    const action = readPlanShotString(item, ["action", "action_limit"]);
    const actionZh = readPlanShotString(item, ["actionZh", "action_zh"]);
    const actionEn = readPlanShotString(item, ["actionEn", "action_en"]);
    const camera = readPlanShotString(item, ["camera", "camera_limit"]);
    const cameraZh = readPlanShotString(item, ["cameraZh", "camera_zh"]);
    const cameraEn = readPlanShotString(item, ["cameraEn", "camera_en"]);
    const imagePromptZh = readPlanShotString(item, ["imagePromptZh", "image_prompt_zh"]);
    const imagePromptEn = readPlanShotString(item, ["imagePromptEn", "image_prompt_en"]);
    const imagePrompt = readPlanShotString(item, ["imagePrompt", "image_prompt"]) || imagePromptZh || imagePromptEn;
    const imageUrl = readPlanShotString(item, ["imageUrl", "image_url"]);
    const imageTaskId = readPlanShotString(item, ["imageTaskId", "image_task_id"]);
    const errorMessage = readPlanShotString(item, ["errorMessage", "error_message"]);
    const imageStatusValue = readPlanShotString(item, ["imageStatus", "image_status", "status"]);
    const usesConsistencyAnchors = readPlanStringArray(item, ["usesConsistencyAnchors", "uses_consistency_anchors"]);
    const imageStatus = imageStatusValue === "idle" || imageStatusValue === "pending" || imageStatusValue === "running" || imageStatusValue === "ready" || imageStatusValue === "failed"
      ? imageStatusValue
      : imageUrl
        ? "ready"
        : imageTaskId
          ? "running"
          : undefined;
    const promptZh = readPlanShotString(item, ["promptZh", "prompt_zh"]);
    const promptEn = readPlanShotString(item, ["promptEn", "prompt_en"]);
    const prompt = readPlanShotString(item, ["prompt"]) || promptZh || promptEn || action || purpose;
    if (!prompt && !purpose && !scene && !action && !imagePrompt && !imageUrl) return [];
    const referenceTypeValue = item.referenceType ?? item.reference_type;
    const referenceType = referenceTypeValue === "text" || referenceTypeValue === "image_prompt" || referenceTypeValue === "mixed"
      ? referenceTypeValue
      : referenceTypeValue === "image"
        ? "image_prompt"
        : undefined;
    return [{
      microShotNo: Number(item.microShotNo ?? item.micro_shot_no ?? index + 1),
      localTimeSeconds: Number.isFinite(localTimeSeconds) ? localTimeSeconds : 0,
      endSeconds: Number.isFinite(endSeconds) ? endSeconds : undefined,
      absoluteTimeSeconds: Number.isFinite(absoluteTimeSeconds) ? absoluteTimeSeconds : 0,
      purpose,
      scene,
      sceneZh,
      sceneEn,
      action,
      actionZh,
      actionEn,
      camera,
      cameraZh,
      cameraEn,
      referenceType,
      imagePrompt,
      imagePromptZh,
      imagePromptEn,
      imageUrl,
      imageTaskId,
      imageStatus,
      errorMessage,
      usesConsistencyAnchors,
      prompt,
      promptZh,
      promptEn,
    }];
  });
}

export async function listVideoProjects(userId: string): Promise<VideoProjectWithShots[]> {
  await logOnePromptVideo("project.list.request", { userId });
  let projects = await prisma.videoProject.findMany({
    where: { userId },
    include: PROJECT_INCLUDE,
    orderBy: { updatedAt: "desc" },
    take: 20,
  });
  if (!projects.length) {
    const demoProject = await ensureDemoVideoProject(userId);
    if (demoProject) {
      projects = [demoProject];
    }
  }
  await logOnePromptVideo("project.list.response", {
    userId,
    count: projects.length,
    projects: projects.map((project) => ({ id: project.id, status: project.status, title: project.title })),
  });
  return projects;
}

async function ensureDemoVideoProject(userId: string): Promise<VideoProjectWithShots | null> {
  const existing = await prisma.videoProject.findFirst({
    where: { userId },
    include: PROJECT_INCLUDE,
    orderBy: { updatedAt: "desc" },
  });
  if (existing) return existing;

  const source = await findDemoSourceProject(userId);
  const project = source
    ? await cloneDemoSourceProject(userId, source)
    : await createFallbackDemoProject(userId);

  await logOnePromptVideo("project.demo.seeded", {
    userId,
    projectId: project.id,
    clonedFromProjectId: source?.id ?? null,
    title: project.title,
  });
  return project;
}

async function findDemoSourceProject(userId: string): Promise<VideoProjectWithShots | null> {
  const configuredId = process.env.ONE_PROMPT_VIDEO_DEMO_SOURCE_PROJECT_ID?.trim();
  const sourceIds = configuredId ? [configuredId, ...DEMO_PROJECT_SOURCE_IDS] : DEMO_PROJECT_SOURCE_IDS;
  const byId = await prisma.videoProject.findFirst({
    where: {
      id: { in: sourceIds },
      userId: { not: userId },
      status: VideoProjectStatus.DONE,
      finalVideoUrl: { not: null },
    },
    include: PROJECT_INCLUDE,
    orderBy: { updatedAt: "desc" },
  });
  if (byId) return byId;

  return prisma.videoProject.findFirst({
    where: {
      userId: { not: userId },
      status: VideoProjectStatus.DONE,
      finalVideoUrl: { not: null },
      OR: [
        { title: DEMO_PROJECT_TITLE },
        { title: { contains: "Tongits King", mode: "insensitive" } },
      ],
    },
    include: PROJECT_INCLUDE,
    orderBy: { updatedAt: "desc" },
  });
}

async function cloneDemoSourceProject(userId: string, source: VideoProjectWithShots): Promise<VideoProjectWithShots> {
  const created = await prisma.$transaction(async (tx) => {
    const project = await tx.videoProject.create({
      data: {
        userId,
        status: VideoProjectStatus.DONE,
        title: source.title || DEMO_PROJECT_TITLE,
        userPrompt: source.userPrompt || DEMO_PROJECT_PROMPT,
        referenceImageUrls: cloneJsonValue(source.referenceImageUrls),
        planJson: source.planJson ? cloneJsonValue(source.planJson) : undefined,
        aspectRatio: source.aspectRatio,
        durationSeconds: source.durationSeconds,
        stylePreset: source.stylePreset,
        finalVideoUrl: DEMO_PROJECT_FINAL_VIDEO_URL,
        composeTaskId: null,
        errorMessage: null,
      },
    });
    if (source.keyframes.length) {
      await tx.videoKeyframe.createMany({
        data: source.keyframes.map((keyframe) => ({
          projectId: project.id,
          keyframeNo: keyframe.keyframeNo,
          timeSeconds: keyframe.timeSeconds,
          status: keyframe.imageUrl ? VideoShotStatus.IMAGE_APPROVED : keyframe.status,
          purpose: keyframe.purpose,
          scene: keyframe.scene,
          characterState: keyframe.characterState,
          productState: keyframe.productState,
          imagePrompt: keyframe.imagePrompt,
          negativePrompt: keyframe.negativePrompt,
          imageUrl: demoKeyframeAssetUrl(keyframe.keyframeNo) ?? keyframe.imageUrl,
          imageTaskId: null,
          qualityScore: keyframe.qualityScore,
          errorMessage: null,
          locked: Boolean(keyframe.imageUrl),
        })),
      });
    }
    if (source.segments.length) {
      await tx.videoSegment.createMany({
        data: source.segments.map((segment) => ({
          projectId: project.id,
          segmentNo: segment.segmentNo,
          status: segment.clipUrl ? VideoShotStatus.CLIP_APPROVED : segment.status,
          startKeyframeNo: segment.startKeyframeNo,
          endKeyframeNo: segment.endKeyframeNo,
          startTimeSeconds: segment.startTimeSeconds,
          endTimeSeconds: segment.endTimeSeconds,
          durationSeconds: segment.durationSeconds,
          purpose: segment.purpose,
          motion: segment.motion,
          camera: segment.camera,
          subjectMotion: segment.subjectMotion,
          environmentMotion: segment.environmentMotion,
          videoPrompt: segment.videoPrompt,
          negativePrompt: segment.negativePrompt,
          subtitle: segment.subtitle,
          clipUrl: demoClipAssetUrl(segment.segmentNo) ?? segment.clipUrl,
          clipTaskId: null,
          qualityScore: segment.qualityScore,
          errorMessage: null,
          locked: Boolean(segment.clipUrl),
        })),
      });
    }
    if (source.shots.length) {
      await tx.videoShot.createMany({
        data: source.shots.map((shot) => ({
          projectId: project.id,
          shotNo: shot.shotNo,
          status: shot.status,
          durationSeconds: shot.durationSeconds,
          purpose: shot.purpose,
          camera: shot.camera,
          action: shot.action,
          imagePrompt: shot.imagePrompt,
          videoPrompt: shot.videoPrompt,
          negativePrompt: shot.negativePrompt,
          subtitle: shot.subtitle,
          imageUrl: shot.imageUrl,
          clipUrl: shot.clipUrl,
          imageTaskId: null,
          clipTaskId: null,
          qualityScore: shot.qualityScore,
          errorMessage: null,
          locked: shot.locked,
        })),
      });
    }
    return project;
  });
  return requireVideoProject(userId, created.id);
}

async function createFallbackDemoProject(userId: string): Promise<VideoProjectWithShots> {
  const plan = fallbackDemoPlan();
  const created = await prisma.$transaction(async (tx) => {
    const project = await tx.videoProject.create({
      data: {
        userId,
        status: VideoProjectStatus.DONE,
        title: DEMO_PROJECT_TITLE,
        userPrompt: DEMO_PROJECT_PROMPT,
        referenceImageUrls: [],
        planJson: plan as unknown as Prisma.InputJsonValue,
        aspectRatio: "9:16",
        durationSeconds: 30,
        stylePreset: "cartoon",
        finalVideoUrl: DEMO_PROJECT_FINAL_VIDEO_URL,
        composeTaskId: null,
        errorMessage: null,
      },
    });
    await tx.videoKeyframe.createMany({
      data: [
        ...(plan.consistencyReferences ?? []).filter((reference) => reference.needed).map((reference) => ({
          projectId: project.id,
          keyframeNo: reference.keyframeNo,
          timeSeconds: 0,
          status: VideoShotStatus.IMAGE_APPROVED,
          purpose: reference.purpose,
          scene: reference.scene,
          characterState: reference.characterState,
          productState: reference.productState,
          imagePrompt: reference.imagePromptZh ?? reference.imagePrompt,
          negativePrompt: reference.negativePrompt,
          imageUrl: referenceImageForDemoKeyframe(reference.keyframeNo),
          imageTaskId: null,
          qualityScore: 90,
          errorMessage: null,
          locked: true,
        })),
        ...plan.keyframes.map((keyframe) => ({
          projectId: project.id,
          keyframeNo: keyframe.keyframeNo,
          timeSeconds: keyframe.timeSeconds,
          status: VideoShotStatus.IMAGE_APPROVED,
          purpose: keyframe.purpose,
          scene: keyframe.scene,
          characterState: keyframe.characterState,
          productState: keyframe.productState,
          imagePrompt: keyframe.imagePromptZh ?? keyframe.imagePrompt,
          negativePrompt: keyframe.negativePrompt,
          imageUrl: referenceImageForDemoKeyframe(keyframe.keyframeNo),
          imageTaskId: null,
          qualityScore: 90,
          errorMessage: null,
          locked: true,
        })),
      ],
    });
    await tx.videoSegment.createMany({
      data: plan.segments.map((segment) => ({
        projectId: project.id,
        segmentNo: segment.segmentNo,
        status: VideoShotStatus.CLIP_APPROVED,
        startKeyframeNo: segment.startKeyframeNo,
        endKeyframeNo: segment.endKeyframeNo,
        startTimeSeconds: segment.startTimeSeconds,
        endTimeSeconds: segment.endTimeSeconds,
        durationSeconds: segment.durationSeconds,
        purpose: segment.purpose,
        motion: segment.motion,
        camera: segment.camera,
        subjectMotion: segment.subjectMotion,
        environmentMotion: segment.environmentMotion,
        videoPrompt: segment.videoPromptZh ?? segment.videoPrompt,
        negativePrompt: segment.negativePrompt,
        subtitle: segment.subtitle,
        clipUrl: DEMO_PROJECT_FINAL_VIDEO_URL,
        clipTaskId: null,
        qualityScore: 90,
        errorMessage: null,
        locked: true,
      })),
    });
    return project;
  });
  return requireVideoProject(userId, created.id);
}

function cloneJsonValue(value: Prisma.JsonValue): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function referenceImageForDemoKeyframe(keyframeNo: number): string {
  return demoKeyframeAssetUrl(keyframeNo) ?? "/covers/sample-a.png";
}

function demoKeyframeAssetUrl(keyframeNo: number): string | null {
  if (keyframeNo === CHARACTER_CONSISTENCY_KEYFRAME_NO) return "/demo/tongits/keyframe--2.png";
  if (keyframeNo >= 1 && keyframeNo <= 7) return `/demo/tongits/keyframe-${keyframeNo}.png`;
  return null;
}

function demoClipAssetUrl(segmentNo: number): string | null {
  if (segmentNo >= 1 && segmentNo <= 6) return `/demo/tongits/clip-${segmentNo}.mp4`;
  return null;
}

function fallbackDemoPlan(): OnePromptVideoPlan {
  const negativePrompt = "realistic, dark, gloomy, low resolution, blurry, distorted, extra limbs, deformed face, inconsistent clothing, missing logo elements";
  const negativePromptZh = negativePrompt;
  const keyframes = [
    demoKeyframe(1, 0, "Opening mascot reveal", "Introduce the mascot in a warm spotlight", negativePrompt, negativePromptZh),
    demoKeyframe(2, 5, "Enter the game world", "Reveal the bright tropical game world", negativePrompt, negativePromptZh),
    demoKeyframe(3, 9, "Cards and strategy", "Show the tropical card-game world", negativePrompt, negativePromptZh),
    demoKeyframe(4, 15, "Smart move", "Show the mascot playing cards and making a smart move", negativePrompt, negativePromptZh),
    demoKeyframe(5, 20, "Winning moment", "Celebrate the winning moment", negativePrompt, negativePromptZh),
    demoKeyframe(6, 25, "Logo reveal", "Reveal the Tongits King logo", negativePrompt, negativePromptZh),
    demoKeyframe(7, 30, "Call to action", "End with a download call to action", negativePrompt, negativePromptZh),
  ];
  const segments = [
    demoSegment(1, 1, 2, 0, 5, "Opening mascot reveal", "A continuous push-in reveals the smiling mascot under warm spotlight.", negativePrompt, negativePromptZh),
    demoSegment(2, 2, 3, 5, 9, "Enter the game world", "The camera opens into a sunny tropical game world with cards and playful motion.", negativePrompt, negativePromptZh),
    demoSegment(3, 3, 4, 9, 15, "Cards and strategy", "The mascot picks cards, considers strategy, and makes a confident move.", negativePrompt, negativePromptZh),
    demoSegment(4, 4, 5, 15, 20, "Winning moment", "The mascot wins, jumps in celebration, and the scene fills with festive effects.", negativePrompt, negativePromptZh),
    demoSegment(5, 5, 6, 20, 25, "Logo reveal", "The Tongits King logo emerges clearly with cards and tropical leaves.", negativePrompt, negativePromptZh),
    demoSegment(6, 6, 7, 25, 30, "Call to action", "The logo holds while a clean download call to action appears.", negativePrompt, negativePromptZh),
  ];
  return {
    title: DEMO_PROJECT_TITLE,
    logline: "Tongits King 30s game ad demo with a consistent mascot, tropical card-game energy, and a clear call to action.",
    durationSeconds: 30,
    aspectRatio: "9:16",
    keyframeCount: keyframes.length,
    segmentCount: segments.length,
    styleBible: {
      visualStyle: "bright cinematic cartoon game advertisement",
      characterLock: "same cartoon bull mascot, straw hat, red scarf, blue jacket, gold badge, friendly confident smile",
      productLock: "Tongits King card-game brand, tropical playing-card visual language",
      colorPalette: "green, blue, yellow, warm gold highlights",
      colorToneLock: "bright saturated tropical colors",
      lightingToneLock: "warm commercial lighting with clear readable subjects",
      negativePrompt,
      negativePromptZh,
      negativePromptEn: negativePrompt,
    },
    planningManifest: {
      projectIntent: {
        videoType: "game_ad",
        primaryGoalZh: "Show Tongits King in a polished 30s game ad.",
        primaryGoalEn: "Show Tongits King's joyful competitive mood in 30 seconds and drive installs",
      },
      storyStrategy: {
        narrativeArcZh: "Mascot reveal, game world, strategy, victory, logo, call to action",
        narrativeArcEn: "Mascot reveal, game-world entry, strategic interaction, victory, brand reveal, call to action",
      },
      timelineBlueprint: {
        segmentCount: segments.length,
        totalDurationSeconds: 30,
        segmentDurationMinSeconds: 3,
        segmentDurationMaxSeconds: 15,
        splitStrategyZh: "Six clear advertising beats, each kept as one continuous shot.",
        segments: segments.map((segment) => ({
          segmentNo: segment.segmentNo,
          startTimeSeconds: segment.startTimeSeconds,
          endTimeSeconds: segment.endTimeSeconds,
          durationSeconds: segment.durationSeconds,
          purposeZh: segment.purposeZh,
          purposeEn: segment.purposeEn,
          requiredAnchorIds: ["mascot-bull", "tongits-brand"],
          boundaryModeHint: "continuous",
        })),
      },
      consistencyManifest: {
        anchors: [
          {
            id: "mascot-bull",
            type: "person",
            displayNameZh: "Bull mascot",
            displayNameEn: "Bull mascot",
            mustStayConsistent: true,
            needsReferenceImage: true,
            referenceStrength: "hard",
            descriptionZh: "Cartoon bull with straw hat, red scarf, blue jacket, and gold badge",
            descriptionEn: "Cartoon bull with straw hat, red scarf, blue jacket, and gold badge",
            appliesTo: ["keyframes", "segments", "micro_shots"],
            userEditable: true,
            imagePromptZh: "Cartoon bull mascot, straw hat, red scarf, blue jacket, gold badge, friendly smile, bright background",
            imagePromptEn: "Cartoon bull mascot, straw hat, red scarf, blue jacket, gold badge, friendly smile, bright background",
          },
          {
            id: "tongits-brand",
            type: "brand_visual",
            displayNameZh: "Tongits King brand visual",
            displayNameEn: "Tongits King brand visual",
            mustStayConsistent: true,
            needsReferenceImage: false,
            referenceStrength: "medium",
            descriptionZh: "Bright tropical card-game brand with green leaves, playing cards, and readable logo",
            descriptionEn: "Bright tropical card-game brand with green leaves, playing cards, and readable logo",
            appliesTo: ["keyframes", "segments", "micro_shots"],
            userEditable: true,
          },
        ],
      },
    },
    consistencyManifest: {
      anchors: [
        {
          id: "mascot-bull",
          type: "person",
          displayNameZh: "Bull mascot",
          displayNameEn: "Bull mascot",
          mustStayConsistent: true,
          needsReferenceImage: true,
          referenceStrength: "hard",
          descriptionZh: "Cartoon bull with straw hat, red scarf, blue jacket, and gold badge",
          descriptionEn: "Cartoon bull with straw hat, red scarf, blue jacket, and gold badge",
          appliesTo: ["keyframes", "segments", "micro_shots"],
          userEditable: true,
          imagePromptZh: "Cartoon bull mascot, straw hat, red scarf, blue jacket, gold badge, friendly smile, bright background",
          imagePromptEn: "Cartoon bull mascot, straw hat, red scarf, blue jacket, gold badge, friendly smile, bright background",
        },
        {
          id: "tongits-brand",
          type: "brand_visual",
          displayNameZh: "Tongits King brand visual",
          displayNameEn: "Tongits King brand visual",
          mustStayConsistent: true,
          needsReferenceImage: false,
          referenceStrength: "medium",
          descriptionZh: "Bright tropical card-game brand with green leaves, playing cards, and readable logo",
          descriptionEn: "Bright tropical card-game brand with green leaves, playing cards, and readable logo",
          appliesTo: ["keyframes", "segments", "micro_shots"],
          userEditable: true,
        },
      ],
    },
    timelineBlueprint: {
      segmentCount: segments.length,
      totalDurationSeconds: 30,
      segmentDurationMinSeconds: 3,
      segmentDurationMaxSeconds: 15,
      splitStrategyZh: "Six clear advertising beats, each kept as one continuous shot.",
      segments: segments.map((segment) => ({
        segmentNo: segment.segmentNo,
        startTimeSeconds: segment.startTimeSeconds,
        endTimeSeconds: segment.endTimeSeconds,
        durationSeconds: segment.durationSeconds,
        purposeZh: segment.purposeZh,
        purposeEn: segment.purposeEn,
        requiredAnchorIds: ["mascot-bull", "tongits-brand"],
        boundaryModeHint: "continuous",
      })),
    },
    consistencyReferences: [
      {
        kind: "character",
        needed: true,
        keyframeNo: CHARACTER_CONSISTENCY_KEYFRAME_NO,
        anchorId: "mascot-bull",
        frameId: "mascot-bull-reference",
        purpose: "Bull mascot identity reference",
        purposeZh: "Bull mascot identity reference",
        purposeEn: "Bull mascot identity reference",
        scene: "clean bright reference background",
        characterState: "same cartoon bull mascot, straw hat, red scarf, blue jacket, gold badge",
        productState: "Tongits King game identity",
        imagePrompt: "Cartoon bull mascot, straw hat, red scarf, blue jacket, gold badge, friendly smile, bright background",
        imagePromptZh: "Cartoon bull mascot, straw hat, red scarf, blue jacket, gold badge, friendly smile, bright background",
        imagePromptEn: "Cartoon bull mascot, straw hat, red scarf, blue jacket, gold badge, friendly smile, bright background",
        negativePrompt,
        negativePromptZh,
        negativePromptEn: negativePrompt,
      },
    ],
    keyframes,
    segments,
    shots: segments.map((segment) => ({
      shotNo: segment.segmentNo,
      durationSeconds: segment.durationSeconds,
      boundaryMode: segment.boundaryMode,
      purpose: segment.purpose,
      purposeZh: segment.purposeZh,
      purposeEn: segment.purposeEn,
      camera: segment.camera,
      action: segment.motion,
      imagePrompt: keyframes.find((keyframe) => keyframe.keyframeNo === segment.startKeyframeNo)?.imagePrompt ?? "",
      imagePromptZh: keyframes.find((keyframe) => keyframe.keyframeNo === segment.startKeyframeNo)?.imagePromptZh ?? "",
      imagePromptEn: keyframes.find((keyframe) => keyframe.keyframeNo === segment.startKeyframeNo)?.imagePromptEn ?? "",
      videoPrompt: segment.videoPrompt,
      videoPromptZh: segment.videoPromptZh,
      videoPromptEn: segment.videoPromptEn,
      outputMode: "mixed",
      constraints: ["Keep mascot identity consistent", "Keep tropical card-game world coherent", "No subtitles, UI overlays, or random text"],
      subtitle: "",
      negativePrompt,
      negativePromptZh,
      negativePromptEn: negativePrompt,
      usesConsistencyAnchors: ["mascot-bull", "tongits-brand"],
    })),
  };
}

function demoKeyframe(
  keyframeNo: number,
  timeSeconds: number,
  purposeZh: string,
  purposeEn: string,
  negativePrompt: string,
  negativePromptZh: string,
) {
  const imagePromptZh = `Cinematic cartoon game ad, ${purposeZh}, same bull mascot with straw hat, red scarf, blue jacket, and gold badge, tropical card-game mood, vertical 9:16 composition, bright saturated commercial quality, no watermark, no UI, no subtitles`;
  const imagePromptEn = `Cinematic cartoon game advertisement, ${purposeEn}, same bull mascot with straw hat, red scarf, blue jacket, and gold badge, tropical card-game mood, vertical 9:16 composition, bright saturated commercial quality, no watermark, no UI, no subtitles`;
  return {
    keyframeNo,
    frameId: `KF${String(keyframeNo).padStart(2, "0")}`,
    frameRole: keyframeNo === 1 ? "video_start" as const : keyframeNo === 7 ? "video_end" as const : "shared_boundary" as const,
    timeSeconds,
    purpose: purposeZh,
    purposeZh,
    purposeEn,
    scene: "bright tropical cartoon card-game world",
    characterState: "same bull mascot with straw hat, red scarf, blue jacket, gold badge",
    productState: "Tongits King game brand remains readable and festive",
    imagePrompt: imagePromptZh,
    imagePromptZh,
    imagePromptEn,
    negativePrompt,
    negativePromptZh,
    negativePromptEn: negativePrompt,
    usesConsistencyAnchors: ["mascot-bull", "tongits-brand"],
  };
}

function demoSegment(
  segmentNo: number,
  startKeyframeNo: number,
  endKeyframeNo: number,
  startTimeSeconds: number,
  endTimeSeconds: number,
  purposeZh: string,
  videoPromptEn: string,
  negativePrompt: string,
  negativePromptZh: string,
) {
  const durationSeconds = endTimeSeconds - startTimeSeconds;
  const videoPromptZh = `Single continuous shot: ${purposeZh}. Maintain same mascot identity, same tropical card-game world, coherent lighting, no cuts, no scene jumps, no UI overlays.`;
  return {
    segmentNo,
    startKeyframeNo,
    endKeyframeNo,
    startTimeSeconds,
    endTimeSeconds,
    durationSeconds,
    boundaryMode: "continuous" as const,
    purpose: purposeZh,
    purposeZh,
    purposeEn: videoPromptEn,
    motion: purposeZh,
    camera: "smooth continuous commercial camera movement",
    subjectMotion: "mascot performs one clear advertising beat with natural motion",
    environmentMotion: "subtle tropical ambience, cards and celebratory effects remain coherent",
    videoPrompt: videoPromptZh,
    videoPromptZh,
    videoPromptEn,
    subtitle: "",
    outputMode: "mixed" as const,
    constraints: ["Keep mascot identity consistent", "Keep tropical card-game world coherent", "No subtitles, UI overlays, or random text"],
    negativePrompt,
    negativePromptZh,
    negativePromptEn: negativePrompt,
    usesConsistencyAnchors: ["mascot-bull", "tongits-brand"],
  };
}

export async function createVideoProject(
  userId: string,
  input: CreateVideoProjectInput,
): Promise<VideoProjectWithShots> {
  const planInput = normalizePlanInput(input);
  await logOnePromptVideo("project.create.request", {
    userId,
    userPromptLength: planInput.userPrompt.length,
    aspectRatio: planInput.aspectRatio,
    durationSeconds: planInput.durationSeconds,
    fallbackSegmentCount: planInput.shotCount,
    stylePreset: planInput.stylePreset,
    referenceImageCount: planInput.referenceImageUrls.length,
  });
  const project = await prisma.videoProject.create({
    data: {
      userId,
      status: VideoProjectStatus.DRAFT,
      userPrompt: planInput.userPrompt,
      referenceImageUrls: planInput.referenceImageUrls,
      aspectRatio: planInput.aspectRatio,
      durationSeconds: planInput.durationSeconds,
      stylePreset: planInput.stylePreset ?? "",
    },
    include: PROJECT_INCLUDE,
  });
  await logOnePromptVideo("project.create.success", { userId, projectId: project.id, status: project.status });
  await writeProjectOverviewLog({
    userId,
    projectId: project.id,
    title: project.title,
    prompt: project.userPrompt,
    aspectRatio: project.aspectRatio,
    durationSeconds: project.durationSeconds,
    stylePreset: project.stylePreset,
    referenceImageCount: planInput.referenceImageUrls.length,
    status: project.status,
  });
  return project;
}

export async function getVideoProject(
  userId: string,
  projectId: string,
): Promise<VideoProjectWithShots | null> {
  const project = await prisma.videoProject.findFirst({
    where: { id: projectId, userId },
    include: PROJECT_INCLUDE,
  });
  if (!project?.planJson || !isRecord(project.planJson)) return project;
  const hydratedPlanJson = await hydratePlanArtifactsFromTables(project.id, project.planJson);
  const source = isRecord(hydratedPlanJson) ? hydratedPlanJson : project.planJson;
  const hydratedProject = { ...project, planJson: source } as VideoProjectWithShots;
  const needsTransitionBackfill = !Array.isArray(source.transitionReferenceArtifacts) || !Array.isArray(source.generatedBridgeArtifacts);
  const plan = cloneJsonRecord(source) as unknown as OnePromptVideoPlan;
  if (!Array.isArray(plan.segments)) return hydratedProject;
  if (needsTransitionBackfill) materializeTransitionProductionArtifacts(plan, project.planJson);
  ensurePlanArtifactMetadata(plan as unknown as Record<string, unknown>);
  if (JSON.stringify(plan) === JSON.stringify(source)) return hydratedProject;
  return prisma.videoProject.update({ where: { id: project.id }, data: { planJson: cleanInputJson(plan as unknown as Record<string, unknown>) }, include: PROJECT_INCLUDE });
}

export async function getVideoShotClipForDownload(
  userId: string,
  projectId: string,
  shotId: string,
): Promise<{ title: string; shotNo: number; clipUrl: string }> {
  const project = await requireVideoProject(userId, projectId);
  const segment = project.segments.find((item) => item.id === shotId);
  if (segment) {
    if (!segment.clipUrl) throw new Error("Segment video is not ready yet");
    return {
      title: project.title || "one-prompt-video",
      shotNo: segment.segmentNo,
      clipUrl: segment.clipUrl,
    };
  }
  const shot = project.shots.find((item) => item.id === shotId);
  if (!shot) throw new Error("Shot not found");
  if (!shot.clipUrl) throw new Error("Shot video is not ready yet");
  return {
    title: project.title || "one-prompt-video",
    shotNo: shot.shotNo,
    clipUrl: shot.clipUrl,
  };
}

export async function updateVideoProject(
  userId: string,
  projectId: string,
  input: { title?: string; planDebugPatch?: PlanDebugPatch },
): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  const data: Prisma.VideoProjectUpdateInput = {};
  if (typeof input.title === "string") data.title = input.title.trim().slice(0, 80);
  if (input.planDebugPatch && project.planJson) {
    const plan = cloneJsonRecord(project.planJson);
    applyPlanDebugPatch(plan, input.planDebugPatch);
    data.planJson = plan as Prisma.InputJsonValue;
  }

  if (!Object.keys(data).length) return requireVideoProject(userId, projectId);

  const updated = await prisma.videoProject.update({
    where: { id: projectId },
    data,
    include: PROJECT_INCLUDE,
  });
  if (updated.planJson && data.planJson) await mirrorPlanArtifactsToTables(projectId, updated.planJson);
  if (updated.planJson && data.planJson) await mirrorPlanArtifactsToTables(projectId, updated.planJson);
  await logOnePromptVideo("project.update.success", {
    userId,
    projectId,
    updatedFields: Object.keys(data),
  });
  return updated;
}

export async function deleteVideoProject(userId: string, projectId: string): Promise<void> {
  await logOnePromptVideo("project.delete.start", { userId, projectId });
  try {
    await requireVideoProject(userId, projectId);
    await prisma.videoProject.delete({ where: { id: projectId } });
    await logOnePromptVideo("project.delete.success", { userId, projectId });
  } catch (error) {
    await logOnePromptVideo("project.delete.error", { userId, projectId, ...errorForLog(error) }, "error");
    throw error;
  }
}

export async function cancelVideoProject(
  userId: string,
  projectId: string,
  audit?: { cancelIntentId: string; confirmedAt: string; userAgent?: string },
): Promise<VideoProjectWithShots> {
  await requireVideoProject(userId, projectId);
  await logOnePromptVideo("project.cancel.start", { userId, projectId, ...audit });

  const updated = await prisma.$transaction(async (tx) => {
    await tx.videoKeyframe.updateMany({
      where: {
        projectId,
        status: { in: [VideoShotStatus.IMAGE_PENDING, VideoShotStatus.IMAGE_RUNNING] },
      },
      data: {
        status: VideoShotStatus.FAILED,
        imageTaskId: null,
        locked: false,
        errorMessage: MANUAL_STOP_MESSAGE,
      },
    });
    await tx.videoSegment.updateMany({
      where: {
        projectId,
        status: { in: [VideoShotStatus.CLIP_PENDING, VideoShotStatus.CLIP_RUNNING] },
      },
      data: {
        status: VideoShotStatus.FAILED,
        clipTaskId: null,
        locked: false,
        errorMessage: MANUAL_STOP_MESSAGE,
      },
    });
    await tx.videoShot.updateMany({
      where: {
        projectId,
        status: {
          in: [
            VideoShotStatus.IMAGE_PENDING,
            VideoShotStatus.IMAGE_RUNNING,
            VideoShotStatus.CLIP_PENDING,
            VideoShotStatus.CLIP_RUNNING,
          ],
        },
      },
      data: {
        status: VideoShotStatus.FAILED,
        imageTaskId: null,
        clipTaskId: null,
        locked: false,
        errorMessage: MANUAL_STOP_MESSAGE,
      },
    });
    await tx.videoGenerationCandidate.updateMany({
      where: { projectId, status: { in: ["pending", "running"] } },
      data: {
        status: "cancelled",
        taskId: null,
        errorMessage: MANUAL_STOP_MESSAGE,
      },
    });
    return tx.videoProject.update({
      where: { id: projectId },
      data: {
        status: VideoProjectStatus.FAILED,
        composeTaskId: null,
        errorMessage: MANUAL_STOP_MESSAGE,
      },
      include: PROJECT_INCLUDE,
    });
  });

  await logOnePromptVideo("project.cancel.success", { userId, projectId, status: updated.status });
  return updated;
}

export async function resumeVideoProject(userId: string, projectId: string): Promise<VideoProjectWithShots> {
  let project = await requireVideoProject(userId, projectId);
  await logOnePromptVideo("project.resume.start", {
    userId,
    projectId,
    status: project.status,
    keyframeCount: project.keyframes.length,
    segmentCount: project.segments.length,
    hasPlan: Boolean(project.planJson),
    finalVideoUrl: project.finalVideoUrl,
  });
  const wasManuallyStopped = isManuallyStopped(project);
  if (wasManuallyStopped) {
    const cleared = await prisma.$transaction(async (tx) => {
      const resetKeyframes = await tx.videoKeyframe.updateMany({
        where: { projectId, status: VideoShotStatus.FAILED, errorMessage: MANUAL_STOP_MESSAGE },
        data: { status: VideoShotStatus.IMAGE_PENDING, imageTaskId: null, errorMessage: null, locked: false },
      });
      const resetSegments = await tx.videoSegment.updateMany({
        where: { projectId, status: VideoShotStatus.FAILED, errorMessage: MANUAL_STOP_MESSAGE },
        data: { status: VideoShotStatus.CLIP_PENDING, clipTaskId: null, errorMessage: null, locked: false },
      });
      const resetImageShots = await tx.videoShot.updateMany({
        where: { projectId, status: VideoShotStatus.FAILED, errorMessage: MANUAL_STOP_MESSAGE, imageUrl: null },
        data: { status: VideoShotStatus.IMAGE_PENDING, imageTaskId: null, clipTaskId: null, errorMessage: null, locked: false },
      });
      const resetClipShots = await tx.videoShot.updateMany({
        where: { projectId, status: VideoShotStatus.FAILED, errorMessage: MANUAL_STOP_MESSAGE, imageUrl: { not: null } },
        data: { status: VideoShotStatus.CLIP_PENDING, imageTaskId: null, clipTaskId: null, errorMessage: null, locked: false },
      });
      const resumed = await tx.videoProject.update({
        where: { id: projectId },
        data: { errorMessage: null },
        include: PROJECT_INCLUDE,
      });
      return {
        project: resumed,
        counts: {
          keyframes: resetKeyframes.count,
          segments: resetSegments.count,
          imageShots: resetImageShots.count,
          clipShots: resetClipShots.count,
        },
      };
    });
    project = cleared.project;
    await logOnePromptVideo("project.resume.clear_manual_stop_children", { userId, projectId, ...cleared.counts });
    await logOnePromptVideo("project.resume.clear_manual_stop", { userId, projectId });
  }
  project = await repairAcceptedShortTransitionReferences(project);
  if (await upgradeLegacyImageQualityReports(project)) {
    project = await requireVideoProject(userId, projectId);
    await syncGenerationCandidates(project);
    project = await requireVideoProject(userId, projectId);
  }
  if (project.status === VideoProjectStatus.FAILED) {
    const failedRecoveryPlan = cloneJsonRecord(project.planJson ?? {});
    const failedRecoveryMetadata = ensurePlanArtifactMetadata(failedRecoveryPlan);
    const failedBoundaryKeyframe = project.keyframes.find((keyframe) => {
      const metadata = failedRecoveryMetadata[imageArtifactIdForKeyframeNo(keyframe.keyframeNo)];
      const hasActiveCandidate = project.generationCandidates.some((candidate) =>
        candidate.targetId === keyframe.id && (candidate.status === "running" || candidate.status === "pending" || candidate.status === "evaluating")
      );
      return keyframe.keyframeNo > 0
        && keyframe.status === VideoShotStatus.FAILED
        && Boolean(metadata && (metadata.status === "dirty" || metadata.status === "failed") && !metadata.userAccepted)
        && !keyframe.imageTaskId
        && !hasActiveCandidate;
    });
    if (failedBoundaryKeyframe) {
      await logOnePromptVideo("project.resume.failed_boundary_new_retry_cycle", {
        userId,
        projectId,
        keyframeNo: failedBoundaryKeyframe.keyframeNo,
        reason: "failed boundary recovery takes priority over unrelated running candidates",
      });
      return regenerateShotImage(userId, projectId, failedBoundaryKeyframe.id, { recovery: true });
    }
  }
  const hasRunningImageWork = Boolean(
    project.keyframes.some((item) => item.imageTaskId) ||
    project.generationCandidates.some((item) => (item.status === "running" || item.status === "pending") && (item.kind === "keyframe_image" || item.kind === "micro_shot_image"))
  );
  const hasRunningClipWork = Boolean(
    project.segments.some((item) => item.clipTaskId) ||
    project.generationCandidates.some((item) => (item.status === "running" || item.status === "pending") && item.kind === "segment_video")
  );
  const hasRunningWork = Boolean(
    project.composeTaskId ||
    hasRunningImageWork ||
    hasRunningClipWork ||
    project.generationCandidates.some((item) => item.status === "running" || item.status === "pending")
  );
  if (hasRunningWork) {
    if (wasManuallyStopped) {
      const resumedStatus = project.composeTaskId
        ? VideoProjectStatus.COMPOSING
        : hasRunningImageWork
          ? VideoProjectStatus.IMAGE_GENERATING
          : VideoProjectStatus.CLIP_GENERATING;
      project = await prisma.videoProject.update({
        where: { id: projectId },
        data: { status: resumedStatus, errorMessage: null },
        include: PROJECT_INCLUDE,
      });
      await logOnePromptVideo("project.resume.restore_running_status", { userId, projectId, status: resumedStatus });
    }
    await logOnePromptVideo("project.resume.sync_running", { userId, projectId, reason: "running tasks are synchronized instead of resubmitted" });
    return syncVideoProject(userId, projectId);
  }
  const consistencyReferences = project.keyframes.filter((keyframe) => isConsistencyKeyframeNo(keyframe.keyframeNo));
  const assetLibraryReady = consistencyReferences.length > 0 && consistencyReferences.every((keyframe) => Boolean(keyframe.imageUrl));
  const assetLibraryApproved = consistencyReferences.every(isApprovedConsistencyReference);
  if (project.status === VideoProjectStatus.FAILED && assetLibraryReady && !assetLibraryApproved) {
    await logOnePromptVideo("project.resume.approve_ready_asset_library", {
      userId,
      projectId,
      reason: "resume confirms the current complete asset set and advances to boundary generation",
      unapprovedKeyframeNos: consistencyReferences.filter((keyframe) => !isApprovedConsistencyReference(keyframe)).map((keyframe) => keyframe.keyframeNo),
    });
    return approveAssetLibrary(userId, projectId);
  }
  const recoveryPlan = cloneJsonRecord(project.planJson ?? {});
  const recoveryMetadata = ensurePlanArtifactMetadata(recoveryPlan);
  const recoverable = (artifactId: string): boolean => {
    const item = recoveryMetadata[artifactId];
    return Boolean(item && (item.status === "dirty" || item.status === "failed") && !item.userAccepted);
  };
  const dirtyKeyframe = project.keyframes.find((keyframe) =>
    recoverable(imageArtifactIdForKeyframeNo(keyframe.keyframeNo)) &&
    keyframe.status !== VideoShotStatus.IMAGE_APPROVED
  );
  if (dirtyKeyframe) {
    await logOnePromptVideo("project.resume.dirty_keyframe", { userId, projectId, keyframeNo: dirtyKeyframe.keyframeNo, retryFromStage: recoveryMetadata[imageArtifactIdForKeyframeNo(dirtyKeyframe.keyframeNo)]?.retryFromStage });
    return regenerateShotImage(userId, projectId, dirtyKeyframe.id, { recovery: true });
  }
  for (const segment of project.segments) {
    const microShots = readPlanMicroShots(readPlanSegmentMap(project.planJson).get(segment.segmentNo));
    const dirtyMicroShot = microShots.find((item) => recoverable(imageArtifactIdForMicroShot(segment.segmentNo, item.microShotNo)) && item.imageStatus !== "running");
    if (dirtyMicroShot) {
      await logOnePromptVideo("project.resume.dirty_micro_shot", { userId, projectId, segmentNo: segment.segmentNo, microShotNo: dirtyMicroShot.microShotNo, retryFromStage: recoveryMetadata[imageArtifactIdForMicroShot(segment.segmentNo, dirtyMicroShot.microShotNo)]?.retryFromStage });
      return regenerateMicroShotImage(userId, projectId, segment.id, dirtyMicroShot.microShotNo);
    }
  }
  const dirtySegment = project.segments.find((segment) =>
    recoverable(videoArtifactIdForSegmentNo(segment.segmentNo)) &&
    segment.status !== VideoShotStatus.CLIP_APPROVED
  );
  if (dirtySegment) {
    await logOnePromptVideo("project.resume.dirty_segment", { userId, projectId, segmentNo: dirtySegment.segmentNo, retryFromStage: recoveryMetadata[videoArtifactIdForSegmentNo(dirtySegment.segmentNo)]?.retryFromStage });
    return regenerateShotClip(userId, projectId, dirtySegment.id);
  }
  const pendingRevisionReview = project.generationCandidates.some((item) => {
    if (item.status !== "recommended" || item.selected) return false;
    if (item.kind === "keyframe_image") {
      const keyframe = project.keyframes.find((candidate) => candidate.id === item.targetId);
      // A locked/approved asset is the user's final decision. Older
      // recommended candidates for that target must not block the pipeline.
      return Boolean(keyframe && !keyframe.locked && keyframe.status !== VideoShotStatus.IMAGE_APPROVED);
    }
    if (item.kind === "segment_video") {
      const segment = project.segments.find((candidate) => candidate.id === item.targetId);
      return Boolean(segment && !segment.locked && segment.status !== VideoShotStatus.CLIP_APPROVED);
    }
    return true;
  });
  if (pendingRevisionReview) {
    await logOnePromptVideo("project.resume.wait_revision_approval", { userId, projectId, reason: "a regenerated candidate must be explicitly selected before downstream recovery" });
    return project;
  }
  if (recoverable("final_video") && project.segments.length > 0 && project.segments.every((segment) => Boolean(segment.clipUrl))) {
    if (project.status !== VideoProjectStatus.CLIP_REVIEW && project.status !== VideoProjectStatus.FINAL_REVIEW && project.status !== VideoProjectStatus.DONE) {
      await prisma.videoProject.update({ where: { id: projectId }, data: { status: VideoProjectStatus.CLIP_REVIEW, errorMessage: null } });
    }
    await logOnePromptVideo("project.resume.dirty_compose", { userId, projectId, retryFromStage: recoveryMetadata.final_video?.retryFromStage });
    return composeVideoProject(userId, projectId);
  }
  if (project.status === VideoProjectStatus.IMAGE_REVIEW) {
    const missingKeyframes = project.keyframes.filter((keyframe) => !keyframe.imageUrl);
    const consistencyReferences = project.keyframes.filter((keyframe) => isConsistencyKeyframeNo(keyframe.keyframeNo));
    const consistencyReadyForBoundary = consistencyReferences.every(isApprovedConsistencyReference);
    const actionableMissingConsistency = missingKeyframes.filter((keyframe) =>
      isConsistencyKeyframeNo(keyframe.keyframeNo) && isAssetViewGenerationReady(project, keyframe.keyframeNo)
    );
    if (missingKeyframes.length && (actionableMissingConsistency.length > 0 || consistencyReadyForBoundary)) {
      await prisma.videoKeyframe.updateMany({
        where: { projectId, imageUrl: null, imageTaskId: null, NOT: { status: VideoShotStatus.IMAGE_APPROVED } },
        data: {
          status: VideoShotStatus.IMAGE_PENDING,
          imageTaskId: null,
          qualityScore: null,
          errorMessage: null,
          locked: false,
        },
      });
      const queued = await prisma.videoProject.update({
        where: { id: projectId },
        data: { status: VideoProjectStatus.IMAGE_GENERATING, errorMessage: null },
        include: PROJECT_INCLUDE,
      });
      await submitNextImageTask({
        userId,
        projectId,
        keyframes: queued.keyframes,
        logEventPrefix: "image.resume_after_consistency_approval",
      });
      const updated = await requireVideoProject(userId, projectId);
      await logOnePromptVideo("project.resume.boundary_keyframes_after_consistency_approval", {
        userId,
        projectId,
        status: updated.status,
        missingKeyframeCount: missingKeyframes.length,
      });
      return updated;
    }
  }

  if (project.status === VideoProjectStatus.PLANNING) {
    await logOnePromptVideo("project.resume.ensure_planning_task", { userId, projectId });
    return queueVideoProjectPlanning(userId, projectId);
  }

  if (project.status !== VideoProjectStatus.FAILED) {
    await logOnePromptVideo("project.resume.noop", { userId, projectId, status: project.status });
    return project;
  }

  if (project.segments.length) {
    assertPlanValidForGeneration(project.planJson, {
      stage: "video_generation",
      targetArtifactId: "project:failure_recovery",
    });
    const blockedContinuity = project.segments.flatMap((segment) => {
      const report = latestGenerationQualityReport(project.planJson, videoArtifactIdForSegmentNo(segment.segmentNo));
      if (!segment.clipUrl || segment.status !== VideoShotStatus.FAILED) return [];
      return !report?.passed ? [{ segment, report }] : [];
    })[0];
    if (blockedContinuity) {
      const retryStage = blockedContinuity.report?.endFrameDecision === "return_stage_2b" ? "Stage 2B" : "端帧连续性复核";
      throw new Error(`失败恢复已被阻止：segment:${blockedContinuity.segment.segmentNo} ${blockedContinuity.report?.retryInstruction || blockedContinuity.report?.endFrameReasons?.join("；") || "缺少已通过的端帧连续性报告"}。建议回退：${retryStage}。不会盲目重新生成或机械贴入尾帧。`);
    }
  }

  if (!project.keyframes.length && !project.segments.length) {
    await logOnePromptVideo("project.resume.replan", { userId, projectId });
    return queueVideoProjectPlanning(userId, projectId);
  }

  const missingKeyframes = project.keyframes.filter((keyframe) => !keyframe.imageUrl);
  if (missingKeyframes.length) {
    await prisma.videoKeyframe.updateMany({
      where: { projectId, imageUrl: null, imageTaskId: null, NOT: { status: VideoShotStatus.IMAGE_APPROVED } },
      data: {
        status: VideoShotStatus.IMAGE_PENDING,
        imageTaskId: null,
        qualityScore: null,
        errorMessage: null,
        locked: false,
      },
    });
    const queued = await prisma.videoProject.update({
      where: { id: projectId },
      data: { status: VideoProjectStatus.IMAGE_GENERATING, errorMessage: null },
      include: PROJECT_INCLUDE,
    });
    await submitNextImageTask({
      userId,
      projectId,
      keyframes: queued.keyframes,
      logEventPrefix: "image.resume",
    });
    const updated = await requireVideoProject(userId, projectId);
    await logOnePromptVideo("project.resume.image_generating", {
      userId,
      projectId,
      status: updated.status,
      missingKeyframeCount: missingKeyframes.length,
    });
    return updated;
  }

  const keyframesApproved = project.keyframes.length > 0 && project.keyframes.every((keyframe) => keyframe.locked || keyframe.status === VideoShotStatus.IMAGE_APPROVED);
  if (!keyframesApproved) {
    const updated = await prisma.videoProject.update({
      where: { id: projectId },
      data: { status: VideoProjectStatus.IMAGE_REVIEW, errorMessage: null },
      include: PROJECT_INCLUDE,
    });
    await logOnePromptVideo("project.resume.image_review", { userId, projectId, status: updated.status });
    return updated;
  }

  const microShotIssues = requiredMicroShotImageIssues(project);
  if (microShotIssues.length) {
    const updated = await prisma.videoProject.update({
      where: { id: projectId },
      data: { status: VideoProjectStatus.MICRO_SHOT_REVIEW, errorMessage: null },
      include: PROJECT_INCLUDE,
    });
    queueRequiredMicroShotImageTasks(userId, projectId, { retryFailed: true });
    await logOnePromptVideo("project.resume.micro_shot_review", {
      userId,
      projectId,
      status: updated.status,
      issueCount: microShotIssues.length,
    });
    return updated;
  }

  const missingSegments = project.segments.filter((segment) => !segment.clipUrl);
  if (missingSegments.length) {
    await prisma.videoSegment.updateMany({
      where: { projectId, clipUrl: null, clipTaskId: null, NOT: { status: VideoShotStatus.CLIP_APPROVED } },
      data: {
        status: VideoShotStatus.CLIP_PENDING,
        clipTaskId: null,
        qualityScore: null,
        errorMessage: null,
        locked: true,
      },
    });
    const queued = await prisma.videoProject.update({
      where: { id: projectId },
      data: { status: VideoProjectStatus.CLIP_GENERATING, errorMessage: null },
      include: PROJECT_INCLUDE,
    });
    await submitNextClipTask({
      userId,
      projectId,
      segments: queued.segments,
      keyframes: queued.keyframes,
      logEventPrefix: "clip.resume",
    });
    const updated = await requireVideoProject(userId, projectId);
    await logOnePromptVideo("project.resume.clip_generating", {
      userId,
      projectId,
      status: updated.status,
      missingSegmentCount: missingSegments.length,
    });
    return updated;
  }

  const updated = await prisma.videoProject.update({
    where: { id: projectId },
    data: { status: project.finalVideoUrl ? VideoProjectStatus.FINAL_REVIEW : VideoProjectStatus.CLIP_REVIEW, errorMessage: null },
    include: PROJECT_INCLUDE,
  });
  await logOnePromptVideo("project.resume.review_ready", { userId, projectId, status: updated.status });
  return updated;
}

async function refreshVideoPlanningLease(projectId: string, taskId: string): Promise<void> {
  const heartbeatAt = new Date().toISOString();
  const leaseExpiresAt = new Date(Date.now() + PLANNING_LEASE_MS).toISOString();
  await prisma.$executeRaw`
    UPDATE "video_projects"
    SET "plan_json" = jsonb_set(
      jsonb_set(COALESCE("plan_json", '{}'::jsonb), '{plannerProgress,heartbeatAt}', to_jsonb(${heartbeatAt}::text), true),
      '{plannerProgress,leaseExpiresAt}', to_jsonb(${leaseExpiresAt}::text), true
    ),
    "updated_at" = NOW()
    WHERE "id" = ${projectId}
      AND "status" = 'PLANNING'
      AND "plan_json" #>> '{plannerProgress,taskId}' = ${taskId}
  `;
}

export async function queueVideoProjectPlanning(
  userId: string,
  projectId: string,
  override?: Partial<CreateVideoProjectInput>,
): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  if (project.status === VideoProjectStatus.PLANNING && planningRuns.has(projectId)) return project;

  const input = normalizePlanInput({
    userPrompt: override?.userPrompt ?? project.userPrompt,
    aspectRatio: override?.aspectRatio ?? project.aspectRatio,
    durationSeconds: override?.durationSeconds ?? project.durationSeconds,
    shotCount: override?.shotCount,
    stylePreset: override?.stylePreset ?? project.stylePreset,
    referenceImageUrls: override?.referenceImageUrls ?? jsonStringArray(project.referenceImageUrls),
  });
  const existingProgress = readVideoPlanningProgress(project.planJson);
  const existingLeaseExpiry = existingProgress?.leaseExpiresAt ? Date.parse(existingProgress.leaseExpiresAt) : 0;
  if (project.status === VideoProjectStatus.PLANNING && existingLeaseExpiry > Date.now()) {
    await logOnePromptVideo("project.plan.active_lease_reused", {
      userId,
      projectId,
      taskId: existingProgress?.taskId,
      workerId: existingProgress?.workerId,
      leaseExpiresAt: existingProgress?.leaseExpiresAt,
    });
    return project;
  }
  const taskId = project.status === VideoProjectStatus.PLANNING && existingProgress?.taskId
    ? existingProgress.taskId
    : randomUUID();
  const now = new Date().toISOString();
  const checkpoint = isRecord(project.planJson) && isRecord(project.planJson.plannerCheckpoint)
    ? project.planJson.plannerCheckpoint
    : undefined;
  const plannerProgress: VideoPlanningProgress = existingProgress?.taskId === taskId
    ? {
        ...existingProgress,
        workerId: planningWorkerId,
        heartbeatAt: now,
        leaseExpiresAt: new Date(Date.now() + PLANNING_LEASE_MS).toISOString(),
        status: "queued",
        stage: "queued",
        updatedAt: now,
      }
    : {
        taskId,
        workerId: planningWorkerId,
        heartbeatAt: now,
        leaseExpiresAt: new Date(Date.now() + PLANNING_LEASE_MS).toISOString(),
        status: "queued",
        stage: "queued",
        completedSteps: 0,
        totalSteps: 4,
        completedSegments: 0,
        totalSegments: 0,
        detailZh: "规划任务已进入后台队列，页面可以安全轮询真实进度。",
        detailEn: "The planning job is queued in the background. The page can safely poll real progress.",
        startedAt: now,
        updatedAt: now,
        metrics: {
          jsonRepairCount: 0,
          jsonRepairDurationMs: 0,
          singleTakeRepairCount: 0,
          singleTakeRepairDurationMs: 0,
        },
      };

  const queued = await prisma.videoProject.update({
    where: { id: projectId },
    data: {
      status: VideoProjectStatus.PLANNING,
      userPrompt: input.userPrompt,
      aspectRatio: input.aspectRatio,
      durationSeconds: input.durationSeconds,
      stylePreset: input.stylePreset ?? "",
      referenceImageUrls: input.referenceImageUrls,
      errorMessage: null,
      planJson: {
        ...(checkpoint ? { plannerCheckpoint: checkpoint } : {}),
        plannerProgress,
      } as unknown as Prisma.InputJsonValue,
    },
    include: PROJECT_INCLUDE,
  });

  const run = new Promise<void>((resolve) => setImmediate(resolve))
    .then(async () => {
      const heartbeat = setInterval(() => {
        void refreshVideoPlanningLease(projectId, taskId).catch((error) => logOnePromptVideo(
          "project.plan.heartbeat.error",
          { projectId, taskId, ...errorForLog(error) },
          "warn",
        ));
      }, PLANNING_HEARTBEAT_MS);
      heartbeat.unref?.();
      try {
        await planVideoProject(userId, projectId, input, { planningTaskId: taskId });
      } finally {
        clearInterval(heartbeat);
      }
    })
    .catch(async (error) => {
      await logOnePromptVideo("project.plan.background.error", { userId, projectId, taskId, ...errorForLog(error) }, "error");
    })
    .finally(() => {
      if (planningRuns.get(projectId) === run) planningRuns.delete(projectId);
    });
  planningRuns.set(projectId, run);
  await logOnePromptVideo("project.plan.queued", { userId, projectId, taskId });
  return queued;
}

export async function planVideoProject(
  userId: string,
  projectId: string,
  override?: Partial<CreateVideoProjectInput>,
  internal?: { planningTaskId?: string },
): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  const claimedProgress = readVideoPlanningProgress(project.planJson);
  if (project.status === VideoProjectStatus.PLANNING && !internal?.planningTaskId) {
    await logOnePromptVideo("project.plan.duplicate_ignored", {
      userId,
      projectId,
      status: project.status,
      reason: "already_planning",
    }, "warn");
    return project;
  }
  if (internal?.planningTaskId && claimedProgress?.taskId !== internal.planningTaskId) {
    await logOnePromptVideo("project.plan.stale_background_task_ignored", {
      userId,
      projectId,
      taskId: internal.planningTaskId,
      activeTaskId: claimedProgress?.taskId,
    }, "warn");
    return project;
  }
  const input = normalizePlanInput({
    userPrompt: override?.userPrompt ?? project.userPrompt,
    aspectRatio: override?.aspectRatio ?? project.aspectRatio,
    durationSeconds: override?.durationSeconds ?? project.durationSeconds,
    shotCount: override?.shotCount,
    stylePreset: override?.stylePreset ?? project.stylePreset,
    referenceImageUrls: override?.referenceImageUrls ?? jsonStringArray(project.referenceImageUrls),
  });
  await logOnePromptVideo("project.plan.start", {
    userId,
    projectId,
    status: project.status,
    plannerArch: onePromptPlannerArch(),
    fallbackSegmentCount: input.shotCount,
    durationSeconds: input.durationSeconds,
    aspectRatio: input.aspectRatio,
    stylePreset: input.stylePreset,
    referenceImageCount: input.referenceImageUrls.length,
  });
  await appendProjectStageLog({
    projectId,
    title: project.title,
    stage: "script",
    event: "Script planning started",
    summary: "Collecting project settings and reference images before generating the storyboard.",
    lines: [
      `Prompt: ${input.userPrompt}`,
      `Duration: ${input.durationSeconds}s`,
      `Aspect ratio: ${input.aspectRatio}`,
      `Style preset: ${input.stylePreset || "default"}`,
      `Reference images: ${input.referenceImageUrls.length}`,
      "The planner will produce script, anchors, keyframes, segments, and prompt metadata.",
    ],
    data: {
      userId,
      status: project.status,
      plannerArch: onePromptPlannerArch(),
      durationSeconds: input.durationSeconds,
      aspectRatio: input.aspectRatio,
      stylePreset: input.stylePreset,
      referenceImageCount: input.referenceImageUrls.length,
    },
  });
  const claimed = await prisma.videoProject.updateMany({
    where: { id: project.id, status: project.status },
    data: {
      status: VideoProjectStatus.PLANNING,
      userPrompt: input.userPrompt,
      aspectRatio: input.aspectRatio,
      durationSeconds: input.durationSeconds,
      stylePreset: input.stylePreset ?? "",
      referenceImageUrls: input.referenceImageUrls,
      errorMessage: null,
    },
  });
  if (!claimed.count) {
    const latest = await requireVideoProject(userId, projectId);
    await logOnePromptVideo("project.plan.duplicate_ignored", {
      userId,
      projectId,
      originalStatus: project.status,
      latestStatus: latest.status,
      reason: "planning_claim_lost",
    }, "warn");
    return latest;
  }
  let planningStateWrite = Promise.resolve();
  let plannerProgress = claimedProgress;
  const writePlanningEnvelope = (patch: Record<string, unknown>): Promise<void> => {
    planningStateWrite = planningStateWrite.then(async () => {
      const current = await prisma.videoProject.findUnique({
        where: { id: project.id },
        select: { status: true, planJson: true },
      });
      if (!current || current.status !== VideoProjectStatus.PLANNING) return;
      const currentEnvelope = isRecord(current.planJson) ? current.planJson : {};
      const activeProgress = readVideoPlanningProgress(current.planJson);
      if (internal?.planningTaskId && activeProgress?.taskId !== internal.planningTaskId) return;
      await prisma.videoProject.update({
        where: { id: project.id },
        data: {
          planJson: { ...currentEnvelope, ...patch } as unknown as Prisma.InputJsonValue,
        },
      });
    });
    return planningStateWrite;
  };
  const savePlannerCheckpoint = (checkpoint: AliyunStoryboardPlannerCheckpoint): Promise<void> => {
    return writePlanningEnvelope({ plannerCheckpoint: checkpoint }).then(async () => {
      await logOnePromptVideo("project.plan.checkpoint.saved", {
        userId,
        projectId,
        hasPlanningRaw: checkpoint.planningRaw !== undefined,
        hasStoryboardArtistPlan: Boolean(checkpoint.storyboardArtistPlan),
        completedShotDecomposerSegments: Object.keys(checkpoint.shotDecomposerSegmentPlans ?? {}).map(Number).sort((a, b) => a - b),
      });
    });
  };
  const savePlannerProgress = (update: AliyunStoryboardProgressUpdate): Promise<void> => {
    const now = new Date().toISOString();
    const previous = plannerProgress ?? {
      taskId: internal?.planningTaskId ?? randomUUID(),
      status: "running" as const,
      stage: "queued" as const,
      completedSteps: 0,
      totalSteps: 4,
      completedSegments: 0,
      totalSegments: 0,
      detailZh: "正在启动剧本规划。",
      detailEn: "Starting storyboard planning.",
      startedAt: now,
      updatedAt: now,
      metrics: {
        jsonRepairCount: 0,
        jsonRepairDurationMs: 0,
        singleTakeRepairCount: 0,
        singleTakeRepairDurationMs: 0,
      },
    };
    const delta = update.metricsDelta ?? {};
    plannerProgress = {
      ...previous,
      workerId: planningWorkerId,
      heartbeatAt: now,
      leaseExpiresAt: new Date(Date.now() + PLANNING_LEASE_MS).toISOString(),
      status: update.stage === "complete" ? "completed" : update.stage === "failed" ? "failed" : "running",
      stage: update.stage,
      completedSteps: update.completedSteps ?? previous.completedSteps,
      totalSteps: update.totalSteps ?? previous.totalSteps,
      currentSegmentNo: update.currentSegmentNo ?? previous.currentSegmentNo,
      completedSegments: update.completedSegments ?? previous.completedSegments,
      totalSegments: update.totalSegments ?? previous.totalSegments,
      attempt: update.attempt ?? previous.attempt,
      detailZh: update.detailZh ?? previous.detailZh,
      detailEn: update.detailEn ?? previous.detailEn,
      updatedAt: now,
      metrics: {
        jsonRepairCount: previous.metrics.jsonRepairCount + (delta.jsonRepairCount ?? 0),
        jsonRepairDurationMs: previous.metrics.jsonRepairDurationMs + (delta.jsonRepairDurationMs ?? 0),
        singleTakeRepairCount: previous.metrics.singleTakeRepairCount + (delta.singleTakeRepairCount ?? 0),
        singleTakeRepairDurationMs: previous.metrics.singleTakeRepairDurationMs + (delta.singleTakeRepairDurationMs ?? 0),
      },
    };
    return writePlanningEnvelope({ plannerProgress }).then(() => logOnePromptVideo("project.plan.progress", {
      userId,
      projectId,
      taskId: plannerProgress?.taskId,
      stage: plannerProgress?.stage,
      completedSteps: plannerProgress?.completedSteps,
      totalSteps: plannerProgress?.totalSteps,
      completedSegments: plannerProgress?.completedSegments,
      totalSegments: plannerProgress?.totalSegments,
      attempt: plannerProgress?.attempt,
      metrics: plannerProgress?.metrics,
    }));
  };
  let plan: OnePromptVideoPlan;
  try {
    plan = await createPlanForPlannerArch(input, { userId, projectId }, {
      checkpoint: project.planJson,
      onCheckpoint: savePlannerCheckpoint,
      onProgress: savePlannerProgress,
    });
    plan = ensureProjectAssetLibrary(plan, input);
    const storyRolloutConfig = readStoryRolloutConfig();
    if (shouldEvaluateStoryQuality(storyRolloutConfig)) {
      plan = withStoryQualityGate(plan);
      const storyRewriteDecision = decideStoryRewrite(plan.storyQualityReport);
      if (storyRewriteDecision.shouldRewrite && shouldRequireStoryQualityReview(storyRolloutConfig)) {
        plan = markStoryRewriteRequired(plan, plan.storyQualityReport?.autoRewriteAttempts ?? 0, storyRewriteDecision);
      }
    } else {
      plan = {
        ...plan,
        plannerWarnings: [
          ...(plan.plannerWarnings ?? []),
          "story quality gate disabled by ONE_PROMPT_VIDEO_STORY_GATE=off",
        ],
      };
    }
    await logOnePromptVideo("story_quality_gate.report", {
      userId,
      projectId,
      storyGateMode: storyRolloutConfig.storyGateMode,
      storyRewriteMax: storyRolloutConfig.storyRewriteMax,
      shotGroupingMode: storyRolloutConfig.shotGroupingMode,
      passed: plan.storyQualityReport?.passed,
      score: plan.storyQualityReport?.score,
      rewriteRequired: plan.storyQualityReport?.rewriteRequired,
      rewriteFromStage: plan.storyQualityReport?.rewriteFromStage,
      autoRewriteAttempts: plan.storyQualityReport?.autoRewriteAttempts,
      rewriteReasons: plan.storyQualityReport?.rewriteReasons ?? [],
      issueCodes: plan.storyQualityReport?.issueCodes ?? [],
      issues: (plan.storyQualityReport?.issues ?? []).map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        beatId: issue.beatId,
        segmentNo: issue.segmentNo,
        messageZh: issue.messageZh,
      })),
    }, (plan.storyQualityReport?.issues?.length ?? 0) > 0 ? "warn" : "info");
  } catch (error) {
    await savePlannerProgress({
      stage: "failed",
      detailZh: error instanceof Error ? error.message : "剧本规划失败。",
      detailEn: error instanceof Error ? error.message : "Storyboard planning failed.",
    }).catch(() => undefined);
    await planningStateWrite.catch((checkpointError) => logOnePromptVideo("project.plan.checkpoint.flush_failed", {
      userId,
      projectId,
      error: errorForLog(checkpointError),
    }, "error"));
    const current = await prisma.videoProject.findUnique({
      where: { id: project.id },
      select: { status: true, errorMessage: true },
    });
    if (!current || !isManuallyStopped(current)) {
      await prisma.videoProject.update({
        where: { id: project.id },
        data: {
          status: VideoProjectStatus.FAILED,
          errorMessage: error instanceof Error ? error.message : "Plan generation failed",
        },
      });
    }
    await logOnePromptVideo("project.plan.error", { userId, projectId, ...errorForLog(error) }, "error");
    await writeStageErrorLog({
      projectId,
      title: project.title,
      stage: "script",
      event: "Script planning failed",
      error,
      context: {
        userId,
        durationSeconds: input.durationSeconds,
        aspectRatio: input.aspectRatio,
        stylePreset: input.stylePreset,
      },
    });
    throw error;
  }

  const appliedProject = await prisma.$transaction(async (tx) => {
    const current = await tx.videoProject.findUnique({
      where: { id: project.id },
      include: PROJECT_INCLUDE,
    });
    if (current && isManuallyStopped(current)) {
      await logOnePromptVideo("project.plan.cancelled.skip_apply", { userId, projectId });
      return current;
    }
    await tx.videoProject.update({
      where: { id: project.id },
      data: {
        status: VideoProjectStatus.PLANNING,
        userPrompt: input.userPrompt,
        aspectRatio: input.aspectRatio,
        durationSeconds: input.durationSeconds,
        stylePreset: input.stylePreset ?? "",
        referenceImageUrls: input.referenceImageUrls,
      },
    });
    const preservedConsistencyAssets = approvedConsistencyAssetsForReplan(current, plan.consistencyReferences ?? []);
    await tx.videoShot.deleteMany({ where: { projectId: project.id } });
    await tx.videoSegment.deleteMany({ where: { projectId: project.id } });
    await tx.videoKeyframe.deleteMany({ where: { projectId: project.id } });
    const consistencyKeyframes = (plan.consistencyReferences ?? [])
      .filter((reference) => reference.needed)
      .map((reference) => {
        const preserved = preservedConsistencyAssets.get(reference.keyframeNo);
        return {
          projectId: project.id,
          keyframeNo: reference.keyframeNo,
          timeSeconds: 0,
          status: preserved ? VideoShotStatus.IMAGE_APPROVED : VideoShotStatus.SCRIPT_READY,
          purpose: reference.purpose,
          scene: reference.scene,
          characterState: reference.characterState,
          productState: reference.productState,
          imagePrompt: reference.imagePromptZh ?? reference.imagePrompt,
          negativePrompt: reference.negativePrompt,
          imageUrl: preserved?.imageUrl ?? null,
          imageTaskId: null,
          qualityScore: preserved?.qualityScore ?? null,
          locked: Boolean(preserved),
          errorMessage: null,
        };
      });
    await tx.videoKeyframe.createMany({
      data: [
        ...consistencyKeyframes,
        ...plan.keyframes.map((keyframe) => ({
          projectId: project.id,
          keyframeNo: keyframe.keyframeNo,
          timeSeconds: keyframe.timeSeconds,
          status: VideoShotStatus.SCRIPT_READY,
          purpose: keyframe.purpose,
          scene: keyframe.scene,
          characterState: keyframe.characterState,
          productState: keyframe.productState,
          imagePrompt: keyframe.imagePromptZh ?? keyframe.imagePrompt,
          negativePrompt: keyframe.negativePrompt,
        })),
      ],
    });
    await tx.videoSegment.createMany({
      data: plan.segments.map((segment) => ({
        projectId: project.id,
        segmentNo: segment.segmentNo,
        status: VideoShotStatus.SCRIPT_READY,
        startKeyframeNo: segment.startKeyframeNo,
        endKeyframeNo: segment.endKeyframeNo,
        startTimeSeconds: segment.startTimeSeconds,
        endTimeSeconds: segment.endTimeSeconds,
        durationSeconds: segment.durationSeconds,
        purpose: segment.purpose,
        motion: segment.motion,
        camera: segment.camera,
        subjectMotion: segment.subjectMotion,
        environmentMotion: segment.environmentMotion,
        videoPrompt: segment.videoPromptZh ?? segment.videoPrompt,
        negativePrompt: segment.negativePrompt,
        subtitle: segment.subtitle,
      })),
    });
    (plan as unknown as Record<string, unknown>).rolloutFlags = createOnePromptRolloutSnapshot();
    materializeTransitionProductionArtifacts(plan, current?.planJson);
    ensurePlanArtifactMetadata(plan as unknown as Record<string, unknown>);
    const updated = await tx.videoProject.update({
      where: { id: project.id },
      data: {
        status: VideoProjectStatus.PLAN_REVIEW,
        title: plan.title,
        planJson: plan as unknown as Prisma.InputJsonValue,
      },
      include: PROJECT_INCLUDE,
    });
    const billing = await consumeUserBalanceInTransaction(
      tx,
      userId,
      ONE_PROMPT_VIDEO_COST_CREDITS,
      `婵炴垶鎸撮崑鎾绘煕濞嗗秴鍔ラ柣锔跨矙楠炲骞囬纰辨毈闂?{updated.title || project.id}`,
      `one-prompt-video:${project.id}`,
    );
    await logOnePromptVideo("project.plan.success", {
      userId,
      projectId,
      title: updated.title,
      status: updated.status,
      chargedCredits: ONE_PROMPT_VIDEO_COST_CREDITS,
      balanceAfter: billing.balanceAfter,
      keyframeCount: updated.keyframes.length,
      segmentCount: updated.segments.length,
      segments: updated.segments.map((segment) => ({
        id: segment.id,
        segmentNo: segment.segmentNo,
        startKeyframeNo: segment.startKeyframeNo,
        endKeyframeNo: segment.endKeyframeNo,
        durationSeconds: segment.durationSeconds,
      })),
    });
    await writeProjectOverviewLog({
      userId,
      projectId: project.id,
      title: updated.title,
      prompt: input.userPrompt,
      aspectRatio: input.aspectRatio,
      durationSeconds: input.durationSeconds,
      stylePreset: input.stylePreset,
      referenceImageCount: input.referenceImageUrls.length,
      status: updated.status,
    });
    await writeScriptBreakdownLog({
      userId,
      projectId: project.id,
      input,
      plan,
    });
    return updated;
  });
  if (appliedProject.planJson) await mirrorPlanArtifactsToTables(appliedProject.id, appliedProject.planJson);
  return appliedProject;
}

export async function updateVideoShot(
  userId: string,
  projectId: string,
  shotId: string,
  input: UpdateShotInput,
): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  let approvedFrontKeyframeNo: number | undefined;
  let unlockedParentKeyframeNo: number | undefined;
  let removedMicroShotArtifactIds: string[] = [];
  const segment = project.segments.find((item) => item.id === shotId);
  const updatedFields: string[] = [];
  if (segment) {
    if (Array.isArray(input.microShots)) {
      const previousMicroShots = readPlanMicroShots(readPlanSegmentMap(project.planJson).get(segment.segmentNo));
      if (previousMicroShots.length !== input.microShots.length) {
        // Micro-shot numbers are normalized on save, so after an insertion or
        // deletion every historical candidate for this segment may point at a
        // different logical checkpoint. Remove those stale async writers.
        removedMicroShotArtifactIds = previousMicroShots.map((item) =>
          imageArtifactIdForMicroShot(segment.segmentNo, item.microShotNo)
        );
      }
    }
    const data: Prisma.VideoSegmentUpdateInput = {};
    if (typeof input.purpose === "string") data.purpose = input.purpose;
    if (typeof input.camera === "string") data.camera = input.camera;
    if (typeof input.action === "string") data.motion = input.action;
    if (typeof input.videoPrompt === "string") data.videoPrompt = input.videoPrompt;
    if (typeof input.negativePrompt === "string") data.negativePrompt = input.negativePrompt;
    if (typeof input.subtitle === "string") data.subtitle = input.subtitle;
    if (typeof input.durationSeconds === "number") {
      data.durationSeconds = Math.max(3, Math.min(15, Math.round(input.durationSeconds)));
    }
    if (typeof input.locked === "boolean") {
      data.locked = input.locked;
      data.status = input.locked ? VideoShotStatus.CLIP_APPROVED : segment.clipUrl ? VideoShotStatus.CLIP_READY : VideoShotStatus.CLIP_PENDING;
    }
    if (Object.keys(data).length) {
      await prisma.videoSegment.update({ where: { id: shotId, projectId }, data });
      updatedFields.push(...Object.keys(data));
    }
    if (typeof input.imagePrompt === "string") {
      await prisma.videoKeyframe.updateMany({
        where: { projectId, keyframeNo: segment.startKeyframeNo },
        data: { imagePrompt: input.imagePrompt },
      });
      updatedFields.push("imagePrompt");
    }
    if (Array.isArray(input.microShots)) updatedFields.push("microShots");
    await syncPlanJsonFromShots(projectId, {
      shotId,
      locale: input.locale,
      microShots: input.microShots,
      purposeUpdated: typeof input.purpose === "string",
      imagePromptUpdated: typeof input.imagePrompt === "string",
      negativePromptUpdated: typeof input.negativePrompt === "string",
    });
  } else {
    const keyframe = project.keyframes.find((item) => item.id === shotId);
    if (keyframe) {
      const data: Prisma.VideoKeyframeUpdateInput = {};
      if (typeof input.purpose === "string") data.purpose = input.purpose;
      if (typeof input.imagePrompt === "string") data.imagePrompt = input.imagePrompt;
      if (typeof input.negativePrompt === "string") data.negativePrompt = input.negativePrompt;
      if (typeof input.locked === "boolean") {
        data.locked = input.locked;
        data.status = input.locked
          ? VideoShotStatus.IMAGE_APPROVED
          : keyframe.imageUrl
            ? VideoShotStatus.IMAGE_READY
            : VideoShotStatus.SCRIPT_READY;
        const reference = readPlanConsistencyReferenceMap(project.planJson).get(keyframe.keyframeNo);
        if (input.locked && keyframe.keyframeNo < 0 && readPlanShotString(reference, ["assetView", "asset_view"]) === "front") {
          approvedFrontKeyframeNo = keyframe.keyframeNo;
        }
        if (!input.locked && keyframe.keyframeNo >= 0) unlockedParentKeyframeNo = keyframe.keyframeNo;
      }
      if (Object.keys(data).length) {
        await prisma.videoKeyframe.update({ where: { id: shotId, projectId }, data });
        updatedFields.push(...Object.keys(data));
      }
      await syncPlanJsonFromShots(projectId, {
        shotId,
        locale: input.locale,
        purposeUpdated: typeof input.purpose === "string",
        imagePromptUpdated: typeof input.imagePrompt === "string",
        negativePromptUpdated: typeof input.negativePrompt === "string",
      });
    } else {
    const data: Prisma.VideoShotUpdateInput = {};
    if (typeof input.purpose === "string") data.purpose = input.purpose;
    if (typeof input.camera === "string") data.camera = input.camera;
    if (typeof input.action === "string") data.action = input.action;
    if (typeof input.imagePrompt === "string") data.imagePrompt = input.imagePrompt;
    if (typeof input.videoPrompt === "string") data.videoPrompt = input.videoPrompt;
    if (typeof input.negativePrompt === "string") data.negativePrompt = input.negativePrompt;
    if (typeof input.subtitle === "string") data.subtitle = input.subtitle;
    if (typeof input.durationSeconds === "number") data.durationSeconds = Math.max(1, Math.min(10, Math.round(input.durationSeconds)));
    if (typeof input.locked === "boolean") {
      data.locked = input.locked;
      data.status = input.locked ? VideoShotStatus.IMAGE_APPROVED : VideoShotStatus.IMAGE_READY;
    }
    await prisma.videoShot.update({ where: { id: shotId, projectId }, data });
    updatedFields.push(...Object.keys(data));
    await syncPlanJsonFromShots(projectId, {
      shotId,
      locale: input.locale,
      purposeUpdated: typeof input.purpose === "string",
      imagePromptUpdated: typeof input.imagePrompt === "string",
      negativePromptUpdated: typeof input.negativePrompt === "string",
      });
    }
  }
  if (removedMicroShotArtifactIds.length) {
    await prisma.videoGenerationCandidate.deleteMany({
      where: {
        projectId,
        targetId: shotId,
        kind: "micro_shot_image",
      },
    });
  }
  await logOnePromptVideo("shot.update.success", {
    userId,
    projectId,
    shotId,
    updatedFields,
  });
  if (unlockedParentKeyframeNo !== undefined) {
    await invalidateTransitionReferencesForParent(projectId, unlockedParentKeyframeNo, "Parent-camera keyframe was unlocked; transition reference approval must be renewed.");
  }
  let updatedProject = await requireVideoProject(userId, projectId);
  if (approvedFrontKeyframeNo !== undefined) {
    const hasReadyDerivedViews = updatedProject.keyframes.some((keyframe) =>
      keyframe.keyframeNo < 0 && !keyframe.imageUrl && isAssetViewGenerationReady(updatedProject, keyframe.keyframeNo)
    );
    if (hasReadyDerivedViews) {
      updatedProject = await prisma.videoProject.update({
        where: { id: projectId },
        data: { status: VideoProjectStatus.IMAGE_GENERATING, errorMessage: null },
        include: PROJECT_INCLUDE,
      });
      await submitNextImageTask({
        userId,
        projectId,
        keyframes: updatedProject.keyframes,
        logEventPrefix: "asset_library.front_approved",
      });
      updatedProject = await requireVideoProject(userId, projectId);
    }
  }
  return updatedProject;
}

export async function approveVideoPlan(userId: string, projectId: string): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  const assetKeyframes = project.keyframes.filter((keyframe) => isConsistencyKeyframeNo(keyframe.keyframeNo));
  const assetLibraryFirst = assetKeyframes.length > 0;
  await logOnePromptVideo("image.batch.submit.start", {
    userId,
    projectId,
    keyframeCount: project.keyframes.length,
    assetCount: assetKeyframes.length,
    boundaryCount: project.keyframes.length - assetKeyframes.length,
    assetLibraryFirst,
    status: project.status,
  });
  await appendProjectStageLog({
    projectId,
    title: project.title,
    stage: "keyframes",
    event: assetLibraryFirst ? "Asset library review started" : "Keyframe review started",
    summary: assetLibraryFirst
      ? "Generate and review asset-library references first. Boundary keyframes start only after asset approval."
      : "Reviewing boundary keyframes and consistency reference frames before image generation.",
    lines: (assetLibraryFirst ? assetKeyframes : project.keyframes).map((keyframe) => {
      const label = keyframe.keyframeNo < 0 ? "Reference" : "Boundary";
      return `${label} KF${keyframe.keyframeNo}: ${keyframe.purpose || "untitled"}, time=${keyframe.timeSeconds}s, prompt=${(keyframe.imagePrompt || "").slice(0, 260)}`;
    }),
    data: {
      userId,
      status: project.status,
      keyframeCount: project.keyframes.length,
      assetCount: assetKeyframes.length,
      assetLibraryFirst,
      consistencyReferenceCount: assetKeyframes.length,
    },
  });

  await prisma.videoKeyframe.updateMany({
    where: {
      projectId,
      ...(assetLibraryFirst ? { keyframeNo: { lt: 0 } } : {}),
      NOT: { locked: true, imageUrl: { not: null } },
    },
    data: {
      imageTaskId: null,
      imageUrl: null,
      status: VideoShotStatus.IMAGE_PENDING,
      qualityScore: null,
      errorMessage: null,
    },
  });

  const queued = await prisma.videoProject.update({
    where: { id: project.id },
    data: { status: VideoProjectStatus.IMAGE_GENERATING, errorMessage: null },
    include: PROJECT_INCLUDE,
  });
  await submitNextImageTask({
    userId,
    projectId,
    keyframes: assetLibraryFirst
      ? queued.keyframes.filter((keyframe) => isConsistencyKeyframeNo(keyframe.keyframeNo))
      : queued.keyframes,
    logEventPrefix: assetLibraryFirst ? "asset_library.batch" : "image.batch",
  });
  const updated = await requireVideoProject(userId, projectId);
  await logOnePromptVideo("image.batch.submit.done", {
    userId,
    projectId,
    status: updated.status,
    assetLibraryFirst,
    runningCount: updated.keyframes.filter((keyframe) => keyframe.status === VideoShotStatus.IMAGE_RUNNING).length,
    pendingCount: updated.keyframes.filter((keyframe) => keyframe.status === VideoShotStatus.IMAGE_PENDING).length,
  });
  await appendProjectStageLog({
    projectId,
    title: updated.title,
    stage: "keyframes",
    event: assetLibraryFirst ? "Asset library image tasks submitted" : "Keyframe image tasks submitted",
    summary: assetLibraryFirst
      ? "Asset-library reference image tasks were submitted upstream. Boundary keyframes wait for asset approval."
      : "Boundary and consistency reference image tasks were submitted upstream.",
    lines: [
      `Running: ${updated.keyframes.filter((keyframe) => keyframe.status === VideoShotStatus.IMAGE_RUNNING).length}`,
      `Pending: ${updated.keyframes.filter((keyframe) => keyframe.status === VideoShotStatus.IMAGE_PENDING).length}`,
      `Completed images: ${updated.keyframes.filter((keyframe) => Boolean(keyframe.imageUrl)).length}`,
    ],
    data: {
      userId,
      status: updated.status,
      keyframes: updated.keyframes.map((keyframe) => ({
        keyframeNo: keyframe.keyframeNo,
        status: keyframe.status,
        imageTaskId: keyframe.imageTaskId,
        hasImageUrl: Boolean(keyframe.imageUrl),
      })),
    },
  });
  return updated;
}

export async function approveAssetLibrary(userId: string, projectId: string): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  const assetKeyframes = project.keyframes.filter((keyframe) => isConsistencyKeyframeNo(keyframe.keyframeNo));
  if (!assetKeyframes.length) throw new Error("No asset-library reference images found");
  const missing = assetKeyframes.filter((keyframe) => !keyframe.imageUrl);
  if (missing.length) throw new Error("All asset-library images must be generated before approval");

  await logOnePromptVideo("asset_library.approve.start", {
    userId,
    projectId,
    assetCount: assetKeyframes.length,
    status: project.status,
  });

  await prisma.videoKeyframe.updateMany({
    where: { projectId, keyframeNo: { lt: 0 }, imageUrl: { not: null } },
    data: { status: VideoShotStatus.IMAGE_APPROVED, locked: true, errorMessage: null },
  });
  await updateProjectArtifactStatus(
    projectId,
    assetKeyframes.map((keyframe) => imageArtifactIdForKeyframeNo(keyframe.keyframeNo)),
    "approved",
    { retryFromStage: "generation" },
  );

  const latest = await requireVideoProject(userId, projectId);
  const missingBoundaryKeyframes = latest.keyframes.filter((keyframe) => !isConsistencyKeyframeNo(keyframe.keyframeNo) && !keyframe.imageUrl);
  if (missingBoundaryKeyframes.length) {
    await prisma.videoKeyframe.updateMany({
      where: { projectId, keyframeNo: { gt: 0 }, imageUrl: null },
      data: {
        status: VideoShotStatus.IMAGE_PENDING,
        imageTaskId: null,
        qualityScore: null,
        errorMessage: null,
        locked: false,
      },
    });
    const queued = await prisma.videoProject.update({
      where: { id: projectId },
      data: { status: VideoProjectStatus.IMAGE_GENERATING, errorMessage: null },
      include: PROJECT_INCLUDE,
    });
    await submitNextImageTask({
      userId,
      projectId,
      keyframes: queued.keyframes,
      logEventPrefix: "asset_library.approve",
    });
    const updated = await requireVideoProject(userId, projectId);
    await logOnePromptVideo("asset_library.approve.boundary_submitted", {
      userId,
      projectId,
      status: updated.status,
      missingBoundaryCount: missingBoundaryKeyframes.length,
    });
    return updated;
  }

  const updated = await prisma.videoProject.update({
    where: { id: projectId },
    data: { status: VideoProjectStatus.IMAGE_REVIEW, errorMessage: null },
    include: PROJECT_INCLUDE,
  });
  await logOnePromptVideo("asset_library.approve.done", {
    userId,
    projectId,
    status: updated.status,
    assetCount: assetKeyframes.length,
  });
  return updated;
}

type ImageCandidateLearningSummary = {
  historicalCandidateCount: number;
  sourceCandidateIds: string[];
  promptAddon: string;
  referenceImageUrls: string[];
  referenceUsageNotes: string[];
  debugSummary: Record<string, unknown>;
};

function buildImageCandidateLearningSummary(
  project: VideoProjectWithShots,
  artifactId: string,
  currentImageUrl?: string | null,
): ImageCandidateLearningSummary {
  const historical = project.generationCandidates.filter((candidate) => candidate.artifactId === artifactId);
  const evaluated = historical.flatMap((candidate) => {
    if (!candidate.qualityReport || !isRecord(candidate.qualityReport)) return [];
    return [{ candidate, report: candidate.qualityReport as unknown as GenerationQualityReport }];
  });
  const ranked = [...evaluated]
    .filter(({ candidate }) => Boolean(candidate.mediaUrl))
    .sort((a, b) => {
      const scoreDelta =
        (b.candidate.compositeScore ?? generationQualityCompositeScore(b.report)) -
        (a.candidate.compositeScore ?? generationQualityCompositeScore(a.report));
      if (scoreDelta !== 0) return scoreDelta;
      const createdDelta = b.candidate.createdAt.getTime() - a.candidate.createdAt.getTime();
      return createdDelta !== 0 ? createdDelta : b.candidate.candidateNo - a.candidate.candidateNo;
    });
  const strongest = ranked[0];
  const latestEvaluated = [...evaluated].sort((a, b) => b.candidate.candidateNo - a.candidate.candidateNo)[0];
  const activeLedgerIssues = (latestEvaluated?.report.issueLedger ?? []).filter((issue) =>
    (issue.status === "open" || issue.status === "regressed")
    && issue.applicableStage === "static_image"
    && issue.severity !== "advisory"
  );
  const strongDimensions = strongest ? [
    strongest.report.identityScore >= 80 ? `identity ${strongest.report.identityScore.toFixed(1)}` : "",
    strongest.report.layoutScore >= 80 ? `layout ${strongest.report.layoutScore.toFixed(1)}` : "",
    strongest.report.promptAlignmentScore >= 80 ? `prompt alignment ${strongest.report.promptAlignmentScore.toFixed(1)}` : "",
    strongest.report.continuityScore >= 80 ? `continuity ${strongest.report.continuityScore.toFixed(1)}` : "",
  ].filter(Boolean) : [];
  const failureIssues = uniqueStrings((activeLedgerIssues.length
    ? activeLedgerIssues.map((issue) => issue.summary)
    : latestEvaluated?.report.passed === false ? latestEvaluated.report.artifactIssues ?? [] : [])
    .filter((issue) => !/^Unverified evaluator contract suspicion:/i.test(issue))
    .map((issue) => clipText(issue, 320)))
    .slice(0, 10);
  const retryInstructions = uniqueStrings(evaluated
    .filter(({ candidate, report }) => candidate.id === latestEvaluated?.candidate.id && !report.passed && report.retryInstruction && (!report.contractConflicts?.length || report.contractConflictsVerified === true))
    .map(({ report }) => clipText(report.retryInstruction as string, 520)))
    .slice(0, 6);
  const correctionActions = uniqueStrings(evaluated.flatMap(({ candidate, report }) => candidate.id !== latestEvaluated?.candidate.id || (report.contractConflicts?.length && report.contractConflictsVerified !== true) ? [] : (report.correctionActions ?? []).map((action) => {
    const evidence = action.evidenceStatus || typeof action.confidence === "number"
      ? ` Evidence: ${action.evidenceStatus ?? "confirmed"}${typeof action.confidence === "number" ? `, confidence ${action.confidence.toFixed(2)}` : ""}.`
      : "";
    const normalizedRegion = action.normalizedRegion
      ? ` Region x=${action.normalizedRegion.xMin.toFixed(2)}..${action.normalizedRegion.xMax.toFixed(2)}, y=${action.normalizedRegion.yMin.toFixed(2)}..${action.normalizedRegion.yMax.toFixed(2)} in normalized top-left-origin coordinates.`
      : "";
    const targetPoint = action.targetPoint
      ? ` Target point=(${action.targetPoint.x.toFixed(2)},${action.targetPoint.y.toFixed(2)}).`
      : "";
    const executionParameters = action.executionParameters && Object.keys(action.executionParameters).length
      ? ` Parameters=${JSON.stringify(action.executionParameters)}.`
      : "";
    const tolerance = action.tolerance ? ` Tolerance: ${action.tolerance}.` : "";
    const preserve = action.preserve?.length ? ` Preserve: ${action.preserve.join(", ")}.` : "";
    return `[${action.region}] ${action.element}: change ${action.observed} to ${action.target}. ${action.instruction}.${evidence}${normalizedRegion}${targetPoint}${executionParameters}${tolerance}${preserve}`;
  }))).slice(0, 3);
  const contractConflicts = uniqueStrings(evaluated.flatMap(({ report }) => report.contractConflictsVerified === true ? report.contractConflicts ?? [] : [])).slice(0, 10);
  const suspectedContractConflicts = uniqueStrings(evaluated.flatMap(({ report }) => report.suspectedContractConflicts ?? (report.contractConflictsVerified === true ? [] : report.contractConflicts ?? []))).slice(0, 10);
  const passedCount = evaluated.filter(({ report }) => report.passed).length;
  const acceptedCount = historical.filter((candidate) => candidate.userAccepted).length;
  const latestWithMedia = [...historical]
    .filter((candidate) => Boolean(candidate.mediaUrl))
    .sort((a, b) => {
      const createdDelta = b.createdAt.getTime() - a.createdAt.getTime();
      return createdDelta !== 0 ? createdDelta : b.candidateNo - a.candidateNo;
    })[0];
  const baselineCandidate = latestWithMedia;
  const baselineUrl = baselineCandidate?.mediaUrl || currentImageUrl || "";
  const sourceCandidateIds = uniqueStrings([
    ...evaluated.map(({ candidate }) => candidate.id),
    ...historical.filter((candidate) => candidate.errorMessage).map((candidate) => candidate.id),
  ]);
  const promptAddon = historical.length ? [
    "INCREMENTAL CANDIDATE IMPROVEMENT — LEARN FROM ALL PRIOR ATTEMPTS",
    `This is candidate #${historical.length + 1}. Preserve every earlier candidate as history; do not restart the exploration from scratch.`,
    `Prior attempts reviewed: ${historical.length}; visually evaluated: ${evaluated.length}; system-passed: ${passedCount}; manually accepted: ${acceptedCount}.`,
    strongDimensions.length
      ? `Preserve the strongest verified qualities from earlier attempts: ${strongDimensions.join(", ")}.`
      : "Preserve any correct identity, composition, subject count, and scene structure visible in the strongest earlier attempt.",
    failureIssues.length ? "Do not repeat these observed failures:\n" + failureIssues.map((issue) => `- ${issue}`).join("\n") : "",
    correctionActions.length ? "Execute these accumulated, spatially precise corrections:\n" + correctionActions.map((action) => `- ${action}`).join("\n") : "",
    retryInstructions.length ? "Apply the accumulated visual-judge corrections:\n" + retryInstructions.map((instruction) => `- ${instruction}`).join("\n") : "",
    "Concretize any older vague feedback before rendering: turn words such as near, proper, improve, fix, or more accurate into one exact visible target supported by the authoritative frame contract. Use viewer-left/viewer-right only, never character-relative direction; normalized coordinates use top-left=(0,0), bottom-right=(1,1). Specify the region, target point, angle range/count/format/pose/color, tolerance, and keep-unmodified surroundings; never invent a target that conflicts with the contract.",
    contractConflicts.length ? "Previously detected contract conflicts must be resolved using the authoritative frame contract before rendering; never obey both sides:\n" + contractConflicts.map((conflict) => `- ${conflict}`).join("\n") : "",
    baselineUrl
      ? "The historical baseline image is provided only for its successful identity, composition, and scene structure. Correct its known logic, text, timer, score, lighting, anatomy, and artifact defects instead of copying them."
      : "",
    "The new candidate must be a measurable improvement over the strongest prior candidate while still obeying the authoritative frame and narrative contracts.",
  ].filter(Boolean).join("\n") : "";
  return {
    historicalCandidateCount: historical.length,
    sourceCandidateIds,
    promptAddon,
    referenceImageUrls: baselineUrl ? [baselineUrl] : [],
    referenceUsageNotes: baselineUrl
      ? ["Latest historical candidate is an improvement baseline only. Preserve its verified strengths and apply the requested delta corrections; never treat its defective score, timer, text, lighting, anatomy, or narrative state as authoritative."]
      : [],
    debugSummary: {
      historicalCandidateCount: historical.length,
      evaluatedCandidateCount: evaluated.length,
      passedCandidateCount: passedCount,
      manuallyAcceptedCandidateCount: acceptedCount,
      strongestCandidateId: strongest?.candidate.id,
      baselineCandidateId: baselineCandidate?.id,
      baselineSelectionRule: "latest_available_candidate",
      strongDimensions,
      accumulatedFailureIssues: failureIssues,
      accumulatedRetryInstructions: retryInstructions,
      accumulatedCorrectionActions: correctionActions,
      accumulatedContractConflicts: contractConflicts,
      ignoredUnverifiedContractSuspicions: suspectedContractConflicts,
      sourceCandidateIds,
    },
  };
}

export async function regenerateShotImage(
  userId: string,
  projectId: string,
  shotId: string,
  options: { recovery?: boolean } = {},
): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  const segment = project.segments.find((item) => item.id === shotId);
  const keyframe = project.keyframes.find((item) => item.id === shotId) ??
    (segment ? project.keyframes.find((item) => item.keyframeNo === segment.startKeyframeNo) : undefined);
  if (!keyframe) throw new Error("Keyframe not found");
  if (options.recovery && keyframe.imageUrl && (keyframe.status === VideoShotStatus.IMAGE_READY || keyframe.status === VideoShotStatus.IMAGE_APPROVED)) {
    return project;
  }

  await logOnePromptVideo("image.regenerate.start", {
    userId,
    projectId,
    keyframeId: keyframe.id,
    keyframeNo: keyframe.keyframeNo,
    wasLocked: keyframe.locked,
  });
  const artifactId = imageArtifactIdForKeyframeNo(keyframe.keyframeNo);
  const learning = buildImageCandidateLearningSummary(project, artifactId, keyframe.imageUrl);
  const draftPrompt = compileImagePromptForKeyframe(project, keyframe);
  const referenceSelection = await selectReferenceImagesForKeyframe(project, keyframe, draftPrompt.prompt);
  const compiled = compileImagePromptForKeyframe(project, keyframe, {
    ...referenceSelection.output,
    finalTextPrompt: draftPrompt.prompt,
  });
  assertCompiledVisualContractReady(compiled);
  const learnedPrompt = [compiled.prompt, learning.promptAddon].filter(Boolean).join("\n\n");
  const learnedReferenceUrls = uniqueStrings([
    ...learning.referenceImageUrls,
    ...(compiled.referenceImageUrls ?? []),
  ]).slice(0, ONE_PROMPT_MAX_REFERENCE_IMAGES);
  const authoritativeAnchorLocks = consistencyAnchorLocksForPrompt(
    project.planJson,
    readPlanStringArray(readPlanKeyframeMap(project.planJson).get(keyframe.keyframeNo), ["usesConsistencyAnchors", "uses_consistency_anchors"]),
  );
  const learnedReferenceUsageNotes = uniqueStrings([
    ...learning.referenceUsageNotes,
    ...(referenceSelection.output.usageNotes ?? []),
    authoritativeAnchorLocks ? `AUTHORITATIVE ANCHOR CONTRACTS — visible words and markings in these locks are required, not forbidden:\n${authoritativeAnchorLocks}` : "",
  ]);
  await saveReferenceSelectionOutput(projectId, {
    ...referenceSelection.output,
    selectedReferenceUrls: learnedReferenceUrls,
    finalTextPrompt: learnedPrompt,
  });
  await savePromptDebugArtifact(projectId, {
    ...compiled.debugArtifact,
    inputs: {
      ...compiled.debugArtifact.inputs,
      incrementalCandidateLearning: learning.debugSummary,
    },
    selectedReferenceUrls: learnedReferenceUrls,
    referenceUsageNotes: learnedReferenceUsageNotes,
    finalPrompt: learnedPrompt,
    rules: uniqueStrings([...compiled.debugArtifact.rules, "incremental_candidate_learning", "preserve_candidate_history"]),
  });
  if (options.recovery) {
    const claim = await prisma.videoKeyframe.updateMany({
      where: {
        id: keyframe.id,
        imageTaskId: null,
        imageUrl: keyframe.imageUrl,
        status: { in: [VideoShotStatus.FAILED, VideoShotStatus.IMAGE_PENDING] },
      },
      data: { status: VideoShotStatus.IMAGE_RUNNING, errorMessage: null },
    });
    if (claim.count !== 1) {
      await logOnePromptVideo("image.regenerate.skip_stale_recovery", { userId, projectId, keyframeId: keyframe.id, keyframeNo: keyframe.keyframeNo });
      return requireVideoProject(userId, projectId);
    }
  }
  const taskId = await createImageCandidateBatch({
    project,
    artifactId,
    targetId: keyframe.id,
    kind: "keyframe_image",
    prompt: learnedPrompt,
    negativePrompt: compiled.negativePrompt,
    referenceImageUrls: learnedReferenceUrls,
    seedBase: Date.now() % 2147483647,
    candidateCount: 1,
    metadata: {
      isRegeneration: Boolean(keyframe.imageUrl),
      retryCycleId: randomUUID(),
      incrementalRegeneration: true,
      historicalCandidateCount: learning.historicalCandidateCount,
      learnedFromCandidateIds: learning.sourceCandidateIds,
      keyframeNo: keyframe.keyframeNo,
      targetContract: readPlanKeyframeMap(project.planJson).get(keyframe.keyframeNo) ?? { purpose: keyframe.purpose, imagePrompt: keyframe.imagePrompt },
      visualContract: compiled.debugArtifact.inputs.visualContract,
      selectedReferenceUrls: learnedReferenceUrls,
      referenceUsageNotes: learnedReferenceUsageNotes,
    },
  });
  await prisma.videoKeyframe.update({
    where: { id: keyframe.id },
    data: {
      imageTaskId: taskId,
      status: VideoShotStatus.IMAGE_RUNNING,
      qualityScore: null,
      errorMessage: null,
      locked: keyframe.locked,
    },
  });
  await updateProjectArtifactStatus(projectId, [artifactId], "generating", { retryFromStage: "generation" });

  const updated = await prisma.videoProject.update({
    where: { id: projectId },
    data: { status: VideoProjectStatus.IMAGE_GENERATING, errorMessage: null },
    include: PROJECT_INCLUDE,
  });
      await logOnePromptVideo("image.regenerate.success", { userId, projectId, keyframeId: keyframe.id, keyframeNo: keyframe.keyframeNo, imageTaskId: taskId });
  await appendProjectStageLog({
    projectId,
    title: updated.title,
    stage: "keyframes",
    event: `Regenerated keyframe KF${keyframe.keyframeNo}`,
    summary: "A keyframe image task was resubmitted with the latest prompt and references.",
    lines: [
      `Purpose: ${keyframe.purpose || "untitled"}`,
      `Task ID: ${taskId}`,
      `Historical candidates preserved: ${learning.historicalCandidateCount}`,
      `New candidate ordinal: ${learning.historicalCandidateCount + 1}`,
      `Prompt: ${learnedPrompt.slice(0, 400)}`,
    ],
    data: {
      userId,
      keyframeId: keyframe.id,
      keyframeNo: keyframe.keyframeNo,
      imageTaskId: taskId,
      historicalCandidateCount: learning.historicalCandidateCount,
      learnedFromCandidateIds: learning.sourceCandidateIds,
      referenceImageCount: learnedReferenceUrls.length,
    },
  });
  return updated;
}

export async function regenerateMicroShotImage(
  userId: string,
  projectId: string,
  shotId: string,
  microShotNo: number,
  input?: { microShot?: Partial<VideoMicroShot>; locale?: "zh" | "en" },
): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  const segment = project.segments.find((item) => item.id === shotId);
  if (!segment) throw new Error("Video segment not found");
  const planSegment = readPlanSegmentMap(project.planJson).get(segment.segmentNo);
  const microShots = readPlanMicroShots(planSegment);
  const existing = microShots.find((item) => item.microShotNo === microShotNo);
  if (!existing && !input?.microShot) throw new Error("Micro-shot not found");
  const merged = normalizeMicroShotForSegment(
    {
      ...existing,
      ...(input?.microShot ?? {}),
      microShotNo,
    },
    segment,
  );
  const imagePrompt = localizedMicroShotImagePromptForGeneration(merged, input?.locale);
  if (!imagePrompt) throw new Error("Micro-shot image prompt is required");

  await logOnePromptVideo("micro_shot.image.regenerate.start", {
    userId,
    projectId,
    segmentId: segment.id,
    segmentNo: segment.segmentNo,
    microShotNo,
  });
  const latest = await requireVideoProject(userId, projectId);
  const latestSegment = latest.segments.find((item) => item.id === shotId) ?? segment;
  const draftPrompt = compileImagePromptForMicroShot(latest, latestSegment, merged);
  const referenceSelection = await selectReferenceImagesForMicroShot(latest, latestSegment, merged, draftPrompt.prompt);
  const compiled = compileImagePromptForMicroShot(latest, latestSegment, merged, {
    ...referenceSelection.output,
    finalTextPrompt: draftPrompt.prompt,
  });
  await saveReferenceSelectionOutput(projectId, {
    ...referenceSelection.output,
    selectedReferenceUrls: referenceSelection.urls,
    finalTextPrompt: compiled.prompt,
  });
  await savePromptDebugArtifact(projectId, compiled.debugArtifact);
  const taskId = await createImageCandidateBatch({
    project: latest,
    artifactId: imageArtifactIdForMicroShot(segment.segmentNo, microShotNo),
    targetId: segment.id,
    kind: "micro_shot_image",
    prompt: compiled.prompt,
    negativePrompt: compiled.negativePrompt,
    referenceImageUrls: compiled.referenceImageUrls ?? [],
    seedBase: Math.abs(segment.segmentNo * 100 + microShotNo + Date.now()) % 2147483647,
    metadata: {
      isRegeneration: Boolean(existing?.imageUrl),
      retryCycleId: randomUUID(),
      segmentNo: segment.segmentNo,
      microShotNo,
      targetContract: merged as unknown as Record<string, unknown>,
      selectedReferenceUrls: compiled.referenceImageUrls ?? [],
      referenceUsageNotes: referenceSelection.output.usageNotes ?? [],
    },
  });

  await updatePlanMicroShot(projectId, segment.segmentNo, microShotNo, {
    ...merged,
    referenceType: merged.referenceType === "text" ? "image_prompt" : merged.referenceType ?? "image_prompt",
    imageStatus: "running",
    imageTaskId: taskId,
    imageUrl: existing?.imageUrl ?? "",
    errorMessage: "",
  });
  await updateProjectArtifactStatus(projectId, [imageArtifactIdForMicroShot(segment.segmentNo, microShotNo)], "generating", { retryFromStage: "generation" });
  await logOnePromptVideo("micro_shot.image.regenerate.success", {
    userId,
    projectId,
    segmentNo: segment.segmentNo,
    microShotNo,
    imageTaskId: taskId,
  });
  return requireVideoProject(userId, projectId);
}

export async function regenerateShotClip(
  userId: string,
  projectId: string,
  shotId: string,
): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  const segment = project.segments.find((item) => item.id === shotId);
  if (!segment) throw new Error("Video segment not found");
  const keyframeMap = new Map(project.keyframes.map((keyframe) => [keyframe.keyframeNo, keyframe]));
  const startKeyframe = keyframeMap.get(segment.startKeyframeNo);
  const endKeyframe = keyframeMap.get(segment.endKeyframeNo);
  if (!startKeyframe?.imageUrl) throw new Error("Segment start keyframe image is missing");
  if (!endKeyframe?.imageUrl) throw new Error("Segment end keyframe image is missing");
  assertPlanValidForGeneration(project.planJson, {
    stage: "video_generation",
    targetArtifactId: `segment:${segment.segmentNo}`,
    segmentNo: segment.segmentNo,
  });

  await logOnePromptVideo("clip.regenerate.start", {
    userId,
    projectId,
    segmentId: segment.id,
    segmentNo: segment.segmentNo,
  });
  const compiled = compileVideoPromptForSegment(project, segment, startKeyframe, endKeyframe);
  await savePromptDebugArtifact(projectId, compiled.debugArtifact);
  const renderDescription = readPlanSegmentRenderDescriptionMap(project.planJson).get(segment.segmentNo) ?? {};
  const taskId = await createVideoCandidateBatch({
    project,
    segment,
    prompt: compiled.prompt,
    startFrameUrl: startKeyframe.imageUrl,
    endFrameUrl: endKeyframe.imageUrl,
    metadata: {
      isRegeneration: Boolean(segment.clipUrl),
      retryCycleId: randomUUID(),
      targetContract: renderDescription,
      motionCheckpoints: readPlanMicroShots(readPlanSegmentMap(project.planJson).get(segment.segmentNo)),
      selectedReferenceUrls: selectedReferenceUrlsForPromptTarget(project.planJson, `segment:${segment.segmentNo}`),
      referenceUsageNotes: [],
    },
  });
  await prisma.videoSegment.update({
    where: { id: segment.id },
    data: {
      clipTaskId: taskId,
      status: VideoShotStatus.CLIP_RUNNING,
      locked: segment.locked,
      errorMessage: null,
    },
  });
  await updateProjectArtifactStatus(projectId, [videoArtifactIdForSegmentNo(segment.segmentNo)], "generating", { retryFromStage: "generation" });
  const updated = await prisma.videoProject.update({
    where: { id: projectId },
    data: { status: VideoProjectStatus.CLIP_GENERATING, finalVideoUrl: null, errorMessage: null },
    include: PROJECT_INCLUDE,
  });
  await logOnePromptVideo("clip.regenerate.success", {
    userId,
    projectId,
    segmentId: segment.id,
    segmentNo: segment.segmentNo,
    clipTaskId: taskId,
  });
  await appendProjectStageLog({
    projectId,
    title: updated.title,
    stage: "clips",
    event: `Regenerated clip for segment ${segment.segmentNo}`,
    summary: "A segment video task was resubmitted with the latest prompt and references.",
    lines: [
      `Start keyframe: KF${segment.startKeyframeNo}`,
      `End keyframe: KF${segment.endKeyframeNo}`,
      `Duration: ${segment.durationSeconds}s`,
      `Task ID: ${taskId}`,
      `Prompt: ${compiled.prompt.slice(0, 500)}`,
    ],
    data: {
      userId,
      segmentId: segment.id,
      segmentNo: segment.segmentNo,
      clipTaskId: taskId,
      startKeyframeUrl: startKeyframe.imageUrl,
      endKeyframeUrl: endKeyframe.imageUrl,
    },
  });
  return updated;
}

export async function rollbackVideoMedia(
  userId: string,
  projectId: string,
  input: RollbackVideoMediaInput,
): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  const key = videoMediaRevisionKey(input);
  const history = readVideoMediaRevisionHistory(project.planJson);
  const revisions = [...(history[key] ?? [])];
  const revision = revisions.pop();
  if (!revision) throw new Error("No previous media version is available");

  const plan = cloneJsonRecord(project.planJson ?? {});
  history[key] = revisions;
  if (!revisions.length) delete history[key];
  plan.mediaRevisionHistory = history;
  delete plan.media_revision_history;

  let nextStatus: VideoProjectStatus;
  await prisma.$transaction(async (tx) => {
    if (input.kind === "keyframe_image") {
      const keyframe = project.keyframes.find((item) => item.id === input.targetId);
      if (!keyframe) throw new Error("Keyframe not found");
      await tx.videoKeyframe.update({
        where: { id: keyframe.id },
        data: {
          imageUrl: revision.url,
          imageTaskId: null,
          qualityScore: null,
          status: VideoShotStatus.IMAGE_READY,
          locked: false,
          errorMessage: null,
        },
      });
      setPlanArtifactStatus(plan, [imageArtifactIdForKeyframeNo(keyframe.keyframeNo)], "ready", { retryFromStage: "generation" });
      const transitionArtifacts = transitionReferenceArtifactsFromPlan(plan as unknown as Prisma.JsonValue).map((artifact) =>
        artifact.parentKeyframeNo === keyframe.keyframeNo
          ? { ...artifact, status: "waiting_parent" as const, locked: false, errorMessage: "Parent-camera keyframe was rolled back; transition reference approval must be renewed.", updatedAt: new Date().toISOString() }
          : artifact
      );
      plan.transitionReferenceArtifacts = transitionArtifacts as unknown as Prisma.InputJsonValue;
      nextStatus = VideoProjectStatus.IMAGE_REVIEW;
    } else if (input.kind === "micro_shot_image") {
      const segment = project.segments.find((item) => item.id === input.targetId);
      const microShotNo = Number(input.microShotNo ?? revision.microShotNo);
      if (!segment || !Number.isInteger(microShotNo) || microShotNo < 1) throw new Error("Micro-shot not found");
      const patch: Partial<VideoMicroShot> = {
        imageUrl: revision.url,
        imageTaskId: "",
        imageStatus: "ready",
        errorMessage: "",
      };
      updatePlanMicroShotCollection(plan, "segments", segment.segmentNo, microShotNo, patch);
      updatePlanMicroShotCollection(plan, "shots", segment.segmentNo, microShotNo, patch);
      setPlanArtifactStatus(plan, [imageArtifactIdForMicroShot(segment.segmentNo, microShotNo)], "ready", { retryFromStage: "generation" });
      nextStatus = VideoProjectStatus.MICRO_SHOT_REVIEW;
    } else if (input.kind === "segment_clip") {
      const segment = project.segments.find((item) => item.id === input.targetId);
      if (!segment) throw new Error("Video segment not found");
      await tx.videoSegment.update({
        where: { id: segment.id },
        data: {
          clipUrl: revision.url,
          clipTaskId: null,
          qualityScore: null,
          status: VideoShotStatus.CLIP_READY,
          locked: false,
          errorMessage: null,
        },
      });
      setPlanArtifactStatus(plan, [videoArtifactIdForSegmentNo(segment.segmentNo)], "ready", { retryFromStage: "generation" });
      const bridgeArtifacts = generatedBridgeArtifactsFromPlan(plan as unknown as Prisma.JsonValue).map((artifact) =>
        artifact.fromSegmentNo === segment.segmentNo || artifact.toSegmentNo === segment.segmentNo
          ? { ...artifact, status: "planned" as const, locked: false, errorMessage: "Adjacent segment clip was rolled back; generated bridge approval must be renewed.", updatedAt: new Date().toISOString() }
          : artifact
      );
      plan.generatedBridgeArtifacts = bridgeArtifacts as unknown as Prisma.InputJsonValue;
      nextStatus = VideoProjectStatus.CLIP_REVIEW;
    } else if (input.kind === "transition_reference") {
      const artifacts = transitionReferenceArtifactsFromPlan(project.planJson);
      const index = artifacts.findIndex((item) => item.id === input.targetId);
      if (index < 0) throw new Error("Transition reference artifact not found");
      artifacts[index] = { ...artifacts[index], selectedFrameUrl: revision.url, status: "ready_for_review", locked: false, updatedAt: new Date().toISOString() };
      plan.transitionReferenceArtifacts = artifacts as unknown as Prisma.InputJsonValue;
      setPlanArtifactStatus(plan, [input.targetId], "ready", { retryFromStage: "generation" });
      nextStatus = project.status;
    } else if (input.kind === "generated_bridge") {
      const artifacts = generatedBridgeArtifactsFromPlan(project.planJson);
      const index = artifacts.findIndex((item) => item.id === input.targetId);
      if (index < 0) throw new Error("Generated bridge artifact not found");
      artifacts[index] = { ...artifacts[index], selectedVideoUrl: revision.url, status: "ready_for_review", locked: false, updatedAt: new Date().toISOString() };
      plan.generatedBridgeArtifacts = artifacts as unknown as Prisma.InputJsonValue;
      setPlanArtifactStatus(plan, [input.targetId], "ready", { retryFromStage: "generation" });
      nextStatus = VideoProjectStatus.CLIP_REVIEW;
    } else {
      if (input.kind !== "final_video") throw new Error("Unsupported media revision kind");
      setPlanArtifactStatus(plan, ["final_video"], "ready", { retryFromStage: "composition" });
      nextStatus = VideoProjectStatus.FINAL_REVIEW;
    }

    await tx.videoProject.update({
      where: { id: projectId },
      data: {
        planJson: plan as Prisma.InputJsonValue,
        status: nextStatus,
        finalVideoUrl: input.kind === "final_video" ? revision.url : input.kind === "segment_clip" ? null : project.finalVideoUrl,
        composeTaskId: null,
        errorMessage: null,
      },
    });
  });

  await logOnePromptVideo("media.revision.rollback", {
    userId,
    projectId,
    kind: input.kind,
    targetId: input.targetId,
    microShotNo: input.microShotNo,
    revisionId: revision.id,
  }, "warn");
  return requireVideoProject(userId, projectId);
}

async function submitRequiredMicroShotImageTasks(
  userId: string,
  projectId: string,
  options: { retryFailed?: boolean } = {},
): Promise<void> {
  const project = await requireVideoProject(userId, projectId);
  const planSegments = readPlanSegmentMap(project.planJson);
  for (const segment of project.segments) {
    const microShots = readPlanMicroShots(planSegments.get(segment.segmentNo));
    for (const microShot of microShots) {
      if (!isMicroShotImageRequired(microShot)) continue;
      if (microShot.imageUrl || (microShot.imageStatus === "running" && microShot.imageTaskId)) continue;
      if (microShot.imageStatus === "failed" && !options.retryFailed) continue;
      const imagePrompt = localizedMicroShotImagePromptForGeneration(microShot);
      if (!imagePrompt) continue;
      await updatePlanMicroShot(projectId, segment.segmentNo, microShot.microShotNo, {
        ...microShot,
        imageStatus: "pending",
        imageUrl: "",
        imageTaskId: "",
        errorMessage: "",
      });
      try {
        const latest = await requireVideoProject(userId, projectId);
        const latestSegment = latest.segments.find((item) => item.id === segment.id) ?? segment;
        const draftPrompt = compileImagePromptForMicroShot(latest, latestSegment, microShot);
        const referenceSelection = await selectReferenceImagesForMicroShot(latest, latestSegment, microShot, draftPrompt.prompt);
        const compiled = compileImagePromptForMicroShot(latest, latestSegment, microShot, {
          ...referenceSelection.output,
          finalTextPrompt: draftPrompt.prompt,
        });
        await saveReferenceSelectionOutput(projectId, {
          ...referenceSelection.output,
          selectedReferenceUrls: referenceSelection.urls,
          finalTextPrompt: compiled.prompt,
        });
        await savePromptDebugArtifact(projectId, compiled.debugArtifact);
        const taskId = await createImageCandidateBatch({
          project: latest,
          artifactId: imageArtifactIdForMicroShot(segment.segmentNo, microShot.microShotNo),
          targetId: segment.id,
          kind: "micro_shot_image",
          prompt: compiled.prompt,
          negativePrompt: compiled.negativePrompt,
          referenceImageUrls: compiled.referenceImageUrls ?? [],
          seedBase: Math.abs(segment.segmentNo * 100 + microShot.microShotNo) || 1,
          metadata: {
            segmentNo: segment.segmentNo,
            microShotNo: microShot.microShotNo,
            targetContract: microShot as unknown as Record<string, unknown>,
            selectedReferenceUrls: compiled.referenceImageUrls ?? [],
            referenceUsageNotes: referenceSelection.output.usageNotes ?? [],
          },
        });
        await updatePlanMicroShot(projectId, segment.segmentNo, microShot.microShotNo, {
          ...microShot,
          imageStatus: "running",
          imageTaskId: taskId,
          imageUrl: "",
          errorMessage: "",
        });
        await updateProjectArtifactStatus(projectId, [imageArtifactIdForMicroShot(segment.segmentNo, microShot.microShotNo)], "generating", { retryFromStage: "generation" });
        await logOnePromptVideo("micro_shot.image.submit.success", {
          userId,
          projectId,
          segmentNo: segment.segmentNo,
          microShotNo: microShot.microShotNo,
          imageTaskId: taskId,
        });
        await appendProjectStageLog({
          projectId,
          title: project.title,
          stage: "micro_shots",
          event: `Micro-shot image task submitted S${segment.segmentNo}.${microShot.microShotNo}`,
          summary: "A micro-shot reference image task was submitted upstream.",
          lines: [
            `Segment: ${segment.purpose || "untitled"}`,
            `Micro-shot: ${microShot.purposeZh || microShot.purpose || "untitled"}`,
            `Task ID: ${taskId}`,
            `Prompt: ${compiled.prompt.slice(0, 360)}`,
          ],
          data: {
            userId,
            segmentNo: segment.segmentNo,
            microShotNo: microShot.microShotNo,
            imageTaskId: taskId,
            referenceImageCount: (compiled.referenceImageUrls ?? []).length,
          },
        });
      } catch (error) {
        const retryable = isAliyunRateLimitError(error);
        await updatePlanMicroShot(projectId, segment.segmentNo, microShot.microShotNo, {
          ...microShot,
          imageStatus: retryable ? "pending" : "failed",
          errorMessage: retryable ? "Aliyun rate limit, please retry later" : error instanceof Error ? error.message : "Micro-shot image submit failed",
        });
        if (!retryable) {
          await saveGenerationQualityReport(projectId, buildImageGenerationQualityReport({
            assetId: imageArtifactIdForMicroShot(segment.segmentNo, microShot.microShotNo),
            imageUrl: null,
            prompt: localizedMicroShotImagePromptForGeneration(microShot),
            targetType: "motion_checkpoint_image",
            upstreamError: error instanceof Error ? error.message : "Micro-shot image submit failed",
          }));
          await updateProjectArtifactStatus(projectId, [imageArtifactIdForMicroShot(segment.segmentNo, microShot.microShotNo)], "failed", {
            dirtyReason: error instanceof Error ? error.message : "Micro-shot image submit failed",
            retryFromStage: "generation",
          });
        }
        await logOnePromptVideo("micro_shot.image.submit.error", {
          userId,
          projectId,
          segmentNo: segment.segmentNo,
          microShotNo: microShot.microShotNo,
          retryable,
          ...errorForLog(error),
        }, retryable ? "warn" : "error");
        await writeStageErrorLog({
          projectId,
          title: project.title,
          stage: "micro_shots",
          event: `Micro-shot image task failed S${segment.segmentNo}.${microShot.microShotNo}`,
          error,
          context: {
            userId,
            segmentNo: segment.segmentNo,
            microShotNo: microShot.microShotNo,
            retryable,
          },
        });
        if (retryable) return;
      }
    }
  }
}

function queueRequiredMicroShotImageTasks(
  userId: string,
  projectId: string,
  options: { retryFailed?: boolean } = {},
): boolean {
  if (microShotSubmissionRuns.has(projectId)) return false;
  const run = new Promise<void>((resolve) => setImmediate(resolve))
    .then(() => submitRequiredMicroShotImageTasks(userId, projectId, options))
    .catch((error) => logOnePromptVideo("micro_shot.submit.background.error", {
      userId,
      projectId,
      ...errorForLog(error),
    }, "error"))
    .finally(() => {
      if (microShotSubmissionRuns.get(projectId) === run) microShotSubmissionRuns.delete(projectId);
    });
  microShotSubmissionRuns.set(projectId, run);
  void logOnePromptVideo("micro_shot.submit.background.queued", {
    userId,
    projectId,
    retryFailed: Boolean(options.retryFailed),
  });
  return true;
}

function hasSubmittableRequiredMicroShotImage(project: VideoProjectWithShots): boolean {
  const planSegments = readPlanSegmentMap(project.planJson);
  return project.segments.some((segment) =>
    readPlanMicroShots(planSegments.get(segment.segmentNo)).some((microShot) =>
      isMicroShotImageRequired(microShot)
      && Boolean(localizedMicroShotImagePromptForGeneration(microShot))
      && !microShot.imageUrl
      && microShot.imageStatus !== "failed"
      && !(microShot.imageStatus === "running" && microShot.imageTaskId),
    ),
  );
}

function requiredMicroShotImageIssues(project: VideoProjectWithShots): string[] {
  const planSegments = readPlanSegmentMap(project.planJson);
  const selectedArtifactIds = new Set(
    project.generationCandidates
      .filter((candidate) => candidate.kind === "micro_shot_image" && candidate.selected && Boolean(candidate.mediaUrl))
      .map((candidate) => candidate.artifactId),
  );
  return project.segments.flatMap((segment) => {
    const microShots = readPlanMicroShots(planSegments.get(segment.segmentNo));
    return microShots.flatMap((microShot) => {
      if (!isMicroShotImageRequired(microShot)) return [];
      const label = `S${segment.segmentNo}.${microShot.microShotNo}`;
      const hasSelectedCandidate = selectedArtifactIds.has(imageArtifactIdForMicroShot(segment.segmentNo, microShot.microShotNo));
      if (!localizedMicroShotImagePromptForGeneration(microShot)) return [`${label} prompt missing`];
      if (microShot.imageStatus === "failed" && !hasSelectedCandidate) return [`${label} failed`];
      if (!microShot.imageUrl && !hasSelectedCandidate) return [`${label} image missing`];
      return [];
    });
  });
}

function isMicroShotImageRequired(microShot: VideoMicroShot): boolean {
  return microShot.referenceType === "image_prompt" || microShot.referenceType === "mixed";
}

export async function approveShotImages(userId: string, projectId: string): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  const missing = project.keyframes.filter((keyframe) => !keyframe.imageUrl);
  if (missing.length) throw new Error("All keyframe images must be generated before approval");
  await logOnePromptVideo("micro_shot.review.start", {
    userId,
    projectId,
    keyframeCount: project.keyframes.length,
    segmentCount: project.segments.length,
    status: project.status,
  });
  await appendProjectStageLog({
    projectId,
    title: project.title,
    stage: "micro_shots",
    event: "Micro-shot review started",
    summary: "Reviewing micro-shot image requirements before clip generation.",
    lines: project.segments.flatMap((segment) => {
      const planSegment = readPlanSegmentMap(project.planJson).get(segment.segmentNo);
      const microShots = readPlanMicroShots(planSegment);
      return microShots.length
        ? microShots.map((microShot) => `Segment ${segment.segmentNo} / Micro ${microShot.microShotNo}: ${microShot.purposeZh || microShot.purpose}, reference=${microShot.referenceType || "text"}, prompt=${(localizedMicroShotImagePromptForGeneration(microShot) || "").slice(0, 240)}`)
        : [`Segment ${segment.segmentNo}: no micro-shot image references required`];
    }),
    data: {
      userId,
      keyframeCount: project.keyframes.length,
      segmentCount: project.segments.length,
      requiredMicroShotIssues: requiredMicroShotImageIssues(project),
    },
  });

  await prisma.videoKeyframe.updateMany({
    where: { projectId, imageUrl: { not: null } },
    data: { status: VideoShotStatus.IMAGE_APPROVED, locked: true, errorMessage: null },
  });
  await updateProjectArtifactStatus(
    projectId,
    project.keyframes.filter((keyframe) => Boolean(keyframe.imageUrl)).map((keyframe) => imageArtifactIdForKeyframeNo(keyframe.keyframeNo)),
    "approved",
    { retryFromStage: "generation" },
  );

  const updated = await prisma.videoProject.update({
    where: { id: projectId },
    data: {
      status: VideoProjectStatus.MICRO_SHOT_REVIEW,
      errorMessage: null,
    },
    include: PROJECT_INCLUDE,
  });
  queueRequiredMicroShotImageTasks(userId, projectId);
  await logOnePromptVideo("micro_shot.review.ready", { userId, projectId, status: updated.status });
  await appendProjectStageLog({
    projectId,
    title: updated.title,
    stage: "micro_shots",
    event: "Micro-shot review opened",
    summary: "The review opened immediately; required micro-shot reference images are being submitted in the background.",
    data: {
      userId,
      status: updated.status,
    },
  });
  return updated;
}

export async function approveMicroShotReferences(userId: string, projectId: string): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  if (project.status !== VideoProjectStatus.IMAGE_REVIEW && project.status !== ("MICRO_SHOT_REVIEW" as VideoProjectStatus)) {
    throw new Error("Project is not in micro-shot review");
  }
  const missing = requiredMicroShotImageIssues(project);
  if (missing.length) {
    throw new Error(`Micro-shot reference images are not ready: ${missing.slice(0, 5).join(", ")}`);
  }
  await logOnePromptVideo("clip.batch.submit.start", {
    userId,
    projectId,
    keyframeCount: project.keyframes.length,
    segmentCount: project.segments.length,
    status: project.status,
  });
  await appendProjectStageLog({
    projectId,
    title: project.title,
    stage: "clips",
    event: "Clip submission started",
    summary: "Submitting approved segment prompts for video generation.",
    lines: project.segments.map((segment) => `Segment ${segment.segmentNo}: KF${segment.startKeyframeNo} -> KF${segment.endKeyframeNo}, ${segment.durationSeconds}s, ${segment.purpose}, prompt=${(segment.videoPrompt || "").slice(0, 280)}`),
    data: {
      userId,
      keyframeCount: project.keyframes.length,
      segmentCount: project.segments.length,
      status: project.status,
    },
  });
  await prisma.videoSegment.updateMany({
    where: { projectId },
    data: { status: VideoShotStatus.CLIP_PENDING, locked: true, errorMessage: null },
  });
  await updateProjectArtifactStatus(projectId, approvedMicroShotImageArtifactIds(project), "approved", { retryFromStage: "generation" });
  await submitNextClipTask({
    userId,
    projectId,
    segments: project.segments,
    keyframes: project.keyframes,
    logEventPrefix: "clip.batch",
  });

  const updated = await prisma.videoProject.update({
    where: { id: projectId },
    data: {
      status: VideoProjectStatus.CLIP_GENERATING,
      errorMessage: null,
    },
    include: PROJECT_INCLUDE,
  });
  await logOnePromptVideo("clip.batch.submit.done", { userId, projectId, status: updated.status });
  await appendProjectStageLog({
    projectId,
    title: updated.title,
    stage: "clips",
    event: "Clip tasks submitted",
    summary: "Segment video generation tasks were submitted upstream.",
    data: {
      userId,
      status: updated.status,
      runningCount: updated.segments.filter((segment) => segment.status === VideoShotStatus.CLIP_RUNNING).length,
      pendingCount: updated.segments.filter((segment) => segment.status === VideoShotStatus.CLIP_PENDING).length,
    },
  });
  return updated;
}

function buildFinalCompositionSequence(project: VideoProjectWithShots): {
  clipUrls: string[];
  clipDurations: number[];
  subtitles: Array<{ text: string; durationSeconds: number }>;
  transitionPlan: FinalTransitionPlan[];
} {
  const sources = project.segments.length ? project.segments : project.shots;
  const originalPlan = readFinalTransitionPlan(project.planJson);
  const bridges = generatedBridgeArtifactsFromPlan(project.planJson);
  const entries: Array<{ url: string; duration: number; subtitle: string; segmentNo?: number; bridge?: GeneratedBridgeArtifact }> = [];
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    if (!source.clipUrl) throw new Error("Not all video clips are ready");
    const segmentNo = "segmentNo" in source ? source.segmentNo : source.shotNo;
    entries.push({ url: source.clipUrl, duration: source.durationSeconds, subtitle: source.subtitle || "", segmentNo });
    const next = sources[index + 1];
    if (!next) continue;
    const nextSegmentNo = "segmentNo" in next ? next.segmentNo : next.shotNo;
    const transition = originalPlan.find((item) => item.fromSegmentNo === segmentNo && item.toSegmentNo === nextSegmentNo);
    if (transition?.visualMode !== "generated_bridge" && !transition?.generatedBridgeRequired) continue;
    const bridge = bridges.find((item) => item.fromSegmentNo === segmentNo && item.toSegmentNo === nextSegmentNo);
    if (!bridge?.locked || bridge.status !== "approved" || !bridge.selectedVideoUrl) throw new Error(`Generated bridge ${segmentNo}->${nextSegmentNo} must be generated, quality-passed, reviewed and locked before final composition`);
    entries.push({ url: bridge.selectedVideoUrl, duration: bridge.durationSeconds, subtitle: "", bridge });
  }
  const transitionPlan: FinalTransitionPlan[] = [];
  for (let index = 0; index < entries.length - 1; index += 1) {
    const current = entries[index];
    const next = entries[index + 1];
    const original = current.segmentNo && next.segmentNo
      ? originalPlan.find((item) => item.fromSegmentNo === current.segmentNo && item.toSegmentNo === next.segmentNo)
      : undefined;
    const bridgeBoundary = Boolean(current.bridge || next.bridge);
    transitionPlan.push({
      fromSegmentNo: index + 1,
      toSegmentNo: index + 2,
      visualMode: bridgeBoundary ? "hard_cut" : original?.visualMode ?? "hard_cut",
      audioMode: bridgeBoundary ? "none" : original?.audioMode ?? "none",
      overlapSeconds: bridgeBoundary ? 0 : original?.overlapSeconds ?? 0,
      matchAnchorId: bridgeBoundary ? undefined : original?.matchAnchorId,
      generatedBridgeRequired: false,
    });
  }
  return { clipUrls: entries.map((item) => item.url), clipDurations: entries.map((item) => item.duration), subtitles: entries.map((item) => ({ text: item.subtitle, durationSeconds: item.duration })), transitionPlan };
}

export async function composeVideoProject(userId: string, projectId: string): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  if (
    project.status !== VideoProjectStatus.CLIP_REVIEW &&
    project.status !== VideoProjectStatus.FINAL_REVIEW &&
    project.status !== VideoProjectStatus.DONE
  ) {
    throw new Error("Current project is not ready for composition");
  }

  const sourceCount = project.segments.length || project.shots.length;
  const sourceClipUrls = (project.segments.length ? project.segments : project.shots).map((item) => item.clipUrl).filter((url): url is string => Boolean(url));
  if (!sourceCount || sourceClipUrls.length !== sourceCount) throw new Error("Not all video clips are ready");
  const composition = buildFinalCompositionSequence(project);
  const { clipUrls, clipDurations, subtitles, transitionPlan } = composition;
  await logOnePromptVideo("compose.submit.start", {
    userId,
    projectId,
    status: project.status,
    clipCount: clipUrls.length,
    title: project.title,
  });
  await appendProjectStageLog({
    projectId,
    title: project.title,
    stage: "final",
    event: "Final video composition started",
    summary: "Combining generated clips into the final review video.",
    lines: [
      `Clip count: ${clipUrls.length}`,
      `Clip durations: ${clipDurations.join("s / ")}s`,
      `Aspect ratio: ${project.aspectRatio}`,
      `Audio mode: ${String(readAudioBible(project.planJson)?.mode ?? "default")}`,
      `Transition count: ${readFinalTransitionPlan(project.planJson).length}`,
    ],
    data: {
      userId,
      status: project.status,
      clipUrls,
      transitionPlan,
      audioBible: readAudioBible(project.planJson),
    },
  });
  await updateProjectArtifactStatus(projectId, ["final_video"], "generating", { retryFromStage: "composition" });
  let finalVideoUrl: string;
  try {
    finalVideoUrl = await composeVideoClipsLocally({
      projectId,
      title: project.title,
      clipUrls,
      clipDurations,
      subtitles,
      aspectRatio: project.aspectRatio as "9:16" | "16:9" | "1:1",
      transitionPlan,
      audioBible: readAudioBible(project.planJson),
    });
  } catch (error) {
    await writeStageErrorLog({
      projectId,
      title: project.title,
      stage: "final",
      event: "Final video composition failed",
      error,
      context: {
        userId,
        clipCount: clipUrls.length,
        aspectRatio: project.aspectRatio,
      },
    });
    throw error;
  }

  await appendVideoMediaRevision(projectId, {
    kind: "final_video",
    targetId: "final",
    url: project.finalVideoUrl,
  });

  if (project.segments.length) {
    await prisma.videoSegment.updateMany({
      where: { projectId },
      data: { status: VideoShotStatus.CLIP_APPROVED, locked: true, errorMessage: null },
    });
    await updateProjectArtifactStatus(projectId, project.segments.filter((segment) => Boolean(segment.clipUrl)).map((segment) => videoArtifactIdForSegmentNo(segment.segmentNo)), "approved", { retryFromStage: "generation" });
  } else {
    await prisma.videoShot.updateMany({
      where: { projectId },
      data: { status: VideoShotStatus.CLIP_APPROVED, locked: true, errorMessage: null },
    });
  }

  const updated = await prisma.videoProject.update({
    where: { id: projectId },
    data: {
      status: VideoProjectStatus.FINAL_REVIEW,
      composeTaskId: null,
      finalVideoUrl,
      errorMessage: null,
    },
    include: PROJECT_INCLUDE,
  });
  await updateProjectArtifactStatus(projectId, ["final_video"], "ready", { retryFromStage: "composition" });
  await logOnePromptVideo("compose.submit.success", {
    userId,
    projectId,
    composeTaskId: null,
    localCompose: true,
    finalVideoUrl: updated.finalVideoUrl,
    status: updated.status,
  });
  await appendProjectStageLog({
    projectId,
    title: updated.title,
    stage: "final",
    event: "Final video composed",
    summary: "The local composer produced the final review video.",
    lines: [
      `Final video: ${updated.finalVideoUrl}`,
      `Status: ${updated.status}`,
      `Clip count: ${clipUrls.length}`,
    ],
    data: {
      userId,
      finalVideoUrl: updated.finalVideoUrl,
      status: updated.status,
    },
  });
  return updated;
}
export async function finishVideoProject(userId: string, projectId: string): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  if (project.status !== VideoProjectStatus.FINAL_REVIEW && project.status !== VideoProjectStatus.DONE) {
    throw new Error("Project is not ready to finish");
  }

  const updated = await prisma.videoProject.update({
    where: { id: projectId },
    data: {
      status: VideoProjectStatus.DONE,
      errorMessage: null,
    },
    include: PROJECT_INCLUDE,
  });
  await logOnePromptVideo("project.finish.success", { userId, projectId, status: updated.status, finalVideoUrl: updated.finalVideoUrl });
  return updated;
}

export type VideoProjectRollbackTarget = "PLAN_REVIEW" | "ASSET_LIBRARY_REVIEW" | "IMAGE_REVIEW" | "MICRO_SHOT_REVIEW" | "CLIP_REVIEW";

export async function rollbackVideoProject(
  userId: string,
  projectId: string,
  targetStatus?: VideoProjectRollbackTarget,
): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  const target = targetStatus ?? previousRollbackTarget(project.status);
  if (!target) throw new Error("Current project stage cannot be rolled back");
  const repairingCurrentBoundaryReview = project.status === VideoProjectStatus.IMAGE_REVIEW && target === "IMAGE_REVIEW";
  if (!canRollbackTo(project.status, target) && !repairingCurrentBoundaryReview) {
    throw new Error(`Cannot rollback from ${project.status} to ${target}`);
  }

  await logOnePromptVideo("project.rollback.start", {
    userId,
    projectId,
    fromStatus: project.status,
    targetStatus: target,
  }, "warn");

  const rollbackResult = await prisma.$transaction(async (tx) => {
    const cancellableStatuses = ["pending", "running", "succeeded", "evaluating", "quality_retry"];
    const candidateKindsToCancel = target === "PLAN_REVIEW" || target === "ASSET_LIBRARY_REVIEW"
      ? ["keyframe_image", "micro_shot_image", "segment_video"]
      : target === "IMAGE_REVIEW"
        ? ["micro_shot_image", "segment_video"]
        : target === "MICRO_SHOT_REVIEW"
          ? ["segment_video"]
          : [];
    const cancelledCandidates = candidateKindsToCancel.length
      ? await tx.videoGenerationCandidate.updateMany({
          where: {
            projectId,
            kind: { in: candidateKindsToCancel },
            status: { in: cancellableStatuses },
          },
          data: {
            status: "cancelled",
            taskId: null,
            errorMessage: `Cancelled by rollback to ${target}`,
          },
        })
      : { count: 0 };
    if (target === "PLAN_REVIEW") {
      await tx.videoKeyframe.updateMany({
        where: { projectId },
        data: {
          status: VideoShotStatus.SCRIPT_READY,
          imageTaskId: null,
          imageUrl: null,
          qualityScore: null,
          errorMessage: null,
          locked: false,
        },
      });
      await tx.videoSegment.updateMany({
        where: { projectId },
        data: {
          status: VideoShotStatus.SCRIPT_READY,
          clipTaskId: null,
          clipUrl: null,
          qualityScore: null,
          errorMessage: null,
          locked: false,
        },
      });
      await tx.videoShot.updateMany({
        where: { projectId },
        data: {
          status: VideoShotStatus.SCRIPT_READY,
          imageTaskId: null,
          imageUrl: null,
          clipTaskId: null,
          clipUrl: null,
          qualityScore: null,
          errorMessage: null,
          locked: false,
        },
      });
      await rollbackPlanMicroShotImages(projectId, tx);
    } else if (target === "ASSET_LIBRARY_REVIEW") {
      await tx.videoKeyframe.updateMany({
        where: { projectId, keyframeNo: { lt: 0 }, imageUrl: { not: null } },
        data: {
          status: VideoShotStatus.IMAGE_READY,
          imageTaskId: null,
          qualityScore: null,
          errorMessage: null,
          locked: false,
        },
      });
      await tx.videoKeyframe.updateMany({
        where: { projectId, keyframeNo: { lt: 0 }, imageUrl: null },
        data: {
          status: VideoShotStatus.SCRIPT_READY,
          imageTaskId: null,
          qualityScore: null,
          errorMessage: null,
          locked: false,
        },
      });
      await tx.videoKeyframe.updateMany({
        where: { projectId, keyframeNo: { gt: 0 } },
        data: {
          status: VideoShotStatus.SCRIPT_READY,
          imageTaskId: null,
          imageUrl: null,
          qualityScore: null,
          errorMessage: null,
          locked: false,
        },
      });
      await tx.videoSegment.updateMany({
        where: { projectId },
        data: {
          status: VideoShotStatus.SCRIPT_READY,
          clipTaskId: null,
          clipUrl: null,
          qualityScore: null,
          errorMessage: null,
          locked: false,
        },
      });
      await tx.videoShot.updateMany({
        where: { projectId },
        data: {
          status: VideoShotStatus.SCRIPT_READY,
          imageTaskId: null,
          imageUrl: null,
          clipTaskId: null,
          clipUrl: null,
          qualityScore: null,
          errorMessage: null,
          locked: false,
        },
      });
      await rollbackPlanMicroShotImages(projectId, tx);
    } else if (target === "IMAGE_REVIEW") {
      await tx.videoKeyframe.updateMany({
        where: { projectId, keyframeNo: { lt: 0 }, imageUrl: { not: null } },
        data: {
          status: VideoShotStatus.IMAGE_APPROVED,
          imageTaskId: null,
          errorMessage: null,
          locked: true,
        },
      });
      await tx.videoKeyframe.updateMany({
        where: { projectId, keyframeNo: { lt: 0 }, imageUrl: null },
        data: { status: VideoShotStatus.SCRIPT_READY, imageTaskId: null, errorMessage: null, locked: false },
      });
      await tx.videoKeyframe.updateMany({
        where: { projectId, keyframeNo: { gt: 0 }, imageUrl: { not: null } },
        data: {
          status: VideoShotStatus.IMAGE_READY,
          imageTaskId: null,
          errorMessage: null,
          locked: false,
        },
      });
      await tx.videoKeyframe.updateMany({
        where: { projectId, keyframeNo: { gt: 0 }, imageUrl: null },
        data: { status: VideoShotStatus.SCRIPT_READY, imageTaskId: null, errorMessage: null, locked: false },
      });
      await tx.videoSegment.updateMany({
        where: { projectId },
        data: {
          status: VideoShotStatus.SCRIPT_READY,
          clipTaskId: null,
          clipUrl: null,
          qualityScore: null,
          errorMessage: null,
          locked: false,
        },
      });
      await tx.videoShot.updateMany({
        where: { projectId },
        data: {
          status: VideoShotStatus.IMAGE_READY,
          clipTaskId: null,
          clipUrl: null,
          errorMessage: null,
          locked: false,
        },
      });
      await rollbackPlanToBoundaryReview(projectId, tx, project.keyframes);
    } else if (target === "MICRO_SHOT_REVIEW") {
      await tx.videoKeyframe.updateMany({
        where: { projectId, imageUrl: { not: null } },
        data: { status: VideoShotStatus.IMAGE_APPROVED, locked: true, imageTaskId: null, errorMessage: null },
      });
      await tx.videoSegment.updateMany({
        where: { projectId },
        data: {
          status: VideoShotStatus.SCRIPT_READY,
          clipTaskId: null,
          clipUrl: null,
          qualityScore: null,
          errorMessage: null,
          locked: false,
        },
      });
      await tx.videoShot.updateMany({
        where: { projectId },
        data: {
          status: VideoShotStatus.IMAGE_APPROVED,
          clipTaskId: null,
          clipUrl: null,
          errorMessage: null,
          locked: false,
        },
      });
    } else if (target === "CLIP_REVIEW") {
      await tx.videoSegment.updateMany({
        where: { projectId, clipUrl: { not: null } },
        data: { status: VideoShotStatus.CLIP_READY, clipTaskId: null, errorMessage: null, locked: false },
      });
      await tx.videoShot.updateMany({
        where: { projectId, clipUrl: { not: null } },
        data: { status: VideoShotStatus.CLIP_READY, clipTaskId: null, errorMessage: null, locked: false },
      });
    }

    await tx.videoProject.update({
      where: { id: projectId },
      data: {
        status: target === "ASSET_LIBRARY_REVIEW" ? VideoProjectStatus.IMAGE_REVIEW : target as VideoProjectStatus,
        finalVideoUrl: target === "CLIP_REVIEW" ? project.finalVideoUrl : null,
        composeTaskId: null,
        errorMessage: null,
      },
    });
    return { cancelledCandidateCount: cancelledCandidates.count };
  });

  const updated = await requireVideoProject(userId, projectId);
  await logOnePromptVideo("project.rollback.done", {
    userId,
    projectId,
    fromStatus: project.status,
    targetStatus: target,
    status: updated.status,
    cancelledCandidateCount: rollbackResult.cancelledCandidateCount,
  }, "warn");
  return updated;
}

function previousRollbackTarget(status: VideoProjectStatus): VideoProjectRollbackTarget | undefined {
  if (status === VideoProjectStatus.IMAGE_REVIEW || status === VideoProjectStatus.IMAGE_GENERATING) return "PLAN_REVIEW";
  if (status === VideoProjectStatus.MICRO_SHOT_REVIEW) return "IMAGE_REVIEW";
  if (status === VideoProjectStatus.CLIP_GENERATING || status === VideoProjectStatus.CLIP_REVIEW) return "MICRO_SHOT_REVIEW";
  if (status === VideoProjectStatus.COMPOSING || status === VideoProjectStatus.FINAL_REVIEW || status === VideoProjectStatus.DONE) return "CLIP_REVIEW";
  return undefined;
}

function canRollbackTo(current: VideoProjectStatus, target: VideoProjectRollbackTarget): boolean {
  const order: Record<VideoProjectStatus, number> = {
    DRAFT: 0,
    PLANNING: 0,
    PLAN_REVIEW: 1,
    IMAGE_GENERATING: 2,
    IMAGE_REVIEW: 2,
    MICRO_SHOT_REVIEW: 3,
    CLIP_GENERATING: 4,
    CLIP_REVIEW: 4,
    COMPOSING: 5,
    FINAL_REVIEW: 5,
    DONE: 6,
    FAILED: 6,
  };
  const targetOrder: Record<VideoProjectRollbackTarget, number> = {
    PLAN_REVIEW: 1,
    ASSET_LIBRARY_REVIEW: 1.5,
    IMAGE_REVIEW: 2,
    MICRO_SHOT_REVIEW: 3,
    CLIP_REVIEW: 4,
  };
  return order[current] > targetOrder[target];
}

async function rollbackPlanMicroShotImages(
  projectId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const project = await tx.videoProject.findUnique({ where: { id: projectId } });
  if (!project?.planJson) return;
  const plan = cloneJsonRecord(project.planJson);
  clearPlanMicroShotImages(plan, "segments");
  clearPlanMicroShotImages(plan, "shots");
  await tx.videoProject.update({
    where: { id: projectId },
    data: { planJson: plan as Prisma.InputJsonValue },
  });
}

function clearPlanMicroShotImages(plan: Record<string, unknown>, collectionKey: "segments" | "shots"): void {
  const collection = plan[collectionKey];
  if (!Array.isArray(collection)) return;
  for (const item of collection) {
    if (!isRecord(item)) continue;
    const rawMicroShots = item.microShots ?? item.micro_shots ?? item.internalStoryboard ?? item.internal_storyboard ?? item.subShots ?? item.sub_shots;
    if (!Array.isArray(rawMicroShots)) continue;
    item.microShots = rawMicroShots.map((microShot) => {
      if (!isRecord(microShot)) return microShot;
      const next = { ...microShot };
      delete next.imageUrl;
      delete next.image_url;
      delete next.imageTaskId;
      delete next.image_task_id;
      delete next.errorMessage;
      delete next.error_message;
      next.imageStatus = "idle";
      next.image_status = "idle";
      return next;
    });
  }
}

export async function syncVideoProject(userId: string, projectId: string): Promise<VideoProjectWithShots> {
  let project = await requireVideoProject(userId, projectId);
  if (project.status === VideoProjectStatus.PLANNING && !planningRuns.has(projectId)) {
    project = await queueVideoProjectPlanning(userId, projectId);
  }
  await logOnePromptVideo("project.sync.start", {
    userId,
    projectId,
    status: project.status,
    composeTaskId: project.composeTaskId,
    keyframes: project.keyframes.map((keyframe) => ({
      keyframeNo: keyframe.keyframeNo,
      status: keyframe.status,
      imageTaskId: keyframe.imageTaskId,
      hasImageUrl: Boolean(keyframe.imageUrl),
    })),
    segments: project.segments.map((segment) => ({
      segmentNo: segment.segmentNo,
      status: segment.status,
      clipTaskId: segment.clipTaskId,
      hasClipUrl: Boolean(segment.clipUrl),
    })),
  });

  await syncTransitionReferenceArtifacts(project);
  await syncGeneratedBridgeCandidates(project);
  await syncGenerationCandidates(project);
  // Candidate evaluation may turn a previously FAILED project back into an
  // automatically recoverable generating state. Reload before scheduling so
  // the retry is submitted in this same sync request without a user click.
  project = await requireVideoProject(userId, projectId);
  if (project.status === VideoProjectStatus.IMAGE_GENERATING) {
    await syncImageTasks(project);
  }
  if (project.status === VideoProjectStatus.MICRO_SHOT_REVIEW && hasSubmittableRequiredMicroShotImage(project)) {
    queueRequiredMicroShotImageTasks(userId, projectId);
  }
  await syncMicroShotImageTasks(project);
  if (project.status === VideoProjectStatus.CLIP_GENERATING) {
    await syncClipTasks(project);
  }
  if (project.status === VideoProjectStatus.COMPOSING && project.composeTaskId) {
    await syncComposeTask(project.id, project.composeTaskId);
  }
  await persistExistingTemporaryImageUrls(project.id);

  const synced = await requireVideoProject(userId, projectId);
  await logOnePromptVideo("project.sync.done", {
    userId,
    projectId,
    status: synced.status,
    errorMessage: synced.errorMessage,
    finalVideoUrl: synced.finalVideoUrl,
  });
  return synced;
}

async function persistGeneratedImageUrl(params: {
  projectId: string;
  sourceUrl: string;
  kind: "keyframe" | "micro-shot";
  keyframeNo?: number;
  segmentNo?: number;
  microShotNo?: number;
}): Promise<string> {
  if (!isTemporaryDashScopeUrl(params.sourceUrl)) return params.sourceUrl;
  const suffix = params.kind === "keyframe"
    ? `keyframe-${params.keyframeNo ?? "unknown"}`
    : `segment-${params.segmentNo ?? "unknown"}-micro-${params.microShotNo ?? "unknown"}`;
  const key = `one-prompt-video/images/${params.projectId}/${suffix}-${Date.now()}.jpg`;
  try {
    const publicUrl = await persistRemoteMediaToOss({
      url: params.sourceUrl,
      key,
      fallbackContentType: "image/jpeg",
    });
    await logOnePromptVideo("image.persist.success", {
      projectId: params.projectId,
      kind: params.kind,
      key,
      publicUrl,
    });
    return publicUrl;
  } catch (error) {
    await logOnePromptVideo("image.persist.error", {
      projectId: params.projectId,
      kind: params.kind,
      keyframeNo: params.keyframeNo,
      segmentNo: params.segmentNo,
      microShotNo: params.microShotNo,
      ...errorForLog(error),
    }, "error");
    return params.sourceUrl;
  }
}

async function refreshAndPersistTemporaryImage(params: {
  projectId: string;
  currentUrl: string;
  taskId?: string | null;
  kind: "keyframe" | "micro-shot";
  keyframeNo?: number;
  segmentNo?: number;
  microShotNo?: number;
}): Promise<string> {
  let sourceUrl = params.currentUrl;
  if (params.taskId) {
    try {
      const refreshed = await queryDashScopeTask(params.taskId);
      if (refreshed.status === "succeeded" && refreshed.resultUrl) {
        sourceUrl = refreshed.resultUrl;
      }
    } catch (error) {
      await logOnePromptVideo("image.persist.refresh_task_error", {
        projectId: params.projectId,
        kind: params.kind,
        taskId: params.taskId,
        ...errorForLog(error),
      }, "warn");
    }
  }
  return persistGeneratedImageUrl({
    projectId: params.projectId,
    sourceUrl,
    kind: params.kind,
    keyframeNo: params.keyframeNo,
    segmentNo: params.segmentNo,
    microShotNo: params.microShotNo,
  });
}

async function persistExistingTemporaryImageUrls(projectId: string): Promise<void> {
  const project = await prisma.videoProject.findUnique({ where: { id: projectId }, include: PROJECT_INCLUDE });
  if (!project) return;

  for (const keyframe of project.keyframes) {
    if (!isTemporaryDashScopeUrl(keyframe.imageUrl)) continue;
    const persisted = await refreshAndPersistTemporaryImage({
      projectId,
      currentUrl: keyframe.imageUrl as string,
      taskId: keyframe.imageTaskId,
      kind: "keyframe",
      keyframeNo: keyframe.keyframeNo,
    });
    if (persisted !== keyframe.imageUrl) {
      await prisma.videoKeyframe.update({
        where: { id: keyframe.id },
        data: { imageUrl: persisted },
      });
    }
  }

  const planSegments = readPlanSegmentMap(project.planJson);
  for (const segment of project.segments) {
    const microShots = readPlanMicroShots(planSegments.get(segment.segmentNo));
    for (const microShot of microShots) {
      if (!isTemporaryDashScopeUrl(microShot.imageUrl)) continue;
      const persisted = await refreshAndPersistTemporaryImage({
        projectId,
        currentUrl: microShot.imageUrl as string,
        taskId: microShot.imageTaskId,
        kind: "micro-shot",
        segmentNo: segment.segmentNo,
        microShotNo: microShot.microShotNo,
      });
      if (persisted !== microShot.imageUrl) {
        await updatePlanMicroShot(projectId, segment.segmentNo, microShot.microShotNo, {
          ...microShot,
          imageUrl: persisted,
        });
      }
    }
  }
}

function candidateMetadata(value: Prisma.JsonValue | null): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

async function patchTransitionReferenceArtifact(projectId: string, artifactId: string, patch: Partial<TransitionReferenceArtifact>): Promise<void> {
  const project = await prisma.videoProject.findUnique({ where: { id: projectId } });
  if (!project?.planJson) throw new Error("Project plan is missing");
  const plan = cloneJsonRecord(project.planJson);
  const artifacts = transitionReferenceArtifactsFromPlan(project.planJson);
  const index = artifacts.findIndex((item) => item.id === artifactId);
  if (index < 0) throw new Error("Transition reference artifact not found");
  artifacts[index] = { ...artifacts[index], ...patch, updatedAt: new Date().toISOString() };
  plan.transitionReferenceArtifacts = artifacts as unknown as Prisma.InputJsonValue;
  delete plan.transition_reference_artifacts;
  await prisma.videoProject.update({ where: { id: projectId }, data: { planJson: cleanInputJson(plan) } });
  await mirrorPlanArtifactsToTables(projectId, plan);
}

async function invalidateTransitionReferencesForParent(projectId: string, keyframeNo: number, reason: string): Promise<void> {
  const project = await prisma.videoProject.findUnique({ where: { id: projectId } });
  if (!project?.planJson) return;
  const artifacts = transitionReferenceArtifactsFromPlan(project.planJson);
  let changed = false;
  const next = artifacts.map((item) => {
    if (item.parentKeyframeNo !== keyframeNo) return item;
    changed = true;
    return { ...item, status: "waiting_parent" as const, locked: false, errorMessage: reason, updatedAt: new Date().toISOString() };
  });
  if (!changed) return;
  const plan = cloneJsonRecord(project.planJson);
  plan.transitionReferenceArtifacts = next as unknown as Prisma.InputJsonValue;
  await prisma.videoProject.update({ where: { id: projectId }, data: { planJson: cleanInputJson(plan) } });
  await mirrorPlanArtifactsToTables(projectId, plan);
}

async function reconcileTransitionReferencesForAcceptedParent(
  projectId: string,
  keyframeNo: number,
  imageUrl: string,
): Promise<void> {
  const project = await prisma.videoProject.findUnique({ where: { id: projectId } });
  if (!project?.planJson) return;
  const artifacts = transitionReferenceArtifactsFromPlan(project.planJson);
  const affected = artifacts.filter((item) => item.parentKeyframeNo === keyframeNo);
  if (!affected.length) return;
  const now = new Date().toISOString();
  const next = artifacts.map((item) => {
    if (item.parentKeyframeNo !== keyframeNo) return item;
    if (item.mode === "short") {
      return {
        ...item,
        status: "approved" as const,
        locked: true,
        parentKeyframeUrl: imageUrl,
        selectedFrameUrl: imageUrl,
        errorMessage: undefined,
        updatedAt: now,
      };
    }
    return {
      ...item,
      status: "waiting_parent" as const,
      locked: false,
      parentKeyframeUrl: imageUrl,
      selectedFrameUrl: undefined,
      errorMessage: "Parent-camera keyframe changed; regenerate and approve this full transition reference.",
      updatedAt: now,
    };
  });
  const plan = cloneJsonRecord(project.planJson);
  plan.transitionReferenceArtifacts = next as unknown as Prisma.InputJsonValue;
  delete plan.transition_reference_artifacts;
  const shortIds = affected.filter((item) => item.mode === "short").map((item) => item.id);
  const fullIds = affected.filter((item) => item.mode === "full").map((item) => item.id);
  if (shortIds.length) setPlanArtifactStatus(plan, shortIds, "approved", { retryFromStage: "generation", userAccepted: true });
  if (fullIds.length) setPlanArtifactStatus(plan, fullIds, "dirty", { dirtyReason: "Accepted parent-camera image changed; full transition reference must be regenerated.", retryFromStage: "generation" });
  await prisma.videoProject.update({ where: { id: projectId }, data: { planJson: cleanInputJson(plan) } });
  await mirrorPlanArtifactsToTables(projectId, plan);
}

async function repairAcceptedShortTransitionReferences(project: VideoProjectWithShots): Promise<VideoProjectWithShots> {
  const staleParentKeyframeNos = new Set<number>();
  for (const artifact of transitionReferenceArtifactsFromPlan(project.planJson)) {
    if (artifact.mode !== "short") continue;
    const parent = project.keyframes.find((item) => item.keyframeNo === artifact.parentKeyframeNo);
    if (!parent?.imageUrl || !isUsableTransitionParentKeyframe(project, parent)) continue;
    if (
      artifact.status !== "approved"
      || !artifact.locked
      || artifact.parentKeyframeUrl !== parent.imageUrl
      || artifact.selectedFrameUrl !== parent.imageUrl
    ) {
      staleParentKeyframeNos.add(parent.keyframeNo);
    }
  }
  if (!staleParentKeyframeNos.size) return project;
  for (const keyframeNo of staleParentKeyframeNos) {
    const parent = project.keyframes.find((item) => item.keyframeNo === keyframeNo);
    if (parent?.imageUrl) await reconcileTransitionReferencesForAcceptedParent(project.id, keyframeNo, parent.imageUrl);
  }
  const repaired = await prisma.videoProject.findUnique({ where: { id: project.id }, include: PROJECT_INCLUDE });
  return repaired ?? project;
}

async function invalidateGeneratedBridgesForSegment(projectId: string, segmentNo: number, reason: string): Promise<void> {
  const project = await prisma.videoProject.findUnique({ where: { id: projectId } });
  if (!project?.planJson) return;
  const artifacts = generatedBridgeArtifactsFromPlan(project.planJson);
  let changed = false;
  const next = artifacts.map((item) => {
    if (item.fromSegmentNo !== segmentNo && item.toSegmentNo !== segmentNo) return item;
    changed = true;
    return { ...item, status: "planned" as const, locked: false, errorMessage: reason, updatedAt: new Date().toISOString() };
  });
  if (!changed) return;
  const plan = cloneJsonRecord(project.planJson);
  plan.generatedBridgeArtifacts = next as unknown as Prisma.InputJsonValue;
  await prisma.videoProject.update({ where: { id: projectId }, data: { planJson: cleanInputJson(plan) } });
}

async function patchGeneratedBridgeArtifact(projectId: string, artifactId: string, patch: Partial<GeneratedBridgeArtifact>): Promise<void> {
  const project = await prisma.videoProject.findUnique({ where: { id: projectId } });
  if (!project?.planJson) throw new Error("Project plan is missing");
  const plan = cloneJsonRecord(project.planJson);
  const artifacts = generatedBridgeArtifactsFromPlan(project.planJson);
  const index = artifacts.findIndex((item) => item.id === artifactId);
  if (index < 0) throw new Error("Generated bridge artifact not found");
  artifacts[index] = { ...artifacts[index], ...patch, updatedAt: new Date().toISOString() };
  plan.generatedBridgeArtifacts = artifacts as unknown as Prisma.InputJsonValue;
  delete plan.generated_bridge_artifacts;
  await prisma.videoProject.update({ where: { id: projectId }, data: { planJson: cleanInputJson(plan) } });
}

export async function generateTransitionReference(userId: string, projectId: string, artifactId: string): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  const artifact = transitionReferenceArtifactsFromPlan(project.planJson).find((item) => item.id === artifactId);
  if (!artifact) throw new Error("Transition reference artifact not found");
  if (artifact.mode !== "full") throw new Error("Short mode uses the approved parent keyframe directly and does not generate a transition video");
  const parentKeyframe = project.keyframes.find((item) => item.keyframeNo === artifact.parentKeyframeNo);
  if (!parentKeyframe?.imageUrl || (!parentKeyframe.locked && parentKeyframe.status !== VideoShotStatus.IMAGE_APPROVED)) throw new Error("Approve and lock the parent-camera keyframe before generating the transition reference");
  const targetContext = resolveCameraInheritanceContext(planRecord(project.planJson), artifact.toSegmentNo);
  const prompt = [
    "Generate a short transition-reference camera move used only to discover the target camera composition; this video will never enter the final edit.",
    `Move from parent camera ${artifact.fromCameraId ?? "unknown"} toward target camera ${artifact.toCameraId}.`,
    `Relation: ${artifact.relation}. Inheritance scope: ${artifact.inheritanceScope.join(", ")}.`,
    targetContext.node?.axisDescription ? `Axis lock: ${targetContext.node.axisDescription}.` : "",
    targetContext.node?.spatialLayoutLock ? `Spatial left-right lock: ${targetContext.node.spatialLayoutLock}.` : "",
    targetContext.node?.framingRange ? `Target framing: ${targetContext.node.framingRange}.` : "",
    "Preserve only scene layout, composition, lighting, fixed objects and subject positions. Do not invent or copy identity, logos, product text, captions, UI, watermarks, or accidental typography. Hard anchor images remain authoritative later.",
    "One continuous reachable camera move, no cut, dissolve, montage, teleportation, scene replacement, or identity morphing.",
  ].filter(Boolean).join("\n");
  const taskId = await submitAliyunImageToVideoTask({ imageUrl: parentKeyframe.imageUrl, lastFrameUrl: parentKeyframe.imageUrl, prompt, durationSeconds: 3 });
  await patchTransitionReferenceArtifact(projectId, artifact.id, { status: "video_running", parentKeyframeUrl: parentKeyframe.imageUrl, videoTaskId: taskId, videoUrl: undefined, frameCandidates: undefined, errorMessage: undefined, locked: false });
  await updateProjectArtifactStatus(projectId, [artifact.id], "generating", { retryFromStage: "generation" });
  return requireVideoProject(userId, projectId);
}

export async function approveTransitionReference(userId: string, projectId: string, artifactId: string, frameId?: string): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  const artifact = transitionReferenceArtifactsFromPlan(project.planJson).find((item) => item.id === artifactId);
  if (!artifact) throw new Error("Transition reference artifact not found");
  const parentRevisionIds: string[] = [];
  if (artifact.mode === "short") {
    const parent = project.keyframes.find((item) => item.keyframeNo === artifact.parentKeyframeNo && item.imageUrl && (item.locked || item.status === VideoShotStatus.IMAGE_APPROVED));
    if (!parent?.imageUrl) throw new Error("The approved parent-camera keyframe is unavailable");
    if (artifact.selectedFrameUrl && artifact.selectedFrameUrl !== parent.imageUrl) {
      const revisionId = await appendVideoMediaRevision(projectId, { kind: "transition_reference", targetId: artifact.id, segmentNo: artifact.toSegmentNo, url: artifact.selectedFrameUrl });
      if (revisionId) parentRevisionIds.push(revisionId);
    }
    await patchTransitionReferenceArtifact(projectId, artifact.id, { status: "approved", selectedFrameUrl: parent.imageUrl, parentKeyframeUrl: parent.imageUrl, locked: true, errorMessage: undefined });
  } else {
    const candidate = artifact.frameCandidates?.find((item) => item.id === (frameId ?? artifact.frameCandidates?.find((entry) => entry.selected)?.id));
    if (!candidate || !candidate.passed) throw new Error("Select a quality-passed transition frame before approval");
    if (artifact.selectedFrameUrl && artifact.selectedFrameUrl !== candidate.url) {
      const revisionId = await appendVideoMediaRevision(projectId, { kind: "transition_reference", targetId: artifact.id, segmentNo: artifact.toSegmentNo, url: artifact.selectedFrameUrl });
      if (revisionId) parentRevisionIds.push(revisionId);
    }
    await patchTransitionReferenceArtifact(projectId, artifact.id, { status: "approved", selectedFrameUrl: candidate.url, frameCandidates: artifact.frameCandidates?.map((item) => ({ ...item, selected: item.id === candidate.id })), locked: true, errorMessage: undefined });
  }
  await markProjectArtifactsDirty(projectId, [artifact.id], `Active transition-reference revision changed for ${artifact.id}.`);
  await updateProjectArtifactStatus(projectId, [artifact.id], "approved", { retryFromStage: "generation", parentRevisionIds, userAccepted: true });
  return requireVideoProject(userId, projectId);
}

async function syncTransitionReferenceArtifacts(project: VideoProjectWithShots): Promise<void> {
  for (const artifact of transitionReferenceArtifactsFromPlan(project.planJson).filter((item) => item.status === "video_running" && item.videoTaskId)) {
    const result = await queryDashScopeTask(artifact.videoTaskId as string);
    if (result.status === "failed") {
      await patchTransitionReferenceArtifact(project.id, artifact.id, { status: "failed", errorMessage: result.errorMessage || "Transition reference video generation failed" });
      await updateProjectArtifactStatus(project.id, [artifact.id], "failed", { dirtyReason: result.errorMessage || "Transition reference video generation failed", retryFromStage: "generation" });
      continue;
    }
    if (result.status !== "succeeded" || !result.resultUrl) continue;
    try {
      const videoUrl = await persistRemoteMediaToOss({ url: result.resultUrl, key: `one-prompt-video/transition-references/${project.id}/${artifact.id.replace(/[^a-z0-9_-]+/gi, "-")}-${Date.now()}.mp4`, fallbackContentType: "video/mp4" });
      await patchTransitionReferenceArtifact(project.id, artifact.id, { status: "evaluating_frames", videoUrl, videoTaskId: undefined });
      const frames = await extractVideoFrameDataUrls(videoUrl);
      const evaluated: TransitionReferenceFrameCandidate[] = [];
      for (const [index, frame] of frames.entries()) {
        const url = await persistRemoteMediaToOss({ url: frame.dataUrl, key: `one-prompt-video/transition-references/${project.id}/${artifact.id.replace(/[^a-z0-9_-]+/gi, "-")}-frame-${index + 1}-${Date.now()}.jpg`, fallbackContentType: "image/jpeg" });
        const id = `${artifact.id}:frame:${index + 1}`;
        const report = await evaluateGeneratedImageQuality({ assetId: artifact.id, candidateId: id, candidateNo: index + 1, mediaUrl: url, targetContract: { targetCameraId: artifact.toCameraId, relation: artifact.relation, inheritanceScope: artifact.inheritanceScope, reasonZh: artifact.reasonZh }, selectedReferenceUrls: artifact.parentKeyframeUrl ? [artifact.parentKeyframeUrl] : [], referenceUsageNotes: ["Parent camera is scene-layout evidence only; ignore identity, products, logos and text."], prompt: artifact.reasonZh, purpose: "transition_reference_frame" });
        await saveGenerationQualityReport(project.id, report);
        evaluated.push({ id, url, timestampFraction: frame.fraction, compositeScore: generationQualityCompositeScore(report), passed: report.passed, qualityReport: report });
      }
      const best = evaluated.filter((item) => item.passed).sort((a, b) => b.compositeScore - a.compositeScore)[0];
      if (!best) {
        await patchTransitionReferenceArtifact(project.id, artifact.id, { status: "failed", videoUrl, frameCandidates: evaluated, errorMessage: "No extracted transition frame passed actual-image quality evaluation" });
        await updateProjectArtifactStatus(project.id, [artifact.id], "failed", { dirtyReason: "No transition frame passed visual evaluation", retryFromStage: "generation" });
      } else {
        await patchTransitionReferenceArtifact(project.id, artifact.id, { status: "ready_for_review", videoUrl, frameCandidates: evaluated.map((item) => ({ ...item, selected: item.id === best.id })), selectedFrameUrl: artifact.selectedFrameUrl ?? best.url, locked: false, errorMessage: undefined });
        await updateProjectArtifactStatus(project.id, [artifact.id], "ready", { retryFromStage: "generation" });
      }
    } catch (error) {
      await patchTransitionReferenceArtifact(project.id, artifact.id, { status: "failed", errorMessage: error instanceof Error ? error.message : String(error) });
    }
  }
}

export async function generateGeneratedBridge(userId: string, projectId: string, artifactId: string): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  const artifact = generatedBridgeArtifactsFromPlan(project.planJson).find((item) => item.id === artifactId);
  if (!artifact) throw new Error("Generated bridge artifact not found");
  const fromSegment = project.segments.find((item) => item.segmentNo === artifact.fromSegmentNo);
  const toSegment = project.segments.find((item) => item.segmentNo === artifact.toSegmentNo);
  if (!fromSegment?.clipUrl || !toSegment?.clipUrl) throw new Error("Both adjacent segment clips must be ready before generating a bridge");
  const startFrame = project.keyframes.find((item) => item.keyframeNo === fromSegment.endKeyframeNo);
  const endFrame = project.keyframes.find((item) => item.keyframeNo === toSegment.startKeyframeNo);
  if (!startFrame?.imageUrl || !endFrame?.imageUrl) throw new Error("Bridge boundary frames are missing");
  const prompt = [
    "GENERATED BRIDGE ARTIFACT FOR FINAL EDIT — this clip enters the final composition and is not a transition-reference asset.",
    `Create a ${artifact.durationSeconds}s continuous visual bridge from segment ${artifact.fromSegmentNo}'s approved ending state toward segment ${artifact.toSegmentNo}'s approved starting state.`,
    `Start state: ${startFrame.purpose}; ${startFrame.scene}; ${startFrame.characterState}; ${startFrame.productState}.`,
    `End state target: ${endFrame.purpose}; ${endFrame.scene}; ${endFrame.characterState}; ${endFrame.productState}.`,
    "Preserve hard character/product identity, instance count, spatial logic and lighting. No captions, UI, wrong logo, random text, jump cut, dissolve, montage, teleportation, melting or scene replacement.",
    "One physically reachable take. The bridge must add meaningful visible connective motion and must not duplicate either full adjacent segment.",
  ].join("\n");
  const batchId = randomUUID();
  const priorBatches = new Set(project.generationCandidates.filter((item) => item.artifactId === artifact.id).map((item) => item.batchId));
  const attempt = priorBatches.size + 1;
  let submitted = 0;
  for (let candidateNo = 1; candidateNo <= videoCandidateCount(); candidateNo += 1) {
    try {
      const taskId = await submitAliyunImageToVideoTask({ imageUrl: startFrame.imageUrl, lastFrameUrl: endFrame.imageUrl, prompt, durationSeconds: Math.max(3, artifact.durationSeconds) });
      await prisma.videoGenerationCandidate.create({ data: { projectId, artifactId: artifact.id, targetId: artifact.id, kind: "generated_bridge", batchId, candidateNo, taskId, status: "running", prompt, negativePrompt: "cut, dissolve, montage, duplicate person, duplicate product, identity drift, wrong logo, random text, teleportation, melting, scene replacement", metadata: cleanInputJson({ attempt, durationSeconds: Math.max(3, artifact.durationSeconds), startFrameUrl: startFrame.imageUrl, endFrameUrl: endFrame.imageUrl, fromSegmentNo: artifact.fromSegmentNo, toSegmentNo: artifact.toSegmentNo, targetContract: { artifactType: "generated_bridge", entersFinalComposition: true } }) } });
      submitted += 1;
    } catch (error) {
      await prisma.videoGenerationCandidate.create({ data: { projectId, artifactId: artifact.id, targetId: artifact.id, kind: "generated_bridge", batchId, candidateNo, status: "failed", prompt, errorMessage: error instanceof Error ? error.message : String(error), metadata: cleanInputJson({ attempt, fromSegmentNo: artifact.fromSegmentNo, toSegmentNo: artifact.toSegmentNo }) } });
    }
  }
  if (!submitted) throw new Error("All generated bridge candidate submissions failed");
  await patchGeneratedBridgeArtifact(projectId, artifact.id, { status: "running", prompt, locked: false, errorMessage: undefined });
  await updateProjectArtifactStatus(projectId, [artifact.id], "generating", { retryFromStage: "generation" });
  return requireVideoProject(userId, projectId);
}

async function syncGeneratedBridgeCandidates(project: VideoProjectWithShots): Promise<void> {
  const running = project.generationCandidates.filter((item) => item.kind === "generated_bridge" && item.status === "running" && item.taskId);
  for (const candidate of running) {
    const result = await queryDashScopeTask(candidate.taskId as string);
    if (result.status === "failed") await prisma.videoGenerationCandidate.update({ where: { id: candidate.id }, data: { status: "failed", errorMessage: result.errorMessage || "Generated bridge failed" } });
    if (result.status === "succeeded" && result.resultUrl) {
      const mediaUrl = await persistRemoteMediaToOss({ url: result.resultUrl, key: `one-prompt-video/generated-bridges/${project.id}/${candidate.artifactId.replace(/[^a-z0-9_-]+/gi, "-")}-${candidate.batchId}-${candidate.candidateNo}.mp4`, fallbackContentType: "video/mp4" });
      await prisma.videoGenerationCandidate.update({ where: { id: candidate.id }, data: { status: "succeeded", mediaUrl } });
    }
  }
  const fresh = await prisma.videoGenerationCandidate.findMany({ where: { projectId: project.id, kind: "generated_bridge" }, orderBy: [{ createdAt: "desc" }, { candidateNo: "asc" }] });
  const latestBatch = new Map<string, string>();
  for (const item of fresh) if (!latestBatch.has(item.artifactId)) latestBatch.set(item.artifactId, item.batchId);
  for (const [artifactId, batchId] of latestBatch) {
    const batch = fresh.filter((item) => item.artifactId === artifactId && item.batchId === batchId);
    if (!batch.length || batch.some((item) => item.status === "running" || item.status === "pending") || batch.some((item) => item.status === "selected")) continue;
    for (const candidate of batch.filter((item) => item.status === "succeeded" && item.mediaUrl && !item.qualityReport)) {
      const metadata = candidateMetadata(candidate.metadata);
      const report = await evaluateGeneratedVideoQuality({ assetId: artifactId, candidateId: candidate.id, candidateNo: candidate.candidateNo, mediaUrl: candidate.mediaUrl as string, targetContract: isRecord(metadata.targetContract) ? metadata.targetContract : { artifactType: "generated_bridge" }, selectedReferenceUrls: [String(metadata.startFrameUrl || ""), String(metadata.endFrameUrl || "")].filter(Boolean), referenceUsageNotes: ["Approved source ending boundary", "Approved destination starting boundary"], prompt: candidate.prompt, purpose: "generated_bridge", durationSeconds: Number(metadata.durationSeconds) || 3, motionCheckpoints: [], startFrameUrl: String(metadata.startFrameUrl || ""), endFrameUrl: String(metadata.endFrameUrl || "") });
      await prisma.videoGenerationCandidate.update({ where: { id: candidate.id }, data: { status: "evaluated", qualityReport: cleanInputJson(report as unknown as Record<string, unknown>), compositeScore: generationQualityCompositeScore(report), passed: report.passed, retryInstruction: report.retryInstruction ?? null } });
      await saveGenerationQualityReport(project.id, report);
    }
    const evaluated = await prisma.videoGenerationCandidate.findMany({ where: { projectId: project.id, artifactId, batchId }, orderBy: { candidateNo: "asc" } });
    const best = evaluated.filter((item) => item.passed === true && item.mediaUrl).sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0))[0];
    if (!best) {
      await patchGeneratedBridgeArtifact(project.id, artifactId, { status: "failed", errorMessage: "No generated bridge candidate passed actual-video quality evaluation" });
      await updateProjectArtifactStatus(project.id, [artifactId], "failed", { dirtyReason: "No generated bridge candidate passed", retryFromStage: "generation" });
    } else {
      await prisma.videoGenerationCandidate.updateMany({ where: { projectId: project.id, artifactId }, data: { selected: false } });
      await prisma.videoGenerationCandidate.update({ where: { id: best.id }, data: { selected: true, status: "selected" } });
      const existingArtifact = generatedBridgeArtifactsFromPlan(project.planJson).find((item) => item.id === artifactId);
      await patchGeneratedBridgeArtifact(project.id, artifactId, { status: "ready_for_review", selectedVideoUrl: existingArtifact?.selectedVideoUrl ?? best.mediaUrl as string, locked: false, errorMessage: undefined });
      await updateProjectArtifactStatus(project.id, [artifactId], "ready", { retryFromStage: "generation" });
    }
  }
}

export async function approveGeneratedBridge(userId: string, projectId: string, artifactId: string, candidateId?: string): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  const artifact = generatedBridgeArtifactsFromPlan(project.planJson).find((item) => item.id === artifactId);
  if (!artifact) throw new Error("Generated bridge artifact not found");
  const candidate = candidateId
    ? project.generationCandidates.find((item) => item.id === candidateId && item.artifactId === artifact.id)
    : project.generationCandidates.find((item) => item.artifactId === artifact.id && item.selected);
  if (!candidate?.mediaUrl || candidate.passed !== true) throw new Error("Select a quality-passed generated bridge candidate before approval");
  const parentRevisionIds: string[] = [];
  if (artifact.selectedVideoUrl && artifact.selectedVideoUrl !== candidate.mediaUrl) {
    const revisionId = await appendVideoMediaRevision(projectId, { kind: "generated_bridge", targetId: artifact.id, segmentNo: artifact.fromSegmentNo, url: artifact.selectedVideoUrl });
    if (revisionId) parentRevisionIds.push(revisionId);
  }
  await prisma.videoGenerationCandidate.updateMany({ where: { projectId, artifactId }, data: { selected: false } });
  await prisma.videoGenerationCandidate.update({ where: { id: candidate.id }, data: { selected: true, status: "selected" } });
  await patchGeneratedBridgeArtifact(projectId, artifact.id, { status: "approved", selectedVideoUrl: candidate.mediaUrl, locked: true, errorMessage: undefined });
  await markProjectArtifactsDirty(projectId, [artifact.id], `Active generated-bridge revision changed for ${artifact.id}.`);
  await updateProjectArtifactStatus(projectId, [artifact.id], "approved", { retryFromStage: "generation", parentRevisionIds, userAccepted: true });
  return requireVideoProject(userId, projectId);
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

async function upgradeLegacyImageQualityReports(project: VideoProjectWithShots): Promise<boolean> {
  const candidates = [...project.generationCandidates]
    .filter((candidate) => (candidate.kind === "keyframe_image" || candidate.kind === "micro_shot_image") && candidate.qualityReport && isRecord(candidate.qualityReport))
    .sort((a, b) => a.candidateNo - b.candidateNo);
  const previousByArtifact = new Map<string, { report: GenerationQualityReport; mediaUrl?: string }>();
  let changed = false;
  for (const candidate of candidates) {
    const existing = candidate.qualityReport as unknown as GenerationQualityReport;
    if (existing.policyVersion === "quality-policy-v3") {
      previousByArtifact.set(candidate.artifactId, { report: existing, mediaUrl: candidate.mediaUrl ?? undefined });
      continue;
    }
    const metadata = candidateMetadata(candidate.metadata);
    const targetContract = isRecord(metadata.targetContract) ? metadata.targetContract : {};
    const referenceUsageNotes = stringArrayValue(metadata.referenceUsageNotes);
    const selectedReferenceUrls = stringArrayValue(metadata.selectedReferenceUrls);
    const visualContract = buildAuthoritativeVisualContract({
      targetContract,
      anchorContractText: referenceUsageNotes.join("\n"),
      prompt: candidate.prompt,
      negativePrompt: candidate.negativePrompt,
      mediaStage: "static_image",
      hasApprovedReferences: selectedReferenceUrls.length > 0,
    });
    const previous = previousByArtifact.get(candidate.artifactId);
    const assetCategory = readPlanShotString(targetContract, ["assetCategory", "asset_category", "kind"]);
    const evaluationParams = {
      assetId: candidate.artifactId,
      candidateId: candidate.id,
      candidateNo: candidate.candidateNo,
      mediaUrl: candidate.mediaUrl ?? existing.mediaUrl ?? "",
      targetContract,
      selectedReferenceUrls,
      referenceUsageNotes,
      prompt: candidate.prompt,
      negativePrompt: candidate.negativePrompt,
      purpose: candidate.kind === "micro_shot_image"
        ? "motion_checkpoint_image"
        : Number(metadata.keyframeNo) < 0 ? "anchor_reference_image" : "boundary_keyframe",
      assetCategory: assetCategory || undefined,
      requiresExactBrandText: Number(metadata.keyframeNo) < 0 && assetCategory === "brand_visual",
      visualContract,
      authoritativeContractConflicts: visualContract.verifiedConflicts,
      previousQualityReport: previous?.report,
      previousCandidateUrl: previous?.mediaUrl,
    } as const;
    const previousStatus = candidate.status;
    const normalized = normalizeImageQualityResponse(existing, evaluationParams);
    const report: GenerationQualityReport = existing.originalPassed === false
      ? {
          ...normalized,
          passed: false,
          originalPassed: false,
          userAccepted: existing.userAccepted === true,
        }
      : normalized;
    const upgraded = await prisma.videoGenerationCandidate.updateMany({
      where: {
        id: candidate.id,
        status: previousStatus,
        qualityReport: { equals: cleanInputJson(existing as unknown as Record<string, unknown>) },
      },
      data: {
        qualityReport: cleanInputJson(report as unknown as Record<string, unknown>),
        compositeScore: generationQualityCompositeScore(report),
        passed: report.passed,
        retryInstruction: report.retryInstruction ?? null,
      },
    });
    if (upgraded.count !== 1) continue;
    await saveGenerationQualityReport(project.id, report);
    previousByArtifact.set(candidate.artifactId, { report, mediaUrl: candidate.mediaUrl ?? undefined });
    changed = true;
  }
  return changed;
}

async function syncGenerationCandidates(project: VideoProjectWithShots): Promise<void> {
  await upgradeLegacyImageQualityReports(project);
  const coreKinds = new Set(["keyframe_image", "micro_shot_image", "segment_video"]);
  await prisma.videoGenerationCandidate.updateMany({
    where: {
      projectId: project.id,
      status: "evaluating",
      updatedAt: { lt: new Date(Date.now() - QUALITY_EVALUATION_LEASE_MS) },
    },
    data: { status: "succeeded", errorMessage: "Quality evaluation lease expired; retrying evaluation." },
  });
  const running = project.generationCandidates.filter((candidate) => coreKinds.has(candidate.kind) && candidate.status === "running" && candidate.taskId);
  for (const candidate of running) {
    const result = await queryDashScopeTask(candidate.taskId as string);
    if (result.status === "succeeded" && result.resultUrl) {
      const metadata = candidateMetadata(candidate.metadata);
      const mediaUrl = candidate.kind === "segment_video"
        ? await persistRemoteMediaToOss({
            url: result.resultUrl,
            key: `one-prompt-video/candidates/${project.id}/${candidate.artifactId.replace(/[^a-z0-9_-]+/gi, "-")}-${candidate.batchId}-${candidate.candidateNo}.mp4`,
            fallbackContentType: "video/mp4",
          })
        : await persistGeneratedImageUrl({
            projectId: project.id,
            sourceUrl: result.resultUrl,
            kind: candidate.kind === "keyframe_image" ? "keyframe" : "micro-shot",
            keyframeNo: Number(metadata.keyframeNo),
            segmentNo: Number(metadata.segmentNo),
            microShotNo: Number(metadata.microShotNo),
          });
      await prisma.videoGenerationCandidate.update({ where: { id: candidate.id }, data: { mediaUrl, status: "succeeded", errorMessage: null } });
    } else if (result.status === "failed") {
      await prisma.videoGenerationCandidate.update({ where: { id: candidate.id }, data: { status: "failed", errorMessage: result.errorMessage || "Upstream generation failed" } });
    }
  }

  let fresh = await prisma.videoGenerationCandidate.findMany({ where: { projectId: project.id, kind: { in: [...coreKinds] } }, orderBy: [{ createdAt: "desc" }, { candidateNo: "asc" }] });
  let requeuedHistoricalTechnicalFailures = false;
  for (const candidate of fresh) {
    if (!candidate.mediaUrl || !candidate.qualityReport || !isRecord(candidate.qualityReport)) continue;
    const report = candidate.qualityReport as unknown as GenerationQualityReport;
    if (!isTechnicalQualityEvaluationFailure(report) || candidate.status === "quality_retry" || candidate.status === "quality_failed") continue;
    const metadata = candidateMetadata(candidate.metadata);
    const requeued = await prisma.videoGenerationCandidate.updateMany({
      where: { id: candidate.id, status: candidate.status },
      data: {
        status: "quality_retry",
        compositeScore: null,
        passed: null,
        retryInstruction: null,
        metadata: cleanInputJson({
          ...metadata,
          qualityTechnicalAttempts: 0,
          qualityNextRetryAt: new Date().toISOString(),
        }),
      },
    });
    if (requeued.count === 1) {
      requeuedHistoricalTechnicalFailures = true;
    }
  }
  if (requeuedHistoricalTechnicalFailures) {
    fresh = await prisma.videoGenerationCandidate.findMany({ where: { projectId: project.id, kind: { in: [...coreKinds] } }, orderBy: [{ createdAt: "desc" }, { candidateNo: "asc" }] });
  }
  for (const candidate of fresh) {
    if (
      candidate.status !== "quality_retry"
      || !candidate.qualityReport
      || !isRecord(candidate.qualityReport)
      || !isTechnicalQualityEvaluationFailure(candidate.qualityReport as unknown as GenerationQualityReport)
      || !generationTargetNeedsTechnicalRetryReset(project, candidate)
    ) continue;
    await updateGenerationTargetForTechnicalQualityRetry(project, candidate, false, "");
    await updateProjectArtifactStatus(project.id, [candidate.artifactId], "generating", { retryFromStage: "generation" });
  }
  const artifactIds = [...new Set(fresh.map((candidate) => candidate.artifactId))];
  let evaluationsStarted = 0;
  for (const artifactId of artifactIds) {
    const artifactCandidates = fresh.filter((candidate) => candidate.artifactId === artifactId);

    // Evaluate every successful return across every batch. An older task may
    // finish after a retry batch was submitted; its paid result still belongs
    // in the quality pool and must not remain permanently at `succeeded`.
    const qualityWorkItems = artifactCandidates.filter((item) => {
      if (!item.mediaUrl) return false;
      if (item.status === "succeeded" && !item.qualityReport) return true;
      if (item.status !== "quality_retry") return false;
      const metadata = candidateMetadata(item.metadata);
      const nextRetryAt = Date.parse(String(metadata.qualityNextRetryAt || ""));
      return !Number.isFinite(nextRetryAt) || nextRetryAt <= Date.now();
    });
    for (const candidate of qualityWorkItems) {
      if (evaluationsStarted >= qualityEvaluationsPerSync()) break;
      const evaluationClaim = candidate.status === "quality_retry"
        ? await prisma.videoGenerationCandidate.updateMany({
            where: { id: candidate.id, status: "quality_retry" },
            data: { status: "evaluating", errorMessage: null },
          })
        : await prisma.videoGenerationCandidate.updateMany({
            where: {
              id: candidate.id,
              status: "succeeded",
              qualityReport: { equals: Prisma.DbNull },
            },
            data: { status: "evaluating", errorMessage: null },
          });
      if (evaluationClaim.count !== 1) continue;
      evaluationsStarted += 1;
      const metadata = candidateMetadata(candidate.metadata);
      const targetContract = isRecord(metadata.targetContract) ? metadata.targetContract : {};
      const visualContract = isRecord(metadata.visualContract)
        ? metadata.visualContract as unknown as AuthoritativeVisualContract
        : undefined;
      const previousCandidate = artifactCandidates
        .filter((item) => item.id !== candidate.id && item.candidateNo < candidate.candidateNo && item.qualityReport && isRecord(item.qualityReport))
        .sort((a, b) => b.candidateNo - a.candidateNo)[0];
      const previousQualityReport = previousCandidate?.qualityReport && isRecord(previousCandidate.qualityReport)
        ? previousCandidate.qualityReport as unknown as GenerationQualityReport
        : undefined;
      const assetCategory = readPlanShotString(targetContract, ["assetCategory", "asset_category", "kind"]);
      const brandVisualAsset = candidate.kind === "keyframe_image" && Number(metadata.keyframeNo) < 0 && assetCategory === "brand_visual";
      const common = {
        assetId: candidate.artifactId,
        candidateId: candidate.id,
        candidateNo: candidate.candidateNo,
        mediaUrl: candidate.mediaUrl as string,
        targetContract,
        selectedReferenceUrls: stringArrayValue(metadata.selectedReferenceUrls),
        referenceUsageNotes: stringArrayValue(metadata.referenceUsageNotes),
        prompt: candidate.prompt,
        negativePrompt: candidate.negativePrompt,
        visualContract,
        authoritativeContractConflicts: visualContract?.verifiedConflicts,
        previousQualityReport,
        previousCandidateUrl: previousCandidate?.mediaUrl ?? undefined,
      };
      try {
        const report = candidate.kind === "segment_video"
          ? await evaluateGeneratedVideoQuality({
              ...common,
              purpose: "video_segment",
              durationSeconds: Number(metadata.durationSeconds) || 0,
              motionCheckpoints: Array.isArray(metadata.motionCheckpoints) ? metadata.motionCheckpoints : [],
              startFrameUrl: String(metadata.startFrameUrl || ""),
              endFrameUrl: String(metadata.endFrameUrl || ""),
            })
          : await evaluateGeneratedImageQuality({
              ...common,
              purpose: candidate.kind === "micro_shot_image"
                ? "motion_checkpoint_image"
                : Number(metadata.keyframeNo) < 0 ? "anchor_reference_image" : "boundary_keyframe",
              assetCategory: assetCategory || undefined,
              requiresExactBrandText: brandVisualAsset,
            });
        const technicalFailure = isTechnicalQualityEvaluationFailure(report);
        const compositeScore = technicalFailure ? null : generationQualityCompositeScore(report);
        const technicalAttempts = Math.max(0, Number(metadata.qualityTechnicalAttempts) || 0) + 1;
        const technicalRetryExhausted = technicalAttempts >= qualityTechnicalRetryCycles();
        const technicalMetadata = cleanInputJson({
          ...metadata,
          qualityTechnicalAttempts: technicalAttempts,
          qualityNextRetryAt: new Date(Date.now() + qualityTechnicalRetryDelayMs(technicalAttempts)).toISOString(),
        }) as Prisma.InputJsonValue;
        const persistedEvaluation = await prisma.videoGenerationCandidate.updateMany({
          where: candidate.status === "quality_retry"
            ? {
                id: candidate.id,
                status: "evaluating",
              }
            : {
                id: candidate.id,
                status: "evaluating",
                qualityReport: { equals: Prisma.DbNull },
              },
          data: technicalFailure
            ? {
                qualityReport: cleanInputJson(report as unknown as Record<string, unknown>),
                compositeScore: null,
                passed: null,
                retryInstruction: null,
                status: technicalRetryExhausted ? "quality_failed" : "quality_retry",
                metadata: technicalMetadata,
              }
            : {
                qualityReport: cleanInputJson(report as unknown as Record<string, unknown>),
                compositeScore,
                passed: report.passed,
                retryInstruction: report.retryInstruction ?? null,
                status: "evaluated",
              },
        });
        if (persistedEvaluation.count !== 1) {
          await logOnePromptVideo("generation_quality.duplicate_result_discarded", {
            projectId: project.id,
            artifactId,
            candidateId: candidate.id,
          }, "warn");
          continue;
        }
        if (!technicalFailure) {
          await saveGenerationQualityReport(project.id, report);
        } else {
          const issue = report.artifactIssues.join("；") || "画面质检服务暂不可用";
          await updateGenerationTargetForTechnicalQualityRetry(project, candidate, technicalRetryExhausted, issue);
          await updateProjectArtifactStatus(
            project.id,
            [candidate.artifactId],
            technicalRetryExhausted ? "failed" : "generating",
            {
              dirtyReason: technicalRetryExhausted ? issue : undefined,
              retryFromStage: technicalRetryExhausted ? "manual" : "generation",
            },
          );
        }
      } catch (error) {
        await prisma.videoGenerationCandidate.updateMany({
          where: { id: candidate.id, status: "evaluating" },
          data: { status: "succeeded", errorMessage: error instanceof Error ? error.message : String(error) },
        });
        await logOnePromptVideo("generation_quality.evaluation_retry", {
          projectId: project.id,
          artifactId,
          candidateId: candidate.id,
          error: errorForLog(error),
        }, "warn");
      }
    }

    let allArtifactCandidates = await prisma.videoGenerationCandidate.findMany({ where: { projectId: project.id, artifactId }, orderBy: [{ createdAt: "desc" }, { candidateNo: "asc" }] });
    // Reclassify brand candidates from every attempt, not only the latest
    // batch. A later retry can be worse than an earlier usable logo.
    for (const candidate of allArtifactCandidates) {
      if (candidate.kind !== "keyframe_image" || candidate.passed === true || !candidate.mediaUrl || !candidate.qualityReport || !isRecord(candidate.qualityReport)) continue;
      const candidateMetadataValue = candidateMetadata(candidate.metadata);
      const targetContract = isRecord(candidateMetadataValue.targetContract) ? candidateMetadataValue.targetContract : {};
      const assetCategory = readPlanShotString(targetContract, ["assetCategory", "asset_category", "kind"]);
      if (Number(candidateMetadataValue.keyframeNo) >= 0 || assetCategory !== "brand_visual") continue;
      const normalized = normalizeImageQualityResponse(candidate.qualityReport, {
        assetId: candidate.artifactId,
        candidateId: candidate.id,
        candidateNo: candidate.candidateNo,
        mediaUrl: candidate.mediaUrl,
        targetContract,
        selectedReferenceUrls: stringArrayValue(candidateMetadataValue.selectedReferenceUrls),
        referenceUsageNotes: stringArrayValue(candidateMetadataValue.referenceUsageNotes),
        prompt: candidate.prompt,
        purpose: "anchor_reference_image",
        assetCategory,
        requiresExactBrandText: true,
      });
      if (!normalized.passed) continue;
      await prisma.videoGenerationCandidate.update({
        where: { id: candidate.id },
        data: { passed: true, qualityReport: cleanInputJson(normalized as unknown as Record<string, unknown>), compositeScore: generationQualityCompositeScore(normalized), retryInstruction: null },
      });
    }
    allArtifactCandidates = await prisma.videoGenerationCandidate.findMany({ where: { projectId: project.id, artifactId }, orderBy: [{ createdAt: "desc" }, { candidateNo: "asc" }] });
    // Do not rank a partial pool or start another paid retry while any submitted
    // task is still generating, persisting, or waiting for visual evaluation.
    const unsettledStatuses = new Set(["running", "pending", "succeeded", "evaluating", "quality_retry"]);
    if (allArtifactCandidates.some((candidate) => unsettledStatuses.has(candidate.status))) continue;

    const passing = allArtifactCandidates.filter((candidate) => candidate.passed === true && candidate.mediaUrl).sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0));
    const selected = passing[0];
    const currentSelection = allArtifactCandidates.find((candidate) => candidate.selected);
    const targetKeyframe = allArtifactCandidates[0]?.kind === "keyframe_image"
      ? project.keyframes.find((item) => item.id === allArtifactCandidates[0]?.targetId)
      : undefined;
    const targetSegment = allArtifactCandidates[0]?.kind === "segment_video"
      ? project.segments.find((item) => item.id === allArtifactCandidates[0]?.targetId)
      : undefined;
    const userProtectedSelection = Boolean(
      currentSelection?.userAccepted ||
      targetKeyframe?.locked || targetKeyframe?.status === VideoShotStatus.IMAGE_APPROVED ||
      targetSegment?.locked || targetSegment?.status === VideoShotStatus.CLIP_APPROVED
    );
    if (selected) {
      // Late results may win the global ranking, but an explicit user choice or
      // locked/approved target is immutable until the user selects a revision.
      if (userProtectedSelection || currentSelection?.id === selected.id) continue;
      await applySelectedGenerationCandidate(project, selected.id, false, false, [], true);
      continue;
    }

    if (userProtectedSelection) continue;
    const newestCandidate = allArtifactCandidates[0];
    if (!newestCandidate) continue;
    const newestMetadata = candidateMetadata(newestCandidate.metadata);
    const activeRetryCycleId = typeof newestMetadata.retryCycleId === "string" ? newestMetadata.retryCycleId : "";
    const retryCycleCandidates = activeRetryCycleId
      ? allArtifactCandidates.filter((candidate) => candidateMetadata(candidate.metadata).retryCycleId === activeRetryCycleId)
      : allArtifactCandidates.filter((candidate) => candidate.batchId === newestCandidate.batchId);
    const bestFailure = retryCycleCandidates.filter((candidate) =>
      candidate.qualityReport
      && isRecord(candidate.qualityReport)
      && !isTechnicalQualityEvaluationFailure(candidate.qualityReport as unknown as GenerationQualityReport),
    ).sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0))[0];
    const failureReport = bestFailure?.qualityReport && isRecord(bestFailure.qualityReport) ? bestFailure.qualityReport as unknown as GenerationQualityReport : undefined;
    const metadata = candidateMetadata(retryCycleCandidates[0]?.metadata ?? null);
    const anchorImageMisclassifiedAsStage2b = retryCycleCandidates[0]?.kind === "keyframe_image"
      && Number(metadata.keyframeNo) < 0
      && failureReport?.retryFromStage === "stage2b";
    const unverifiedEvaluatorConflict = failureReport?.retryFromStage === "stage3"
      && Boolean(failureReport.contractConflicts?.length)
      && failureReport.contractConflictsVerified !== true;
    const effectiveRetryFromStage = anchorImageMisclassifiedAsStage2b || unverifiedEvaluatorConflict
      ? "generation"
      : failureReport?.retryFromStage;
    const technicalEvaluationExhausted = retryCycleCandidates.some((candidate) =>
      candidate.status === "quality_failed"
      && candidate.qualityReport
      && isRecord(candidate.qualityReport)
      && isTechnicalQualityEvaluationFailure(candidate.qualityReport as unknown as GenerationQualityReport),
    );
    if (technicalEvaluationExhausted) {
      const preservedCandidate = retryCycleCandidates.find((candidate) =>
        candidate.status === "quality_failed"
        && Boolean(candidate.mediaUrl)
        && candidate.qualityReport
        && isRecord(candidate.qualityReport)
        && isTechnicalQualityEvaluationFailure(candidate.qualityReport as unknown as GenerationQualityReport),
      ) ?? newestCandidate;
      const issue = preservedCandidate.qualityReport && isRecord(preservedCandidate.qualityReport)
        ? (preservedCandidate.qualityReport as unknown as GenerationQualityReport).artifactIssues.join("；")
        : "画面质检服务暂不可用";
      await updateGenerationTargetForTechnicalQualityRetry(project, preservedCandidate, true, issue);
      await updateProjectArtifactStatus(project.id, [artifactId], "generating", {
        dirtyReason: issue,
        retryFromStage: "manual",
      });
      if (preservedCandidate.kind === "keyframe_image") {
        await prisma.videoProject.update({
          where: { id: project.id },
          data: { status: VideoProjectStatus.IMAGE_GENERATING, errorMessage: null },
        });
      } else if (preservedCandidate.kind === "segment_video") {
        await prisma.videoProject.update({
          where: { id: project.id },
          data: { status: VideoProjectStatus.CLIP_GENERATING, errorMessage: null },
        });
      }
      continue;
    }
    const qualityAttemptsUsed = generationQualityAttemptsUsed(retryCycleCandidates);
    const transportAttemptsUsed = generationTransportAttemptsUsed(retryCycleCandidates);
    const retryBudgetExhausted = qualityAttemptsUsed > generationMaxRetries();
    const transportRetryBudgetExhausted = !failureReport && transportAttemptsUsed > generationMaxRetries();
    const retryable = !technicalEvaluationExhausted
      && (!failureReport || effectiveRetryFromStage === "generation")
      && !retryBudgetExhausted
      && !transportRetryBudgetExhausted;
    const retryInstruction = failureReport?.retryInstruction || retryCycleCandidates.map((item) => item.errorMessage).filter(Boolean).join("; ") || "No generated candidate passed visual quality evaluation";
    const errorDetails = failureReport?.artifactIssues.length ? ` ${failureReport.artifactIssues.join("；")}` : "";
    const errorMessage = retryable
      ? null
      : technicalEvaluationExhausted
        ? `画面质检服务暂不可用，已保留现有候选图且未消耗画面生成重试预算。请稍后对现有候选重新质检。${errorDetails}`
      : retryBudgetExhausted
        ? `画面质检未通过，且该版本链的自动重试预算已用完（初始生成 1 次，自动重试 ${generationMaxRetries()} 次）。请查看候选结果后重新生成或人工接受。${errorDetails}`
        : transportRetryBudgetExhausted
          ? `上游生成或素材下载连续失败，技术重试预算已用完；这不代表画面质检未通过。请检查素材地址后重试。${errorDetails}`
        : effectiveRetryFromStage === "stage3"
          ? `画面质检发现经编译器确认的提示合同冲突，已暂停继续抽图，需先修正生成合同。${errorDetails}`
          : effectiveRetryFromStage === "stage2b"
            ? `画面质检发现镜头结构或叙事状态不可达，已暂停继续抽图，需先修正分镜结构。${errorDetails}`
            : `画面质检无法可靠完成，已暂停自动生成，请查看诊断后重试。${errorDetails}`;
    if (failureReport) await saveGenerationQualityReport(project.id, failureReport);
    if (retryCycleCandidates[0]?.kind === "keyframe_image") {
      await prisma.videoKeyframe.update({ where: { id: retryCycleCandidates[0].targetId }, data: { imageTaskId: null, status: retryable ? VideoShotStatus.IMAGE_PENDING : VideoShotStatus.FAILED, errorMessage } });
      if (retryable) await prisma.videoProject.update({ where: { id: project.id }, data: { status: VideoProjectStatus.IMAGE_GENERATING, errorMessage: null } });
    } else if (retryCycleCandidates[0]?.kind === "micro_shot_image") {
      await updatePlanMicroShot(project.id, Number(metadata.segmentNo), Number(metadata.microShotNo), { imageTaskId: "", imageStatus: retryable ? "idle" : "failed", errorMessage: errorMessage ?? "" });
    } else if (retryCycleCandidates[0]?.kind === "segment_video") {
      await prisma.videoSegment.update({ where: { id: retryCycleCandidates[0].targetId }, data: { clipTaskId: null, status: retryable ? VideoShotStatus.CLIP_PENDING : VideoShotStatus.FAILED, errorMessage } });
      if (retryable) await prisma.videoProject.update({ where: { id: project.id }, data: { status: VideoProjectStatus.CLIP_GENERATING, errorMessage: null } });
    }
    await updateProjectArtifactStatus(project.id, [artifactId], retryable ? "dirty" : "failed", {
      dirtyReason: errorMessage ?? retryInstruction,
      retryFromStage: technicalEvaluationExhausted
        ? "manual"
        : effectiveRetryFromStage === "stage2b"
          ? "stage2b"
          : effectiveRetryFromStage === "stage3"
            ? "stage3"
            : effectiveRetryFromStage === "manual"
              ? "manual"
              : "generation",
    });
  }
}

async function updateGenerationTargetForTechnicalQualityRetry(
  project: VideoProjectWithShots,
  candidate: VideoProjectWithShots["generationCandidates"][number],
  exhausted: boolean,
  errorMessage: string,
): Promise<void> {
  const metadata = candidateMetadata(candidate.metadata);
  if (candidate.kind === "keyframe_image") {
    await prisma.videoKeyframe.updateMany({
      where: { id: candidate.targetId },
      data: {
        status: VideoShotStatus.IMAGE_RUNNING,
        imageTaskId: candidate.taskId,
        errorMessage: exhausted ? errorMessage : null,
      },
    });
    return;
  }
  if (candidate.kind === "micro_shot_image") {
    await updatePlanMicroShot(project.id, Number(metadata.segmentNo), Number(metadata.microShotNo), {
      imageStatus: "running",
      imageTaskId: candidate.taskId ?? `quality:${candidate.id}`,
      errorMessage: exhausted ? errorMessage : "",
    });
    return;
  }
  if (candidate.kind === "segment_video") {
    await prisma.videoSegment.updateMany({
      where: { id: candidate.targetId },
      data: {
        status: VideoShotStatus.CLIP_RUNNING,
        clipTaskId: candidate.taskId,
        errorMessage: exhausted ? errorMessage : null,
      },
    });
  }
}

function generationTargetNeedsTechnicalRetryReset(
  project: VideoProjectWithShots,
  candidate: VideoProjectWithShots["generationCandidates"][number],
): boolean {
  if (candidate.kind === "keyframe_image") {
    const target = project.keyframes.find((item) => item.id === candidate.targetId);
    return Boolean(target && (target.status === VideoShotStatus.FAILED || target.errorMessage));
  }
  if (candidate.kind === "segment_video") {
    const target = project.segments.find((item) => item.id === candidate.targetId);
    return Boolean(target && (target.status === VideoShotStatus.FAILED || target.errorMessage));
  }
  if (candidate.kind === "micro_shot_image") {
    const metadata = candidateMetadata(candidate.metadata);
    const microShot = readPlanMicroShots(
      readPlanSegmentMap(project.planJson).get(Number(metadata.segmentNo)),
    ).find((item) => item.microShotNo === Number(metadata.microShotNo));
    return Boolean(microShot && (microShot.imageStatus === "failed" || microShot.errorMessage));
  }
  return false;
}

async function applySelectedGenerationCandidate(
  project: VideoProjectWithShots,
  candidateId: string,
  userAccepted: boolean,
  userApproved: boolean,
  parentRevisionIds: string[] = [],
  protectLockedSelection = false,
): Promise<void> {
  const candidate = await prisma.videoGenerationCandidate.findUnique({ where: { id: candidateId } });
  if (!candidate || candidate.projectId !== project.id || !candidate.mediaUrl) throw new Error("Generation candidate is unavailable");
  const report = candidate.qualityReport && isRecord(candidate.qualityReport) ? candidate.qualityReport as unknown as GenerationQualityReport : undefined;
  if (candidate.passed !== true && !userAccepted) throw new Error("Candidate did not pass visual quality evaluation");
  const acceptedReport = report ? { ...report, userAccepted: candidate.passed !== true && userAccepted, originalPassed: report.originalPassed ?? report.passed } : undefined;
  const metadata = candidateMetadata(candidate.metadata);
  const dependencyRevisionIds = activeDependencyRevisionIds(project, candidate.kind, candidate.targetId, metadata);
  let applied = false;
  await prisma.$transaction(async (tx) => {
    if (protectLockedSelection) {
      const acceptedSelection = await tx.videoGenerationCandidate.findFirst({
        where: { projectId: project.id, artifactId: candidate.artifactId, selected: true, userAccepted: true },
        select: { id: true },
      });
      if (acceptedSelection) return;
      if (candidate.kind === "keyframe_image") {
        const guarded = await tx.videoKeyframe.updateMany({
          where: { id: candidate.targetId, locked: false, NOT: { status: VideoShotStatus.IMAGE_APPROVED } },
          data: { imageUrl: candidate.mediaUrl, imageTaskId: null, status: VideoShotStatus.IMAGE_READY, qualityScore: Math.round(candidate.compositeScore ?? 0), errorMessage: null },
        });
        if (guarded.count !== 1) return;
      } else if (candidate.kind === "segment_video") {
        const guarded = await tx.videoSegment.updateMany({
          where: { id: candidate.targetId, locked: false, NOT: { status: VideoShotStatus.CLIP_APPROVED } },
          data: { clipUrl: candidate.mediaUrl, clipTaskId: null, status: VideoShotStatus.CLIP_READY, qualityScore: Math.round(candidate.compositeScore ?? 0), errorMessage: null },
        });
        if (guarded.count !== 1) return;
      }
    }
    await tx.videoGenerationCandidate.updateMany({
      where: { projectId: project.id, artifactId: candidate.artifactId, selected: true, id: { not: candidate.id } },
      data: { selected: false, status: "evaluated" },
    });
    await tx.videoGenerationCandidate.update({ where: { id: candidate.id }, data: { selected: true, userAccepted: candidate.passed !== true && userAccepted, status: "selected", qualityReport: acceptedReport ? cleanInputJson(acceptedReport as unknown as Record<string, unknown>) : undefined } });
    if (candidate.kind === "keyframe_image" && !protectLockedSelection) {
      const keyframe = project.keyframes.find((item) => item.id === candidate.targetId);
      if (!keyframe) throw new Error("Keyframe not found");
      await tx.videoKeyframe.update({ where: { id: keyframe.id }, data: { imageUrl: candidate.mediaUrl, imageTaskId: null, status: VideoShotStatus.IMAGE_READY, qualityScore: Math.round(candidate.compositeScore ?? 0), errorMessage: null } });
    } else if (candidate.kind === "segment_video" && !protectLockedSelection) {
      const segment = project.segments.find((item) => item.id === candidate.targetId);
      if (!segment) throw new Error("Video segment not found");
      await tx.videoSegment.update({ where: { id: segment.id }, data: { clipUrl: candidate.mediaUrl, clipTaskId: null, status: VideoShotStatus.CLIP_READY, qualityScore: Math.round(candidate.compositeScore ?? 0), errorMessage: null } });
    }
    applied = true;
  });
  if (!applied) return;
  if (candidate.kind === "segment_video") {
    const segment = project.segments.find((item) => item.id === candidate.targetId);
    if (segment) await invalidateGeneratedBridgesForSegment(project.id, segment.segmentNo, "Adjacent segment candidate changed; generated bridge approval must be renewed.");
  }
  if (candidate.kind === "micro_shot_image") {
    await updatePlanMicroShot(project.id, Number(metadata.segmentNo), Number(metadata.microShotNo), { imageUrl: candidate.mediaUrl, imageTaskId: "", imageStatus: "ready", errorMessage: "" });
  }
  if (acceptedReport) await saveGenerationQualityReport(project.id, acceptedReport);
  await markProjectArtifactsDirty(
    project.id,
    [candidate.artifactId],
    `Active revision changed for ${candidate.artifactId}; only its dependency-graph descendants require recovery.`,
  );
  await updateProjectArtifactStatus(project.id, [candidate.artifactId], "ready", { retryFromStage: "generation", userAccepted: userApproved, parentRevisionIds: uniqueStrings([...parentRevisionIds, ...dependencyRevisionIds]) });
  if (candidate.kind === "keyframe_image") {
    const keyframe = project.keyframes.find((item) => item.id === candidate.targetId);
    if (keyframe) await reconcileTransitionReferencesForAcceptedParent(project.id, keyframe.keyframeNo, candidate.mediaUrl);
  }
}

function activeDependencyRevisionIds(project: VideoProjectWithShots, kind: string, targetId: string, candidateMetadataValue: Record<string, unknown>): string[] {
  const plan = cloneJsonRecord(project.planJson ?? {});
  const artifactMetadata = ensurePlanArtifactMetadata(plan);
  const token = (artifactId: string) => `${artifactId}@r${artifactMetadata[artifactId]?.revision ?? 1}`;
  if (kind === "keyframe_image") {
    const keyframe = project.keyframes.find((item) => item.id === targetId);
    if (!keyframe || keyframe.keyframeNo >= 0) return [];
    const references = consistencyReferencesFromPlan(plan);
    const current = references.find((item) => item.keyframeNo === keyframe.keyframeNo);
    const source = current?.sourceArtifactId ? references.find((item) => item.assetId === current.sourceArtifactId) : undefined;
    return source ? [token(imageArtifactIdForKeyframeNo(source.keyframeNo))] : [];
  }
  if (kind === "segment_video") {
    const segment = project.segments.find((item) => item.id === targetId);
    return segment ? [token(imageArtifactIdForKeyframeNo(segment.startKeyframeNo)), token(imageArtifactIdForKeyframeNo(segment.endKeyframeNo))] : [];
  }
  if (kind === "micro_shot_image") {
    const segmentNo = Number(candidateMetadataValue.segmentNo);
    const segment = project.segments.find((item) => item.segmentNo === segmentNo);
    return segment ? [token(imageArtifactIdForKeyframeNo(segment.startKeyframeNo))] : [];
  }
  return [];
}

export async function selectGenerationCandidate(userId: string, projectId: string, candidateId: string, acceptFailed = false): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  const candidate = project.generationCandidates.find((item) => item.id === candidateId);
  if (!candidate) throw new Error("Generation candidate not found");
  if (!candidate.mediaUrl || !candidate.qualityReport) throw new Error("Candidate has not finished visual quality evaluation");
  if (candidate.passed !== true && !acceptFailed) throw new Error("This candidate failed quality evaluation; explicit acceptance is required");
  const parentRevisionIds: string[] = [];
  if (candidate.kind === "keyframe_image") {
    const keyframe = project.keyframes.find((item) => item.id === candidate.targetId);
    if (keyframe) {
      const revisionId = await appendVideoMediaRevision(projectId, { kind: "keyframe_image", targetId: keyframe.id, url: keyframe.imageUrl });
      if (revisionId) parentRevisionIds.push(revisionId);
    }
  } else if (candidate.kind === "segment_video") {
    const segment = project.segments.find((item) => item.id === candidate.targetId);
    if (segment) {
      const revisionId = await appendVideoMediaRevision(projectId, { kind: "segment_clip", targetId: segment.id, segmentNo: segment.segmentNo, url: segment.clipUrl });
      if (revisionId) parentRevisionIds.push(revisionId);
    }
  } else {
    const metadata = candidateMetadata(candidate.metadata);
    const micro = readPlanMicroShots(readPlanSegmentMap(project.planJson).get(Number(metadata.segmentNo))).find((item) => item.microShotNo === Number(metadata.microShotNo));
    const revisionId = await appendVideoMediaRevision(projectId, { kind: "micro_shot_image", targetId: candidate.targetId, segmentNo: Number(metadata.segmentNo), microShotNo: Number(metadata.microShotNo), url: micro?.imageUrl });
    if (revisionId) parentRevisionIds.push(revisionId);
  }
  await applySelectedGenerationCandidate(project, candidateId, acceptFailed, true, parentRevisionIds);
  let selectedProject = await requireVideoProject(userId, projectId);
  if (
    candidate.kind === "micro_shot_image"
    && selectedProject.status === VideoProjectStatus.MICRO_SHOT_REVIEW
    && requiredMicroShotImageIssues(selectedProject).length === 0
  ) {
    await logOnePromptVideo("micro_shot.manual_candidate.auto_continue", {
      userId,
      projectId,
      candidateId,
      artifactId: candidate.artifactId,
      userAccepted: acceptFailed,
    });
    return approveMicroShotReferences(userId, projectId);
  }
  const selectedKeyframe = candidate.kind === "keyframe_image"
    ? selectedProject.keyframes.find((item) => item.id === candidate.targetId)
    : undefined;
  const missingBoundaryFrames = selectedProject.keyframes.filter((item) => item.keyframeNo > 0 && !item.imageUrl);
  if (selectedKeyframe && selectedKeyframe.keyframeNo > 0 && missingBoundaryFrames.length > 0) {
    await prisma.videoKeyframe.updateMany({
      where: {
        projectId,
        keyframeNo: { gt: 0 },
        imageUrl: null,
        imageTaskId: null,
        NOT: { status: VideoShotStatus.IMAGE_APPROVED },
      },
      data: {
        status: VideoShotStatus.IMAGE_PENDING,
        errorMessage: null,
      },
    });
    selectedProject = await prisma.videoProject.update({
      where: { id: projectId },
      data: { status: VideoProjectStatus.IMAGE_GENERATING, errorMessage: null },
      include: PROJECT_INCLUDE,
    });
    await submitNextImageTask({
      userId,
      projectId,
      keyframes: selectedProject.keyframes,
      logEventPrefix: "image.continue_after_manual_candidate_selection",
    });
    await logOnePromptVideo("image.manual_candidate.continue_next", {
      userId,
      projectId,
      selectedKeyframeNo: selectedKeyframe.keyframeNo,
      remainingBoundaryKeyframeNos: missingBoundaryFrames.map((item) => item.keyframeNo),
      userAccepted: acceptFailed,
    });
    return requireVideoProject(userId, projectId);
  }
  return selectedProject;
}

export async function retryGenerationCandidateQuality(
  userId: string,
  projectId: string,
  candidateId: string,
): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  const candidate = project.generationCandidates.find((item) => item.id === candidateId);
  if (!candidate) throw new Error("Generation candidate not found");
  if (!candidate.mediaUrl || !candidate.qualityReport || !isRecord(candidate.qualityReport)) {
    throw new Error("Candidate media is not ready for visual quality evaluation");
  }
  const report = candidate.qualityReport as unknown as GenerationQualityReport;
  if (!isTechnicalQualityEvaluationFailure(report)) {
    throw new Error("Only a technical quality-evaluation failure can be retried without regenerating media");
  }
  const metadata = candidateMetadata(candidate.metadata);
  await prisma.videoGenerationCandidate.update({
    where: { id: candidate.id },
    data: {
      status: "quality_retry",
      passed: null,
      compositeScore: null,
      retryInstruction: null,
      errorMessage: null,
      metadata: cleanInputJson({
        ...metadata,
        qualityTechnicalAttempts: 0,
        qualityNextRetryAt: new Date().toISOString(),
      }),
    },
  });
  await updateGenerationTargetForTechnicalQualityRetry(project, candidate, false, "");
  await updateProjectArtifactStatus(project.id, [candidate.artifactId], "generating", { retryFromStage: "generation" });
  await prisma.videoProject.update({
    where: { id: project.id },
    data: { errorMessage: null },
  });
  return requireVideoProject(userId, projectId);
}

async function syncImageTasks(project: VideoProjectWithShots): Promise<void> {
  const candidateArtifacts = new Set(project.generationCandidates.map((candidate) => candidate.artifactId));
  const running = project.keyframes.filter((keyframe) => keyframe.status === VideoShotStatus.IMAGE_RUNNING && keyframe.imageTaskId && !candidateArtifacts.has(imageArtifactIdForKeyframeNo(keyframe.keyframeNo)));
  await logOnePromptVideo("image.sync.start", {
    projectId: project.id,
    runningCount: running.length,
    taskIds: running.map((keyframe) => ({ keyframeNo: keyframe.keyframeNo, imageTaskId: keyframe.imageTaskId })),
  });
  for (const keyframe of running) {
    const result = await queryDashScopeTask(keyframe.imageTaskId as string);
    await logOnePromptVideo("image.sync.shot.result", {
      projectId: project.id,
      keyframeId: keyframe.id,
      keyframeNo: keyframe.keyframeNo,
      imageTaskId: keyframe.imageTaskId,
      status: result.status,
      resultUrl: result.resultUrl,
      errorMessage: result.errorMessage,
    }, result.status === "failed" ? "error" : "info");
    if (result.status === "succeeded" && result.resultUrl) {
      const persistedImageUrl = await persistGeneratedImageUrl({
        projectId: project.id,
        sourceUrl: result.resultUrl,
        kind: "keyframe",
        keyframeNo: keyframe.keyframeNo,
      });
      await prisma.videoKeyframe.update({
        where: { id: keyframe.id },
        data: {
          imageUrl: persistedImageUrl,
          status: VideoShotStatus.IMAGE_READY,
          qualityScore: null,
          errorMessage: null,
        },
      });
      const planKeyframe = readPlanKeyframeMap(project.planJson).get(keyframe.keyframeNo) ??
        readPlanConsistencyReferenceMap(project.planJson).get(keyframe.keyframeNo);
      const assetCategory = readPlanShotString(planKeyframe, ["assetCategory", "asset_category"]);
      const consistencyReference = isConsistencyKeyframeNo(keyframe.keyframeNo);
      const consistencyKind = consistencyReference
        ? consistencyReferenceKindForPlan(planKeyframe, keyframe.keyframeNo)
        : undefined;
      const brandVisualAsset = isBrandVisualAssetKeyframe(consistencyReference, assetCategory, consistencyKind);
      const report = await evaluateGeneratedImageQuality({
        assetId: imageArtifactIdForKeyframeNo(keyframe.keyframeNo),
        mediaUrl: persistedImageUrl,
        prompt: keyframe.imagePrompt,
        negativePrompt: keyframe.negativePrompt,
        selectedReferenceUrls: selectedReferenceUrlsForPromptTarget(project.planJson, keyframeTargetArtifactId(keyframe.keyframeNo)),
        referenceUsageNotes: [],
        targetContract: planKeyframe ?? { purpose: keyframe.purpose, imagePrompt: keyframe.imagePrompt },
        purpose: consistencyReference ? "anchor_reference_image" : "boundary_keyframe",
        assetCategory: assetCategory || consistencyKind,
        requiresExactBrandText: brandVisualAsset,
      });
      await prisma.videoKeyframe.update({ where: { id: keyframe.id }, data: { qualityScore: Math.round(generationQualityCompositeScore(report)) } });
      await saveGenerationQualityReport(project.id, report);
      await appendProjectStageLog({
        projectId: project.id,
        title: project.title,
        stage: "keyframes",
        event: "Keyframe image ready KF" + keyframe.keyframeNo,
        summary: "A keyframe image finished and quality report was recorded.",
        lines: [
          "Image URL: " + persistedImageUrl,
          "Quality: " + (report.passed ? "passed" : "needs retry"),
          "Scores: identity=" + report.identityScore + ", layout=" + report.layoutScore + ", prompt=" + report.promptAlignmentScore + ", continuity=" + report.continuityScore,
          report.artifactIssues.length ? "Issues: " + report.artifactIssues.join("; ") : "No quality issues reported",
        ],
        data: {
          keyframeId: keyframe.id,
          keyframeNo: keyframe.keyframeNo,
          imageTaskId: keyframe.imageTaskId,
          imageUrl: persistedImageUrl,
          qualityReport: report,
        },
      });
      if (!report.passed) {
        if (consistencyReference) {
          await prisma.videoKeyframe.update({
            where: { id: keyframe.id },
            data: {
              status: VideoShotStatus.IMAGE_READY,
              errorMessage: assetQualityReviewMessage(report, brandVisualAsset),
            },
          });
        } else {
          await prisma.videoKeyframe.update({
            where: { id: keyframe.id },
            data: { status: VideoShotStatus.FAILED, errorMessage: report.retryInstruction || report.artifactIssues.join("; ") },
          });
        }
      }
    } else if (result.status === "failed") {
      await saveGenerationQualityReport(project.id, buildImageGenerationQualityReport({
        assetId: imageArtifactIdForKeyframeNo(keyframe.keyframeNo),
        imageUrl: null,
        prompt: keyframe.imagePrompt,
        targetType: keyframe.keyframeNo < 0 ? "anchor_reference_image" : "boundary_keyframe",
        upstreamError: result.errorMessage || "Boundary keyframe generation failed",
      }));
      await prisma.videoKeyframe.update({
        where: { id: keyframe.id },
        data: { status: VideoShotStatus.FAILED, errorMessage: result.errorMessage || "Asset reference image generation failed" },
      });
      await updateProjectArtifactStatus(project.id, [imageArtifactIdForKeyframeNo(keyframe.keyframeNo)], "failed", {
        dirtyReason: result.errorMessage || "Asset reference image generation failed",
        retryFromStage: "generation",
      });
      await appendProjectStageLog({
        projectId: project.id,
        title: project.title,
        stage: "keyframes",
        event: `Keyframe KF${keyframe.keyframeNo} image failed`,
        level: "error",
        summary: "The image task failed or returned an invalid result. The frame is marked failed for retry.",
        data: {
          keyframeId: keyframe.id,
          keyframeNo: keyframe.keyframeNo,
          imageTaskId: keyframe.imageTaskId,
          errorMessage: result.errorMessage,
        },
      });
    }
  }

  const latest = await prisma.videoProject.findUnique({ where: { id: project.id }, include: PROJECT_INCLUDE });
  if (!latest) return;
  const failed = latest.keyframes.find((keyframe) => keyframe.status === VideoShotStatus.FAILED);
  if (failed) {
    await prisma.videoProject.update({
      where: { id: project.id },
      data: { status: VideoProjectStatus.FAILED, errorMessage: failed.errorMessage || "Image generation failed" },
    });
    await logOnePromptVideo("image.sync.project.failed", {
      projectId: project.id,
      failedKeyframeNo: failed.keyframeNo,
      errorMessage: failed.errorMessage,
    }, "error");
    return;
  }
  if (latest.keyframes.length > 0 && latest.keyframes.every((keyframe) => Boolean(keyframe.imageUrl))) {
    await prisma.videoProject.update({
      where: { id: project.id },
      data: { status: VideoProjectStatus.IMAGE_REVIEW, errorMessage: null },
    });
    await logOnePromptVideo("image.sync.project.ready", {
      projectId: project.id,
      status: VideoProjectStatus.IMAGE_REVIEW,
      imageCount: latest.keyframes.length,
    });
    await appendProjectStageLog({
      projectId: project.id,
      title: latest.title,
      stage: "keyframes",
      event: "All keyframe images ready",
      summary: "All keyframe and reference images are ready for review.",
      lines: latest.keyframes.map((keyframe) => "KF" + keyframe.keyframeNo + ": " + (keyframe.imageUrl ? "ready" : "missing") + ", status=" + keyframe.status),
      data: {
        status: VideoProjectStatus.IMAGE_REVIEW,
        imageCount: latest.keyframes.length,
      },
    });
  }
  const runningCount = latest.keyframes.filter((keyframe) => keyframe.status === VideoShotStatus.IMAGE_RUNNING && keyframe.imageTaskId).length;
  const pending = latest.keyframes.some((keyframe) => keyframe.status === VideoShotStatus.IMAGE_PENDING);
  if (runningCount < imageTaskConcurrency() && pending) {
    await submitNextImageTask({
      projectId: project.id,
      keyframes: latest.keyframes,
      logEventPrefix: "image.sync",
    });
  }
}

async function syncMicroShotImageTasks(project: VideoProjectWithShots): Promise<void> {
  const planSegments = readPlanSegmentMap(project.planJson);
  const candidateArtifacts = new Set(project.generationCandidates.map((candidate) => candidate.artifactId));
  const running = project.segments.flatMap((segment) => {
    const microShots = readPlanMicroShots(planSegments.get(segment.segmentNo));
    return microShots
      .filter((microShot) => microShot.imageStatus === "running" && Boolean(microShot.imageTaskId) && !candidateArtifacts.has(imageArtifactIdForMicroShot(segment.segmentNo, microShot.microShotNo)))
      .map((microShot) => ({ segment, microShot }));
  });
  if (!running.length) return;

  await logOnePromptVideo("micro_shot.image.sync.start", {
    projectId: project.id,
    runningCount: running.length,
    taskIds: running.map((item) => ({
      segmentNo: item.segment.segmentNo,
      microShotNo: item.microShot.microShotNo,
      imageTaskId: item.microShot.imageTaskId,
    })),
  });

  for (const item of running) {
    const result = await queryDashScopeTask(item.microShot.imageTaskId as string);
    await logOnePromptVideo("micro_shot.image.sync.result", {
      projectId: project.id,
      segmentNo: item.segment.segmentNo,
      microShotNo: item.microShot.microShotNo,
      imageTaskId: item.microShot.imageTaskId,
      status: result.status,
      resultUrl: result.resultUrl,
      errorMessage: result.errorMessage,
    }, result.status === "failed" ? "error" : "info");
    if (result.status === "succeeded" && result.resultUrl) {
      const persistedImageUrl = await persistGeneratedImageUrl({
        projectId: project.id,
        sourceUrl: result.resultUrl,
        kind: "micro-shot",
        segmentNo: item.segment.segmentNo,
        microShotNo: item.microShot.microShotNo,
      });
      await updatePlanMicroShot(project.id, item.segment.segmentNo, item.microShot.microShotNo, {
        ...item.microShot,
        imageUrl: persistedImageUrl,
        imageStatus: "ready",
        errorMessage: "",
      });
      const targetArtifactId = "segment:" + item.segment.segmentNo + ":micro_shot:" + item.microShot.microShotNo;
      const report = await evaluateGeneratedImageQuality({
        assetId: imageArtifactIdForMicroShot(item.segment.segmentNo, item.microShot.microShotNo),
        mediaUrl: persistedImageUrl,
        prompt: localizedMicroShotImagePromptForGeneration(item.microShot),
        negativePrompt: readPlanShotString(item.microShot as unknown as Record<string, unknown>, ["negativePrompt", "negative_prompt"]),
        selectedReferenceUrls: selectedReferenceUrlsForPromptTarget(project.planJson, targetArtifactId),
        referenceUsageNotes: [],
        targetContract: item.microShot as unknown as Record<string, unknown>,
        purpose: "motion_checkpoint_image",
      });
      await saveGenerationQualityReport(project.id, report);
      await appendProjectStageLog({
        projectId: project.id,
        title: project.title,
        stage: "micro_shots",
        event: "Micro-shot image ready S" + item.segment.segmentNo + "." + item.microShot.microShotNo,
        summary: "Micro-shot reference image finished and quality report was recorded.",
        lines: [
          "Image URL: " + persistedImageUrl,
          "Quality: " + (report.passed ? "passed" : "needs retry"),
          "Purpose: " + (item.microShot.purposeZh || item.microShot.purpose || "untitled"),
          report.artifactIssues.length ? "Issues: " + report.artifactIssues.join("; ") : "No quality issues reported",
        ],
        data: {
          segmentNo: item.segment.segmentNo,
          microShotNo: item.microShot.microShotNo,
          imageTaskId: item.microShot.imageTaskId,
          imageUrl: persistedImageUrl,
          qualityReport: report,
        },
      });
      if (!report.passed) {
        await updatePlanMicroShot(project.id, item.segment.segmentNo, item.microShot.microShotNo, {
          ...item.microShot,
          imageStatus: "failed",
          errorMessage: report.retryInstruction || report.artifactIssues.join("; "),
        });
      }
    } else if (result.status === "failed") {
      await saveGenerationQualityReport(project.id, buildImageGenerationQualityReport({
        assetId: imageArtifactIdForMicroShot(item.segment.segmentNo, item.microShot.microShotNo),
        imageUrl: null,
        prompt: localizedMicroShotImagePromptForGeneration(item.microShot),
        targetType: "motion_checkpoint_image",
        upstreamError: result.errorMessage || "Micro-shot reference image generation failed",
      }));
      await updatePlanMicroShot(project.id, item.segment.segmentNo, item.microShot.microShotNo, {
        ...item.microShot,
        imageStatus: "failed",
        errorMessage: result.errorMessage || "Micro-shot reference image generation failed",
      });
      await updateProjectArtifactStatus(project.id, [imageArtifactIdForMicroShot(item.segment.segmentNo, item.microShot.microShotNo)], "failed", {
        dirtyReason: result.errorMessage || "Micro-shot reference image generation failed",
        retryFromStage: "generation",
      });
      await appendProjectStageLog({
        projectId: project.id,
        title: project.title,
        stage: "micro_shots",
        event: "Micro-shot image failed S" + item.segment.segmentNo + "." + item.microShot.microShotNo,
        level: "error",
        summary: "Micro-shot reference image generation failed upstream.",
        data: {
          segmentNo: item.segment.segmentNo,
          microShotNo: item.microShot.microShotNo,
          imageTaskId: item.microShot.imageTaskId,
          errorMessage: result.errorMessage,
        },
      });
    }
  }
}

async function submitNextImageTask(params: {
  userId?: string;
  projectId: string;
  keyframes: VideoProjectWithShots["keyframes"];
  logEventPrefix: string;
}): Promise<void> {
  const running = params.keyframes.filter((keyframe) => keyframe.status === VideoShotStatus.IMAGE_RUNNING && keyframe.imageTaskId);
  const concurrency = imageTaskConcurrency();
  const availableSlots = Math.max(0, concurrency - running.length);
  if (!availableSlots) {
    await logOnePromptVideo(params.logEventPrefix + ".submit.skip_running", {
      userId: params.userId,
      projectId: params.projectId,
      runningCount: running.length,
      concurrency,
      taskIds: running.map((keyframe) => ({ keyframeNo: keyframe.keyframeNo, imageTaskId: keyframe.imageTaskId })),
    });
    return;
  }

  const project = await prisma.videoProject.findUnique({
    where: { id: params.projectId },
    include: PROJECT_INCLUDE,
  });
  if (!project) return;

  const nextKeyframes = [...params.keyframes]
    .sort((a, b) => assetGenerationPriority(project.planJson, a.keyframeNo) - assetGenerationPriority(project.planJson, b.keyframeNo) || a.keyframeNo - b.keyframeNo)
    .filter((keyframe) => {
      if (keyframe.locked && keyframe.imageUrl) return false;
      if (keyframe.imageUrl) return false;
      if (keyframe.status === VideoShotStatus.IMAGE_RUNNING) return false;
      return keyframe.status !== VideoShotStatus.IMAGE_READY && keyframe.status !== VideoShotStatus.IMAGE_APPROVED;
    });
  const consistencyReferences = params.keyframes.filter((keyframe) => isConsistencyKeyframeNo(keyframe.keyframeNo));
  const missingConsistencyReferences = consistencyReferences.filter((keyframe) => !keyframe.imageUrl);
  const unapprovedConsistencyReferences = consistencyReferences.filter((keyframe) => keyframe.imageUrl && !isApprovedConsistencyReference(keyframe));
  const waitingForConsistencyReferences = missingConsistencyReferences.length > 0 || unapprovedConsistencyReferences.length > 0;
  const candidateKeyframes = missingConsistencyReferences.length
    ? nextKeyframes.filter((keyframe) => isConsistencyKeyframeNo(keyframe.keyframeNo) && isAssetViewGenerationReady(project, keyframe.keyframeNo))
    : waitingForConsistencyReferences
      ? []
      : nextKeyframes.filter((keyframe) => !isConsistencyKeyframeNo(keyframe.keyframeNo) && isTransitionReferenceReadyForBoundary(project, keyframe.keyframeNo));
  if (missingConsistencyReferences.length && !candidateKeyframes.length) {
    const blockedDerivedViews = missingConsistencyReferences.filter((keyframe) => !isAssetViewGenerationReady(project, keyframe.keyframeNo));
    if (blockedDerivedViews.length && !running.length) {
      await prisma.videoProject.update({
        where: { id: params.projectId },
        data: {
          status: VideoProjectStatus.IMAGE_REVIEW,
          errorMessage: "Approve and lock each person front view before generating its side and back views.",
        },
      });
    }
    await logOnePromptVideo(params.logEventPrefix + ".submit.wait_consistency_references", {
      userId: params.userId,
      projectId: params.projectId,
      runningCount: running.length,
      concurrency,
      consistencyReferences: consistencyReferences.map((keyframe) => ({
        keyframeNo: keyframe.keyframeNo,
        status: keyframe.status,
        imageTaskId: keyframe.imageTaskId,
        hasImageUrl: Boolean(keyframe.imageUrl),
        locked: keyframe.locked,
      })),
    });
    return;
  }
  if (!missingConsistencyReferences.length && unapprovedConsistencyReferences.length) {
    await prisma.videoProject.update({
      where: { id: params.projectId },
      data: {
        status: VideoProjectStatus.IMAGE_REVIEW,
        errorMessage: "Hard consistency reference images are ready. Lock or approve them before generating boundary keyframes.",
      },
    });
    await logOnePromptVideo(params.logEventPrefix + ".submit.wait_consistency_approval", {
      userId: params.userId,
      projectId: params.projectId,
      consistencyReferences: unapprovedConsistencyReferences.map((keyframe) => ({
        keyframeNo: keyframe.keyframeNo,
        status: keyframe.status,
        hasImageUrl: Boolean(keyframe.imageUrl),
        locked: keyframe.locked,
      })),
    });
    return;
  }
  const nextKeyframesToSubmit = candidateKeyframes.slice(0, availableSlots);
  if (!nextKeyframesToSubmit.length) {
    const blockedBoundaryKeyframes = nextKeyframes.filter((keyframe) =>
      !isConsistencyKeyframeNo(keyframe.keyframeNo) && !isTransitionReferenceReadyForBoundary(project, keyframe.keyframeNo)
    );
    if (blockedBoundaryKeyframes.length && !running.length) {
      const frontier = [...blockedBoundaryKeyframes].sort((a, b) => a.keyframeNo - b.keyframeNo)[0];
      const frontierSegmentNo = segmentNoForBoundaryKeyframe(project.planJson, frontier.keyframeNo);
      const transition = transitionReferenceArtifactsFromPlan(project.planJson).find((item) => item.toSegmentNo === frontierSegmentNo);
      const dependency = transition?.parentKeyframeNo ? `，依赖 KF${transition.parentKeyframeNo}` : "";
      await prisma.videoProject.update({
        where: { id: params.projectId },
        data: {
          status: VideoProjectStatus.IMAGE_REVIEW,
          errorMessage: `当前生成前沿为 KF${frontier.keyframeNo}${dependency}。请先让该依赖的当前采用版本通过质检或完成人工确认。后续边界帧会按顺序自动继续。`,
        },
      });
    }
    await logOnePromptVideo(params.logEventPrefix + ".submit.no_pending", {
      userId: params.userId,
      projectId: params.projectId,
      runningCount: running.length,
      concurrency,
      blockedBoundaryKeyframeNos: blockedBoundaryKeyframes.map((item) => item.keyframeNo),
    });
    return;
  }

  await logOnePromptVideo(params.logEventPrefix + ".submit.batch", {
    userId: params.userId,
    projectId: params.projectId,
    runningCount: running.length,
    concurrency,
    submitCount: nextKeyframesToSubmit.length,
    keyframeNos: nextKeyframesToSubmit.map((keyframe) => keyframe.keyframeNo),
    consistencyGateActive: waitingForConsistencyReferences,
  });

  for (const nextKeyframe of nextKeyframesToSubmit) {
    try {
      const artifactId = imageArtifactIdForKeyframeNo(nextKeyframe.keyframeNo);
      const learning = buildImageCandidateLearningSummary(project, artifactId, nextKeyframe.imageUrl);
      const draftPrompt = compileImagePromptForKeyframe(project, nextKeyframe);
      const referenceSelection = await selectReferenceImagesForKeyframe(project, nextKeyframe, draftPrompt.prompt);
      const compiled = compileImagePromptForKeyframe(project, nextKeyframe, {
        ...referenceSelection.output,
        finalTextPrompt: draftPrompt.prompt,
      });
      assertCompiledVisualContractReady(compiled);
      const learnedPrompt = [compiled.prompt, learning.promptAddon].filter(Boolean).join("\n\n");
      const learnedReferenceUrls = uniqueStrings([
        ...learning.referenceImageUrls,
        ...(compiled.referenceImageUrls ?? []),
      ]).slice(0, ONE_PROMPT_MAX_REFERENCE_IMAGES);
      const authoritativeAnchorLocks = consistencyAnchorLocksForPrompt(
        project.planJson,
        readPlanStringArray(readPlanKeyframeMap(project.planJson).get(nextKeyframe.keyframeNo), ["usesConsistencyAnchors", "uses_consistency_anchors"]),
      );
      const learnedReferenceUsageNotes = uniqueStrings([
        ...learning.referenceUsageNotes,
        ...(referenceSelection.output.usageNotes ?? []),
        authoritativeAnchorLocks ? `AUTHORITATIVE ANCHOR CONTRACTS — visible words and markings in these locks are required, not forbidden:\n${authoritativeAnchorLocks}` : "",
      ]);
      await saveReferenceSelectionOutput(params.projectId, {
        ...referenceSelection.output,
        selectedReferenceUrls: learnedReferenceUrls,
        finalTextPrompt: learnedPrompt,
      });
      await savePromptDebugArtifact(params.projectId, {
        ...compiled.debugArtifact,
        inputs: {
          ...compiled.debugArtifact.inputs,
          incrementalCandidateLearning: learning.debugSummary,
        },
        selectedReferenceUrls: learnedReferenceUrls,
        referenceUsageNotes: learnedReferenceUsageNotes,
        finalPrompt: learnedPrompt,
        rules: uniqueStrings([...compiled.debugArtifact.rules, "incremental_candidate_learning", "preserve_candidate_history"]),
      });
      const claim = await prisma.videoKeyframe.updateMany({
        where: {
          id: nextKeyframe.id,
          imageUrl: null,
          imageTaskId: null,
          status: VideoShotStatus.IMAGE_PENDING,
        },
        data: {
          status: VideoShotStatus.IMAGE_RUNNING,
          errorMessage: null,
        },
      });
      if (claim.count !== 1) {
        await logOnePromptVideo(params.logEventPrefix + ".submit.skip_claimed", {
          userId: params.userId,
          projectId: params.projectId,
          keyframeId: nextKeyframe.id,
          keyframeNo: nextKeyframe.keyframeNo,
          reason: "another sync request already claimed this keyframe",
        });
        continue;
      }
      const taskId = await createImageCandidateBatch({
        project,
        artifactId,
        targetId: nextKeyframe.id,
        kind: "keyframe_image",
        prompt: learnedPrompt,
        negativePrompt: compiled.negativePrompt,
        referenceImageUrls: learnedReferenceUrls,
        seedBase: Math.abs(nextKeyframe.keyframeNo) || 1,
        candidateCount: 1,
        metadata: {
          incrementalRegeneration: learning.historicalCandidateCount > 0,
          historicalCandidateCount: learning.historicalCandidateCount,
          learnedFromCandidateIds: learning.sourceCandidateIds,
          keyframeNo: nextKeyframe.keyframeNo,
          targetContract: readPlanKeyframeMap(project.planJson).get(nextKeyframe.keyframeNo) ?? { purpose: nextKeyframe.purpose, imagePrompt: nextKeyframe.imagePrompt },
          visualContract: compiled.debugArtifact.inputs.visualContract,
          selectedReferenceUrls: learnedReferenceUrls,
          referenceUsageNotes: learnedReferenceUsageNotes,
        },
      });
      await prisma.videoKeyframe.update({
        where: { id: nextKeyframe.id },
        data: {
          imageTaskId: taskId,
          imageUrl: null,
          status: VideoShotStatus.IMAGE_RUNNING,
          qualityScore: null,
          errorMessage: null,
        },
      });
      await updateProjectArtifactStatus(params.projectId, [artifactId], "generating", { retryFromStage: "generation" });
      await logOnePromptVideo(params.logEventPrefix + ".submit.success", {
        userId: params.userId,
        projectId: params.projectId,
        keyframeId: nextKeyframe.id,
        keyframeNo: nextKeyframe.keyframeNo,
        imageTaskId: taskId,
      });
      await appendProjectStageLog({
        projectId: params.projectId,
        title: project.title,
        stage: "keyframes",
        event: "Keyframe image task submitted KF" + nextKeyframe.keyframeNo,
        summary: nextKeyframe.keyframeNo < 0 ? "Submitted a consistency reference image task." : "Submitted a boundary keyframe image task.",
        lines: [
          "Purpose: " + (nextKeyframe.purpose || "untitled"),
          "Candidate tasks: 1 (incremental candidate #" + (learning.historicalCandidateCount + 1) + ", legacy task ID: " + taskId + ")",
          "Historical candidates preserved: " + learning.historicalCandidateCount,
          "Reference images: " + learnedReferenceUrls.length,
          "Prompt: " + learnedPrompt.slice(0, 400),
        ],
        data: {
          userId: params.userId,
          keyframeId: nextKeyframe.id,
          keyframeNo: nextKeyframe.keyframeNo,
          imageTaskId: taskId,
          referenceImageUrls: compiled.referenceImageUrls ?? [],
          negativePrompt: compiled.negativePrompt,
        },
      });
    } catch (error) {
      const retryable = isAliyunRateLimitError(error);
      await prisma.videoKeyframe.update({
        where: { id: nextKeyframe.id },
        data: {
          status: retryable ? VideoShotStatus.IMAGE_PENDING : VideoShotStatus.FAILED,
          errorMessage: retryable ? "Aliyun rate limit, will retry later" : error instanceof Error ? error.message : "Image submit failed",
        },
      });
      if (!retryable) {
        await saveGenerationQualityReport(params.projectId, buildImageGenerationQualityReport({
          assetId: imageArtifactIdForKeyframeNo(nextKeyframe.keyframeNo),
          imageUrl: null,
          prompt: nextKeyframe.imagePrompt,
          targetType: nextKeyframe.keyframeNo < 0 ? "anchor_reference_image" : "boundary_keyframe",
          upstreamError: error instanceof Error ? error.message : "Image submit failed",
        }));
        await updateProjectArtifactStatus(params.projectId, [imageArtifactIdForKeyframeNo(nextKeyframe.keyframeNo)], "failed", {
          dirtyReason: error instanceof Error ? error.message : "Image submit failed",
          retryFromStage: "generation",
        });
      }
      await logOnePromptVideo(params.logEventPrefix + ".submit.error", {
        userId: params.userId,
        projectId: params.projectId,
        keyframeId: nextKeyframe.id,
        keyframeNo: nextKeyframe.keyframeNo,
        retryable,
        ...errorForLog(error),
      }, retryable ? "warn" : "error");
      await writeStageErrorLog({
        projectId: params.projectId,
        title: project.title,
        stage: "keyframes",
        event: "Keyframe image submit failed KF" + nextKeyframe.keyframeNo,
        error,
        context: {
          userId: params.userId,
          keyframeId: nextKeyframe.id,
          keyframeNo: nextKeyframe.keyframeNo,
          retryable,
        },
      });
      if (!retryable) throw error;
      break;
    }
  }
}

async function syncClipTasks(project: VideoProjectWithShots): Promise<void> {
  const clipBackedUnreadySegments = project.segments.filter(
    (segment) =>
      Boolean(segment.clipUrl) &&
      (segment.status === VideoShotStatus.CLIP_PENDING || segment.status === VideoShotStatus.CLIP_RUNNING),
  );
  const recoverableClipBackedSegments = clipBackedUnreadySegments.filter((segment) => latestGenerationQualityReport(project.planJson, videoArtifactIdForSegmentNo(segment.segmentNo))?.passed);
  const unsafeClipBackedSegments = clipBackedUnreadySegments.filter((segment) => !recoverableClipBackedSegments.includes(segment));
  if (recoverableClipBackedSegments.length) {
    await prisma.videoSegment.updateMany({
      where: {
        projectId: project.id,
        id: { in: recoverableClipBackedSegments.map((segment) => segment.id) },
        status: { in: [VideoShotStatus.CLIP_PENDING, VideoShotStatus.CLIP_RUNNING] },
      },
      data: { status: VideoShotStatus.CLIP_READY, clipTaskId: null, errorMessage: null },
    });
    await logOnePromptVideo("clip.sync.recover_ready_status", {
      projectId: project.id,
      segments: recoverableClipBackedSegments.map((segment) => ({
        segmentNo: segment.segmentNo,
        previousStatus: segment.status,
        hasClipUrl: Boolean(segment.clipUrl),
      })),
    }, "warn");
  }
  if (unsafeClipBackedSegments.length) {
    await prisma.videoSegment.updateMany({
      where: { id: { in: unsafeClipBackedSegments.map((segment) => segment.id) } },
      data: { status: VideoShotStatus.FAILED, clipTaskId: null, errorMessage: "Clip has no passed end-frame continuity report; visual continuity evaluation is required." },
    });
  }

  const candidateArtifacts = new Set(project.generationCandidates.map((candidate) => candidate.artifactId));
  const running = project.segments.filter((segment) => segment.status === VideoShotStatus.CLIP_RUNNING && segment.clipTaskId && !segment.clipUrl && !candidateArtifacts.has(videoArtifactIdForSegmentNo(segment.segmentNo)));
  await logOnePromptVideo("clip.sync.start", {
    projectId: project.id,
    runningCount: running.length,
    taskIds: running.map((segment) => ({ segmentNo: segment.segmentNo, clipTaskId: segment.clipTaskId })),
  });
  for (const segment of running) {
    const startKeyframe = project.keyframes.find((keyframe) => keyframe.keyframeNo === segment.startKeyframeNo);
    const endKeyframe = project.keyframes.find((keyframe) => keyframe.keyframeNo === segment.endKeyframeNo);
    const qualityPrompt = startKeyframe && endKeyframe
      ? compileVideoPromptForSegment(project, segment, startKeyframe, endKeyframe).prompt
      : segment.videoPrompt;
    const result = await queryDashScopeTask(segment.clipTaskId as string);
    await logOnePromptVideo("clip.sync.shot.result", {
      projectId: project.id,
      segmentId: segment.id,
      segmentNo: segment.segmentNo,
      clipTaskId: segment.clipTaskId,
      status: result.status,
      resultUrl: result.resultUrl,
      errorMessage: result.errorMessage,
    }, result.status === "failed" ? "error" : "info");
    if (result.status === "succeeded" && result.resultUrl) {
      const artifactId = videoArtifactIdForSegmentNo(segment.segmentNo);
      let clipUrl = result.resultUrl;
      try {
        if (!endKeyframe?.imageUrl) throw new Error("Approved segment end-frame image is missing");
        clipUrl = await persistRemoteMediaToOss({
          url: result.resultUrl,
          key: `one-prompt-video/segments/${project.id}-segment-${segment.segmentNo}-${Date.now()}.mp4`,
          fallbackContentType: "video/mp4",
        });
      } catch (error) {
        const message = `Failed to persist generated segment before continuity evaluation: ${error instanceof Error ? error.message : String(error)}`;
        await prisma.videoSegment.update({
          where: { id: segment.id },
          data: { status: VideoShotStatus.FAILED, errorMessage: message },
        });
        await updateProjectArtifactStatus(project.id, [artifactId], "failed", {
          dirtyReason: message,
          retryFromStage: "generation",
        });
        continue;
      }
      const renderDescription = readPlanSegmentRenderDescriptionMap(project.planJson).get(segment.segmentNo);
      const continuity = await evaluateEndFrameContinuity({
        projectId: project.id,
        segmentNo: segment.segmentNo,
        clipUrl,
        approvedEndFrameUrl: endKeyframe?.imageUrl ?? "",
        endFrameContract: readLooseRecord(renderDescription ?? {}, ["endFrameContract", "end_frame_contract"]),
        motionContract: readLooseRecord(renderDescription ?? {}, ["motionContract", "motion_contract"]),
      });
      const previousReport = latestGenerationQualityReport(project.planJson, artifactId);
      const continuityRetryCount = (previousReport?.continuityRetryCount ?? 0) + (continuity.decision === "retry_generation" ? 1 : 0);
      const actualReport = await evaluateGeneratedVideoQuality({
        assetId: artifactId,
        mediaUrl: clipUrl,
        prompt: qualityPrompt,
        purpose: "video_segment",
        targetContract: renderDescription ?? {},
        selectedReferenceUrls: selectedReferenceUrlsForPromptTarget(project.planJson, `segment:${segment.segmentNo}`),
        referenceUsageNotes: [],
        durationSeconds: segment.durationSeconds,
        motionCheckpoints: readPlanMicroShots(readPlanSegmentMap(project.planJson).get(segment.segmentNo)),
        startFrameUrl: startKeyframe?.imageUrl ?? "",
        endFrameUrl: endKeyframe?.imageUrl ?? "",
      });
      const report: GenerationQualityReport = {
        ...actualReport,
        endFrameDecision: continuity.decision,
        endFrameSimilarityScore: continuity.similarityScore,
        endFrameReasons: continuity.reasons,
        continuityRetryCount,
        passed: actualReport.passed && continuity.decision === "pass",
        retryInstruction: actualReport.retryInstruction || continuity.retryInstruction,
        retryFromStage: actualReport.retryFromStage === "stage2b" || continuity.decision === "return_stage_2b" ? "stage2b" : actualReport.retryFromStage,
      };
      await saveGenerationQualityReport(project.id, report);
      const mayRetry = report.passed === false && report.retryFromStage === "generation" && continuityRetryCount <= maxEndFrameContinuityRetries();
      await appendVideoMediaRevision(project.id, {
        kind: "segment_clip",
        targetId: segment.id,
        segmentNo: segment.segmentNo,
        url: clipUrl,
      });
      await prisma.videoSegment.update({
        where: { id: segment.id },
        data: report.passed
          ? { clipUrl, clipTaskId: null, status: VideoShotStatus.CLIP_READY, qualityScore: Math.round(generationQualityCompositeScore(report)), errorMessage: null }
          : mayRetry
            ? { clipUrl: null, clipTaskId: null, status: VideoShotStatus.CLIP_PENDING, qualityScore: Math.round(generationQualityCompositeScore(report)), errorMessage: report.retryInstruction }
            : { clipUrl, clipTaskId: null, status: VideoShotStatus.FAILED, qualityScore: Math.round(generationQualityCompositeScore(report)), errorMessage: report.retryInstruction || report.artifactIssues.join("; ") },
      });
      await appendProjectStageLog({
        projectId: project.id,
        title: project.title,
        stage: "clips",
        event: report.passed ? "Clip ready segment " + segment.segmentNo : mayRetry ? "Clip continuity retry segment " + segment.segmentNo : "Clip continuity blocked segment " + segment.segmentNo,
        level: report.passed ? "info" : "warn",
        summary: report.passed
          ? "The generated last sampled frame is acceptably close to the approved end-state contract."
          : mayRetry
            ? "The ending is prompt-fixable; a bounded regeneration was queued with the visual evaluator retry instruction."
            : continuity.decision === "return_stage_2b"
              ? "The ending gap is structurally unreachable and must return to Stage 2B."
              : "End-frame continuity did not pass; blind regeneration is blocked.",
        lines: [
          "Clip URL: " + clipUrl,
          "End boundary: KF" + segment.endKeyframeNo + " was injected as a mandatory terminal-state prompt contract and independently checked; no still frame was pasted",
          "End-frame decision: " + continuity.decision,
          "End-frame similarity: " + continuity.similarityScore.toFixed(3),
          "Continuity retry: " + continuityRetryCount + "/" + maxEndFrameContinuityRetries(),
          "Duration: " + segment.durationSeconds + "s",
          "Quality: " + (report.passed ? "passed" : "needs retry"),
          report.artifactIssues.length ? "Issues: " + report.artifactIssues.join("; ") : "No quality issues reported",
        ],
        data: {
          segmentId: segment.id,
          segmentNo: segment.segmentNo,
          clipTaskId: segment.clipTaskId,
          upstreamClipUrl: result.resultUrl,
          clipUrl,
          endKeyframeNo: segment.endKeyframeNo,
          endFrameEnforced: false,
          endFramePromptEnforced: true,
          endFrameSemanticMode: "strong_prompt_target_and_visual_check",
          continuity,
          mayRetry,
          qualityReport: report,
        },
      });
    } else if (result.status === "failed") {
      await saveGenerationQualityReport(project.id, buildVideoGenerationQualityReport({
        assetId: videoArtifactIdForSegmentNo(segment.segmentNo),
        clipUrl: null,
        prompt: qualityPrompt,
        durationSeconds: segment.durationSeconds,
        upstreamError: result.errorMessage || "Video segment generation failed",
      }));
      await prisma.videoSegment.update({
        where: { id: segment.id },
        data: { status: VideoShotStatus.FAILED, errorMessage: result.errorMessage || "Video segment generation failed" },
      });
      await updateProjectArtifactStatus(project.id, [videoArtifactIdForSegmentNo(segment.segmentNo)], "failed", {
        dirtyReason: result.errorMessage || "Video segment generation failed",
        retryFromStage: "generation",
      });
      await appendProjectStageLog({
        projectId: project.id,
        title: project.title,
        stage: "clips",
        event: "Clip failed segment " + segment.segmentNo,
        level: "error",
        summary: "The segment video task failed. The segment is marked failed and can be retried after checking the upstream error.",
        data: {
          segmentId: segment.id,
          segmentNo: segment.segmentNo,
          clipTaskId: segment.clipTaskId,
          errorMessage: result.errorMessage,
        },
      });
    }
  }

  const latest = await prisma.videoProject.findUnique({ where: { id: project.id }, include: PROJECT_INCLUDE });
  if (!latest) return;
  const failed = latest.segments.find((segment) => segment.status === VideoShotStatus.FAILED);
  if (failed) {
    await prisma.videoProject.update({
      where: { id: project.id },
      data: { status: VideoProjectStatus.FAILED, errorMessage: failed.errorMessage || "Video segment generation failed" },
    });
    await logOnePromptVideo("clip.sync.project.failed", {
      projectId: project.id,
      failedSegmentNo: failed.segmentNo,
      errorMessage: failed.errorMessage,
    }, "error");
    return;
  }
  const runningCount = latest.segments.filter((segment) => segment.status === VideoShotStatus.CLIP_RUNNING && segment.clipTaskId).length;
  if (latest.segments.length > 0 && latest.segments.every((segment) => Boolean(segment.clipUrl) && (segment.status === VideoShotStatus.CLIP_READY || segment.status === VideoShotStatus.CLIP_APPROVED))) {
    await prisma.videoProject.update({
      where: { id: project.id },
      data: { status: VideoProjectStatus.CLIP_REVIEW, errorMessage: null },
    });
    await logOnePromptVideo("clip.sync.project.ready", {
      projectId: project.id,
      status: VideoProjectStatus.CLIP_REVIEW,
      clipCount: latest.segments.length,
    });
    await appendProjectStageLog({
      projectId: project.id,
      title: latest.title,
      stage: "clips",
      event: "All clips ready",
      summary: "All segment clips are ready for review.",
      lines: latest.segments.map((segment) => "Segment " + segment.segmentNo + ": " + (segment.clipUrl ? "ready" : "missing") + ", status=" + segment.status),
      data: {
        status: VideoProjectStatus.CLIP_REVIEW,
        clipCount: latest.segments.length,
      },
    });
    return;
  }
  const pending = latest.segments.some((segment) => segment.status === VideoShotStatus.CLIP_PENDING && !segment.clipUrl);
  if (runningCount < clipTaskConcurrency() && pending) {
    await submitNextClipTask({
      projectId: project.id,
      segments: latest.segments,
      keyframes: latest.keyframes,
      logEventPrefix: "clip.sync",
    });
  }
}

async function submitNextClipTask(params: {
  userId?: string;
  projectId: string;
  segments: VideoProjectWithShots["segments"];
  keyframes: VideoProjectWithShots["keyframes"];
  logEventPrefix: string;
}): Promise<void> {
  const running = params.segments.filter((segment) => segment.status === VideoShotStatus.CLIP_RUNNING && segment.clipTaskId);
  const concurrency = clipTaskConcurrency();
  const availableSlots = Math.max(0, concurrency - running.length);
  if (!availableSlots) {
    await logOnePromptVideo(params.logEventPrefix + ".submit.skip_running", {
      userId: params.userId,
      projectId: params.projectId,
      runningCount: running.length,
      concurrency,
      taskIds: running.map((segment) => ({ segmentNo: segment.segmentNo, clipTaskId: segment.clipTaskId })),
    });
    return;
  }

  const keyframeMap = new Map(params.keyframes.map((keyframe) => [keyframe.keyframeNo, keyframe]));
  const nextSegments = [...params.segments]
    .sort((a, b) => a.segmentNo - b.segmentNo)
    .filter((segment) => {
      const start = keyframeMap.get(segment.startKeyframeNo);
      const end = keyframeMap.get(segment.endKeyframeNo);
      return Boolean(
        start?.imageUrl &&
          end?.imageUrl &&
          !segment.clipUrl &&
          segment.status !== VideoShotStatus.CLIP_RUNNING &&
          segment.status !== VideoShotStatus.CLIP_READY &&
          segment.status !== VideoShotStatus.CLIP_APPROVED,
      );
    })
    .slice(0, availableSlots);

  if (!nextSegments.length) {
    await logOnePromptVideo(params.logEventPrefix + ".submit.no_pending", {
      userId: params.userId,
      projectId: params.projectId,
      runningCount: running.length,
      concurrency,
    });
    return;
  }

  const project = await prisma.videoProject.findUnique({
    where: { id: params.projectId },
    include: PROJECT_INCLUDE,
  });
  if (!project) return;
  assertPlanValidForGeneration(project.planJson, {
    stage: "video_generation",
    targetArtifactId: nextSegments.length === 1 ? `segment:${nextSegments[0].segmentNo}` : "segments:batch",
  });

  await logOnePromptVideo(params.logEventPrefix + ".submit.batch", {
    userId: params.userId,
    projectId: params.projectId,
    runningCount: running.length,
    concurrency,
    submitCount: nextSegments.length,
    segmentNos: nextSegments.map((segment) => segment.segmentNo),
  });

  for (const nextSegment of nextSegments) {
    const startKeyframe = keyframeMap.get(nextSegment.startKeyframeNo);
    const endKeyframe = keyframeMap.get(nextSegment.endKeyframeNo);
    if (!startKeyframe?.imageUrl || !endKeyframe?.imageUrl) continue;
    try {
      const compiled = compileVideoPromptForSegment(project, nextSegment, startKeyframe, endKeyframe);
      await savePromptDebugArtifact(params.projectId, compiled.debugArtifact);
      const renderDescription = readPlanSegmentRenderDescriptionMap(project.planJson).get(nextSegment.segmentNo) ?? {};
      const taskId = await createVideoCandidateBatch({
        project,
        segment: nextSegment,
        prompt: compiled.prompt,
        startFrameUrl: startKeyframe.imageUrl,
        endFrameUrl: endKeyframe.imageUrl,
        metadata: {
          targetContract: renderDescription,
          motionCheckpoints: readPlanMicroShots(readPlanSegmentMap(project.planJson).get(nextSegment.segmentNo)),
          selectedReferenceUrls: selectedReferenceUrlsForPromptTarget(project.planJson, `segment:${nextSegment.segmentNo}`),
          referenceUsageNotes: [],
        },
      });
      await prisma.videoSegment.update({
        where: { id: nextSegment.id },
        data: {
          clipTaskId: taskId,
          clipUrl: null,
          status: VideoShotStatus.CLIP_RUNNING,
          locked: true,
          errorMessage: null,
        },
      });
      await updateProjectArtifactStatus(params.projectId, [videoArtifactIdForSegmentNo(nextSegment.segmentNo)], "generating", { retryFromStage: "generation" });
      await logOnePromptVideo(params.logEventPrefix + ".submit.success", {
        userId: params.userId,
        projectId: params.projectId,
        segmentId: nextSegment.id,
        segmentNo: nextSegment.segmentNo,
        startKeyframeNo: nextSegment.startKeyframeNo,
        endKeyframeNo: nextSegment.endKeyframeNo,
        clipTaskId: taskId,
        durationSeconds: nextSegment.durationSeconds,
      });
      await appendProjectStageLog({
        projectId: params.projectId,
        title: project.title,
        stage: "clips",
        event: "Clip task submitted segment " + nextSegment.segmentNo,
        summary: "Submitted a segment video task with approved boundary frames and references.",
        lines: [
          "Start keyframe: KF" + nextSegment.startKeyframeNo,
          "End keyframe: KF" + nextSegment.endKeyframeNo,
          "Duration: " + nextSegment.durationSeconds + "s",
          "Task ID: " + taskId,
          "Prompt: " + compiled.prompt.slice(0, 520),
        ],
        data: {
          userId: params.userId,
          segmentId: nextSegment.id,
          segmentNo: nextSegment.segmentNo,
          startKeyframeNo: nextSegment.startKeyframeNo,
          endKeyframeNo: nextSegment.endKeyframeNo,
          clipTaskId: taskId,
          durationSeconds: nextSegment.durationSeconds,
          negativePrompt: compiled.negativePrompt,
        },
      });
    } catch (error) {
      const isThrottle = isAliyunRateLimitError(error);
      await prisma.videoSegment.update({
        where: { id: nextSegment.id },
        data: {
          status: VideoShotStatus.CLIP_PENDING,
          errorMessage: isThrottle ? "Aliyun rate limit, will retry later" : error instanceof Error ? error.message : "Video segment submit failed",
        },
      });
      if (!isThrottle) {
        await saveGenerationQualityReport(params.projectId, buildVideoGenerationQualityReport({
          assetId: videoArtifactIdForSegmentNo(nextSegment.segmentNo),
          clipUrl: null,
          prompt: nextSegment.videoPrompt,
          durationSeconds: nextSegment.durationSeconds,
          upstreamError: error instanceof Error ? error.message : "Video segment submit failed",
        }));
        await updateProjectArtifactStatus(params.projectId, [videoArtifactIdForSegmentNo(nextSegment.segmentNo)], "failed", {
          dirtyReason: error instanceof Error ? error.message : "Video segment submit failed",
          retryFromStage: "generation",
        });
      }
      await logOnePromptVideo(params.logEventPrefix + ".submit.error", {
        userId: params.userId,
        projectId: params.projectId,
        segmentId: nextSegment.id,
        segmentNo: nextSegment.segmentNo,
        retryable: isThrottle,
        ...errorForLog(error),
      }, isThrottle ? "warn" : "error");
      await writeStageErrorLog({
        projectId: params.projectId,
        title: project.title,
        stage: "clips",
        event: "Clip submit failed segment " + nextSegment.segmentNo,
        error,
        context: {
          userId: params.userId,
          segmentId: nextSegment.id,
          segmentNo: nextSegment.segmentNo,
          retryable: isThrottle,
        },
      });
      if (!isThrottle) throw error;
      break;
    }
  }
}

function readLooseRecord(source: Record<string, unknown>, keys: string[]): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = source[key];
    if (isRecord(value)) return value;
  }
  return undefined;
}

function readLooseArray(source: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function isAliyunRateLimitError(error: unknown): boolean {
  return error instanceof Error && /Throttling|RateQuota|rate limit|Requests rate limit exceeded/i.test(error.message);
}

async function syncComposeTask(projectId: string, jobId: string): Promise<void> {
  const result = await queryImsComposeJob(jobId);
  await logOnePromptVideo("compose.sync.result", {
    projectId,
    composeTaskId: jobId,
    status: result.status,
    mediaUrl: result.mediaUrl,
    errorMessage: result.errorMessage,
  }, result.status === "failed" ? "error" : "info");
  if (result.status === "succeeded") {
    await prisma.videoProject.update({
      where: { id: projectId },
      data: {
        status: VideoProjectStatus.FINAL_REVIEW,
        finalVideoUrl: result.mediaUrl || null,
        errorMessage: null,
      },
    });
    await updateProjectArtifactStatus(projectId, ["final_video"], "ready", { retryFromStage: "composition" });
  } else if (result.status === "failed") {
    await prisma.videoProject.update({
      where: { id: projectId },
      data: {
        status: VideoProjectStatus.FAILED,
        errorMessage: result.errorMessage || "Final video composition failed",
      },
    });
    await updateProjectArtifactStatus(projectId, ["final_video"], "failed", {
      dirtyReason: result.errorMessage || "Final video composition failed",
      retryFromStage: "composition",
    });
  }
}

async function requireVideoProject(userId: string, projectId: string): Promise<VideoProjectWithShots> {
  const project = await getVideoProject(userId, projectId);
  if (!project) throw new Error("Video project not found");
  return project;
}

function generationPromptForShot(
  _project: Pick<VideoProjectWithShots, "planJson">,
  shot: VideoProjectWithShots["shots"][number],
  kind: "image" | "video",
): string {
  return kind === "image" ? shot.imagePrompt : shot.videoPrompt;
}

function readStylePresetFromPlan(planJson: Prisma.JsonValue | null): string {
  return readPlanShotString(planRecord(planJson), ["stylePreset", "style_preset"]);
}

function generationPromptForKeyframe(
  project: Pick<VideoProjectWithShots, "planJson" | "keyframes">,
  keyframe: VideoProjectWithShots["keyframes"][number],
): string {
  const planKeyframe = readPlanKeyframeMap(project.planJson).get(keyframe.keyframeNo) ??
    readPlanConsistencyReferenceMap(project.planJson).get(keyframe.keyframeNo);
  const stylePreset = readStylePresetFromPlan(project.planJson);
  const assetCategory = readPlanShotString(planKeyframe, ["assetCategory", "asset_category"]);
  const isConsistencyReference = isConsistencyKeyframeNo(keyframe.keyframeNo);
  const consistencyKind = isConsistencyReference
    ? consistencyReferenceKindForPlan(planKeyframe, keyframe.keyframeNo)
    : undefined;
  const brandVisualAsset = isBrandVisualAssetKeyframe(isConsistencyReference, assetCategory, consistencyKind);
  const fallback = sanitizeGameVisualPromptText(stripNonStandardPromptSymbols(keyframe.imagePrompt), stylePreset, { brandVisual: brandVisualAsset });
  const identityLock = characterIdentityLockForPrompt(project.planJson);
  const toneLock = colorToneLockForPrompt(project.planJson);
  const anchorLock = consistencyAnchorLocksForPrompt(
    project.planJson,
    readPlanStringArray(planKeyframe, ["usesConsistencyAnchors", "uses_consistency_anchors"]),
  );
  const base = fallback;
  return [
    base,
    isConsistencyReference && keyframe.keyframeNo === CHARACTER_CONSISTENCY_KEYFRAME_NO
      ? "This is the fixed character consistency reference image for the whole project. Make the person clear, stable, front/three-quarter visible, and easy to reuse as identity guidance."
      : "",
    isConsistencyReference && keyframe.keyframeNo === SCENE_CONSISTENCY_KEYFRAME_NO
      ? "This is the fixed scene consistency reference image for the whole project. Make the environment layout, architecture, materials, product placement, lighting, and color palette clear and stable."
      : "",
    isConsistencyReference && keyframe.keyframeNo !== CHARACTER_CONSISTENCY_KEYFRAME_NO && keyframe.keyframeNo !== SCENE_CONSISTENCY_KEYFRAME_NO
      ? brandVisualAsset
        ? "This is a fixed brand/logo/UI consistency reference. Render ONLY the locked logo or UI elements on a pure white background with exact required text spelling, clean proportions, and no characters, scenery, decorative effects, or extra UI."
        : "This is a fixed hard consistency reference image for a project anchor such as product, logo, prop, vehicle, food, style, or spatial layout. Make the anchor visually stable, reusable, and faithful to its lock details."
      : "",
    identityLock ? "Hard character identity lock, must be preserved exactly in this still image: " + identityLock : "",
    toneLock ? "Hard color tone lock, must be preserved exactly in this still image: " + toneLock : "",
    anchorLock ? "Hard project consistency anchors for this still image:\n" + anchorLock : "",
    "If the main person appears, keep the exact same face, age, hairstyle, hair color, outfit, body type, skin tone, and distinctive accessories as in all other boundary reference frames. Do not generate a different-looking person.",
    isConsistencyReference
      ? "Generate exactly one static consistency reference image only. No storyboard timeline labels, no split-screen, no collage, no before/after comparison."
      : "Generate exactly one still boundary reference image only. Timeline labels such as 0s, 30s, or the final duration are placement metadata, not image duration and not video duration.",
  ].filter(Boolean).join("\n");
}

function generationNegativePromptForKeyframe(
  project: Pick<VideoProjectWithShots, "planJson">,
  keyframe: VideoProjectWithShots["keyframes"][number],
): string {
  const planKeyframe = readPlanKeyframeMap(project.planJson).get(keyframe.keyframeNo) ??
    readPlanConsistencyReferenceMap(project.planJson).get(keyframe.keyframeNo);
  return bilingualNegativePromptForGeneration(planKeyframe, keyframe.negativePrompt);
}

function generationNegativePromptForSegment(
  project: Pick<VideoProjectWithShots, "planJson">,
  segment: VideoProjectWithShots["segments"][number],
): string {
  const planSegment = readPlanSegmentMap(project.planJson).get(segment.segmentNo);
  return bilingualNegativePromptForGeneration(planSegment, segment.negativePrompt);
}

function narrativePromptContextForSegment(planJson: Prisma.JsonValue | null, segmentNo: number): NarrativePromptContext {
  const planSegment = readPlanSegmentMap(planJson).get(segmentNo);
  const storyBeats = readPlanStoryBeats(planJson);
  const linkedBeatIds = uniqueStrings([
    ...readPlanStringArray(planSegment, ["linkedBeatIds", "linked_beat_ids"]),
    ...storyBeats.filter((beat) => readPlanNumberArray(beat, ["targetSegmentNos", "target_segment_nos"]).includes(segmentNo)).map((beat) => readPlanShotString(beat, ["beatId", "beat_id"])),
  ]);
  const linkedBeats = storyBeats.filter((beat) => linkedBeatIds.includes(readPlanShotString(beat, ["beatId", "beat_id"])));
  const primaryBeat = linkedBeats[0];
  const previousSegment = readAdjacentPlanSegment(planJson, segmentNo, -1);
  const keyEvidenceIds = uniqueStrings([
    ...readPlanStringArray(planSegment, ["keyEvidenceIds", "key_evidence_ids"]),
    ...linkedBeats.flatMap((beat) => readPlanStringArray(beat, ["keyEvidenceIds", "key_evidence_ids"])),
  ]);
  const requiredAnchorIds = uniqueStrings([
    ...readPlanStringArray(planSegment, ["usesConsistencyAnchors", "uses_consistency_anchors"]),
    ...linkedBeats.flatMap((beat) => readPlanStringArray(beat, ["requiredAnchorIds", "required_anchor_ids"])),
  ]);
  const storyFunction = readPlanShotString(planSegment, ["storyFunction", "story_function"]) ||
    readPlanShotString(primaryBeat, ["storyFunction", "story_function"]);
  const cause = readPlanShotString(planSegment, ["cause"]) || readPlanShotString(primaryBeat, ["cause"]);
  const effect = readPlanShotString(planSegment, ["effect"]) || readPlanShotString(primaryBeat, ["effect"]);
  const informationUnit = readPlanShotString(planSegment, ["informationUnit", "information_unit"]) ||
    readPlanShotString(primaryBeat, ["informationUnit", "information_unit"]);
  const narrativeStateBefore = cause ||
    readPlanShotString(previousSegment, ["effect", "informationUnit", "information_unit", "purposeZh", "purpose_zh", "purpose"]);
  const narrativeStateAfter = effect || informationUnit ||
    readPlanShotString(planSegment, ["purposeZh", "purpose_zh", "purpose"]);
  return {
    linkedBeatIds,
    linkedBeatId: linkedBeatIds[0],
    storyFunction,
    storyMoment: buildStoryMomentText({
      label: `Segment ${segmentNo}`,
      storyFunction,
      cause,
      effect,
      informationUnit,
      linkedBeatIds,
    }),
    cause,
    effect,
    informationUnit,
    keyEvidenceIds,
    requiredVisibleEvidence: uniqueStrings([...keyEvidenceIds, ...requiredAnchorIds]),
    forbiddenEvidence: forbiddenEvidenceAfterSegment(planJson, segmentNo, linkedBeatIds),
    narrativeStateBefore,
    narrativeStateAfter,
    actionContinuity: readLooseRecord(planSegment ?? {}, ["actionContinuity", "action_continuity"]) ??
      readLooseRecord(primaryBeat ?? {}, ["actionContinuity", "action_continuity"]),
    reactionBeat: readPlanShotString(planSegment, ["reactionBeat", "reaction_beat"]) ||
      readPlanShotString(primaryBeat, ["reactionBeat", "reaction_beat"]),
    powerShift: readPlanShotString(planSegment, ["powerShift", "power_shift"]) ||
      readPlanShotString(primaryBeat, ["powerShift", "power_shift"]),
  };
}

function narrativePromptContextForKeyframe(planJson: Prisma.JsonValue | null, keyframeNo: number): NarrativePromptContext {
  if (isConsistencyKeyframeNo(keyframeNo)) return emptyNarrativePromptContext();
  const segments = [...readPlanSegmentMap(planJson).values()];
  const previous = segments.find((segment) => Number(segment.endKeyframeNo ?? segment.end_keyframe_no) === keyframeNo);
  const next = segments.find((segment) => Number(segment.startKeyframeNo ?? segment.start_keyframe_no) === keyframeNo);
  const previousNo = Number(previous?.segmentNo ?? previous?.segment_no);
  const nextNo = Number(next?.segmentNo ?? next?.segment_no);
  const previousContext = Number.isFinite(previousNo) ? narrativePromptContextForSegment(planJson, previousNo) : undefined;
  const nextContext = Number.isFinite(nextNo) ? narrativePromptContextForSegment(planJson, nextNo) : undefined;
  const primary = previousContext ?? nextContext ?? emptyNarrativePromptContext();
  const linkedBeatIds = uniqueStrings([...(previousContext?.linkedBeatIds ?? []), ...(nextContext?.linkedBeatIds ?? [])]);
  const requiredVisibleEvidence = uniqueStrings([
    ...(previousContext?.requiredVisibleEvidence ?? []),
    ...(nextContext?.requiredVisibleEvidence ?? []),
  ]);
  const narrativeStateBefore = previousContext
    ? previousContext.narrativeStateBefore
    : nextContext?.narrativeStateBefore;
  const narrativeStateAfter = previousContext
    ? previousContext.narrativeStateAfter
    : nextContext?.narrativeStateBefore ?? nextContext?.narrativeStateAfter;
  return {
    ...primary,
    linkedBeatIds,
    linkedBeatId: linkedBeatIds[0],
    storyMoment: buildBoundaryStoryMomentText(keyframeNo, previousNo, nextNo, previousContext, nextContext),
    requiredVisibleEvidence,
    forbiddenEvidence: forbiddenEvidenceAfterKeyframe(planJson, keyframeNo, linkedBeatIds),
    narrativeStateBefore,
    narrativeStateAfter,
  };
}

function narrativeContextLinesForImage(context: NarrativePromptContext): string[] {
  if (!context.storyMoment && !context.linkedBeatIds.length) return [];
  return [
    context.linkedBeatId ? "linkedBeatId: " + context.linkedBeatId : "",
    context.linkedBeatIds.length ? "linkedBeatIds: " + context.linkedBeatIds.join(", ") : "",
    context.storyMoment ? "storyMoment: " + context.storyMoment : "",
    context.requiredVisibleEvidence.length ? "requiredVisibleEvidence: " + context.requiredVisibleEvidence.join(", ") : "",
    context.forbiddenEvidence.length ? "forbiddenEvidence: " + context.forbiddenEvidence.join(", ") : "",
    context.narrativeStateBefore ? "narrativeStateBefore: " + context.narrativeStateBefore : "",
    context.narrativeStateAfter ? "narrativeStateAfter: " + context.narrativeStateAfter : "",
  ].filter(Boolean);
}

function narrativeContextLinesForVideo(context: NarrativePromptContext): string[] {
  return [
    context.linkedBeatIds.length ? "linkedBeatIds: " + context.linkedBeatIds.join(", ") : "",
    context.storyFunction ? "storyFunction: " + context.storyFunction : "",
    context.cause ? "cause: " + context.cause : "",
    context.effect ? "effect: " + context.effect : "",
    context.informationUnit ? "informationUnit: " + context.informationUnit : "",
    context.narrativeStateBefore ? "narrativeStateBefore/start: " + context.narrativeStateBefore : "",
    context.narrativeStateAfter ? "narrativeStateAfter/end: " + context.narrativeStateAfter : "",
    compactJsonLine("actionContinuity", context.actionContinuity),
    context.reactionBeat ? "reactionBeat: " + context.reactionBeat : "",
    context.powerShift ? "powerShift: " + context.powerShift : "",
    context.keyEvidenceIds.length ? "keyEvidenceIds: " + context.keyEvidenceIds.join(", ") : "",
    context.requiredVisibleEvidence.length ? "requiredVisibleEvidence: " + context.requiredVisibleEvidence.join(", ") : "",
    context.forbiddenEvidence.length ? "forbiddenEvidence: " + context.forbiddenEvidence.join(", ") : "",
  ].filter(Boolean);
}

function readPlanStoryBeats(planJson: Prisma.JsonValue | null): Record<string, unknown>[] {
  const plan = planRecord(planJson);
  const value = Array.isArray(plan.storyBeats) ? plan.storyBeats : Array.isArray(plan.story_beats) ? plan.story_beats : [];
  return value.filter(isRecord);
}

function readAdjacentPlanSegment(planJson: Prisma.JsonValue | null, segmentNo: number, offset: -1 | 1): Record<string, unknown> | undefined {
  return readPlanSegmentMap(planJson).get(segmentNo + offset);
}

function readPlanNumberArray(record: Record<string, unknown> | undefined, keys: string[]): number[] {
  if (!record) return [];
  for (const key of keys) {
    const value = record[key];
    if (!Array.isArray(value)) continue;
    return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  }
  return [];
}

function forbiddenEvidenceAfterSegment(planJson: Prisma.JsonValue | null, segmentNo: number, linkedBeatIds: string[]): string[] {
  const storyBeats = readPlanStoryBeats(planJson);
  const linkedOrders = storyBeats
    .filter((beat) => linkedBeatIds.includes(readPlanShotString(beat, ["beatId", "beat_id"])))
    .map((beat) => Number(beat.order))
    .filter((order) => Number.isFinite(order));
  const currentOrder = linkedOrders.length ? Math.max(...linkedOrders) : segmentNo;
  return uniqueStrings(storyBeats
    .filter((beat) => {
      const order = Number(beat.order);
      return Number.isFinite(order) && order > currentOrder;
    })
    .flatMap((beat) => [
      ...readPlanStringArray(beat, ["keyEvidenceIds", "key_evidence_ids"]),
      readPlanShotString(beat, ["storyFunction", "story_function"]) === "cta" ? "future CTA before payoff is complete" : "",
    ]))
    .slice(0, 8);
}

function forbiddenEvidenceAfterKeyframe(planJson: Prisma.JsonValue | null, keyframeNo: number, linkedBeatIds: string[]): string[] {
  return forbiddenEvidenceAfterSegment(planJson, Math.max(1, keyframeNo), linkedBeatIds);
}

function emptyNarrativePromptContext(): NarrativePromptContext {
  return {
    linkedBeatIds: [],
    keyEvidenceIds: [],
    requiredVisibleEvidence: [],
    forbiddenEvidence: [],
  };
}

function buildStoryMomentText(input: {
  label: string;
  storyFunction?: string;
  cause?: string;
  effect?: string;
  informationUnit?: string;
  linkedBeatIds: string[];
}): string {
  return [
    input.label,
    input.linkedBeatIds.length ? `beats=${input.linkedBeatIds.join(",")}` : "",
    input.storyFunction ? `function=${input.storyFunction}` : "",
    input.cause && input.effect ? `${input.cause} -> ${input.effect}` : input.cause || input.effect || "",
    input.informationUnit ? `new information=${input.informationUnit}` : "",
  ].filter(Boolean).join("; ");
}

function buildBoundaryStoryMomentText(
  keyframeNo: number,
  previousSegmentNo: number,
  nextSegmentNo: number,
  previousContext?: NarrativePromptContext,
  nextContext?: NarrativePromptContext,
): string {
  if (Number.isFinite(previousSegmentNo) && Number.isFinite(nextSegmentNo)) {
    return `Boundary keyframe ${keyframeNo}: resolved state after segment ${previousSegmentNo} and setup state before segment ${nextSegmentNo}; ${previousContext?.narrativeStateAfter || ""}${nextContext?.narrativeStateBefore ? " / next: " + nextContext.narrativeStateBefore : ""}`;
  }
  if (Number.isFinite(nextSegmentNo)) {
    return `Opening keyframe ${keyframeNo}: visible story state before segment ${nextSegmentNo}; ${nextContext?.narrativeStateBefore || ""}`;
  }
  if (Number.isFinite(previousSegmentNo)) {
    return `Ending keyframe ${keyframeNo}: visible story result after segment ${previousSegmentNo}; ${previousContext?.narrativeStateAfter || ""}`;
  }
  return `Boundary keyframe ${keyframeNo}: visible story state.`;
}

function compileVideoPromptForSegment(
  project: Pick<VideoProjectWithShots, "planJson">,
  segment: VideoProjectWithShots["segments"][number],
  startKeyframe: VideoProjectWithShots["keyframes"][number],
  endKeyframe: VideoProjectWithShots["keyframes"][number],
): CompiledPrompt {
  const planSegment = readPlanSegmentMap(project.planJson).get(segment.segmentNo);
  const renderDescription = readPlanSegmentRenderDescriptionMap(project.planJson).get(segment.segmentNo);
  const motionContract = readLooseRecord(renderDescription ?? {}, ["motionContract", "motion_contract"]);
  const singleTakeContract = readLooseRecord(renderDescription ?? {}, ["singleTakeContract", "single_take_contract"]);
  const startFrameContract = readLooseRecord(renderDescription ?? {}, ["startFrameContract", "start_frame_contract"]);
  const endFrameContract = readLooseRecord(renderDescription ?? {}, ["endFrameContract", "end_frame_contract"]);
  const checkpointRecords = readLooseArray(renderDescription ?? {}, ["motionCheckpoints", "motion_checkpoints"])
    .filter(hasMeaningfulMotionCheckpoint);
  const microShots = readPlanMicroShots(planSegment);
  const visibleAnchorIds = readPlanStringArray(renderDescription, ["visibleAnchorIds", "visible_anchor_ids"]);
  const segmentAnchorIds = visibleAnchorIds.length
    ? visibleAnchorIds
    : readPlanStringArray(planSegment, ["usesConsistencyAnchors", "uses_consistency_anchors"]);
  const anchorLock = consistencyAnchorLocksForPrompt(project.planJson, segmentAnchorIds);
  const cameraInheritance = resolveCameraInheritanceContext(planRecord(project.planJson), segment.segmentNo);
  const previousQualityReport = latestGenerationQualityReport(project.planJson, videoArtifactIdForSegmentNo(segment.segmentNo));
  const beforePrompt = generationPromptForSegment(project, segment);
  const narrativeContext = narrativePromptContextForSegment(project.planJson, segment.segmentNo);
  const narrativeContextLines = narrativeContextLinesForVideo(narrativeContext);
  const startVisualBlueprint = clipText([
    startKeyframe.imagePrompt,
    startKeyframe.purpose,
    startKeyframe.scene,
    startKeyframe.characterState,
    startKeyframe.productState,
  ].filter(Boolean).join("; "), 760);
  const endVisualBlueprint = clipText([
    endKeyframe.imagePrompt,
    endKeyframe.purpose,
    endKeyframe.scene,
    endKeyframe.characterState,
    endKeyframe.productState,
  ].filter(Boolean).join("; "), 1100);
  const intent = clipText(
    segment.purpose || segment.videoPrompt,
    420,
  );
  const checkpointLines = microShots.length
    ? microShots.slice(0, 4).map((checkpoint, index) => {
        const parts = [
          "t=+" + checkpoint.localTimeSeconds + "s",
          checkpoint.purpose || checkpoint.purposeZh || checkpoint.purposeEn,
          checkpoint.scene || checkpoint.sceneZh || checkpoint.sceneEn,
          checkpoint.action || checkpoint.actionZh || checkpoint.actionEn,
          checkpoint.camera || checkpoint.cameraZh || checkpoint.cameraEn,
        ].filter(Boolean).join("; ");
        return "- " + (index + 1) + ". " + auditedVideoText(parts);
      })
    : checkpointRecords.slice(0, 4).map((checkpoint, index) => "- " + (index + 1) + ". " + auditedVideoText(compactJsonLine("state", checkpoint).replace(/^state: /, "")));
  const finalPrompt = [
    "HAPPYHORSE FIRST-FRAME I2V — MANDATORY TERMINAL-STATE CONTRACT",
    "Duration: " + segment.durationSeconds + "s.",
    "HARD START INPUT: begin exactly from the supplied approved first-frame image. Preserve its identity, composition, objects, environment, wardrobe, product instance, and visible state.",
    startVisualBlueprint ? "Approved first-boundary visual blueprint: " + startVisualBlueprint : "",
    "MANDATORY FINAL-FRAME CONTRACT: by the final sampled frame, the video MUST visibly arrive at the approved ending state described below. This is not optional atmosphere or inspiration; it is the required terminal pose, action result, framing, camera direction, subject/product state, object placement, environment layout, and lighting state.",
    endVisualBlueprint ? "REQUIRED TERMINAL VISUAL STATE: " + endVisualBlueprint : "",
    "Allocate the motion timing backward from the required ending: complete the main action early enough to settle into the terminal state before the clip ends. Hold the required terminal composition stably for the final visible moment. Do not stop midway, overshoot, introduce a different ending, or defer the required state beyond the clip.",
    "Generate one continuous, physically plausible path from the supplied first frame to the mandatory terminal state. Do not fake arrival with a cut, dissolve, scene replacement, freeze-frame insertion, or pasted still image.",
    narrativeContextLines.length ? "Narrative execution contract for this segment:" : "",
    ...narrativeContextLines.map((line) => "- " + auditedVideoText(clipText(line, 900))),
    "Hard narrative boundary: the video model must ONLY animate the visible transition from the approved first boundary state to the approved ending state. Do not invent missing plot events, new wins/rewards/conversions, extra CTA, extra UI, new characters, new products, or future beat evidence beyond this segment.",
    "Brief intent: " + auditedVideoText(intent),
    "Detailed same-take motion direction: " + auditedVideoText(clipText(beforePrompt, 1100)),
    previousQualityReport?.passed === false && previousQualityReport.retryInstruction && (previousQualityReport.retryFromStage === "generation" || previousQualityReport.retryFromStage === "stage3" || previousQualityReport.endFrameDecision === "retry_generation")
      ? "MANDATORY RETRY CORRECTION FROM END-FRAME VISUAL CHECK / ACTUAL VIDEO QUALITY CHECK: " + auditedVideoText(clipText(previousQualityReport.retryInstruction, 700))
      : "",
    "Start state:",
    "- " + auditedVideoText(compactJsonLine("contract", startFrameContract) || (startKeyframe.purpose + ". " + startKeyframe.scene)),
    "Required ending state:",
    "- " + auditedVideoText(compactJsonLine("contract", endFrameContract) || (endKeyframe.purpose + ". " + endKeyframe.scene)),
    "Continuous motion path:",
    "- " + auditedVideoText(compactJsonLine("motion", motionContract) || segment.motion),
    "Single-take execution contract:",
    "- " + auditedVideoText(compactJsonLine("single_take", singleTakeContract) || segment.camera),
    checkpointLines.length ? "Motion checkpoints as reachable states along the same path:" : "",
    ...checkpointLines,
    anchorLock ? "Visible anchor locks:\n" + auditedVideoText(clipText(anchorLock, 900)) : "",
    cameraInheritance.inheritanceDirectives.length ? "Camera Graph inheritance contract:\n" + cameraInheritance.inheritanceDirectives.map((item) => "- " + item).join("\n") : "",
    cameraInheritance.auditDirectives.length ? "Camera Graph audit constraints:\n" + cameraInheritance.auditDirectives.map((item) => "- " + item).join("\n") : "",
    "Video rules:",
    "- One uninterrupted camera take from first frame through the final moment.",
    "- Keep the same location logic, camera axis family, lighting direction, color grade, identity, clothing, product instance, and prop layout.",
    "- Every checkpoint is a reachable body/prop/camera state along one physical path, not a separate scene.",
    "- Use gradual camera movement, subject movement, hand/prop movement, focus change, parallax, and ambient motion only.",
    "- Do not render subtitles, captions, UI overlays, watermarks, timecodes, random letters, or lyrics.",
    "- Generate coherent ambient sound, sound effects, and music matching the continuous action; do not create speech or singing unless the brief explicitly requests it.",
  ].filter(Boolean).join("\n");
  const negativePrompt = compileVideoNegativePrompt(generationNegativePromptForSegment(project, segment));
  return {
    prompt: finalPrompt,
    negativePrompt,
    referenceImageUrls: [startKeyframe.imageUrl, endKeyframe.imageUrl].filter((url): url is string => Boolean(url)),
    debugArtifact: {
      targetArtifactId: "segment:" + segment.segmentNo,
      targetType: "segment",
      compilerVersion: "prompt-compiler-v1",
      inputs: {
        firstFrameUrl: startKeyframe.imageUrl,
        lastFrameUrl: endKeyframe.imageUrl,
        motionContract,
        singleTakeContract,
        motionCheckpointCount: checkpointRecords.length || microShots.length,
        visibleAnchorIds: segmentAnchorIds,
        cameraGraph: cameraInheritance,
        previousEndFrameQualityReport: previousQualityReport,
        narrativeContext,
      },
      selectedReferenceUrls: [startKeyframe.imageUrl, endKeyframe.imageUrl].filter((url): url is string => Boolean(url)),
      referenceUsageNotes: [
        "The first boundary frame is the hard first_frame image input accepted by happyhorse-1.1-i2v.",
        "The approved end boundary is compiled into a mandatory, detailed terminal-state prompt contract and independently checked against the generated last sampled frame.",
      ],
      beforePrompt,
      finalPrompt,
      finalNegativePrompt: negativePrompt,
      rules: [
        "happyhorse_first_frame_hard_input",
        "end_frame_mandatory_prompt_contract",
        "end_frame_visual_continuity_check",
        "no_segment_boundary_mode_terms",
        "checkpoints_as_motion_states",
        "narrative_contract_injected",
        "model_must_not_invent_story",
        "no_embedded_subtitles_or_audio",
        "camera_graph_inheritance_enforced",
      ],
      warnings: [],
      createdAt: new Date().toISOString(),
    },
  };
}

function compileVideoNegativePrompt(baseNegativePrompt: string): string {
  return [
    baseNegativePrompt,
    "embedded subtitles, captions, UI overlays, watermarks, timecodes, random letters, lyrics, speech balloons, duplicated product, duplicated person, identity drift, clothing drift, product morphing, scene replacement, teleporting subject, ghost overlays, melted frames, corrupted text, gibberish glyphs, broken timer display, illegible score display, decorative pseudo-text, non-standard symbols",
  ].filter(Boolean).join(", ");
}

function auditedVideoText(value: string): string {
  // Structural cut problems must be rejected by Single-take Audit. The compiler
  // deliberately preserves audited text instead of hiding defects by replacement.
  return value;
}

function hasMeaningfulMotionCheckpoint(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Object.values(value).some((item) => typeof item === "string" && item.trim().length > 0);
}

function bilingualNegativePromptForGeneration(_source: Record<string, unknown> | undefined, fallback: string): string {
  return fallback;
}

function compileImagePromptForKeyframe(
  project: Pick<VideoProjectWithShots, "planJson" | "keyframes">,
  keyframe: VideoProjectWithShots["keyframes"][number],
  referenceSelection?: ReferenceSelectionOutput,
): CompiledPrompt {
  const planKeyframe = readPlanKeyframeMap(project.planJson).get(keyframe.keyframeNo) ??
    readPlanConsistencyReferenceMap(project.planJson).get(keyframe.keyframeNo);
  const isConsistencyReference = isConsistencyKeyframeNo(keyframe.keyframeNo);
  const stylePreset = readStylePresetFromPlan(project.planJson);
  const targetArtifactId = isConsistencyReference ? "consistency_reference:" + keyframe.keyframeNo : "keyframe:" + keyframe.keyframeNo;
  const visibleAnchorIds = readPlanStringArray(planKeyframe, ["usesConsistencyAnchors", "uses_consistency_anchors"]);
  const assetCategory = readPlanShotString(planKeyframe, ["assetCategory", "asset_category"]);
  const assetView = readPlanShotString(planKeyframe, ["assetView", "asset_view"]);
  const consistencyKind = isConsistencyReference
    ? consistencyReferenceKindForPlan(planKeyframe, keyframe.keyframeNo)
    : undefined;
  const brandVisualAsset = isBrandVisualAssetKeyframe(isConsistencyReference, assetCategory, consistencyKind);
  // The database field is the latest user-edited value. Localized plan fields may
  // still contain the model's original translation, so they must only be fallbacks.
  const rawSourceImagePrompt = sanitizeGameVisualPromptText(stripNonStandardPromptSymbols(keyframe.imagePrompt), stylePreset, { brandVisual: brandVisualAsset });
  const isPersonAsset = isConsistencyReference && (assetCategory === "person" || consistencyKind === "character");
  const anchorLock = consistencyAnchorLocksForPrompt(project.planJson, visibleAnchorIds);
  const visualContract = buildAuthoritativeVisualContract({
    targetContract: planKeyframe ?? { purpose: keyframe.purpose, imagePrompt: keyframe.imagePrompt },
    anchorContractText: anchorLock,
    prompt: rawSourceImagePrompt,
    negativePrompt: generationNegativePromptForKeyframe(project, keyframe),
    mediaStage: "static_image",
    hasApprovedReferences: Boolean(referenceSelection?.selectedReferenceUrls?.length),
  });
  const sourceImagePrompt = repairPromptAgainstVisualContract(rawSourceImagePrompt, visualContract);
  const frameContract = [
    "target: " + targetArtifactId,
    assetCategory ? "asset_category: " + assetCategory : "",
    assetView ? "asset_view: " + assetView : "",
    keyframe.purpose ? "purpose: " + keyframe.purpose : "",
    "scene: " + (readPlanShotString(planKeyframe, ["scene"]) || keyframe.scene),
    "character_state: " + (readPlanShotString(planKeyframe, ["characterState", "character_state"]) || keyframe.characterState),
    "product_state: " + (readPlanShotString(planKeyframe, ["productState", "product_state"]) || keyframe.productState),
    sourceImagePrompt ? "source_image_prompt: " + clipText(sourceImagePrompt, 1200) : "",
    visibleAnchorIds.length ? "visible_anchors: " + visibleAnchorIds.join(", ") : "",
    compactJsonLine("frame_design", planKeyframe?.frameDesign ?? planKeyframe?.frame_design),
  ].filter(Boolean);
  const cameraInheritance = isConsistencyReference
    ? undefined
    : resolveCameraInheritanceContext(planRecord(project.planJson), segmentNoForBoundaryKeyframe(project.planJson, keyframe.keyframeNo));
  const referenceNotes = referenceSelection?.usageNotes ?? [];
  const previousQualityReport = latestGenerationQualityReport(project.planJson, imageArtifactIdForKeyframeNo(keyframe.keyframeNo));
  const beforePrompt = generationPromptForKeyframe(project, keyframe);
  const narrativeContext = isConsistencyReference ? emptyNarrativePromptContext() : narrativePromptContextForKeyframe(project.planJson, keyframe.keyframeNo);
  const narrativeContextLines = narrativeContextLinesForImage(narrativeContext);
  const finalPrompt = [
    "IMAGE PROMPT COMPILED FROM STRUCTURED CONTRACT",
    isConsistencyReference
      ? "Create one reusable still consistency reference image."
      : "Create one still boundary keyframe image.",
    "Frame contract:",
    ...frameContract.map((line) => "- " + line),
    narrativeContextLines.length ? "Narrative boundary contract (must be visible in this still image):" : "",
    ...narrativeContextLines.map((line) => "- " + clipText(line, 900)),
    anchorLock ? "Visible anchor locks:\n" + anchorLock : "",
    "Authoritative visual contract:\n" + JSON.stringify(visualContract),
    cameraInheritance?.inheritanceDirectives.length ? "Camera Graph inheritance contract:\n" + cameraInheritance.inheritanceDirectives.map((item) => "- " + item).join("\n") : "",
    referenceNotes.length ? "Selected reference usage:" : "",
    ...referenceNotes.map((note) => "- " + note + " Inherit only the stated identity, layout, product, or style signal; ignore unrelated pose, crop, artifacts, and accidental text."),
    previousQualityReport?.passed === false && previousQualityReport.retryFromStage !== "manual" && previousQualityReport.retryInstruction
      ? "MANDATORY RETRY CORRECTION FROM ACTUAL IMAGE QUALITY CHECK: " + clipText(previousQualityReport.retryInstruction, 700)
      : "",
    "Image rules:",
    "- The source_image_prompt is authoritative for subject count, pose, framing, and background. Ignore older purpose, scene, character-state, product-state, or reference-image composition when they conflict with it.",
    "- One clean still image only; no storyboard panels, before/after layout, or timeline labels.",
    isConsistencyReference ? "- For asset-library references, render only the requested asset and requested view; do not create a turnaround sheet, split-screen, multiple views, or duplicate characters in one image." : "",
    brandVisualAsset ? "- BRAND/LOGO/UI ASSET ISOLATION: render ONLY the locked logo or UI elements described in source_image_prompt, centered on a pure white background." : "",
    brandVisualAsset ? "- Required brand/UI text must be spelled exactly as specified in source_image_prompt and anchor locks. Use clean sans-serif typography and correct proportions." : "",
    brandVisualAsset ? "- No characters, people, animals, scenery, decorative effects, poster layouts, or extra UI beyond the locked logo elements." : "",
    isPersonAsset ? "- PERSON ASSET ISOLATION: render exactly one character only, centered and clearly visible, on a uniform pure-white or light-neutral studio background. No environment, scenery, floor set, decorative backdrop, border, poster layout, title, logo, product card, UI, confetti, balloons, flags, fireworks, or secondary character." : "",
    isPersonAsset && referenceNotes.length ? "- Reference images are identity/style evidence only. Preserve the character's face, clothing, colors, proportions, and accessories, but never copy their background, typography, logo placement, crop, poster composition, or other people." : "",
    !brandVisualAsset ? "- Do not render subtitles, captions, UI overlays, watermarks, timecodes, random letters, or misspelled text." : "",
    !isPersonAsset && !brandVisualAsset ? "- If a game timer or score HUD appears, use clean sans-serif Arabic numerals only (MM:SS for timers, plain digits for scores). No corrupted glyphs, decorative pseudo-text, or non-standard symbols." : "",
    stylePreset === "guofeng" && !isPersonAsset && !brandVisualAsset ? "- Guofeng game UI: jade/gold thin frames, restrained ornament, consistent typography, and legible Arabic numerals only." : "",
    isPersonAsset
      ? "- No text or logo is allowed anywhere in a person asset image, even if a brand/logo anchor exists elsewhere in the project."
      : brandVisualAsset
        ? "- Brand/logo/UI text is required when explicitly named in source_image_prompt or anchor locks. Forbid misspelled, truncated, or random extra text."
        : "- Brand or product text is allowed only when it is part of a locked product/package/logo anchor.",
    "- Preserve identity, clothing details, product geometry, scene layout, lighting direction, and color tone from the relevant contracts.",
  ].filter(Boolean).join("\n");
  const negativePrompt = repairNegativePromptAgainstVisualContract(compileImageNegativePrompt([
    generationNegativePromptForKeyframe(project, keyframe),
    isPersonAsset
      ? "background scenery, decorative background, poster composition, advertisement layout, title, typography, letters, logo, product card, UI, confetti, balloons, flags, fireworks, border, frame, duplicate person, multiple people, cropped duplicate"
      : "",
  ].filter(Boolean).join(", "), { brandVisual: brandVisualAsset }), visualContract);
  return {
    prompt: finalPrompt,
    negativePrompt,
    referenceImageUrls: referenceSelection?.selectedReferenceUrls ?? [],
    debugArtifact: {
      targetArtifactId,
      targetType: isConsistencyReference ? "consistency_reference" : "keyframe",
      compilerVersion: "prompt-compiler-v1",
      inputs: {
        frameContract,
        visualContract,
        narrativeContext,
        visibleAnchorIds,
        cameraGraph: cameraInheritance,
        referenceCandidateCount: referenceSelection?.candidates.length ?? 0,
      },
      selectedReferenceUrls: referenceSelection?.selectedReferenceUrls ?? [],
      referenceUsageNotes: referenceNotes,
      beforePrompt,
      finalPrompt,
      finalNegativePrompt: negativePrompt,
      rules: [
        "image_no_subtitles",
        "image_no_ui_watermark_random_text",
        "reference_usage_explicit_inherit_ignore",
        "narrative_boundary_contract_injected",
        "camera_graph_inheritance_enforced",
      ],
      warnings: uniqueStrings([...(referenceSelection?.warnings ?? []), ...visualContract.warnings]),
      createdAt: new Date().toISOString(),
    },
  };
}

function compileImagePromptForMicroShot(
  project: Pick<VideoProjectWithShots, "planJson">,
  segment: VideoProjectWithShots["segments"][number],
  microShot: VideoMicroShot,
  referenceSelection?: ReferenceSelectionOutput,
): CompiledPrompt {
  const targetArtifactId = "segment:" + segment.segmentNo + ":micro_shot:" + microShot.microShotNo;
  const visibleAnchorIds = microShot.usesConsistencyAnchors ?? [];
  const sourceImagePrompt = microShot.imagePrompt ?? microShot.imagePromptZh ?? microShot.imagePromptEn ?? "";
  const frameContract = [
    "target: " + targetArtifactId,
    "segment: " + segment.segmentNo,
    "local_time_seconds: " + microShot.localTimeSeconds,
    "purpose: " + (microShot.purpose || microShot.purposeZh || microShot.purposeEn),
    "scene_state: " + (microShot.scene || microShot.sceneZh || microShot.sceneEn),
    "action_state: " + (microShot.action || microShot.actionZh || microShot.actionEn),
    "camera_state: " + (microShot.camera || microShot.cameraZh || microShot.cameraEn || segment.camera),
    sourceImagePrompt ? "source_image_prompt: " + clipText(sourceImagePrompt, 1200) : "",
    visibleAnchorIds.length ? "visible_anchors: " + visibleAnchorIds.join(", ") : "",
  ].filter(Boolean);
  const anchorLock = consistencyAnchorLocksForPrompt(project.planJson, visibleAnchorIds);
  const cameraInheritance = resolveCameraInheritanceContext(planRecord(project.planJson), segment.segmentNo);
  const referenceNotes = referenceSelection?.usageNotes ?? [];
  const previousQualityReport = latestGenerationQualityReport(project.planJson, imageArtifactIdForMicroShot(segment.segmentNo, microShot.microShotNo));
  const beforePrompt = generationPromptForMicroShot(project, segment, microShot);
  const finalPrompt = [
    "IMAGE PROMPT COMPILED FROM STRUCTURED CONTRACT",
    "Create one static internal motion-checkpoint reference image inside the same segment.",
    "Frame contract:",
    ...frameContract.map((line) => "- " + line),
    anchorLock ? "Visible anchor locks:\n" + anchorLock : "",
    cameraInheritance.inheritanceDirectives.length ? "Camera Graph inheritance contract:\n" + cameraInheritance.inheritanceDirectives.map((item) => "- " + item).join("\n") : "",
    referenceNotes.length ? "Selected reference usage:" : "",
    ...referenceNotes.map((note) => "- " + note + " Inherit only the stated identity, layout, product, or style signal; ignore unrelated pose, crop, artifacts, and accidental text."),
    previousQualityReport?.passed === false && previousQualityReport.retryFromStage === "generation" && previousQualityReport.retryInstruction
      ? "MANDATORY RETRY CORRECTION FROM ACTUAL IMAGE QUALITY CHECK: " + clipText(previousQualityReport.retryInstruction, 700)
      : "",
    "Image rules:",
    "- The source_image_prompt and current generic micro-shot fields are authoritative user-facing values. Ignore stale translated or original model fields when they conflict.",
    "- One clean still image only; no storyboard panels, before/after layout, timeline labels, or video-frame sequence.",
    "- Do not render subtitles, captions, UI overlays, watermarks, timecodes, random letters, or misspelled text.",
    "- Preserve same scene, camera-axis family, lighting direction, color tone, identity, clothing, product instance, and prop layout.",
  ].filter(Boolean).join("\n");
  const negativePrompt = compileImageNegativePrompt(generationNegativePromptForSegment(project, segment));
  return {
    prompt: finalPrompt,
    negativePrompt,
    referenceImageUrls: referenceSelection?.selectedReferenceUrls ?? [],
    debugArtifact: {
      targetArtifactId,
      targetType: "micro_shot",
      compilerVersion: "prompt-compiler-v1",
      inputs: {
        frameContract,
        visibleAnchorIds,
        cameraGraph: cameraInheritance,
        referenceCandidateCount: referenceSelection?.candidates.length ?? 0,
      },
      selectedReferenceUrls: referenceSelection?.selectedReferenceUrls ?? [],
      referenceUsageNotes: referenceNotes,
      beforePrompt,
      finalPrompt,
      finalNegativePrompt: negativePrompt,
      rules: [
        "image_no_subtitles",
        "image_no_ui_watermark_random_text",
        "micro_shot_is_static_checkpoint",
        "camera_graph_inheritance_enforced",
      ],
      warnings: referenceSelection?.warnings ?? [],
      createdAt: new Date().toISOString(),
    },
  };
}

function compileImageNegativePrompt(baseNegativePrompt: string, options?: { brandVisual?: boolean }): string {
  if (options?.brandVisual) {
    return [
      baseNegativePrompt,
      "characters, people, animals, scenery, decorative background, poster layout, extra logos, misspelled brand text, gibberish letters, random captions, watermarks, split screen, collage, decorative effects, non-standard symbols",
    ].filter(Boolean).join(", ");
  }
  return [
    baseNegativePrompt,
    "subtitles, captions, UI overlays, watermarks, timecodes, random letters, misspelled text, storyboard panels, split screen, before-after comparison, duplicated product, identity drift, distorted hands, distorted face, malformed logo, corrupted text, gibberish glyphs, broken timer display, illegible score display, decorative pseudo-text, non-standard symbols",
  ].filter(Boolean).join(", ");
}

function compactJsonLine(label: string, value: unknown): string {
  if (!isRecord(value) && !Array.isArray(value)) return "";
  const text = JSON.stringify(value);
  return text && text !== "{}" && text !== "[]" ? `${label}: ${clipText(text, 480)}` : "";
}

function clipText(value: string, maxLength: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function isConsistencyKeyframeNo(keyframeNo: number): boolean {
  return keyframeNo < 0;
}

function isBrandVisualAssetKeyframe(
  isConsistencyReference: boolean,
  assetCategory: string,
  consistencyKind?: VideoConsistencyReference["kind"],
): boolean {
  return isConsistencyReference && (assetCategory === "brand_visual" || consistencyKind === "brand_visual");
}

function assetQualityReviewMessage(report: GenerationQualityReport, brandVisualAsset: boolean): string {
  if (brandVisualAsset) {
    return "Logo/UI quality check flagged spelling or layout issues. Review the image, regenerate if needed, or approve to continue.";
  }
  return "Image quality check suggests retry. You can still review and approve this asset.";
}

function isApprovedConsistencyReference(keyframe: Pick<VideoProjectWithShots["keyframes"][number], "imageUrl" | "locked" | "status">): boolean {
  return Boolean(keyframe.imageUrl) && (keyframe.locked || keyframe.status === VideoShotStatus.IMAGE_APPROVED);
}

function assetGenerationPriority(planJson: Prisma.JsonValue | null, keyframeNo: number): number {
  if (!isConsistencyKeyframeNo(keyframeNo)) return 2;
  if (!onePromptRolloutEnabled("ONE_PROMPT_THREE_VIEW_DERIVATION")) return 0;
  const reference = readPlanConsistencyReferenceMap(planJson).get(keyframeNo);
  return readPlanShotString(reference, ["viewGenerationMode", "view_generation_mode"]) === "derived_from_front" ? 1 : 0;
}

function isAssetViewGenerationReady(
  project: Pick<VideoProjectWithShots, "planJson" | "keyframes">,
  keyframeNo: number,
): boolean {
  if (!isConsistencyKeyframeNo(keyframeNo)) return true;
  if (!onePromptRolloutEnabled("ONE_PROMPT_THREE_VIEW_DERIVATION")) return true;
  const referenceMap = readPlanConsistencyReferenceMap(project.planJson);
  const reference = referenceMap.get(keyframeNo);
  const assetView = readPlanShotString(reference, ["assetView", "asset_view"]);
  const derivedFromFront = readPlanShotString(reference, ["viewGenerationMode", "view_generation_mode"]) === "derived_from_front" || assetView === "side" || assetView === "back";
  if (!derivedFromFront) return true;
  const anchorId = anchorIdForConsistencyReference(reference);
  const frontReferenceEntry = [...referenceMap.entries()].find(([, candidate]) =>
    anchorIdForConsistencyReference(candidate) === anchorId && readPlanShotString(candidate, ["assetView", "asset_view"]) === "front"
  );
  if (!frontReferenceEntry) return false;
  const frontKeyframe = project.keyframes.find((candidate) => candidate.keyframeNo === frontReferenceEntry[0]);
  return Boolean(frontKeyframe && isApprovedConsistencyReference(frontKeyframe));
}

function consistencyReferenceImageUrls(
  project: Pick<VideoProjectWithShots, "keyframes">,
  excludeKeyframeNo?: number,
): string[] {
  return project.keyframes
    .filter((keyframe) => isConsistencyKeyframeNo(keyframe.keyframeNo))
    .filter((keyframe) => keyframe.keyframeNo !== excludeKeyframeNo)
    .filter(isApprovedConsistencyReference)
    .map((keyframe) => keyframe.imageUrl)
    .filter((url): url is string => Boolean(url));
}

async function selectReferenceImagesForKeyframe(
  project: Pick<VideoProjectWithShots, "planJson" | "keyframes" | "referenceImageUrls" | "generationCandidates">,
  keyframe: VideoProjectWithShots["keyframes"][number],
  finalTextPrompt: string,
): Promise<{ urls: string[]; output: ReferenceSelectionOutput }> {
  const targetArtifactId = isConsistencyKeyframeNo(keyframe.keyframeNo)
    ? `consistency_reference:${keyframe.keyframeNo}`
    : `keyframe:${keyframe.keyframeNo}`;
  const planKeyframe = readPlanKeyframeMap(project.planJson).get(keyframe.keyframeNo) ??
    readPlanConsistencyReferenceMap(project.planJson).get(keyframe.keyframeNo);
  const targetOrientation = detectReferenceOrientation(
    keyframe.imagePrompt,
    keyframe.purpose,
    keyframe.characterState,
    readPlanShotString(planKeyframe, ["imagePrompt", "image_prompt", "imagePromptZh", "image_prompt_zh", "imagePromptEn", "image_prompt_en"]),
  );
  const targetAnchorId = anchorIdForConsistencyReference(planKeyframe);
  const requiredAnchorIds = uniqueStrings([
    ...readPlanStringArray(planKeyframe, ["usesConsistencyAnchors", "uses_consistency_anchors"]),
    ...(isConsistencyKeyframeNo(keyframe.keyframeNo) && targetAnchorId ? [targetAnchorId] : []),
  ]);
  const hardAnchorIds = hardReferenceAnchorIds(project.planJson);
  let candidates = collectReferenceCandidates({
    project,
    targetKeyframeNo: keyframe.keyframeNo,
    requiredAnchorIds,
    hardAnchorIds,
    targetOrientation,
    includeBoundaryFrames: false,
  });
  if (isConsistencyKeyframeNo(keyframe.keyframeNo)) {
    const targetView = readPlanShotString(planKeyframe, ["assetView", "asset_view"]);
    const derivedFromFront = onePromptRolloutEnabled("ONE_PROMPT_THREE_VIEW_DERIVATION") && (readPlanShotString(planKeyframe, ["viewGenerationMode", "view_generation_mode"]) === "derived_from_front" || targetView === "side" || targetView === "back");
    candidates = candidates.filter((candidate) =>
      candidate.sourceType === "user_upload" ||
      candidate.sourceType === "style_brand" ||
      (derivedFromFront && candidate.sourceType === "hard_anchor" && candidate.anchorId === targetAnchorId && candidate.assetView === "front")
    );
    if (derivedFromFront && !candidates.some((candidate) => candidate.sourceType === "hard_anchor" && candidate.assetView === "front")) {
      throw new Error(`Person ${targetView || "derived"} view requires an approved front reference before generation`);
    }
    const enriched = await enrichReferenceCandidatesWithVision({ candidates, targetOrientation, targetPrompt: finalTextPrompt, targetArtifactId });
    const result = buildReferenceSelectionOutput({
      targetArtifactId,
      targetType: "consistency_reference",
      candidates: enriched.candidates as ReferenceCandidateDraft[],
      targetOrientation,
      finalTextPrompt,
      missingHardAnchorWarnings: enriched.warnings,
    });
    assertPlanValidForGeneration(project.planJson, { stage: "keyframe_generation", targetArtifactId });
    return result;
  }
  assertFullTransitionReferenceReady(project, segmentNoForBoundaryKeyframe(project.planJson, keyframe.keyframeNo));
  const missingHardAnchorWarnings = requiredAnchorIds.length
    ? missingHardAnchorWarningsForTarget(project, requiredAnchorIds, keyframe.keyframeNo)
    : [];
  if (missingHardAnchorWarnings.length) {
    throw new Error("Reference image selection failed: " + missingHardAnchorWarnings.join("; "));
  }
  const enriched = await enrichReferenceCandidatesWithVision({ candidates, targetOrientation, targetPrompt: finalTextPrompt, targetArtifactId });
  const result = buildReferenceSelectionOutput({
    targetArtifactId,
    targetType: "keyframe",
    candidates: enriched.candidates as ReferenceCandidateDraft[],
    targetOrientation,
    finalTextPrompt,
    missingHardAnchorWarnings: [...missingHardAnchorWarnings, ...enriched.warnings],
  });
  assertTransitionReferenceSelected(project, segmentNoForBoundaryKeyframe(project.planJson, keyframe.keyframeNo), result.output);
  assertReferenceSelectionValid(project, targetArtifactId, requiredAnchorIds, hardAnchorIds, result.output, "keyframe_generation");
  return result;
}

function collectReferenceCandidates(params: {
  project: Pick<VideoProjectWithShots, "planJson" | "keyframes" | "referenceImageUrls" | "generationCandidates">;
  targetKeyframeNo?: number;
  segment?: VideoProjectWithShots["segments"][number];
  microShot?: VideoMicroShot;
  requiredAnchorIds: string[];
  hardAnchorIds: Set<string>;
  targetOrientation: ReferenceOrientation;
  includeBoundaryFrames: boolean;
}): ReferenceCandidateDraft[] {
  const candidates: ReferenceCandidateDraft[] = [];
  const requiredAnchorIds = new Set(params.requiredAnchorIds);
  const referenceMap = readPlanConsistencyReferenceMap(params.project.planJson);
  for (const keyframe of params.project.keyframes) {
    if (!keyframe.imageUrl || keyframe.keyframeNo === params.targetKeyframeNo) continue;
    if (isConsistencyKeyframeNo(keyframe.keyframeNo)) {
      if (!isApprovedConsistencyReference(keyframe)) continue;
      const reference = referenceMap.get(keyframe.keyframeNo);
      const anchorId = anchorIdForConsistencyReference(reference);
      const kind = consistencyReferenceKindForPlan(reference, keyframe.keyframeNo);
      const required = Boolean(anchorId && requiredAnchorIds.has(anchorId));
      const hardRequired = required && params.hardAnchorIds.has(anchorId);
      const sourceType: ReferenceSourceType = kind === "brand_visual" ? "style_brand" : "hard_anchor";
      const quotaType = quotaTypeForReferenceKind(kind);
      const assetView = readPlanShotString(reference, ["assetView", "asset_view"]) as VideoAssetView | "";
      candidates.push({
        artifactId: `consistency_reference:${keyframe.keyframeNo}`,
        url: keyframe.imageUrl,
        sourceType,
        quotaType,
        purpose: referencePurpose(reference, keyframe.purpose || `consistency ${keyframe.keyframeNo}`),
        relevanceScore: hardRequired ? 1 : required ? 0.9 : sourceType === "style_brand" ? 0.65 : 0.8,
        conflictScore: hardRequired ? 0 : 0.1,
        recencyScore: 1,
        viewMatchScore: kind === "character" ? referenceViewMatchScore(params.targetOrientation, assetView || undefined) : 0.5,
        anchorId,
        assetView: assetView || undefined,
        hardRequired,
        usageNote: hardRequired
          ? `Required hard anchor ${anchorId || keyframe.keyframeNo}${assetView ? `, ${assetView} view` : ""}.`
          : `Available ${kind} anchor${assetView ? `, ${assetView} view` : ""}.`,
      });
      continue;
    }
    if (!params.includeBoundaryFrames && params.targetKeyframeNo !== undefined) {
      const distance = Math.abs(keyframe.keyframeNo - params.targetKeyframeNo);
      if (distance > 2) continue;
      candidates.push({
        artifactId: `keyframe:${keyframe.keyframeNo}`,
        url: keyframe.imageUrl,
        sourceType: "recent_keyframe",
        quotaType: "space_layout",
        purpose: keyframe.purpose || `nearby keyframe ${keyframe.keyframeNo}`,
        relevanceScore: distance <= 1 ? 0.65 : 0.45,
        conflictScore: 0.2,
        recencyScore: referenceRecencyScore(distance, 4),
        viewMatchScore: 0.5,
        usageNote: `Nearby boundary frame for spatial continuity, distance=${distance}.`,
      });
    }
  }
  for (const [index, url] of jsonStringArray(params.project.referenceImageUrls).entries()) {
    candidates.push({
      artifactId: `user_upload:${index + 1}`,
      url,
      sourceType: "user_upload",
      quotaType: "style_brand",
      purpose: `User uploaded reference ${index + 1}`,
      relevanceScore: params.targetKeyframeNo !== undefined && isConsistencyKeyframeNo(params.targetKeyframeNo) ? 0.75 : 0.45,
      conflictScore: 0.25,
      recencyScore: 0.25,
      viewMatchScore: 0.25,
      usageNote: "User supplied visual reference.",
    });
  }
  if (params.includeBoundaryFrames && params.segment) {
    const boundaryNos = [params.segment.startKeyframeNo, params.segment.endKeyframeNo];
    for (const keyframeNo of boundaryNos) {
      const keyframe = params.project.keyframes.find((item) => item.keyframeNo === keyframeNo);
      if (!keyframe?.imageUrl) continue;
      const distance = params.microShot
        ? Math.min(
            Math.abs(params.microShot.absoluteTimeSeconds - keyframe.timeSeconds),
            Math.abs(params.microShot.localTimeSeconds - (keyframeNo === params.segment.startKeyframeNo ? 0 : params.segment.durationSeconds)),
          )
        : 0;
      candidates.push({
        artifactId: `keyframe:${keyframe.keyframeNo}`,
        url: keyframe.imageUrl,
        sourceType: "parent_camera",
        quotaType: "space_layout",
        purpose: keyframe.purpose || `segment boundary ${keyframe.keyframeNo}`,
        relevanceScore: keyframeNo === params.segment.startKeyframeNo ? 0.82 : 0.7,
        conflictScore: 0.05,
        recencyScore: referenceRecencyScore(distance, Math.max(1, params.segment.durationSeconds)),
        viewMatchScore: 0.5,
        usageNote: `Parent segment boundary frame ${keyframe.keyframeNo}.`,
      });
    }
  }
  const targetSegmentNo = params.segment?.segmentNo ?? (params.targetKeyframeNo && params.targetKeyframeNo > 0
    ? segmentNoForBoundaryKeyframe(params.project.planJson, params.targetKeyframeNo)
    : undefined);
  if (targetSegmentNo) {
    const cameraContext = resolveCameraInheritanceContext(planRecord(params.project.planJson), targetSegmentNo);
    const parentSegmentNo = cameraContext.node?.parentSegmentNo ?? cameraContext.parent?.segmentNos.at(-1);
    const parentSegment = parentSegmentNo ? readPlanSegmentMap(params.project.planJson).get(parentSegmentNo) : undefined;
    const parentBoundaryNo = Number(parentSegment?.endKeyframeNo ?? parentSegment?.end_keyframe_no ?? parentSegmentNo);
    const parentKeyframe = params.project.keyframes.find((item) => item.keyframeNo === parentBoundaryNo && Boolean(item.imageUrl));
    if (parentKeyframe?.imageUrl && cameraContext.relation !== "new_camera_setup" && cameraContext.relation !== "same_subject_group") {
      const strongLayoutInheritance = cameraContext.relation === "same_camera_setup" || cameraContext.relation === "derived_reframe";
      candidates.push({
        artifactId: `keyframe:${parentKeyframe.keyframeNo}`,
        url: parentKeyframe.imageUrl,
        sourceType: "parent_camera",
        quotaType: "space_layout",
        purpose: `Parent camera ${cameraContext.parent?.cameraId ?? "unknown"} inheritance evidence`,
        relevanceScore: strongLayoutInheritance ? 0.9 : 0.72,
        conflictScore: cameraContext.relation === "alternate_view" ? 0.18 : 0.08,
        recencyScore: 0.8,
        viewMatchScore: cameraContext.relation === "alternate_view" ? 0.45 : 0.72,
        usageNote: `${cameraContext.selectorDirective ?? "Use parent camera continuity evidence."} Never use this frame to replace hard person/product identity anchors.`,
      });
    }
  }
  // Boundary-keyframe selection has no `segment` object. Use the segment
  // resolved from the keyframe number so unrelated transition references do
  // not compete with the required layout reference.
  for (const candidate of collectTransitionReferenceCandidates(params.project, targetSegmentNo)) {
    candidates.push(candidate);
  }
  return dedupeReferenceCandidates(candidates);
}

function buildReferenceSelectionOutput(params: {
  targetArtifactId: string;
  targetType: ReferenceSelectionOutput["targetType"];
  candidates: ReferenceCandidateDraft[];
  targetOrientation: ReferenceOrientation;
  finalTextPrompt: string;
  missingHardAnchorWarnings: string[];
}): { urls: string[]; output: ReferenceSelectionOutput } {
  if (!onePromptRolloutEnabled("ONE_PROMPT_REFERENCE_SELECTOR_V2")) {
    const legacy = legacyReferenceSelection(params.candidates);
    const selectedCandidates = legacy.selected;
    const urls = selectedCandidates.map((candidate) => candidate.url).filter(Boolean);
    return {
      urls,
      output: {
        targetArtifactId: params.targetArtifactId,
        targetType: params.targetType,
        selectedArtifactIds: selectedCandidates.map((candidate) => candidate.artifactId),
        selectedReferenceUrls: urls,
        candidates: legacy.candidates,
        usageNotes: selectedCandidates.map((candidate) => candidate.usageNote).filter(Boolean),
        finalTextPrompt: params.finalTextPrompt,
        targetOrientation: params.targetOrientation,
        selectionPolicyVersion: "legacy-v1-fallback",
        warnings: [...params.missingHardAnchorWarnings, "Reference Selector V2 disabled; legacy approved-reference ordering is active."],
      },
    };
  }
  const decision = selectReferenceCandidates({
    candidates: params.candidates as SelectableReferenceCandidate[],
    targetOrientation: params.targetOrientation,
  });
  const outputCandidates = decision.candidates;
  const selectedCandidates = decision.selected;
  const requiredAnchors = new Set(params.candidates.filter((candidate) => candidate.hardRequired && candidate.anchorId).map((candidate) => candidate.anchorId as string));
  const selectedRequiredAnchors = new Set(selectedCandidates.filter((candidate) => candidate.hardRequired && candidate.anchorId).map((candidate) => candidate.anchorId as string));
  const missingSelectedHardAnchors = [...requiredAnchors].filter((anchorId) => !selectedRequiredAnchors.has(anchorId));
  if (missingSelectedHardAnchors.length) {
    throw new Error(`Reference image selection failed: required hard anchors rejected or unavailable: ${missingSelectedHardAnchors.join(", ")}`);
  }
  const urls = selectedCandidates.map((candidate) => candidate.url).filter((url): url is string => Boolean(url));
  return {
    urls,
    output: {
      targetArtifactId: params.targetArtifactId,
      targetType: params.targetType,
      selectedArtifactIds: selectedCandidates.map((candidate) => candidate.artifactId),
      selectedReferenceUrls: urls,
      candidates: outputCandidates,
      usageNotes: selectedCandidates.map((candidate) => candidate.usageNote).filter((note): note is string => Boolean(note)),
      finalTextPrompt: params.finalTextPrompt,
      targetOrientation: decision.targetOrientation,
      selectedView: decision.selectedView,
      orientationFallbackReason: decision.orientationFallbackReason,
      selectionPolicyVersion: REFERENCE_SELECTION_POLICY_VERSION,
      warnings: [...params.missingHardAnchorWarnings, ...decision.warnings],
    },
  };
}

function assertReferenceSelectionValid(
  project: Pick<VideoProjectWithShots, "planJson" | "keyframes">,
  targetArtifactId: string,
  requiredAnchorIds: string[],
  hardAnchorIds: Set<string>,
  output: ReferenceSelectionOutput,
  stage: "keyframe_generation" | "micro_shot_generation",
): void {
  const hardRequired = requiredAnchorIds.filter((anchorId) => hardAnchorIds.has(anchorId));
  const referenceMap = readPlanConsistencyReferenceMap(project.planJson);
  const approvedHardAnchorIds = project.keyframes.flatMap((keyframe) => {
    if (!isApprovedConsistencyReference(keyframe)) return [];
    const anchorId = anchorIdForConsistencyReference(referenceMap.get(keyframe.keyframeNo));
    return anchorId ? [anchorId] : [];
  });
  const selectedHardAnchorIds = output.candidates.flatMap((candidate) => candidate.selected && candidate.anchorId ? [candidate.anchorId] : []);
  assertPlanValidForGeneration(project.planJson, {
    stage,
    targetArtifactId,
    requiredHardAnchorIds: hardRequired,
    approvedHardAnchorIds,
    selectedHardAnchorIds,
  });
}

function dedupeReferenceCandidates(candidates: ReferenceCandidateDraft[]): ReferenceCandidateDraft[] {
  const selectedByKey = new Map<string, ReferenceCandidateDraft>();
  for (const candidate of candidates) {
    const key = candidate.url || candidate.artifactId;
    if (!key) continue;
    const current = selectedByKey.get(key);
    if (!current || referenceCandidateDedupePriority(candidate) > referenceCandidateDedupePriority(current)) {
      selectedByKey.set(key, candidate);
    }
  }
  return [...selectedByKey.values()];
}

function assertCompiledVisualContractReady(compiled: CompiledPrompt): void {
  const value = compiled.debugArtifact.inputs.visualContract;
  if (!isRecord(value)) return;
  const conflicts = stringArrayValue(value.verifiedConflicts);
  if (conflicts.length) {
    throw new Error(`生成前检测到权威视觉合同冲突，已停止抽图：${conflicts.join("；")}`);
  }
}

function referenceCandidateDedupePriority(candidate: ReferenceCandidateDraft): number {
  // Short transition references deliberately reuse the approved parent-camera
  // image. Keep the mandatory transition artifact alias when URLs collide so
  // reference selection can prove that the scene-layout contract was selected.
  if (candidate.sourceType === "transition_reference" && candidate.hardRequired) return 3;
  if (candidate.hardRequired) return 2;
  if (candidate.sourceType === "transition_reference") return 1;
  return 0;
}

function quotaTypeForReferenceKind(kind: VideoConsistencyReference["kind"]): ReferenceQuotaType {
  if (kind === "character") return "character";
  if (kind === "scene" || kind === "space_layout") return "space_layout";
  if (kind === "brand_visual" || kind === "custom") return "style_brand";
  return "product";
}

function anchorIdForConsistencyReference(reference: Record<string, unknown> | undefined): string {
  const explicit = readPlanShotString(reference, ["anchorId", "anchor_id"]);
  if (explicit) return explicit;
  const frameId = readPlanShotString(reference, ["frameId", "frame_id"]);
  return frameId.startsWith("consistency_") ? frameId.slice("consistency_".length) : "";
}

function referencePurpose(reference: Record<string, unknown> | undefined, fallback: string): string {
  return readPlanShotString(reference, ["purposeZh", "purpose_zh", "purposeEn", "purpose_en", "purpose"]) || fallback;
}

function missingHardAnchorWarningsForTarget(
  project: Pick<VideoProjectWithShots, "planJson" | "keyframes">,
  requiredAnchorIds: string[],
  excludeKeyframeNo?: number,
): string[] {
  const references = readPlanConsistencyReferenceMap(project.planJson);
  const referenceAnchorIds = new Set<string>();
  for (const reference of references.values()) {
    const anchorId = anchorIdForConsistencyReference(reference);
    if (anchorId) referenceAnchorIds.add(anchorId);
  }
  const readyAnchorIds = new Set<string>();
  for (const keyframe of project.keyframes) {
    if (keyframe.keyframeNo === excludeKeyframeNo || !isConsistencyKeyframeNo(keyframe.keyframeNo)) continue;
    if (!isApprovedConsistencyReference(keyframe)) continue;
    const anchorId = anchorIdForConsistencyReference(references.get(keyframe.keyframeNo));
    if (anchorId) readyAnchorIds.add(anchorId);
  }
  return requiredAnchorIds
    .filter((anchorId) => referenceAnchorIds.has(anchorId))
    .filter((anchorId) => !readyAnchorIds.has(anchorId))
    .map((anchorId) => "hard anchor " + anchorId + " missing locked consistency reference image");
}

function collectTransitionReferenceCandidates(
  project: Pick<VideoProjectWithShots, "planJson" | "keyframes" | "generationCandidates">,
  segmentNo?: number,
): ReferenceCandidateDraft[] {
  if (!onePromptRolloutEnabled("ONE_PROMPT_TRANSITION_REFERENCE")) return [];
  return transitionReferenceArtifactsFromPlan(project.planJson).flatMap((item) => {
    const relatedSegment = item.toSegmentNo;
    if (segmentNo && relatedSegment !== segmentNo) return [];
    let url = item.locked && item.status === "approved" ? item.selectedFrameUrl : undefined;
    let sourceLabel = "approved transition reference frame";
    if (item.mode === "short") {
      const parentKeyframe = project.keyframes.find((keyframe) =>
        keyframe.keyframeNo === item.parentKeyframeNo && isUsableTransitionParentKeyframe(project, keyframe)
      );
      url = parentKeyframe?.imageUrl ?? url;
      sourceLabel = parentKeyframe?.locked || parentKeyframe?.status === VideoShotStatus.IMAGE_APPROVED
        ? `approved parent-camera keyframe KF${item.parentKeyframeNo ?? "?"}`
        : `quality-passed parent-camera keyframe KF${item.parentKeyframeNo ?? "?"}`;
    }
    if (!url) return [];
    const distance = Number.isFinite(relatedSegment) && segmentNo ? Math.abs(relatedSegment - segmentNo) : 1;
    return [{
      artifactId: item.id,
      url,
      sourceType: "transition_reference" as const,
      quotaType: "space_layout" as const,
      hardRequired: true,
      purpose: `${sourceLabel}: ${item.reasonZh}`,
      relevanceScore: distance <= 1 ? 0.92 : 0.55,
      conflictScore: 0.06,
      recencyScore: referenceRecencyScore(distance, 4),
      viewMatchScore: item.relation === "alternate_view" ? 0.82 : 0.72,
      usageNote: `SCENE-LAYOUT ONLY from ${sourceLabel}: inherit only ${item.inheritanceScope.join(", ")}. Never inherit person/product identity, logos, typography, accidental text, or conflicting objects; hard anchors remain authoritative.`,
    }];
  });
}

async function rollbackPlanToBoundaryReview(
  projectId: string,
  tx: Prisma.TransactionClient,
  keyframes: VideoProjectWithShots["keyframes"],
): Promise<void> {
  const stored = await tx.videoProject.findUnique({ where: { id: projectId } });
  if (!stored?.planJson) return;
  const plan = cloneJsonRecord(stored.planJson);
  clearPlanMicroShotImages(plan, "segments");
  clearPlanMicroShotImages(plan, "shots");
  const assetArtifactIds = keyframes
    .filter((keyframe) => keyframe.keyframeNo < 0 && Boolean(keyframe.imageUrl))
    .map((keyframe) => imageArtifactIdForKeyframeNo(keyframe.keyframeNo));
  const boundaryArtifactIds = keyframes
    .filter((keyframe) => keyframe.keyframeNo > 0 && Boolean(keyframe.imageUrl))
    .map((keyframe) => imageArtifactIdForKeyframeNo(keyframe.keyframeNo));
  setPlanArtifactStatus(plan, assetArtifactIds, "approved", { retryFromStage: "generation" });
  setPlanArtifactStatus(plan, boundaryArtifactIds, "ready", { retryFromStage: "generation" });
  await tx.videoProject.update({
    where: { id: projectId },
    data: { planJson: plan as Prisma.InputJsonValue },
  });
}

function isUsableTransitionParentKeyframe(
  project: Pick<VideoProjectWithShots, "planJson" | "generationCandidates">,
  keyframe: Pick<VideoProjectWithShots["keyframes"][number], "keyframeNo" | "imageUrl" | "locked" | "status"> | undefined,
): boolean {
  if (!keyframe?.imageUrl) return false;
  if (keyframe.locked || keyframe.status === VideoShotStatus.IMAGE_APPROVED) return true;
  const artifactId = imageArtifactIdForKeyframeNo(keyframe.keyframeNo);
  const selectedCandidate = project.generationCandidates.find((candidate) =>
    candidate.artifactId === artifactId
    && candidate.selected
    && candidate.mediaUrl === keyframe.imageUrl
  );
  if (selectedCandidate?.passed === true || selectedCandidate?.userAccepted === true) return true;
  const report = generationQualityReportForActiveMedia(project.planJson, artifactId, keyframe.imageUrl);
  // A short transition is layout evidence only. Requiring another manual lock
  // after the currently selected parent passed visual QA deadlocks sequential
  // boundary generation after every frame.
  return (report?.passed === true || report?.userAccepted === true) && report.mediaUrl === keyframe.imageUrl;
}

function assertFullTransitionReferenceReady(project: Pick<VideoProjectWithShots, "planJson">, segmentNo: number): void {
  if (!onePromptRolloutEnabled("ONE_PROMPT_TRANSITION_REFERENCE")) return;
  const required = transitionReferenceArtifactsFromPlan(project.planJson).filter((item) => item.toSegmentNo === segmentNo && item.mode === "full");
  const missing = required.filter((item) => item.status !== "approved" || !item.locked || !item.selectedFrameUrl);
  if (missing.length) throw new Error(`Transition reference is required before generating segment ${segmentNo}: ${missing.map((item) => `${item.id} status=${item.status}`).join(", ")}. Generate, review, and lock it first.`);
}

function assertTransitionReferenceSelected(project: Pick<VideoProjectWithShots, "planJson">, segmentNo: number, output: ReferenceSelectionOutput): void {
  if (!onePromptRolloutEnabled("ONE_PROMPT_TRANSITION_REFERENCE")) return;
  const requiredIds = transitionReferenceArtifactsFromPlan(project.planJson).filter((item) => item.toSegmentNo === segmentNo).map((item) => item.id);
  const missing = requiredIds.filter((id) => !output.selectedArtifactIds.includes(id));
  if (missing.length) throw new Error(`Required transition scene-layout reference was not selected: ${missing.join(", ")}`);
}

function isTransitionReferenceReadyForBoundary(project: Pick<VideoProjectWithShots, "planJson" | "keyframes" | "generationCandidates">, keyframeNo: number): boolean {
  if (!onePromptRolloutEnabled("ONE_PROMPT_TRANSITION_REFERENCE")) return true;
  if (keyframeNo < 0) return true;
  const segmentNo = segmentNoForBoundaryKeyframe(project.planJson, keyframeNo);
  const artifacts = transitionReferenceArtifactsFromPlan(project.planJson).filter((item) => item.toSegmentNo === segmentNo);
  return artifacts.every((artifact) => {
    if (artifact.mode === "full") return artifact.status === "approved" && artifact.locked && Boolean(artifact.selectedFrameUrl);
    const parent = project.keyframes.find((item) => item.keyframeNo === artifact.parentKeyframeNo);
    return isUsableTransitionParentKeyframe(project, parent);
  });
}

function characterIdentityLockForPrompt(planJson: Prisma.JsonValue | null): string {
  const plan = isRecord(planJson) ? planJson : {};
  const styleBible = isRecord(plan.styleBible) ? plan.styleBible : isRecord(plan.style_bible) ? plan.style_bible : undefined;
  const styleLock = readPlanShotString(styleBible, ["characterLock", "character_lock"]);
  const characters = Array.isArray(plan.characters) ? plan.characters : [];
  const locks = characters.flatMap((character) => {
    if (!isRecord(character)) return [];
    const parts = [
      readPlanShotString(character, ["name"]),
      readPlanShotString(character, ["appearance"]),
      readPlanShotString(character, ["clothing"]),
      readPlanShotString(character, ["consistencyPrompt", "consistency_prompt"]),
    ].filter(Boolean);
    return parts.length ? [parts.join("; ")] : [];
  });
  return [styleLock, ...locks].filter(Boolean).join("\n");
}

function colorToneLockForPrompt(planJson: Prisma.JsonValue | null): string {
  const plan = isRecord(planJson) ? planJson : {};
  const styleBible = isRecord(plan.styleBible) ? plan.styleBible : isRecord(plan.style_bible) ? plan.style_bible : undefined;
  return [
    readPlanShotString(styleBible, ["colorPalette", "color_palette"]),
    readPlanShotString(styleBible, ["colorToneLock", "color_tone_lock"]),
    readPlanShotString(styleBible, ["lightingToneLock", "lighting_tone_lock"]),
  ].filter(Boolean).join("\n");
}

function consistencyAnchorLocksForPrompt(planJson: Prisma.JsonValue | null, anchorIds?: string[]): string {
  const plan = isRecord(planJson) ? planJson : {};
  const manifest = isRecord(plan.consistencyManifest)
    ? plan.consistencyManifest
    : isRecord(plan.consistency_manifest)
      ? plan.consistency_manifest
      : isRecord(plan.planningManifest)
        ? plan.planningManifest.consistencyManifest
        : isRecord(plan.planning_manifest)
          ? plan.planning_manifest.consistency_manifest
          : undefined;
  const anchors = isRecord(manifest) && Array.isArray(manifest.anchors) ? manifest.anchors : [];
  const wanted = anchorIds?.length ? new Set(anchorIds) : undefined;
  return anchors.flatMap((anchor) => {
    if (!isRecord(anchor)) return [];
    const id = readPlanShotString(anchor, ["id"]);
    if (wanted && (!id || !wanted.has(id))) return [];
    const visualLock = isRecord(anchor.visualLock)
      ? anchor.visualLock
      : isRecord(anchor.visual_lock)
        ? anchor.visual_lock
        : undefined;
    const forbiddenDrift = readPlanStringArray(visualLock, ["forbiddenDrift", "forbidden_drift"]);
    const parts = [
      id ? `anchor_id=${id}` : "",
      readPlanShotString(anchor, ["type"]) ? `type=${readPlanShotString(anchor, ["type"])}` : "",
      readPlanShotString(anchor, ["displayNameEn", "display_name_en", "displayNameZh", "display_name_zh", "display_name"]),
      readPlanShotString(anchor, ["descriptionEn", "description_en", "descriptionZh", "description_zh"]),
      readPlanShotString(visualLock, ["shape"]) ? `shape: ${readPlanShotString(visualLock, ["shape"])}` : "",
      readPlanShotString(visualLock, ["material"]) ? `material: ${readPlanShotString(visualLock, ["material"])}` : "",
      readPlanShotString(visualLock, ["color"]) ? `color: ${readPlanShotString(visualLock, ["color"])}` : "",
      readPlanShotString(visualLock, ["markings"]) ? `markings: ${readPlanShotString(visualLock, ["markings"])}` : "",
      readPlanShotString(visualLock, ["scale"]) ? `scale: ${readPlanShotString(visualLock, ["scale"])}` : "",
      readPlanShotString(visualLock, ["state"]) ? `state: ${readPlanShotString(visualLock, ["state"])}` : "",
      forbiddenDrift.length ? `forbidden drift: ${forbiddenDrift.join(", ")}` : "",
    ].filter(Boolean);
    return parts.length ? [`- ${parts.join("; ")}`] : [];
  }).join("\n");
}

function audioPromptInstruction(audioPlan: NonNullable<ReturnType<typeof readPlanAudioPlan>>): string {
  const lines = [
    ...(audioPlan.linesEn ?? []),
    ...(audioPlan.linesZh ?? []),
    ...(audioPlan.lines ?? []),
  ].filter(Boolean);
  if (audioPlan.mode === "voiceover" || audioPlan.mode === "dialogue" || audioPlan.mode === "mixed" || audioPlan.needsVoiceover || audioPlan.needsDialogue) {
    return [
      "Audio/speech direction:",
      `- Mode: ${audioPlan.mode}.`,
      audioPlan.language ? `- Language: ${audioPlan.language}.` : "",
      audioPlan.speaker ? `- Speaker: ${audioPlan.speaker}.` : "",
      audioPlan.voiceStyle ? `- Voice style: ${audioPlan.voiceStyle}.` : "",
      lines.length ? `- Spoken lines: ${lines.join(" / ")}` : "",
      audioPlan.rationale ? `- Reason: ${audioPlan.rationale}` : "",
      "- If the video model supports audio, include this voice/dialogue naturally. Do not add unrelated speech.",
    ].filter(Boolean).join("\n");
  }
  return [
    "Audio/speech direction:",
    `- Mode: ${audioPlan.mode}.`,
    "- No voiceover or character dialogue is required for this segment unless the model can only produce ambient audio.",
    audioPlan.rationale ? `- Reason: ${audioPlan.rationale}` : "",
  ].filter(Boolean).join("\n");
}

function generationPromptForSegment(
  project: Pick<VideoProjectWithShots, "planJson">,
  segment: VideoProjectWithShots["segments"][number],
): string {
  const planSegment = readPlanSegmentMap(project.planJson).get(segment.segmentNo);
  const boundaryMode = readPlanBoundaryMode(planSegment);
  const outputMode = readPlanShotString(planSegment, ["outputMode", "output_mode"]);
  const constraints = readPlanStringArray(planSegment, ["constraints"]);
  const timedPrompts = readPlanTimedPrompts(planSegment);
  const microShots = readPlanMicroShots(planSegment);
  const audioPlan = readPlanAudioPlan(planSegment);
  const identityLock = characterIdentityLockForPrompt(project.planJson);
  const toneLock = colorToneLockForPrompt(project.planJson);
  const anchorLock = consistencyAnchorLocksForPrompt(
    project.planJson,
    readPlanStringArray(planSegment, ["usesConsistencyAnchors", "uses_consistency_anchors"]),
  );
  const negativePrompt = generationNegativePromptForSegment(project, segment);
  const base = segment.videoPrompt;
  const singleTakeDirective = [
    `CRITICAL SINGLE-TAKE DIRECTIVE FOR THIS ${segment.durationSeconds}s CLIP:`,
    "Generate the whole segment as one continuous unbroken camera take from the first boundary frame to the last boundary frame.",
    "Do not use any internal cuts, jump cuts, crossfades, dissolves, fades, wipes, montage edits, shot-reverse-shot edits, ghosted overlays, scene replacement, or hidden transition tricks inside this clip.",
    "The environment, location, camera axis, composition logic, lighting direction, color grade, subject identity, outfit, product identity, and prop layout must remain continuous across every frame.",
    "Only allow physically plausible camera motion, subject motion, hand/prop motion, parallax, focus pull, and ambient movement inside the same scene.",
    "Treat all micro-shots and timed prompts as same-shot motion checkpoints, not separate shots, not scene changes, and not edit points.",
    "If the start and end boundary frames differ, connect them through natural movement inside the same take; never solve the difference with a dissolve or hard visual transition.",
  ].join("\n");
  const additions = [
    singleTakeDirective,
    boundaryMode ? `Boundary mode for timeline editing around this segment: ${boundaryMode}. This is not permission to create an internal cut or dissolve inside the generated clip.` : "",
    outputMode ? `Output constraint mode: ${outputMode}.` : "",
    identityLock ? `Hard character identity lock for the entire video segment:\n${identityLock}\nPreserve the same person across all frames. Do not morph into a different face, age, hairstyle, outfit, or body type.` : "",
    toneLock ? `Hard color tone continuity lock for the entire video segment:\n${toneLock}\nPreserve the same color grading, white balance, saturation, contrast, exposure, skin tone treatment, and product color treatment from the start boundary frame to the end boundary frame. Do not drift into a different warm/cool look unless explicitly requested.` : "",
    anchorLock ? `Hard project consistency anchors for this segment:\n${anchorLock}` : "",
    negativePrompt ? `Avoid / negative prompt:\n${negativePrompt}` : "",
    audioPlan ? audioPromptInstruction(audioPlan) : "",
    constraints.length ? `Segment constraints:\n${constraints.map((item) => `- ${item}`).join("\n")}` : "",
    microShots.length
      ? `Same-take internal motion checkpoints for this ${segment.durationSeconds}s segment. These checkpoints must happen inside the same continuous camera take:\n${microShots.map((item) => {
          const parts = [
            `+${item.localTimeSeconds}s`,
            item.purpose || item.purposeZh || item.purposeEn ? `purpose: ${item.purpose || item.purposeZh || item.purposeEn}` : "",
            item.scene ? `scene: ${item.scene}` : "",
            item.action ? `action: ${item.action}` : "",
            item.camera ? `camera: ${item.camera}` : "",
            item.imagePrompt ?? item.imagePromptZh ?? item.imagePromptEn ? `reference image prompt: ${item.imagePrompt ?? item.imagePromptZh ?? item.imagePromptEn}` : "",
            item.imageUrl ? `generated reference image URL: ${item.imageUrl}` : "",
            item.prompt || item.promptZh || item.promptEn ? `control prompt: ${item.prompt || item.promptZh || item.promptEn}` : "",
          ].filter(Boolean).join("; ");
          return `- ${parts}`;
        }).join("\n")}` : "",
    timedPrompts.length
      ? `Timed control prompts:\n${timedPrompts.map((item) => {
          const range = typeof item.startSeconds === "number" && typeof item.endSeconds === "number"
            ? `${item.startSeconds}-${item.endSeconds}s`
            : `${item.timeSeconds}s`;
          return `- At ${range}: ${item.prompt || item.promptZh || item.promptEn}`;
        }).join("\n")}`
      : "",
  ].filter(Boolean);
  if (additions.length) return [base, ...additions].join("\n");
  return base;
}

function normalizeMicroShotForSegment(
  value: Partial<VideoMicroShot>,
  segment: VideoProjectWithShots["segments"][number],
): VideoMicroShot {
  const localTimeSeconds = Math.max(0, Math.min(segment.durationSeconds, Math.round(Number(value.localTimeSeconds) || 0)));
  const endSeconds = typeof value.endSeconds === "number"
    ? Math.max(0, Math.min(segment.durationSeconds, Math.round(Number(value.endSeconds) || localTimeSeconds)))
    : undefined;
  const referenceType = value.referenceType === "text" || value.referenceType === "image_prompt" || value.referenceType === "mixed"
    ? value.referenceType
    : value.referenceType === "image"
      ? "image_prompt"
      : undefined;
  return {
    microShotNo: Math.max(1, Math.round(Number(value.microShotNo) || 1)),
    localTimeSeconds,
    endSeconds,
    absoluteTimeSeconds: segment.startTimeSeconds + localTimeSeconds,
    purpose: value.purpose ?? "",
    purposeZh: value.purposeZh ?? "",
    purposeEn: value.purposeEn ?? "",
    scene: value.scene ?? "",
    sceneZh: value.sceneZh ?? "",
    sceneEn: value.sceneEn ?? "",
    action: value.action ?? "",
    actionZh: value.actionZh ?? "",
    actionEn: value.actionEn ?? "",
    camera: value.camera ?? "",
    cameraZh: value.cameraZh ?? "",
    cameraEn: value.cameraEn ?? "",
    referenceType,
    imagePrompt: value.imagePrompt ?? value.imagePromptZh ?? value.imagePromptEn ?? "",
    imagePromptZh: value.imagePromptZh ?? "",
    imagePromptEn: value.imagePromptEn ?? "",
    imageUrl: value.imageUrl ?? "",
    imageTaskId: value.imageTaskId ?? "",
    imageStatus: value.imageStatus,
    errorMessage: value.errorMessage ?? "",
    usesConsistencyAnchors: value.usesConsistencyAnchors ?? [],
    prompt: value.prompt ?? value.promptZh ?? value.promptEn ?? value.action ?? value.purpose ?? "",
    promptZh: value.promptZh ?? "",
    promptEn: value.promptEn ?? "",
  };
}

function localizedMicroShotImagePromptForGeneration(microShot: VideoMicroShot, locale?: "zh" | "en"): string {
  if (typeof microShot.imagePrompt === "string") return microShot.imagePrompt;
  if (locale === "en") return microShot.imagePromptEn || microShot.imagePromptZh || "";
  return microShot.imagePromptZh || microShot.imagePromptEn || "";
}

function generationPromptForMicroShot(
  project: Pick<VideoProjectWithShots, "planJson">,
  segment: VideoProjectWithShots["segments"][number],
  microShot: VideoMicroShot,
): string {
  const imagePrompt = microShot.imagePrompt ?? microShot.imagePromptZh ?? microShot.imagePromptEn;
  const identityLock = characterIdentityLockForPrompt(project.planJson);
  const toneLock = colorToneLockForPrompt(project.planJson);
  const anchorLock = consistencyAnchorLocksForPrompt(project.planJson, microShot.usesConsistencyAnchors);
  return [
    "Generate exactly one static internal storyboard reference image for a single micro-shot inside a video segment.",
    "This is not a timeline label, not a collage, not a split-screen, and not a video frame sequence.",
    `Segment ${segment.segmentNo}, local time +${microShot.localTimeSeconds}s.`,
    microShot.purpose || microShot.purposeZh || microShot.purposeEn ? `Micro-shot purpose: ${microShot.purpose || microShot.purposeZh || microShot.purposeEn}` : "",
    microShot.scene ? `Scene/state: ${microShot.scene}` : "",
    microShot.action ? `Static action state to depict: ${microShot.action}` : "",
    microShot.camera ? `Composition/camera: ${microShot.camera}` : "",
    imagePrompt ? `Reference image prompt: ${imagePrompt}` : "",
    microShot.prompt || microShot.promptZh || microShot.promptEn ? `Text control prompt: ${microShot.prompt || microShot.promptZh || microShot.promptEn}` : "",
    identityLock ? "Hard character identity lock: " + identityLock : "",
    toneLock ? "Hard color tone lock: " + toneLock : "",
    anchorLock ? "Hard project consistency anchors for this micro-shot:\n" + anchorLock : "",
    "Describe and render a still moment only. Avoid motion trails, before/after panels, subtitles, labels, watermarks, UI, or added typography.",
  ].filter(Boolean).join("\n");
}

async function selectReferenceImagesForMicroShot(
  project: Pick<VideoProjectWithShots, "planJson" | "keyframes" | "referenceImageUrls" | "generationCandidates">,
  segment: VideoProjectWithShots["segments"][number],
  microShot: VideoMicroShot,
  finalTextPrompt: string,
): Promise<{ urls: string[]; output: ReferenceSelectionOutput }> {
  assertFullTransitionReferenceReady(project, segment.segmentNo);
  const requiredAnchorIds = microShot.usesConsistencyAnchors?.length
    ? microShot.usesConsistencyAnchors
    : readPlanStringArray(readPlanSegmentMap(project.planJson).get(segment.segmentNo), ["usesConsistencyAnchors", "uses_consistency_anchors"]);
  const missingHardAnchorWarnings = requiredAnchorIds.length
    ? missingHardAnchorWarningsForTarget(project, requiredAnchorIds)
    : [];
  if (missingHardAnchorWarnings.length) {
    throw new Error("Reference image selection failed: " + missingHardAnchorWarnings.join("; "));
  }
  const targetArtifactId = "segment:" + segment.segmentNo + ":micro_shot:" + microShot.microShotNo;
  const targetOrientation = detectReferenceOrientation(
    microShot.imagePrompt,
    microShot.imagePromptZh,
    microShot.imagePromptEn,
    microShot.action,
    microShot.actionZh,
    microShot.actionEn,
  );
  const hardAnchorIds = hardReferenceAnchorIds(project.planJson);
  const candidates = collectReferenceCandidates({
    project,
    segment,
    microShot,
    requiredAnchorIds,
    hardAnchorIds,
    targetOrientation,
    includeBoundaryFrames: true,
  });
  const enriched = await enrichReferenceCandidatesWithVision({ candidates, targetOrientation, targetPrompt: finalTextPrompt, targetArtifactId });
  const result = buildReferenceSelectionOutput({
    targetArtifactId,
    targetType: "micro_shot",
    candidates: enriched.candidates as ReferenceCandidateDraft[],
    targetOrientation,
    finalTextPrompt,
    missingHardAnchorWarnings: [...missingHardAnchorWarnings, ...enriched.warnings],
  });
  assertTransitionReferenceSelected(project, segment.segmentNo, result.output);
  assertReferenceSelectionValid(project, targetArtifactId, requiredAnchorIds, hardAnchorIds, result.output, "micro_shot_generation");
  return result;
}

async function saveReferenceSelectionOutput(projectId: string, output: ReferenceSelectionOutput): Promise<void> {
  const project = await prisma.videoProject.findUnique({ where: { id: projectId } });
  if (!project?.planJson) return;
  const plan = cloneJsonRecord(project.planJson);
  const existing = Array.isArray(plan.referenceSelectionOutputs)
    ? plan.referenceSelectionOutputs
    : Array.isArray(plan.reference_selection_outputs)
      ? plan.reference_selection_outputs
      : [];
  plan.referenceSelectionOutputs = [
    ...existing.filter((item) => {
      if (!isRecord(item)) return true;
      return (item.targetArtifactId ?? item.target_artifact_id) !== output.targetArtifactId;
    }),
    output,
  ].slice(-120);
  setPlanArtifactStatus(plan, [referenceSelectionArtifactId(output.targetArtifactId)], "ready", { retryFromStage: "reference_selector" });
  delete plan.reference_selection_outputs;
  await prisma.videoProject.update({
    where: { id: projectId },
    data: { planJson: plan as Prisma.InputJsonValue },
  });
  await mirrorPlanArtifactsToTables(projectId, plan);
  await logOnePromptVideo("reference_selector.output", {
    projectId,
    targetArtifactId: output.targetArtifactId,
    targetType: output.targetType,
    selectedArtifactIds: output.selectedArtifactIds,
    candidateCount: output.candidates.length,
    warnings: output.warnings,
  });
}

async function savePromptDebugArtifact(projectId: string, artifact: PromptDebugArtifact): Promise<void> {
  const project = await prisma.videoProject.findUnique({ where: { id: projectId } });
  if (!project?.planJson) return;
  const plan = cloneJsonRecord(project.planJson);
  const existing = isRecord(plan.promptDebugArtifacts)
    ? plan.promptDebugArtifacts
    : isRecord(plan.prompt_debug_artifacts)
      ? plan.prompt_debug_artifacts
      : {};
  plan.promptDebugArtifacts = {
    ...existing,
    [artifact.targetArtifactId]: artifact,
  };
  setPlanArtifactStatus(plan, [promptArtifactIdForTarget(artifact.targetArtifactId)], "ready", { retryFromStage: "compiler" });
  delete plan.prompt_debug_artifacts;
  await prisma.videoProject.update({
    where: { id: projectId },
    data: { planJson: plan as Prisma.InputJsonValue },
  });
  await mirrorPlanArtifactsToTables(projectId, plan);
  await logOnePromptVideo("prompt_compiler.output", {
    projectId,
    targetArtifactId: artifact.targetArtifactId,
    targetType: artifact.targetType,
    compilerVersion: artifact.compilerVersion,
    beforePromptLength: artifact.beforePrompt?.length ?? 0,
    finalPromptLength: artifact.finalPrompt.length,
    negativePromptLength: artifact.finalNegativePrompt?.length ?? 0,
    selectedReferenceCount: artifact.selectedReferenceUrls?.length ?? 0,
    rules: artifact.rules,
    warnings: artifact.warnings,
  });
}

const MAX_MEDIA_REVISIONS_PER_TARGET = 10;

function videoMediaRevisionKey(input: Pick<RollbackVideoMediaInput, "kind" | "targetId" | "microShotNo">): string {
  return input.kind === "micro_shot_image"
    ? `${input.kind}:${input.targetId}:${Number(input.microShotNo)}`
    : `${input.kind}:${input.targetId}`;
}

function readVideoMediaRevisionHistory(planJson: Prisma.JsonValue | null): Record<string, VideoMediaRevision[]> {
  const plan = isRecord(planJson) ? planJson : {};
  const raw = isRecord(plan.mediaRevisionHistory)
    ? plan.mediaRevisionHistory
    : isRecord(plan.media_revision_history)
      ? plan.media_revision_history
      : {};
  const history: Record<string, VideoMediaRevision[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!Array.isArray(value)) continue;
    history[key] = value.flatMap((item) => {
      if (!isRecord(item) || typeof item.url !== "string" || !item.url.trim()) return [];
      const kind = item.kind;
      if (kind !== "keyframe_image" && kind !== "micro_shot_image" && kind !== "segment_clip" && kind !== "transition_reference" && kind !== "generated_bridge" && kind !== "final_video") return [];
      return [{
        id: typeof item.id === "string" ? item.id : randomUUID(),
        kind,
        targetId: typeof item.targetId === "string" ? item.targetId : typeof item.target_id === "string" ? item.target_id : "",
        url: item.url.trim(),
        createdAt: typeof item.createdAt === "string" ? item.createdAt : typeof item.created_at === "string" ? item.created_at : new Date().toISOString(),
        segmentNo: Number.isInteger(Number(item.segmentNo ?? item.segment_no)) ? Number(item.segmentNo ?? item.segment_no) : undefined,
        microShotNo: Number.isInteger(Number(item.microShotNo ?? item.micro_shot_no)) ? Number(item.microShotNo ?? item.micro_shot_no) : undefined,
      } satisfies VideoMediaRevision];
    });
  }
  return history;
}

async function appendVideoMediaRevision(
  projectId: string,
  input: Omit<VideoMediaRevision, "id" | "createdAt" | "url"> & { url?: string | null },
): Promise<string | undefined> {
  const url = input.url?.trim();
  if (!url) return undefined;
  const project = await prisma.videoProject.findUnique({ where: { id: projectId }, select: { planJson: true } });
  if (!project) return undefined;
  const plan = cloneJsonRecord(project.planJson ?? {});
  const history = readVideoMediaRevisionHistory(project.planJson);
  const key = videoMediaRevisionKey(input);
  const revisions = history[key] ?? [];
  if (revisions.at(-1)?.url === url) return revisions.at(-1)?.id;
  const revisionId = randomUUID();
  revisions.push({ ...input, id: revisionId, url, createdAt: new Date().toISOString() });
  history[key] = revisions.slice(-MAX_MEDIA_REVISIONS_PER_TARGET);
  plan.mediaRevisionHistory = history;
  delete plan.media_revision_history;
  await prisma.videoProject.update({
    where: { id: projectId },
    data: { planJson: plan as Prisma.InputJsonValue },
  });
  return revisionId;
}

async function updatePlanMicroShot(
  projectId: string,
  segmentNo: number,
  microShotNo: number,
  patch: Partial<VideoMicroShot>,
): Promise<void> {
  const project = await prisma.videoProject.findUnique({ where: { id: projectId } });
  if (!project?.planJson) return;
  const plan = cloneJsonRecord(project.planJson);
  updatePlanMicroShotCollection(plan, "segments", segmentNo, microShotNo, patch);
  updatePlanMicroShotCollection(plan, "shots", segmentNo, microShotNo, patch);
  await prisma.videoProject.update({
    where: { id: projectId },
    data: { planJson: plan as Prisma.InputJsonValue },
  });
}

function cloneJsonRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return JSON.parse(JSON.stringify(isRecord(value) ? value : {})) as Record<string, unknown>;
}

function updatePlanMicroShotCollection(
  plan: Record<string, unknown>,
  collectionKey: "segments" | "shots",
  segmentNo: number,
  microShotNo: number,
  patch: Partial<VideoMicroShot>,
): void {
  const collection = plan[collectionKey];
  if (!Array.isArray(collection)) return;
  for (const item of collection) {
    if (!isRecord(item)) continue;
    const n = Number(item.segmentNo ?? item.segment_no ?? item.shotNo ?? item.shot_no ?? item.sequence);
    if (n !== segmentNo) continue;
    const rawMicroShots = item.microShots ?? item.micro_shots ?? item.internalStoryboard ?? item.internal_storyboard ?? item.subShots ?? item.sub_shots;
    const microShots = Array.isArray(rawMicroShots) ? rawMicroShots : [];
    const nextMicroShots = microShots.map((microShot, index) => {
      if (!isRecord(microShot)) return microShot;
      const currentNo = Number(microShot.microShotNo ?? microShot.micro_shot_no ?? index + 1);
      if (currentNo !== microShotNo) return microShot;
      return {
        ...microShot,
        ...patch,
        microShotNo,
      };
    });
    // Candidate polling and quality evaluation may finish after the user has
    // deleted this micro-shot. Those asynchronous updates may enrich an
    // existing item, but must never recreate an item that the user removed.
    item.microShots = nextMicroShots;
  }
}

async function syncPlanJsonFromShots(
  projectId: string,
  localizedUpdate?: {
    shotId: string;
    locale?: "zh" | "en";
    microShots?: UpdateShotInput["microShots"];
    purposeUpdated?: boolean;
    imagePromptUpdated?: boolean;
    negativePromptUpdated?: boolean;
  },
): Promise<void> {
  const project = await prisma.videoProject.findUnique({
    where: { id: projectId },
    include: PROJECT_INCLUDE,
  });
  if (!project?.planJson) return;

  const plan = project.planJson as unknown as OnePromptVideoPlan;

  const boundaryProjectKeyframes = project.keyframes.filter((keyframe) => !isConsistencyKeyframeNo(keyframe.keyframeNo));
  const consistencyProjectKeyframes = project.keyframes.filter((keyframe) => isConsistencyKeyframeNo(keyframe.keyframeNo));

  if (project.segments.length && boundaryProjectKeyframes.length) {
    const previousKeyframes = readPlanKeyframeMap(project.planJson);
    const previousConsistencyReferences = readPlanConsistencyReferenceMap(project.planJson);
    const previousSegments = readPlanSegmentMap(project.planJson);
    const updatedSegment = localizedUpdate
      ? project.segments.find((segment) => segment.id === localizedUpdate.shotId)
      : undefined;
    const updatedKeyframe = localizedUpdate
      ? project.keyframes.find((keyframe) => keyframe.id === localizedUpdate.shotId)
      : undefined;
    const updatedStartKeyframeNo = updatedSegment?.startKeyframeNo ?? updatedKeyframe?.keyframeNo;

    const nextConsistencyReferences: VideoConsistencyReference[] = consistencyProjectKeyframes.map((keyframe) => {
      const previous = previousConsistencyReferences.get(keyframe.keyframeNo);
      const localizedImageUpdate = localizedUpdate?.imagePromptUpdated && localizedUpdate.shotId === keyframe.id;
      const imagePromptZh = localizedImageUpdate && localizedUpdate?.locale !== "en"
        ? keyframe.imagePrompt
        : readPlanShotString(previous, ["imagePromptZh", "image_prompt_zh"]) || keyframe.imagePrompt;
      const imagePromptEn = localizedImageUpdate && localizedUpdate?.locale === "en"
        ? keyframe.imagePrompt
        : readPlanShotString(previous, ["imagePromptEn", "image_prompt_en"]) || keyframe.imagePrompt;
      const localizedNegativeUpdate = localizedUpdate?.negativePromptUpdated && localizedUpdate?.shotId === keyframe.id;
      const negativePromptZh = localizedNegativeUpdate && localizedUpdate?.locale !== "en"
        ? keyframe.negativePrompt
        : readPlanShotString(previous, ["negativePromptZh", "negative_prompt_zh"]) || toChineseNegativePrompt(keyframe.negativePrompt);
      const negativePromptEn = localizedNegativeUpdate && localizedUpdate?.locale === "en"
        ? keyframe.negativePrompt
        : readPlanShotString(previous, ["negativePromptEn", "negative_prompt_en"]) || keyframe.negativePrompt;
      const localizedPurposeUpdate = localizedUpdate?.purposeUpdated && localizedUpdate?.shotId === keyframe.id;
      const purposeZh = localizedPurposeUpdate && localizedUpdate?.locale !== "en"
        ? keyframe.purpose
        : readPlanShotString(previous, ["purposeZh", "purpose_zh"]) || keyframe.purpose;
      const purposeEn = localizedPurposeUpdate && localizedUpdate?.locale === "en"
        ? keyframe.purpose
        : readPlanShotString(previous, ["purposeEn", "purpose_en"]) || titleFromPrompt(readPlanShotString(previous, ["imagePromptEn", "image_prompt_en"]) || keyframe.imagePrompt, "Reference frame " + Math.abs(keyframe.keyframeNo));
      return {
        ...previous,
        kind: consistencyReferenceKindForPlan(previous, keyframe.keyframeNo),
        needed: true,
        keyframeNo: keyframe.keyframeNo,
        purpose: keyframe.purpose,
        purposeZh,
        purposeEn,
        scene: keyframe.scene,
        characterState: keyframe.characterState,
        productState: keyframe.productState,
        imagePrompt: keyframe.imagePrompt,
        imagePromptZh,
        imagePromptEn,
        negativePrompt: keyframe.negativePrompt,
        negativePromptZh,
        negativePromptEn,
      };
    });

    const nextKeyframes = boundaryProjectKeyframes.map((keyframe) => {
      const previous = previousKeyframes.get(keyframe.keyframeNo);
      const localizedImageUpdate = localizedUpdate?.imagePromptUpdated && updatedStartKeyframeNo === keyframe.keyframeNo;
      const imagePromptZh = localizedImageUpdate && localizedUpdate?.locale !== "en"
        ? keyframe.imagePrompt
        : readPlanShotString(previous, ["imagePromptZh", "image_prompt_zh"]) || keyframe.imagePrompt;
      const imagePromptEn = localizedImageUpdate && localizedUpdate?.locale === "en"
        ? keyframe.imagePrompt
        : readPlanShotString(previous, ["imagePromptEn", "image_prompt_en"]) || keyframe.imagePrompt;
      const localizedNegativeUpdate = localizedUpdate?.negativePromptUpdated && localizedUpdate?.shotId === keyframe.id;
      const negativePromptZh = localizedNegativeUpdate && localizedUpdate?.locale !== "en"
        ? keyframe.negativePrompt
        : readPlanShotString(previous, ["negativePromptZh", "negative_prompt_zh"]) || toChineseNegativePrompt(keyframe.negativePrompt);
      const negativePromptEn = localizedNegativeUpdate && localizedUpdate?.locale === "en"
        ? keyframe.negativePrompt
        : readPlanShotString(previous, ["negativePromptEn", "negative_prompt_en"]) || keyframe.negativePrompt;
      const localizedPurposeUpdate = localizedUpdate?.purposeUpdated && localizedUpdate?.shotId === keyframe.id;
      const purposeZh = localizedPurposeUpdate && localizedUpdate?.locale !== "en"
        ? keyframe.purpose
        : readPlanShotString(previous, ["purposeZh", "purpose_zh"]) || keyframe.purpose;
      const purposeEn = localizedPurposeUpdate && localizedUpdate?.locale === "en"
        ? keyframe.purpose
        : readPlanShotString(previous, ["purposeEn", "purpose_en"]) || titleFromPrompt(readPlanShotString(previous, ["imagePromptEn", "image_prompt_en"]) || keyframe.imagePrompt, "Boundary frame " + keyframe.keyframeNo);
      return {
        ...previous,
        keyframeNo: keyframe.keyframeNo,
        timeSeconds: keyframe.timeSeconds,
        purpose: keyframe.purpose,
        purposeZh,
        purposeEn,
        scene: keyframe.scene,
        characterState: keyframe.characterState,
        productState: keyframe.productState,
        imagePrompt: keyframe.imagePrompt,
        imagePromptZh,
        imagePromptEn,
        negativePrompt: keyframe.negativePrompt,
        negativePromptZh,
        negativePromptEn,
      };
    });

    const nextSegments = project.segments.map((segment) => {
      const previous = previousSegments.get(segment.segmentNo);
      const localizedVideoUpdate = localizedUpdate?.shotId === segment.id;
      const videoPromptZh = localizedVideoUpdate && localizedUpdate?.locale !== "en"
        ? segment.videoPrompt
        : readPlanShotString(previous, ["videoPromptZh", "video_prompt_zh"]) || segment.videoPrompt;
      const videoPromptEn = localizedVideoUpdate && localizedUpdate?.locale === "en"
        ? segment.videoPrompt
        : readPlanShotString(previous, ["videoPromptEn", "video_prompt_en"]) || segment.videoPrompt;
      const localizedNegativeUpdate = localizedUpdate?.negativePromptUpdated && localizedUpdate?.shotId === segment.id;
      const negativePromptZh = localizedNegativeUpdate && localizedUpdate?.locale !== "en"
        ? segment.negativePrompt
        : readPlanShotString(previous, ["negativePromptZh", "negative_prompt_zh"]) || toChineseNegativePrompt(segment.negativePrompt);
      const negativePromptEn = localizedNegativeUpdate && localizedUpdate?.locale === "en"
        ? segment.negativePrompt
        : readPlanShotString(previous, ["negativePromptEn", "negative_prompt_en"]) || segment.negativePrompt;
      const localizedPurposeUpdate = localizedUpdate?.purposeUpdated && localizedUpdate?.shotId === segment.id;
      const purposeZh = localizedPurposeUpdate && localizedUpdate?.locale !== "en"
        ? segment.purpose
        : readPlanShotString(previous, ["purposeZh", "purpose_zh"]) || segment.purpose;
      const purposeEn = localizedPurposeUpdate && localizedUpdate?.locale === "en"
        ? segment.purpose
        : readPlanShotString(previous, ["purposeEn", "purpose_en"]) || titleFromPrompt(readPlanShotString(previous, ["videoPromptEn", "video_prompt_en"]) || segment.videoPrompt, "Segment " + segment.segmentNo);
      const microShots = localizedVideoUpdate && Array.isArray(localizedUpdate?.microShots)
        ? localizedUpdate.microShots.map((item, index) => ({
            ...item,
            microShotNo: index + 1,
            localTimeSeconds: Math.max(0, Math.min(segment.durationSeconds, Math.round(Number(item.localTimeSeconds) || 0))),
            absoluteTimeSeconds: segment.startTimeSeconds + Math.max(0, Math.min(segment.durationSeconds, Math.round(Number(item.localTimeSeconds) || 0))),
          }))
        : readPlanMicroShots(previous);
      return {
        ...previous,
        segmentNo: segment.segmentNo,
        startKeyframeNo: segment.startKeyframeNo,
        endKeyframeNo: segment.endKeyframeNo,
        startTimeSeconds: segment.startTimeSeconds,
        endTimeSeconds: segment.endTimeSeconds,
        durationSeconds: segment.durationSeconds,
        boundaryMode: readPlanBoundaryMode(previous) || "continuous",
        purpose: segment.purpose,
        purposeZh,
        purposeEn,
        motion: segment.motion,
        camera: segment.camera,
        subjectMotion: segment.subjectMotion,
        environmentMotion: segment.environmentMotion,
        videoPrompt: segment.videoPrompt,
        videoPromptZh,
        videoPromptEn,
        subtitle: segment.subtitle,
        outputMode: readPlanOutputMode(previous),
        constraints: readPlanStringArray(previous, ["constraints"]),
        timedPrompts: readPlanTimedPrompts(previous),
        microShots,
        audioPlan: readPlanAudioPlan(previous),
        negativePrompt: segment.negativePrompt,
        negativePromptZh,
        negativePromptEn,
      };
    });

    const keyframeMap = new Map(boundaryProjectKeyframes.map((keyframe) => [keyframe.keyframeNo, keyframe]));
    const nextShots = project.segments.map((segment) => {
      const start = keyframeMap.get(segment.startKeyframeNo);
      const planSegment = nextSegments.find((item) => item.segmentNo === segment.segmentNo);
      const planKeyframe = nextKeyframes.find((item) => item.keyframeNo === segment.startKeyframeNo);
      return {
        shotNo: segment.segmentNo,
        durationSeconds: segment.durationSeconds,
        purpose: segment.purpose,
        purposeZh: planSegment?.purposeZh,
        purposeEn: planSegment?.purposeEn,
        camera: segment.camera,
        action: segment.motion,
        imagePrompt: start?.imagePrompt || "",
        imagePromptZh: planKeyframe?.imagePromptZh || start?.imagePrompt || "",
        imagePromptEn: planKeyframe?.imagePromptEn || start?.imagePrompt || "",
        videoPrompt: segment.videoPrompt,
        videoPromptZh: planSegment?.videoPromptZh || segment.videoPrompt,
        videoPromptEn: planSegment?.videoPromptEn || segment.videoPrompt,
        boundaryMode: planSegment?.boundaryMode,
        outputMode: planSegment?.outputMode,
        constraints: planSegment?.constraints,
        timedPrompts: planSegment?.timedPrompts,
        microShots: planSegment?.microShots,
        audioPlan: planSegment?.audioPlan,
        subtitle: segment.subtitle,
        negativePrompt: segment.negativePrompt,
        negativePromptZh: planSegment?.negativePromptZh,
        negativePromptEn: planSegment?.negativePromptEn,
      };
    });

    const nextPlan: OnePromptVideoPlan = {
      ...plan,
      keyframeCount: boundaryProjectKeyframes.length,
      segmentCount: project.segments.length,
      consistencyReferences: nextConsistencyReferences,
      keyframes: nextKeyframes,
      segments: nextSegments,
      shots: nextShots,
    };
    markPlanArtifactsDirtyForShotUpdate(nextPlan as unknown as Record<string, unknown>, project, localizedUpdate);
    await prisma.videoProject.update({
      where: { id: projectId },
      data: { planJson: nextPlan as unknown as Prisma.InputJsonValue },
    });
    return;
  }

  if (!project.shots.length) return;
  const previousShots = readPlanShotMap(project.planJson);
  const nextPlan: OnePromptVideoPlan = {
    ...plan,
    shots: project.shots.map((shot) => ({
      ...previousShots.get(shot.shotNo),
      shotNo: shot.shotNo,
      durationSeconds: shot.durationSeconds,
      purpose: shot.purpose,
      purposeZh:
        localizedUpdate?.purposeUpdated && localizedUpdate?.shotId === shot.id && localizedUpdate.locale !== "en"
          ? shot.purpose
          : readPlanShotString(previousShots.get(shot.shotNo), ["purposeZh", "purpose_zh"]) || shot.purpose,
      purposeEn:
        localizedUpdate?.purposeUpdated && localizedUpdate?.shotId === shot.id && localizedUpdate.locale === "en"
          ? shot.purpose
          : readPlanShotString(previousShots.get(shot.shotNo), ["purposeEn", "purpose_en"]) || titleFromPrompt(readPlanShotString(previousShots.get(shot.shotNo), ["videoPromptEn", "video_prompt_en"]) || shot.videoPrompt, "Shot " + shot.shotNo),
      camera: shot.camera,
      action: shot.action,
      imagePrompt: shot.imagePrompt,
      imagePromptZh:
        localizedUpdate?.imagePromptUpdated && localizedUpdate.shotId === shot.id && localizedUpdate.locale !== "en"
          ? shot.imagePrompt
          : readPlanShotString(previousShots.get(shot.shotNo), ["imagePromptZh", "image_prompt_zh"]) || shot.imagePrompt,
      imagePromptEn:
        localizedUpdate?.imagePromptUpdated && localizedUpdate.shotId === shot.id && localizedUpdate.locale === "en"
          ? shot.imagePrompt
          : readPlanShotString(previousShots.get(shot.shotNo), ["imagePromptEn", "image_prompt_en"]) || shot.imagePrompt,
      videoPrompt: shot.videoPrompt,
      videoPromptZh:
        localizedUpdate?.shotId === shot.id && localizedUpdate.locale !== "en"
          ? shot.videoPrompt
          : readPlanShotString(previousShots.get(shot.shotNo), ["videoPromptZh", "video_prompt_zh"]) || shot.videoPrompt,
      videoPromptEn:
        localizedUpdate?.shotId === shot.id && localizedUpdate.locale === "en"
          ? shot.videoPrompt
          : readPlanShotString(previousShots.get(shot.shotNo), ["videoPromptEn", "video_prompt_en"]) || shot.videoPrompt,
      subtitle: shot.subtitle,
      negativePrompt: shot.negativePrompt,
      negativePromptZh:
        localizedUpdate?.negativePromptUpdated && localizedUpdate?.shotId === shot.id && localizedUpdate.locale !== "en"
          ? shot.negativePrompt
          : readPlanShotString(previousShots.get(shot.shotNo), ["negativePromptZh", "negative_prompt_zh"]) || toChineseNegativePrompt(shot.negativePrompt),
      negativePromptEn:
        localizedUpdate?.negativePromptUpdated && localizedUpdate?.shotId === shot.id && localizedUpdate.locale === "en"
          ? shot.negativePrompt
          : readPlanShotString(previousShots.get(shot.shotNo), ["negativePromptEn", "negative_prompt_en"]) || shot.negativePrompt,
      microShots:
        localizedUpdate?.shotId === shot.id && Array.isArray(localizedUpdate.microShots)
          ? localizedUpdate.microShots.map((item, index) => ({
              ...item,
              microShotNo: index + 1,
              localTimeSeconds: Math.max(0, Math.min(shot.durationSeconds, Math.round(Number(item.localTimeSeconds) || 0))),
            }))
          : readPlanMicroShots(previousShots.get(shot.shotNo)),
    })),
  };
  markPlanArtifactsDirtyForShotUpdate(nextPlan as unknown as Record<string, unknown>, project, localizedUpdate);
  await prisma.videoProject.update({
    where: { id: projectId },
    data: { planJson: nextPlan as unknown as Prisma.InputJsonValue },
  });
}

