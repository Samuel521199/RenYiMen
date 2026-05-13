/**
 * 将公网图片 URL 转为 RunningHub 可接受的 `api/...` 路径（先拉取再调 `/task/openapi/upload`）。
 * @see https://www.runninghub.ai/runninghub-api-doc-en/api-425761099
 */

import { ProviderError } from "./types";

const UPLOAD_PATH = "/task/openapi/upload";
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

function isHttpImageUrl(v: string): boolean {
  const t = v.trim();
  return /^https?:\/\//i.test(t);
}

function guessFilenameFromUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    const seg = u.pathname.split("/").filter(Boolean);
    const last = seg[seg.length - 1];
    if (last && /\.(png|jpe?g|webp|gif)$/i.test(last)) return last.slice(0, 200);
  } catch {
    /* ignore */
  }
  return "image.png";
}

function guessMimeFromFilename(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/png";
}

/**
 * 从公网 URL 下载图片并上传到 RunningHub，返回 `data.fileName`。
 */
export async function uploadRemoteImageUrlToRunningHub(options: {
  baseUrl: string;
  apiKey: string;
  imageUrl: string;
  signal?: AbortSignal;
}): Promise<string> {
  const { baseUrl, apiKey, imageUrl, signal } = options;
  const trimmed = imageUrl.trim();

  let imgRes: Response;
  try {
    imgRes = await fetch(trimmed, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal,
    });
  } catch (e) {
    console.error("[RunningHubUpload] 拉取图片 URL 失败", trimmed, e);
    throw new ProviderError(
      "无法下载图片（请确认 OSS/CDN 公网可访问），无法提交到 RunningHub",
      "RH_IMAGE_FETCH_FAILED",
      502,
      e
    );
  }
  if (!imgRes.ok) {
    throw new ProviderError(
      `下载图片失败 HTTP ${imgRes.status}`,
      "RH_IMAGE_FETCH_FAILED",
      502,
      await imgRes.text().catch(() => "")
    );
  }
  const buf = new Uint8Array(await imgRes.arrayBuffer());
  if (buf.byteLength > MAX_UPLOAD_BYTES) {
    throw new ProviderError(
      `图片超过 RunningHub 单文件上限 ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB，请先压缩或改用较小文件`,
      "RH_IMAGE_TOO_LARGE",
      400
    );
  }

  const filename = guessFilenameFromUrl(trimmed);
  const mime = imgRes.headers.get("content-type")?.split(";")[0]?.trim() || guessMimeFromFilename(filename);

  const form = new FormData();
  form.append("apiKey", apiKey);
  form.append("fileType", "input");
  form.append("file", new Blob([buf], { type: mime || "application/octet-stream" }), filename);

  const uploadUrl = `${baseUrl.replace(/\/$/, "")}${UPLOAD_PATH}`;
  let res: Response;
  try {
    res = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
      cache: "no-store",
      signal,
    });
  } catch (e) {
    console.error("[RunningHubUpload] 上传 RunningHub 失败", e);
    throw new ProviderError(
      e instanceof Error ? e.message : "上传到 RunningHub 失败",
      "RH_NETWORK",
      undefined,
      e
    );
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    raw = { parseError: true, httpStatus: res.status };
  }
  if (!res.ok) {
    console.error("[RunningHubUpload] HTTP 非 2xx", res.status, raw);
    throw new ProviderError(`上传 RunningHub HTTP ${res.status}`, "RH_HTTP", res.status, raw);
  }
  if (!isRecord(raw)) {
    console.error("[RunningHubUpload] 响应非对象", raw);
    throw new ProviderError("RunningHub 上传响应格式异常", "RH_BAD_RESPONSE", undefined, raw);
  }
  const code = raw.code;
  const okCode = code === 0 || code === 200 || code === "0" || code === "200";
  if (!okCode) {
    const msg = typeof raw === "object" && raw && "msg" in raw ? String((raw as Record<string, unknown>).msg) : "上传失败";
    console.error("[RunningHubUpload] 业务错误", raw);
    throw new ProviderError(msg, "RH_BUSINESS", undefined, raw);
  }
  const data = raw.data;
  if (!isRecord(data) || typeof data.fileName !== "string" || !data.fileName.trim()) {
    console.error("[RunningHubUpload] 响应缺少 data.fileName", raw);
    throw new ProviderError("RunningHub 上传响应缺少 fileName", "RH_BAD_RESPONSE", undefined, raw);
  }
  return data.fileName.trim();
}

/** 与 Comfy 常见图片输入字段名一致（含 `LoadImage` / `ImageLoader` 等）。 */
function isComfyImageInputFieldName(fieldName: string): boolean {
  return fieldName === "image" || fieldName.endsWith(".image");
}

/**
 * 将 `nodeInfoList` 扁平项里指向公网的图片 URL 替换为 RunningHub `api/...` 路径（同 URL 只上传一次）。
 */
export async function rewriteHttpUrlsInNodeInfoListForRunningHubImages(
  list: { nodeId: string; fieldName: string; fieldValue: string }[],
  opts: { baseUrl: string; apiKey: string; signal?: AbortSignal }
): Promise<{ nodeId: string; fieldName: string; fieldValue: string }[]> {
  const cache = new Map<string, string>();
  const out: { nodeId: string; fieldName: string; fieldValue: string }[] = [];

  for (const item of list) {
    const v = item.fieldValue.trim();
    if (!isComfyImageInputFieldName(item.fieldName) || !isHttpImageUrl(v)) {
      out.push(item);
      continue;
    }
    let fileName = cache.get(v);
    if (!fileName) {
      fileName = await uploadRemoteImageUrlToRunningHub({
        baseUrl: opts.baseUrl,
        apiKey: opts.apiKey,
        imageUrl: v,
        signal: opts.signal,
      });
      cache.set(v, fileName);
    }
    out.push({ ...item, fieldValue: fileName });
  }
  return out;
}
