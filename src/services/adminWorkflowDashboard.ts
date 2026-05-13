import { GenerationHistoryStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** 百炼任务若长时间仍 PENDING，视为已放弃轮询，避免看板长期「进行中」幽灵行 */
const STALE_BAILIAN_PENDING_MS = 30 * 60 * 1000;
/** 其他线路（如 RunningHub）允许更长排队 */
const STALE_OTHER_PENDING_MS = 72 * 60 * 60 * 1000;

/**
 * 将过久仍 PENDING 的生成记录标记为失败（未写终态实扣与成片；仅数据卫生，非业务退款）。
 */
async function expireStalePendingGenerationHistory(): Promise<void> {
  const now = Date.now();
  const bailianCutoff = new Date(now - STALE_BAILIAN_PENDING_MS);
  const otherCutoff = new Date(now - STALE_OTHER_PENDING_MS);
  const res = await prisma.generationHistory.updateMany({
    where: {
      status: GenerationHistoryStatus.PENDING,
      OR: [
        {
          AND: [{ providerCode: "ALIYUN_BAILIAN" }, { createdAt: { lt: bailianCutoff } }],
        },
        {
          AND: [{ providerCode: { not: "ALIYUN_BAILIAN" } }, { createdAt: { lt: otherCutoff } }],
        },
      ],
    },
    data: { status: GenerationHistoryStatus.FAILED },
  });
  if (res.count > 0) {
    console.info("[adminWorkflowDashboard] 已清理过期 PENDING 生成记录", { count: res.count });
  }
}

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
  await expireStalePendingGenerationHistory();

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
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));

  return { aggregates, ledger };
}
