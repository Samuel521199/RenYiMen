import { NextResponse } from "next/server";
import { GenerationHistoryStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { parseStandardPayloadFromGatewayBody } from "@/lib/standard-payload-from-request";
import {
  getProviderAdapter,
  resolveProviderCodeFromBody,
} from "@/services/providers/ProviderFactory";
import { BailianAdapter } from "@/services/providers/BailianAdapter";
import type { IProviderAdapter, StandardPayload } from "@/services/providers/types";
import { ProviderError } from "@/services/providers/types";

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

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { balance: true },
    });
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

    try {
      await prisma.generationHistory.create({
        data: {
          userId: session.user.id,
          skuId,
          taskId: upstream.taskId,
          status: GenerationHistoryStatus.PENDING,
          providerCode,
          cost: Number.isFinite(cost) ? Math.round(Number(cost)) : 0,
          mediaType: "",
          ...(sourceAssetBytes != null ? { sourceAssetBytes } : {}),
        },
      });
    } catch (dbErr) {
      console.error("[gateway/generate] generationHistory 落盘失败（上游任务已创建）", {
        userId: session.user.id,
        taskId: upstream.taskId,
        err: dbErr,
      });
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
