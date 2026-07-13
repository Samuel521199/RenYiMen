"use client";

import Link from "next/link";

import TaskStatusBadge from "@workbench/components/tasks/TaskStatusBadge";
import { useLanguage } from "@workbench/lib/LanguageContext";
import type { Task } from "@workbench/lib/types";
import {
  WB_TABLE_HEAD_CLASS,
  WB_TABLE_ROW_HOVER_CLASS,
  WB_TABLE_TH_CLASS,
  WB_TABLE_WRAP_CLASS,
} from "@workbench/lib/workbench-ui-theme";

interface TaskTableProps {
  tasks: Task[];
}

function formatDate(value: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TaskTable({ tasks }: TaskTableProps) {
  const { t } = useLanguage();
  const safeTasks = Array.isArray(tasks) ? tasks : [];

  return (
    <div className={WB_TABLE_WRAP_CLASS}>
      <table className="min-w-full divide-y divide-white/10">
        <thead className={WB_TABLE_HEAD_CLASS}>
          <tr>
            <th className={WB_TABLE_TH_CLASS}>ID</th>
            <th className={WB_TABLE_TH_CLASS}>{t("标题")}</th>
            <th className={WB_TABLE_TH_CLASS}>{t("场景")}</th>
            <th className={WB_TABLE_TH_CLASS}>{t("状态")}</th>
            <th className={WB_TABLE_TH_CLASS}>{t("成本")}</th>
            <th className={WB_TABLE_TH_CLASS}>{t("创建时间")}</th>
            <th className={`${WB_TABLE_TH_CLASS} text-right`}>{t("操作")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {safeTasks.length === 0 ? (
            <tr>
              <td className="px-4 py-8 text-center text-sm text-slate-500" colSpan={7}>
                {t("暂无任务")}
              </td>
            </tr>
          ) : (
            safeTasks.map((task) => (
              <tr key={task.id} className={WB_TABLE_ROW_HOVER_CLASS}>
                <td className="px-4 py-3 text-sm text-slate-500">#{task.id}</td>
                <td className="px-4 py-3 text-sm font-medium text-slate-100">{task.title}</td>
                <td className="px-4 py-3 text-sm text-slate-400">{task.scene}</td>
                <td className="px-4 py-3">
                  <TaskStatusBadge status={task.status} />
                </td>
                <td className="px-4 py-3 text-sm text-slate-400">
                  ${Number(task.cost ?? task.budget ?? 0).toFixed(2)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-500">{formatDate(task.created_at)}</td>
                <td className="px-4 py-3 text-right text-sm">
                  <Link
                    href={`/tasks/${task.id}`}
                    className="font-medium text-indigo-300 hover:text-indigo-200"
                  >
                    {t("查看")}
                  </Link>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
