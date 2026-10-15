/**
 * Pure initial Survival match-state construction shared by the authoritative
 * room service (`server/rooms.ts`) and the deterministic autoplay harness
 * (`src/sim/autoplay.ts`). Every robot starts docked at full armor, upright,
 * scanning East, with catalog starting ammo (`docs/spec.md` §§2-5, §9).
 */

import { ROBOT_DEFINITIONS, WEAPONS } from "../../engine/catalog";
import { ORIGINAL_SPOTTING_RULES_REVISION } from "../../engine/constants";
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

export const createDockedRobot = (
  teamId: string,
  robotClass: RobotClass,
  rosterIndex: number,
): RobotState => {
  const definition = ROBOT_DEFINITIONS[robotClass];
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
      WEAPON_IDS.map((weaponId) => [weaponId, WEAPONS[weaponId].startingAmmo]),
    ) as Readonly<Record<WeaponId, number | "unlimited">>,
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
}): MatchState => ({
  config: {
    sportType: "survival",
    formation: input.formation,
    length: input.length,
    arenaType: input.arena.type,
    arenaSizeName: input.arena.sizeName,
    turnLengthSeconds: input.turnLengthSeconds,
    rulesRevision: ORIGINAL_SPOTTING_RULES_REVISION,
  },
  turnNumber: 1,
  teams: input.teams.map((team): TeamState => ({
    id: team.id,
    name: team.name,
    color: team.color,
    side: team.side,
    homeSlot: team.homeSlot,
    brain: "human",
    robots: team.roster.map((robotClass, index) => createDockedRobot(team.id, robotClass, index)),
    score: 0,
  })),
  arena: input.arena,
  lastKnownMarkers: new Map(),
});
