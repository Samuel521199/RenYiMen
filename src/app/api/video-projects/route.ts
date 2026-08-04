import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  createVideoProject,
  listVideoProjects,
  serializeVideoProject,
} from "@/services/video-orchestrator/project-service";
import { normalizePlanInput } from "@/services/video-orchestrator/planner";
import { isOnePromptVideoWorkbenchEnabled } from "@/lib/one-prompt-video-feature";

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
    if (!isOnePromptVideoWorkbenchEnabled()) {
      return NextResponse.json({
        ok: false,
        error: "一句话成片工作台当前未开放。",
        errorCode: "ONE_PROMPT_VIDEO_WORKBENCH_DISABLED",
      }, { status: 404 });
    }
    if (process.env.NEXT_PUBLIC_ONE_PROMPT_MIGRATION_FROZEN === "true") {
      return NextResponse.json({
        ok: false,
        error: "一句话成片正在进行架构迁移，当前已暂停新建任务。",
        errorCode: "ONE_PROMPT_MIGRATION_FROZEN",
      }, { status: 503 });
    }
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
