import { PointsTransactionType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface AdminKpiSnapshot {
  /** 今日 API 调用总次数 */
  todayApiCalls: number;
  /** 今日总营收（积分口径，与网关售价一致） */
  todayRevenueCredits: number;
  /** 今日预估利润（积分） */
  todayEstimatedProfitCredits: number;
  /** 活跃用户数（当日至少一次请求的去重用户） */
  activeUsers: number;
}

export interface ApiCallTrendPoint {
  /** ISO 日期 yyyy-mm-dd */
  date: string;
  /** 图表横轴展示文案 */
  label: string;
  calls: number;
}

export interface AdminApiLogRow {
  id: string;
  endpoint: string;
  responseStatus: number | null;
  /** 请求耗时（毫秒） */
  durationMs: number;
  /** 利润（积分），可为小数 */
  profitCredits: number | null;
  createdAt: string;
}

/** 本地日历日的 0 点（与 `new Date()` 所在时区一致，一般为服务器 TZ）。 */
function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function addLocalDays(d: Date, delta: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + delta);
  return x;
}

/**
 * 顶部 KPI：当日工作流提单量 + ApiLog、当日 CONSUME 流水营收、ApiLog 毛利汇总、活跃用户去重。
 */
export async function getAdminKpiSnapshot(): Promise<AdminKpiSnapshot> {
  const dayStart = startOfLocalDay(new Date());
  const dayEnd = addLocalDays(dayStart, 1);

  const [
    generationSubmitCount,
    apiLogCount,
    consumeAgg,
    apiProfitAgg,
    ghDistinctUsers,
    txDistinctUsers,
  ] = await Promise.all([
    prisma.generationHistory.count({
      where: { createdAt: { gte: dayStart, lt: dayEnd } },
    }),
    prisma.apiLog.count({
      where: { createdAt: { gte: dayStart, lt: dayEnd } },
    }),
    prisma.transaction.aggregate({
      where: {
        type: PointsTransactionType.CONSUME,
        createdAt: { gte: dayStart, lt: dayEnd },
      },
      _sum: { amount: true },
    }),
    prisma.apiLog.aggregate({
      where: { createdAt: { gte: dayStart, lt: dayEnd } },
      _sum: { profit: true },
    }),
    prisma.generationHistory.findMany({
      where: { createdAt: { gte: dayStart, lt: dayEnd } },
      distinct: ["userId"],
      select: { userId: true },
    }),
    prisma.transaction.findMany({
      where: { createdAt: { gte: dayStart, lt: dayEnd } },
      distinct: ["userId"],
      select: { userId: true },
    }),
  ]);

  const consumeSum = consumeAgg._sum.amount;
  const todayRevenueCredits =
    consumeSum != null && typeof consumeSum === "number" ? Math.abs(consumeSum) : 0;

  const profitDec = apiProfitAgg._sum.profit;
  const todayEstimatedProfitCredits =
    profitDec != null ? Math.round(Number(profitDec) * 100) / 100 : 0;

  const active = new Set<string>();
  for (const r of ghDistinctUsers) active.add(r.userId);
  for (const r of txDistinctUsers) active.add(r.userId);

  return {
    todayApiCalls: generationSubmitCount + apiLogCount,
    todayRevenueCredits,
    todayEstimatedProfitCredits,
    activeUsers: active.size,
  };
}

/**
 * 近 N 天：按自然日统计「工作流提单」次数（`GenerationHistory.createdAt`）。
 */
export async function getAdminApiCallTrend(days = 7): Promise<ApiCallTrendPoint[]> {
  const now = new Date();
  const todayStart = startOfLocalDay(now);
  const oldestStart = addLocalDays(todayStart, -(days - 1));

  const dayStarts: Date[] = [];
  for (let i = 0; i < days; i++) {
    dayStarts.push(addLocalDays(oldestStart, i));
  }

  const counts = await Promise.all(
    dayStarts.map((start) => {
      const end = addLocalDays(start, 1);
      return prisma.generationHistory.count({
        where: { createdAt: { gte: start, lt: end } },
      });
    })
  );

  return dayStarts.map((d, i) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const date = `${yyyy}-${mm}-${dd}`;
    const w = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
    return {
      date,
      label: `${mm}/${dd} 周${w}`,
      calls: counts[i] ?? 0,
    };
  });
}

/**
 * 最近 `ApiLog` 记录（网关或其它写入 `api_logs` 的调用）。
 */
export async function getAdminRecentApiLogs(limit = 10): Promise<AdminApiLogRow[]> {
  const rows = await prisma.apiLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      endpoint: true,
      responseStatus: true,
      durationMs: true,
      profit: true,
      createdAt: true,
    },
  });

  return rows.map((r) => ({
    id: r.id,
    endpoint: r.endpoint,
    responseStatus: r.responseStatus,
    durationMs: r.durationMs ?? 0,
    profitCredits: r.profit != null ? Number(r.profit) : null,
    createdAt: r.createdAt.toISOString(),
  }));
}
