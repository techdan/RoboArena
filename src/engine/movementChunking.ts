/** Browser-safe unit-route compression shared by the engine and Phase 9 planner.
 * Sourced from `docs/spec.md` §5 Movement. */

import type { ArenaTile, MovementStep, TileCoord } from "./types.js";

const chebyshev = (left: TileCoord, right: TileCoord): number =>
  Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));

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
    if (!first || chebyshev(from, first) !== 1) return null;
    const firstTile = tileAt(first);
    if (!firstTile) return null;
    const second = unitSteps[index + 1];
    const secondTile = second ? tileAt(second) : undefined;
    if (
      second &&
      chebyshev(first, second) === 1 &&
      chebyshev(from, second) === 2 &&
      firstTile.terrain === "open" &&
      secondTile !== undefined &&
      secondTile.terrain === "open"
    ) {
      chunks.push({ to: second, via: first });
      from = second;
      index += 2;
    } else {
      chunks.push({ to: first });
      from = first;
      index += 1;
    }
  }
  return chunks;
};
