import { GenerationHistoryStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * 各 provider 的幽灵 PENDING 超时阈值。
 *
 * 策略：任务实际执行通常在 10 分钟内完成；45 分钟足以覆盖极端长队列，
 * 同时避免幽灵记录长期占据并发限额（原 72 小时过于宽松）。
 */
export const STALE_THRESHOLDS_MS = {
  /** 百炼（阿里云 DashScope）：保留 30 分钟 */
  ALIYUN_BAILIAN: 30 * 60 * 1000,
  /** 其他 provider（RunningHub、Kling 等）：保留 45 分钟 */
  DEFAULT: 45 * 60 * 1000,
} as const;

/**
 * 将全平台超时的 PENDING 记录标记为 FAILED。
 * 适合管理后台看板 / cron 调用。
 * @returns 清理的记录数
 */
export async function expireAllStalePending(): Promise<number> {
  const now = Date.now();
  const bailianCutoff = new Date(now - STALE_THRESHOLDS_MS.ALIYUN_BAILIAN);
  const otherCutoff = new Date(now - STALE_THRESHOLDS_MS.DEFAULT);

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
    console.info("[stale-pending-cleanup] 清理全平台过期 PENDING", { count: res.count });
  }

  return res.count;
}

/**
 * 仅清理指定用户的超时 PENDING 记录，在提交新任务前调用，
 * 防止幽灵记录触发 CONCURRENT_LIMIT_EXCEEDED。
 * @returns 清理的记录数
 */
export async function expireStaleUserPending(userId: string): Promise<number> {
  const now = Date.now();
  const bailianCutoff = new Date(now - STALE_THRESHOLDS_MS.ALIYUN_BAILIAN);
  const otherCutoff = new Date(now - STALE_THRESHOLDS_MS.DEFAULT);

  const res = await prisma.generationHistory.updateMany({
    where: {
      userId,
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
    console.info("[stale-pending-cleanup] 清理用户过期 PENDING", { userId, count: res.count });
  }

  return res.count;
}
