"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ApiCallTrendPoint } from "@/services/adminService";

export interface AdminApiTrendChartProps {
  data: ApiCallTrendPoint[];
}

export function AdminApiTrendChart({ data }: AdminApiTrendChartProps) {
  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
          <XAxis
            dataKey="label"
            tick={{ fill: "oklch(0.708 0 0)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            dy={6}
          />
          <YAxis
            tick={{ fill: "oklch(0.708 0 0)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <Tooltip
            contentStyle={{
              background: "oklch(0.205 0 0)",
              border: "1px solid oklch(0.35 0 0)",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            labelStyle={{ color: "oklch(0.92 0 0)" }}
            itemStyle={{ color: "oklch(0.92 0 0)" }}
            formatter={(value) => [`${value ?? ""} 次`, "调用量"]}
          />
          <Line
            type="monotone"
            dataKey="calls"
            stroke="oklch(0.72 0.17 264)"
            strokeWidth={2.5}
            dot={{ r: 3, fill: "oklch(0.72 0.17 264)", strokeWidth: 0 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
