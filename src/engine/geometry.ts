/**
 * Pure deterministic geometry helpers.
 *
 * Combat distance is floored Euclidean (RE §4). Bresenham paths stay integer
 * and are shared by LoS, cover, and renderer path construction.
 */

import type { Heading, TileCoord } from "./types.js";

/** Exact combat/range/blast metric for arena-sized integer coordinates. */
export const floorEuclideanDistance = (a: TileCoord, b: TileCoord): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.floor(Math.sqrt(dx * dx + dy * dy));
};

/** Retained for rules that explicitly mean eight-neighbor adjacency. */
export const chebyshevDistance = (a: TileCoord, b: TileCoord): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

const HEADING_VECTORS: Readonly<Record<Heading, readonly [x: number, y: number]>> = {
  N: [0, -1],
  NE: [1, -1],
  E: [1, 0],
  SE: [1, 1],
  S: [0, 1],
  SW: [-1, 1],
  W: [-1, 0],
  NW: [-1, -1],
};

export const bearingDegrees = (from: TileCoord, to: TileCoord): number => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return 0;
  const radians = Math.atan2(dx, -dy);
  const degrees = (radians * 180) / Math.PI;
  return degrees < 0 ? degrees + 360 : degrees;
};

export const angleDelta = (a: number, b: number): number => {
  const delta = Math.abs(a - b) % 360;
  return delta > 180 ? 360 - delta : delta;
};

/**
 * Original hard firing gate: the closed forward semicircle. Integer dot
 * product preserves the exact inclusive ±90° boundary without floating point.
 */
export const isWithinScanCone = (
  shooterTile: TileCoord,
  shooterHeading: Heading,
  target: TileCoord,
): boolean => {
  if (shooterTile.x === target.x && shooterTile.y === target.y) return true;
  const [headingX, headingY] = HEADING_VECTORS[shooterHeading];
  const targetX = target.x - shooterTile.x;
  const targetY = target.y - shooterTile.y;
  return headingX * targetX + headingY * targetY >= 0;
};

/** Tiles crossed by a Bresenham line, excluding both endpoints. */
export const tilesAlongLineExclusive = (from: TileCoord, to: TileCoord): TileCoord[] => {
  const tiles: TileCoord[] = [];
  let x0 = from.x;
  let y0 = from.y;
  const x1 = to.x;
  const y1 = to.y;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (x0 !== x1 || y0 !== y1) {
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
    if (x0 === x1 && y0 === y1) break;
    tiles.push({ x: x0, y: y0 });
  }

  return tiles;
};
