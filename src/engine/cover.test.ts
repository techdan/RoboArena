import { describe, expect, it } from "vitest";
import { coverClassForTerrain, resolveCover } from "./cover.js";
import type { ArenaTile, TileCoord } from "./types.js";

describe("coverClassForTerrain", () => {
  it("maps exposed terrain by posture", () => {
    expect(coverClassForTerrain("upright", "open")).toBe(4);
    expect(coverClassForTerrain("ducking", "open")).toBe(4);
    expect(coverClassForTerrain("crouching", "open")).toBe(3);
  });

  it("maps bush cover by posture", () => {
    expect(coverClassForTerrain("upright", "bush")).toBe(4);
    expect(coverClassForTerrain("ducking", "bush")).toBe(3);
    expect(coverClassForTerrain("crouching", "bush")).toBe(2);
  });

  it("maps low-wall cover by posture", () => {
    expect(coverClassForTerrain("upright", "low-wall")).toBe(3);
    expect(coverClassForTerrain("ducking", "low-wall")).toBe(2);
    expect(coverClassForTerrain("crouching", "low-wall")).toBe(1);
  });

  it("marks walls as blocked", () => {
    expect(coverClassForTerrain("upright", "wall")).toBe("blocked");
    expect(coverClassForTerrain("crouching", "outer-wall")).toBe("blocked");
  });
});

describe("resolveCover", () => {
  const at =
    (terrains: Readonly<Record<string, ArenaTile["terrain"]>>) =>
    (tile: TileCoord): ArenaTile => ({ terrain: terrains[`${tile.x},${tile.y}`] ?? "open" });

  it("uses class 4 at point blank", () => {
    expect(
      resolveCover({
        from: { x: 1, y: 1 },
        to: { x: 1, y: 1 },
        targetPosture: "crouching",
        arenaTileAt: at({}),
      }),
    ).toEqual({ outcome: "cover", coverClass: 4 });
  });

  it("includes bush cover on the target tile", () => {
    expect(
      resolveCover({
        from: { x: 0, y: 0 },
        to: { x: 3, y: 0 },
        targetPosture: "ducking",
        arenaTileAt: at({ "3,0": "bush" }),
      }),
    ).toEqual({ outcome: "cover", coverClass: 3 });
  });

  it("uses the strongest intervening cover", () => {
    expect(
      resolveCover({
        from: { x: 0, y: 0 },
        to: { x: 4, y: 0 },
        targetPosture: "crouching",
        arenaTileAt: at({ "1,0": "bush", "2,0": "low-wall" }),
      }),
    ).toEqual({ outcome: "cover", coverClass: 1 });
  });

  it("reports the first blocking wall", () => {
    expect(
      resolveCover({
        from: { x: 0, y: 0 },
        to: { x: 4, y: 0 },
        targetPosture: "upright",
        arenaTileAt: at({ "2,0": "wall" }),
      }),
    ).toEqual({ outcome: "blocked", stoppedAt: { x: 2, y: 0 } });
  });
});
