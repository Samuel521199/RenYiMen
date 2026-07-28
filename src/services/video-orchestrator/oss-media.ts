import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { optimizeMp4ForStreaming } from "./mp4-streaming";

interface OssConfig {
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicDomain: string;
  forcePathStyle: boolean;
}

const MAX_REMOTE_MEDIA_BYTES = 80 * 1024 * 1024;

export function isTemporaryDashScopeUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      host.includes("dashscope") ||
      (url.searchParams.has("Expires") && url.searchParams.has("OSSAccessKeyId") && url.searchParams.has("Signature"))
    );
  } catch {
    return false;
  }
}

export function isOwnOssUrl(value: string | null | undefined): boolean {
  const publicDomains = [
    process.env.OSS_PUBLIC_DOMAIN?.trim(),
    process.env.OSS_MEDIA_PUBLIC_DOMAIN?.trim(),
  ].filter((item): item is string => Boolean(item));
  if (!value || !publicDomains.length) return false;
  try {
    return publicDomains.some((domain) => new URL(value).origin === new URL(domain).origin);
  } catch {
    return false;
  }
}

export async function persistRemoteMediaToOss(params: {
  url: string;
  key: string;
  fallbackContentType?: string;
}): Promise<string> {
  if (isOwnOssUrl(params.url)) return params.url;
  const cfg = readOssConfig();
  const res = await fetchMediaWithRetry(params.url, {
    cache: "no-store",
    headers: { Accept: "image/*,video/*,*/*;q=0.8" },
  });
  if (!res.ok) {
    throw new Error(`Failed to download remote media HTTP ${res.status}`);
  }
  const contentLength = Number(res.headers.get("content-length") ?? "0");
  if (contentLength > MAX_REMOTE_MEDIA_BYTES) {
    throw new Error(`Remote media too large: ${contentLength}`);
  }
  let body: Buffer = Buffer.from(await res.arrayBuffer());
  if (body.byteLength > MAX_REMOTE_MEDIA_BYTES) {
    throw new Error(`Remote media too large: ${body.byteLength}`);
  }
  const contentType = (res.headers.get("content-type") ?? params.fallbackContentType ?? contentTypeFromKey(params.key))
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (contentType === "video/mp4") {
    body = await optimizeMp4ForStreaming(body);
    if (body.byteLength > MAX_REMOTE_MEDIA_BYTES) {
      throw new Error(`Optimized remote media too large: ${body.byteLength}`);
    }
  }
  const resolvedKey = mediaKeyMatchingContentType(params.key, contentType);
  await uploadMediaObject(cfg, resolvedKey, body, contentType);
  return buildPublicUrl(cfg.publicDomain, resolvedKey);
}

export async function rewriteOwnOssVideoForStreaming(url: string): Promise<string> {
  if (!isOwnOssUrl(url)) throw new Error("Video URL is not hosted by the configured OSS media origins");
  const cfg = readOssConfig();
  const parsed = new URL(url);
  const key = parsed.pathname
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => decodeURIComponent(segment))
    .join("/");
  if (!key || !key.toLowerCase().endsWith(".mp4")) {
    throw new Error("Only configured OSS MP4 objects can be rewritten");
  }
  const res = await fetchMediaWithRetry(url, { cache: "no-store", headers: { Accept: "video/mp4" } });
  if (!res.ok) throw new Error(`Failed to download existing OSS video HTTP ${res.status}`);
  const original = Buffer.from(await res.arrayBuffer());
  if (original.byteLength > MAX_REMOTE_MEDIA_BYTES) {
    throw new Error(`Existing OSS video too large: ${original.byteLength}`);
  }
  const optimized = await optimizeMp4ForStreaming(original);
  await uploadMediaObject(cfg, key, optimized, "video/mp4");
  return buildPublicUrl(cfg.publicDomain, key);
}

export function mediaKeyMatchingContentType(key: string, contentType: string): string {
  const extension = contentType === "image/png"
    ? ".png"
    : contentType === "image/webp"
      ? ".webp"
      : contentType === "image/gif"
        ? ".gif"
        : contentType === "image/jpeg" || contentType === "image/jpg"
          ? ".jpg"
          : "";
  if (!extension) return key;
  return /\.[a-z0-9]+$/i.test(key)
    ? key.replace(/\.[a-z0-9]+$/i, extension)
    : `${key}${extension}`;
}

function readOssConfig(): OssConfig {
  const region = process.env.OSS_REGION?.trim();
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.OSS_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.OSS_BUCKET_NAME?.trim();
  const publicDomain = process.env.OSS_MEDIA_PUBLIC_DOMAIN?.trim()
    || process.env.OSS_PUBLIC_DOMAIN?.trim();
  if (!region || !accessKeyId || !secretAccessKey || !bucket || !publicDomain) {
    throw new Error("OSS_REGION / OSS_ACCESS_KEY_ID / OSS_SECRET_ACCESS_KEY / OSS_BUCKET_NAME / OSS_PUBLIC_DOMAIN are required.");
  }
  return {
    region,
    endpoint: process.env.OSS_ENDPOINT?.trim() || undefined,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicDomain,
    forcePathStyle: process.env.OSS_FORCE_PATH_STYLE?.trim().toLowerCase() === "true",
  };
}

function buildPublicUrl(publicDomain: string, key: string): string {
  const base = publicDomain.replace(/\/+$/, "");
  const pathValue = key.split("/").map((seg) => encodeURIComponent(seg)).join("/");
  return `${base}/${pathValue}`;
}

async function uploadMediaObject(
  cfg: OssConfig,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const client = new S3Client({
    region: cfg.region,
    ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    forcePathStyle: cfg.forcePathStyle,
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await client.send(new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: body,
        ContentLength: body.length,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
        ContentDisposition: "inline",
      }));
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("OSS media upload failed");
}

async function fetchMediaWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok || response.status < 500 || attempt === 4) return response;
      lastError = new Error(`Media origin returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
  }
  throw lastError instanceof Error ? lastError : new Error("Media origin fetch failed");
}

function contentTypeFromKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".mp4")) return "video/mp4";
  return "image/jpeg";
}
