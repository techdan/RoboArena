/** Presentation tokens for the Phase 11.8 targeting heatmap. */

import type { TargetingTilePreview } from "./firingHelpers";
import {
  TARGETING_PALETTE,
  type TargetingCategory,
  type TargetingPattern,
} from "./targetingPalette";

export type { TargetingCategory, TargetingPattern };

export interface TargetingTileVisual {
  readonly color: number;
  readonly alpha: number;
  readonly pattern: TargetingPattern;
  readonly category: TargetingCategory;
}

const visual = (category: TargetingCategory): TargetingTileVisual => {
  const { hex, alpha, pattern } = TARGETING_PALETTE[category];
  return { category, color: hex, alpha, pattern };
};

export const targetingTileVisual = (tile: TargetingTilePreview): TargetingTileVisual => {
  if (tile.status === "angle-blocked" || tile.status === "shooter-docked")
    return visual("angle-blocked");
  if (tile.status === "out-of-range") return visual("out-of-range");
  if (tile.status === "sight-blocked") return visual("sight-blocked");
  if (tile.resolution === "blast") return visual("blast");
  return visual(tile.chanceBand ?? "zero");
};
