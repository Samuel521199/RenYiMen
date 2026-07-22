import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  rollbackVideoProject,
  serializeVideoProject,
  type VideoProjectRollbackTarget,
} from "@/services/video-orchestrator/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

const ROLLBACK_TARGETS = new Set<VideoProjectRollbackTarget>([
  "PLAN_REVIEW",
  "ASSET_LIBRARY_REVIEW",
  "IMAGE_REVIEW",
  "MICRO_SHOT_REVIEW",
  "CLIP_REVIEW",
]);

export async function POST(req: Request, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
  }

  let targetStatus: VideoProjectRollbackTarget | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    const rawTarget = isRecord(body) ? body.targetStatus : undefined;
    if (typeof rawTarget === "string" && ROLLBACK_TARGETS.has(rawTarget as VideoProjectRollbackTarget)) {
      targetStatus = rawTarget as VideoProjectRollbackTarget;
    }
  } catch {
    targetStatus = undefined;
  }

  const { projectId } = await ctx.params;
  try {
    const project = await rollbackVideoProject(session.user.id, projectId, targetStatus);
    return NextResponse.json({ ok: true, project: serializeVideoProject(project) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "回退失败" },
      { status: 400 },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
