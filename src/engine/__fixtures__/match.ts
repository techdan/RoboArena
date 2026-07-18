/** Test-only builders for small deterministic Phase 2 match states. */

import { ROBOT_DEFINITIONS, WEAPONS } from "../catalog.js";
import type {
  Arena,
  HomeSlot,
  MatchState,
  RobotClass,
  RobotState,
  TeamState,
  TileCoord,
  WeaponId,
} from "../types.js";

const ALL_WEAPONS = Object.keys(WEAPONS) as WeaponId[];

export const makeOpenArena = (width = 8, height = 8): Arena => ({
  type: "rubble",
  sizeName: "Resolver Test",
  width,
  height,
  tiles: Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ terrain: "open" as const })),
  ),
  homeAreas: [
    {
      corner: "NW",
      tiles: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    },
    {
      corner: "NE",
      tiles: [
        { x: width - 1, y: 0 },
        { x: width - 2, y: 0 },
      ],
    },
    {
      corner: "SE",
      tiles: [
        { x: width - 1, y: height - 1 },
        { x: width - 2, y: height - 1 },
      ],
    },
    {
      corner: "SW",
      tiles: [
        { x: 0, y: height - 1 },
        { x: 1, y: height - 1 },
      ],
    },
  ],
});

export const makeRobot = (
  id: string,
  teamId: string,
  robotClass: RobotClass,
  position: TileCoord | "dock",
  overrides: Partial<
    Pick<RobotState, "hp" | "posture" | "scanHeading" | "damageStaggerActionsRemaining">
  > = {},
): RobotState => {
  const definition = ROBOT_DEFINITIONS[robotClass];
  return {
    id,
    teamId,
    definition,
    position,
    hp: overrides.hp ?? definition.armor,
    posture: overrides.posture ?? "upright",
    scanHeading: overrides.scanHeading ?? "E",
    damageStaggerActionsRemaining: overrides.damageStaggerActionsRemaining ?? 0,
    ammo: Object.fromEntries(
      ALL_WEAPONS.map((weaponId) => [weaponId, WEAPONS[weaponId].startingAmmo]),
    ) as Readonly<Record<WeaponId, number | "unlimited">>,
  };
};

const SIDE_COLORS = ["red", "blue", "green", "yellow"] as const;

export const makeTeam = (
  id: string,
  side: TeamState["side"],
  robots: readonly RobotState[],
  homeSlot: HomeSlot,
): TeamState => ({
  id,
  name: id,
  color: SIDE_COLORS[(side - 1) % SIDE_COLORS.length]!,
  side,
  homeSlot,
  brain: "human",
  robots,
  score: 0,
});

export const makeMatch = (input?: {
  readonly teamOneRobots?: readonly RobotState[];
  readonly teamTwoRobots?: readonly RobotState[];
  readonly arena?: Arena;
  readonly turnLengthSeconds?: number;
  readonly turnNumber?: number;
}): MatchState => ({
  config: {
    sportType: "survival",
    formation: "beginner",
    length: "melee",
    arenaType: "rubble",
    arenaSizeName: "Resolver Test",
    turnLengthSeconds: input?.turnLengthSeconds ?? 15,
  },
  turnNumber: input?.turnNumber ?? 1,
  teams: [
    makeTeam(
      "team-1",
      1,
      input?.teamOneRobots ?? [makeRobot("r1", "team-1", "rifle", { x: 1, y: 1 })],
      0,
    ),
    makeTeam(
      "team-2",
      2,
      input?.teamTwoRobots ?? [makeRobot("r2", "team-2", "rifle", { x: 6, y: 6 })],
      2,
    ),
  ],
  arena: input?.arena ?? makeOpenArena(),
  lastKnownMarkers: new Map(),
});

/**
 * A free-for-all match with one unique Side and Home slot per team, for
 * three-/four-player lifecycle coverage. Each entry supplies that team's
 * robots; Side and Home slot follow the (non-compacting) array order.
 */
export const makeFfaMatch = (
  teams: readonly { readonly id: string; readonly robots: readonly RobotState[] }[],
  input?: { readonly arena?: Arena; readonly turnLengthSeconds?: number },
): MatchState => {
  if (teams.length < 2 || teams.length > 4) {
    throw new Error("A free-for-all match needs two to four teams.");
  }
  return {
    config: {
      sportType: "survival",
      formation: "beginner",
      length: "melee",
      arenaType: "rubble",
      arenaSizeName: "Resolver Test",
      turnLengthSeconds: input?.turnLengthSeconds ?? 15,
    },
    turnNumber: 1,
    teams: teams.map((team, index) =>
      makeTeam(team.id, (index + 1) as TeamState["side"], team.robots, index as HomeSlot),
    ),
    arena: input?.arena ?? makeOpenArena(),
    lastKnownMarkers: new Map(),
  };
};
