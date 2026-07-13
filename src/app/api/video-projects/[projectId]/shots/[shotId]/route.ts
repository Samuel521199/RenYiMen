import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { serializeVideoProject, updateVideoShot } from "@/services/video-orchestrator/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ projectId: string; shotId: string }>;
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
  }

  const body = await readJson(req);
  const { projectId, shotId } = await ctx.params;
  try {
    const project = await updateVideoShot(session.user.id, projectId, shotId, isRecord(body) ? body : {});
    return NextResponse.json({ ok: true, project: serializeVideoProject(project) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "操作失败" },
      { status: 400 },
    );
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
