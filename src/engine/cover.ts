/**
 * Posture/terrain cover classification from RoboSport's seg87 trace (RE §15).
 *
 * The final mapping is exact. The original also samples beside some diagonal
 * Bresenham steps; this v1 path sampler uses the center line only and is marked
 * PROVISIONAL RE §20 #3 at that boundary.
 */

import { tilesAlongLineExclusive } from "./geometry.js";
import type { ArenaTile, CoverClass, Posture, Terrain, TileCoord } from "./types.js";

export type CoverResolution =
  | { readonly outcome: "blocked"; readonly stoppedAt: TileCoord }
  | { readonly outcome: "cover"; readonly coverClass: CoverClass };

const terrainCoverClass = (posture: Posture, terrain: Terrain): CoverClass | "blocked" => {
  if (terrain === "wall" || terrain === "outer-wall") return "blocked";

  if (terrain === "low-wall") {
    return posture === "upright" ? 3 : posture === "ducking" ? 2 : 1;
  }

  if (terrain === "bush") {
    return posture === "upright" ? 4 : posture === "ducking" ? 3 : 2;
  }

  return posture === "crouching" ? 3 : 4;
};

export const coverClassForTerrain = (posture: Posture, terrain: Terrain): CoverClass | "blocked" =>
  terrainCoverClass(posture, terrain);

export const resolveCover = (input: {
  readonly from: TileCoord;
  readonly to: TileCoord;
  readonly targetPosture: Posture;
  readonly arenaTileAt: (tile: TileCoord) => ArenaTile | undefined;
}): CoverResolution => {
  const { from, to, targetPosture, arenaTileAt } = input;
  if (from.x === to.x && from.y === to.y) {
    return { outcome: "cover", coverClass: 4 };
  }

  let coverClass: CoverClass = 4;
  // Include the target tile: bushes protect robots directly on them.
  const sampledTiles = [...tilesAlongLineExclusive(from, to), to];

  for (const tileCoord of sampledTiles) {
    const tile = arenaTileAt(tileCoord);
    if (!tile) continue;
    const sampled = terrainCoverClass(targetPosture, tile.terrain);
    if (sampled === "blocked") {
      return { outcome: "blocked", stoppedAt: tileCoord };
    }
    coverClass = Math.min(coverClass, sampled) as CoverClass;
  }

  return { outcome: "cover", coverClass };
};
