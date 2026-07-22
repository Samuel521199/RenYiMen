import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { generateTransitionReference, serializeVideoProject } from "@/services/video-orchestrator/project-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(_req: Request, ctx: { params: Promise<{ projectId: string; artifactId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { projectId, artifactId } = await ctx.params;
  try { return NextResponse.json({ ok: true, project: serializeVideoProject(await generateTransitionReference(session.user.id, projectId, decodeURIComponent(artifactId))) }); }
  catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Transition reference generation failed" }, { status: 400 }); }
}
