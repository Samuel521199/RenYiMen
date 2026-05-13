/**
 * 浏览器直传对象存储：先向本应用申请预签名 URL，再 PUT 到上游 OSS。
 */

export function isPresignPayload(v: unknown): v is { uploadUrl: string; publicUrl: string } {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.uploadUrl === "string" && typeof o.publicUrl === "string";
}

/**
 * 将图片文件直传到 OSS，返回公网可访问的 `publicUrl`。
 *
 * 1. `POST /api/upload/presign` 传入 `filename` / `contentType`（来自 `file.name` / `file.type`）。
 * 2. 使用 `PUT` + 原生 `fetch` 将 `file` 写入 `uploadUrl`。
 */
export async function uploadImageToOSS(file: File): Promise<string> {
  try {
    const presignRes = await fetch("/api/upload/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type,
      }),
    });

    let presignJson: unknown;
    try {
      presignJson = await presignRes.json();
    } catch {
      throw new Error("上传失败");
    }

    if (!presignRes.ok || !isPresignPayload(presignJson)) {
      throw new Error("上传失败");
    }

    const { uploadUrl, publicUrl } = presignJson;

    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type },
    });

    // S3 / 部分兼容实现成功时可能是 200 或 204；仅认 200 会误判为失败
    if (!putRes.ok) {
      const detail = await putRes.text().catch(() => "");
      console.warn("[uploadImageToOSS] PUT 未成功", {
        status: putRes.status,
        statusText: putRes.statusText,
        bodySnippet: detail.slice(0, 300),
      });
      throw new Error("上传失败");
    }

    return publicUrl;
  } catch (e) {
    if (e instanceof Error && e.message === "上传失败") {
      throw e;
    }
    // 常见：OSS Bucket 未配置 CORS，浏览器跨域 PUT 会抛 TypeError（Failed to fetch）
    console.error("[uploadImageToOSS] 直传异常（多为跨域或未联网）", e);
    throw new Error("上传失败");
  }
}
