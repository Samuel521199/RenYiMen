import { GenerationHistoryStatus } from "@prisma/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { WorkflowLedgerRow } from "@/services/adminWorkflowDashboard";

function statusLabel(s: GenerationHistoryStatus): string {
  switch (s) {
    case GenerationHistoryStatus.PENDING:  return "进行中";
    case GenerationHistoryStatus.SUCCESS:  return "成功";
    case GenerationHistoryStatus.FAILED:   return "失败";
    default: return s;
  }
}

function statusVariant(
  s: GenerationHistoryStatus
): "default" | "secondary" | "destructive" | "outline" {
  if (s === GenerationHistoryStatus.SUCCESS) return "secondary";
  if (s === GenerationHistoryStatus.FAILED)  return "destructive";
  return "outline";
}

function formatUser(row: WorkflowLedgerRow): string {
  const n = row.userName?.trim();
  const e = row.userEmail?.trim();
  if (n && e) return `${n} (${e})`;
  if (e) return e;
  if (n) return n;
  return row.userId.slice(0, 8) + "…";
}

/** 格式化为 UTC+8 时间 */
function formatCN(date: Date): string {
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function WorkflowLedgerTable({ rows }: { rows: WorkflowLedgerRow[] }) {
  return (
    <div className="rounded-lg border border-border/60">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[160px] text-xs">时间（UTC+8）</TableHead>
            <TableHead className="min-w-[140px] text-xs">用户</TableHead>
            <TableHead className="text-xs">工作流 SKU</TableHead>
            <TableHead className="w-[100px] text-right text-xs">单次耗时</TableHead>
            <TableHead className="w-[100px] text-right text-xs">积分</TableHead>
            <TableHead className="w-[88px] text-center text-xs">状态</TableHead>
            <TableHead className="text-xs text-red-400/70">失败原因</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                暂无流水记录
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow
                key={r.id}
                className={`text-xs ${r.status === GenerationHistoryStatus.FAILED ? "bg-red-950/10" : ""}`}
              >
                <TableCell className="whitespace-nowrap font-mono text-muted-foreground">
                  {formatCN(r.updatedAt)}
                </TableCell>
                <TableCell className="max-w-[200px] truncate text-foreground/90" title={formatUser(r)}>
                  {formatUser(r)}
                </TableCell>
                <TableCell className="max-w-[220px] truncate font-mono text-[11px]">{r.skuId}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {r.durationInt > 0 ? `${r.durationInt} s` : "—"}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-emerald-400/90">
                  {r.status === GenerationHistoryStatus.FAILED ? (
                    <span className="text-muted-foreground">—</span>
                  ) : r.cost}
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant={statusVariant(r.status)} className="text-[10px]">
                    {statusLabel(r.status)}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-[320px]">
                  {r.status === GenerationHistoryStatus.FAILED && r.errorMessage ? (
                    <span
                      className="line-clamp-2 text-red-400/80 text-[11px]"
                      title={r.errorMessage}
                    >
                      {r.errorMessage}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/30">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
