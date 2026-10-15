/**
 * Pure command timing helpers for the Phase 2 resolver.
 *
 * Sourced from `docs/spec.md` §§3–6 and
 * `tasks/phase2-resolver-design.md`.
 */

import {
  DEPLOY_COST_TICKS,
  POSTURE_CHANGE_COST_TICKS,
  SCAN_DIRECTION_COST_TICKS,
} from "./constants.js";
import { chebyshevDistance } from "./geometry.js";
import { moveStepCostTicks } from "./movement.js";
import { headingTurnSteps, postureChangeSteps } from "./orientation.js";
import type { Heading, Posture, RobotCommandSegment, RobotState, TileCoord } from "./types.js";

/**
 * Selectors 70..72 cost 10 ticks per record. With `stepped` (rules revision 2)
 * Upright↔Crouching is two records via Ducking; otherwise one record.
 */
export const postureChangeCostTicks = (from: Posture, to: Posture, stepped = false): number =>
  from === to ? 0 : (stepped ? postureChangeSteps(from, to).length : 1) * POSTURE_CHANGE_COST_TICKS;

/**
 * Selectors 24..31 cost 5 ticks per record. With `stepped` (rules revision 2)
 * a turn is one record per octant; otherwise one record.
 */
export const scanRotationCostTicks = (from: Heading, to: Heading, stepped = false): number =>
  from === to ? 0 : (stepped ? headingTurnSteps(from, to).length : 1) * SCAN_DIRECTION_COST_TICKS;

export const moveStepSize = (from: TileCoord, to: TileCoord): 1 | 2 | null => {
  const distance = chebyshevDistance(from, to);
  return distance === 1 || distance === 2 ? distance : null;
};

export const moveStepDurationTicks = (from: TileCoord, to: TileCoord): number | null => {
  const size = moveStepSize(from, to);
  return size === null ? null : moveStepCostTicks(size);
};

/** Duration of a non-move command when it starts from the supplied robot state. */
export const commandDurationTicks = (
  command: Exclude<RobotCommandSegment, { readonly kind: "move" }>,
  robot: RobotState,
  firingIntervalTicks?: number,
  stepped = false,
): number | null => {
  switch (command.kind) {
    case "deploy":
      return DEPLOY_COST_TICKS;
    case "set-posture":
      return postureChangeCostTicks(robot.posture, command.posture, stepped);
    case "set-scan-direction":
      return scanRotationCostTicks(robot.scanHeading, command.heading, stepped);
    case "aim-and-fire":
      return firingIntervalTicks ?? null;
    case "scan-and-fire":
      return null;
  }
};
