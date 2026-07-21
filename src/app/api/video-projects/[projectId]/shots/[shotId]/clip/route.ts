import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { regenerateShotClip, serializeVideoProject } from "@/services/video-orchestrator/project-service";

interface RouteParams {
  params: Promise<{ projectId: string; shotId: string }>;
}

export async function POST(_request: Request, context: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { projectId, shotId } = await context.params;
  try {
    const project = await regenerateShotClip(session.user.id, projectId, shotId);
    return NextResponse.json({ ok: true, project: serializeVideoProject(project) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Clip regeneration failed" },
      { status: 400 },
    );
  }
}
