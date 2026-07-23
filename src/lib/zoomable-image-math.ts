export interface ZoomView {
  scale: number;
  x: number;
  y: number;
}

export interface ZoomFocus {
  x: number;
  y: number;
}

/**
 * Changes zoom while keeping the image coordinate beneath `focus` at the same
 * screen position. Translation values are screen pixels relative to the
 * viewport center, matching `translate3d(...) scale(...)`.
 */
export function zoomViewAtPoint(
  current: ZoomView,
  factor: number,
  focus: ZoomFocus = { x: 0, y: 0 },
  limits: { min: number; max: number } = { min: 1, max: 6 },
): ZoomView {
  const nextScale = Math.min(limits.max, Math.max(limits.min, current.scale * factor));
  if (nextScale === current.scale) return current;
  if (nextScale === limits.min) return { scale: limits.min, x: 0, y: 0 };
  const ratio = nextScale / current.scale;
  return {
    scale: nextScale,
    x: focus.x - (focus.x - current.x) * ratio,
    y: focus.y - (focus.y - current.y) * ratio,
  };
}
