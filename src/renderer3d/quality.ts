/** Explicit local graphics preference, shared by the planner and movie. */
export type GraphicsQuality = "cinematic" | "balanced" | "performance";
export const GRAPHICS_QUALITY_KEY = "roboarena.graphicsQuality";
export const GRAPHICS_QUALITY_EVENT = "roboarena:graphics-quality";

export const GRAPHICS_QUALITIES = {
  cinematic: { label: "Cinematic", pixels: Infinity, aoScale: 1 },
  balanced: { label: "Balanced", pixels: 1_500_000, aoScale: 0.5 },
  performance: { label: "Performance", pixels: 900_000, aoScale: 0.5 },
} as const;

export const isGraphicsQuality = (value: unknown): value is GraphicsQuality =>
  value === "cinematic" || value === "balanced" || value === "performance";

export const preferredGraphicsQuality = (): GraphicsQuality => {
  try {
    const stored = window.localStorage.getItem(GRAPHICS_QUALITY_KEY);
    if (isGraphicsQuality(stored)) return stored;
  } catch {
    // Storage may be blocked. The full-quality default remains available.
  }
  return "cinematic";
};

export const rememberGraphicsQuality = (quality: GraphicsQuality): void => {
  try {
    window.localStorage.setItem(GRAPHICS_QUALITY_KEY, quality);
  } catch {
    // The event still applies the choice for this page.
  }
  window.dispatchEvent(new CustomEvent(GRAPHICS_QUALITY_EVENT, { detail: quality }));
};

/** Preserve native pixels on small canvases; cap work only when the image is large. */
export const graphicsPixelRatio = (
  quality: GraphicsQuality,
  width: number,
  height: number,
  deviceRatio: number,
): number =>
  Math.min(
    deviceRatio,
    2,
    Math.sqrt(GRAPHICS_QUALITIES[quality].pixels / Math.max(1, width * height)),
  );
