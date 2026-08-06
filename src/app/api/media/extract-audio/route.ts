import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { extractAudioFromVideo } from "@/services/media/audio-extraction";
import { isOwnOssUrl } from "@/services/video-orchestrator/oss-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "请求格式无效" }, { status: 400 });
  }
  const sourceUrl = isRecord(body) && typeof body.sourceUrl === "string"
    ? body.sourceUrl.trim()
    : "";
  if (!/^https?:\/\//i.test(sourceUrl) || !isOwnOssUrl(sourceUrl)) {
    return NextResponse.json(
      { ok: false, error: "只能提取通过本平台上传的 MP4 视频" },
      { status: 400 },
    );
  }

  try {
    const result = await extractAudioFromVideo(
      sourceUrl,
      "mp3",
      `talking-preview-${session.user.id}-${randomUUID().replace(/-/g, "")}`,
    );
    return NextResponse.json({ ok: true, audio: result });
  } catch (error) {
    console.error("[media/extract-audio] failed", { userId: session.user.id, error });
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "MP4 声音提取失败" },
      { status: 400 },
    );
  }
}
