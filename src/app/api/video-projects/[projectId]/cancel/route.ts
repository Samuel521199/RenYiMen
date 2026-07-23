import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { cancelVideoProject, serializeVideoProject } from "@/services/video-orchestrator/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

export async function POST(req: Request, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as {
    confirmation?: string;
    cancelIntentId?: string;
    confirmedAt?: string;
  } | null;
  if (body?.confirmation !== "stop-generation") {
    return NextResponse.json({ ok: false, error: "Explicit stop confirmation is required" }, { status: 400 });
  }
  const confirmedAt = Date.parse(body.confirmedAt ?? "");
  if (
    typeof body.cancelIntentId !== "string" ||
    body.cancelIntentId.length < 12 ||
    !Number.isFinite(confirmedAt) ||
    Math.abs(Date.now() - confirmedAt) > 60_000
  ) {
    return NextResponse.json({ ok: false, error: "A fresh user stop intent is required" }, { status: 400 });
  }

  const { projectId } = await ctx.params;
  try {
    const project = await cancelVideoProject(session.user.id, projectId, {
      cancelIntentId: body.cancelIntentId,
      confirmedAt: body.confirmedAt as string,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({ ok: true, project: serializeVideoProject(project) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Cancel failed" },
      { status: 400 },
    );
  }
}
