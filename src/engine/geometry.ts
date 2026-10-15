/**
 * Pure deterministic geometry helpers.
 *
 * Combat distance is floored Euclidean (RE §4). Bresenham paths stay integer
 * and are shared by LoS, cover, and renderer path construction.
 */

import type { Arena, Heading, TileCoord } from "./types.js";

/**
 * The original integer square root, seg9:0x0530. Its final fix-up returns one
 * less than the true floor for even perfect squares (isqrt(100) = 9).
 */
const originalIsqrt = (value: number): number => {
  let bx = 32;
  let cx = 0;
  for (let step = 16; step !== 0; step >>= 1) {
    cx = bx;
    bx = bx * bx < value ? bx + step : bx - step;
  }
  if (bx * bx > value) {
    if (cx > bx) return bx - 1;
    return cx * cx > value ? cx - 1 : cx;
  }
  if (cx < bx) return bx;
  return cx * cx < value ? cx : bx;
};

const tableDistance = (dx: number, dy: number): number => originalIsqrt(dx * dx + dy * dy);

/**
 * Exact combat/range/blast metric, seg56:0x02A0 (RE §4). Axis-aligned deltas
 * return the other delta unclamped; otherwise the 32×32 table built from the
 * original isqrt is used, halving both deltas once (and doubling the result)
 * above 32, and returning 64 above 63. The table is floor(√(dx²+dy²)) except
 * for six Pythagorean pairs such as (6, 8), which read one lower.
 */
export const floorEuclideanDistance = (a: TileCoord, b: TileCoord): number => {
  let dx = Math.abs(a.x - b.x);
  let dy = Math.abs(a.y - b.y);
  if (dx === 0) return dy;
  if (dy === 0) return dx;
  if (dx > 32 || dy > 32) {
    if (dx > 63 || dy > 63) return 64;
    dx >>= 1;
    dy >>= 1;
    if (dx === 0) return dy * 2;
    if (dy === 0) return dx * 2;
    return tableDistance(dx, dy) * 2;
  }
  return tableDistance(dx, dy);
};

/** Retained for rules that explicitly mean eight-neighbor adjacency. */
export const chebyshevDistance = (a: TileCoord, b: TileCoord): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

interface EndpointSamples {
  readonly center: TileCoord;
  readonly major?: TileCoord;
  readonly diagonal?: TileCoord;
}

/** Exact target-end cover sampling produced by seg87:0x1BF8 → 0x1CE0 (spec §6). */
export const targetCoverSamples = (from: TileCoord, to: TileCoord): EndpointSamples => {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const distance = Math.max(dx, dy);
  if (distance === 0) return { center: to };

  const stepX = Math.sign(from.x - to.x);
  const stepY = Math.sign(from.y - to.y);
  const xMajor = dx > dy; // Ties are y-major in the original.
  const major =
    distance >= 2
      ? xMajor
        ? { x: to.x + stepX, y: to.y }
        : { x: to.x, y: to.y + stepY }
      : undefined;
  const diagonal =
    distance > 1 && Math.abs(dx - dy) < 2 ? { x: to.x + stepX, y: to.y + stepY } : undefined;

  return {
    center: to,
    ...(major === undefined ? {} : { major }),
    ...(diagonal === undefined ? {} : { diagonal }),
  };
};

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

/**
 * Closed ±45° front arc around the shooter's heading, seg21:0x0F0A. A target
 * outside it halves the live-fire hit score (RE §7b). Same tile counts as inside.
 */
export const isWithinFrontArc = (
  shooterTile: TileCoord,
  shooterHeading: Heading,
  target: TileCoord,
): boolean => {
  const vx = target.x - shooterTile.x;
  const vy = target.y - shooterTile.y;
  if (vx === 0 && vy === 0) return true;
  const [hx, hy] = HEADING_VECTORS[shooterHeading];
  if (hx !== 0 && hy !== 0) return hx * vx >= 0 && hy * vy >= 0;
  return hx * vx + hy * vy >= Math.abs(hx * vy - hy * vx);
};

/**
 * Tiles visited by the original sight walker, seg56:0x0360. It runs Bresenham
 * on 5× sub-tile centres (x*5+2), ties y-major, and reports each newly entered
 * tile. The start tile is never reported and the end tile always is. An
 * original bug compares tiles against the scaled end point, so an intermediate
 * tile equal to (5*x2+2, 5*y2+2) is skipped.
 */
export const sightWalkTiles = (from: TileCoord, to: TileCoord): TileCoord[] => {
  if (from.x === to.x && from.y === to.y) return [];
  let fx = from.x * 5 + 2;
  let fy = from.y * 5 + 2;
  const ex = to.x * 5 + 2;
  const ey = to.y * 5 + 2;
  const dx = Math.abs(ex - fx);
  const dy = Math.abs(ey - fy);
  const xMajor = dx > dy;
  let count = xMajor ? dx : dy;
  let err = xMajor ? 2 * dy - dx : 2 * dx - dy;
  const straightIncrement = xMajor ? 2 * dy : 2 * dx;
  const diagonalIncrement = xMajor ? 2 * (dy - dx) : 2 * (dx - dy);
  const sx = fx === ex ? 0 : fx > ex ? -1 : 1;
  const sy = fy === ey ? 0 : fy > ey ? -1 : 1;
  let previousX = from.x;
  let previousY = from.y;
  const tiles: TileCoord[] = [];
  while (count > 0) {
    if (xMajor) {
      fx += sx;
      if (err < 0) err += straightIncrement;
      else {
        fy += sy;
        err += diagonalIncrement;
      }
    } else {
      fy += sy;
      if (err < 0) err += straightIncrement;
      else {
        fx += sx;
        err += diagonalIncrement;
      }
    }
    const tileX = Math.floor(fx / 5);
    const tileY = Math.floor(fy / 5);
    if (tileX !== previousX || tileY !== previousY) {
      if (tileX !== ex || tileY !== ey) tiles.push({ x: tileX, y: tileY });
      previousX = tileX;
      previousY = tileY;
    }
    count -= 1;
  }
  return tiles;
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

const geometryTileAt = (arena: Arena, tile: TileCoord) => arena.tiles[tile.y]?.[tile.x];

/**
 * Exact scan-grid sight value from `seg87:0x19E3`.
 *
 * Clear sight starts at 16. The tiles come from the original sight walker
 * (`sightWalkTiles`): the shooter's own tile is not sampled, the target tile
 * is. Every Low Wall or Bush sample removes 3; Walls, Outer Walls and
 * off-arena tiles return 0. Crevices and ordinary ground do not cut the value.
 */
export const scanSightStrength = (arena: Arena, from: TileCoord, to: TileCoord): number => {
  if (geometryTileAt(arena, from) === undefined || geometryTileAt(arena, to) === undefined)
    return 0;
  if (from.x === to.x && from.y === to.y) return 16;

  let strength = 16;
  for (const tile of sightWalkTiles(from, to)) {
    const terrain = geometryTileAt(arena, tile)?.terrain;
    if (terrain === undefined || terrain === "wall" || terrain === "outer-wall") return 0;
    if (terrain === "low-wall" || terrain === "bush") {
      strength = Math.max(0, strength - 3);
    }
  }
  return strength;
};

/**
 * `seg18:0x0854` adds two to a candidate's rank distance unless seg21:0x0CCF
 * flagged it inside the closed ±45° inner cone. A same-tile candidate is never
 * flagged inner and so also takes the +2.
 */
export const scanRankPenalty = (from: TileCoord, heading: Heading, target: TileCoord): 0 | 2 =>
  from.x !== target.x || from.y !== target.y
    ? isWithinFrontArc(from, heading, target)
      ? 0
      : 2
    : 2;
