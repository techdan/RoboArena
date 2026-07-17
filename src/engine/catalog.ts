/**
 * Canonical robot and weapon catalogs.
 *
 * Armor/accuracy, raw damage/blast rolls, and named command-selector mappings
 * are binary-confirmed (RE §5/§7/§19).
 */

import { WEAPON_MAX_RANGE, WEAPON_TIMING } from "./constants.js";
import type { RobotClass, RobotDefinition, WeaponDefinition, WeaponId } from "./types.js";
import { ROBOT_CATALOG_DATA, WEAPON_CATALOG_DATA } from "./catalogData.js";

export const WEAPONS: Readonly<Record<WeaponId, WeaponDefinition>> = {
  rifle: {
    id: "rifle",
    ...WEAPON_CATALOG_DATA.rifle,
    ...WEAPON_TIMING.rifle,
    maxRange: WEAPON_MAX_RANGE,
  },
  "burst-gun": {
    id: "burst-gun",
    ...WEAPON_CATALOG_DATA["burst-gun"],
    ...WEAPON_TIMING["burst-gun"],
    maxRange: WEAPON_MAX_RANGE,
  },
  "auto-rifle": {
    id: "auto-rifle",
    ...WEAPON_CATALOG_DATA["auto-rifle"],
    ...WEAPON_TIMING["auto-rifle"],
    maxRange: WEAPON_MAX_RANGE,
  },
  "missile-launcher": {
    id: "missile-launcher",
    ...WEAPON_CATALOG_DATA["missile-launcher"],
    ...WEAPON_TIMING["missile-launcher"],
    maxRange: WEAPON_MAX_RANGE,
  },
  "grenade-launcher": {
    id: "grenade-launcher",
    ...WEAPON_CATALOG_DATA["grenade-launcher"],
    ...WEAPON_TIMING["grenade-launcher"],
    maxRange: WEAPON_MAX_RANGE,
  },
};

export const ROBOT_DEFINITIONS: Readonly<Record<RobotClass, RobotDefinition>> = ROBOT_CATALOG_DATA;

export const DEFAULT_ROSTER_BY_LENGTH: Readonly<
  Record<"skirmish" | "melee" | "battle" | "campaign", readonly RobotClass[]>
> = {
  skirmish: ["rifle", "burst"],
  melee: ["rifle", "burst", "auto", "missile"],
  battle: ["rifle", "rifle", "burst", "burst", "auto", "missile"],
  campaign: ["rifle", "rifle", "rifle", "burst", "burst", "auto", "auto", "missile"],
};
