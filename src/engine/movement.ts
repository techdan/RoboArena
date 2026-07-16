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
import { chebyshevDistance } from "./geometry.js";
import type { ArenaTile, MovementStep, Posture, Terrain, TileCoord } from "./types.js";

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

/** TIL movement property 2: eligible to participate in a two-tile command. */
export const isFullSpeedTerrain = (terrain: Terrain): boolean => terrain === "open";

/** Convenience: same as `isFullSpeedTerrain` for an `ArenaTile`. */
export const isFullSpeedTile = (tile: ArenaTile): boolean => isFullSpeedTerrain(tile.terrain);

/**
 * Whether a robot of the given posture can walk ONTO this terrain.
 *
 * Upright/Ducking: any non-wall, non-crevice, non-outer-wall.
 * Crouching: only open ground.
 *
 * Note the distinction between *traversal* (walking onto) and *occupancy*
 * (already being on a tile when crouching). A standing robot on a low wall
 * can crouch in place — it occupies the low wall but did not walk onto it
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

/**
 * Compress a contiguous tile-by-tile route into original one-/two-tile
 * command steps. Two-tile steps retain the selected intermediate waypoint.
 * Returns `null` for a malformed route or missing tile.
 *
 * Two consecutive unit steps are paired only when both entered tiles are
 * full-speed terrain. A slow entered tile therefore forces a 30-tick single
 * without introducing a separate terrain multiplier or stride state.
 */
export const chunkMovementPath = (
  start: TileCoord,
  unitSteps: readonly TileCoord[],
  tileAt: (coord: TileCoord) => ArenaTile | undefined,
): readonly MovementStep[] | null => {
  const chunks: MovementStep[] = [];
  let from = start;
  let index = 0;

  while (index < unitSteps.length) {
    const first = unitSteps[index];
    if (!first || chebyshevDistance(from, first) !== 1) return null;
    const firstTile = tileAt(first);
    if (!firstTile) return null;

    const second = unitSteps[index + 1];
    const secondTile = second ? tileAt(second) : undefined;
    if (
      second &&
      chebyshevDistance(first, second) === 1 &&
      chebyshevDistance(from, second) === 2 &&
      isFullSpeedTile(firstTile) &&
      secondTile !== undefined &&
      isFullSpeedTile(secondTile)
    ) {
      chunks.push({ to: second, via: first });
      from = second;
      index += 2;
      continue;
    }

    chunks.push({ to: first });
    from = first;
    index += 1;
  }

  return chunks;
};
