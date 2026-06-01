/**
 * Movement step-cost calculation.
 *
 * From `docs/spec.md` §"Movement":
 *   - Single tile move: alternates 0.3 / 0.7 s (parity 0/1).
 *   - Double tile move: alternates 0.4 / 0.8 s.
 *   - Stride parity persists across non-move commands; only resets on deployment.
 *   - Standing/crouching have identical costs on Open Ground.
 *   - Crouching can only walk onto Open Ground (other terrain blocks it).
 *
 * NB: standing posture moves freely on all passable terrain, all at the same cost
 * (DOS-confirmed: terrain doesn't slow upright movement).
 */

import {
  MOVE_DOUBLE_COST_TICKS,
  MOVE_SINGLE_COST_TICKS,
} from "./constants.js";
import type { ArenaTile, Posture, Terrain } from "./types.js";

/**
 * Cost in ticks for one step of given size at given parity.
 *  - stepSize = 1 → 0.3 / 0.7 s (alt by parity)
 *  - stepSize = 2 → 0.4 / 0.8 s (alt by parity)
 *
 * Triple+ tile chunks are not yet observed; the engine ships single+double only.
 * Pathfinder is responsible for chunking long runs into 1- and 2-tile pieces.
 */
export const moveStepCostTicks = (
  stepSize: 1 | 2,
  parity: 0 | 1,
): number => {
  return stepSize === 1
    ? MOVE_SINGLE_COST_TICKS[parity]
    : MOVE_DOUBLE_COST_TICKS[parity];
};

/** Flips parity 0→1 or 1→0. */
export const flipParity = (p: 0 | 1): 0 | 1 => (p === 0 ? 1 : 0);

/**
 * Whether a robot of the given posture can walk ONTO this terrain.
 *
 * Standing: any non-wall, non-crevice, non-outer-wall.
 * Crouching: only open ground.
 *
 * Note the distinction between *traversal* (walking onto) and *occupancy*
 * (already being on a tile when crouching). A standing robot on a low wall
 * can crouch in place — it occupies the low wall but didn't walk onto it
 * while crouched. The engine enforces traversal at planner-time when the
 * player draws a path.
 */
export const canTraverse = (posture: Posture, terrain: Terrain): boolean => {
  if (terrain === "wall" || terrain === "outer-wall" || terrain === "crevice") {
    return false;
  }
  if (posture === "crouching" && terrain !== "open") {
    return false;
  }
  return true;
};

/** Convenience: same as canTraverse for an `ArenaTile`. */
export const canTraverseTile = (posture: Posture, tile: ArenaTile): boolean =>
  canTraverse(posture, tile.terrain);
