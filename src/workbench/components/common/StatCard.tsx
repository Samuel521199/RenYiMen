import type { ReactNode } from "react";

import { WB_CARD_CLASS } from "@workbench/lib/workbench-ui-theme";

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
      ? "text-emerald-400"
      : trend && trend < 0
        ? "text-red-400"
        : "text-slate-500";

  return (
    <div className={WB_CARD_CLASS}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-400">{label}</p>
        {hasTrend && (
          <span className={`text-xs font-medium ${trendClass}`}>
            {trend > 0 ? "+" : ""}
            {trend}%
          </span>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-white">{value}</span>
        {unit && <span className="text-sm text-slate-400">{unit}</span>}
      </div>
    </div>
  );
}
