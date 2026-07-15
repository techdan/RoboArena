/**
 * Exact explosive base/mask rolls and Euclidean falloff (RE §7).
 */

import { floorEuclideanDistance } from "./geometry.js";
import type { Rng } from "./rng.js";
import type { CoverClass, TileCoord, WeaponDefinition } from "./types.js";

export interface BlastTarget {
  readonly robotId: string;
  readonly tile: TileCoord;
  /** Cover/posture class at the blast path, produced by the cover resolver. */
  readonly coverClass: CoverClass;
}

export interface BlastDamageRoll {
  readonly robotId: string;
  readonly damage: number;
  readonly radius: number;
}

export interface BlastContext {
  readonly impact: TileCoord;
  readonly weapon: WeaponDefinition;
  readonly potentialTargets: readonly BlastTarget[];
  readonly rng: Rng;
}

export const applyExplosiveCoverCut = (raw: number, coverClass: CoverClass): number => {
  if (coverClass === 1) return raw >> 1;
  if (coverClass === 2) return raw - (raw >> 2);
  if (coverClass === 3) return raw - (raw >> 3);
  return raw;
};

export const resolveBlast = ({
  impact,
  weapon,
  potentialTargets,
  rng,
}: BlastContext): BlastDamageRoll[] => {
  if (!weapon.blast) {
    throw new Error(`resolveBlast requires an explosive weapon; received ${weapon.id}`);
  }

  const rolls: BlastDamageRoll[] = [];
  for (const target of potentialTargets) {
    const radius = floorEuclideanDistance(impact, target.tile);
    const damageRoll = weapon.blast.damageAtRadius[radius];
    if (radius > weapon.blast.radius || !damageRoll) continue;
    const raw = damageRoll.base + (rng.nextUint32() & damageRoll.mask);
    rolls.push({
      robotId: target.robotId,
      radius,
      damage: applyExplosiveCoverCut(raw, target.coverClass),
    });
  }
  return rolls;
};
