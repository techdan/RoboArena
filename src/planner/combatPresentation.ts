/** Planner-facing firing counts and blast damage derived from the canonical catalog. */

import { WEAPON_CATALOG_DATA } from "../engine/catalogData";
import type { WeaponId } from "../engine/types";

export interface FireActionCount {
  readonly primary: string;
  readonly projectiles: string | null;
}

const counted = (count: number, singular: string, plural = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : plural}`;

/** Labels firing actions accurately: a Burst action launches three independent bullets. */
export const fireActionCount = (weapon: WeaponId, actions: number): FireActionCount => {
  const weaponData = WEAPON_CATALOG_DATA[weapon];
  if (weaponData.kind === "burst") {
    return {
      primary: counted(actions, "burst", "bursts"),
      projectiles: counted(actions * weaponData.bulletsPerClick, "bullet"),
    };
  }
  if (weapon === "missile-launcher") {
    return { primary: counted(actions, "missile"), projectiles: null };
  }
  if (weapon === "grenade-launcher") {
    return { primary: counted(actions, "grenade"), projectiles: null };
  }
  return { primary: counted(actions, "shot"), projectiles: null };
};

export interface BlastDamagePresentation {
  readonly radius: number;
  readonly bands: string;
}

export const blastDamagePresentation = (weapon: WeaponId): BlastDamagePresentation | null => {
  const blast = WEAPON_CATALOG_DATA[weapon].blast;
  if (blast === undefined) return null;
  return {
    radius: blast.radius,
    bands: blast.damageAtRadius
      .map(
        (damage, radius) =>
          `${radius === 0 ? "impact" : `radius ${radius}:`} ${damage.base}–${damage.base + damage.mask}`,
      )
      .join(" · "),
  };
};
