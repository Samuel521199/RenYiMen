import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  retryGenerationCandidateQuality,
  serializeVideoProject,
} from "@/services/video-orchestrator/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ projectId: string; candidateId: string }>;
}

export async function POST(_req: Request, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { projectId, candidateId } = await ctx.params;
  try {
    const project = await retryGenerationCandidateQuality(session.user.id, projectId, candidateId);
    return NextResponse.json({ ok: true, project: serializeVideoProject(project) });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Quality evaluation retry failed",
    }, { status: 400 });
  }
}
