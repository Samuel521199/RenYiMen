import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  repairVideoProjectContract,
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
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  if (!jobId) {
    return commandErrorResponse(new Error("jobId is required"), 400, {
      errorCode: "REPAIR_JOB_ID_REQUIRED",
      category: "state",
      retryable: false,
      recoveryAction: "REFRESH_PROJECT",
    });
  }
  try {
    const project = await repairVideoProjectContract(
      session.user.id,
      projectId,
      jobId,
    );
    return NextResponse.json({
      ok: true,
      acceptedAction: "REPAIR_CONTRACT",
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
