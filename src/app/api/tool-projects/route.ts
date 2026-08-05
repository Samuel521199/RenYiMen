import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_NAME_LENGTH = 80;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readRequiredString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
  }

  const skuId = new URL(req.url).searchParams.get("skuId")?.trim();
  if (!skuId) {
    return NextResponse.json({ ok: false, error: "缺少 skuId" }, { status: 400 });
  }

  const projects = await prisma.toolProject.findMany({
    where: { userId: session.user.id, skuId },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({ ok: true, projects });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
  }

  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body)) {
    return NextResponse.json({ ok: false, error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const skuId = readRequiredString(body.skuId, 100);
  const name = readRequiredString(body.name, MAX_NAME_LENGTH);
  if (!skuId || !name) {
    return NextResponse.json({ ok: false, error: "项目名称或工具标识无效" }, { status: 400 });
  }

  const formState = isRecord(body.formState) ? body.formState : {};
  const providerCode = typeof body.providerCode === "string" ? body.providerCode.trim().slice(0, 100) : "";
  const project = await prisma.toolProject.create({
    data: {
      userId: session.user.id,
      skuId,
      name,
      formState: formState as Prisma.InputJsonValue,
      outputState: {},
      providerCode,
    },
  });
  return NextResponse.json({ ok: true, project }, { status: 201 });
}
