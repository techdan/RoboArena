/**
 * Posture/terrain cover classification from RoboSport's seg87 trace (RE §15).
 *
 * Line-of-sight blocking follows the center path. Cover itself is local to the
 * target endpoint: the target tile, the major-axis neighbor toward the shooter,
 * and—only for exact or near diagonals—the corner neighbor toward the shooter.
 */

import { tilesAlongLineExclusive } from "./geometry.js";
import type { ArenaTile, CoverClass, Posture, Terrain, TileCoord } from "./types.js";

export type CoverResolution =
  | { readonly outcome: "blocked"; readonly stoppedAt: TileCoord }
  | { readonly outcome: "cover"; readonly coverClass: CoverClass };

const terrainHeight = (terrain: Terrain): 2 | 3 | 4 => {
  if (terrain === "low-wall") return 3;
  if (terrain === "wall" || terrain === "outer-wall") return 4;
  return 2;
};

const coverClassForEffectiveHeight = (
  posture: Posture,
  effectiveHeight: 2 | 3,
  hasBush: boolean,
): CoverClass => {
  if (effectiveHeight === 3) {
    return posture === "upright" ? 3 : posture === "ducking" ? 2 : 1;
  }
  if (hasBush) {
    return posture === "upright" ? 4 : posture === "ducking" ? 3 : 2;
  }
  return posture === "crouching" ? 3 : 4;
};

export const coverClassForTerrain = (
  posture: Posture,
  terrain: Terrain,
): CoverClass | "blocked" => {
  if (terrain === "wall" || terrain === "outer-wall") return "blocked";
  return coverClassForEffectiveHeight(posture, terrain === "low-wall" ? 3 : 2, terrain === "bush");
};

interface EndpointSamples {
  readonly center: TileCoord;
  readonly major?: TileCoord;
  readonly diagonal?: TileCoord;
}

/** Exact target-end sampling produced by seg87:0x1BF8 → 0x1CE0. */
export const targetCoverSamples = (from: TileCoord, to: TileCoord): EndpointSamples => {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const distance = Math.max(dx, dy);
  if (distance === 0) return { center: to };

  const stepX = Math.sign(from.x - to.x);
  const stepY = Math.sign(from.y - to.y);
  const xMajor = dx > dy; // Ties are y-major in the original.
  const major =
    distance >= 2
      ? xMajor
        ? { x: to.x + stepX, y: to.y }
        : { x: to.x, y: to.y + stepY }
      : undefined;
  const diagonal =
    distance > 1 && Math.abs(dx - dy) < 2 ? { x: to.x + stepX, y: to.y + stepY } : undefined;

  return {
    center: to,
    ...(major === undefined ? {} : { major }),
    ...(diagonal === undefined ? {} : { diagonal }),
  };
};

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

  // The separate LoS gate rejects complete walls anywhere on the center path.
  for (const tileCoord of [...tilesAlongLineExclusive(from, to), to]) {
    const terrain = arenaTileAt(tileCoord)?.terrain;
    if (terrain === "wall" || terrain === "outer-wall") {
      return { outcome: "blocked", stoppedAt: tileCoord };
    }
  }

  const samples = targetCoverSamples(from, to);
  const centerTerrain = arenaTileAt(samples.center)?.terrain ?? "open";
  const centerHeight = terrainHeight(centerTerrain);
  const majorTerrain =
    samples.major === undefined ? undefined : arenaTileAt(samples.major)?.terrain;
  const diagonalTerrain =
    samples.diagonal === undefined ? undefined : arenaTileAt(samples.diagonal)?.terrain;

  let effectiveHeight: 2 | 3 = centerHeight === 3 ? 3 : 2;
  if (majorTerrain !== undefined) {
    const height = terrainHeight(majorTerrain);
    if (height > centerHeight && height !== 4) effectiveHeight = 3;
  }
  if (effectiveHeight === 2 && diagonalTerrain !== undefined) {
    const height = terrainHeight(diagonalTerrain);
    if (height > centerHeight && height !== 4) effectiveHeight = 3;
  }

  const hasBush = centerTerrain === "bush" || majorTerrain === "bush" || diagonalTerrain === "bush";
  return {
    outcome: "cover",
    coverClass: coverClassForEffectiveHeight(targetPosture, effectiveHeight, hasBush),
  };
};
