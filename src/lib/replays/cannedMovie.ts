/** Canned, non-authoritative Phase 7 movie used by the local debug route. */

import type {
  MatchState,
  ResolutionEvent,
  RobotClass,
  RobotDefinition,
  RobotState,
  WeaponId,
} from "../../engine/types";
import { loadArena } from "../arenas";

/** Presentation-only fixture values mirror the canonical engine catalog. */
const DEFINITIONS: Readonly<Record<"rifle" | "missile", RobotDefinition>> = {
  rifle: { class: "rifle", accuracy: 2, armor: 140, rating: 40, primaryWeapon: "rifle" },
  missile: {
    class: "missile",
    accuracy: 1,
    armor: 100,
    rating: 80,
    primaryWeapon: "missile-launcher",
    secondaryWeapons: ["rifle"],
  },
};

const AMMO: Readonly<Record<WeaponId, number | "unlimited">> = {
  rifle: "unlimited",
  "burst-gun": "unlimited",
  "auto-rifle": "unlimited",
  "missile-launcher": 3,
  "grenade-launcher": 0,
};

const makeRobot = (
  id: string,
  teamId: string,
  robotClass: Extract<RobotClass, "rifle" | "missile">,
  x: number,
  hp?: number,
): RobotState => {
  const definition = DEFINITIONS[robotClass];
  return {
    id,
    teamId,
    definition,
    position: { x, y: 1 },
    hp: hp ?? definition.armor,
    posture: "upright",
    scanHeading: teamId === "team-ember" ? "E" : "W",
    damageStaggerActionsRemaining: 0,
    ammo: AMMO,
  };
};

export interface CannedMovie {
  readonly initialState: MatchState;
  readonly events: readonly ResolutionEvent[];
}

export async function createCannedMovie(): Promise<CannedMovie> {
  const arena = await loadArena("rubble-two");
  const initialState: MatchState = {
    config: {
      sportType: "survival",
      formation: "beginner",
      length: "melee",
      arenaType: "rubble",
      arenaSizeName: arena.sizeName,
      turnLengthSeconds: 15,
    },
    turnNumber: 1,
    teams: [
      {
        id: "team-ember",
        name: "Ember Unit",
        color: "red",
        side: 1,
        homeSlot: 0,
        brain: "human",
        robots: [makeRobot("ember-rifle", "team-ember", "rifle", 6)],
        score: 0,
      },
      {
        id: "team-azure",
        name: "Azure Unit",
        color: "blue",
        side: 2,
        homeSlot: 2,
        brain: "human",
        robots: [makeRobot("azure-missile", "team-azure", "missile", 14, 60)],
        score: 0,
      },
    ],
    arena,
    lastKnownMarkers: new Map(),
  };
  const events: readonly ResolutionEvent[] = [
    { tick: 0, seq: 0, kind: "turn-start", turnNumber: 1 },
    { tick: 20, seq: 1, kind: "move-step", robotId: "ember-rifle", to: { x: 7, y: 1 } },
    { tick: 40, seq: 2, kind: "move-step", robotId: "ember-rifle", to: { x: 8, y: 1 } },
    { tick: 60, seq: 3, kind: "move-step", robotId: "ember-rifle", to: { x: 9, y: 1 } },
    { tick: 80, seq: 4, kind: "move-step", robotId: "ember-rifle", to: { x: 10, y: 1 } },
    { tick: 100, seq: 5, kind: "move-step", robotId: "ember-rifle", to: { x: 11, y: 1 } },
    { tick: 120, seq: 6, kind: "posture-changed", robotId: "ember-rifle", posture: "crouching" },
    { tick: 135, seq: 7, kind: "scan-rotated", robotId: "ember-rifle", heading: "E" },
    {
      tick: 140,
      seq: 8,
      kind: "fired",
      shooterId: "ember-rifle",
      commandIndex: 1,
      weapon: "rifle",
      target: { x: 14, y: 1 },
      fireMode: "aim",
    },
    {
      tick: 140,
      seq: 9,
      kind: "projectile-launched",
      projectileId: "demo:1",
      shooterId: "ember-rifle",
      shotIndex: 0,
      weapon: "rifle",
      from: { x: 11, y: 1 },
      target: { x: 14, y: 1 },
    },
    {
      tick: 155,
      seq: 10,
      kind: "projectile-impacted",
      projectileId: "demo:1",
      weapon: "rifle",
      target: { x: 14, y: 1 },
      outcome: "hit",
    },
    {
      tick: 155,
      seq: 11,
      kind: "damaged",
      damageKind: "direct",
      sourceId: "ember-rifle",
      shotIndex: 0,
      targetId: "azure-missile",
      damage: 24,
      score: 18,
    },
    {
      tick: 190,
      seq: 12,
      kind: "projectile-launched",
      projectileId: "demo:2",
      shooterId: "ember-rifle",
      shotIndex: 0,
      weapon: "missile-launcher",
      from: { x: 11, y: 1 },
      target: { x: 14, y: 1 },
    },
    {
      tick: 205,
      seq: 13,
      kind: "projectile-impacted",
      projectileId: "demo:2",
      weapon: "missile-launcher",
      target: { x: 14, y: 1 },
      outcome: "blast",
    },
    {
      tick: 205,
      seq: 14,
      kind: "damaged",
      damageKind: "blast",
      sourceId: "ember-rifle",
      shotIndex: 0,
      targetId: "azure-missile",
      damage: 36,
      radius: 0,
    },
    { tick: 205, seq: 15, kind: "destroyed", robotId: "azure-missile" },
    { tick: 240, seq: 16, kind: "turn-end", turnNumber: 1 },
  ];
  return { initialState, events };
}
