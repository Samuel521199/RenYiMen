import { saveFileWithPicker } from "./save-file-with-picker";

export type ModelExportFormat = "fbx" | "textures";

export async function downloadModelExport(modelUrl: string, format: ModelExportFormat): Promise<void> {
  const response = await fetch("/api/model-assets/export", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/zip" },
    credentials: "same-origin",
    body: JSON.stringify({ url: modelUrl, format }),
  });

  if (!response.ok) {
    let message = "模型导出失败，请稍后重试。";
    try {
      const body = await response.json() as { error?: string };
      if (body.error) message = body.error;
    } catch {
      const detail = await response.text().catch(() => "");
      if (detail.trim()) message = detail.trim();
    }
    throw new Error(message);
  }

  const filename = format === "fbx" ? "model-fbx-package.zip" : "model-textures.zip";
  const saved = await saveFileWithPicker(await response.blob(), filename, [
    { description: "ZIP 美术资源包", accept: { "application/zip": [".zip"] } },
  ]);
  if (!saved) return;
}
