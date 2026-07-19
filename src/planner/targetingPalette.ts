/**
 * Single source of truth for targeting-overlay colors (spec §6 "Planner
 * targeting analysis"). The PIXI board layer consumes `hex`/`alpha`, while the
 * React legend and Shot Analysis panel consume `css`, so the board, legend,
 * and panel can never drift apart.
 *
 * Probability bands use a viridis-family ramp: perceptually ordered by
 * luminance (excellent brightest → zero darkest) so the ordering survives
 * grayscale and common color-vision deficiencies. Blocked statuses pair color
 * with a distinct pattern (dim / hatch / reverse-hatch) so they are never
 * color-only.
 */

export type TargetingPattern = "none" | "hatch" | "reverse-hatch" | "dim";

export type TargetingCategory =
  | "excellent"
  | "good"
  | "risky"
  | "poor"
  | "zero"
  | "blast"
  | "sight-blocked"
  | "out-of-range"
  | "angle-blocked";

export interface TargetingSwatch {
  readonly hex: number;
  readonly css: string;
  readonly alpha: number;
  readonly pattern: TargetingPattern;
}

export const hexToCss = (hex: number): string => `#${hex.toString(16).padStart(6, "0")}`;

const swatch = (hex: number, alpha: number, pattern: TargetingPattern): TargetingSwatch => ({
  hex,
  css: hexToCss(hex),
  alpha,
  pattern,
});

export const TARGETING_PALETTE: Record<TargetingCategory, TargetingSwatch> = {
  excellent: swatch(0xfde725, 0.62, "none"),
  good: swatch(0x5ec962, 0.55, "none"),
  risky: swatch(0x21918c, 0.5, "none"),
  poor: swatch(0x3b528b, 0.48, "none"),
  zero: swatch(0x2d1140, 0.5, "hatch"),
  blast: swatch(0x60a5fa, 0.4, "none"),
  "sight-blocked": swatch(0x64748b, 0.45, "hatch"),
  "out-of-range": swatch(0x0b0f14, 0.55, "dim"),
  "angle-blocked": swatch(0x10161f, 0.45, "reverse-hatch"),
};

export const TARGETING_BAND_ORDER = ["excellent", "good", "risky", "poor", "zero"] as const;

/** WCAG relative luminance of an opaque hex color, for ordering checks. */
export const relativeLuminance = (hex: number): number => {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((hex >> 16) & 0xff) +
    0.7152 * channel((hex >> 8) & 0xff) +
    0.0722 * channel(hex & 0xff)
  );
};
