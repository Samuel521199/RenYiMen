import { GenerationHistoryStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getProviderAdapter } from "@/services/providers/ProviderFactory";
import { persistTemporaryHistoryVideo } from "@/services/history-media-persistence";
import { isOwnOssUrl, isTemporaryDashScopeUrl } from "@/services/video-orchestrator/oss-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const { taskId: rawTaskId } = await context.params;
  const taskId = decodeURIComponent(rawTaskId || "").trim();
  const row = await prisma.generationHistory.findFirst({
    where: {
      taskId,
      userId: session.user.id,
      status: GenerationHistoryStatus.SUCCESS,
    },
    select: { id: true, resultUrl: true, mediaType: true, providerCode: true, skuId: true },
  });
  if (!row?.resultUrl) return NextResponse.json({ error: "历史视频不存在" }, { status: 404 });
  if (isOwnOssUrl(row.resultUrl)) return NextResponse.json({ ok: true, resultUrl: row.resultUrl });
  if (row.mediaType !== "video" || !isTemporaryDashScopeUrl(row.resultUrl)) {
    return NextResponse.json({ error: "该历史记录无法自动恢复" }, { status: 409 });
  }

  try {
    const adapter = getProviderAdapter(row.providerCode);
    const refreshed = await adapter.queryTask(taskId, { skuId: row.skuId });
    if (refreshed.status !== "succeeded" || !refreshed.resultUrl) {
      return NextResponse.json({ error: "上游任务已失效，无法恢复原视频" }, { status: 410 });
    }
    const resultUrl = await persistTemporaryHistoryVideo({
      userId: session.user.id,
      taskId,
      resultUrl: refreshed.resultUrl,
      mediaType: refreshed.resultMediaType ?? row.mediaType,
    });
    if (!isOwnOssUrl(resultUrl)) {
      return NextResponse.json({ error: "上游未返回可永久保存的视频" }, { status: 502 });
    }
    await prisma.generationHistory.update({
      where: { id: row.id },
      data: { resultUrl, mediaType: "video" },
    });
    return NextResponse.json({ ok: true, resultUrl });
  } catch (error) {
    console.error("[history/repair-media] failed", {
      taskId,
      userId: session.user.id,
      error,
    });
    return NextResponse.json({ error: "历史视频恢复失败，请稍后重试" }, { status: 502 });
  }
}
