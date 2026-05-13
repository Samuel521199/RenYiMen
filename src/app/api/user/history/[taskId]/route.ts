import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TASK_ID_MAX_LEN = 128;

function isValidTaskId(id: string): boolean {
  if (!id || id.length > TASK_ID_MAX_LEN) return false;
  return /^[\w-]+$/.test(id);
}

/**
 * DELETE `/api/user/history/:taskId` — 删除当前用户名下的一条生成历史（防越权）。
 */
export async function DELETE(
  _req: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const resolved = await context.params;
  const taskId = decodeURIComponent(resolved.taskId ?? "").trim();
  if (!isValidTaskId(taskId)) {
    return NextResponse.json({ error: "非法 taskId" }, { status: 400 });
  }

  const row = await prisma.generationHistory.findUnique({
    where: { taskId },
    select: { userId: true },
  });

  if (!row) {
    return NextResponse.json({ error: "记录不存在" }, { status: 404 });
  }

  if (row.userId !== session.user.id) {
    return NextResponse.json({ error: "无权删除该记录" }, { status: 403 });
  }

  await prisma.generationHistory.delete({ where: { taskId } });

  return NextResponse.json({ success: true });
}
