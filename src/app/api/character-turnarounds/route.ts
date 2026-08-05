import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  createCharacterTurnaroundProject,
  listCharacterTurnaroundProjects,
  serializeVideoProject,
} from "@/services/video-orchestrator/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
    }
    const projects = await listCharacterTurnaroundProjects(session.user.id);
    return NextResponse.json({ ok: true, projects: projects.map(serializeVideoProject) });
  } catch (error) {
    console.error("[character-turnarounds] GET failed", error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "三视图项目加载失败",
    }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
    }
    const body: unknown = await req.json();
    if (!isRecord(body)) {
      return NextResponse.json({ ok: false, error: "请求体不是合法 JSON" }, { status: 400 });
    }
    const referenceImageUrl = typeof body.referenceImageUrl === "string" ? body.referenceImageUrl : "";
    if (!referenceImageUrl.trim()) {
      return NextResponse.json({ ok: false, error: "请先上传人物身份参考图" }, { status: 400 });
    }
    const project = await createCharacterTurnaroundProject(session.user.id, {
      referenceImageUrl,
      title: typeof body.title === "string" ? body.title : undefined,
      characterDescription: typeof body.characterDescription === "string" ? body.characterDescription : undefined,
      aspectRatio: body.aspectRatio === "1:1" || body.aspectRatio === "16:9" ? body.aspectRatio : "9:16",
    });
    return NextResponse.json({ ok: true, project: serializeVideoProject(project) }, { status: 201 });
  } catch (error) {
    console.error("[character-turnarounds] POST failed", error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "三视图项目创建失败",
    }, { status: 500 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
