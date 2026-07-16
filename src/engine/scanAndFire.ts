/**
 * Deterministic Scan & Fire target acquisition (`docs/spec.md` §§6-7).
 *
 * Callers supply candidates in canonical Home-slot/roster order. Equal-distance
 * candidates retain that order until the original priority field is named.
 */

import { floorEuclideanDistance, isWithinScanCone } from "./geometry.js";
import { hasVisibilityLineOfSight } from "./visibility.js";
import type { Arena, RobotState, TileCoord } from "./types.js";

export interface ScanCandidate {
  readonly side: number;
  readonly robot: RobotState;
}

export interface ScanTarget {
  readonly robot: RobotState & { readonly position: TileCoord };
  readonly distance: number;
  readonly adjustedDistance: number;
  readonly alignmentMagnitude: number;
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

/**
 * RoboArena's 0..16 reconstruction of the original scan-grid alignment value.
 * The live-fire penalty bands and exact-boundary zero are confirmed; the
 * original grid value's UI label remains unnamed (`docs/spec.md` §6).
 */
export const scanAlignmentMagnitude = (
  from: TileCoord,
  heading: RobotState["scanHeading"],
  target: TileCoord,
): number => {
  if (from.x === target.x && from.y === target.y) return 16;
  const direction = HEADING_OFFSETS[heading];
  const headingX = direction.x;
  const headingY = direction.y;
  const targetX = target.x - from.x;
  const targetY = target.y - from.y;
  const dot = Math.max(0, headingX * targetX + headingY * targetY);
  const denominator =
    Math.sqrt(headingX ** 2 + headingY ** 2) * Math.sqrt(targetX ** 2 + targetY ** 2);
  return Math.max(0, Math.min(16, Math.ceil((dot * 16) / denominator)));
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
    if (
      distance > input.maxDistance ||
      !isWithinScanCone(input.shooter.position, input.shooter.scanHeading, robot.position) ||
      !hasVisibilityLineOfSight(input.arena, input.shooter.position, robot.position)
    ) {
      continue;
    }
    const alignmentMagnitude = scanAlignmentMagnitude(
      input.shooter.position,
      input.shooter.scanHeading,
      robot.position,
    );
    // seg18:0x0854 adds two only for the exact inclusive cone boundary.
    const adjustedDistance = distance + (alignmentMagnitude === 0 ? 2 : 0);
    if (selected === null || adjustedDistance < selected.adjustedDistance) {
      selected = {
        robot: { ...robot, position: robot.position },
        distance,
        adjustedDistance,
        alignmentMagnitude,
      };
    }
  }
  return selected;
};
