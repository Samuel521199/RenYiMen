import { NextRequest, NextResponse } from "next/server";
import { expireAllStalePending } from "@/lib/stale-pending-cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/cleanup
 *
 * 定时清理全平台幽灵 PENDING 生成记录。
 *
 * 鉴权：通过 `Authorization: Bearer <CRON_SECRET>` 头，
 * 或 `?secret=<CRON_SECRET>` 查询参数。
 *
 * 未配置 CRON_SECRET 时仅允许本机回环地址（127.0.0.1 / ::1）调用。
 *
 * 推荐调用频率：每 10-15 分钟一次。
 * 可用 cron-job.org / UptimeRobot / 服务器 crontab 定时触发。
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (cronSecret) {
    const authHeader = req.headers.get("authorization") ?? "";
    const querySecret = req.nextUrl.searchParams.get("secret") ?? "";
    const provided = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : querySecret;

    if (provided !== cronSecret) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  } else {
    // CRON_SECRET 未配置时，仅允许本机调用
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "";
    if (ip && ip !== "127.0.0.1" && ip !== "::1" && ip !== "::ffff:127.0.0.1") {
      return NextResponse.json(
        { ok: false, error: "CRON_SECRET not configured — external calls are blocked" },
        { status: 403 }
      );
    }
  }

  const cleaned = await expireAllStalePending();

  console.info("[cron/cleanup] 定时清理完成", { cleaned, ts: new Date().toISOString() });

  return NextResponse.json({ ok: true, cleaned, ts: new Date().toISOString() });
}
