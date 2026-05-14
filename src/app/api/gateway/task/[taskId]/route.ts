import { NextResponse } from "next/server";
import { GenerationHistoryStatus, Prisma } from "@prisma/client";
import { auth } from "@/auth";
import {
  BillingBalanceError,
  calculateOssCredits,
  consumeUserBalanceInTransaction,
} from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { inferMediaTypeFromResultUrl } from "@/lib/task-status-view";
import type { GatewayTaskPollBody } from "@/types/gateway-task-poll";
import type { TaskStatusPollData } from "@/types/task-status";
import {
  DEFAULT_PROVIDER_CODE,
  getProviderAdapter,
} from "@/services/providers/ProviderFactory";
import { BailianAdapter, BAILIAN_GATEWAY_POLL_DEADLINE_MS } from "@/services/providers/BailianAdapter";
import {
  RUNNINGHUB_GATEWAY_POLL_DEADLINE_MS,
} from "@/services/providers/RunningHubAdapter";
import type { IProviderAdapter } from "@/services/providers/types";
import { ProviderError } from "@/services/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TASK_ID_MAX_LEN = 128;

function isValidTaskId(id: string): boolean {
  if (!id || id.length > TASK_ID_MAX_LEN) return false;
  return /^[\w-]+$/.test(id);
}

function pollFailure(message: string, httpStatus: number) {
  const body: GatewayTaskPollBody = { status: "failure", error: message };
  return NextResponse.json(body, { status: httpStatus });
}

function isTimeoutOrAbort(e: unknown): boolean {
  if (e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError")) {
    return true;
  }
  if (e instanceof Error && e.name === "AbortError") return true;
  return false;
}

function isTransientPollFailure(e: unknown): boolean {
  if (isTimeoutOrAbort(e)) return true;
  return (
    e instanceof ProviderError &&
    (e.code === "RH_POLL_FETCH_TIMEOUT" ||
      e.code === "RH_POLL_ABORTED" ||
      e.code === "BAILIAN_POLL_ABORTED" ||
      e.code === "BAILIAN_POLL_NETWORK")
  );
}

function mapPollDataToGatewayBody(d: TaskStatusPollData): GatewayTaskPollBody {
  if (d.status === "succeeded") {
    const body: GatewayTaskPollBody = {
      status: "success",
      videoUrl: d.resultUrl ?? undefined,
      progress: d.progress != null ? Math.round(Number(d.progress)) : 100,
      ...(Array.isArray(d.resultUrls) && d.resultUrls.length > 1 ? { resultUrls: d.resultUrls } : {}),
      ...(d.resultMediaType ? { resultMediaType: d.resultMediaType } : {}),
      ...(typeof d.providerCost === "number" && Number.isFinite(d.providerCost)
        ? { providerCost: d.providerCost }
        : {}),
      ...(typeof d.sellPrice === "number" && Number.isFinite(d.sellPrice) && d.sellPrice >= 0
        ? { sellPrice: d.sellPrice }
        : {}),
    };
    console.log("[gateway/task] 发往前端的 pollBody:", {
      status: body.status,
      videoUrl: body.videoUrl,
      resultMediaType: body.resultMediaType,
      resultUrlsCount: body.resultUrls?.length ?? 0,
      resultUrls: body.resultUrls,
    });
    return body;
  }
  if (d.status === "failed") {
    return { status: "failure", error: d.errorMessage ?? "生成失败" };
  }
  const prog =
    d.progress != null && !Number.isNaN(Number(d.progress))
      ? Math.round(Number(d.progress))
      : undefined;
  return { status: "loading", progress: prog };
}

function resolveBytesForOssBilling(poll: TaskStatusPollData, stored: number | null): number {
  const fromPoll =
    typeof poll.providerAssetSizeBytes === "number" &&
    Number.isFinite(poll.providerAssetSizeBytes) &&
    poll.providerAssetSizeBytes > 0
      ? Math.floor(poll.providerAssetSizeBytes)
      : 0;
  if (fromPoll > 0) return fromPoll;
  if (typeof stored === "number" && Number.isFinite(stored) && stored > 0) {
    return Math.floor(stored);
  }
  return 0;
}

/**
 * 终态落库与扣费；返回本次应对外展示的实扣积分（与 `User.balance` 扣减一致），无则 `null`。
 */
async function persistGenerationHistoryTerminal(
  userId: string,
  taskId: string,
  pollData: TaskStatusPollData
): Promise<number | null> {
  const owned = await prisma.generationHistory.findUnique({
    where: { taskId },
    select: { userId: true, status: true },
  });
  if (!owned || owned.userId !== userId) return null;

  if (pollData.status === "succeeded" && owned.status === GenerationHistoryStatus.SUCCESS) {
    const row = await prisma.generationHistory.findUnique({
      where: { taskId },
      select: { cost: true },
    });
    return typeof row?.cost === "number" && Number.isFinite(row.cost) ? row.cost : null;
  }
  if (pollData.status === "failed") {
    await prisma.generationHistory.updateMany({
      where: { taskId, userId, status: GenerationHistoryStatus.PENDING },
      data: { status: GenerationHistoryStatus.FAILED },
    });
    return null;
  }

  if (pollData.status !== "succeeded") return null;

  // 多图输出（如分镜）：将所有 URL 序列化为 JSON 数组存入 resultUrl 字段
  const rawResultUrl = pollData.resultUrl?.trim() ? String(pollData.resultUrl).trim() : null;
  const resultUrl =
    Array.isArray(pollData.resultUrls) && pollData.resultUrls.length > 1
      ? JSON.stringify(pollData.resultUrls)
      : rawResultUrl;
  const mediaType = rawResultUrl ? inferMediaTypeFromResultUrl(rawResultUrl) : "";
  const actualCost =
    typeof pollData.providerCost === "number" && Number.isFinite(pollData.providerCost)
      ? Math.round(pollData.providerCost)
      : undefined;

  try {
    let settledBill: number | null = null;

    await prisma.$transaction(
      async (tx) => {
        const gh = await tx.generationHistory.findUnique({
          where: { taskId },
          select: {
            userId: true,
            status: true,
            sourceAssetBytes: true,
            skuId: true,
            createdAt: true,
            providerCode: true,
          },
        });
        if (!gh || gh.userId !== userId || gh.status !== GenerationHistoryStatus.PENDING) {
          return;
        }

        const rhDurSec =
          typeof pollData.providerDurationSec === "number" &&
          Number.isFinite(pollData.providerDurationSec) &&
          pollData.providerDurationSec > 0
            ? Math.min(Math.trunc(pollData.providerDurationSec), 2_147_483_647)
            : undefined;
        const wallSec = Math.max(
          1,
          Math.min(
            2_147_483_647,
            Math.floor((Date.now() - gh.createdAt.getTime()) / 1000)
          )
        );
        /**
         * 百炼：`providerDurationSec` 多来自 DashScope `usage.duration`（成片时长或缺省计费用 5），
         * 不等于「从提单到完成」的等待时长；经营看板「单次耗时」改为墙钟秒数。
         * RunningHub：优先用上游上报的执行耗时，否则用墙钟。
         */
        const providerUpper = (gh.providerCode ?? "").trim().toUpperCase();
        const isAliyunBailian = providerUpper === "ALIYUN_BAILIAN";
        const durationIntFinal = isAliyunBailian ? wallSec : rhDurSec ?? wallSec;

        const bytesForOss = resolveBytesForOssBilling(pollData, gh.sourceAssetBytes);
        /** 无底图大小时 OSS 成本按 1 积分计（与 `calculateOssCredits` 最小档一致） */
        const ossCredits =
          bytesForOss > 0 ? calculateOssCredits(bytesForOss) : 1;
        const rhPart =
          typeof pollData.providerCost === "number" && Number.isFinite(pollData.providerCost)
            ? pollData.providerCost
            : 0;
        const totalCredits = Math.ceil(rhPart + ossCredits);

        if (totalCredits > 0) {
          await consumeUserBalanceInTransaction(
            tx,
            userId,
            totalCredits,
            "图生视频算力消耗",
            taskId
          );
        }

        const updated = await tx.generationHistory.updateMany({
          where: { taskId, userId, status: GenerationHistoryStatus.PENDING },
          data: {
            status: GenerationHistoryStatus.SUCCESS,
            resultUrl,
            mediaType,
            cost: totalCredits,
            ...(actualCost != null ? { actualCost } : {}),
            durationInt: durationIntFinal,
          },
        });
        if (updated.count === 0) {
          console.warn("[gateway/task] 终态 SUCCESS 未更新任何行（可能并发或状态已变）", {
            taskId,
            userId,
            pollStatus: pollData.status,
          });
          return;
        }

        settledBill = totalCredits;

        const rhLabel =
          typeof pollData.providerCost === "number" && Number.isFinite(pollData.providerCost)
            ? String(pollData.providerCost)
            : "未知";
        console.log(
          `[RH 真实计费账单] 订单号: ${taskId}, RH币: ${rhLabel}, 底图字节: ${bytesForOss || "—"}, OSS换算分: ${ossCredits}, 合计扣积分: ${totalCredits}, 耗时(s): RH=${pollData.providerDurationSec ?? "—"} 落库=${durationIntFinal}`
        );
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 15000,
      }
    );

    if (settledBill !== null) {
      return settledBill;
    }

    const row = await prisma.generationHistory.findUnique({
      where: { taskId },
      select: { status: true, cost: true },
    });
    if (row?.status === GenerationHistoryStatus.SUCCESS && typeof row.cost === "number") {
      return row.cost;
    }
    return null;
  } catch (e) {
    if (e instanceof BillingBalanceError) {
      console.error("[gateway/task] 终态扣费失败（余额不足或非法金额）", {
        taskId,
        userId,
        code: e.code,
        message: e.message,
      });
      return null;
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      console.warn("[gateway/task] 终态 Serializable 冲突，将依赖下次轮询重试", { taskId });
      return null;
    }
    throw e;
  }
}

/**
 * GET `/api/gateway/task/:taskId` — 轮询任务状态；可选查询参数 `providerCode` 指定线路（默认 RUNNINGHUB_SVD）。
 */
export async function GET(
  req: Request,
  context: { params: Promise<{ taskId: string }> }
): Promise<NextResponse<GatewayTaskPollBody | { error: string }>> {
  const session = await auth();
  if (!session?.user?.id) {
    console.error("[gateway/task] 未登录轮询");
    return pollFailure("未登录", 401);
  }

  const resolved = await context.params;
  const taskId = decodeURIComponent(resolved.taskId ?? "").trim();
  if (!isValidTaskId(taskId)) {
    console.error("[gateway/task] 非法 taskId", { raw: resolved.taskId });
    return pollFailure("非法或缺失的 taskId", 400);
  }

  const url = new URL(req.url);
  const providerParam = url.searchParams.get("providerCode")?.trim();
  const providerCode = (providerParam || DEFAULT_PROVIDER_CODE).toUpperCase();

  let adapter: IProviderAdapter;
  try {
    adapter =
      providerCode === "ALIYUN_BAILIAN" ? new BailianAdapter() : getProviderAdapter(providerCode);
  } catch (e) {
    if (e instanceof ProviderError) {
      return pollFailure(e.message, e.httpStatus ?? 400);
    }
    return pollFailure("不支持的线路", 400);
  }

  const pollDeadlineMs =
    providerCode === "ALIYUN_BAILIAN" ? BAILIAN_GATEWAY_POLL_DEADLINE_MS : RUNNINGHUB_GATEWAY_POLL_DEADLINE_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("网关轮询上游超时", "TimeoutError"));
  }, pollDeadlineMs);

  const t0 = Date.now();
  try {
    const pollData = await adapter.queryTask(taskId, { signal: controller.signal });
    let billCredits: number | null = null;
    try {
      billCredits = await persistGenerationHistoryTerminal(session.user.id, taskId, pollData);
    } catch (dbErr) {
      console.error("[gateway/task] generationHistory 终态落盘失败", {
        taskId,
        userId: session.user.id,
        pollStatus: pollData.status,
        err: dbErr,
      });
    }

    const pollForClient: TaskStatusPollData =
      billCredits !== null && pollData.status === "succeeded"
        ? { ...pollData, sellPrice: billCredits }
        : pollData;

    const body = mapPollDataToGatewayBody(pollForClient);
    const elapsed = Date.now() - t0;
    console.log(`[Poll] TaskId: ${taskId}, 耗时: ${elapsed}ms, 状态: ${body.status}`);
    return NextResponse.json(body);
  } catch (e) {
    const elapsed = Date.now() - t0;
    if (isTransientPollFailure(e)) {
      const msg =
        e instanceof ProviderError
          ? e.message
          : isTimeoutOrAbort(e)
            ? "上游查询超时，请稍后重试"
            : "上游查询中断，请稍后重试";
      console.warn(`[Poll] TaskId: ${taskId}, 耗时: ${elapsed}ms, 状态: transient_503`, e);
      return NextResponse.json({ error: msg }, { status: 503 });
    }
    console.error("[gateway/task] 上游查询异常", { taskId, providerCode, elapsedMs: elapsed, err: e });
    if (e instanceof ProviderError) {
      return NextResponse.json({ status: "failure", error: e.message }, { status: 200 });
    }
    let message = "服务暂时不可用";
    if (isTimeoutOrAbort(e)) {
      message = "上游查询超时，请稍后重试";
    } else if (e instanceof Error && e.message) {
      message = e.message;
    }
    return NextResponse.json({ status: "failure", error: message }, { status: 200 });
  } finally {
    clearTimeout(timer);
  }
}
