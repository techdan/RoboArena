/**
 * Pure geometry helpers — Chebyshev distance, scan-cone classification,
 * tile-line tracing for bullet paths.
 *
 * No engine state, no RNG; these are deterministic functions of inputs.
 */

import {
  SCAN_BLACK_ZONE_HALF_WIDTH_DEGREES,
  SCAN_CONE_HALF_WIDTH_DEGREES,
} from "./constants.js";
import type { Heading, TileCoord } from "./types.js";

// ──────────────────────────────────────────────────────────────────────────
// Distance

/** King-move distance, used for both range checks and missile blast radius. */
export const chebyshevDistance = (a: TileCoord, b: TileCoord): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// ──────────────────────────────────────────────────────────────────────────
// Headings (8-direction compass)

const HEADING_DEGREES: Readonly<Record<Heading, number>> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

/** Bearing in degrees from `from` to `to`, clockwise from N. Returns 0..360. */
export const bearingDegrees = (from: TileCoord, to: TileCoord): number => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return 0;
  // y grows down (screen-style); flip dy for compass math (N = -dy)
  const radians = Math.atan2(dx, -dy);
  let degrees = (radians * 180) / Math.PI;
  if (degrees < 0) degrees += 360;
  return degrees;
};

/** Smallest absolute angle between two bearings, in [0, 180]. */
export const angleDelta = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

export type ScanZone = "black" | "grey" | "blocked";

/**
 * Classify where `target` falls in the shooter's scan cone.
 *  - "black": inside ±SCAN_BLACK_ZONE_HALF_WIDTH_DEGREES (45°), full hit chance
 *  - "grey":  inside ±SCAN_CONE_HALF_WIDTH_DEGREES (90°) but outside black, low hit chance
 *  - "blocked": outside the cone entirely, can't fire ("angle blocked")
 */
export const classifyScanZone = (
  shooterTile: TileCoord,
  shooterHeading: Heading,
  target: TileCoord,
): ScanZone => {
  if (shooterTile.x === target.x && shooterTile.y === target.y) return "black";
  const targetBearing = bearingDegrees(shooterTile, target);
  const headingBearing = HEADING_DEGREES[shooterHeading];
  const delta = angleDelta(targetBearing, headingBearing);
  if (delta <= SCAN_BLACK_ZONE_HALF_WIDTH_DEGREES) return "black";
  if (delta <= SCAN_CONE_HALF_WIDTH_DEGREES) return "grey";
  return "blocked";
};

// ──────────────────────────────────────────────────────────────────────────
// Line-of-sight tile tracing (Bresenham-style; integer-only, deterministic)

/**
 * Tiles the bullet passes through from `from` to `to`, EXCLUSIVE of both
 * endpoints. Used for wall-blocking and in-transit cover detection.
 *
 * Pure integer Bresenham — never floating-point, so identical input → identical output
 * across machines (replay determinism contract).
 */
export const tilesAlongLineExclusive = (
  from: TileCoord,
  to: TileCoord,
): TileCoord[] => {
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
