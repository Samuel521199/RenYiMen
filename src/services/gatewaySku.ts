import { Prisma } from "@prisma/client";

/** 售价 / 成本 / 利润（积分），与网关 SKU 对齐（0 利润） */
export const GATEWAY_SKU_COST_CREDITS = new Prisma.Decimal(8);
export const GATEWAY_SKU_SELL_CREDITS = GATEWAY_SKU_COST_CREDITS;
export const GATEWAY_SKU_PROFIT_CREDITS = new Prisma.Decimal(0);
/** 预扣与余额门槛（积分） */
export const GATEWAY_SKU_PRECHARGE_CREDITS = GATEWAY_SKU_SELL_CREDITS;
