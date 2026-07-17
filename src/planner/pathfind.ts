/** Deterministic eight-direction A* used by the Phase 9 order planner. */

import { MOVE_DOUBLE_COST_TICKS, MOVE_SINGLE_COST_TICKS } from "../engine/constants";
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

const chebyshev = (from: TileCoord, to: TileCoord): number =>
  Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y));

const heuristic = (from: TileCoord, to: TileCoord): number => {
  const distance = chebyshev(from, to);
  return (
    Math.floor(distance / 2) * MOVE_DOUBLE_COST_TICKS + (distance % 2) * MOVE_SINGLE_COST_TICKS
  );
};

interface PathEdge {
  readonly previous: string;
  readonly steps: readonly TileCoord[];
}

interface CandidateMove {
  readonly destination: TileCoord;
  readonly steps: readonly TileCoord[];
  readonly cost: number;
}

const candidateMoves = (
  arena: Arena,
  from: TileCoord,
  posture: Posture,
): readonly CandidateMove[] => {
  const moves: CandidateMove[] = [];
  for (const direction of DIRECTIONS) {
    const first = { x: from.x + direction.x, y: from.y + direction.y };
    const firstTile = tileAt(arena, first);
    if (
      !isInBounds(arena, first) ||
      firstTile === undefined ||
      !canTraverse(posture, firstTile.terrain)
    ) {
      continue;
    }
    moves.push({ destination: first, steps: [first], cost: MOVE_SINGLE_COST_TICKS });
    if (firstTile.terrain !== "open") continue;
    for (const secondDirection of DIRECTIONS) {
      const second = { x: first.x + secondDirection.x, y: first.y + secondDirection.y };
      const secondTile = tileAt(arena, second);
      if (
        !isInBounds(arena, second) ||
        chebyshev(from, second) !== 2 ||
        secondTile?.terrain !== "open" ||
        !canTraverse(posture, secondTile.terrain)
      ) {
        continue;
      }
      moves.push({
        destination: second,
        steps: [first, second],
        cost: MOVE_DOUBLE_COST_TICKS,
      });
    }
  }
  return moves;
};

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
  const cameFrom = new Map<string, PathEdge>();
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
        const edge = cameFrom.get(cursor);
        if (coord === undefined || edge === undefined) {
          return { kind: "error", reason: "unreachable" };
        }
        reversed.push(...[...edge.steps].reverse());
        cursor = edge.previous;
      }
      return { kind: "path", steps: reversed.reverse() };
    }

    open.delete(currentKey);
    closed.add(currentKey);
    for (const move of candidateMoves(arena, current, posture)) {
      const nextCost = (costs.get(currentKey) ?? 0) + move.cost;
      const neighborKey = tileKey(move.destination);
      if (closed.has(neighborKey) && nextCost >= (costs.get(neighborKey) ?? Infinity)) continue;
      if (nextCost < (costs.get(neighborKey) ?? Infinity)) {
        cameFrom.set(neighborKey, { previous: currentKey, steps: move.steps });
        coords.set(neighborKey, move.destination);
        costs.set(neighborKey, nextCost);
        insertionOrder += 1;
        open.set(neighborKey, { coord: move.destination, order: insertionOrder });
      }
    }
  }
  return { kind: "error", reason: "unreachable" };
};
