/**
 * Pure rules for the on-board targeting labels (spec §6). Every eligible
 * direct-fire tile shows its final estimated hit percentage; the layer fades
 * out when tiles get too small on screen and the cursor tooltip / Shot
 * Analysis panel carry the exact numbers instead.
 */

import type { TileCoord } from "../engine/types";
import type { AimPreviewStatus, TargetingTilePreview } from "./firingHelpers";

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

/**
 * Plain-language blocked-status wording shared by the cursor tooltip, the
 * Shot Analysis panel, and the legend, so the same state is never named three
 * different ways.
 */
export const targetingStatusLabel = (
  status: Exclude<AimPreviewStatus, "eligible">,
  maxDistance: number,
): string => {
  switch (status) {
    case "shooter-docked":
      return "Deploy this robot before firing";
    case "out-of-range":
      return `Outside the ${maxDistance}-tile range`;
    case "angle-blocked":
      return "Behind the scan cone — robots can’t fire backward";
    case "sight-blocked":
      return "A wall blocks line of sight";
  }
};

/**
 * Compact cursor-tooltip lines for the hovered tile: the precision fallback
 * when the per-tile labels fade out, and the place the cone-edge `+2`
 * acquisition-distance rule is explained.
 */
export const tooltipLines = (
  tile: TargetingTilePreview,
  maxDistance: number,
): readonly string[] => {
  if (tile.status !== "eligible") return [targetingStatusLabel(tile.status, maxDistance)];
  if (tile.resolution === "blast") return [`Blast impact · ${tile.distance} tiles`];
  const estimate = tile.estimates[0] ?? null;
  const chance = tile.chancePercent ?? estimate?.chancePercent ?? 0;
  const lines: string[] = [`${chance}% hit · ${tile.distance} tiles`];
  const damage = estimate?.damageRange ?? null;
  if (damage !== null)
    lines.push(
      `${damage.minimum}–${damage.maximum} dmg${
        damage.bulletsPerClick > 1 ? ` × ${damage.bulletsPerClick} bullets` : ""
      }`,
    );
  if (tile.fireMode === "scan" && tile.onConeBoundary)
    lines.push(`Cone edge — counts as ${tile.distance + 2} tiles for acquisition`);
  return lines;
};
