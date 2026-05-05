import { describe, expect, it } from "vitest";
import {
  bearingDegrees,
  chebyshevDistance,
  classifyScanZone,
  tilesAlongLineExclusive,
} from "./geometry.js";

describe("chebyshevDistance", () => {
  it("equal tiles → 0", () => {
    expect(chebyshevDistance({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
  });

  it("orthogonal d=1", () => {
    expect(chebyshevDistance({ x: 5, y: 5 }, { x: 6, y: 5 })).toBe(1);
    expect(chebyshevDistance({ x: 5, y: 5 }, { x: 5, y: 4 })).toBe(1);
  });

  it("diagonal counts the same as orthogonal (king-move)", () => {
    expect(chebyshevDistance({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(1);
    expect(chebyshevDistance({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(3);
  });

  it("non-uniform deltas → max axis", () => {
    expect(chebyshevDistance({ x: 0, y: 0 }, { x: 7, y: 3 })).toBe(7);
    expect(chebyshevDistance({ x: 0, y: 0 }, { x: -2, y: 5 })).toBe(5);
  });
});

describe("bearingDegrees", () => {
  // y grows down (screen-style); N is -dy
  it("north = 0", () => {
    expect(bearingDegrees({ x: 0, y: 5 }, { x: 0, y: 0 })).toBe(0);
  });
  it("east = 90", () => {
    expect(bearingDegrees({ x: 0, y: 0 }, { x: 5, y: 0 })).toBe(90);
  });
  it("south = 180", () => {
    expect(bearingDegrees({ x: 0, y: 0 }, { x: 0, y: 5 })).toBe(180);
  });
  it("west = 270", () => {
    expect(bearingDegrees({ x: 5, y: 0 }, { x: 0, y: 0 })).toBe(270);
  });
});

describe("classifyScanZone", () => {
  it("dead-center forward → black", () => {
    // Shooter at (0,5) facing N (toward y=0); target at (0,0) is straight north.
    expect(classifyScanZone({ x: 0, y: 5 }, "N", { x: 0, y: 0 })).toBe("black");
  });

  it("directly behind → blocked", () => {
    // Shooter at (0,0) facing N; target at (0,5) is due south = 180° off.
    expect(classifyScanZone({ x: 0, y: 0 }, "N", { x: 0, y: 5 })).toBe("blocked");
  });

  it("perpendicular (90° off) → grey edge", () => {
    // Facing N, target due east = 90° off = on the boundary.
    // Boundary defined as ≤90° → grey (not blocked).
    expect(classifyScanZone({ x: 0, y: 0 }, "N", { x: 5, y: 0 })).toBe("grey");
  });

  it("45° off → black edge", () => {
    // Facing N, target at NE = 45°. Boundary defined as ≤45° → still black.
    expect(classifyScanZone({ x: 0, y: 5 }, "N", { x: 5, y: 0 })).toBe("black");
  });

  it("diagonal heading hits black for diagonal targets", () => {
    expect(classifyScanZone({ x: 0, y: 5 }, "NE", { x: 5, y: 0 })).toBe("black");
  });

  it("target on shooter's tile → black (degenerate but defined)", () => {
    expect(classifyScanZone({ x: 3, y: 3 }, "N", { x: 3, y: 3 })).toBe("black");
  });
});

describe("tilesAlongLineExclusive (Bresenham, integer-only)", () => {
  it("returns nothing for adjacent tiles (no intermediates)", () => {
    const path = tilesAlongLineExclusive({ x: 5, y: 5 }, { x: 6, y: 5 });
    expect(path).toEqual([]);
  });

  it("returns intermediate tiles, not endpoints", () => {
    const path = tilesAlongLineExclusive({ x: 0, y: 0 }, { x: 5, y: 0 });
    expect(path).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ]);
  });

  it("diagonal line includes diagonal intermediates", () => {
    const path = tilesAlongLineExclusive({ x: 0, y: 0 }, { x: 3, y: 3 });
    expect(path).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
  });

  it("works in negative directions", () => {
    const path = tilesAlongLineExclusive({ x: 5, y: 0 }, { x: 0, y: 0 });
    expect(path).toEqual([
      { x: 4, y: 0 },
      { x: 3, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 0 },
    ]);
  });

  it("identical endpoints → empty path", () => {
    expect(tilesAlongLineExclusive({ x: 3, y: 3 }, { x: 3, y: 3 })).toEqual([]);
  });
});
