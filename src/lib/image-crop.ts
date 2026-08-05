export interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropOutputSize {
  width: number;
  height: number;
  scale: number;
}

/** Route cross-origin images through the authenticated media proxy for Canvas use. */
export function resolveCropImageSource(imageUrl: string, currentOrigin: string): string {
  if (imageUrl.startsWith("blob:") || imageUrl.startsWith("data:")) return imageUrl;

  try {
    const parsed = new URL(imageUrl, currentOrigin);
    if (parsed.origin === currentOrigin) return imageUrl;
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return `/api/download-external-image?url=${encodeURIComponent(parsed.href)}`;
    }
  } catch {
    // Keep relative or otherwise browser-resolvable sources unchanged.
  }

  return imageUrl;
}

/** Keep the crop's aspect ratio while fitting the model's dimension bounds. */
export function getCropOutputSize(
  crop: Pick<PixelCrop, "width" | "height">,
  minDimension?: number,
  maxDimension?: number,
): CropOutputSize {
  if (!(crop.width > 0) || !(crop.height > 0)) {
    throw new Error("裁剪区域无效");
  }

  const shortest = Math.min(crop.width, crop.height);
  const longest = Math.max(crop.width, crop.height);
  const minimumScale = minDimension ? minDimension / shortest : 0;
  const maximumScale = maxDimension ? maxDimension / longest : Number.POSITIVE_INFINITY;

  if (minimumScale > maximumScale) {
    throw new Error("裁剪区域过于狭长，无法满足模型尺寸要求");
  }

  const scale = Math.min(maximumScale, Math.max(minimumScale, 1));
  return {
    width: Math.max(1, Math.round(crop.width * scale)),
    height: Math.max(1, Math.round(crop.height * scale)),
    scale,
  };
}

export function isImageSizeWithinBounds(
  width: number,
  height: number,
  minDimension?: number,
  maxDimension?: number,
): boolean {
  if (minDimension && (width < minDimension || height < minDimension)) return false;
  if (maxDimension && (width > maxDimension || height > maxDimension)) return false;
  return true;
}
