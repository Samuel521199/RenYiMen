import { NextRequest, NextResponse } from "next/server";
import { getAdminAccess } from "@/lib/admin-access";
import { getPlanningPerformanceBaseline } from "@/services/video-orchestrator/planning-performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function boundedInteger(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
}

export async function GET(request: NextRequest) {
  const access = await getAdminAccess();
  if (!access.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const days = boundedInteger(request.nextUrl.searchParams.get("days"), 7, 1, 90);
  const durationParam = request.nextUrl.searchParams.get("durationSeconds");
  const durationSeconds = durationParam
    ? boundedInteger(durationParam, 30, 3, 300)
    : undefined;
  const modelName = request.nextUrl.searchParams.get("model")?.trim().slice(0, 120) || undefined;

  const baseline = await getPlanningPerformanceBaseline({
    days,
    durationSeconds,
    modelName,
  });
  return NextResponse.json(baseline);
}
