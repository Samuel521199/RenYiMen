import type { GatewayTaskPollBody } from "@/types/gateway-task-poll";
import type { TaskStatusPollData } from "@/types/task-status";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

function mapGatewayBodyToPollData(body: GatewayTaskPollBody): TaskStatusPollData {
  if (body.status === "success") {
    return {
      status: "succeeded",
      resultUrl: body.videoUrl ?? null,
      progress: 100,
      ...(Array.isArray(body.resultUrls) && body.resultUrls.length > 1
        ? { resultUrls: body.resultUrls }
        : {}),
      ...(typeof body.sellPrice === "number" && Number.isFinite(body.sellPrice)
        ? { sellPrice: body.sellPrice }
        : {}),
      ...(typeof body.providerCost === "number" && Number.isFinite(body.providerCost)
        ? { providerCost: body.providerCost }
        : {}),
    };
  }
  if (body.status === "failure") {
    const rawErr = typeof body.error === "string" ? body.error.trim() : "";
    /** 上游偶发把 HTTP 级 `msg: success` 透传为失败文案，避免 UI 显示「success」。 */
    const trivial = /^success$/i.test(rawErr) || /^ok$/i.test(rawErr);
    return {
      status: "failed",
      errorMessage: trivial ? "生成失败" : rawErr || "生成失败",
    };
  }
  const p = typeof body.progress === "number" && !Number.isNaN(body.progress) ? body.progress : null;
  const sub = p != null && p < 48 ? "queued" : "running";
  return {
    status: sub,
    progress: p,
  };
}

/**
 * 调用 `GET /api/gateway/task/:taskId`，将网关 DTO 转为 `TaskStatusPollData`。
 * 401/400 返回终态 `failed`（不抛错），避免轮询无限退避重试。
 * 5xx（含 503 上游瞬时不可用）会抛错，供 `useTaskPolling` 走传输层退避重试。
 */
export async function fetchGatewayTaskPoll(
  taskId: string,
  signal: AbortSignal,
  options?: { providerCode?: string }
): Promise<TaskStatusPollData> {
  const qs =
    options?.providerCode && options.providerCode.trim()
      ? `?providerCode=${encodeURIComponent(options.providerCode.trim())}`
      : "";
  const res = await fetch(`/api/gateway/task/${encodeURIComponent(taskId)}${qs}`, {
    method: "GET",
    signal,
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new Error("轮询响应不是合法 JSON");
  }

  if (!res.ok) {
    const errMsg = isRecord(raw) && typeof raw.error === "string" ? raw.error : `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 400) {
      return { status: "failed", errorMessage: errMsg };
    }
    throw new Error(errMsg);
  }

  if (!isRecord(raw) || typeof raw.status !== "string") {
    throw new Error("轮询响应格式异常");
  }

  const body = raw as unknown as GatewayTaskPollBody;
  if (body.status !== "loading" && body.status !== "success" && body.status !== "failure") {
    throw new Error("未知的任务状态");
  }

  return mapGatewayBodyToPollData(body);
}
