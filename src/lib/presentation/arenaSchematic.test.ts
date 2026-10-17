import { describe, expect, it } from "vitest";
import { createHomeAreas } from "../../engine/arena";
import type { Arena, Terrain } from "../../engine/types";
import { loadArena } from "../arenas";
import {
  cornerAtTile,
  homeRects,
  outsideCorners,
  showsSouthFace,
  terrainCounts,
  tileNoise,
} from "./arenaSchematic";

const CHAR: Readonly<Record<string, Terrain>> = {
  ".": "open",
  W: "wall",
  L: "low-wall",
  O: "outer-wall",
  B: "bush",
  R: "rough",
  C: "crevice",
};

const arenaFrom = (rows: readonly string[]): Arena => ({
  type: "rubble",
  sizeName: "Test",
  width: rows[0]!.length,
  height: rows.length,
  tiles: rows.map((row) => [...row].map((char) => ({ terrain: CHAR[char]! }))),
  homeAreas: createHomeAreas(rows[0]!.length, rows.length),
});

describe("outsideCorners", () => {
  it("rounds all four corners of a lone wall", () => {
    const arena = arenaFrom(["...", ".W.", "..."]);
    expect(outsideCorners(arena, 1, 1)).toEqual([true, true, true, true]);
  });

  it("keeps the joined side of a horizontal run square", () => {
    const arena = arenaFrom(["....", ".WW.", "...."]);
    expect(outsideCorners(arena, 1, 1)).toEqual([true, false, false, true]);
    expect(outsideCorners(arena, 2, 1)).toEqual([false, true, true, false]);
  });

  it("treats outer walls as the same slab as walls, but not low walls", () => {
    const arena = arenaFrom(["OW.", "L..", "..."]);
    expect(outsideCorners(arena, 1, 0)).toEqual([false, true, true, false]);
    expect(outsideCorners(arena, 0, 1)).toEqual([true, true, true, true]);
  });

  it("gives open ground no south face", () => {
    const arena = arenaFrom(["..", ".."]);
    expect(showsSouthFace(arena, 0, 0)).toBe(false);
  });
});

describe("showsSouthFace", () => {
  it("shows the face only at the bottom of a vertical run", () => {
    const arena = arenaFrom([".W.", ".W.", "..."]);
    expect(showsSouthFace(arena, 1, 0)).toBe(false);
    expect(showsSouthFace(arena, 1, 1)).toBe(true);
  });
});

describe("home corners", () => {
  it("matches the engine's home areas", () => {
    const rects = homeRects(24, 24);
    const engine = createHomeAreas(24, 24);
    for (const area of engine) {
      const rect = rects[area.corner];
      for (const tile of area.tiles) {
        expect(tile.x >= rect.x && tile.x < rect.x + rect.width).toBe(true);
        expect(tile.y >= rect.y && tile.y < rect.y + rect.height).toBe(true);
      }
      expect(area.tiles).toHaveLength(rect.width * rect.height);
    }
  });

  it("finds the corner under a tile", () => {
    expect(cornerAtTile(24, 24, 0, 0)).toBe("NW");
    expect(cornerAtTile(24, 24, 23, 0)).toBe("NE");
    expect(cornerAtTile(24, 24, 23, 23)).toBe("SE");
    expect(cornerAtTile(24, 24, 0, 23)).toBe("SW");
    expect(cornerAtTile(24, 24, 12, 12)).toBeNull();
  });
});

describe("decoration and summaries", () => {
  it("produces stable noise in [0, 1)", () => {
    const value = tileNoise(5, 9, 2);
    expect(value).toBe(tileNoise(5, 9, 2));
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
    expect(tileNoise(5, 9, 3)).not.toBe(value);
  });

  it("counts interior terrain on a real map", async () => {
    const counts = terrainCounts(await loadArena("rubble-two"));
    expect(counts.walls).toBeGreaterThan(0);
    expect(counts.bushes).toBeGreaterThan(0);
    const total = counts.walls + counts.lowWalls + counts.bushes + counts.rough + counts.crevices;
    expect(total).toBeLessThanOrEqual(24 * 24);
  });
});
