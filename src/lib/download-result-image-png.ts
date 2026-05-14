import { saveFileWithPicker } from "./save-file-with-picker";

/**
 * 将任务结果图保存为 PNG：
 * 1. 经同源 API 拉取字节 → createImageBitmap → Canvas toBlob 转成 PNG
 * 2. 调用 showSaveFilePicker 让用户自选保存路径（不支持时降级为 <a download>）
 */
export async function downloadResultImageAsPng(imageUrl: string, downloadFileName: string): Promise<void> {
  const base =
    downloadFileName.toLowerCase().endsWith(".png")
      ? downloadFileName
      : `${downloadFileName.replace(/\.[^./\\]+$/, "")}.png`;

  const res = await fetch("/api/download-external-image", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "*/*" },
    credentials: "same-origin",
    body: JSON.stringify({ url: imageUrl }),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { error?: string; message?: string };
      detail = j.message ?? j.error ?? "";
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(detail || `下载失败（HTTP ${res.status}）`);
  }

  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);

  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bmp.close();
    throw new Error("无法创建画布上下文");
  }
  ctx.drawImage(bmp, 0, 0);
  bmp.close();

  const pngBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (!b) {
          reject(new Error("PNG 编码失败"));
          return;
        }
        resolve(b);
      },
      "image/png",
      1.0
    );
  });

  const saved = await saveFileWithPicker(pngBlob, base, [
    { description: "PNG 图片", accept: { "image/png": [".png"] } },
  ]);

  if (!saved) {
    // 用户主动取消了文件选择对话框，静默处理
    return;
  }
}
