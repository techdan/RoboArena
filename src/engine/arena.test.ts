import { describe, expect, it } from "vitest";

import { createHomeAreas, homeAreaSpan } from "./arena.js";

describe("original home-area derivation", () => {
  it("uses the exact per-axis size thresholds", () => {
    expect([16, 20, 32, 48].map(homeAreaSpan)).toEqual([6, 8, 12, 16]);
  });

  it("creates clockwise corner rectangles", () => {
    const homes = createHomeAreas(24, 32);
    expect(homes.map(({ corner, tiles }) => [corner, tiles.length])).toEqual([
      ["NW", 96],
      ["NE", 96],
      ["SE", 96],
      ["SW", 96],
    ]);
    expect(homes[0]?.tiles).toContainEqual({ x: 0, y: 0 });
    expect(homes[1]?.tiles).toContainEqual({ x: 23, y: 0 });
    expect(homes[2]?.tiles).toContainEqual({ x: 23, y: 31 });
    expect(homes[3]?.tiles).toContainEqual({ x: 0, y: 31 });
  });
});
