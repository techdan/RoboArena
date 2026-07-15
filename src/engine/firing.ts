/**
 * Direct-fire resolution from RoboSport's live resolver (RE §7b/§15).
 *
 * Hit and damage are rolled at fire time. Projectile travel may delay applying
 * the pre-rolled result, but it never rerolls or enables in-flight dodging.
 */

import {
  COVER_CLASS_BULLET_DAMAGE_ADJUST,
  COVER_CLASS_HIT_SCORE,
  LIVE_FIRE_HIT_THRESHOLDS,
  WEAPON_ACCURACY_ADDS,
} from "./constants.js";
import { resolveCover } from "./cover.js";
import { floorEuclideanDistance, isWithinScanCone } from "./geometry.js";
import type { Rng } from "./rng.js";
import type {
  AccuracyTier,
  ArenaTile,
  CoverClass,
  Heading,
  Posture,
  TileCoord,
  WeaponDefinition,
} from "./types.js";

export type FireResolution =
  | { readonly outcome: "out-of-range"; readonly distance: number }
  | { readonly outcome: "angle-blocked" }
  | { readonly outcome: "sight-blocked"; readonly stoppedAt: TileCoord }
  | {
      readonly outcome: "miss";
      readonly score: number;
      readonly threshold: number;
      readonly coverClass: CoverClass;
    }
  | {
      readonly outcome: "hit";
      readonly damage: number;
      readonly score: number;
      readonly threshold: number;
      readonly coverClass: CoverClass;
    };

export interface FireContext {
  readonly shooterTile: TileCoord;
  readonly shooterHeading: Heading;
  readonly shooterAccuracy: AccuracyTier;
  /** Fixed tile selected by Aim & Fire. */
  readonly aimedTile: TileCoord;
  /** Target robot's actual tile when the command resolves. */
  readonly targetTile: TileCoord;
  readonly targetPosture: Posture;
  readonly weapon: WeaponDefinition;
  readonly arenaTileAt: (tile: TileCoord) => ArenaTile | undefined;
  readonly rng: Rng;
  /** PROVISIONAL RE §20 #2: unresolved first score-halving modifier. */
  readonly additionalHalving?: boolean;
}

const clampScore = (score: number): number => Math.max(0, Math.min(19, score));

export const distanceScoreAdjustment = (distance: number, accuracyBase: number): number => {
  if (distance > 12) return Math.floor(accuracyBase / 2) - 4;
  if (distance >= 7) return accuracyBase - 2;
  if (distance >= 3) return Math.floor(accuracyBase / 2) + (6 - distance);
  return accuracyBase + 2 * (3 - distance) + 2;
};

const terrainScoreAdjustment = (
  terrain: ArenaTile["terrain"] | undefined,
  weapon: WeaponDefinition,
): number => {
  if (terrain === "rough") return 2;
  if (terrain === "bush") return -1;
  if (terrain === "low-wall") return -3;
  const index = weapon.accuracyAddIndex ?? 0;
  return WEAPON_ACCURACY_ADDS[index];
};

export const calculateLiveFireScore = (input: {
  readonly accuracy: AccuracyTier;
  readonly distance: number;
  readonly coverClass: CoverClass;
  readonly targetTerrain: ArenaTile["terrain"] | undefined;
  readonly weapon: WeaponDefinition;
  readonly targetOnAimedTile: boolean;
  readonly additionalHalving?: boolean;
}): number => {
  const accuracyBase = input.accuracy + 4;
  let score =
    COVER_CLASS_HIT_SCORE[input.coverClass] +
    distanceScoreAdjustment(input.distance, accuracyBase) +
    terrainScoreAdjustment(input.targetTerrain, input.weapon);

  // The original also subtracts an unresolved posture/scan argument. Omitted
  // intentionally until RE §20 #2 is decoded.
  score = clampScore(score);
  if (input.additionalHalving) score >>= 1;
  if (!input.targetOnAimedTile) score >>= 1;
  return score;
};

const rollDirectDamage = (
  rng: Rng,
  weapon: WeaponDefinition,
  coverClass: CoverClass,
  distance: number,
): number => {
  if (!weapon.damageRoll) {
    throw new Error(`resolveFire requires a direct-fire weapon; received ${weapon.id}`);
  }
  const raw = weapon.damageRoll.base + (rng.nextUint32() & weapon.damageRoll.mask);
  const distanceAdjust = distance > 12 ? -4 : distance < 5 ? 4 : 0;
  return Math.max(0, raw + COVER_CLASS_BULLET_DAMAGE_ADJUST[coverClass] + distanceAdjust);
};

export const resolveFire = (ctx: FireContext): FireResolution => {
  const distance = floorEuclideanDistance(ctx.shooterTile, ctx.aimedTile);
  if (distance > ctx.weapon.maxRange) {
    return { outcome: "out-of-range", distance };
  }
  if (!isWithinScanCone(ctx.shooterTile, ctx.shooterHeading, ctx.aimedTile)) {
    return { outcome: "angle-blocked" };
  }

  const cover = resolveCover({
    from: ctx.shooterTile,
    to: ctx.aimedTile,
    targetPosture: ctx.targetPosture,
    arenaTileAt: ctx.arenaTileAt,
  });
  if (cover.outcome === "blocked") {
    return { outcome: "sight-blocked", stoppedAt: cover.stoppedAt };
  }

  const targetTerrain = ctx.arenaTileAt(ctx.targetTile)?.terrain;
  const score = calculateLiveFireScore({
    accuracy: ctx.shooterAccuracy,
    distance,
    coverClass: cover.coverClass,
    targetTerrain,
    weapon: ctx.weapon,
    targetOnAimedTile: ctx.aimedTile.x === ctx.targetTile.x && ctx.aimedTile.y === ctx.targetTile.y,
    ...(ctx.additionalHalving === undefined ? {} : { additionalHalving: ctx.additionalHalving }),
  });
  const threshold = LIVE_FIRE_HIT_THRESHOLDS[score] ?? 0;
  const roll = ctx.rng.nextUint32() & 0xff;
  if (roll >= threshold) {
    return { outcome: "miss", score, threshold, coverClass: cover.coverClass };
  }

  return {
    outcome: "hit",
    damage: rollDirectDamage(ctx.rng, ctx.weapon, cover.coverClass, distance),
    score,
    threshold,
    coverClass: cover.coverClass,
  };
};
