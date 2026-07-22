import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  queueVideoProjectPlanning,
  serializeVideoProject,
  updateVideoShot,
} from "@/services/video-orchestrator/project-service";
import { normalizePlanInput } from "@/services/video-orchestrator/planner";
import { storyboardStageHttpStatus } from "@/services/video-orchestrator/storyboard-stage-retry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

export async function POST(req: Request, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
  }

  const { projectId } = await ctx.params;
  const body = await readJson(req);
  const input = normalizePlanInput(isRecord(body) ? body : {});
  try {
    const project = await queueVideoProjectPlanning(session.user.id, projectId, input);
    return NextResponse.json({ ok: true, accepted: true, project: serializeVideoProject(project) }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
  }

  const body = await readJson(req);
  if (!isRecord(body) || typeof body.shotId !== "string") {
    return NextResponse.json({ ok: false, error: "缺少 shotId" }, { status: 400 });
  }

  const { projectId } = await ctx.params;
  try {
    const project = await updateVideoShot(session.user.id, projectId, body.shotId, body);
    return NextResponse.json({ ok: true, project: serializeVideoProject(project) });
  } catch (error) {
    return errorResponse(error);
  }
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function errorResponse(error: unknown) {
  return NextResponse.json(
    { ok: false, error: error instanceof Error ? error.message : "操作失败" },
    { status: storyboardStageHttpStatus(error) },
  );
}
