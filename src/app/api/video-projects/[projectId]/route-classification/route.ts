import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  serializeVideoProject,
  updateUserPlanningRoute,
} from "@/services/video-orchestrator/project-service";
import type {
  VideoChronologyMode,
  VideoCreativeCategory,
  VideoCreativeTemplateId,
  VideoHookMode,
  VideoHookRevealLevel,
} from "@/services/video-orchestrator/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
  }
  try {
    const body = await req.json();
    if (!isRecord(body)) throw new Error("请求体必须是 JSON 对象");
    const { projectId } = await ctx.params;
    const project = await updateUserPlanningRoute(session.user.id, projectId, {
      videoCategory: requiredString(body.videoCategory, "videoCategory") as VideoCreativeCategory,
      templateId: requiredString(body.templateId, "templateId") as VideoCreativeTemplateId,
      chronologyMode: requiredString(body.chronologyMode, "chronologyMode") as VideoChronologyMode,
      hookMode: requiredString(body.hookMode, "hookMode") as VideoHookMode,
      hookRevealLevel: requiredString(body.hookRevealLevel, "hookRevealLevel") as VideoHookRevealLevel,
      requiresReturnPoint: body.requiresReturnPoint === true,
    });
    return NextResponse.json({
      ok: true,
      accepted: project.status === "PLANNING",
      project: serializeVideoProject(project),
    }, { status: project.status === "PLANNING" ? 202 : 200 });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "保存任务分类与叙事路线失败",
    }, { status: 400 });
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
