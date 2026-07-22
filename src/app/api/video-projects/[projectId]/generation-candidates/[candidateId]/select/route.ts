import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { selectGenerationCandidate, serializeVideoProject } from "@/services/video-orchestrator/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ projectId: string; candidateId: string }>;
}

export async function POST(req: Request, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { projectId, candidateId } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { acceptFailed?: unknown };
  try {
    const project = await selectGenerationCandidate(session.user.id, projectId, candidateId, body.acceptFailed === true);
    return NextResponse.json({ ok: true, project: serializeVideoProject(project) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Candidate selection failed" }, { status: 400 });
  }
}
