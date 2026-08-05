import { Prisma, VideoProjectStatus, VideoShotStatus } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { consumeUserBalanceInTransaction } from "@/lib/billing";
import { normalizePlanInput } from "./planner";
import { buildImageGenerationQualityReport, buildVideoGenerationQualityReport } from "./quality-judge";
import {
  queryDashScopeTask,
  queryImsComposeJob,
  aliyunImageModelName,
  aliyunImageToVideoCapabilities,
  aliyunVideoImageInputCapabilities,
  prepareAliyunImagePromptForSubmission,
  submitAliyunImageTask,
  submitAliyunImageToVideoTask,
  type DashScopeTaskResult,
} from "./aliyun-workflow";
import {
  applyManualPlanningRouteClassification,
  createAliyunStoryboardPlan,
  normalizeAliyunStoryboardPlannerCheckpoint,
  type AliyunStoryboardPlannerCheckpoint,
  type AliyunStoryboardProgressStage,
  type AliyunStoryboardProgressUpdate,
  type AliyunStoryboardStageMetric,
} from "./three-stage-planner";
import {
  PLANNING_ROUTE_CATEGORY_TEMPLATE_MAP,
  validateCategoryTemplateCombination,
} from "./planning-route-mapping";
import {
  PLANNING_CHRONOLOGY_HOOK_POLICY,
  validateChronologyHookPolicy,
} from "./planning-chronology-policy";
import { comparePlanningRouteContracts } from "./planning-route-invalidation";
import type { ApprovedPlanningRouteContract } from "./planning-route-planning-architect";
import { decideStoryRewrite, markStoryRewriteRequired, withStoryQualityGate } from "./story-quality-gate";
import { readStoryRolloutConfig, shouldEvaluateStoryQuality, shouldRequireStoryQualityReview } from "./story-rollout-config";
import { errorForLog, logOnePromptVideo, withOnePromptVideoLogContext } from "./logger";
import { composeVideoClipsLocally } from "./local-compose";
import { isTemporaryDashScopeUrl, persistRemoteMediaToOss } from "./oss-media";
import { appendProjectStageLog, writeProjectOverviewLog, writeScriptBreakdownLog, writeStageErrorLog } from "./stage-logger";
import type { ArtifactMetadata, CameraRelation, CreateCharacterTurnaroundInput, CreateVideoProjectInput, DeferredVideoQualityCheck, FinalTransitionPlan, GeneratedBridgeArtifact, GenerationQualityReport, ImageRepairDecision, ImageRepairMode, OnePromptVideoPlan, PlanVideoProjectInput, PromptDebugArtifact, ReferenceSelectionOutput, RollbackVideoMediaInput, SegmentRenderDescription, TransitionReferenceArtifact, TransitionReferenceFrameCandidate, UpdateShotInput, VideoAssetCategory, VideoAssetLibrary, VideoAssetLibraryItem, VideoAssetView, VideoAudioPlan, VideoBoundaryContract, VideoChronologyMode, VideoConsistencyAnchor, VideoConsistencyReference, VideoCreativeCategory, VideoCreativeTemplateId, VideoHookMode, VideoHookRevealLevel, VideoMediaConditionedSegmentPlan, VideoMediaRevision, VideoMicroShot, VideoObservedBoundaryFacts } from "./types";
import { detectReferenceOrientation, referenceRecencyScore, referenceViewMatchScore, selectReferenceCandidates, type ReferenceOrientation, type SelectableReferenceCandidate, REFERENCE_SELECTION_POLICY_VERSION } from "./reference-selector";
import { enrichReferenceCandidatesWithVision } from "./reference-vision-evaluator";
import { readCameraGraph, resolveCameraInheritanceContext } from "./camera-graph";
import {
  assertPlanValidForGeneration as assertPlanValidForGenerationV2,
  validateOnePromptVideoPlan,
} from "./plan-validator";
import { sanitizeGameVisualPromptText, stripNonStandardPromptSymbols } from "./frame-contract";
import { evaluateEndFrameContinuity } from "./end-frame-continuity";
import { evaluateGeneratedImageQuality, evaluateGeneratedVideoQuality, extractVideoFrameDataUrls, generationQualityCompositeScore, generationQualityModelIdentity, inspectGeneratedVideoTechnicalQuality, isReferenceMissingQualityEvaluation, isTechnicalQualityEvaluationFailure, normalizeImageQualityResponse } from "./generation-quality-evaluator";
import {
  commitArtifactPlan,
  readArtifactPlan,
} from "./plan-artifact-store";
import {
  createCanonicalExecutionContractV2,
  providerPromptFromExecutionContract,
} from "./canonical-execution-contract";
import { ExecutionContractMissingError } from "./execution-contract-error";
import { buildAuthoritativeVisualContract, repairNegativePromptAgainstVisualContract, repairPromptAgainstVisualContract, type AuthoritativeVisualContract } from "./visual-quality-contract";
import { isVideoProviderCapacityError, registerVideoProviderDemand } from "./video-provider-capacity";
import { isProviderCapacityError, registerProviderDemand } from "./provider-capacity";
import { ONE_PROMPT_MAX_REFERENCE_IMAGES } from "@/lib/one-prompt-video-limits";
import {
  assertEndFrameRequirementSupported,
  compileAliyunVideoPrompt,
  resolveEndFrameRequirementLevel,
  resolveVideoAudioStrategy,
  videoPromptContractFromUnknown,
} from "./video-terminal-contract";
import {
  finishPlanningPerformanceRun,
  queuePlanningPerformanceRun,
  recordPlanningStageObservation,
  startPlanningPerformanceRun,
  type PlanningProgressCounters,
} from "./planning-performance";
import {
  resolveVideoImageInputs,
  type ResolvedVideoImageInputs,
  type VideoImageInput,
} from "@/services/providers/video-input-contract";
import { compileOrderedSubjectActionPrompt } from "./video-prompt-presentation";
import {
  bindBoundaryContractsToApprovedAssets,
  deriveCanonicalBoundaryContracts,
  setBoundaryContractStatus,
  validateBoundaryContracts,
} from "./boundary-contract";
import {
  observeApprovedBoundaryFrame,
  planMediaConditionedSegment,
} from "./media-conditioned-planner";
import {
  buildGenerationInputFingerprint,
  buildQualityEvaluationFingerprint,
  buildQualityReferenceSetHash,
  GENERATION_INPUT_FINGERPRINT_VERSION,
  QUALITY_EVALUATION_FINGERPRINT_VERSION,
  QUALITY_POLICY_VERSION,
  QUALITY_PROMPT_VERSION,
} from "./generation-candidate-policy";
import { hashMediaContent } from "./media-content-hash";
import {
  claimQualityEvaluationCache,
  completeQualityEvaluationCache,
  failQualityEvaluationCache,
} from "./generation-quality-cache";
import {
  advanceRepairConvergence,
  buildRepairContractRevision,
  repairConvergenceEpisodeFromUnknown,
  type RepairConvergenceDecision,
  type RepairConvergenceStage,
} from "./repair-convergence-controller";
import {
  computeProjectTaskGraphSnapshot,
  type ProjectTaskGraphNode,
  type ProjectTaskStatus,
} from "./task-graph-progress";
import {
  applyImagePromptEditContractToAssetContract,
  compileImagePromptDisplay,
  compileImagePromptForProvider,
  normalizeImagePromptEditContract,
  normalizeVideoAssetImageContract,
  validateImagePromptEditContract,
} from "./image-prompt-edit-contract";
import {
  anchorReferenceUsagePolicy,
  isReferenceImageEligibleAnchor,
  isVisibleEvidenceAnchor,
  normalizeAnchorSemantics,
  purgePlanSoftAnchorConflicts,
  sanitizePlanSoftAnchorVisibility,
} from "./anchor-semantics";
import {
  compileAssetImagePromptEn,
  compileAssetImagePromptZh,
} from "./asset-image-contract";
import {
  isPlayingCardAnchor,
  resolvePlayingCardAssetContract,
} from "./playing-card-contract";
import {
  assertVideoProductionJobLease,
  claimNextVideoProductionJob,
  classifyVideoProductionFailure,
  completeVideoProductionJob,
  deferVideoProductionJobForCapacity,
  enqueueVideoProductionJob,
  failVideoProductionJob,
  heartbeatVideoProductionJob,
  LostProductionJobLeaseError,
  ProductionSchedulingInvariantError,
  rescheduleVideoProductionJob,
  retryFailedVideoProductionJobById,
  retryVideoProductionJob,
  setVideoProductionJobStage,
  ACTIVE_VIDEO_PRODUCTION_JOB_STATUSES,
  SUPPORTED_VIDEO_PRODUCTION_PAYLOAD_VERSIONS,
  VIDEO_PRODUCTION_CONTRACT_VERSION,
  VIDEO_PRODUCTION_PAYLOAD_SCHEMA_VERSION,
  type VideoProductionJobKind,
  type VideoProductionStage,
} from "./production-job-queue";
import {
  heartbeatVideoProductionWorker,
  resolveVideoProductionRuntimeVersion,
} from "./production-worker-runtime";
import {
  compactPersonCharacterState,
  compactPersonReferenceUsageNote,
  compilePersonCompositionPrompt,
  compilePersonIdentityLock,
  normalizePersonReferenceUsageNotes,
} from "./person-image-prompt-ownership";
import { projectProductionProjection as computeProjectProductionProjection } from "./project-production-projection";
import {
  StructuredCommandError,
  type ProductionErrorCategory,
} from "./structured-production-error";
import { isOnePromptVideoFastPreviewEnabled } from "./fast-preview-config";

const PROJECT_INCLUDE = {
  keyframes: { orderBy: { keyframeNo: "asc" as const } },
  segments: { orderBy: { segmentNo: "asc" as const } },
  generationCandidates: { orderBy: [{ createdAt: "desc" as const }, { candidateNo: "asc" as const }] },
  providerVideoLeases: {
    select: {
      id: true,
      resourceKey: true,
      targetId: true,
      status: true,
      upstreamTaskId: true,
      queuedAt: true,
      lastRequestedAt: true,
      leaseExpiresAt: true,
      attempt: true,
      lastError: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" as const },
  },
  productionJobs: {
    select: {
      id: true,
      artifactId: true,
      targetId: true,
      kind: true,
      stage: true,
      status: true,
      priority: true,
      attempt: true,
      maxAttempts: true,
      modelAttempt: true,
      maxModelAttempts: true,
      stageRepairAttempt: true,
      maxStageRepairAttempts: true,
      infrastructureAttempt: true,
      maxInfrastructureAttempts: true,
      leaseLossCount: true,
      userRetryCount: true,
      lastInterruptionReason: true,
      deploymentGraceUntil: true,
      lastError: true,
      errorCategory: true,
      errorCode: true,
      recoveryAction: true,
      workerId: true,
      requiredWorkerVersion: true,
      claimedWorkerVersion: true,
      progressAt: true,
      availableAt: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "desc" as const },
    take: 100,
  },
};

const DEFAULT_IMAGE_TASK_CONCURRENCY = 5;
const DEFAULT_CLIP_TASK_CONCURRENCY = 5;
const MAX_UPSTREAM_TASK_CONCURRENCY = 5;
const DEFAULT_MICRO_SHOT_PREPARATION_CONCURRENCY = 5;
const ASSET_IMAGE_JOB_PRIORITY = 100;
const BOUNDARY_IMAGE_JOB_PRIORITY = 50;
const MAX_BOUNDARY_IMAGE_CONCURRENCY_WHILE_ASSETS_PENDING = 2;
const CURRENT_PLANNER_ARCH = "v2";

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
    storyContractRepairCount: number;
    storyContractRepairDurationMs: number;
  };
}

export function planningCheckpointResumeProgress(
  checkpoint: AliyunStoryboardPlannerCheckpoint | undefined,
  referenceImageCount: number,
): Pick<
  VideoPlanningProgress,
  "stage" | "completedSteps" | "totalSteps" | "completedSegments" | "totalSegments" | "detailZh" | "detailEn"
> | undefined {
  if (!checkpoint?.planningRaw) return undefined;
  const segmentNos = (value: Record<string, unknown> | undefined): number[] =>
    Object.keys(value ?? {})
      .map(Number)
      .filter((segmentNo) => Number.isInteger(segmentNo) && segmentNo > 0);
  const decomposedSegmentNos = segmentNos(checkpoint.shotDecomposerSegmentPlans);
  const approvedSegmentNos = segmentNos(checkpoint.approvedShotDecomposerSegmentPlans);
  const compiledSegmentNos = segmentNos(checkpoint.promptDetailSegmentPlans);
  const knownSegmentNos = new Set([
    ...decomposedSegmentNos,
    ...approvedSegmentNos,
    ...compiledSegmentNos,
  ]);
  if (!knownSegmentNos.size) {
    const totalSteps = referenceImageCount > 0 ? 5 : 4;
    return {
      stage: "storyboard_artist",
      completedSteps: 1 + (referenceImageCount > 0 ? 1 : 0),
      totalSteps,
      completedSegments: 0,
      totalSegments: 0,
      detailZh: "已恢复故事架构检查点，将从尚未完成的剧情设计继续。",
      detailEn: "The planning architecture checkpoint was restored. Work will continue from the unfinished story-design stage.",
    };
  }
  const totalSegments = Math.max(...knownSegmentNos);
  const referenceStepOffset = referenceImageCount > 0 ? 1 : 0;
  const storyGatesComplete = Boolean(
    checkpoint.storyboardArtistPlan
    && checkpoint.storyContractReport?.passed
    && checkpoint.storySemanticReview,
  );
  const baseCompletedSteps = storyGatesComplete
    ? 5 + referenceStepOffset
    : 1 + referenceStepOffset;
  const totalSteps = totalSegments * 2 + 6 + referenceStepOffset;
  const completedSteps = Math.min(
    totalSteps - 1,
    baseCompletedSteps + decomposedSegmentNos.length + compiledSegmentNos.length,
  );
  const stage: AliyunStoryboardProgressStage = compiledSegmentNos.length > 0
    ? "prompt_detailer"
    : "shot_decomposer";
  return {
    stage,
    completedSteps,
    totalSteps,
    completedSegments: compiledSegmentNos.length,
    totalSegments,
    detailZh: `已从检查点恢复：保留 ${decomposedSegmentNos.length}/${totalSegments} 个已拆解片段和 ${compiledSegmentNos.length}/${totalSegments} 个已编译片段，只继续未完成部分。`,
    detailEn: `Checkpoint restored: kept ${decomposedSegmentNos.length}/${totalSegments} decomposed segments and ${compiledSegmentNos.length}/${totalSegments} compiled segments. Only unfinished work will continue.`,
  };
}

const planningRuntime = globalThis as typeof globalThis & {
  onePromptVideoPlanningWorkerId?: string;
  onePromptVideoProductionWorkerId?: string;
};
const planningWorkerId = planningRuntime.onePromptVideoPlanningWorkerId ?? randomUUID();
planningRuntime.onePromptVideoPlanningWorkerId = planningWorkerId;
const productionWorkerId = planningRuntime.onePromptVideoProductionWorkerId ?? randomUUID();
planningRuntime.onePromptVideoProductionWorkerId = productionWorkerId;
const PLANNING_LEASE_MS = 90000;

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

function planningErrorCategory(error: unknown): string {
  if (
    error
    && typeof error === "object"
    && Reflect.get(error, "classification") === "stage_repairable"
  ) {
    return "stage_repairable";
  }
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code.slice(0, 80);
  }
  if (error instanceof Error && error.name) return error.name.slice(0, 80);
  return "unknown_error";
}

function imageTaskConcurrency(): number {
  return Math.max(1, Math.min(MAX_UPSTREAM_TASK_CONCURRENCY, envInt("ONE_PROMPT_VIDEO_IMAGE_CONCURRENCY", DEFAULT_IMAGE_TASK_CONCURRENCY)));
}

function microShotPreparationConcurrency(): number {
  return Math.max(
    1,
    Math.min(
      MAX_UPSTREAM_TASK_CONCURRENCY,
      envInt(
        "ONE_PROMPT_VIDEO_MICRO_SHOT_PREP_CONCURRENCY",
        DEFAULT_MICRO_SHOT_PREPARATION_CONCURRENCY,
      ),
    ),
  );
}

function clipTaskConcurrency(): number {
  return Math.max(1, Math.min(MAX_UPSTREAM_TASK_CONCURRENCY, envInt("ONE_PROMPT_VIDEO_CLIP_CONCURRENCY", DEFAULT_CLIP_TASK_CONCURRENCY)));
}

function isManuallyStopped(project: Pick<VideoProjectRecord, "status" | "errorMessage">): boolean {
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
const CHARACTER_TURNAROUND_STYLE_PRESET = "character-turnaround";
const CHARACTER_TURNAROUND_T_POSE_EN = "MANDATORY BODY POSE: strict symmetrical 3D-modeling T-pose, standing upright with both arms fully extended horizontally at shoulder height, forming a straight fingertip-to-fingertip line, elbows straight, wrists neutral, fingers together, legs straight and slightly apart, and both feet fully visible. Preserve this exact T-pose in every view.";
const CHARACTER_TURNAROUND_T_POSE_ZH = "强制身体姿势：严格对称的 3D 建模 T 字姿势，人物直立，双臂在肩部高度完全水平伸展，指尖到指尖形成直线，肘部伸直，手腕保持中立，手指并拢，双腿伸直并略微分开，双脚完整可见。所有视角必须保持完全一致的 T 字姿势。";
const CHARACTER_TURNAROUND_T_POSE_NEGATIVE_EN = "A-pose, arms lowered, arms down, bent elbows, hands on hips, crossed arms, action pose, asymmetrical arm height, cropped hands, cropped feet";
const CHARACTER_TURNAROUND_T_POSE_NEGATIVE_ZH = "A 字姿势，手臂下垂，手臂放下，肘部弯曲，双手叉腰，双臂交叉，动作姿势，双臂高度不对称，手部裁切，脚部裁切";
const MANUAL_STOP_MESSAGE = "Generation stopped by user";
const CLIP_CONTINUITY_REPORT_MISSING_ERROR = "Clip has no passed end-frame continuity report; visual continuity evaluation is required.";

export type VideoProjectRecord = Prisma.VideoProjectGetPayload<{
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
  resolvedVideoImages?: ResolvedVideoImageInputs;
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

export function serializeVideoProject(project: VideoProjectRecord) {
  const planKeyframes = readPlanKeyframeMap(project.planJson);
  const planConsistencyReferences = readPlanConsistencyReferenceMap(project.planJson);
  const planConsistencyAnchors = readPlanConsistencyAnchorMap(project.planJson);
  const planSegments = readPlanSegmentMap(project.planJson);
  const keyframes = "keyframes" in project ? project.keyframes : [];
  const segments = "segments" in project ? project.segments : [];
  const keyframeMap = new Map(keyframes.map((frame) => [frame.keyframeNo, frame]));
  const selectedMicroShotCandidates = new Map(
    project.generationCandidates
      .filter((candidate) => candidate.kind === "micro_shot_image" && candidate.selected && Boolean(candidate.mediaUrl))
      .map((candidate) => [candidate.artifactId, candidate]),
  );
  const plannerProgress = readVideoPlanningProgress(project.planJson);
  const taskGraph = buildProjectTaskGraph(project, plannerProgress);
  const activeTaskNodes = taskGraph.nodes.filter((node) =>
    node.active !== false
    && node.type !== "review_gate"
    && !node.id.startsWith("cancelled:")
  );
  const productionProjection = normalizeCharacterTurnaroundProductionProjection(project, computeProjectProductionProjection({
    jobs: project.productionJobs,
    taskGraphNodes: taskGraph.nodes,
    completedArtifactCount: activeTaskNodes.filter((node) => node.status === "completed").length,
    totalArtifactCount: activeTaskNodes.length,
    finalVideoReady: Boolean(project.finalVideoUrl),
  }));
  const projectedTaskGraph = {
    ...taskGraph,
    recoveryAction:
      productionProjection.recoveryAction
      ?? taskGraph.recoveryAction,
    allowedActions: productionProjection.recoveryAction
      ? ["EXECUTE_RECOVERY_ACTION" as const]
      : taskGraph.allowedActions,
  };
  const humanWorkflowState = deriveHumanWorkflowState(project);
  const productionState = deriveProductionState(project);
  const {
    providerVideoLeases: _providerVideoLeases,
    productionJobs: _productionJobs,
    ...publicProject
  } = project;
  return {
    ...publicProject,
    status: productionProjection.status,
    referenceImageUrls: jsonStringArray(project.referenceImageUrls),
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    keyframes: keyframes.filter((frame) => isEligibleConsistencyKeyframe(project.planJson, frame.keyframeNo)).map((frame) => {
      const source = planKeyframes.get(frame.keyframeNo) ?? planConsistencyReferences.get(frame.keyframeNo);
      const imagePromptZh = readPlanShotString(source, ["imagePromptZh", "image_prompt_zh"]) || frame.imagePrompt;
      const imagePromptEn = readPlanShotString(source, ["imagePromptEn", "image_prompt_en"]) || frame.imagePrompt;
      const anchorId = readPlanShotString(source, ["anchorId", "anchor_id"]);
      const anchor = anchorId ? planConsistencyAnchors.get(anchorId) : undefined;
      const imagePromptEditContract = normalizeImagePromptEditContract(
        source?.imagePromptEditContract ?? source?.image_prompt_edit_contract,
        {
          imagePromptZh,
          imagePromptEn,
          providerPrompt: frame.imagePrompt,
          assetContract: normalizeVideoAssetImageContract(anchor?.assetImageContract ?? anchor?.asset_image_contract),
        },
      );
      return {
        ...frame,
        providerImagePrompt: frame.imagePrompt,
        imagePromptEditContract,
        anchorId,
        assetView: readPlanShotString(source, ["assetView", "asset_view"]),
        sourceArtifactId: readPlanShotString(source, ["sourceArtifactId", "source_artifact_id"]),
        viewGenerationMode: readPlanShotString(source, ["viewGenerationMode", "view_generation_mode"]),
        purposeZh: readPlanShotString(source, ["purposeZh", "purpose_zh"]) || frame.purpose,
        purposeEn: readPlanShotString(source, ["purposeEn", "purpose_en"]) || titleFromPrompt(imagePromptEn || frame.imagePrompt, `Boundary frame ${frame.keyframeNo}`),
        imagePromptZh: compileImagePromptDisplay(imagePromptEditContract, "zh"),
        imagePromptEn: compileImagePromptDisplay(imagePromptEditContract, "en"),
        negativePromptZh: readPlanShotString(source, ["negativePromptZh", "negative_prompt_zh"]) || toChineseNegativePrompt(frame.negativePrompt),
        negativePromptEn: readPlanShotString(source, ["negativePromptEn", "negative_prompt_en"]) || frame.negativePrompt,
        createdAt: frame.createdAt.toISOString(),
        updatedAt: frame.updatedAt.toISOString(),
      };
    }),
    segments: segments.map((segment) => {
      const editorProjection = serializeVideoSegmentProjection(
        segment,
        keyframeMap,
        planSegments,
        selectedMicroShotCandidates,
        project.planJson,
      );
      return {
        ...segment,
        ...editorProjection,
        segmentNo: segment.segmentNo,
        motion: segment.motion,
        startImageUrl: editorProjection.imageUrl,
        endImageUrl: editorProjection.endImageUrl,
      };
    }),
    generationCandidates: project.generationCandidates.map((candidate) => ({
      ...candidate,
      createdAt: candidate.createdAt.toISOString(),
      updatedAt: candidate.updatedAt.toISOString(),
    })),
    productionJobs: project.productionJobs.map((job) => ({
      ...job,
      availableAt: job.availableAt.toISOString(),
      deploymentGraceUntil: job.deploymentGraceUntil?.toISOString() ?? null,
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
      progressAt: job.progressAt.toISOString(),
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    })),
    plannerProgress,
    taskGraph: projectedTaskGraph,
    humanWorkflowState,
    productionState,
    productionProjection,
    planDebug: extractPlanDebug(project.planJson),
  };
}

function deriveProductionState(project: VideoProjectRecord): {
  hasPendingJobs: boolean;
  queuedCount: number;
  runningCount: number;
  retryingCount: number;
  oldestQueuedAt: string | null;
  oldestQueuedAgeMs: number;
  workerUnavailable: boolean;
  workerStalled: boolean;
  workerHealth: "idle" | "healthy" | "unavailable" | "stalled";
  lastMeaningfulProgressAt: string | null;
  upstreamAcceptedCount: number;
  submissionState: "not_submitted" | "upstream_accepted" | "upstream_running";
} {
  const pending = project.productionJobs.filter((job) =>
    ACTIVE_VIDEO_PRODUCTION_JOB_STATUSES.includes(
      job.status as (typeof ACTIVE_VIDEO_PRODUCTION_JOB_STATUSES)[number],
    )
  );
  const queued = pending.filter((job) => job.status === "queued");
  const running = pending.filter((job) =>
    job.status === "claimed" || job.status === "running"
  );
  const oldestQueued = queued.reduce<(typeof queued)[number] | undefined>(
    (oldest, job) => !oldest || job.createdAt < oldest.createdAt ? job : oldest,
    undefined,
  );
  const oldestQueuedAgeMs = oldestQueued
    ? Math.max(0, Date.now() - oldestQueued.createdAt.getTime())
    : 0;
  const nowMs = Date.now();
  const recentlyTouched = pending.some((job) =>
    nowMs - job.updatedAt.getTime() < 45_000
  );
  const progressTrackedJobs = pending.filter((job) => job.errorCategory !== "internal_capacity");
  const lastProgress = progressTrackedJobs.reduce<Date | undefined>(
    (latest, job) => !latest || job.progressAt > latest ? job.progressAt : latest,
    undefined,
  );
  const workerStalled = Boolean(
    progressTrackedJobs.some((job) =>
      nowMs - job.updatedAt.getTime() < 45_000
      && nowMs - job.progressAt.getTime() >= 5 * 60_000
    )
  );
  const workerUnavailable = Boolean(
    oldestQueued
    && !recentlyTouched
    && oldestQueuedAgeMs >= 15_000
  );
  const upstreamJobs = pending.filter((job) => job.status === "waiting_upstream");
  return {
    hasPendingJobs: pending.length > 0,
    queuedCount: queued.length,
    runningCount: running.length,
    retryingCount: queued.filter((job) =>
      job.attempt > 0
      || job.infrastructureAttempt > 0
      || job.recoveryAction === "AUTO_RETRY_INFRASTRUCTURE"
    ).length,
    oldestQueuedAt: oldestQueued?.createdAt.toISOString() ?? null,
    oldestQueuedAgeMs,
    workerUnavailable,
    workerStalled,
    workerHealth: workerStalled
      ? "stalled"
      : workerUnavailable
        ? "unavailable"
        : pending.length
          ? "healthy"
          : "idle",
    lastMeaningfulProgressAt: lastProgress?.toISOString() ?? null,
    upstreamAcceptedCount: upstreamJobs.length,
    submissionState: upstreamJobs.length
      ? "upstream_running"
      : pending.some((job) => job.stage === "provider_polling")
        ? "upstream_accepted"
        : "not_submitted",
  };
}

function hasUnresolvedSelectableImageCandidate(project: VideoProjectRecord): boolean {
  const resolvedTargets = new Set(
    project.generationCandidates
      .filter((candidate) =>
        candidate.kind !== "segment_video"
        && candidate.selected
        && Boolean(candidate.mediaUrl)
      )
      .map((candidate) => candidate.targetId || candidate.artifactId),
  );
  return project.generationCandidates.some((candidate) => {
    if (
      candidate.kind === "segment_video"
      || !candidate.mediaUrl
      || candidate.selected
      || !["evaluated", "recommended", "review_ready"].includes(candidate.status)
    ) {
      return false;
    }
    return !resolvedTargets.has(candidate.targetId || candidate.artifactId);
  });
}

function deriveHumanWorkflowState(project: VideoProjectRecord): {
  state: "none" | "waiting_candidate_selection" | "waiting_asset_confirmation" | "waiting_boundary_confirmation";
  blocking: boolean;
  titleZh?: string;
  titleEn?: string;
} {
  if (project.status !== VideoProjectStatus.IMAGE_REVIEW) {
    return { state: "none", blocking: false };
  }
  const assets = project.keyframes.filter((keyframe) =>
    keyframe.keyframeNo < 0 && isEligibleConsistencyKeyframe(project.planJson, keyframe.keyframeNo)
  );
  const selectedAssetIds = new Set(
    project.generationCandidates
      .filter((candidate) => candidate.kind === "keyframe_image" && candidate.selected && Boolean(candidate.mediaUrl))
      .map((candidate) => candidate.targetId),
  );
  const assetsReadyForConfirmation = assets.length > 0
    && assets.every((keyframe) => Boolean(keyframe.imageUrl) || selectedAssetIds.has(keyframe.id))
    && assets.some((keyframe) => !keyframe.locked && keyframe.status !== VideoShotStatus.IMAGE_APPROVED);
  if (assetsReadyForConfirmation) {
    return {
      state: "waiting_asset_confirmation",
      blocking: true,
      titleZh: "等待确认资产",
      titleEn: "Waiting for asset confirmation",
    };
  }
  const hasUnselectedImageCandidate = hasUnresolvedSelectableImageCandidate(project);
  if (hasUnselectedImageCandidate) {
    return {
      state: "waiting_candidate_selection",
      blocking: true,
      titleZh: "等待采纳候选图",
      titleEn: "Waiting for candidate selection",
    };
  }
  const boundariesReady = project.keyframes.some((keyframe) =>
    keyframe.keyframeNo > 0
    && Boolean(keyframe.imageUrl)
    && !keyframe.locked
    && keyframe.status !== VideoShotStatus.IMAGE_APPROVED
  );
  return boundariesReady
    ? {
        state: "waiting_boundary_confirmation",
        blocking: true,
        titleZh: "等待确认边界关键帧",
        titleEn: "Waiting for boundary-frame confirmation",
      }
    : { state: "none", blocking: false };
}

const TASK_GRAPH_ESTIMATES_MS = {
  planning: 120_000,
  review: 5_000,
  image: 150_000,
  microImage: 120_000,
  video: 300_000,
  composition: 45_000,
} as const;

function buildProjectTaskGraph(
  project: VideoProjectRecord,
  plannerProgress?: VideoPlanningProgress,
) {
  const nowMs = Date.now();
  const nodes: ProjectTaskGraphNode[] = [];
  const projectStatusRank = taskGraphProjectStatusRank(project.status);
  const planningComplete =
    project.keyframes.length > 0 ||
    project.segments.length > 0 ||
    projectStatusRank >= taskGraphProjectStatusRank(VideoProjectStatus.PLAN_REVIEW);
  const planReviewComplete =
    projectStatusRank > taskGraphProjectStatusRank(VideoProjectStatus.PLAN_REVIEW)
    || project.keyframes.some((keyframe) => keyframe.status !== VideoShotStatus.SCRIPT_READY)
    || project.generationCandidates.some((candidate) => candidate.kind === "keyframe_image");
  const planningFailureMessage = project.errorMessage ?? plannerProgress?.detailZh ?? "";
  const planningJob = project.productionJobs.find((job) => job.kind === "planning");
  const planningModelReturnedBeforeFailure =
    plannerProgress?.status === "failed"
    && /Strict JSON Schema validation failed|Structured stage contract validation failed|Structured contract failure was unchanged|JSON (?:结构|Schema|schema)|contract_validation_error|模型.*返回/i.test(planningFailureMessage);
  nodes.push({
    id: "planning",
    type: "planning",
    targetId: project.id,
    labelZh: "剧本拆解与提示词规划",
    labelEn: "Storyboard and prompt planning",
    required: true,
    active: true,
    weight: TASK_GRAPH_ESTIMATES_MS.planning,
    status: planningComplete
      ? "completed"
      : planningJob?.status === "failed"
        ? "failed"
        : planningJob?.status === "queued"
          ? planningJob.errorCategory === "internal_capacity" ? "waiting_capacity" : "reserved"
          : planningJob?.status === "claimed" || planningJob?.status === "running"
            ? "running"
            : planningJob?.status === "waiting_upstream"
              ? "upstream_accepted"
            : "blocked",
    dependencyIds: [],
    upstreamAccepted: planningJob?.status === "waiting_upstream" || planningModelReturnedBeforeFailure,
    queuedAt: planningJob?.createdAt.toISOString() ?? project.createdAt.toISOString(),
    startedAt: planningJob?.startedAt?.toISOString() ?? plannerProgress?.startedAt,
    completedAt: planningComplete ? project.updatedAt.toISOString() : undefined,
    attempt: planningJob
      ? Math.max(1, planningJob.attempt + 1)
      : plannerProgress?.attempt ?? 1,
    retryReason: planningJob?.lastError
      ?? (plannerProgress?.status === "failed" ? project.errorMessage ?? plannerProgress.detailZh : undefined),
    correctionStrategy: plannerProgress?.stage.includes("repair") ? plannerProgress.detailZh : undefined,
    estimatedDurationMs: TASK_GRAPH_ESTIMATES_MS.planning,
    progressRatio: planningComplete
      ? 1
      : plannerProgress
        ? Math.min(0.95, plannerProgress.completedSteps / Math.max(1, plannerProgress.totalSteps))
        : 0,
  });

  nodes.push(taskGraphReviewNode({
    id: "review:plan",
    labelZh: "确认剧本与分镜计划",
    labelEn: "Approve storyboard plan",
    dependencyIds: ["planning"],
    completed: planReviewComplete,
    awaiting: project.status === VideoProjectStatus.PLAN_REVIEW,
  }));

  const latestCandidateByArtifact = new Map<string, VideoProjectRecord["generationCandidates"][number]>();
  const candidatesByArtifact = new Map<string, VideoProjectRecord["generationCandidates"]>();
  const latestJobByArtifact = new Map<string, VideoProjectRecord["productionJobs"][number]>();
  for (const candidate of project.generationCandidates) {
    candidatesByArtifact.set(candidate.artifactId, [
      ...(candidatesByArtifact.get(candidate.artifactId) ?? []),
      candidate,
    ]);
    if (!latestCandidateByArtifact.has(candidate.artifactId) && candidate.status !== "cancelled") {
      latestCandidateByArtifact.set(candidate.artifactId, candidate);
    }
  }
  for (const job of project.productionJobs) {
    if (job.artifactId && !latestJobByArtifact.has(job.artifactId)) {
      latestJobByArtifact.set(job.artifactId, job);
    }
  }
  const imageQualityJob = project.productionJobs.find((job) => job.kind === "image_quality");
  const assetNodeByAnchorId = new Map<string, string>();
  const activeArtifactIds = new Set<string>();
  const consistencyMap = readPlanConsistencyReferenceMap(project.planJson);
  const keyframeMap = readPlanKeyframeMap(project.planJson);
  const assetNodes: ProjectTaskGraphNode[] = [];
  const boundaryNodes: ProjectTaskGraphNode[] = [];

  for (const keyframe of project.keyframes) {
    if (!isEligibleConsistencyKeyframe(project.planJson, keyframe.keyframeNo)) continue;
    const artifactId = imageArtifactIdForKeyframeNo(keyframe.keyframeNo);
    activeArtifactIds.add(artifactId);
    const planTarget = keyframeMap.get(keyframe.keyframeNo) ?? consistencyMap.get(keyframe.keyframeNo);
    const isAsset = isConsistencyKeyframeNo(keyframe.keyframeNo);
    const anchorId = readPlanShotString(planTarget, ["anchorId", "anchor_id"]);
    const view = readPlanShotString(planTarget, ["assetView", "asset_view"]);
    const label = isAsset
      ? `${readPlanShotString(planTarget, ["displayNameZh", "display_name_zh"]) || keyframe.purpose || anchorId || "资产"}${view ? `（${view}）` : ""}`
      : `边界关键帧 KF${keyframe.keyframeNo}`;
    const labelEn = isAsset
      ? `${readPlanShotString(planTarget, ["displayNameEn", "display_name_en"]) || anchorId || "Asset"}${view ? ` (${view})` : ""}`
      : `Boundary keyframe KF${keyframe.keyframeNo}`;
    const candidate = latestCandidateByArtifact.get(artifactId);
    const attempts = candidatesByArtifact.get(artifactId) ?? [];
    const nodeId = `${isAsset ? "asset-image" : "boundary-image"}:${keyframe.id}`;
    if (anchorId && !assetNodeByAnchorId.has(anchorId)) assetNodeByAnchorId.set(anchorId, nodeId);
    const dependencyIds = isAsset
      ? ["review:plan"]
      : effectiveRequiredAnchorIds(planTarget)
          .map((requiredAnchorId) => assetNodeByAnchorId.get(requiredAnchorId))
          .filter((id): id is string => Boolean(id));
    const timing = taskGraphCandidateTiming(attempts, candidate, nowMs);
    const node = taskGraphGenerationNode({
      id: nodeId,
      type: isAsset ? "asset_image" : "boundary_image",
      targetId: keyframe.id,
      labelZh: label,
      labelEn,
      dependencyIds: dependencyIds.length ? dependencyIds : ["review:plan"],
      mediaReady: Boolean(keyframe.imageUrl),
      locked: keyframe.locked || keyframe.status === VideoShotStatus.IMAGE_APPROVED,
      upstreamTaskId: candidate?.taskId,
      candidate,
      job: candidate?.mediaUrl
        && imageQualityJob
        && ACTIVE_VIDEO_PRODUCTION_JOB_STATUSES.includes(
          imageQualityJob.status as (typeof ACTIVE_VIDEO_PRODUCTION_JOB_STATUSES)[number],
        )
        ? imageQualityJob
        : latestJobByArtifact.get(artifactId),
      attempts,
      estimateMs: taskGraphObservedEstimateMs(attempts, TASK_GRAPH_ESTIMATES_MS.image),
      timing,
    });
    (isAsset ? assetNodes : boundaryNodes).push(node);
  }
  nodes.push(...assetNodes);

  const assetNodeIds = assetNodes.map((node) => node.id);
  const reviewableAssetKeyframes = project.keyframes
    .filter((keyframe) => isConsistencyKeyframeNo(keyframe.keyframeNo) && isEligibleConsistencyKeyframe(project.planJson, keyframe.keyframeNo));
  const assetsApproved = reviewableAssetKeyframes.length > 0
    && reviewableAssetKeyframes.every((keyframe) =>
      Boolean(keyframe.imageUrl)
      && (keyframe.locked || keyframe.status === VideoShotStatus.IMAGE_APPROVED)
    );
  nodes.push(taskGraphReviewNode({
    id: "review:assets",
    labelZh: "确认资产一致性图库",
    labelEn: "Approve consistency asset library",
    dependencyIds: assetNodeIds.length ? assetNodeIds : ["review:plan"],
    completed: assetsApproved || projectStatusRank > taskGraphProjectStatusRank(VideoProjectStatus.IMAGE_REVIEW),
    awaiting: project.status === VideoProjectStatus.IMAGE_REVIEW
      && assetNodes.length > 0
      && assetNodes.every((node) => node.status === "completed"),
  }));
  // Boundary dependencies are resolved after every asset node is known, so a
  // boundary can start from its own approved subset instead of all assets.
  for (const node of boundaryNodes) {
    const keyframe = project.keyframes.find((item) => node.targetId === item.id);
    const planTarget = keyframe
      ? keyframeMap.get(keyframe.keyframeNo) ?? consistencyMap.get(keyframe.keyframeNo)
      : undefined;
    const scopedDependencies = effectiveRequiredAnchorIds(planTarget)
      .map((anchorId) => assetNodeByAnchorId.get(anchorId))
      .filter((id): id is string => Boolean(id));
    node.dependencyIds = scopedDependencies.length ? scopedDependencies : ["review:assets"];
  }
  nodes.push(...boundaryNodes);

  const reviewableBoundaryKeyframes = project.keyframes
    .filter((keyframe) => !isConsistencyKeyframeNo(keyframe.keyframeNo));
  const boundaryApproved = reviewableBoundaryKeyframes.length > 0
    && reviewableBoundaryKeyframes.every((keyframe) =>
      Boolean(keyframe.imageUrl)
      && (keyframe.locked || keyframe.status === VideoShotStatus.IMAGE_APPROVED)
    );
  nodes.push(taskGraphReviewNode({
    id: "review:boundaries",
    labelZh: "确认边界关键帧",
    labelEn: "Approve boundary keyframes",
    dependencyIds: boundaryNodes.length
      ? boundaryNodes.map((node) => node.id)
      : ["review:assets"],
    // Approval is an artifact fact, not a projection-status fact. Active
    // micro-shot jobs temporarily project the project as IMAGE_GENERATING;
    // tying this gate to that derived status re-opened an already approved
    // boundary review as soon as the last micro-shot job completed.
    completed: boundaryApproved,
    awaiting: project.status === VideoProjectStatus.IMAGE_REVIEW
      && boundaryNodes.length > 0
      && boundaryNodes.every((node) => node.status === "completed"),
  }));

  const microNodes: ProjectTaskGraphNode[] = [];
  for (const segment of project.segments) {
    for (const microShot of readEffectivePlanMicroShots(project.planJson, segment.segmentNo)) {
      if (microShot.referenceType !== "image_prompt" && microShot.referenceType !== "mixed") continue;
      const artifactId = imageArtifactIdForMicroShot(segment.segmentNo, microShot.microShotNo);
      activeArtifactIds.add(artifactId);
      const attempts = candidatesByArtifact.get(artifactId) ?? [];
      const candidate = latestCandidateByArtifact.get(artifactId);
      const mediaReady = Boolean(microShot.imageUrl);
      microNodes.push(taskGraphGenerationNode({
        id: `micro-image:${segment.id}:${microShot.microShotNo}`,
        type: "micro_shot_image",
        targetId: `${segment.id}:${microShot.microShotNo}`,
        labelZh: `片段 ${segment.segmentNo} 子分镜 ${microShot.microShotNo} 参考图`,
        labelEn: `Segment ${segment.segmentNo} micro-shot ${microShot.microShotNo} image`,
        dependencyIds: ["review:boundaries"],
        mediaReady,
        locked: mediaReady && microShot.imageStatus !== "failed",
        upstreamTaskId: candidate?.taskId,
        candidate,
        job: candidate?.mediaUrl
          && imageQualityJob
          && ACTIVE_VIDEO_PRODUCTION_JOB_STATUSES.includes(
            imageQualityJob.status as (typeof ACTIVE_VIDEO_PRODUCTION_JOB_STATUSES)[number],
          )
          ? imageQualityJob
          : latestJobByArtifact.get(artifactId),
        attempts,
        estimateMs: taskGraphObservedEstimateMs(attempts, TASK_GRAPH_ESTIMATES_MS.microImage),
        timing: taskGraphCandidateTiming(attempts, candidate, nowMs),
      }));
    }
  }
  nodes.push(...microNodes);
  const microReviewCompleted = project.segments.length > 0
    && project.segments.every((segment) =>
      segment.locked
      || segment.status === VideoShotStatus.CLIP_PENDING
      || segment.status === VideoShotStatus.CLIP_RUNNING
      || segment.status === VideoShotStatus.CLIP_READY
      || segment.status === VideoShotStatus.CLIP_APPROVED
    );
  nodes.push(taskGraphReviewNode({
    id: "review:micro-shots",
    labelZh: "确认内部子分镜",
    labelEn: "Approve internal micro-shots",
    dependencyIds: microNodes.length ? microNodes.map((node) => node.id) : ["review:boundaries"],
    completed: microReviewCompleted,
    awaiting: !microReviewCompleted
      && project.segments.length > 0
      && boundaryApproved
      && microNodes.every((node) => node.status === "completed"),
  }));

  const segmentNodes: ProjectTaskGraphNode[] = [];
  for (const segment of project.segments) {
    const artifactId = videoArtifactIdForSegmentNo(segment.segmentNo);
    activeArtifactIds.add(artifactId);
    const attempts = candidatesByArtifact.get(artifactId) ?? [];
    const candidate = latestCandidateByArtifact.get(artifactId);
    segmentNodes.push(taskGraphGenerationNode({
      id: `segment-video:${segment.id}`,
      type: "segment_video",
      targetId: segment.id,
      labelZh: `视频片段 ${segment.segmentNo}`,
      labelEn: `Video segment ${segment.segmentNo}`,
      dependencyIds: ["review:micro-shots"],
      // A provider-complete video candidate is finished generation work even
      // before the user chooses it. Treat it as complete so the graph opens
      // the clip review gate instead of inventing an orphaned-work invariant.
      mediaReady: Boolean(
        segment.clipUrl
        || (
          candidate?.mediaUrl
          && ["review_ready", "recommended", "selected"].includes(candidate.status)
        )
      ),
      locked: Boolean(segment.clipUrl),
      upstreamTaskId: candidate?.taskId,
      candidate,
      job: latestJobByArtifact.get(artifactId),
      attempts,
      estimateMs: taskGraphObservedEstimateMs(attempts, TASK_GRAPH_ESTIMATES_MS.video),
      timing: taskGraphCandidateTiming(attempts, candidate, nowMs),
    }));
  }
  nodes.push(...segmentNodes);
  const clipsApproved = project.segments.length > 0
    && project.segments.every((segment) =>
      Boolean(segment.clipUrl)
      // `locked` protects the generation inputs as soon as clip submission
      // starts. It is not evidence of user approval.
      && segment.status === VideoShotStatus.CLIP_APPROVED
    );
  nodes.push(taskGraphReviewNode({
    id: "review:clips",
    labelZh: "确认全部视频片段",
    labelEn: "Approve all video segments",
    dependencyIds: segmentNodes.length
      ? segmentNodes.map((node) => node.id)
      : ["review:micro-shots"],
    completed: clipsApproved,
    awaiting: !clipsApproved
      && segmentNodes.length > 0
      && segmentNodes.every((node) => node.status === "completed"),
  }));

  const compositionComplete = Boolean(project.finalVideoUrl)
    || project.status === VideoProjectStatus.FINAL_REVIEW
    || project.status === VideoProjectStatus.DONE;
  const composeJob = project.productionJobs.find((job) => job.kind === "compose");
  nodes.push({
    id: "composition",
    type: "composition",
    targetId: project.id,
    labelZh: "合成最终成片",
    labelEn: "Compose final video",
    required: true,
    active: true,
    weight: TASK_GRAPH_ESTIMATES_MS.composition,
    status: compositionComplete
      ? "completed"
      : composeJob?.status === "failed"
        ? "failed"
        : composeJob?.status === "claimed" || composeJob?.status === "running"
          ? "running"
          : composeJob?.status === "waiting_upstream"
            ? "upstream_accepted"
          : composeJob?.status === "queued"
            ? composeJob.errorCategory === "internal_capacity" ? "waiting_capacity" : "reserved"
        : project.status === VideoProjectStatus.FAILED && !isManuallyStopped(project)
          ? "failed"
          : "blocked",
    dependencyIds: ["review:clips"],
    upstreamAccepted: composeJob?.status === "waiting_upstream",
    upstreamTaskId: composeJob?.id,
    queuedAt: composeJob?.createdAt.toISOString() ?? project.updatedAt.toISOString(),
    startedAt: composeJob?.startedAt?.toISOString(),
    completedAt: compositionComplete ? project.updatedAt.toISOString() : undefined,
    attempt: composeJob?.attempt ?? 0,
    retryReason: composeJob?.lastError
      ?? (project.status === VideoProjectStatus.FAILED ? project.errorMessage ?? undefined : undefined),
    correctionStrategy: project.status === VideoProjectStatus.FAILED ? "检查合成输入、转场和音轨后重新合成" : undefined,
    estimatedDurationMs: TASK_GRAPH_ESTIMATES_MS.composition,
  });
  nodes.push(taskGraphReviewNode({
    id: "review:final",
    labelZh: "确认最终成片",
    labelEn: "Approve final video",
    dependencyIds: ["composition"],
    completed: project.status === VideoProjectStatus.DONE,
    awaiting: project.status === VideoProjectStatus.FINAL_REVIEW,
  }));

  // Keep cancelled work visible for audit, but inactive nodes never inflate the
  // current denominator or the remaining critical path.
  for (const candidate of project.generationCandidates) {
    if (candidate.status !== "cancelled" || activeArtifactIds.has(candidate.artifactId)) continue;
    nodes.push({
      id: `cancelled:${candidate.id}`,
      type: candidate.kind === "segment_video"
        ? "segment_video"
        : candidate.kind === "micro_shot_image"
          ? "micro_shot_image"
          : "boundary_image",
      targetId: candidate.targetId,
      labelZh: `已取消任务 ${candidate.artifactId}`,
      labelEn: `Cancelled task ${candidate.artifactId}`,
      required: false,
      active: false,
      weight: candidate.kind === "segment_video" ? TASK_GRAPH_ESTIMATES_MS.video : TASK_GRAPH_ESTIMATES_MS.image,
      status: "cancelled",
      dependencyIds: [],
      upstreamAccepted: false,
      queuedAt: candidate.createdAt.toISOString(),
      completedAt: candidate.updatedAt.toISOString(),
      attempt: Math.max(1, Number(candidateMetadata(candidate.metadata).attempt) || candidate.candidateNo),
      retryReason: candidate.errorMessage ?? "Cancelled after the active plan changed.",
      correctionStrategy: "该任务已从当前计划分母和关键路径中移除。",
      estimatedDurationMs: candidate.kind === "segment_video" ? TASK_GRAPH_ESTIMATES_MS.video : TASK_GRAPH_ESTIMATES_MS.image,
    });
  }

  const durationSampleCount = project.generationCandidates.filter((candidate) =>
    Boolean(candidate.mediaUrl) && candidate.updatedAt.getTime() > candidate.createdAt.getTime()
  ).length;
  return computeProjectTaskGraphSnapshot(nodes, { nowMs, durationSampleCount });
}

function taskGraphReviewNode(params: {
  id: string;
  labelZh: string;
  labelEn: string;
  dependencyIds: string[];
  completed: boolean;
  awaiting: boolean;
}): ProjectTaskGraphNode {
  return {
    id: params.id,
    type: "review_gate",
    targetId: params.id,
    labelZh: params.labelZh,
    labelEn: params.labelEn,
    required: true,
    active: true,
    weight: TASK_GRAPH_ESTIMATES_MS.review,
    status: params.completed ? "completed" : params.awaiting ? "awaiting_review" : "blocked",
    dependencyIds: params.dependencyIds,
    upstreamAccepted: false,
    attempt: 0,
    correctionStrategy: params.awaiting ? "等待用户确认后继续关键路径。" : undefined,
    estimatedDurationMs: TASK_GRAPH_ESTIMATES_MS.review,
  };
}

function taskGraphGenerationNode(params: {
  id: string;
  type: "asset_image" | "boundary_image" | "micro_shot_image" | "segment_video";
  targetId: string;
  labelZh: string;
  labelEn: string;
  dependencyIds: string[];
  mediaReady: boolean;
  locked: boolean;
  upstreamTaskId?: string | null;
  candidate?: VideoProjectRecord["generationCandidates"][number];
  job?: VideoProjectRecord["productionJobs"][number];
  attempts: VideoProjectRecord["generationCandidates"];
  estimateMs: number;
  timing: { queuedAt?: string; startedAt?: string; completedAt?: string };
}): ProjectTaskGraphNode {
  const job = params.job;
  const providerAccepted = job?.status === "waiting_upstream";
  let status: ProjectTaskStatus;
  if (params.mediaReady) status = "completed";
  else if (job?.status === "failed") status = "failed";
  else if (job?.status === "waiting_review") status = "awaiting_review";
  else if (
    job?.stage === "quality_evaluation"
    && (job.status === "claimed" || job.status === "running")
  ) status = "quality_checking";
  else if (job?.status === "waiting_upstream") status = "upstream_accepted";
  else if (job?.status === "claimed" || job?.status === "running") status = "running";
  else if (job?.status === "queued") {
    status = job.errorCategory === "internal_capacity"
      ? "waiting_capacity"
      : job.attempt > 0
        || job.infrastructureAttempt > 0
        || job.recoveryAction === "AUTO_RETRY_INFRASTRUCTURE"
        ? "retrying"
        : "reserved";
  } else status = "blocked";
  const latestReport = params.candidate?.qualityReport && isRecord(params.candidate.qualityReport)
    ? params.candidate.qualityReport
    : {};
  const metadata = candidateMetadata(params.candidate?.metadata ?? null);
  const repairMode = firstNonEmptyString([
    metadata.repairMode,
    isRecord(latestReport.repairDecision) ? latestReport.repairDecision.mode : undefined,
  ]);
  const retryReason = job?.lastError
    || params.candidate?.errorMessage
    || params.candidate?.retryInstruction
    || (typeof latestReport.retryInstruction === "string" ? latestReport.retryInstruction : undefined)
    || undefined;
  return {
    id: params.id,
    type: params.type,
    targetId: params.targetId,
    labelZh: params.labelZh,
    labelEn: params.labelEn,
    required: true,
    active: true,
    weight: params.estimateMs,
    status,
    dependencyIds: params.dependencyIds,
    upstreamAccepted: providerAccepted,
    upstreamTaskId: providerAccepted ? params.upstreamTaskId ?? undefined : undefined,
    ...params.timing,
    attempt: Math.max(
      params.attempts.length ? 1 : 0,
      ...params.attempts.map((item) => Math.max(1, Number(candidateMetadata(item.metadata).attempt) || item.candidateNo)),
      job?.attempt ?? 0,
    ),
    retryReason,
    correctionStrategy: repairMode
      ? `按 ${repairMode} 策略执行下一轮纠正。`
      : retryReason
        ? params.type === "segment_video" ? "根据失败原因修正视频提示词或连续性合同后重试。" : "根据质检修正指令重新生成当前图片。"
        : undefined,
    estimatedDurationMs: params.estimateMs,
  };
}

function taskGraphCandidateTiming(
  attempts: VideoProjectRecord["generationCandidates"],
  candidate: VideoProjectRecord["generationCandidates"][number] | undefined,
  nowMs: number,
): { queuedAt?: string; startedAt?: string; completedAt?: string } {
  const oldest = [...attempts].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  const completed = candidate && (
    candidate.status === "selected"
    || candidate.status === "evaluated"
    || candidate.status === "review_ready"
    || candidate.status === "recommended"
  );
  return {
    queuedAt: oldest?.createdAt.toISOString(),
    startedAt: candidate?.taskId
      ? candidate.createdAt.toISOString()
      : undefined,
    completedAt: completed ? candidate.updatedAt.toISOString() : undefined,
  };
}

function taskGraphObservedEstimateMs(
  attempts: VideoProjectRecord["generationCandidates"],
  fallback: number,
): number {
  const samples = attempts
    .filter((candidate) => Boolean(candidate.mediaUrl))
    .map((candidate) => candidate.updatedAt.getTime() - candidate.createdAt.getTime())
    .filter((duration) => Number.isFinite(duration) && duration >= 5_000 && duration <= 60 * 60_000)
    .sort((a, b) => a - b);
  if (!samples.length) return fallback;
  const median = samples[Math.floor(samples.length / 2)];
  return Math.max(Math.round(fallback * 0.5), Math.min(Math.round(fallback * 2), median));
}

function taskGraphProjectStatusRank(status: VideoProjectStatus): number {
  const order: VideoProjectStatus[] = [
    VideoProjectStatus.DRAFT,
    VideoProjectStatus.PLANNING,
    VideoProjectStatus.PLAN_REVIEW,
    VideoProjectStatus.IMAGE_GENERATING,
    VideoProjectStatus.IMAGE_REVIEW,
    VideoProjectStatus.MICRO_SHOT_REVIEW,
    VideoProjectStatus.CLIP_GENERATING,
    VideoProjectStatus.CLIP_REVIEW,
    VideoProjectStatus.COMPOSING,
    VideoProjectStatus.FINAL_REVIEW,
    VideoProjectStatus.DONE,
  ];
  const index = order.indexOf(status);
  return index >= 0 ? index : -1;
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
      storyContractRepairCount: Math.max(0, planningNumber(metrics.storyContractRepairCount)),
      storyContractRepairDurationMs: Math.max(0, planningNumber(metrics.storyContractRepairDurationMs)),
    },
  };
}

function planningNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function serializeVideoSegmentProjection(
  segment: VideoProjectRecord["segments"][number],
  keyframeMap: Map<number, VideoProjectRecord["keyframes"][number]>,
  planSegments: Map<number, Record<string, unknown>>,
  selectedMicroShotCandidates: Map<string, VideoProjectRecord["generationCandidates"][number]>,
  planJson: Prisma.JsonValue | null,
) {
  const start = keyframeMap.get(segment.startKeyframeNo);
  const end = keyframeMap.get(segment.endKeyframeNo);
  const planSegment = planSegments.get(segment.segmentNo);
  return {
    id: segment.id,
    segmentNo: segment.segmentNo,
    status: segment.status,
    durationSeconds: segment.durationSeconds,
    purpose: segment.purpose,
    purposeZh: readPlanShotString(planSegment, ["purposeZh", "purpose_zh"]) || segment.purpose,
    purposeEn: readPlanShotString(planSegment, ["purposeEn", "purpose_en"]) || titleFromPrompt(readPlanShotString(planSegment, ["videoPromptEn", "video_prompt_en"]) || segment.videoPrompt, `Segment ${segment.segmentNo}`),
    camera: segment.camera,
    action: segment.motion,
    imagePrompt: start?.imagePrompt ?? "",
    imagePromptZh: readPlanShotString(planSegment, ["imagePromptZh", "image_prompt_zh"]),
    imagePromptEn: readPlanShotString(planSegment, ["imagePromptEn", "image_prompt_en"]) || start?.imagePrompt || "",
    videoPrompt: segment.videoPrompt,
    videoPromptZh: readPlanShotString(planSegment, ["videoPromptZh", "video_prompt_zh"]) || segment.videoPrompt,
    videoPromptEn: readPlanShotString(planSegment, ["videoPromptEn", "video_prompt_en"]) || segment.videoPrompt,
    boundaryMode: readPlanBoundaryMode(planSegment),
    outputMode: readPlanShotString(planSegment, ["outputMode", "output_mode"]),
    constraints: readPlanStringArray(planSegment, ["constraints"]),
    timedPrompts: readPlanTimedPrompts(planSegment),
    microShots: readEffectivePlanMicroShots(planJson, segment.segmentNo).map((microShot) => {
      const selected = selectedMicroShotCandidates.get(imageArtifactIdForMicroShot(segment.segmentNo, microShot.microShotNo));
      const {
        imageStatus: _legacyImageStatus,
        ...publicMicroShot
      } = microShot;
      return selected?.mediaUrl && selectedCandidateMatchesMicroShotRevision(selected, microShot)
        ? { ...publicMicroShot, imageUrl: selected.mediaUrl, errorMessage: "" }
        : publicMicroShot;
    }),
    audioPlan: readPlanAudioPlan(planSegment),
    negativePrompt: segment.negativePrompt,
    negativePromptZh: readPlanShotString(planSegment, ["negativePromptZh", "negative_prompt_zh"]) || toChineseNegativePrompt(segment.negativePrompt),
    negativePromptEn: readPlanShotString(planSegment, ["negativePromptEn", "negative_prompt_en"]) || segment.negativePrompt,
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
  const plannerCheckpoint = isRecord(plan.plannerCheckpoint)
    ? plan.plannerCheckpoint
    : {};
  const routeClassification = isRecord(plannerCheckpoint.routeClassification)
    ? plannerCheckpoint.routeClassification
    : {};
  const approvedRouteContract = isRecord(routeClassification.routeContract)
    ? routeClassification.routeContract
    : isRecord(plan.approvedRouteContract)
      ? plan.approvedRouteContract
      : {};
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
    approvedRouteContract,
    routeClassification: {
      authority: routeClassification.authority === "user" ? "user" : "model",
      locked: routeClassification.locked === true,
      status: routeClassification.status ?? null,
      routeContract: approvedRouteContract,
      modelName: routeClassification.modelName ?? approvedRouteContract.modelName ?? null,
      modelDurationMs: routeClassification.modelDurationMs ?? null,
      inputTokens: routeClassification.inputTokens ?? null,
      outputTokens: routeClassification.outputTokens ?? null,
      gateResult: isRecord(routeClassification.gateResult)
        ? routeClassification.gateResult
        : null,
      repairCount: routeClassification.repairCount ?? 0,
      fallbackInfo: isRecord(routeClassification.fallbackInfo)
        ? routeClassification.fallbackInfo
        : null,
    },
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
    storySemanticReview: isRecord(plan.storySemanticReview)
      ? plan.storySemanticReview
      : isRecord(plan.story_semantic_review)
        ? plan.story_semantic_review
        : {},
    consistencyAnchors: isRecord(consistencyManifest) && Array.isArray(consistencyManifest.anchors)
      ? consistencyManifest.anchors.flatMap((anchor) =>
          isRecord(anchor) ? [normalizePlanAnchorRecord(anchor)] : []
        )
      : [],
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
    sceneContracts: Array.isArray(plan.sceneContracts)
      ? plan.sceneContracts
      : Array.isArray(plan.scene_contracts)
        ? plan.scene_contracts
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
  assertPlanValidForGenerationV2(...args);
}

function imageCandidateCount(): number {
  // Images are progressive too; environment configuration must not silently
  // restore eager multi-candidate spending.
  return 1;
}

function visualContractDesignConflicts(planJson: Prisma.JsonValue | null): string[] {
  const sanitizedPlan = sanitizePlanSoftAnchorVisibility(planJson).plan;
  return validateOnePromptVideoPlan(sanitizedPlan, { stage: "keyframe_generation" })
    .filter((issue) =>
      issue.code === "PALETTE_MOOD_MISCLASSIFIED_AS_SCENE"
      || issue.code === "SCENE_ANCHOR_GEOMETRY_MISSING"
      || issue.code === "SOFT_STYLE_ANCHOR_MARKED_VISIBLE"
    )
    .map((issue) => `upstream_design_contract:${issue.code}:${issue.messageZh}`);
}

function selectedCandidateMatchesMicroShotRevision(
  candidate: VideoProjectRecord["generationCandidates"][number],
  microShot: VideoMicroShot,
): boolean {
  const metadata = isRecord(candidate.metadata) ? candidate.metadata : {};
  const targetContract = isRecord(metadata.targetContract)
    ? metadata.targetContract
    : isRecord(metadata.target_contract)
      ? metadata.target_contract
      : {};
  const candidateRevision = readPlanShotString(targetContract, [
    "resolvedRevisionId",
    "resolved_revision_id",
  ]);
  return microShot.resolvedRevisionId
    ? candidateRevision === microShot.resolvedRevisionId
    : !candidateRevision;
}

export function generationCandidateMatchesActivePlanningRevision(
  planJson: unknown,
  candidate: { kind: string; metadata: unknown },
): boolean {
  if (candidate.kind !== "micro_shot_image") return true;
  const metadata = isRecord(candidate.metadata) ? candidate.metadata : {};
  const segmentNo = Number(metadata.segmentNo);
  const microShotNo = Number(metadata.microShotNo);
  if (!Number.isInteger(segmentNo) || segmentNo <= 0 || !Number.isInteger(microShotNo) || microShotNo <= 0) {
    return false;
  }
  const activeMicroShot = readEffectivePlanMicroShots(
    planJson as Prisma.JsonValue | null | undefined,
    segmentNo,
  ).find((item) => item.microShotNo === microShotNo);
  return Boolean(activeMicroShot && selectedCandidateMatchesMicroShotRevision(
    candidate as VideoProjectRecord["generationCandidates"][number],
    activeMicroShot,
  ));
}

function videoCandidateCount(): number {
  // Video candidates are intentionally progressive: submit one paid render,
  // expose it for review, and create another only after a meaningful input
  // change and an explicit retry.
  return 1;
}

function generationMaxRetries(kind?: CandidateKind): number {
  if (kind === "keyframe_image" || kind === "micro_shot_image") {
    // Image iteration is comparatively cheap and benefits from preserving a
    // candidate history. Do not force a human decision after only three images.
    return Math.max(0, Math.min(8, envInt("ONE_PROMPT_IMAGE_GENERATION_MAX_RETRIES", 5)));
  }
  return Math.max(0, Math.min(4, envInt("ONE_PROMPT_GENERATION_MAX_RETRIES", 2)));
}

const QUALITY_EVALUATION_LEASE_MS = 5 * 60 * 1000;
const UPSTREAM_GENERATION_POLL_DELAY_MS = 3_000;

function qualityEvaluationsPerSync(): number {
  const value = Number(process.env.ONE_PROMPT_GENERATION_QUALITY_EVALUATIONS_PER_SYNC);
  return Number.isFinite(value) && value >= 1 ? Math.min(4, Math.round(value)) : 4;
}

function qualityEvaluationConcurrency(): number {
  const value = Number(process.env.ONE_PROMPT_GENERATION_QUALITY_CONCURRENCY);
  return Number.isFinite(value) && value >= 1 ? Math.min(4, Math.round(value)) : 4;
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

function generationCandidateLogContext(params: {
  projectId: string;
  artifactId: string;
  kind: string;
  candidateNo: number;
  candidateCount?: number;
  attempt?: number;
  metadata: Record<string, unknown>;
}): Record<string, unknown> {
  const targetContract = isRecord(params.metadata.targetContract) ? params.metadata.targetContract : {};
  const keyframeNo = finiteNumber(params.metadata.keyframeNo);
  const moduleNameZh = params.kind === "segment_video"
    ? "视频片段生成"
    : params.kind === "micro_shot_image"
      ? "子分镜参考图生成"
      : keyframeNo !== undefined && keyframeNo < 0
        ? "一致性资产图片生成"
        : "关键帧图片生成";
  const assetLabel = firstNonEmptyString([
    params.metadata.assetNameZh,
    params.metadata.assetName,
    params.metadata.displayNameZh,
    targetContract.assetNameZh,
    targetContract.assetName,
    targetContract.displayNameZh,
    targetContract.displayName,
    targetContract.purposeZh,
    targetContract.purpose,
    targetContract.targetAnchorId,
    targetContract.anchorId,
  ]);
  return {
    projectId: params.projectId,
    artifactId: params.artifactId,
    generationKind: params.kind,
    moduleNameZh,
    candidateNo: params.candidateNo,
    candidateCount: params.candidateCount,
    attempt: params.attempt,
    assetLabel: assetLabel || undefined,
    assetCategory: firstNonEmptyString([
      params.metadata.assetCategory,
      targetContract.assetCategory,
      targetContract.kind,
    ]) || undefined,
    assetView: firstNonEmptyString([
      params.metadata.assetView,
      targetContract.assetView,
      targetContract.view,
    ]) || undefined,
    keyframeNo,
    segmentNo: finiteNumber(params.metadata.segmentNo),
    microShotNo: finiteNumber(params.metadata.microShotNo),
  };
}

function firstNonEmptyString(values: unknown[]): string {
  return values.find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim() ?? "";
}

function finiteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function assetLogLabelForKeyframe(
  project: VideoProjectRecord,
  keyframe: VideoProjectRecord["keyframes"][number],
): string {
  const target = readPlanKeyframeMap(project.planJson).get(keyframe.keyframeNo)
    ?? readPlanConsistencyReferenceMap(project.planJson).get(keyframe.keyframeNo);
  const name = readPlanShotString(target, [
    "displayNameZh",
    "display_name_zh",
    "purposeZh",
    "purpose_zh",
    "purpose",
  ]) || keyframe.purpose || `关键帧 ${keyframe.keyframeNo}`;
  const view = readPlanShotString(target, ["assetView", "asset_view", "view"]);
  const viewLabel = view === "front" ? "正面图" : view === "side" ? "侧面图" : view === "back" ? "背面图" : "";
  return `${name}${viewLabel && !name.includes(viewLabel.slice(0, 2)) ? `（${viewLabel}）` : ""}`;
}

const ACTIVE_GENERATION_CANDIDATE_STATUSES = new Set([
  "pending",
  "running",
  "succeeded",
  "review_ready",
  "evaluating",
  "quality_retry",
]);

async function existingGenerationInput(params: {
  projectId: string;
  artifactId: string;
  generationInputFingerprint: string;
}): Promise<{ taskId: string | null; active: boolean; paidResultExists: boolean } | undefined> {
  const candidates = await prisma.videoGenerationCandidate.findMany({
    where: {
      projectId: params.projectId,
      artifactId: params.artifactId,
    },
    select: {
      taskId: true,
      mediaUrl: true,
      status: true,
      metadata: true,
    },
    orderBy: { createdAt: "desc" },
  });
  for (const candidate of candidates) {
    const metadata = candidateMetadata(candidate.metadata);
    if (metadata.generationInputFingerprint !== params.generationInputFingerprint) continue;
    const active = ACTIVE_GENERATION_CANDIDATE_STATUSES.has(candidate.status);
    // A transport/decoding failure is not a usable paid draw. It may retry the
    // same semantic request without weakening the content-duplicate guard.
    const paidResultExists = candidate.status !== "failed" && (
      Boolean(candidate.mediaUrl)
      || ["evaluated", "selected", "recommended"].includes(candidate.status)
    );
    if (active || paidResultExists) {
      return { taskId: candidate.taskId, active, paidResultExists };
    }
  }
  return undefined;
}

async function guardProgressiveCandidateSubmission(params: {
  projectId: string;
  artifactId: string;
  generationInputFingerprint: string;
}): Promise<string | undefined> {
  const existing = await existingGenerationInput(params);
  if (!existing) return undefined;
  if (existing.active && existing.taskId) {
    await logOnePromptVideo("generation_candidate.submit.reused_active", params);
    return existing.taskId;
  }
  throw new Error(
    "生成输入没有发生实质变化。请先修改 Prompt、参考图或生成参数，再生成下一候选。",
  );
}

async function createImageCandidateBatch(params: {
  project: VideoProjectRecord;
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
  const generationInputFingerprint = buildGenerationInputFingerprint({
    kind: params.kind,
    prompt: params.prompt,
    negativePrompt: params.negativePrompt,
    referenceImageUrls: params.referenceImageUrls,
    parameters: {
      model: "aliyun-image",
      aspectRatio: params.project.aspectRatio,
    },
  });
  const reusedTaskId = await guardProgressiveCandidateSubmission({
    projectId: params.project.id,
    artifactId: params.artifactId,
    generationInputFingerprint,
  });
  if (reusedTaskId) return reusedTaskId;
  const batchId = randomUUID();
  const requestedRetryCycleId = typeof params.metadata.retryCycleId === "string" ? params.metadata.retryCycleId : undefined;
  const { attempt, retryCycleId } = nextGenerationCandidateAttempt(params.project.generationCandidates, params.artifactId, requestedRetryCycleId);
  const historicalCandidateCount = await prisma.videoGenerationCandidate.count({
    where: { projectId: params.project.id, artifactId: params.artifactId },
  });
  const candidateCount = imageCandidateCount();
  const referenceUsageNotes = Array.isArray(params.metadata.referenceUsageNotes)
    ? params.metadata.referenceUsageNotes.filter((item): item is string => typeof item === "string")
    : [];
  const hardPersonReferenceRequired = referenceUsageNotes.some((note) =>
    /HARD IDENTITY \+ HARD RENDERING STYLE/i.test(note)
  );
  if (hardPersonReferenceRequired && !params.referenceImageUrls.some((url) => Boolean(url?.trim()))) {
    throw new Error("人物资产生成已停止：强身份与强渲染风格参考图缺失，禁止降级为纯文字生成。");
  }
  const referencePolicy: "none" | "optional" | "required" = hardPersonReferenceRequired
    ? "required"
    : params.referenceImageUrls.some((url) => Boolean(url?.trim()))
      ? "optional"
      : "none";
  let firstTaskId = "";
  const previousRejectedCandidate = params.project.generationCandidates
    .filter((candidate) =>
      candidate.artifactId === params.artifactId
      && candidate.passed === false
      && candidate.qualityReport
    )
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  const repairTimingMetadata = previousRejectedCandidate
    ? {
        repairOriginCandidateId: previousRejectedCandidate.id,
        repairOriginQualityCompletedAt: previousRejectedCandidate.updatedAt.toISOString(),
      }
    : {};
  if (attempt > 1 && previousRejectedCandidate) {
    const repairDecision = isRecord(previousRejectedCandidate.qualityReport)
      && isRecord(previousRejectedCandidate.qualityReport.repairDecision)
      ? previousRejectedCandidate.qualityReport.repairDecision
      : {};
    await logOnePromptVideo("production.step.completed", {
      ...generationCandidateLogContext({
        projectId: params.project.id,
        artifactId: params.artifactId,
        kind: params.kind,
        candidateNo: historicalCandidateCount + 1,
        candidateCount: historicalCandidateCount + candidateCount,
        attempt,
        metadata: params.metadata,
      }),
      stepNameZh: "质检打回后等待返修任务重新提交",
      executionMethod: "program",
      durationMs: Math.max(0, Date.now() - previousRejectedCandidate.updatedAt.getTime()),
      waitingAfterQcMs: Math.max(0, Date.now() - previousRejectedCandidate.updatedAt.getTime()),
      repairMode: firstNonEmptyString([params.metadata.repairMode, repairDecision.mode]),
      resultZh: "开始提交新一轮候选图",
    });
  }
  let cachedSubmittedPromptReport: Awaited<ReturnType<typeof prepareAliyunImagePromptForSubmission>> | undefined;
  let promptPreparationDurationMs = 0;
  for (let localCandidateNo = 1; localCandidateNo <= candidateCount; localCandidateNo += 1) {
    const candidateNo = historicalCandidateCount + localCandidateNo;
    const finalPromptStartedAtMs = Date.now();
    if (!cachedSubmittedPromptReport) {
      cachedSubmittedPromptReport = await prepareAliyunImagePromptForSubmission(
        params.prompt,
        params.negativePrompt,
        params.referenceImageUrls,
        referenceUsageNotes,
        { userId: params.project.userId, projectId: params.project.id },
      );
      promptPreparationDurationMs = Date.now() - finalPromptStartedAtMs;
    }
    const submittedPromptReport = cachedSubmittedPromptReport;
    const { prompt: submittedPrompt, ...submittedPromptMetrics } = submittedPromptReport;
    const executionContract = createCanonicalExecutionContractV2({
      targetId: params.targetId,
      artifactId: params.artifactId,
      revision: candidateNo,
      prompt: submittedPrompt,
      negativePrompt: params.negativePrompt,
      constraints: {
        kind: params.kind,
        aspectRatio: params.project.aspectRatio,
        referencePolicy,
      },
      references: params.referenceImageUrls.map((url, index) => ({
        url,
        role: referenceUsageNotes[index] || `reference_${index + 1}`,
      })),
    });
    if (
      hardPersonReferenceRequired
      && (
        !submittedPrompt.includes("role=hard_identity_style")
        || !submittedPrompt.includes("Identity lock (sole textual identity source):")
        || !submittedPrompt.includes("Isolation: exactly one character")
      )
    ) {
      throw new Error("人物资产生成已停止：最终提交 Prompt 未完整保留用户参考图的强身份与强渲染风格合同，未向图片模型发送不完整请求。");
    }
    await withOnePromptVideoLogContext(generationCandidateLogContext({
      projectId: params.project.id,
      artifactId: params.artifactId,
      kind: params.kind,
      candidateNo,
      candidateCount: historicalCandidateCount + candidateCount,
      attempt,
      metadata: params.metadata,
    }), async () => {
      await logOnePromptVideo("production.step.completed", {
        stepNameZh: "整理本张候选图最终提交提示词",
        executionMethod: submittedPromptReport.modelCompactionAttempted ? "model" : "program",
        durationMs: localCandidateNo === 1 ? promptPreparationDurationMs : 0,
        repairMode: firstNonEmptyString([params.metadata.repairMode]),
        originalPromptLength: submittedPromptReport.originalLength,
        submittedPromptLength: submittedPromptReport.submittedLength,
        promptExceededSoftBudget: submittedPromptReport.exceededSoftBudget,
        promptUsedHardBudget: submittedPromptReport.usedHardBudget,
        promptRemovedDuplicateUnits: submittedPromptReport.removedDuplicateUnits,
        promptOmittedUnits: submittedPromptReport.omittedUnits,
        promptOmittedCriticalUnits: submittedPromptReport.omittedCriticalUnits,
        modelCompactionAttempted: submittedPromptReport.modelCompactionAttempted,
        modelCompactionSucceeded: submittedPromptReport.modelCompactionSucceeded,
        modelCompactionModel: submittedPromptReport.modelCompactionModel,
        modelCompactionDurationMs: submittedPromptReport.modelCompactionDurationMs,
        modelCompactionFailureReason: submittedPromptReport.modelCompactionFailureReason,
        resultZh: submittedPromptReport.modelCompactionSucceeded
          ? "关键约束超出程序预算，已由非思考模型完成保真压缩并通过程序复核"
          : submittedPromptReport.modelCompactionAttempted
            ? "模型保真压缩未通过，已使用程序最终保护并记录告警"
            : submittedPromptReport.compacted
              ? "提示词已按语义优先级压缩并组装"
              : "提示词已组装，无需压缩",
      });
      await logOnePromptVideo("generation_candidate.image.submit.start");
      try {
        const submitStartedAtMs = Date.now();
        const taskId = await submitAliyunImageTask({
          prompt: providerPromptFromExecutionContract(executionContract),
          negativePrompt: executionContract.negativePrompt,
          referenceImageUrls: params.referenceImageUrls,
          referenceUsageNotes,
          referencePolicy,
          aspectRatio: params.project.aspectRatio as "9:16" | "16:9" | "1:1",
          seed: Math.abs((params.seedBase ?? Date.now()) + candidateNo * 7919) % 2147483647,
          preparedPromptReport: submittedPromptReport,
          schedulingContext: {
            userId: params.project.userId,
            projectId: params.project.id,
            // targetId must identify the generated artifact, not the owning
            // segment: one segment can contain several concurrent micro-shots.
            targetId: params.kind === "micro_shot_image"
              ? `${params.project.id}:${params.artifactId}`
              : params.targetId,
          },
        });
        await logOnePromptVideo("production.step.completed", {
          stepNameZh: "把提示词和参考图提交给图片生成模型",
          executionMethod: "image_model",
          durationMs: Date.now() - submitStartedAtMs,
          resultZh: "图片生成任务已受理，开始等待渲染",
        });
        if (!firstTaskId) firstTaskId = taskId;
        await prisma.videoGenerationCandidate.create({ data: { projectId: params.project.id, artifactId: params.artifactId, targetId: params.targetId, kind: params.kind, batchId, candidateNo, taskId, status: "running", prompt: executionContract.prompt, negativePrompt: executionContract.negativePrompt, upstreamSubmittedAt: new Date(), metadata: cleanInputJson({ ...params.metadata, ...repairTimingMetadata, executionContract, attempt, retryCycleId, historicalCandidateCount, sourcePrompt: params.prompt, submittedPromptCompacted: submittedPromptReport.compacted, submittedPromptFitReport: submittedPromptMetrics, generationInputFingerprint, generationInputFingerprintVersion: GENERATION_INPUT_FINGERPRINT_VERSION }) } });
        await logOnePromptVideo("generation_candidate.image.submit.success", { taskId });
      } catch (error) {
        if (isProviderCapacityError(error) || isVideoProviderCapacityError(error)) throw error;
        await prisma.videoGenerationCandidate.create({ data: { projectId: params.project.id, artifactId: params.artifactId, targetId: params.targetId, kind: params.kind, batchId, candidateNo, status: "failed", prompt: executionContract.prompt, negativePrompt: executionContract.negativePrompt, errorMessage: error instanceof Error ? error.message : String(error), metadata: cleanInputJson({ ...params.metadata, ...repairTimingMetadata, executionContract, attempt, retryCycleId, historicalCandidateCount, sourcePrompt: params.prompt, submittedPromptCompacted: submittedPromptReport.compacted, submittedPromptFitReport: submittedPromptMetrics, generationInputFingerprint, generationInputFingerprintVersion: GENERATION_INPUT_FINGERPRINT_VERSION }) } });
        await logOnePromptVideo("generation_candidate.image.submit.error", errorForLog(error), "error");
      }
    });
  }
  if (!firstTaskId) throw new Error("All image candidate submissions failed");
  return firstTaskId;
}

async function createVideoCandidateBatch(params: {
  project: VideoProjectRecord;
  segment: VideoProjectRecord["segments"][number];
  prompt: string;
  startFrameUrl: string;
  endFrameUrl: string;
  imageInputs: VideoImageInput[];
  resolvedVideoImages?: ResolvedVideoImageInputs;
  metadata: Record<string, unknown>;
}): Promise<string> {
  const artifactId = videoArtifactIdForSegmentNo(params.segment.segmentNo);
  const batchId = randomUUID();
  const requestedRetryCycleId = typeof params.metadata.retryCycleId === "string" ? params.metadata.retryCycleId : undefined;
  const { attempt, retryCycleId } = nextGenerationCandidateAttempt(params.project.generationCandidates, artifactId, requestedRetryCycleId);
  const endFrameRequirementLevel = resolveEndFrameRequirementLevel(params.metadata.targetContract);
  const audioPlan = readPlanAudioPlan(readPlanSegmentMap(params.project.planJson).get(params.segment.segmentNo));
  const audioStrategy = resolveVideoAudioStrategy(audioPlan);
  assertEndFrameRequirementSupported(
    endFrameRequirementLevel,
    aliyunImageToVideoCapabilities(),
    aliyunVideoImageInputCapabilities().modelId,
  );
  const providerImageCapabilities = aliyunVideoImageInputCapabilities();
  const resolvedVideoImages = params.resolvedVideoImages ?? resolveVideoImageInputs({
    inputs: params.imageInputs,
    capabilities: providerImageCapabilities,
    endFrameRequirementLevel,
  });
  const generationInputFingerprint = buildGenerationInputFingerprint({
    kind: "segment_video",
    prompt: params.prompt,
    negativePrompt: params.segment.negativePrompt,
    referenceImageUrls: resolvedVideoImages.transported.map((item) => item.url),
    parameters: {
      model: providerImageCapabilities.modelId,
      durationSeconds: params.segment.durationSeconds,
      startFrameUrl: params.startFrameUrl,
      endFrameUrl: params.endFrameUrl,
      endFrameRequirementLevel,
      transportedVideoImageInputs: resolvedVideoImages.transported,
    },
  });
  const reusedTaskId = await guardProgressiveCandidateSubmission({
    projectId: params.project.id,
    artifactId,
    generationInputFingerprint,
  });
  if (reusedTaskId) return reusedTaskId;
  const historicalCandidateCount = await prisma.videoGenerationCandidate.count({
    where: { projectId: params.project.id, artifactId },
  });
  let firstTaskId = "";
  const candidateCount = videoCandidateCount();
  for (let localCandidateNo = 1; localCandidateNo <= candidateCount; localCandidateNo += 1) {
    const candidateNo = historicalCandidateCount + localCandidateNo;
    const executionContract = createCanonicalExecutionContractV2({
      targetId: params.segment.id,
      artifactId,
      revision: candidateNo,
      prompt: params.prompt,
      negativePrompt: params.segment.negativePrompt,
      constraints: {
        kind: "segment_video",
        durationSeconds: params.segment.durationSeconds,
        endFrameRequirementLevel,
      },
      references: resolvedVideoImages.transported.map((input) => ({
        url: input.url,
        role: input.role,
      })),
    });
    await withOnePromptVideoLogContext(generationCandidateLogContext({
      projectId: params.project.id,
      artifactId,
      kind: "segment_video",
      candidateNo,
      candidateCount,
      attempt,
      metadata: { ...params.metadata, segmentNo: params.segment.segmentNo },
    }), async () => {
      await logOnePromptVideo("generation_candidate.video.submit.start");
      try {
        const taskId = await submitAliyunImageToVideoTask({
          imageUrl: params.startFrameUrl,
          lastFrameUrl: params.endFrameUrl,
          imageInputs: params.imageInputs,
          resolvedImageInputs: resolvedVideoImages,
          prompt: providerPromptFromExecutionContract(executionContract),
          negativePrompt: executionContract.negativePrompt,
          durationSeconds: params.segment.durationSeconds,
          endFrameRequirementLevel,
          schedulingContext: {
            userId: params.project.userId,
            projectId: params.project.id,
            targetId: params.segment.id,
          },
        });
        if (!firstTaskId) firstTaskId = taskId;
        await prisma.videoGenerationCandidate.create({ data: { projectId: params.project.id, artifactId, targetId: params.segment.id, kind: "segment_video", batchId, candidateNo, taskId, status: "running", prompt: executionContract.prompt, negativePrompt: executionContract.negativePrompt, upstreamSubmittedAt: new Date(), metadata: cleanInputJson({ ...params.metadata, executionContract, attempt, retryCycleId, historicalCandidateCount, durationSeconds: params.segment.durationSeconds, startFrameUrl: params.startFrameUrl, endFrameUrl: params.endFrameUrl, videoModel: aliyunVideoImageInputCapabilities().modelId, audioPlan, audioStrategy, preserveNativeAudio: audioPlan?.preserveNativeAudio ?? audioStrategy !== "post_only", endFrameRequirementLevel, endFrameConstraintMode: resolvedVideoImages.nativeLastFrame ? "native_last_frame" : "semantic_prompt_and_visual_check", endFramePromptEnforced: true, videoImageInputCapabilities: providerImageCapabilities, requestedVideoImageInputs: params.imageInputs, transportedVideoImageInputs: resolvedVideoImages.transported, evaluationOnlyVideoImageInputs: resolvedVideoImages.evaluationOnly, rejectedVideoImageInputs: resolvedVideoImages.rejected, generationInputFingerprint, generationInputFingerprintVersion: GENERATION_INPUT_FINGERPRINT_VERSION }) } });
        await logOnePromptVideo("generation_candidate.video.submit.success", { taskId });
      } catch (error) {
        if (isProviderCapacityError(error) || isVideoProviderCapacityError(error)) throw error;
        await prisma.videoGenerationCandidate.create({ data: { projectId: params.project.id, artifactId, targetId: params.segment.id, kind: "segment_video", batchId, candidateNo, status: "failed", prompt: executionContract.prompt, negativePrompt: executionContract.negativePrompt, errorMessage: error instanceof Error ? error.message : String(error), metadata: cleanInputJson({ ...params.metadata, executionContract, attempt, retryCycleId, historicalCandidateCount, durationSeconds: params.segment.durationSeconds, startFrameUrl: params.startFrameUrl, endFrameUrl: params.endFrameUrl, generationInputFingerprint, generationInputFingerprintVersion: GENERATION_INPUT_FINGERPRINT_VERSION }) } });
        await logOnePromptVideo("generation_candidate.video.submit.error", errorForLog(error), "error");
      }
    });
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

function readPlanConsistencyAnchorMap(planJson: Prisma.JsonValue | null): Map<string, Record<string, unknown>> {
  const plan = isRecord(planJson) ? planJson : {};
  const planningManifest = isRecord(plan.planningManifest)
    ? plan.planningManifest
    : isRecord(plan.planning_manifest)
      ? plan.planning_manifest
      : {};
  const manifest = isRecord(plan.consistencyManifest)
    ? plan.consistencyManifest
    : isRecord(plan.consistency_manifest)
      ? plan.consistency_manifest
      : isRecord(planningManifest.consistencyManifest)
        ? planningManifest.consistencyManifest
        : isRecord(planningManifest.consistency_manifest)
          ? planningManifest.consistency_manifest
          : {};
  const anchors = Array.isArray(manifest.anchors) ? manifest.anchors : [];
  return new Map(anchors.flatMap((anchor) => {
    if (!isRecord(anchor)) return [];
    const id = readPlanShotString(anchor, ["id"]);
    return id ? [[id, normalizePlanAnchorRecord(anchor)] as const] : [];
  }));
}

function normalizePlanAnchorRecord(anchor: Record<string, unknown>): Record<string, unknown> {
  const type = readPlanShotString(anchor, ["type"]) as VideoConsistencyAnchor["type"];
  const normalized = normalizeAnchorSemantics({
    id: readPlanShotString(anchor, ["id"]),
    type: type || "custom",
    displayNameZh: readPlanShotString(anchor, ["displayNameZh", "display_name_zh"]),
    displayNameEn: readPlanShotString(anchor, ["displayNameEn", "display_name_en"]),
    mustStayConsistent: anchor.mustStayConsistent !== false && anchor.must_stay_consistent !== false,
    needsReferenceImage: anchor.needsReferenceImage === true || anchor.needs_reference_image === true,
    referenceStrength: readPlanShotString(anchor, ["referenceStrength", "reference_strength"]) as VideoConsistencyAnchor["referenceStrength"],
    descriptionZh: readPlanShotString(anchor, ["descriptionZh", "description_zh"]),
    descriptionEn: readPlanShotString(anchor, ["descriptionEn", "description_en"]),
    imagePromptZh: readPlanShotString(anchor, ["imagePromptZh", "image_prompt_zh"]),
    imagePromptEn: readPlanShotString(anchor, ["imagePromptEn", "image_prompt_en"]),
    assetImageContract: normalizeVideoAssetImageContract(anchor.assetImageContract ?? anchor.asset_image_contract),
  });
  return {
    ...anchor,
    ...normalized,
  };
}

function isEligibleConsistencyKeyframe(
  planJson: Prisma.JsonValue | null,
  keyframeNo: number,
): boolean {
  if (!isConsistencyKeyframeNo(keyframeNo)) return true;
  const reference = readPlanConsistencyReferenceMap(planJson).get(keyframeNo);
  const anchorId = readPlanShotString(reference, ["anchorId", "anchor_id"]);
  if (!anchorId) return true;
  const anchor = readPlanConsistencyAnchorMap(planJson).get(anchorId);
  if (!anchor) return true;
  return isReferenceImageEligibleAnchor(anchor as unknown as VideoConsistencyAnchor);
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

function canonicalBoundaryContractsFromPlan(
  planJson: Prisma.JsonValue | null,
): VideoBoundaryContract[] {
  const plan = planRecord(planJson);
  if (Array.isArray(plan.boundaryContracts) && plan.boundaryContracts.length) {
    return plan.boundaryContracts.filter(isRecord) as unknown as VideoBoundaryContract[];
  }
  const typedPlan = plan as unknown as OnePromptVideoPlan;
  if (!Array.isArray(typedPlan.keyframes) || !Array.isArray(typedPlan.segments)) {
    throw new Error("The video plan is missing keyframes or segments required for boundary contracts.");
  }
  const contracts = deriveCanonicalBoundaryContracts(typedPlan);
  validateBoundaryContracts(typedPlan, contracts);
  return contracts;
}

function canonicalBoundaryContractMap(
  planJson: Prisma.JsonValue | null,
): Map<number, VideoBoundaryContract> {
  return new Map(
    canonicalBoundaryContractsFromPlan(planJson)
      .map((contract) => [contract.keyframeNo, contract]),
  );
}

function consistencyAssetReferenceIds(
  planJson: Prisma.JsonValue | null,
): Set<string> {
  const ids = new Set<string>();
  for (const reference of readPlanConsistencyReferenceMap(planJson).values()) {
    for (const id of [
      anchorIdForConsistencyReference(reference),
      readPlanShotString(reference, ["assetId", "asset_id"]),
    ]) {
      if (id) ids.add(id);
    }
  }
  return ids;
}

function requiredAssetReferencesByBoundary(
  planJson: Prisma.JsonValue | null,
): Map<number, string[]> {
  const assetIds = consistencyAssetReferenceIds(planJson);
  return new Map(
    canonicalBoundaryContractsFromPlan(planJson).map((contract) => [
      contract.keyframeNo,
      uniqueStrings(contract.requiredAnchorIds.filter((id) => assetIds.has(id))),
    ]),
  );
}

function approvedConsistencyAssetReferenceIds(
  project: Pick<VideoProjectRecord, "planJson" | "keyframes">,
): string[] {
  const referenceMap = readPlanConsistencyReferenceMap(project.planJson);
  return uniqueStrings(
    project.keyframes
      .filter((keyframe) => keyframe.keyframeNo < 0 && isApprovedConsistencyReference(keyframe))
      .flatMap((keyframe) => {
        const reference = referenceMap.get(keyframe.keyframeNo);
        return [
          anchorIdForConsistencyReference(reference),
          readPlanShotString(reference, ["assetId", "asset_id"]),
        ];
      }),
  );
}

function missingApprovedAssetReferenceIdsForBoundary(
  project: Pick<VideoProjectRecord, "planJson" | "keyframes">,
  keyframeNo: number,
): string[] {
  const required = requiredAssetReferencesByBoundary(project.planJson).get(keyframeNo) ?? [];
  const approved = new Set(approvedConsistencyAssetReferenceIds(project));
  return required.filter((id) => !approved.has(id));
}

function isBoundaryAssetDependencyReady(
  project: Pick<VideoProjectRecord, "planJson" | "keyframes">,
  keyframeNo: number,
): boolean {
  return keyframeNo >= 0
    && missingApprovedAssetReferenceIdsForBoundary(project, keyframeNo).length === 0;
}

async function bindApprovedAssetsIntoBoundaryPlan(
  project: VideoProjectRecord,
): Promise<void> {
  const plan = cloneJsonRecord(project.planJson ?? {});
  const contracts = canonicalBoundaryContractsFromPlan(project.planJson);
  const boundContracts = bindBoundaryContractsToApprovedAssets(
    contracts,
    approvedConsistencyAssetReferenceIds(project),
    requiredAssetReferencesByBoundary(project.planJson),
  );
  plan.boundaryContracts = boundContracts;
  plan.planningPhase = {
    semanticPlanning: "complete",
    boundaryPlanning: boundContracts.every((contract) => contract.status === "asset_bound")
      ? "asset_bound"
      : "semantic_draft",
    mediaConditionedPlanning: "pending_images",
    finalPromptCompilation: "deferred_to_generation",
    updatedAt: new Date().toISOString(),
  };
  await commitArtifactPlan(project.id, cleanInputJson(plan));
}

async function runMediaConditionedPlanningAfterImageApproval(
  project: VideoProjectRecord,
): Promise<{
  observedFacts: VideoObservedBoundaryFacts[];
  segmentPlans: VideoMediaConditionedSegmentPlan[];
}> {
  const plan = cloneJsonRecord(project.planJson ?? {});
  const typedPlan = plan as unknown as OnePromptVideoPlan;
  const contracts = setBoundaryContractStatus(
    canonicalBoundaryContractsFromPlan(project.planJson),
    "image_approved",
  );
  validateBoundaryContracts(typedPlan, contracts);
  const contractMap = new Map(contracts.map((contract) => [contract.keyframeNo, contract]));
  const boundaryKeyframes = project.keyframes
    .filter((keyframe) => keyframe.keyframeNo > 0 && Boolean(keyframe.imageUrl))
    .sort((a, b) => a.keyframeNo - b.keyframeNo);
  const observedFacts = await Promise.all(boundaryKeyframes.map((keyframe) =>
    observeApprovedBoundaryFrame({
      contract: requiredMapValue(
        contractMap,
        keyframe.keyframeNo,
        `Missing canonical boundary contract for KF${keyframe.keyframeNo}.`,
      ),
      imageUrl: keyframe.imageUrl as string,
      schedulingContext: { userId: project.userId, projectId: project.id },
    })
  ));
  const factsMap = new Map(observedFacts.map((facts) => [facts.keyframeNo, facts]));
  const dbKeyframes = new Map(boundaryKeyframes.map((keyframe) => [keyframe.keyframeNo, keyframe]));
  const provisionalMap = readPlanSegmentRenderDescriptionMap(project.planJson);
  const planSegments = new Map(typedPlan.segments.map((segment) => [segment.segmentNo, segment]));
  const segmentPlans = await Promise.all(project.segments
    .sort((a, b) => a.segmentNo - b.segmentNo)
    .map((dbSegment) => {
      const segment = requiredMapValue(
        planSegments,
        dbSegment.segmentNo,
        `Missing semantic segment ${dbSegment.segmentNo}.`,
      );
      const startKeyframe = requiredMapValue(
        dbKeyframes,
        segment.startKeyframeNo,
        `Missing approved start image KF${segment.startKeyframeNo}.`,
      );
      const endKeyframe = requiredMapValue(
        dbKeyframes,
        segment.endKeyframeNo,
        `Missing approved end image KF${segment.endKeyframeNo}.`,
      );
      return planMediaConditionedSegment({
        segment,
        startContract: requiredMapValue(contractMap, segment.startKeyframeNo, "Missing start boundary contract."),
        endContract: requiredMapValue(contractMap, segment.endKeyframeNo, "Missing end boundary contract."),
        startFacts: requiredMapValue(factsMap, segment.startKeyframeNo, "Missing observed start facts."),
        endFacts: requiredMapValue(factsMap, segment.endKeyframeNo, "Missing observed end facts."),
        startImageUrl: startKeyframe.imageUrl as string,
        endImageUrl: endKeyframe.imageUrl as string,
        provisional: provisionalMap.get(segment.segmentNo) as unknown as SegmentRenderDescription | undefined,
        schedulingContext: { userId: project.userId, projectId: project.id },
      });
    }));

  const mediaPlanBySegment = new Map(segmentPlans.map((item) => [item.segmentNo, item]));
  const existingRenderDescriptions = Array.isArray(plan.segmentRenderDescriptions)
    ? plan.segmentRenderDescriptions.filter(isRecord)
    : [];
  plan.boundaryContracts = contracts;
  plan.observedBoundaryFacts = observedFacts;
  plan.mediaConditionedSegmentPlans = segmentPlans;
  plan.segments = activateResolvedMicroShots(
    Array.isArray(plan.segments) ? plan.segments : [],
    mediaPlanBySegment,
  );
  plan.segmentRenderDescriptions = typedPlan.segments.map((segment) => {
    const existing = existingRenderDescriptions.find((item) =>
      Number(item.segmentNo ?? item.segment_no) === segment.segmentNo
    ) ?? {};
    const media = requiredMapValue(mediaPlanBySegment, segment.segmentNo, "Missing media-conditioned segment plan.");
    return {
      ...existing,
      segmentNo: segment.segmentNo,
      startFrameContract: media.startFrameContract,
      endFrameContract: media.endFrameContract,
      motionContract: media.motionContract,
      singleTakeContract: media.singleTakeContract,
      motionCheckpoints: media.motionCheckpoints,
      resolvedMicroShots: media.resolvedMicroShots,
      microShotRevisionId: media.microShotRevisionId,
      videoPromptContract: media.videoPromptContract,
      warnings: uniqueStrings([
        ...readPlanStringArray(existing, ["warnings"]),
        ...media.warnings,
      ]),
      planningSource: media.planningStatus,
      refinedAt: media.refinedAt,
    };
  });
  const fallbackCount = segmentPlans.filter((item) => item.planningStatus === "fallback").length;
  plan.planningPhase = {
    semanticPlanning: "complete",
    boundaryPlanning: "image_approved",
    mediaConditionedPlanning: fallbackCount ? "partial" : "complete",
    finalPromptCompilation: "deferred_to_generation",
    updatedAt: new Date().toISOString(),
  };
  await commitArtifactPlan(project.id, cleanInputJson(plan));
  await Promise.all(segmentPlans.map((media) =>
    prisma.videoSegment.updateMany({
      where: { projectId: project.id, segmentNo: media.segmentNo },
      data: {
        motion: compactJsonLine("motion", media.motionContract),
        camera: compactJsonLine("single_take", media.singleTakeContract),
        subjectMotion: readPlanShotString(media.motionContract, ["subjectMotion", "subject_motion", "subjectPath", "subject_path"]),
        environmentMotion: readPlanShotString(media.motionContract, ["environmentMotion", "environment_motion"]),
      },
    })
  ));
  return { observedFacts, segmentPlans };
}

function activateResolvedMicroShots(
  items: unknown[],
  mediaPlanBySegment: Map<number, VideoMediaConditionedSegmentPlan>,
): unknown[] {
  return items.map((item) => {
    if (!isRecord(item)) return item;
    const segmentNo = Number(
      item.segmentNo
      ?? item.segment_no
      ?? item.shotNo
      ?? item.shot_no,
    );
    const media = mediaPlanBySegment.get(segmentNo);
    if (!media) return item;
    const currentMicroShots = Array.isArray(item.microShots)
      ? item.microShots
      : Array.isArray(item.micro_shots)
        ? item.micro_shots
        : [];
    const provisionalMicroShots = Array.isArray(item.provisionalMicroShots)
      ? item.provisionalMicroShots
      : Array.isArray(item.provisional_micro_shots)
        ? item.provisional_micro_shots
        : currentMicroShots;
    return {
      ...item,
      provisionalMicroShots,
      resolvedMicroShots: media.resolvedMicroShots,
      microShots: media.resolvedMicroShots,
      microShotRevisionId: media.microShotRevisionId,
      microShotResolutionStatus: "resolved",
    };
  });
}

function requiredMapValue<K, V>(map: Map<K, V>, key: K, message: string): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(message);
  return value;
}

async function invalidateMediaPlanningForBoundary(
  projectId: string,
  keyframeNo: number,
): Promise<void> {
  if (keyframeNo <= 0) return;
  const authority = await readArtifactPlan(projectId, { allowMissing: true });
  if (!authority) return;
  const plan = cloneJsonRecord(authority);
  const adjacentSegmentNos = new Set(
    (Array.isArray(plan.segments) ? plan.segments : [])
      .filter(isRecord)
      .filter((segment) =>
        Number(segment.startKeyframeNo ?? segment.start_keyframe_no) === keyframeNo
        || Number(segment.endKeyframeNo ?? segment.end_keyframe_no) === keyframeNo
      )
      .map((segment) => Number(segment.segmentNo ?? segment.segment_no))
      .filter((segmentNo) => Number.isInteger(segmentNo) && segmentNo > 0),
  );
  const staleArtifactIds = [...adjacentSegmentNos].flatMap((segmentNo) => {
    const segment = (Array.isArray(plan.segments) ? plan.segments : [])
      .filter(isRecord)
      .find((item) => Number(item.segmentNo ?? item.segment_no) === segmentNo);
    const media = (Array.isArray(plan.mediaConditionedSegmentPlans)
      ? plan.mediaConditionedSegmentPlans
      : [])
      .filter(isRecord)
      .find((item) => Number(item.segmentNo ?? item.segment_no) === segmentNo);
    const microShots = Array.isArray(media?.resolvedMicroShots)
      ? readPlanMicroShots({ microShots: media.resolvedMicroShots })
      : readPlanMicroShots(segment);
    return [
      ...microShots.map((item) =>
        imageArtifactIdForMicroShot(segmentNo, item.microShotNo)
      ),
      videoArtifactIdForSegmentNo(segmentNo),
      `segment:${segmentNo}:prompt`,
      `segment:${segmentNo}:reference_selection`,
    ];
  });
  plan.observedBoundaryFacts = (Array.isArray(plan.observedBoundaryFacts)
    ? plan.observedBoundaryFacts
    : []).filter((item) => !isRecord(item) || Number(item.keyframeNo) !== keyframeNo);
  plan.mediaConditionedSegmentPlans = (Array.isArray(plan.mediaConditionedSegmentPlans)
    ? plan.mediaConditionedSegmentPlans
    : []).filter((item) =>
      !isRecord(item) || !adjacentSegmentNos.has(Number(item.segmentNo))
    );
  const restoreProvisionalMicroShots = (items: unknown[]): unknown[] => items.map((item) => {
    if (!isRecord(item)) return item;
    const segmentNo = Number(
      item.segmentNo
      ?? item.segment_no
      ?? item.shotNo
      ?? item.shot_no,
    );
    if (!adjacentSegmentNos.has(segmentNo)) return item;
    const provisional = Array.isArray(item.provisionalMicroShots)
      ? item.provisionalMicroShots
      : Array.isArray(item.provisional_micro_shots)
        ? item.provisional_micro_shots
        : Array.isArray(item.microShots)
          ? item.microShots
          : [];
    const next: Record<string, unknown> = {
      ...item,
      microShots: provisional,
      microShotResolutionStatus: "stale",
    };
    delete next.resolvedMicroShots;
    delete next.microShotRevisionId;
    return next;
  });
  if (Array.isArray(plan.segments)) {
    plan.segments = restoreProvisionalMicroShots(plan.segments);
  }
  plan.segmentRenderDescriptions = (Array.isArray(plan.segmentRenderDescriptions)
    ? plan.segmentRenderDescriptions
    : []).map((item) => {
      if (!isRecord(item) || !adjacentSegmentNos.has(Number(item.segmentNo ?? item.segment_no))) {
        return item;
      }
      const next = { ...item };
      for (const key of [
        "startFrameContract",
        "endFrameContract",
        "motionContract",
        "singleTakeContract",
        "motionCheckpoints",
        "resolvedMicroShots",
        "microShotRevisionId",
        "videoPromptContract",
        "planningSource",
        "refinedAt",
      ]) {
        delete next[key];
      }
      return next;
    });
  plan.planningPhase = {
    semanticPlanning: "complete",
    boundaryPlanning: "asset_bound",
    mediaConditionedPlanning: "pending_images",
    finalPromptCompilation: "deferred_to_generation",
    updatedAt: new Date().toISOString(),
  };
  markPlanArtifactsDirty(
    plan,
    uniqueStrings(staleArtifactIds),
    `Boundary KF${keyframeNo} changed; media-conditioned micro-shots and all downstream outputs are stale.`,
  );
  await commitArtifactPlan(projectId, cleanInputJson(plan));
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
    stripSourceAudio: postProductionMode
      ? true
      : audioBible.stripSourceAudio ?? audioBible.strip_source_audio ?? false,
    loudnorm: audioBible.loudnorm ?? audioBible.loudNorm ?? audioBible.loudnessNormalization ?? audioBible.loudness_normalization ?? true,
  };
}

function transitionReferenceMode(): "short" | "full" {
  if (isOnePromptVideoFastPreviewEnabled()) return "short";
  return process.env.ONE_PROMPT_TRANSITION_REFERENCE_MODE?.trim().toLowerCase() === "full" ? "full" : "short";
}

function transitionReferenceArtifactsFromPlan(planJson: Prisma.JsonValue | null): TransitionReferenceArtifact[] {
  const plan = planRecord(planJson);
  const values = Array.isArray(plan.transitionReferenceArtifacts)
    ? plan.transitionReferenceArtifacts
    : Array.isArray(plan.transition_reference_artifacts) ? plan.transition_reference_artifacts : [];
  return (values.filter(isRecord) as unknown as TransitionReferenceArtifact[]).flatMap((artifact) => {
    // A root camera has no parent image from which a transition reference can
    // be derived. Keeping this artifact would block KF1 forever.
    if (!Number.isInteger(artifact.parentKeyframeNo)) return [];
    // Palette/mood guides do not contain reusable scene geometry. A full
    // transition-video extraction cannot discover meaningful layout from
    // them, so use the already accepted parent frame as a short composition
    // reference instead.
    if (artifact.mode === "full" && !cameraLocationSupportsSpatialInheritance(planJson, artifact.toCameraId)) {
      return [{
        ...artifact,
        mode: "short" as const,
        reasonZh: `${artifact.reasonZh}（目标仅含色调/氛围背景，已降级为父关键帧构图参考。）`,
      }];
    }
    return [artifact];
  });
}

function cameraLocationSupportsSpatialInheritance(
  planJson: Prisma.JsonValue | null,
  cameraId: string,
): boolean {
  const plan = planRecord(planJson);
  const graph = readCameraGraph(plan.cameraGraph ?? plan.camera_graph);
  const camera = graph.cameras.find((item) => item.cameraId === cameraId);
  if (!camera?.locationId) return true;
  const anchor = readPlanConsistencyAnchorMap(planJson).get(camera.locationId);
  if (!anchor) return true;
  return isVisibleEvidenceAnchor(anchor as unknown as VideoConsistencyAnchor);
}

function generatedBridgeArtifactsFromPlan(planJson: Prisma.JsonValue | null): GeneratedBridgeArtifact[] {
  const plan = planRecord(planJson);
  const values = Array.isArray(plan.generatedBridgeArtifacts)
    ? plan.generatedBridgeArtifacts
    : Array.isArray(plan.generated_bridge_artifacts) ? plan.generated_bridge_artifacts : [];
  return values.filter(isRecord) as unknown as GeneratedBridgeArtifact[];
}

function materializeTransitionProductionArtifacts(plan: OnePromptVideoPlan, previousPlanJson?: Prisma.JsonValue | null): void {
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
    // The initial/root camera has no upstream frame to inherit. Creating a
    // transition artifact here produces an impossible dependency and leaves
    // the first boundary keyframe permanently pending.
    if (!Number.isInteger(parentKeyframeNo)) continue;
    const id = `transition_reference:${node.cameraId}:${toSegmentNo}`;
    const previous = previousTransitions.get(id);
    const modeValue = readPlanShotString(request, ["mode", "productionMode", "production_mode"]);
    const requestedMode = modeValue === "full" || modeValue === "short" ? modeValue : transitionReferenceMode();
    const mode = requestedMode === "full" && !cameraLocationSupportsSpatialInheritance(plan as unknown as Prisma.JsonValue, node.cameraId)
      ? "short"
      : requestedMode;
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

async function createCurrentVideoPlan(
  input: PlanVideoProjectInput,
  context: { userId: string; projectId: string },
  plannerOptions?: {
    checkpoint?: unknown;
    onCheckpoint?: (checkpoint: AliyunStoryboardPlannerCheckpoint) => Promise<void> | void;
    onProgress?: (progress: AliyunStoryboardProgressUpdate) => Promise<void> | void;
    onStageMetric?: (metric: AliyunStoryboardStageMetric) => Promise<void> | void;
  },
): Promise<OnePromptVideoPlan> {
  await logOnePromptVideo("project.plan.arch.selected", {
    ...context,
    arch: CURRENT_PLANNER_ARCH,
  });

  return withCurrentPlannerMetadata(await withOnePromptVideoLogContext(
    { ...context, atomicFunction: "脚本拆解", workflowStage: "planning" },
    () => createAliyunStoryboardPlan(input, { ...plannerOptions, schedulingContext: context }),
  ));
}

function withCurrentPlannerMetadata(plan: OnePromptVideoPlan): OnePromptVideoPlan {
  return {
    ...plan,
    artifactMetadata: {
      ...(plan.artifactMetadata ?? {}),
      planning: {
        artifactId: "planning",
        artifactType: "planning_contract",
        producedByStage: "stage1",
        revision: 1,
        schemaVersion: "planJson",
        plannerVersion: CURRENT_PLANNER_ARCH,
        promptVersion: CURRENT_PLANNER_ARCH,
        modelVersion: "dashscope",
        inputHash: "",
        dependsOn: [],
        status: "ready",
        retryFromStage: "stage1",
      },
    },
  };
}

function ensureProjectAssetLibrary(plan: OnePromptVideoPlan, input: PlanVideoProjectInput): OnePromptVideoPlan {
  const anchors = assetLibraryAnchorsForPlan(plan, input).map((anchor) =>
    isPlayingCardAnchor(anchor)
      ? resolvePlayingCardAssetContract({ anchor, userPrompt: input.userPrompt }).anchor
      : anchor
  );
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
        sourceView: category === "person" && view === "side" ? "front" : category === "person" && view === "back" ? "side" : undefined,
        sourceArtifactId: category === "person" && view === "side"
          ? `${anchor.id || category}:front`
          : category === "person" && view === "back"
            ? `${anchor.id || category}:side`
            : undefined,
        orientation: category === "person" && (view === "front" || view === "side" || view === "back") ? view : "unknown",
        viewGenerationMode: category === "person" && view === "side"
          ? "derived_from_front"
          : category === "person" && view === "back"
            ? "derived_from_side"
            : "primary",
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
  project: VideoProjectRecord | null,
  nextReferences: VideoConsistencyReference[],
): Map<number, VideoProjectRecord["keyframes"][number]> {
  const preserved = new Map<number, VideoProjectRecord["keyframes"][number]>();
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
  const anchors = manifestAnchors
    .map(normalizeAssetAnchor)
    .filter(isReferenceImageEligibleAnchor);
  if (manifestAnchors.length) return anchors;
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
  return normalizeAnchorSemantics({
    ...anchor,
    id: anchor.id || `${anchor.type || "asset"}-${Math.abs(JSON.stringify(anchor).length)}`,
    mustStayConsistent: anchor.mustStayConsistent ?? true,
    needsReferenceImage: anchor.needsReferenceImage ?? true,
  });
}

function assetCategoryForAnchor(anchor: VideoConsistencyAnchor): VideoAssetCategory {
  if (anchor.type === "person") return "person";
  if (anchor.type === "location" || anchor.type === "space_layout") return "scene";
  if (anchor.type === "product" || anchor.type === "task_object" || anchor.type === "food" || anchor.type === "vehicle") return "product";
  if (anchor.type === "prop") return "prop";
  if (anchor.type === "brand_visual") return "brand_visual";
  if (anchor.type === "style" || anchor.type === "graphic_backdrop" || anchor.type === "effect_state") return "style";
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

export function buildAssetConsistencyReference(params: {
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
  const playingCardAsset = category === "prop" && isPlayingCardAnchor(params.anchor)
    ? resolvePlayingCardAssetContract({
        anchor: params.anchor,
        userPrompt: params.userPrompt,
      })
    : undefined;
  const authoritativeAnchor = playingCardAsset?.anchor ?? params.anchor;
  const rawAnchorPromptZh = authoritativeAnchor.imagePromptZh || authoritativeAnchor.descriptionZh || params.baseReference?.imagePromptZh || params.baseReference?.imagePrompt || params.userPrompt;
  const rawAnchorPromptEn = authoritativeAnchor.imagePromptEn || authoritativeAnchor.descriptionEn || params.baseReference?.imagePromptEn || params.baseReference?.imagePrompt || params.userPrompt;
  const subjectInstructionEn = playingCardAsset ? "" : assetSubjectPromptInstruction(authoritativeAnchor, category, "en");
  const subjectInstructionZh = playingCardAsset ? "" : assetSubjectPromptInstruction(authoritativeAnchor, category, "zh");
  const anchorPromptZh = normalizeAssetAnchorPrompt(rawAnchorPromptZh, Boolean(subjectInstructionZh), "zh");
  const anchorPromptEn = normalizeAssetAnchorPrompt(rawAnchorPromptEn, Boolean(subjectInstructionEn), "en");
  const viewInstructionEn = subjectInstructionEn ? "" : assetViewPromptInstruction(category, view, "en");
  const viewInstructionZh = subjectInstructionZh ? "" : assetViewPromptInstruction(category, view, "zh");
  const commonRulesEn = "Clean asset-library reference image on a plain white or light neutral background. Show only the explicitly requested asset set, with no storyboard panels, split screen, captions, interface chrome, branding, or watermark. Preserve intrinsic markings required to identify the asset; do not treat them as forbidden incidental text.";
  const commonRulesZh = "资产库参考图，白色或浅色纯净背景。只展示明确要求的资产组合，不要分镜拼图、多宫格、字幕、界面框、品牌标识或水印。必须保留用于识别资产的固有标记，不能把牌面点数、花色等固有标记当成禁用文字。";
  const specificNegativePromptEn = assetSpecificNegativePrompt(authoritativeAnchor, category, "en");
  const specificNegativePromptZh = assetSpecificNegativePrompt(authoritativeAnchor, category, "zh");
  const baseNegativePrompt = params.baseReference?.negativePrompt || params.negativePrompt;
  const baseNegativePromptZh = params.baseReference?.negativePromptZh || params.negativePromptZh || params.negativePrompt;
  const baseNegativePromptEn = params.baseReference?.negativePromptEn || params.negativePromptEn || params.negativePrompt;
  const providerPromptEn = playingCardAsset
    ? compileAssetImagePromptEn(authoritativeAnchor)
    : [viewInstructionEn, subjectInstructionEn, anchorPromptEn, commonRulesEn].filter(Boolean).join("\n");
  const displayPromptZh = playingCardAsset
    ? compileAssetImagePromptZh(authoritativeAnchor)
    : [viewInstructionZh, subjectInstructionZh, anchorPromptZh, commonRulesZh].filter(Boolean).join("\n");
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
    scene: category === "scene"
      ? params.baseReference?.scene || params.anchor.descriptionEn || params.anchor.descriptionZh || "reusable scene overview"
      : "plain white or light neutral asset-library background",
    characterState: category === "person" ? `${params.item.displayNameEn || params.item.assetId}: ${viewInstructionEn}` : "",
    productState: category === "product" || category === "prop" || category === "brand_visual"
      ? `${params.item.displayNameEn || params.item.assetId}: ${viewInstructionEn}`
      : "",
    // English is the canonical provider execution prompt. The Chinese copy is
    // retained only for UI presentation and must not affect generation.
    imagePrompt: providerPromptEn,
    imagePromptZh: displayPromptZh,
    imagePromptEn: providerPromptEn,
    negativePrompt: mergeNegativePrompt(baseNegativePromptEn || baseNegativePrompt, specificNegativePromptEn, "en"),
    negativePromptZh: mergeNegativePrompt(baseNegativePromptZh, specificNegativePromptZh, "zh"),
    negativePromptEn: mergeNegativePrompt(baseNegativePromptEn, specificNegativePromptEn, "en"),
  };
}

function mergeNegativePrompt(base: string, addition: string, lang: "zh" | "en"): string {
  const separator = lang === "zh" ? "，" : ", ";
  const parts = `${base}${separator}${addition}`
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(parts)].join(separator);
}

function normalizeAssetAnchorPrompt(prompt: string, hasIntrinsicMarkingContract: boolean, lang: "zh" | "en"): string {
  if (!hasIntrinsicMarkingContract) return prompt;
  if (lang === "en") {
    return prompt.replace(
      /\bno text\b/gi,
      "no extra decorative text; preserve the explicitly required card ranks and suit symbols",
    );
  }
  return prompt.replace(
    /无文字/g,
    "无额外装饰文字（必须保留明确指定的牌面点数与花色）",
  );
}

export function assetSubjectPromptInstruction(
  anchor: VideoConsistencyAnchor,
  category: VideoAssetCategory,
  lang: "zh" | "en",
): string {
  if (category !== "prop" || !isPlayingCardAnchor(anchor)) return "";
  const resolved = resolvePlayingCardAssetContract({ anchor }).anchor;
  return lang === "en"
    ? compileAssetImagePromptEn(resolved)
    : compileAssetImagePromptZh(resolved);
}

function assetSpecificNegativePrompt(
  anchor: VideoConsistencyAnchor,
  category: VideoAssetCategory,
  lang: "zh" | "en",
): string {
  if (category !== "prop" || !isPlayingCardAnchor(anchor)) return "";
  const forbidOverlap = anchor.assetImageContract?.playingCards?.overlap.mode !== "percentage";
  return lang === "en"
    ? [
        "extra cards",
        "duplicate cards",
        ...(forbidOverlap ? ["overlapping cards"] : []),
        "cropped corners",
        "card backs",
        "joker",
        "wrong rank",
        "wrong suit",
        "mismatched corner indices",
        "invented symbols",
        "mirrored symbols",
        "unreadable card face",
      ].join(", ")
    : [
        "多余扑克牌",
        "重复扑克牌",
        ...(forbidOverlap ? ["牌面重叠"] : []),
        "卡角裁切",
        "出现牌背",
        "大小王",
        "错误点数",
        "错误花色",
        "对角点数不一致",
        "虚构符号",
        "镜像符号",
        "牌面不可辨认",
      ].join("，");
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
  const dirtyIds = collectDependentArtifactIds(metadata, roots);
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
  const authority = await readArtifactPlan(projectId, { allowMissing: true });
  if (!authority) return;
  const plan = cloneJsonRecord(authority);
  setPlanArtifactStatus(plan, artifactIds, status, options);
  await commitArtifactPlan(projectId, plan);
}

async function saveGenerationQualityReport(projectId: string, report: GenerationQualityReport): Promise<void> {
  const authority = await readArtifactPlan(projectId, { allowMissing: true });
  if (!authority) return;
  const plan = cloneJsonRecord(authority);
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
  const referenceMissing = isReferenceMissingQualityEvaluation(report);
  setPlanArtifactStatus(plan, [report.assetId], technicalFailure ? "generating" : referenceMissing ? "dirty" : report.passed ? "ready" : "failed", {
    dirtyReason: report.passed || technicalFailure ? undefined : report.retryInstruction || report.artifactIssues.join("; "),
    retryFromStage: report.retryFromStage === "stage2b"
      ? "stage2b"
      : report.retryFromStage === "stage3"
        ? "stage3"
        : report.retryFromStage === "reference_selector"
          ? "reference_selector"
        : report.retryFromStage === "manual"
          ? "manual"
          : report.endFrameDecision === "return_stage_2b"
            ? "stage2b"
            : inferRetryFromArtifactId(report.assetId),
  });
  await commitArtifactPlan(projectId, plan);
  await logOnePromptVideo("generation_quality.report", {
    projectId,
    assetId: report.assetId,
    policyVersion: report.policyVersion,
    evaluationStatus: report.evaluationStatus,
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
    atomicRequirementCount: report.atomicRequirements?.length ?? 0,
    evidenceObservationCount: report.evidenceObservations?.length ?? 0,
    confirmedHardEvidenceCount: report.hardFailureReasons?.filter((reason) => reason.startsWith("requirement ")).length ?? 0,
    adjudicationRequired: report.adjudicationRequired,
    adjudicationPerformed: report.adjudicationPerformed,
    adjudicationReason: report.adjudicationReason,
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
    const normalized = normalizePlanAnchorRecord(anchor);
    const id = typeof normalized.id === "string" && normalized.id.trim() ? normalized.id.trim() : `anchor_${index + 1}`;
    return [{
      id,
      referenceStrength: readPlanShotString(normalized, ["referenceStrength", "reference_strength"]),
      needsReferenceImage: typeof normalized.needsReferenceImage === "boolean"
        ? normalized.needsReferenceImage
        : typeof normalized.needs_reference_image === "boolean"
          ? normalized.needs_reference_image
          : undefined,
      type: readPlanShotString(normalized, ["type"]),
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

function deferredVideoQualityChecksForSegment(
  project: Pick<VideoProjectRecord, "planJson">,
  segment: Pick<VideoProjectRecord["segments"][number], "segmentNo">,
  startKeyframe: Pick<VideoProjectRecord["keyframes"][number], "keyframeNo" | "imageUrl">,
  endKeyframe: Pick<VideoProjectRecord["keyframes"][number], "keyframeNo" | "imageUrl">,
): DeferredVideoQualityCheck[] {
  const sources: Array<{ artifactId: string; mediaUrl?: string | null }> = [
    { artifactId: imageArtifactIdForKeyframeNo(startKeyframe.keyframeNo), mediaUrl: startKeyframe.imageUrl },
    { artifactId: imageArtifactIdForKeyframeNo(endKeyframe.keyframeNo), mediaUrl: endKeyframe.imageUrl },
    ...readEffectivePlanMicroShots(project.planJson, segment.segmentNo).map((microShot) => ({
      artifactId: imageArtifactIdForMicroShot(segment.segmentNo, microShot.microShotNo),
      mediaUrl: microShot.imageUrl,
    })),
  ];
  const checks = sources.flatMap(({ artifactId, mediaUrl }) => {
    if (!mediaUrl) return [];
    const report = generationQualityReportForActiveMedia(project.planJson, artifactId, mediaUrl);
    return (report?.issueLedger ?? [])
      .filter((issue) => issue.status === "invalid_for_stage" && issue.applicableStage === "video")
      .map((issue) => ({
        sourceIssueId: `${artifactId}::${issue.issueId}`,
        sourceArtifactId: artifactId,
        category: issue.category,
        region: issue.region,
        requiredVideoCheck: issue.target
          ? `${issue.summary}. Required visible video state: ${issue.target}`
          : issue.summary,
        expectedState: issue.target,
      } satisfies DeferredVideoQualityCheck));
  });
  return [...new Map(checks.map((check) => [check.sourceIssueId, check])).values()];
}

function deferredVideoQualityChecksFromUnknown(value: unknown): DeferredVideoQualityCheck[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const sourceIssueId = readPlanShotString(item, ["sourceIssueId", "source_issue_id"]);
    const sourceArtifactId = readPlanShotString(item, ["sourceArtifactId", "source_artifact_id"]);
    const requiredVideoCheck = readPlanShotString(item, ["requiredVideoCheck", "required_video_check"]);
    if (!sourceIssueId || !sourceArtifactId || !requiredVideoCheck) return [];
    const categoryValue = readPlanShotString(item, ["category"]);
    const category: DeferredVideoQualityCheck["category"] =
      categoryValue === "text_brand"
      || categoryValue === "game_ui"
      || categoryValue === "anatomy"
      || categoryValue === "identity"
      || categoryValue === "layout"
      || categoryValue === "continuity"
        ? categoryValue
        : "artifact";
    return [{
      sourceIssueId,
      sourceArtifactId,
      category,
      region: readPlanShotString(item, ["region"]) || undefined,
      requiredVideoCheck,
      expectedState: readPlanShotString(item, ["expectedState", "expected_state"]) || undefined,
    }];
  });
}

export function hasUsableVideoCandidateForActiveClip(
  candidates: Array<{
    kind: string;
    targetId: string;
    status: string;
    mediaUrl: string | null;
  }>,
  targetId: string,
  clipUrl: string,
): boolean {
  return candidates.some((candidate) =>
    candidate.kind === "segment_video"
    && candidate.targetId === targetId
    && candidate.mediaUrl === clipUrl
    && candidate.status !== "failed"
  );
}

function maxEndFrameContinuityRetries(): number {
  const value = Number(process.env.ONE_PROMPT_END_FRAME_MAX_RETRIES);
  return Number.isFinite(value) ? Math.max(0, Math.min(4, Math.round(value))) : 2;
}

async function markProjectArtifactsDirty(projectId: string, artifactIds: string[], dirtyReason: string): Promise<void> {
  const authority = await readArtifactPlan(projectId, { allowMissing: true });
  if (!authority) return;
  const plan = cloneJsonRecord(authority);
  markPlanArtifactsDirty(plan, artifactIds, dirtyReason);
  await commitArtifactPlan(projectId, plan);
}

function hardReferenceAnchorIds(planJson: Prisma.JsonValue | null): Set<string> {
  const plan = isRecord(planJson) ? planJson : {};
  return new Set(
    consistencyAnchorsFromPlan(plan)
      .filter((anchor) =>
        anchor.referenceStrength === "hard"
        && anchor.needsReferenceImage !== false
        && anchor.type !== "palette_mood"
        && anchor.type !== "style"
        && anchor.type !== "graphic_backdrop"
      )
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
      anchorIds: effectiveRequiredAnchorIds(keyframe),
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
    const anchorIds = effectiveRequiredAnchorIds(segment);
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

function approvedMicroShotImageArtifactIds(project: VideoProjectRecord): string[] {
  const planSegments = readPlanSegmentMap(project.planJson);
  const selectedArtifactIds = new Set(
    project.generationCandidates
      .filter((candidate) => candidate.kind === "micro_shot_image" && candidate.selected && Boolean(candidate.mediaUrl))
      .map((candidate) => candidate.artifactId),
  );
  return project.segments.flatMap((segment) => {
    const microShots = readEffectivePlanMicroShots(project.planJson, segment.segmentNo);
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

function buildSegmentVideoImageInputs(
  project: Pick<VideoProjectRecord, "planJson" | "keyframes">,
  segment: VideoProjectRecord["segments"][number],
  startKeyframe: VideoProjectRecord["keyframes"][number],
  endKeyframe: VideoProjectRecord["keyframes"][number],
): VideoImageInput[] {
  if (!startKeyframe.imageUrl || !endKeyframe.imageUrl) {
    throw new Error(`Segment ${segment.segmentNo} requires approved first and last boundary images.`);
  }
  const inputs: VideoImageInput[] = [{
    id: `segment:${segment.segmentNo}:first_frame`,
    role: "first_frame",
    url: startKeyframe.imageUrl,
    authority: "native_boundary",
    sourceArtifactId: imageArtifactIdForKeyframeNo(startKeyframe.keyframeNo),
    instruction: "This is the exact approved first frame. Start the video from this image.",
    allowedUse: ["initial composition", "initial pose", "initial camera", "initial scene and product state"],
    forbiddenUse: ["do not treat it as style-only evidence", "do not swap it with the last frame"],
    entityName: "the approved opening composition",
    actionRole: "boundary",
  }, {
    id: `segment:${segment.segmentNo}:last_frame`,
    role: "last_frame",
    url: endKeyframe.imageUrl,
    authority: "native_boundary",
    sourceArtifactId: imageArtifactIdForKeyframeNo(endKeyframe.keyframeNo),
    instruction: "This is the exact approved last frame. Reach it through one continuous physically plausible take.",
    allowedUse: ["terminal composition", "terminal pose", "terminal scene and product state"],
    forbiddenUse: ["do not reveal it at the start", "do not reach it by cut, dissolve, teleportation, or pasted freeze-frame"],
    entityName: "the approved target ending state",
    actionRole: "boundary",
  }];

  const planSegment = readPlanSegmentMap(project.planJson).get(segment.segmentNo);
  const requiredAnchors = new Set(visibleRequiredAnchorIds(project.planJson, planSegment));
  const referenceMap = readPlanConsistencyReferenceMap(project.planJson);
  for (const keyframe of project.keyframes) {
    if (keyframe.keyframeNo >= 0 || !keyframe.imageUrl || !isApprovedConsistencyReference(keyframe)) continue;
    if (!isEligibleConsistencyKeyframe(project.planJson, keyframe.keyframeNo)) continue;
    const reference = referenceMap.get(keyframe.keyframeNo);
    const anchorId = readPlanShotString(reference, ["anchorId", "anchor_id"]);
    if (requiredAnchors.size && anchorId && !requiredAnchors.has(anchorId)) continue;
    const category = readPlanShotString(reference, ["assetCategory", "asset_category"]);
    const kind = readPlanShotString(reference, ["kind"]);
    const assetView = readPlanShotString(reference, ["assetView", "asset_view"]);
    const role = videoReferenceRole(category, kind);
    inputs.push({
      id: `segment:${segment.segmentNo}:asset:${keyframe.keyframeNo}`,
      role,
      url: keyframe.imageUrl,
      authority: "reference_only",
      sourceArtifactId: imageArtifactIdForKeyframeNo(keyframe.keyframeNo),
      instruction: videoReferenceInstruction(role, anchorId),
      allowedUse: videoReferenceAllowedUse(role),
      forbiddenUse: ["do not copy pose, framing, background, or unrelated objects unless this image is explicitly a scene-layout reference"],
      anchorId: anchorId || undefined,
      entityName: videoReferenceEntityName(role, anchorId, reference),
      actionRole: videoReferenceActionRole(role),
      requiredForSegment: Boolean(anchorId && requiredAnchors.has(anchorId)),
      relevanceScore:
        (anchorId && requiredAnchors.has(anchorId) ? 500 : 0)
        + videoReferenceViewScore(assetView),
    });
  }

  for (const microShot of readEffectivePlanMicroShots(project.planJson, segment.segmentNo)) {
    if (!microShot.imageUrl) continue;
    inputs.push({
      id: `segment:${segment.segmentNo}:checkpoint:${microShot.microShotNo}`,
      role: "motion_checkpoint",
      url: microShot.imageUrl,
      authority: "reference_only",
      sourceArtifactId: imageArtifactIdForMicroShot(segment.segmentNo, microShot.microShotNo),
      instruction: `Use only as ordered motion checkpoint ${microShot.microShotNo} at approximately ${microShot.localTimeSeconds}s.`,
      allowedUse: ["intermediate pose", "intermediate object state", "motion order"],
      forbiddenUse: ["do not use as first or last frame", "do not insert it as a cutaway or frozen frame"],
      entityName: `the intermediate action at approximately ${microShot.localTimeSeconds}s`,
      actionRole: "checkpoint",
      temporalPosition: segment.durationSeconds > 0
        ? Math.max(0, Math.min(1, microShot.localTimeSeconds / segment.durationSeconds))
        : undefined,
    });
  }
  return uniqueVideoImageInputs(inputs);
}

function videoReferenceRole(
  category: string,
  kind: string,
): VideoImageInput["role"] {
  if (category === "person" || kind === "character") return "character_identity";
  if (category === "product" || category === "prop" || kind === "product" || kind === "prop") return "product_identity";
  if (category === "scene" || kind === "scene" || kind === "space_layout") return "scene_layout";
  if (category === "style") return "style_reference";
  return "custom_reference";
}

function videoReferenceInstruction(
  role: VideoImageInput["role"],
  anchorId: string,
): string {
  const target = anchorId ? ` for anchor ${anchorId}` : "";
  if (role === "character_identity") return `Preserve character identity only${target}.`;
  if (role === "product_identity") return `Preserve product or prop appearance only${target}.`;
  if (role === "scene_layout") return `Preserve approved spatial layout only${target}.`;
  if (role === "style_reference") return "Preserve only the approved rendering style.";
  return `Use only as scoped consistency evidence${target}.`;
}

function videoReferenceAllowedUse(role: VideoImageInput["role"]): string[] {
  if (role === "character_identity") return ["face", "hair", "clothing", "body proportions"];
  if (role === "product_identity") return ["shape", "material", "color", "required markings"];
  if (role === "scene_layout") return ["spatial relationships", "camera axis", "stable background geometry"];
  if (role === "style_reference") return ["rendering style", "texture", "color treatment"];
  return ["attributes explicitly named in its instruction"];
}

function videoReferenceEntityName(
  role: VideoImageInput["role"],
  anchorId: string,
  reference: Record<string, unknown> | undefined,
): string {
  const displayName = readPlanShotString(reference, [
    "displayNameEn",
    "display_name_en",
    "purposeEn",
    "purpose_en",
    "displayName",
    "display_name",
  ]).replace(/\s+/g, " ").trim();
  if (displayName) return /^(the|a|an)\s/i.test(displayName) ? displayName : `the ${displayName}`;
  const normalizedAnchor = anchorId.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (normalizedAnchor) return `the ${normalizedAnchor}`;
  if (role === "character_identity") return "the main character";
  if (role === "product_identity") return "the referenced product";
  if (role === "scene_layout") return "the approved setting";
  if (role === "style_reference") return "the approved visual style";
  return "the referenced subject";
}

function videoReferenceActionRole(
  role: VideoImageInput["role"],
): NonNullable<VideoImageInput["actionRole"]> {
  if (role === "character_identity") return "actor";
  if (role === "product_identity") return "object";
  if (role === "scene_layout") return "environment";
  if (role === "style_reference") return "style";
  return "object";
}

function videoReferenceViewScore(view: string): number {
  if (view === "front" || view === "face_closeup" || view === "overview") return 100;
  if (view === "three_quarter") return 80;
  if (view === "side") return 50;
  if (view === "back") return 20;
  return 0;
}

function uniqueVideoImageInputs(inputs: VideoImageInput[]): VideoImageInput[] {
  const seen = new Set<string>();
  return inputs.filter((input) => {
    const fingerprint = `${input.role}:${input.url}`;
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
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
  project: VideoProjectRecord,
  localizedUpdate?: {
    shotId: string;
    locale?: "zh" | "en";
    microShots?: UpdateShotInput["microShots"];
    purposeUpdated?: boolean;
    imagePromptUpdated?: boolean;
    imagePromptEditContract?: UpdateShotInput["imagePromptEditContract"];
    negativePromptUpdated?: boolean;
  },
): void {
  if (!localizedUpdate?.shotId) return;
  if (!localizedUpdate.purposeUpdated && !localizedUpdate.imagePromptUpdated && !localizedUpdate.negativePromptUpdated && !localizedUpdate.microShots) return;
  const artifactIds: string[] = [];
  const segment = project.segments.find((item) => item.id === localizedUpdate.shotId);
  const keyframe = project.keyframes.find((item) => item.id === localizedUpdate.shotId);

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

function readPlanAudioPlan(shot: Record<string, unknown> | undefined): VideoAudioPlan | undefined {
  const raw = shot?.audioPlan ?? shot?.audio_plan;
  if (!isRecord(raw)) return undefined;
  const modeRaw = raw.mode;
  const mode = modeRaw === "voiceover" || modeRaw === "dialogue" || modeRaw === "mixed" || modeRaw === "silent" || modeRaw === "ambient"
    ? modeRaw
    : "ambient";
  const strategyRaw = raw.strategy ?? raw.generationStrategy ?? raw.generation_strategy;
  const strategy = strategyRaw === "native_ambience" || strategyRaw === "native_full" || strategyRaw === "post_only"
    ? strategyRaw
    : mode === "silent"
      ? "post_only"
      : "native_ambience";
  const linesZh = readPlanStringArray(raw, ["linesZh", "lines_zh"]);
  const linesEn = readPlanStringArray(raw, ["linesEn", "lines_en"]);
  const lines = readPlanStringArray(raw, ["lines"]);
  const soundEffectsRaw = Array.isArray(raw.soundEffects)
    ? raw.soundEffects
    : Array.isArray(raw.sound_effects)
      ? raw.sound_effects
      : [];
  const soundEffects = soundEffectsRaw.filter(isRecord).flatMap((effect) => {
    const source = readPlanShotString(effect, ["source"]);
    const action = readPlanShotString(effect, ["action"]);
    const description = readPlanShotString(effect, ["description"]);
    if (!source || !action || !description) return [];
    const timing = Number(effect.timingSeconds ?? effect.timing_seconds);
    return [{
      timingSeconds: Number.isFinite(timing) ? timing : undefined,
      source,
      action,
      description,
    }];
  });
  const backgroundMusicRaw = isRecord(raw.backgroundMusic)
    ? raw.backgroundMusic
    : isRecord(raw.background_music)
      ? raw.background_music
      : undefined;
  const backgroundMusicSource = backgroundMusicRaw?.source;
  const backgroundMusic: VideoAudioPlan["backgroundMusic"] = backgroundMusicRaw && (
    backgroundMusicSource === "native"
    || backgroundMusicSource === "post"
    || backgroundMusicSource === "none"
  ) ? {
      source: backgroundMusicSource,
      style: readPlanShotString(backgroundMusicRaw, ["style"]) || undefined,
      mood: readPlanShotString(backgroundMusicRaw, ["mood"]) || undefined,
      intensity: readPlanShotString(backgroundMusicRaw, ["intensity"]) || undefined,
    } : undefined;
  return {
    mode,
    strategy,
    needsVoiceover: typeof raw.needsVoiceover === "boolean" ? raw.needsVoiceover : typeof raw.needs_voiceover === "boolean" ? raw.needs_voiceover : mode === "voiceover" || mode === "mixed",
    needsDialogue: typeof raw.needsDialogue === "boolean" ? raw.needsDialogue : typeof raw.needs_dialogue === "boolean" ? raw.needs_dialogue : mode === "dialogue" || mode === "mixed",
    language: readPlanShotString(raw, ["language"]),
    speaker: readPlanShotString(raw, ["speaker"]),
    voiceStyle: readPlanShotString(raw, ["voiceStyle", "voice_style"]),
    lines,
    linesZh,
    linesEn,
    exactTextRequired: typeof raw.exactTextRequired === "boolean"
      ? raw.exactTextRequired
      : typeof raw.exact_text_required === "boolean"
        ? raw.exact_text_required
        : lines.length + linesZh.length + linesEn.length > 0,
    preserveNativeAudio: typeof raw.preserveNativeAudio === "boolean"
      ? raw.preserveNativeAudio
      : typeof raw.preserve_native_audio === "boolean"
        ? raw.preserve_native_audio
        : strategy !== "post_only",
    soundEffects,
    backgroundMusic,
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
    const errorMessage = readPlanShotString(item, ["errorMessage", "error_message"]);
    const imageStatusValue = readPlanShotString(item, ["imageStatus", "image_status", "status"]);
    const usesConsistencyAnchors = effectiveRequiredAnchorIds(item);
    const imageStatus = imageStatusValue === "idle" || imageStatusValue === "pending" || imageStatusValue === "running" || imageStatusValue === "ready" || imageStatusValue === "failed"
      ? imageStatusValue
      : imageUrl
        ? "ready"
        : undefined;
    const promptZh = readPlanShotString(item, ["promptZh", "prompt_zh"]);
    const promptEn = readPlanShotString(item, ["promptEn", "prompt_en"]);
    const prompt = readPlanShotString(item, ["prompt"]) || promptZh || promptEn || action || purpose;
    const planningSourceValue = readPlanShotString(item, ["planningSource", "planning_source"]);
    const planningSource = planningSourceValue === "provisional"
      || planningSourceValue === "media_conditioned"
      ? planningSourceValue
      : undefined;
    const sourceIntentMicroShotNo = Number(
      item.sourceIntentMicroShotNo ?? item.source_intent_micro_shot_no,
    );
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
      imageStatus,
      errorMessage,
      usesConsistencyAnchors,
      prompt,
      promptZh,
      promptEn,
      planningSource,
      sourceIntentMicroShotNo: Number.isInteger(sourceIntentMicroShotNo)
        ? sourceIntentMicroShotNo
        : undefined,
      resolvedRevisionId: readPlanShotString(item, ["resolvedRevisionId", "resolved_revision_id"]),
      resolvedAt: readPlanShotString(item, ["resolvedAt", "resolved_at"]),
      startBoundaryImageUrl: readPlanShotString(item, ["startBoundaryImageUrl", "start_boundary_image_url"]),
      endBoundaryImageUrl: readPlanShotString(item, ["endBoundaryImageUrl", "end_boundary_image_url"]),
    }];
  });
}

function readEffectivePlanMicroShots(
  planJson: Prisma.JsonValue | null | undefined,
  segmentNo: number,
): VideoMicroShot[] {
  const plan = isRecord(planJson) ? planJson : {};
  const findSegmentRecord = (value: unknown): Record<string, unknown> | undefined =>
    (Array.isArray(value) ? value : [])
      .filter(isRecord)
      .find((item) => Number(
        item.segmentNo
        ?? item.segment_no
        ?? item.shotNo
        ?? item.shot_no,
      ) === segmentNo);
  const media = findSegmentRecord(plan.mediaConditionedSegmentPlans);
  const mediaResolved = media?.resolvedMicroShots ?? media?.resolved_micro_shots;
  if (Array.isArray(mediaResolved)) {
    return readPlanMicroShots({ microShots: mediaResolved });
  }
  // Migrated media-conditioned checkpoints can be treated only as provisional
  // intent. They are never promoted to an executable media contract.
  const provisionalMediaCheckpoints = media?.motionCheckpoints ?? media?.motion_checkpoints;
  if (Array.isArray(provisionalMediaCheckpoints)) {
    return readPlanMicroShots({ microShots: provisionalMediaCheckpoints }).map((item) => ({
      ...item,
      planningSource: item.planningSource ?? "provisional",
    }));
  }
  const renderDescription = findSegmentRecord(plan.segmentRenderDescriptions);
  const renderResolved = renderDescription?.resolvedMicroShots
    ?? renderDescription?.resolved_micro_shots;
  if (Array.isArray(renderResolved)) {
    return readPlanMicroShots({ microShots: renderResolved });
  }
  const segment = findSegmentRecord(plan.segments);
  const segmentResolved = segment?.resolvedMicroShots ?? segment?.resolved_micro_shots;
  if (Array.isArray(segmentResolved)) {
    return readPlanMicroShots({ microShots: segmentResolved });
  }
  return readPlanMicroShots(segment).map((item) => ({
    ...item,
    planningSource: item.planningSource ?? "provisional",
  }));
}

function hasResolvedMicroShotPlan(
  planJson: Prisma.JsonValue | null | undefined,
  segmentNo: number,
): boolean {
  const plan = isRecord(planJson) ? planJson : {};
  const planningPhase = isRecord(plan.planningPhase) ? plan.planningPhase : undefined;
  if (!planningPhase || planningPhase.boundaryPlanning !== "image_approved") {
    return true;
  }
  const mediaItems: Record<string, unknown>[] = (Array.isArray(plan.mediaConditionedSegmentPlans)
    ? plan.mediaConditionedSegmentPlans
    : []).flatMap((item) => isRecord(item) ? [item] : []);
  const media = mediaItems
    .find((item) => Number(item.segmentNo ?? item.segment_no) === segmentNo);
  return Boolean(
    media
    && (
      Array.isArray(media.resolvedMicroShots)
      || Array.isArray(media.resolved_micro_shots)
      // Compatibility for projects approved before resolvedMicroShots existed.
      || Array.isArray(media.motionCheckpoints)
      || Array.isArray(media.motion_checkpoints)
    )
  );
}

export async function listVideoProjects(userId: string): Promise<VideoProjectRecord[]> {
  await logOnePromptVideo("project.list.request", { userId });
  let projects = await prisma.videoProject.findMany({
    where: { userId },
    include: PROJECT_INCLUDE,
    orderBy: { updatedAt: "desc" },
    take: 20,
  });
  projects = await Promise.all(projects.map(async (project) => ({
    ...project,
    planJson: await readArtifactPlan(project.id, {
      allowMissing: !project.planJson,
    }).catch(() => null),
  } as VideoProjectRecord)));
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

export async function listCharacterTurnaroundProjects(userId: string): Promise<VideoProjectRecord[]> {
  const projects = await prisma.videoProject.findMany({
    where: { userId, stylePreset: CHARACTER_TURNAROUND_STYLE_PRESET },
    include: PROJECT_INCLUDE,
    orderBy: { updatedAt: "desc" },
    take: 12,
  });
  return Promise.all(projects.map(async (project) => ({
    ...project,
    planJson: await readArtifactPlan(project.id, {
      allowMissing: !project.planJson,
    }).catch(() => project.planJson),
  } as VideoProjectRecord)));
}

async function ensureDemoVideoProject(userId: string): Promise<VideoProjectRecord | null> {
  const existing = await prisma.videoProject.findFirst({
    where: { userId },
    include: PROJECT_INCLUDE,
    orderBy: { updatedAt: "desc" },
  });
  if (existing) return getVideoProject(userId, existing.id);

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

async function findDemoSourceProject(userId: string): Promise<VideoProjectRecord | null> {
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
  if (byId) {
    const authority = await readArtifactPlan(byId.id);
    return { ...byId, planJson: authority } as VideoProjectRecord;
  }

  const fallback = await prisma.videoProject.findFirst({
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
  if (!fallback) return null;
  const authority = await readArtifactPlan(fallback.id);
  return { ...fallback, planJson: authority } as VideoProjectRecord;
}

async function cloneDemoSourceProject(userId: string, source: VideoProjectRecord): Promise<VideoProjectRecord> {
  const created = await prisma.$transaction(async (tx) => {
    const project = await tx.videoProject.create({
      data: {
        userId,
        status: VideoProjectStatus.DONE,
        title: source.title || DEMO_PROJECT_TITLE,
        userPrompt: source.userPrompt || DEMO_PROJECT_PROMPT,
        referenceImageUrls: cloneJsonValue(source.referenceImageUrls),
        aspectRatio: source.aspectRatio,
        durationSeconds: source.durationSeconds,
        stylePreset: source.stylePreset,
        finalVideoUrl: DEMO_PROJECT_FINAL_VIDEO_URL,
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
          qualityScore: segment.qualityScore,
          errorMessage: null,
          locked: Boolean(segment.clipUrl),
        })),
      });
    }
    return project;
  });
  if (source.planJson) {
    await commitArtifactPlan(created.id, cloneJsonValue(source.planJson));
  }
  return requireVideoProject(userId, created.id);
}

async function createFallbackDemoProject(userId: string): Promise<VideoProjectRecord> {
  const plan = fallbackDemoPlan();
  const created = await prisma.$transaction(async (tx) => {
    const project = await tx.videoProject.create({
      data: {
        userId,
        status: VideoProjectStatus.DONE,
        title: DEMO_PROJECT_TITLE,
        userPrompt: DEMO_PROJECT_PROMPT,
        referenceImageUrls: [],
        aspectRatio: "9:16",
        durationSeconds: 30,
        stylePreset: "cartoon",
        finalVideoUrl: DEMO_PROJECT_FINAL_VIDEO_URL,
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
          imagePrompt: reference.imagePromptEn ?? reference.imagePrompt,
          negativePrompt: reference.negativePrompt,
          imageUrl: referenceImageForDemoKeyframe(reference.keyframeNo),
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
          imagePrompt: keyframe.imagePromptEn ?? keyframe.imagePrompt,
          negativePrompt: keyframe.negativePrompt,
          imageUrl: referenceImageForDemoKeyframe(keyframe.keyframeNo),
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
        videoPrompt: segment.videoPromptEn ?? segment.videoPrompt,
        negativePrompt: segment.negativePrompt,
        subtitle: segment.subtitle,
        clipUrl: DEMO_PROJECT_FINAL_VIDEO_URL,
        qualityScore: 90,
        errorMessage: null,
        locked: true,
      })),
    });
    return project;
  });
  await commitArtifactPlan(created.id, plan as unknown as Prisma.JsonValue);
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
    imagePrompt: imagePromptEn,
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
    videoPrompt: videoPromptEn,
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
): Promise<VideoProjectRecord> {
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
  await commitArtifactPlan(project.id, {});
  return requireVideoProject(userId, project.id);
}

export async function createCharacterTurnaroundProject(
  userId: string,
  input: CreateCharacterTurnaroundInput,
): Promise<VideoProjectRecord> {
  const referenceImageUrl = input.referenceImageUrl?.trim();
  if (!referenceImageUrl) throw new Error("请先上传人物身份参考图");
  const characterDescription = input.characterDescription?.trim()
    || "Preserve the exact identity, face, hairstyle, body proportions, outfit, materials, colors, and accessories from the uploaded identity reference.";
  const title = input.title?.trim().slice(0, 80) || "人物三视图";
  const aspectRatio = input.aspectRatio === "1:1" || input.aspectRatio === "16:9"
    ? input.aspectRatio
    : "9:16";
  const pose = input.pose === "t_pose" ? "t_pose" : "neutral";
  const anchor: VideoConsistencyAnchor = normalizeAnchorSemantics({
    id: "turnaround-character",
    type: "person",
    displayNameZh: "人物",
    displayNameEn: "Character",
    mustStayConsistent: true,
    needsReferenceImage: true,
    referenceStrength: "hard",
    descriptionZh: characterDescription,
    descriptionEn: characterDescription,
    imagePromptZh: characterDescription,
    imagePromptEn: characterDescription,
    appliesTo: ["keyframes"],
    userEditable: true,
    status: "approved",
    assetImageContract: {
      subjectCount: 1,
      subjectDescription: characterDescription,
      composition: {
        framing: "full body",
        cameraAngle: "eye level",
        placement: "centered",
        occupancy: "the complete character remains visible from head to feet",
      },
      environment: { background: "plain white or light neutral studio background" },
      renderingStyle: {
        medium: "match the uploaded identity reference exactly",
        authority: "user_reference",
        forbiddenDrift: ["identity drift", "style drift", "outfit redesign"],
      },
      forbiddenElements: ["multiple characters", "multiple views", "collage", "text", "logo", "watermark", "interface"],
      acceptanceCriteria: ["one character only", "full body visible", "identity matches the uploaded source"],
    },
  });
  const basePlan: OnePromptVideoPlan = {
    workflowKind: "character_turnaround",
    characterPose: pose,
    title,
    logline: characterDescription,
    durationSeconds: 0,
    aspectRatio,
    keyframeCount: 0,
    segmentCount: 0,
    styleBible: {
      visualStyle: "Match the uploaded identity reference exactly",
      characterLock: characterDescription,
      colorPalette: "Match the uploaded identity reference exactly",
      negativePrompt: "identity drift, different person, different outfit, multiple characters, multiple views, collage, split screen, cropped feet, cropped head, text, logo, watermark, interface, scenery",
      negativePromptZh: "身份漂移，不同人物，不同服装，多个人物，多视图，拼图，分屏，脚部裁切，头部裁切，文字，标志，水印，界面，复杂场景",
      negativePromptEn: "identity drift, different person, different outfit, multiple characters, multiple views, collage, split screen, cropped feet, cropped head, text, logo, watermark, interface, scenery",
    },
    consistencyManifest: { anchors: [anchor] },
    assetLibrary: { items: [] },
    consistencyReferences: [],
    keyframes: [],
    segments: [],
  };
  const assetPlan = ensureProjectAssetLibrary(basePlan, {
    userPrompt: characterDescription,
    aspectRatio,
    durationSeconds: 0,
    stylePreset: CHARACTER_TURNAROUND_STYLE_PRESET,
    referenceImageUrls: [referenceImageUrl],
  });
  const plan = applyCharacterTurnaroundPoseContract(assetPlan, pose);
  ensurePlanArtifactMetadata(plan as unknown as Record<string, unknown>);
  const references = plan.consistencyReferences ?? [];
  const frontReference = references.find((reference) => reference.assetView === "front");
  if (!frontReference || references.length !== 3) {
    throw new Error("人物三视图计划创建失败：正面、侧面、背面合同不完整");
  }

  const created = await prisma.$transaction(async (tx) => {
    const project = await tx.videoProject.create({
      data: {
        userId,
        status: VideoProjectStatus.IMAGE_GENERATING,
        title,
        userPrompt: characterDescription,
        referenceImageUrls: [referenceImageUrl],
        aspectRatio,
        durationSeconds: 0,
        stylePreset: CHARACTER_TURNAROUND_STYLE_PRESET,
      },
    });
    await tx.videoKeyframe.createMany({
      data: references.map((reference) => ({
        projectId: project.id,
        keyframeNo: reference.keyframeNo,
        timeSeconds: 0,
        status: reference.assetView === "front" ? VideoShotStatus.IMAGE_PENDING : VideoShotStatus.SCRIPT_READY,
        purpose: reference.purpose,
        scene: reference.scene,
        characterState: reference.characterState,
        productState: reference.productState,
        imagePrompt: reference.imagePromptEn ?? reference.imagePrompt,
        negativePrompt: reference.negativePromptEn ?? reference.negativePrompt,
      })),
    });
    return project;
  });
  await commitArtifactPlan(created.id, plan as unknown as Prisma.JsonValue);
  await queueNextImageTask(userId, created.id, "character_turnaround.front");
  return requireVideoProject(userId, created.id);
}

export function applyCharacterTurnaroundPoseContract(
  plan: OnePromptVideoPlan,
  pose: "neutral" | "t_pose",
): OnePromptVideoPlan {
  if (pose !== "t_pose") return { ...plan, characterPose: "neutral" };
  const replaceNeutralPose = (value: string | undefined, lang: "zh" | "en") => {
    const instruction = lang === "zh" ? CHARACTER_TURNAROUND_T_POSE_ZH : CHARACTER_TURNAROUND_T_POSE_EN;
    const neutralPattern = lang === "zh" ? /中性站姿/g : /standing neutral pose/gi;
    const normalized = String(value ?? "").replace(neutralPattern, instruction).trim();
    return normalized.includes(instruction)
      ? normalized
      : [normalized, instruction].filter(Boolean).join("\n");
  };
  return {
    ...plan,
    characterPose: "t_pose",
    styleBible: {
      ...plan.styleBible,
      negativePrompt: mergeNegativePrompt(plan.styleBible.negativePrompt, CHARACTER_TURNAROUND_T_POSE_NEGATIVE_EN, "en"),
      negativePromptEn: mergeNegativePrompt(plan.styleBible.negativePromptEn ?? plan.styleBible.negativePrompt, CHARACTER_TURNAROUND_T_POSE_NEGATIVE_EN, "en"),
      negativePromptZh: mergeNegativePrompt(plan.styleBible.negativePromptZh ?? "", CHARACTER_TURNAROUND_T_POSE_NEGATIVE_ZH, "zh"),
    },
    consistencyReferences: (plan.consistencyReferences ?? []).map((reference) => {
      if (reference.assetCategory !== "person") return reference;
      return {
        ...reference,
        characterState: replaceNeutralPose(reference.characterState, "en"),
        imagePrompt: replaceNeutralPose(reference.imagePrompt, "en"),
        imagePromptEn: replaceNeutralPose(reference.imagePromptEn ?? reference.imagePrompt, "en"),
        imagePromptZh: replaceNeutralPose(reference.imagePromptZh, "zh"),
        negativePrompt: mergeNegativePrompt(reference.negativePrompt, CHARACTER_TURNAROUND_T_POSE_NEGATIVE_EN, "en"),
        negativePromptEn: mergeNegativePrompt(reference.negativePromptEn ?? reference.negativePrompt, CHARACTER_TURNAROUND_T_POSE_NEGATIVE_EN, "en"),
        negativePromptZh: mergeNegativePrompt(reference.negativePromptZh ?? "", CHARACTER_TURNAROUND_T_POSE_NEGATIVE_ZH, "zh"),
      };
    }),
  };
}

export async function getVideoProject(
  userId: string,
  projectId: string,
): Promise<VideoProjectRecord | null> {
  const project = await prisma.videoProject.findFirst({
    where: { id: projectId, userId },
    include: PROJECT_INCLUDE,
  });
  if (!project) return null;
  const authoritativePlan = await readArtifactPlan(project.id, {
    allowMissing: !project.planJson,
  });
  return {
    ...project,
    planJson: authoritativePlan,
  } as VideoProjectRecord;
}

export async function getVideoSegmentClipForDownload(
  userId: string,
  projectId: string,
  segmentId: string,
): Promise<{ title: string; segmentNo: number; clipUrl: string }> {
  const project = await requireVideoProject(userId, projectId);
  const segment = project.segments.find((item) => item.id === segmentId);
  if (!segment) throw new Error("Video segment not found");
  if (!segment.clipUrl) throw new Error("Segment video is not ready yet");
  return {
    title: project.title || "one-prompt-video",
    segmentNo: segment.segmentNo,
    clipUrl: segment.clipUrl,
  };
}

export async function updateVideoProject(
  userId: string,
  projectId: string,
  input: { title?: string; planDebugPatch?: PlanDebugPatch },
): Promise<VideoProjectRecord> {
  const project = await requireVideoProject(userId, projectId);
  const data: Prisma.VideoProjectUpdateInput = {};
  let artifactPlanUpdate: Prisma.InputJsonValue | undefined;
  if (typeof input.title === "string") data.title = input.title.trim().slice(0, 80);
  if (input.planDebugPatch && project.planJson) {
    const plan = cloneJsonRecord(project.planJson);
    applyPlanDebugPatch(plan, input.planDebugPatch);
    artifactPlanUpdate = cleanInputJson(plan);
  }

  if (!Object.keys(data).length && !artifactPlanUpdate) {
    return project;
  }

  if (Object.keys(data).length) {
    await prisma.videoProject.update({
      where: { id: projectId },
      data,
    });
  }
  if (artifactPlanUpdate) {
    await commitArtifactPlan(projectId, artifactPlanUpdate);
  }
  const updated = await requireVideoProject(userId, projectId);
  await logOnePromptVideo("project.update.success", {
    userId,
    projectId,
    updatedFields: Object.keys(data),
  });
  return updated;
}

export interface UserPlanningRouteUpdate {
  videoCategory: VideoCreativeCategory;
  templateId: VideoCreativeTemplateId;
  chronologyMode: VideoChronologyMode;
  hookMode: VideoHookMode;
  hookRevealLevel: VideoHookRevealLevel;
  requiresReturnPoint: boolean;
}

export async function updateUserPlanningRoute(
  userId: string,
  projectId: string,
  input: UserPlanningRouteUpdate,
): Promise<VideoProjectRecord> {
  const project = await requireVideoProject(userId, projectId);
  if (project.status !== VideoProjectStatus.PLAN_REVIEW) {
    throw new Error("Route Contract can only be edited during PLAN_REVIEW");
  }
  const categoryValues = Object.keys(PLANNING_ROUTE_CATEGORY_TEMPLATE_MAP);
  const templateValues = Object.values(PLANNING_ROUTE_CATEGORY_TEMPLATE_MAP).flat();
  const chronologyValues = Object.keys(PLANNING_CHRONOLOGY_HOOK_POLICY);
  const hookModeValues = ["pain_point", "curiosity", "tease", "payoff_preview"];
  const revealValues = ["none", "partial", "full"];
  if (!categoryValues.includes(input.videoCategory)) throw new Error("Invalid videoCategory");
  if (!templateValues.includes(input.templateId)) throw new Error("Invalid templateId");
  if (!chronologyValues.includes(input.chronologyMode)) throw new Error("Invalid chronologyMode");
  if (!hookModeValues.includes(input.hookMode)) throw new Error("Invalid hookMode");
  if (!revealValues.includes(input.hookRevealLevel)) throw new Error("Invalid hookRevealLevel");

  const mappingIssues = validateCategoryTemplateCombination(
    input.videoCategory,
    input.templateId,
  );
  if (mappingIssues.length) throw new Error(mappingIssues[0]?.message ?? "Invalid category/template combination");
  const hookIssues = validateChronologyHookPolicy(input);
  if (hookIssues.length) throw new Error(hookIssues[0]?.message ?? "Invalid chronology/Hook policy");

  const plan = cloneJsonRecord(project.planJson);
  const planInput = normalizePlanInput({
    userPrompt: project.userPrompt,
    aspectRatio: project.aspectRatio,
    durationSeconds: project.durationSeconds,
    stylePreset: project.stylePreset,
    referenceImageUrls: jsonStringArray(project.referenceImageUrls),
  });
  const rawCheckpoint = isRecord(plan.plannerCheckpoint)
    ? plan.plannerCheckpoint
    : {};
  const checkpoint = normalizeAliyunStoryboardPlannerCheckpoint(
    rawCheckpoint,
    planInput,
  );
  const previousRoute = checkpoint.routeClassification?.routeContract
    ?? (isRecord(plan.approvedRouteContract)
      && plan.approvedRouteContract.version === "planning-route-v1"
      ? plan.approvedRouteContract as ApprovedPlanningRouteContract
      : undefined);
  if (!previousRoute) throw new Error("Approved Route Contract is missing");

  const routeContract: ApprovedPlanningRouteContract = {
    ...previousRoute,
    videoCategory: input.videoCategory,
    templateId: input.templateId,
    chronologyMode: input.chronologyMode,
    hookMode: input.hookMode,
    hookRevealLevel: input.hookRevealLevel,
    requiresReturnPoint: input.requiresReturnPoint,
    categoryReason: input.videoCategory === previousRoute.videoCategory
      ? previousRoute.categoryReason
      : "用户在 PLAN_REVIEW 中手动选择视频品类。",
    templateReason: input.templateId === previousRoute.templateId
      ? previousRoute.templateReason
      : "用户在 PLAN_REVIEW 中手动选择叙事模板。",
    chronologyReason: input.chronologyMode === previousRoute.chronologyMode
      ? previousRoute.chronologyReason
      : "用户在 PLAN_REVIEW 中手动选择时间顺序和 Hook policy。",
  };
  const changes = comparePlanningRouteContracts(previousRoute, routeContract);
  applyManualPlanningRouteClassification({
    checkpoint,
    input: planInput,
    referenceFactsRaw: checkpoint.referenceFactsRaw,
    routeContract,
    editorName: "user",
  });
  plan.plannerCheckpoint = checkpoint;
  plan.approvedRouteContract = routeContract;
  const creativeStrategy = isRecord(plan.creativeStrategy)
    ? { ...plan.creativeStrategy }
    : isRecord(plan.creative_strategy)
      ? { ...plan.creative_strategy }
      : {};
  plan.creativeStrategy = {
    ...creativeStrategy,
    videoCategory: routeContract.videoCategory,
    templateId: routeContract.templateId,
    chronologyMode: routeContract.chronologyMode,
    hookMode: routeContract.hookMode,
    hookRevealLevel: routeContract.hookRevealLevel,
  };
  delete plan.creative_strategy;
  if (changes.invalidateProductionContent) {
    markPlanArtifactsDirty(
      plan,
      [
        "planning:creative_strategy",
        "planning:narrative_events",
        "planning:timeline",
        "planning:consistency_manifest",
      ],
      "User changed the locked Route Contract; Planning and every downstream artifact must be regenerated.",
    );
  }
  await commitArtifactPlan(projectId, cleanInputJson(plan));
  await logOnePromptVideo("planning.route.user_override", {
    userId,
    projectId,
    authority: "user",
    locked: true,
    videoCategory: routeContract.videoCategory,
    templateId: routeContract.templateId,
    chronologyMode: routeContract.chronologyMode,
    hookMode: routeContract.hookMode,
    hookRevealLevel: routeContract.hookRevealLevel,
    requiresReturnPoint: routeContract.requiresReturnPoint,
    changedFields: changes.changedFields,
    invalidationBoundary: changes.checkpointBoundary,
  });
  return changes.invalidateProductionContent
    ? queueVideoProjectPlanning(userId, projectId)
    : requireVideoProject(userId, projectId);
}

export async function deleteVideoProject(userId: string, projectId: string): Promise<void> {
  await logOnePromptVideo("project.delete.start", { userId, projectId });
  try {
    // Deletion must remain available precisely when a project's plan or
    // artifact authority is corrupt. Do not hydrate, migrate, or validate the
    // project before deleting it. The compound filter is also an idempotent
    // ownership check: an absent/already-deleted project is a successful no-op.
    const result = await prisma.videoProject.deleteMany({
      where: { id: projectId, userId },
    });
    await logOnePromptVideo("project.delete.success", {
      userId,
      projectId,
      deleted: result.count > 0,
      alreadyAbsent: result.count === 0,
    });
  } catch (error) {
    await logOnePromptVideo("project.delete.error", { userId, projectId, ...errorForLog(error) }, "error");
    throw error;
  }
}

export async function cancelVideoProject(
  userId: string,
  projectId: string,
  audit?: { cancelIntentId: string; confirmedAt: string; userAgent?: string },
): Promise<VideoProjectRecord> {
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
        errorMessage: MANUAL_STOP_MESSAGE,
      },
      include: PROJECT_INCLUDE,
    });
  });

  await logOnePromptVideo("project.cancel.success", { userId, projectId, status: updated.status });
  return updated;
}

async function requeueExistingCandidateAfterReferenceSelection(
  project: VideoProjectRecord,
  artifactId: string,
): Promise<boolean> {
  const candidate = project.generationCandidates
    .filter((item) =>
      item.artifactId === artifactId
      && item.kind !== "segment_video"
      && Boolean(item.mediaUrl)
      && item.qualityReport
      && isRecord(item.qualityReport)
      && isReferenceMissingQualityEvaluation(item.qualityReport as unknown as GenerationQualityReport)
    )
    .sort((left, right) => right.candidateNo - left.candidateNo)[0];
  if (!candidate) return false;

  const metadata = candidateMetadata(candidate.metadata);
  let referenceSelection: { urls: string[]; output: ReferenceSelectionOutput };
  if (candidate.kind === "keyframe_image") {
    const keyframe = project.keyframes.find((item) => item.id === candidate.targetId);
    if (!keyframe) return false;
    referenceSelection = await selectReferenceImagesForKeyframe(project, keyframe, candidate.prompt);
  } else {
    const segmentNo = Number(metadata.segmentNo);
    const microShotNo = Number(metadata.microShotNo);
    const segment = project.segments.find((item) => item.segmentNo === segmentNo);
    const microShot = segment
      ? readEffectivePlanMicroShots(project.planJson, segmentNo).find((item) => item.microShotNo === microShotNo)
      : undefined;
    if (!segment || !microShot) return false;
    referenceSelection = await selectReferenceImagesForMicroShot(
      project,
      segment,
      microShot,
      candidate.prompt,
    );
  }

  await saveReferenceSelectionOutput(project.id, referenceSelection.output);
  const selectedReferenceUrls = uniqueStrings([
    ...referenceSelection.urls,
    ...(referenceSelection.output.selectedReferenceUrls ?? []),
  ]);
  const referenceUsageNotes = uniqueStrings([
    ...stringArrayValue(metadata.referenceUsageNotes),
    ...(referenceSelection.output.usageNotes ?? []),
  ]);
  const requeued = await prisma.videoGenerationCandidate.updateMany({
    where: {
      id: candidate.id,
      artifactId,
      mediaUrl: { not: null },
    },
    data: {
      status: "quality_retry",
      passed: null,
      compositeScore: null,
      retryInstruction: null,
      errorMessage: null,
      metadata: cleanInputJson({
        ...metadata,
        selectedReferenceUrls,
        referenceUsageNotes,
        qualityNextRetryAt: new Date().toISOString(),
        referenceSelectionRetriedAt: new Date().toISOString(),
      }),
    },
  });
  if (requeued.count !== 1) return false;

  await updateGenerationTargetForTechnicalQualityRetry(project, candidate, false, "");
  await updateProjectArtifactStatus(project.id, [artifactId], "generating", {
    retryFromStage: "reference_selector",
  });
  await prisma.videoProject.update({
    where: { id: project.id },
    data: { status: VideoProjectStatus.IMAGE_GENERATING, errorMessage: null },
  });
  return true;
}

export async function continueVideoProjectTaskGraph(
  userId: string,
  projectId: string,
  expectedNodeId: string,
): Promise<VideoProjectRecord> {
  const project = await requireVideoProject(userId, projectId);
  const graph = buildProjectTaskGraph(project, readVideoPlanningProgress(project.planJson));
  if (!expectedNodeId || graph.currentNode !== expectedNodeId) {
    throw structuredCommandError(
      "TASK_GRAPH_NODE_CONFLICT",
      `Expected task graph node ${expectedNodeId || "<missing>"}, current node is ${graph.currentNode || "<complete>"}`,
      "state",
      "REFRESH_PROJECT",
    );
  }
  if (!graph.allowedActions.includes("RESUME_CURRENT_NODE")) {
    throw structuredCommandError(
      "TASK_GRAPH_CONTINUE_NOT_ALLOWED",
      `Task graph node ${expectedNodeId} does not allow continue`,
      "state",
      graph.allowedActions.includes("APPROVE_CURRENT_NODE")
        ? "APPROVE_CURRENT_NODE"
        : "REFRESH_PROJECT",
    );
  }
  await logOnePromptVideo("task_graph.continue.command", {
    userId,
    projectId,
    expectedNodeId,
  });
  if (expectedNodeId === "planning") {
    return queueVideoProjectPlanning(userId, projectId);
  }
  if (expectedNodeId.startsWith("asset-image:") || expectedNodeId.startsWith("boundary-image:")) {
    await queueNextImageTask(userId, projectId, `task_graph:${expectedNodeId}`, {
      reactivateFailed: true,
    });
    return requireVideoProject(userId, projectId);
  }
  if (expectedNodeId.startsWith("micro-image:")) {
    await queueRequiredMicroShotImageTasks(userId, projectId, { retryFailed: true });
    return requireVideoProject(userId, projectId);
  }
  if (expectedNodeId.startsWith("segment-video:")) {
    await queueNextClipTask(userId, projectId, `task_graph:${expectedNodeId}`);
    return requireVideoProject(userId, projectId);
  }
  if (expectedNodeId === "composition") {
    return composeVideoProject(userId, projectId);
  }
  throw structuredCommandError(
    "TASK_GRAPH_COMMAND_UNSUPPORTED",
    `Task graph node ${expectedNodeId} has no continue command`,
    "state",
    "REFRESH_PROJECT",
  );
}

export async function retryVideoProductionJobCommand(
  userId: string,
  projectId: string,
  jobId: string,
): Promise<VideoProjectRecord> {
  const project = await requireVideoProject(userId, projectId);
  const job = project.productionJobs.find((item) => item.id === jobId);
  if (!job || job.status !== "failed") {
    throw structuredCommandError(
      "RETRY_JOB_NOT_ALLOWED",
      "The requested failed job does not exist or is no longer retryable",
      "state",
      "REFRESH_PROJECT",
    );
  }
  if (job.recoveryAction === "REPAIR_CONTRACT") {
    throw structuredCommandError(
      "CONTRACT_REPAIR_REQUIRED",
      "This job requires contract repair rather than a transport retry",
      "contract",
      "REPAIR_CONTRACT",
      { targetId: job.targetId, artifactId: job.artifactId ?? undefined },
    );
  }
  const retried = await retryFailedVideoProductionJobById({
    id: job.id,
    projectId,
    userId,
  });
  if (!retried) {
    throw structuredCommandError(
      "RETRY_JOB_CONFLICT",
      "The job changed before the retry command was committed",
      "state",
      "REFRESH_PROJECT",
    );
  }
  await persistProjectProductionProjection(projectId);
  return requireVideoProject(userId, projectId);
}

export async function repairVideoProjectContract(
  userId: string,
  projectId: string,
  jobId: string,
): Promise<VideoProjectRecord> {
  const project = await requireVideoProject(userId, projectId);
  const job = project.productionJobs.find((item) => item.id === jobId);
  if (
    !job
    || job.status !== "failed"
    || job.recoveryAction !== "REPAIR_CONTRACT"
  ) {
    throw structuredCommandError(
      "REPAIR_CONTRACT_NOT_ALLOWED",
      "The requested job is not waiting for contract repair",
      "state",
      "REFRESH_PROJECT",
    );
  }
  await prisma.videoProductionJob.updateMany({
    where: {
      id: job.id,
      projectId,
      userId,
      status: "failed",
    },
    data: {
      status: "cancelled",
      recoveryAction: "CONTRACT_REPAIR_QUEUED",
      completedAt: new Date(),
    },
  });
  return queueVideoProjectPlanning(userId, projectId);
}

/**
 * Legacy compatibility only. New clients must call a single-purpose command
 * endpoint. Keeping this implementation isolated prevents new UI code from
 * depending on the former heuristic dispatcher.
 */
export async function queueVideoProjectPlanning(
  userId: string,
  projectId: string,
  override?: Partial<CreateVideoProjectInput>,
): Promise<VideoProjectRecord> {
  const project = await requireVideoProject(userId, projectId);

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
    if (existingProgress?.taskId) {
      await enqueueVideoProductionJob({
        userId,
        projectId,
        kind: "planning",
        stage: "planning",
        targetId: projectId,
        idempotencyKey: `planning:${projectId}:${existingProgress.taskId}`,
        payload: cleanInputJson({ taskId: existingProgress.taskId, input }),
        priority: 100,
        maxAttempts: 3,
      });
    }
    await logOnePromptVideo("project.plan.active_lease_reused", {
      userId,
      projectId,
      taskId: existingProgress?.taskId,
      workerId: existingProgress?.workerId,
      leaseExpiresAt: existingProgress?.leaseExpiresAt,
    });
    return requireVideoProject(userId, projectId);
  }
  const taskId = project.status === VideoProjectStatus.PLANNING && existingProgress?.taskId
    ? existingProgress.taskId
    : randomUUID();
  const now = new Date().toISOString();
  const rawCheckpoint = isRecord(project.planJson) && isRecord(project.planJson.plannerCheckpoint)
    ? project.planJson.plannerCheckpoint
    : undefined;
  const checkpoint = rawCheckpoint
    ? normalizeAliyunStoryboardPlannerCheckpoint(rawCheckpoint, input)
    : undefined;
  const resumeProgress = planningCheckpointResumeProgress(checkpoint, input.referenceImageUrls.length);
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
        stage: resumeProgress?.stage ?? "queued",
        completedSteps: resumeProgress?.completedSteps ?? 0,
        totalSteps: resumeProgress?.totalSteps ?? 4,
        completedSegments: resumeProgress?.completedSegments ?? 0,
        totalSegments: resumeProgress?.totalSegments ?? 0,
        detailZh: resumeProgress?.detailZh ?? "规划任务已进入后台队列，页面可以安全轮询真实进度。",
        detailEn: resumeProgress?.detailEn ?? "The planning job is queued in the background. The page can safely poll real progress.",
        startedAt: now,
        updatedAt: now,
        metrics: {
          jsonRepairCount: 0,
          jsonRepairDurationMs: 0,
          singleTakeRepairCount: 0,
          singleTakeRepairDurationMs: 0,
          storyContractRepairCount: 0,
          storyContractRepairDurationMs: 0,
        },
      };

  await prisma.videoProject.update({
    where: { id: projectId },
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
  await commitArtifactPlan(projectId, {
    ...(isRecord(project.planJson) ? project.planJson : {}),
    ...(checkpoint ? { plannerCheckpoint: checkpoint } : {}),
    plannerProgress,
  });
  await queuePlanningPerformanceRun({
    taskId,
    projectId,
    userId,
    plannerArch: CURRENT_PLANNER_ARCH,
    durationSeconds: input.durationSeconds,
    referenceImageCount: input.referenceImageUrls.length,
    checkpointResume: Boolean(checkpoint),
    queuedAt: new Date(now),
  });

  const durable = await enqueueVideoProductionJob({
    userId,
    projectId,
    kind: "planning",
    stage: "planning",
    targetId: projectId,
    idempotencyKey: `planning:${projectId}:${taskId}`,
    payload: cleanInputJson({ taskId, input }),
    priority: 100,
    maxAttempts: 3,
  });
  await logOnePromptVideo("project.plan.queued", {
    userId,
    projectId,
    taskId,
    durableJobId: durable.id,
    durableJobCreated: durable.created,
  });
  // Return a read-after-enqueue snapshot. A snapshot fetched before the
  // durable job existed made planning look blocked and could surface an empty
  // downstream review gate as the current operation.
  return requireVideoProject(userId, projectId);
}

export async function planVideoProject(
  userId: string,
  projectId: string,
  override?: Partial<CreateVideoProjectInput>,
  internal?: {
    planningTaskId?: string;
    planningAttemptNumber?: number;
    planningAttemptQueuedAt?: Date;
  },
): Promise<VideoProjectRecord> {
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
  const performanceTaskId = internal?.planningTaskId ?? claimedProgress?.taskId ?? randomUUID();
  if (!internal?.planningTaskId && !claimedProgress?.taskId) {
    await queuePlanningPerformanceRun({
      taskId: performanceTaskId,
      projectId,
      userId,
      plannerArch: CURRENT_PLANNER_ARCH,
      durationSeconds: input.durationSeconds,
      referenceImageCount: input.referenceImageUrls.length,
      checkpointResume: Boolean(project.planJson),
    });
  }
  const performanceAttempt = await startPlanningPerformanceRun(performanceTaskId, {
    attemptNumber: internal?.planningAttemptNumber,
    queuedAt: internal?.planningAttemptQueuedAt,
    checkpointResume: Boolean(project.planJson),
  });
  const performanceAttemptTaskId = performanceAttempt.taskId;
  await logOnePromptVideo("project.plan.start", {
    userId,
    projectId,
    status: project.status,
    plannerArch: CURRENT_PLANNER_ARCH,
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
      plannerArch: CURRENT_PLANNER_ARCH,
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
    await finishPlanningPerformanceRun({
      taskId: performanceAttemptTaskId,
      status: "cancelled",
      failureStage: "claim",
      errorCategory: "planning_claim_lost",
    });
    return latest;
  }
  let planningStateWrite = Promise.resolve();
  let plannerProgress = claimedProgress;
  const performanceCounters: PlanningProgressCounters = {
    jsonRepairCount: 0,
    jsonRepairDurationMs: 0,
    singleTakeRepairCount: 0,
    singleTakeRepairDurationMs: 0,
    storyContractRepairCount: 0,
    storyContractRepairDurationMs: 0,
  };
  const writePlanningEnvelope = (patch: Record<string, unknown>): Promise<void> => {
    planningStateWrite = planningStateWrite.then(async () => {
      const current = await prisma.videoProject.findUnique({
        where: { id: project.id },
        select: { status: true },
      });
      if (!current || current.status !== VideoProjectStatus.PLANNING) return;
      const authority = await readArtifactPlan(project.id, { allowMissing: true });
      const currentEnvelope = isRecord(authority) ? authority : {};
      const activeProgress = readVideoPlanningProgress(authority);
      if (internal?.planningTaskId && activeProgress?.taskId !== internal.planningTaskId) return;
      await commitArtifactPlan(project.id, {
        ...currentEnvelope,
        ...patch,
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
        storyContractRepairCount: 0,
        storyContractRepairDurationMs: 0,
      },
    };
    const delta = update.metricsDelta ?? {};
    performanceCounters.jsonRepairCount += delta.jsonRepairCount ?? 0;
    performanceCounters.jsonRepairDurationMs += delta.jsonRepairDurationMs ?? 0;
    performanceCounters.singleTakeRepairCount += delta.singleTakeRepairCount ?? 0;
    performanceCounters.singleTakeRepairDurationMs += delta.singleTakeRepairDurationMs ?? 0;
    performanceCounters.storyContractRepairCount += delta.storyContractRepairCount ?? 0;
    performanceCounters.storyContractRepairDurationMs += delta.storyContractRepairDurationMs ?? 0;
    plannerProgress = {
      ...previous,
      workerId: planningWorkerId,
      heartbeatAt: now,
      leaseExpiresAt: new Date(Date.now() + PLANNING_LEASE_MS).toISOString(),
      status: update.stage === "complete" ? "completed" : update.stage === "failed" ? "failed" : "running",
      stage: update.stage,
      completedSteps: Math.max(previous.completedSteps, update.completedSteps ?? previous.completedSteps),
      totalSteps: Math.max(previous.totalSteps, update.totalSteps ?? previous.totalSteps),
      currentSegmentNo: update.currentSegmentNo ?? previous.currentSegmentNo,
      completedSegments: Math.max(previous.completedSegments, update.completedSegments ?? previous.completedSegments),
      totalSegments: Math.max(previous.totalSegments, update.totalSegments ?? previous.totalSegments),
      attempt: update.attempt ?? previous.attempt,
      detailZh: update.detailZh ?? previous.detailZh,
      detailEn: update.detailEn ?? previous.detailEn,
      updatedAt: now,
      metrics: {
        jsonRepairCount: previous.metrics.jsonRepairCount + (delta.jsonRepairCount ?? 0),
        jsonRepairDurationMs: previous.metrics.jsonRepairDurationMs + (delta.jsonRepairDurationMs ?? 0),
        singleTakeRepairCount: previous.metrics.singleTakeRepairCount + (delta.singleTakeRepairCount ?? 0),
        singleTakeRepairDurationMs: previous.metrics.singleTakeRepairDurationMs + (delta.singleTakeRepairDurationMs ?? 0),
        storyContractRepairCount: previous.metrics.storyContractRepairCount + (delta.storyContractRepairCount ?? 0),
        storyContractRepairDurationMs: previous.metrics.storyContractRepairDurationMs + (delta.storyContractRepairDurationMs ?? 0),
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
    plan = await createCurrentVideoPlan(input, { userId, projectId }, {
      checkpoint: project.planJson,
      onCheckpoint: savePlannerCheckpoint,
      onProgress: savePlannerProgress,
      onStageMetric: (metric) => recordPlanningStageObservation(performanceAttemptTaskId, metric),
    });
    plan = ensureProjectAssetLibrary(plan, input);
    plan = purgePlanSoftAnchorConflicts(plan).plan;
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
    await finishPlanningPerformanceRun({
      taskId: performanceAttemptTaskId,
      status: "failed",
      failureStage: plannerProgress?.stage,
      errorCategory: planningErrorCategory(error),
      counters: performanceCounters,
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
          imagePrompt: reference.imagePromptEn ?? reference.imagePrompt,
          negativePrompt: reference.negativePrompt,
          imageUrl: preserved?.imageUrl ?? null,
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
          imagePrompt: keyframe.imagePromptEn ?? keyframe.imagePrompt,
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
        videoPrompt: segment.videoPromptEn ?? segment.videoPrompt,
        negativePrompt: segment.negativePrompt,
        subtitle: segment.subtitle,
      })),
    });
    materializeTransitionProductionArtifacts(plan, project.planJson);
    ensurePlanArtifactMetadata(plan as unknown as Record<string, unknown>);
    const updated = await tx.videoProject.update({
      where: { id: project.id },
      data: {
        status: VideoProjectStatus.PLAN_REVIEW,
        title: plan.title,
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
  await commitArtifactPlan(appliedProject.id, plan as unknown as Prisma.JsonValue);
  const authoritativeAppliedProject = await requireVideoProject(userId, projectId);
  await finishPlanningPerformanceRun({
    taskId: performanceAttemptTaskId,
    status: isManuallyStopped(authoritativeAppliedProject) ? "cancelled" : "completed",
    segmentCount: authoritativeAppliedProject.segments.length,
    counters: performanceCounters,
  });
  return authoritativeAppliedProject;
}

async function updateVideoEntity(
  userId: string,
  projectId: string,
  entityId: string,
  input: UpdateShotInput,
  entityKind: "segment" | "keyframe",
): Promise<VideoProjectRecord> {
  const project = await requireVideoProject(userId, projectId);
  const shotId = entityId;
  let unlockedParentKeyframeNo: number | undefined;
  let changedAssetApproval: { keyframeNo: number; approved: boolean } | undefined;
  let removedMicroShotArtifactIds: string[] = [];
  const segment = entityKind === "segment"
    ? project.segments.find((item) => item.id === shotId)
    : undefined;
  const updatedFields: string[] = [];
  const imagePromptEditContract = input.imagePromptEditContract
    ? normalizeImagePromptEditContract(input.imagePromptEditContract)
    : undefined;
  if (imagePromptEditContract) {
    const contractErrors = validateImagePromptEditContract(imagePromptEditContract);
    if (contractErrors.length) {
      throw new Error(`图片生成合同校验失败：${contractErrors.join(", ")}`);
    }
  }
  const compiledProviderImagePrompt = imagePromptEditContract
    ? compileImagePromptForProvider(imagePromptEditContract)
    : undefined;
  if (segment) {
    if (Array.isArray(input.microShots)) {
      const previousMicroShots = readEffectivePlanMicroShots(project.planJson, segment.segmentNo);
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
    if (compiledProviderImagePrompt || typeof input.imagePrompt === "string") {
      await prisma.videoKeyframe.updateMany({
        where: { projectId, keyframeNo: segment.startKeyframeNo },
        data: { imagePrompt: compiledProviderImagePrompt ?? input.imagePrompt },
      });
      updatedFields.push("imagePrompt");
    }
    if (Array.isArray(input.microShots)) updatedFields.push("microShots");
    await syncCanonicalPlanFromEntities(projectId, {
      shotId,
      locale: input.locale,
      microShots: input.microShots,
      purposeUpdated: typeof input.purpose === "string",
      imagePromptUpdated: Boolean(compiledProviderImagePrompt) || typeof input.imagePrompt === "string",
      imagePromptEditContract,
      negativePromptUpdated: typeof input.negativePrompt === "string",
    });
  } else {
    const keyframe = entityKind === "keyframe"
      ? project.keyframes.find((item) => item.id === shotId)
      : undefined;
    if (keyframe) {
      const data: Prisma.VideoKeyframeUpdateInput = {};
      if (typeof input.purpose === "string") data.purpose = input.purpose;
      if (compiledProviderImagePrompt || typeof input.imagePrompt === "string") {
        data.imagePrompt = compiledProviderImagePrompt ?? input.imagePrompt;
      }
      if (typeof input.negativePrompt === "string") data.negativePrompt = input.negativePrompt;
      if (typeof input.locked === "boolean") {
        data.locked = input.locked;
        data.status = input.locked
          ? VideoShotStatus.IMAGE_APPROVED
          : keyframe.imageUrl
            ? VideoShotStatus.IMAGE_READY
            : VideoShotStatus.SCRIPT_READY;
        const reference = readPlanConsistencyReferenceMap(project.planJson).get(keyframe.keyframeNo);
        if (keyframe.keyframeNo < 0) {
          changedAssetApproval = {
            keyframeNo: keyframe.keyframeNo,
            approved: input.locked,
          };
        }
        if (!input.locked && keyframe.keyframeNo >= 0) unlockedParentKeyframeNo = keyframe.keyframeNo;
      }
      if (Object.keys(data).length) {
        await prisma.videoKeyframe.update({ where: { id: shotId, projectId }, data });
        updatedFields.push(...Object.keys(data));
      }
      const canonicalPlanChanged = typeof input.purpose === "string"
        || Boolean(compiledProviderImagePrompt)
        || typeof input.imagePrompt === "string"
        || typeof input.negativePrompt === "string";
      if (canonicalPlanChanged) {
        await syncCanonicalPlanFromEntities(projectId, {
          shotId,
          locale: input.locale,
          purposeUpdated: typeof input.purpose === "string",
          imagePromptUpdated: Boolean(compiledProviderImagePrompt) || typeof input.imagePrompt === "string",
          imagePromptEditContract,
          negativePromptUpdated: typeof input.negativePrompt === "string",
        });
      }
    } else {
      throw new Error(entityKind === "segment" ? "Video segment not found" : "Video keyframe not found");
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
    await invalidateMediaPlanningForBoundary(projectId, unlockedParentKeyframeNo);
    await invalidateTransitionReferencesForParent(projectId, unlockedParentKeyframeNo, "Parent-camera keyframe was unlocked; transition reference approval must be renewed.");
  }
  let updatedProject = await requireVideoProject(userId, projectId);
  if (changedAssetApproval) {
    const assetArtifactId = imageArtifactIdForKeyframeNo(changedAssetApproval.keyframeNo);
    if (changedAssetApproval.approved) {
      await updateProjectArtifactStatus(projectId, [assetArtifactId], "approved", {
        retryFromStage: "generation",
        userAccepted: true,
      });
    } else {
      await markProjectArtifactsDirty(
        projectId,
        [assetArtifactId],
        "An asset reference was unlocked; dependent boundary images remain visible but must be regenerated after the asset is approved again.",
      );
    }
    updatedProject = await requireVideoProject(userId, projectId);
    await bindApprovedAssetsIntoBoundaryPlan(updatedProject);
    updatedProject = await requireVideoProject(userId, projectId);

    const dependencyReadyBoundaryNos = updatedProject.keyframes
      .filter((keyframe) =>
        keyframe.keyframeNo >= 0
        && !keyframe.imageUrl
        && isBoundaryAssetDependencyReady(updatedProject, keyframe.keyframeNo)
      )
      .map((keyframe) => keyframe.keyframeNo);
    if (dependencyReadyBoundaryNos.length) {
      await prisma.videoKeyframe.updateMany({
        where: {
          projectId,
          keyframeNo: { in: dependencyReadyBoundaryNos },
          imageUrl: null,
          NOT: { status: VideoShotStatus.IMAGE_RUNNING },
        },
        data: {
          status: VideoShotStatus.IMAGE_PENDING,
          errorMessage: null,
        },
      });
    }

    const hasReadyDerivedViews = changedAssetApproval.approved && updatedProject.keyframes.some((keyframe) =>
      keyframe.keyframeNo < 0 && !keyframe.imageUrl && isAssetViewGenerationReady(updatedProject, keyframe.keyframeNo)
    );
    if (hasReadyDerivedViews || dependencyReadyBoundaryNos.length) {
      updatedProject = await prisma.videoProject.update({
        where: { id: projectId },
        data: { status: VideoProjectStatus.IMAGE_GENERATING, errorMessage: null },
        include: PROJECT_INCLUDE,
      });
      await queueNextImageTask(
        userId,
        projectId,
        changedAssetApproval.approved
          ? "asset_library.asset_approved"
          : "asset_library.asset_unlocked",
      );
    }
    if (
      isCharacterTurnaroundProject(updatedProject.planJson)
      && updatedProject.keyframes.filter((keyframe) => keyframe.keyframeNo < 0).every(isApprovedConsistencyReference)
    ) {
      updatedProject = await prisma.videoProject.update({
        where: { id: projectId },
        data: { status: VideoProjectStatus.DONE, errorMessage: null },
        include: PROJECT_INCLUDE,
      });
    }
  }
  return updatedProject;
}

export async function updateVideoSegment(
  userId: string,
  projectId: string,
  segmentId: string,
  input: UpdateShotInput,
): Promise<VideoProjectRecord> {
  return updateVideoEntity(userId, projectId, segmentId, input, "segment");
}

export async function updateVideoKeyframe(
  userId: string,
  projectId: string,
  keyframeId: string,
  input: UpdateShotInput,
): Promise<VideoProjectRecord> {
  return updateVideoEntity(userId, projectId, keyframeId, input, "keyframe");
}

export async function approveVideoPlan(userId: string, projectId: string): Promise<VideoProjectRecord> {
  const project = await requireVideoProject(userId, projectId);
  const assetKeyframes = project.keyframes.filter((keyframe) =>
    isConsistencyKeyframeNo(keyframe.keyframeNo)
    && isEligibleConsistencyKeyframe(project.planJson, keyframe.keyframeNo)
  );
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
      ? "Generate and review asset-library references. Each boundary keyframe starts as soon as its own required assets are approved."
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
      ...(assetLibraryFirst ? { id: { in: assetKeyframes.map((keyframe) => keyframe.id) } } : {}),
      NOT: { locked: true, imageUrl: { not: null } },
    },
    data: {
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
  await queueNextImageTask(
    userId,
    projectId,
    assetLibraryFirst ? "asset_library.batch" : "image.batch",
  );
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
      ? "Asset-library reference image tasks were submitted upstream. Dependency-ready boundary keyframes can start after individual asset approval."
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
        hasImageUrl: Boolean(keyframe.imageUrl),
      })),
    },
  });
  return updated;
}

export async function approveAssetLibrary(userId: string, projectId: string): Promise<VideoProjectRecord> {
  const project = await requireVideoProject(userId, projectId);
  const assetKeyframes = project.keyframes.filter((keyframe) =>
    isConsistencyKeyframeNo(keyframe.keyframeNo)
    && isEligibleConsistencyKeyframe(project.planJson, keyframe.keyframeNo)
  );
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
    where: { projectId, id: { in: assetKeyframes.map((keyframe) => keyframe.id) }, imageUrl: { not: null } },
    data: { status: VideoShotStatus.IMAGE_APPROVED, locked: true, errorMessage: null },
  });
  await updateProjectArtifactStatus(
    projectId,
    assetKeyframes.map((keyframe) => imageArtifactIdForKeyframeNo(keyframe.keyframeNo)),
    "approved",
    { retryFromStage: "generation" },
  );
  await bindApprovedAssetsIntoBoundaryPlan(await requireVideoProject(userId, projectId));

  const latest = await requireVideoProject(userId, projectId);
  const missingBoundaryKeyframes = latest.keyframes.filter((keyframe) => !isConsistencyKeyframeNo(keyframe.keyframeNo) && !keyframe.imageUrl);
  if (missingBoundaryKeyframes.length) {
    await prisma.videoKeyframe.updateMany({
      where: { projectId, keyframeNo: { gt: 0 }, imageUrl: null },
      data: {
        status: VideoShotStatus.IMAGE_PENDING,
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
    await queueNextImageTask(userId, projectId, "asset_library.approve");
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
  repairMode: ImageRepairMode;
  repairDecision?: ImageRepairDecision;
  baselineSelection: ImageBaselineSelectionDecision;
  promptAddon: string;
  referenceImageUrls: string[];
  referenceUsageNotes: string[];
  debugSummary: Record<string, unknown>;
};

export type ImageBaselineCandidateSnapshot = {
  id: string;
  candidateNo: number;
  createdAtMs: number;
  parentCandidateId?: string;
  structurallyUsable: boolean;
  catastrophicRegressionReasons: string[];
  regressionAgainstParent: boolean;
};

export type ImageBaselineSelectionDecision = {
  latestCandidateId?: string;
  baselineCandidateId?: string;
  baselineUsable: boolean;
  regressionAgainstParent: boolean;
  catastrophicRegressionReasons: string[];
  fallbackDepth: number;
  selectionRule: "latest_usable_candidate_then_nearest_usable_ancestor";
};

export function selectLatestUsableImageBaseline(
  candidates: ImageBaselineCandidateSnapshot[],
): ImageBaselineSelectionDecision {
  const ordered = [...candidates].sort((a, b) =>
    b.candidateNo - a.candidateNo || b.createdAtMs - a.createdAtMs
  );
  const latest = ordered[0];
  if (!latest) {
    return {
      baselineUsable: false,
      regressionAgainstParent: false,
      catastrophicRegressionReasons: [],
      fallbackDepth: 0,
      selectionRule: "latest_usable_candidate_then_nearest_usable_ancestor",
    };
  }

  const byId = new Map(ordered.map((candidate) => [candidate.id, candidate]));
  const visited = new Set<string>();
  let cursor: ImageBaselineCandidateSnapshot | undefined = latest;
  let fallbackDepth = 0;
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    if (cursor.structurallyUsable && cursor.catastrophicRegressionReasons.length === 0) {
      return {
        latestCandidateId: latest.id,
        baselineCandidateId: cursor.id,
        baselineUsable: true,
        regressionAgainstParent: latest.regressionAgainstParent,
        catastrophicRegressionReasons: latest.catastrophicRegressionReasons,
        fallbackDepth,
        selectionRule: "latest_usable_candidate_then_nearest_usable_ancestor",
      };
    }
    const explicitParent: ImageBaselineCandidateSnapshot | undefined =
      cursor.parentCandidateId ? byId.get(cursor.parentCandidateId) : undefined;
    cursor = explicitParent ?? ordered.find((candidate) => candidate.candidateNo < cursor!.candidateNo);
    fallbackDepth += 1;
  }

  return {
    latestCandidateId: latest.id,
    baselineUsable: false,
    regressionAgainstParent: latest.regressionAgainstParent,
    catastrophicRegressionReasons: latest.catastrophicRegressionReasons,
    fallbackDepth,
    selectionRule: "latest_usable_candidate_then_nearest_usable_ancestor",
  };
}

function buildImageCandidateLearningSummary(
  project: VideoProjectRecord,
  artifactId: string,
  currentImageUrl?: string | null,
): ImageCandidateLearningSummary {
  const historical = project.generationCandidates.filter((candidate) => candidate.artifactId === artifactId);
  const evaluated = historical.flatMap((candidate) => {
    if (!candidate.qualityReport || !isRecord(candidate.qualityReport)) return [];
    return [{ candidate, report: candidate.qualityReport as unknown as GenerationQualityReport }];
  });
  const latestEvaluated = [...evaluated].sort((a, b) => b.candidate.candidateNo - a.candidate.candidateNo)[0];
  const repairDecision = latestEvaluated?.report.repairDecision;
  const latestEvaluatedMetadata = candidateMetadata(latestEvaluated?.candidate.metadata ?? null);
  const convergenceEpisode = repairConvergenceEpisodeFromUnknown(
    latestEvaluatedMetadata.repairConvergenceEpisode,
  );
  const repairMode: ImageRepairMode = historical.length === 0
    ? "full_regenerate"
    : convergenceEpisode?.terminalState
      ? "manual_review"
      : convergenceEpisode?.nextRepairMode
      ?? repairDecision?.mode
      ?? (latestEvaluated?.report.passed ? "guided_regenerate" : "full_regenerate");
  const activeLedgerIssues = (latestEvaluated?.report.issueLedger ?? []).filter((issue) =>
    (issue.status === "open" || issue.status === "regressed")
    && issue.applicableStage === "static_image"
    && issue.severity !== "advisory"
  );
  const preservedResolvedStates = uniqueStrings((latestEvaluated?.report.issueLedger ?? [])
    .filter((issue) => issue.status === "resolved" && issue.applicableStage === "static_image")
    .map((issue) => issue.target
      ? `${issue.region ? `${issue.region}: ` : ""}${issue.target}`
      : `Preserve the currently verified ${issue.category}${issue.region ? ` state at ${issue.region}` : " state"}.`
    ))
    .slice(0, 12);
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
  const evaluatedById = new Map(evaluated.map((item) => [item.candidate.id, item]));
  const baselineSnapshots = evaluated
    .filter(({ candidate }) => Boolean(candidate.mediaUrl))
    .map(({ candidate, report }) => {
      const metadata = candidateMetadata(candidate.metadata);
      const convergence = isRecord(metadata.repairConvergence)
        ? metadata.repairConvergence
        : {};
      const parentCandidateId = typeof metadata.parentCandidateId === "string"
        ? metadata.parentCandidateId
        : undefined;
      const parent = parentCandidateId ? evaluatedById.get(parentCandidateId) : undefined;
      const catastrophicRegressionReasons = catastrophicImageBaselineReasons(candidate, report, parent?.report);
      return {
        id: candidate.id,
        candidateNo: candidate.candidateNo,
        createdAtMs: candidate.createdAt.getTime(),
        parentCandidateId,
        structurallyUsable: isStructurallyUsableImageBaseline(candidate, report)
          && convergence.acceptedAsBaseline !== false,
        catastrophicRegressionReasons,
        regressionAgainstParent: imageCandidateRegressedAgainstParent(candidate, report, parent?.report),
      } satisfies ImageBaselineCandidateSnapshot;
    });
  const lineageSelection = selectLatestUsableImageBaseline(baselineSnapshots);
  const lineageBaseline = lineageSelection.baselineCandidateId
    ? evaluatedById.get(lineageSelection.baselineCandidateId)
    : undefined;
  const mayReuseBaseline = repairMode === "local_edit" || repairMode === "guided_regenerate";
  const baselineCandidate = mayReuseBaseline && lineageBaseline
    && (repairDecision?.baselineUsable ?? true)
    ? lineageBaseline.candidate
    : mayReuseBaseline && evaluated.length === 0
      ? latestWithMedia
      : undefined;
  const baselineUrl = mayReuseBaseline
    ? baselineCandidate?.mediaUrl || (historical.length > 0 && evaluated.length === 0 ? currentImageUrl : "") || ""
    : "";
  const baselineSelection: ImageBaselineSelectionDecision = {
    ...lineageSelection,
    baselineCandidateId: baselineCandidate?.id,
    baselineUsable: Boolean(baselineUrl),
  };
  const baselineReport = baselineCandidate ? evaluatedById.get(baselineCandidate.id)?.report : undefined;
  const strongDimensions = baselineReport ? [
    typeof baselineReport.identityScore === "number" && baselineReport.identityScore >= 80 ? `identity ${baselineReport.identityScore.toFixed(1)}` : "",
    typeof baselineReport.layoutScore === "number" && baselineReport.layoutScore >= 80 ? `layout ${baselineReport.layoutScore.toFixed(1)}` : "",
    typeof baselineReport.promptAlignmentScore === "number" && baselineReport.promptAlignmentScore >= 80 ? `prompt alignment ${baselineReport.promptAlignmentScore.toFixed(1)}` : "",
    typeof baselineReport.continuityScore === "number" && baselineReport.continuityScore >= 80 ? `continuity ${baselineReport.continuityScore.toFixed(1)}` : "",
  ].filter(Boolean) : [];
  const sourceCandidateIds = uniqueStrings([
    ...evaluated.map(({ candidate }) => candidate.id),
    ...historical.filter((candidate) => candidate.errorMessage).map((candidate) => candidate.id),
  ]);
  const currentRepairDirectives = uniqueStrings([
    ...correctionActions,
    ...retryInstructions,
    ...failureIssues.map((issue) => `Do not repeat: ${issue}`),
  ]).map((directive) => clipText(directive, 420)).slice(0, 6);
  const promptAddon = historical.length ? [
    repairMode === "local_edit"
      ? "LOCAL IMAGE REPAIR — MODIFY ONLY THE LISTED REGIONS"
      : repairMode === "guided_regenerate"
        ? "GUIDED IMAGE REGENERATION — PRESERVE VERIFIED STRENGTHS"
        : "FULL IMAGE REGENERATION — DO NOT COPY THE FAILED BASELINE",
    mayReuseBaseline && strongDimensions.length
      ? `Preserve the verified qualities from the latest usable lineage state: ${strongDimensions.join(", ")}.`
      : mayReuseBaseline
        ? "Preserve any correct identity, composition, subject count, and scene structure visible in the latest usable lineage state."
        : "Start from the authoritative contract and approved references. Do not imitate the failed candidate's scene, layout, subject count, or identity.",
    currentRepairDirectives.length
      ? "CURRENT VERIFIED REPAIR DELTA:\n" + currentRepairDirectives.map((directive) => `- ${directive}`).join("\n")
      : "",
    preservedResolvedStates.length
      ? "RESOLVED-STATE PRESERVATION LOCK — these verified improvements must not regress:\n" + preservedResolvedStates.map((state) => `- ${state}`).join("\n")
      : "",
    contractConflicts.length ? "Previously detected contract conflicts must be resolved using the authoritative frame contract before rendering; never obey both sides:\n" + contractConflicts.map((conflict) => `- ${conflict}`).join("\n") : "",
    baselineUrl
      ? "The historical baseline image is provided only for its verified strengths. Apply only the current verified repair delta instead of copying known defects."
      : "",
    repairMode === "local_edit"
      ? "Change only the listed normalized regions. Keep every unlisted verified visual attribute and pixel region as stable as the provider permits."
      : "The new candidate must be a measurable improvement over the strongest prior candidate while still obeying the authoritative frame and narrative contracts.",
  ].filter(Boolean).join("\n") : "";
  return {
    historicalCandidateCount: historical.length,
    sourceCandidateIds,
    repairMode,
    repairDecision,
    baselineSelection,
    promptAddon,
    referenceImageUrls: baselineUrl ? [baselineUrl] : [],
    referenceUsageNotes: baselineUrl
      ? ["The latest usable candidate in the repair lineage is the improvement baseline. Preserve its verified strengths and apply only the requested delta corrections; never replace it with an older candidate merely because that candidate has a higher aggregate score."]
      : [],
    debugSummary: {
      historicalCandidateCount: historical.length,
      evaluatedCandidateCount: evaluated.length,
      passedCandidateCount: passedCount,
      manuallyAcceptedCandidateCount: acceptedCount,
      latestEvaluatedCandidateId: latestEvaluated?.candidate.id,
      baselineCandidateId: baselineCandidate?.id,
      parentCandidateId: baselineCandidate ? candidateMetadata(baselineCandidate.metadata).parentCandidateId : undefined,
      baselineSelectionRule: baselineSelection.selectionRule,
      baselineSelection,
      repairMode,
      repairDecision,
      repairConvergenceEpisode: convergenceEpisode,
      strongDimensions,
      accumulatedFailureIssues: failureIssues,
      accumulatedRetryInstructions: retryInstructions,
      accumulatedCorrectionActions: correctionActions,
      preservedResolvedStates,
      accumulatedContractConflicts: contractConflicts,
      ignoredUnverifiedContractSuspicions: suspectedContractConflicts,
      sourceCandidateIds,
    },
  };
}

function buildImageAttemptPrompt(
  compiled: CompiledPrompt,
  learning: ImageCandidateLearningSummary,
): string {
  if (learning.historicalCandidateCount === 0) return compiled.prompt;
  if (learning.repairMode === "full_regenerate") {
    return [compiled.prompt, learning.promptAddon].filter(Boolean).join("\n\n");
  }
  if (learning.repairMode !== "local_edit" && learning.repairMode !== "guided_regenerate") {
    // Modes such as reevaluate_only/reference_reselect/stage repair should not
    // normally reach paid image submission. Keep the full contract if a manual
    // user action explicitly resubmits anyway.
    return [compiled.prompt, learning.promptAddon].filter(Boolean).join("\n\n");
  }

  const inputs = compiled.debugArtifact.inputs;
  const minimalContract = {
    targetArtifactId: compiled.debugArtifact.targetArtifactId,
    targetType: compiled.debugArtifact.targetType,
    frameContract: inputs.frameContract,
  };
  const guidedContext = learning.repairMode === "guided_regenerate"
    ? {
        boundaryExecutionContract: inputs.boundaryExecutionContract,
        narrativeContext: inputs.narrativeContext,
        cameraGraph: inputs.cameraGraph,
      }
    : undefined;
  return [
    learning.repairMode === "local_edit"
      ? "LOCAL IMAGE REPAIR PACKET — THE BASELINE IMAGE IS THE PRIMARY VISUAL STATE"
      : "GUIDED IMAGE REGENERATION PACKET — REUSE ONLY VERIFIED BASELINE STRENGTHS",
    learning.repairMode === "local_edit"
      ? "Do not redesign the shot. Apply only the confirmed deltas below and preserve all unlisted content."
      : "Rerender the image under the compact authoritative contract while preserving verified identity and composition from the baseline.",
    `Minimal immutable contract:\n${clipText(JSON.stringify(minimalContract), 2100)}`,
    guidedContext ? `Relevant narrative and camera context:\n${clipText(JSON.stringify(guidedContext), 900)}` : "",
    learning.promptAddon,
    "Authority rule: the minimal immutable contract and approved references outrank the historical baseline wherever they conflict.",
  ].filter(Boolean).join("\n\n");
}

function isStructurallyUsableImageBaseline(
  candidate: VideoProjectRecord["generationCandidates"][number],
  report: GenerationQualityReport,
): boolean {
  const metadata = candidateMetadata(candidate.metadata);
  const targetContract = isRecord(metadata.targetContract) ? metadata.targetContract : {};
  const isolatedAsset = Number(metadata.keyframeNo) < 0
    || readPlanShotString(targetContract, ["isolationMode", "isolation_mode"]) === "single_asset";
  if (!isolatedAsset || report.passed) return true;
  const structuralIssues = [
    ...(report.artifactIssues ?? []),
    ...(report.correctionActions ?? []).flatMap((action) => [
      action.region,
      action.element,
      action.observed,
      action.instruction,
    ]),
  ].join(" ");
  const hasIsolationViolation = /background|scenery|scene|environment|ui|logo|title|extra character|second character|multiple (?:people|characters|subjects)|牌桌|场景|背景|界面|徽标|标题|其他角色|多个角色/i.test(structuralIssues);
  return !hasIsolationViolation
    && (report.identityScore ?? 0) >= 55
    && (report.layoutScore ?? 0) >= 55
    && (report.promptAlignmentScore ?? 0) >= 55;
}

function imageCandidateRegressedAgainstParent(
  candidate: VideoProjectRecord["generationCandidates"][number],
  report: GenerationQualityReport,
  parentReport?: GenerationQualityReport,
): boolean {
  if (!parentReport) return false;
  const scorePairs = [
    [report.identityScore, parentReport.identityScore],
    [report.layoutScore, parentReport.layoutScore],
    [report.promptAlignmentScore, parentReport.promptAlignmentScore],
    [report.continuityScore, parentReport.continuityScore],
  ] as const;
  const dimensionRegressed = scorePairs.some(([current, parent]) =>
    typeof current === "number" && typeof parent === "number" && parent - current >= 15
  );
  const currentComposite = candidate.compositeScore ?? generationQualityCompositeScore(report);
  const parentComposite = generationQualityCompositeScore(parentReport);
  return dimensionRegressed
    || (typeof currentComposite === "number" && typeof parentComposite === "number" && parentComposite - currentComposite >= 15);
}

function catastrophicImageBaselineReasons(
  candidate: VideoProjectRecord["generationCandidates"][number],
  report: GenerationQualityReport,
  parentReport?: GenerationQualityReport,
): string[] {
  const reasons: string[] = [];
  if (isTechnicalQualityEvaluationFailure(report) || report.contentBased === false) {
    reasons.push("technical_or_non_visual_evaluation");
  }
  if (report.repairDecision?.baselineUsable === false
    && (report.repairDecision.mode === "local_edit" || report.repairDecision.mode === "guided_regenerate")) {
    reasons.push("deterministic_router_rejected_baseline");
  }
  const scores = [
    report.identityScore,
    report.layoutScore,
    report.promptAlignmentScore,
    report.continuityScore,
  ].filter((score): score is number => typeof score === "number");
  if (scores.length === 4 && Math.min(...scores) < 40) {
    reasons.push("catastrophic_dimension_score");
  }
  const hardRegressedIssue = (report.issueLedger ?? []).some((issue) =>
    issue.status === "regressed" && issue.severity === "hard"
  );
  if (hardRegressedIssue) reasons.push("hard_issue_regressed");

  const issueText = [
    ...(report.artifactIssues ?? []),
    ...(report.hardFailureReasons ?? []),
    ...(report.correctionActions ?? []).flatMap((action) => [
      action.region,
      action.element,
      action.observed,
      action.instruction,
    ]),
  ].join(" ");
  if (/black image|blank image|corrupt(?:ed)? image|identity (?:collapse|failure|replacement)|wrong (?:main )?subject|missing (?:main )?(?:person|character|product)|extra (?:person|character|product)|entire (?:scene|composition|layout).*(?:wrong|destroyed|replaced)|scene replacement|严重身份漂移|身份崩坏|主体缺失|主体错误|额外人物|额外角色|画面损坏|黑图|空白图|构图崩坏|场景被替换/i.test(issueText)) {
    reasons.push("explicit_catastrophic_visual_failure");
  }
  if (!isStructurallyUsableImageBaseline(candidate, report)) {
    reasons.push("structurally_unusable_baseline");
  }

  // A score drop is diagnostic only. It never causes rollback by itself,
  // because evaluator scores can fluctuate even when the intended edit improved.
  if (imageCandidateRegressedAgainstParent(candidate, report, parentReport)
    && (hardRegressedIssue || reasons.includes("explicit_catastrophic_visual_failure"))) {
    reasons.push("confirmed_regression_against_parent");
  }
  return uniqueStrings(reasons);
}

function effectiveRequiredAnchorIds(source: Record<string, unknown> | undefined): string[] {
  if (!source) return [];
  if ("effectiveRequiredAnchorIds" in source || "effective_required_anchor_ids" in source) {
    return readPlanStringArray(source, ["effectiveRequiredAnchorIds", "effective_required_anchor_ids"]);
  }
  return readPlanStringArray(source, ["usesConsistencyAnchors", "uses_consistency_anchors", "requiredAnchorIds", "required_anchor_ids"]);
}

function visibleRequiredAnchorIds(
  planJson: Prisma.JsonValue | null,
  source: Record<string, unknown> | undefined,
): string[] {
  const anchorMap = readPlanConsistencyAnchorMap(planJson);
  return effectiveRequiredAnchorIds(source).filter((anchorId) => {
    const anchor = anchorMap.get(anchorId);
    return !anchor || isVisibleEvidenceAnchor(anchor as unknown as VideoConsistencyAnchor);
  });
}

export type ImageTargetDependencyScope = {
  targetArtifactId: string;
  isolatedAsset: boolean;
  assetCategory: string;
  assetView: string;
  targetAnchorId?: string;
  requiredAnchorIds: string[];
  forbiddenAnchorIds: string[];
};

export function resolveImageTargetDependencyScope(
  planJson: Prisma.JsonValue | null,
  target: Record<string, unknown> | undefined,
  keyframeNo: number,
): ImageTargetDependencyScope {
  const isolatedAsset = isConsistencyKeyframeNo(keyframeNo);
  const targetArtifactId = isolatedAsset ? `consistency_reference:${keyframeNo}` : `keyframe:${keyframeNo}`;
  const assetCategory = readPlanShotString(target, ["assetCategory", "asset_category"]);
  const assetView = readPlanShotString(target, ["assetView", "asset_view"]);
  const anchorMap = readPlanConsistencyAnchorMap(planJson);
  const visibleAnchorIds = new Set(
    [...anchorMap.entries()]
      .filter(([, anchor]) => isVisibleEvidenceAnchor(anchor as unknown as VideoConsistencyAnchor))
      .map(([anchorId]) => anchorId),
  );
  if (!isolatedAsset) {
    return {
      targetArtifactId,
      isolatedAsset: false,
      assetCategory,
      assetView,
      requiredAnchorIds: visibleRequiredAnchorIds(planJson, target),
      forbiddenAnchorIds: [],
    };
  }

  const targetAnchorId = anchorIdForConsistencyReference(target);
  const allAnchorIds = consistencyAnchorsFromPlan(planRecord(planJson))
    .map((anchor) => anchor.id)
    .filter((anchorId) => anchorId && visibleAnchorIds.has(anchorId));
  const targetIsVisible = Boolean(targetAnchorId && visibleAnchorIds.has(targetAnchorId));
  return {
    targetArtifactId,
    isolatedAsset: true,
    assetCategory,
    assetView,
    targetAnchorId: targetAnchorId || undefined,
    // Project-level anchors describe downstream story consumers. A reusable
    // asset reference must render only its own anchor.
    requiredAnchorIds: targetIsVisible && targetAnchorId ? [targetAnchorId] : [],
    forbiddenAnchorIds: targetAnchorId
      ? allAnchorIds.filter((anchorId) => anchorId !== targetAnchorId)
      : allAnchorIds,
  };
}

function scopedImageTargetContract(
  planJson: Prisma.JsonValue | null,
  target: Record<string, unknown> | undefined,
  keyframe: VideoProjectRecord["keyframes"][number],
  scope: ImageTargetDependencyScope,
): Record<string, unknown> {
  const sourceImagePrompt = keyframe.imagePrompt
    || readPlanShotString(target, ["imagePrompt", "image_prompt"]);
  const category = scope.assetCategory;
  const renderingStyle = scope.isolatedAsset && category === "person"
    ? renderingStyleContractForPrompt(planJson, scope.targetAnchorId)
    : undefined;
  return {
    targetArtifactId: scope.targetArtifactId,
    purpose: keyframe.purpose,
    assetCategory: category,
    assetView: scope.assetView,
    targetAnchorId: scope.targetAnchorId,
    effectiveRequiredAnchorIds: scope.requiredAnchorIds,
    forbiddenAnchorIds: scope.forbiddenAnchorIds,
    isolationMode: scope.isolatedAsset ? "single_asset" : "story_frame",
    scene: !scope.isolatedAsset || category === "scene"
      ? readPlanShotString(target, ["scene"]) || keyframe.scene
      : "plain white or light neutral asset-library background",
    characterState: !scope.isolatedAsset || category === "person"
      ? readPlanShotString(target, ["characterState", "character_state"]) || keyframe.characterState
      : "",
    productState: !scope.isolatedAsset || category === "product" || category === "prop" || category === "brand_visual"
      ? readPlanShotString(target, ["productState", "product_state"]) || keyframe.productState
      : "",
    imagePrompt: sourceImagePrompt,
    ...(renderingStyle ? {
      renderingStyle,
      styleReferenceRequired: true,
      identityReferenceRequired: true,
    } : {}),
  };
}

function scopedTargetContractFromCompiled(
  compiled: CompiledPrompt,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  const targetContract = compiled.debugArtifact.inputs.targetContract;
  return isRecord(targetContract) ? targetContract : fallback;
}

export async function regenerateKeyframeImage(
  userId: string,
  projectId: string,
  shotId: string,
  options: { recovery?: boolean } = {},
): Promise<VideoProjectRecord> {
  return regenerateKeyframeImageInternal(userId, projectId, shotId, {
    recovery: options.recovery,
    executeInline: false,
  });
}

async function regenerateKeyframeImageInternal(
  userId: string,
  projectId: string,
  shotId: string,
  options: { recovery?: boolean; executeInline: boolean },
): Promise<VideoProjectRecord> {
  let project = await requireVideoProject(userId, projectId);
  const segment = project.segments.find((item) => item.id === shotId);
  const keyframe = project.keyframes.find((item) => item.id === shotId) ??
    (segment ? project.keyframes.find((item) => item.keyframeNo === segment.startKeyframeNo) : undefined);
  if (!keyframe) throw new Error("Keyframe not found");
  if (isConsistencyKeyframeNo(keyframe.keyframeNo) && !isAssetViewGenerationReady(project, keyframe.keyframeNo)) {
    const target = readPlanConsistencyReferenceMap(project.planJson).get(keyframe.keyframeNo);
    const view = readPlanShotString(target, ["assetView", "asset_view"]);
    const required = requiredApprovedAssetViewsForTarget(view).at(-1);
    throw new Error(required === "side"
      ? "背面图生成已阻止：请先批准并锁定侧面图"
      : "侧面图生成已阻止：请先批准并锁定正面图");
  }
  if (!options.executeInline) {
    const revision = stableShortHash(JSON.stringify({
      keyframeId: keyframe.id,
      imagePrompt: keyframe.imagePrompt,
      negativePrompt: keyframe.negativePrompt,
      previousImageUrl: keyframe.imageUrl,
      keyframeVersion: keyframe.updatedAt.toISOString(),
    }));
    await prisma.videoKeyframe.update({
      where: { id: keyframe.id },
      data: { status: VideoShotStatus.IMAGE_PENDING, errorMessage: null },
    });
    await prisma.videoProject.update({
      where: { id: projectId },
      data: { status: VideoProjectStatus.IMAGE_GENERATING, errorMessage: null },
    });
    await enqueueVideoProductionJob({
      userId,
      projectId,
      kind: "image_prepare_submit",
      stage: "provider_submission",
      idempotencyKey: `image-regenerate:${projectId}:${keyframe.id}:${revision}`,
      artifactId: imageArtifactIdForKeyframeNo(keyframe.keyframeNo),
      targetId: keyframe.id,
      payload: cleanInputJson({
        action: "regenerate",
        recovery: Boolean(options.recovery),
        requestedShotId: shotId,
      }),
      priority: 60,
      maxAttempts: 5,
    });
    return requireVideoProject(userId, projectId);
  }
  if (options.recovery && keyframe.imageUrl && (keyframe.status === VideoShotStatus.IMAGE_READY || keyframe.status === VideoShotStatus.IMAGE_APPROVED)) {
    return requireVideoProject(userId, projectId);
  }
  if (keyframe.keyframeNo > 0) {
    await invalidateMediaPlanningForBoundary(projectId, keyframe.keyframeNo);
    project = await requireVideoProject(userId, projectId);
  }

  const artifactId = imageArtifactIdForKeyframeNo(keyframe.keyframeNo);
  const learning = buildImageCandidateLearningSummary(project, artifactId, keyframe.imageUrl);
  const planTarget = readPlanKeyframeMap(project.planJson).get(keyframe.keyframeNo)
    ?? readPlanConsistencyReferenceMap(project.planJson).get(keyframe.keyframeNo);
  const dependencyScope = resolveImageTargetDependencyScope(project.planJson, planTarget, keyframe.keyframeNo);
  const regenerationContext = generationCandidateLogContext({
    projectId,
    artifactId,
    kind: "keyframe_image",
    candidateNo: learning.historicalCandidateCount + 1,
    candidateCount: learning.historicalCandidateCount + 1,
    metadata: {
      keyframeNo: keyframe.keyframeNo,
      assetNameZh: readPlanShotString(planTarget, ["displayNameZh", "display_name_zh", "purposeZh", "purpose_zh", "purpose"]),
      assetCategory: dependencyScope.assetCategory,
      assetView: dependencyScope.assetView,
      targetContract: planTarget ?? { purpose: keyframe.purpose },
    },
  });
  await logOnePromptVideo("image.regenerate.start", {
    userId,
    ...regenerationContext,
    keyframeId: keyframe.id,
    wasLocked: keyframe.locked,
  });
  const draftPromptStartedAtMs = Date.now();
  const draftPrompt = compileImagePromptForKeyframe(project, keyframe);
  await logOnePromptVideo("production.step.completed", {
    ...regenerationContext,
    stepNameZh: "程序根据脚本、画面合同和上一轮问题起草图片提示词",
    executionMethod: "program",
    durationMs: Date.now() - draftPromptStartedAtMs,
    resultZh: learning.historicalCandidateCount > 0 ? "已把上一轮质检问题写入返修提示词" : "首轮生成提示词已起草",
  });
  const referenceSelectionStartedAtMs = Date.now();
  const referenceSelection = await selectReferenceImagesForKeyframe(project, keyframe, draftPrompt.prompt);
  await logOnePromptVideo("production.step.completed", {
    ...regenerationContext,
    stepNameZh: "为这张图选择一致性参考资产",
    executionMethod: "program",
    durationMs: Date.now() - referenceSelectionStartedAtMs,
    resultZh: `选中 ${referenceSelection.output.selectedReferenceUrls?.length ?? 0} 张参考图`,
  });
  const compileStartedAtMs = Date.now();
  const compiled = compileImagePromptForKeyframe(project, keyframe, {
    ...referenceSelection.output,
    finalTextPrompt: draftPrompt.prompt,
  });
  assertCompiledVisualContractReady(compiled);
  const learnedPrompt = buildImageAttemptPrompt(compiled, learning);
  await logOnePromptVideo("production.step.completed", {
    ...regenerationContext,
    stepNameZh: "编译最终图片提示词并做合同冲突检查",
    executionMethod: "deterministic_program",
    durationMs: Date.now() - compileStartedAtMs,
    resultZh: "最终提示词通过程序合同检查",
  });
  const learnedReferenceUrls = uniqueStrings([
    ...learning.referenceImageUrls,
    ...(compiled.referenceImageUrls ?? []),
  ]).slice(0, ONE_PROMPT_MAX_REFERENCE_IMAGES);
  const personIdentityAnchor = dependencyScope.isolatedAsset
    ? personAnchorForPrompt(project.planJson, dependencyScope.targetAnchorId)
    : undefined;
  const authoritativeAnchorLocks = personIdentityAnchor
    ? ""
    : consistencyAnchorLocksForPrompt(
        project.planJson,
        dependencyScope.requiredAnchorIds,
      );
  const rawLearnedReferenceUsageNotes = [
    ...learning.referenceUsageNotes,
    ...(referenceSelection.output.usageNotes ?? []),
    authoritativeAnchorLocks ? `AUTHORITATIVE ANCHOR CONTRACTS — visible words and markings in these locks are required, not forbidden:\n${authoritativeAnchorLocks}` : "",
  ];
  const learnedReferenceUsageNotes = personIdentityAnchor
    ? normalizePersonReferenceUsageNotes(rawLearnedReferenceUsageNotes, personIdentityAnchor.id)
    : uniqueStrings(rawLearnedReferenceUsageNotes);
  await withOnePromptVideoLogContext(regenerationContext, () => saveReferenceSelectionOutput(projectId, {
    ...referenceSelection.output,
    selectedReferenceUrls: learnedReferenceUrls,
    finalTextPrompt: learnedPrompt,
  }));
  await withOnePromptVideoLogContext(regenerationContext, () => savePromptDebugArtifact(projectId, {
    ...compiled.debugArtifact,
    inputs: {
      ...compiled.debugArtifact.inputs,
      incrementalCandidateLearning: learning.debugSummary,
    },
    selectedReferenceUrls: learnedReferenceUrls,
    referenceUsageNotes: learnedReferenceUsageNotes,
    finalPrompt: learnedPrompt,
    rules: uniqueStrings([...compiled.debugArtifact.rules, "incremental_candidate_learning", "preserve_candidate_history"]),
  }));
  if (options.recovery) {
    const claim = await prisma.videoKeyframe.updateMany({
      where: {
        id: keyframe.id,
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
      repairMode: learning.repairMode,
      repairDecision: learning.repairDecision,
      parentCandidateId: learning.baselineSelection.baselineCandidateId,
      baselineSelection: learning.baselineSelection,
      keyframeNo: keyframe.keyframeNo,
      assetNameZh: readPlanShotString(planTarget, ["displayNameZh", "display_name_zh", "purposeZh", "purpose_zh", "purpose"]),
      assetCategory: dependencyScope.assetCategory,
      assetView: dependencyScope.assetView,
      targetContract: scopedTargetContractFromCompiled(
        compiled,
        planTarget ?? { purpose: keyframe.purpose, imagePrompt: keyframe.imagePrompt },
      ),
      visualContract: compiled.debugArtifact.inputs.visualContract,
      selectedReferenceUrls: learnedReferenceUrls,
      referenceUsageNotes: learnedReferenceUsageNotes,
    },
  });
  await prisma.videoKeyframe.update({
    where: { id: keyframe.id },
    data: {
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
  await logOnePromptVideo("image.regenerate.success", { userId, ...regenerationContext, keyframeId: keyframe.id, taskId });
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
): Promise<VideoProjectRecord> {
  return regenerateMicroShotImageInternal(userId, projectId, shotId, microShotNo, {
    ...input,
    executeInline: false,
  });
}

async function regenerateMicroShotImageInternal(
  userId: string,
  projectId: string,
  shotId: string,
  microShotNo: number,
  input: { microShot?: Partial<VideoMicroShot>; locale?: "zh" | "en"; executeInline: boolean },
): Promise<VideoProjectRecord> {
  const project = await requireVideoProject(userId, projectId);
  const segment = project.segments.find((item) => item.id === shotId);
  if (!segment) throw new Error("Video segment not found");
  const microShots = readEffectivePlanMicroShots(project.planJson, segment.segmentNo);
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
  if (!input?.executeInline) {
    const targetId = microShotJobTargetId(projectId, segment.segmentNo, microShotNo);
    const revision = stableShortHash(JSON.stringify({
      targetId,
      merged,
      previousImageUrl: existing?.imageUrl,
    }));
    await updatePlanMicroShot(projectId, segment.segmentNo, microShotNo, {
      ...merged,
      imageStatus: "pending",
      errorMessage: "",
    });
    await enqueueVideoProductionJob({
      userId,
      projectId,
      kind: "micro_shot_prepare_submit",
      stage: "provider_submission",
      idempotencyKey: `micro-shot-regenerate:${targetId}:${revision}`,
      artifactId: imageArtifactIdForMicroShot(segment.segmentNo, microShotNo),
      targetId,
      payload: cleanInputJson({
        action: "regenerate",
        shotId,
        microShotNo,
        microShot: input?.microShot,
        locale: input?.locale,
      }),
      priority: 60,
      maxAttempts: 5,
    });
    return requireVideoProject(userId, projectId);
  }

  await logOnePromptVideo("micro_shot.image.regenerate.start", {
    userId,
    projectId,
    segmentId: segment.id,
    segmentNo: segment.segmentNo,
    microShotNo,
  });
  const latest = await requireVideoProject(userId, projectId);
  const latestSegment = latest.segments.find((item) => item.id === shotId) ?? segment;
  const artifactId = imageArtifactIdForMicroShot(segment.segmentNo, microShotNo);
  const learning = buildImageCandidateLearningSummary(latest, artifactId, existing?.imageUrl);
  const draftPrompt = compileImagePromptForMicroShot(latest, latestSegment, merged);
  const referenceSelection = await selectReferenceImagesForMicroShot(latest, latestSegment, merged, draftPrompt.prompt);
  const compiled = compileImagePromptForMicroShot(latest, latestSegment, merged, {
    ...referenceSelection.output,
    finalTextPrompt: draftPrompt.prompt,
  });
  const learnedPrompt = buildImageAttemptPrompt(compiled, learning);
  const learnedReferenceUrls = uniqueStrings([
    ...learning.referenceImageUrls,
    ...(compiled.referenceImageUrls ?? []),
  ]).slice(0, ONE_PROMPT_MAX_REFERENCE_IMAGES);
  const learnedReferenceUsageNotes = uniqueStrings([
    ...learning.referenceUsageNotes,
    ...(referenceSelection.output.usageNotes ?? []),
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
    rules: uniqueStrings([...compiled.debugArtifact.rules, "incremental_candidate_learning", "repair_mode_routing"]),
  });
  const taskId = await createImageCandidateBatch({
    project: latest,
    artifactId,
    targetId: segment.id,
    kind: "micro_shot_image",
    prompt: learnedPrompt,
    negativePrompt: compiled.negativePrompt,
    referenceImageUrls: learnedReferenceUrls,
    seedBase: Math.abs(segment.segmentNo * 100 + microShotNo + Date.now()) % 2147483647,
    metadata: {
      isRegeneration: Boolean(existing?.imageUrl),
      retryCycleId: randomUUID(),
      segmentNo: segment.segmentNo,
      microShotNo,
      targetContract: merged as unknown as Record<string, unknown>,
      visualContract: compiled.debugArtifact.inputs.visualContract,
      selectedReferenceUrls: learnedReferenceUrls,
      referenceUsageNotes: learnedReferenceUsageNotes,
      repairMode: learning.repairMode,
      repairDecision: learning.repairDecision,
      parentCandidateId: learning.baselineSelection.baselineCandidateId,
      baselineSelection: learning.baselineSelection,
    },
  });

  await updatePlanMicroShot(projectId, segment.segmentNo, microShotNo, {
    ...merged,
    referenceType: merged.referenceType === "text" ? "image_prompt" : merged.referenceType ?? "image_prompt",
    imageStatus: "running",
    imageUrl: existing?.imageUrl ?? "",
    errorMessage: "",
  });
  await updateProjectArtifactStatus(projectId, [artifactId], "generating", { retryFromStage: "generation" });
  await logOnePromptVideo("micro_shot.image.regenerate.success", {
    userId,
    projectId,
    segmentNo: segment.segmentNo,
    microShotNo,
  });
  return requireVideoProject(userId, projectId);
}

export async function regenerateSegmentClip(
  userId: string,
  projectId: string,
  shotId: string,
): Promise<VideoProjectRecord> {
  return regenerateSegmentClipInternal(userId, projectId, shotId, { executeInline: false });
}

async function regenerateSegmentClipInternal(
  userId: string,
  projectId: string,
  shotId: string,
  options: { executeInline: boolean },
): Promise<VideoProjectRecord> {
  const project = await requireVideoProject(userId, projectId);
  const segment = project.segments.find((item) => item.id === shotId);
  if (!segment) throw new Error("Video segment not found");
  const keyframeMap = new Map(project.keyframes.map((keyframe) => [keyframe.keyframeNo, keyframe]));
  const startKeyframe = keyframeMap.get(segment.startKeyframeNo);
  const endKeyframe = keyframeMap.get(segment.endKeyframeNo);
  if (!startKeyframe?.imageUrl) throw new Error("Segment start keyframe image is missing");
  if (!endKeyframe?.imageUrl) throw new Error("Segment end keyframe image is missing");
  requireCanonicalVideoPromptContract(project, segment);
  if (!options.executeInline) {
    const revision = stableShortHash(JSON.stringify({
      segmentId: segment.id,
      videoPrompt: segment.videoPrompt,
      negativePrompt: segment.negativePrompt,
      previousClipUrl: segment.clipUrl,
    }));
    await prisma.videoSegment.update({
      where: { id: segment.id },
      data: {
        clipUrl: null,
        status: VideoShotStatus.CLIP_PENDING,
        locked: false,
        qualityScore: null,
        errorMessage: null,
      },
    });
    await prisma.videoProject.update({
      where: { id: projectId },
      data: {
        status: VideoProjectStatus.CLIP_GENERATING,
        finalVideoUrl: null,
        errorMessage: null,
      },
    });
    await enqueueVideoProductionJob({
      userId,
      projectId,
      kind: "clip_prepare_submit",
      stage: "contract_validation",
      idempotencyKey: `clip-regenerate:${projectId}:${segment.id}:${revision}`,
      artifactId: videoArtifactIdForSegmentNo(segment.segmentNo),
      targetId: segment.id,
      payload: cleanInputJson({ action: "regenerate", shotId }),
      priority: 60,
      maxAttempts: 5,
    });
    return requireVideoProject(userId, projectId);
  }
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
    imageInputs: compiled.resolvedVideoImages?.transported
      ?? buildSegmentVideoImageInputs(project, segment, startKeyframe, endKeyframe),
    resolvedVideoImages: compiled.resolvedVideoImages,
    metadata: {
      isRegeneration: Boolean(segment.clipUrl),
      retryCycleId: randomUUID(),
      targetContract: renderDescription,
      motionCheckpoints: readEffectivePlanMicroShots(project.planJson, segment.segmentNo),
      selectedReferenceUrls: selectedReferenceUrlsForPromptTarget(project.planJson, `segment:${segment.segmentNo}`),
      referenceUsageNotes: [],
    },
  });
  await prisma.videoSegment.update({
    where: { id: segment.id },
    data: {
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
): Promise<VideoProjectRecord> {
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
        imageStatus: "ready",
        errorMessage: "",
      };
      updatePlanMicroShotCollection(plan, "segments", segment.segmentNo, microShotNo, patch);
      setPlanArtifactStatus(plan, [imageArtifactIdForMicroShot(segment.segmentNo, microShotNo)], "ready", { retryFromStage: "generation" });
      nextStatus = VideoProjectStatus.MICRO_SHOT_REVIEW;
    } else if (input.kind === "segment_clip") {
      const segment = project.segments.find((item) => item.id === input.targetId);
      if (!segment) throw new Error("Video segment not found");
      await tx.videoSegment.update({
        where: { id: segment.id },
        data: {
          clipUrl: revision.url,
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
        status: nextStatus,
        finalVideoUrl: input.kind === "final_video" ? revision.url : input.kind === "segment_clip" ? null : project.finalVideoUrl,
        errorMessage: null,
      },
    });
  });
  await commitArtifactPlan(projectId, plan);

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

type PreparedMicroShotImageSubmission = {
  segment: VideoProjectRecord["segments"][number];
  microShot: VideoMicroShot;
  artifactId: string;
  learning: ReturnType<typeof buildImageCandidateLearningSummary>;
  referenceSelection: Awaited<ReturnType<typeof selectReferenceImagesForMicroShot>>;
  compiled: ReturnType<typeof compileImagePromptForMicroShot>;
  learnedPrompt: string;
  learnedReferenceUrls: string[];
  learnedReferenceUsageNotes: string[];
};

async function mapWithConcurrencyLimit<T, R>(
  items: T[],
  concurrency: number,
  operation: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(items[index], index);
    }
  }));
  return results;
}

async function prepareMicroShotImageSubmission(
  project: VideoProjectRecord,
  segment: VideoProjectRecord["segments"][number],
  microShot: VideoMicroShot,
): Promise<PreparedMicroShotImageSubmission> {
  const artifactId = imageArtifactIdForMicroShot(
    segment.segmentNo,
    microShot.microShotNo,
  );
  const learning = buildImageCandidateLearningSummary(
    project,
    artifactId,
    microShot.imageUrl,
  );
  const draftPrompt = compileImagePromptForMicroShot(project, segment, microShot);
  const referenceSelection = await selectReferenceImagesForMicroShot(
    project,
    segment,
    microShot,
    draftPrompt.prompt,
  );
  const compiled = compileImagePromptForMicroShot(project, segment, microShot, {
    ...referenceSelection.output,
    finalTextPrompt: draftPrompt.prompt,
  });
  const learnedPrompt = buildImageAttemptPrompt(compiled, learning);
  const learnedReferenceUrls = uniqueStrings([
    ...learning.referenceImageUrls,
    ...(compiled.referenceImageUrls ?? []),
  ]).slice(0, ONE_PROMPT_MAX_REFERENCE_IMAGES);
  const learnedReferenceUsageNotes = uniqueStrings([
    ...learning.referenceUsageNotes,
    ...(referenceSelection.output.usageNotes ?? []),
  ]);
  return {
    segment,
    microShot,
    artifactId,
    learning,
    referenceSelection,
    compiled,
    learnedPrompt,
    learnedReferenceUrls,
    learnedReferenceUsageNotes,
  };
}

async function persistPreparedMicroShotImageSubmission(
  projectId: string,
  prepared: PreparedMicroShotImageSubmission,
): Promise<void> {
  const { segment, microShot, artifactId, learning, referenceSelection, compiled } = prepared;
  const microShotLogContext = {
    projectId,
    artifactId,
    generationKind: "micro_shot_image",
    assetLabel: microShot.purposeZh || microShot.purpose,
    segmentNo: segment.segmentNo,
    microShotNo: microShot.microShotNo,
  };
  await withOnePromptVideoLogContext(microShotLogContext, () =>
    saveReferenceSelectionOutput(projectId, {
      ...referenceSelection.output,
      selectedReferenceUrls: prepared.learnedReferenceUrls,
      finalTextPrompt: prepared.learnedPrompt,
    })
  );
  await withOnePromptVideoLogContext(microShotLogContext, () =>
    savePromptDebugArtifact(projectId, {
      ...compiled.debugArtifact,
      inputs: {
        ...compiled.debugArtifact.inputs,
        incrementalCandidateLearning: learning.debugSummary,
      },
      selectedReferenceUrls: prepared.learnedReferenceUrls,
      referenceUsageNotes: prepared.learnedReferenceUsageNotes,
      finalPrompt: prepared.learnedPrompt,
      rules: uniqueStrings([
        ...compiled.debugArtifact.rules,
        "incremental_candidate_learning",
        "repair_mode_routing",
      ]),
    })
  );
}

async function submitPreparedMicroShotImageCandidate(
  project: VideoProjectRecord,
  prepared: PreparedMicroShotImageSubmission,
): Promise<string> {
  const { segment, microShot, artifactId, learning, compiled } = prepared;
  return createImageCandidateBatch({
    project,
    artifactId,
    targetId: segment.id,
    kind: "micro_shot_image",
    prompt: prepared.learnedPrompt,
    negativePrompt: compiled.negativePrompt,
    referenceImageUrls: prepared.learnedReferenceUrls,
    seedBase: Math.abs(segment.segmentNo * 100 + microShot.microShotNo) || 1,
    metadata: {
      segmentNo: segment.segmentNo,
      microShotNo: microShot.microShotNo,
      assetNameZh: microShot.purposeZh || microShot.purpose,
      targetContract: microShot as unknown as Record<string, unknown>,
      visualContract: compiled.debugArtifact.inputs.visualContract,
      selectedReferenceUrls: prepared.learnedReferenceUrls,
      referenceUsageNotes: prepared.learnedReferenceUsageNotes,
      repairMode: learning.repairMode,
      repairDecision: learning.repairDecision,
      parentCandidateId: learning.baselineSelection.baselineCandidateId,
      baselineSelection: learning.baselineSelection,
    },
  });
}

async function submitRequiredMicroShotImageTasks(
  userId: string,
  projectId: string,
  options: { retryFailed?: boolean; targetId?: string } = {},
): Promise<void> {
  const project = await requireVideoProject(userId, projectId);
  const preparationConcurrency = microShotPreparationConcurrency();
  const targets = project.segments.flatMap((segment) =>
    readEffectivePlanMicroShots(project.planJson, segment.segmentNo)
      .filter((microShot) => {
        if (!isMicroShotImageRequired(microShot)) return false;
        if (microShot.imageUrl) return false;
        if (microShot.imageStatus === "failed" && !options.retryFailed) return false;
        return Boolean(localizedMicroShotImagePromptForGeneration(microShot));
      })
      .map((microShot) => ({ segment, microShot }))
  )
    .filter(({ segment, microShot }) =>
      !options.targetId
      || microShotJobTargetId(projectId, segment.segmentNo, microShot.microShotNo) === options.targetId
    )
    .slice(0, preparationConcurrency);
  if (!targets.length) return;
  await logOnePromptVideo("micro_shot.image.prepare.batch", {
    userId,
    projectId,
    targetCount: targets.length,
    preparationConcurrency,
    globalImageConcurrency: imageTaskConcurrency(),
  });
  // Claim each target in order so planJson remains a single-writer
  // compatibility mirror. Expensive prompt/reference work starts afterwards.
  for (const { segment, microShot } of targets) {
    await updatePlanMicroShot(projectId, segment.segmentNo, microShot.microShotNo, {
      ...microShot,
      imageStatus: "pending",
      imageUrl: "",
      errorMessage: "",
    });
  }
  const preparedResults = await mapWithConcurrencyLimit(
    targets,
    preparationConcurrency,
    async ({ segment, microShot }) => {
      try {
        return {
          key: `${segment.segmentNo}:${microShot.microShotNo}`,
          prepared: await prepareMicroShotImageSubmission(
            project,
            segment,
            microShot,
          ),
        };
      } catch (error) {
        return {
          key: `${segment.segmentNo}:${microShot.microShotNo}`,
          error,
        };
      }
    },
  );
  const preparedByKey = new Map(
    preparedResults.map((result) => [result.key, result]),
  );
  const persistedPrepared: PreparedMicroShotImageSubmission[] = [];
  for (const result of preparedResults) {
    if ("error" in result) continue;
    try {
      await persistPreparedMicroShotImageSubmission(projectId, result.prepared);
      persistedPrepared.push(result.prepared);
    } catch (error) {
      preparedByKey.set(result.key, { key: result.key, error });
    }
  }
  const demandRegistrationResults = await Promise.allSettled(
    persistedPrepared.map((prepared) =>
      registerProviderDemand(
        "image_generation",
        aliyunImageModelName(),
        {
          userId,
          projectId,
          targetId: `${projectId}:${prepared.artifactId}`,
        },
      )
    ),
  );
  const demandRegistrationFailures = demandRegistrationResults.filter(
    (result) => result.status === "rejected",
  );
  if (demandRegistrationFailures.length) {
    await logOnePromptVideo("micro_shot.image.capacity_registration.partial", {
      userId,
      projectId,
      failureCount: demandRegistrationFailures.length,
    }, "warn");
  }
  const latestForSubmission = await requireVideoProject(userId, projectId);
  const submittedResults = await mapWithConcurrencyLimit(
    persistedPrepared,
    imageTaskConcurrency(),
    async (prepared) => {
      const key = `${prepared.segment.segmentNo}:${prepared.microShot.microShotNo}`;
      try {
        return {
          key,
          taskId: await submitPreparedMicroShotImageCandidate(
            latestForSubmission,
            prepared,
          ),
        };
      } catch (error) {
        return { key, error };
      }
    },
  );
  const submittedByKey = new Map(
    submittedResults.map((result) => [result.key, result]),
  );
  for (const segment of project.segments) {
    const microShots = readEffectivePlanMicroShots(project.planJson, segment.segmentNo);
    for (const microShot of microShots) {
      if (!isMicroShotImageRequired(microShot)) continue;
      if (microShot.imageUrl) continue;
      if (microShot.imageStatus === "failed" && !options.retryFailed) continue;
      const imagePrompt = localizedMicroShotImagePromptForGeneration(microShot);
      if (!imagePrompt) continue;
      try {
        const preparedResult = preparedByKey.get(
          `${segment.segmentNo}:${microShot.microShotNo}`,
        );
        if (!preparedResult) continue;
        if ("error" in preparedResult) throw preparedResult.error;
        const {
          artifactId,
          learnedPrompt,
          learnedReferenceUrls,
        } = preparedResult.prepared;
        const submittedResult = submittedByKey.get(
          `${segment.segmentNo}:${microShot.microShotNo}`,
        );
        if (!submittedResult) continue;
        if ("error" in submittedResult) throw submittedResult.error;
        const taskId = submittedResult.taskId;
        await updatePlanMicroShot(projectId, segment.segmentNo, microShot.microShotNo, {
          ...microShot,
          imageStatus: "running",
          imageUrl: "",
          errorMessage: "",
        });
        await updateProjectArtifactStatus(projectId, [artifactId], "generating", { retryFromStage: "generation" });
        await logOnePromptVideo("micro_shot.image.submit.success", {
          userId,
          projectId,
          segmentNo: segment.segmentNo,
          microShotNo: microShot.microShotNo,
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
            `Prompt: ${learnedPrompt.slice(0, 360)}`,
          ],
          data: {
            userId,
            segmentNo: segment.segmentNo,
            microShotNo: microShot.microShotNo,
            referenceImageCount: learnedReferenceUrls.length,
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
        if (retryable) throw error;
      }
    }
  }
}

async function queueRequiredMicroShotImageTasks(
  userId: string,
  projectId: string,
  options: { retryFailed?: boolean } = {},
): Promise<boolean> {
  const project = await requireVideoProject(userId, projectId);
  const activeArtifactIds = new Set(
    project.productionJobs
      .filter((job) =>
        job.kind === "micro_shot_prepare_submit"
        && ACTIVE_VIDEO_PRODUCTION_JOB_STATUSES.includes(
          job.status as (typeof ACTIVE_VIDEO_PRODUCTION_JOB_STATUSES)[number],
        )
      )
      .flatMap((job) => job.artifactId ? [job.artifactId] : []),
  );
  const targets = project.segments.flatMap((segment) =>
    readEffectivePlanMicroShots(project.planJson, segment.segmentNo)
      .filter((microShot) =>
        isMicroShotImageRequired(microShot)
        && !microShot.imageUrl
        && !activeArtifactIds.has(imageArtifactIdForMicroShot(segment.segmentNo, microShot.microShotNo))
        && (options.retryFailed || microShot.imageStatus !== "failed")
        && Boolean(localizedMicroShotImagePromptForGeneration(microShot))
      )
      .map((microShot) => ({ segment, microShot }))
  );
  let created = false;
  for (const { segment, microShot } of targets) {
    const targetId = microShotJobTargetId(projectId, segment.segmentNo, microShot.microShotNo);
    const revision = stableShortHash(JSON.stringify({
      targetId,
      imagePrompt: microShot.imagePrompt,
      referenceType: microShot.referenceType,
      imageUrl: microShot.imageUrl,
      imageStatus: microShot.imageStatus,
    }));
    const queued = await enqueueVideoProductionJob({
      userId,
      projectId,
      kind: "micro_shot_prepare_submit",
      stage: "provider_submission",
      idempotencyKey: `micro-shot-submit:${targetId}:${revision}`,
      artifactId: imageArtifactIdForMicroShot(segment.segmentNo, microShot.microShotNo),
      targetId,
      payload: cleanInputJson({
        retryFailed: Boolean(options.retryFailed),
        segmentNo: segment.segmentNo,
        microShotNo: microShot.microShotNo,
      }),
      priority: 30,
    });
    created ||= queued.created;
    void logOnePromptVideo("micro_shot.submit.background.queued", {
      userId,
      projectId,
      targetId,
      segmentNo: segment.segmentNo,
      microShotNo: microShot.microShotNo,
      durableJobId: queued.id,
      durableJobCreated: queued.created,
    });
  }
  return created;
}

function microShotJobTargetId(projectId: string, segmentNo: number, microShotNo: number): string {
  return `${projectId}:${imageArtifactIdForMicroShot(segmentNo, microShotNo)}`;
}

export async function retryRequiredMicroShotImageTasks(
  userId: string,
  projectId: string,
): Promise<boolean> {
  const project = await requireVideoProject(userId, projectId);
  const failedTargets = project.segments.flatMap((segment) =>
    readEffectivePlanMicroShots(project.planJson, segment.segmentNo)
      .filter((microShot) =>
        isMicroShotImageRequired(microShot)
        && !microShot.imageUrl
        && microShot.imageStatus === "failed"
        && Boolean(localizedMicroShotImagePromptForGeneration(microShot))
      )
      .map((microShot) => ({ segmentNo: segment.segmentNo, microShot }))
  );
  for (const target of failedTargets) {
    await updatePlanMicroShot(projectId, target.segmentNo, target.microShot.microShotNo, {
      ...target.microShot,
      imageStatus: "idle",
      errorMessage: "",
    });
  }
  return queueRequiredMicroShotImageTasks(userId, projectId);
}

async function queueNextImageTask(
  userId: string,
  projectId: string,
  logEventPrefix: string,
  options: { reactivateFailed?: boolean } = {},
): Promise<boolean> {
  const project = await requireVideoProject(userId, projectId);
  const activeTargetIds = new Set(
    project.productionJobs
      .filter((job) =>
        job.kind === "image_prepare_submit"
        && ACTIVE_VIDEO_PRODUCTION_JOB_STATUSES.includes(
          job.status as (typeof ACTIVE_VIDEO_PRODUCTION_JOB_STATUSES)[number],
        )
        && Boolean(job.targetId)
      )
      .flatMap((job) => job.targetId ? [job.targetId] : []),
  );
  const availableSlots = Math.max(
    0,
    imageTaskConcurrency() - activeTargetIds.size,
  );
  if (!availableSlots) return false;
  const keyframesById = new Map(
    project.keyframes.map((keyframe) => [keyframe.id, keyframe]),
  );
  const activeBoundaryCount = [...activeTargetIds].filter((targetId) => {
    const keyframe = keyframesById.get(targetId);
    return keyframe && !isConsistencyKeyframeNo(keyframe.keyframeNo);
  }).length;
  const unfinishedAssetImages = project.keyframes.some((keyframe) =>
    isEligibleConsistencyKeyframe(project.planJson, keyframe.keyframeNo)
    && !keyframe.imageUrl
    && keyframe.status !== VideoShotStatus.FAILED
  );
  const dependencyReadyTargets = dependencyReadyImageTargets(project, {
    includeFailed: options.reactivateFailed === true,
  })
    .filter((keyframe) => !activeTargetIds.has(keyframe.id));
  const readyAssetTargets = dependencyReadyTargets.filter((keyframe) =>
    isConsistencyKeyframeNo(keyframe.keyframeNo)
  );
  const readyBoundaryTargets = dependencyReadyTargets.filter((keyframe) =>
    !isConsistencyKeyframeNo(keyframe.keyframeNo)
  );
  const selectedAssetTargets = readyAssetTargets.slice(0, availableSlots);
  const remainingSlots = Math.max(0, availableSlots - selectedAssetTargets.length);
  const availableBoundarySlots = unfinishedAssetImages
    ? Math.max(
        0,
        Math.min(
          remainingSlots,
          MAX_BOUNDARY_IMAGE_CONCURRENCY_WHILE_ASSETS_PENDING - activeBoundaryCount,
        ),
      )
    : remainingSlots;
  const targets = [
    ...selectedAssetTargets,
    ...readyBoundaryTargets.slice(0, availableBoundarySlots),
  ];
  let created = false;
  for (const target of targets) {
    const revision = imageTargetSubmissionRevision(project, target);
    const queued = await enqueueVideoProductionJob({
      userId,
      projectId,
      kind: "image_prepare_submit",
      stage: "provider_submission",
      idempotencyKey: `image-submit:${projectId}:${target.id}:${revision}`,
      artifactId: imageArtifactIdForKeyframeNo(target.keyframeNo),
      targetId: target.id,
      payload: cleanInputJson({
        logEventPrefix,
        generationRevision: revision,
        keyframeNo: target.keyframeNo,
      }),
      priority: isConsistencyKeyframeNo(target.keyframeNo)
        ? ASSET_IMAGE_JOB_PRIORITY
        : BOUNDARY_IMAGE_JOB_PRIORITY,
      maxAttempts: 5,
      reactivateFailed: options.reactivateFailed,
    });
    created ||= queued.created;
    void logOnePromptVideo(`${logEventPrefix}.submit.background.queued`, {
      userId,
      projectId,
      keyframeId: target.id,
      keyframeNo: target.keyframeNo,
      generationRevision: revision,
      durableJobId: queued.id,
      durableJobCreated: queued.created,
    });
  }
  return created;
}

function dependencyReadyImageTargets(
  project: VideoProjectRecord,
  options: { includeFailed?: boolean } = {},
): VideoProjectRecord["keyframes"] {
  const nextKeyframes = [...project.keyframes]
    .sort((a, b) =>
      assetGenerationPriority(project.planJson, a.keyframeNo)
      - assetGenerationPriority(project.planJson, b.keyframeNo)
      || a.keyframeNo - b.keyframeNo
    )
    .filter((keyframe) => {
      if (keyframe.locked && keyframe.imageUrl) return false;
      if (keyframe.imageUrl) return false;
      return keyframe.status !== VideoShotStatus.IMAGE_READY
        && keyframe.status !== VideoShotStatus.IMAGE_APPROVED
        && keyframe.status !== VideoShotStatus.IMAGE_RUNNING
        && (options.includeFailed || keyframe.status !== VideoShotStatus.FAILED);
    });
  const dependencyReadyBoundaryKeyframes = nextKeyframes.filter((keyframe) =>
    !isConsistencyKeyframeNo(keyframe.keyframeNo)
    && isBoundaryAssetDependencyReady(project, keyframe.keyframeNo)
    && isTransitionReferenceReadyForBoundary(project, keyframe.keyframeNo)
  );
  const dependencyReadyAssetKeyframes = nextKeyframes.filter((keyframe) =>
    isConsistencyKeyframeNo(keyframe.keyframeNo)
    && isAssetViewGenerationReady(project, keyframe.keyframeNo)
  );
  return [
    ...dependencyReadyAssetKeyframes,
    ...dependencyReadyBoundaryKeyframes,
  ];
}

function imageTargetSubmissionRevision(
  project: VideoProjectRecord,
  keyframe: VideoProjectRecord["keyframes"][number],
): string {
  const planTarget = readPlanKeyframeMap(project.planJson).get(keyframe.keyframeNo)
    ?? readPlanConsistencyReferenceMap(project.planJson).get(keyframe.keyframeNo);
  const dependencyScope = resolveImageTargetDependencyScope(
    project.planJson,
    planTarget,
    keyframe.keyframeNo,
  );
  const referencedAssets = project.keyframes
    .filter((candidate) =>
      isConsistencyKeyframeNo(candidate.keyframeNo)
      && dependencyScope.requiredAnchorIds.includes(
        readPlanShotString(
          readPlanConsistencyReferenceMap(project.planJson).get(candidate.keyframeNo),
          ["anchorId", "anchor_id", "id"],
        ),
      )
    )
    .map((candidate) => [
      candidate.id,
      candidate.imageUrl,
      candidate.locked,
    ]);
  const candidateHistory = project.generationCandidates
    .filter((candidate) =>
      candidate.kind === "keyframe_image"
      && candidate.artifactId === imageArtifactIdForKeyframeNo(keyframe.keyframeNo)
    )
    .map((candidate) => [
      candidate.id,
      candidate.status,
      candidate.selected,
      candidate.mediaUrl,
    ]);
  return stableShortHash(JSON.stringify({
    keyframeId: keyframe.id,
    keyframeNo: keyframe.keyframeNo,
    purpose: keyframe.purpose,
    prompt: keyframe.imagePrompt,
    negativePrompt: keyframe.negativePrompt,
    planTarget,
    referencedAssets,
    candidateHistory,
  }));
}

async function queueNextClipTask(
  userId: string,
  projectId: string,
  logEventPrefix: string,
): Promise<boolean> {
  const project = await requireVideoProject(userId, projectId);
  const activeTargetIds = new Set(project.productionJobs
    .filter((job) =>
      job.kind === "clip_prepare_submit"
      && ACTIVE_VIDEO_PRODUCTION_JOB_STATUSES.includes(
        job.status as (typeof ACTIVE_VIDEO_PRODUCTION_JOB_STATUSES)[number],
      )
      && Boolean(job.targetId)
    )
    .flatMap((job) => job.targetId ? [job.targetId] : []));
  const targets = project.segments.filter((segment) =>
    !activeTargetIds.has(segment.id)
    && !segment.clipUrl
    && segment.status !== VideoShotStatus.CLIP_RUNNING
    && segment.status !== VideoShotStatus.CLIP_READY
    && segment.status !== VideoShotStatus.CLIP_APPROVED
  );
  let created = false;
  for (const segment of targets) {
    const revision = stableShortHash(JSON.stringify({
      id: segment.id,
      videoPrompt: segment.videoPrompt,
      negativePrompt: segment.negativePrompt,
      status: segment.status,
      clipUrl: segment.clipUrl,
      startKeyframeNo: segment.startKeyframeNo,
      endKeyframeNo: segment.endKeyframeNo,
    }));
    const queued = await enqueueVideoProductionJob({
      userId,
      projectId,
      kind: "clip_prepare_submit",
      stage: "provider_submission",
      idempotencyKey: `clip-submit:${projectId}:${segment.id}:${revision}`,
      artifactId: videoArtifactIdForSegmentNo(segment.segmentNo),
      targetId: segment.id,
      payload: cleanInputJson({ logEventPrefix, segmentNo: segment.segmentNo }),
      priority: 35,
    });
    created ||= queued.created;
    void logOnePromptVideo(`${logEventPrefix}.submit.background.queued`, {
      userId,
      projectId,
      segmentId: segment.id,
      segmentNo: segment.segmentNo,
      durableJobId: queued.id,
      durableJobCreated: queued.created,
    });
  }
  return created;
}

async function queueImageQualityWork(
  userId: string,
  projectId: string,
  reason: string,
): Promise<boolean> {
  const candidates = await prisma.videoGenerationCandidate.findMany({
    where: {
      projectId,
      kind: { in: ["keyframe_image", "micro_shot_image"] },
      mediaUrl: { not: null },
      status: { in: ["succeeded", "quality_retry"] },
    },
    select: { id: true, updatedAt: true },
    orderBy: { id: "asc" },
  });
  if (!candidates.length) return false;
  const revision = candidates
    .map((candidate) => `${candidate.id}:${candidate.updatedAt.getTime()}`)
    .join("|");
  const queued = await enqueueVideoProductionJob({
    userId,
    projectId,
    kind: "image_quality",
    stage: "quality_evaluation",
    targetId: projectId,
    idempotencyKey: `image-quality:${projectId}:${stableShortHash(revision)}`,
    payload: cleanInputJson({ reason }),
    priority: 50,
  });
  void logOnePromptVideo("generation_quality.worker.queued", {
    userId,
    projectId,
    reason,
    durableJobId: queued.id,
    durableJobCreated: queued.created,
  });
  return queued.created;
}

function stableShortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

async function runImageQualityWorker(userId: string, projectId: string): Promise<void> {
  await logOnePromptVideo("generation_quality.worker.start", { userId, projectId });
  for (;;) {
    const project = await requireVideoProject(userId, projectId);
    await syncGenerationCandidates(project, {
      pollUpstream: false,
      runQualityEvaluations: true,
      queueQualityWorker: false,
    });

    const candidates = await prisma.videoGenerationCandidate.findMany({
      where: {
        projectId,
        kind: { in: ["keyframe_image", "micro_shot_image"] },
        mediaUrl: { not: null },
        status: { in: ["succeeded", "quality_retry"] },
      },
      select: { status: true, qualityReport: true, metadata: true },
    });
    const now = Date.now();
    let hasImmediateWork = false;
    let nextRetryAt = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      if (candidate.status === "succeeded" && !candidate.qualityReport) {
        hasImmediateWork = true;
        break;
      }
      if (candidate.status !== "quality_retry") continue;
      const retryAt = Date.parse(String(candidateMetadata(candidate.metadata).qualityNextRetryAt || ""));
      if (!Number.isFinite(retryAt) || retryAt <= now) {
        hasImmediateWork = true;
        break;
      }
      nextRetryAt = Math.min(nextRetryAt, retryAt);
    }
    if (hasImmediateWork) continue;
    if (Number.isFinite(nextRetryAt)) {
      const delayMs = Math.max(0, Math.min(60_000, nextRetryAt - Date.now()));
      await logOnePromptVideo("generation_quality.worker.retry_wait", {
        userId,
        projectId,
        delayMs,
        nextRetryAt: new Date(nextRetryAt).toISOString(),
      });
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
    break;
  }

  let latest = await requireVideoProject(userId, projectId);
  if (isCharacterTurnaroundProject(latest.planJson)) {
    const nextReadyView = [...latest.keyframes]
      .filter((keyframe) => keyframe.keyframeNo < 0)
      .sort((a, b) => assetGenerationPriority(latest.planJson, a.keyframeNo) - assetGenerationPriority(latest.planJson, b.keyframeNo))
      .find((keyframe) => keyframe.imageUrl && !isApprovedConsistencyReference(keyframe));
    if (nextReadyView) {
      latest = await updateVideoKeyframe(userId, projectId, nextReadyView.id, { locked: true });
      await logOnePromptVideo("character_turnaround.auto_advance", {
        userId,
        projectId,
        keyframeId: nextReadyView.id,
        keyframeNo: nextReadyView.keyframeNo,
      });
    }
  }
  if (
    latest.status === VideoProjectStatus.IMAGE_GENERATING
    && latest.keyframes.some((keyframe) => keyframe.status === VideoShotStatus.IMAGE_PENDING)
  ) {
    await queueNextImageTask(userId, projectId, "generation_quality.worker");
  }
  await logOnePromptVideo("generation_quality.worker.done", { userId, projectId });
}

function requiredMicroShotImageIssues(project: VideoProjectRecord): string[] {
  const selectedCandidates = new Map(
    project.generationCandidates
      .filter((candidate) => candidate.kind === "micro_shot_image" && candidate.selected && Boolean(candidate.mediaUrl))
      .map((candidate) => [candidate.artifactId, candidate]),
  );
  return project.segments.flatMap((segment) => {
    if (!hasResolvedMicroShotPlan(project.planJson, segment.segmentNo)) {
      return [`S${segment.segmentNo} media-conditioned micro-shot plan missing`];
    }
    const microShots = readEffectivePlanMicroShots(project.planJson, segment.segmentNo);
    return microShots.flatMap((microShot) => {
      if (!isMicroShotImageRequired(microShot)) return [];
      const label = `S${segment.segmentNo}.${microShot.microShotNo}`;
      const selected = selectedCandidates.get(
        imageArtifactIdForMicroShot(segment.segmentNo, microShot.microShotNo),
      );
      const hasSelectedCandidate = Boolean(
        selected && selectedCandidateMatchesMicroShotRevision(selected, microShot),
      );
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

export async function approveShotImages(userId: string, projectId: string): Promise<VideoProjectRecord> {
  const project = await requireVideoProject(userId, projectId);
  const missing = project.keyframes.filter((keyframe) => !keyframe.imageUrl);
  if (missing.length) throw new Error("All keyframe images must be generated before approval");
  let mediaPlanning: Awaited<ReturnType<typeof runMediaConditionedPlanningAfterImageApproval>>;
  try {
    mediaPlanning = await runMediaConditionedPlanningAfterImageApproval(project);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.videoProject.update({
      where: { id: projectId },
      data: {
        status: VideoProjectStatus.IMAGE_REVIEW,
        errorMessage: `[CONTRACT_REPAIR_REQUIRED] 媒体条件规划未能产生可执行合同：${message}`,
      },
    });
    await writeStageErrorLog({
      projectId,
      title: project.title,
      stage: "micro_shots",
      event: "Media-conditioned planning contract failed",
      error,
      context: { userId, projectId },
    });
    throw error;
  }
  const unreachable = mediaPlanning.segmentPlans.filter(
    (item) => item.singleTakeContract.physicallyReachable === false,
  );
  if (unreachable.length) {
    throw new Error(
      "Approved boundary images cannot form a physically reachable single take for segment(s): "
      + unreachable.map((item) => item.segmentNo).join(", ")
      + ". Regenerate an adjacent boundary image or return to timeline planning.",
    );
  }
  const resolvedProject = await requireVideoProject(userId, projectId);
  try {
    assertPlanValidForGeneration(resolvedProject.planJson, {
      stage: "video_generation",
      targetArtifactId: "segments:batch",
    });
  } catch (error) {
    await prisma.videoProject.update({
      where: { id: projectId },
      data: { errorMessage: `[CONTRACT_REPAIR_REQUIRED] ${error instanceof Error ? error.message : String(error)}` },
    });
    throw error;
  }
  await logOnePromptVideo("micro_shot.review.start", {
    userId,
    projectId,
    keyframeCount: project.keyframes.length,
    segmentCount: project.segments.length,
    status: project.status,
    observedBoundaryCount: mediaPlanning.observedFacts.length,
    mediaConditionedSegmentCount: mediaPlanning.segmentPlans.length,
  });
  await appendProjectStageLog({
    projectId,
    title: project.title,
    stage: "micro_shots",
    event: "Micro-shot review started",
    summary: "Reviewing micro-shot image requirements before clip generation.",
    lines: resolvedProject.segments.flatMap((segment) => {
      const microShots = readEffectivePlanMicroShots(
        resolvedProject.planJson,
        segment.segmentNo,
      );
      return microShots.length
        ? microShots.map((microShot) => `Segment ${segment.segmentNo} / Micro ${microShot.microShotNo}: ${microShot.purposeZh || microShot.purpose}, reference=${microShot.referenceType || "text"}, prompt=${(localizedMicroShotImagePromptForGeneration(microShot) || "").slice(0, 240)}`)
        : [`Segment ${segment.segmentNo}: no micro-shot image references required`];
    }),
    data: {
      userId,
      keyframeCount: project.keyframes.length,
      segmentCount: project.segments.length,
      requiredMicroShotIssues: requiredMicroShotImageIssues(resolvedProject),
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
  await queueRequiredMicroShotImageTasks(userId, projectId);
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

export async function approveMicroShotReferences(userId: string, projectId: string): Promise<VideoProjectRecord> {
  const project = await requireVideoProject(userId, projectId);
  if (project.status !== VideoProjectStatus.IMAGE_REVIEW && project.status !== ("MICRO_SHOT_REVIEW" as VideoProjectStatus)) {
    throw new Error("Project is not in micro-shot review");
  }
  const missing = requiredMicroShotImageIssues(project);
  if (missing.length) {
    throw new Error(`Micro-shot reference images are not ready: ${missing.slice(0, 5).join(", ")}`);
  }
  try {
    assertPlanValidForGeneration(project.planJson, {
      stage: "video_generation",
      targetArtifactId: "segments:batch",
    });
  } catch (error) {
    await prisma.videoProject.update({
      where: { id: projectId },
      data: { errorMessage: `[CONTRACT_REPAIR_REQUIRED] ${error instanceof Error ? error.message : String(error)}` },
    });
    throw error;
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
  await prisma.$transaction([
    prisma.videoSegment.updateMany({
      where: { projectId },
      data: { status: VideoShotStatus.CLIP_PENDING, locked: true, errorMessage: null },
    }),
    prisma.videoProject.update({
      where: { id: projectId },
      data: {
        status: VideoProjectStatus.CLIP_GENERATING,
        errorMessage: null,
      },
    }),
  ]);
  await updateProjectArtifactStatus(projectId, approvedMicroShotImageArtifactIds(project), "approved", { retryFromStage: "generation" });
  try {
    await queueNextClipTask(userId, projectId, "clip.batch");
  } catch (error) {
    await prisma.$transaction([
      prisma.videoSegment.updateMany({
        where: { projectId, clipUrl: null },
        data: { status: VideoShotStatus.SCRIPT_READY, locked: false },
      }),
      prisma.videoProject.update({
        where: { id: projectId },
        data: {
          status: VideoProjectStatus.MICRO_SHOT_REVIEW,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      }),
    ]);
    throw error;
  }

  const updated = await requireVideoProject(userId, projectId);
  await logOnePromptVideo("clip.batch.submit.queued", { userId, projectId, status: updated.status });
  await appendProjectStageLog({
    projectId,
    title: updated.title,
    stage: "clips",
    event: "Clip submission queued",
    summary: "A durable worker will validate and submit the segment video tasks upstream.",
    data: {
      userId,
      status: updated.status,
      runningCount: updated.segments.filter((segment) => segment.status === VideoShotStatus.CLIP_RUNNING).length,
      pendingCount: updated.segments.filter((segment) => segment.status === VideoShotStatus.CLIP_PENDING).length,
    },
  });
  return updated;
}

function structuredCommandError(
  errorCode: string,
  message: string,
  category: ProductionErrorCategory,
  recoveryAction: string,
  context: { targetId?: string; artifactId?: string; retryable?: boolean } = {},
): StructuredCommandError {
  return new StructuredCommandError({
    errorCode,
    message,
    category,
    recoveryAction,
    ...context,
  });
}

function buildFinalCompositionSequence(project: VideoProjectRecord): {
  clipUrls: string[];
  clipDurations: number[];
  clipAudioStrategies: Array<NonNullable<VideoAudioPlan["strategy"]>>;
  subtitles: Array<{ text: string; durationSeconds: number }>;
  transitionPlan: FinalTransitionPlan[];
} {
  const sources = project.segments;
  if (!sources.length) throw new Error("Project has no canonical video segments");
  const originalPlan = readFinalTransitionPlan(project.planJson);
  const bridges = generatedBridgeArtifactsFromPlan(project.planJson);
  const skipGeneratedBridges = isOnePromptVideoFastPreviewEnabled();
  const entries: Array<{
    url: string;
    duration: number;
    subtitle: string;
    audioStrategy: NonNullable<VideoAudioPlan["strategy"]>;
    segmentNo?: number;
    bridge?: GeneratedBridgeArtifact;
  }> = [];
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    if (!source.clipUrl) throw new Error("Not all video clips are ready");
    const segmentNo = source.segmentNo;
    const planSegment = readPlanSegmentMap(project.planJson).get(segmentNo);
    entries.push({
      url: source.clipUrl,
      duration: source.durationSeconds,
      subtitle: source.subtitle || "",
      audioStrategy: resolveVideoAudioStrategy(readPlanAudioPlan(planSegment)),
      segmentNo,
    });
    const next = sources[index + 1];
    if (!next) continue;
    const nextSegmentNo = next.segmentNo;
    const transition = originalPlan.find((item) => item.fromSegmentNo === segmentNo && item.toSegmentNo === nextSegmentNo);
    if (transition?.visualMode !== "generated_bridge" && !transition?.generatedBridgeRequired) continue;
    if (skipGeneratedBridges) continue;
    const bridge = bridges.find((item) => item.fromSegmentNo === segmentNo && item.toSegmentNo === nextSegmentNo);
    if (!bridge?.locked || bridge.status !== "approved" || !bridge.selectedVideoUrl) throw new Error(`Generated bridge ${segmentNo}->${nextSegmentNo} must be generated, quality-passed, reviewed and locked before final composition`);
    entries.push({
      url: bridge.selectedVideoUrl,
      duration: bridge.durationSeconds,
      subtitle: "",
      audioStrategy: "post_only",
      bridge,
    });
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
  return {
    clipUrls: entries.map((item) => item.url),
    clipDurations: entries.map((item) => item.duration),
    clipAudioStrategies: entries.map((item) => item.audioStrategy),
    subtitles: entries.map((item) => ({ text: item.subtitle, durationSeconds: item.duration })),
    transitionPlan,
  };
}

export async function approveVideoClips(
  userId: string,
  projectId: string,
): Promise<VideoProjectRecord> {
  const project = await requireVideoProject(userId, projectId);
  const clipReviewReady = buildProjectTaskGraph(
    project,
    readVideoPlanningProgress(project.planJson),
  ).nodes.some((node) =>
    node.id === "review:clips" && node.status === "awaiting_review"
  );
  if (!clipReviewReady) {
    throw structuredCommandError(
      "CLIP_APPROVAL_NOT_ALLOWED",
      "The task graph is not awaiting clip approval",
      "state",
      "REFRESH_PROJECT",
    );
  }
  if (!project.segments.length || project.segments.some((segment) => !segment.clipUrl)) {
    throw structuredCommandError(
      "CLIPS_NOT_READY",
      "Every segment must have a generated clip before approval",
      "state",
      "WAIT_FOR_WORKER",
    );
  }
  await prisma.$transaction([
    prisma.videoSegment.updateMany({
      where: { projectId },
      data: {
        status: VideoShotStatus.CLIP_APPROVED,
        locked: true,
        errorMessage: null,
      },
    }),
    prisma.videoProject.update({
      where: { id: projectId },
      data: {
        status: VideoProjectStatus.CLIP_REVIEW,
        errorMessage: null,
      },
    }),
  ]);
  await updateProjectArtifactStatus(
    projectId,
    project.segments.map((segment) => videoArtifactIdForSegmentNo(segment.segmentNo)),
    "approved",
    { retryFromStage: "generation" },
  );
  await logOnePromptVideo("clips.approve.completed", {
    userId,
    projectId,
    segmentCount: project.segments.length,
  });
  return requireVideoProject(userId, projectId);
}

export async function composeVideoProject(userId: string, projectId: string): Promise<VideoProjectRecord> {
  const project = await requireVideoProject(userId, projectId);
  if (
    project.status !== VideoProjectStatus.CLIP_REVIEW
    && project.status !== VideoProjectStatus.FINAL_REVIEW
    && project.status !== VideoProjectStatus.DONE
    && project.status !== VideoProjectStatus.COMPOSING
  ) {
    throw new Error("Current project is not ready for composition");
  }
  if (!project.segments.length || project.segments.some((segment) =>
    !segment.clipUrl
    || (!segment.locked && segment.status !== VideoShotStatus.CLIP_APPROVED)
  )) {
    throw structuredCommandError(
      "CLIP_APPROVAL_REQUIRED",
      "Approve every generated clip before composition",
      "state",
      "APPROVE_CLIPS",
    );
  }
  if (project.finalVideoUrl && (
    project.status === VideoProjectStatus.FINAL_REVIEW
    || project.status === VideoProjectStatus.DONE
  )) {
    return project;
  }
  const composition = buildFinalCompositionSequence(project);
  const revision = stableShortHash(JSON.stringify({
    clipUrls: composition.clipUrls,
    clipDurations: composition.clipDurations,
    clipAudioStrategies: composition.clipAudioStrategies,
    transitionPlan: composition.transitionPlan,
    aspectRatio: project.aspectRatio,
    audioBible: readAudioBible(project.planJson),
  }));
  const queued = await enqueueVideoProductionJob({
    userId,
    projectId,
    kind: "compose",
    stage: "composition",
    idempotencyKey: `compose:${projectId}:${revision}`,
    artifactId: "final_video",
    targetId: "final",
    payload: cleanInputJson({ revision }),
    priority: 25,
    maxAttempts: 3,
    reactivateFailed: true,
  });
  const updated = await prisma.videoProject.update({
    where: { id: projectId },
    data: {
      status: VideoProjectStatus.COMPOSING,
      errorMessage: null,
    },
    include: PROJECT_INCLUDE,
  });
  await logOnePromptVideo("compose.background.queued", {
    userId,
    projectId,
    revision,
    durableJobId: queued.id,
    durableJobCreated: queued.created,
  });
  return updated;
}

async function performVideoProjectComposition(userId: string, projectId: string): Promise<VideoProjectRecord> {
  const project = await requireVideoProject(userId, projectId);
  if (
    project.status !== VideoProjectStatus.CLIP_REVIEW &&
    project.status !== VideoProjectStatus.COMPOSING &&
    project.status !== VideoProjectStatus.FINAL_REVIEW &&
    project.status !== VideoProjectStatus.DONE
  ) {
    throw new Error("Current project is not ready for composition");
  }

  const sourceCount = project.segments.length;
  const sourceClipUrls = project.segments.map((item) => item.clipUrl).filter((url): url is string => Boolean(url));
  if (!sourceCount || sourceClipUrls.length !== sourceCount) throw new Error("Not all video clips are ready");
  const composition = buildFinalCompositionSequence(project);
  const { clipUrls, clipDurations, clipAudioStrategies, subtitles, transitionPlan } = composition;
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
      clipAudioStrategies,
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
      clipAudioStrategies,
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

  await prisma.videoSegment.updateMany({
    where: { projectId },
    data: { status: VideoShotStatus.CLIP_APPROVED, locked: true, errorMessage: null },
  });
  await updateProjectArtifactStatus(projectId, project.segments.filter((segment) => Boolean(segment.clipUrl)).map((segment) => videoArtifactIdForSegmentNo(segment.segmentNo)), "approved", { retryFromStage: "generation" });

  const updated = await prisma.videoProject.update({
    where: { id: projectId },
    data: {
      status: VideoProjectStatus.FINAL_REVIEW,
      finalVideoUrl,
      errorMessage: null,
    },
    include: PROJECT_INCLUDE,
  });
  await updateProjectArtifactStatus(projectId, ["final_video"], "ready", { retryFromStage: "composition" });
  await logOnePromptVideo("compose.submit.success", {
    userId,
    projectId,
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
export async function finishVideoProject(userId: string, projectId: string): Promise<VideoProjectRecord> {
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
): Promise<VideoProjectRecord> {
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

  const rollbackPlan = cloneJsonRecord(project.planJson ?? {});
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
          clipUrl: null,
          qualityScore: null,
          errorMessage: null,
          locked: false,
        },
      });
      clearPlanMicroShotImages(rollbackPlan, "segments");
    } else if (target === "ASSET_LIBRARY_REVIEW") {
      await tx.videoKeyframe.updateMany({
        where: { projectId, keyframeNo: { lt: 0 }, imageUrl: { not: null } },
        data: {
          status: VideoShotStatus.IMAGE_READY,
          qualityScore: null,
          errorMessage: null,
          locked: false,
        },
      });
      await tx.videoKeyframe.updateMany({
        where: { projectId, keyframeNo: { lt: 0 }, imageUrl: null },
        data: {
          status: VideoShotStatus.SCRIPT_READY,
          qualityScore: null,
          errorMessage: null,
          locked: false,
        },
      });
      await tx.videoKeyframe.updateMany({
        where: { projectId, keyframeNo: { gt: 0 } },
        data: {
          status: VideoShotStatus.SCRIPT_READY,
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
          clipUrl: null,
          qualityScore: null,
          errorMessage: null,
          locked: false,
        },
      });
      clearPlanMicroShotImages(rollbackPlan, "segments");
    } else if (target === "IMAGE_REVIEW") {
      await tx.videoKeyframe.updateMany({
        where: { projectId, keyframeNo: { lt: 0 }, imageUrl: { not: null } },
        data: {
          status: VideoShotStatus.IMAGE_APPROVED,
          errorMessage: null,
          locked: true,
        },
      });
      await tx.videoKeyframe.updateMany({
        where: { projectId, keyframeNo: { lt: 0 }, imageUrl: null },
        data: { status: VideoShotStatus.SCRIPT_READY, errorMessage: null, locked: false },
      });
      await tx.videoKeyframe.updateMany({
        where: { projectId, keyframeNo: { gt: 0 }, imageUrl: { not: null } },
        data: {
          status: VideoShotStatus.IMAGE_READY,
          errorMessage: null,
          locked: false,
        },
      });
      await tx.videoKeyframe.updateMany({
        where: { projectId, keyframeNo: { gt: 0 }, imageUrl: null },
        data: { status: VideoShotStatus.SCRIPT_READY, errorMessage: null, locked: false },
      });
      await tx.videoSegment.updateMany({
        where: { projectId },
        data: {
          status: VideoShotStatus.SCRIPT_READY,
          clipUrl: null,
          qualityScore: null,
          errorMessage: null,
          locked: false,
        },
      });
      rollbackPlanToBoundaryReview(rollbackPlan, project.keyframes);
    } else if (target === "MICRO_SHOT_REVIEW") {
      await tx.videoKeyframe.updateMany({
        where: { projectId, imageUrl: { not: null } },
        data: { status: VideoShotStatus.IMAGE_APPROVED, locked: true, errorMessage: null },
      });
      await tx.videoSegment.updateMany({
        where: { projectId },
        data: {
          status: VideoShotStatus.SCRIPT_READY,
          clipUrl: null,
          qualityScore: null,
          errorMessage: null,
          locked: false,
        },
      });
    } else if (target === "CLIP_REVIEW") {
      await tx.videoSegment.updateMany({
        where: { projectId, clipUrl: { not: null } },
        data: { status: VideoShotStatus.CLIP_READY, errorMessage: null, locked: false },
      });
    }

    await tx.videoProject.update({
      where: { id: projectId },
      data: {
        status: target === "ASSET_LIBRARY_REVIEW" ? VideoProjectStatus.IMAGE_REVIEW : target as VideoProjectStatus,
        finalVideoUrl: target === "CLIP_REVIEW" ? project.finalVideoUrl : null,
        errorMessage: null,
      },
    });
    return { cancelledCandidateCount: cancelledCandidates.count };
  });

  await commitArtifactPlan(projectId, rollbackPlan);
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
    WAITING_RECOVERY: 6,
    STATE_INVARIANT_VIOLATION: 6,
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

function clearPlanMicroShotImages(plan: Record<string, unknown>, collectionKey: "segments"): void {
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
      delete next.image_task_id;
      delete next.errorMessage;
      delete next.error_message;
      next.imageStatus = "idle";
      next.image_status = "idle";
      return next;
    });
  }
}

export async function syncVideoProject(userId: string, projectId: string): Promise<VideoProjectRecord> {
  const project = await requireVideoProject(userId, projectId);
  await logOnePromptVideo("project.sync.read", {
    userId,
    projectId,
    status: project.status,
    productionMode: "read_only",
  });
  return project;
}

async function runVideoProjectReconcileWorker(userId: string, projectId: string): Promise<VideoProjectRecord> {
  let project = await requireVideoProject(userId, projectId);
  await logOnePromptVideo("project.sync.start", {
    userId,
    projectId,
    status: project.status,
    keyframes: project.keyframes.map((keyframe) => ({
      keyframeNo: keyframe.keyframeNo,
      status: keyframe.status,
      hasImageUrl: Boolean(keyframe.imageUrl),
    })),
    segments: project.segments.map((segment) => ({
      segmentNo: segment.segmentNo,
      status: segment.status,
      hasClipUrl: Boolean(segment.clipUrl),
    })),
  });

  await syncTransitionReferenceArtifacts(project);
  await syncGeneratedBridgeCandidates(project);
  await syncGenerationCandidates(project);
  // Candidate rows are the only upstream-task observations. Entity task-id
  // columns are write-through display projections and are never polled.
  project = await requireVideoProject(userId, projectId);
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

export async function projectProductionProjection(projectId: string) {
  const storedProject = await prisma.videoProject.findUnique({
    where: { id: projectId },
    include: PROJECT_INCLUDE,
  });
  if (!storedProject) throw new Error("Video project not found");
  const project = {
    ...storedProject,
    planJson: await readArtifactPlan(projectId, {
      allowMissing: !storedProject.planJson,
    }),
  } as VideoProjectRecord;
  const plannerProgress = readVideoPlanningProgress(project.planJson);
  const taskGraph = buildProjectTaskGraph(project, plannerProgress);
  const artifactNodes = taskGraph.nodes.filter((node) =>
    node.active !== false
    && node.type !== "review_gate"
    && !node.id.startsWith("cancelled:")
  );
  return normalizeCharacterTurnaroundProductionProjection(project, computeProjectProductionProjection({
    jobs: project.productionJobs,
    taskGraphNodes: taskGraph.nodes,
    completedArtifactCount: artifactNodes.filter((node) => node.status === "completed").length,
    totalArtifactCount: artifactNodes.length,
    finalVideoReady: Boolean(project.finalVideoUrl),
  }));
}

function normalizeCharacterTurnaroundProductionProjection(
  project: VideoProjectRecord,
  projection: ReturnType<typeof computeProjectProductionProjection>,
): ReturnType<typeof computeProjectProductionProjection> {
  if (!isCharacterTurnaroundProject(project.planJson)) return projection;
  const assetFrames = project.keyframes.filter((keyframe) =>
    isConsistencyKeyframeNo(keyframe.keyframeNo)
  );
  const allApproved = assetFrames.length === 3 && assetFrames.every((keyframe) =>
    Boolean(keyframe.imageUrl)
    && (keyframe.locked || keyframe.status === VideoShotStatus.IMAGE_APPROVED)
  );
  if (allApproved) {
    return {
      ...projection,
      status: "DONE",
      source: "task_graph",
      errorCode: undefined,
      errorMessage: undefined,
      recoveryAction: undefined,
      frontierNodeId: undefined,
    };
  }
  const awaitingAssetApproval = assetFrames.some((keyframe) =>
    Boolean(keyframe.imageUrl)
    && !keyframe.locked
    && keyframe.status !== VideoShotStatus.IMAGE_APPROVED
  );
  if (awaitingAssetApproval && projection.status === "STATE_INVARIANT_VIOLATION") {
    return {
      ...projection,
      status: "IMAGE_REVIEW",
      source: "review_gate",
      errorCode: undefined,
      errorMessage: undefined,
      recoveryAction: undefined,
      frontierNodeId: undefined,
    };
  }
  return projection;
}

async function persistProjectProductionProjection(projectId: string): Promise<void> {
  const projection = await projectProductionProjection(projectId);
  const current = await prisma.videoProject.findUnique({
    where: { id: projectId },
    select: { status: true, errorMessage: true },
  });
  if (!current) return;
  const nextStatus = projection.status as VideoProjectStatus;
  const structuralError = projection.errorMessage
    ? `[${projection.errorCode ?? "PRODUCTION_STATE_ERROR"}] ${projection.errorMessage}`
    : null;
  const clearStructuralError = (
    current.status === VideoProjectStatus.WAITING_RECOVERY
    || current.status === VideoProjectStatus.STATE_INVARIANT_VIOLATION
  ) && !structuralError;
  if (
    current.status === nextStatus
    && (!structuralError || current.errorMessage === structuralError)
    && !clearStructuralError
  ) return;
  await prisma.videoProject.update({
    where: { id: projectId },
    data: {
      status: nextStatus,
      ...(structuralError
        ? { errorMessage: structuralError }
        : clearStructuralError
          ? { errorMessage: null }
          : {}),
    },
  });
}

const fastPreviewAutoAdvanceLocks = new Set<string>();

async function autoAdvanceFastPreviewProject(
  userId: string,
  projectId: string,
): Promise<void> {
  if (!isOnePromptVideoFastPreviewEnabled() || fastPreviewAutoAdvanceLocks.has(projectId)) return;
  fastPreviewAutoAdvanceLocks.add(projectId);
  try {
    for (let step = 0; step < 6; step += 1) {
      const project = await requireVideoProject(userId, projectId);
      if (project.status === VideoProjectStatus.PLAN_REVIEW) {
        await logOnePromptVideo("fast_preview.review_auto_approved", {
          userId,
          projectId,
          review: "plan",
        }, "warn");
        await approveVideoPlan(userId, projectId);
        continue;
      }
      if (project.status === VideoProjectStatus.IMAGE_REVIEW) {
        const assets = project.keyframes.filter((keyframe) =>
          isConsistencyKeyframeNo(keyframe.keyframeNo)
          && isEligibleConsistencyKeyframe(project.planJson, keyframe.keyframeNo)
        );
        const pendingAssetReview = assets.some((keyframe) => !keyframe.locked);
        if (pendingAssetReview && assets.every((keyframe) => Boolean(keyframe.imageUrl))) {
          await logOnePromptVideo("fast_preview.review_auto_approved", {
            userId,
            projectId,
            review: "asset_library",
          }, "warn");
          await approveAssetLibrary(userId, projectId);
          continue;
        }
        if (!pendingAssetReview && project.keyframes.every((keyframe) => Boolean(keyframe.imageUrl))) {
          await logOnePromptVideo("fast_preview.review_auto_approved", {
            userId,
            projectId,
            review: "boundary_images",
          }, "warn");
          await approveShotImages(userId, projectId);
          continue;
        }
        return;
      }
      if (project.status === VideoProjectStatus.MICRO_SHOT_REVIEW) {
        if (requiredMicroShotImageIssues(project).length) return;
        await logOnePromptVideo("fast_preview.review_auto_approved", {
          userId,
          projectId,
          review: "micro_shot_references",
        }, "warn");
        await approveMicroShotReferences(userId, projectId);
        continue;
      }
      if (project.status === VideoProjectStatus.CLIP_REVIEW) {
        if (!project.segments.length || project.segments.some((segment) => !segment.clipUrl)) return;
        await logOnePromptVideo("fast_preview.review_auto_approved", {
          userId,
          projectId,
          review: "video_clips",
        }, "warn");
        await approveVideoClips(userId, projectId);
        await composeVideoProject(userId, projectId);
        return;
      }
      if (project.status === VideoProjectStatus.FINAL_REVIEW && project.finalVideoUrl) {
        await logOnePromptVideo("fast_preview.review_auto_approved", {
          userId,
          projectId,
          review: "final_video",
        }, "warn");
        await finishVideoProject(userId, projectId);
      }
      return;
    }
  } catch (error) {
    await logOnePromptVideo("fast_preview.auto_advance_blocked", {
      userId,
      projectId,
      ...errorForLog(error),
    }, "warn");
  } finally {
    fastPreviewAutoAdvanceLocks.delete(projectId);
  }
}

export async function pumpVideoProductionJobs(options: {
  maxJobs?: number;
  workerId?: string;
  runtimeVersion?: string;
  kinds?: VideoProductionJobKind[];
  shouldStop?: () => boolean;
  onLeaseAcquired?: (lease: {
    id: string;
    projectId: string;
    leaseToken: string;
  }) => Promise<void> | void;
  onLeaseReleased?: (lease: {
    id: string;
    projectId: string;
    leaseToken: string;
  }) => Promise<void> | void;
} = {}): Promise<{
  claimedCount: number;
  completedCount: number;
  retriedCount: number;
  failedCount: number;
  meaningfulProgressCount: number;
}> {
  const maxJobs = Math.max(1, Math.min(100, options.maxJobs ?? 20));
  const workerId = options.workerId ?? productionWorkerId;
  const runtimeVersion = options.runtimeVersion ?? resolveVideoProductionRuntimeVersion();
  let claimedCount = 0;
  let completedCount = 0;
  let retriedCount = 0;
  let failedCount = 0;
  let meaningfulProgressCount = 0;
  for (let index = 0; index < maxJobs; index += 1) {
    if (options.shouldStop?.()) break;
    const job = await claimNextVideoProductionJob({
      workerId,
      runtimeVersion,
      kinds: options.kinds,
      supportedPayloadVersions: SUPPORTED_VIDEO_PRODUCTION_PAYLOAD_VERSIONS,
      leaseMs: 3 * 60_000,
    });
    if (!job?.leaseToken) break;
    const activeLease = {
      id: job.id,
      projectId: job.projectId,
      leaseToken: job.leaseToken,
    };
    await options.onLeaseAcquired?.(activeLease);
    claimedCount += 1;
    let leaseLost = false;
    let heartbeatInFlight = false;
    const heartbeat = setInterval(() => {
      if (heartbeatInFlight || leaseLost) return;
      heartbeatInFlight = true;
      void heartbeatVideoProductionJob(job.id, job.leaseToken as string, 3 * 60_000)
        .then((renewed) => {
          if (!renewed) leaseLost = true;
        })
        .catch(() => {
          leaseLost = true;
        })
        .finally(() => {
          heartbeatInFlight = false;
        });
    }, 30_000);
    heartbeat.unref?.();
    try {
      const result = await processClaimedVideoProductionJob(job);
      const stillOwned = !leaseLost
        && await heartbeatVideoProductionJob(job.id, job.leaseToken, 3 * 60_000);
      if (!stillOwned) {
        await logOnePromptVideo("production_job.worker.lease_lost", {
          jobId: job.id,
          projectId: job.projectId,
          kind: job.kind,
        }, "warn");
        continue;
      }
      if (result.rescheduleAt) {
        const rescheduled = await rescheduleVideoProductionJob({
          id: job.id,
          leaseToken: job.leaseToken,
          stage: result.stage,
          availableAt: result.rescheduleAt,
        });
        if (rescheduled) retriedCount += 1;
        continue;
      }
      const completed = await completeVideoProductionJob({
        id: job.id,
        leaseToken: job.leaseToken,
        stage: result.stage,
      });
      if (completed) {
        completedCount += 1;
        if (result.meaningfulProgress) meaningfulProgressCount += 1;
      }
    } catch (error) {
      if (leaseLost || error instanceof LostProductionJobLeaseError) {
        await logOnePromptVideo("production_job.worker.lease_lost", {
          jobId: job.id,
          projectId: job.projectId,
          kind: job.kind,
          ...errorForLog(error),
        }, "warn");
        continue;
      }
      if (isProviderCapacityError(error)) {
        const outcome = await deferVideoProductionJobForCapacity({
          id: job.id,
          leaseToken: job.leaseToken,
          error,
        });
        if (outcome === "queued") retriedCount += 1;
        if (outcome === "paused") {
          failedCount += 1;
        }
        await logOnePromptVideo("production_job.worker.capacity_wait", {
          jobId: job.id,
          projectId: job.projectId,
          targetId: job.targetId,
          kind: job.kind,
          outcome,
          ...errorForLog(error),
        }, outcome === "paused" ? "warn" : "info");
        continue;
      }
      const classification = classifyVideoProductionFailure(error);
      const disposition = classification.disposition;
      const outcome = disposition === "retry"
        ? await retryVideoProductionJob({
            id: job.id,
            leaseToken: job.leaseToken,
            error,
            stage: job.stage as VideoProductionStage,
            category: classification.category,
          })
        : await failVideoProductionJob({
            id: job.id,
            leaseToken: job.leaseToken,
            error,
            stage: disposition === "contract_repair_required"
              ? "contract_validation"
              : job.stage as VideoProductionStage,
            category: classification.category,
            errorCode: structuredErrorString(error, "code")
              || (disposition === "contract_repair_required"
                ? "EXECUTION_CONTRACT_INVALID"
                : disposition === "stage_repairable"
                  ? "STRUCTURED_OUTPUT_SYNTAX_ERROR"
                : "PRODUCTION_JOB_FAILED"),
            recoveryAction: structuredErrorString(error, "recoveryAction")
              || (disposition === "contract_repair_required"
                ? "REPAIR_CONTRACT"
                : disposition === "stage_repairable"
                  ? "RETRY_STAGE"
                : "RETRY_JOB"),
          }).then((updated) => updated ? "failed" as const : "lost" as const);
      if (outcome === "failed") failedCount += 1;
      else if (outcome === "queued") retriedCount += 1;
      await logOnePromptVideo("production_job.worker.error", {
        jobId: job.id,
        projectId: job.projectId,
        kind: job.kind,
        stage: job.stage,
        disposition,
        errorCategory: classification.category,
        outcome,
        ...errorForLog(error),
      }, outcome === "failed" ? "error" : "warn");
    } finally {
      clearInterval(heartbeat);
      await options.onLeaseReleased?.(activeLease);
      await persistProjectProductionProjection(job.projectId).catch((error) =>
        logOnePromptVideo("production_projection.persist.error", {
          projectId: job.projectId,
          jobId: job.id,
          ...errorForLog(error),
        }, "error")
      );
      await autoAdvanceFastPreviewProject(job.userId, job.projectId);
    }
  }
  return { claimedCount, completedCount, retriedCount, failedCount, meaningfulProgressCount };
}

type ProductionJobProcessResult = {
  stage: VideoProductionStage;
  meaningfulProgress: boolean;
  rescheduleAt?: Date;
};

const SUBMITTED_TARGET_JOB_STAGES = new Set<VideoProductionStage>([
  "provider_polling",
]);

async function continueSubmittedTargetJob(
  job: NonNullable<Awaited<ReturnType<typeof claimNextVideoProductionJob>>>,
): Promise<ProductionJobProcessResult> {
  await setVideoProductionJobStage({
    id: job.id,
    leaseToken: job.leaseToken as string,
    stage: "provider_polling",
    meaningfulProgress: false,
  });
  const project = await runVideoProjectReconcileWorker(job.userId, job.projectId);
  const candidates = project.generationCandidates.filter((candidate) =>
    candidate.status !== "cancelled"
    && (
      (job.artifactId && candidate.artifactId === job.artifactId)
      || (!job.artifactId && candidate.targetId === job.targetId)
    )
  );
  const latestCandidate = candidates[0];
  const activeCandidate = candidates.some((candidate) =>
    ["pending", "running", "evaluating", "quality_retry"].includes(candidate.status)
  );
  if (latestCandidate?.mediaUrl) {
    return { stage: "provider_polling", meaningfulProgress: true };
  }
  if (latestCandidate && ["failed", "quality_failed"].includes(latestCandidate.status)) {
    throw new Error(
      latestCandidate.errorMessage
      || latestCandidate.retryInstruction
      || `${job.kind} upstream candidate failed`,
    );
  }
  if (activeCandidate) {
    return {
      stage: "provider_polling",
      meaningfulProgress: false,
      rescheduleAt: new Date(Date.now() + 3_000),
    };
  }
  if (!latestCandidate) {
    throw new ProductionSchedulingInvariantError(
      `${job.kind} completed submission without a persisted generation candidate`,
    );
  }
  return { stage: "provider_polling", meaningfulProgress: true };
}

async function processClaimedVideoProductionJob(
  job: NonNullable<Awaited<ReturnType<typeof claimNextVideoProductionJob>>>,
): Promise<ProductionJobProcessResult> {
  const payload = candidateMetadata(job.payload);
  const payloadSchemaVersion = Number(payload.payloadSchemaVersion || 0);
  const contractVersion = Number(payload.contractVersion || 0);
  const payloadWorkerVersion = firstNonEmptyString([payload.requiredWorkerVersion]);
  if (
    payloadSchemaVersion !== VIDEO_PRODUCTION_PAYLOAD_SCHEMA_VERSION
    || contractVersion !== VIDEO_PRODUCTION_CONTRACT_VERSION
    || payloadWorkerVersion !== job.requiredWorkerVersion
    || job.claimedWorkerVersion !== job.requiredWorkerVersion
  ) {
    throw new ProductionSchedulingInvariantError(
      `${job.kind} version handshake failed: payload=${payloadSchemaVersion || "legacy"}, `
      + `contract=${contractVersion || "legacy"}, required=${job.requiredWorkerVersion}, `
      + `payloadWorker=${payloadWorkerVersion || "missing"}, claimed=${job.claimedWorkerVersion || "missing"}.`,
    );
  }
  const leaseToken = job.leaseToken as string;
  await assertVideoProductionJobLease(job.id, leaseToken);
  await logOnePromptVideo("production_job.worker.start", {
    jobId: job.id,
    projectId: job.projectId,
    kind: job.kind,
    stage: job.stage,
    attempt: job.attempt,
    modelAttempt: job.modelAttempt,
    stageRepairAttempt: job.stageRepairAttempt,
    infrastructureAttempt: job.infrastructureAttempt,
    leaseLossCount: job.leaseLossCount,
  });
  if (
    (
      job.kind === "image_prepare_submit"
      || job.kind === "micro_shot_prepare_submit"
      || job.kind === "clip_prepare_submit"
    )
    && SUBMITTED_TARGET_JOB_STAGES.has(job.stage as VideoProductionStage)
  ) {
    return continueSubmittedTargetJob(job);
  }
  if (job.kind === "planning") {
    await setVideoProductionJobStage({ id: job.id, leaseToken, stage: "planning" });
    const taskId = firstNonEmptyString([payload.taskId]);
    if (!taskId) throw new Error("Durable planning job is missing taskId");
    await planVideoProject(job.userId, job.projectId, undefined, {
      planningTaskId: taskId,
      planningAttemptNumber: Math.max(1, job.modelAttempt + 1),
      planningAttemptQueuedAt: job.availableAt,
    });
    return { stage: "planning", meaningfulProgress: true };
  }
  if (job.kind === "image_prepare_submit") {
    await setVideoProductionJobStage({ id: job.id, leaseToken, stage: "provider_submission" });
    const project = await requireVideoProject(job.userId, job.projectId);
    if (!job.targetId?.trim()) {
      throw new ProductionSchedulingInvariantError(
        "image_prepare_submit is missing targetId; refusing to infer a different target during execution",
      );
    }
    if (payload.action === "regenerate") {
      await regenerateKeyframeImageInternal(
        job.userId,
        job.projectId,
        firstNonEmptyString([payload.requestedShotId]) || job.targetId,
        { recovery: payload.recovery === true, executeInline: true },
      );
    } else {
      await submitNextImageTaskWork({
        userId: job.userId,
        projectId: job.projectId,
        keyframes: project.keyframes,
        logEventPrefix: firstNonEmptyString([payload.logEventPrefix]) || "image.worker",
        targetId: job.targetId,
      });
    }
    return {
      stage: "provider_polling",
      meaningfulProgress: true,
      rescheduleAt: new Date(Date.now() + 2_000),
    };
  }
  if (job.kind === "micro_shot_prepare_submit") {
    if (!job.targetId?.trim()) {
      throw new ProductionSchedulingInvariantError(
        "micro_shot_prepare_submit is missing targetId",
      );
    }
    await setVideoProductionJobStage({ id: job.id, leaseToken, stage: "provider_submission" });
    if (payload.action === "regenerate") {
      const shotId = firstNonEmptyString([payload.shotId]);
      const microShotNo = Number(payload.microShotNo);
      if (!shotId || !Number.isInteger(microShotNo) || microShotNo < 1) {
        throw new ProductionSchedulingInvariantError(
          "micro-shot regenerate payload is incomplete",
        );
      }
      await regenerateMicroShotImageInternal(job.userId, job.projectId, shotId, microShotNo, {
        microShot: isRecord(payload.microShot)
          ? payload.microShot as Partial<VideoMicroShot>
          : undefined,
        locale: payload.locale === "en" ? "en" : payload.locale === "zh" ? "zh" : undefined,
        executeInline: true,
      });
    } else {
      await submitRequiredMicroShotImageTasks(job.userId, job.projectId, {
        retryFailed: payload.retryFailed === true,
        targetId: job.targetId,
      });
    }
    return {
      stage: "provider_polling",
      meaningfulProgress: true,
      rescheduleAt: new Date(Date.now() + 2_000),
    };
  }
  if (job.kind === "clip_prepare_submit") {
    if (!job.targetId?.trim()) {
      throw new ProductionSchedulingInvariantError("clip_prepare_submit is missing targetId");
    }
    await setVideoProductionJobStage({ id: job.id, leaseToken, stage: "contract_validation" });
    const project = await requireVideoProject(job.userId, job.projectId);
    const targetSegment = project.segments.find((segment) => segment.id === job.targetId);
    if (!targetSegment) {
      throw new ProductionSchedulingInvariantError(`clip target ${job.targetId} does not exist`);
    }
    if (targetSegment.clipUrl) {
      return { stage: "provider_submission", meaningfulProgress: true };
    }
    await setVideoProductionJobStage({ id: job.id, leaseToken, stage: "provider_submission" });
    if (payload.action === "regenerate") {
      await regenerateSegmentClipInternal(job.userId, job.projectId, job.targetId, {
        executeInline: true,
      });
    } else {
      await submitNextClipTask({
        userId: job.userId,
        projectId: job.projectId,
        segments: project.segments,
        keyframes: project.keyframes,
        logEventPrefix: firstNonEmptyString([payload.logEventPrefix]) || "clip.worker",
        targetId: job.targetId,
      });
    }
    return {
      stage: "provider_polling",
      meaningfulProgress: true,
      rescheduleAt: new Date(Date.now() + 2_000),
    };
  }
  if (job.kind === "image_quality") {
    await setVideoProductionJobStage({ id: job.id, leaseToken, stage: "quality_evaluation" });
    await runImageQualityWorker(job.userId, job.projectId);
    const latest = await requireVideoProject(job.userId, job.projectId);
    const unselectedReviewed = hasUnresolvedSelectableImageCandidate(latest);
    if (unselectedReviewed) return { stage: "quality_evaluation", meaningfulProgress: true };
    const waitingAssetConfirmation = latest.status === VideoProjectStatus.IMAGE_REVIEW
      && latest.keyframes.some((keyframe) =>
        keyframe.keyframeNo < 0
        && Boolean(keyframe.imageUrl)
        && !keyframe.locked
      );
    return {
      stage: "quality_evaluation",
      meaningfulProgress: true,
    };
  }
  if (job.kind === "compose") {
    if (job.targetId !== "final") {
      throw new ProductionSchedulingInvariantError(
        "compose requires targetId=final",
      );
    }
    await setVideoProductionJobStage({ id: job.id, leaseToken, stage: "composition" });
    await performVideoProjectComposition(job.userId, job.projectId);
    return { stage: "composition", meaningfulProgress: true };
  }
  throw new ProductionSchedulingInvariantError(`Unsupported production job kind: ${job.kind}`);
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
    const candidate = project.generationCandidates.find((item) =>
      item.artifactId === imageArtifactIdForKeyframeNo(keyframe.keyframeNo)
      && Boolean(item.taskId)
    );
    const persisted = await refreshAndPersistTemporaryImage({
      projectId,
      currentUrl: keyframe.imageUrl as string,
      taskId: candidate?.taskId,
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

  for (const segment of project.segments) {
    const microShots = readEffectivePlanMicroShots(project.planJson, segment.segmentNo);
    for (const microShot of microShots) {
      if (!isTemporaryDashScopeUrl(microShot.imageUrl)) continue;
      const artifactId = imageArtifactIdForMicroShot(segment.segmentNo, microShot.microShotNo);
      const candidate = project.generationCandidates.find((item) =>
        item.artifactId === artifactId && Boolean(item.taskId)
      );
      const persisted = await refreshAndPersistTemporaryImage({
        projectId,
        currentUrl: microShot.imageUrl as string,
        taskId: candidate?.taskId,
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

function structuredErrorString(
  error: unknown,
  field: "code" | "recoveryAction",
): string | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const value = Reflect.get(error, field);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function imageRepairConvergenceStage(
  report: GenerationQualityReport,
): RepairConvergenceStage {
  if (report.retryFromStage === "stage2b") return "stage2b";
  if (report.retryFromStage === "stage3") return "stage3";
  if (report.retryFromStage === "reference_selector") return "reference_selector";
  if (report.retryFromStage === "manual") return "manual";
  return "generation";
}

function imageRepairConvergenceDecision(params: {
  candidate: ImageQualityCandidate;
  report: GenerationQualityReport;
  previousCandidate?: ImageQualityCandidate;
}): RepairConvergenceDecision {
  const metadata = candidateMetadata(params.candidate.metadata);
  const previousMetadata = candidateMetadata(params.previousCandidate?.metadata ?? null);
  const targetContract = isRecord(metadata.targetContract) ? metadata.targetContract : {};
  const visualContract = isRecord(metadata.visualContract) ? metadata.visualContract : {};
  const explicitRevision = readPlanShotString(targetContract, [
    "resolvedRevisionId",
    "resolved_revision_id",
    "contractRevision",
    "contract_revision",
  ]);
  const contractRevision = buildRepairContractRevision({
    artifactId: params.candidate.artifactId,
    targetContract,
    visualContract,
    referenceSet: {
      urls: stringArrayValue(metadata.selectedReferenceUrls),
      roles: stringArrayValue(metadata.referenceUsageNotes),
    },
    explicitRevision,
  });
  const previousEpisode = repairConvergenceEpisodeFromUnknown(
    previousMetadata.repairConvergenceEpisode,
  );
  const requestedMode = firstNonEmptyString([
    metadata.repairMode,
    params.report.repairDecision?.mode,
    previousEpisode?.nextRepairMode,
  ]) as ImageRepairMode || "local_edit";
  return advanceRepairConvergence({
    previous: previousEpisode,
    stage: imageRepairConvergenceStage(params.report),
    repairMode: requestedMode,
    contractRevision,
    report: params.report,
    candidateId: params.candidate.id,
    candidateNo: params.candidate.candidateNo,
  });
}

function convergenceMetadata(
  decision: RepairConvergenceDecision,
): Record<string, unknown> {
  return {
    repairConvergenceEpisode: decision.episode,
    repairConvergence: {
      acceptedAsBaseline: decision.acceptedAsBaseline,
      strictlyImproved: decision.strictlyImproved,
      mayContinueAutomatically: decision.mayContinueAutomatically,
      nextRepairMode: decision.nextRepairMode,
      terminalState: decision.terminalState,
      reason: decision.reason,
    },
  };
}

function qualityEvaluationFingerprintForCandidate(
  candidate: Pick<
    VideoProjectRecord["generationCandidates"][number],
    "kind" | "mediaUrl" | "prompt" | "negativePrompt" | "metadata"
  >,
): string | undefined {
  if (!candidate.mediaUrl) return undefined;
  const metadata = candidateMetadata(candidate.metadata);
  const candidateContentHash = firstNonEmptyString([metadata.mediaContentHash]);
  const referenceContentIdentities = Array.isArray(metadata.referenceContentIdentities)
    ? metadata.referenceContentIdentities.filter(isRecord)
    : [];
  if (!candidateContentHash) return undefined;
  const referenceSetHash = buildQualityReferenceSetHash(referenceContentIdentities.map((item) => ({
    contentHash: firstNonEmptyString([item.contentHash]),
    usageNote: firstNonEmptyString([item.usageNote]),
  })));
  const targetContract = isRecord(metadata.targetContract) ? metadata.targetContract : {};
  const visualContract = isRecord(metadata.visualContract) ? metadata.visualContract : {};
  return buildQualityEvaluationFingerprint({
    kind: candidate.kind,
    candidateContentHash,
    referenceSetHash,
    qualityPolicyVersion: QUALITY_POLICY_VERSION,
    qualityPromptVersion: QUALITY_PROMPT_VERSION,
    qualityModelId: generationQualityModelIdentity(),
    evaluationContract: {
      prompt: candidate.prompt,
      negativePrompt: candidate.negativePrompt,
      targetContract,
      visualContract,
      keyframeNo: finiteNumber(metadata.keyframeNo),
      segmentNo: finiteNumber(metadata.segmentNo),
      microShotNo: finiteNumber(metadata.microShotNo),
      durationSeconds: finiteNumber(metadata.durationSeconds),
      startFrameUrl: firstNonEmptyString([metadata.startFrameUrl]),
      endFrameUrl: firstNonEmptyString([metadata.endFrameUrl]),
      motionCheckpoints: Array.isArray(metadata.motionCheckpoints) ? metadata.motionCheckpoints : [],
      deferredVideoQualityChecks: Array.isArray(metadata.deferredVideoQualityChecks) ? metadata.deferredVideoQualityChecks : [],
    },
  });
}

async function ensureQualityContentIdentity(
  candidate: VideoProjectRecord["generationCandidates"][number],
): Promise<VideoProjectRecord["generationCandidates"][number]> {
  if (!candidate.mediaUrl || candidate.kind === "segment_video") return candidate;
  const metadata = candidateMetadata(candidate.metadata);
  const selectedReferenceUrls = stringArrayValue(metadata.selectedReferenceUrls);
  const referenceUsageNotes = stringArrayValue(metadata.referenceUsageNotes);
  // Re-read bytes whenever an evaluation is actually requested. Normal page
  // polling never reaches this path for an evaluated candidate, while this
  // prevents a mutable/signed URL from making a stale digest authoritative.
  const mediaContentHash = await hashMediaContent(candidate.mediaUrl);
  const referenceContentIdentities = await Promise.all(selectedReferenceUrls.map(async (url, index) => ({
    url,
    contentHash: await hashMediaContent(url),
    usageNote: referenceUsageNotes[index] ?? "",
  })));
  const nextMetadata = cleanInputJson({
    ...metadata,
    mediaContentHash,
    referenceContentIdentities,
  });
  await prisma.videoGenerationCandidate.update({
    where: { id: candidate.id },
    data: { metadata: nextMetadata },
  });
  return {
    ...candidate,
    metadata: nextMetadata as Prisma.JsonValue,
  };
}

type CachedImageQualityResult =
  | {
      state: "completed";
      report: GenerationQualityReport;
      cacheKey: string;
      cacheHit: boolean;
      candidate: VideoProjectRecord["generationCandidates"][number];
    }
  | {
      state: "busy";
      retryAt: Date;
      candidate: VideoProjectRecord["generationCandidates"][number];
    };

async function evaluateGeneratedImageQualityWithCache(params: {
  project: VideoProjectRecord;
  candidate: VideoProjectRecord["generationCandidates"][number];
  evaluation: Parameters<typeof evaluateGeneratedImageQuality>[0];
}): Promise<CachedImageQualityResult> {
  const candidate = await ensureQualityContentIdentity(params.candidate);
  const metadata = candidateMetadata(candidate.metadata);
  const cacheKey = qualityEvaluationFingerprintForCandidate(candidate);
  const candidateContentHash = firstNonEmptyString([metadata.mediaContentHash]);
  const referenceContentIdentities = Array.isArray(metadata.referenceContentIdentities)
    ? metadata.referenceContentIdentities.filter(isRecord)
    : [];
  if (!cacheKey || !candidateContentHash) {
    throw new Error("Quality evaluation content identity is incomplete");
  }
  const referenceSetHash = buildQualityReferenceSetHash(referenceContentIdentities.map((item) => ({
    contentHash: firstNonEmptyString([item.contentHash]),
    usageNote: firstNonEmptyString([item.usageNote]),
  })));
  const claim = await claimQualityEvaluationCache({
    projectId: params.project.id,
    cacheKey,
    candidateContentHash,
    referenceSetHash,
    policyVersion: QUALITY_POLICY_VERSION,
    promptVersion: QUALITY_PROMPT_VERSION,
    modelId: generationQualityModelIdentity(),
    candidateId: candidate.id,
  });
  if (claim.state === "busy") {
    return { state: "busy", retryAt: claim.retryAt, candidate };
  }
  if (claim.state === "hit") {
    const cached = claim.report && isRecord(claim.report)
      ? claim.report as unknown as GenerationQualityReport
      : undefined;
    if (!cached) throw new Error("Completed quality cache entry has no report");
    await logOnePromptVideo("generation_quality.persistent_cache_hit", {
      projectId: params.project.id,
      candidateId: candidate.id,
      sourceCandidateId: claim.sourceCandidateId,
      cacheKey,
    });
    return {
      state: "completed",
      cacheKey,
      cacheHit: true,
      candidate,
      report: {
        ...cached,
        assetId: candidate.artifactId,
        candidateId: candidate.id,
        candidateNo: candidate.candidateNo,
        mediaUrl: candidate.mediaUrl ?? undefined,
      },
    };
  }

  try {
    const report = await evaluateGeneratedImageQuality(params.evaluation);
    const technicalFailure = isTechnicalQualityEvaluationFailure(report);
    if (technicalFailure) {
      await failQualityEvaluationCache({
        projectId: params.project.id,
        cacheKey,
        leaseToken: claim.leaseToken,
        report: cleanInputJson(report as unknown as Record<string, unknown>),
        errorMessage: report.artifactIssues.join("；") || "Quality evaluator failed",
      });
    } else {
      await completeQualityEvaluationCache({
        projectId: params.project.id,
        cacheKey,
        leaseToken: claim.leaseToken,
        report: cleanInputJson(report as unknown as Record<string, unknown>),
        candidateId: candidate.id,
      });
    }
    return { state: "completed", report, cacheKey, cacheHit: false, candidate };
  } catch (error) {
    await failQualityEvaluationCache({
      projectId: params.project.id,
      cacheKey,
      leaseToken: claim.leaseToken,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function reusableQualityEvaluation(
  candidate: VideoProjectRecord["generationCandidates"][number],
  candidates: VideoProjectRecord["generationCandidates"],
): { report: GenerationQualityReport; sourceCandidateId: string; fingerprint: string } | undefined {
  const fingerprint = qualityEvaluationFingerprintForCandidate(candidate);
  if (!fingerprint) return undefined;
  for (const source of candidates) {
    if (
      source.id === candidate.id
      || !source.qualityReport
      || !isRecord(source.qualityReport)
      || isTechnicalQualityEvaluationFailure(source.qualityReport as unknown as GenerationQualityReport)
      || qualityEvaluationFingerprintForCandidate(source) !== fingerprint
    ) continue;
    const sourceReport = source.qualityReport as unknown as GenerationQualityReport;
    return {
      fingerprint,
      sourceCandidateId: source.id,
      report: {
        ...sourceReport,
        assetId: candidate.artifactId,
        candidateId: candidate.id,
        candidateNo: candidate.candidateNo,
        mediaUrl: candidate.mediaUrl ?? undefined,
      },
    };
  }
  return undefined;
}

async function patchTransitionReferenceArtifact(projectId: string, artifactId: string, patch: Partial<TransitionReferenceArtifact>): Promise<void> {
  const authority = await readArtifactPlan(projectId);
  if (!authority) throw new Error("Project plan is missing");
  const plan = cloneJsonRecord(authority);
  const artifacts = transitionReferenceArtifactsFromPlan(authority);
  const index = artifacts.findIndex((item) => item.id === artifactId);
  if (index < 0) throw new Error("Transition reference artifact not found");
  artifacts[index] = { ...artifacts[index], ...patch, updatedAt: new Date().toISOString() };
  plan.transitionReferenceArtifacts = artifacts as unknown as Prisma.InputJsonValue;
  delete plan.transition_reference_artifacts;
  await commitArtifactPlan(projectId, cleanInputJson(plan));
}

async function invalidateTransitionReferencesForParent(projectId: string, keyframeNo: number, reason: string): Promise<void> {
  const authority = await readArtifactPlan(projectId, { allowMissing: true });
  if (!authority) return;
  const artifacts = transitionReferenceArtifactsFromPlan(authority);
  let changed = false;
  const next = artifacts.map((item) => {
    if (item.parentKeyframeNo !== keyframeNo) return item;
    changed = true;
    return { ...item, status: "waiting_parent" as const, locked: false, errorMessage: reason, updatedAt: new Date().toISOString() };
  });
  if (!changed) return;
  const plan = cloneJsonRecord(authority);
  plan.transitionReferenceArtifacts = next as unknown as Prisma.InputJsonValue;
  await commitArtifactPlan(projectId, cleanInputJson(plan));
}

async function reconcileTransitionReferencesForAcceptedParent(
  projectId: string,
  keyframeNo: number,
  imageUrl: string,
): Promise<void> {
  const authority = await readArtifactPlan(projectId, { allowMissing: true });
  if (!authority) return;
  const artifacts = transitionReferenceArtifactsFromPlan(authority);
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
  const plan = cloneJsonRecord(authority);
  plan.transitionReferenceArtifacts = next as unknown as Prisma.InputJsonValue;
  delete plan.transition_reference_artifacts;
  const shortIds = affected.filter((item) => item.mode === "short").map((item) => item.id);
  const fullIds = affected.filter((item) => item.mode === "full").map((item) => item.id);
  if (shortIds.length) setPlanArtifactStatus(plan, shortIds, "approved", { retryFromStage: "generation", userAccepted: true });
  if (fullIds.length) setPlanArtifactStatus(plan, fullIds, "dirty", { dirtyReason: "Accepted parent-camera image changed; full transition reference must be regenerated.", retryFromStage: "generation" });
  await commitArtifactPlan(projectId, cleanInputJson(plan));
}

async function repairAcceptedShortTransitionReferences(project: VideoProjectRecord): Promise<VideoProjectRecord> {
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
  const authority = await readArtifactPlan(projectId, { allowMissing: true });
  if (!authority) return;
  const artifacts = generatedBridgeArtifactsFromPlan(authority);
  let changed = false;
  const next = artifacts.map((item) => {
    if (item.fromSegmentNo !== segmentNo && item.toSegmentNo !== segmentNo) return item;
    changed = true;
    return { ...item, status: "planned" as const, locked: false, errorMessage: reason, updatedAt: new Date().toISOString() };
  });
  if (!changed) return;
  const plan = cloneJsonRecord(authority);
  plan.generatedBridgeArtifacts = next as unknown as Prisma.InputJsonValue;
  await commitArtifactPlan(projectId, cleanInputJson(plan));
}

async function patchGeneratedBridgeArtifact(projectId: string, artifactId: string, patch: Partial<GeneratedBridgeArtifact>): Promise<void> {
  const authority = await readArtifactPlan(projectId);
  if (!authority) throw new Error("Project plan is missing");
  const plan = cloneJsonRecord(authority);
  const artifacts = generatedBridgeArtifactsFromPlan(authority);
  const index = artifacts.findIndex((item) => item.id === artifactId);
  if (index < 0) throw new Error("Generated bridge artifact not found");
  artifacts[index] = { ...artifacts[index], ...patch, updatedAt: new Date().toISOString() };
  plan.generatedBridgeArtifacts = artifacts as unknown as Prisma.InputJsonValue;
  delete plan.generated_bridge_artifacts;
  await commitArtifactPlan(projectId, cleanInputJson(plan));
}

export async function generateTransitionReference(userId: string, projectId: string, artifactId: string): Promise<VideoProjectRecord> {
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
  const taskId = await submitAliyunImageToVideoTask({
    imageUrl: parentKeyframe.imageUrl,
    lastFrameUrl: parentKeyframe.imageUrl,
    prompt,
    durationSeconds: 3,
    schedulingContext: { userId, projectId, targetId: artifact.id },
  });
  await patchTransitionReferenceArtifact(projectId, artifact.id, { status: "video_running", parentKeyframeUrl: parentKeyframe.imageUrl, videoTaskId: taskId, videoUrl: undefined, frameCandidates: undefined, errorMessage: undefined, locked: false });
  await updateProjectArtifactStatus(projectId, [artifact.id], "generating", { retryFromStage: "generation" });
  return requireVideoProject(userId, projectId);
}

export async function approveTransitionReference(userId: string, projectId: string, artifactId: string, frameId?: string): Promise<VideoProjectRecord> {
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

async function syncTransitionReferenceArtifacts(project: VideoProjectRecord): Promise<void> {
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
        const report = await evaluateGeneratedImageQuality({ assetId: artifact.id, candidateId: id, candidateNo: index + 1, mediaUrl: url, targetContract: { targetCameraId: artifact.toCameraId, relation: artifact.relation, inheritanceScope: artifact.inheritanceScope, reasonZh: artifact.reasonZh }, selectedReferenceUrls: artifact.parentKeyframeUrl ? [artifact.parentKeyframeUrl] : [], referenceUsageNotes: ["Parent camera is scene-layout evidence only; ignore identity, products, logos and text."], prompt: artifact.reasonZh, purpose: "transition_reference_frame", schedulingContext: { userId: project.userId, projectId: project.id } });
        await saveGenerationQualityReport(project.id, report);
        evaluated.push({ id, url, timestampFraction: frame.fraction, compositeScore: generationQualityCompositeScore(report), passed: report.passed, qualityReport: report });
      }
      const best = evaluated.filter((item) => item.passed).sort((a, b) => (b.compositeScore ?? -1) - (a.compositeScore ?? -1))[0];
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

export async function generateGeneratedBridge(userId: string, projectId: string, artifactId: string): Promise<VideoProjectRecord> {
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
      const taskId = await submitAliyunImageToVideoTask({
        imageUrl: startFrame.imageUrl,
        lastFrameUrl: endFrame.imageUrl,
        prompt,
        durationSeconds: Math.max(3, artifact.durationSeconds),
        schedulingContext: { userId, projectId, targetId: artifact.id },
      });
      await prisma.videoGenerationCandidate.create({ data: { projectId, artifactId: artifact.id, targetId: artifact.id, kind: "generated_bridge", batchId, candidateNo, taskId, status: "running", prompt, negativePrompt: "cut, dissolve, montage, duplicate person, duplicate product, identity drift, wrong logo, random text, teleportation, melting, scene replacement", metadata: cleanInputJson({ attempt, durationSeconds: Math.max(3, artifact.durationSeconds), startFrameUrl: startFrame.imageUrl, endFrameUrl: endFrame.imageUrl, fromSegmentNo: artifact.fromSegmentNo, toSegmentNo: artifact.toSegmentNo, targetContract: { artifactType: "generated_bridge", entersFinalComposition: true } }) } });
      submitted += 1;
    } catch (error) {
      if (isVideoProviderCapacityError(error)) throw error;
      await prisma.videoGenerationCandidate.create({ data: { projectId, artifactId: artifact.id, targetId: artifact.id, kind: "generated_bridge", batchId, candidateNo, status: "failed", prompt, errorMessage: error instanceof Error ? error.message : String(error), metadata: cleanInputJson({ attempt, fromSegmentNo: artifact.fromSegmentNo, toSegmentNo: artifact.toSegmentNo }) } });
    }
  }
  if (!submitted) throw new Error("All generated bridge candidate submissions failed");
  await patchGeneratedBridgeArtifact(projectId, artifact.id, { status: "running", prompt, locked: false, errorMessage: undefined });
  await updateProjectArtifactStatus(projectId, [artifact.id], "generating", { retryFromStage: "generation" });
  return requireVideoProject(userId, projectId);
}

async function syncGeneratedBridgeCandidates(project: VideoProjectRecord): Promise<void> {
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
      const report = await evaluateGeneratedVideoQuality({ assetId: artifactId, candidateId: candidate.id, candidateNo: candidate.candidateNo, mediaUrl: candidate.mediaUrl as string, targetContract: isRecord(metadata.targetContract) ? metadata.targetContract : { artifactType: "generated_bridge" }, selectedReferenceUrls: [String(metadata.startFrameUrl || ""), String(metadata.endFrameUrl || "")].filter(Boolean), referenceUsageNotes: ["Approved source ending boundary", "Approved destination starting boundary"], prompt: candidate.prompt, purpose: "generated_bridge", durationSeconds: Number(metadata.durationSeconds) || 3, motionCheckpoints: [], startFrameUrl: String(metadata.startFrameUrl || ""), endFrameUrl: String(metadata.endFrameUrl || ""), schedulingContext: { userId: project.userId, projectId: project.id } });
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

export async function approveGeneratedBridge(userId: string, projectId: string, artifactId: string, candidateId?: string): Promise<VideoProjectRecord> {
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

type ImageQualityCandidate = VideoProjectRecord["generationCandidates"][number];

function isImageQualityWorkItem(candidate: ImageQualityCandidate): boolean {
  if (!candidate.mediaUrl || candidate.kind === "segment_video") return false;
  if (candidate.status === "succeeded" && !candidate.qualityReport) return true;
  if (candidate.status !== "quality_retry") return false;
  const metadata = candidateMetadata(candidate.metadata);
  const nextRetryAt = Date.parse(String(metadata.qualityNextRetryAt || ""));
  return !Number.isFinite(nextRetryAt) || nextRetryAt <= Date.now();
}

async function claimImageQualityCandidate(candidate: ImageQualityCandidate): Promise<boolean> {
  const claim = candidate.status === "quality_retry"
    ? await prisma.videoGenerationCandidate.updateMany({
        where: { id: candidate.id, status: "quality_retry" },
        data: { status: "evaluating", errorMessage: null },
      })
    : candidate.status === "review_ready"
      ? await prisma.videoGenerationCandidate.updateMany({
          where: {
            id: candidate.id,
            status: "review_ready",
            qualityReport: { equals: Prisma.DbNull },
          },
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
  return claim.count === 1;
}

async function reuseImageQualityEvaluation(
  project: VideoProjectRecord,
  candidate: ImageQualityCandidate,
  artifactCandidates: ImageQualityCandidate[],
): Promise<boolean> {
  const reusableEvaluation = reusableQualityEvaluation(candidate, artifactCandidates);
  if (!reusableEvaluation) return false;
  const metadata = candidateMetadata(candidate.metadata);
  const cachedReport = reusableEvaluation.report;
  const previousCandidate = artifactCandidates
    .filter((item) =>
      item.id !== candidate.id
      && item.candidateNo < candidate.candidateNo
      && item.qualityReport
      && isRecord(item.qualityReport)
    )
    .sort((a, b) => b.candidateNo - a.candidateNo)[0];
  const convergence = imageRepairConvergenceDecision({
    candidate,
    report: cachedReport,
    previousCandidate,
  });
  await prisma.videoGenerationCandidate.update({
    where: { id: candidate.id },
    data: {
      status: "evaluated",
      qualityReport: cleanInputJson(cachedReport as unknown as Record<string, unknown>),
      compositeScore: generationQualityCompositeScore(cachedReport),
      passed: cachedReport.passed,
      retryInstruction: cachedReport.retryInstruction ?? null,
      metadata: cleanInputJson({
        ...metadata,
        qualityEvaluationFingerprint: reusableEvaluation.fingerprint,
        qualityEvaluationFingerprintVersion: QUALITY_EVALUATION_FINGERPRINT_VERSION,
        qualityReportReusedFromCandidateId: reusableEvaluation.sourceCandidateId,
        ...convergenceMetadata(convergence),
      }),
    },
  });
  await logOnePromptVideo("generation_quality.report_reused", {
    projectId: project.id,
    artifactId: candidate.artifactId,
    candidateId: candidate.id,
    sourceCandidateId: reusableEvaluation.sourceCandidateId,
    qualityEvaluationFingerprint: reusableEvaluation.fingerprint,
  });
  return true;
}

async function evaluateClaimedImageCandidate(
  project: VideoProjectRecord,
  candidate: ImageQualityCandidate,
  artifactCandidates: ImageQualityCandidate[],
): Promise<void> {
  const metadata = candidateMetadata(candidate.metadata);
  const targetContract = isRecord(metadata.targetContract) ? metadata.targetContract : {};
  const visualContract = isRecord(metadata.visualContract)
    ? metadata.visualContract as unknown as AuthoritativeVisualContract
    : undefined;
  const previousCandidate = artifactCandidates
    .filter((item) =>
      item.id !== candidate.id
      && item.candidateNo < candidate.candidateNo
      && item.qualityReport
      && isRecord(item.qualityReport)
    )
    .sort((a, b) => b.candidateNo - a.candidateNo)[0];
  const previousQualityReport = previousCandidate?.qualityReport && isRecord(previousCandidate.qualityReport)
    ? previousCandidate.qualityReport as unknown as GenerationQualityReport
    : undefined;
  const assetCategory = readPlanShotString(targetContract, ["assetCategory", "asset_category", "kind"]);
  const brandVisualAsset =
    candidate.kind === "keyframe_image"
    && Number(metadata.keyframeNo) < 0
    && assetCategory === "brand_visual";
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
    authoritativeContractConflicts: uniqueStrings([
      ...(visualContract?.verifiedConflicts ?? []),
      ...visualContractDesignConflicts(project.planJson),
    ]),
    previousQualityReport,
    previousCandidateUrl: previousCandidate?.mediaUrl ?? undefined,
  };
  try {
    const evaluationLogContext = generationCandidateLogContext({
      projectId: project.id,
      artifactId: candidate.artifactId,
      kind: candidate.kind,
      candidateNo: candidate.candidateNo,
      metadata,
    });
    const cachedEvaluation = await withOnePromptVideoLogContext(evaluationLogContext, () =>
      evaluateGeneratedImageQualityWithCache({
        project,
        candidate,
        evaluation: {
        ...common,
        purpose: candidate.kind === "micro_shot_image"
          ? "motion_checkpoint_image"
          : Number(metadata.keyframeNo) < 0
            ? "anchor_reference_image"
            : "boundary_keyframe",
        assetCategory: assetCategory || undefined,
        requiresExactBrandText: brandVisualAsset,
        },
      }));
    if (cachedEvaluation.state === "busy") {
      await prisma.videoGenerationCandidate.updateMany({
        where: { id: candidate.id, status: "evaluating" },
        data: {
          status: "quality_retry",
          metadata: cleanInputJson({
            ...candidateMetadata(cachedEvaluation.candidate.metadata),
            qualityNextRetryAt: cachedEvaluation.retryAt.toISOString(),
          }),
        },
      });
      return;
    }
    const evaluatedCandidate = cachedEvaluation.candidate;
    const evaluatedMetadata = candidateMetadata(evaluatedCandidate.metadata);
    const report = cachedEvaluation.report;
    const technicalFailure = isTechnicalQualityEvaluationFailure(report);
    const compositeScore = technicalFailure ? null : generationQualityCompositeScore(report);
    const convergence = technicalFailure
      ? undefined
      : imageRepairConvergenceDecision({
          candidate: evaluatedCandidate,
          report,
          previousCandidate,
        });
    const technicalAttempts = Math.max(0, Number(evaluatedMetadata.qualityTechnicalAttempts) || 0) + 1;
    const technicalRetryExhausted = technicalAttempts >= qualityTechnicalRetryCycles();
    const technicalMetadata = cleanInputJson({
      ...evaluatedMetadata,
      qualityTechnicalAttempts: technicalAttempts,
      qualityNextRetryAt: new Date(Date.now() + qualityTechnicalRetryDelayMs(technicalAttempts)).toISOString(),
      qualityEvaluationFingerprint: qualityEvaluationFingerprintForCandidate(evaluatedCandidate),
      qualityEvaluationFingerprintVersion: QUALITY_EVALUATION_FINGERPRINT_VERSION,
    }) as Prisma.InputJsonValue;
    const completedMetadata = cleanInputJson({
      ...evaluatedMetadata,
      qualityEvaluationFingerprint: qualityEvaluationFingerprintForCandidate(evaluatedCandidate),
      qualityEvaluationFingerprintVersion: QUALITY_EVALUATION_FINGERPRINT_VERSION,
      ...(convergence ? convergenceMetadata(convergence) : {}),
    }) as Prisma.InputJsonValue;
    const persistedEvaluation = await prisma.videoGenerationCandidate.updateMany({
      where: candidate.status === "quality_retry"
        ? { id: candidate.id, status: "evaluating" }
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
            metadata: completedMetadata,
          },
    });
    if (persistedEvaluation.count !== 1) {
      await logOnePromptVideo("generation_quality.duplicate_result_discarded", {
        projectId: project.id,
        artifactId: candidate.artifactId,
        candidateId: candidate.id,
      }, "warn");
      return;
    }
    if (!technicalFailure) {
      await saveGenerationQualityReport(project.id, report);
    } else {
      const issue = report.artifactIssues.join("；") || "画面质检服务暂不可用";
      await updateGenerationTargetForTechnicalQualityRetry(
        project,
        candidate,
        technicalRetryExhausted,
        issue,
      );
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
    const technicalAttempts = Math.max(0, Number(metadata.qualityTechnicalAttempts) || 0) + 1;
    const technicalRetryExhausted = technicalAttempts >= qualityTechnicalRetryCycles();
    const errorMessage = error instanceof Error ? error.message : String(error);
    await prisma.videoGenerationCandidate.updateMany({
      where: { id: candidate.id, status: "evaluating" },
      data: {
        status: technicalRetryExhausted ? "quality_failed" : "quality_retry",
        errorMessage,
        metadata: cleanInputJson({
          ...metadata,
          qualityTechnicalAttempts: technicalAttempts,
          qualityNextRetryAt: new Date(
            Date.now() + qualityTechnicalRetryDelayMs(technicalAttempts),
          ).toISOString(),
        }),
      },
    });
    if (technicalRetryExhausted) {
      await updateGenerationTargetForTechnicalQualityRetry(project, candidate, true, errorMessage);
      await updateProjectArtifactStatus(project.id, [candidate.artifactId], "failed", {
        dirtyReason: errorMessage,
        retryFromStage: "manual",
      });
    }
    await logOnePromptVideo("generation_quality.evaluation_retry", {
      projectId: project.id,
      artifactId: candidate.artifactId,
      candidateId: candidate.id,
      technicalAttempts,
      technicalRetryExhausted,
      nextRetryDelayMs: qualityTechnicalRetryDelayMs(technicalAttempts),
      error: errorForLog(error),
    }, "warn");
  }
}

async function runBoundedImageQualityEvaluations(
  project: VideoProjectRecord,
  candidates: ImageQualityCandidate[],
): Promise<void> {
  const modelWorkLimit = qualityEvaluationsPerSync();
  const claimed: Array<{
    candidate: ImageQualityCandidate;
    artifactCandidates: ImageQualityCandidate[];
  }> = [];
  const artifactIds = [...new Set(candidates.map((candidate) => candidate.artifactId))];
  for (const artifactId of artifactIds) {
    const artifactCandidates = candidates.filter((candidate) => candidate.artifactId === artifactId);
    for (const candidate of artifactCandidates.filter(isImageQualityWorkItem)) {
      const reusableEvaluation = reusableQualityEvaluation(candidate, artifactCandidates);
      if (reusableEvaluation) {
        if (!await claimImageQualityCandidate(candidate)) continue;
        await reuseImageQualityEvaluation(project, candidate, artifactCandidates);
        continue;
      }
      if (claimed.length >= modelWorkLimit) break;
      if (!await claimImageQualityCandidate(candidate)) continue;
      claimed.push({ candidate, artifactCandidates });
      // Candidate N+1 for one artifact depends on candidate N's issue ledger.
      // Only distinct artifacts may enter the parallel vision pool.
      break;
    }
  }
  if (!claimed.length) return;

  const concurrency = Math.min(qualityEvaluationConcurrency(), claimed.length);
  let cursor = 0;
  await logOnePromptVideo("generation_quality.parallel_batch.start", {
    projectId: project.id,
    candidateCount: claimed.length,
    concurrency,
    artifactIds: claimed.map((item) => item.candidate.artifactId),
  });
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < claimed.length) {
      const index = cursor;
      cursor += 1;
      const item = claimed[index];
      if (!item) continue;
      await evaluateClaimedImageCandidateWithTimedRetries(
        project,
        item.candidate,
        item.artifactCandidates,
      );
    }
  }));
  await logOnePromptVideo("generation_quality.parallel_batch.completed", {
    projectId: project.id,
    candidateCount: claimed.length,
    concurrency,
  });
}

async function evaluateClaimedImageCandidateWithTimedRetries(
  project: VideoProjectRecord,
  initialCandidate: ImageQualityCandidate,
  initialArtifactCandidates: ImageQualityCandidate[],
): Promise<void> {
  let candidate = initialCandidate;
  let artifactCandidates = initialArtifactCandidates;
  for (let cycle = 0; cycle <= qualityTechnicalRetryCycles(); cycle += 1) {
    await evaluateClaimedImageCandidate(project, candidate, artifactCandidates);
    const refreshed = await prisma.videoGenerationCandidate.findUnique({
      where: { id: candidate.id },
    });
    if (!refreshed || refreshed.status !== "quality_retry") return;
    const retryAt = Date.parse(
      String(candidateMetadata(refreshed.metadata).qualityNextRetryAt || ""),
    );
    const delayMs = Number.isFinite(retryAt)
      ? Math.max(0, retryAt - Date.now())
      : qualityTechnicalRetryDelayMs(cycle + 1);
    await logOnePromptVideo("generation_quality.asset_retry_wait", {
      projectId: project.id,
      artifactId: refreshed.artifactId,
      candidateId: refreshed.id,
      delayMs,
      cycle: cycle + 1,
    });
    if (delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
    if (!await claimImageQualityCandidate(refreshed)) return;
    artifactCandidates = await prisma.videoGenerationCandidate.findMany({
      where: { projectId: project.id, artifactId: refreshed.artifactId },
      orderBy: [{ createdAt: "desc" }, { candidateNo: "asc" }],
    });
    const current = artifactCandidates.find((item) => item.id === refreshed.id);
    if (!current) return;
    // Keep the pre-claim status on this snapshot. Persistence uses it to choose
    // the quality-retry compare-and-swap branch after the model returns.
    candidate = { ...current, status: "quality_retry" };
  }
}

function upstreamTimestampMs(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric > 1_000_000_000_000) return Math.round(numeric);
    if (numeric > 1_000_000_000) return Math.round(numeric * 1000);
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dashScopeTimingBreakdown(
  result: DashScopeTaskResult,
  completedSeenAtMs: number,
): {
  providerQueueDurationMs?: number;
  providerRenderDurationMs?: number;
  pollDiscoveryDelayMs?: number;
} {
  const submittedAtMs = upstreamTimestampMs(result.upstreamSubmittedAt);
  const scheduledAtMs = upstreamTimestampMs(result.upstreamScheduledAt);
  const endedAtMs = upstreamTimestampMs(result.upstreamEndedAt);
  return {
    providerQueueDurationMs: submittedAtMs !== undefined && scheduledAtMs !== undefined
      ? Math.max(0, scheduledAtMs - submittedAtMs)
      : undefined,
    providerRenderDurationMs: scheduledAtMs !== undefined && endedAtMs !== undefined
      ? Math.max(0, endedAtMs - scheduledAtMs)
      : undefined,
    pollDiscoveryDelayMs: endedAtMs !== undefined
      ? Math.max(0, completedSeenAtMs - endedAtMs)
      : undefined,
  };
}

async function pollGenerationCandidateUpstream(params: {
  candidate: VideoProjectRecord["generationCandidates"][number];
  logContext: Record<string, unknown>;
  nextPollDelayMs: number;
}): Promise<DashScopeTaskResult> {
  if (!params.candidate.taskId) throw new Error("Cannot poll a generation candidate without an upstream task ID");
  const pollStartedAt = new Date();
  const claimed = await prisma.videoGenerationCandidate.update({
    where: { id: params.candidate.id },
    data: {
      upstreamSubmittedAt: params.candidate.upstreamSubmittedAt ?? params.candidate.createdAt,
      upstreamPollCount: { increment: 1 },
      upstreamLastPolledAt: pollStartedAt,
    },
    select: {
      upstreamSubmittedAt: true,
      upstreamPollCount: true,
      upstreamPollTotalMs: true,
      createdAt: true,
    },
  });
  const submittedAt = claimed.upstreamSubmittedAt ?? claimed.createdAt;
  const pollNo = claimed.upstreamPollCount;
  const queryStartedAtMs = Date.now();
  try {
    const result = await withOnePromptVideoLogContext(params.logContext, () =>
      queryDashScopeTask(params.candidate.taskId as string));
    const observedAtMs = Date.now();
    const queryDurationMs = observedAtMs - queryStartedAtMs;
    const terminal = result.status === "succeeded" || result.status === "failed";
    const updated = await prisma.videoGenerationCandidate.update({
      where: { id: params.candidate.id },
      data: {
        upstreamPollTotalMs: { increment: queryDurationMs },
        ...(terminal ? { upstreamCompletedSeenAt: new Date(observedAtMs) } : {}),
      },
      select: { upstreamPollTotalMs: true },
    });
    const elapsedSinceSubmissionMs = Math.max(0, observedAtMs - submittedAt.getTime());
    const timing = dashScopeTimingBreakdown(result, observedAtMs);
    const providerTimingAvailable = timing.providerQueueDurationMs !== undefined
      || timing.providerRenderDurationMs !== undefined;
    await logOnePromptVideo("production.step.completed", {
      ...params.logContext,
      stepNameZh: "向上游查询生成进度",
      executionMethod: "program",
      durationMs: queryDurationMs,
      upstreamPollNo: pollNo,
      upstreamStatus: result.upstreamStatus ?? result.status,
      elapsedSinceSubmissionMs,
      upstreamPollTotalMs: updated.upstreamPollTotalMs,
      nonQueryElapsedMs: Math.max(0, elapsedSinceSubmissionMs - updated.upstreamPollTotalMs),
      ...timing,
      nextPollDelayMs: terminal ? undefined : params.nextPollDelayMs,
      providerReportedSubmittedAt: result.upstreamSubmittedAt,
      providerReportedScheduledAt: result.upstreamScheduledAt,
      providerReportedEndedAt: result.upstreamEndedAt,
      resultZh: terminal
        ? providerTimingAvailable
          ? "上游任务已结束；供应商时间戳足够时，已拆分排队、实际生成和完成后发现延迟"
          : "上游任务已结束；供应商未返回完整时间戳，排队和实际生成仍无法可靠拆分"
        : "上游任务仍在排队或生成；已记录本次查询耗时和下一次计划查询时间",
      errorMessage: result.errorMessage,
    }, result.status === "failed" ? "error" : "info");
    return result;
  } catch (error) {
    const observedAtMs = Date.now();
    const queryDurationMs = observedAtMs - queryStartedAtMs;
    const updated = await prisma.videoGenerationCandidate.update({
      where: { id: params.candidate.id },
      data: { upstreamPollTotalMs: { increment: queryDurationMs } },
      select: { upstreamPollTotalMs: true },
    });
    const elapsedSinceSubmissionMs = Math.max(0, observedAtMs - submittedAt.getTime());
    await logOnePromptVideo("production.step.failed", {
      ...params.logContext,
      stepNameZh: "向上游查询生成进度",
      executionMethod: "program",
      durationMs: queryDurationMs,
      upstreamPollNo: pollNo,
      upstreamStatus: "QUERY_ERROR",
      elapsedSinceSubmissionMs,
      upstreamPollTotalMs: updated.upstreamPollTotalMs,
      nonQueryElapsedMs: Math.max(0, elapsedSinceSubmissionMs - updated.upstreamPollTotalMs),
      nextPollDelayMs: params.nextPollDelayMs,
      resultZh: "本次查询失败；已保留轮询序号和耗时，等待后台任务按错误策略重试",
      ...errorForLog(error),
    }, "error");
    throw error;
  }
}

async function syncGenerationCandidates(
  project: VideoProjectRecord,
  options: {
    pollUpstream?: boolean;
    runQualityEvaluations?: boolean;
    queueQualityWorker?: boolean;
  } = {},
): Promise<void> {
  const pollUpstream = options.pollUpstream !== false;
  const runQualityEvaluations = options.runQualityEvaluations === true;
  const queueQualityWorker = options.queueQualityWorker !== false;
  const coreKinds = new Set(["keyframe_image", "micro_shot_image", "segment_video"]);
  // Recover candidates created by the former automatic video-vision pipeline.
  // A persisted segment video is governed by its deterministic inspection;
  // stale advisory states must not keep the project waiting forever.
  await prisma.videoGenerationCandidate.updateMany({
    where: {
      projectId: project.id,
      kind: "segment_video",
      mediaUrl: { not: null },
      status: { in: ["succeeded", "evaluating", "evaluated", "quality_retry", "quality_failed"] },
    },
    data: {
      status: "review_ready",
      passed: null,
      errorMessage: null,
    },
  });
  await prisma.videoGenerationCandidate.updateMany({
    where: {
      projectId: project.id,
      status: "evaluating",
      updatedAt: { lt: new Date(Date.now() - QUALITY_EVALUATION_LEASE_MS) },
    },
    data: { status: "succeeded", errorMessage: "Quality evaluation lease expired; retrying evaluation." },
  });
  const running = pollUpstream
    ? project.generationCandidates.filter((candidate) => coreKinds.has(candidate.kind) && candidate.status === "running" && candidate.taskId)
    : [];
  for (const candidate of running) {
    const runningMetadata = candidateMetadata(candidate.metadata);
    const candidateLogContext = generationCandidateLogContext({
      projectId: project.id,
      artifactId: candidate.artifactId,
      kind: candidate.kind,
      candidateNo: candidate.candidateNo,
      metadata: runningMetadata,
    });
    const result = await pollGenerationCandidateUpstream({
      candidate,
      logContext: candidateLogContext,
      nextPollDelayMs: 3_000,
    });
    if (result.status === "succeeded" && result.resultUrl) {
      const metadata = runningMetadata;
      const resultUrl = result.resultUrl;
      const completedCandidate = await prisma.videoGenerationCandidate.findUnique({
        where: { id: candidate.id },
        select: {
          upstreamSubmittedAt: true,
          upstreamPollCount: true,
          upstreamPollTotalMs: true,
          upstreamCompletedSeenAt: true,
        },
      });
      const submittedAtMs = (completedCandidate?.upstreamSubmittedAt ?? candidate.createdAt).getTime();
      const completedSeenAtMs = (completedCandidate?.upstreamCompletedSeenAt ?? new Date()).getTime();
      const elapsedSinceSubmissionMs = Math.max(0, completedSeenAtMs - submittedAtMs);
      const timing = dashScopeTimingBreakdown(result, completedSeenAtMs);
      await logOnePromptVideo("production.step.completed", {
        ...candidateLogContext,
        stepNameZh: candidate.kind === "segment_video"
          ? "视频生成模型完成候选视频"
          : "图片生成模型完成候选图",
        executionMethod: candidate.kind === "segment_video" ? "video_model" : "image_model",
        durationMs: elapsedSinceSubmissionMs,
        upstreamPollNo: completedCandidate?.upstreamPollCount,
        upstreamPollTotalMs: completedCandidate?.upstreamPollTotalMs,
        elapsedSinceSubmissionMs,
        nonQueryElapsedMs: Math.max(0, elapsedSinceSubmissionMs - (completedCandidate?.upstreamPollTotalMs ?? 0)),
        upstreamStatus: result.upstreamStatus ?? result.status,
        ...timing,
        resultZh: timing.providerQueueDurationMs !== undefined && timing.providerRenderDurationMs !== undefined
          ? "候选结果已发现；总耗时已拆分为供应商排队、实际生成、查询接口和完成后发现延迟"
          : "候选结果已发现；已精确记录轮询次数和查询耗时，但供应商未返回完整排队/渲染时间戳",
      });
      const repairOriginQualityCompletedAt = Date.parse(String(metadata.repairOriginQualityCompletedAt || ""));
      if (candidate.kind !== "segment_video" && Number.isFinite(repairOriginQualityCompletedAt)) {
        await logOnePromptVideo("production.step.completed", {
          ...candidateLogContext,
          stepNameZh: "上一轮质检打回到本轮返修候选图生成完成",
          executionMethod: "program",
          durationMs: Math.max(0, Date.now() - repairOriginQualityCompletedAt),
          repairMode: firstNonEmptyString([metadata.repairMode]),
          resultZh: "返修候选图已经生成，接下来重新质检",
        });
      }
      const persistStartedAtMs = Date.now();
      const mediaUrl = candidate.kind === "segment_video"
        ? await withOnePromptVideoLogContext(candidateLogContext, () => persistRemoteMediaToOss({
            url: resultUrl,
            key: `one-prompt-video/candidates/${project.id}/${candidate.artifactId.replace(/[^a-z0-9_-]+/gi, "-")}-${candidate.batchId}-${candidate.candidateNo}.mp4`,
            fallbackContentType: "video/mp4",
          }))
        : await withOnePromptVideoLogContext(candidateLogContext, () => persistGeneratedImageUrl({
            projectId: project.id,
            sourceUrl: resultUrl,
            kind: candidate.kind === "keyframe_image" ? "keyframe" : "micro-shot",
            keyframeNo: Number(metadata.keyframeNo),
            segmentNo: Number(metadata.segmentNo),
            microShotNo: Number(metadata.microShotNo),
          }));
      await logOnePromptVideo("production.step.completed", {
        ...candidateLogContext,
        stepNameZh: candidate.kind === "segment_video"
          ? "保存候选视频到项目存储"
          : "保存候选图到项目存储",
        executionMethod: "program",
        durationMs: Date.now() - persistStartedAtMs,
        resultZh: "已保存，可进入质检",
      });
      if (candidate.kind === "segment_video") {
        const technical = await withOnePromptVideoLogContext(candidateLogContext, () =>
          inspectGeneratedVideoTechnicalQuality(mediaUrl));
        const audioStrategy = resolveVideoAudioStrategy(readPlanAudioPlan({ audioPlan: metadata.audioPlan }));
        const nativeAudioExpected = audioStrategy !== "post_only";
        await logOnePromptVideo("generation_quality.video_audio_technical", {
          ...candidateLogContext,
          audioStrategy,
          nativeAudioExpected,
          audioStreamPresent: technical.audioStreamPresent,
          audioCodec: technical.audioCodec ?? null,
          audioSampleRate: technical.audioSampleRate ?? null,
          resultZh: nativeAudioExpected
            ? (technical.audioStreamPresent ? "模型返回了可保留的原生音轨" : "模型未返回预期的原生音轨")
            : (technical.audioStreamPresent ? "模型返回了音轨，但该片段按后期音频策略处理" : "后期音频片段未携带模型音轨"),
        }, nativeAudioExpected && !technical.audioStreamPresent ? "warn" : "info");
        await prisma.videoGenerationCandidate.update({
          where: { id: candidate.id },
          data: technical.valid
            ? {
                mediaUrl,
                status: "review_ready",
                errorMessage: null,
                metadata: cleanInputJson({
                  ...metadata,
                  technicalInspection: technical,
                  nativeAudioExpected,
                }),
              }
            : {
                mediaUrl,
                status: "failed",
                errorMessage: `视频文件技术检查失败：${technical.errorMessage || "无法解码视频"}`,
                metadata: cleanInputJson({ ...metadata, technicalInspection: technical, nativeAudioExpected }),
              },
        });
      } else {
        await prisma.videoGenerationCandidate.update({ where: { id: candidate.id }, data: { mediaUrl, status: "succeeded", errorMessage: null } });
      }
    } else if (result.status === "failed") {
      await logOnePromptVideo("production.step.completed", {
        ...candidateLogContext,
        stepNameZh: candidate.kind === "segment_video"
          ? "视频生成模型生成候选视频"
          : "图片生成模型生成候选图",
        executionMethod: candidate.kind === "segment_video" ? "video_model" : "image_model",
        durationMs: Math.max(0, Date.now() - candidate.createdAt.getTime()),
        resultZh: "上游生成失败",
        errorMessage: result.errorMessage || "上游生成失败",
      }, "error");
      await prisma.videoGenerationCandidate.update({ where: { id: candidate.id }, data: { status: "failed", errorMessage: result.errorMessage || "Upstream generation failed" } });
    }
  }

  let fresh = await prisma.videoGenerationCandidate.findMany({ where: { projectId: project.id, kind: { in: [...coreKinds] } }, orderBy: [{ createdAt: "desc" }, { candidateNo: "asc" }] });
  fresh = await excludeObsoletePlanningRevisionCandidates(project, fresh);
  let requeuedHistoricalTechnicalFailures = false;
  for (const candidate of fresh) {
    if (candidate.kind === "segment_video") continue;
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
    fresh = await excludeObsoletePlanningRevisionCandidates(project, fresh);
  }
  if (isOnePromptVideoFastPreviewEnabled()) {
    const selectedArtifactIds = new Set(
      fresh.filter((candidate) => candidate.selected).map((candidate) => candidate.artifactId),
    );
    const previewCandidates = fresh.filter((candidate) =>
      Boolean(candidate.mediaUrl)
      && !selectedArtifactIds.has(candidate.artifactId)
      && !["failed", "quality_failed", "cancelled", "superseded"].includes(candidate.status)
    );
    const previewCandidateByArtifact = new Map<string, typeof previewCandidates[number]>();
    for (const candidate of previewCandidates) {
      if (!previewCandidateByArtifact.has(candidate.artifactId)) {
        previewCandidateByArtifact.set(candidate.artifactId, candidate);
      }
    }
    for (const candidate of previewCandidateByArtifact.values()) {
      await applySelectedGenerationCandidate(project, candidate.id, true, false, [], true);
      await logOnePromptVideo("fast_preview.candidate_auto_selected", {
        projectId: project.id,
        artifactId: candidate.artifactId,
        candidateId: candidate.id,
        kind: candidate.kind,
      }, "warn");
    }
    if (previewCandidateByArtifact.size) {
      fresh = await prisma.videoGenerationCandidate.findMany({
        where: { projectId: project.id, kind: { in: [...coreKinds] } },
        orderBy: [{ createdAt: "desc" }, { candidateNo: "asc" }],
      });
      fresh = await excludeObsoletePlanningRevisionCandidates(project, fresh);
    }
  }
  for (const candidate of fresh) {
    if (
      candidate.kind === "segment_video"
      ||
      candidate.status !== "quality_retry"
      || !candidate.qualityReport
      || !isRecord(candidate.qualityReport)
      || !isTechnicalQualityEvaluationFailure(candidate.qualityReport as unknown as GenerationQualityReport)
      || !generationTargetNeedsTechnicalRetryReset(project, candidate)
    ) continue;
    await updateGenerationTargetForTechnicalQualityRetry(project, candidate, false, "");
    await updateProjectArtifactStatus(project.id, [candidate.artifactId], "generating", { retryFromStage: "generation" });
  }
  const parallelQualityEnabled =
    process.env.ONE_PROMPT_GENERATION_QUALITY_PARALLEL?.trim().toLowerCase() !== "false";
  if (parallelQualityEnabled && runQualityEvaluations) {
    await runBoundedImageQualityEvaluations(project, fresh);
    fresh = await prisma.videoGenerationCandidate.findMany({
      where: { projectId: project.id, kind: { in: [...coreKinds] } },
      orderBy: [{ createdAt: "desc" }, { candidateNo: "asc" }],
    });
    fresh = await excludeObsoletePlanningRevisionCandidates(project, fresh);
  }
  if (
    !runQualityEvaluations
    && queueQualityWorker
    && fresh.some((candidate) =>
      candidate.kind !== "segment_video"
      && Boolean(candidate.mediaUrl)
      && (
        (candidate.status === "succeeded" && !candidate.qualityReport)
        || candidate.status === "quality_retry"
      )
    )
  ) {
    await queueImageQualityWork(project.userId, project.id, "generation_candidates_ready");
  }
  const artifactIds = [...new Set(fresh.map((candidate) => candidate.artifactId))];
  // Keep the former sequential evaluator as an emergency rollback path.
  // In normal mode the bounded cross-artifact pool above owns all model calls.
  let evaluationsStarted = !runQualityEvaluations || parallelQualityEnabled
    ? qualityEvaluationsPerSync()
    : 0;
  for (const artifactId of artifactIds) {
    const artifactCandidates = fresh.filter((candidate) => candidate.artifactId === artifactId);

    // Evaluate every successful return across every batch. An older task may
    // finish after a retry batch was submitted; its paid result still belongs
    // in the quality pool and must not remain permanently at `succeeded`.
    const qualityWorkItems = artifactCandidates.filter((item) => {
      if (!item.mediaUrl) return false;
      // Segment videos leave the critical path after deterministic file/decode
      // validation. Multi-frame vision review is available only by explicit
      // user request and never runs from the sync loop.
      if (item.kind === "segment_video") return false;
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
        : candidate.status === "review_ready"
          ? await prisma.videoGenerationCandidate.updateMany({
              where: {
                id: candidate.id,
                status: "review_ready",
                qualityReport: { equals: Prisma.DbNull },
              },
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
      const metadata = candidateMetadata(candidate.metadata);
      const reusableEvaluation = reusableQualityEvaluation(candidate, artifactCandidates);
      if (reusableEvaluation) {
        const cachedReport = candidate.kind === "segment_video"
          ? { ...reusableEvaluation.report, advisoryOnly: true }
          : reusableEvaluation.report;
        const previousCandidate = artifactCandidates
          .filter((item) =>
            item.id !== candidate.id
            && item.candidateNo < candidate.candidateNo
            && item.qualityReport
            && isRecord(item.qualityReport)
          )
          .sort((a, b) => b.candidateNo - a.candidateNo)[0];
        const convergence = imageRepairConvergenceDecision({
          candidate,
          report: cachedReport,
          previousCandidate,
        });
        await prisma.videoGenerationCandidate.update({
          where: { id: candidate.id },
          data: {
            status: "evaluated",
            qualityReport: cleanInputJson(cachedReport as unknown as Record<string, unknown>),
            compositeScore: generationQualityCompositeScore(cachedReport),
            passed: candidate.kind === "segment_video" ? null : cachedReport.passed,
            retryInstruction: cachedReport.retryInstruction ?? null,
            metadata: cleanInputJson({
              ...metadata,
              qualityEvaluationFingerprint: reusableEvaluation.fingerprint,
              qualityEvaluationFingerprintVersion: QUALITY_EVALUATION_FINGERPRINT_VERSION,
              qualityReportReusedFromCandidateId: reusableEvaluation.sourceCandidateId,
              ...convergenceMetadata(convergence),
            }),
          },
        });
        await logOnePromptVideo("generation_quality.report_reused", {
          projectId: project.id,
          artifactId,
          candidateId: candidate.id,
          sourceCandidateId: reusableEvaluation.sourceCandidateId,
          qualityEvaluationFingerprint: reusableEvaluation.fingerprint,
        });
        continue;
      }
      evaluationsStarted += 1;
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
        authoritativeContractConflicts: uniqueStrings([
          ...(visualContract?.verifiedConflicts ?? []),
          ...visualContractDesignConflicts(project.planJson),
        ]),
        previousQualityReport,
        previousCandidateUrl: previousCandidate?.mediaUrl ?? undefined,
        schedulingContext: { userId: project.userId, projectId: project.id },
      };
      try {
        const evaluationLogContext = generationCandidateLogContext({
          projectId: project.id,
          artifactId: candidate.artifactId,
          kind: candidate.kind,
          candidateNo: candidate.candidateNo,
          metadata,
        });
        const cachedEvaluation = await withOnePromptVideoLogContext(evaluationLogContext, () =>
          evaluateGeneratedImageQualityWithCache({
            project,
            candidate,
            evaluation: {
                ...common,
                purpose: candidate.kind === "micro_shot_image"
                  ? "motion_checkpoint_image"
                  : Number(metadata.keyframeNo) < 0 ? "anchor_reference_image" : "boundary_keyframe",
                assetCategory: assetCategory || undefined,
                requiresExactBrandText: brandVisualAsset,
            },
          }));
        if (cachedEvaluation.state === "busy") {
          await prisma.videoGenerationCandidate.updateMany({
            where: { id: candidate.id, status: "evaluating" },
            data: {
              status: "quality_retry",
              metadata: cleanInputJson({
                ...candidateMetadata(cachedEvaluation.candidate.metadata),
                qualityNextRetryAt: cachedEvaluation.retryAt.toISOString(),
              }),
            },
          });
          continue;
        }
        const evaluatedCandidate = cachedEvaluation.candidate;
        const evaluatedMetadata = candidateMetadata(evaluatedCandidate.metadata);
        const report = cachedEvaluation.report;
        const effectiveReport: GenerationQualityReport = report;
        const technicalFailure = isTechnicalQualityEvaluationFailure(effectiveReport);
        const compositeScore = technicalFailure ? null : generationQualityCompositeScore(report);
        const convergence = technicalFailure
          ? undefined
          : imageRepairConvergenceDecision({
              candidate: evaluatedCandidate,
              report: effectiveReport,
              previousCandidate,
            });
        const technicalAttempts = Math.max(0, Number(evaluatedMetadata.qualityTechnicalAttempts) || 0) + 1;
        const technicalRetryExhausted = technicalAttempts >= qualityTechnicalRetryCycles();
        const technicalMetadata = cleanInputJson({
          ...evaluatedMetadata,
          qualityTechnicalAttempts: technicalAttempts,
          qualityNextRetryAt: new Date(Date.now() + qualityTechnicalRetryDelayMs(technicalAttempts)).toISOString(),
          qualityEvaluationFingerprint: qualityEvaluationFingerprintForCandidate(evaluatedCandidate),
          qualityEvaluationFingerprintVersion: QUALITY_EVALUATION_FINGERPRINT_VERSION,
        }) as Prisma.InputJsonValue;
        const completedMetadata = cleanInputJson({
          ...evaluatedMetadata,
          qualityEvaluationFingerprint: qualityEvaluationFingerprintForCandidate(evaluatedCandidate),
          qualityEvaluationFingerprintVersion: QUALITY_EVALUATION_FINGERPRINT_VERSION,
          ...(convergence ? convergenceMetadata(convergence) : {}),
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
                qualityReport: cleanInputJson(effectiveReport as unknown as Record<string, unknown>),
                compositeScore: null,
                passed: null,
                retryInstruction: null,
                status: technicalRetryExhausted ? "quality_failed" : "quality_retry",
                metadata: technicalMetadata,
              }
            : {
                qualityReport: cleanInputJson(effectiveReport as unknown as Record<string, unknown>),
                compositeScore,
                passed: report.passed,
                retryInstruction: report.retryInstruction ?? null,
                status: "evaluated",
                metadata: completedMetadata,
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
          await saveGenerationQualityReport(project.id, effectiveReport);
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
        const technicalAttempts = Math.max(0, Number(metadata.qualityTechnicalAttempts) || 0) + 1;
        const technicalRetryExhausted = technicalAttempts >= qualityTechnicalRetryCycles();
        const errorMessage = error instanceof Error ? error.message : String(error);
        await prisma.videoGenerationCandidate.updateMany({
          where: { id: candidate.id, status: "evaluating" },
          data: {
            status: technicalRetryExhausted ? "quality_failed" : "quality_retry",
            errorMessage,
            metadata: cleanInputJson({
              ...metadata,
              qualityTechnicalAttempts: technicalAttempts,
              qualityNextRetryAt: new Date(
                Date.now() + qualityTechnicalRetryDelayMs(technicalAttempts),
              ).toISOString(),
            }),
          },
        });
        if (technicalRetryExhausted) {
          await updateGenerationTargetForTechnicalQualityRetry(project, candidate, true, errorMessage);
          await updateProjectArtifactStatus(project.id, [candidate.artifactId], "failed", {
            dirtyReason: errorMessage,
            retryFromStage: "manual",
          });
        }
        await logOnePromptVideo("generation_quality.evaluation_retry", {
          projectId: project.id,
          artifactId,
          candidateId: candidate.id,
          technicalAttempts,
          technicalRetryExhausted,
          nextRetryDelayMs: qualityTechnicalRetryDelayMs(technicalAttempts),
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
    const unsettledStatuses = allArtifactCandidates[0]?.kind === "segment_video"
      ? new Set(["running", "pending", "succeeded", "evaluating", "quality_retry"])
      : new Set(["running", "pending", "succeeded", "review_ready", "evaluating", "quality_retry"]);
    if (allArtifactCandidates.some((candidate) => unsettledStatuses.has(candidate.status))) continue;

    if (allArtifactCandidates[0]?.kind === "segment_video") {
      const usableCandidates = allArtifactCandidates.filter((candidate) =>
        Boolean(candidate.mediaUrl)
        && candidate.status !== "failed"
      );
      const segment = project.segments.find((item) => item.id === allArtifactCandidates[0]?.targetId);
      if (segment && usableCandidates.length > 0) {
        const activeCandidate = usableCandidates.find((candidate) =>
          candidate.selected && candidate.mediaUrl === segment.clipUrl
        );
        await prisma.videoSegment.update({
          where: { id: segment.id },
          data: activeCandidate
            ? {
                status: VideoShotStatus.CLIP_READY,
                qualityScore: Math.round(activeCandidate.compositeScore ?? segment.qualityScore ?? 0),
                errorMessage: null,
              }
            : {
                status: VideoShotStatus.CLIP_RUNNING,
                errorMessage: null,
              },
        });
        await updateProjectArtifactStatus(
          project.id,
          [artifactId],
          activeCandidate ? "ready" : "generating",
          activeCandidate
            ? { retryFromStage: "generation" }
            : {
                dirtyReason: "Video candidates are ready for user review; automated visual analysis is advisory only.",
                retryFromStage: "manual",
              },
        );
      } else if (segment) {
        const technicalErrors = allArtifactCandidates
          .map((candidate) => candidate.errorMessage)
          .filter((value): value is string => Boolean(value));
        const newestMetadata = candidateMetadata(allArtifactCandidates[0]?.metadata ?? null);
        const retryCycleId = typeof newestMetadata.retryCycleId === "string"
          ? newestMetadata.retryCycleId
          : "";
        const retryCycleCandidates = retryCycleId
          ? allArtifactCandidates.filter((candidate) =>
              candidateMetadata(candidate.metadata).retryCycleId === retryCycleId
            )
          : allArtifactCandidates;
        const failedAttempts = new Set(
          retryCycleCandidates
            .filter((candidate) => candidate.status === "failed")
            .map((candidate) => Math.max(1, Number(candidateMetadata(candidate.metadata).attempt) || 1)),
        ).size;
        const canRetryTechnicalVideoFailure = failedAttempts <= generationMaxRetries("segment_video");
        if (canRetryTechnicalVideoFailure) {
          await prisma.videoSegment.update({
            where: { id: segment.id },
            data: {
              status: VideoShotStatus.CLIP_PENDING,
              errorMessage: null,
            },
          });
          await updateProjectArtifactStatus(project.id, [artifactId], "dirty", {
            dirtyReason: technicalErrors.join("；") || "Video candidate failed deterministic technical validation; submitting the next progressive candidate.",
            retryFromStage: "generation",
          });
          await logOnePromptVideo("generation_candidate.video.progressive_retry_scheduled", {
            projectId: project.id,
            artifactId,
            segmentNo: segment.segmentNo,
            failedAttempts,
            maxRetries: generationMaxRetries("segment_video"),
          });
          continue;
        }
        await prisma.videoSegment.update({
          where: { id: segment.id },
          data: {
            status: VideoShotStatus.FAILED,
            errorMessage: technicalErrors.join("；") || "所有视频候选均未通过文件技术检查，请修改提示词或素材后手动重新生成。",
          },
        });
        await updateProjectArtifactStatus(project.id, [artifactId], "failed", {
          dirtyReason: technicalErrors.join("；") || "All video candidates failed deterministic file validation.",
          retryFromStage: "manual",
        });
      }
      continue;
    }

    const referenceMissingCandidate = allArtifactCandidates.find((candidate) =>
      candidate.qualityReport
      && isRecord(candidate.qualityReport)
      && isReferenceMissingQualityEvaluation(candidate.qualityReport as unknown as GenerationQualityReport)
    );
    if (referenceMissingCandidate?.qualityReport && isRecord(referenceMissingCandidate.qualityReport)) {
      const report = referenceMissingCandidate.qualityReport as unknown as GenerationQualityReport;
      await saveGenerationQualityReport(project.id, report);
      const metadata = candidateMetadata(referenceMissingCandidate.metadata);
      if (referenceMissingCandidate.kind === "keyframe_image") {
        await prisma.videoKeyframe.update({
          where: { id: referenceMissingCandidate.targetId },
          data: { status: VideoShotStatus.IMAGE_PENDING, errorMessage: report.retryInstruction ?? null },
        });
      } else if (referenceMissingCandidate.kind === "micro_shot_image") {
        await updatePlanMicroShot(project.id, Number(metadata.segmentNo), Number(metadata.microShotNo), {
          imageStatus: "idle",
          errorMessage: report.retryInstruction ?? "",
        });
      }
      await updateProjectArtifactStatus(project.id, [artifactId], "dirty", {
        dirtyReason: report.retryInstruction || report.artifactIssues.join("；"),
        retryFromStage: "reference_selector",
      });
      continue;
    }

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
    if (
      userProtectedSelection
      && targetKeyframe
      && targetKeyframe.imageUrl
      && targetKeyframe.status === VideoShotStatus.IMAGE_RUNNING
    ) {
      // A regeneration candidate may finish after the user has already locked
      // an older selected image. The protected selection must stay intact, but
      // the now-terminal task must no longer keep the keyframe and project in
      // a fake "generating" state.
      await prisma.videoKeyframe.updateMany({
        where: {
          id: targetKeyframe.id,
          status: VideoShotStatus.IMAGE_RUNNING,
          imageUrl: { not: null },
        },
        data: {
          status: targetKeyframe.locked
            ? VideoShotStatus.IMAGE_APPROVED
            : VideoShotStatus.IMAGE_READY,
          errorMessage: null,
        },
      });
      await logOnePromptVideo("image.sync.protected_selection_task_reconciled", {
        projectId: project.id,
        artifactId,
        keyframeId: targetKeyframe.id,
        keyframeNo: targetKeyframe.keyframeNo,
        preservedCandidateId: currentSelection?.id,
        completedCandidateId: allArtifactCandidates[0]?.id,
        restoredStatus: targetKeyframe.locked
          ? VideoShotStatus.IMAGE_APPROVED
          : VideoShotStatus.IMAGE_READY,
      });
    }
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
    const latestEvaluatedFailure = [...retryCycleCandidates]
      .filter((candidate) => candidate.qualityReport && isRecord(candidate.qualityReport))
      .sort((a, b) => b.candidateNo - a.candidateNo)[0];
    const convergenceEpisode = repairConvergenceEpisodeFromUnknown(
      candidateMetadata(latestEvaluatedFailure?.metadata ?? null).repairConvergenceEpisode,
    );
    const convergenceTerminal = convergenceEpisode?.terminalState;
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
      continue;
    }
    const qualityAttemptsUsed = generationQualityAttemptsUsed(retryCycleCandidates);
    const transportAttemptsUsed = generationTransportAttemptsUsed(retryCycleCandidates);
    const automaticRetryLimit = generationMaxRetries(retryCycleCandidates[0]?.kind as CandidateKind | undefined);
    const retryBudgetExhausted = qualityAttemptsUsed > automaticRetryLimit;
    const transportRetryBudgetExhausted = !failureReport && transportAttemptsUsed > automaticRetryLimit;
    const retryable = !technicalEvaluationExhausted
      && (!failureReport || effectiveRetryFromStage === "generation")
      && !retryBudgetExhausted
      && !transportRetryBudgetExhausted
      && !convergenceTerminal;
    const retryInstruction = failureReport?.retryInstruction || retryCycleCandidates.map((item) => item.errorMessage).filter(Boolean).join("; ") || "No generated candidate passed visual quality evaluation";
    const errorDetails = failureReport?.artifactIssues.length ? ` ${failureReport.artifactIssues.join("；")}` : "";
    const errorMessage = retryable
      ? null
      : technicalEvaluationExhausted
        ? `画面质检服务暂不可用，已保留现有候选图且未消耗画面生成重试预算。请稍后对现有候选重新质检。${errorDetails}`
      : retryBudgetExhausted
        ? `画面质检未通过，且该版本链的自动重试预算已用完（初始生成 1 次，自动重试 ${automaticRetryLimit} 次）。请查看候选结果后重新生成或人工接受。${errorDetails}`
        : convergenceTerminal === "stalled"
          ? `自动修复已停止：连续两轮没有产生可识别的新状态。系统保留了最佳候选，请人工检查或修改合同后再试。${errorDetails}`
          : convergenceTerminal === "oscillating"
            ? `自动修复已停止：检测到修复状态在两个结果之间往返振荡。系统保留了最佳候选，请人工检查或修改合同后再试。${errorDetails}`
            : convergenceTerminal === "budget_exhausted"
              ? `自动修复已停止：统一收敛预算已用完，且没有达到通过条件。系统保留了最佳候选。${errorDetails}`
              : convergenceTerminal === "manual_review"
                ? `自动修复已升级到人工复核：当前阶段访问过多，或完整重生成仍未严格改善。系统保留了最佳候选。${errorDetails}`
        : transportRetryBudgetExhausted
          ? `上游生成或素材下载连续失败，技术重试预算已用完；这不代表画面质检未通过。请检查素材地址后重试。${errorDetails}`
        : effectiveRetryFromStage === "stage3"
          ? `画面质检发现经编译器确认的提示合同冲突，已暂停继续抽图，需先修正生成合同。${errorDetails}`
          : effectiveRetryFromStage === "stage2b"
            ? `画面质检发现镜头结构或叙事状态不可达，已暂停继续抽图，需先修正分镜结构。${errorDetails}`
            : `画面质检无法可靠完成，已暂停自动生成，请查看诊断后重试。${errorDetails}`;
    if (failureReport) await saveGenerationQualityReport(project.id, failureReport);
    if (retryCycleCandidates[0]?.kind === "keyframe_image") {
      await prisma.videoKeyframe.update({ where: { id: retryCycleCandidates[0].targetId }, data: { status: retryable ? VideoShotStatus.IMAGE_PENDING : VideoShotStatus.FAILED, errorMessage } });
    } else if (retryCycleCandidates[0]?.kind === "micro_shot_image") {
      await updatePlanMicroShot(project.id, Number(metadata.segmentNo), Number(metadata.microShotNo), { imageStatus: retryable ? "idle" : "failed", errorMessage: errorMessage ?? "" });
    } else if (retryCycleCandidates[0]?.kind === "segment_video") {
      await prisma.videoSegment.update({ where: { id: retryCycleCandidates[0].targetId }, data: { status: retryable ? VideoShotStatus.CLIP_PENDING : VideoShotStatus.FAILED, errorMessage } });
    }
    await updateProjectArtifactStatus(project.id, [artifactId], retryable ? "dirty" : "failed", {
      dirtyReason: errorMessage ?? retryInstruction,
      retryFromStage: technicalEvaluationExhausted
        ? "manual"
        : convergenceTerminal
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
  project: VideoProjectRecord,
  candidate: VideoProjectRecord["generationCandidates"][number],
  exhausted: boolean,
  errorMessage: string,
): Promise<void> {
  const metadata = candidateMetadata(candidate.metadata);
  if (candidate.kind === "keyframe_image") {
    await prisma.videoKeyframe.updateMany({
      where: { id: candidate.targetId },
      data: {
        status: VideoShotStatus.IMAGE_RUNNING,
        errorMessage: exhausted ? errorMessage : null,
      },
    });
    return;
  }
  if (candidate.kind === "micro_shot_image") {
    const targetContract = isRecord(metadata.targetContract) ? metadata.targetContract : {};
    await updatePlanMicroShot(project.id, Number(metadata.segmentNo), Number(metadata.microShotNo), {
      imageStatus: "running",
      errorMessage: exhausted ? errorMessage : "",
      resolvedRevisionId: readPlanShotString(targetContract, [
        "resolvedRevisionId",
        "resolved_revision_id",
      ]) || undefined,
    });
    return;
  }
  if (candidate.kind === "segment_video") {
    await prisma.videoSegment.updateMany({
      where: { id: candidate.targetId },
      data: {
        status: VideoShotStatus.CLIP_RUNNING,
        errorMessage: exhausted ? errorMessage : null,
      },
    });
  }
}

async function excludeObsoletePlanningRevisionCandidates(
  project: VideoProjectRecord,
  candidates: VideoProjectRecord["generationCandidates"],
): Promise<VideoProjectRecord["generationCandidates"]> {
  const obsolete = candidates.filter((candidate) =>
    !generationCandidateMatchesActivePlanningRevision(project.planJson, candidate));
  if (!obsolete.length) return candidates;

  const settledObsoleteIds = obsolete
    .filter((candidate) => candidate.status !== "running")
    .map((candidate) => candidate.id);
  if (settledObsoleteIds.length) {
    await prisma.videoGenerationCandidate.updateMany({
      where: {
        id: { in: settledObsoleteIds },
        status: { not: "superseded" },
      },
      data: {
        status: "superseded",
        selected: false,
        errorMessage: "Candidate preserved for history but excluded because its boundary-planning revision is obsolete.",
      },
    });
  }
  await logOnePromptVideo("generation_candidate.obsolete_revision_ignored", {
    projectId: project.id,
    candidateIds: obsolete.map((candidate) => candidate.id),
    runningCandidateIds: obsolete
      .filter((candidate) => candidate.status === "running")
      .map((candidate) => candidate.id),
  }, "warn");
  return candidates.filter((candidate) =>
    generationCandidateMatchesActivePlanningRevision(project.planJson, candidate));
}

function generationTargetNeedsTechnicalRetryReset(
  project: VideoProjectRecord,
  candidate: VideoProjectRecord["generationCandidates"][number],
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
    const microShot = readEffectivePlanMicroShots(
      project.planJson,
      Number(metadata.segmentNo),
    ).find((item) => item.microShotNo === Number(metadata.microShotNo));
    return Boolean(microShot && (microShot.imageStatus === "failed" || microShot.errorMessage));
  }
  return false;
}

async function applySelectedGenerationCandidate(
  project: VideoProjectRecord,
  candidateId: string,
  userAccepted: boolean,
  userApproved: boolean,
  parentRevisionIds: string[] = [],
  protectLockedSelection = false,
): Promise<void> {
  const candidate = await prisma.videoGenerationCandidate.findUnique({ where: { id: candidateId } });
  if (!candidate || candidate.projectId !== project.id || !candidate.mediaUrl) throw new Error("Generation candidate is unavailable");
  const report = candidate.qualityReport && isRecord(candidate.qualityReport) ? candidate.qualityReport as unknown as GenerationQualityReport : undefined;
  if (candidate.kind !== "segment_video" && candidate.passed !== true && !userAccepted) {
    throw new Error("Candidate did not pass visual quality evaluation");
  }
  if (candidate.kind === "segment_video" && candidate.status === "failed") {
    throw new Error("Video candidate failed deterministic technical validation");
  }
  const acceptedReport = report ? { ...report, userAccepted: candidate.passed !== true && userAccepted, originalPassed: report.originalPassed ?? report.passed } : undefined;
  const metadata = candidateMetadata(candidate.metadata);
  if (candidate.kind === "micro_shot_image") {
    const activeMicroShot = readEffectivePlanMicroShots(
      project.planJson,
      Number(metadata.segmentNo),
    ).find((item) => item.microShotNo === Number(metadata.microShotNo));
    if (!activeMicroShot || !selectedCandidateMatchesMicroShotRevision(candidate, activeMicroShot)) {
      throw new Error("This micro-shot candidate belongs to an obsolete boundary-planning revision.");
    }
  }
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
          data: { imageUrl: candidate.mediaUrl, status: VideoShotStatus.IMAGE_READY, qualityScore: Math.round(candidate.compositeScore ?? 0), errorMessage: null },
        });
        if (guarded.count !== 1) return;
      } else if (candidate.kind === "segment_video") {
        const guarded = await tx.videoSegment.updateMany({
          where: { id: candidate.targetId, locked: false, NOT: { status: VideoShotStatus.CLIP_APPROVED } },
          data: { clipUrl: candidate.mediaUrl, status: VideoShotStatus.CLIP_READY, qualityScore: Math.round(candidate.compositeScore ?? 0), errorMessage: null },
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
      await tx.videoKeyframe.update({ where: { id: keyframe.id }, data: { imageUrl: candidate.mediaUrl, status: VideoShotStatus.IMAGE_READY, qualityScore: Math.round(candidate.compositeScore ?? 0), errorMessage: null } });
    } else if (candidate.kind === "segment_video" && !protectLockedSelection) {
      const segment = project.segments.find((item) => item.id === candidate.targetId);
      if (!segment) throw new Error("Video segment not found");
      await tx.videoSegment.update({ where: { id: segment.id }, data: { clipUrl: candidate.mediaUrl, status: VideoShotStatus.CLIP_READY, qualityScore: Math.round(candidate.compositeScore ?? 0), errorMessage: null } });
    }
    applied = true;
  });
  if (!applied) return;
  if (candidate.kind === "segment_video") {
    const segment = project.segments.find((item) => item.id === candidate.targetId);
    if (segment) await invalidateGeneratedBridgesForSegment(project.id, segment.segmentNo, "Adjacent segment candidate changed; generated bridge approval must be renewed.");
  }
  if (candidate.kind === "micro_shot_image") {
    const targetContract = isRecord(metadata.targetContract) ? metadata.targetContract : {};
    await updatePlanMicroShot(project.id, Number(metadata.segmentNo), Number(metadata.microShotNo), {
      imageUrl: candidate.mediaUrl,
      imageStatus: "ready",
      errorMessage: "",
      resolvedRevisionId: readPlanShotString(targetContract, [
        "resolvedRevisionId",
        "resolved_revision_id",
      ]) || undefined,
    });
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
  await logOnePromptVideo("generation_candidate.selected", {
    ...generationCandidateLogContext({
      projectId: project.id,
      artifactId: candidate.artifactId,
      kind: candidate.kind,
      candidateNo: candidate.candidateNo,
      metadata,
    }),
    candidateId: candidate.id,
    passed: candidate.passed,
    userAccepted,
    automaticallySelected: !userApproved,
  });
}

function activeDependencyRevisionIds(project: VideoProjectRecord, kind: string, targetId: string, candidateMetadataValue: Record<string, unknown>): string[] {
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

export async function selectGenerationCandidate(userId: string, projectId: string, candidateId: string, acceptFailed = false): Promise<VideoProjectRecord> {
  const project = await requireVideoProject(userId, projectId);
  const candidate = project.generationCandidates.find((item) => item.id === candidateId);
  if (!candidate) throw new Error("Generation candidate not found");
  if (!candidate.mediaUrl) throw new Error("Candidate media is not ready");
  if (candidate.kind !== "segment_video" && !candidate.qualityReport) throw new Error("Candidate has not finished visual quality evaluation");
  if (candidate.kind !== "segment_video" && candidate.passed !== true && !acceptFailed) throw new Error("This candidate failed quality evaluation; explicit acceptance is required");
  if (candidate.kind === "segment_video" && candidate.status === "failed") throw new Error("Video candidate failed deterministic technical validation");
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
    const micro = readEffectivePlanMicroShots(
      project.planJson,
      Number(metadata.segmentNo),
    ).find((item) => item.microShotNo === Number(metadata.microShotNo));
    const revisionId = await appendVideoMediaRevision(projectId, { kind: "micro_shot_image", targetId: candidate.targetId, segmentNo: Number(metadata.segmentNo), microShotNo: Number(metadata.microShotNo), url: micro?.imageUrl });
    if (revisionId) parentRevisionIds.push(revisionId);
  }
  await applySelectedGenerationCandidate(project, candidateId, acceptFailed, true, parentRevisionIds);
  await persistProjectProductionProjection(projectId);
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
    await queueNextImageTask(userId, projectId, "image.continue_after_manual_candidate_selection");
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
): Promise<VideoProjectRecord> {
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

export async function analyzeSegmentVideoCandidate(
  userId: string,
  projectId: string,
  candidateId: string,
): Promise<VideoProjectRecord> {
  const project = await requireVideoProject(userId, projectId);
  const candidate = project.generationCandidates.find((item) => item.id === candidateId);
  if (!candidate || candidate.kind !== "segment_video") {
    throw new Error("Segment video candidate not found");
  }
  if (!candidate.mediaUrl) throw new Error("Segment video is not ready");

  const technical = await inspectGeneratedVideoTechnicalQuality(candidate.mediaUrl);
  if (!technical.valid) {
    throw new Error(`视频文件技术检查失败：${technical.errorMessage || "无法解码视频"}`);
  }
  const metadata = candidateMetadata(candidate.metadata);
  const targetContract = isRecord(metadata.targetContract) ? metadata.targetContract : {};
  const visualContract = isRecord(metadata.visualContract)
    ? metadata.visualContract as unknown as AuthoritativeVisualContract
    : undefined;
  const report = await evaluateGeneratedVideoQuality({
    assetId: candidate.artifactId,
    candidateId: candidate.id,
    candidateNo: candidate.candidateNo,
    mediaUrl: candidate.mediaUrl,
    targetContract,
    selectedReferenceUrls: stringArrayValue(metadata.selectedReferenceUrls),
    referenceUsageNotes: stringArrayValue(metadata.referenceUsageNotes),
    prompt: candidate.prompt,
    negativePrompt: candidate.negativePrompt,
    visualContract,
    authoritativeContractConflicts: uniqueStrings([
      ...(visualContract?.verifiedConflicts ?? []),
      ...visualContractDesignConflicts(project.planJson),
    ]),
    purpose: "video_segment",
    durationSeconds: Number(metadata.durationSeconds) || 0,
    motionCheckpoints: Array.isArray(metadata.motionCheckpoints) ? metadata.motionCheckpoints : [],
    deferredVideoQualityChecks: deferredVideoQualityChecksFromUnknown(metadata.deferredVideoQualityChecks),
    startFrameUrl: String(metadata.startFrameUrl || ""),
    endFrameUrl: String(metadata.endFrameUrl || ""),
    schedulingContext: { userId, projectId },
  });
  const advisoryReport: GenerationQualityReport = {
    ...report,
    advisoryOnly: true,
    manualVideoQualityChecks: deferredVideoQualityChecksFromUnknown(metadata.deferredVideoQualityChecks),
  };
  await prisma.videoGenerationCandidate.update({
    where: { id: candidate.id },
    data: {
      status: "review_ready",
      qualityReport: cleanInputJson(advisoryReport as unknown as Record<string, unknown>),
      compositeScore: generationQualityCompositeScore(advisoryReport),
      passed: null,
      retryInstruction: advisoryReport.retryInstruction ?? null,
      errorMessage: null,
      metadata: cleanInputJson({
        ...metadata,
        technicalInspection: technical,
        videoAdvisoryAnalyzedAt: new Date().toISOString(),
      }),
    },
  });
  await logOnePromptVideo("generation_quality.video_advisory_requested", {
    userId,
    projectId,
    artifactId: candidate.artifactId,
    candidateId: candidate.id,
    modelPassed: report.passed,
  });
  return requireVideoProject(userId, projectId);
}

async function prepareKeyframeImageSubmission(
  project: VideoProjectRecord,
  nextKeyframe: VideoProjectRecord["keyframes"][number],
) {
  const artifactId = imageArtifactIdForKeyframeNo(nextKeyframe.keyframeNo);
  const learning = buildImageCandidateLearningSummary(project, artifactId, nextKeyframe.imageUrl);
  const earlyTargetLogContext = {
    projectId: project.id,
    artifactId,
    generationKind: "keyframe_image",
    keyframeNo: nextKeyframe.keyframeNo,
    assetLabel: assetLogLabelForKeyframe(project, nextKeyframe),
    candidateNo: learning.historicalCandidateCount + 1,
    candidateCount: learning.historicalCandidateCount + 1,
    moduleNameZh: nextKeyframe.keyframeNo < 0 ? "一致性资产图片生成" : "关键帧图片生成",
  };
  const draftPromptStartedAtMs = Date.now();
  const draftPrompt = compileImagePromptForKeyframe(project, nextKeyframe);
  await logOnePromptVideo("production.step.completed", {
    ...earlyTargetLogContext,
    stepNameZh: "程序根据脚本、画面合同和上一轮问题起草图片提示词",
    executionMethod: "program",
    durationMs: Date.now() - draftPromptStartedAtMs,
    resultZh: learning.historicalCandidateCount > 0 ? "已把上一轮质检问题写入返修提示词" : "首轮生成提示词已起草",
  });
  const referenceSelectionStartedAtMs = Date.now();
  const referenceSelection = await selectReferenceImagesForKeyframe(project, nextKeyframe, draftPrompt.prompt);
  await logOnePromptVideo("production.step.completed", {
    ...earlyTargetLogContext,
    stepNameZh: "为这张图选择一致性参考资产",
    executionMethod: "program",
    durationMs: Date.now() - referenceSelectionStartedAtMs,
    resultZh: `选中 ${referenceSelection.output.selectedReferenceUrls?.length ?? 0} 张参考图`,
  });
  const compileStartedAtMs = Date.now();
  const compiled = compileImagePromptForKeyframe(project, nextKeyframe, {
    ...referenceSelection.output,
    finalTextPrompt: draftPrompt.prompt,
  });
  assertCompiledVisualContractReady(compiled);
  const learnedPrompt = buildImageAttemptPrompt(compiled, learning);
  await logOnePromptVideo("production.step.completed", {
    ...earlyTargetLogContext,
    stepNameZh: "编译最终图片提示词并做合同冲突检查",
    executionMethod: "deterministic_program",
    durationMs: Date.now() - compileStartedAtMs,
    resultZh: "最终提示词通过程序合同检查",
  });
  const learnedReferenceUrls = uniqueStrings([
    ...learning.referenceImageUrls,
    ...(compiled.referenceImageUrls ?? []),
  ]).slice(0, ONE_PROMPT_MAX_REFERENCE_IMAGES);
  const planTarget = readPlanKeyframeMap(project.planJson).get(nextKeyframe.keyframeNo)
    ?? readPlanConsistencyReferenceMap(project.planJson).get(nextKeyframe.keyframeNo);
  const dependencyScope = resolveImageTargetDependencyScope(project.planJson, planTarget, nextKeyframe.keyframeNo);
  const personIdentityAnchor = dependencyScope.isolatedAsset
    ? personAnchorForPrompt(project.planJson, dependencyScope.targetAnchorId)
    : undefined;
  const authoritativeAnchorLocks = personIdentityAnchor
    ? ""
    : consistencyAnchorLocksForPrompt(
        project.planJson,
        dependencyScope.requiredAnchorIds,
      );
  const rawLearnedReferenceUsageNotes = [
    ...learning.referenceUsageNotes,
    ...(referenceSelection.output.usageNotes ?? []),
    authoritativeAnchorLocks ? `AUTHORITATIVE ANCHOR CONTRACTS — visible words and markings in these locks are required, not forbidden:\n${authoritativeAnchorLocks}` : "",
  ];
  const learnedReferenceUsageNotes = personIdentityAnchor
    ? normalizePersonReferenceUsageNotes(rawLearnedReferenceUsageNotes, personIdentityAnchor.id)
    : uniqueStrings(rawLearnedReferenceUsageNotes);
  const targetLogContext = generationCandidateLogContext({
    projectId: project.id,
    artifactId,
    kind: "keyframe_image",
    candidateNo: learning.historicalCandidateCount + 1,
    candidateCount: learning.historicalCandidateCount + 1,
    metadata: {
      keyframeNo: nextKeyframe.keyframeNo,
      assetNameZh: readPlanShotString(planTarget, ["displayNameZh", "display_name_zh", "purposeZh", "purpose_zh", "purpose"]),
      assetCategory: dependencyScope.assetCategory,
      assetView: dependencyScope.assetView,
      targetContract: planTarget ?? { purpose: nextKeyframe.purpose },
    },
  });
  return {
    artifactId,
    learning,
    referenceSelection,
    compiled,
    learnedPrompt,
    learnedReferenceUrls,
    planTarget,
    dependencyScope,
    learnedReferenceUsageNotes,
    targetLogContext,
  };
}

async function submitNextImageTaskWork(params: {
  userId?: string;
  projectId: string;
  keyframes: VideoProjectRecord["keyframes"];
  logEventPrefix: string;
  targetId: string;
}): Promise<void> {
  const concurrency = imageTaskConcurrency();
  const availableSlots = 1;

  const storedProject = await prisma.videoProject.findUnique({
    where: { id: params.projectId },
    include: PROJECT_INCLUDE,
  });
  if (!storedProject) return;
  const project = {
    ...storedProject,
    planJson: await readArtifactPlan(params.projectId),
  } as VideoProjectRecord;

  const nextKeyframes = project.keyframes.filter((keyframe) => {
    if (keyframe.locked && keyframe.imageUrl) return false;
    if (keyframe.imageUrl) return false;
    return keyframe.status !== VideoShotStatus.IMAGE_READY
      && keyframe.status !== VideoShotStatus.IMAGE_APPROVED
      && keyframe.status !== VideoShotStatus.FAILED;
  });
  const consistencyReferences = project.keyframes.filter((keyframe) => isConsistencyKeyframeNo(keyframe.keyframeNo));
  const missingConsistencyReferences = consistencyReferences.filter((keyframe) => !keyframe.imageUrl);
  const unapprovedConsistencyReferences = consistencyReferences.filter((keyframe) => keyframe.imageUrl && !isApprovedConsistencyReference(keyframe));
  const waitingForConsistencyReferences = missingConsistencyReferences.length > 0 || unapprovedConsistencyReferences.length > 0;
  const candidateKeyframes = dependencyReadyImageTargets(project)
    .filter((keyframe) => !params.targetId || keyframe.id === params.targetId);
  const nextKeyframesToClaim = candidateKeyframes.slice(0, availableSlots);
  const nextKeyframesToSubmit: typeof nextKeyframesToClaim = [];
  for (const keyframe of nextKeyframesToClaim) {
    const claim = await prisma.videoKeyframe.updateMany({
      where: {
        id: keyframe.id,
        imageUrl: null,
        status: {
          in: [
            VideoShotStatus.SCRIPT_READY,
            VideoShotStatus.IMAGE_PENDING,
            VideoShotStatus.IMAGE_RUNNING,
          ],
        },
      },
      data: {
        status: VideoShotStatus.IMAGE_RUNNING,
        errorMessage: null,
      },
    });
    if (claim.count === 1) {
      nextKeyframesToSubmit.push(keyframe);
    } else {
      await logOnePromptVideo(params.logEventPrefix + ".prepare.skip_claimed", {
        userId: params.userId,
        projectId: params.projectId,
        keyframeId: keyframe.id,
        keyframeNo: keyframe.keyframeNo,
        reason: "durable worker could not claim target before prompt/reference preparation",
      });
    }
  }
  if (!nextKeyframesToSubmit.length) {
    const blockedBoundaryKeyframes = nextKeyframes.filter((keyframe) =>
      !isConsistencyKeyframeNo(keyframe.keyframeNo)
      && (
        !isBoundaryAssetDependencyReady(project, keyframe.keyframeNo)
        || !isTransitionReferenceReadyForBoundary(project, keyframe.keyframeNo)
      )
    );
    if (blockedBoundaryKeyframes.length) {
      const frontier = [...blockedBoundaryKeyframes].sort((a, b) => a.keyframeNo - b.keyframeNo)[0];
      const frontierSegmentNo = segmentNoForBoundaryKeyframe(project.planJson, frontier.keyframeNo);
      const transition = transitionReferenceArtifactsFromPlan(project.planJson).find((item) => item.toSegmentNo === frontierSegmentNo);
      const missingAssetIds = missingApprovedAssetReferenceIdsForBoundary(project, frontier.keyframeNo);
      const dependency = missingAssetIds.length
        ? `，等待资产 ${missingAssetIds.join("、")}`
        : transition?.parentKeyframeNo
          ? `，依赖 KF${transition.parentKeyframeNo}`
          : "";
      await prisma.videoProject.update({
        where: { id: params.projectId },
        data: {
          status: VideoProjectStatus.IMAGE_REVIEW,
          errorMessage: `当前生成前沿为 KF${frontier.keyframeNo}${dependency}。依赖满足后会自动进入生成队列。`,
        },
      });
    } else if (waitingForConsistencyReferences) {
      await prisma.videoProject.update({
        where: { id: params.projectId },
        data: {
          status: VideoProjectStatus.IMAGE_REVIEW,
          errorMessage: null,
        },
      });
    }
    await logOnePromptVideo(params.logEventPrefix + ".submit.no_pending", {
      userId: params.userId,
      projectId: params.projectId,
      runningCount: 0,
      concurrency,
      blockedBoundaryKeyframeNos: blockedBoundaryKeyframes.map((item) => item.keyframeNo),
      missingAssets: missingConsistencyReferences.map((keyframe) => assetLogLabelForKeyframe(project, keyframe)),
      unapprovedAssets: unapprovedConsistencyReferences.map((keyframe) => assetLogLabelForKeyframe(project, keyframe)),
    });
    return;
  }

  await logOnePromptVideo(params.logEventPrefix + ".submit.batch", {
    userId: params.userId,
    projectId: params.projectId,
    runningCount: 0,
    concurrency,
    submitCount: nextKeyframesToSubmit.length,
    keyframeNos: nextKeyframesToSubmit.map((keyframe) => keyframe.keyframeNo),
    consistencyGateActive: waitingForConsistencyReferences,
  });

  // Prompt compilation and reference selection are independent for every
  // dependency-ready target. Prepare the whole wave concurrently, then keep
  // planJson persistence and task claiming ordered to prevent lost updates.
  const preparedSubmissions = await Promise.allSettled(
    nextKeyframesToSubmit.map((nextKeyframe) =>
      prepareKeyframeImageSubmission(project, nextKeyframe)
    ),
  );
  for (let index = 0; index < nextKeyframesToSubmit.length; index += 1) {
    const nextKeyframe = nextKeyframesToSubmit[index];
    try {
      const prepared = preparedSubmissions[index];
      if (prepared.status === "rejected") throw prepared.reason;
      const {
        artifactId,
        learning,
        referenceSelection,
        compiled,
        learnedPrompt,
        learnedReferenceUrls,
        planTarget,
        dependencyScope,
        learnedReferenceUsageNotes,
        targetLogContext,
      } = prepared.value;
      await withOnePromptVideoLogContext(targetLogContext, () => saveReferenceSelectionOutput(params.projectId, {
        ...referenceSelection.output,
        selectedReferenceUrls: learnedReferenceUrls,
        finalTextPrompt: learnedPrompt,
      }));
      await withOnePromptVideoLogContext(targetLogContext, () => savePromptDebugArtifact(params.projectId, {
        ...compiled.debugArtifact,
        inputs: {
          ...compiled.debugArtifact.inputs,
          incrementalCandidateLearning: learning.debugSummary,
        },
        selectedReferenceUrls: learnedReferenceUrls,
        referenceUsageNotes: learnedReferenceUsageNotes,
        finalPrompt: learnedPrompt,
        rules: uniqueStrings([...compiled.debugArtifact.rules, "incremental_candidate_learning", "preserve_candidate_history"]),
      }));
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
          repairMode: learning.repairMode,
          repairDecision: learning.repairDecision,
          parentCandidateId: learning.baselineSelection.baselineCandidateId,
          baselineSelection: learning.baselineSelection,
          keyframeNo: nextKeyframe.keyframeNo,
          assetNameZh: readPlanShotString(planTarget, ["displayNameZh", "display_name_zh", "purposeZh", "purpose_zh", "purpose"]),
          assetCategory: dependencyScope.assetCategory,
          assetView: dependencyScope.assetView,
          targetContract: scopedTargetContractFromCompiled(
            compiled,
            planTarget ?? { purpose: nextKeyframe.purpose, imagePrompt: nextKeyframe.imagePrompt },
          ),
          visualContract: compiled.debugArtifact.inputs.visualContract,
          selectedReferenceUrls: learnedReferenceUrls,
          referenceUsageNotes: learnedReferenceUsageNotes,
        },
      });
      await prisma.videoKeyframe.update({
        where: { id: nextKeyframe.id },
        data: {
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
          referenceImageUrls: compiled.referenceImageUrls ?? [],
          negativePrompt: compiled.negativePrompt,
        },
      });
    } catch (error) {
      const retryable = isAliyunRateLimitError(error);
      const waitingForLocalCapacity = isProviderCapacityError(error);
      await prisma.videoKeyframe.update({
        where: { id: nextKeyframe.id },
        data: {
          status: retryable ? VideoShotStatus.IMAGE_PENDING : VideoShotStatus.FAILED,
          errorMessage: retryable
            ? waitingForLocalCapacity
              ? "正在等待本地图片生成容量槽位，系统将自动退避重试"
              : "阿里云图片接口触发限流，系统将自动退避重试"
            : error instanceof Error
              ? error.message
              : "Image submit failed",
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
      throw error;
    }
  }
}

async function submitNextClipTask(params: {
  userId?: string;
  projectId: string;
  segments: VideoProjectRecord["segments"];
  keyframes: VideoProjectRecord["keyframes"];
  logEventPrefix: string;
  targetId: string;
}): Promise<void> {
  const concurrency = clipTaskConcurrency();
  const availableSlots = 1;

  const keyframeMap = new Map(params.keyframes.map((keyframe) => [keyframe.keyframeNo, keyframe]));
  const nextSegments = [...params.segments]
    .sort((a, b) => a.segmentNo - b.segmentNo)
    .filter((segment) => {
      if (params.targetId && segment.id !== params.targetId) return false;
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
      runningCount: 0,
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
    runningCount: 0,
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
      const deferredVideoQualityChecks = deferredVideoQualityChecksForSegment(
        project,
        nextSegment,
        startKeyframe,
        endKeyframe,
      );
      const taskId = await createVideoCandidateBatch({
        project,
        segment: nextSegment,
        prompt: compiled.prompt,
        startFrameUrl: startKeyframe.imageUrl,
        endFrameUrl: endKeyframe.imageUrl,
        imageInputs: compiled.resolvedVideoImages?.transported
          ?? buildSegmentVideoImageInputs(project, nextSegment, startKeyframe, endKeyframe),
        resolvedVideoImages: compiled.resolvedVideoImages,
        metadata: {
          targetContract: renderDescription,
          motionCheckpoints: readEffectivePlanMicroShots(project.planJson, nextSegment.segmentNo),
          deferredVideoQualityChecks,
          selectedReferenceUrls: selectedReferenceUrlsForPromptTarget(project.planJson, `segment:${nextSegment.segmentNo}`),
          referenceUsageNotes: [],
        },
      });
      await prisma.videoSegment.update({
        where: { id: nextSegment.id },
        data: {
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
      throw error;
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
  return isProviderCapacityError(error)
    || isVideoProviderCapacityError(error)
    || (error instanceof Error && /Throttling|RateQuota|rate limit|Requests rate limit exceeded/i.test(error.message));
}

async function requireVideoProject(userId: string, projectId: string): Promise<VideoProjectRecord> {
  const project = await getVideoProject(userId, projectId);
  if (!project) throw new Error("Video project not found");
  return project;
}

function readStylePresetFromPlan(planJson: Prisma.JsonValue | null): string {
  return readPlanShotString(planRecord(planJson), ["stylePreset", "style_preset"]);
}

function generationPromptForKeyframe(
  project: Pick<VideoProjectRecord, "planJson" | "keyframes">,
  keyframe: VideoProjectRecord["keyframes"][number],
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
    visibleRequiredAnchorIds(project.planJson, planKeyframe),
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
  project: Pick<VideoProjectRecord, "planJson">,
  keyframe: VideoProjectRecord["keyframes"][number],
): string {
  const planKeyframe = readPlanKeyframeMap(project.planJson).get(keyframe.keyframeNo) ??
    readPlanConsistencyReferenceMap(project.planJson).get(keyframe.keyframeNo);
  return bilingualNegativePromptForGeneration(planKeyframe, keyframe.negativePrompt);
}

function generationNegativePromptForSegment(
  project: Pick<VideoProjectRecord, "planJson">,
  segment: VideoProjectRecord["segments"][number],
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
    ...visibleRequiredAnchorIds(planJson, planSegment),
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

function narrativeContextLinesForImage(
  context: NarrativePromptContext,
  hasCanonicalBoundaryContract: boolean,
): string[] {
  if (!context.storyMoment && !context.linkedBeatIds.length) return [];
  const visibleEvidence = [
    context.requiredVisibleEvidence.length ? "requiredVisibleEvidence: " + context.requiredVisibleEvidence.join(", ") : "",
    context.forbiddenEvidence.length ? "forbiddenEvidence: " + context.forbiddenEvidence.join(", ") : "",
  ].filter(Boolean);
  if (visibleEvidence.length || hasCanonicalBoundaryContract) return visibleEvidence;
  return context.storyMoment ? ["storyMoment: " + context.storyMoment] : [];
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
  project: Pick<VideoProjectRecord, "planJson" | "keyframes">,
  segment: VideoProjectRecord["segments"][number],
  startKeyframe: VideoProjectRecord["keyframes"][number],
  endKeyframe: VideoProjectRecord["keyframes"][number],
): CompiledPrompt {
  if (!hasResolvedMicroShotPlan(project.planJson, segment.segmentNo)) {
    throw new Error(
      `Segment ${segment.segmentNo} has no authoritative media-conditioned micro-shot plan.`,
    );
  }
  const planSegment = readPlanSegmentMap(project.planJson).get(segment.segmentNo);
  const renderDescription = readPlanSegmentRenderDescriptionMap(project.planJson).get(segment.segmentNo);
  const motionContract = readLooseRecord(renderDescription ?? {}, ["motionContract", "motion_contract"]);
  const singleTakeContract = readLooseRecord(renderDescription ?? {}, ["singleTakeContract", "single_take_contract"]);
  const startFrameContract = readLooseRecord(renderDescription ?? {}, ["startFrameContract", "start_frame_contract"]);
  const endFrameContract = readLooseRecord(renderDescription ?? {}, ["endFrameContract", "end_frame_contract"]);
  const planRoot = planRecord(project.planJson);
  const mediaConditionedPlan = (Array.isArray(planRoot.mediaConditionedSegmentPlans)
    ? planRoot.mediaConditionedSegmentPlans
    : [])
    .filter(isRecord)
    .find((item) => Number(item.segmentNo ?? item.segment_no) === segment.segmentNo);
  const observedBoundaryFacts = (Array.isArray(planRoot.observedBoundaryFacts)
    ? planRoot.observedBoundaryFacts
    : [])
    .filter(isRecord)
    .filter((item) =>
      Number(item.keyframeNo ?? item.keyframe_no) === startKeyframe.keyframeNo
      || Number(item.keyframeNo ?? item.keyframe_no) === endKeyframe.keyframeNo
    );
  const requestedVideoImageInputs = buildSegmentVideoImageInputs(
    project,
    segment,
    startKeyframe,
    endKeyframe,
  );
  const checkpointRecords = readLooseArray(renderDescription ?? {}, ["motionCheckpoints", "motion_checkpoints"])
    .filter(hasMeaningfulMotionCheckpoint);
  const microShots = readEffectivePlanMicroShots(project.planJson, segment.segmentNo);
  const visibleAnchorIds = readPlanStringArray(renderDescription, ["visibleAnchorIds", "visible_anchor_ids"]);
  const segmentAnchorIds = visibleAnchorIds.length
    ? visibleAnchorIds
    : effectiveRequiredAnchorIds(planSegment);
  const anchorLock = consistencyAnchorLocksForPrompt(project.planJson, segmentAnchorIds);
  const cameraInheritance = resolveCameraInheritanceContext(planRecord(project.planJson), segment.segmentNo);
  const deferredVideoQualityChecks = deferredVideoQualityChecksForSegment(
    project,
    segment,
    startKeyframe,
    endKeyframe,
  );
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
  const endFrameRequirementLevel = resolveEndFrameRequirementLevel(renderDescription);
  const modelPromptContract = requireCanonicalVideoPromptContract(project, segment);
  const retryCorrections = previousQualityReport?.passed === false
    && (previousQualityReport.retryFromStage === "generation"
      || previousQualityReport.retryFromStage === "stage3"
      || previousQualityReport.endFrameDecision === "retry_generation")
    ? previousQualityReport.correctionActions?.length
      ? previousQualityReport.correctionActions.map((action) => [
          `${action.element}: ${action.instruction}`,
          `Target: ${action.target}`,
          action.preserve?.length ? `Preserve: ${action.preserve.join(", ")}` : "",
        ].filter(Boolean).join(" "))
      : previousQualityReport.retryInstruction
        ? [previousQualityReport.retryInstruction]
        : []
    : [];
  const imageToVideoHandoffRequirements = deferredVideoQualityChecks.map((check) =>
    `IMAGE-TO-VIDEO HANDOFF [${check.sourceIssueId}]: ${check.requiredVideoCheck}`
  );
  const providerImageCapabilities = aliyunVideoImageInputCapabilities();
  const resolvedVideoImages = resolveVideoImageInputs({
    inputs: requestedVideoImageInputs,
    capabilities: providerImageCapabilities,
    endFrameRequirementLevel,
  });
  const compiledStartState = auditedVideoText(
    compactJsonLine("contract", startFrameContract)
    || startVisualBlueprint
    || (startKeyframe.purpose + ". " + startKeyframe.scene),
  );
  const videoPromptContract = modelPromptContract;
  const compiledVideoPrompt = compileAliyunVideoPrompt({
    durationSeconds: segment.durationSeconds,
    requirementLevel: endFrameRequirementLevel,
    modelId: providerImageCapabilities.modelId,
    audioPlan: readPlanAudioPlan(planSegment),
    startState: compiledStartState,
    contract: videoPromptContract,
    retryCorrections: uniqueStrings([...retryCorrections, ...imageToVideoHandoffRequirements]),
    firstFrameIsNativeInput: resolvedVideoImages.nativeFirstFrame,
    lastFrameIsNativeInput: resolvedVideoImages.nativeLastFrame,
  });
  const naturalReferencePromptEnabled =
    process.env.ONE_PROMPT_VIDEO_NATURAL_REFERENCE_PROMPT?.trim().toLowerCase() !== "false";
  const naturalReferencePromptCandidate = naturalReferencePromptEnabled
    && providerImageCapabilities.promptReferenceMode === "ordered_subject_action"
    && providerImageCapabilities.promptCanAddressInputOrder
    ? compileOrderedSubjectActionPrompt({
        contract: videoPromptContract,
        resolvedImages: resolvedVideoImages,
        startState: compiledStartState,
      })
    : "";
  const naturalReferencePromptFits = !providerImageCapabilities.maxPromptCharacters
    || !naturalReferencePromptCandidate
    || naturalReferencePromptCandidate.length + compiledVideoPrompt.prompt.length + 2
      <= providerImageCapabilities.maxPromptCharacters;
  // The natural presentation layer is an enhancement. If the complete,
  // validated system contract leaves insufficient room, keep the contract
  // intact and fall back instead of truncating either layer.
  const naturalReferencePrompt = naturalReferencePromptFits
    ? naturalReferencePromptCandidate
    : "";
  const finalPrompt = [naturalReferencePrompt, compiledVideoPrompt.prompt]
    .filter(Boolean)
    .join("\n\n");
  if (
    providerImageCapabilities.maxPromptCharacters
    && finalPrompt.length > providerImageCapabilities.maxPromptCharacters
  ) {
    throw new Error(
      `Compiled video prompt is ${finalPrompt.length} characters, exceeding `
      + `${providerImageCapabilities.modelId}'s declared limit of `
      + `${providerImageCapabilities.maxPromptCharacters}. Hard system constraints were not truncated.`,
    );
  }
  const negativePrompt = compileVideoNegativePrompt(generationNegativePromptForSegment(project, segment));
  return {
    prompt: finalPrompt,
    negativePrompt,
    referenceImageUrls: resolvedVideoImages.transported.map((input) => input.url),
    resolvedVideoImages,
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
        endFrameRequirementLevel,
        videoPromptContractSource: mediaConditionedPlan
          ? "post_keyframe_media_conditioned_planner"
          : "pre_image_provisional_planner",
        videoPromptContract,
        observedBoundaryFacts,
        mediaConditionedPlan,
        requestedVideoImageInputs,
        transportedVideoImageInputs: resolvedVideoImages.transported,
        evaluationOnlyVideoImageInputs: resolvedVideoImages.evaluationOnly,
        rejectedVideoImageInputs: resolvedVideoImages.rejected,
        internalVideoReferenceMap: resolvedVideoImages.internalReferenceMap,
        videoReferenceCoverage: resolvedVideoImages.coverage,
        naturalReferencePrompt,
        naturalReferencePromptSkippedForBudget:
          Boolean(naturalReferencePromptCandidate) && !naturalReferencePromptFits,
        deferredVideoQualityChecks,
        providerImageCapabilities,
      },
      selectedReferenceUrls: resolvedVideoImages.transported.map((input) => input.url),
      referenceUsageNotes: resolvedVideoImages.transported.map((input, index) =>
        `[Image ${index + 1}] ${input.role}: ${input.instruction} Selection=${input.selectionReason ?? "selected"}.`
      ),
      beforePrompt,
      finalPrompt,
      finalNegativePrompt: negativePrompt,
      rules: [
        providerImageCapabilities.promptReferenceMode === "ordered_subject_action"
          ? "ordered_subject_action_prompt"
          : "plain_action_prompt",
        "internal_reference_map_not_sent_by_default",
        "end_frame_mandatory_prompt_contract",
        "end_frame_visual_continuity_check",
        "no_segment_boundary_mode_terms",
        "checkpoints_as_motion_states",
        "narrative_contract_injected",
        "model_must_not_invent_story",
        "no_visual_subtitles",
        `provider_audio_${resolveVideoAudioStrategy(readPlanAudioPlan(planSegment))}`,
        "camera_graph_inheritance_enforced",
        "deferred_image_issues_handed_to_video_generation_and_quality",
        mediaConditionedPlan ? "actual_boundary_images_observed_before_motion_planning" : "canonical_provisional_motion_contract",
      ],
      warnings: compiledVideoPrompt.warnings,
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

function requireCanonicalVideoPromptContract(
  project: Pick<VideoProjectRecord, "planJson">,
  segment: Pick<VideoProjectRecord["segments"][number], "id" | "segmentNo">,
) {
  const renderDescription = readPlanSegmentRenderDescriptionMap(project.planJson).get(segment.segmentNo);
  const contract = videoPromptContractFromUnknown(renderDescription);
  if (contract) return contract;
  throw new ExecutionContractMissingError(
    `Segment ${segment.segmentNo} is missing its canonical videoPromptContract. Migrate or re-plan this project before generation.`,
    {
      targetId: segment.id,
      artifactId: videoArtifactIdForSegmentNo(segment.segmentNo),
    },
  );
}

function normalizedPromptFact(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function promptAlreadyContainsFact(prompt: string, fact: string): boolean {
  const normalizedFact = normalizedPromptFact(fact);
  return normalizedFact.length >= 8 && normalizedPromptFact(prompt).includes(normalizedFact);
}

function imageBoundaryExecutionContract(
  contract: VideoBoundaryContract,
  sourceImagePrompt: string,
): Record<string, unknown> | undefined {
  const uncovered = (value: string | undefined): string | undefined =>
    value && !promptAlreadyContainsFact(sourceImagePrompt, value) ? value : undefined;
  const forbiddenStoryStates = contract.forbiddenStoryStates.filter((value) =>
    !promptAlreadyContainsFact(sourceImagePrompt, value)
  );
  const compact = {
    storyState: uncovered(contract.storyState),
    scene: uncovered(contract.scene),
    cameraId: uncovered(contract.cameraId),
    characterState: uncovered(contract.characterState),
    productState: uncovered(contract.productState),
    compositionIntent: uncovered(contract.compositionIntent),
    forbiddenStoryStates: forbiddenStoryStates.length ? forbiddenStoryStates : undefined,
  };
  return Object.values(compact).some(Boolean) ? compact : undefined;
}

function compileImagePromptForKeyframe(
  project: Pick<VideoProjectRecord, "planJson" | "keyframes">,
  keyframe: VideoProjectRecord["keyframes"][number],
  referenceSelection?: ReferenceSelectionOutput,
): CompiledPrompt {
  const planKeyframe = readPlanKeyframeMap(project.planJson).get(keyframe.keyframeNo) ??
    readPlanConsistencyReferenceMap(project.planJson).get(keyframe.keyframeNo);
  const isConsistencyReference = isConsistencyKeyframeNo(keyframe.keyframeNo);
  const canonicalBoundaryContract = isConsistencyReference
    ? undefined
    : canonicalBoundaryContractMap(project.planJson).get(keyframe.keyframeNo);
  const stylePreset = readStylePresetFromPlan(project.planJson);
  const dependencyScope = resolveImageTargetDependencyScope(project.planJson, planKeyframe, keyframe.keyframeNo);
  const targetArtifactId = dependencyScope.targetArtifactId;
  const visibleAnchorIds = dependencyScope.requiredAnchorIds;
  const assetCategory = dependencyScope.assetCategory;
  const assetView = dependencyScope.assetView;
  const consistencyKind = isConsistencyReference
    ? consistencyReferenceKindForPlan(planKeyframe, keyframe.keyframeNo)
    : undefined;
  const brandVisualAsset = isBrandVisualAssetKeyframe(isConsistencyReference, assetCategory, consistencyKind);
  // The database field is the latest user-edited value. Localized plan fields may
  // still contain the model's original translation, so they must only be fallbacks.
  const rawSourceImagePrompt = sanitizeGameVisualPromptText(stripNonStandardPromptSymbols(keyframe.imagePrompt), stylePreset, { brandVisual: brandVisualAsset });
  const isPersonAsset = isConsistencyReference && (assetCategory === "person" || consistencyKind === "character");
  const personAnchor = isPersonAsset
    ? personAnchorForPrompt(project.planJson, dependencyScope.targetAnchorId)
    : undefined;
  const anchorLock = isPersonAsset
    ? compilePersonIdentityLock(personAnchor)
    : consistencyAnchorLocksForPrompt(project.planJson, visibleAnchorIds);
  const targetContract = scopedImageTargetContract(project.planJson, planKeyframe, keyframe, dependencyScope);
  const visualContract = buildAuthoritativeVisualContract({
    targetContract,
    anchorContractText: anchorLock,
    prompt: rawSourceImagePrompt,
    negativePrompt: generationNegativePromptForKeyframe(project, keyframe),
    mediaStage: "static_image",
    hasApprovedReferences: Boolean(referenceSelection?.selectedReferenceUrls?.length),
  });
  const repairedSourceImagePrompt = repairPromptAgainstVisualContract(rawSourceImagePrompt, visualContract);
  const renderingStyle = isRecord(targetContract.renderingStyle)
    ? targetContract.renderingStyle
    : undefined;
  const personCharacterState = isPersonAsset
    ? compactPersonCharacterState(
        readPlanShotString(targetContract, ["characterState", "character_state"]),
        assetView,
      )
    : "";
  const sourceImagePrompt = isPersonAsset
    ? compilePersonCompositionPrompt(
        personAnchor?.assetImageContract,
        repairedSourceImagePrompt,
        personCharacterState,
      )
    : repairedSourceImagePrompt;
  const fallbackFrameFacts = sourceImagePrompt ? [] : [
    keyframe.purpose ? "purpose: " + keyframe.purpose : "",
    readPlanShotString(targetContract, ["scene"]) ? "scene: " + readPlanShotString(targetContract, ["scene"]) : "",
    readPlanShotString(targetContract, ["characterState"]) ? "character_state: " + readPlanShotString(targetContract, ["characterState"]) : "",
    readPlanShotString(targetContract, ["productState"]) ? "product_state: " + readPlanShotString(targetContract, ["productState"]) : "",
    compactJsonLine("frame_design", planKeyframe?.frameDesign ?? planKeyframe?.frame_design),
  ];
  const frameContract = [
    "target: " + targetArtifactId,
    assetCategory ? "asset_category: " + assetCategory : "",
    assetView ? "asset_view: " + assetView : "",
    dependencyScope.isolatedAsset ? "output_scope: isolated_asset" : "",
    personCharacterState ? "character_state: " + personCharacterState : "",
    sourceImagePrompt ? "source_image_prompt: " + clipText(sourceImagePrompt, 1000) : "",
    ...fallbackFrameFacts,
    visibleAnchorIds.length ? "visible_anchors: " + visibleAnchorIds.join(", ") : "",
    dependencyScope.forbiddenAnchorIds.length ? "forbidden_anchors: " + dependencyScope.forbiddenAnchorIds.join(", ") : "",
  ].filter(Boolean);
  const cameraInheritance = isConsistencyReference
    ? undefined
    : resolveCameraInheritanceContext(planRecord(project.planJson), segmentNoForBoundaryKeyframe(project.planJson, keyframe.keyframeNo));
  const referenceNotes = referenceSelection?.usageNotes ?? [];
  const beforePrompt = generationPromptForKeyframe(project, keyframe);
  const narrativeContext = isConsistencyReference ? emptyNarrativePromptContext() : narrativePromptContextForKeyframe(project.planJson, keyframe.keyframeNo);
  const narrativeContextLines = narrativeContextLinesForImage(narrativeContext, Boolean(canonicalBoundaryContract));
  const boundaryExecutionContract = canonicalBoundaryContract
    ? imageBoundaryExecutionContract(canonicalBoundaryContract, sourceImagePrompt)
    : undefined;
  const requiresNumericGameUi = !isConsistencyReference
    && /\b(?:timer|score|hud|countdown)\b|计时|比分|分数|倒计时/i.test(sourceImagePrompt);
  const finalPrompt = [
    "IMAGE PROMPT COMPILED FROM STRUCTURED CONTRACT",
    isConsistencyReference
      ? "Create one reusable still consistency reference image."
      : "Create one still boundary keyframe image.",
    "Frame contract:",
    ...frameContract.map((line) => "- " + line),
    boundaryExecutionContract ? "Boundary facts not already covered above:\n" + clipText(JSON.stringify(boundaryExecutionContract), 650) : "",
    narrativeContextLines.length ? "Narrative boundary contract (must be visible in this still image):" : "",
    ...narrativeContextLines.map((line) => "- " + clipText(line, 420)),
    anchorLock
      ? isPersonAsset
        ? "Identity lock (sole textual identity source): " + clipText(anchorLock, 700)
        : "Visible anchor locks:\n" + clipText(anchorLock, 700)
      : "",
    // visualContract remains canonical structured metadata for validation and
    // quality review. Serializing it here repeated target/source/anchor facts
    // already present above and was the main cause of 8k-10k provider prompts.
    cameraInheritance?.inheritanceDirectives.length ? "Camera Graph inheritance contract:\n" + cameraInheritance.inheritanceDirectives.slice(0, 3).map((item) => "- " + clipText(item, 280)).join("\n") : "",
    // Reference role notes are serialized exactly once by
    // buildAliyunReferenceImageMap, adjacent to their uploaded images.
    "Execution rules:",
    isPersonAsset
      ? "- For person assets, character_state is authoritative for view, framing, pose, expression, and action; source_image_prompt owns camera, placement, background, and lighting."
      : "- The source_image_prompt is authoritative for subject count, pose, framing, and background; other sections only add facts absent from it.",
    "- Output exactly one clean still in the requested view.",
    isPersonAsset
      ? "- Isolation: exactly one character; plain white or light-neutral background; no text, logo, UI, scenery, or other characters."
      : dependencyScope.isolatedAsset
        ? "- Render only the target named by this isolated-asset contract."
        : "",
    brandVisualAsset ? "- Render locked brand/UI text exactly as written." : "",
    requiresNumericGameUi ? "- Render timer and score values as legible Arabic numerals." : "",
  ].filter(Boolean).join("\n");
  const negativePrompt = repairNegativePromptAgainstVisualContract(compileImageNegativePrompt([
    generationNegativePromptForKeyframe(project, keyframe),
    isPersonAsset
      ? [
          "background scenery, decorative background, poster composition, advertisement layout, title, typography, letters, logo, product card, UI, confetti, balloons, flags, fireworks, border, frame, duplicate person, multiple people, cropped duplicate",
          ...readPlanStringArray(renderingStyle, ["forbiddenDrift", "forbidden_drift"]),
        ].join(", ")
      : "",
  ].filter(Boolean).join(", "), {
    brandVisual: brandVisualAsset,
    assetCategory,
    consistencyReference: isConsistencyReference,
  }), visualContract);
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
        targetContract,
        canonicalBoundaryContract,
        boundaryExecutionContract,
        dependencyScope,
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
        ...(dependencyScope.isolatedAsset ? ["target_scoped_asset_dependency_isolation", "forbidden_global_anchors"] : []),
        "narrative_boundary_contract_injected",
        "camera_graph_inheritance_enforced",
      ],
      warnings: uniqueStrings([...(referenceSelection?.warnings ?? []), ...visualContract.warnings]),
      createdAt: new Date().toISOString(),
    },
  };
}

function compileImagePromptForMicroShot(
  project: Pick<VideoProjectRecord, "planJson">,
  segment: VideoProjectRecord["segments"][number],
  microShot: VideoMicroShot,
  referenceSelection?: ReferenceSelectionOutput,
): CompiledPrompt {
  const targetArtifactId = "segment:" + segment.segmentNo + ":micro_shot:" + microShot.microShotNo;
  const visibleAnchorIds = microShot.usesConsistencyAnchors ?? [];
  const rawSourceImagePrompt = microShot.imagePrompt ?? "";
  const anchorLock = consistencyAnchorLocksForPrompt(project.planJson, visibleAnchorIds);
  const targetContract = microShot as unknown as Record<string, unknown>;
  const baseNegativePrompt = generationNegativePromptForSegment(project, segment);
  const visualContract = buildAuthoritativeVisualContract({
    targetContract,
    anchorContractText: anchorLock,
    prompt: rawSourceImagePrompt,
    negativePrompt: baseNegativePrompt,
    mediaStage: "static_image",
    hasApprovedReferences: Boolean(referenceSelection?.selectedReferenceUrls?.length),
  });
  const sourceImagePrompt = repairPromptAgainstVisualContract(rawSourceImagePrompt, visualContract);
  const frameContract = [
    "target: " + targetArtifactId,
    "segment: " + segment.segmentNo,
    "local_time_seconds: " + microShot.localTimeSeconds,
    "purpose: " + (microShot.purpose || microShot.purposeZh || microShot.purposeEn),
    "scene_state: " + (microShot.scene || microShot.sceneZh || microShot.sceneEn),
    "action_state: " + (microShot.action || microShot.actionZh || microShot.actionEn),
    "camera_state: " + (microShot.camera || microShot.cameraZh || microShot.cameraEn || segment.camera),
    sourceImagePrompt ? "source_image_prompt: " + clipText(sourceImagePrompt, 1000) : "",
    visibleAnchorIds.length ? "visible_anchors: " + visibleAnchorIds.join(", ") : "",
  ].filter(Boolean);
  const cameraInheritance = resolveCameraInheritanceContext(planRecord(project.planJson), segment.segmentNo);
  const referenceNotes = referenceSelection?.usageNotes ?? [];
  const beforePrompt = generationPromptForMicroShot(project, segment, microShot);
  const finalPrompt = [
    "IMAGE PROMPT COMPILED FROM STRUCTURED CONTRACT",
    "Create one static internal motion-checkpoint reference image inside the same segment.",
    "Frame contract:",
    ...frameContract.map((line) => "- " + line),
    anchorLock ? "Visible anchor locks:\n" + clipText(anchorLock, 700) : "",
    cameraInheritance.inheritanceDirectives.length ? "Camera Graph inheritance contract:\n" + cameraInheritance.inheritanceDirectives.slice(0, 3).map((item) => "- " + clipText(item, 280)).join("\n") : "",
    "Execution rules:",
    "- Treat the listed frame, anchor, and camera fields as the complete authority.",
    "- Output exactly one clean still.",
  ].filter(Boolean).join("\n");
  const negativePrompt = repairNegativePromptAgainstVisualContract(
    compileImageNegativePrompt(baseNegativePrompt),
    visualContract,
  );
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
        targetContract,
        visualContract,
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

function compileImageNegativePrompt(
  baseNegativePrompt: string,
  options?: {
    brandVisual?: boolean;
    assetCategory?: string;
    consistencyReference?: boolean;
  },
): string {
  const scopedBaseNegativePrompt = scopeNegativePromptForAsset(
    baseNegativePrompt,
    options?.consistencyReference ? options.assetCategory : undefined,
  );
  if (options?.brandVisual) {
    return [
      scopedBaseNegativePrompt,
      "characters, people, animals, scenery, decorative background, poster layout, extra logos, misspelled brand text, gibberish letters, random captions, watermarks, split screen, collage, decorative effects, non-standard symbols",
    ].filter(Boolean).join(", ");
  }
  if (options?.consistencyReference && options.assetCategory === "scene") {
    return [
      scopedBaseNegativePrompt,
      "foreground subjects, text, logos, subtitles, captions, UI, collage, split screen, watermark, duplicated structures, malformed scene geometry",
    ].filter(Boolean).join(", ");
  }
  if (options?.consistencyReference && options.assetCategory === "person") {
    return [
      scopedBaseNegativePrompt,
      "scenery, decorative background, poster layout, text, logos, UI, duplicate person, multiple people, cropped duplicate, distorted hands, distorted face, identity drift, clothing drift, watermark, split screen, collage",
    ].filter(Boolean).join(", ");
  }
  if (options?.consistencyReference && (options.assetCategory === "product" || options.assetCategory === "prop")) {
    return [
      scopedBaseNegativePrompt,
      "people, characters, scenery, unrelated props, duplicated product, duplicate object, altered intrinsic markings, distorted geometry, random text, subtitles, captions, UI, watermark, split screen, collage",
    ].filter(Boolean).join(", ");
  }
  return [
    scopedBaseNegativePrompt,
    "subtitles, captions, UI overlays, watermarks, timecodes, random letters, misspelled text, storyboard panels, split screen, before-after comparison, duplicated product, identity drift, distorted hands, distorted face, malformed logo, corrupted text, gibberish glyphs, broken timer display, illegible score display, decorative pseudo-text, non-standard symbols",
  ].filter(Boolean).join(", ");
}

function scopeNegativePromptForAsset(baseNegativePrompt: string, assetCategory?: string): string {
  const clauses = baseNegativePrompt
    .split(/[,;\n]+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  if (!assetCategory) return clauses.join(", ");
  const irrelevantPattern = assetCategory === "scene"
    ? /\b(?:persons?|people|characters?|products?|cards?|finger|hand|face|facial|body|anatomy|clothing|outfit|identity drift|product morph|timer|score)\b/i
    : assetCategory === "person"
      ? /\b(?:product morph|duplicated product|timer|score|malformed logo|scene replacement)\b/i
      : assetCategory === "product" || assetCategory === "prop" || assetCategory === "brand_visual"
        ? /\b(?:finger|hand|face|facial|body|anatomy|clothing|outfit|identity drift|timer|score|scene replacement)\b/i
        : undefined;
  return clauses.filter((clause) => !irrelevantPattern?.test(clause)).join(", ");
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

function isApprovedConsistencyReference(keyframe: Pick<VideoProjectRecord["keyframes"][number], "imageUrl" | "locked" | "status">): boolean {
  return Boolean(keyframe.imageUrl) && (keyframe.locked || keyframe.status === VideoShotStatus.IMAGE_APPROVED);
}

function assetGenerationPriority(planJson: Prisma.JsonValue | null, keyframeNo: number): number {
  if (!isConsistencyKeyframeNo(keyframeNo)) return 2;
  const reference = readPlanConsistencyReferenceMap(planJson).get(keyframeNo);
  const assetView = readPlanShotString(reference, ["assetView", "asset_view"]);
  if (assetView === "back") return 2;
  if (assetView === "side") return 1;
  return 0;
}

function isCharacterTurnaroundProject(planJson: Prisma.JsonValue | null): boolean {
  return readPlanShotString(planRecord(planJson), ["workflowKind", "workflow_kind"]) === "character_turnaround";
}

export function requiredApprovedAssetViewsForTarget(assetView: string | undefined): Array<"front" | "side"> {
  if (assetView === "side") return ["front"];
  if (assetView === "back") return ["front", "side"];
  return [];
}

function isAssetViewGenerationReady(
  project: Pick<VideoProjectRecord, "planJson" | "keyframes">,
  keyframeNo: number,
): boolean {
  if (!isConsistencyKeyframeNo(keyframeNo)) return true;
  const referenceMap = readPlanConsistencyReferenceMap(project.planJson);
  const reference = referenceMap.get(keyframeNo);
  const assetView = readPlanShotString(reference, ["assetView", "asset_view"]);
  const requiredViews = requiredApprovedAssetViewsForTarget(assetView);
  if (!requiredViews.length) return true;
  const anchorId = anchorIdForConsistencyReference(reference);
  return requiredViews.every((requiredView) => {
    const entry = [...referenceMap.entries()].find(([, candidate]) =>
      anchorIdForConsistencyReference(candidate) === anchorId
      && readPlanShotString(candidate, ["assetView", "asset_view"]) === requiredView
    );
    if (!entry) return false;
    const keyframe = project.keyframes.find((candidate) => candidate.keyframeNo === entry[0]);
    return Boolean(keyframe && isApprovedConsistencyReference(keyframe));
  });
}

function consistencyReferenceImageUrls(
  project: Pick<VideoProjectRecord, "keyframes">,
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
  project: Pick<VideoProjectRecord, "planJson" | "keyframes" | "referenceImageUrls" | "generationCandidates">,
  keyframe: VideoProjectRecord["keyframes"][number],
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
    readPlanShotString(planKeyframe, ["imagePrompt", "image_prompt"]),
  );
  const dependencyScope = resolveImageTargetDependencyScope(project.planJson, planKeyframe, keyframe.keyframeNo);
  const targetAnchorId = dependencyScope.targetAnchorId ?? anchorIdForConsistencyReference(planKeyframe);
  const requiredAnchorIds = dependencyScope.requiredAnchorIds;
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
    const targetConsistencyKind = consistencyReferenceKindForPlan(planKeyframe, keyframe.keyframeNo);
    const targetIsPersonAsset =
      dependencyScope.assetCategory === "person"
      || targetConsistencyKind === "character";
    const requiredSourceViews = requiredApprovedAssetViewsForTarget(targetView);
    const closestSourceView = requiredSourceViews.at(-1);
    candidates = candidates.filter((candidate) =>
      candidate.sourceType === "user_upload" ||
      candidate.sourceType === "style_brand" ||
      (requiredSourceViews.length > 0
        && candidate.sourceType === "hard_anchor"
        && candidate.anchorId === targetAnchorId
        && requiredSourceViews.includes(candidate.assetView as "front" | "side"))
    ).map((candidate) => {
      if (candidate.sourceType === "hard_anchor") {
        const isClosestSource = candidate.assetView === closestSourceView;
        return {
          ...candidate,
          hardRequired: isClosestSource,
          relevanceScore: isClosestSource ? 1 : Math.max(candidate.relevanceScore, 0.82),
          conflictScore: isClosestSource ? 0 : candidate.conflictScore,
          viewMatchScore: isClosestSource ? 0.98 : candidate.viewMatchScore,
          usageNote: isClosestSource
            ? `Required approved ${closestSourceView} view for ${targetView} view derivation.`
            : candidate.usageNote,
        };
      }
      if (candidate.sourceType !== "user_upload") return candidate;
      if (targetIsPersonAsset) {
        return {
          ...candidate,
          quotaType: "style_brand" as const,
          anchorId: targetAnchorId || candidate.anchorId,
          hardRequired: true,
          relevanceScore: 1,
          conflictScore: 0,
          viewMatchScore: Math.max(candidate.viewMatchScore, 0.85),
          usageNote: compactPersonReferenceUsageNote(targetAnchorId || targetArtifactId),
        };
      }
      return {
        ...candidate,
        quotaType: "style_brand" as const,
        relevanceScore: Math.min(candidate.relevanceScore, 0.55),
        conflictScore: Math.max(candidate.conflictScore, 0.35),
        usageNote: `STYLE-ONLY reference for isolated asset ${targetAnchorId || targetArtifactId}. Inherit rendering medium, palette, and line treatment only. Do not copy unrelated subjects, scenery, props, text, logo, or UI.`,
      };
    });
    const missingSourceView = requiredSourceViews.find((requiredView) =>
      !candidates.some((candidate) => candidate.sourceType === "hard_anchor" && candidate.assetView === requiredView)
    );
    if (missingSourceView) {
      throw new Error(`Person ${targetView || "derived"} view requires an approved ${missingSourceView} reference before generation`);
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
    if (targetView === "back") {
      const approvedFront = result.output.candidates.find((candidate) =>
        candidate.sourceType === "hard_anchor"
        && candidate.anchorId === targetAnchorId
        && candidate.assetView === "front"
      );
      if (approvedFront?.url && !result.output.selectedArtifactIds.includes(approvedFront.artifactId)) {
        result.urls = uniqueStrings([...result.urls, approvedFront.url]);
        result.output.selectedArtifactIds = uniqueStrings([...result.output.selectedArtifactIds, approvedFront.artifactId]);
        result.output.selectedReferenceUrls = result.urls;
        result.output.usageNotes = uniqueStrings([
          ...(result.output.usageNotes ?? []),
          "Approved front view retained as direct identity evidence for back-view generation.",
        ]);
        result.output.candidates = result.output.candidates.map((candidate) =>
          candidate.artifactId === approvedFront.artifactId
            ? { ...candidate, selected: true, rejectionReason: undefined }
            : candidate
        );
      }
    }
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
  project: Pick<VideoProjectRecord, "planJson" | "keyframes" | "referenceImageUrls" | "generationCandidates">;
  targetKeyframeNo?: number;
  segment?: VideoProjectRecord["segments"][number];
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
      if (!isEligibleConsistencyKeyframe(params.project.planJson, keyframe.keyframeNo)) continue;
      if (!isApprovedConsistencyReference(keyframe)) continue;
      const reference = referenceMap.get(keyframe.keyframeNo);
      const anchorId = anchorIdForConsistencyReference(reference);
      const anchorRecord = anchorId ? readPlanConsistencyAnchorMap(params.project.planJson).get(anchorId) : undefined;
      const anchorPolicy = anchorRecord
        ? anchorReferenceUsagePolicy(anchorRecord as unknown as VideoConsistencyAnchor)
        : undefined;
      const kind = consistencyReferenceKindForPlan(reference, keyframe.keyframeNo);
      const required = Boolean(anchorId && requiredAnchorIds.has(anchorId));
      const styleOnly = anchorPolicy?.role === "style_only" || anchorPolicy?.role === "graphic_backdrop";
      const hardRequired = !styleOnly && required && params.hardAnchorIds.has(anchorId);
      const sourceType: ReferenceSourceType = kind === "brand_visual" || styleOnly ? "style_brand" : "hard_anchor";
      const quotaType = styleOnly ? "style_brand" : quotaTypeForReferenceKind(kind);
      const assetView = readPlanShotString(reference, ["assetView", "asset_view"]) as VideoAssetView | "";
      const scopedUsageNote = anchorPolicy
        ? `Reference role=${anchorPolicy.role}. Inherit only: ${anchorPolicy.inherit.join(", ")}. Never inherit: ${anchorPolicy.forbidInherit.join(", ")}.`
        : "";
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
        usageNote: scopedUsageNote || (hardRequired
          ? `Required hard anchor ${anchorId || keyframe.keyframeNo}${assetView ? `, ${assetView} view` : ""}.`
          : `Available ${kind} anchor${assetView ? `, ${assetView} view` : ""}.`),
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
  project: Pick<VideoProjectRecord, "planJson" | "keyframes">,
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
  const dependencyScope = compiled.debugArtifact.inputs.dependencyScope;
  if (isRecord(dependencyScope) && dependencyScope.isolatedAsset === true) {
    const targetAnchorId = readPlanShotString(dependencyScope, ["targetAnchorId", "target_anchor_id"]);
    const requiredAnchorIds = readPlanStringArray(dependencyScope, ["requiredAnchorIds", "required_anchor_ids"]);
    const forbiddenAnchorIds = readPlanStringArray(dependencyScope, ["forbiddenAnchorIds", "forbidden_anchor_ids"]);
    if (!targetAnchorId || requiredAnchorIds.length !== 1 || requiredAnchorIds[0] !== targetAnchorId) {
      throw new Error("生成前检测到资产依赖作用域缺失：单体资产必须且只能绑定一个目标锚点。");
    }
    const overlap = requiredAnchorIds.filter((anchorId) => forbiddenAnchorIds.includes(anchorId));
    if (overlap.length) {
      throw new Error(`生成前检测到资产依赖作用域冲突：${overlap.join(", ")} 同时被要求和禁止。`);
    }
    const visibleLockSection = compiled.prompt
      .split("Visible anchor locks:")[1]
      ?.split(/\n(?:Camera Graph inheritance contract:|MANDATORY RETRY CORRECTION|Execution rules:)/)[0] ?? "";
    const leakedAnchorIds = forbiddenAnchorIds.filter((anchorId) =>
      visibleLockSection.includes(`anchor_id=${anchorId}`),
    );
    if (leakedAnchorIds.length) {
      throw new Error(`生成前检测到全局锚点污染，已停止抽图：${leakedAnchorIds.join(", ")}`);
    }
  }
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
  // For a person asset the uploaded source may share its URL with a generic
  // style candidate. Preserve the scoped identity+style authority alias.
  if (candidate.sourceType === "user_upload" && candidate.hardRequired) return 3;
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
  project: Pick<VideoProjectRecord, "planJson" | "keyframes">,
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
  project: Pick<VideoProjectRecord, "planJson" | "keyframes" | "generationCandidates">,
  segmentNo?: number,
): ReferenceCandidateDraft[] {
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

function rollbackPlanToBoundaryReview(
  plan: Record<string, unknown>,
  keyframes: VideoProjectRecord["keyframes"],
): void {
  clearPlanMicroShotImages(plan, "segments");
  const assetArtifactIds = keyframes
    .filter((keyframe) => keyframe.keyframeNo < 0 && Boolean(keyframe.imageUrl))
    .map((keyframe) => imageArtifactIdForKeyframeNo(keyframe.keyframeNo));
  const boundaryArtifactIds = keyframes
    .filter((keyframe) => keyframe.keyframeNo > 0 && Boolean(keyframe.imageUrl))
    .map((keyframe) => imageArtifactIdForKeyframeNo(keyframe.keyframeNo));
  setPlanArtifactStatus(plan, assetArtifactIds, "approved", { retryFromStage: "generation" });
  setPlanArtifactStatus(plan, boundaryArtifactIds, "ready", { retryFromStage: "generation" });
}

function isUsableTransitionParentKeyframe(
  project: Pick<VideoProjectRecord, "planJson" | "generationCandidates">,
  keyframe: Pick<VideoProjectRecord["keyframes"][number], "keyframeNo" | "imageUrl" | "locked" | "status"> | undefined,
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

function assertFullTransitionReferenceReady(project: Pick<VideoProjectRecord, "planJson">, segmentNo: number): void {
  const required = transitionReferenceArtifactsFromPlan(project.planJson).filter((item) => item.toSegmentNo === segmentNo && item.mode === "full");
  const missing = required.filter((item) => item.status !== "approved" || !item.locked || !item.selectedFrameUrl);
  if (missing.length) throw new Error(`Transition reference is required before generating segment ${segmentNo}: ${missing.map((item) => `${item.id} status=${item.status}`).join(", ")}. Generate, review, and lock it first.`);
}

function assertTransitionReferenceSelected(project: Pick<VideoProjectRecord, "planJson">, segmentNo: number, output: ReferenceSelectionOutput): void {
  const requiredIds = transitionReferenceArtifactsFromPlan(project.planJson).filter((item) => item.toSegmentNo === segmentNo).map((item) => item.id);
  const missing = requiredIds.filter((id) => !output.selectedArtifactIds.includes(id));
  if (missing.length) throw new Error(`Required transition scene-layout reference was not selected: ${missing.join(", ")}`);
}

function isTransitionReferenceReadyForBoundary(project: Pick<VideoProjectRecord, "planJson" | "keyframes" | "generationCandidates">, keyframeNo: number): boolean {
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

function renderingStyleContractForPrompt(
  planJson: Prisma.JsonValue | null,
  targetAnchorId?: string,
): Record<string, unknown> | undefined {
  const plan = planRecord(planJson);
  const styleBible = isRecord(plan.styleBible)
    ? plan.styleBible
    : isRecord(plan.style_bible)
      ? plan.style_bible
      : undefined;
  const planningManifest = isRecord(plan.planningManifest)
    ? plan.planningManifest
    : isRecord(plan.planning_manifest)
      ? plan.planning_manifest
      : undefined;
  const globalStyle = isRecord(planningManifest?.globalStyle)
    ? planningManifest.globalStyle
    : isRecord(planningManifest?.global_style)
      ? planningManifest.global_style
      : undefined;
  const manifest = isRecord(plan.consistencyManifest)
    ? plan.consistencyManifest
    : isRecord(plan.consistency_manifest)
      ? plan.consistency_manifest
      : isRecord(planningManifest?.consistencyManifest)
        ? planningManifest.consistencyManifest
        : isRecord(planningManifest?.consistency_manifest)
          ? planningManifest.consistency_manifest
          : undefined;
  const targetAnchor = Array.isArray(manifest?.anchors)
    ? manifest.anchors.find((item) => isRecord(item) && readPlanShotString(item, ["id"]) === targetAnchorId)
    : undefined;
  const assetContract = isRecord(targetAnchor)
    ? isRecord(targetAnchor.assetImageContract)
      ? targetAnchor.assetImageContract
      : isRecord(targetAnchor.asset_image_contract)
        ? targetAnchor.asset_image_contract
        : undefined
    : undefined;
  const explicit = isRecord(assetContract?.renderingStyle)
    ? assetContract.renderingStyle
    : isRecord(assetContract?.rendering_style)
      ? assetContract.rendering_style
      : undefined;
  const visualStyle = firstNonEmptyString([
    readPlanShotString(explicit, ["medium"]),
    readPlanShotString(styleBible, ["visualStyle", "visual_style"]),
    readPlanShotString(globalStyle, ["visualStyle", "visual_style"]),
  ]);
  if (!visualStyle) return undefined;
  const dimensionality = firstNonEmptyString([
    readPlanShotString(explicit, ["dimensionality"]),
    /\b(?:3d|cgi|cg render)/i.test(visualStyle)
      ? "3d"
      : /\b(?:2\.5d)/i.test(visualStyle)
        ? "2.5d"
        : /\b(?:2d|vector|illustration|cel[- ]?shad)/i.test(visualStyle)
          ? "2d"
          : "",
  ]);
  const isThreeDimensional = dimensionality === "3d" || dimensionality === "2.5d";
  return {
    medium: visualStyle,
    dimensionality: dimensionality || "mixed",
    shading: firstNonEmptyString([
      readPlanShotString(explicit, ["shading"]),
      isThreeDimensional ? "rounded volumetric form with smooth gradient shading matching the user reference" : "match the user reference shading exactly",
    ]),
    edgeTreatment: firstNonEmptyString([
      readPlanShotString(explicit, ["edgeTreatment", "edge_treatment"]),
      isThreeDimensional ? "preserve the reference edge treatment; no newly invented thick ink outlines" : "match the reference line and edge treatment exactly",
    ]),
    surfaceTreatment: firstNonEmptyString([
      readPlanShotString(explicit, ["surfaceTreatment", "surface_treatment"]),
      isThreeDimensional ? "preserve the reference's soft character surfaces, fabric, fur, and accessory materials" : "match the reference surface language",
    ]),
    depthTreatment: firstNonEmptyString([
      readPlanShotString(explicit, ["depthTreatment", "depth_treatment"]),
      isThreeDimensional ? "preserve three-dimensional volume and soft depth separation" : "match the reference depth treatment",
    ]),
    authority: firstNonEmptyString([
      readPlanShotString(explicit, ["authority"]),
      "user_reference",
    ]),
    forbiddenDrift: uniqueStrings([
      ...readPlanStringArray(explicit, ["forbiddenDrift", "forbidden_drift"]),
      ...(isThreeDimensional
        ? ["flat 2D vector illustration", "thick black contour lines", "cel-shaded comic rendering"]
        : []),
    ]),
  };
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
    const normalizedAnchor = normalizePlanAnchorRecord(anchor);
    if (!isVisibleEvidenceAnchor(normalizedAnchor as unknown as VideoConsistencyAnchor)) return [];
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

function personAnchorForPrompt(
  planJson: Prisma.JsonValue | null,
  targetAnchorId: string | undefined,
): VideoConsistencyAnchor | undefined {
  if (!targetAnchorId) return undefined;
  const anchor = readPlanConsistencyAnchorMap(planJson).get(targetAnchorId);
  if (!anchor || readPlanShotString(anchor, ["type"]) !== "person") return undefined;
  const rawVisualLock = isRecord(anchor.visualLock)
    ? anchor.visualLock
    : isRecord(anchor.visual_lock)
      ? anchor.visual_lock
      : undefined;
  return {
    ...(anchor as unknown as VideoConsistencyAnchor),
    visualLock: rawVisualLock
      ? {
          shape: readPlanShotString(rawVisualLock, ["shape"]),
          material: readPlanShotString(rawVisualLock, ["material"]),
          color: readPlanShotString(rawVisualLock, ["color"]),
          markings: readPlanShotString(rawVisualLock, ["markings"]),
          scale: readPlanShotString(rawVisualLock, ["scale"]),
          state: readPlanShotString(rawVisualLock, ["state"]),
          forbiddenDrift: readPlanStringArray(rawVisualLock, ["forbiddenDrift", "forbidden_drift"]),
        }
      : undefined,
  };
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
  project: Pick<VideoProjectRecord, "planJson">,
  segment: VideoProjectRecord["segments"][number],
): string {
  const planSegment = readPlanSegmentMap(project.planJson).get(segment.segmentNo);
  const boundaryMode = readPlanBoundaryMode(planSegment);
  const outputMode = readPlanShotString(planSegment, ["outputMode", "output_mode"]);
  const constraints = readPlanStringArray(planSegment, ["constraints"]);
  const timedPrompts = readPlanTimedPrompts(planSegment);
  const microShots = readEffectivePlanMicroShots(project.planJson, segment.segmentNo);
  const audioPlan = readPlanAudioPlan(planSegment);
  const identityLock = characterIdentityLockForPrompt(project.planJson);
  const toneLock = colorToneLockForPrompt(project.planJson);
  const anchorLock = consistencyAnchorLocksForPrompt(
    project.planJson,
    effectiveRequiredAnchorIds(planSegment),
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
            item.purpose ? `purpose: ${item.purpose}` : "",
            item.scene ? `scene: ${item.scene}` : "",
            item.action ? `action: ${item.action}` : "",
            item.camera ? `camera: ${item.camera}` : "",
            item.imagePrompt ? `reference image prompt: ${item.imagePrompt}` : "",
            item.imageUrl ? `generated reference image URL: ${item.imageUrl}` : "",
            item.prompt ? `control prompt: ${item.prompt}` : "",
          ].filter(Boolean).join("; ");
          return `- ${parts}`;
        }).join("\n")}` : "",
    timedPrompts.length
      ? `Timed control prompts:\n${timedPrompts.map((item) => {
          const range = typeof item.startSeconds === "number" && typeof item.endSeconds === "number"
            ? `${item.startSeconds}-${item.endSeconds}s`
            : `${item.timeSeconds}s`;
          return `- At ${range}: ${item.prompt}`;
        }).join("\n")}`
      : "",
  ].filter(Boolean);
  if (additions.length) return [base, ...additions].join("\n");
  return base;
}

function normalizeMicroShotForSegment(
  value: Partial<VideoMicroShot>,
  segment: VideoProjectRecord["segments"][number],
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
    imagePrompt: value.imagePrompt ?? "",
    imagePromptZh: value.imagePromptZh ?? "",
    imagePromptEn: value.imagePromptEn ?? "",
    imageUrl: value.imageUrl ?? "",
    imageStatus: value.imageStatus,
    errorMessage: value.errorMessage ?? "",
    usesConsistencyAnchors: value.usesConsistencyAnchors ?? [],
    prompt: value.prompt ?? "",
    promptZh: value.promptZh ?? "",
    promptEn: value.promptEn ?? "",
  };
}

function localizedMicroShotImagePromptForGeneration(microShot: VideoMicroShot, _locale?: "zh" | "en"): string {
  return typeof microShot.imagePrompt === "string" ? microShot.imagePrompt.trim() : "";
}

function generationPromptForMicroShot(
  project: Pick<VideoProjectRecord, "planJson">,
  segment: VideoProjectRecord["segments"][number],
  microShot: VideoMicroShot,
): string {
  const imagePrompt = microShot.imagePrompt;
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
    microShot.prompt ? `Text control prompt: ${microShot.prompt}` : "",
    identityLock ? "Hard character identity lock: " + identityLock : "",
    toneLock ? "Hard color tone lock: " + toneLock : "",
    anchorLock ? "Hard project consistency anchors for this micro-shot:\n" + anchorLock : "",
    "Describe and render a still moment only. Avoid motion trails, before/after panels, subtitles, labels, watermarks, UI, or added typography.",
  ].filter(Boolean).join("\n");
}

async function selectReferenceImagesForMicroShot(
  project: Pick<VideoProjectRecord, "planJson" | "keyframes" | "referenceImageUrls" | "generationCandidates">,
  segment: VideoProjectRecord["segments"][number],
  microShot: VideoMicroShot,
  finalTextPrompt: string,
): Promise<{ urls: string[]; output: ReferenceSelectionOutput }> {
  assertFullTransitionReferenceReady(project, segment.segmentNo);
  const requiredAnchorIds = microShot.effectiveRequiredAnchorIds
    ?? microShot.usesConsistencyAnchors
    ?? effectiveRequiredAnchorIds(readPlanSegmentMap(project.planJson).get(segment.segmentNo));
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
  const authority = await readArtifactPlan(projectId, { allowMissing: true });
  if (!authority) return;
  const plan = cloneJsonRecord(authority);
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
  await commitArtifactPlan(projectId, plan);
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
  const authority = await readArtifactPlan(projectId, { allowMissing: true });
  if (!authority) return;
  const plan = cloneJsonRecord(authority);
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
  await commitArtifactPlan(projectId, plan);
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
  const authority = await readArtifactPlan(projectId, { allowMissing: true });
  if (!authority) return undefined;
  const plan = cloneJsonRecord(authority);
  const history = readVideoMediaRevisionHistory(authority);
  const key = videoMediaRevisionKey(input);
  const revisions = history[key] ?? [];
  if (revisions.at(-1)?.url === url) return revisions.at(-1)?.id;
  const revisionId = randomUUID();
  revisions.push({ ...input, id: revisionId, url, createdAt: new Date().toISOString() });
  history[key] = revisions.slice(-MAX_MEDIA_REVISIONS_PER_TARGET);
  plan.mediaRevisionHistory = history;
  delete plan.media_revision_history;
  await commitArtifactPlan(projectId, plan);
  return revisionId;
}

async function updatePlanMicroShot(
  projectId: string,
  segmentNo: number,
  microShotNo: number,
  patch: Partial<VideoMicroShot>,
): Promise<void> {
  const authority = await readArtifactPlan(projectId, { allowMissing: true });
  if (!authority) return;
  const plan = cloneJsonRecord(authority);
  updatePlanMicroShotCollection(plan, "segments", segmentNo, microShotNo, patch);
  updateResolvedMicroShotCollection(
    plan,
    "mediaConditionedSegmentPlans",
    segmentNo,
    microShotNo,
    patch,
  );
  updateResolvedMicroShotCollection(
    plan,
    "segmentRenderDescriptions",
    segmentNo,
    microShotNo,
    patch,
  );
  await commitArtifactPlan(projectId, plan);
}

function cloneJsonRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return JSON.parse(JSON.stringify(isRecord(value) ? value : {})) as Record<string, unknown>;
}

function updatePlanMicroShotCollection(
  plan: Record<string, unknown>,
  collectionKey: "segments",
  segmentNo: number,
  microShotNo: number,
  patch: Partial<VideoMicroShot>,
): void {
  const collection = plan[collectionKey];
  if (!Array.isArray(collection)) return;
  for (const item of collection) {
    if (!isRecord(item)) continue;
    const n = Number(item.segmentNo ?? item.segment_no);
    if (n !== segmentNo) continue;
    const updateItems = (value: unknown): unknown[] => {
      const microShots = Array.isArray(value) ? value : [];
      return microShots.map((microShot, index) => {
        if (!isRecord(microShot)) return microShot;
        const currentNo = Number(microShot.microShotNo ?? microShot.micro_shot_no ?? index + 1);
        if (currentNo !== microShotNo) return microShot;
        const patchRevision = patch.resolvedRevisionId;
        const currentRevision = readPlanShotString(microShot, [
          "resolvedRevisionId",
          "resolved_revision_id",
        ]);
        if (patchRevision && patchRevision !== currentRevision) return microShot;
        return {
          ...microShot,
          ...patch,
          microShotNo,
        };
      });
    };
    const rawMicroShots = item.microShots ?? item.micro_shots ?? item.internalStoryboard ?? item.internal_storyboard ?? item.subShots ?? item.sub_shots;
    // Candidate polling and quality evaluation may finish after the user has
    // deleted this micro-shot. Those asynchronous updates may enrich an
    // existing item, but must never recreate an item that the user removed.
    item.microShots = updateItems(rawMicroShots);
    if (Array.isArray(item.resolvedMicroShots)) {
      item.resolvedMicroShots = updateItems(item.resolvedMicroShots);
    }
  }
}

function updateResolvedMicroShotCollection(
  plan: Record<string, unknown>,
  collectionKey: "mediaConditionedSegmentPlans" | "segmentRenderDescriptions",
  segmentNo: number,
  microShotNo: number,
  patch: Partial<VideoMicroShot>,
): void {
  const collection = plan[collectionKey];
  if (!Array.isArray(collection)) return;
  for (const item of collection) {
    if (!isRecord(item) || Number(item.segmentNo ?? item.segment_no) !== segmentNo) continue;
    const updateItems = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
      .map((microShot, index) => {
        if (!isRecord(microShot)) return microShot;
        const currentNo = Number(microShot.microShotNo ?? microShot.micro_shot_no ?? index + 1);
        const patchRevision = patch.resolvedRevisionId;
        const currentRevision = readPlanShotString(microShot, [
          "resolvedRevisionId",
          "resolved_revision_id",
        ]);
        if (patchRevision && patchRevision !== currentRevision) return microShot;
        return currentNo === microShotNo
          ? { ...microShot, ...patch, microShotNo }
          : microShot;
      });
    if (Array.isArray(item.resolvedMicroShots)) {
      item.resolvedMicroShots = updateItems(item.resolvedMicroShots);
    }
    if (Array.isArray(item.motionCheckpoints)) {
      item.motionCheckpoints = updateItems(item.motionCheckpoints);
    }
  }
}

function synchronizeUserEditedResolvedMicroShots(
  plan: Record<string, unknown>,
  segmentNo: number,
): void {
  const mediaPlans = Array.isArray(plan.mediaConditionedSegmentPlans)
    ? plan.mediaConditionedSegmentPlans
    : [];
  const media = mediaPlans.find((item) =>
    isRecord(item) && Number(item.segmentNo ?? item.segment_no) === segmentNo
  );
  if (!isRecord(media)) return;
  const segment = (Array.isArray(plan.segments) ? plan.segments : [])
    .find((item) => isRecord(item) && Number(item.segmentNo ?? item.segment_no) === segmentNo);
  if (!isRecord(segment) || !Array.isArray(segment.microShots)) return;
  const revisionId = `resolved-micro-shots-user:${randomUUID()}`;
  const resolvedAt = new Date().toISOString();
  const resolved = segment.microShots.map((item, index) => {
    if (!isRecord(item)) return item;
    return {
      ...item,
      microShotNo: index + 1,
      planningSource: "media_conditioned",
      resolvedRevisionId: revisionId,
      resolvedAt,
      imageUrl: "",
      imageStatus: "idle",
      errorMessage: "",
    };
  });
  segment.microShots = resolved;
  segment.resolvedMicroShots = resolved;
  segment.microShotRevisionId = revisionId;
  segment.microShotResolutionStatus = "resolved";
  media.resolvedMicroShots = resolved;
  media.motionCheckpoints = resolved;
  media.microShotRevisionId = revisionId;
  for (const collectionKey of ["segmentRenderDescriptions"] as const) {
    const collection = Array.isArray(plan[collectionKey]) ? plan[collectionKey] : [];
    for (const item of collection) {
      if (!isRecord(item)) continue;
      const n = Number(item.segmentNo ?? item.segment_no);
      if (n !== segmentNo) continue;
      item.resolvedMicroShots = resolved;
      item.microShotRevisionId = revisionId;
      item.motionCheckpoints = resolved;
    }
  }
}

async function syncCanonicalPlanFromEntities(
  projectId: string,
  localizedUpdate?: {
    shotId: string;
    locale?: "zh" | "en";
    microShots?: UpdateShotInput["microShots"];
    purposeUpdated?: boolean;
    imagePromptUpdated?: boolean;
    imagePromptEditContract?: UpdateShotInput["imagePromptEditContract"];
    negativePromptUpdated?: boolean;
  },
): Promise<void> {
  const storedProject = await prisma.videoProject.findUnique({
    where: { id: projectId },
    include: PROJECT_INCLUDE,
  });
  if (!storedProject) return;
  const authority = await readArtifactPlan(projectId, { allowMissing: true });
  if (!authority) return;
  const project = {
    ...storedProject,
    planJson: authority,
  } as VideoProjectRecord;

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
      const editContract = localizedImageUpdate && localizedUpdate?.imagePromptEditContract
        ? localizedUpdate.imagePromptEditContract
        : normalizeImagePromptEditContract(previous?.imagePromptEditContract ?? previous?.image_prompt_edit_contract, {
            imagePromptZh: readPlanShotString(previous, ["imagePromptZh", "image_prompt_zh"]),
            imagePromptEn: readPlanShotString(previous, ["imagePromptEn", "image_prompt_en"]),
            providerPrompt: keyframe.imagePrompt,
          });
      const imagePromptZh = localizedImageUpdate && localizedUpdate?.imagePromptEditContract
        ? compileImagePromptDisplay(editContract, "zh")
        : localizedImageUpdate && localizedUpdate?.locale !== "en"
        ? keyframe.imagePrompt
        : readPlanShotString(previous, ["imagePromptZh", "image_prompt_zh"]) || keyframe.imagePrompt;
      const imagePromptEn = localizedImageUpdate && localizedUpdate?.imagePromptEditContract
        ? compileImagePromptDisplay(editContract, "en")
        : localizedImageUpdate && localizedUpdate?.locale === "en"
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
        imagePromptEditContract: editContract,
        negativePrompt: keyframe.negativePrompt,
        negativePromptZh,
        negativePromptEn,
      };
    });

    const nextKeyframes = boundaryProjectKeyframes.map((keyframe) => {
      const previous = previousKeyframes.get(keyframe.keyframeNo);
      const localizedImageUpdate = localizedUpdate?.imagePromptUpdated && updatedStartKeyframeNo === keyframe.keyframeNo;
      const editContract = localizedImageUpdate && localizedUpdate?.imagePromptEditContract
        ? localizedUpdate.imagePromptEditContract
        : normalizeImagePromptEditContract(previous?.imagePromptEditContract ?? previous?.image_prompt_edit_contract, {
            imagePromptZh: readPlanShotString(previous, ["imagePromptZh", "image_prompt_zh"]),
            imagePromptEn: readPlanShotString(previous, ["imagePromptEn", "image_prompt_en"]),
            providerPrompt: keyframe.imagePrompt,
          });
      const imagePromptZh = localizedImageUpdate && localizedUpdate?.imagePromptEditContract
        ? compileImagePromptDisplay(editContract, "zh")
        : localizedImageUpdate && localizedUpdate?.locale !== "en"
        ? keyframe.imagePrompt
        : readPlanShotString(previous, ["imagePromptZh", "image_prompt_zh"]) || keyframe.imagePrompt;
      const imagePromptEn = localizedImageUpdate && localizedUpdate?.imagePromptEditContract
        ? compileImagePromptDisplay(editContract, "en")
        : localizedImageUpdate && localizedUpdate?.locale === "en"
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
        imagePromptEditContract: editContract,
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

    const nextPlan: OnePromptVideoPlan = {
      ...plan,
      keyframeCount: boundaryProjectKeyframes.length,
      segmentCount: project.segments.length,
      consistencyReferences: nextConsistencyReferences,
      keyframes: nextKeyframes,
      segments: nextSegments,
    };
    const updatedConsistencyKeyframe = localizedUpdate
      ? consistencyProjectKeyframes.find((keyframe) => keyframe.id === localizedUpdate.shotId)
      : undefined;
    const updatedConsistencyReference = updatedConsistencyKeyframe
      ? nextConsistencyReferences.find((reference) => reference.keyframeNo === updatedConsistencyKeyframe.keyframeNo)
      : undefined;
    synchronizeEditedAssetPromptContract(
      nextPlan as unknown as Record<string, unknown>,
      updatedConsistencyReference?.anchorId,
      localizedUpdate?.imagePromptUpdated ? localizedUpdate.imagePromptEditContract : undefined,
    );
    if (updatedSegment && Array.isArray(localizedUpdate?.microShots)) {
      synchronizeUserEditedResolvedMicroShots(
        nextPlan as unknown as Record<string, unknown>,
        updatedSegment.segmentNo,
      );
    }
    markPlanArtifactsDirtyForShotUpdate(nextPlan as unknown as Record<string, unknown>, project, localizedUpdate);
    await commitArtifactPlan(
      projectId,
      nextPlan as unknown as Prisma.JsonValue,
    );
    return;
  }

  throw new Error("Project has no canonical segments; run the artifact migration before editing");
}

function synchronizeEditedAssetPromptContract(
  plan: Record<string, unknown>,
  anchorId: string | undefined,
  editContract: UpdateShotInput["imagePromptEditContract"] | undefined,
): void {
  if (!anchorId || !editContract) return;
  const nextManifest = consistencyManifestRecordForMutation(plan);
  const anchors = Array.isArray(nextManifest.anchors) ? nextManifest.anchors : [];
  let changed = false;
  nextManifest.anchors = anchors.map((item) => {
    if (!isRecord(item) || readPlanShotString(item, ["id"]) !== anchorId) return item;
    changed = true;
    const previousAssetContract = normalizeVideoAssetImageContract(
      item.assetImageContract ?? item.asset_image_contract,
    );
    const updatedAnchor = {
      ...item,
      imagePromptZh: compileImagePromptDisplay(editContract, "zh"),
      imagePromptEn: compileImagePromptDisplay(editContract, "en"),
      assetImageContract: applyImagePromptEditContractToAssetContract(editContract, previousAssetContract),
    };
    return isPlayingCardAnchor(updatedAnchor as unknown as VideoConsistencyAnchor)
      ? resolvePlayingCardAssetContract({
          anchor: updatedAnchor as unknown as VideoConsistencyAnchor,
          userEditPrompt: compileImagePromptForProvider(editContract),
        }).anchor
      : updatedAnchor;
  });
  if (!changed) return;

  plan.consistencyManifest = nextManifest;
  delete plan.consistency_manifest;
  const planningManifest = isRecord(plan.planningManifest)
    ? { ...plan.planningManifest }
    : isRecord(plan.planning_manifest)
      ? { ...plan.planning_manifest }
      : undefined;
  if (planningManifest) {
    planningManifest.consistencyManifest = nextManifest;
    delete planningManifest.consistency_manifest;
    plan.planningManifest = planningManifest;
    delete plan.planning_manifest;
  }
}

