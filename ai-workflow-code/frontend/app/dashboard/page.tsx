"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

import PageHeader from "@/components/common/PageHeader";
import StatCard from "@/components/common/StatCard";
import { apiGet } from "@/lib/api";
import { useLanguage } from "@/lib/LanguageContext";
import type { DashboardStats } from "@/lib/types";

const emptyStats: DashboardStats = {
  today_tasks: 0,
  today_cost_usd: 0,
  today_images: 0,
  pending_reviews: 0,
};

interface DailyCostItem {
  stat_date: string;
  total_cost_usd: number;
  date?: string;
  cost?: number;
}
interface ModelStatItem {
  model_name: string;
  model_provider: string;
  total_cost: number;
  image_count: number;
  value?: number;
  name?: string;
  fullName?: string;
}

function shortenModelName(name: string): string {
  if (name.includes("kling")) {
    const match = name.match(/kling[^/]*/i);
    return match ? match[0].replace("kling-", "Kling ").replace("kwaivgi/", "") : "Kling";
  }
  if (name.includes("gemini")) {
    return name.replace("gemini-", "Gemini ").split("-preview")[0].split("-image")[0];
  }
  if (name.includes("chatgpt")) {
    return name.replace("chatgpt-image-", "ChatGPT Image ").replace("chatgpt-", "ChatGPT ");
  }
  if (name.includes("gpt")) {
    return name.replace("gpt-image-", "GPT Image ").replace("gpt-", "GPT ");
  }
  return name.length > 20 ? `${name.slice(0, 18)}…` : name;
}

const PIE_COLORS = [
  "#6366f1",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>(emptyStats);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dailyCosts, setDailyCosts] = useState<DailyCostItem[]>([]);
  const [modelStats, setModelStats] = useState<ModelStatItem[]>([]);
  const [chartsLoading, setChartsLoading] = useState(true);
  const { t } = useLanguage();

  useEffect(() => {
    let active = true;

    async function loadStats() {
      setLoading(true);
      setError("");

      try {
        const res = await apiGet<DashboardStats>("/api/stats/dashboard");
        if (!active) return;

        if (res.code !== 0) {
          setError(res.msg || t("统计数据加载失败"));
          return;
        }

        setStats(res.data ?? emptyStats);
      } catch {
        if (active) setError(t("无法连接后端服务"));
      } finally {
        if (active) setLoading(false);
      }
    }

    loadStats();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadCharts() {
      setChartsLoading(true);
      try {
        const [costRes, modelRes] = await Promise.all([
          apiGet<DailyCostItem[]>("/api/stats/cost-daily"),
          apiGet<ModelStatItem[]>("/api/stats/model"),
        ]);

        if (!active) return;

        if (costRes.code === 0 && Array.isArray(costRes.data)) {
          const sorted = [...costRes.data]
            .sort((a, b) => a.stat_date.localeCompare(b.stat_date))
            .slice(-7)
            .map((item) => ({
              ...item,
              date: item.stat_date.slice(5),
              cost: Number(item.total_cost_usd || 0),
            }));
          setDailyCosts(sorted as any);
        }

        if (modelRes.code === 0 && Array.isArray(modelRes.data)) {
          setModelStats(
            modelRes.data
              .filter((item) => Number(item.total_cost) > 0)
              .map((item) => ({
                ...item,
                value: Number(item.total_cost),
                name: shortenModelName(item.model_name),
                fullName: item.model_name,
              }))
          );
        }
      } catch {
        // 图表加载失败静默处理
      } finally {
        if (active) setChartsLoading(false);
      }
    }

    loadCharts();

    return () => {
      active = false;
    };
  }, []);

  const cards = [
    { label: t("今日任务"), value: stats.today_tasks ?? 0 },
    { label: t("今日花费"), value: Number(stats.today_cost_usd ?? 0).toFixed(2), unit: "USD" },
    { label: t("今日图片"), value: stats.today_images ?? 0 },
    { label: t("待审核"), value: stats.pending_reviews ?? 0 },
  ];
  const safeCards = Array.isArray(cards) ? cards : [];

  return (
    <div>
      <PageHeader title={t("首页看板")} description={t("今日生产、成本和审核队列概览")} />

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {safeCards.map((c) => (
          <StatCard
            key={c.label}
            label={c.label}
            value={loading ? "..." : c.value}
            unit={c.unit}
          />
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">{t("7日花费折线图")}</h2>
          <div className="mt-4 h-80">
            {chartsLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-gray-400">
                {t("加载中")}
              </div>
            ) : dailyCosts.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-gray-400">
                {t("暂无数据")}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyCosts} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${Number(v).toFixed(4)}`} />
                  <Tooltip formatter={(v: number) => [`$${v.toFixed(4)}`, t("花费")] } />
                  <Line type="monotone" dataKey="cost" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm overflow-visible">
          <h2 className="text-sm font-semibold text-gray-900">{t("模型占比饼图")}</h2>
          <div className="mt-4 h-80">
            {chartsLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-gray-400">
                {t("加载中")}
              </div>
            ) : modelStats.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-gray-400">
                {t("暂无数据")}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={modelStats}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="43%"
                    outerRadius={88}
                    innerRadius={34}
                    paddingAngle={2}
                    label={({ cx, cy, midAngle, outerRadius, percent }) => {
                      if (percent == null || percent <= 0.05) return null;
                      const RADIAN = Math.PI / 180;
                      const radius = outerRadius + 18;
                      const angle = midAngle ?? 0;
                      const x = cx + radius * Math.cos(-angle * RADIAN);
                      const y = cy + radius * Math.sin(-angle * RADIAN);
                      return (
                        <text x={x} y={y} fill="#374151" textAnchor="middle" dominantBaseline="central" fontSize={11}>
                          {`${(percent * 100).toFixed(0)}%`}
                        </text>
                      );
                    }}
                    labelLine={false}
                  >
                    {modelStats.map((_, index) => (
                      <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, name: string, props: any) => [
                      `$${value.toFixed(4)}`,
                      props?.payload?.fullName || name,
                    ]}
                  />
                  <Legend
                    layout="horizontal"
                    verticalAlign="bottom"
                    align="center"
                    iconSize={8}
                    wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
