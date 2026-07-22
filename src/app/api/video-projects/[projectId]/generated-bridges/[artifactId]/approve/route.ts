import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { approveGeneratedBridge, serializeVideoProject } from "@/services/video-orchestrator/project-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request, ctx: { params: Promise<{ projectId: string; artifactId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { projectId, artifactId } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { candidateId?: unknown };
  try { return NextResponse.json({ ok: true, project: serializeVideoProject(await approveGeneratedBridge(session.user.id, projectId, decodeURIComponent(artifactId), typeof body.candidateId === "string" ? body.candidateId : undefined)) }); }
  catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Generated bridge approval failed" }, { status: 400 }); }
}
