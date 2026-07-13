/** Default browser cache TTL for workbench static assets (24h). */
export const DEFAULT_WORKBENCH_STATIC_CACHE_MAX_AGE = 86_400;

export function parseWorkbenchStaticCacheMaxAge(raw: string | undefined): number {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_WORKBENCH_STATIC_CACHE_MAX_AGE;
  }
  return parsed;
}

/** `/api/workbench/static/...` proxy paths map to backend `/static/...`. */
export function isWorkbenchStaticAssetPath(pathSegments: string[]): boolean {
  return pathSegments.length > 0 && pathSegments[0] === "static";
}

export function buildStaticCacheControl(maxAge: number): string {
  const safeMaxAge = Number.isFinite(maxAge) && maxAge >= 0 ? maxAge : DEFAULT_WORKBENCH_STATIC_CACHE_MAX_AGE;
  return `public, max-age=${safeMaxAge}, must-revalidate`;
}

export const STATIC_UPSTREAM_HEADER_NAMES = [
  "content-type",
  "content-length",
  "etag",
  "last-modified",
  "accept-ranges",
] as const;
