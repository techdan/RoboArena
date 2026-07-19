/**
 * Pure rules for the on-board targeting labels (spec §6). Every eligible
 * direct-fire tile shows its final estimated hit percentage; the layer fades
 * out when tiles get too small on screen and the cursor tooltip / Shot
 * Analysis panel carry the exact numbers instead.
 */

import type { TileCoord } from "../engine/types.js";
import type { TargetingTilePreview } from "./firingHelpers.js";

/**
 * Label text for one previewed tile, or null when a number would mislead or
 * clutter: blocked/out-of-range tiles, explosive coverage (no hit table), and
 * the shooter's own tile (occupied by the robot sprite).
 */
export const tileLabel = (tile: TargetingTilePreview, origin: TileCoord): string | null => {
  if (tile.tile.x === origin.x && tile.tile.y === origin.y) return null;
  if (tile.status !== "eligible") return null;
  if (tile.resolution === "blast") return null;
  if (tile.chancePercent === null) return null;
  return `${tile.chancePercent}%`;
};

/**
 * Layer opacity from the effective on-screen tile size in CSS pixels
 * (tileSize · fitScale · userZoom): hidden below 17px, fully opaque from 23px,
 * linear in between so zooming fades labels rather than popping them.
 */
export const labelAlpha = (effectiveTilePx: number): number =>
  Math.min(1, Math.max(0, (effectiveTilePx - 17) / 6));
