import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  deleteVideoProject,
  getVideoProject,
  serializeVideoProject,
  updateVideoProject,
} from "@/services/video-orchestrator/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
  }

  const { projectId } = await ctx.params;
  const project = await getVideoProject(session.user.id, projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "项目不存在或无权访问" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, project: serializeVideoProject(project) });
}

export async function PATCH(req: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "请求体不是合法 JSON" }, { status: 400 });
    }

    const { projectId } = await ctx.params;
    const input = isRecord(body) && typeof body.title === "string" ? { title: body.title } : {};
    const project = await updateVideoProject(session.user.id, projectId, input);
    return NextResponse.json({ ok: true, project: serializeVideoProject(project) });
  } catch (error) {
    console.error("[video-projects] PATCH failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "项目更新失败" },
      { status: 400 },
    );
  }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
    }

    const { projectId } = await ctx.params;
    await deleteVideoProject(session.user.id, projectId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[video-projects] DELETE failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "项目删除失败" },
      { status: 400 },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
