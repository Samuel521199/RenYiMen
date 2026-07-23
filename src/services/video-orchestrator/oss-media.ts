import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

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
  const publicDomain = process.env.OSS_PUBLIC_DOMAIN?.trim();
  if (!value || !publicDomain) return false;
  try {
    return new URL(value).origin === new URL(publicDomain).origin;
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
  const res = await fetch(params.url, {
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
  const body = Buffer.from(await res.arrayBuffer());
  if (body.byteLength > MAX_REMOTE_MEDIA_BYTES) {
    throw new Error(`Remote media too large: ${body.byteLength}`);
  }
  const contentType = (res.headers.get("content-type") ?? params.fallbackContentType ?? contentTypeFromKey(params.key))
    .split(";")[0]
    .trim()
    .toLowerCase();
  const resolvedKey = mediaKeyMatchingContentType(params.key, contentType);
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
  await client.send(new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: resolvedKey,
    Body: body,
    ContentLength: body.length,
    ContentType: contentType,
  }));
  return buildPublicUrl(cfg.publicDomain, resolvedKey);
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
  const publicDomain = process.env.OSS_PUBLIC_DOMAIN?.trim();
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

function contentTypeFromKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".mp4")) return "video/mp4";
  return "image/jpeg";
}
