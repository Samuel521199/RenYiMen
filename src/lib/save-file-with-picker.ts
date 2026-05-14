/**
 * 文件保存辅助：优先调用 File System Access API（showSaveFilePicker）让用户自选保存路径，
 * 不支持的浏览器（Firefox / 旧版 Safari）自动降级为传统 <a download> 触发方式。
 *
 * @returns true = 已保存；false = 用户主动取消了文件选择对话框
 */

export interface PickerFileType {
  description: string;
  accept: Record<string, string[]>;
}

// File System Access API 最小类型声明（TypeScript dom lib 尚未全量覆盖）
interface FileSystemWritableFileStream extends WritableStream {
  write(data: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
}
interface FileSystemFileHandle {
  createWritable(): Promise<FileSystemWritableFileStream>;
}
interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: PickerFileType[];
  excludeAcceptAllOption?: boolean;
}

declare global {
  interface Window {
    showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
  }
}

export async function saveFileWithPicker(
  blob: Blob,
  suggestedName: string,
  types: PickerFileType[]
): Promise<boolean> {
  // ── 优先：File System Access API（Chrome 86+ / Edge 86+ / Safari 15.2+）
  if (typeof window !== "undefined" && typeof window.showSaveFilePicker === "function") {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName, types });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        // 用户点了「取消」
        return false;
      }
      // 其他错误（权限拒绝、沙箱等）→ 回退到传统方式
      console.warn("[saveFileWithPicker] showSaveFilePicker 失败，回退传统下载", e);
    }
  }

  // ── 降级：<a download> 触发，浏览器自动存入默认下载目录
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = suggestedName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
  return true;
}
