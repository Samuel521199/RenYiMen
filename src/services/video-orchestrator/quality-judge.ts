import type { VideoShot } from "@prisma/client";

export function scoreShotImage(shot: Pick<VideoShot, "imageUrl" | "imagePrompt" | "locked">): number {
  let score = 45;
  if (shot.imageUrl) score += 30;
  if (shot.imagePrompt && shot.imagePrompt.length > 80) score += 15;
  if (shot.locked) score += 5;
  return Math.max(0, Math.min(100, score));
}

export function buildPlaceholderKeyframeUrl(params: {
  shotNo: number;
  aspectRatio: string;
  title: string;
  purpose: string;
  subtitle: string;
}): string {
  const width = params.aspectRatio === "16:9" ? 1280 : params.aspectRatio === "1:1" ? 1024 : 720;
  const height = params.aspectRatio === "16:9" ? 720 : params.aspectRatio === "1:1" ? 1024 : 1280;
  const title = escapeXml(params.title.slice(0, 28));
  const purpose = escapeXml(params.purpose.slice(0, 42));
  const subtitle = escapeXml(params.subtitle.slice(0, 36));
  const hue = (params.shotNo * 47) % 360;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},50%,18%)"/><stop offset="1" stop-color="hsl(${(hue + 80) % 360},45%,8%)"/></linearGradient></defs>`,
    `<rect width="100%" height="100%" fill="url(#bg)"/>`,
    `<rect x="${width * 0.08}" y="${height * 0.08}" width="${width * 0.84}" height="${height * 0.84}" rx="28" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.22)" stroke-width="2"/>`,
    `<text x="${width * 0.12}" y="${height * 0.18}" fill="rgba(255,255,255,0.72)" font-family="Arial, sans-serif" font-size="${Math.round(width * 0.045)}" font-weight="700">SHOT ${String(params.shotNo).padStart(2, "0")}</text>`,
    `<text x="${width * 0.12}" y="${height * 0.34}" fill="white" font-family="Arial, sans-serif" font-size="${Math.round(width * 0.055)}" font-weight="700">${title}</text>`,
    `<text x="${width * 0.12}" y="${height * 0.46}" fill="rgba(255,255,255,0.86)" font-family="Arial, sans-serif" font-size="${Math.round(width * 0.035)}">${purpose}</text>`,
    `<text x="${width * 0.12}" y="${height * 0.78}" fill="rgba(255,255,255,0.76)" font-family="Arial, sans-serif" font-size="${Math.round(width * 0.032)}">${subtitle}</text>`,
    `</svg>`,
  ].join("");
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
