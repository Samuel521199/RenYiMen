import { PrismaClient } from "@prisma/client";

/**
 * Next.js 开发热重载会多次实例化模块；将 PrismaClient 挂在 `globalThis` 上复用，
 * 避免连接池被耗尽。生产环境每个 Node 进程仍只建一个实例。
 *
 * @see https://www.prisma.io/docs/guides/database/troubleshooting-orm/help-articles/nextjs-prisma-client-dev-practices
 */
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
