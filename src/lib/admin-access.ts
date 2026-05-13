import { cookies } from "next/headers";
import { Role } from "@prisma/client";
import { auth } from "@/auth";
import { ADMIN_PANEL_COOKIE, verifyAdminPanelToken } from "@/lib/admin-panel-session";

export type AdminAccess =
  | { ok: true; via: "nextauth"; userId: string; label: string }
  | { ok: true; via: "panel"; label: string }
  | { ok: false };

/**
 * 管理端访问：NextAuth 且 `role === ADMIN`，或独立管理端 Cookie（`/api/admin/panel/login`）。
 */
export async function getAdminAccess(): Promise<AdminAccess> {
  const session = await auth();
  if (session?.user?.id && session.user.role === Role.ADMIN) {
    const label = session.user.email ?? session.user.name ?? session.user.id;
    return { ok: true, via: "nextauth", userId: session.user.id, label };
  }
  const jar = await cookies();
  const raw = jar.get(ADMIN_PANEL_COOKIE)?.value;
  const payload = verifyAdminPanelToken(raw);
  if (payload) {
    return { ok: true, via: "panel", label: payload.sub };
  }
  return { ok: false };
}
