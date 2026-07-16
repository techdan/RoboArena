import { describe, expect, it } from "vitest";
import {
  canTraverse,
  chunkMovementPath,
  isFullSpeedTerrain,
  moveStepCostTicks,
} from "./movement.js";
import type { ArenaTile, TileCoord } from "./types.js";

const tileKey = ({ x, y }: TileCoord): string => `${x},${y}`;

const terrainLookup =
  (entries: Readonly<Record<string, ArenaTile["terrain"]>>) =>
  (coord: TileCoord): ArenaTile => ({ terrain: entries[tileKey(coord)] ?? "open" });

describe("movement timing", () => {
  it("uses the exact 30-tick single-step cost", () => {
    expect(moveStepCostTicks(1)).toBe(30);
  });

  it("uses the exact 40-tick double-step cost", () => {
    expect(moveStepCostTicks(2)).toBe(40);
  });
});

describe("terrain traversal", () => {
  it.each(["open", "rough", "low-wall", "bush"] as const)("allows Upright onto %s", (terrain) =>
    expect(canTraverse("upright", terrain)).toBe(true),
  );

  it.each(["open", "rough", "low-wall", "bush"] as const)("allows Ducking onto %s", (terrain) =>
    expect(canTraverse("ducking", terrain)).toBe(true),
  );

  it("allows Crouching only on open ground", () => {
    expect(canTraverse("crouching", "open")).toBe(true);
    expect(canTraverse("crouching", "rough")).toBe(false);
    expect(canTraverse("crouching", "low-wall")).toBe(false);
    expect(canTraverse("crouching", "bush")).toBe(false);
  });

  it.each(["wall", "crevice", "outer-wall"] as const)("blocks every posture on %s", (terrain) => {
    expect(canTraverse("upright", terrain)).toBe(false);
    expect(canTraverse("ducking", terrain)).toBe(false);
    expect(canTraverse("crouching", terrain)).toBe(false);
  });
});

describe("original slow-terrain path chunking", () => {
  it("classifies only open ground as full-speed", () => {
    expect(isFullSpeedTerrain("open")).toBe(true);
    expect(isFullSpeedTerrain("rough")).toBe(false);
    expect(isFullSpeedTerrain("bush")).toBe(false);
    expect(isFullSpeedTerrain("low-wall")).toBe(false);
  });

  it("pairs two open unit steps into one 40-tick endpoint", () => {
    expect(
      chunkMovementPath(
        { x: 0, y: 0 },
        [
          { x: 1, y: 0 },
          { x: 2, y: 0 },
          { x: 3, y: 0 },
          { x: 4, y: 0 },
        ],
        terrainLookup({}),
      ),
    ).toEqual([
      { to: { x: 2, y: 0 }, via: { x: 1, y: 0 } },
      { to: { x: 4, y: 0 }, via: { x: 3, y: 0 } },
    ]);
  });

  it("retains slow tiles as single-step endpoints without resetting a stride", () => {
    expect(
      chunkMovementPath(
        { x: 0, y: 0 },
        [
          { x: 1, y: 0 },
          { x: 2, y: 0 },
          { x: 3, y: 0 },
          { x: 4, y: 0 },
        ],
        terrainLookup({ "2,0": "rough" }),
      ),
    ).toEqual([
      { to: { x: 1, y: 0 } },
      { to: { x: 2, y: 0 } },
      { to: { x: 4, y: 0 }, via: { x: 3, y: 0 } },
    ]);
  });

  it("does not pair a diagonal route across a slow intermediate tile", () => {
    expect(
      chunkMovementPath(
        { x: 0, y: 0 },
        [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
        terrainLookup({ "1,1": "bush" }),
      ),
    ).toEqual([{ to: { x: 1, y: 1 } }, { to: { x: 2, y: 2 } }]);
  });

  it("retains the selected intermediate for a mixed-direction double step", () => {
    expect(
      chunkMovementPath(
        { x: 0, y: 0 },
        [
          { x: 1, y: 1 },
          { x: 2, y: 1 },
        ],
        terrainLookup({}),
      ),
    ).toEqual([{ to: { x: 2, y: 1 }, via: { x: 1, y: 1 } }]);
  });

  it("rejects a non-contiguous unit route", () => {
    expect(chunkMovementPath({ x: 0, y: 0 }, [{ x: 2, y: 0 }], terrainLookup({}))).toBeNull();
  });
});
