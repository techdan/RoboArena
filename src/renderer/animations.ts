/** Pure movie timeline reconstruction for Phase 7 presentation. */

import type {
  Heading,
  MatchState,
  Posture,
  ResolutionEvent,
  RobotClass,
  TileCoord,
} from "../engine/types";

export interface MovieRobotSnapshot {
  readonly id: string;
  readonly teamId: string;
  readonly teamColor: string;
  readonly robotClass: RobotClass;
  readonly position: TileCoord | "dock";
  readonly hp: number;
  readonly armor: number;
  readonly posture: Posture;
  readonly scanHeading: Heading;
  readonly destroyed: boolean;
}

export interface MovieSnapshot {
  readonly tick: number;
  readonly robots: Readonly<Record<string, MovieRobotSnapshot>>;
}

export interface MovieTimeline {
  readonly ticks: readonly number[];
  readonly snapshots: readonly MovieSnapshot[];
  readonly eventsByTick: ReadonlyMap<number, readonly ResolutionEvent[]>;
}

export type AnimationCue =
  "none" | "move" | "posture" | "scan" | "projectile" | "impact" | "hit" | "destroyed";

/** Exhaustive presentation mapping; non-visual events intentionally map to `none`. */
export const ANIMATION_CUES: Readonly<Record<ResolutionEvent["kind"], AnimationCue>> = {
  "turn-start": "none",
  "command-start": "none",
  deployed: "move",
  "move-step": "move",
  "posture-changed": "posture",
  "scan-rotated": "scan",
  "enemy-spotted": "none",
  "enemy-lost": "none",
  "scan-target-acquired": "none",
  fired: "none",
  "projectile-launched": "projectile",
  "projectile-impacted": "impact",
  "shot-missed": "none",
  damaged: "hit",
  destroyed: "destroyed",
  "last-known-marker": "none",
  "command-aborted": "none",
  "turn-end": "none",
};

const initialRobots = (state: MatchState): Record<string, MovieRobotSnapshot> => {
  const robots: Record<string, MovieRobotSnapshot> = {};
  for (const team of state.teams) {
    for (const robot of team.robots) {
      robots[robot.id] = {
        id: robot.id,
        teamId: robot.teamId,
        teamColor: team.color,
        robotClass: robot.definition.class,
        position: robot.position,
        hp: robot.hp,
        armor: robot.definition.armor,
        posture: robot.posture,
        scanHeading: robot.scanHeading,
        destroyed: robot.hp === 0,
      };
    }
  }
  return robots;
};

const updateRobot = (
  robots: Readonly<Record<string, MovieRobotSnapshot>>,
  robotId: string,
  update: (robot: MovieRobotSnapshot) => MovieRobotSnapshot,
): Readonly<Record<string, MovieRobotSnapshot>> => {
  const robot = robots[robotId];
  return robot === undefined ? robots : { ...robots, [robotId]: update(robot) };
};

export const applyMovieEvent = (
  robots: Readonly<Record<string, MovieRobotSnapshot>>,
  event: ResolutionEvent,
): Readonly<Record<string, MovieRobotSnapshot>> => {
  switch (event.kind) {
    case "deployed":
    case "move-step":
      return updateRobot(robots, event.robotId, (robot) => ({ ...robot, position: event.to }));
    case "posture-changed":
      return updateRobot(robots, event.robotId, (robot) => ({ ...robot, posture: event.posture }));
    case "scan-rotated":
      return updateRobot(robots, event.robotId, (robot) => ({
        ...robot,
        scanHeading: event.heading,
      }));
    case "damaged":
      return updateRobot(robots, event.targetId, (robot) => ({
        ...robot,
        hp: Math.max(0, robot.hp - event.damage),
      }));
    case "destroyed":
      return updateRobot(robots, event.robotId, (robot) => ({
        ...robot,
        hp: 0,
        destroyed: true,
      }));
    default:
      return robots;
  }
};

export const buildMovieTimeline = (
  initialState: MatchState,
  events: readonly ResolutionEvent[],
): MovieTimeline => {
  const sorted = [...events].sort((left, right) => left.tick - right.tick || left.seq - right.seq);
  const eventsByTick = new Map<number, ResolutionEvent[]>();
  for (const event of sorted) {
    const atTick = eventsByTick.get(event.tick) ?? [];
    atTick.push(event);
    eventsByTick.set(event.tick, atTick);
  }

  const ticks = [...new Set([0, ...sorted.map((event) => event.tick)])].sort((a, b) => a - b);
  let robots: Readonly<Record<string, MovieRobotSnapshot>> = initialRobots(initialState);
  const snapshots = ticks.map((tick) => {
    for (const event of eventsByTick.get(tick) ?? []) robots = applyMovieEvent(robots, event);
    return { tick, robots } satisfies MovieSnapshot;
  });
  return { ticks, snapshots, eventsByTick };
};

export const snapshotAtTick = (timeline: MovieTimeline, tick: number): MovieSnapshot => {
  let index = 0;
  while (index + 1 < timeline.ticks.length && (timeline.ticks[index + 1] ?? Infinity) <= tick) {
    index += 1;
  }
  const snapshot = timeline.snapshots[index];
  if (snapshot === undefined) throw new Error("Movie timeline has no initial snapshot.");
  return snapshot;
};

export const presentationDelayMs = (input: {
  readonly fromTick: number;
  readonly toTick: number;
  readonly fps: number;
  readonly speed: number;
  readonly compressIdle: boolean;
}): number => {
  const elapsedTicks = Math.max(1, input.toTick - input.fromTick);
  const presentedFrames = input.compressIdle ? Math.min(elapsedTicks, 6) : elapsedTicks;
  return Math.max(16, Math.round((presentedFrames * 1000) / input.fps / input.speed));
};
