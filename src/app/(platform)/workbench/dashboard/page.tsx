// @ts-nocheck
"use client";

import { Fragment, useEffect, useState } from "react";
import {
  LineChart, Line,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";

import PageHeader from "@workbench/components/common/PageHeader";
import StatCard from "@workbench/components/common/StatCard";
import { apiGet } from "@workbench/lib/api";
import { useLanguage } from "@workbench/lib/LanguageContext";
import { usePermission } from "@workbench/lib/PermissionContext";
import type { DashboardStats } from "@workbench/lib/types";
import {
  WB_CARD_CLASS,
  WB_ERROR_BANNER_CLASS,
  WB_SECTION_TITLE_CLASS,
} from "@workbench/lib/workbench-ui-theme";

// ─── 类型 ────────────────────────────────────────────────────────────────────

const emptyStats: DashboardStats = {
  today_tasks: 0, today_cost_usd: 0, today_images: 0, pending_reviews: 0,
};

interface DailyCostItem   { stat_date: string; total_cost_usd: number; date?: string; cost?: number }
interface ModelStatItem    { model_name: string; model_provider: string; total_cost: number; image_count: number; value?: number; name?: string; fullName?: string }
interface DailyCallItem    { date: string; label: string; image_calls: number; video_calls: number; total_calls: number }
interface AiModelStat      { model_name: string; model_provider: string; call_count: number; total_tokens: number; total_cost_usd: number; type: string }
interface AiUserModelBreak { model_name: string; call_count: number; total_tokens: number; total_cost_usd: number; type: string }
interface AiUserModelStat  { user_id: number; username: string; total_calls: number; models: AiUserModelBreak[] }

// ─── 时间范围工具 ─────────────────────────────────────────────────────────────

type TimeRange = "7d" | "30d";

/** 生成最近 N 个连续日期（ISO YYYY-MM-DD），从旧到新 */
function buildDateRange(days: number): string[] {
  const today = new Date();
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (days - 1 - i));
    return d.toISOString().slice(0, 10);
  });
}

/** 时间范围切换按钮 */
function TimeRangeTab({ value, onChange }: { value: TimeRange; onChange: (v: TimeRange) => void }) {
  return (
    <div className="flex gap-0.5 rounded-md border border-white/10 bg-white/5 p-0.5">
      {(["7d", "30d"] as TimeRange[]).map((r) => (
        <button key={r} type="button" onClick={() => onChange(r)}
          className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${value === r ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
        >
          {r === "7d" ? "近7天" : "近30天"}
        </button>
      ))}
    </div>
  );
}

// ─── 工具 ────────────────────────────────────────────────────────────────────

function shortenModelName(name: string): string {
  if (name.includes("kling")) {
    const m = name.match(/kling[^/]*/i);
    return m ? m[0].replace("kling-", "Kling ").replace("kwaivgi/", "") : "Kling";
  }
  if (name.includes("gemini")) return name.replace("gemini-", "Gemini ").split("-preview")[0].split("-image")[0];
  if (name.includes("chatgpt")) return name.replace("chatgpt-image-", "ChatGPT Image ").replace("chatgpt-", "ChatGPT ");
  if (name.includes("gpt")) return name.replace("gpt-image-", "GPT Image ").replace("gpt-", "GPT ");
  if (name.includes("veo")) return name.replace("veo-", "Veo ");
  return name.length > 22 ? `${name.slice(0, 20)}…` : name;
}

const CHART_TOOLTIP_STYLE = {
  backgroundColor: "#0f1728",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "8px",
  color: "#e2e8f0",
  fontSize: "12px",
};

const PIE_COLORS = ["#6366f1","#f59e0b","#10b981","#ef4444","#3b82f6","#8b5cf6","#ec4899","#14b8a6","#f97316","#06b6d4"];

// ─── 子组件：图表容器 ────────────────────────────────────────────────────────

function ChartShell({ title, loading, empty, children, action }: {
  title: string; loading: boolean; empty: boolean; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className={WB_CARD_CLASS}>
      <div className="flex items-center justify-between">
        <h2 className={WB_SECTION_TITLE_CLASS}>{title}</h2>
        {action}
      </div>
      <div className="mt-4 h-72">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">加载中…</div>
        ) : empty ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">暂无数据</div>
        ) : children}
      </div>
    </div>
  );
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

type Dimension = "time" | "model" | "user";

export default function DashboardPage() {
  const { t } = useLanguage();
  const { isAdmin } = usePermission();

  // ── 基础统计 ──
  const [stats, setStats] = useState<DashboardStats>(emptyStats);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState("");

  // ── 历史图表（所有用户可见） ──
  const [allDailyCosts, setAllDailyCosts] = useState<DailyCostItem[]>([]); // 完整30天
  const [modelCostStats, setModelCostStats] = useState<ModelStatItem[]>([]);
  const [chartsLoading, setChartsLoading] = useState(true);
  const [costRange, setCostRange] = useState<TimeRange>("7d");

  // ── AI 调用统计（管理员专属） ──
  const [allDailyCalls, setAllDailyCalls] = useState<DailyCallItem[]>([]); // 完整30天
  const [aiModels, setAiModels] = useState<AiModelStat[]>([]);
  const [aiUsers, setAiUsers] = useState<AiUserModelStat[]>([]);
  const [aiLoading, setAiLoading] = useState(true);
  const [aiError, setAiError] = useState("");
  const [callsRange, setCallsRange] = useState<TimeRange>("7d");

  // ── 维度 Tab ──
  const [dim, setDim] = useState<Dimension>("time");
  const [expandTable, setExpandTable] = useState(false);
  const [expandedUsers, setExpandedUsers] = useState<Set<number>>(new Set());
  const [modelSearch, setModelSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");

  // ── 加载基础统计 ──
  useEffect(() => {
    let active = true;
    async function load() {
      setStatsLoading(true);
      try {
        const res = await apiGet<DashboardStats>("/api/stats/dashboard");
        if (active && res.code === 0) setStats(res.data ?? emptyStats);
        else if (active) setStatsError(res.msg || t("统计数据加载失败"));
      } catch { if (active) setStatsError(t("无法连接后端服务")); }
      finally { if (active) setStatsLoading(false); }
    }
    load();
    return () => { active = false; };
  }, []);

  // ── 加载历史图表 ──
  useEffect(() => {
    let active = true;
    async function load() {
      setChartsLoading(true);
      try {
        const [costRes, modelRes] = await Promise.all([
          apiGet<DailyCostItem[]>("/api/stats/cost-daily"),
          apiGet<ModelStatItem[]>("/api/stats/model"),
        ]);
        if (!active) return;
        if (costRes.code === 0 && Array.isArray(costRes.data)) {
          const costMap = new Map(
            costRes.data.map((item) => [item.stat_date, Number(item.total_cost_usd || 0)])
          );
          // 始终生成最近 30 个连续日期，缺失填 0
          const filled = buildDateRange(30).map((key) => ({
            stat_date: key,
            date: key.slice(5),
            cost: costMap.get(key) ?? 0,
          }));
          setAllDailyCosts(filled as any);
        }
        if (modelRes.code === 0 && Array.isArray(modelRes.data)) {
          setModelCostStats(
            modelRes.data
              .filter((i) => Number(i.total_cost) > 0)
              .map((i) => ({ ...i, value: Number(i.total_cost), name: shortenModelName(i.model_name), fullName: i.model_name }))
          );
        }
      } catch { /* 静默 */ }
      finally { if (active) setChartsLoading(false); }
    }
    load();
    return () => { active = false; };
  }, []);

  // ── 加载 AI 调用统计（仅 admin） ──
  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    async function load() {
      setAiLoading(true);
      setAiError("");
      try {
        const [callsRes, modelsRes, usersRes] = await Promise.all([
          apiGet<DailyCallItem[]>("/api/stats/daily-calls?days=30"),
          apiGet<AiModelStat[]>("/api/stats/model-detail"),
          apiGet<AiUserModelStat[]>("/api/stats/user-model"),
        ]);
        if (!active) return;
        if (callsRes.code === 0 && Array.isArray(callsRes.data)) {
          const callMap = new Map(callsRes.data.map((item) => [item.date, item]));
          // 生成最近 30 个连续日期，缺失填 0
          const filled = buildDateRange(30).map((key) => {
            const found = callMap.get(key);
            return {
              date: key,
              label: key.slice(5),
              image_calls: found?.image_calls ?? 0,
              video_calls: found?.video_calls ?? 0,
              total_calls: found?.total_calls ?? 0,
            };
          });
          setAllDailyCalls(filled);
        }
        if (modelsRes.code === 0 && Array.isArray(modelsRes.data)) setAiModels(modelsRes.data);
        else setAiError(modelsRes.msg || "AI 调用统计加载失败");
        if (usersRes.code === 0 && Array.isArray(usersRes.data)) setAiUsers(usersRes.data);
      } catch (e) { if (active) setAiError(e instanceof Error ? e.message : "请求失败"); }
      finally { if (active) setAiLoading(false); }
    }
    load();
    return () => { active = false; };
  }, [isAdmin]);

  // ── 派生数据：按时间范围切片 ──
  const costDays = costRange === "7d" ? 7 : 30;
  const dailyCosts = allDailyCosts.slice(-costDays);

  const callsDays = callsRange === "7d" ? 7 : 30;
  const dailyCalls = allDailyCalls.slice(-callsDays);

  const aiTotalCalls = aiModels.reduce((s, r) => s + r.call_count, 0);
  const aiModelCount = aiModels.length;
  const aiUserCount = aiUsers.length;

  // 按模型图表数据（取前12）
  const modelBarData = [...aiModels]
    .sort((a, b) => b.call_count - a.call_count)
    .slice(0, 12)
    .map((r) => ({ name: shortenModelName(r.model_name), fullName: r.model_name, calls: r.call_count }))
    .reverse(); // 让最大值在顶部

  // 按用户图表数据（取前12）
  const userBarData = [...aiUsers]
    .sort((a, b) => b.total_calls - a.total_calls)
    .slice(0, 12)
    .map((r) => ({ name: r.username.length > 16 ? `${r.username.slice(0, 14)}…` : r.username, calls: r.total_calls }))
    .reverse();

  // 饼图数据（按调用次数）
  const modelPieData = [...aiModels]
    .sort((a, b) => b.call_count - a.call_count)
    .slice(0, 8)
    .map((r) => ({ name: shortenModelName(r.model_name), fullName: r.model_name, value: r.call_count }));

  const toggleUser = (id: number) => {
    setExpandedUsers((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const filteredModels = aiModels
    .filter((r) => !modelSearch || r.model_name.toLowerCase().includes(modelSearch.toLowerCase()))
    .sort((a, b) => b.call_count - a.call_count);

  const filteredUsers = aiUsers
    .filter((r) => !userSearch || r.username.toLowerCase().includes(userSearch.toLowerCase()))
    .sort((a, b) => b.total_calls - a.total_calls);

  return (
    <div className="space-y-6">
      <PageHeader title={t("首页看板")} description={t("生产成本、模型调用与用户使用概览")} />

      {statsError && <div className={WB_ERROR_BANNER_CLASS}>{statsError}</div>}

      {/* ── 基础统计卡片 ── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: t("今日任务"), value: stats.today_tasks ?? 0 },
          { label: t("今日花费"), value: Number(stats.today_cost_usd ?? 0).toFixed(2), unit: "USD" },
          { label: t("今日图片"), value: stats.today_images ?? 0 },
          { label: t("待审核"), value: stats.pending_reviews ?? 0 },
        ].map((c) => (
          <StatCard key={c.label} label={c.label} value={statsLoading ? "…" : c.value} unit={c.unit} />
        ))}
      </div>

      {/* ── 历史趋势图（所有用户） ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartShell
          title={t("花费趋势")}
          loading={chartsLoading}
          empty={dailyCosts.length === 0}
          action={<TimeRangeTab value={costRange} onChange={setCostRange} />}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dailyCosts} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94a3b8" }} stroke="rgba(255,255,255,0.1)" />
              <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} stroke="rgba(255,255,255,0.1)" tickFormatter={(v) => `$${Number(v).toFixed(4)}`} />
              <Tooltip formatter={(v) => [`$${Number(v ?? 0).toFixed(4)}`, t("花费")]} contentStyle={CHART_TOOLTIP_STYLE} />
              <Line type="monotone" dataKey="cost" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartShell>

        <ChartShell title={t("模型费用占比")} loading={chartsLoading} empty={modelCostStats.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={modelCostStats} dataKey="value" nameKey="name" cx="50%" cy="43%" outerRadius={86} innerRadius={32} paddingAngle={2}
                label={({ cx, cy, midAngle, outerRadius, percent }) => {
                  if (!percent || percent <= 0.05) return null;
                  const R = Math.PI / 180;
                  const r = outerRadius + 18;
                  const x = cx + r * Math.cos(-midAngle * R);
                  const y = cy + r * Math.sin(-midAngle * R);
                  return <text x={x} y={y} fill="#94a3b8" textAnchor="middle" dominantBaseline="central" fontSize={11}>{`${(percent * 100).toFixed(0)}%`}</text>;
                }}
                labelLine={false}
              >
                {modelCostStats.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v, name, p) => [`$${Number(v ?? 0).toFixed(4)}`, (p as any)?.payload?.fullName || String(name)]} contentStyle={CHART_TOOLTIP_STYLE} />
              <Legend layout="horizontal" verticalAlign="bottom" align="center" iconSize={8} wrapperStyle={{ fontSize: "11px", paddingTop: "8px", color: "#94a3b8" }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartShell>
      </div>

      {/* ════════════════════════════════════════════════════
          以下为管理员专属：AI 模型调用统计
          ════════════════════════════════════════════════════ */}
      {isAdmin && (
        <div className="space-y-4">
          {/* 分隔标题 */}
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-slate-300">AI 模型调用统计</span>
            <div className="h-px flex-1 bg-white/10" />
            <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-xs text-indigo-300">管理员可见</span>
          </div>

          {aiError && <div className={WB_ERROR_BANNER_CLASS}>{aiError}</div>}

          {/* AI 摘要卡片 */}
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: "AI 总调用次数", value: aiLoading ? "…" : aiTotalCalls.toLocaleString() },
              { label: "模型种类", value: aiLoading ? "…" : aiModelCount },
              { label: "活跃用户数", value: aiLoading ? "…" : aiUserCount },
            ].map((c) => (
              <StatCard key={c.label} label={c.label} value={c.value} />
            ))}
          </div>

          {/* 维度切换 Tab */}
          <div className="flex gap-1 rounded-lg border border-white/10 bg-white/5 p-1 w-fit">
            {(["time", "model", "user"] as Dimension[]).map((d) => (
              <button key={d} type="button" onClick={() => setDim(d)}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${dim === d ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-slate-200"}`}
              >
                {d === "time" ? "按时间" : d === "model" ? "按模型" : "按用户"}
              </button>
            ))}
          </div>

          {/* 图表区 */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* 左图：随维度变化 */}
            {dim === "time" && (
              <ChartShell
                title="每日调用量"
                loading={aiLoading}
                empty={dailyCalls.length === 0}
                action={<TimeRangeTab value={callsRange} onChange={setCallsRange} />}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyCalls} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} stroke="rgba(255,255,255,0.1)" interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} stroke="rgba(255,255,255,0.1)" allowDecimals={false} />
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: "11px", color: "#94a3b8" }} />
                    <Line type="monotone" dataKey="image_calls" name="图片调用" stroke="#6366f1" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
                    <Line type="monotone" dataKey="video_calls" name="视频调用" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartShell>
            )}

            {dim === "model" && (
              <ChartShell title="各模型调用次数（Top 12）" loading={aiLoading} empty={modelBarData.length === 0}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={modelBarData} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} stroke="rgba(255,255,255,0.1)" allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} stroke="rgba(255,255,255,0.1)" width={110} />
                    <Tooltip formatter={(v, _, p) => [v, (p as any)?.payload?.fullName || "调用次数"]} contentStyle={CHART_TOOLTIP_STYLE} />
                    <Bar dataKey="calls" name="调用次数" radius={[0, 4, 4, 0]}>
                      {modelBarData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartShell>
            )}

            {dim === "user" && (
              <ChartShell title="各用户调用次数（Top 12）" loading={aiLoading} empty={userBarData.length === 0}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={userBarData} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} stroke="rgba(255,255,255,0.1)" allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} stroke="rgba(255,255,255,0.1)" width={100} />
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                    <Bar dataKey="calls" name="调用次数" fill="#6366f1" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartShell>
            )}

            {/* 右图：模型调用分布饼图 */}
            <ChartShell title="模型调用分布（次数占比）" loading={aiLoading} empty={modelPieData.length === 0}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={modelPieData} dataKey="value" nameKey="name" cx="50%" cy="43%" outerRadius={86} innerRadius={32} paddingAngle={2}
                    label={({ cx, cy, midAngle, outerRadius, percent }) => {
                      if (!percent || percent <= 0.05) return null;
                      const R = Math.PI / 180;
                      const r = outerRadius + 18;
                      const x = cx + r * Math.cos(-midAngle * R);
                      const y = cy + r * Math.sin(-midAngle * R);
                      return <text x={x} y={y} fill="#94a3b8" textAnchor="middle" dominantBaseline="central" fontSize={11}>{`${(percent * 100).toFixed(0)}%`}</text>;
                    }}
                    labelLine={false}
                  >
                    {modelPieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v, name, p) => [v, (p as any)?.payload?.fullName || String(name)]} contentStyle={CHART_TOOLTIP_STYLE} />
                  <Legend layout="horizontal" verticalAlign="bottom" align="center" iconSize={8} wrapperStyle={{ fontSize: "11px", paddingTop: "8px", color: "#94a3b8" }} />
                </PieChart>
              </ResponsiveContainer>
            </ChartShell>
          </div>

          {/* 详情表展开按钮 */}
          <button
            type="button"
            onClick={() => setExpandTable((v) => !v)}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/10"
          >
            <span>{expandTable ? "▲ 收起详情表格" : "▼ 展开详情表格"}</span>
          </button>

          {expandTable && (
            <div className="space-y-6">
              {/* 模型汇总表 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-slate-300">各 AI 模型调用汇总</h3>
                  <input
                    type="text"
                    placeholder="搜索模型名…"
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    className="w-52 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-indigo-500/60"
                  />
                </div>
                <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0f1728]">
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5">
                        {["#", "模型名称", "类型", "调用次数", "Token 用量", "费用（USD）"].map((h, i) => (
                          <th key={h} className={`px-4 py-3 text-xs font-medium uppercase tracking-wider text-slate-400 ${i >= 3 ? "text-right" : "text-left"}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {aiLoading ? (
                        <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">正在加载…</td></tr>
                      ) : filteredModels.length === 0 ? (
                        <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">暂无数据</td></tr>
                      ) : filteredModels.map((row, idx) => (
                        <tr key={row.model_name} className="hover:bg-white/5 transition-colors">
                          <td className="px-4 py-3 text-sm text-slate-500">{idx + 1}</td>
                          <td className="px-4 py-3">
                            <code className="text-sm font-medium text-indigo-200">{row.model_name}</code>
                            <p className="text-xs text-slate-500">{row.model_provider}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${row.type === "video" ? "border-violet-500/30 bg-violet-500/15 text-violet-300" : "border-blue-500/30 bg-blue-500/15 text-blue-300"}`}>
                              {row.type === "video" ? "视频" : "图片"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-sm font-semibold text-slate-100">{row.call_count.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-sm text-slate-400">{row.total_tokens > 0 ? row.total_tokens.toLocaleString() : <span className="text-slate-600">—</span>}</td>
                          <td className="px-4 py-3 text-right text-sm text-slate-300">${row.total_cost_usd.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 用户明细表（可展开） */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-slate-300">各用户调用明细</h3>
                  <input
                    type="text"
                    placeholder="搜索用户名…"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className="w-52 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-indigo-500/60"
                  />
                </div>
                <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0f1728]">
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5">
                        <th className="w-8 px-4 py-3" />
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">用户名</th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400">总调用次数</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {aiLoading ? (
                        <tr><td colSpan={3} className="px-4 py-8 text-center text-sm text-slate-500">正在加载…</td></tr>
                      ) : filteredUsers.length === 0 ? (
                        <tr><td colSpan={3} className="px-4 py-8 text-center text-sm text-slate-500">暂无数据</td></tr>
                      ) : filteredUsers.map((user) => {
                        const isExp = expandedUsers.has(user.user_id);
                        return (
                          <Fragment key={user.user_id}>
                            <tr onClick={() => toggleUser(user.user_id)} className="cursor-pointer hover:bg-white/5 transition-colors">
                              <td className="px-4 py-3 text-center text-xs text-slate-500 select-none">{isExp ? "▲" : "▼"}</td>
                              <td className="px-4 py-3 text-sm font-medium text-slate-100">{user.username}</td>
                              <td className="px-4 py-3 text-right text-sm font-semibold text-slate-100">{user.total_calls.toLocaleString()}</td>
                            </tr>
                            {isExp && (
                              <tr>
                                <td colSpan={3} className="bg-white/[0.02] px-0 py-0">
                                  <div className="border-t border-white/5 px-6 py-3">
                                    <div className="overflow-hidden rounded-lg border border-white/5">
                                      <table className="min-w-full text-sm">
                                        <thead>
                                          <tr className="bg-white/5">
                                            {["模型名称", "类型", "调用次数", "Token", "费用（USD）"].map((h, i) => (
                                              <th key={h} className={`px-3 py-2 text-xs font-medium text-slate-500 ${i >= 2 ? "text-right" : "text-left"}`}>{h}</th>
                                            ))}
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/5">
                                          {user.models.map((m) => (
                                            <tr key={m.model_name} className="hover:bg-white/5">
                                              <td className="px-3 py-2"><code className="text-xs text-indigo-200">{m.model_name}</code></td>
                                              <td className="px-3 py-2">
                                                <span className={`rounded-full px-1.5 py-0.5 text-xs ${m.type === "video" ? "bg-violet-500/15 text-violet-300" : "bg-blue-500/15 text-blue-300"}`}>
                                                  {m.type === "video" ? "视频" : "图片"}
                                                </span>
                                              </td>
                                              <td className="px-3 py-2 text-right font-semibold text-slate-100">{m.call_count.toLocaleString()}</td>
                                              <td className="px-3 py-2 text-right text-slate-400">{m.total_tokens > 0 ? m.total_tokens.toLocaleString() : <span className="text-slate-600">—</span>}</td>
                                              <td className="px-3 py-2 text-right text-slate-300">${m.total_cost_usd.toFixed(4)}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-slate-600">点击用户行可展开该用户在每个 AI 模型上的调用明细</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
