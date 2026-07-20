import { describe, expect, it } from "vitest";
import { makeOpenArena, makeRobot } from "../engine/__fixtures__/match";
import type { Heading } from "../engine/types";
import { previewTargetingTiles } from "./firingHelpers";
import {
  coneWedge,
  damageRings,
  labelRayAngle,
  placeRingLabels,
  ringRadiusPx,
  tileCenterPx,
  type RingLabelBox,
} from "./overlayGeometry";

const HEADINGS: readonly Heading[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

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

describe("ringRadiusPx", () => {
  it("bounds floored-Euclidean inclusion at (r + 1) tile units", () => {
    expect(ringRadiusPx(4, 24)).toBe(5 * 24);
    expect(ringRadiusPx(18, 24)).toBe(19 * 24);
  });
});

describe("damageRings", () => {
  it("marks both damage breakpoints plus the range limit at full range", () => {
    expect(damageRings(18, "direct-hit-roll").map((ring) => ring.radius)).toEqual([4, 12, 18]);
  });

  it("suppresses breakpoints at or beyond the selected maximum", () => {
    expect(damageRings(12, "direct-hit-roll").map((ring) => ring.kind)).toEqual([
      "near-bonus",
      "max-range",
    ]);
    expect(damageRings(4, "direct-hit-roll").map((ring) => ring.kind)).toEqual(["max-range"]);
    expect(damageRings(3, "direct-hit-roll")).toHaveLength(1);
  });

  it("shows only the range limit for explosives", () => {
    expect(damageRings(18, "blast").map((ring) => ring.kind)).toEqual(["max-range"]);
  });
});

describe("coneWedge", () => {
  it("puts both rays exactly on the perpendicular gate line for all 8 headings", () => {
    for (const heading of HEADINGS) {
      const wedge = coneWedge({ x: 10, y: 10 }, heading, 120, 24);
      const [headingX, headingY] = HEADING_VECTORS[heading];
      for (const ray of [wedge.rayA, wedge.rayB]) {
        const dot = headingX * (ray.x - wedge.center.x) + headingY * (ray.y - wedge.center.y);
        expect(Math.abs(dot)).toBeLessThan(1e-9);
      }
    }
  });

  it("sweeps the arc across the heading side", () => {
    for (const heading of HEADINGS) {
      const wedge = coneWedge({ x: 10, y: 10 }, heading, 120, 24);
      const [headingX, headingY] = HEADING_VECTORS[heading];
      const midAngle = (wedge.startAngle + wedge.endAngle) / 2;
      const mid = {
        x: wedge.center.x + 120 * Math.cos(midAngle),
        y: wedge.center.y + 120 * Math.sin(midAngle),
      };
      const dot = headingX * (mid.x - wedge.center.x) + headingY * (mid.y - wedge.center.y);
      expect(dot).toBeGreaterThan(0);
    }
  });
});

describe("labelRayAngle", () => {
  // 32×32 arena → 768px; positions chosen to exercise the four review poses.
  const ARENA = 768;

  it("runs a top-center shooter facing S down the heading centerline", () => {
    const wedge = coneWedge({ x: 16, y: 0 }, "S", 480, 24);
    const centerline = (wedge.startAngle + wedge.endAngle) / 2;
    const angle = labelRayAngle(wedge, ARENA, ARENA);
    expect(angle).toBeCloseTo(centerline);
    expect(angle).not.toBeCloseTo(wedge.startAngle);
    expect(angle).not.toBeCloseTo(wedge.endAngle);
  });

  it("runs an east-edge shooter facing E down the longer boundary, not the centerline", () => {
    const wedge = coneWedge({ x: 31, y: 15 }, "E", 480, 24);
    const centerline = (wedge.startAngle + wedge.endAngle) / 2;
    const angle = labelRayAngle(wedge, ARENA, ARENA);
    // South boundary has the longest run from a slightly-south-of-center east edge.
    expect(angle).toBeCloseTo(wedge.endAngle);
    expect(angle).not.toBeCloseTo(centerline);
  });

  it("picks the diagonal centerline for a corner shooter facing into the board", () => {
    const wedge = coneWedge({ x: 0, y: 0 }, "SE", 480, 24);
    const centerline = (wedge.startAngle + wedge.endAngle) / 2;
    // Both boundaries (NE/SW) exit almost immediately; the SE diagonal is longest.
    expect(labelRayAngle(wedge, ARENA, ARENA)).toBeCloseTo(centerline);
  });
});

describe("placeRingLabels", () => {
  const ARENA = 768;
  const overlap = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    w: number,
    h: number,
  ) => Math.abs(a.x - b.x) < w && Math.abs(a.y - b.y) < h;

  it("places each label at its own radius along the shared ray when they fit", () => {
    const wedge = coneWedge({ x: 16, y: 0 }, "S", 480, 24);
    const rings: readonly RingLabelBox[] = [
      { radiusPx: ringRadiusPx(4, 24), kind: "near-bonus", width: 44, height: 12 },
      { radiusPx: ringRadiusPx(12, 24), kind: "far-penalty", width: 52, height: 12 },
      { radiusPx: ringRadiusPx(18, 24), kind: "max-range", width: 48, height: 12 },
    ];
    const placed = placeRingLabels(wedge, rings, ARENA, ARENA);
    expect(placed.every((label) => label.visible)).toBe(true);
    // All share the vertical centerline x and increase in y with radius.
    expect(placed[1]!.x).toBeCloseTo(placed[0]!.x);
    expect(placed[1]!.y).toBeGreaterThan(placed[0]!.y);
    expect(placed[2]!.y).toBeGreaterThan(placed[1]!.y);
  });

  it("drops the least informative label when boxes cannot be separated", () => {
    const wedge = coneWedge({ x: 31, y: 15 }, "E", 480, 24);
    // Tall boxes on a boundary run that clamps near the arena edge: the outer
    // max-range collides with the far-penalty and cannot nudge past the clamp.
    const rings: readonly RingLabelBox[] = [
      { radiusPx: ringRadiusPx(4, 24), kind: "near-bonus", width: 60, height: 120 },
      { radiusPx: ringRadiusPx(12, 24), kind: "far-penalty", width: 60, height: 120 },
      { radiusPx: ringRadiusPx(18, 24), kind: "max-range", width: 60, height: 120 },
    ];
    const placed = placeRingLabels(wedge, rings, ARENA, ARENA);
    // The far-penalty (lowest rank) is sacrificed; the envelope + bonus survive.
    expect(placed[1]!.visible).toBe(false);
    expect(placed[0]!.visible).toBe(true);
    expect(placed[2]!.visible).toBe(true);
    const visible = placed.filter((label) => label.visible);
    for (let i = 0; i < visible.length; i += 1)
      for (let j = i + 1; j < visible.length; j += 1)
        expect(overlap(visible[i]!, visible[j]!, 30 + 30 + 2, 60 + 60 + 2)).toBe(false);
  });
});

describe("drawn geometry matches the targeting preview truth", () => {
  it("agrees with previewTargetingTiles on angle and range gating", () => {
    const maxDistance = 10;
    const tileSize = 24;
    for (const heading of ["NE", "S", "W"] as const) {
      const arena = makeOpenArena(24, 24);
      const origin = { x: 12, y: 12 };
      const shooter = makeRobot("r1", "t1", "rifle", origin, { scanHeading: heading });
      const tiles = previewTargetingTiles({
        arena,
        shooter,
        weapon: "rifle",
        authorizedContacts: [],
        fireMode: "scan",
        maxDistance,
        assumedPosture: "upright",
      });
      const [headingX, headingY] = HEADING_VECTORS[heading];
      const center = tileCenterPx(origin, tileSize);
      const circleRadius = ringRadiusPx(maxDistance, tileSize);
      for (const preview of tiles) {
        const tileCenter = tileCenterPx(preview.tile, tileSize);
        const dot = headingX * (tileCenter.x - center.x) + headingY * (tileCenter.y - center.y);
        const distancePx = Math.hypot(tileCenter.x - center.x, tileCenter.y - center.y);
        if (preview.status === "angle-blocked") {
          // Strictly behind the drawn boundary rays (the rays themselves are inclusive).
          expect(dot).toBeLessThan(0);
        }
        if (preview.status === "out-of-range") {
          expect(distancePx).toBeGreaterThanOrEqual(circleRadius - 1e-9);
        }
        if (preview.status === "eligible") {
          expect(dot).toBeGreaterThanOrEqual(0);
          expect(distancePx).toBeLessThan(circleRadius);
        }
      }
    }
  });
});
