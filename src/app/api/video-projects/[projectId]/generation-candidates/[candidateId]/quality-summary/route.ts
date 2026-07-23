import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getOrCreateCandidateQualityDisplaySummary } from "@/services/video-orchestrator/quality-display-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ projectId: string; candidateId: string }>;
}

export async function POST(req: Request, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { projectId, candidateId } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { lang?: unknown };
  const lang = body.lang === "en" ? "en" : "zh";
  try {
    const summary = await getOrCreateCandidateQualityDisplaySummary({
      userId: session.user.id,
      projectId,
      candidateId,
      lang,
    });
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : (lang === "zh" ? "质检摘要生成失败" : "Failed to summarize quality review"),
    }, { status: 400 });
  }
}
