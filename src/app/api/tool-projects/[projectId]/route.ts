import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ projectId: string }> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function findOwnedProject(projectId: string, userId: string) {
  return prisma.toolProject.findFirst({ where: { id: projectId, userId } });
}

export async function GET(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
  const { projectId } = await context.params;
  const project = await findOwnedProject(projectId, session.user.id);
  if (!project) return NextResponse.json({ ok: false, error: "项目不存在" }, { status: 404 });
  return NextResponse.json({ ok: true, project });
}

export async function PATCH(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
  const { projectId } = await context.params;
  const existing = await findOwnedProject(projectId, session.user.id);
  if (!existing) return NextResponse.json({ ok: false, error: "项目不存在" }, { status: 404 });

  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body)) return NextResponse.json({ ok: false, error: "请求体不是合法 JSON" }, { status: 400 });

  const data: Prisma.ToolProjectUpdateInput = {};
  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 80) return NextResponse.json({ ok: false, error: "项目名称无效" }, { status: 400 });
    data.name = name;
  }
  if ("formState" in body) {
    if (!isRecord(body.formState)) return NextResponse.json({ ok: false, error: "项目表单无效" }, { status: 400 });
    data.formState = body.formState as Prisma.InputJsonValue;
  }
  if ("outputState" in body) {
    if (!isRecord(body.outputState)) return NextResponse.json({ ok: false, error: "项目输出无效" }, { status: 400 });
    data.outputState = body.outputState as Prisma.InputJsonValue;
  }
  if ("activeTaskId" in body) {
    if (body.activeTaskId !== null && typeof body.activeTaskId !== "string") {
      return NextResponse.json({ ok: false, error: "任务标识无效" }, { status: 400 });
    }
    data.activeTaskId = typeof body.activeTaskId === "string" ? body.activeTaskId.trim() || null : null;
  }
  if ("providerCode" in body) {
    if (typeof body.providerCode !== "string") return NextResponse.json({ ok: false, error: "服务商标识无效" }, { status: 400 });
    data.providerCode = body.providerCode.trim().slice(0, 100);
  }

  const project = await prisma.toolProject.update({ where: { id: existing.id }, data });
  return NextResponse.json({ ok: true, project });
}

export async function DELETE(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
  const { projectId } = await context.params;
  const existing = await findOwnedProject(projectId, session.user.id);
  if (!existing) return NextResponse.json({ ok: false, error: "项目不存在" }, { status: 404 });
  await prisma.toolProject.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
}
