// @ts-nocheck
"use client";

import { useEffect, useState } from "react";

import PageHeader from "@workbench/components/common/PageHeader";
import { apiGet } from "@workbench/lib/api";
import { useLanguage } from "@workbench/lib/LanguageContext";
import type { DashboardStats } from "@workbench/lib/types";

interface DailyCostStat {
  id?: number;
  stat_date: string;
  user_id?: number;
  model_provider?: string;
  total_tokens: number;
  total_cost: number;
  image_count: number;
}

interface ModelStat {
  model_provider: string;
  total_tokens: number;
  total_cost: number;
  image_count: number;
}

interface UserStat {
  user_id: number;
  username?: string;
  total_tokens: number;
  total_cost: number;
  image_count: number;
}

interface ImagePerformanceStat {
  id: number;
  image_id?: number;
  final_image_id?: number;
  image_url?: string;
  likes: number;
  comments: number;
  shares: number;
  score: number;
}

function formatMoney(value: number | string | undefined) {
  return `$${Number(value || 0).toFixed(4)}`;
}

function EmptyRow({ colSpan }: { colSpan: number }) {
  const { t } = useLanguage();
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-sm text-gray-500">
        {t("暂无数据")}
      </td>
    </tr>
  );
}

export default function StatsPage() {
  const { t } = useLanguage();
  const [dashboard, setDashboard] = useState<DashboardStats | null>(null);
  const [dailyCosts, setDailyCosts] = useState<DailyCostStat[]>([]);
  const [modelStats, setModelStats] = useState<ModelStat[]>([]);
  const [userStats, setUserStats] = useState<UserStat[]>([]);
  const [imageStats, setImageStats] = useState<ImagePerformanceStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const safeDailyCosts = Array.isArray(dailyCosts) ? dailyCosts : [];
  const safeModelStats = Array.isArray(modelStats) ? modelStats : [];
  const safeUserStats = Array.isArray(userStats) ? userStats : [];
  const safeImageStats = Array.isArray(imageStats) ? imageStats : [];

  useEffect(() => {
    let active = true;

    async function loadStats() {
      setLoading(true);
      setError("");

      try {
        const [dashboardRes, costRes, modelRes, userRes, imageRes] = await Promise.all([
          apiGet<DashboardStats>("/api/stats/dashboard"),
          apiGet<DailyCostStat[]>("/api/stats/cost-daily"),
          apiGet<ModelStat[]>("/api/stats/model"),
          apiGet<UserStat[]>("/api/stats/user"),
          apiGet<ImagePerformanceStat[]>("/api/stats/images"),
        ]);

        if (!active) return;

        const failed = [dashboardRes, costRes, modelRes, userRes, imageRes].find(
          (res) => res.code !== 0,
        );
        if (failed) {
          setError(failed.msg || t("统计数据加载失败"));
          return;
        }

        setDashboard(dashboardRes.data ?? null);
        setDailyCosts(Array.isArray(costRes.data) ? costRes.data : []);
        setModelStats(Array.isArray(modelRes.data) ? modelRes.data : []);
        setUserStats(Array.isArray(userRes.data) ? userRes.data : []);
        setImageStats(Array.isArray(imageRes.data) ? imageRes.data : []);
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

  return (
    <div>
      <PageHeader title={t("统计中心")} description={t("成本、模型、用户和图片表现的运营统计")} />

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {dashboard && (
        <div className="mb-6 grid gap-4 md:grid-cols-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500">{t("总任务")}</p>
            <p className="mt-2 text-xl font-semibold text-gray-900">{dashboard.today_tasks}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500">{t("总花费")}</p>
            <p className="mt-2 text-xl font-semibold text-gray-900">
              {formatMoney(dashboard.today_cost_usd)}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500">{t("总图片")}</p>
            <p className="mt-2 text-xl font-semibold text-gray-900">{dashboard.today_images}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500">{t("待审核")}</p>
            <p className="mt-2 text-xl font-semibold text-gray-900">{dashboard.pending_reviews}</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
          {t("正在加载统计数据...")}
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-5 py-4">
              <h2 className="text-base font-semibold text-gray-900">{t("每日花费")}</h2>
              <p className="mt-1 text-xs text-gray-500">{t("可接入图表库")}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("日期")}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("模型")}</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Token</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">{t("花费")}</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">{t("图片")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {safeDailyCosts.length === 0 ? (
                    <EmptyRow colSpan={5} />
                  ) : (
                    safeDailyCosts.map((item, index) => (
                      <tr key={`${item.stat_date}-${item.model_provider}-${index}`}>
                        <td className="px-4 py-3 text-sm text-gray-700">{item.stat_date}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{item.model_provider || "-"}</td>
                        <td className="px-4 py-3 text-right text-sm text-gray-700">{item.total_tokens}</td>
                        <td className="px-4 py-3 text-right text-sm text-gray-900">{formatMoney(item.total_cost)}</td>
                        <td className="px-4 py-3 text-right text-sm text-gray-700">{item.image_count}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-5 py-4">
              <h2 className="text-base font-semibold text-gray-900">{t("模型使用占比")}</h2>
              <p className="mt-1 text-xs text-gray-500">{t("可接入图表库")}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("模型")}</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Token</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">{t("花费")}</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">{t("图片")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {safeModelStats.length === 0 ? (
                    <EmptyRow colSpan={4} />
                  ) : (
                    safeModelStats.map((item) => (
                      <tr key={item.model_provider}>
                        <td className="px-4 py-3 text-sm text-gray-700">{item.model_provider}</td>
                        <td className="px-4 py-3 text-right text-sm text-gray-700">{item.total_tokens}</td>
                        <td className="px-4 py-3 text-right text-sm text-gray-900">{formatMoney(item.total_cost)}</td>
                        <td className="px-4 py-3 text-right text-sm text-gray-700">{item.image_count}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-5 py-4">
              <h2 className="text-base font-semibold text-gray-900">{t("用户花费排行")}</h2>
              <p className="mt-1 text-xs text-gray-500">{t("可接入图表库")}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("用户")}</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Token</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">{t("花费")}</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">{t("图片")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {safeUserStats.length === 0 ? (
                    <EmptyRow colSpan={4} />
                  ) : (
                    safeUserStats
                      .slice()
                      .sort((a, b) => Number(b.total_cost) - Number(a.total_cost))
                      .map((item) => (
                        <tr key={item.user_id}>
                          <td className="px-4 py-3 text-sm text-gray-700">
                          {item.username || `${t("用户")} #${item.user_id}`}
                          </td>
                          <td className="px-4 py-3 text-right text-sm text-gray-700">{item.total_tokens}</td>
                          <td className="px-4 py-3 text-right text-sm text-gray-900">{formatMoney(item.total_cost)}</td>
                          <td className="px-4 py-3 text-right text-sm text-gray-700">{item.image_count}</td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-5 py-4">
              <h2 className="text-base font-semibold text-gray-900">{t("图片表现排行")}</h2>
              <p className="mt-1 text-xs text-gray-500">{t("可接入图表库")}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("图片")}</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">{t("点赞")}</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">{t("评论")}</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">{t("分享")}</th>
                  </tr>
                </thead>
                <tbody>
                  {safeImageStats.length === 0 ? (
                    <EmptyRow colSpan={4} />
                  ) : (
                    safeImageStats.map((item) => (
                      <tr key={item.id}>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          #{item.final_image_id || item.image_id || item.id}
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-gray-700">{item.likes}</td>
                        <td className="px-4 py-3 text-right text-sm text-gray-700">{item.comments}</td>
                        <td className="px-4 py-3 text-right text-sm text-gray-700">{item.shares}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
