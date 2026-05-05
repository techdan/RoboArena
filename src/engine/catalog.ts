/**
 * Canonical robot-class and weapon catalogs. Numbers come straight from the
 * point-buy table in the in-game team builder + empirical damage tests.
 *
 * Source of truth: `docs/initial-plan.md` §"Engine constants" & §"Weapons".
 */

import { secondsToTicks, WEAPON_MAX_RANGE } from "./constants.js";
import type {
  RobotClass,
  RobotDefinition,
  WeaponDefinition,
  WeaponId,
} from "./types.js";

// ──────────────────────────────────────────────────────────────────────────
// Weapons

/** v1 weapon catalog. Brackets and timings from Match 1-7 empirical data. */
export const WEAPONS: Readonly<Record<WeaponId, WeaponDefinition>> = {
  rifle: {
    id: "rifle",
    displayName: "Rifle",
    kind: "bullet",
    bulletsPerClick: 1,
    firingIntervalTicks: [secondsToTicks(0.7), secondsToTicks(0.3)],
    maxRange: WEAPON_MAX_RANGE,
    startingAmmo: "unlimited",
    brackets: {
      standing: {
        full: { min: 18, max: 25 },
        partial: { min: 10, max: 17 },
      },
      crouching: {
        // ~25% lower across the board; user data showed 10-13 typical at d=6-7
        full: { min: 14, max: 21 },
        partial: { min: 7, max: 13 },
      },
    },
  },

  "burst-gun": {
    id: "burst-gun",
    displayName: "Burst Gun",
    kind: "burst",
    bulletsPerClick: 3,
    firingIntervalTicks: [secondsToTicks(0.15), secondsToTicks(0.55)],
    maxRange: WEAPON_MAX_RANGE,
    startingAmmo: "unlimited",
    brackets: {
      // Per-bullet brackets; engine rolls 3 independent hit + bracket rolls per click
      standing: {
        full: { min: 7, max: 10 },
        partial: { min: 3, max: 6 },
      },
      crouching: {
        full: { min: 5, max: 8 },
        partial: { min: 2, max: 5 },
      },
    },
  },

  "auto-rifle": {
    id: "auto-rifle",
    displayName: "Machine Gun", // in-game label; manual calls it "Automatic Rifle"
    kind: "bullet",
    bulletsPerClick: 1,
    // TBD by future test; assumed similar to Rifle for now
    firingIntervalTicks: [secondsToTicks(0.7), secondsToTicks(0.3)],
    maxRange: WEAPON_MAX_RANGE,
    startingAmmo: "unlimited",
    brackets: {
      // Match 1+3 Auto: 14-31 wide spread at point-blank
      standing: {
        full: { min: 18, max: 25 },
        partial: { min: 10, max: 17 },
      },
      crouching: {
        full: { min: 14, max: 21 },
        partial: { min: 7, max: 13 },
      },
    },
  },

  "missile-launcher": {
    id: "missile-launcher",
    displayName: "Missile Launcher",
    kind: "explosive",
    bulletsPerClick: 1, // explosives don't burst; one missile per click
    // TBD; ~0.7/0.3 strawman from heavier weapon assumption
    firingIntervalTicks: [secondsToTicks(0.7), secondsToTicks(0.3)],
    maxRange: WEAPON_MAX_RANGE,
    startingAmmo: 3,
    blast: {
      radius: 2, // Match 2: r=3 always 0 damage
      damageAtRadius: [
        { min: 55, max: 80 }, // r=0 direct hit (avg ~70)
        { min: 40, max: 60 }, // r=1 (avg ~50)
        { min: 13, max: 17 }, // r=2 edge (avg ~15)
      ],
    },
  },

  "grenade-launcher": {
    id: "grenade-launcher",
    displayName: "Grenade Launcher",
    kind: "explosive",
    bulletsPerClick: 1,
    firingIntervalTicks: [secondsToTicks(0.7), secondsToTicks(0.3)],
    maxRange: WEAPON_MAX_RANGE,
    startingAmmo: 3,
    blast: {
      // Default: ~80% of Missile damages. Tunable in playtest.
      radius: 2,
      damageAtRadius: [
        { min: 44, max: 64 },
        { min: 32, max: 48 },
        { min: 10, max: 14 },
      ],
    },
  },
};

// ──────────────────────────────────────────────────────────────────────────
// Robot classes (point-buy table)

/** v1 robot catalog. Stats from the B&W Mac Custom Game team builder. */
export const ROBOT_DEFINITIONS: Readonly<Record<RobotClass, RobotDefinition>> = {
  rifle: {
    class: "rifle",
    accuracy: "high",
    armor: 140,
    rating: 40,
    primaryWeapon: "rifle",
  },
  burst: {
    class: "burst",
    accuracy: "medium",
    armor: 120,
    rating: 50,
    primaryWeapon: "burst-gun",
  },
  auto: {
    class: "auto",
    accuracy: "low",
    armor: 100,
    rating: 60,
    primaryWeapon: "auto-rifle",
  },
  missile: {
    class: "missile",
    accuracy: "medium",
    armor: 100,
    rating: 80,
    primaryWeapon: "missile-launcher",
    secondaryWeapons: ["rifle"], // manual: "Missile Robots also carry rifles"
  },
  stealth: {
    class: "stealth",
    accuracy: "medium",
    armor: 120,
    rating: 100,
    primaryWeapon: "burst-gun",
    stealthVisibility: "stealth", // invisible unless moving or scanned from adjacent
  },
};

/** Default Quick Start rosters by Game Length (Beginner formation). */
export const DEFAULT_ROSTER_BY_LENGTH: Readonly<
  Record<"skirmish" | "melee" | "battle" | "campaign", readonly RobotClass[]>
> = {
  // Skirmish: 2 robots — TBD; sensible default
  skirmish: ["rifle", "burst"],
  melee: ["rifle", "burst", "auto", "missile"],
  battle: ["rifle", "rifle", "burst", "burst", "auto", "missile"],
  campaign: ["rifle", "rifle", "rifle", "burst", "burst", "auto", "auto", "missile"],
};
