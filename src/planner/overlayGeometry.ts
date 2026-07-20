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

import type { Heading, TileCoord } from "../engine/types";

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

const rayLengthInsideRect = (
  origin: PixelPoint,
  angle: number,
  width: number,
  height: number,
): number => {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const xLength =
    Math.abs(dx) < Number.EPSILON
      ? Number.POSITIVE_INFINITY
      : dx > 0
        ? (width - origin.x) / dx
        : -origin.x / dx;
  const yLength =
    Math.abs(dy) < Number.EPSILON
      ? Number.POSITIVE_INFINITY
      : dy > 0
        ? (height - origin.y) / dy
        : -origin.y / dy;
  return Math.min(xLength, yLength);
};

/**
 * The ray the ring labels ride along. Three candidates radiate from the wedge
 * center: the heading centerline and the two perpendicular boundary rays. The
 * one with the longest run before it leaves the arena wins, so a top-center
 * shooter facing S labels down the board's middle while an east-edge shooter
 * facing E labels down the boundary. Near-ties prefer the centerline, keeping
 * open-field poses centered rather than snapping to a boundary.
 */
export const labelRayAngle = (
  wedge: ConeWedge,
  arenaWidthPx: number,
  arenaHeightPx: number,
): number => {
  const headingAngle = (wedge.startAngle + wedge.endAngle) / 2;
  const candidates: readonly { readonly angle: number; readonly priority: number }[] = [
    { angle: headingAngle, priority: 2 },
    { angle: wedge.startAngle, priority: 1 },
    { angle: wedge.endAngle, priority: 1 },
  ];
  let bestAngle = headingAngle;
  let bestLength = Number.NEGATIVE_INFINITY;
  let bestPriority = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const length = rayLengthInsideRect(wedge.center, candidate.angle, arenaWidthPx, arenaHeightPx);
    if (
      length > bestLength + 1e-6 ||
      (Math.abs(length - bestLength) <= 1e-6 && candidate.priority > bestPriority)
    ) {
      bestLength = length;
      bestAngle = candidate.angle;
      bestPriority = candidate.priority;
    }
  }
  return bestAngle;
};

/** A ring label's radius, kind, and rendered size, supplied by the renderer. */
export interface RingLabelBox {
  readonly radiusPx: number;
  readonly kind: RingSpec["kind"];
  readonly width: number;
  readonly height: number;
}

/** Resolved label placement; `visible: false` means it was dropped to avoid overlap. */
export interface PlacedRingLabel {
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
}

// The firing envelope (max-range) is the most informative guide, then the
// near bonus, then the far penalty; when two labels cannot be separated the
// lower-ranked one is dropped rather than overlapped.
const LABEL_RANK: Readonly<Record<RingSpec["kind"], number>> = {
  "max-range": 3,
  "near-bonus": 2,
  "far-penalty": 1,
};
const LABEL_EDGE_MARGIN = 4;
const LABEL_GAP = 2;
const LABEL_NUDGE_STEP = 6;
const LABEL_MAX_NUDGES = 48;

interface PlacedBox {
  x: number;
  y: number;
  readonly halfWidth: number;
  readonly halfHeight: number;
  readonly rank: number;
  readonly index: number;
  visible: boolean;
}

const boxesOverlap = (a: PlacedBox, b: PlacedBox): boolean =>
  Math.abs(a.x - b.x) < a.halfWidth + b.halfWidth + LABEL_GAP &&
  Math.abs(a.y - b.y) < a.halfHeight + b.halfHeight + LABEL_GAP;

/**
 * Places every ring label along the chosen ray, each at its own radius so the
 * text stays visually attached to its arc. Labels are clamped inside the arena
 * so they never crop at the edge, then de-overlapped by their rendered bounds:
 * a collided label is nudged outward along the ray, and if that cannot clear it
 * (short runs, small arenas) the least informative of the pair is dropped.
 * Returns placements in the input order.
 */
export const placeRingLabels = (
  wedge: ConeWedge,
  rings: readonly RingLabelBox[],
  arenaWidthPx: number,
  arenaHeightPx: number,
  inwardOffsetPx = 8,
): readonly PlacedRingLabel[] => {
  const angle = labelRayAngle(wedge, arenaWidthPx, arenaHeightPx);
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const clampX = (x: number, halfWidth: number): number =>
    Math.min(
      arenaWidthPx - halfWidth - LABEL_EDGE_MARGIN,
      Math.max(halfWidth + LABEL_EDGE_MARGIN, x),
    );
  const clampY = (y: number, halfHeight: number): number =>
    Math.min(
      arenaHeightPx - halfHeight - LABEL_EDGE_MARGIN,
      Math.max(halfHeight + LABEL_EDGE_MARGIN, y),
    );
  const placed: PlacedBox[] = [];
  const byRadius = rings
    .map((ring, index) => ({ ring, index }))
    .sort((a, b) => a.ring.radiusPx - b.ring.radiusPx);
  for (const { ring, index } of byRadius) {
    const halfWidth = ring.width / 2;
    const halfHeight = ring.height / 2;
    const at = (radius: number): { x: number; y: number } => ({
      x: clampX(wedge.center.x + radius * ux, halfWidth),
      y: clampY(wedge.center.y + radius * uy, halfHeight),
    });
    let radius = ring.radiusPx - inwardOffsetPx;
    const start = at(radius);
    const box: PlacedBox = {
      x: start.x,
      y: start.y,
      halfWidth,
      halfHeight,
      rank: LABEL_RANK[ring.kind],
      index,
      visible: true,
    };
    for (let nudges = 0; nudges < LABEL_MAX_NUDGES; nudges += 1) {
      if (!placed.some((other) => other.visible && boxesOverlap(box, other))) break;
      radius += LABEL_NUDGE_STEP;
      const next = at(radius);
      if (Math.abs(next.x - box.x) < 0.01 && Math.abs(next.y - box.y) < 0.01) break;
      box.x = next.x;
      box.y = next.y;
    }
    const collider = placed.find((other) => other.visible && boxesOverlap(box, other));
    if (collider !== undefined) {
      if (box.rank <= collider.rank) box.visible = false;
      else collider.visible = false;
    }
    placed.push(box);
  }
  const result: PlacedRingLabel[] = rings.map(() => ({ x: 0, y: 0, visible: false }));
  for (const box of placed) result[box.index] = { x: box.x, y: box.y, visible: box.visible };
  return result;
};

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
