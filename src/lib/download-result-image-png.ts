/**
 * 将任务结果图保存为 PNG：经同源 API 拉取字节 → `createImageBitmap` → Canvas `toBlob('image/png')` → 触发浏览器下载。
 * 避免跨域资源上直接使用 `<a download>` 被浏览器忽略、仅打开新标签的问题。
 */
export async function downloadResultImageAsPng(imageUrl: string, downloadFileName: string): Promise<void> {
  const base =
    downloadFileName.toLowerCase().endsWith(".png") ?
      downloadFileName
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

  await new Promise<void>((resolve, reject) => {
    canvas.toBlob(
      (pngBlob) => {
        if (!pngBlob) {
          reject(new Error("PNG 编码失败"));
          return;
        }
        const objectUrl = URL.createObjectURL(pngBlob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = base;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
        resolve();
      },
      "image/png",
      1.0
    );
  });
}
