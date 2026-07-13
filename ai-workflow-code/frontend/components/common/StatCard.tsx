import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: ReactNode;
  unit?: string;
  trend?: number;
}

export default function StatCard({ label, value, unit, trend }: StatCardProps) {
  const hasTrend = typeof trend === "number";
  const trendClass =
    trend && trend > 0
      ? "text-emerald-600"
      : trend && trend < 0
        ? "text-red-600"
        : "text-gray-500";

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        {hasTrend && (
          <span className={`text-xs font-medium ${trendClass}`}>
            {trend > 0 ? "+" : ""}
            {trend}%
          </span>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-gray-900">{value}</span>
        {unit && <span className="text-sm text-gray-500">{unit}</span>}
      </div>
    </div>
  );
}
