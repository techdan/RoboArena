import { describe, expect, it } from "vitest";
import { makeOpenArena, makeRobot } from "../engine/__fixtures__/match";
import type { Heading } from "../engine/types";
import { previewTargetingTiles } from "./firingHelpers";
import {
  coneWedge,
  damageRings,
  longestConeBoundaryAngle,
  ringLabelPosition,
  ringRadiusPx,
  tileCenterPx,
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

describe("ring label placement", () => {
  it("uses the longer south boundary when an east-facing shooter is near the north edge", () => {
    const wedge = coneWedge({ x: 1, y: 1 }, "E", 600, 24);
    const boundaryAngle = longestConeBoundaryAngle(wedge, 768, 768);
    expect(boundaryAngle).toBe(wedge.endAngle);

    const near = ringLabelPosition(wedge, ringRadiusPx(4, 24), 768, 768);
    const far = ringLabelPosition(wedge, ringRadiusPx(12, 24), 768, 768);
    expect(near.x).toBeCloseTo(wedge.center.x + 8);
    expect(far.x).toBeCloseTo(near.x);
    expect(far.y).toBeGreaterThan(near.y);
  });

  it("uses the longer north boundary when the same shooter is near the south edge", () => {
    const wedge = coneWedge({ x: 1, y: 28 }, "E", 600, 24);
    expect(longestConeBoundaryAngle(wedge, 768, 768)).toBe(wedge.startAngle);
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
