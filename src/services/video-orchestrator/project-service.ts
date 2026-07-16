import { Prisma, VideoProjectStatus, VideoShotStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { consumeUserBalanceInTransaction } from "@/lib/billing";
import { normalizePlanInput } from "./planner";
import { scoreShotImage } from "./quality-judge";
import {
  queryDashScopeTask,
  queryImsComposeJob,
  submitAliyunImageTask,
  submitAliyunImageToVideoTask,
} from "./aliyun-workflow";
import { createAliyunStoryboardPlan } from "./three-stage-planner";
import { errorForLog, logOnePromptVideo } from "./logger";
import { composeVideoClipsLocally } from "./local-compose";
import type { CreateVideoProjectInput, OnePromptVideoPlan, UpdateShotInput, VideoConsistencyReference, VideoMicroShot } from "./types";

const PROJECT_INCLUDE = {
  shots: { orderBy: { shotNo: "asc" as const } },
  keyframes: { orderBy: { keyframeNo: "asc" as const } },
  segments: { orderBy: { segmentNo: "asc" as const } },
};

const DEFAULT_IMAGE_TASK_CONCURRENCY = 3;
const DEFAULT_CLIP_TASK_CONCURRENCY = 2;
const MAX_UPSTREAM_TASK_CONCURRENCY = 5;

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.round(value) : fallback;
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
const DEMO_PROJECT_TITLE = "Tongits King: 欢乐竞技，智取王座";
const DEMO_PROJECT_SOURCE_IDS = ["cmrlwfpz10001tvu4g80aou8c", "cmrlur1ue0001tvw42u6de3yr"];
const DEMO_PROJECT_PROMPT = "如图这个游戏，我要做一个30s的广告宣传片，要求引人入胜，画面精良，且整个视频前后人物要一致";
const DEMO_PROJECT_FINAL_VIDEO_URL = "/demo/tongits/final.mp4";
const ONE_PROMPT_VIDEO_COST_CREDITS = 5000;
const MANUAL_STOP_MESSAGE = "Generation stopped by user";

export type VideoProjectWithShots = Prisma.VideoProjectGetPayload<{
  include: typeof PROJECT_INCLUDE;
}>;

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
    if (n === CHARACTER_CONSISTENCY_KEYFRAME_NO || n === SCENE_CONSISTENCY_KEYFRAME_NO) map.set(n, reference);
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
  const purposeMatch = cleaned.match(/\bPurpose:\s*([^.;。]+)/i);
  const source = purposeMatch?.[1]?.trim() || cleaned.split(/[.;。]/)[0]?.trim() || fallback;
  return source.length > 96 ? `${source.slice(0, 93)}...` : source;
}

function toChineseNegativePrompt(prompt: string): string {
  const dictionary: Record<string, string> = {
    text: "文字",
    subtitles: "字幕",
    captions: "字幕",
    logos: "标志",
    logo: "标志",
    watermarks: "水印",
    watermark: "水印",
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
    blurry: "模糊",
    "duplicated body": "身体重复",
  };
  return prompt
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => dictionary[item.toLowerCase()] ?? item)
    .join("，");
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
    const action = readPlanShotString(item, ["action", "action_limit"]);
    const camera = readPlanShotString(item, ["camera", "camera_limit"]);
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
      action,
      camera,
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
  const negativePromptZh = "写实风格、昏暗、低清晰度、模糊、畸变、多余肢体、脸部变形、服装不一致、品牌元素缺失";
  const keyframes = [
    demoKeyframe(1, 0, "神秘光影中引入主角牛角色，营造期待感", "Introduce the mascot in mysterious spotlight and build anticipation", negativePrompt, negativePromptZh),
    demoKeyframe(2, 5, "角色完全展现，准备进入明亮游戏世界", "Reveal the mascot and move toward the bright game world", negativePrompt, negativePromptZh),
    demoKeyframe(3, 9, "展示热带游戏世界全景", "Show the tropical card-game world", negativePrompt, negativePromptZh),
    demoKeyframe(4, 15, "角色操作卡牌，展示互动性", "Show the mascot playing cards and making a smart move", negativePrompt, negativePromptZh),
    demoKeyframe(5, 20, "胜利瞬间，角色欢呼", "Celebrate the winning moment", negativePrompt, negativePromptZh),
    demoKeyframe(6, 25, "品牌LOGO完全展现", "Reveal the Tongits King logo", negativePrompt, negativePromptZh),
    demoKeyframe(7, 30, "行动号召，引导下载", "End with a download call to action", negativePrompt, negativePromptZh),
  ];
  const segments = [
    demoSegment(1, 1, 2, 0, 5, "通过神秘光影引入主角牛角色，营造期待感", "A continuous push-in reveals the smiling mascot under warm spotlight.", negativePrompt, negativePromptZh),
    demoSegment(2, 2, 3, 5, 9, "展示游戏界面与环境，突出热带主题与卡牌元素", "The camera opens into a sunny tropical game world with cards and playful motion.", negativePrompt, negativePromptZh),
    demoSegment(3, 3, 4, 9, 15, "展示角色操作卡牌，体现游戏互动性", "The mascot picks cards, considers strategy, and makes a confident move.", negativePrompt, negativePromptZh),
    demoSegment(4, 4, 5, 15, 20, "展示胜利瞬间，角色欢呼，增强情感共鸣", "The mascot wins, jumps in celebration, and the scene fills with festive effects.", negativePrompt, negativePromptZh),
    demoSegment(5, 5, 6, 20, 25, "品牌LOGO浮现，强化记忆点", "The Tongits King logo emerges clearly with cards and tropical leaves.", negativePrompt, negativePromptZh),
    demoSegment(6, 6, 7, 25, 30, "行动号召，引导下载", "The logo holds while a clean download call to action appears.", negativePrompt, negativePromptZh),
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
        primaryGoalZh: "用30秒展示 Tongits King 的欢乐竞技氛围并引导下载",
        primaryGoalEn: "Show Tongits King's joyful competitive mood in 30 seconds and drive installs",
      },
      storyStrategy: {
        narrativeArcZh: "角色登场、进入游戏世界、策略互动、胜利庆祝、品牌露出、行动号召",
        narrativeArcEn: "Mascot reveal, game-world entry, strategic interaction, victory, brand reveal, call to action",
      },
      timelineBlueprint: {
        segmentCount: segments.length,
        totalDurationSeconds: 30,
        segmentDurationMinSeconds: 3,
        segmentDurationMaxSeconds: 15,
        splitStrategyZh: "按广告叙事节拍拆分为6段，每段3-15秒",
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
            displayNameZh: "主角牛角色",
            displayNameEn: "Bull mascot",
            mustStayConsistent: true,
            needsReferenceImage: true,
            referenceStrength: "hard",
            descriptionZh: "草帽、红围巾、蓝外套、金色徽章的卡通牛",
            descriptionEn: "Cartoon bull with straw hat, red scarf, blue jacket, and gold badge",
            appliesTo: ["keyframes", "segments", "micro_shots"],
            userEditable: true,
            imagePromptZh: "卡通牛，草帽，红围巾，蓝外套，金色徽章，微笑，明亮背景",
            imagePromptEn: "Cartoon bull mascot, straw hat, red scarf, blue jacket, gold badge, friendly smile, bright background",
          },
          {
            id: "tongits-brand",
            type: "brand_visual",
            displayNameZh: "Tongits King 品牌视觉",
            displayNameEn: "Tongits King brand visual",
            mustStayConsistent: true,
            needsReferenceImage: false,
            referenceStrength: "medium",
            descriptionZh: "明亮热带卡牌游戏品牌，绿色叶子、扑克牌和清晰LOGO",
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
          displayNameZh: "主角牛角色",
          displayNameEn: "Bull mascot",
          mustStayConsistent: true,
          needsReferenceImage: true,
          referenceStrength: "hard",
          descriptionZh: "草帽、红围巾、蓝外套、金色徽章的卡通牛",
          descriptionEn: "Cartoon bull with straw hat, red scarf, blue jacket, and gold badge",
          appliesTo: ["keyframes", "segments", "micro_shots"],
          userEditable: true,
        imagePromptZh: "卡通牛，草帽，红围巾，蓝外套，金色徽章，微笑，明亮背景",
        imagePromptEn: "Cartoon bull mascot, straw hat, red scarf, blue jacket, gold badge, friendly smile, bright background",
      },
      {
        id: "tongits-brand",
        type: "brand_visual",
        displayNameZh: "Tongits King 品牌视觉",
        displayNameEn: "Tongits King brand visual",
        mustStayConsistent: true,
        needsReferenceImage: false,
        referenceStrength: "medium",
        descriptionZh: "明亮热带卡牌游戏品牌，绿色叶子、扑克牌和清晰LOGO",
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
      splitStrategyZh: "按广告叙事节拍拆分为6段，每段3-15秒",
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
        frameId: "mascot-bull-reference",
        purpose: "牛角色",
        purposeZh: "牛角色",
        purposeEn: "Bull mascot identity reference",
        scene: "clean bright reference background",
        characterState: "same cartoon bull mascot, straw hat, red scarf, blue jacket, gold badge",
        productState: "Tongits King game identity",
        imagePrompt: "Cartoon bull mascot, straw hat, red scarf, blue jacket, gold badge, friendly smile, bright background",
        imagePromptZh: "卡通牛，草帽，红围巾，蓝外套，金色徽章，微笑，明亮背景",
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
      constraints: ["保持主角牛角色造型一致", "保持品牌色彩明亮清晰", "无水印、无UI、无字幕"],
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
  const imagePromptZh = `电影级卡通游戏广告，${purposeZh}，同一只草帽红围巾蓝外套金色徽章的卡通牛角色，热带卡牌游戏氛围，9:16竖构图，明亮高饱和商业质感，无水印，无UI，无字幕`;
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
  const videoPromptZh = `单段一镜到底连续镜头，${purposeZh}。保持同一只草帽红围巾蓝外套金色徽章的卡通牛角色，保持热带卡牌游戏世界、明亮商业卡通质感和品牌色彩一致。禁止切镜、跳切、淡入淡出、场景替换、角色漂移、文字水印和UI。`;
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
    constraints: ["保持主角牛角色造型一致", "保持品牌色彩明亮清晰", "无水印、无UI、无字幕"],
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
  input: { title?: string },
): Promise<VideoProjectWithShots> {
  await requireVideoProject(userId, projectId);
  const data: Prisma.VideoProjectUpdateInput = {};
  if (typeof input.title === "string") data.title = input.title.trim().slice(0, 80);

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
  await requireVideoProject(userId, projectId);
  await prisma.videoProject.delete({ where: { id: projectId } });
  await logOnePromptVideo("project.delete.success", { userId, projectId });
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

export async function planVideoProject(
  userId: string,
  projectId: string,
  override?: Partial<CreateVideoProjectInput>,
): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
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
    fallbackSegmentCount: input.shotCount,
    durationSeconds: input.durationSeconds,
    aspectRatio: input.aspectRatio,
    stylePreset: input.stylePreset,
    referenceImageCount: input.referenceImageUrls.length,
  });
  await prisma.videoProject.update({
    where: { id: project.id },
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
  let plan: OnePromptVideoPlan;
  try {
    plan = await createAliyunStoryboardPlan(input);
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
      `一句话成片：${updated.title || project.id}`,
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
  if (!keyframe) throw new Error("边界参考帧不存在");
  if (keyframe.locked) throw new Error("边界参考帧已锁定，请先解锁再重生成");

  await logOnePromptVideo("image.regenerate.start", { userId, projectId, keyframeId: keyframe.id, keyframeNo: keyframe.keyframeNo });
  const taskId = await submitAliyunImageTask({
    prompt: generationPromptForKeyframe(project, keyframe),
    negativePrompt: generationNegativePromptForKeyframe(project, keyframe),
    referenceImageUrls: referenceImageUrlsForKeyframe(project, keyframe),
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

  const updated = await prisma.videoProject.update({
    where: { id: projectId },
    data: { status: VideoProjectStatus.IMAGE_GENERATING, errorMessage: null },
    include: PROJECT_INCLUDE,
  });
  await logOnePromptVideo("image.regenerate.success", { userId, projectId, keyframeId: keyframe.id, keyframeNo: keyframe.keyframeNo, imageTaskId: taskId });
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
  const taskId = await submitAliyunImageTask({
    prompt: generationPromptForMicroShot(latest, latestSegment, merged),
    negativePrompt: generationNegativePromptForSegment(latest, latestSegment),
    referenceImageUrls: referenceImageUrlsForMicroShot(latest, latestSegment),
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
  await logOnePromptVideo("micro_shot.image.regenerate.success", {
    userId,
    projectId,
    segmentNo: segment.segmentNo,
    microShotNo,
    imageTaskId: taskId,
  });
  return requireVideoProject(userId, projectId);
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
        const taskId = await submitAliyunImageTask({
          prompt: generationPromptForMicroShot(latest, latestSegment, microShot),
          negativePrompt: generationNegativePromptForSegment(latest, latestSegment),
          referenceImageUrls: referenceImageUrlsForMicroShot(latest, latestSegment),
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
        await logOnePromptVideo("micro_shot.image.submit.success", {
          userId,
          projectId,
          segmentNo: segment.segmentNo,
          microShotNo: microShot.microShotNo,
          imageTaskId: taskId,
        });
      } catch (error) {
        const retryable = isAliyunRateLimitError(error);
        await updatePlanMicroShot(projectId, segment.segmentNo, microShot.microShotNo, {
          ...microShot,
          imageStatus: retryable ? "pending" : "failed",
          errorMessage: retryable ? "Aliyun rate limit, please retry later" : error instanceof Error ? error.message : "Micro-shot image submit failed",
        });
        await logOnePromptVideo("micro_shot.image.submit.error", {
          userId,
          projectId,
          segmentNo: segment.segmentNo,
          microShotNo: microShot.microShotNo,
          retryable,
          ...errorForLog(error),
        }, retryable ? "warn" : "error");
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
  if (missing.length) throw new Error("还有边界参考帧没有生成完成，不能进入视频阶段");
  await logOnePromptVideo("micro_shot.review.start", {
    userId,
    projectId,
    keyframeCount: project.keyframes.length,
    segmentCount: project.segments.length,
    status: project.status,
  });

  await prisma.videoKeyframe.updateMany({
    where: { projectId, imageUrl: { not: null } },
    data: { status: VideoShotStatus.IMAGE_APPROVED, locked: true, errorMessage: null },
  });
  await submitRequiredMicroShotImageTasks(userId, projectId);

  const updated = await prisma.videoProject.update({
    where: { id: projectId },
    data: {
      status: VideoProjectStatus.IMAGE_REVIEW,
      errorMessage: null,
    },
    include: PROJECT_INCLUDE,
  });
  await logOnePromptVideo("micro_shot.review.ready", { userId, projectId, status: updated.status });
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
  await prisma.videoSegment.updateMany({
    where: { projectId },
    data: { status: VideoShotStatus.CLIP_PENDING, locked: true, errorMessage: null },
  });
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
  return updated;
}

export async function composeVideoProject(userId: string, projectId: string): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  if (project.status !== VideoProjectStatus.CLIP_REVIEW && project.status !== VideoProjectStatus.FINAL_REVIEW) {
    throw new Error("Current project is not ready for composition");
  }

  const sourceCount = project.segments.length || project.shots.length;
  const clipUrls = (project.segments.length ? project.segments : project.shots)
    .map((item) => item.clipUrl)
    .filter((url): url is string => Boolean(url));
  if (!sourceCount || clipUrls.length !== sourceCount) throw new Error("Not all video clips are ready");
  await logOnePromptVideo("compose.submit.start", {
    userId,
    projectId,
    status: project.status,
    clipCount: clipUrls.length,
    title: project.title,
  });

  const composeSources = project.segments.length ? project.segments : project.shots;
  const clipDurations = composeSources.map((item) => item.durationSeconds);
  const subtitles = composeSources.map((item) => ({
    text: item.subtitle || "",
    durationSeconds: item.durationSeconds,
  }));
  const finalVideoUrl = await composeVideoClipsLocally({
    projectId,
    title: project.title,
    clipUrls,
    clipDurations,
    subtitles,
    aspectRatio: project.aspectRatio as "9:16" | "16:9" | "1:1",
  });

  if (project.segments.length) {
    await prisma.videoSegment.updateMany({
      where: { projectId },
      data: { status: VideoShotStatus.CLIP_APPROVED, locked: true, errorMessage: null },
    });
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
  await logOnePromptVideo("compose.submit.success", {
    userId,
    projectId,
    composeTaskId: null,
    localCompose: true,
    finalVideoUrl: updated.finalVideoUrl,
    status: updated.status,
  });
  return updated;
}
export async function finishVideoProject(userId: string, projectId: string): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  if (project.status !== VideoProjectStatus.FINAL_REVIEW && project.status !== VideoProjectStatus.DONE) {
    throw new Error("请先进入成片审核");
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
      await prisma.videoKeyframe.update({
        where: { id: keyframe.id },
        data: {
          imageUrl: result.resultUrl,
          status: VideoShotStatus.IMAGE_READY,
          qualityScore: scoreShotImage({ imageUrl: result.resultUrl, imagePrompt: keyframe.imagePrompt, locked: keyframe.locked }),
          errorMessage: null,
        },
      });
    } else if (result.status === "failed") {
      await prisma.videoKeyframe.update({
        where: { id: keyframe.id },
        data: { status: VideoShotStatus.FAILED, errorMessage: result.errorMessage || "边界参考帧生成失败" },
      });
    }
  }

  const latest = await prisma.videoProject.findUnique({ where: { id: project.id }, include: PROJECT_INCLUDE });
  if (!latest) return;
  const failed = latest.keyframes.find((keyframe) => keyframe.status === VideoShotStatus.FAILED);
  if (failed) {
    await prisma.videoProject.update({
      where: { id: project.id },
      data: { status: VideoProjectStatus.FAILED, errorMessage: failed.errorMessage || "边界参考帧生成失败" },
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
      await updatePlanMicroShot(project.id, item.segment.segmentNo, item.microShot.microShotNo, {
        ...item.microShot,
        imageUrl: result.resultUrl,
        imageStatus: "ready",
        errorMessage: "",
      });
    } else if (result.status === "failed") {
      await updatePlanMicroShot(project.id, item.segment.segmentNo, item.microShot.microShotNo, {
        ...item.microShot,
        imageStatus: "failed",
        errorMessage: result.errorMessage || "Micro-shot reference image generation failed",
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
    await logOnePromptVideo(`${params.logEventPrefix}.submit.skip_running`, {
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
  const waitingForConsistencyReferences = consistencyReferences.some((keyframe) => !keyframe.imageUrl);
  const candidateKeyframes = waitingForConsistencyReferences
    ? nextKeyframes.filter((keyframe) => isConsistencyKeyframeNo(keyframe.keyframeNo))
    : nextKeyframes;
  if (waitingForConsistencyReferences && !candidateKeyframes.length) {
    await logOnePromptVideo(`${params.logEventPrefix}.submit.wait_consistency_references`, {
      userId: params.userId,
      projectId: params.projectId,
      runningCount: running.length,
      concurrency,
      consistencyReferences: consistencyReferences.map((keyframe) => ({
        keyframeNo: keyframe.keyframeNo,
        status: keyframe.status,
        imageTaskId: keyframe.imageTaskId,
        hasImageUrl: Boolean(keyframe.imageUrl),
      })),
    });
    return;
  }
  const nextKeyframesToSubmit = candidateKeyframes.slice(0, availableSlots);
  if (!nextKeyframesToSubmit.length) {
    await logOnePromptVideo(`${params.logEventPrefix}.submit.no_pending`, {
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

  await logOnePromptVideo(`${params.logEventPrefix}.submit.batch`, {
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
      const taskId = await submitAliyunImageTask({
        prompt: generationPromptForKeyframe(project, nextKeyframe),
        negativePrompt: generationNegativePromptForKeyframe(project, nextKeyframe),
        referenceImageUrls: referenceImageUrlsForKeyframe(project, nextKeyframe),
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
      await logOnePromptVideo(`${params.logEventPrefix}.submit.success`, {
        userId: params.userId,
        projectId: params.projectId,
        keyframeId: nextKeyframe.id,
        keyframeNo: nextKeyframe.keyframeNo,
        imageTaskId: taskId,
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
      await logOnePromptVideo(`${params.logEventPrefix}.submit.error`, {
        userId: params.userId,
        projectId: params.projectId,
        keyframeId: nextKeyframe.id,
        keyframeNo: nextKeyframe.keyframeNo,
        retryable,
        ...errorForLog(error),
      }, retryable ? "warn" : "error");
      if (!retryable) throw error;
      break;
    }
  }
}

async function syncClipTasks(project: VideoProjectWithShots): Promise<void> {
  const running = project.segments.filter((segment) => segment.status === VideoShotStatus.CLIP_RUNNING && segment.clipTaskId);
  await logOnePromptVideo("clip.sync.start", {
    projectId: project.id,
    runningCount: running.length,
    taskIds: running.map((segment) => ({ segmentNo: segment.segmentNo, clipTaskId: segment.clipTaskId })),
  });
  for (const segment of running) {
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
      await prisma.videoSegment.update({
        where: { id: segment.id },
        data: {
          clipUrl: result.resultUrl,
          status: VideoShotStatus.CLIP_READY,
          errorMessage: null,
        },
      });
    } else if (result.status === "failed") {
      await prisma.videoSegment.update({
        where: { id: segment.id },
        data: { status: VideoShotStatus.FAILED, errorMessage: result.errorMessage || "视频片段生成失败" },
      });
    }
  }

  const latest = await prisma.videoProject.findUnique({ where: { id: project.id }, include: PROJECT_INCLUDE });
  if (!latest) return;
  const failed = latest.segments.find((segment) => segment.status === VideoShotStatus.FAILED);
  if (failed) {
    await prisma.videoProject.update({
      where: { id: project.id },
      data: { status: VideoProjectStatus.FAILED, errorMessage: failed.errorMessage || "视频片段生成失败" },
    });
    await logOnePromptVideo("clip.sync.project.failed", {
      projectId: project.id,
      failedSegmentNo: failed.segmentNo,
      errorMessage: failed.errorMessage,
    }, "error");
    return;
  }
  const runningCount = latest.segments.filter((segment) => segment.status === VideoShotStatus.CLIP_RUNNING && segment.clipTaskId).length;
  const pending = latest.segments.some((segment) => segment.status === VideoShotStatus.CLIP_PENDING);
  if (runningCount < clipTaskConcurrency() && pending) {
    await submitNextClipTask({
      projectId: project.id,
      segments: latest.segments,
      keyframes: latest.keyframes,
      logEventPrefix: "clip.sync",
    });
    return;
  }
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
    await logOnePromptVideo(`${params.logEventPrefix}.submit.skip_running`, {
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
    await logOnePromptVideo(`${params.logEventPrefix}.submit.no_pending`, {
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

  const consistencyReferences = consistencyReferenceImageUrls(project);
  await logOnePromptVideo(`${params.logEventPrefix}.submit.batch`, {
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
      const taskId = await submitAliyunImageToVideoTask({
        imageUrl: startKeyframe.imageUrl,
        lastFrameUrl: endKeyframe.imageUrl,
        prompt: [
          generationPromptForSegment(project, nextSegment),
          consistencyReferences.length
            ? `Project-level consistency reference images for identity and scene continuity: ${consistencyReferences.join(" ; ")}`
            : "",
          `Start boundary reference frame ${nextSegment.startKeyframeNo}: ${startKeyframe.purpose}. ${startKeyframe.scene}`,
          `End boundary reference frame ${nextSegment.endKeyframeNo}: ${endKeyframe.purpose}. ${endKeyframe.scene}`,
          nextSegment.camera,
          nextSegment.motion,
        ].filter(Boolean).join("\n"),
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
      await logOnePromptVideo(`${params.logEventPrefix}.submit.success`, {
        userId: params.userId,
        projectId: params.projectId,
        segmentId: nextSegment.id,
        segmentNo: nextSegment.segmentNo,
        startKeyframeNo: nextSegment.startKeyframeNo,
        endKeyframeNo: nextSegment.endKeyframeNo,
        clipTaskId: taskId,
        durationSeconds: nextSegment.durationSeconds,
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
      await logOnePromptVideo(`${params.logEventPrefix}.submit.error`, {
        userId: params.userId,
        projectId: params.projectId,
        segmentId: nextSegment.id,
        segmentNo: nextSegment.segmentNo,
        retryable: isThrottle,
        ...errorForLog(error),
      }, isThrottle ? "warn" : "error");
      if (!isThrottle) throw error;
      break;
    }
  }
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
  } else if (result.status === "failed") {
    await prisma.videoProject.update({
      where: { id: projectId },
      data: {
        status: VideoProjectStatus.FAILED,
        errorMessage: result.errorMessage || "IMS 合成失败",
      },
    });
  }
}

async function requireVideoProject(userId: string, projectId: string): Promise<VideoProjectWithShots> {
  const project = await getVideoProject(userId, projectId);
  if (!project) throw new Error("项目不存在或无权访问");
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
    return `${en}\nUser-facing Chinese revision to respect: ${zh}`;
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
  const consistencyUrls = consistencyReferenceImageUrls(project, keyframe.keyframeNo);
  const isConsistencyReference = isConsistencyKeyframeNo(keyframe.keyframeNo);
  const base = en && zh && zh !== en
    ? `${en}\nUser-facing Chinese revision to respect: ${zh}`
    : en || zh || fallback;
  return [
    base,
    isConsistencyReference && keyframe.keyframeNo === CHARACTER_CONSISTENCY_KEYFRAME_NO
      ? "This is the fixed character consistency reference image for the whole project. Make the person clear, stable, front/three-quarter visible, and easy to reuse as identity guidance."
      : "",
    isConsistencyReference && keyframe.keyframeNo === SCENE_CONSISTENCY_KEYFRAME_NO
      ? "This is the fixed scene consistency reference image for the whole project. Make the environment layout, architecture, materials, product placement, lighting, and color palette clear and stable."
      : "",
    identityLock ? `Hard character identity lock, must be preserved exactly in this still image: ${identityLock}` : "",
    toneLock ? `Hard color tone lock, must be preserved exactly in this still image: ${toneLock}` : "",
    anchorLock ? `Hard project consistency anchors for this still image:\n${anchorLock}` : "",
    consistencyUrls.length && !isConsistencyReference
      ? `Use these generated consistency reference image URLs as visual anchors for this boundary frame: ${consistencyUrls.join(" ; ")}`
      : "",
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

function bilingualNegativePromptForGeneration(source: Record<string, unknown> | undefined, fallback: string): string {
  const en = readPlanShotString(source, ["negativePromptEn", "negative_prompt_en"]);
  const zh = readPlanShotString(source, ["negativePromptZh", "negative_prompt_zh"]);
  if (en && zh && zh !== en) return `${en}\nAlso avoid the user-facing Chinese exclusions: ${zh}`;
  return en || zh || fallback;
}

function isConsistencyKeyframeNo(keyframeNo: number): boolean {
  return keyframeNo === CHARACTER_CONSISTENCY_KEYFRAME_NO || keyframeNo === SCENE_CONSISTENCY_KEYFRAME_NO;
}

function consistencyReferenceImageUrls(
  project: Pick<VideoProjectWithShots, "keyframes">,
  excludeKeyframeNo?: number,
): string[] {
  return project.keyframes
    .filter((keyframe) => isConsistencyKeyframeNo(keyframe.keyframeNo))
    .filter((keyframe) => keyframe.keyframeNo !== excludeKeyframeNo)
    .map((keyframe) => keyframe.imageUrl)
    .filter((url): url is string => Boolean(url));
}

function referenceImageUrlsForKeyframe(
  project: Pick<VideoProjectWithShots, "keyframes" | "referenceImageUrls">,
  keyframe: VideoProjectWithShots["keyframes"][number],
): string[] {
  if (isConsistencyKeyframeNo(keyframe.keyframeNo)) {
    return jsonStringArray(project.referenceImageUrls).slice(0, 4);
  }
  return consistencyReferenceImageUrls(project, keyframe.keyframeNo).slice(0, 4);
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
    action: value.action ?? "",
    camera: value.camera ?? "",
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
    identityLock ? `Hard character identity lock: ${identityLock}` : "",
    toneLock ? `Hard color tone lock: ${toneLock}` : "",
    anchorLock ? `Hard project consistency anchors for this micro-shot:\n${anchorLock}` : "",
    "Describe and render a still moment only. Avoid motion trails, before/after panels, subtitles, labels, watermarks, UI, or added typography.",
  ].filter(Boolean).join("\n");
}

function referenceImageUrlsForMicroShot(
  project: Pick<VideoProjectWithShots, "keyframes" | "referenceImageUrls">,
  segment: VideoProjectWithShots["segments"][number],
): string[] {
  const keyframeMap = new Map(project.keyframes.map((keyframe) => [keyframe.keyframeNo, keyframe.imageUrl]));
  return [
    ...consistencyReferenceImageUrls(project),
    keyframeMap.get(segment.startKeyframeNo),
    keyframeMap.get(segment.endKeyframeNo),
    ...jsonStringArray(project.referenceImageUrls),
  ].filter((url): url is string => Boolean(url)).slice(0, 4);
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
        : readPlanShotString(previous, ["purposeEn", "purpose_en"]) || titleFromPrompt(readPlanShotString(previous, ["imagePromptEn", "image_prompt_en"]) || keyframe.imagePrompt, `Reference frame ${Math.abs(keyframe.keyframeNo)}`);
      return {
        ...previous,
        kind: keyframe.keyframeNo === CHARACTER_CONSISTENCY_KEYFRAME_NO ? "character" as const : "scene" as const,
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
        : readPlanShotString(previous, ["purposeEn", "purpose_en"]) || titleFromPrompt(readPlanShotString(previous, ["imagePromptEn", "image_prompt_en"]) || keyframe.imagePrompt, `Boundary frame ${keyframe.keyframeNo}`);
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
        : readPlanShotString(previous, ["purposeEn", "purpose_en"]) || titleFromPrompt(readPlanShotString(previous, ["videoPromptEn", "video_prompt_en"]) || segment.videoPrompt, `Segment ${segment.segmentNo}`);
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
          : readPlanShotString(previousShots.get(shot.shotNo), ["purposeEn", "purpose_en"]) || titleFromPrompt(readPlanShotString(previousShots.get(shot.shotNo), ["videoPromptEn", "video_prompt_en"]) || shot.videoPrompt, `Shot ${shot.shotNo}`),
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
  await prisma.videoProject.update({
    where: { id: projectId },
    data: { planJson: nextPlan as unknown as Prisma.InputJsonValue },
  });
}
