/**
 * Pure initial Survival match-state construction shared by the authoritative
 * room service (`server/rooms.ts`) and the deterministic autoplay harness
 * (`src/sim/autoplay.ts`). Every robot starts docked at full armor, upright,
 * scanning East, with catalog starting ammo (`docs/spec.md` §§2-5, §9).
 */

import { ROBOT_DEFINITIONS, WEAPONS } from "../../engine/catalog";
import { ORIGINAL_TIMING_RULES_REVISION } from "../../engine/constants";
import {
  FORMATION_SETUPS,
  isSupportedFormation,
  type FormationSetup,
} from "../../engine/formations";
import type {
  Arena,
  Formation,
  GameLength,
  HomeSlot,
  MatchState,
  RobotClass,
  RobotState,
  TeamState,
  WeaponId,
} from "../../engine/types";

const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];

/** Stable robot id derived from its Team id and roster index. */
export const robotIdFor = (teamId: string, rosterIndex: number): string =>
  `${teamId}-r${rosterIndex + 1}`;

/**
 * With a formation, every robot carries its grenades (weapon mask bit 0x10 is
 * set for every class, re-map/setup.md §5.1), Missile robots get the
 * formation's missiles, and with Time Bomb armed the Team's first robot
 * carries one (seg21:0x01E5, seg21:0x02E7).
 */
export const createDockedRobot = (
  teamId: string,
  robotClass: RobotClass,
  rosterIndex: number,
  formation?: FormationSetup,
): RobotState => {
  const baseDefinition = ROBOT_DEFINITIONS[robotClass];
  const definition =
    formation !== undefined && formation.grenades > 0
      ? {
          ...baseDefinition,
          secondaryWeapons: [
            ...(baseDefinition.secondaryWeapons ?? []),
            "grenade-launcher" as const,
          ],
        }
      : baseDefinition;
  const startingAmmo = (weaponId: WeaponId): number | "unlimited" =>
    formation === undefined
      ? WEAPONS[weaponId].startingAmmo
      : weaponId === "grenade-launcher"
        ? formation.grenades
        : weaponId === "missile-launcher"
          ? formation.missiles
          : WEAPONS[weaponId].startingAmmo;
  return {
    id: robotIdFor(teamId, rosterIndex),
    teamId,
    definition,
    position: "dock",
    hp: definition.armor,
    posture: "upright",
    scanHeading: "E",
    damageStaggerActionsRemaining: 0,
    ammo: Object.fromEntries(
      WEAPON_IDS.map((weaponId) => [weaponId, startingAmmo(weaponId)]),
    ) as Readonly<Record<WeaponId, number | "unlimited">>,
    ...(formation?.timeBomb === true && rosterIndex === 0 ? { timeBombs: 1 } : {}),
  };
};

export interface SurvivalTeamSetup {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly side: TeamState["side"];
  readonly homeSlot: HomeSlot;
  readonly roster: readonly RobotClass[];
}

export const createSurvivalMatchState = (input: {
  readonly arena: Arena;
  readonly formation: Formation;
  readonly length: GameLength;
  readonly turnLengthSeconds: number;
  readonly teams: readonly SurvivalTeamSetup[];
}): MatchState => {
  const formation = isSupportedFormation(input.formation)
    ? FORMATION_SETUPS[input.formation]
    : undefined;
  return {
    config: {
      sportType: "survival",
      formation: input.formation,
      length: input.length,
      arenaType: input.arena.type,
      arenaSizeName: input.arena.sizeName,
      turnLengthSeconds: input.turnLengthSeconds,
      rulesRevision: ORIGINAL_TIMING_RULES_REVISION,
      ...(formation?.showEnemyPositions === true ? { showEnemyPositions: true as const } : {}),
      ...(formation?.zapArmed === true ? { zapArmed: true as const } : {}),
    },
    turnNumber: 1,
    teams: input.teams.map((team): TeamState => ({
      id: team.id,
      name: team.name,
      color: team.color,
      side: team.side,
      homeSlot: team.homeSlot,
      brain: "human",
      robots: team.roster.map((robotClass, index) =>
        createDockedRobot(team.id, robotClass, index, formation),
      ),
      score: 0,
    })),
    arena: input.arena,
    lastKnownMarkers: new Map(),
  };
};

/** The formation's roster for a game length (DGROUP 0x162A). */
export const formationRoster = (formation: Formation, length: GameLength): readonly RobotClass[] =>
  FORMATION_SETUPS[isSupportedFormation(formation) ? formation : "beginner"].rosters[length];
