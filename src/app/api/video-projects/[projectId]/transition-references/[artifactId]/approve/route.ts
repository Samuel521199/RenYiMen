import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { approveTransitionReference, serializeVideoProject } from "@/services/video-orchestrator/project-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request, ctx: { params: Promise<{ projectId: string; artifactId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { projectId, artifactId } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { frameId?: unknown };
  try { return NextResponse.json({ ok: true, project: serializeVideoProject(await approveTransitionReference(session.user.id, projectId, decodeURIComponent(artifactId), typeof body.frameId === "string" ? body.frameId : undefined)) }); }
  catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Transition reference approval failed" }, { status: 400 }); }
}
