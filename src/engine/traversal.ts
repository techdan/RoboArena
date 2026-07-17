/** Browser-safe terrain traversal predicates shared by engine and planner.
 * Sourced from `docs/spec.md` §5 Movement. */

import type { ArenaTile, Posture, Terrain } from "./types.js";

/** TIL movement property 2: eligible to participate in a two-tile command. */
export const isFullSpeedTerrain = (terrain: Terrain): boolean => terrain === "open";

export const isFullSpeedTile = (tile: ArenaTile): boolean => isFullSpeedTerrain(tile.terrain);

/** Upright/Ducking traverse passable terrain; Crouching may enter only Open Ground. */
export const canTraverse = (posture: Posture, terrain: Terrain): boolean => {
  if (terrain === "wall" || terrain === "outer-wall" || terrain === "crevice") return false;
  return posture !== "crouching" || terrain === "open";
};

export const canTraverseTile = (posture: Posture, tile: ArenaTile): boolean =>
  canTraverse(posture, tile.terrain);
