import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { regenerateSegmentClip, serializeVideoProject } from "@/services/video-orchestrator/project-service";
import { executionContractErrorDetails } from "@/services/video-orchestrator/execution-contract-error";

interface RouteParams {
  params: Promise<{ projectId: string; segmentId: string }>;
}

export async function POST(_request: Request, context: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { projectId, segmentId } = await context.params;
  try {
    const project = await regenerateSegmentClip(session.user.id, projectId, segmentId);
    return NextResponse.json({ ok: true, project: serializeVideoProject(project) });
  } catch (error) {
    const contractError = executionContractErrorDetails(error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Clip regeneration failed",
        ...(contractError ?? {}),
      },
      { status: contractError ? 409 : 400 },
    );
  }
}
