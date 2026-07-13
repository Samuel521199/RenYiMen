"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";

import {
  DEFAULT_DISK_CRITICAL_PERCENT,
  DEFAULT_DISK_WARN_PERCENT,
  formatBytesAsGib,
  formatDiskUsageSummary,
  getDiskUsageLevel,
  type DiskUsagePayload,
} from "@/lib/disk-usage";
import { useT } from "@/i18n";

const DEFAULT_REFRESH_MS = 60_000;

function levelClasses(level: "normal" | "warning" | "critical"): string {
  if (level === "critical") {
    return "border-red-400/70 bg-gradient-to-r from-red-950/80 to-red-900/60 text-red-100 ring-red-400/40";
  }
  if (level === "warning") {
    return "border-amber-400/70 bg-gradient-to-r from-amber-950/70 to-amber-900/50 text-amber-100 ring-amber-400/30";
  }
  return "border-slate-500/40 bg-slate-900/70 text-slate-200 ring-slate-500/20";
}

export function DiskUsageIndicator({ refreshMs = DEFAULT_REFRESH_MS }: { refreshMs?: number }) {
  const { status } = useSession();
  const t = useT();
  const [data, setData] = useState<DiskUsagePayload | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (status !== "authenticated") return;
    setLoading(true);
    try {
      const res = await fetch("/api/system/disk-usage", {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) {
        setData(null);
        return;
      }
      const json = (await res.json()) as DiskUsagePayload;
      if (typeof json.total_bytes === "number" && typeof json.used_percent === "number") {
        setData(json);
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
  }, [load]);

  useEffect(() => {
    if (status !== "authenticated") return;
    const id = window.setInterval(() => void load(), refreshMs);
    return () => window.clearInterval(id);
  }, [status, refreshMs, load]);

  if (status !== "authenticated") {
    return null;
  }

  const level = data ? getDiskUsageLevel(data.used_percent) : "normal";
  const summary = data
    ? formatDiskUsageSummary(data)
    : loading
      ? "…"
      : "—";
  const tooltip = data
    ? level === "critical"
      ? t.diskUsageCriticalTip(formatBytesAsGib(data.free_bytes), formatBytesAsGib(data.total_bytes))
      : level === "warning"
        ? t.diskUsageWarningTip(formatBytesAsGib(data.free_bytes), formatBytesAsGib(data.total_bytes))
        : t.diskUsageNormalTip(data.path, formatBytesAsGib(data.free_bytes), formatBytesAsGib(data.total_bytes))
    : t.diskUsageUnavailable;

  return (
    <div
      className={`hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs shadow-sm ring-1 sm:inline-flex ${levelClasses(level)}`}
      title={tooltip}
      role="status"
      aria-live="polite"
    >
      <span className="text-sm leading-none" aria-hidden>
        {level === "critical" ? "⚠️" : level === "warning" ? "🟠" : "💾"}
      </span>
      <div className="flex min-w-0 flex-col leading-none">
        <span className="text-[9px] font-medium uppercase tracking-wide opacity-80">{t.diskUsageLabel}</span>
        <span className="font-mono text-sm font-semibold tabular-nums tracking-tight">{summary}</span>
      </div>
    </div>
  );
}
