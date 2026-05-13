import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRESIGN_EXPIRES_SEC = 300;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

/** 去掉路径成分，仅保留文件名并限制危险字符（对象键用）。 */
function sanitizeFileName(name: unknown): string {
  if (typeof name !== "string" || !name.trim()) return "upload.bin";
  const base = name.replace(/^[\\/]+/, "").replace(/.*[/\\]/, "").trim().slice(0, 180);
  if (!base) return "upload.bin";
  return base.replace(/[^\w.\-\u0080-\uFFFF]+/g, "_").replace(/^\.+/, "f");
}

/** 校验 `type/subtype`，避免异常 Content-Type 写入签名。 */
function normalizeContentType(ct: unknown): string | null {
  if (typeof ct !== "string" || !ct.trim()) return null;
  const t = ct.trim().split(",")[0]!.trim().slice(0, 128);
  if (!/^[\w.-]+\/[\w.+-]+$/i.test(t)) return null;
  return t;
}

/** 仅返回「键名」，便于排障（不暴露任何密钥）。 */
function listMissingOssEnvKeys(): string[] {
  const keys = [
    "OSS_REGION",
    "OSS_ACCESS_KEY_ID",
    "OSS_SECRET_ACCESS_KEY",
    "OSS_BUCKET_NAME",
    "OSS_PUBLIC_DOMAIN",
  ] as const;
  return keys.filter((k) => !process.env[k]?.trim());
}

function readOssEnv(): {
  region: string;
  endpoint: string | undefined;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicDomain: string;
  forcePathStyle: boolean;
} | null {
  const region = process.env.OSS_REGION?.trim();
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.OSS_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.OSS_BUCKET_NAME?.trim();
  const publicDomain = process.env.OSS_PUBLIC_DOMAIN?.trim();
  if (!region || !accessKeyId || !secretAccessKey || !bucket || !publicDomain) {
    return null;
  }
  const endpoint = process.env.OSS_ENDPOINT?.trim() || undefined;
  const forcePathStyle = process.env.OSS_FORCE_PATH_STYLE?.trim().toLowerCase() === "true";
  return {
    region,
    endpoint,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicDomain,
    forcePathStyle,
  };
}

function buildPublicUrl(publicDomain: string, key: string): string {
  const base = publicDomain.replace(/\/+$/, "");
  const path = key
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `${base}/${path}`;
}

/**
 * POST `/api/upload/presign` — 为浏览器直传生成 S3 兼容 `PutObject` 预签名 URL（5 分钟有效）。
 * Body: `{ filename: string, contentType: string }` → `{ uploadUrl, publicUrl }`
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    console.warn("[upload/presign] 拒绝：未登录");
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const userId = session.user.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    console.warn("[upload/presign] 拒绝：JSON 解析失败", { userId });
    return NextResponse.json({ error: "请求体须为 JSON" }, { status: 400 });
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: "请求体格式无效" }, { status: 400 });
  }

  const filename = sanitizeFileName(body.filename);
  const contentType = normalizeContentType(body.contentType);
  if (!contentType) {
    console.warn("[upload/presign] 拒绝：无效 contentType", { userId, raw: body.contentType });
    return NextResponse.json({ error: "缺少或无效的 contentType" }, { status: 400 });
  }

  const cfg = readOssEnv();
  if (!cfg) {
    const missingKeys = listMissingOssEnvKeys();
    console.error("[upload/presign] OSS 环境变量不完整", { missingKeys });
    return NextResponse.json(
      {
        error: "对象存储未配置",
        missingKeys,
        hint: "需与代码一致的变量名；文件放在项目根目录的 .env / .env.local，修改后请重启 next dev。",
      },
      { status: 503 }
    );
  }

  const unique = randomBytes(4).toString("hex");
  const key = `uploads/${Date.now()}-${unique}-${filename}`;

  console.log("[upload/presign] 开始签发", {
    userId,
    key,
    contentType,
    bucket: cfg.bucket,
    region: cfg.region,
    hasEndpoint: Boolean(cfg.endpoint),
    forcePathStyle: cfg.forcePathStyle,
    expiresInSec: PRESIGN_EXPIRES_SEC,
  });

  const client = new S3Client({
    region: cfg.region,
    ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    forcePathStyle: cfg.forcePathStyle,
  });

  const command = new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    ContentType: contentType,
  });

  let uploadUrl: string;
  try {
    uploadUrl = await getSignedUrl(client, command, { expiresIn: PRESIGN_EXPIRES_SEC });
  } catch (e) {
    console.error("[upload/presign] 预签名失败", { userId, key, err: e });
    return NextResponse.json({ error: "预签名生成失败" }, { status: 502 });
  }

  const publicUrl = buildPublicUrl(cfg.publicDomain, key);
  console.log("[upload/presign] 签发成功", {
    userId,
    key,
    expiresInSec: PRESIGN_EXPIRES_SEC,
    publicUrlHost: (() => {
      try {
        return new URL(publicUrl).host;
      } catch {
        return "(invalid-public-domain)";
      }
    })(),
  });

  return NextResponse.json({ uploadUrl, publicUrl });
}
