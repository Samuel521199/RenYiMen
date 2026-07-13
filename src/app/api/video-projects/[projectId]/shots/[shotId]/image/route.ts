import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { regenerateShotImage, serializeVideoProject } from "@/services/video-orchestrator/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ projectId: string; shotId: string }>;
}

export async function POST(_req: Request, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
  }

  const { projectId, shotId } = await ctx.params;
  try {
    const project = await regenerateShotImage(session.user.id, projectId, shotId);
    return NextResponse.json({ ok: true, project: serializeVideoProject(project) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "操作失败" },
      { status: 400 },
    );
  }
}
