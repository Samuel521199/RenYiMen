/**
 * Fetch workbench asset images for use in AI Studio (upload to OSS for upstream providers).
 */

export function resolveWorkbenchAssetFetchUrl(url: string): string {
  const value = (url || "").trim();
  if (!value) return value;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/api/workbench")) return value;
  if (value.startsWith("/static/")) return `/api/workbench${value}`;
  return value;
}

export async function fetchWorkbenchAssetAsFile(url: string, fileName: string): Promise<File> {
  const fetchUrl = resolveWorkbenchAssetFetchUrl(url);
  const token = typeof window !== "undefined" ? (localStorage.getItem("workbench_token") ?? "") : "";
  const response = await fetch(fetchUrl, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new Error(`素材加载失败（HTTP ${response.status}）`);
  }
  const blob = await response.blob();
  const safeName =
    fileName && fileName.includes(".") ? fileName : `${fileName || "asset"}.png`;
  return new File([blob], safeName, { type: blob.type || "image/png" });
}
