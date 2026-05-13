import { NextResponse } from "next/server";
import { getAdminAccess } from "@/lib/admin-access";
import { fetchAdminWorkflowDashboard } from "@/services/adminWorkflowDashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET `/api/admin/stats/workflows` — 按 SKU 聚合成功任务 + 最近全平台流水（ADMIN）。
 */
export async function GET() {
  const access = await getAdminAccess();
  if (!access.ok) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { aggregates, ledger } = await fetchAdminWorkflowDashboard();

  return NextResponse.json({
    aggregates,
    /** @deprecated 使用 ledger */
    recent: ledger.filter((r) => r.status === "SUCCESS").slice(0, 100),
    ledger,
  });
}
