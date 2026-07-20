/**
 * Base fit for the planner board. Two modes matter:
 *
 * - `"contain"` letterboxes the whole arena on its binding axis and centers the
 *   remainder — nothing is cropped.
 * - `"width"` fills the full viewport width and centers vertically, cropping
 *   top and bottom when the arena is taller than the viewport at that scale.
 *   This is the planner's default/reset camera so the arena reaches the
 *   viewport edges; user pan/zoom composes on top of this base transform, and
 *   zooming out reaches the cropped rows (see {@link fitWidthZoomFloor}).
 */
export type FitMode = "contain" | "width";

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
  mode: FitMode = "contain",
): FitTransform => {
  const scale =
    mode === "width"
      ? viewportWidth / contentWidth
      : Math.min(viewportWidth / contentWidth, viewportHeight / contentHeight);
  return {
    scale,
    offsetX: (viewportWidth - contentWidth * scale) / 2,
    offsetY: (viewportHeight - contentHeight * scale) / 2,
  };
};

/**
 * The user-zoom floor for a fit-width base: the multiplier that zooms the
 * fit-width camera back out until the whole arena fits (contain). It is the
 * ratio of the contain scale to the fit-width scale, always ≤ 1 (a landscape
 * viewport crops vertically, so contain ≤ width). At or below this floor the
 * entire arena — every Home row — is visible.
 */
export const fitWidthZoomFloor = (
  viewportWidth: number,
  viewportHeight: number,
  contentWidth: number,
  contentHeight: number,
): number => {
  const widthScale = viewportWidth / contentWidth;
  if (widthScale === 0 || !Number.isFinite(widthScale)) return 1;
  const containScale = Math.min(widthScale, viewportHeight / contentHeight);
  return Math.min(1, containScale / widthScale);
};
