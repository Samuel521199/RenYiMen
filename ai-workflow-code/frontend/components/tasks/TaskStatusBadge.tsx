import { TASK_STATUS_COLORS, TASK_STATUS_LABELS } from "@/lib/constants";
import type { TaskStatus } from "@/lib/types";

interface TaskStatusBadgeProps {
  status: TaskStatus | string;
}

export default function TaskStatusBadge({ status }: TaskStatusBadgeProps) {
  const label = TASK_STATUS_LABELS[status] || status;
  const color = TASK_STATUS_COLORS[status] || "bg-gray-100 text-gray-600";

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}
