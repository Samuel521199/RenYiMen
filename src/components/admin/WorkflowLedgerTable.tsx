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
    case GenerationHistoryStatus.PENDING:
      return "进行中";
    case GenerationHistoryStatus.SUCCESS:
      return "成功";
    case GenerationHistoryStatus.FAILED:
      return "失败";
    default:
      return s;
  }
}

function statusVariant(
  s: GenerationHistoryStatus
): "default" | "secondary" | "destructive" | "outline" {
  if (s === GenerationHistoryStatus.SUCCESS) return "secondary";
  if (s === GenerationHistoryStatus.FAILED) return "destructive";
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

export function WorkflowLedgerTable({ rows }: { rows: WorkflowLedgerRow[] }) {
  return (
    <div className="rounded-lg border border-border/60">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[160px] text-xs">时间</TableHead>
            <TableHead className="min-w-[140px] text-xs">用户</TableHead>
            <TableHead className="text-xs">工作流 SKU</TableHead>
            <TableHead className="w-[100px] text-right text-xs">单次耗时</TableHead>
            <TableHead className="w-[100px] text-right text-xs">积分</TableHead>
            <TableHead className="w-[88px] text-center text-xs">状态</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                暂无流水记录
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow key={r.id} className="text-xs">
                <TableCell className="whitespace-nowrap font-mono text-muted-foreground">
                  {r.updatedAt.toLocaleString("zh-CN", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </TableCell>
                <TableCell className="max-w-[200px] truncate text-foreground/90" title={formatUser(r)}>
                  {formatUser(r)}
                </TableCell>
                <TableCell className="max-w-[220px] truncate font-mono text-[11px]">{r.skuId}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {r.durationInt > 0 ? `${r.durationInt} s` : "—"}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-emerald-400/90">{r.cost}</TableCell>
                <TableCell className="text-center">
                  <Badge variant={statusVariant(r.status)} className="text-[10px]">
                    {statusLabel(r.status)}
                  </Badge>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
