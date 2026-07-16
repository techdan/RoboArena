import { describe, expect, it } from "vitest";
import {
  angleDelta,
  bearingDegrees,
  chebyshevDistance,
  floorEuclideanDistance,
  isWithinScanCone,
  tilesAlongLineExclusive,
} from "./geometry.js";

describe("floorEuclideanDistance", () => {
  it("returns zero for the same tile", () => {
    expect(floorEuclideanDistance({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
  });

  it("keeps axis-aligned distances exact", () => {
    expect(floorEuclideanDistance({ x: 0, y: 0 }, { x: 18, y: 0 })).toBe(18);
    expect(floorEuclideanDistance({ x: 0, y: 0 }, { x: 0, y: -18 })).toBe(18);
  });

  it("matches the RE diagonal fixtures", () => {
    expect(floorEuclideanDistance({ x: 0, y: 0 }, { x: 13, y: 13 })).toBe(18);
    expect(floorEuclideanDistance({ x: 0, y: 0 }, { x: 18, y: 18 })).toBe(25);
  });

  it("differs from Chebyshev on diagonals", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 3, y: 4 };
    expect(floorEuclideanDistance(a, b)).toBe(5);
    expect(chebyshevDistance(a, b)).toBe(4);
  });

  it("is symmetric", () => {
    const a = { x: -7, y: 11 };
    const b = { x: 19, y: -3 };
    expect(floorEuclideanDistance(a, b)).toBe(floorEuclideanDistance(b, a));
  });
});

describe("headings and scan gate", () => {
  it("computes cardinal bearings", () => {
    const origin = { x: 4, y: 4 };
    expect(bearingDegrees(origin, { x: 4, y: 3 })).toBe(0);
    expect(bearingDegrees(origin, { x: 5, y: 4 })).toBe(90);
    expect(bearingDegrees(origin, { x: 4, y: 5 })).toBe(180);
    expect(bearingDegrees(origin, { x: 3, y: 4 })).toBe(270);
  });

  it("computes diagonal bearings", () => {
    expect(bearingDegrees({ x: 0, y: 0 }, { x: 1, y: -1 })).toBe(45);
    expect(bearingDegrees({ x: 0, y: 0 }, { x: -1, y: 1 })).toBe(225);
  });

  it("wraps angle deltas", () => {
    expect(angleDelta(350, 10)).toBe(20);
    expect(angleDelta(90, 270)).toBe(180);
  });

  it("accepts targets inside the exact closed forward semicircle", () => {
    expect(isWithinScanCone({ x: 0, y: 0 }, "E", { x: 4, y: 0 })).toBe(true);
    expect(isWithinScanCone({ x: 0, y: 0 }, "E", { x: 0, y: -4 })).toBe(true);
  });

  it("includes both perpendicular boundary rays", () => {
    expect(isWithinScanCone({ x: 0, y: 0 }, "E", { x: 0, y: -8 })).toBe(true);
    expect(isWithinScanCone({ x: 0, y: 0 }, "E", { x: 0, y: 8 })).toBe(true);
  });

  it("blocks the first integer tile behind either boundary", () => {
    expect(isWithinScanCone({ x: 0, y: 0 }, "E", { x: -1, y: -8 })).toBe(false);
    expect(isWithinScanCone({ x: 0, y: 0 }, "E", { x: -1, y: 8 })).toBe(false);
  });

  it("uses the same inclusive boundaries for diagonal headings", () => {
    expect(isWithinScanCone({ x: 0, y: 0 }, "NE", { x: 4, y: 4 })).toBe(true);
    expect(isWithinScanCone({ x: 0, y: 0 }, "NE", { x: -4, y: -4 })).toBe(true);
    expect(isWithinScanCone({ x: 0, y: 0 }, "NE", { x: 3, y: 4 })).toBe(false);
  });

  it("blocks targets behind the shooter", () => {
    expect(isWithinScanCone({ x: 0, y: 0 }, "E", { x: -1, y: 0 })).toBe(false);
  });

  it("accepts the same tile", () => {
    expect(isWithinScanCone({ x: 2, y: 2 }, "W", { x: 2, y: 2 })).toBe(true);
  });
});

describe("tilesAlongLineExclusive", () => {
  it("traces a horizontal line", () => {
    expect(tilesAlongLineExclusive({ x: 0, y: 0 }, { x: 4, y: 0 })).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it("traces a vertical line", () => {
    expect(tilesAlongLineExclusive({ x: 2, y: 1 }, { x: 2, y: 4 })).toEqual([
      { x: 2, y: 2 },
      { x: 2, y: 3 },
    ]);
  });

  it("traces a diagonal line", () => {
    expect(tilesAlongLineExclusive({ x: 0, y: 0 }, { x: 3, y: 3 })).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
  });

  it("uses a stable tie-break for shallow lines", () => {
    expect(tilesAlongLineExclusive({ x: 1, y: 2 }, { x: 7, y: 5 })).toEqual([
      { x: 2, y: 2 },
      { x: 3, y: 3 },
      { x: 4, y: 3 },
      { x: 5, y: 4 },
      { x: 6, y: 4 },
    ]);
  });

  it("returns no intermediate tile for adjacent points", () => {
    expect(tilesAlongLineExclusive({ x: 0, y: 0 }, { x: 1, y: 1 })).toEqual([]);
  });
});
