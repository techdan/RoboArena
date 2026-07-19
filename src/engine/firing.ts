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
import {
  calculateDirectDamageRangeFromFactors,
  calculateLiveFireBreakdownFromFactors,
  distanceScoreAdjustment,
  type DirectDamageRange,
  type LiveFireScoreBreakdown,
} from "./liveFireMath.js";
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
  /** Damage stagger is active for this firing action (original field +0x1E). */
  readonly damageStaggered?: boolean;
  /** Selects the named accuracy table column and scan-strength penalty. Defaults to Aim & Fire. */
  readonly fireMode?: "aim" | "scan";
  /** Scan-grid sight value (0..16); Aim & Fire always passes 16. */
  readonly scanStrength?: number;
}

export interface LiveFireScoreInput {
  readonly accuracy: AccuracyTier;
  readonly distance: number;
  readonly coverClass: CoverClass;
  readonly targetTerrain: ArenaTile["terrain"] | undefined;
  readonly weapon: WeaponDefinition;
  readonly targetOnAimedTile: boolean;
  readonly damageStaggered?: boolean;
  readonly fireMode?: "aim" | "scan";
  readonly scanStrength?: number;
}

/** Exact, presentation-safe explanation of the live-fire score lookup. */
export { distanceScoreAdjustment } from "./liveFireMath.js";
export type { DirectDamageRange, LiveFireScoreBreakdown } from "./liveFireMath.js";

const terrainScoreAdjustment = (
  terrain: ArenaTile["terrain"] | undefined,
  weapon: WeaponDefinition,
  fireMode: "aim" | "scan",
): number => {
  if (terrain === "rough") return 2;
  if (terrain === "bush") return -1;
  if (terrain === "low-wall") return -3;
  const index =
    fireMode === "scan"
      ? (weapon.scanAccuracyAddIndex ?? weapon.accuracyAddIndex ?? 0)
      : (weapon.accuracyAddIndex ?? 0);
  return WEAPON_ACCURACY_ADDS[index];
};

export const calculateLiveFireScoreBreakdown = (
  input: LiveFireScoreInput,
): LiveFireScoreBreakdown => {
  const accuracyBase = input.accuracy + 4;
  const fireMode = input.fireMode ?? "aim";
  const scanStrength = fireMode === "scan" ? (input.scanStrength ?? 16) : 16;
  const coverAdjustment = COVER_CLASS_HIT_SCORE[input.coverClass];
  const distanceAccuracyAdjustment = distanceScoreAdjustment(input.distance, accuracyBase);
  const weaponTerrainAdjustment = terrainScoreAdjustment(
    input.targetTerrain,
    input.weapon,
    fireMode,
  );
  const damageStaggered = input.damageStaggered === true;
  return calculateLiveFireBreakdownFromFactors({
    fireMode,
    coverAdjustment,
    distanceAccuracyAdjustment,
    weaponTerrainAdjustment,
    scanStrength,
    damageStaggered,
    targetOnAimedTile: input.targetOnAimedTile,
    hitThresholds: LIVE_FIRE_HIT_THRESHOLDS,
  });
};

export const calculateLiveFireScore = (input: LiveFireScoreInput): number =>
  calculateLiveFireScoreBreakdown(input).finalScore;

/** Exact direct-fire damage range before the authoritative RNG roll. */
export const calculateDirectDamageRange = (input: {
  readonly weapon: WeaponDefinition;
  readonly coverClass: CoverClass;
  readonly distance: number;
}): DirectDamageRange | null => {
  const damageRoll = input.weapon.damageRoll;
  if (damageRoll === undefined) return null;
  const rawMinimum = damageRoll.base;
  const rawMaximum = damageRoll.base + damageRoll.mask;
  const coverAdjustment = COVER_CLASS_BULLET_DAMAGE_ADJUST[input.coverClass];
  const distanceAdjustment = input.distance > 12 ? -4 : input.distance < 5 ? 4 : 0;
  return calculateDirectDamageRangeFromFactors({
    rawMinimum,
    rawMaximum,
    coverAdjustment,
    distanceAdjustment,
    bulletsPerClick: input.weapon.bulletsPerClick,
  });
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
    ...(ctx.damageStaggered === undefined ? {} : { damageStaggered: ctx.damageStaggered }),
    ...(ctx.fireMode === undefined ? {} : { fireMode: ctx.fireMode }),
    ...(ctx.scanStrength === undefined ? {} : { scanStrength: ctx.scanStrength }),
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
