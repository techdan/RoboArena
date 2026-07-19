/**
 * Pure wording rules for targeting tooltips and status messages (spec §6).
 */

import type { AimPreviewStatus, TargetingTilePreview } from "./firingHelpers";

/**
 * Plain-language blocked-status wording shared by the cursor tooltip and
 * targeting UI so the same state is never named multiple ways.
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
 * Compact cursor-tooltip lines for the hovered tile, including the cone-edge
 * `+2` acquisition-distance rule.
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
