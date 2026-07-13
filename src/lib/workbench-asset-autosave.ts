import type { SkuCategory } from "@/types/sku-catalog";

type AutoSaveMediaType = "image" | "video";

interface AutoSaveItem {
  url: string;
  mediaType: AutoSaveMediaType;
}

interface AutoSaveOptions {
  taskId: string;
  skuId: string;
  skuCategory: SkuCategory;
  items: AutoSaveItem[];
}

interface AutoSaveSummary {
  saved: number;
  failed: number;
  errors: string[];
}

function normalizeToken(): string {
  if (typeof window === "undefined") return "";
  const value = localStorage.getItem("workbench_token");
  return typeof value === "string" ? value.trim() : "";
}

function pickCategory(mediaType: AutoSaveMediaType, skuCategory: SkuCategory): string {
  if (mediaType === "video") return "game_content";
  if (skuCategory === "prompt") return "props";
  if (skuCategory === "video") return "action";
  return "expression";
}

function guessExtensionFromUrl(url: string, mediaType: AutoSaveMediaType): string {
  if (url.startsWith("data:")) {
    const mime = url.slice(5, url.indexOf(";"));
    if (mime.includes("png")) return "png";
    if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
    if (mime.includes("webp")) return "webp";
    if (mime.includes("mp4")) return "mp4";
    return mediaType === "video" ? "mp4" : "png";
  }
  const m = url.toLowerCase().split("?")[0].match(/\.(png|jpe?g|webp|mp4|mov|webm)$/);
  if (m?.[1]) {
    const ext = m[1];
    return ext === "jpeg" ? "jpg" : ext;
  }
  return mediaType === "video" ? "mp4" : "png";
}

async function uploadSingleGeneratedItem(
  token: string,
  taskId: string,
  skuId: string,
  skuCategory: SkuCategory,
  item: AutoSaveItem,
  index: number
): Promise<void> {
  const category = pickCategory(item.mediaType, skuCategory);
  const ext = guessExtensionFromUrl(item.url, item.mediaType);
  const filename = `tools-${taskId}-${index + 1}.${ext}`;

  const formData = new FormData();
  if (item.url.startsWith("data:")) {
    const blob = await fetch(item.url).then((r) => r.blob());
    formData.append("file", new File([blob], filename, { type: blob.type || "application/octet-stream" }));
  } else {
    formData.append("source_url", item.url);
  }
  formData.append("filename", filename);
  formData.append("category", category);
  formData.append(
    "tags",
    [
      "工具自动入库",
      item.mediaType === "video" ? "自动视频" : "自动图片",
      `sku:${skuId}`,
      `task:${taskId}`,
    ].join(",")
  );

  const res = await fetch("/api/workbench/api/assets/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const body = (await res.json().catch(() => null)) as
    | { code?: number; msg?: string; message?: string }
    | null;

  if (!res.ok || !body || body.code !== 0) {
    const msg =
      (body?.msg && body.msg.trim()) ||
      (body?.message && body.message.trim()) ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }
}

export async function autoSaveGeneratedResultsToWorkbenchAssets(
  options: AutoSaveOptions
): Promise<AutoSaveSummary> {
  const token = normalizeToken();
  if (!token) {
    return { saved: 0, failed: options.items.length, errors: ["未检测到 Workbench 登录态，请先登录工作台"] };
  }

  const summary: AutoSaveSummary = { saved: 0, failed: 0, errors: [] };

  for (let i = 0; i < options.items.length; i += 1) {
    const item = options.items[i];
    try {
      await uploadSingleGeneratedItem(token, options.taskId, options.skuId, options.skuCategory, item, i);
      summary.saved += 1;
    } catch (e) {
      summary.failed += 1;
      summary.errors.push(e instanceof Error ? e.message : "入库失败");
    }
  }

  return summary;
}
