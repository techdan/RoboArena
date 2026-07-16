/**
 * Deterministic Scan & Fire target acquisition (`docs/spec.md` §§6-7).
 *
 * Callers supply candidates in canonical Home-slot/roster order. Equal adjusted
 * distances prefer the larger scan-grid sight value, then retain canonical order.
 */

import { floorEuclideanDistance, isWithinScanCone } from "./geometry.js";
import { scanSightStrength } from "./visibility.js";
import type { Arena, RobotState, TileCoord } from "./types.js";

export interface ScanCandidate {
  readonly side: number;
  readonly robot: RobotState;
}

export interface ScanTarget {
  readonly robot: RobotState & { readonly position: TileCoord };
  readonly distance: number;
  readonly adjustedDistance: number;
  readonly scanStrength: number;
}

const isOnArena = (position: RobotState["position"]): position is TileCoord => position !== "dock";

const HEADING_OFFSETS: Readonly<Record<RobotState["scanHeading"], TileCoord>> = {
  N: { x: 0, y: -1 },
  NE: { x: 1, y: -1 },
  E: { x: 1, y: 0 },
  SE: { x: 1, y: 1 },
  S: { x: 0, y: 1 },
  SW: { x: -1, y: 1 },
  W: { x: -1, y: 0 },
  NW: { x: -1, y: -1 },
};

/** Exact inclusive cone boundary used by `seg18:0x0854`'s +2 rank adjustment. */
export const isOnScanConeBoundary = (
  from: TileCoord,
  heading: RobotState["scanHeading"],
  target: TileCoord,
): boolean => {
  if (from.x === target.x && from.y === target.y) return false;
  const direction = HEADING_OFFSETS[heading];
  const targetX = target.x - from.x;
  const targetY = target.y - from.y;
  return direction.x * targetX + direction.y * targetY === 0;
};

export const findScanAndFireTarget = (input: {
  readonly arena: Arena;
  readonly shooter: RobotState & { readonly position: TileCoord };
  readonly shooterSide: number;
  readonly candidates: readonly ScanCandidate[];
  readonly maxDistance: number;
}): ScanTarget | null => {
  let selected: ScanTarget | null = null;
  for (const candidate of input.candidates) {
    const robot = candidate.robot;
    if (candidate.side === input.shooterSide || robot.hp <= 0 || !isOnArena(robot.position)) {
      continue;
    }
    const distance = floorEuclideanDistance(input.shooter.position, robot.position);
    const insideCone = isWithinScanCone(
      input.shooter.position,
      input.shooter.scanHeading,
      robot.position,
    );
    if (distance > input.maxDistance || !insideCone) {
      continue;
    }
    const scanStrength = scanSightStrength(input.arena, input.shooter.position, robot.position);
    if (scanStrength === 0) {
      continue;
    }
    // seg18:0x0854 adds two only for the exact inclusive cone boundary.
    const adjustedDistance =
      distance +
      (isOnScanConeBoundary(input.shooter.position, input.shooter.scanHeading, robot.position)
        ? 2
        : 0);
    if (
      selected === null ||
      adjustedDistance < selected.adjustedDistance ||
      (adjustedDistance === selected.adjustedDistance && scanStrength > selected.scanStrength)
    ) {
      selected = {
        robot: { ...robot, position: robot.position },
        distance,
        adjustedDistance,
        scanStrength,
      };
    }
  }
  return selected;
};
