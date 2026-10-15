/**
 * Deterministic Scan & Fire target acquisition (`docs/spec.md` §§6-7).
 *
 * Callers supply candidates in canonical Home-slot/roster order. Rank distance
 * is the distance plus 2 outside the ±45° inner cone; equal ranks prefer the
 * larger scan-grid sight value, then retain canonical order (seg18:0x072C).
 */

import { floorEuclideanDistance, isWithinScanCone, scanRankPenalty } from "./geometry.js";
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

export { scanRankPenalty };

export const findScanAndFireTarget = (input: {
  readonly arena: Arena;
  readonly shooter: RobotState & { readonly position: TileCoord };
  readonly shooterSide: number;
  readonly candidates: readonly ScanCandidate[];
  readonly maxDistance: number;
  /**
   * Rules revision 4: the sight value seg96:0x1FC5 returns, the spotting
   * pass's cached pair value when the shooter's Team has the target spotted,
   * else 0 (not a candidate). Omitted, sight is walked fresh.
   */
  readonly sightOf?: (target: RobotState & { readonly position: TileCoord }) => number;
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
    const scanStrength = input.sightOf
      ? input.sightOf({ ...robot, position: robot.position })
      : scanSightStrength(input.arena, input.shooter.position, robot.position);
    if (scanStrength === 0) {
      continue;
    }
    const adjustedDistance =
      distance + scanRankPenalty(input.shooter.position, input.shooter.scanHeading, robot.position);
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
