import { GenerationHistoryStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 48;
const MAX_LIMIT = 100;

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const searchParams = new URL(request.url).searchParams;
  const requestedLimit = Number(searchParams.get("limit"));
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(requestedLimit)))
    : DEFAULT_LIMIT;
  const cursor = searchParams.get("cursor")?.trim() || undefined;

  const rows = await prisma.generationHistory.findMany({
    where: {
      userId: session.user.id,
      status: GenerationHistoryStatus.SUCCESS,
      resultUrl: { not: null },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const items = pageRows.filter((row) => Boolean(row.resultUrl?.trim()));

  return NextResponse.json({
    items,
    nextCursor: hasMore ? pageRows.at(-1)?.id ?? null : null,
  });
}
