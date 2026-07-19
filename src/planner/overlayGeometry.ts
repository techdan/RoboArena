/**
 * Pure geometry for the targeting overlay guides (spec §6): shooter-centered
 * distance rings at the real engine breakpoints and the two-ray + arc wedge
 * marking the confirmed ±90° firing half-plane.
 *
 * Ring exactness: floored-Euclidean distance ≤ r is equivalent to the tile
 * center lying strictly inside the circle of radius (r + 1) tile units around
 * the shooter's tile center, so the drawn circle passes precisely along the
 * threshold between the last included and first excluded tile centers.
 */

import type { Heading, TileCoord } from "../engine/types.js";

const HEADING_VECTORS: Readonly<Record<Heading, readonly [number, number]>> = {
  N: [0, -1],
  NE: [1, -1],
  E: [1, 0],
  SE: [1, 1],
  S: [0, 1],
  SW: [-1, 1],
  W: [-1, 0],
  NW: [-1, -1],
};

export interface PixelPoint {
  readonly x: number;
  readonly y: number;
}

export const tileCenterPx = (tile: TileCoord, tileSize: number): PixelPoint => ({
  x: tile.x * tileSize + tileSize / 2,
  y: tile.y * tileSize + tileSize / 2,
});

/** Pixel radius of the circle bounding floored-Euclidean distance ≤ radius. */
export const ringRadiusPx = (radius: number, tileSize: number): number => (radius + 1) * tileSize;

export interface RingSpec {
  readonly radius: number;
  readonly kind: "near-bonus" | "far-penalty" | "max-range";
  readonly label: string;
}

/**
 * Rings to draw for the current tool. Direct fire marks the damage
 * breakpoints (distance < 5 adds 4, distance > 12 subtracts 4) plus the
 * selected maximum distance; a breakpoint at or beyond the maximum is
 * suppressed as redundant. Explosives have no direct-fire damage ladder, so
 * only the range limit is shown.
 */
export const damageRings = (
  maxDistance: number,
  resolution: "direct-hit-roll" | "blast",
): readonly RingSpec[] => {
  const rings: RingSpec[] = [];
  if (resolution === "direct-hit-roll") {
    if (maxDistance > 4) rings.push({ radius: 4, kind: "near-bonus", label: "+4 dmg inside" });
    if (maxDistance > 12) rings.push({ radius: 12, kind: "far-penalty", label: "−4 dmg beyond" });
  }
  rings.push({ radius: maxDistance, kind: "max-range", label: `≤${maxDistance} tiles` });
  return rings;
};

export interface ConeWedge {
  readonly center: PixelPoint;
  /** Boundary ray endpoints along the exact perpendicular gate line. */
  readonly rayA: PixelPoint;
  readonly rayB: PixelPoint;
  /** Arc sweep (canvas angles, y-down) spanning the allowed half-plane. */
  readonly startAngle: number;
  readonly endAngle: number;
}

/**
 * The firing gate is the closed forward half-plane `dot(heading, delta) ≥ 0`.
 * Its boundary is the line through the shooter center perpendicular to the
 * heading; the wedge draws that line's two rays plus the arc between them on
 * the heading side.
 */
export const coneWedge = (
  origin: TileCoord,
  heading: Heading,
  radiusPx: number,
  tileSize: number,
): ConeWedge => {
  const center = tileCenterPx(origin, tileSize);
  const [headingX, headingY] = HEADING_VECTORS[heading];
  const theta = Math.atan2(headingY, headingX);
  const startAngle = theta - Math.PI / 2;
  const endAngle = theta + Math.PI / 2;
  return {
    center,
    rayA: {
      x: center.x + radiusPx * Math.cos(startAngle),
      y: center.y + radiusPx * Math.sin(startAngle),
    },
    rayB: {
      x: center.x + radiusPx * Math.cos(endAngle),
      y: center.y + radiusPx * Math.sin(endAngle),
    },
    startAngle,
    endAngle,
  };
};
