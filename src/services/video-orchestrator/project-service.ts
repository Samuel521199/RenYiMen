import { Prisma, VideoProjectStatus, VideoShotStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { consumeUserBalanceInTransaction } from "@/lib/billing";
import { createVideoPlan, normalizePlanInput } from "./planner";
import { buildImageGenerationQualityReport, buildVideoGenerationQualityReport, scoreShotImage } from "./quality-judge";
import {
  queryDashScopeTask,
  queryImsComposeJob,
  submitAliyunImageTask,
  submitAliyunImageToVideoTask,
} from "./aliyun-workflow";
import { createAliyunStoryboardPlan } from "./three-stage-planner";
import { errorForLog, logOnePromptVideo } from "./logger";
import { composeVideoClipsLocally, enforceSegmentEndFrameLocally } from "./local-compose";
import { isTemporaryDashScopeUrl, persistRemoteMediaToOss } from "./oss-media";
import { appendProjectStageLog, writeProjectOverviewLog, writeScriptBreakdownLog, writeStageErrorLog } from "./stage-logger";
import type { ArtifactMetadata, CreateVideoProjectInput, FinalTransitionPlan, GenerationQualityReport, OnePromptVideoPlan, PlanVideoProjectInput, PromptDebugArtifact, ReferenceSelectionOutput, UpdateShotInput, VideoConsistencyReference, VideoMicroShot } from "./types";

const PROJECT_INCLUDE = {
  shots: { orderBy: { shotNo: "asc" as const } },
  keyframes: { orderBy: { keyframeNo: "asc" as const } },
  segments: { orderBy: { segmentNo: "asc" as const } },
};

const DEFAULT_IMAGE_TASK_CONCURRENCY = 3;
const DEFAULT_CLIP_TASK_CONCURRENCY = 2;
const MAX_UPSTREAM_TASK_CONCURRENCY = 5;
type OnePromptPlannerArch = "v1" | "v2_shadow" | "v2";

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
};

type CompiledPrompt = {
  prompt: string;
  negativePrompt?: string;
  referenceImageUrls?: string[];
  debugArtifact: PromptDebugArtifact;
};

type PlanDebugPatch = {
  narrativeEvents?: unknown;
  consistencyAnchors?: unknown;
  anchorStateTimeline?: unknown;
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
  const compatShots = segments.length
    ? segments.map((segment) => serializeSegmentAsShot(segment, keyframeMap, planShots))
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
    shots: compatShots,
    planDebug: extractPlanDebug(project.planJson),
  };
}

function serializeSegmentAsShot(
  segment: VideoProjectWithShots["segments"][number],
  keyframeMap: Map<number, VideoProjectWithShots["keyframes"][number]>,
  planShots: Map<number, Record<string, unknown>>,
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
    microShots: readPlanMicroShots(planShot),
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
    audioBible: isRecord(plan.audioBible)
      ? plan.audioBible
      : isRecord(plan.audio_bible)
        ? plan.audio_bible
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

function readAudioBible(planJson: Prisma.JsonValue | null): Record<string, unknown> | undefined {
  const plan = isRecord(planJson) ? planJson : {};
  const audioBible = isRecord(plan.audioBible)
    ? plan.audioBible
    : isRecord(plan.audio_bible)
      ? plan.audio_bible
      : undefined;
  if (!audioBible) return undefined;
  return {
    ...audioBible,
    stripSourceAudio: audioBible.stripSourceAudio ?? audioBible.strip_source_audio ?? false,
    loudnorm: audioBible.loudnorm ?? audioBible.loudNorm ?? audioBible.loudnessNormalization ?? audioBible.loudness_normalization ?? true,
  };
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
      const shadowPlan = await createAliyunStoryboardPlan(input);
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

  return withPlannerArchMetadata(await createAliyunStoryboardPlan(input), "v2");
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
  if (dirtyIds.length) markPlanArtifactsDirty(plan, dirtyIds, "User edited planning debug fields; affected assets require local regeneration before reuse.");
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

function markPlanArtifactsDirty(plan: Record<string, unknown>, artifactIds: string[], dirtyReason: string): void {
  const metadata = ensurePlanArtifactMetadata(plan);
  const dirtyIds = collectDependentArtifactIds(metadata, artifactIds);
  const now = new Date().toISOString();
  for (const artifactId of dirtyIds) {
    const previous = metadata[artifactId] ?? defaultArtifactMetadata(artifactId);
    metadata[artifactId] = {
      ...previous,
      revision: Math.max(1, Number(previous.revision) || 1) + 1,
      status: "dirty",
      dirtyReason,
      retryFromStage: previous.retryFromStage ?? inferRetryFromArtifactId(artifactId),
      updatedAt: now,
    };
  }
  plan.artifactMetadata = metadata;
  delete plan.artifact_metadata;
}

function ensurePlanArtifactMetadata(plan: Record<string, unknown>): Record<string, ArtifactMetadata> {
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
    revision: Math.max(1, Number(value.revision) || 1),
    schemaVersion: typeof value.schemaVersion === "string" ? value.schemaVersion : typeof value.schema_version === "string" ? value.schema_version : "plan-json",
    plannerVersion: typeof value.plannerVersion === "string" ? value.plannerVersion : typeof value.planner_version === "string" ? value.planner_version : "unknown",
    promptVersion: typeof value.promptVersion === "string" ? value.promptVersion : typeof value.prompt_version === "string" ? value.prompt_version : "unknown",
    modelVersion: typeof value.modelVersion === "string" ? value.modelVersion : typeof value.model_version === "string" ? value.model_version : "unknown",
    inputHash: typeof value.inputHash === "string" ? value.inputHash : typeof value.input_hash === "string" ? value.input_hash : "",
    dependsOn: uniqueStrings(Array.isArray(value.dependsOn) ? value.dependsOn : Array.isArray(value.depends_on) ? value.depends_on : []),
    status,
    dirtyReason: typeof value.dirtyReason === "string" ? value.dirtyReason : typeof value.dirty_reason === "string" ? value.dirty_reason : undefined,
    retryFromStage,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : typeof value.updated_at === "string" ? value.updated_at : undefined,
  };
}

function defaultArtifactMetadata(artifactId: string): ArtifactMetadata {
  return {
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

function setPlanArtifactStatus(plan: Record<string, unknown>, artifactIds: string[], status: ArtifactMetadata["status"], options?: { dirtyReason?: string; retryFromStage?: ArtifactRetryFromStage }): void {
  const metadata = ensurePlanArtifactMetadata(plan);
  const now = new Date().toISOString();
  for (const artifactId of uniqueStrings(artifactIds)) {
    const previous = metadata[artifactId] ?? defaultArtifactMetadata(artifactId);
    metadata[artifactId] = {
      ...previous,
      status,
      dirtyReason: status === "dirty" ? options?.dirtyReason ?? previous.dirtyReason : undefined,
      retryFromStage: options?.retryFromStage ?? previous.retryFromStage ?? inferRetryFromArtifactId(artifactId),
      updatedAt: now,
    };
  }
  plan.artifactMetadata = metadata;
  delete plan.artifact_metadata;
}

async function updateProjectArtifactStatus(projectId: string, artifactIds: string[], status: ArtifactMetadata["status"], options?: { dirtyReason?: string; retryFromStage?: ArtifactRetryFromStage }): Promise<void> {
  const project = await prisma.videoProject.findUnique({ where: { id: projectId } });
  if (!project?.planJson) return;
  const plan = cloneJsonRecord(project.planJson);
  setPlanArtifactStatus(plan, artifactIds, status, options);
  await prisma.videoProject.update({
    where: { id: projectId },
    data: { planJson: plan as Prisma.InputJsonValue },
  });
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
  plan.generationQualityReports = [
    ...existing.filter((item) => {
      if (!isRecord(item)) return true;
      return (item.assetId ?? item.asset_id) !== report.assetId;
    }),
    report,
  ].slice(-160);
  delete plan.generation_quality_reports;
  setPlanArtifactStatus(plan, [report.assetId], report.passed ? "ready" : "failed", {
    dirtyReason: report.passed ? undefined : report.retryInstruction || report.artifactIssues.join("; "),
    retryFromStage: inferRetryFromArtifactId(report.assetId),
  });
  await prisma.videoProject.update({
    where: { id: projectId },
    data: { planJson: plan as Prisma.InputJsonValue },
  });
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
    retryInstruction: report.retryInstruction,
  }, report.passed ? "info" : "warn");
}

function buildArtifactDependencySeed(plan: Record<string, unknown>): Record<string, { dependsOn: string[]; retryFromStage?: ArtifactRetryFromStage; status?: ArtifactMetadata["status"] }> {
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
  add("planning:timeline", ["planning:narrative_events"], "stage2a");
  add("planning:consistency_manifest", [], "stage1");
  add("planning:anchor_state_timeline", ["planning:narrative_events", "planning:consistency_manifest"], "stage1");
  add("storyboard:brief", ["planning:timeline", "planning:narrative_events"], "stage2a");
  add("camera_graph", ["storyboard:brief"], "stage2a");
  add("final_transition_plan", ["storyboard:brief", "camera_graph"], "stage2a");
  add("prompt_compiler", [], "compiler", "ready");

  for (const anchor of consistencyAnchorsFromPlan(plan)) {
    add(`anchor:${anchor.id}`, ["planning:consistency_manifest"], "stage1");
  }

  const consistencyReferences = consistencyReferencesFromPlan(plan);
  for (const reference of consistencyReferences) {
    const referenceId = `consistency_reference:${reference.keyframeNo}`;
    add(referenceId, ["planning:consistency_manifest"], "generation");
    add(`${referenceId}:reference_selection`, [referenceId], "reference_selector");
    add(`${referenceId}:prompt`, [referenceId, `${referenceId}:reference_selection`, "prompt_compiler"], "compiler");
    add(`${referenceId}:image`, [`${referenceId}:prompt`], "generation");
  }

  const keyframes = keyframesFromPlan(plan);
  for (const keyframe of keyframes) {
    const keyframeId = keyframe.keyframeNo < 0 ? `consistency_reference:${keyframe.keyframeNo}` : `keyframe:${keyframe.keyframeNo}`;
    const anchorDeps = keyframe.anchorIds.map((anchorId) => `anchor:${anchorId}`);
    add(keyframeId, ["planning:timeline", "planning:anchor_state_timeline", ...anchorDeps], "generation");
    add(`${keyframeId}:reference_selection`, [keyframeId, "camera_graph", ...anchorDeps], "reference_selector");
    add(`${keyframeId}:prompt`, [keyframeId, `${keyframeId}:reference_selection`, "prompt_compiler"], "compiler");
    add(`${keyframeId}:image`, [`${keyframeId}:prompt`], "generation");
  }

  const segments = segmentsFromPlan(plan);
  for (const segment of segments) {
    const segmentId = `segment:${segment.segmentNo}`;
    const startKeyframeId = segment.startKeyframeNo ? `keyframe:${segment.startKeyframeNo}:image` : "";
    const endKeyframeId = segment.endKeyframeNo ? `keyframe:${segment.endKeyframeNo}:image` : "";
    const anchorDeps = segment.anchorIds.map((anchorId) => `anchor:${anchorId}`);
    add(segmentId, ["storyboard:brief", "planning:anchor_state_timeline", "camera_graph", ...anchorDeps], "stage2b");
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

    add(`${segmentId}:prompt`, [
      segmentId,
      `${segmentId}:micro_shots`,
      `${segmentId}:subtitle`,
      "prompt_compiler",
      ...(startKeyframeId ? [startKeyframeId] : []),
      ...(endKeyframeId ? [endKeyframeId] : []),
      ...segment.microShots.map((microShot) => `${segmentId}:micro_shot:${microShot.microShotNo}:image`),
    ], "compiler");
    add(`${segmentId}:video`, [`${segmentId}:prompt`, ...(startKeyframeId ? [startKeyframeId] : [])], "generation");
  }

  if (segments.length) {
    add("final_video", [
      "final_transition_plan",
      ...segments.map((segment) => `segment:${segment.segmentNo}:video`),
    ], "composition");
  }

  return seed;
}

function consistencyAnchorsFromPlan(plan: Record<string, unknown>): Array<{ id: string }> {
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
    return [{ id }];
  });
}

function consistencyReferencesFromPlan(plan: Record<string, unknown>): Array<{ keyframeNo: number }> {
  const references = Array.isArray(plan.consistencyReferences)
    ? plan.consistencyReferences
    : Array.isArray(plan.consistency_references)
      ? plan.consistency_references
      : [];
  return references.flatMap((reference) => {
    if (!isRecord(reference)) return [];
    const keyframeNo = Number(reference.keyframeNo ?? reference.keyframe_no);
    return Number.isInteger(keyframeNo) ? [{ keyframeNo }] : [];
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
  if (artifactId.startsWith("planning:narrative_events") || artifactId.startsWith("planning:consistency_manifest") || artifactId.startsWith("planning:anchor_state_timeline") || artifactId.startsWith("anchor:")) return "stage1";
  if (artifactId.startsWith("planning:timeline") || artifactId.startsWith("storyboard:brief") || artifactId === "camera_graph" || artifactId === "final_transition_plan") return "stage2a";
  if (artifactId.includes(":micro_shots") || /^segment:\d+$/.test(artifactId)) return "stage2b";
  if (artifactId.includes(":reference_selection")) return "reference_selector";
  if (artifactId.includes(":prompt") || artifactId === "prompt_compiler" || artifactId.includes(":subtitle")) return "compiler";
  if (artifactId === "final_video") return "composition";
  if (artifactId.includes(":image") || artifactId.includes(":video") || artifactId.startsWith("keyframe:") || artifactId.startsWith("consistency_reference:")) return "generation";
  return "manual";
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
  return project.segments.flatMap((segment) => {
    const microShots = readPlanMicroShots(planSegments.get(segment.segmentNo));
    return microShots
      .filter((microShot) => Boolean(microShot.imageUrl))
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
    negativePromptUpdated?: boolean;
  },
): void {
  if (!localizedUpdate?.shotId) return;
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
    if (segment.startKeyframeNo) artifactIds.push(`keyframe:${segment.startKeyframeNo}`);
    if (segment.endKeyframeNo) artifactIds.push(`keyframe:${segment.endKeyframeNo}`);
    if (localizedUpdate.microShots) artifactIds.push(`segment:${segment.segmentNo}:micro_shots`);
  } else if (keyframe) {
    artifactIds.push(keyframe.keyframeNo < 0 ? `consistency_reference:${keyframe.keyframeNo}` : `keyframe:${keyframe.keyframeNo}`);
    if (keyframe.keyframeNo < 0) artifactIds.push("anchors:hard_locks");
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
  return prisma.videoProject.findFirst({
    where: { id: projectId, userId },
    include: PROJECT_INCLUDE,
  });
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

export async function cancelVideoProject(userId: string, projectId: string): Promise<VideoProjectWithShots> {
  await requireVideoProject(userId, projectId);
  await logOnePromptVideo("project.cancel.start", { userId, projectId });

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
  const project = await requireVideoProject(userId, projectId);
  await logOnePromptVideo("project.resume.start", {
    userId,
    projectId,
    status: project.status,
    keyframeCount: project.keyframes.length,
    segmentCount: project.segments.length,
    hasPlan: Boolean(project.planJson),
    finalVideoUrl: project.finalVideoUrl,
  });
  if (project.status === VideoProjectStatus.IMAGE_REVIEW) {
    const missingKeyframes = project.keyframes.filter((keyframe) => !keyframe.imageUrl);
    const consistencyReferences = project.keyframes.filter((keyframe) => isConsistencyKeyframeNo(keyframe.keyframeNo));
    const consistencyReadyForBoundary = consistencyReferences.every(isApprovedConsistencyReference);
    if (missingKeyframes.length && consistencyReadyForBoundary) {
      await prisma.videoKeyframe.updateMany({
        where: { projectId, imageUrl: null },
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

  if (project.status !== VideoProjectStatus.FAILED) {
    await logOnePromptVideo("project.resume.noop", { userId, projectId, status: project.status });
    return project;
  }

  if (!project.keyframes.length && !project.segments.length) {
    await logOnePromptVideo("project.resume.replan", { userId, projectId });
    return planVideoProject(userId, projectId);
  }

  const missingKeyframes = project.keyframes.filter((keyframe) => !keyframe.imageUrl);
  if (missingKeyframes.length) {
    await prisma.videoKeyframe.updateMany({
      where: { projectId, imageUrl: null },
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
    await submitRequiredMicroShotImageTasks(userId, projectId);
    const updated = await prisma.videoProject.update({
      where: { id: projectId },
      data: { status: VideoProjectStatus.MICRO_SHOT_REVIEW, errorMessage: null },
      include: PROJECT_INCLUDE,
    });
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
      where: { projectId, clipUrl: null },
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

export async function planVideoProject(
  userId: string,
  projectId: string,
  override?: Partial<CreateVideoProjectInput>,
): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  if (project.status === VideoProjectStatus.PLANNING) {
    await logOnePromptVideo("project.plan.duplicate_ignored", {
      userId,
      projectId,
      status: project.status,
      reason: "already_planning",
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
  let plan: OnePromptVideoPlan;
  try {
    plan = await createPlanForPlannerArch(input, { userId, projectId });
  } catch (error) {
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

  return prisma.$transaction(async (tx) => {
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
    await tx.videoShot.deleteMany({ where: { projectId: project.id } });
    await tx.videoSegment.deleteMany({ where: { projectId: project.id } });
    await tx.videoKeyframe.deleteMany({ where: { projectId: project.id } });
    const consistencyKeyframes = (plan.consistencyReferences ?? [])
      .filter((reference) => reference.needed)
      .map((reference) => ({
        projectId: project.id,
        keyframeNo: reference.keyframeNo,
        timeSeconds: 0,
        status: VideoShotStatus.SCRIPT_READY,
        purpose: reference.purpose,
        scene: reference.scene,
        characterState: reference.characterState,
        productState: reference.productState,
        imagePrompt: reference.imagePromptZh ?? reference.imagePrompt,
        negativePrompt: reference.negativePrompt,
      }));
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
}

export async function updateVideoShot(
  userId: string,
  projectId: string,
  shotId: string,
  input: UpdateShotInput,
): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  const segment = project.segments.find((item) => item.id === shotId);
  const updatedFields: string[] = [];
  if (segment) {
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
      }
      if (Object.keys(data).length) {
        await prisma.videoKeyframe.update({ where: { id: shotId, projectId }, data });
        updatedFields.push(...Object.keys(data));
      }
      await syncPlanJsonFromShots(projectId, {
        shotId,
        locale: input.locale,
        purposeUpdated: typeof input.purpose === "string",
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
      negativePromptUpdated: typeof input.negativePrompt === "string",
    });
    }
  }
  await logOnePromptVideo("shot.update.success", {
    userId,
    projectId,
    shotId,
    updatedFields,
  });
  return requireVideoProject(userId, projectId);
}

export async function approveVideoPlan(userId: string, projectId: string): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  await logOnePromptVideo("image.batch.submit.start", {
    userId,
    projectId,
    keyframeCount: project.keyframes.length,
    status: project.status,
  });
  await appendProjectStageLog({
    projectId,
    title: project.title,
    stage: "keyframes",
    event: "Keyframe review started",
    summary: "Reviewing boundary keyframes and consistency reference frames before image generation.",
    lines: project.keyframes.map((keyframe) => {
      const label = keyframe.keyframeNo < 0 ? "Reference" : "Boundary";
      return `${label} KF${keyframe.keyframeNo}: ${keyframe.purpose || "untitled"}, time=${keyframe.timeSeconds}s, prompt=${(keyframe.imagePrompt || "").slice(0, 260)}`;
    }),
    data: {
      userId,
      status: project.status,
      keyframeCount: project.keyframes.length,
      consistencyReferenceCount: project.keyframes.filter((keyframe) => keyframe.keyframeNo < 0).length,
    },
  });

  await prisma.videoKeyframe.updateMany({
    where: {
      projectId,
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
    keyframes: queued.keyframes,
    logEventPrefix: "image.batch",
  });
  const updated = await requireVideoProject(userId, projectId);
  await logOnePromptVideo("image.batch.submit.done", {
    userId,
    projectId,
    status: updated.status,
    runningCount: updated.keyframes.filter((keyframe) => keyframe.status === VideoShotStatus.IMAGE_RUNNING).length,
    pendingCount: updated.keyframes.filter((keyframe) => keyframe.status === VideoShotStatus.IMAGE_PENDING).length,
  });
  await appendProjectStageLog({
    projectId,
    title: updated.title,
    stage: "keyframes",
    event: "Keyframe image tasks submitted",
    summary: "Boundary and consistency reference image tasks were submitted upstream.",
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

export async function regenerateShotImage(
  userId: string,
  projectId: string,
  shotId: string,
): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  const segment = project.segments.find((item) => item.id === shotId);
  const keyframe = project.keyframes.find((item) => item.id === shotId) ??
    (segment ? project.keyframes.find((item) => item.keyframeNo === segment.startKeyframeNo) : undefined);
  if (!keyframe) throw new Error("Keyframe not found");
  if (keyframe.locked) throw new Error("Locked keyframes cannot be regenerated");

  await logOnePromptVideo("image.regenerate.start", { userId, projectId, keyframeId: keyframe.id, keyframeNo: keyframe.keyframeNo });
  const draftPrompt = compileImagePromptForKeyframe(project, keyframe);
  const referenceSelection = selectReferenceImagesForKeyframe(project, keyframe, draftPrompt.prompt);
  const compiled = compileImagePromptForKeyframe(project, keyframe, {
    ...referenceSelection.output,
    finalTextPrompt: draftPrompt.prompt,
  });
  await saveReferenceSelectionOutput(projectId, {
    ...referenceSelection.output,
    selectedReferenceUrls: referenceSelection.urls,
    finalTextPrompt: compiled.prompt,
  });
  await savePromptDebugArtifact(projectId, compiled.debugArtifact);
  const taskId = await submitAliyunImageTask({
    prompt: compiled.prompt,
    negativePrompt: compiled.negativePrompt,
    referenceImageUrls: compiled.referenceImageUrls ?? [],
    aspectRatio: project.aspectRatio as "9:16" | "16:9" | "1:1",
    seed: Date.now() % 2147483647,
  });
  await prisma.videoKeyframe.update({
    where: { id: keyframe.id },
    data: {
      imageTaskId: taskId,
      imageUrl: null,
      status: VideoShotStatus.IMAGE_RUNNING,
      qualityScore: null,
      errorMessage: null,
    },
  });
  await updateProjectArtifactStatus(projectId, [imageArtifactIdForKeyframeNo(keyframe.keyframeNo)], "generating", { retryFromStage: "generation" });

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
      `Prompt: ${compiled.prompt.slice(0, 400)}`,
    ],
    data: {
      userId,
      keyframeId: keyframe.id,
      keyframeNo: keyframe.keyframeNo,
      imageTaskId: taskId,
      referenceImageCount: (compiled.referenceImageUrls ?? []).length,
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

  await updatePlanMicroShot(projectId, segment.segmentNo, microShotNo, {
    ...merged,
    referenceType: merged.referenceType === "text" ? "image_prompt" : merged.referenceType ?? "image_prompt",
    imageStatus: "pending",
    imageTaskId: "",
    imageUrl: "",
    errorMessage: "",
  });

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
  const referenceSelection = selectReferenceImagesForMicroShot(latest, latestSegment, merged, draftPrompt.prompt);
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
  const taskId = await submitAliyunImageTask({
    prompt: compiled.prompt,
    negativePrompt: compiled.negativePrompt,
    referenceImageUrls: compiled.referenceImageUrls ?? [],
    aspectRatio: latest.aspectRatio as "9:16" | "16:9" | "1:1",
    seed: Math.abs(segment.segmentNo * 100 + microShotNo + Date.now()) % 2147483647,
  });

  await updatePlanMicroShot(projectId, segment.segmentNo, microShotNo, {
    ...merged,
    referenceType: merged.referenceType === "text" ? "image_prompt" : merged.referenceType ?? "image_prompt",
    imageStatus: "running",
    imageTaskId: taskId,
    imageUrl: "",
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
  const renderDescriptions = readPlanSegmentRenderDescriptionMap(project.planJson);
  const blockReason = singleTakeBlockReasonForSegment(renderDescriptions.get(segment.segmentNo), segment);
  if (blockReason) {
    await logOnePromptVideo("clip.regenerate.single_take_audit_softened", {
      userId,
      projectId,
      segmentNo: segment.segmentNo,
      blockReason,
    }, "warn");
  }

  await logOnePromptVideo("clip.regenerate.start", {
    userId,
    projectId,
    segmentId: segment.id,
    segmentNo: segment.segmentNo,
  });
  const compiled = compileVideoPromptForSegment(project, segment, startKeyframe, endKeyframe);
  await savePromptDebugArtifact(projectId, compiled.debugArtifact);
  const taskId = await submitAliyunImageToVideoTask({
    imageUrl: startKeyframe.imageUrl,
    lastFrameUrl: endKeyframe.imageUrl,
    prompt: compiled.prompt,
    durationSeconds: segment.durationSeconds,
  });
  await prisma.videoSegment.update({
    where: { id: segment.id },
    data: {
      clipTaskId: taskId,
      clipUrl: null,
      status: VideoShotStatus.CLIP_RUNNING,
      locked: true,
      errorMessage: null,
    },
  });
  await updateProjectArtifactStatus(projectId, [videoArtifactIdForSegmentNo(segment.segmentNo)], "generating", { retryFromStage: "generation" });
  const updated = await prisma.videoProject.update({
    where: { id: projectId },
    data: { status: VideoProjectStatus.CLIP_GENERATING, errorMessage: null },
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

async function submitRequiredMicroShotImageTasks(userId: string, projectId: string): Promise<void> {
  const project = await requireVideoProject(userId, projectId);
  const planSegments = readPlanSegmentMap(project.planJson);
  for (const segment of project.segments) {
    const microShots = readPlanMicroShots(planSegments.get(segment.segmentNo));
    for (const microShot of microShots) {
      if (!isMicroShotImageRequired(microShot)) continue;
      if (microShot.imageUrl || (microShot.imageStatus === "running" && microShot.imageTaskId)) continue;
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
        const referenceSelection = selectReferenceImagesForMicroShot(latest, latestSegment, microShot, draftPrompt.prompt);
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
        const taskId = await submitAliyunImageTask({
          prompt: compiled.prompt,
          negativePrompt: compiled.negativePrompt,
          referenceImageUrls: compiled.referenceImageUrls ?? [],
          aspectRatio: latest.aspectRatio as "9:16" | "16:9" | "1:1",
          seed: Math.abs(segment.segmentNo * 100 + microShot.microShotNo) || 1,
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

function requiredMicroShotImageIssues(project: VideoProjectWithShots): string[] {
  const planSegments = readPlanSegmentMap(project.planJson);
  return project.segments.flatMap((segment) => {
    const microShots = readPlanMicroShots(planSegments.get(segment.segmentNo));
    return microShots.flatMap((microShot) => {
      if (!isMicroShotImageRequired(microShot)) return [];
      const label = `S${segment.segmentNo}.${microShot.microShotNo}`;
      if (!localizedMicroShotImagePromptForGeneration(microShot)) return [`${label} prompt missing`];
      if (microShot.imageStatus === "failed") return [`${label} failed`];
      if (!microShot.imageUrl) return [`${label} image missing`];
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
  await submitRequiredMicroShotImageTasks(userId, projectId);

  const updated = await prisma.videoProject.update({
    where: { id: projectId },
    data: {
      status: VideoProjectStatus.MICRO_SHOT_REVIEW,
      errorMessage: null,
    },
    include: PROJECT_INCLUDE,
  });
  await logOnePromptVideo("micro_shot.review.ready", { userId, projectId, status: updated.status });
  await appendProjectStageLog({
    projectId,
    title: updated.title,
    stage: "micro_shots",
    event: "Micro-shot references approved",
    summary: "All required micro-shot reference images are ready for clip generation.",
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
  const clipUrls = (project.segments.length ? project.segments : project.shots)
    .map((item) => item.clipUrl)
    .filter((url): url is string => Boolean(url));
  if (!sourceCount || clipUrls.length !== sourceCount) throw new Error("Not all video clips are ready");
  const composeSources = project.segments.length ? project.segments : project.shots;
  const clipDurations = composeSources.map((item) => item.durationSeconds);
  const subtitles = composeSources.map((item) => ({
    text: item.subtitle || "",
    durationSeconds: item.durationSeconds,
  }));
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
      transitionPlan: readFinalTransitionPlan(project.planJson),
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
      transitionPlan: readFinalTransitionPlan(project.planJson),
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

export type VideoProjectRollbackTarget = "PLAN_REVIEW" | "IMAGE_REVIEW" | "MICRO_SHOT_REVIEW" | "CLIP_REVIEW";

export async function rollbackVideoProject(
  userId: string,
  projectId: string,
  targetStatus?: VideoProjectRollbackTarget,
): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  const target = targetStatus ?? previousRollbackTarget(project.status);
  if (!target) throw new Error("Current project stage cannot be rolled back");
  if (!canRollbackTo(project.status, target)) throw new Error(`Cannot rollback from ${project.status} to ${target}`);

  await logOnePromptVideo("project.rollback.start", {
    userId,
    projectId,
    fromStatus: project.status,
    targetStatus: target,
  }, "warn");

  await prisma.$transaction(async (tx) => {
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
    } else if (target === "IMAGE_REVIEW") {
      await tx.videoKeyframe.updateMany({
        where: { projectId },
        data: {
          status: VideoShotStatus.IMAGE_READY,
          imageTaskId: null,
          errorMessage: null,
          locked: false,
        },
      });
      await tx.videoKeyframe.updateMany({
        where: { projectId, imageUrl: null },
        data: { status: VideoShotStatus.SCRIPT_READY },
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
      await rollbackPlanMicroShotImages(projectId, tx);
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
        status: target as VideoProjectStatus,
        finalVideoUrl: target === "CLIP_REVIEW" ? project.finalVideoUrl : null,
        composeTaskId: null,
        errorMessage: null,
      },
    });
  });

  const updated = await requireVideoProject(userId, projectId);
  await logOnePromptVideo("project.rollback.done", {
    userId,
    projectId,
    fromStatus: project.status,
    targetStatus: target,
    status: updated.status,
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
  const project = await requireVideoProject(userId, projectId);
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

  if (project.status === VideoProjectStatus.IMAGE_GENERATING) {
    await syncImageTasks(project);
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

async function syncImageTasks(project: VideoProjectWithShots): Promise<void> {
  const running = project.keyframes.filter((keyframe) => keyframe.status === VideoShotStatus.IMAGE_RUNNING && keyframe.imageTaskId);
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
          qualityScore: scoreShotImage({ imageUrl: persistedImageUrl, imagePrompt: keyframe.imagePrompt, locked: keyframe.locked }),
          errorMessage: null,
        },
      });
      const report = buildImageGenerationQualityReport({
        assetId: imageArtifactIdForKeyframeNo(keyframe.keyframeNo),
        imageUrl: persistedImageUrl,
        prompt: keyframe.imagePrompt,
        selectedReferenceUrls: selectedReferenceUrlsForPromptTarget(project.planJson, keyframeTargetArtifactId(keyframe.keyframeNo)),
        targetType: keyframe.keyframeNo < 0 ? "anchor_reference_image" : "boundary_keyframe",
      });
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
        await prisma.videoKeyframe.update({
          where: { id: keyframe.id },
          data: { status: VideoShotStatus.FAILED, errorMessage: report.retryInstruction || report.artifactIssues.join("; ") },
        });
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
        data: { status: VideoShotStatus.FAILED, errorMessage: result.errorMessage || "闁哄鐗嗗﹢閬嶅疾椤愶箑鐭楅柛灞剧妇閸嬫捇宕橀妸锕€顫撻梺姹囧灮閸犳劙宕瑰顓炵窞閺夊牜鍋夎" },
      });
      await updateProjectArtifactStatus(project.id, [imageArtifactIdForKeyframeNo(keyframe.keyframeNo)], "failed", {
        dirtyReason: result.errorMessage || "Boundary keyframe generation failed",
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
      data: { status: VideoProjectStatus.FAILED, errorMessage: failed.errorMessage || "闁哄鐗嗗﹢閬嶅疾椤愶箑鐭楅柛灞剧妇閸嬫捇宕橀妸锕€顫撻梺姹囧灮閸犳劙宕瑰顓炵窞閺夊牜鍋夎" },
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
  const running = project.segments.flatMap((segment) => {
    const microShots = readPlanMicroShots(planSegments.get(segment.segmentNo));
    return microShots
      .filter((microShot) => microShot.imageStatus === "running" && Boolean(microShot.imageTaskId))
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
      const report = buildImageGenerationQualityReport({
        assetId: imageArtifactIdForMicroShot(item.segment.segmentNo, item.microShot.microShotNo),
        imageUrl: persistedImageUrl,
        prompt: localizedMicroShotImagePromptForGeneration(item.microShot),
        selectedReferenceUrls: selectedReferenceUrlsForPromptTarget(project.planJson, targetArtifactId),
        targetType: "motion_checkpoint_image",
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

  const nextKeyframes = [...params.keyframes]
    .sort((a, b) => a.keyframeNo - b.keyframeNo)
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
    ? nextKeyframes.filter((keyframe) => isConsistencyKeyframeNo(keyframe.keyframeNo))
    : waitingForConsistencyReferences
      ? []
      : nextKeyframes.filter((keyframe) => !isConsistencyKeyframeNo(keyframe.keyframeNo));
  if (missingConsistencyReferences.length && !candidateKeyframes.length) {
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
      const draftPrompt = compileImagePromptForKeyframe(project, nextKeyframe);
      const referenceSelection = selectReferenceImagesForKeyframe(project, nextKeyframe, draftPrompt.prompt);
      const compiled = compileImagePromptForKeyframe(project, nextKeyframe, {
        ...referenceSelection.output,
        finalTextPrompt: draftPrompt.prompt,
      });
      await saveReferenceSelectionOutput(params.projectId, {
        ...referenceSelection.output,
        selectedReferenceUrls: referenceSelection.urls,
        finalTextPrompt: compiled.prompt,
      });
      await savePromptDebugArtifact(params.projectId, compiled.debugArtifact);
      const taskId = await submitAliyunImageTask({
        prompt: compiled.prompt,
        negativePrompt: compiled.negativePrompt,
        referenceImageUrls: compiled.referenceImageUrls ?? [],
        aspectRatio: project.aspectRatio as "9:16" | "16:9" | "1:1",
        seed: Math.abs(nextKeyframe.keyframeNo) || 1,
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
      await updateProjectArtifactStatus(params.projectId, [imageArtifactIdForKeyframeNo(nextKeyframe.keyframeNo)], "generating", { retryFromStage: "generation" });
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
          "Task ID: " + taskId,
          "Reference images: " + ((compiled.referenceImageUrls ?? []).length),
          "Prompt: " + compiled.prompt.slice(0, 400),
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
  if (clipBackedUnreadySegments.length) {
    await prisma.videoSegment.updateMany({
      where: {
        projectId: project.id,
        clipUrl: { not: null },
        status: { in: [VideoShotStatus.CLIP_PENDING, VideoShotStatus.CLIP_RUNNING] },
      },
      data: { status: VideoShotStatus.CLIP_READY, clipTaskId: null, errorMessage: null },
    });
    await logOnePromptVideo("clip.sync.recover_ready_status", {
      projectId: project.id,
      segments: clipBackedUnreadySegments.map((segment) => ({
        segmentNo: segment.segmentNo,
        previousStatus: segment.status,
        hasClipUrl: Boolean(segment.clipUrl),
      })),
    }, "warn");
  }

  const running = project.segments.filter((segment) => segment.status === VideoShotStatus.CLIP_RUNNING && segment.clipTaskId && !segment.clipUrl);
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
      let clipUrl: string;
      try {
        if (!endKeyframe?.imageUrl) throw new Error("Approved segment end-frame image is missing");
        clipUrl = await enforceSegmentEndFrameLocally({
          projectId: project.id,
          segmentNo: segment.segmentNo,
          clipUrl: result.resultUrl,
          endFrameUrl: endKeyframe.imageUrl,
          durationSeconds: segment.durationSeconds,
          aspectRatio: project.aspectRatio as "9:16" | "16:9" | "1:1",
        });
      } catch (error) {
        const message = `Failed to enforce approved end frame: ${error instanceof Error ? error.message : String(error)}`;
        await prisma.videoSegment.update({
          where: { id: segment.id },
          data: { status: VideoShotStatus.FAILED, errorMessage: message },
        });
        await updateProjectArtifactStatus(project.id, [videoArtifactIdForSegmentNo(segment.segmentNo)], "failed", {
          dirtyReason: message,
          retryFromStage: "generation",
        });
        await appendProjectStageLog({
          projectId: project.id,
          title: project.title,
          stage: "clips",
          event: "End-frame enforcement failed segment " + segment.segmentNo,
          level: "error",
          summary: "HappyHorse completed, but the approved boundary frame could not be attached deterministically.",
          data: {
            segmentId: segment.id,
            segmentNo: segment.segmentNo,
            clipTaskId: segment.clipTaskId,
            endKeyframeNo: segment.endKeyframeNo,
            errorMessage: message,
          },
        });
        continue;
      }
      await prisma.videoSegment.update({
        where: { id: segment.id },
        data: {
          clipUrl,
          status: VideoShotStatus.CLIP_READY,
          errorMessage: null,
        },
      });
      const report = buildVideoGenerationQualityReport({
        assetId: videoArtifactIdForSegmentNo(segment.segmentNo),
        clipUrl,
        prompt: qualityPrompt,
        durationSeconds: segment.durationSeconds,
      });
      await saveGenerationQualityReport(project.id, report);
      await appendProjectStageLog({
        projectId: project.id,
        title: project.title,
        stage: "clips",
        event: "Clip ready segment " + segment.segmentNo,
        summary: "Segment clip finished and quality report was recorded.",
        lines: [
          "Clip URL: " + clipUrl,
          "End boundary: exact KF" + segment.endKeyframeNo + " frame enforced",
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
          endFrameEnforced: true,
          qualityReport: report,
        },
      });
      if (!report.passed) {
        await prisma.videoSegment.update({
          where: { id: segment.id },
          data: { status: VideoShotStatus.FAILED, errorMessage: report.retryInstruction || report.artifactIssues.join("; ") },
        });
      }
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
  if (latest.segments.length > 0 && latest.segments.every((segment) => Boolean(segment.clipUrl))) {
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

  const renderDescriptions = readPlanSegmentRenderDescriptionMap(project.planJson);
  const blockedSegments = nextSegments.flatMap((segment) => {
    const reason = singleTakeBlockReasonForSegment(renderDescriptions.get(segment.segmentNo), segment);
    return reason ? [{ segment, reason }] : [];
  });
  if (blockedSegments.length) {
    await logOnePromptVideo(params.logEventPrefix + ".submit.blocked_single_take_audit", {
      userId: params.userId,
      projectId: params.projectId,
      blocked: blockedSegments.map((item) => ({
        segmentNo: item.segment.segmentNo,
        reason: item.reason,
      })),
      action: "softened_and_continued",
    }, "warn");
    await appendProjectStageLog({
      projectId: params.projectId,
      title: project.title,
      stage: "clips",
      event: "Single-take audit warning",
      level: "warn",
      summary: "Some plan fields still contain old cut/transition wording. The video prompt compiler will sanitize them and continue submitting the clip task.",
      lines: blockedSegments.map((item) => "Segment " + item.segment.segmentNo + ": " + item.reason),
      data: {
        userId: params.userId,
        blocked: blockedSegments.map((item) => ({
          segmentNo: item.segment.segmentNo,
          reason: item.reason,
        })),
      },
    });
  }

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
      const taskId = await submitAliyunImageToVideoTask({
        imageUrl: startKeyframe.imageUrl,
        lastFrameUrl: endKeyframe.imageUrl,
        prompt: compiled.prompt,
        durationSeconds: nextSegment.durationSeconds,
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

function singleTakeBlockReasonForSegment(
  description: Record<string, unknown> | undefined,
  segment: VideoProjectWithShots["segments"][number],
): string | undefined {
  if (!description) return undefined;
  const singleTake = readLooseRecord(description, ["singleTakeContract", "single_take_contract"]);
  const motion = readLooseRecord(description, ["motionContract", "motion_contract"]);
  const startFrame = readLooseRecord(description, ["startFrameContract", "start_frame_contract"]);
  const endFrame = readLooseRecord(description, ["endFrameContract", "end_frame_contract"]);
  const checkpoints = readLooseArray(description, ["motionCheckpoints", "motion_checkpoints"]);
  const reasons: string[] = [];

  if (truthyPlanFlag(description.requiresCut ?? description.requires_cut)) reasons.push("description requires a cut");
  if (riskLevelIsHigh(description.riskLevel ?? description.risk_level)) reasons.push("description risk level is high");
  if (hasPlanPayload(description.timelineChangeRequest ?? description.timeline_change_request)) reasons.push("description requests timeline changes");
  if (singleTake) {
    if (truthyPlanFlag(singleTake.requiresCut ?? singleTake.requires_cut)) reasons.push("single take requires a cut");
    if (riskLevelIsHigh(singleTake.riskLevel ?? singleTake.risk_level)) reasons.push("single take risk level is high");
    if (singleTake.physicallyReachable === false || singleTake.physically_reachable === false) reasons.push("single take is not physically reachable");
  }
  if (containsInternalCutLanguage([description, singleTake, motion, startFrame, endFrame, checkpoints])) reasons.push("internal cut language was detected");

  if (!reasons.length) return undefined;
  const uniqueReasons = [...new Set(reasons)];
  return "Segment " + segment.segmentNo + " should be decomposed into micro-shots: " + uniqueReasons.join("; ");
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

function truthyPlanFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") return /^(true|yes|1|requires_cut|high)$/i.test(value.trim());
  return false;
}

function riskLevelIsHigh(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "high";
}

function hasPlanPayload(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  if (typeof value === "string") return Boolean(value.trim());
  return false;
}

function containsInternalCutLanguage(value: unknown): boolean {
  const text = JSON.stringify(value ?? "").toLowerCase();
  return /\b(cut to|jump cut|hard cut|dissolve|fade out|fade in|crossfade|montage|switch to|scene transition|new shot|another shot|shot change)\b/.test(text);
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
  project: Pick<VideoProjectWithShots, "planJson">,
  shot: VideoProjectWithShots["shots"][number],
  kind: "image" | "video",
): string {
  const planShot = readPlanShotMap(project.planJson).get(shot.shotNo);
  const en = readPlanShotString(
    planShot,
    kind === "image" ? ["imagePromptEn", "image_prompt_en"] : ["videoPromptEn", "video_prompt_en"],
  );
  const zh = readPlanShotString(
    planShot,
    kind === "image" ? ["imagePromptZh", "image_prompt_zh"] : ["videoPromptZh", "video_prompt_zh"],
  );
  const fallback = kind === "image" ? shot.imagePrompt : shot.videoPrompt;
  if (en && zh && zh !== en) {
    return en + "\nUser-facing Chinese revision to respect: " + zh;
  }
  return en || zh || fallback;
}

function generationPromptForKeyframe(
  project: Pick<VideoProjectWithShots, "planJson" | "keyframes">,
  keyframe: VideoProjectWithShots["keyframes"][number],
): string {
  const planKeyframe = readPlanKeyframeMap(project.planJson).get(keyframe.keyframeNo) ??
    readPlanConsistencyReferenceMap(project.planJson).get(keyframe.keyframeNo);
  const en = readPlanShotString(planKeyframe, ["imagePromptEn", "image_prompt_en"]);
  const zh = readPlanShotString(planKeyframe, ["imagePromptZh", "image_prompt_zh"]);
  const fallback = keyframe.imagePrompt;
  const identityLock = characterIdentityLockForPrompt(project.planJson);
  const toneLock = colorToneLockForPrompt(project.planJson);
  const anchorLock = consistencyAnchorLocksForPrompt(
    project.planJson,
    readPlanStringArray(planKeyframe, ["usesConsistencyAnchors", "uses_consistency_anchors"]),
  );
  const isConsistencyReference = isConsistencyKeyframeNo(keyframe.keyframeNo);
  const base = en && zh && zh !== en
    ? en + "\nUser-facing Chinese revision to respect: " + zh
    : en || zh || fallback;
  return [
    base,
    isConsistencyReference && keyframe.keyframeNo === CHARACTER_CONSISTENCY_KEYFRAME_NO
      ? "This is the fixed character consistency reference image for the whole project. Make the person clear, stable, front/three-quarter visible, and easy to reuse as identity guidance."
      : "",
    isConsistencyReference && keyframe.keyframeNo === SCENE_CONSISTENCY_KEYFRAME_NO
      ? "This is the fixed scene consistency reference image for the whole project. Make the environment layout, architecture, materials, product placement, lighting, and color palette clear and stable."
      : "",
    isConsistencyReference && keyframe.keyframeNo !== CHARACTER_CONSISTENCY_KEYFRAME_NO && keyframe.keyframeNo !== SCENE_CONSISTENCY_KEYFRAME_NO
      ? "This is a fixed hard consistency reference image for a project anchor such as product, logo, prop, vehicle, food, style, or spatial layout. Make the anchor visually stable, reusable, and faithful to its lock details."
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
  const beforePrompt = generationPromptForSegment(project, segment);
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
    readPlanShotString(planSegment, ["purposeEn", "purpose_en", "purposeZh", "purpose_zh", "purpose"]) ||
      segment.purpose ||
      readPlanShotString(planSegment, ["videoPromptEn", "video_prompt_en", "videoPromptZh", "video_prompt_zh"]) ||
      segment.videoPrompt,
    420,
  );
  const checkpointLines = checkpointRecords.length
    ? checkpointRecords.slice(0, 4).map((checkpoint, index) => "- " + (index + 1) + ". " + stripVideoForbiddenTerms(compactJsonLine("state", checkpoint).replace(/^state: /, "")))
    : microShots.slice(0, 4).map((checkpoint, index) => {
        const parts = [
          "t=+" + checkpoint.localTimeSeconds + "s",
          checkpoint.purposeEn || checkpoint.purposeZh || checkpoint.purpose,
          checkpoint.sceneEn || checkpoint.sceneZh || checkpoint.scene,
          checkpoint.actionEn || checkpoint.actionZh || checkpoint.action,
          checkpoint.cameraEn || checkpoint.cameraZh || checkpoint.camera,
        ].filter(Boolean).join("; ");
        return "- " + (index + 1) + ". " + stripVideoForbiddenTerms(parts);
      });
  const finalPrompt = [
    "HAPPYHORSE FIRST-FRAME I2V PROMPT COMPILED FROM STRUCTURED MOTION CONTRACT",
    "Duration: " + segment.durationSeconds + "s.",
    "Hard model input: begin from the supplied first-frame image and preserve its composition, identity, objects, environment, and visible state.",
    startVisualBlueprint ? "Approved first-boundary visual blueprint: " + startVisualBlueprint : "",
    "The approved end-boundary reference image is represented by the complete visual blueprint below. Treat every listed composition, pose, object, environment, lighting, and state attribute as mandatory visual evidence from that approved reference, not as an optional creative suggestion.",
    endVisualBlueprint ? "APPROVED END-BOUNDARY VISUAL BLUEPRINT — reconstruct this exact destination at the final moment: " + endVisualBlueprint : "",
    "Move continuously and naturally toward that exact ending composition. Complete the required pose, camera framing, object placement, title state, lighting, and environment state before the final moment; do not invent a different ending.",
    "Brief intent: " + stripVideoForbiddenTerms(intent),
    "Detailed same-take motion direction: " + stripVideoForbiddenTerms(clipText(beforePrompt, 1100)),
    "Start state:",
    "- " + stripVideoForbiddenTerms(compactJsonLine("contract", startFrameContract) || (startKeyframe.purpose + ". " + startKeyframe.scene)),
    "Required ending state:",
    "- " + stripVideoForbiddenTerms(compactJsonLine("contract", endFrameContract) || (endKeyframe.purpose + ". " + endKeyframe.scene)),
    "Continuous motion path:",
    "- " + stripVideoForbiddenTerms(compactJsonLine("motion", motionContract) || segment.motion),
    "Single-take execution contract:",
    "- " + stripVideoForbiddenTerms(compactJsonLine("single_take", singleTakeContract) || segment.camera),
    checkpointLines.length ? "Motion checkpoints as reachable states along the same path:" : "",
    ...checkpointLines,
    anchorLock ? "Visible anchor locks:\n" + stripVideoForbiddenTerms(clipText(anchorLock, 900)) : "",
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
      },
      selectedReferenceUrls: [startKeyframe.imageUrl, endKeyframe.imageUrl].filter((url): url is string => Boolean(url)),
      referenceUsageNotes: [
        "The first boundary frame is the sole hard image input accepted by happyhorse-1.1-i2v.",
        "The approved end boundary is a semantic motion target during generation and an exact deterministic frame during post-processing.",
      ],
      beforePrompt,
      finalPrompt,
      finalNegativePrompt: negativePrompt,
      rules: [
        "happyhorse_first_frame_hard_input",
        "deterministic_exact_end_frame_postprocess",
        "no_segment_boundary_mode_terms",
        "checkpoints_as_motion_states",
        "no_embedded_subtitles_or_audio",
      ],
      warnings: [],
      createdAt: new Date().toISOString(),
    },
  };
}

function compileVideoNegativePrompt(baseNegativePrompt: string): string {
  return [
    baseNegativePrompt,
    "embedded subtitles, captions, UI overlays, watermarks, timecodes, random letters, lyrics, speech balloons, duplicated product, duplicated person, identity drift, clothing drift, product morphing, scene replacement, teleporting subject, ghost overlays, melted frames",
  ].filter(Boolean).join(", ");
}

function stripVideoForbiddenTerms(value: string): string {
  return value
    .replace(/\b(hard_cut|match_cut|dissolve|cut to|jump cut|hard cut|fade out|fade in|crossfade|montage|switch to|scene transition|new shot|another shot|shot change)\b/gi, "continuous movement")
    .replace(/硬切|跳切|切换到|切到|转场到|镜头切换|新镜头|另一个镜头|淡入|淡出|叠化|交叉溶解|蒙太奇/g, "连续运动");
}

function hasMeaningfulMotionCheckpoint(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Object.values(value).some((item) => typeof item === "string" && item.trim().length > 0);
}

function bilingualNegativePromptForGeneration(source: Record<string, unknown> | undefined, fallback: string): string {
  const en = readPlanShotString(source, ["negativePromptEn", "negative_prompt_en"]);
  const zh = readPlanShotString(source, ["negativePromptZh", "negative_prompt_zh"]);
  if (en && zh && zh !== en) return en + "\nAlso avoid the user-facing Chinese exclusions: " + zh;
  return en || zh || fallback;
}

function compileImagePromptForKeyframe(
  project: Pick<VideoProjectWithShots, "planJson" | "keyframes">,
  keyframe: VideoProjectWithShots["keyframes"][number],
  referenceSelection?: ReferenceSelectionOutput,
): CompiledPrompt {
  const planKeyframe = readPlanKeyframeMap(project.planJson).get(keyframe.keyframeNo) ??
    readPlanConsistencyReferenceMap(project.planJson).get(keyframe.keyframeNo);
  const isConsistencyReference = isConsistencyKeyframeNo(keyframe.keyframeNo);
  const targetArtifactId = isConsistencyReference ? "consistency_reference:" + keyframe.keyframeNo : "keyframe:" + keyframe.keyframeNo;
  const visibleAnchorIds = readPlanStringArray(planKeyframe, ["usesConsistencyAnchors", "uses_consistency_anchors"]);
  const frameContract = [
    "target: " + targetArtifactId,
    "purpose: " + (readPlanShotString(planKeyframe, ["purposeEn", "purpose_en", "purposeZh", "purpose_zh", "purpose"]) || keyframe.purpose),
    "scene: " + (readPlanShotString(planKeyframe, ["scene"]) || keyframe.scene),
    "character_state: " + (readPlanShotString(planKeyframe, ["characterState", "character_state"]) || keyframe.characterState),
    "product_state: " + (readPlanShotString(planKeyframe, ["productState", "product_state"]) || keyframe.productState),
    visibleAnchorIds.length ? "visible_anchors: " + visibleAnchorIds.join(", ") : "",
    compactJsonLine("frame_design", planKeyframe?.frameDesign ?? planKeyframe?.frame_design),
  ].filter(Boolean);
  const anchorLock = consistencyAnchorLocksForPrompt(project.planJson, visibleAnchorIds);
  const referenceNotes = referenceSelection?.usageNotes ?? [];
  const beforePrompt = generationPromptForKeyframe(project, keyframe);
  const finalPrompt = [
    "IMAGE PROMPT COMPILED FROM STRUCTURED CONTRACT",
    isConsistencyReference
      ? "Create one reusable still consistency reference image."
      : "Create one still boundary keyframe image.",
    "Frame contract:",
    ...frameContract.map((line) => "- " + line),
    anchorLock ? "Visible anchor locks:\n" + anchorLock : "",
    referenceNotes.length ? "Selected reference usage:" : "",
    ...referenceNotes.map((note) => "- " + note + " Inherit only the stated identity, layout, product, or style signal; ignore unrelated pose, crop, artifacts, and accidental text."),
    "Image rules:",
    "- One clean still image only; no storyboard panels, before/after layout, or timeline labels.",
    "- Do not render subtitles, captions, UI overlays, watermarks, timecodes, random letters, or misspelled text.",
    "- Brand or product text is allowed only when it is part of a locked product/package/logo anchor.",
    "- Preserve identity, clothing details, product geometry, scene layout, lighting direction, and color tone from the relevant contracts.",
  ].filter(Boolean).join("\n");
  const negativePrompt = compileImageNegativePrompt(generationNegativePromptForKeyframe(project, keyframe));
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
        visibleAnchorIds,
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
      ],
      warnings: referenceSelection?.warnings ?? [],
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
  const frameContract = [
    "target: " + targetArtifactId,
    "segment: " + segment.segmentNo,
    "local_time_seconds: " + microShot.localTimeSeconds,
    "purpose: " + (microShot.purposeEn || microShot.purposeZh || microShot.purpose),
    "scene_state: " + (microShot.sceneEn || microShot.sceneZh || microShot.scene),
    "action_state: " + (microShot.actionEn || microShot.actionZh || microShot.action),
    "camera_state: " + (microShot.cameraEn || microShot.cameraZh || microShot.camera || segment.camera),
    visibleAnchorIds.length ? "visible_anchors: " + visibleAnchorIds.join(", ") : "",
  ].filter(Boolean);
  const anchorLock = consistencyAnchorLocksForPrompt(project.planJson, visibleAnchorIds);
  const referenceNotes = referenceSelection?.usageNotes ?? [];
  const beforePrompt = generationPromptForMicroShot(project, segment, microShot);
  const finalPrompt = [
    "IMAGE PROMPT COMPILED FROM STRUCTURED CONTRACT",
    "Create one static internal motion-checkpoint reference image inside the same segment.",
    "Frame contract:",
    ...frameContract.map((line) => "- " + line),
    anchorLock ? "Visible anchor locks:\n" + anchorLock : "",
    referenceNotes.length ? "Selected reference usage:" : "",
    ...referenceNotes.map((note) => "- " + note + " Inherit only the stated identity, layout, product, or style signal; ignore unrelated pose, crop, artifacts, and accidental text."),
    "Image rules:",
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
      ],
      warnings: referenceSelection?.warnings ?? [],
      createdAt: new Date().toISOString(),
    },
  };
}

function compileImageNegativePrompt(baseNegativePrompt: string): string {
  return [
    baseNegativePrompt,
    "subtitles, captions, UI overlays, watermarks, timecodes, random letters, misspelled text, storyboard panels, split screen, before-after comparison, duplicated product, identity drift, distorted hands, distorted face, malformed logo",
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

function isApprovedConsistencyReference(keyframe: Pick<VideoProjectWithShots["keyframes"][number], "imageUrl" | "locked" | "status">): boolean {
  return Boolean(keyframe.imageUrl) && (keyframe.locked || keyframe.status === VideoShotStatus.IMAGE_APPROVED);
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

function selectReferenceImagesForKeyframe(
  project: Pick<VideoProjectWithShots, "planJson" | "keyframes" | "referenceImageUrls">,
  keyframe: VideoProjectWithShots["keyframes"][number],
  finalTextPrompt: string,
): { urls: string[]; output: ReferenceSelectionOutput } {
  const targetArtifactId = isConsistencyKeyframeNo(keyframe.keyframeNo)
    ? `consistency_reference:${keyframe.keyframeNo}`
    : `keyframe:${keyframe.keyframeNo}`;
  const planKeyframe = readPlanKeyframeMap(project.planJson).get(keyframe.keyframeNo) ??
    readPlanConsistencyReferenceMap(project.planJson).get(keyframe.keyframeNo);
  const requiredAnchorIds = readPlanStringArray(planKeyframe, ["usesConsistencyAnchors", "uses_consistency_anchors"]);
  const candidates = collectReferenceCandidates({
    project,
    targetKeyframeNo: keyframe.keyframeNo,
    requiredAnchorIds,
    includeBoundaryFrames: false,
  });
  if (isConsistencyKeyframeNo(keyframe.keyframeNo)) {
    return buildReferenceSelectionOutput({
      targetArtifactId,
      targetType: "consistency_reference",
      candidates: candidates.filter((candidate) => candidate.sourceType === "user_upload" || candidate.sourceType === "style_brand"),
      finalTextPrompt,
      missingHardAnchorWarnings: [],
    });
  }
  const missingHardAnchorWarnings = requiredAnchorIds.length
    ? missingHardAnchorWarningsForTarget(project, requiredAnchorIds, keyframe.keyframeNo)
    : [];
  if (missingHardAnchorWarnings.length) {
    throw new Error("Reference image selection failed: " + missingHardAnchorWarnings.join("; "));
  }
  return buildReferenceSelectionOutput({
    targetArtifactId,
    targetType: "keyframe",
    candidates,
    finalTextPrompt,
    missingHardAnchorWarnings,
  });
}

function collectReferenceCandidates(params: {
  project: Pick<VideoProjectWithShots, "planJson" | "keyframes" | "referenceImageUrls">;
  targetKeyframeNo?: number;
  segment?: VideoProjectWithShots["segments"][number];
  microShot?: VideoMicroShot;
  requiredAnchorIds: string[];
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
      const sourceType: ReferenceSourceType = kind === "brand_visual" ? "style_brand" : "hard_anchor";
      const quotaType = quotaTypeForReferenceKind(kind);
      candidates.push({
        artifactId: `consistency_reference:${keyframe.keyframeNo}`,
        url: keyframe.imageUrl,
        sourceType,
        quotaType,
        purpose: referencePurpose(reference, keyframe.purpose || `consistency ${keyframe.keyframeNo}`),
        relevanceScore: required ? 1 : sourceType === "style_brand" ? 0.65 : 0.8,
        conflictScore: required ? 0 : 0.1,
        recencyScore: 0,
        viewMatchScore: kind === "character" ? 0.15 : 0.05,
        usageNote: required
          ? `Required hard anchor ${anchorId || keyframe.keyframeNo}.`
          : `Available hard ${kind} anchor.`,
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
        recencyScore: Math.min(1, distance / 4),
        viewMatchScore: distance <= 1 ? 0.15 : 0.35,
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
      recencyScore: 0,
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
        recencyScore: Math.min(1, distance / Math.max(1, params.segment.durationSeconds)),
        viewMatchScore: keyframeNo === params.segment.startKeyframeNo ? 0.05 : 0.18,
        usageNote: `Parent segment boundary frame ${keyframe.keyframeNo}.`,
      });
    }
  }
  for (const candidate of collectTransitionReferenceCandidates(params.project, params.segment?.segmentNo)) {
    candidates.push(candidate);
  }
  return dedupeReferenceCandidates(candidates);
}

function buildReferenceSelectionOutput(params: {
  targetArtifactId: string;
  targetType: ReferenceSelectionOutput["targetType"];
  candidates: ReferenceCandidateDraft[];
  finalTextPrompt: string;
  missingHardAnchorWarnings: string[];
}): { urls: string[]; output: ReferenceSelectionOutput } {
  const scored = params.candidates
    .map((candidate) => ({
      ...candidate,
      finalScore: referenceFinalScore(candidate),
    }))
    .sort((a, b) => b.finalScore - a.finalScore);
  const selected = new Set<string>();
  const quotaUsed = new Set<ReferenceQuotaType>();
  for (const candidate of scored) {
    if (selected.size >= 4) break;
    if (quotaUsed.has(candidate.quotaType)) continue;
    selected.add(candidate.artifactId);
    quotaUsed.add(candidate.quotaType);
  }
  const outputCandidates: ReferenceSelectionOutput["candidates"] = scored.map((candidate) => {
    const isSelected = selected.has(candidate.artifactId);
    const rejectionReason = isSelected
      ? undefined
      : selected.size >= 4
        ? "quota_full"
        : quotaUsed.has(candidate.quotaType)
          ? `quota_${candidate.quotaType}_already_selected`
          : "lower_score";
    return {
      artifactId: candidate.artifactId,
      url: candidate.url,
      sourceType: candidate.sourceType,
      quotaType: candidate.quotaType,
      purpose: candidate.purpose,
      relevanceScore: roundScore(candidate.relevanceScore),
      conflictScore: roundScore(candidate.conflictScore),
      recencyScore: roundScore(candidate.recencyScore),
      viewMatchScore: roundScore(candidate.viewMatchScore),
      finalScore: roundScore(candidate.finalScore),
      selected: isSelected,
      rejectionReason,
      usageNote: candidate.usageNote,
    };
  });
  const selectedCandidates = outputCandidates.filter((candidate) => candidate.selected);
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
      warnings: params.missingHardAnchorWarnings,
    },
  };
}

function referenceFinalScore(candidate: ReferenceCandidateDraft): number {
  return candidate.relevanceScore * 0.45 -
    candidate.viewMatchScore * 0.25 -
    candidate.recencyScore * 0.2 -
    candidate.conflictScore * 0.35;
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function dedupeReferenceCandidates(candidates: ReferenceCandidateDraft[]): ReferenceCandidateDraft[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.url || candidate.artifactId;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  project: Pick<VideoProjectWithShots, "planJson">,
  segmentNo?: number,
): ReferenceCandidateDraft[] {
  const plan = isRecord(project.planJson) ? project.planJson : {};
  const raw = Array.isArray(plan.transitionReferencePlan)
    ? plan.transitionReferencePlan
    : Array.isArray(plan.transition_reference_plan)
      ? plan.transition_reference_plan
      : [];
  return raw.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const url = readPlanShotString(item, ["imageUrl", "image_url", "referenceUrl", "reference_url", "url"]);
    if (!url) return [];
    const relatedSegment = Number(item.segmentNo ?? item.segment_no ?? item.toSegmentNo ?? item.to_segment_no);
    const distance = Number.isFinite(relatedSegment) && segmentNo ? Math.abs(relatedSegment - segmentNo) : 1;
    return [{
      artifactId: `transition_reference:${index + 1}`,
      url,
      sourceType: "transition_reference" as const,
      quotaType: "space_layout" as const,
      purpose: readPlanShotString(item, ["purpose", "reason"]) || "transition reference",
      relevanceScore: distance <= 1 ? 0.68 : 0.42,
      conflictScore: 0.12,
      recencyScore: Math.min(1, distance / 4),
      viewMatchScore: 0.18,
      usageNote: "Transition reference for spatial continuity.",
    }];
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
  const en = readPlanShotString(planSegment, ["videoPromptEn", "video_prompt_en"]);
  const zh = readPlanShotString(planSegment, ["videoPromptZh", "video_prompt_zh"]);
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
  const fallback = segment.videoPrompt;
  const base = en && zh && zh !== en
    ? `${en}\nUser-facing Chinese revision to respect: ${zh}`
    : en || zh || fallback;
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
            item.purposeEn || item.purposeZh || item.purpose ? `purpose: ${item.purposeEn || item.purposeZh || item.purpose}` : "",
            item.scene ? `scene: ${item.scene}` : "",
            item.action ? `action: ${item.action}` : "",
            item.camera ? `camera: ${item.camera}` : "",
            item.imagePromptEn || item.imagePromptZh || item.imagePrompt ? `reference image prompt: ${item.imagePromptEn || item.imagePromptZh || item.imagePrompt}` : "",
            item.imageUrl ? `generated reference image URL: ${item.imageUrl}` : "",
            item.promptEn || item.promptZh || item.prompt ? `control prompt: ${item.promptEn || item.promptZh || item.prompt}` : "",
          ].filter(Boolean).join("; ");
          return `- ${parts}`;
        }).join("\n")}` : "",
    timedPrompts.length
      ? `Timed control prompts:\n${timedPrompts.map((item) => {
          const range = typeof item.startSeconds === "number" && typeof item.endSeconds === "number"
            ? `${item.startSeconds}-${item.endSeconds}s`
            : `${item.timeSeconds}s`;
          return `- At ${range}: ${item.promptEn || item.promptZh || item.prompt}`;
        }).join("\n")}`
      : "",
  ].filter(Boolean);
  if (additions.length) return [base, ...additions].join("\n");
  if (en && zh && zh !== en) {
    return `${en}\nUser-facing Chinese revision to respect: ${zh}`;
  }
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
  if (locale === "en") return microShot.imagePromptEn || microShot.imagePrompt || microShot.imagePromptZh || "";
  return microShot.imagePromptZh || microShot.imagePrompt || microShot.imagePromptEn || "";
}

function generationPromptForMicroShot(
  project: Pick<VideoProjectWithShots, "planJson">,
  segment: VideoProjectWithShots["segments"][number],
  microShot: VideoMicroShot,
): string {
  const imagePrompt = microShot.imagePromptEn || microShot.imagePrompt || microShot.imagePromptZh;
  const identityLock = characterIdentityLockForPrompt(project.planJson);
  const toneLock = colorToneLockForPrompt(project.planJson);
  const anchorLock = consistencyAnchorLocksForPrompt(project.planJson, microShot.usesConsistencyAnchors);
  return [
    "Generate exactly one static internal storyboard reference image for a single micro-shot inside a video segment.",
    "This is not a timeline label, not a collage, not a split-screen, and not a video frame sequence.",
    `Segment ${segment.segmentNo}, local time +${microShot.localTimeSeconds}s.`,
    microShot.purposeEn || microShot.purposeZh || microShot.purpose ? `Micro-shot purpose: ${microShot.purposeEn || microShot.purposeZh || microShot.purpose}` : "",
    microShot.scene ? `Scene/state: ${microShot.scene}` : "",
    microShot.action ? `Static action state to depict: ${microShot.action}` : "",
    microShot.camera ? `Composition/camera: ${microShot.camera}` : "",
    imagePrompt ? `Reference image prompt: ${imagePrompt}` : "",
    microShot.promptEn || microShot.promptZh || microShot.prompt ? `Text control prompt: ${microShot.promptEn || microShot.promptZh || microShot.prompt}` : "",
    identityLock ? "Hard character identity lock: " + identityLock : "",
    toneLock ? "Hard color tone lock: " + toneLock : "",
    anchorLock ? "Hard project consistency anchors for this micro-shot:\n" + anchorLock : "",
    "Describe and render a still moment only. Avoid motion trails, before/after panels, subtitles, labels, watermarks, UI, or added typography.",
  ].filter(Boolean).join("\n");
}

function selectReferenceImagesForMicroShot(
  project: Pick<VideoProjectWithShots, "planJson" | "keyframes" | "referenceImageUrls">,
  segment: VideoProjectWithShots["segments"][number],
  microShot: VideoMicroShot,
  finalTextPrompt: string,
): { urls: string[]; output: ReferenceSelectionOutput } {
  const requiredAnchorIds = microShot.usesConsistencyAnchors?.length
    ? microShot.usesConsistencyAnchors
    : readPlanStringArray(readPlanSegmentMap(project.planJson).get(segment.segmentNo), ["usesConsistencyAnchors", "uses_consistency_anchors"]);
  const missingHardAnchorWarnings = requiredAnchorIds.length
    ? missingHardAnchorWarningsForTarget(project, requiredAnchorIds)
    : [];
  if (missingHardAnchorWarnings.length) {
    throw new Error("Reference image selection failed: " + missingHardAnchorWarnings.join("; "));
  }
  return buildReferenceSelectionOutput({
    targetArtifactId: "segment:" + segment.segmentNo + ":micro_shot:" + microShot.microShotNo,
    targetType: "micro_shot",
    candidates: collectReferenceCandidates({
      project,
      segment,
      microShot,
      requiredAnchorIds,
      includeBoundaryFrames: true,
    }),
    finalTextPrompt,
    missingHardAnchorWarnings,
  });
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
    const exists = nextMicroShots.some((microShot, index) => isRecord(microShot) && Number(microShot.microShotNo ?? microShot.micro_shot_no ?? index + 1) === microShotNo);
    if (!exists) nextMicroShots.push({ ...patch, microShotNo });
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
      const localizedImageUpdate = localizedUpdate?.shotId === keyframe.id;
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
      const localizedImageUpdate = updatedStartKeyframeNo === keyframe.keyframeNo;
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
        localizedUpdate?.shotId === shot.id && localizedUpdate.locale !== "en"
          ? shot.imagePrompt
          : readPlanShotString(previousShots.get(shot.shotNo), ["imagePromptZh", "image_prompt_zh"]) || shot.imagePrompt,
      imagePromptEn:
        localizedUpdate?.shotId === shot.id && localizedUpdate.locale === "en"
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
    })),
  };
  markPlanArtifactsDirtyForShotUpdate(nextPlan as unknown as Record<string, unknown>, project, localizedUpdate);
  await prisma.videoProject.update({
    where: { id: projectId },
    data: { planJson: nextPlan as unknown as Prisma.InputJsonValue },
  });
}

