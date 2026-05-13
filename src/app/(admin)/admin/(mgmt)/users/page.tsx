import Link from "next/link";
import { PointsTransactionType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AdminUsersTable, type AdminUserRow } from "@/components/admin/AdminUsersTable";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const rows = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      balance: true,
    },
  });

  const consumeAgg = await prisma.transaction.groupBy({
    by: ["userId"],
    where: { type: PointsTransactionType.CONSUME },
    _sum: { amount: true },
  });
  const consumedByUserId = new Map(
    consumeAgg.map((g) => [g.userId, Math.abs(g._sum.amount ?? 0)])
  );

  const initialUsers: AdminUserRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    balance: r.balance,
    totalConsumed: consumedByUserId.get(r.id) ?? 0,
  }));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">用户与积分</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            查看所有用户的当前积分余额、历史消耗汇总，并可发起后台充值。
          </p>
        </div>
        <Link
          href="/admin"
          className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← 返回仪表盘
        </Link>
      </div>

      <AdminUsersTable initialUsers={initialUsers} />
    </div>
  );
}
