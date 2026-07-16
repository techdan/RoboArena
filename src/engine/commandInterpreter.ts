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
import type { Heading, Posture, RobotCommandSegment, RobotState, TileCoord } from "./types.js";

/** Selectors 70..72 set an absolute posture and all cost 10 ticks. */
export const postureChangeCostTicks = (from: Posture, to: Posture): number =>
  from === to ? 0 : POSTURE_CHANGE_COST_TICKS;

/** Selectors 24..31 set an absolute heading and all cost 5 ticks. */
export const scanRotationCostTicks = (from: Heading, to: Heading): number => {
  return from === to ? 0 : SCAN_DIRECTION_COST_TICKS;
};

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
): number | null => {
  switch (command.kind) {
    case "deploy":
      return DEPLOY_COST_TICKS;
    case "set-posture":
      return postureChangeCostTicks(robot.posture, command.posture);
    case "set-scan-direction":
      return scanRotationCostTicks(robot.scanHeading, command.heading);
    case "aim-and-fire":
      return firingIntervalTicks ?? null;
    case "scan-and-fire":
      return null;
  }
};
