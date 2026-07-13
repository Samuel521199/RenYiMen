import { GenerationHistoryStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { expireAllStalePending } from "@/lib/stale-pending-cleanup";

export type WorkflowSkuAggregate = {  skuId: string;
  callCount: number;
  totalCost: number;
  avgDurationSec: number | null;
};

export type WorkflowLedgerRow = {
  id: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  skuId: string;
  taskId: string;
  durationInt: number;
  cost: number;
  status: GenerationHistoryStatus;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * 管理端「工作流经营看板」：按 SKU 聚合（成功任务）+ 全平台最近流水。
 * `cost` 在任务成功后为实扣积分，聚合 `_sum.cost` 即累计实扣。
 */
export async function fetchAdminWorkflowDashboard(): Promise<{
  aggregates: WorkflowSkuAggregate[];
  ledger: WorkflowLedgerRow[];
}> {
  await expireAllStalePending();

  const [bySku, rows] = await Promise.all([
    prisma.generationHistory.groupBy({
      by: ["skuId"],
      where: { status: GenerationHistoryStatus.SUCCESS },
      _count: { id: true },
      _sum: { cost: true },
      _avg: { durationInt: true },
    }),
    prisma.generationHistory.findMany({
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: {
        id: true,
        userId: true,
        taskId: true,
        skuId: true,
        durationInt: true,
        cost: true,
        status: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { email: true, name: true } },
      },
    }),
  ]);

  const aggregates: WorkflowSkuAggregate[] = bySku.map((row) => ({
    skuId: row.skuId,
    callCount: row._count.id,
    totalCost: row._sum.cost ?? 0,
    avgDurationSec: row._avg.durationInt,
  }));

  aggregates.sort((a, b) => b.callCount - a.callCount);

  const ledger: WorkflowLedgerRow[] = rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    userEmail: r.user.email,
    userName: r.user.name,
    skuId: r.skuId,
    taskId: r.taskId,
    durationInt: r.durationInt,
    cost: r.cost,
    status: r.status,
    errorMessage: r.errorMessage ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));

  return { aggregates, ledger };
}
