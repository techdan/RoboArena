/** Pure movie timeline reconstruction for Phase 7 presentation. */

import type {
  Heading,
  MatchState,
  Posture,
  ResolutionEvent,
  RobotClass,
  TileCoord,
} from "../engine/types";
import { MOVE_DOUBLE_COST_TICKS, TICKS_PER_SECOND } from "../engine/constants";
import type { ParticipantResolutionEvent } from "../lib/net/protocol";

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

/** A Time Bomb armed on the board at a snapshot (the viewer's own bombs only). */
export interface MovieBombSnapshot {
  readonly id: string;
  readonly ownerId: string;
  readonly at: TileCoord;
}

export interface MovieSnapshot {
  readonly tick: number;
  readonly robots: Readonly<Record<string, MovieRobotSnapshot>>;
  /** Armed bombs: carried in from earlier turns, placed, and not yet exploded. */
  readonly bombs: readonly MovieBombSnapshot[];
}

export interface MovieTimeline {
  readonly ticks: readonly number[];
  readonly snapshots: readonly MovieSnapshot[];
  readonly eventsByTick: ReadonlyMap<number, readonly ParticipantResolutionEvent[]>;
  /** Tick each projectile lands on, by projectile id. */
  readonly projectileImpactTicks: ReadonlyMap<string, number>;
}

export type AnimationCue =
  | "none"
  | "move"
  | "posture"
  | "scan"
  | "muzzle"
  | "target-lock"
  | "last-known"
  | "projectile"
  | "impact"
  | "miss"
  | "hit"
  | "destroyed"
  | "zap"
  | "bomb"
  | "explosion";

/** Exhaustive presentation mapping; non-visual events intentionally map to `none`. */
export const ANIMATION_CUES: Readonly<Record<ResolutionEvent["kind"], AnimationCue>> = {
  "turn-start": "none",
  "command-start": "none",
  deployed: "move",
  "move-step": "move",
  "posture-changed": "posture",
  "scan-rotated": "scan",
  "enemy-spotted": "none",
  "enemy-lost": "last-known",
  "scan-target-acquired": "target-lock",
  fired: "muzzle",
  "projectile-launched": "projectile",
  "projectile-impacted": "impact",
  "shot-missed": "miss",
  damaged: "hit",
  destroyed: "destroyed",
  "last-known-marker": "last-known",
  "command-aborted": "none",
  zapped: "zap",
  "bomb-placed": "bomb",
  "bomb-exploded": "explosion",
  "self-destructed": "explosion",
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
  event: ParticipantResolutionEvent,
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
    case "enemy-spotted":
      return event.contact === undefined ? robots : { ...robots, [event.enemyId]: event.contact };
    case "enemy-lost": {
      if (robots[event.enemyId] === undefined) return robots;
      const next = { ...robots };
      delete next[event.enemyId];
      return next;
    }
    default:
      return robots;
  }
};

export const applyBombEvent = (
  bombs: readonly MovieBombSnapshot[],
  event: ParticipantResolutionEvent,
): readonly MovieBombSnapshot[] => {
  if (event.kind === "bomb-placed") {
    return [
      ...bombs.filter((bomb) => bomb.id !== event.bombId),
      { id: event.bombId, ownerId: event.robotId, at: event.at },
    ];
  }
  if (event.kind === "bomb-exploded") return bombs.filter((bomb) => bomb.id !== event.bombId);
  return bombs;
};

export const buildMovieTimeline = (
  initialState: MatchState,
  events: readonly ParticipantResolutionEvent[],
): MovieTimeline => {
  const sorted = [...events].sort((left, right) => left.tick - right.tick || left.seq - right.seq);
  const eventsByTick = new Map<number, ParticipantResolutionEvent[]>();
  for (const event of sorted) {
    const atTick = eventsByTick.get(event.tick) ?? [];
    atTick.push(event);
    eventsByTick.set(event.tick, atTick);
  }

  const projectileImpactTicks = new Map<string, number>();
  for (const event of sorted) {
    if (event.kind === "projectile-impacted")
      projectileImpactTicks.set(event.projectileId, event.tick);
  }

  const ticks = [...new Set([0, ...sorted.map((event) => event.tick)])].sort((a, b) => a - b);
  let robots: Readonly<Record<string, MovieRobotSnapshot>> = initialRobots(initialState);
  let bombs: readonly MovieBombSnapshot[] = (initialState.armedBombs ?? []).map((bomb) => ({
    id: bomb.id,
    ownerId: bomb.ownerId,
    at: bomb.at,
  }));
  const snapshots = ticks.map((tick) => {
    for (const event of eventsByTick.get(tick) ?? []) {
      robots = applyMovieEvent(robots, event);
      bombs = applyBombEvent(bombs, event);
    }
    return { tick, robots, bombs } satisfies MovieSnapshot;
  });
  return { ticks, snapshots, eventsByTick, projectileImpactTicks };
};

/**
 * Seconds at 1× a projectile spends in flight when it lands on a later tick
 * than it was launched (rules revision 4 delays every impact); undefined when
 * it lands on its launch tick and the renderer picks a travel time itself.
 */
export const projectileFlightSeconds = (
  impactTicks: ReadonlyMap<string, number> | undefined,
  launch: { readonly projectileId: string; readonly tick: number },
): number | undefined => {
  const impactTick = impactTicks?.get(launch.projectileId);
  return impactTick !== undefined && impactTick > launch.tick
    ? (impactTick - launch.tick) / TICKS_PER_SECOND
    : undefined;
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

/**
 * Shortest beat idle compression may collapse to.
 *
 * A flat six-frame cap also compressed two-tile moves, which cost 40 ticks and
 * therefore need eight frames at 12 fps: doubles played at exactly the same
 * tempo as singles, losing the "two tiles is faster per tile" reading, and the
 * movie advanced before the robot finished crossing. Compression exists for
 * waits, so the floor is the longest beat a robot can still be physically
 * crossing a tile in — anything longer really is idle.
 */
export const idleFrameFloor = (fps: number): number =>
  Math.max(1, Math.ceil((MOVE_DOUBLE_COST_TICKS * fps) / TICKS_PER_SECOND));

export const presentationDelayMs = (input: {
  readonly fromTick: number;
  readonly toTick: number;
  readonly fps: number;
  readonly speed: number;
  readonly compressIdle: boolean;
}): number => {
  const elapsedTicks = Math.max(1, input.toTick - input.fromTick);
  const elapsedFrames = Math.max(1, Math.ceil((elapsedTicks * input.fps) / TICKS_PER_SECOND));
  const presentedFrames = input.compressIdle
    ? Math.min(elapsedFrames, idleFrameFloor(input.fps))
    : elapsedFrames;
  return Math.max(16, Math.round((presentedFrames * 1000) / input.fps / input.speed));
};
