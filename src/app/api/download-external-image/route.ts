import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES_IMAGE = 25 * 1024 * 1024;
/** 视频结果通常大于单张图；仍由服务端一次性缓冲，超大文件可后续改为流式透传。 */
const MAX_BYTES_VIDEO = 200 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 45_000;

function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "0.0.0.0") return true;
  if (h === "[::1]" || h === "::1") return true;

  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const d = Number(m[4]);
  if ([a, b, c, d].some((x) => x > 255)) return true;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/**
 * 登录用户代理拉取公网媒体字节：默认按「图片」校验大小与 Accept；
 * `body.mediaKind === "video"` 时用于 MP4/WebM 等结果下载（同源 Blob + `a.download`）。
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const rec = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  const url = typeof rec?.url === "string" ? rec.url.trim() : "";
  if (!url) {
    return NextResponse.json({ error: "MISSING_URL" }, { status: 400 });
  }

  const mediaKindRaw = typeof rec?.mediaKind === "string" ? rec.mediaKind.trim().toLowerCase() : "image";
  const isVideo = mediaKindRaw === "video";
  const maxBytes = isVideo ? MAX_BYTES_VIDEO : MAX_BYTES_IMAGE;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "INVALID_URL" }, { status: 400 });
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return NextResponse.json({ error: "UNSUPPORTED_PROTOCOL" }, { status: 400 });
  }

  if (isBlockedHostname(parsed.hostname)) {
    return NextResponse.json({ error: "BLOCKED_HOST" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeoutMs = isVideo ? 120_000 : FETCH_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: isVideo ? "video/*,*/*;q=0.9" : "image/*,*/*;q=0.8",
      },
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: "UPSTREAM_FAILED", status: upstream.status },
        { status: 502 }
      );
    }

    const cl = upstream.headers.get("content-length");
    if (cl && Number(cl) > maxBytes) {
      return NextResponse.json({ error: "TOO_LARGE" }, { status: 413 });
    }

    const buf = await upstream.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      return NextResponse.json({ error: "TOO_LARGE" }, { status: 413 });
    }

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "FETCH_FAILED", message: msg }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
