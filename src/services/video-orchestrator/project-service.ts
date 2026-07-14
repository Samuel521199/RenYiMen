import { Prisma, VideoProjectStatus, VideoShotStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizePlanInput } from "./planner";
import { scoreShotImage } from "./quality-judge";
import {
  createAliyunStoryboardPlan,
  queryDashScopeTask,
  queryImsComposeJob,
  submitAliyunImageTask,
  submitAliyunImageToVideoTask,
} from "./aliyun-workflow";
import { errorForLog, logOnePromptVideo } from "./logger";
import { composeVideoClipsLocally } from "./local-compose";
import type { CreateVideoProjectInput, OnePromptVideoPlan, UpdateShotInput } from "./types";

const PROJECT_INCLUDE = {
  shots: { orderBy: { shotNo: "asc" as const } },
  keyframes: { orderBy: { keyframeNo: "asc" as const } },
  segments: { orderBy: { segmentNo: "asc" as const } },
};

export type VideoProjectWithShots = Prisma.VideoProjectGetPayload<{
  include: typeof PROJECT_INCLUDE;
}>;

export function serializeVideoProject(project: VideoProjectWithShots) {
  const planShots = readPlanShotMap(project.planJson);
  const planKeyframes = readPlanKeyframeMap(project.planJson);
  const planSegments = readPlanSegmentMap(project.planJson);
  const keyframes = "keyframes" in project ? project.keyframes : [];
  const segments = "segments" in project ? project.segments : [];
  const keyframeMap = new Map(keyframes.map((frame) => [frame.keyframeNo, frame]));
  const compatShots = segments.length
    ? segments.map((segment) => serializeSegmentAsShot(segment, keyframeMap, planShots))
    : project.shots.map((shot) => ({
        ...shot,
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
      imagePromptZh: readPlanShotString(planKeyframes.get(frame.keyframeNo), ["imagePromptZh", "image_prompt_zh"]) || frame.imagePrompt,
      imagePromptEn: readPlanShotString(planKeyframes.get(frame.keyframeNo), ["imagePromptEn", "image_prompt_en"]) || frame.imagePrompt,
      negativePromptZh: readPlanShotString(planKeyframes.get(frame.keyframeNo), ["negativePromptZh", "negative_prompt_zh"]) || toChineseNegativePrompt(frame.negativePrompt),
      negativePromptEn: readPlanShotString(planKeyframes.get(frame.keyframeNo), ["negativePromptEn", "negative_prompt_en"]) || frame.negativePrompt,
      createdAt: frame.createdAt.toISOString(),
      updatedAt: frame.updatedAt.toISOString(),
    })),
    segments: segments.map((segment) => ({
      ...segment,
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

function readPlanMicroShots(shot: Record<string, unknown> | undefined): Array<{
  microShotNo: number;
  localTimeSeconds: number;
  endSeconds?: number;
  absoluteTimeSeconds: number;
  purpose: string;
  scene: string;
  action: string;
  camera?: string;
  referenceType?: "text" | "image_prompt" | "mixed";
  imagePrompt?: string;
  imagePromptZh?: string;
  imagePromptEn?: string;
  prompt: string;
  promptZh?: string;
  promptEn?: string;
}> {
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
    const promptZh = readPlanShotString(item, ["promptZh", "prompt_zh"]);
    const promptEn = readPlanShotString(item, ["promptEn", "prompt_en"]);
    const prompt = readPlanShotString(item, ["prompt"]) || promptZh || promptEn || action || purpose;
    if (!prompt && !purpose && !scene && !action && !imagePrompt) return [];
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
      prompt,
      promptZh,
      promptEn,
    }];
  });
}

export async function listVideoProjects(userId: string): Promise<VideoProjectWithShots[]> {
  await logOnePromptVideo("project.list.request", { userId });
  const projects = await prisma.videoProject.findMany({
    where: { userId },
    include: PROJECT_INCLUDE,
    orderBy: { updatedAt: "desc" },
    take: 20,
  });
  await logOnePromptVideo("project.list.response", {
    userId,
    count: projects.length,
    projects: projects.map((project) => ({ id: project.id, status: project.status, title: project.title })),
  });
  return projects;
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
    shotCount: override?.shotCount ?? (project.segments.length || project.shots.length || 6),
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
  let plan: OnePromptVideoPlan;
  try {
    plan = await createAliyunStoryboardPlan(input);
  } catch (error) {
    await logOnePromptVideo("project.plan.error", { userId, projectId, ...errorForLog(error) }, "error");
    throw error;
  }

  return prisma.$transaction(async (tx) => {
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
    await tx.videoKeyframe.createMany({
      data: plan.keyframes.map((keyframe) => ({
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
    await logOnePromptVideo("project.plan.success", {
      userId,
      projectId,
      title: updated.title,
      status: updated.status,
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

export async function approveShotImages(userId: string, projectId: string): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  const missing = project.keyframes.filter((keyframe) => !keyframe.imageUrl);
  if (missing.length) throw new Error("还有边界参考帧没有生成完成，不能进入视频阶段");
  await logOnePromptVideo("clip.batch.submit.start", {
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

  const clipDurations = (project.segments.length ? project.segments : project.shots).map((item) => item.durationSeconds);
  const finalVideoUrl = await composeVideoClipsLocally({
    projectId,
    title: project.title,
    clipUrls,
    clipDurations,
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
  const stillRunning = latest.keyframes.some((keyframe) => keyframe.status === VideoShotStatus.IMAGE_RUNNING);
  const pending = latest.keyframes.some((keyframe) => keyframe.status === VideoShotStatus.IMAGE_PENDING);
  if (!stillRunning && pending) {
    await submitNextImageTask({
      projectId: project.id,
      keyframes: latest.keyframes,
      logEventPrefix: "image.sync",
    });
  }
}

async function submitNextImageTask(params: {
  userId?: string;
  projectId: string;
  keyframes: VideoProjectWithShots["keyframes"];
  logEventPrefix: string;
}): Promise<void> {
  const running = params.keyframes.find((keyframe) => keyframe.status === VideoShotStatus.IMAGE_RUNNING && keyframe.imageTaskId);
  if (running) {
    await logOnePromptVideo(`${params.logEventPrefix}.submit.skip_running`, {
      userId: params.userId,
      projectId: params.projectId,
      keyframeNo: running.keyframeNo,
      imageTaskId: running.imageTaskId,
    });
    return;
  }

  const nextKeyframe = [...params.keyframes]
    .sort((a, b) => a.keyframeNo - b.keyframeNo)
    .find((keyframe) => {
      if (keyframe.locked && keyframe.imageUrl) return false;
      if (keyframe.imageUrl) return false;
      return keyframe.status !== VideoShotStatus.IMAGE_READY && keyframe.status !== VideoShotStatus.IMAGE_APPROVED;
    });
  if (!nextKeyframe) {
    await logOnePromptVideo(`${params.logEventPrefix}.submit.no_pending`, {
      userId: params.userId,
      projectId: params.projectId,
    });
    return;
  }

  const project = await prisma.videoProject.findUnique({
    where: { id: params.projectId },
    include: PROJECT_INCLUDE,
  });
  if (!project) return;

  try {
    const taskId = await submitAliyunImageTask({
      prompt: generationPromptForKeyframe(project, nextKeyframe),
      negativePrompt: generationNegativePromptForKeyframe(project, nextKeyframe),
      aspectRatio: project.aspectRatio as "9:16" | "16:9" | "1:1",
      seed: nextKeyframe.keyframeNo,
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
  const stillRunning = latest.segments.some((segment) => segment.status === VideoShotStatus.CLIP_RUNNING);
  const pending = latest.segments.some((segment) => segment.status === VideoShotStatus.CLIP_PENDING);
  if (!stillRunning && pending) {
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
  const running = params.segments.find((segment) => segment.status === VideoShotStatus.CLIP_RUNNING && segment.clipTaskId);
  if (running) {
    await logOnePromptVideo(`${params.logEventPrefix}.submit.skip_running`, {
      userId: params.userId,
      projectId: params.projectId,
      segmentNo: running.segmentNo,
      clipTaskId: running.clipTaskId,
    });
    return;
  }

  const keyframeMap = new Map(params.keyframes.map((keyframe) => [keyframe.keyframeNo, keyframe]));
  const nextSegment = [...params.segments]
    .sort((a, b) => a.segmentNo - b.segmentNo)
    .find((segment) => {
      const start = keyframeMap.get(segment.startKeyframeNo);
      const end = keyframeMap.get(segment.endKeyframeNo);
      return Boolean(
        start?.imageUrl &&
          end?.imageUrl &&
          !segment.clipUrl &&
          segment.status !== VideoShotStatus.CLIP_READY &&
          segment.status !== VideoShotStatus.CLIP_APPROVED,
      );
    });
  const startKeyframe = nextSegment ? keyframeMap.get(nextSegment.startKeyframeNo) : undefined;
  const endKeyframe = nextSegment ? keyframeMap.get(nextSegment.endKeyframeNo) : undefined;

  if (!nextSegment || !startKeyframe?.imageUrl || !endKeyframe?.imageUrl) {
    await logOnePromptVideo(`${params.logEventPrefix}.submit.no_pending`, {
      userId: params.userId,
      projectId: params.projectId,
    });
    return;
  }

  const project = await prisma.videoProject.findUnique({
    where: { id: params.projectId },
    include: PROJECT_INCLUDE,
  });
  if (!project) return;

  try {
    const taskId = await submitAliyunImageToVideoTask({
      imageUrl: startKeyframe.imageUrl,
      lastFrameUrl: endKeyframe.imageUrl,
      prompt: [
        generationPromptForSegment(project, nextSegment),
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
  project: Pick<VideoProjectWithShots, "planJson">,
  keyframe: VideoProjectWithShots["keyframes"][number],
): string {
  const planKeyframe = readPlanKeyframeMap(project.planJson).get(keyframe.keyframeNo);
  const en = readPlanShotString(planKeyframe, ["imagePromptEn", "image_prompt_en"]);
  const zh = readPlanShotString(planKeyframe, ["imagePromptZh", "image_prompt_zh"]);
  const fallback = keyframe.imagePrompt;
  const identityLock = characterIdentityLockForPrompt(project.planJson);
  const base = en && zh && zh !== en
    ? `${en}\nUser-facing Chinese revision to respect: ${zh}`
    : en || zh || fallback;
  return [
    base,
    identityLock ? `Hard character identity lock, must be preserved exactly in this still image: ${identityLock}` : "",
    "If the main person appears, keep the exact same face, age, hairstyle, hair color, outfit, body type, skin tone, and distinctive accessories as in all other boundary reference frames. Do not generate a different-looking person.",
    "Generate exactly one still boundary reference image only. Timeline labels such as 0s, 30s, or the final duration are placement metadata, not image duration and not video duration.",
  ].filter(Boolean).join("\n");
}

function generationNegativePromptForKeyframe(
  project: Pick<VideoProjectWithShots, "planJson">,
  keyframe: VideoProjectWithShots["keyframes"][number],
): string {
  const planKeyframe = readPlanKeyframeMap(project.planJson).get(keyframe.keyframeNo);
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
  const negativePrompt = generationNegativePromptForSegment(project, segment);
  const fallback = segment.videoPrompt;
  const base = en && zh && zh !== en
    ? `${en}\nUser-facing Chinese revision to respect: ${zh}`
    : en || zh || fallback;
  const additions = [
    boundaryMode ? `Boundary transition mode: ${boundaryMode}.` : "",
    outputMode ? `Output constraint mode: ${outputMode}.` : "",
    identityLock ? `Hard character identity lock for the entire video segment:\n${identityLock}\nPreserve the same person across all frames. Do not morph into a different face, age, hairstyle, outfit, or body type.` : "",
    negativePrompt ? `Avoid / negative prompt:\n${negativePrompt}` : "",
    audioPlan ? audioPromptInstruction(audioPlan) : "",
    constraints.length ? `Segment constraints:\n${constraints.map((item) => `- ${item}`).join("\n")}` : "",
    microShots.length
      ? `Internal storyboard controls for this ${segment.durationSeconds}s segment:\n${microShots.map((item) => {
          const parts = [
            `+${item.localTimeSeconds}s`,
            item.purpose ? `purpose: ${item.purpose}` : "",
            item.scene ? `scene: ${item.scene}` : "",
            item.action ? `action: ${item.action}` : "",
            item.camera ? `camera: ${item.camera}` : "",
            item.imagePromptEn || item.imagePromptZh || item.imagePrompt ? `reference image prompt: ${item.imagePromptEn || item.imagePromptZh || item.imagePrompt}` : "",
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

async function syncPlanJsonFromShots(
  projectId: string,
  localizedUpdate?: {
    shotId: string;
    locale?: "zh" | "en";
    microShots?: UpdateShotInput["microShots"];
    negativePromptUpdated?: boolean;
  },
): Promise<void> {
  const project = await prisma.videoProject.findUnique({
    where: { id: projectId },
    include: PROJECT_INCLUDE,
  });
  if (!project?.planJson) return;

  const plan = project.planJson as unknown as OnePromptVideoPlan;

  if (project.segments.length && project.keyframes.length) {
    const previousKeyframes = readPlanKeyframeMap(project.planJson);
    const previousSegments = readPlanSegmentMap(project.planJson);
    const updatedSegment = localizedUpdate
      ? project.segments.find((segment) => segment.id === localizedUpdate.shotId)
      : undefined;
    const updatedKeyframe = localizedUpdate
      ? project.keyframes.find((keyframe) => keyframe.id === localizedUpdate.shotId)
      : undefined;
    const updatedStartKeyframeNo = updatedSegment?.startKeyframeNo ?? updatedKeyframe?.keyframeNo;

    const nextKeyframes = project.keyframes.map((keyframe) => {
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
      return {
        ...previous,
        keyframeNo: keyframe.keyframeNo,
        timeSeconds: keyframe.timeSeconds,
        purpose: keyframe.purpose,
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

    const keyframeMap = new Map(project.keyframes.map((keyframe) => [keyframe.keyframeNo, keyframe]));
    const nextShots = project.segments.map((segment) => {
      const start = keyframeMap.get(segment.startKeyframeNo);
      const planSegment = nextSegments.find((item) => item.segmentNo === segment.segmentNo);
      const planKeyframe = nextKeyframes.find((item) => item.keyframeNo === segment.startKeyframeNo);
      return {
        shotNo: segment.segmentNo,
        durationSeconds: segment.durationSeconds,
        purpose: segment.purpose,
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
      keyframeCount: project.keyframes.length,
      segmentCount: project.segments.length,
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
