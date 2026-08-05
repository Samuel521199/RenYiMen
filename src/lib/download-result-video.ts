import { saveFileWithPicker } from "./save-file-with-picker";

/**
 * 将任务结果视频保存为本地文件：
 * 1. 经同源 API 拉取字节 → Blob
 * 2. 调用 showSaveFilePicker 让用户自选保存路径（不支持时降级为 <a download>）
 */
export async function downloadResultVideoAsFile(videoUrl: string, downloadFileName: string): Promise<void> {
  const ext = /\.(mp4|webm|mov|gif|glb|mp3|wav|m4a|aac|flac|ogg|opus)$/i.exec(downloadFileName.trim())?.[1]?.toLowerCase() ?? "mp4";
  const isAudio = /^(mp3|wav|m4a|aac|flac|ogg|opus)$/.test(ext);
  const isModel = ext === "glb";
  const base = /\.(mp4|webm|mov|gif|glb|mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(downloadFileName.trim())
    ? downloadFileName.trim()
    : `${downloadFileName.replace(/\.[^./\\]+$/, "")}.${ext}`;

  const res = await fetch("/api/download-external-image", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "*/*" },
    credentials: "same-origin",
    body: JSON.stringify({ url: videoUrl, mediaKind: isModel ? "model" : isAudio ? "audio" : "video" }),
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

  const mimeMap: Record<string, string> = {
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    gif: "image/gif",
    glb: "model/gltf-binary",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    aac: "audio/aac",
    flac: "audio/flac",
    ogg: "audio/ogg",
    opus: "audio/opus",
  };
  const mime = mimeMap[ext] ?? (isAudio ? "audio/mpeg" : "video/mp4");

  const saved = await saveFileWithPicker(blob, base, [
    { description: `${ext.toUpperCase()} 文件`, accept: { [mime]: [`.${ext}`] } },
  ]);

  if (!saved) {
    // 用户主动取消了文件选择对话框，静默处理
    return;
  }
}
