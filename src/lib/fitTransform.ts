/**
 * Letterbox fit: scale content uniformly to fit a viewport and center the
 * remainder. The planner board viewport no longer matches the arena aspect
 * ratio, so the canvas content is fit on the binding axis and centered on the
 * other; user pan/zoom composes on top of this base transform.
 */
export interface FitTransform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export const fitTransform = (
  viewportWidth: number,
  viewportHeight: number,
  contentWidth: number,
  contentHeight: number,
): FitTransform => {
  const scale = Math.min(viewportWidth / contentWidth, viewportHeight / contentHeight);
  return {
    scale,
    offsetX: (viewportWidth - contentWidth * scale) / 2,
    offsetY: (viewportHeight - contentHeight * scale) / 2,
  };
};
