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
import type {
  Arena,
  CommandTimeline,
  Heading,
  MovementStep,
  Posture,
  RobotCommandSegment,
  RobotState,
  TileCoord,
  TurnOrders,
} from "../engine/types";
import { findPath, tileAt } from "./pathfind";

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
    const durationTicks = segmentDuration(segment, projected);
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
