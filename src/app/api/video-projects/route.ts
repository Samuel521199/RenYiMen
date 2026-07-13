import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  createVideoProject,
  listVideoProjects,
  serializeVideoProject,
} from "@/services/video-orchestrator/project-service";
import { normalizePlanInput } from "@/services/video-orchestrator/planner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
    }

    const projects = await listVideoProjects(session.user.id);
    return NextResponse.json({ ok: true, projects: projects.map(serializeVideoProject) });
  } catch (error) {
    console.error("[video-projects] GET failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "项目加载失败" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "请求体不是合法 JSON" }, { status: 400 });
    }

    const input = normalizePlanInput(isRecord(body) ? body : {});
    const project = await createVideoProject(session.user.id, input);
    return NextResponse.json({ ok: true, project: serializeVideoProject(project) });
  } catch (error) {
    console.error("[video-projects] POST failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "项目创建失败" },
      { status: 500 },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
