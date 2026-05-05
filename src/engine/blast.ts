/**
 * Blast resolution for explosive weapons (Missile, Grenade).
 *
 * From `docs/initial-plan.md` §"Engine constants — v1 canonical stats" §Weapons:
 *   Missile blast curve: r=0 ≈ 70, r=1 ≈ 50, r=2 ≈ 15, r≥3 = 0.
 *   blastRadius = 2 (Chebyshev / king-move).
 *
 * Friendly-fire rule: explosives damage all robots in radius regardless of team
 * (manual: "Missiles (and other explosives) can [harm friendlies]"). Bullets do not.
 *
 * Pure function — caller maps the result onto match state.
 */

import { chebyshevDistance } from "./geometry.js";
import type { Rng } from "./rng.js";
import type { TileCoord, WeaponDefinition } from "./types.js";

export interface BlastTarget {
  readonly robotId: string;
  readonly tile: TileCoord;
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

/**
 * Returns one damage roll per robot that fell within the blast radius.
 * Robots outside the radius are filtered out (no zero-damage rolls).
 */
export const resolveBlast = ({
  impact,
  weapon,
  potentialTargets,
  rng,
}: BlastContext): BlastDamageRoll[] => {
  if (!weapon.blast) {
    throw new Error(
      `resolveBlast called for non-explosive weapon ${weapon.id}; bullets use resolveFire instead`,
    );
  }

  const { damageAtRadius, radius: maxRadius } = weapon.blast;
  const rolls: BlastDamageRoll[] = [];

  for (const target of potentialTargets) {
    const radius = chebyshevDistance(impact, target.tile);
    if (radius > maxRadius) continue;
    const bracket = damageAtRadius[radius];
    if (!bracket) continue; // defensive — should not happen if catalog is well-formed
    const damage = rng.intInRange(bracket.min, bracket.max);
    rolls.push({ robotId: target.robotId, damage, radius });
  }

  return rolls;
};
