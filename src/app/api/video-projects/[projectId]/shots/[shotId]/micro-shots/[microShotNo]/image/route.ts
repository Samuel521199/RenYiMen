import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { regenerateMicroShotImage, serializeVideoProject } from "@/services/video-orchestrator/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ projectId: string; shotId: string; microShotNo: string }>;
}

export async function POST(req: Request, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { projectId, shotId, microShotNo } = await ctx.params;
  const index = Number(microShotNo);
  if (!Number.isInteger(index) || index < 1) {
    return NextResponse.json({ ok: false, error: "Invalid micro-shot number" }, { status: 400 });
  }

  const body = await readJson(req);
  try {
    const project = await regenerateMicroShotImage(
      session.user.id,
      projectId,
      shotId,
      index,
      isRecord(body)
        ? {
            microShot: isRecord(body.microShot) ? body.microShot : undefined,
            locale: body.locale === "en" ? "en" : "zh",
          }
        : undefined,
    );
    return NextResponse.json({ ok: true, project: serializeVideoProject(project) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Micro-shot image generation failed" },
      { status: 400 },
    );
  }
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
