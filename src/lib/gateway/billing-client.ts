import { Prisma } from "@prisma/client";
import { BillingBalanceError, deductUserBalance } from "@/lib/billing";
import { prisma as basePrisma } from "@/lib/prisma";
import {
  GATEWAY_GENERATE_COST_CREDITS,
  GATEWAY_GENERATE_PROFIT_CREDITS,
  GATEWAY_GENERATE_SELL_CREDITS,
} from "@/lib/gateway/pricing";

const ENDPOINT = "/api/gateway/generate";

export class GatewayHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = "GatewayHttpError";
  }
}

function mapBillingError(e: BillingBalanceError): GatewayHttpError {
  if (e.code === "USER_NOT_FOUND") {
    return new GatewayHttpError(404, e.message, "USER_NOT_FOUND");
  }
  if (e.code === "INSUFFICIENT_BALANCE") {
    return new GatewayHttpError(402, e.message, "INSUFFICIENT_BALANCE");
  }
  return new GatewayHttpError(400, e.message, "INVALID_AMOUNT");
}

/**
 * 使用 Prisma Client `$extends` 封装网关预扣费与结算，保证关键路径在 `$transaction` 中原子执行。
 */
export const prismaGateway = basePrisma.$extends({
  name: "gatewayBilling",
  client: {
    /**
     * 预扣：校验余额 → 扣减 `User.balance` → 写入 CONSUME 流水。
     */
    async gatewayPrecharge(userId: string, sellCredits: number) {
      try {
        return await deductUserBalance(
          userId,
          sellCredits,
          "CONSUME",
          `网关生成预扣（${sellCredits} 积分）`
        );
      } catch (e) {
        if (e instanceof BillingBalanceError) {
          throw mapBillingError(e);
        }
        throw e;
      }
    },

    /**
     * 成功结算：写入 ApiLog（流水在预扣时已落库，此处不再改流水状态）。
     */
    async gatewaySettleCompleted(
      _transactionId: string,
      userId: string,
      ctx: {
        requestPayload?: Prisma.InputJsonValue;
        responseStatus: number;
      }
    ) {
      const cost = new Prisma.Decimal(GATEWAY_GENERATE_COST_CREDITS);
      const sell = new Prisma.Decimal(GATEWAY_GENERATE_SELL_CREDITS);
      const profit = new Prisma.Decimal(GATEWAY_GENERATE_PROFIT_CREDITS);

      return basePrisma.$transaction(async (tx) => {
        await tx.apiLog.create({
          data: {
            userId,
            endpoint: ENDPOINT,
            requestPayload: ctx.requestPayload,
            responseStatus: ctx.responseStatus,
            costPrice: cost,
            sellPrice: sell,
            profit: profit,
          },
        });
      });
    },

    /**
     * 失败结算：退还预扣积分并写入 RECHARGE 流水。
     */
    async gatewaySettleFailed(_transactionId: string, userId: string, refundCredits: number) {
      try {
        await deductUserBalance(
          userId,
          refundCredits,
          "RECHARGE",
          `网关生成失败退款（${refundCredits} 积分）`
        );
        return { refunded: true as const };
      } catch (e) {
        if (e instanceof BillingBalanceError) {
          console.error("[gatewayBilling] gatewaySettleFailed 退款失败", e.code, e.message);
          return { refunded: false as const };
        }
        throw e;
      }
    },
  },
});
