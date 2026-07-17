/**
 * Movement step-cost calculation.
 *
 * From `docs/spec.md` §"Movement":
 *   - Single tile move: 30 ticks (0.5 s).
 *   - Double tile move: 40 ticks (2/3 s).
 *   - Upright/Ducking share traversal; Crouching is restricted to open ground.
 *   - Crouching can only walk onto Open Ground (other terrain blocks it).
 *
 * Slow terrain is represented by restricting the available two-tile commands.
 * A two-tile command is legal only when every entered tile is full-speed open
 * ground. Rough, bush, and low-wall destinations are retained as one-tile
 * waypoints and therefore cost 30 ticks per entered tile.
 */

import { MOVE_DOUBLE_COST_TICKS, MOVE_SINGLE_COST_TICKS } from "./constants.js";
export { chunkMovementPath } from "./movementChunking.js";
export { canTraverse, canTraverseTile, isFullSpeedTerrain, isFullSpeedTile } from "./traversal.js";

/**
 * Cost in ticks for one encoded movement command.
 *  - stepSize = 1 → 30 ticks
 *  - stepSize = 2 → 40 ticks
 *
 * Triple+ tile chunks are not yet observed; the engine ships single+double only.
 * Pathfinder is responsible for chunking long runs into 1- and 2-tile pieces.
 */
export const moveStepCostTicks = (stepSize: 1 | 2): number =>
  stepSize === 1 ? MOVE_SINGLE_COST_TICKS : MOVE_DOUBLE_COST_TICKS;
