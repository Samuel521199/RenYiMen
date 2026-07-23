import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES_IMAGE = 25 * 1024 * 1024;
/** 视频结果通常大于单张图；仍由服务端一次性缓冲，超大文件可后续改为流式透传。 */
const MAX_BYTES_VIDEO = 200 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 45_000;
const IMAGE_PREVIEW_CACHE_CONTROL = "private, max-age=604800, stale-while-revalidate=86400, immutable";
const NO_STORE_CACHE_CONTROL = "private, no-store";

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

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = new URL(req.url).searchParams;
  const url = searchParams.get("url")?.trim() ?? "";
  if (!url) {
    return NextResponse.json({ error: "MISSING_URL" }, { status: 400 });
  }

  const mediaKindRaw = searchParams.get("mediaKind")?.trim().toLowerCase() ?? "image";
  return proxyExternalMedia(url, mediaKindRaw, { cachePreview: mediaKindRaw !== "video" });
}

/**
 * 登录用户代理拉取公网媒体字节：默认按「图片」校验大小与 Accept；
 * `body.mediaKind === "video"` 时用于 MP4/WebM 等结果下载（同源 Blob + `a.download`）。
 * 支持 `data:` URI（Base64 图片，如 GPT-image-2 返回的 b64_json 结果）直接解码返回。
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
  return proxyExternalMedia(url, mediaKindRaw, { cachePreview: false });
}

async function proxyExternalMedia(
  url: string,
  mediaKindRaw: string,
  options: { cachePreview: boolean },
) {
  const isVideo = mediaKindRaw === "video";
  const maxBytes = isVideo ? MAX_BYTES_VIDEO : MAX_BYTES_IMAGE;
  const cacheControl = options.cachePreview && !isVideo
    ? IMAGE_PREVIEW_CACHE_CONTROL
    : NO_STORE_CACHE_CONTROL;

  // ── data: URI（如 gpt-image-2 的 b64_json 结果）直接解码返回 ────────────
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    if (comma === -1) {
      return NextResponse.json({ error: "INVALID_DATA_URI" }, { status: 400 });
    }
    const meta = url.slice(5, comma); // e.g. "image/png;base64"
    const dataPart = url.slice(comma + 1);
    const isBase64 = meta.endsWith(";base64");
    const contentType = isBase64 ? meta.slice(0, -7) : meta;
    let buf: Buffer;
    try {
      buf = isBase64
        ? Buffer.from(dataPart, "base64")
        : Buffer.from(decodeURIComponent(dataPart));
    } catch {
      return NextResponse.json({ error: "DATA_URI_DECODE_FAILED" }, { status: 400 });
    }
    if (buf.byteLength > maxBytes) {
      return NextResponse.json({ error: "TOO_LARGE" }, { status: 413 });
    }
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": contentType || "image/png",
        "Cache-Control": cacheControl,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

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
        "Cache-Control": cacheControl,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "FETCH_FAILED", message: msg }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
