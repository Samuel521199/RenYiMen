// @ts-nocheck
"use client";

import Link from "next/link";
import PageHeader from "@workbench/components/common/PageHeader";

export default function UsageStatsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="AI 模型调用统计" description="调用统计已整合至首页看板，请前往查看" />
      <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-white/10 bg-white/5 py-16 text-center">
        <p className="text-slate-400 text-sm">
          调用统计（按时间 / 按模型 / 按用户）已合并到首页看板。
        </p>
        <Link
          href="/workbench/dashboard"
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
        >
          前往首页看板
        </Link>
      </div>
    </div>
  );
}
