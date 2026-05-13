/**
 * 将任务结果视频保存为本地文件：经同源 API 拉取字节 → Blob → `<a download>`，
 * 避免跨域直链上 `download` 被忽略、仅在新标签全屏播放的问题。
 */
export async function downloadResultVideoAsFile(videoUrl: string, downloadFileName: string): Promise<void> {
  const base = /\.(mp4|webm|mov)$/i.test(downloadFileName.trim())
    ? downloadFileName.trim()
    : `${downloadFileName.replace(/\.[^./\\]+$/, "")}.mp4`;

  const res = await fetch("/api/download-external-image", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "*/*" },
    credentials: "same-origin",
    body: JSON.stringify({ url: videoUrl, mediaKind: "video" }),
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
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = base;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 2500);
}
