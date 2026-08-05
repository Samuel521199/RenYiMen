import { GenerationHistoryStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { deductUserBalance } from "@/lib/billing";
import { AUTO_SUBTITLE_CREDITS } from "@/lib/subtitle-pricing";
import { ProviderError } from "@/services/providers/types";
import { transcribeAudioForSubtitles } from "@/services/providers/bailian-subtitle-service";
import { isOwnOssUrl, isTemporaryDashScopeUrl, uploadMediaBufferToOss } from "@/services/video-orchestrator/oss-media";
import { renderVideoWithSubtitles } from "@/services/subtitles/video-subtitle-renderer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const MAX_SOURCE_VIDEO_BYTES = 200 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function publicHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

async function downloadSourceVideo(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "video/mp4,video/*;q=0.9" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`原视频下载失败（HTTP ${response.status}）`);
  const contentLength = Number(response.headers.get("content-length") || "0");
  if (contentLength > MAX_SOURCE_VIDEO_BYTES) throw new Error("原视频超过 200MB，无法添加字幕");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_SOURCE_VIDEO_BYTES) throw new Error("原视频超过 200MB，无法添加字幕");
  return buffer;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED", error: "请先登录" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_JSON", error: "请求格式无效" }, { status: 400 });
  }
  const taskId = isRecord(body) && typeof body.taskId === "string" ? body.taskId.trim() : "";
  const audioUrl = publicHttpUrl(isRecord(body) ? body.audioUrl : null);
  const standaloneVideoUrl = publicHttpUrl(isRecord(body) ? body.sourceVideoUrl : null);
  let videoUrl: string | null = null;
  let recognitionUrl: string | null = null;
  let outputId = taskId;

  if (standaloneVideoUrl) {
    if (!isOwnOssUrl(standaloneVideoUrl)) {
      return NextResponse.json({ ok: false, code: "UNTRUSTED_VIDEO_URL", error: "只能处理通过本站上传的视频" }, { status: 400 });
    }
    videoUrl = standaloneVideoUrl;
    recognitionUrl = standaloneVideoUrl;
    outputId = `standalone-${Date.now()}`;
  } else {
    if (!taskId || !audioUrl) {
      return NextResponse.json({ ok: false, code: "INVALID_INPUT", error: "缺少视频任务或人声音频" }, { status: 400 });
    }
    if (!isOwnOssUrl(audioUrl)) {
      return NextResponse.json({ ok: false, code: "UNTRUSTED_AUDIO_URL", error: "只能处理本次上传的人声音频" }, { status: 400 });
    }
    const generation = await prisma.generationHistory.findFirst({
      where: {
        taskId,
        userId: session.user.id,
        skuId: "BAILIAN_WAN22_S2V",
        status: GenerationHistoryStatus.SUCCESS,
      },
      select: { resultUrl: true },
    });
    videoUrl = publicHttpUrl(generation?.resultUrl);
    recognitionUrl = audioUrl;
    if (!videoUrl || (!isOwnOssUrl(videoUrl) && !isTemporaryDashScopeUrl(videoUrl))) {
      return NextResponse.json({ ok: false, code: "VIDEO_NOT_READY", error: "有声视频尚未生成完成" }, { status: 409 });
    }
  }

  try {
    const cues = await transcribeAudioForSubtitles(recognitionUrl);
    const sourceVideo = await downloadSourceVideo(videoUrl);
    const captionedVideo = await renderVideoWithSubtitles(sourceVideo, cues);
    const captionedVideoUrl = await uploadMediaBufferToOss({
      key: `subtitled-videos/${session.user.id}/${outputId}-${Date.now()}.mp4`,
      body: captionedVideo,
      contentType: "video/mp4",
    });
    const billing = await deductUserBalance(
      session.user.id,
      AUTO_SUBTITLE_CREDITS,
      "CONSUME",
      "自动添加字幕",
      outputId,
    );
    return NextResponse.json({
      ok: true,
      captionedVideoUrl,
      cueCount: cues.length,
      sellPrice: AUTO_SUBTITLE_CREDITS,
      balance: billing.balanceAfter,
    });
  } catch (error) {
    console.error("[gateway/subtitles] subtitle post-processing failed", { taskId: outputId, userId: session.user.id, error });
    if (error instanceof ProviderError) {
      return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: error.httpStatus ?? 502 });
    }
    return NextResponse.json(
      { ok: false, code: "SUBTITLE_PROCESSING_FAILED", error: error instanceof Error ? error.message : "字幕处理失败" },
      { status: 500 },
    );
  }
}
