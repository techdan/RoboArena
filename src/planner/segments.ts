/** Pure Phase 9 command construction, timing, and projection helpers. */

import {
  DEPLOY_COST_TICKS,
  MOVE_DOUBLE_COST_TICKS,
  MOVE_SINGLE_COST_TICKS,
  POSTURE_CHANGE_COST_TICKS,
  SCAN_DIRECTION_COST_TICKS,
  TICKS_PER_SECOND,
  WEAPON_TIMING,
} from "../engine/constants";
import { chunkMovementPath } from "../engine/movementChunking";
import { canTraverse } from "../engine/traversal";
import type {
  Arena,
  CommandTimeline,
  Heading,
  HomeSlot,
  MovementStep,
  Posture,
  RobotCommandSegment,
  RobotState,
  TileCoord,
  TurnOrders,
} from "../engine/types";
import { findPath, isInBounds, tileAt } from "./pathfind";
import { availableWeapons, PLANNER_WEAPON_RANGE, previewAim } from "./firingHelpers";

export interface ProjectedRobot {
  readonly position: TileCoord | "dock";
  readonly posture: Posture;
  readonly scanHeading: Heading;
  readonly tick: number;
}

export interface SegmentTiming {
  readonly index: number;
  readonly segment: RobotCommandSegment;
  readonly startTick: number;
  readonly endTick: number;
  readonly durationTicks: number;
  readonly overBudget: boolean;
  readonly createsScanOpportunity: boolean;
}

const moveDuration = (path: readonly MovementStep[]): number =>
  path.reduce(
    (total, step) =>
      total + (step.via === undefined ? MOVE_SINGLE_COST_TICKS : MOVE_DOUBLE_COST_TICKS),
    0,
  );

export const segmentDuration = (
  segment: RobotCommandSegment,
  projected: ProjectedRobot,
): number => {
  switch (segment.kind) {
    case "deploy":
      return DEPLOY_COST_TICKS;
    case "move":
      return moveDuration(segment.path);
    case "set-posture":
      return segment.posture === projected.posture ? 0 : POSTURE_CHANGE_COST_TICKS;
    case "set-scan-direction":
      return segment.heading === projected.scanHeading ? 0 : SCAN_DIRECTION_COST_TICKS;
    case "aim-and-fire":
      return WEAPON_TIMING[segment.weapon].firingIntervalTicks;
    case "scan-and-fire":
      return segment.seconds * TICKS_PER_SECOND;
  }
};

const applySegment = (
  state: ProjectedRobot,
  segment: RobotCommandSegment,
  endTick: number,
): ProjectedRobot => {
  switch (segment.kind) {
    case "deploy":
      return { ...state, position: segment.to, tick: endTick };
    case "move":
      return { ...state, position: segment.path.at(-1)?.to ?? state.position, tick: endTick };
    case "set-posture":
      return { ...state, posture: segment.posture, tick: endTick };
    case "set-scan-direction":
      return { ...state, scanHeading: segment.heading, tick: endTick };
    case "aim-and-fire":
    case "scan-and-fire":
      return { ...state, tick: endTick };
  }
};

const initialProjection = (robot: RobotState): ProjectedRobot => ({
  position: robot.position,
  posture: robot.posture,
  scanHeading: robot.scanHeading,
  tick: 0,
});

export const timelineTiming = (
  robot: RobotState,
  segments: readonly RobotCommandSegment[],
  budgetTicks: number,
): readonly SegmentTiming[] => {
  let projected = initialProjection(robot);
  return segments.map((segment, index) => {
    const durationTicks =
      segment.kind === "aim-and-fire" && segment.repeat
        ? Math.max(WEAPON_TIMING[segment.weapon].firingIntervalTicks, budgetTicks - projected.tick)
        : segmentDuration(segment, projected);
    const startTick = projected.tick;
    const endTick = startTick + durationTicks;
    projected = applySegment(projected, segment, endTick);
    return {
      index,
      segment,
      startTick,
      endTick,
      durationTicks,
      overBudget: endTick > budgetTicks,
      createsScanOpportunity:
        segment.kind === "deploy" ||
        segment.kind === "move" ||
        segment.kind === "set-posture" ||
        segment.kind === "set-scan-direction",
    };
  });
};

/** Projection applies a command only when its completion boundary is at or before previewTick. */
export const projectRobotAtTick = (
  robot: RobotState,
  segments: readonly RobotCommandSegment[],
  previewTick = Number.POSITIVE_INFINITY,
): ProjectedRobot => {
  let projected = initialProjection(robot);
  for (const segment of segments) {
    if (segment.kind === "move") {
      for (const step of segment.path) {
        const duration = step.via === undefined ? MOVE_SINGLE_COST_TICKS : MOVE_DOUBLE_COST_TICKS;
        const endTick = projected.tick + duration;
        if (endTick > previewTick) return projected;
        projected = { ...projected, position: step.to, tick: endTick };
      }
      continue;
    }
    const duration = segmentDuration(segment, projected);
    const endTick = projected.tick + duration;
    if (endTick > previewTick) return projected;
    projected = applySegment(projected, segment, endTick);
  }
  return projected;
};

export const timelineForRobot = (orders: TurnOrders, robotId: string): CommandTimeline =>
  orders.timelines.find((timeline) => timeline.robotId === robotId) ?? { robotId, segments: [] };

export const replaceTimeline = (
  orders: TurnOrders,
  robotId: string,
  segments: readonly RobotCommandSegment[],
): TurnOrders => {
  const existingIndex = orders.timelines.findIndex((timeline) => timeline.robotId === robotId);
  if (existingIndex < 0) {
    return { ...orders, timelines: [...orders.timelines, { robotId, segments }] };
  }
  return {
    ...orders,
    timelines: orders.timelines.map((timeline, index) =>
      index === existingIndex ? { robotId, segments } : timeline,
    ),
  };
};

export const appendSegment = (
  orders: TurnOrders,
  robotId: string,
  segment: RobotCommandSegment,
): TurnOrders => {
  const timeline = timelineForRobot(orders, robotId);
  return replaceTimeline(orders, robotId, [...timeline.segments, segment]);
};

export const deleteSegment = (orders: TurnOrders, robotId: string, index: number): TurnOrders => {
  const timeline = timelineForRobot(orders, robotId);
  return replaceTimeline(
    orders,
    robotId,
    timeline.segments.filter((_, segmentIndex) => segmentIndex !== index),
  );
};

export const replaceSegmentAt = (
  orders: TurnOrders,
  robotId: string,
  index: number,
  segment: RobotCommandSegment,
): TurnOrders => {
  const timeline = timelineForRobot(orders, robotId);
  if (timeline.segments[index] === undefined) return orders;
  return replaceTimeline(
    orders,
    robotId,
    timeline.segments.map((current, segmentIndex) => (segmentIndex === index ? segment : current)),
  );
};

const chebyshev = (from: TileCoord, to: TileCoord): number =>
  Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y));

const movementStepIsLegal = (
  arena: Arena,
  from: TileCoord,
  step: MovementStep,
  posture: Posture,
): boolean => {
  if (!isInBounds(arena, step.to)) return false;
  const size = chebyshev(from, step.to);
  if (size === 1 && step.via !== undefined) return false;
  if (size !== 1 && size !== 2) return false;
  const entered = step.via === undefined ? [step.to] : [step.via, step.to];
  if (
    size === 2 &&
    (step.via === undefined ||
      !isInBounds(arena, step.via) ||
      chebyshev(from, step.via) !== 1 ||
      chebyshev(step.via, step.to) !== 1)
  ) {
    return false;
  }
  return entered.every((coord) => {
    const tile = tileAt(arena, coord);
    return (
      tile !== undefined &&
      canTraverse(posture, tile.terrain) &&
      (size === 1 || tile.terrain === "open")
    );
  });
};

export interface ValidatedTimeline {
  readonly segments: readonly RobotCommandSegment[];
  readonly droppedCount: number;
}

/** Retains the executable prefix after a direct edit or command deletion. */
export const validatedTimelinePrefix = (
  arena: Arena,
  robot: RobotState,
  homeSlot: HomeSlot,
  segments: readonly RobotCommandSegment[],
): ValidatedTimeline => {
  let projected = initialProjection(robot);
  const valid: RobotCommandSegment[] = [];
  for (const segment of segments) {
    if (projected.position === "dock" && segment.kind !== "deploy") break;
    if (projected.position !== "dock" && segment.kind === "deploy") break;
    if (segment.kind === "deploy") {
      const home = arena.homeAreas[homeSlot];
      const tile = tileAt(arena, segment.to);
      if (
        tile === undefined ||
        !home?.tiles.some(
          (candidate) => candidate.x === segment.to.x && candidate.y === segment.to.y,
        ) ||
        !canTraverse(projected.posture, tile.terrain)
      ) {
        break;
      }
    }
    if (segment.kind === "move") {
      if (
        projected.position === "dock" ||
        segment.path.length === 0 ||
        segment.posture !== projected.posture
      ) {
        break;
      }
      let position = projected.position;
      let legal = true;
      for (const step of segment.path) {
        if (!movementStepIsLegal(arena, position, step, projected.posture)) {
          legal = false;
          break;
        }
        position = step.to;
      }
      if (!legal) break;
    }
    if (segment.kind === "aim-and-fire") {
      if (
        !isInBounds(arena, segment.target) ||
        !availableWeapons(robot).includes(segment.weapon) ||
        previewAim({
          arena,
          shooter: {
            ...robot,
            position: projected.position,
            posture: projected.posture,
            scanHeading: projected.scanHeading,
          },
          target: segment.target,
          weapon: segment.weapon,
          authorizedContacts: [],
        }).status !== "eligible"
      ) {
        break;
      }
    }
    if (
      segment.kind === "scan-and-fire" &&
      (!availableWeapons(robot).includes(segment.weapon) ||
        segment.maxDistance < 1 ||
        segment.maxDistance > PLANNER_WEAPON_RANGE[segment.weapon] ||
        segment.seconds < 1 ||
        segment.seconds > 40)
    ) {
      break;
    }
    const endTick = projected.tick + segmentDuration(segment, projected);
    projected = applySegment(projected, segment, endTick);
    valid.push(segment);
    if (segment.kind === "aim-and-fire" && segment.repeat) break;
  }
  return { segments: valid, droppedCount: segments.length - valid.length };
};

export const rebaseTurnOrders = (
  arena: Arena,
  robots: readonly RobotState[],
  homeSlot: HomeSlot,
  orders: TurnOrders,
  turnNumber: number,
): TurnOrders => {
  const robotById = new Map(robots.map((robot) => [robot.id, robot]));
  const timelines: CommandTimeline[] = [];
  for (const timeline of orders.timelines) {
    const robot = robotById.get(timeline.robotId);
    if (robot === undefined) continue;
    const validated = validatedTimelinePrefix(arena, robot, homeSlot, timeline.segments);
    if (validated.segments.length > 0) {
      timelines.push({ robotId: robot.id, segments: validated.segments });
    }
  }
  return { turnNumber, timelines };
};

export type MovementPlanResult =
  | { readonly kind: "move"; readonly segment: Extract<RobotCommandSegment, { kind: "move" }> }
  | { readonly kind: "error"; readonly reason: "out-of-bounds" | "blocked" | "unreachable" };

export const planMovement = (
  arena: Arena,
  from: TileCoord,
  to: TileCoord,
  posture: Posture,
): MovementPlanResult => {
  const route = findPath(arena, from, to, posture);
  if (route.kind === "error") return route;
  const path = chunkMovementPath(from, route.steps, (coord) => tileAt(arena, coord));
  if (path === null) return { kind: "error", reason: "unreachable" };
  return { kind: "move", segment: { kind: "move", path, posture } };
};

export const ordersFingerprint = (orders: TurnOrders): string => JSON.stringify(orders);
