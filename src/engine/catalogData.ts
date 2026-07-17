/** Dependency-free canonical catalog data shared by engine composition and browser reference UI. */

import type { RobotClass, RobotDefinition, WeaponDefinition, WeaponId } from "./types.js";

type WeaponCatalogData = Omit<
  WeaponDefinition,
  "id" | "firingIntervalTicks" | "scanFiringIntervalTicks" | "maxRange"
>;

export const WEAPON_CATALOG_DATA: Readonly<Record<WeaponId, WeaponCatalogData>> = {
  rifle: {
    displayName: "Rifle",
    kind: "bullet",
    bulletsPerClick: 1,
    startingAmmo: "unlimited",
    damageRoll: { base: 10, mask: 7 },
    accuracyAddIndex: 0,
    scanAccuracyAddIndex: 1,
  },
  "burst-gun": {
    displayName: "Burst Gun",
    kind: "burst",
    bulletsPerClick: 3,
    startingAmmo: "unlimited",
    damageRoll: { base: 8, mask: 15 },
    accuracyAddIndex: 3,
    scanAccuracyAddIndex: 4,
  },
  "auto-rifle": {
    displayName: "Machine Gun",
    kind: "bullet",
    bulletsPerClick: 1,
    startingAmmo: "unlimited",
    damageRoll: { base: 6, mask: 15 },
    accuracyAddIndex: 6,
    scanAccuracyAddIndex: 7,
  },
  "missile-launcher": {
    displayName: "Missile Launcher",
    kind: "explosive",
    bulletsPerClick: 1,
    startingAmmo: 3,
    blast: {
      radius: 2,
      damageAtRadius: [
        { base: 60, mask: 31 },
        { base: 40, mask: 15 },
        { base: 10, mask: 7 },
      ],
    },
  },
  "grenade-launcher": {
    displayName: "Grenade Launcher",
    kind: "explosive",
    bulletsPerClick: 1,
    startingAmmo: 0,
    blast: {
      radius: 2,
      damageAtRadius: [
        { base: 45, mask: 31 },
        { base: 25, mask: 15 },
        { base: 5, mask: 7 },
      ],
    },
  },
};

export const ROBOT_CATALOG_DATA: Readonly<Record<RobotClass, RobotDefinition>> = {
  rifle: { class: "rifle", accuracy: 2, armor: 140, rating: 40, primaryWeapon: "rifle" },
  burst: { class: "burst", accuracy: 1, armor: 120, rating: 50, primaryWeapon: "burst-gun" },
  auto: { class: "auto", accuracy: 0, armor: 100, rating: 60, primaryWeapon: "auto-rifle" },
  missile: {
    class: "missile",
    accuracy: 1,
    armor: 100,
    rating: 80,
    primaryWeapon: "missile-launcher",
    secondaryWeapons: ["rifle"],
  },
  stealth: {
    class: "stealth",
    accuracy: 1,
    armor: 120,
    rating: 100,
    primaryWeapon: "burst-gun",
    stealthVisibility: "stealth",
  },
};
