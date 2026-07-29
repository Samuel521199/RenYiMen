import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  continueVideoProjectTaskGraph,
  serializeVideoProject,
} from "@/services/video-orchestrator/project-service";
import {
  commandErrorResponse,
  migrationFrozenCommandResponse,
  unauthorizedCommandResponse,
} from "@/app/api/video-projects/_shared/command-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const frozen = migrationFrozenCommandResponse();
  if (frozen) return frozen;
  const session = await auth();
  if (!session?.user?.id) return unauthorizedCommandResponse();
  const { projectId } = await ctx.params;
  const body = await readBody(req);
  const expectedNodeId = typeof body.expectedNodeId === "string"
    ? body.expectedNodeId.trim()
    : "";
  if (!expectedNodeId) {
    return commandErrorResponse(new Error("expectedNodeId is required"), 400, {
      errorCode: "TASK_GRAPH_NODE_REQUIRED",
      category: "state",
      retryable: false,
      recoveryAction: "REFRESH_PROJECT",
    });
  }
  try {
    const project = await continueVideoProjectTaskGraph(
      session.user.id,
      projectId,
      expectedNodeId,
    );
    return NextResponse.json({
      ok: true,
      acceptedAction: "CONTINUE_TASK_GRAPH",
      project: serializeVideoProject(project),
    }, { status: 202 });
  } catch (error) {
    return commandErrorResponse(error);
  }
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await req.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
