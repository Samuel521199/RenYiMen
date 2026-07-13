import { execFile } from "node:child_process";
import { statfs } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { DiskUsagePayload } from "@/lib/disk-usage";

const execFileAsync = promisify(execFile);

function buildPayload(
  targetPath: string,
  total: number,
  free: number,
  source: string,
): DiskUsagePayload {
  const used = Math.max(total - free, 0);
  const used_percent = total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
  return {
    path: targetPath,
    total_bytes: total,
    used_bytes: used,
    free_bytes: free,
    used_percent,
    source,
  };
}

async function readDiskUsageUnix(resolvedPath: string): Promise<DiskUsagePayload> {
  const stats = await statfs(resolvedPath);
  const total = Number(stats.bsize) * Number(stats.blocks);
  const free = Number(stats.bsize) * Number(stats.bavail);
  return buildPayload(resolvedPath, total, free, "next-local-statfs");
}

async function readDiskUsageWindows(resolvedPath: string): Promise<DiskUsagePayload> {
  const driveMatch = /^([A-Za-z]:)/.exec(resolvedPath);
  const drive = driveMatch?.[1] ?? "C:";
  const script = [
    `$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive.replace(/'/g, "''")}'";`,
    "if ($null -eq $disk) { exit 2 };",
    "Write-Output ($disk.FreeSpace);",
    "Write-Output ($disk.Size);",
  ].join(" ");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { timeout: 10_000, windowsHide: true },
  );
  const [freeRaw, totalRaw] = stdout.trim().split(/\r?\n/);
  const free = Number.parseInt(String(freeRaw ?? ""), 10);
  const total = Number.parseInt(String(totalRaw ?? ""), 10);
  if (!Number.isFinite(free) || !Number.isFinite(total) || total <= 0) {
    throw new Error(`Unable to read Windows disk usage for ${drive}`);
  }
  return buildPayload(resolvedPath, total, free, "next-local-powershell");
}

export function resolveDiskUsagePath(): string {
  const configured = process.env.DISK_USAGE_PATH?.trim();
  if (configured) return path.resolve(configured);
  return path.resolve(process.cwd(), "ai-workflow-data", "storage");
}

export async function readLocalDiskUsage(customPath?: string): Promise<DiskUsagePayload> {
  const targetPath = path.resolve(customPath ?? resolveDiskUsagePath());
  if (process.platform === "win32") {
    return readDiskUsageWindows(targetPath);
  }
  return readDiskUsageUnix(targetPath);
}

export async function readWorkbenchBackendDiskUsage(
  backendUrl: string,
): Promise<DiskUsagePayload | null> {
  const base = backendUrl.replace(/\/$/, "");
  const response = await fetch(`${base}/api/system/disk-usage`, {
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return null;
  const json = (await response.json()) as { code?: number; data?: DiskUsagePayload };
  if (json.code !== 0 || !json.data) return null;
  return json.data;
}
