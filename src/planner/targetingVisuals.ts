/** Presentation tokens for the Phase 11.8 targeting heatmap. */

import type { TargetingTilePreview } from "./firingHelpers.js";

export type TargetingPattern = "none" | "hatch";

export interface TargetingTileVisual {
  readonly color: number;
  readonly alpha: number;
  readonly pattern: TargetingPattern;
  readonly category:
    | "excellent"
    | "good"
    | "risky"
    | "poor"
    | "zero"
    | "blast"
    | "sight-blocked"
    | "out-of-range"
    | "angle-blocked";
}

const CHANCE_VISUALS = {
  excellent: { color: 0xfde725, alpha: 0.5, pattern: "none" },
  good: { color: 0x46c7ef, alpha: 0.48, pattern: "none" },
  risky: { color: 0x7c83ff, alpha: 0.46, pattern: "none" },
  poor: { color: 0xc05bd8, alpha: 0.45, pattern: "none" },
  zero: { color: 0x642a49, alpha: 0.46, pattern: "hatch" },
} as const;

export const targetingTileVisual = (tile: TargetingTilePreview): TargetingTileVisual => {
  if (tile.status === "angle-blocked" || tile.status === "shooter-docked") {
    return {
      category: "angle-blocked",
      color: 0x07100d,
      alpha: 0.27,
      pattern: "none",
    };
  }
  if (tile.status === "out-of-range") {
    return {
      category: "out-of-range",
      color: 0x111827,
      alpha: 0.2,
      pattern: "none",
    };
  }
  if (tile.status === "sight-blocked") {
    return {
      category: "sight-blocked",
      color: 0x64748b,
      alpha: 0.42,
      pattern: "hatch",
    };
  }
  if (tile.resolution === "blast") {
    return { category: "blast", color: 0x60a5fa, alpha: 0.4, pattern: "none" };
  }
  const category = tile.chanceBand ?? "zero";
  return { category, ...CHANCE_VISUALS[category] };
};
