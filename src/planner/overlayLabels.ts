/**
 * Pure wording rules for targeting tooltips and status messages (spec §6).
 */

import type { AimPreviewStatus, TargetingTilePreview } from "./firingHelpers";

const COVER_LABELS = {
  1: "strong cover",
  2: "good cover",
  3: "partial cover",
  4: "exposed",
} as const;

const COVER_SOURCE_LABELS = {
  none: null,
  "target-bush": "target on bush",
  "adjacent-bush": "adjacent bush",
  "target-low-wall": "target on low wall",
  "adjacent-low-wall": "adjacent low wall",
} as const;

const TERRAIN_LABELS = {
  open: "Open tile",
  rough: "Rough terrain",
  "low-wall": "Low-wall terrain",
  wall: "Wall terrain",
  bush: "Bush terrain",
  crevice: "Crevice tile",
  "outer-wall": "Outer-wall terrain",
} as const;

const signed = (value: number): string => (value >= 0 ? `+${value}` : `−${Math.abs(value)}`);

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
  if (estimate !== null) {
    const source = COVER_SOURCE_LABELS[estimate.coverSource];
    const postureState = tile.authorizedContact === null ? "assumed" : "observed";
    lines.push(
      `Cover: ${COVER_LABELS[estimate.coverClass]} (score ${estimate.breakdown.coverAdjustment})${
        source === null ? "" : ` · ${source}`
      } · ${estimate.posture} ${postureState}`,
    );
    lines.push(
      `${TERRAIN_LABELS[estimate.targetTerrain]} ${
        estimate.targetTerrain === "rough" ||
        estimate.targetTerrain === "bush" ||
        estimate.targetTerrain === "low-wall"
          ? signed(estimate.breakdown.weaponTerrainAdjustment)
          : `· weapon ${signed(estimate.breakdown.weaponTerrainAdjustment)}`
      } · range ${signed(estimate.breakdown.distanceAccuracyAdjustment)}`,
    );
    if (tile.fireMode === "scan")
      lines.push(
        `Scan sight ${estimate.breakdown.scanStrength}/16 · ${
          estimate.breakdown.scanPenalty === 0
            ? "no penalty"
            : `${signed(-estimate.breakdown.scanPenalty)} score`
        }`,
      );
    else lines.push("Aim: only target and adjacent cover count");
    if (estimate.breakdown.preClampSubtotal !== estimate.breakdown.clampedScore)
      lines.push(
        `Score ${estimate.breakdown.preClampSubtotal} → ${estimate.breakdown.clampedScore} ${
          estimate.breakdown.preClampSubtotal > 19 ? "cap" : "floor"
        }${estimate.breakdown.preClampSubtotal > 19 ? " · 94% max" : ""}`,
      );
  }
  if (tile.fireMode === "scan" && tile.onConeBoundary)
    lines.push(`Cone edge — counts as ${tile.distance + 2} tiles for acquisition`);
  return lines;
};
