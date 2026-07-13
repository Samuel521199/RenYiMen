import Link from "next/link";

import TaskStatusBadge from "@/components/tasks/TaskStatusBadge";
import type { Task } from "@/lib/types";

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
  const safeTasks = Array.isArray(tasks) ? tasks : [];

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">ID</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">标题</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">场景</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">状态</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">成本</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">创建时间</th>
            <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {safeTasks.length === 0 ? (
            <tr>
              <td className="px-4 py-8 text-center text-sm text-gray-500" colSpan={7}>
                暂无任务
              </td>
            </tr>
          ) : (
            safeTasks.map((task) => (
              <tr key={task.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm text-gray-500">#{task.id}</td>
                <td className="px-4 py-3 text-sm font-medium text-gray-900">{task.title}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{task.scene}</td>
                <td className="px-4 py-3">
                  <TaskStatusBadge status={task.status} />
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  ${Number(task.cost ?? task.budget ?? 0).toFixed(2)}
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">{formatDate(task.created_at)}</td>
                <td className="px-4 py-3 text-right text-sm">
                  <Link
                    href={`/tasks/${task.id}`}
                    className="font-medium text-gray-900 hover:text-gray-600"
                  >
                    查看
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
