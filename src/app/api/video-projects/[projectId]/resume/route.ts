import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  continueVideoProjectTaskGraph,
  repairVideoProjectContract,
  retryVideoProductionJobCommand,
  serializeVideoProject,
} from "@/services/video-orchestrator/project-service";
import {
  commandErrorResponse,
  migrationFrozenCommandResponse,
  unauthorizedCommandResponse,
} from "@/app/api/video-projects/_shared/command-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LegacyExplicitAction =
  | "CONTINUE_TASK_GRAPH"
  | "RETRY_JOB"
  | "REPAIR_CONTRACT";

/**
 * Compatibility endpoint only. It intentionally contains no project-state
 * heuristics: the caller must provide one explicit command and its target.
 */
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
  const action = typeof body.action === "string"
    ? body.action.trim() as LegacyExplicitAction
    : "";
  try {
    const project = action === "CONTINUE_TASK_GRAPH"
      ? await continueVideoProjectTaskGraph(
          session.user.id,
          projectId,
          stringField(body.expectedNodeId),
        )
      : action === "RETRY_JOB"
        ? await retryVideoProductionJobCommand(
            session.user.id,
            projectId,
            stringField(body.jobId),
          )
        : action === "REPAIR_CONTRACT"
          ? await repairVideoProjectContract(
              session.user.id,
              projectId,
              stringField(body.jobId),
            )
          : null;
    if (!project) {
      return commandErrorResponse(new Error("An explicit compatibility action is required"), 400, {
        errorCode: "EXPLICIT_RESUME_ACTION_REQUIRED",
        category: "state",
        retryable: false,
        recoveryAction: "USE_COMMAND_ENDPOINT",
      });
    }
    return NextResponse.json({
      ok: true,
      acceptedAction: action,
      deprecatedEndpoint: true,
      project: serializeVideoProject(project),
    }, {
      status: 202,
      headers: {
        Deprecation: "true",
        Sunset: "Wed, 30 Sep 2026 00:00:00 GMT",
        Link: `</api/video-projects/${projectId}/continue-task-graph>; rel="successor-version"`,
      },
    });
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

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
