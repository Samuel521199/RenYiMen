import { cn } from "@/lib/utils";
import type { WorkflowSkuAggregate } from "@/services/adminWorkflowDashboard";

const SLOW_AVG_SEC = 300;

function formatInt(n: number): string {
  return n.toLocaleString("zh-CN");
}

function formatAvgSec(avg: number | null): string {
  if (avg == null || Number.isNaN(avg)) return "—";
  return `${avg.toLocaleString("zh-CN", { maximumFractionDigits: 1 })} s`;
}

export function WorkflowStatsCard({ row }: { row: WorkflowSkuAggregate }) {
  const slow = row.avgDurationSec != null && row.avgDurationSec > SLOW_AVG_SEC;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border bg-card/95 p-4 shadow-sm ring-1 transition-colors",
        slow
          ? "border-amber-500/70 ring-amber-500/35 bg-gradient-to-br from-amber-950/40 to-card"
          : "border-border/80 ring-border/50"
      )}
    >
      {slow && (
        <span className="absolute right-3 top-3 rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950">
          效率预警
        </span>
      )}
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">工作流 SKU</p>
      <p className="mt-1 truncate font-mono text-sm font-semibold text-foreground" title={row.skuId}>
        {row.skuId}
      </p>
      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">累计调用</dt>
          <dd className="font-mono text-lg font-semibold tabular-nums">{formatInt(row.callCount)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">累计实扣积分</dt>
          <dd className="font-mono text-lg font-semibold tabular-nums text-emerald-400/95">{formatInt(row.totalCost)}</dd>
        </div>
        <div>
          <dt className={cn("text-xs", slow ? "text-amber-200/90" : "text-muted-foreground")}>平均执行耗时</dt>
          <dd
            className={cn(
              "font-mono text-lg font-semibold tabular-nums",
              slow ? "text-amber-400" : "text-foreground"
            )}
          >
            {formatAvgSec(row.avgDurationSec)}
          </dd>
        </div>
      </dl>
      {slow && (
        <p className="mt-3 text-[11px] leading-snug text-amber-200/85">
          该 SKU 成功任务平均耗时超过 {SLOW_AVG_SEC} 秒，请关注队列或上游算力。
        </p>
      )}
    </div>
  );
}
