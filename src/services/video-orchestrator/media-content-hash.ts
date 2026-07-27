import { createHash } from "node:crypto";

const MAX_QUALITY_HASH_BYTES = 80 * 1024 * 1024;

export async function hashMediaContent(url: string): Promise<string> {
  const hash = createHash("sha256");
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    if (comma < 0) throw new Error("Invalid media data URL");
    const header = url.slice(0, comma);
    const payload = url.slice(comma + 1);
    const body = header.includes(";base64")
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
    if (body.byteLength > MAX_QUALITY_HASH_BYTES) throw new Error("Media content is too large to hash");
    return `sha256:${hash.update(body).digest("hex")}`;
  }

  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "image/*,video/*,*/*;q=0.8" },
  });
  if (!response.ok) throw new Error(`Failed to hash media HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_QUALITY_HASH_BYTES) throw new Error("Media content is too large to hash");
  if (!response.body) {
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength > MAX_QUALITY_HASH_BYTES) throw new Error("Media content is too large to hash");
    return `sha256:${hash.update(body).digest("hex")}`;
  }

  const reader = response.body.getReader();
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_QUALITY_HASH_BYTES) {
      await reader.cancel();
      throw new Error("Media content is too large to hash");
    }
    hash.update(value);
  }
  return `sha256:${hash.digest("hex")}`;
}
