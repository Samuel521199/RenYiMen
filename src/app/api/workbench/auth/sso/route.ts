import { NextResponse } from "next/server";
import { auth } from "@/auth";

const WORKBENCH_BACKEND_URL =
  process.env.WORKBENCH_BACKEND_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

const WORKBENCH_SSO_SECRET = process.env.WORKBENCH_SSO_SECRET ?? "";

function mapPlatformRole(role: string | undefined): string {
  if (role === "ADMIN") return "admin";
  return "operator";
}

/**
 * Exchange NextAuth session for a Workbench JWT (SSO bridge).
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!WORKBENCH_SSO_SECRET) {
    return NextResponse.json(
      { error: "WORKBENCH_SSO_SECRET is not configured" },
      { status: 503 },
    );
  }

  const username =
    session.user.email.split("@")[0]?.replace(/[^a-zA-Z0-9_.-]/g, "_") ||
    `user_${session.user.id?.slice(0, 8) ?? "unknown"}`;

  try {
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
    });

    const data = (await res.json()) as {
      code?: number;
      data?: { token?: string; access_token?: string };
      token?: string;
      access_token?: string;
      error?: string;
      detail?: string;
    };

    if (!res.ok) {
      return NextResponse.json(
        { error: data.detail ?? data.error ?? "SSO bridge failed" },
        { status: res.status },
      );
    }

    const token =
      data.data?.token ??
      data.data?.access_token ??
      data.token ??
      data.access_token;

    if (!token) {
      return NextResponse.json({ error: "Missing token in SSO response" }, { status: 502 });
    }

    return NextResponse.json({ access_token: token, token });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SSO bridge error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
