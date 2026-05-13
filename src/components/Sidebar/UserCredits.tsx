"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";

const DEFAULT_REFRESH_MS = 20_000;

type ProfilePayload = {
  balance: number;
};

function formatCredits(n: number): string {
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}

/**
 * 工作台积分展示：拉取 `/api/user/profile` 中的 `balance`；默认定时同步，也可通过 `refreshKey` 在任务结算后立即刷新。
 */
export function UserCredits({
  refreshMs = DEFAULT_REFRESH_MS,
  /** 变化时立即重新拉取余额（如任务终态结算后） */
  refreshKey = 0,
}: {
  refreshMs?: number;
  refreshKey?: number;
}) {
  const { status } = useSession();
  const [data, setData] = useState<ProfilePayload | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (status !== "authenticated") return;
    setLoading(true);
    try {
      const res = await fetch("/api/user/profile", {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) {
        setData(null);
        return;
      }
      const json: unknown = await res.json();
      if (json && typeof json === "object" && typeof (json as ProfilePayload).balance === "number") {
        setData({ balance: Math.floor((json as ProfilePayload).balance) });
      } else {
        setData(null);
      }
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (status !== "authenticated") return;
    const id = window.setInterval(() => void load(), refreshMs);
    return () => window.clearInterval(id);
  }, [status, refreshMs, load]);

  if (status !== "authenticated") {
    return null;
  }

  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border border-amber-200/90 bg-gradient-to-r from-amber-50 to-amber-100/80 px-3 py-1.5 shadow-sm ring-1 ring-amber-300/30"
      title="当前积分余额（任务完成后会立即同步，其余时间定时刷新）"
    >
      <span className="text-base leading-none" aria-hidden>
        💎
      </span>
      <div className="flex min-w-0 flex-col leading-none">
        <span className="text-[9px] font-medium uppercase tracking-wide text-amber-900/70">积分</span>
        <span className="font-mono text-sm font-semibold tabular-nums tracking-tight text-amber-950">
          {loading && data == null ? "…" : data != null ? `${formatCredits(data.balance)} 积分` : "—"}
        </span>
      </div>
    </div>
  );
}
