// @ts-nocheck
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import PageHeader from "@workbench/components/common/PageHeader";
import TaskTable from "@workbench/components/tasks/TaskTable";
import { apiGet } from "@workbench/lib/api";
import { useLanguage } from "@workbench/lib/LanguageContext";
import type { Task } from "@workbench/lib/types";

export default function TasksPage() {
  const { t } = useLanguage();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadTasks() {
      setLoading(true);
      setError("");

      try {
        const res = await apiGet<Task[]>("/api/tasks");
        if (!active) return;

        if (res.code !== 0) {
          setError(res.msg || t("任务列表加载失败"));
          return;
        }

        setTasks(Array.isArray(res.data) ? res.data : []);
      } catch {
        if (active) setError(t("无法连接后端服务"));
      } finally {
        if (active) setLoading(false);
      }
    }

    loadTasks();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div>
      <PageHeader
        title={t("任务中心")}
        description={t("查看图片生产任务、成本和当前流转状态")}
        action={
          <Link
            href="/workbench/tasks/create"
            className="inline-flex items-center rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700"
          >
            {t("创建任务")}
          </Link>
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
          {t("正在加载任务...")}
        </div>
      ) : (
        <TaskTable tasks={tasks} />
      )}
    </div>
  );
}
