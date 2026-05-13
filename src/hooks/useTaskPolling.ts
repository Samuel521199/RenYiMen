"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchGatewayTaskPoll } from "@/lib/gateway-task-poll-client";
import type { TaskStatusPollData } from "@/types/task-status";

export interface UseTaskPollingOptions {
  taskId: string | null;
  /** 为 false 时不发起轮询（可用于手动暂停） */
  enabled?: boolean;
  /**
   * 单次轮询实现；默认调用 `GET /api/gateway/task/:taskId`。
   * 未传 `pollFn` 且提供本字段时，会附加 `?providerCode=` 查询参数。
   */
  pollFn?: (taskId: string, signal: AbortSignal) => Promise<TaskStatusPollData>;
  /** 与提单时一致，传给网关任务轮询接口 */
  providerCode?: string | null;
  /** 首次发起轮询前的等待（ms） */
  initialDelayMs?: number;
  /** 任务未结束时，轮询间隔初始值（ms），之后按 `pendingBackoffFactor` 指数增长直至封顶 */
  pendingPollBaseMs?: number;
  pendingPollMaxMs?: number;
  pendingBackoffFactor?: number;
  /** `pollFn` 抛错（网络/5xx 等）后的指数退避：首段等待 */
  errorRetryInitialMs?: number;
  errorRetryMaxMs?: number;
  /** 连续请求失败达到该次数后停止轮询（0 表示不限制） */
  maxConsecutiveErrors?: number;
  onTerminal?: (data: TaskStatusPollData) => void;
}

export interface UseTaskPollingResult {
  data: TaskStatusPollData | null;
  isPolling: boolean;
  transportError: Error | null;
  consecutiveErrors: number;
  /** 自本次 `taskId` 开始轮询以来的毫秒数（约 250ms 刷新），无任务时为 0 */
  elapsedMs: number;
  cancel: () => void;
  reset: () => void;
}

function isTerminal(data: TaskStatusPollData): boolean {
  return data.status === "succeeded" || data.status === "failed";
}

/**
 * 轮询任务状态：任务未完成时轮询间隔指数增长（减轻服务端压力）；
 * 单次请求失败时使用指数退避重试，直至成功、终态或超过 `maxConsecutiveErrors`。
 */
export function useTaskPolling(options: UseTaskPollingOptions): UseTaskPollingResult {
  const {
    taskId,
    enabled = true,
    pollFn: pollFnOverride,
    providerCode,
    initialDelayMs = 0,
    pendingPollBaseMs = 2000,
    pendingPollMaxMs = 20_000,
    pendingBackoffFactor = 1.5,
    errorRetryInitialMs = 1000,
    errorRetryMaxMs = 30_000,
    maxConsecutiveErrors = 0,
    onTerminal,
  } = options;

  const resolvedPollFn = useCallback(
    (id: string, sig: AbortSignal) => {
      if (pollFnOverride) return pollFnOverride(id, sig);
      return fetchGatewayTaskPoll(id, sig, { providerCode: providerCode ?? undefined });
    },
    [pollFnOverride, providerCode]
  );

  const [data, setData] = useState<TaskStatusPollData | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [transportError, setTransportError] = useState<Error | null>(null);
  const [consecutiveErrors, setConsecutiveErrors] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const pollStartRef = useRef<number | null>(null);

  const pollFnRef = useRef(resolvedPollFn);
  pollFnRef.current = resolvedPollFn;
  const onTerminalRef = useRef(onTerminal);
  onTerminalRef.current = onTerminal;

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const pendingDelayRef = useRef(pendingPollBaseMs);
  const consecutiveErrorsRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current != null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    clearTimer();
    abortRef.current?.abort();
    abortRef.current = null;
    setIsPolling(false);
  }, [clearTimer]);

  const reset = useCallback(() => {
    cancel();
    setData(null);
    setTransportError(null);
    setConsecutiveErrors(0);
    consecutiveErrorsRef.current = 0;
    pendingDelayRef.current = pendingPollBaseMs;
    pollStartRef.current = null;
    setElapsedMs(0);
  }, [cancel, pendingPollBaseMs]);

  /** 有任务且启用轮询时记录起点并刷新已耗时（供伪进度条等使用） */
  useEffect(() => {
    if (!taskId || !enabled) {
      pollStartRef.current = null;
      setElapsedMs(0);
      return;
    }
    pollStartRef.current = Date.now();
    setElapsedMs(0);
    const tick = () => {
      const t0 = pollStartRef.current;
      if (t0 == null) return;
      setElapsedMs(Date.now() - t0);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [taskId, enabled]);

  useEffect(() => {
    if (!taskId || !enabled) {
      clearTimer();
      abortRef.current?.abort();
      setIsPolling(false);
      return;
    }

    cancelledRef.current = false;
    consecutiveErrorsRef.current = 0;
    setConsecutiveErrors(0);
    setTransportError(null);
    setData(null);
    pendingDelayRef.current = pendingPollBaseMs;

    const schedule = (delayMs: number) => {
      clearTimer();
      timeoutRef.current = setTimeout(() => {
        void runCycle();
      }, delayMs);
    };

    const runCycle = async () => {
      if (cancelledRef.current || !taskId) return;

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      setIsPolling(true);
      try {
        const result = await pollFnRef.current(taskId, ac.signal);
        if (cancelledRef.current || ac.signal.aborted) return;

        setTransportError(null);
        consecutiveErrorsRef.current = 0;
        setConsecutiveErrors(0);
        setData(result);

        if (isTerminal(result)) {
          setIsPolling(false);
          onTerminalRef.current?.(result);
          return;
        }

        const delay = Math.min(pendingPollMaxMs, pendingDelayRef.current);
        pendingDelayRef.current = Math.min(
          pendingPollMaxMs,
          pendingDelayRef.current * pendingBackoffFactor
        );
        schedule(delay);
      } catch (e) {
        if (ac.signal.aborted || cancelledRef.current) return;
        const err = e instanceof Error ? e : new Error(String(e));
        setTransportError(err);

        consecutiveErrorsRef.current += 1;
        const n = consecutiveErrorsRef.current;
        setConsecutiveErrors(n);

        if (maxConsecutiveErrors > 0 && n >= maxConsecutiveErrors) {
          setIsPolling(false);
          return;
        }

        const backoff = Math.min(errorRetryMaxMs, errorRetryInitialMs * 2 ** (n - 1));
        schedule(backoff);
      }
    };

    schedule(initialDelayMs);

    return () => {
      cancelledRef.current = true;
      clearTimer();
      abortRef.current?.abort();
    };
  }, [
    taskId,
    enabled,
    initialDelayMs,
    pendingPollBaseMs,
    pendingPollMaxMs,
    pendingBackoffFactor,
    errorRetryInitialMs,
    errorRetryMaxMs,
    maxConsecutiveErrors,
    clearTimer,
    resolvedPollFn,
  ]);

  return {
    data,
    isPolling,
    transportError,
    consecutiveErrors,
    elapsedMs,
    cancel,
    reset,
  };
}

/** 默认轮询实现（`GET /api/gateway/task/:taskId`），可在 `pollFn` 中显式传入以覆盖 */
export { fetchGatewayTaskPoll } from "@/lib/gateway-task-poll-client";
