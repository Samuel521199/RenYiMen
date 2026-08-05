const WORKFLOW_FAVORITES_STORAGE_PREFIX = "workflow-studio-favorites";

export function workflowFavoritesStorageKey(ownerId?: string | null): string {
  const normalizedOwner = ownerId?.trim() || "anonymous";
  return `${WORKFLOW_FAVORITES_STORAGE_PREFIX}:${normalizedOwner}`;
}

export function parseWorkflowFavoriteIds(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return new Set();
    return new Set(
      value.filter((item): item is string => typeof item === "string" && item.trim().length > 0),
    );
  } catch {
    return new Set();
  }
}

export function readWorkflowFavoriteIds(ownerId?: string | null): Set<string> {
  if (typeof window === "undefined") return new Set();
  return parseWorkflowFavoriteIds(window.localStorage.getItem(workflowFavoritesStorageKey(ownerId)));
}

export function writeWorkflowFavoriteIds(ownerId: string | null | undefined, ids: ReadonlySet<string>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    workflowFavoritesStorageKey(ownerId),
    JSON.stringify(Array.from(ids).sort()),
  );
}
