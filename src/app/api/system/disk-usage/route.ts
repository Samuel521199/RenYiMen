import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  readLocalDiskUsage,
  readWorkbenchBackendDiskUsage,
  resolveDiskUsagePath,
} from "@/lib/disk-usage-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORKBENCH_BACKEND_URL =
  process.env.WORKBENCH_BACKEND_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

/** GET `/api/system/disk-usage` — 素材存储所在磁盘容量（需登录） */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const fromBackend = await readWorkbenchBackendDiskUsage(WORKBENCH_BACKEND_URL);
    if (fromBackend) {
      return NextResponse.json(fromBackend);
    }

    const local = await readLocalDiskUsage(resolveDiskUsagePath());
    return NextResponse.json(local);
  } catch (error) {
    const message = error instanceof Error ? error.message : "disk usage unavailable";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
