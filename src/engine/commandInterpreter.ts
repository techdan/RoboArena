/**
 * Pure command timing helpers for the Phase 2 resolver.
 *
 * Sourced from `docs/spec.md` §§3–6 and
 * `tasks/phase2-resolver-design.md`.
 */

import {
  DEPLOY_COST_TICKS,
  POSTURE_STEP_COST_TICKS,
  SCAN_ROTATION_COST_TICKS,
} from "./constants.js";
import { chebyshevDistance } from "./geometry.js";
import { moveStepCostTicks } from "./movement.js";
import type { Heading, Posture, RobotCommandSegment, RobotState, TileCoord } from "./types.js";

const POSTURE_INDEX: Readonly<Record<Posture, number>> = {
  upright: 0,
  ducking: 1,
  crouching: 2,
};

const HEADINGS: readonly Heading[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** A posture command pays once for each adjacent posture transition. */
export const postureChangeCostTicks = (from: Posture, to: Posture): number =>
  Math.abs(POSTURE_INDEX[from] - POSTURE_INDEX[to]) * POSTURE_STEP_COST_TICKS;

/**
 * Scan headings are 45° apart while the original clock charges two 22.5°
 * rotation units per heading step (RE §20 #12 remains provisional).
 */
export const scanRotationCostTicks = (from: Heading, to: Heading): number => {
  const fromIndex = HEADINGS.indexOf(from);
  const toIndex = HEADINGS.indexOf(to);
  const clockwise = Math.abs(fromIndex - toIndex);
  const headingSteps = Math.min(clockwise, HEADINGS.length - clockwise);
  return headingSteps * 2 * SCAN_ROTATION_COST_TICKS;
};

export const moveStepSize = (from: TileCoord, to: TileCoord): 1 | 2 | null => {
  const distance = chebyshevDistance(from, to);
  return distance === 1 || distance === 2 ? distance : null;
};

export const moveStepDurationTicks = (
  from: TileCoord,
  to: TileCoord,
  parity: 0 | 1,
): number | null => {
  const size = moveStepSize(from, to);
  return size === null ? null : moveStepCostTicks(size, parity);
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
