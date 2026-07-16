/**
 * Arena setup primitives from `docs/spec.md` §9 / RE §12.
 *
 * Home rectangles are derived from playing-field dimensions in the original;
 * they are not stored in the `.TWN` MAP or INF chunks.
 */

import type { HomeArea, TileCoord } from "./types.js";

/** Exact `seg87:0x1F32` home span for one arena axis. */
export const homeAreaSpan = (axisSize: number): number => {
  if (axisSize >= 48) return 16;
  if (axisSize >= 32) return 12;
  if (axisSize >= 20) return 8;
  return 6;
};

const rectangleTiles = (
  originX: number,
  originY: number,
  width: number,
  height: number,
): readonly TileCoord[] =>
  Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => ({ x: originX + x, y: originY + y })),
  ).flat();

/** Original clockwise team-box order: NW, NE, SE, SW. */
export const createHomeAreas = (arenaWidth: number, arenaHeight: number): readonly HomeArea[] => {
  const width = homeAreaSpan(arenaWidth);
  const height = homeAreaSpan(arenaHeight);
  return [
    { corner: "NW", tiles: rectangleTiles(0, 0, width, height) },
    { corner: "NE", tiles: rectangleTiles(arenaWidth - width, 0, width, height) },
    {
      corner: "SE",
      tiles: rectangleTiles(arenaWidth - width, arenaHeight - height, width, height),
    },
    { corner: "SW", tiles: rectangleTiles(0, arenaHeight - height, width, height) },
  ];
};
