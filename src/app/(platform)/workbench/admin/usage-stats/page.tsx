"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@workbench/components/common/PageHeader";

type DurationStats = { p50: number | null; p95?: number | null; average?: number | null };
type StageStats = {
  stage: string;
  sampleCount: number;
  failureRate: number;
  durationMs: DurationStats;
};
type PlanningBaseline = {
  storageReady: boolean;
  generatedAt: string;
  windowDays: number;
  sampleCount: number;
  completedCount: number;
  failedCount: number;
  successRate: number;
  firstPassRate: number;
  jsonRepairRate: number;
  singleTakeRepairRate: number;
  checkpointResumeRate: number;
  totalDurationMs: DurationStats;
  queueDurationMs: { p50: number | null };
  stages: StageStats[];
  availableModels: string[];
  baseline: {
    ready: boolean;
    recommendedMinimum: number;
    remainingSamples: number;
  };
};

const WINDOWS = [1, 7, 30] as const;

function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value < 1000) return `${value} ms`;
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} 秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}分${Math.round(seconds % 60)}秒`;
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{hint}</div>
    </div>
  );
}

export default function UsageStatsPage() {
  const [days, setDays] = useState<number>(7);
  const [data, setData] = useState<PlanningBaseline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/admin/stats/video-planning?days=${days}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<PlanningBaseline>;
      })
      .then(setData)
      .catch((reason) => {
        if (reason instanceof Error && reason.name === "AbortError") return;
        setError("性能数据读取失败，请稍后重试。");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [days]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="生产性能基线"
        description="第一轮剧本规划的真实耗时、成功率与重试成本"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-lg border border-white/10 bg-black/20 p-1">
          {WINDOWS.map((windowDays) => (
            <button
              key={windowDays}
              type="button"
              onClick={() => setDays(windowDays)}
              className={`rounded-md px-4 py-2 text-sm transition ${
                days === windowDays ? "bg-cyan-500/20 text-cyan-200" : "text-slate-400 hover:text-white"
              }`}
            >
              {windowDays} 天
            </button>
          ))}
        </div>
        <Link href="/workbench/dashboard" className="text-sm text-cyan-300 hover:text-cyan-200">
          返回首页看板
        </Link>
      </div>

      {error ? <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div> : null}
      {!loading && data && !data.storageReady ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          性能数据表尚未就绪。请先执行数据库迁移，再启动采集。
        </div>
      ) : null}
      {!loading && data?.storageReady && !data.baseline.ready ? (
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4 text-sm text-cyan-100">
          基线正在积累：建议至少完成 {data.baseline.recommendedMinimum} 次规划，当前还差 {data.baseline.remainingSamples} 次。
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="总耗时 P50" value={loading ? "…" : formatDuration(data?.totalDurationMs.p50)} hint="一半任务在此时间内完成" />
        <MetricCard label="总耗时 P95" value={loading ? "…" : formatDuration(data?.totalDurationMs.p95)} hint="用于发现长尾慢任务" />
        <MetricCard label="成功率" value={loading ? "…" : `${data?.successRate ?? 0}%`} hint={`${data?.completedCount ?? 0} 成功 / ${data?.failedCount ?? 0} 失败`} />
        <MetricCard label="首轮通过率" value={loading ? "…" : `${data?.firstPassRate ?? 0}%`} hint="未触发结构或内容修复" />
        <MetricCard label="样本量" value={loading ? "…" : String(data?.sampleCount ?? 0)} hint={`最近 ${days} 天的规划任务`} />
        <MetricCard label="排队耗时 P50" value={loading ? "…" : formatDuration(data?.queueDurationMs.p50)} hint="队列拥堵与模型耗时分开计算" />
        <MetricCard label="JSON 修复率" value={loading ? "…" : `${data?.jsonRepairRate ?? 0}%`} hint="结构化输出不合法的任务占比" />
        <MetricCard label="一镜到底修复率" value={loading ? "…" : `${data?.singleTakeRepairRate ?? 0}%`} hint="触发动作连续性修复的任务占比" />
      </div>

      <section className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
        <div className="border-b border-white/10 px-5 py-4">
          <h2 className="font-medium text-white">阶段性能</h2>
          <p className="mt-1 text-xs text-slate-500">按真实模型调用统计；修复请求单独列出。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-white/[0.03] text-xs text-slate-400">
              <tr>
                <th className="px-5 py-3 font-medium">阶段</th>
                <th className="px-5 py-3 font-medium">样本</th>
                <th className="px-5 py-3 font-medium">P50</th>
                <th className="px-5 py-3 font-medium">P95</th>
                <th className="px-5 py-3 font-medium">失败率</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {(data?.stages ?? []).map((stage) => (
                <tr key={stage.stage} className="text-slate-200">
                  <td className="px-5 py-3 font-mono text-xs text-cyan-200">{stage.stage}</td>
                  <td className="px-5 py-3">{stage.sampleCount}</td>
                  <td className="px-5 py-3">{formatDuration(stage.durationMs.p50)}</td>
                  <td className="px-5 py-3">{formatDuration(stage.durationMs.p95)}</td>
                  <td className="px-5 py-3">{stage.failureRate}%</td>
                </tr>
              ))}
              {!loading && !(data?.stages.length) ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-500">当前时间范围内还没有阶段样本。</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
