/** AAC/MP3 encoders can append one or two padding frames to an exact-length source. */
export const MEDIA_DURATION_ENCODING_TOLERANCE_SECONDS = 0.05;

export function exceedsMediaDurationMaximum(
  durationSeconds: number,
  maximumSeconds: number,
  maximumExclusive: boolean,
): boolean {
  if (maximumExclusive) return durationSeconds >= maximumSeconds;
  return durationSeconds > maximumSeconds + MEDIA_DURATION_ENCODING_TOLERANCE_SECONDS;
}
