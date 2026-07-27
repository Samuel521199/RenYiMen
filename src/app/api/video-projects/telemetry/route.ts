import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { logOnePromptVideo } from "@/services/video-orchestrator/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_KEYS = [
  "traceId",
  "projectId",
  "route",
  "method",
  "status",
  "ok",
  "durationMs",
  "responseWaitMs",
  "bodyReadMs",
  "jsonParseMs",
  "errorType",
] as const;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse(null, { status: 401 });
  }

  try {
    const raw = await req.json();
    if (!isRecord(raw) || raw.event !== "frontend.api.request.completed") {
      return new NextResponse(null, { status: 400 });
    }
    const data: Record<string, unknown> = { userId: session.user.id };
    for (const key of ALLOWED_KEYS) {
      const value = raw[key];
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        data[key] = typeof value === "string" ? value.slice(0, 300) : value;
      }
    }
    await logOnePromptVideo("frontend.api.request.completed", data);
    return new NextResponse(null, { status: 204 });
  } catch {
    return new NextResponse(null, { status: 400 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
