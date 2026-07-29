import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { commandErrorResponse, migrationFrozenCommandResponse, unauthorizedCommandResponse } from "@/app/api/video-projects/_shared/command-response";
import { composeVideoProject, serializeVideoProject } from "@/services/video-orchestrator/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const frozen = migrationFrozenCommandResponse();
  if (frozen) return frozen;
  const session = await auth();
  if (!session?.user?.id) return unauthorizedCommandResponse();
  const { projectId } = await ctx.params;
  try {
    const project = await composeVideoProject(session.user.id, projectId);
    return NextResponse.json({
      ok: true,
      acceptedAction: "COMPOSE",
      project: serializeVideoProject(project),
    }, { status: 202 });
  } catch (error) {
    return commandErrorResponse(error, 400, {
      errorCode: "COMPOSE_COMMAND_FAILED",
      category: "state",
      retryable: false,
      recoveryAction: "REFRESH_PROJECT",
    });
  }
}
