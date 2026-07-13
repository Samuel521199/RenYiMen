import { NextResponse } from "next/server";
import { GenerationHistoryStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { consumeUserBalanceInTransaction } from "@/lib/billing";
import { parseStandardPayloadFromGatewayBody } from "@/lib/standard-payload-from-request";
import {
  getProviderAdapter,
  resolveProviderCodeFromBody,
} from "@/services/providers/ProviderFactory";
import { BailianAdapter } from "@/services/providers/BailianAdapter";
import type { IProviderAdapter, StandardPayload } from "@/services/providers/types";
import { ProviderError } from "@/services/providers/types";
import { expireStaleUserPending } from "@/lib/stale-pending-cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

function extractSkuId(body: Record<string, unknown> | null): string {
  if (!body) return "N/A";
  const v = body.skuId;
  return typeof v === "string" && v.trim() ? v.trim() : "N/A";
}

/** 合并网关层可传入的计价提示（如目录基础分），再交给适配器 calculateCost */
function enrichPayloadForPricing(standard: StandardPayload, raw: unknown): StandardPayload {
  if (!isRecord(raw)) return standard;
  const nextFlags: Record<string, unknown> = { ...(standard.flags ?? {}) };
  if (typeof raw.catalogBaseCost === "number" && Number.isFinite(raw.catalogBaseCost)) {
    nextFlags.catalogBaseCost = Math.floor(raw.catalogBaseCost);
  }
  if (Object.keys(nextFlags).length === 0) return standard;
  return { ...standard, flags: nextFlags };
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      console.error("[gateway/generate] 未登录访问");
      return NextResponse.json({ ok: false, error: "未登录", code: "UNAUTHORIZED" }, { status: 401 });
    }

    let rawBody: unknown;
    try {
      const text = await req.text();
      rawBody = text.length ? JSON.parse(text) : null;
    } catch (e) {
      console.error("[gateway/generate] JSON 解析失败", e);
      return NextResponse.json(
        { ok: false, error: "请求体不是合法 JSON", code: "INVALID_JSON" },
        { status: 400 }
      );
    }

    const bodyRecord =
      rawBody !== null && typeof rawBody === "object" ? (rawBody as Record<string, unknown>) : null;
    const skuId = extractSkuId(bodyRecord);

    let providerCode: string;
    try {
      providerCode = resolveProviderCodeFromBody(bodyRecord);
    } catch (e) {
      if (e instanceof ProviderError) {
        return NextResponse.json(
          { ok: false, error: e.message, code: e.code },
          { status: e.httpStatus ?? 400 }
        );
      }
      throw e;
    }

    const standardPayload = parseStandardPayloadFromGatewayBody(rawBody);
    if (!standardPayload) {
      console.error("[gateway/generate] 缺少标准负载 templateId / workflowId", rawBody);
      return NextResponse.json(
        { ok: false, error: "缺少必填字段 templateId 或 workflowId", code: "INVALID_BODY" },
        { status: 400 }
      );
    }

    let adapter: IProviderAdapter;
    try {
      adapter =
        providerCode.trim().toUpperCase() === "ALIYUN_BAILIAN"
          ? new BailianAdapter()
          : getProviderAdapter(providerCode);
    } catch (e) {
      if (e instanceof ProviderError) {
        return NextResponse.json(
          { ok: false, error: e.message, code: e.code },
          { status: e.httpStatus ?? 400 }
        );
      }
      throw e;
    }

    const payloadForCost = enrichPayloadForPricing(standardPayload, rawBody);
    const { cost, sellPrice } = adapter.calculateCost(payloadForCost);

    // 提交前先清理该用户的幽灵 PENDING，防止历史中断轮询的记录误触发并发限额
    await expireStaleUserPending(session.user.id);

    const [user, pendingCount] = await Promise.all([
      prisma.user.findUnique({
        where: { id: session.user.id },
        select: { balance: true },
      }),
      prisma.generationHistory.count({
        where: { userId: session.user.id, status: GenerationHistoryStatus.PENDING },
      }),
    ]);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "用户不存在", code: "USER_NOT_FOUND" },
        { status: 404 }
      );
    }
    /** 信用拦截：余额为非正时禁止发起上游任务（含已透支用户） */
    if (user.balance <= 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "积分余额不足，请联系管理员充值",
          code: "INSUFFICIENT_BALANCE",
          billing: { cost, sellPrice, balance: user.balance },
        },
        { status: 402 }
      );
    }
    /** 每用户并发上限：最多 3 个 PENDING，防止单用户占满上游队列 */
    const MAX_PENDING_PER_USER = 3;
    if (pendingCount >= MAX_PENDING_PER_USER) {
      return NextResponse.json(
        {
          ok: false,
          error: `当前有 ${pendingCount} 个任务正在处理中，请等待完成后再提交新任务`,
          code: "CONCURRENT_LIMIT_EXCEEDED",
          pendingCount,
        },
        { status: 429 }
      );
    }

    console.log(
      "[gateway/generate] 开始调用上游适配器 providerCode=%s skuId=%s userId=%s",
      providerCode, skuId, session.user.id
    );
    const started = performance.now();
    let upstream: Awaited<ReturnType<typeof adapter.generate>>;
    try {
      upstream = await adapter.generate(standardPayload, {});
    } catch (e) {
      console.error("[gateway/generate] 上游适配器调用失败", e);
      if (e instanceof ProviderError) {
        const status =
          e.httpStatus === 400 ? 400 : e.httpStatus === 501 ? 501 : e.code === "RH_NETWORK" ? 502 : 500;
        return NextResponse.json(
          {
            ok: false,
            success: false,
            error: e.message,
            code: e.code,
            details: e.details,
            providerCode,
            skuId,
            billing: { cost, sellPrice },
          },
          { status }
        );
      }
      return NextResponse.json(
        {
          ok: false,
          success: false,
          error: e instanceof Error ? e.message : "上游调用异常",
          code: "UPSTREAM_EXCEPTION",
          providerCode,
          skuId,
          billing: { cost, sellPrice },
        },
        { status: 500 }
      );
    }

    const durationMs = Math.round(performance.now() - started);

    const flags = standardPayload.flags;
    const sourceAssetBytes =
      isRecord(flags) &&
      typeof flags.billingSourceAssetBytes === "number" &&
      Number.isFinite(flags.billingSourceAssetBytes) &&
      flags.billingSourceAssetBytes > 0
        ? Math.floor(flags.billingSourceAssetBytes)
        : undefined;

    console.log(
      "[gateway/generate] 任务已提交 upstream, taskId=%s skuId=%s 参考计价 sellPrice=%s cost=%s balance=%s",
      upstream.taskId,
      skuId,
      String(sellPrice),
      String(cost),
      String(user.balance)
    );

    // ── 同步适配器：直接结果（directResult）处理 ──────────────────────────────
    // 适配器（如 GptImage2Adapter）在 generate() 内同步完成上游调用，将结果编码进
    // raw.directResult，此处直接写 SUCCESS 并扣费，无需经过 PENDING → 轮询 → SUCCESS 流程。
    const rawDirect =
      isRecord(upstream.raw) && isRecord((upstream.raw as Record<string, unknown>).directResult)
        ? ((upstream.raw as Record<string, unknown>).directResult as Record<string, unknown>)
        : null;

    if (rawDirect?.status === "succeeded") {
      const resultUrlsRaw = Array.isArray(rawDirect.resultUrls)
        ? (rawDirect.resultUrls as unknown[])
            .filter((u): u is string => typeof u === "string" && u.length > 0)
        : [];
      const resultUrl =
        resultUrlsRaw.length > 1
          ? JSON.stringify(resultUrlsRaw)
          : (resultUrlsRaw[0] ?? null);

      const directCost =
        typeof rawDirect.providerCost === "number" && Number.isFinite(rawDirect.providerCost)
          ? Math.round(rawDirect.providerCost)
          : Number.isFinite(cost)
            ? Math.round(Number(cost))
            : 0;

      const durationIntSec = Math.max(1, Math.ceil(durationMs / 1000));

      let directDbOk = false;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await prisma.$transaction(
            async (tx) => {
              await tx.generationHistory.create({
                data: {
                  userId: session.user.id,
                  skuId,
                  taskId: upstream.taskId,
                  status: GenerationHistoryStatus.SUCCESS,
                  providerCode,
                  cost: directCost,
                  resultUrl,
                  mediaType: "image",
                  durationInt: durationIntSec,
                  ...(sourceAssetBytes != null ? { sourceAssetBytes } : {}),
                },
              });
              if (directCost > 0) {
                await consumeUserBalanceInTransaction(
                  tx,
                  session.user.id,
                  directCost,
                  "GPT图片生成",
                  upstream.taskId
                );
              }
            },
            { maxWait: 5000, timeout: 10000 }
          );
          directDbOk = true;
          break;
        } catch (dbErr) {
          console.error(
            `[gateway/generate] directResult 落盘失败 attempt=${attempt}`,
            { userId: session.user.id, taskId: upstream.taskId, err: dbErr }
          );
          if (attempt === 1) await new Promise((r) => setTimeout(r, 200));
        }
      }

      if (!directDbOk) {
        return NextResponse.json(
          {
            ok: false,
            error: "图片已生成但记录保存失败，请联系管理员并提供任务ID",
            code: "DB_WRITE_FAILED",
            taskId: upstream.taskId,
          },
          { status: 500 }
        );
      }

      console.log(
        "[gateway/generate] directResult 已落库 SUCCESS, taskId=%s cost=%d resultCount=%d",
        upstream.taskId,
        directCost,
        resultUrlsRaw.length
      );

      return NextResponse.json({
        ok: true,
        success: true,
        taskId: upstream.taskId,
        durationMs,
        providerCode,
        skuId,
        billing: { cost: directCost, sellPrice: directCost },
        upstream: { raw: upstream.raw },
      });
    }

    // ── 异步适配器：落 PENDING，由客户端轮询 ────────────────────────────────
    const historyData = {
      userId: session.user.id,
      skuId,
      taskId: upstream.taskId,
      status: GenerationHistoryStatus.PENDING,
      providerCode,
      cost: Number.isFinite(cost) ? Math.round(Number(cost)) : 0,
      mediaType: "",
      ...(sourceAssetBytes != null ? { sourceAssetBytes } : {}),
    };

    // 落盘失败时重试一次；仍失败则返回 500（上游任务已运行，taskId 记入日志供人工核查）
    let dbWriteOk = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await prisma.generationHistory.create({ data: historyData });
        dbWriteOk = true;
        break;
      } catch (dbErr) {
        console.error(`[gateway/generate] generationHistory 落盘失败 attempt=${attempt}`, {
          userId: session.user.id,
          taskId: upstream.taskId,
          err: dbErr,
        });
        if (attempt === 1) await new Promise((r) => setTimeout(r, 200));
      }
    }

    if (!dbWriteOk) {
      return NextResponse.json(
        {
          ok: false,
          error: "任务已提交但记录保存失败，请联系管理员并提供任务ID",
          code: "DB_WRITE_FAILED",
          taskId: upstream.taskId,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      success: true,
      taskId: upstream.taskId,
      durationMs,
      providerCode,
      skuId,
      billing: { cost, sellPrice },
      upstream: { raw: upstream.raw },
    });
  } catch (e) {
    console.error("[gateway/generate] 未处理异常", e);
    return NextResponse.json(
      {
        ok: false,
        success: false,
        error: e instanceof Error ? e.message : "内部错误",
        code: "INTERNAL_ERROR",
      },
      { status: 500 }
    );
  }
}
