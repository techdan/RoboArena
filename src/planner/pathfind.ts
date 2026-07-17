/** Deterministic eight-direction A* used by the Phase 9 order planner. */

import { canTraverse } from "../engine/traversal";
import type { Arena, Posture, TileCoord } from "../engine/types";

const DIRECTIONS = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
] as const;

export type PathFailure = "out-of-bounds" | "blocked" | "unreachable";
export type PathResult =
  | { readonly kind: "path"; readonly steps: readonly TileCoord[] }
  | { readonly kind: "error"; readonly reason: PathFailure };

export const tileKey = ({ x, y }: TileCoord): string => `${x},${y}`;

export const tileAt = (arena: Arena, coord: TileCoord) => arena.tiles[coord.y]?.[coord.x];

export const isInBounds = (arena: Arena, { x, y }: TileCoord): boolean =>
  x >= 0 && y >= 0 && x < arena.width && y < arena.height;

const heuristic = (from: TileCoord, to: TileCoord): number =>
  Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y));

/** Returns unit waypoints and deliberately ignores robot occupancy: robots may stack. */
export const findPath = (
  arena: Arena,
  start: TileCoord,
  goal: TileCoord,
  posture: Posture,
): PathResult => {
  if (!isInBounds(arena, goal)) return { kind: "error", reason: "out-of-bounds" };
  const goalTile = tileAt(arena, goal);
  if (goalTile === undefined || !canTraverse(posture, goalTile.terrain)) {
    return { kind: "error", reason: "blocked" };
  }
  if (start.x === goal.x && start.y === goal.y) return { kind: "path", steps: [] };

  const startKey = tileKey(start);
  const goalKey = tileKey(goal);
  const open = new Map<string, { readonly coord: TileCoord; readonly order: number }>();
  const closed = new Set<string>();
  const cameFrom = new Map<string, string>();
  const coords = new Map<string, TileCoord>([[startKey, start]]);
  const costs = new Map<string, number>([[startKey, 0]]);
  let insertionOrder = 0;
  open.set(startKey, { coord: start, order: insertionOrder });

  while (open.size > 0) {
    let currentKey: string | undefined;
    let currentOrder = Number.POSITIVE_INFINITY;
    let currentScore = Number.POSITIVE_INFINITY;
    for (const [key, candidate] of open) {
      const score = (costs.get(key) ?? Number.POSITIVE_INFINITY) + heuristic(candidate.coord, goal);
      if (score < currentScore || (score === currentScore && candidate.order < currentOrder)) {
        currentKey = key;
        currentScore = score;
        currentOrder = candidate.order;
      }
    }
    if (currentKey === undefined) break;
    const current = coords.get(currentKey);
    if (current === undefined) break;
    if (currentKey === goalKey) {
      const reversed: TileCoord[] = [];
      let cursor = goalKey;
      while (cursor !== startKey) {
        const coord = coords.get(cursor);
        const previous = cameFrom.get(cursor);
        if (coord === undefined || previous === undefined) {
          return { kind: "error", reason: "unreachable" };
        }
        reversed.push(coord);
        cursor = previous;
      }
      return { kind: "path", steps: reversed.reverse() };
    }

    open.delete(currentKey);
    closed.add(currentKey);
    const nextCost = (costs.get(currentKey) ?? 0) + 1;
    for (const direction of DIRECTIONS) {
      const neighbor = { x: current.x + direction.x, y: current.y + direction.y };
      if (!isInBounds(arena, neighbor)) continue;
      const neighborTile = tileAt(arena, neighbor);
      if (neighborTile === undefined || !canTraverse(posture, neighborTile.terrain)) continue;
      const neighborKey = tileKey(neighbor);
      if (closed.has(neighborKey) && nextCost >= (costs.get(neighborKey) ?? Infinity)) continue;
      if (nextCost < (costs.get(neighborKey) ?? Infinity)) {
        cameFrom.set(neighborKey, currentKey);
        coords.set(neighborKey, neighbor);
        costs.set(neighborKey, nextCost);
        insertionOrder += 1;
        open.set(neighborKey, { coord: neighbor, order: insertionOrder });
      }
    }
  }
  return { kind: "error", reason: "unreachable" };
};
