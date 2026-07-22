import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { approveAssetLibrary, serializeVideoProject } from "@/services/video-orchestrator/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

export async function POST(_req: Request, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await ctx.params;
  try {
    const project = await approveAssetLibrary(session.user.id, projectId);
    return NextResponse.json({ ok: true, project: serializeVideoProject(project) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Approve assets failed" },
      { status: 400 },
    );
  }
}
