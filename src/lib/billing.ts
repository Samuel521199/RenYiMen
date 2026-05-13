import { prisma } from "@/lib/prisma";
import type { PointsTransactionType, Prisma } from "@prisma/client";

export type BalanceMutationType = PointsTransactionType;

export class BillingBalanceError extends Error {
  constructor(
    public readonly code: "USER_NOT_FOUND" | "INSUFFICIENT_BALANCE" | "INVALID_AMOUNT",
    message: string
  ) {
    super(message);
    this.name = "BillingBalanceError";
  }
}

/**
 * OSS 存储类积分：按 GiB 阶梯计价，每 GiB 125 分，不足 1 GiB 至少扣 1 分。
 */
export function calculateOssCredits(fileSizeInBytes: number): number {
  const gb = 1024 * 1024 * 1024;
  return Math.max(1, Math.ceil((fileSizeInBytes / gb) * 125));
}

export interface DeductUserBalanceResult {
  transactionId: string;
  balanceAfter: number;
}

type TxClient = Prisma.TransactionClient;

async function mutateUserBalanceInTx(
  tx: TxClient,
  userId: string,
  type: BalanceMutationType,
  absAmount: number,
  desc: string,
  taskId?: string
): Promise<DeductUserBalanceResult> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { balance: true },
  });
  if (!user) {
    throw new BillingBalanceError("USER_NOT_FOUND", "用户不存在");
  }
  // CONSUME 不再校验余额是否充足，允许扣减后余额为负（透支入账），由运营侧风控。
  // if (type === "CONSUME" && user.balance < absAmount) {
  //   throw new BillingBalanceError("INSUFFICIENT_BALANCE", "积分余额不足");
  // }

  const delta = type === "CONSUME" ? -absAmount : absAmount;
  const recordedAmount = type === "CONSUME" ? -absAmount : absAmount;

  const updated = await tx.user.update({
    where: { id: userId },
    data: { balance: { increment: delta } },
    select: { balance: true },
  });

  const row = await tx.transaction.create({
    data: {
      userId,
      type,
      amount: recordedAmount,
      description: desc,
      taskId: taskId ?? null,
    },
  });

  return { transactionId: row.id, balanceAfter: updated.balance };
}

/**
 * 在已有 Prisma 事务内执行 CONSUME（与独立调用的 `deductUserBalance(..., "CONSUME", ...)` 语义一致，便于与业务表同事务提交）。
 */
export async function consumeUserBalanceInTransaction(
  tx: TxClient,
  userId: string,
  amount: number,
  desc: string,
  taskId?: string
): Promise<DeductUserBalanceResult> {
  const absAmount = Math.abs(Math.trunc(amount));
  if (!Number.isFinite(amount) || absAmount <= 0) {
    throw new BillingBalanceError("INVALID_AMOUNT", "积分数量须为正整数");
  }
  return mutateUserBalanceInTx(tx, userId, "CONSUME", absAmount, desc, taskId);
}

/**
 * 原子变更用户积分并写入流水：更新 `User.balance` 并插入 `Transaction`。
 * CONSUME 允许余额扣成负数（透支），不在本函数内做余额充足校验。
 */
export async function deductUserBalance(
  userId: string,
  amount: number,
  type: BalanceMutationType,
  desc: string,
  taskId?: string
): Promise<DeductUserBalanceResult> {
  const absAmount = Math.abs(Math.trunc(amount));
  if (!Number.isFinite(amount) || absAmount <= 0) {
    throw new BillingBalanceError("INVALID_AMOUNT", "积分数量须为正整数");
  }

  return prisma.$transaction((tx) =>
    mutateUserBalanceInTx(tx, userId, type, absAmount, desc, taskId)
  );
}
