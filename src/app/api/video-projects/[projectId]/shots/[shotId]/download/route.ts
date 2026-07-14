import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getVideoShotClipForDownload } from "@/services/video-orchestrator/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ projectId: string; shotId: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
    }

    const { projectId, shotId } = await ctx.params;
    const clip = await getVideoShotClipForDownload(session.user.id, projectId, shotId);
    const upstream = await fetch(clip.clipUrl, { cache: "no-store" });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ ok: false, error: `视频文件拉取失败 ${upstream.status}` }, { status: 502 });
    }

    const filename = buildClipFilename(clip.title, clip.shotNo);
    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("content-type") || "video/mp4");
    headers.set("Content-Disposition", contentDisposition(filename));
    headers.set("Cache-Control", "private, no-store");
    const length = upstream.headers.get("content-length");
    if (length) headers.set("Content-Length", length);

    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    console.error("[video-projects] shot download failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "镜头视频下载失败" },
      { status: 400 },
    );
  }
}

function buildClipFilename(title: string, shotNo: number): string {
  const safeTitle = title
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 48)
    .replace(/^_+|_+$/g, "");
  return `${safeTitle || "one-prompt-video"}-shot-${String(shotNo).padStart(2, "0")}.mp4`;
}

function contentDisposition(filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeRFC5987(filename)}`;
}

function encodeRFC5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
