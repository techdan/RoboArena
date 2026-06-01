/**
 * Firing resolution: angle check → bullet path → scan-zone hit chance →
 * cover miss chance → damage roll → rough-ground vulnerability.
 *
 * Mirrors the pseudocode in `docs/spec.md` §"Combat resolution".
 *
 * Pure function: takes inputs + Rng, returns a discriminated-union result.
 * No engine-state mutation; the caller applies the result.
 */

import {
  COVER_BUSH_MISS_CHANCE,
  COVER_LOW_WALL_IN_PATH_MISS_CHANCE,
  COVER_LOW_WALL_ON_TILE_MISS_CHANCE,
  HIT_CHANCE_BLACK,
  HIT_CHANCE_GREY,
  ROUGH_GROUND_DAMAGE_MULTIPLIER,
  fullBracketProbability,
} from "./constants.js";
import {
  chebyshevDistance,
  classifyScanZone,
  tilesAlongLineExclusive,
} from "./geometry.js";
import type { Rng } from "./rng.js";
import type {
  ArenaTile,
  DamageBracket,
  Heading,
  Posture,
  TileCoord,
  WeaponDefinition,
} from "./types.js";

export type FireResolution =
  | { readonly outcome: "angle-blocked" }
  | { readonly outcome: "wall-blocked"; readonly stoppedAt: TileCoord }
  | { readonly outcome: "miss"; readonly reason: "scan-grey" | "cover" }
  | {
      readonly outcome: "hit";
      readonly damage: number;
      readonly bracket: "full" | "partial";
    };

export interface FireContext {
  readonly shooterTile: TileCoord;
  readonly shooterHeading: Heading;
  readonly targetTile: TileCoord;
  readonly targetPosture: Posture;
  readonly weapon: WeaponDefinition;
  readonly arenaTileAt: (t: TileCoord) => ArenaTile | undefined;
  readonly rng: Rng;
}

const rollDamage = (rng: Rng, bracket: DamageBracket): number =>
  rng.intInRange(bracket.min, bracket.max);

/**
 * Resolve a single bullet (or per-bullet roll for burst weapons).
 *
 * For burst weapons, the caller invokes this once per bullet; each bullet rolls
 * its own scan zone (same), wall block (same), hit chance, cover, and damage.
 */
export const resolveFire = (ctx: FireContext): FireResolution => {
  const {
    shooterTile,
    shooterHeading,
    targetTile,
    targetPosture,
    weapon,
    arenaTileAt,
    rng,
  } = ctx;

  // 1. Angle check — outside the 180° forward cone? Can't fire at all.
  const zone = classifyScanZone(shooterTile, shooterHeading, targetTile);
  if (zone === "blocked") return { outcome: "angle-blocked" };

  // 2. Range check
  const distance = chebyshevDistance(shooterTile, targetTile);
  if (distance > weapon.maxRange) return { outcome: "angle-blocked" };

  // 3. Trace bullet path; check for walls (block entirely) and low walls (in-transit cover signal)
  const pathTiles = tilesAlongLineExclusive(shooterTile, targetTile);
  let pathHasLowWall = false;
  for (const tileCoord of pathTiles) {
    const tile = arenaTileAt(tileCoord);
    if (!tile) continue;
    if (tile.terrain === "wall" || tile.terrain === "outer-wall") {
      return { outcome: "wall-blocked", stoppedAt: tileCoord };
    }
    if (tile.terrain === "low-wall") {
      pathHasLowWall = true;
    }
  }

  // 4. Scan-zone hit chance (BLACK 1.0 / GREY 0.2)
  const hitChance = zone === "black" ? HIT_CHANCE_BLACK : HIT_CHANCE_GREY;
  if (!rng.chance(hitChance)) {
    return { outcome: "miss", reason: "scan-grey" };
  }

  // 5. Cover miss chance (only applies to crouching targets).
  //    Take the max of target-tile cover and in-transit cover.
  if (targetPosture === "crouching") {
    const targetTileTerrain = arenaTileAt(targetTile)?.terrain;
    const targetTileMiss =
      targetTileTerrain === "bush"
        ? COVER_BUSH_MISS_CHANCE
        : targetTileTerrain === "low-wall"
          ? COVER_LOW_WALL_ON_TILE_MISS_CHANCE
          : 0;
    const inTransitMiss = pathHasLowWall ? COVER_LOW_WALL_IN_PATH_MISS_CHANCE : 0;
    const coverMiss = Math.max(targetTileMiss, inTransitMiss);
    if (rng.chance(coverMiss)) {
      return { outcome: "miss", reason: "cover" };
    }
  }

  // 6. Damage roll: bracket from distance, range from weapon × posture
  if (!weapon.brackets) {
    throw new Error(
      `resolveFire called for non-bullet weapon ${weapon.id}; explosives use the blast resolver instead`,
    );
  }
  const pFull = fullBracketProbability(distance);
  const bracket: "full" | "partial" = rng.chance(pFull) ? "full" : "partial";
  const range = weapon.brackets[targetPosture][bracket];
  let damage = rollDamage(rng, range);

  // 7. Rough-ground vulnerability — applies to all postures
  const targetTerrain = arenaTileAt(targetTile)?.terrain;
  if (targetTerrain === "rough") {
    damage = Math.round(damage * ROUGH_GROUND_DAMAGE_MULTIPLIER);
  }

  return { outcome: "hit", damage, bracket };
};
