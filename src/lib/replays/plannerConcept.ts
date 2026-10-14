/** Planner concept scenario for the 3D planner design review (debug route
 *  /planner-concept). A hand-placed early-turn situation on the showcase arena:
 *  the player's four robots with drafted orders, two enemy contacts and one
 *  last-known marker. Routes, timings, targeting tiles and the hit estimate are
 *  computed by the real planner modules, so the concept shows true numbers.
 *  Non-authoritative; nothing here touches a room.
 */

import {
  TICKS_PER_SECOND,
  MOVE_DOUBLE_COST_TICKS,
  MOVE_SINGLE_COST_TICKS,
} from "../../engine/constants";
import type {
  Heading,
  MatchState,
  RobotClass,
  RobotCommandSegment,
  RobotState,
  TileCoord,
  WeaponId,
} from "../../engine/types";
import {
  PLANNER_WEAPON_RANGE,
  previewAim,
  previewTargetingTiles,
} from "../../planner/firingHelpers";
import { planMovement, projectRobotAtTick, timelineTiming } from "../../planner/segments";
import { targetingTileVisual } from "../../planner/targetingVisuals";
import { createShowcaseMovie } from "./showcaseMovie";

export interface ConceptLaneBlock {
  readonly kind: RobotCommandSegment["kind"];
  readonly label: string;
  readonly startTick: number;
  readonly endTick: number;
}

export interface ConceptRobot {
  readonly id: string;
  readonly name: string;
  readonly robotClass: RobotClass;
  readonly weapon: WeaponId;
  readonly hp: number;
  readonly start: TileCoord;
  readonly startHeading: Heading;
  readonly route: readonly TileCoord[];
  readonly secondMarks: readonly number[];
  readonly end: TileCoord;
  readonly endHeading: Heading;
  readonly endPosture: RobotState["posture"];
  readonly lane: readonly ConceptLaneBlock[];
  readonly usedTicks: number;
  /** Projected tile at the rehearsal tick. */
  readonly rehearsal: TileCoord;
  readonly aimAt?: TileCoord;
}

export interface PlannerConcept {
  readonly state: MatchState;
  readonly teamColor: string;
  readonly budgetTicks: number;
  readonly rehearsalTick: number;
  readonly robots: readonly ConceptRobot[];
  readonly contacts: readonly {
    id: string;
    robotClass: RobotClass;
    tile: TileCoord;
    label: string;
  }[];
  readonly lastKnown: readonly TileCoord[];
  readonly heat: readonly {
    tile: TileCoord;
    color: number;
    alpha: number;
    pattern: "none" | "hatch" | "reverse-hatch" | "dim";
  }[];
  readonly shot: {
    readonly shooterId: string;
    readonly from: TileCoord;
    readonly target: TileCoord;
    readonly heading: Heading;
    readonly range: number;
    readonly distance: number;
    readonly chancePercent: number;
    readonly damage: string;
    readonly coverNote: string;
  };
}

const PLAN: readonly {
  readonly robotClass: RobotClass;
  readonly name: string;
  readonly start: TileCoord;
  readonly startHeading: Heading;
  readonly to: TileCoord | null;
  readonly then: readonly RobotCommandSegment[];
  readonly endHeading: Heading;
}[] = [
  {
    robotClass: "rifle",
    name: "Lance",
    start: { x: 8, y: 22 },
    startHeading: "N",
    to: { x: 10, y: 16 },
    then: [
      { kind: "set-scan-direction", heading: "N" },
      { kind: "aim-and-fire", target: { x: 11, y: 11 }, weapon: "rifle", repeat: false },
      { kind: "aim-and-fire", target: { x: 11, y: 11 }, weapon: "rifle", repeat: false },
    ],
    endHeading: "N",
  },
  {
    robotClass: "burst",
    name: "Vex",
    start: { x: 10, y: 23 },
    startHeading: "N",
    to: { x: 14, y: 18 },
    then: [
      { kind: "set-posture", posture: "ducking" },
      { kind: "scan-and-fire", weapon: "burst-gun", maxDistance: 8, seconds: 3 },
    ],
    endHeading: "NE",
  },
  {
    robotClass: "auto",
    name: "Brick",
    start: { x: 12, y: 22 },
    startHeading: "N",
    to: null,
    then: [
      { kind: "set-scan-direction", heading: "NE" },
      { kind: "scan-and-fire", weapon: "auto-rifle", maxDistance: 9, seconds: 7 },
    ],
    endHeading: "NE",
  },
  {
    robotClass: "missile",
    name: "Atlas",
    start: { x: 14, y: 23 },
    startHeading: "N",
    to: { x: 18, y: 21 },
    then: [
      { kind: "aim-and-fire", target: { x: 18, y: 13 }, weapon: "missile-launcher", repeat: false },
    ],
    endHeading: "N",
  },
];

const LABEL: Record<RobotCommandSegment["kind"], string> = {
  deploy: "Deploy",
  move: "Move",
  "set-posture": "Duck",
  "set-scan-direction": "Face",
  "aim-and-fire": "Fire",
  "scan-and-fire": "Scan & fire",
};

export function createPlannerConcept(): PlannerConcept {
  const base = createShowcaseMovie().initialState;
  const arena = base.arena;
  const red = base.teams[0]!;
  const blue = base.teams[1]!;
  const pick = (team: typeof red, robotClass: RobotClass) =>
    team.robots.find((robot) => robot.definition.class === robotClass)!;
  const budgetTicks = base.config.turnLengthSeconds * TICKS_PER_SECOND;
  const rehearsalTick = Math.round(budgetTicks * 0.4);

  const robots: ConceptRobot[] = [];
  const own: RobotState[] = [];
  for (const plan of PLAN) {
    const source = pick(red, plan.robotClass);
    const robot: RobotState = {
      ...source,
      id: `red-${plan.robotClass}`,
      position: plan.start,
      posture: "upright",
      scanHeading: plan.startHeading,
      hp: source.definition.armor,
    };
    own.push(robot);
    const segments: RobotCommandSegment[] = [];
    const route: TileCoord[] = [plan.start];
    const secondMarks: number[] = [];
    if (plan.to !== null) {
      const move = planMovement(arena, plan.start, plan.to, "upright");
      if (move.kind === "error") throw new Error(`concept route ${plan.name}: ${move.reason}`);
      segments.push(move.segment);
      let ticks = 0;
      let nextMark = TICKS_PER_SECOND;
      for (const step of move.segment.path) {
        if (step.via !== undefined) route.push(step.via);
        route.push(step.to);
        ticks += step.via === undefined ? MOVE_SINGLE_COST_TICKS : MOVE_DOUBLE_COST_TICKS;
        while (ticks >= nextMark) {
          secondMarks.push(route.length - 1);
          nextMark += TICKS_PER_SECOND;
        }
      }
    }
    segments.push(...plan.then);
    const timing = timelineTiming(robot, segments, budgetTicks);
    const lane = timing.map((entry) => ({
      kind: entry.segment.kind,
      label: LABEL[entry.segment.kind],
      startTick: entry.startTick,
      endTick: entry.endTick,
    }));
    const rehearsalProjection = projectRobotAtTick(robot, segments, rehearsalTick);
    const end = route[route.length - 1]!;
    const aim = plan.then.find((segment) => segment.kind === "aim-and-fire");
    robots.push({
      id: robot.id,
      name: plan.name,
      robotClass: plan.robotClass,
      weapon: robot.definition.primaryWeapon,
      hp: robot.hp,
      start: plan.start,
      startHeading: plan.startHeading,
      route,
      secondMarks,
      end,
      endHeading: plan.endHeading,
      endPosture: plan.then.some((s) => s.kind === "set-posture") ? "ducking" : "upright",
      lane,
      usedTicks: lane.at(-1)?.endTick ?? 0,
      rehearsal:
        rehearsalProjection.position === "dock" ? plan.start : rehearsalProjection.position,
      ...(aim?.kind === "aim-and-fire" ? { aimAt: aim.target } : {}),
    });
  }

  const contacts = [
    { robot: pick(blue, "rifle"), tile: { x: 11, y: 11 }, label: "Blue Rifle" },
    { robot: pick(blue, "burst"), tile: { x: 18, y: 13 }, label: "Blue Burst" },
  ];
  const contactStates: RobotState[] = contacts.map(({ robot, tile }) => ({
    ...robot,
    position: tile,
    posture: "upright",
    scanHeading: "S",
  }));

  // Shot analysis for the rifle from its planned firing position.
  const rifle = robots[0]!;
  const shooter: RobotState = { ...own[0]!, position: rifle.end, scanHeading: rifle.endHeading };
  const authorizedContacts = contacts.map(({ robot, tile, label }) => ({
    id: robot.id,
    label,
    tile,
    posture: "upright" as const,
  }));
  const range = PLANNER_WEAPON_RANGE.rifle;
  const heat = previewTargetingTiles({
    arena,
    shooter,
    weapon: "rifle",
    authorizedContacts,
    fireMode: "aim",
    maxDistance: range,
  })
    .map((tile) => ({ tile: tile.tile, ...targetingTileVisual(tile) }))
    .map(({ tile, color, alpha, pattern }) => ({ tile, color, alpha, pattern }));
  const target = rifle.aimAt!;
  const aim = previewAim({ arena, shooter, target, weapon: "rifle", authorizedContacts });
  const estimate = aim.estimates[0];
  const damage = estimate?.damageRange;

  const state: MatchState = {
    ...base,
    turnNumber: 3,
    lastKnownMarkers: new Map(),
    teams: base.teams.map((team, index) => ({
      ...team,
      robots: index === 0 ? own : index === 1 ? contactStates : [],
    })),
  };

  return {
    state,
    teamColor: "#ff5a4f",
    budgetTicks,
    rehearsalTick,
    robots,
    contacts: contacts.map(({ robot, tile, label }) => ({
      id: robot.id,
      robotClass: robot.definition.class,
      tile,
      label,
    })),
    lastKnown: [{ x: 4, y: 11 }],
    heat,
    shot: {
      shooterId: rifle.id,
      from: rifle.end,
      target,
      heading: rifle.endHeading,
      range,
      distance: aim.distance,
      chancePercent: estimate?.chancePercent ?? 0,
      damage: damage === null || damage === undefined ? "–" : `${damage.minimum}–${damage.maximum}`,
      coverNote: estimate === undefined ? "No line of fire" : coverText(estimate.coverSource),
    },
  };
}

const coverText = (source: string): string =>
  ({
    none: "Target in the open",
    "target-bush": "Target in a bush",
    "adjacent-bush": "Bush beside target",
    "target-low-wall": "Target behind low wall",
    "adjacent-low-wall": "Low wall beside target",
  })[source] ?? source;
