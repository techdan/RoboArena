/**
 * Canonical robot and weapon catalogs.
 *
 * Armor/accuracy and raw damage/blast rolls are binary-confirmed (RE §5/§7).
 * Named weapon→selector cadence mapping remains PROVISIONAL RE §20 #1/#10 and
 * is isolated in this file.
 */

import { WEAPON_MAX_RANGE } from "./constants.js";
import type { RobotClass, RobotDefinition, WeaponDefinition, WeaponId } from "./types.js";

export const WEAPONS: Readonly<Record<WeaponId, WeaponDefinition>> = {
  rifle: {
    id: "rifle",
    displayName: "Rifle",
    kind: "bullet",
    bulletsPerClick: 1,
    firingIntervalTicks: 30, // PROVISIONAL selector mapping, RE §20 #1/#10
    maxRange: WEAPON_MAX_RANGE,
    startingAmmo: "unlimited",
    damageRoll: { base: 10, mask: 7 },
    accuracyAddIndex: 0, // PROVISIONAL RE §20 #1
  },
  "burst-gun": {
    id: "burst-gun",
    displayName: "Burst Gun",
    kind: "burst",
    bulletsPerClick: 3,
    firingIntervalTicks: 10, // PROVISIONAL selector mapping, RE §20 #1/#10
    maxRange: WEAPON_MAX_RANGE,
    startingAmmo: "unlimited",
    damageRoll: { base: 6, mask: 15 },
    accuracyAddIndex: 0, // PROVISIONAL RE §20 #1
  },
  "auto-rifle": {
    id: "auto-rifle",
    displayName: "Machine Gun",
    kind: "bullet",
    bulletsPerClick: 1,
    firingIntervalTicks: 20, // PROVISIONAL RE §20 #1/#10: candidates use 15/20
    maxRange: WEAPON_MAX_RANGE,
    startingAmmo: "unlimited",
    damageRoll: { base: 8, mask: 15 },
    accuracyAddIndex: 0, // PROVISIONAL RE §20 #1
  },
  "missile-launcher": {
    id: "missile-launcher",
    displayName: "Missile Launcher",
    kind: "explosive",
    bulletsPerClick: 1,
    firingIntervalTicks: 20, // PROVISIONAL selector mapping, RE §20 #1/#10
    maxRange: WEAPON_MAX_RANGE,
    startingAmmo: 3,
    accuracyAddIndex: 0, // PROVISIONAL RE §20 #1
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
    id: "grenade-launcher",
    displayName: "Grenade Launcher",
    kind: "explosive",
    bulletsPerClick: 1,
    firingIntervalTicks: 20, // PROVISIONAL selector mapping, RE §20 #1/#10
    maxRange: WEAPON_MAX_RANGE,
    startingAmmo: 3, // PROVISIONAL RE §20 #18
    accuracyAddIndex: 0, // PROVISIONAL RE §20 #1
    blast: {
      // Category 0 label is PROVISIONAL RE §20 #17.
      radius: 2,
      damageAtRadius: [
        { base: 45, mask: 31 },
        { base: 25, mask: 15 },
        { base: 5, mask: 7 },
      ],
    },
  },
};

export const ROBOT_DEFINITIONS: Readonly<Record<RobotClass, RobotDefinition>> = {
  rifle: {
    class: "rifle",
    accuracy: 2,
    armor: 140,
    rating: 40,
    primaryWeapon: "rifle",
  },
  burst: {
    class: "burst",
    accuracy: 1,
    armor: 120,
    rating: 50,
    primaryWeapon: "burst-gun",
  },
  auto: {
    class: "auto",
    accuracy: 0,
    armor: 100,
    rating: 60,
    primaryWeapon: "auto-rifle",
  },
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

export const DEFAULT_ROSTER_BY_LENGTH: Readonly<
  Record<"skirmish" | "melee" | "battle" | "campaign", readonly RobotClass[]>
> = {
  skirmish: ["rifle", "burst"],
  melee: ["rifle", "burst", "auto", "missile"],
  battle: ["rifle", "rifle", "burst", "burst", "auto", "missile"],
  campaign: ["rifle", "rifle", "rifle", "burst", "burst", "auto", "auto", "missile"],
};
