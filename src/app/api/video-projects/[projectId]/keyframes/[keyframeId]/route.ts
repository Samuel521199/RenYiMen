import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { serializeVideoProject, updateVideoKeyframe } from "@/services/video-orchestrator/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ projectId: string; keyframeId: string }>;
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Unauthorized", errorCode: "UNAUTHORIZED" }, { status: 401 });
  }
  const { projectId, keyframeId } = await ctx.params;
  const body = await readJson(req);
  try {
    const project = await updateVideoKeyframe(session.user.id, projectId, keyframeId, body);
    return NextResponse.json({ ok: true, project: serializeVideoProject(project) });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Keyframe update failed",
      errorCode: error instanceof Error && error.name ? error.name : "KEYFRAME_UPDATE_FAILED",
    }, { status: 400 });
  }
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await req.json();
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
