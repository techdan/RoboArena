/**
 * Original Quick Start formation setups (re-map/setup.md §1.2-1.3).
 *
 * Rosters come from the formation × length table at DGROUP 0x162A (reader
 * seg61:0x02A7); per-formation extra weapons and flags from
 * seg61:0x02A7..0x03A3. RoboArena offers Beginner and Standard.
 */

import type { Formation, GameLength, RobotClass } from "./types.js";

export type SupportedFormation = Extract<Formation, "beginner" | "standard">;

export const SUPPORTED_FORMATIONS: readonly SupportedFormation[] = ["beginner", "standard"];

export interface FormationSetup {
  /** Grenades per robot, options `+0x28` (`[4126]`). */
  readonly grenades: number;
  /** Missiles per Missile robot, options `+0x2A` (`[4124]`). */
  readonly missiles: number;
  /** Zap armed, options byte `+0x2C` (`[4123]`). */
  readonly zapArmed: boolean;
  /** Time Bomb armed, options byte `+0x2D` (`[4122]`): one per Team. */
  readonly timeBomb: boolean;
  /** Options `+0x1A` bit 0x01: `0x38|7` for Beginner, `0x38|2` otherwise. */
  readonly showEnemyPositions: boolean;
  /** Robots per Team in creation order (seg61:0x0904..0x0A58: Rifle, Burst, Auto, Missile). */
  readonly rosters: Readonly<Record<GameLength, readonly RobotClass[]>>;
}

/** Expands Rifle/Burst/Auto/Missile counts in the original creation order. */
const roster = (rifle: number, burst: number, auto: number, missile: number): RobotClass[] => [
  ...Array<RobotClass>(rifle).fill("rifle"),
  ...Array<RobotClass>(burst).fill("burst"),
  ...Array<RobotClass>(auto).fill("auto"),
  ...Array<RobotClass>(missile).fill("missile"),
];

export const FORMATION_SETUPS: Readonly<Record<SupportedFormation, FormationSetup>> = {
  beginner: {
    grenades: 0,
    missiles: 3,
    zapArmed: false,
    timeBomb: false,
    showEnemyPositions: true,
    rosters: {
      skirmish: roster(1, 0, 1, 0),
      melee: roster(1, 1, 1, 1),
      battle: roster(2, 2, 1, 1),
      campaign: roster(3, 2, 2, 1),
    },
  },
  standard: {
    grenades: 3,
    missiles: 3,
    zapArmed: true,
    timeBomb: true,
    showEnemyPositions: false,
    rosters: {
      skirmish: roster(1, 0, 1, 0),
      melee: roster(1, 1, 1, 1),
      battle: roster(2, 1, 2, 1),
      campaign: roster(2, 2, 2, 2),
    },
  },
};

export const isSupportedFormation = (formation: Formation): formation is SupportedFormation =>
  (SUPPORTED_FORMATIONS as readonly Formation[]).includes(formation);
