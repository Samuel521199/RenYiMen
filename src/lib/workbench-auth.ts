import { auth } from "@/auth";

const WORKBENCH_BACKEND_URL =
  process.env.WORKBENCH_BACKEND_URL?.replace(/\/$/, "") ?? "http://localhost:8000";
const WORKBENCH_SSO_SECRET = process.env.WORKBENCH_SSO_SECRET ?? "";

function mapPlatformRole(role: string | undefined): string {
  if (role === "ADMIN") return "admin";
  return "operator";
}

/** Server-side fetch helper for workbench APIs (uses SSO bridge token). */
export async function getWorkbenchAuthHeaders(): Promise<HeadersInit | null> {
  const session = await auth();
  if (!session?.user?.email || !WORKBENCH_SSO_SECRET) return null;

  const username =
    session.user.email.split("@")[0]?.replace(/[^a-zA-Z0-9_.-]/g, "_") ||
    `user_${session.user.id?.slice(0, 8) ?? "unknown"}`;

  const res = await fetch(`${WORKBENCH_BACKEND_URL}/api/auth/sso-bridge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: WORKBENCH_SSO_SECRET,
      platform_user_id: session.user.id ?? null,
      email: session.user.email,
      username,
      name: session.user.name ?? username,
      role: mapPlatformRole(session.user.role),
    }),
    cache: "no-store",
  });

  if (!res.ok) return null;
  const data = (await res.json()) as { data?: { token?: string }; token?: string };
  const token = data.data?.token ?? data.token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}` };
}

export { WORKBENCH_BACKEND_URL, WORKBENCH_SSO_SECRET };
