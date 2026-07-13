"use client";

import { useEffect, useState } from "react";

import PageHeader from "@/components/common/PageHeader";
import { apiGet } from "@/lib/api";
import { useLanguage } from "@/lib/LanguageContext";

interface AuditLog {
  id: number;
  user_id?: number;
  action: string;
  detail?: string;
  ip_address?: string;
  created_at: string;
}

function formatDate(value: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function AdminLogsPage() {
  const { t } = useLanguage();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const safeLogs = Array.isArray(logs) ? logs : [];

  useEffect(() => {
    let active = true;

    async function loadLogs() {
      setLoading(true);
      setError("");

      try {
        const res = await apiGet<AuditLog[]>("/api/audit-logs");
        if (!active) return;

        if (res.code !== 0) {
          setError(res.msg || t("审计日志加载失败"));
          return;
        }

        setLogs(Array.isArray(res.data) ? res.data : []);
      } catch {
        if (active) setError(t("无法连接后端服务"));
      } finally {
        if (active) setLoading(false);
      }
    }

    loadLogs();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div>
      <PageHeader title={t("审计日志")} description={t("查看用户操作、来源 IP 和关键行为详情")} />

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("时间")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("用户")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("操作")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("详情")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">
                  {t("正在加载日志...")}
                </td>
              </tr>
            ) : safeLogs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">
                  {t("暂无日志")}
                </td>
              </tr>
            ) : (
              safeLogs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                    {formatDate(log.created_at)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {log.user_id ? `${t("用户")} #${log.user_id}` : "-"}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{log.action}</td>
                  <td className="max-w-xl px-4 py-3 text-sm text-gray-600">
                    <span className="line-clamp-2">{log.detail || "-"}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-gray-500">
                    {log.ip_address || "-"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
