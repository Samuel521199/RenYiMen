export type DiskUsagePayload = {
  path: string;
  total_bytes: number;
  used_bytes: number;
  free_bytes: number;
  used_percent: number;
  source?: string;
};

export const DEFAULT_DISK_WARN_PERCENT = 80;
export const DEFAULT_DISK_CRITICAL_PERCENT = 90;

export function parseDiskWarnPercent(raw: string | undefined): number {
  const parsed = Number.parseFloat(String(raw ?? ""));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) {
    return DEFAULT_DISK_WARN_PERCENT;
  }
  return parsed;
}

export function parseDiskCriticalPercent(raw: string | undefined): number {
  const parsed = Number.parseFloat(String(raw ?? ""));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) {
    return DEFAULT_DISK_CRITICAL_PERCENT;
  }
  return parsed;
}

export function formatBytesAsGib(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0G";
  const gib = bytes / 1024 ** 3;
  if (gib >= 100) return `${Math.round(gib)}G`;
  if (gib >= 10) return `${Math.round(gib)}G`;
  return `${gib.toFixed(1)}G`;
}

export function getDiskUsageLevel(
  usedPercent: number,
  warnPercent = DEFAULT_DISK_WARN_PERCENT,
  criticalPercent = DEFAULT_DISK_CRITICAL_PERCENT,
): "normal" | "warning" | "critical" {
  if (usedPercent >= criticalPercent) return "critical";
  if (usedPercent >= warnPercent) return "warning";
  return "normal";
}

export function formatDiskUsageSummary(payload: DiskUsagePayload): string {
  const free = formatBytesAsGib(payload.free_bytes);
  const total = formatBytesAsGib(payload.total_bytes);
  return `${free} / ${total} (${Math.round(payload.used_percent)}%)`;
}
