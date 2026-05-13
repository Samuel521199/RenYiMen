import Link from "next/link";
import { WorkflowLedgerTable } from "@/components/admin/WorkflowLedgerTable";
import { WorkflowStatsCard } from "@/components/admin/WorkflowStatsCard";
import { fetchAdminWorkflowDashboard } from "@/services/adminWorkflowDashboard";

export const dynamic = "force-dynamic";

export default async function AdminWorkflowStatsPage() {
  const { aggregates, ledger } = await fetchAdminWorkflowDashboard();

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">工作流经营看板</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            按 SKU 汇总<strong className="font-medium text-foreground">成功任务</strong>的调用量、
            <strong className="font-medium text-foreground">实扣积分</strong>与平均耗时；下方为最近{" "}
            <span className="font-mono text-xs">200</span> 条全平台生成流水（含进行中 / 失败）。
          </p>
        </div>
        <Link
          href="/admin"
          className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← 返回仪表盘
        </Link>
      </div>

      <section className="space-y-4">
        <h2 className="text-base font-semibold tracking-tight">工作流聚合</h2>
        {aggregates.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/80 px-4 py-10 text-center text-sm text-muted-foreground">
            暂无成功任务数据。完成首单后此处将展示各 SKU 的经营指标。
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {aggregates.map((row) => (
              <WorkflowStatsCard key={row.skuId} row={row} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">全平台生成流水</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            时间取任务 <span className="font-mono">updatedAt</span>；成功行的{" "}
            <span className="font-mono">cost</span> 为实扣积分（与前台/余额一致）；耗时为终态写入的{" "}
            <span className="font-mono">durationInt</span>（秒）：百炼为提单→完成墙钟时长；RunningHub
            优先为上游执行耗时。
          </p>
        </div>
        <WorkflowLedgerTable rows={ledger} />
      </section>
    </div>
  );
}
