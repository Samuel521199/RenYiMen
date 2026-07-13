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
  submitImsComposeJob,
} from "./aliyun-workflow";
import { errorForLog, logOnePromptVideo } from "./logger";
import type { CreateVideoProjectInput, OnePromptVideoPlan, UpdateShotInput } from "./types";

const PROJECT_INCLUDE = {
  shots: { orderBy: { shotNo: "asc" as const } },
};

export type VideoProjectWithShots = Prisma.VideoProjectGetPayload<{
  include: typeof PROJECT_INCLUDE;
}>;

export function serializeVideoProject(project: VideoProjectWithShots) {
  const planShots = readPlanShotMap(project.planJson);
  return {
    ...project,
    referenceImageUrls: jsonStringArray(project.referenceImageUrls),
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    shots: project.shots.map((shot) => ({
      ...shot,
      imagePromptZh: readPlanShotString(planShots.get(shot.shotNo), ["imagePromptZh", "image_prompt_zh"]) || shot.imagePrompt,
      imagePromptEn: readPlanShotString(planShots.get(shot.shotNo), ["imagePromptEn", "image_prompt_en"]) || shot.imagePrompt,
      videoPromptZh: readPlanShotString(planShots.get(shot.shotNo), ["videoPromptZh", "video_prompt_zh"]) || shot.videoPrompt,
      videoPromptEn: readPlanShotString(planShots.get(shot.shotNo), ["videoPromptEn", "video_prompt_en"]) || shot.videoPrompt,
      createdAt: shot.createdAt.toISOString(),
      updatedAt: shot.updatedAt.toISOString(),
    })),
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

function readPlanShotString(shot: Record<string, unknown> | undefined, keys: string[]): string {
  if (!shot) return "";
  for (const key of keys) {
    const value = shot[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
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
    shotCount: planInput.shotCount,
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
    shotCount: override?.shotCount ?? (project.shots.length || 6),
    stylePreset: override?.stylePreset ?? project.stylePreset,
    referenceImageUrls: override?.referenceImageUrls ?? jsonStringArray(project.referenceImageUrls),
  });
  await logOnePromptVideo("project.plan.start", {
    userId,
    projectId,
    status: project.status,
    shotCount: input.shotCount,
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
    await tx.videoShot.createMany({
      data: plan.shots.map((shot) => ({
        projectId: project.id,
        shotNo: shot.shotNo,
        status: VideoShotStatus.SCRIPT_READY,
        durationSeconds: shot.durationSeconds,
        purpose: shot.purpose,
        camera: shot.camera,
        action: shot.action,
        imagePrompt: shot.imagePromptZh ?? shot.imagePrompt,
        videoPrompt: shot.videoPromptZh ?? shot.videoPrompt,
        negativePrompt: shot.negativePrompt,
        subtitle: shot.subtitle,
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
      shotCount: updated.shots.length,
      shots: updated.shots.map((shot) => ({ id: shot.id, shotNo: shot.shotNo, durationSeconds: shot.durationSeconds })),
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
  await requireVideoProject(userId, projectId);
  const data: Prisma.VideoShotUpdateInput = {};

  if (typeof input.purpose === "string") data.purpose = input.purpose;
  if (typeof input.camera === "string") data.camera = input.camera;
  if (typeof input.action === "string") data.action = input.action;
  if (typeof input.imagePrompt === "string") data.imagePrompt = input.imagePrompt;
  if (typeof input.videoPrompt === "string") data.videoPrompt = input.videoPrompt;
  if (typeof input.negativePrompt === "string") data.negativePrompt = input.negativePrompt;
  if (typeof input.subtitle === "string") data.subtitle = input.subtitle;
  if (typeof input.durationSeconds === "number") {
    data.durationSeconds = Math.max(1, Math.min(10, Math.round(input.durationSeconds)));
  }
  if (typeof input.locked === "boolean") {
    data.locked = input.locked;
    data.status = input.locked ? VideoShotStatus.IMAGE_APPROVED : VideoShotStatus.IMAGE_READY;
  }

  await prisma.videoShot.update({
    where: { id: shotId, projectId },
    data,
  });
  await syncPlanJsonFromShots(projectId, { shotId, locale: input.locale });
  await logOnePromptVideo("shot.update.success", {
    userId,
    projectId,
    shotId,
    updatedFields: Object.keys(data),
  });
  return requireVideoProject(userId, projectId);
}

export async function approveVideoPlan(userId: string, projectId: string): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  await logOnePromptVideo("image.batch.submit.start", {
    userId,
    projectId,
    shotCount: project.shots.length,
    status: project.status,
  });

  for (const shot of project.shots) {
    if (shot.locked && shot.imageUrl) continue;
    let taskId: string;
    try {
      taskId = await submitAliyunImageTask({
        prompt: [generationPromptForShot(project, shot, "image"), shot.negativePrompt ? `Negative prompt: ${shot.negativePrompt}` : ""]
          .filter(Boolean)
          .join("\n"),
        aspectRatio: project.aspectRatio as "9:16" | "16:9" | "1:1",
        seed: shot.shotNo,
      });
    } catch (error) {
      await logOnePromptVideo("image.submit.error", { userId, projectId, shotId: shot.id, shotNo: shot.shotNo, ...errorForLog(error) }, "error");
      throw error;
    }
    await prisma.videoShot.update({
      where: { id: shot.id },
      data: {
        imageTaskId: taskId,
        imageUrl: null,
        status: VideoShotStatus.IMAGE_RUNNING,
        qualityScore: null,
        errorMessage: null,
      },
    });
    await logOnePromptVideo("image.submit.success", {
      userId,
      projectId,
      shotId: shot.id,
      shotNo: shot.shotNo,
      imageTaskId: taskId,
    });
  }

  const updated = await prisma.videoProject.update({
    where: { id: project.id },
    data: { status: VideoProjectStatus.IMAGE_GENERATING, errorMessage: null },
    include: PROJECT_INCLUDE,
  });
  await logOnePromptVideo("image.batch.submit.done", { userId, projectId, status: updated.status });
  return updated;
}

export async function regenerateShotImage(
  userId: string,
  projectId: string,
  shotId: string,
): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  const shot = project.shots.find((item) => item.id === shotId);
  if (!shot) throw new Error("镜头不存在");
  if (shot.locked) throw new Error("镜头已锁定，请先解锁再重生成");

  await logOnePromptVideo("image.regenerate.start", { userId, projectId, shotId, shotNo: shot.shotNo });
  const taskId = await submitAliyunImageTask({
    prompt: [generationPromptForShot(project, shot, "image"), shot.negativePrompt ? `Negative prompt: ${shot.negativePrompt}` : ""]
      .filter(Boolean)
      .join("\n"),
    aspectRatio: project.aspectRatio as "9:16" | "16:9" | "1:1",
    seed: Date.now() % 2147483647,
  });
  await prisma.videoShot.update({
    where: { id: shot.id },
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
  await logOnePromptVideo("image.regenerate.success", { userId, projectId, shotId, shotNo: shot.shotNo, imageTaskId: taskId });
  return updated;
}

export async function approveShotImages(userId: string, projectId: string): Promise<VideoProjectWithShots> {
  const project = await requireVideoProject(userId, projectId);
  const missing = project.shots.filter((shot) => !shot.imageUrl);
  if (missing.length) throw new Error("还有镜头没有关键帧，不能进入视频阶段");
  await logOnePromptVideo("clip.batch.submit.start", {
    userId,
    projectId,
    shotCount: project.shots.length,
    status: project.status,
  });

  await prisma.videoShot.updateMany({
    where: { projectId, imageUrl: { not: null } },
    data: { status: VideoShotStatus.CLIP_PENDING, locked: true, errorMessage: null },
  });
  await submitNextClipTask({
    userId,
    projectId,
    shots: project.shots,
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
    throw new Error("当前项目还不能合成成片");
  }

  const clipUrls = project.shots.map((shot) => shot.clipUrl).filter((url): url is string => Boolean(url));
  if (clipUrls.length !== project.shots.length) throw new Error("还有镜头视频未生成完成，不能合成成片");
  await logOnePromptVideo("compose.submit.start", {
    userId,
    projectId,
    status: project.status,
    clipCount: clipUrls.length,
    title: project.title,
  });

  const jobId = await submitImsComposeJob({
    projectId,
    title: project.title,
    clipUrls,
    aspectRatio: project.aspectRatio as "9:16" | "16:9" | "1:1",
  });

  await prisma.videoShot.updateMany({
    where: { projectId },
    data: { status: VideoShotStatus.CLIP_APPROVED, locked: true, errorMessage: null },
  });

  const updated = await prisma.videoProject.update({
    where: { id: projectId },
    data: {
      status: VideoProjectStatus.COMPOSING,
      composeTaskId: jobId,
      errorMessage: null,
    },
    include: PROJECT_INCLUDE,
  });
  await logOnePromptVideo("compose.submit.success", { userId, projectId, composeTaskId: jobId, status: updated.status });
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
    shots: project.shots.map((shot) => ({
      shotNo: shot.shotNo,
      status: shot.status,
      imageTaskId: shot.imageTaskId,
      clipTaskId: shot.clipTaskId,
      hasImageUrl: Boolean(shot.imageUrl),
      hasClipUrl: Boolean(shot.clipUrl),
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
  const running = project.shots.filter((shot) => shot.status === VideoShotStatus.IMAGE_RUNNING && shot.imageTaskId);
  await logOnePromptVideo("image.sync.start", {
    projectId: project.id,
    runningCount: running.length,
    taskIds: running.map((shot) => ({ shotNo: shot.shotNo, imageTaskId: shot.imageTaskId })),
  });
  for (const shot of running) {
    const result = await queryDashScopeTask(shot.imageTaskId as string);
    await logOnePromptVideo("image.sync.shot.result", {
      projectId: project.id,
      shotId: shot.id,
      shotNo: shot.shotNo,
      imageTaskId: shot.imageTaskId,
      status: result.status,
      resultUrl: result.resultUrl,
      errorMessage: result.errorMessage,
    }, result.status === "failed" ? "error" : "info");
    if (result.status === "succeeded" && result.resultUrl) {
      await prisma.videoShot.update({
        where: { id: shot.id },
        data: {
          imageUrl: result.resultUrl,
          status: VideoShotStatus.IMAGE_READY,
          qualityScore: scoreShotImage({ ...shot, imageUrl: result.resultUrl }),
          errorMessage: null,
        },
      });
    } else if (result.status === "failed") {
      await prisma.videoShot.update({
        where: { id: shot.id },
        data: { status: VideoShotStatus.FAILED, errorMessage: result.errorMessage || "关键帧生成失败" },
      });
    }
  }

  const latest = await prisma.videoProject.findUnique({ where: { id: project.id }, include: PROJECT_INCLUDE });
  if (!latest) return;
  const failed = latest.shots.find((shot) => shot.status === VideoShotStatus.FAILED);
  if (failed) {
    await prisma.videoProject.update({
      where: { id: project.id },
      data: { status: VideoProjectStatus.FAILED, errorMessage: failed.errorMessage || "关键帧生成失败" },
    });
    await logOnePromptVideo("image.sync.project.failed", {
      projectId: project.id,
      failedShotNo: failed.shotNo,
      errorMessage: failed.errorMessage,
    }, "error");
    return;
  }
  if (latest.shots.length > 0 && latest.shots.every((shot) => Boolean(shot.imageUrl))) {
    await prisma.videoProject.update({
      where: { id: project.id },
      data: { status: VideoProjectStatus.IMAGE_REVIEW, errorMessage: null },
    });
    await logOnePromptVideo("image.sync.project.ready", {
      projectId: project.id,
      status: VideoProjectStatus.IMAGE_REVIEW,
      imageCount: latest.shots.length,
    });
  }
}

async function syncClipTasks(project: VideoProjectWithShots): Promise<void> {
  const running = project.shots.filter((shot) => shot.status === VideoShotStatus.CLIP_RUNNING && shot.clipTaskId);
  await logOnePromptVideo("clip.sync.start", {
    projectId: project.id,
    runningCount: running.length,
    taskIds: running.map((shot) => ({ shotNo: shot.shotNo, clipTaskId: shot.clipTaskId })),
  });
  for (const shot of running) {
    const result = await queryDashScopeTask(shot.clipTaskId as string);
    await logOnePromptVideo("clip.sync.shot.result", {
      projectId: project.id,
      shotId: shot.id,
      shotNo: shot.shotNo,
      clipTaskId: shot.clipTaskId,
      status: result.status,
      resultUrl: result.resultUrl,
      errorMessage: result.errorMessage,
    }, result.status === "failed" ? "error" : "info");
    if (result.status === "succeeded" && result.resultUrl) {
      await prisma.videoShot.update({
        where: { id: shot.id },
        data: {
          clipUrl: result.resultUrl,
          status: VideoShotStatus.CLIP_READY,
          errorMessage: null,
        },
      });
    } else if (result.status === "failed") {
      await prisma.videoShot.update({
        where: { id: shot.id },
        data: { status: VideoShotStatus.FAILED, errorMessage: result.errorMessage || "视频片段生成失败" },
      });
    }
  }

  const latest = await prisma.videoProject.findUnique({ where: { id: project.id }, include: PROJECT_INCLUDE });
  if (!latest) return;
  const failed = latest.shots.find((shot) => shot.status === VideoShotStatus.FAILED);
  if (failed) {
    await prisma.videoProject.update({
      where: { id: project.id },
      data: { status: VideoProjectStatus.FAILED, errorMessage: failed.errorMessage || "视频片段生成失败" },
    });
    await logOnePromptVideo("clip.sync.project.failed", {
      projectId: project.id,
      failedShotNo: failed.shotNo,
      errorMessage: failed.errorMessage,
    }, "error");
    return;
  }
  const stillRunning = latest.shots.some((shot) => shot.status === VideoShotStatus.CLIP_RUNNING);
  const pending = latest.shots.some((shot) => shot.status === VideoShotStatus.CLIP_PENDING && shot.imageUrl);
  if (!stillRunning && pending) {
    await submitNextClipTask({
      projectId: project.id,
      shots: latest.shots,
      logEventPrefix: "clip.sync",
    });
    return;
  }
  if (latest.shots.length > 0 && latest.shots.every((shot) => Boolean(shot.clipUrl))) {
    await prisma.videoProject.update({
      where: { id: project.id },
      data: { status: VideoProjectStatus.CLIP_REVIEW, errorMessage: null },
    });
    await logOnePromptVideo("clip.sync.project.ready", {
      projectId: project.id,
      status: VideoProjectStatus.CLIP_REVIEW,
      clipCount: latest.shots.length,
    });
  }
}

async function submitNextClipTask(params: {
  userId?: string;
  projectId: string;
  shots: VideoProjectWithShots["shots"];
  logEventPrefix: string;
}): Promise<void> {
  const running = params.shots.find((shot) => shot.status === VideoShotStatus.CLIP_RUNNING && shot.clipTaskId);
  if (running) {
    await logOnePromptVideo(`${params.logEventPrefix}.submit.skip_running`, {
      userId: params.userId,
      projectId: params.projectId,
      shotNo: running.shotNo,
      clipTaskId: running.clipTaskId,
    });
    return;
  }

  const nextShot = [...params.shots]
    .sort((a, b) => a.shotNo - b.shotNo)
    .find((shot) => shot.imageUrl && !shot.clipUrl && shot.status !== VideoShotStatus.CLIP_READY && shot.status !== VideoShotStatus.CLIP_APPROVED);
  if (!nextShot?.imageUrl) {
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
      imageUrl: nextShot.imageUrl,
      prompt: [generationPromptForShot(project, nextShot, "video"), nextShot.camera, nextShot.action].filter(Boolean).join("\n"),
      durationSeconds: nextShot.durationSeconds,
    });
    await prisma.videoShot.update({
      where: { id: nextShot.id },
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
      shotId: nextShot.id,
      shotNo: nextShot.shotNo,
      clipTaskId: taskId,
      durationSeconds: nextShot.durationSeconds,
    });
  } catch (error) {
    const isThrottle = error instanceof Error && /Throttling|RateQuota|rate limit/i.test(error.message);
    await prisma.videoShot.update({
      where: { id: nextShot.id },
      data: {
        status: VideoShotStatus.CLIP_PENDING,
        errorMessage: isThrottle ? "阿里云限流，稍后自动重试" : error instanceof Error ? error.message : "视频片段提交失败",
      },
    });
    await logOnePromptVideo(`${params.logEventPrefix}.submit.error`, {
      userId: params.userId,
      projectId: params.projectId,
      shotId: nextShot.id,
      shotNo: nextShot.shotNo,
      retryable: isThrottle,
      ...errorForLog(error),
    }, isThrottle ? "warn" : "error");
    if (!isThrottle) throw error;
  }
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

async function syncPlanJsonFromShots(
  projectId: string,
  localizedUpdate?: { shotId: string; locale?: "zh" | "en" },
): Promise<void> {
  const project = await prisma.videoProject.findUnique({
    where: { id: projectId },
    include: PROJECT_INCLUDE,
  });
  if (!project?.planJson || !project.shots.length) return;
  const plan = project.planJson as unknown as OnePromptVideoPlan;
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
    })),
  };
  await prisma.videoProject.update({
    where: { id: projectId },
    data: { planJson: nextPlan as unknown as Prisma.InputJsonValue },
  });
}
