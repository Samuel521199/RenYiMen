import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { rollbackVideoMedia, serializeVideoProject } from "@/services/video-orchestrator/project-service";
import type { RollbackVideoMediaInput, VideoMediaRevisionKind } from "@/services/video-orchestrator/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

const MEDIA_KINDS = new Set<VideoMediaRevisionKind>([
  "keyframe_image",
  "micro_shot_image",
  "segment_clip",
  "transition_reference",
  "generated_bridge",
  "final_video",
]);

export async function POST(req: Request, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!isRecord(body) || !MEDIA_KINDS.has(body.kind as VideoMediaRevisionKind) || typeof body.targetId !== "string") {
    return NextResponse.json({ ok: false, error: "Invalid media rollback request" }, { status: 400 });
  }
  const input: RollbackVideoMediaInput = {
    kind: body.kind as VideoMediaRevisionKind,
    targetId: body.targetId,
    microShotNo: Number.isInteger(Number(body.microShotNo)) ? Number(body.microShotNo) : undefined,
  };

  try {
    const project = await rollbackVideoMedia(session.user.id, projectId, input);
    return NextResponse.json({ ok: true, project: serializeVideoProject(project) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Media rollback failed" },
      { status: 400 },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
