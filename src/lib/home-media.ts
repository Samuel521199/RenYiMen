import homeMediaConfig from "../../config/home-media.json";

const publicBaseUrl = process.env.NEXT_PUBLIC_HOME_MEDIA_BASE_URL?.trim().replace(/\/+$/, "") ?? "";

/** Resolve homepage videos to their immutable OSS/CDN object, with a local fallback for development. */
export function homeMediaUrl(path: string): string {
  if (!publicBaseUrl) return path;
  const [pathname] = path.split("?", 1);
  return `${publicBaseUrl}/${homeMediaConfig.version}/${pathname.replace(/^\/+/, "")}`;
}
