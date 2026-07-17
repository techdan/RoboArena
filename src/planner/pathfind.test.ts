import { describe, expect, it } from "vitest";
import type { Arena, Terrain } from "../engine/types";
import { findPath } from "./pathfind";

const arenaWith = (rows: readonly (readonly Terrain[])[]): Arena => ({
  type: "rubble",
  sizeName: "Planner Test",
  width: rows[0]?.length ?? 0,
  height: rows.length,
  tiles: rows.map((row) => row.map((terrain) => ({ terrain }))),
  homeAreas: [],
});

describe("planner A*", () => {
  it("finds a deterministic direct route across open ground", () => {
    const arena = arenaWith(Array.from({ length: 5 }, () => Array<Terrain>(5).fill("open")));
    expect(findPath(arena, { x: 0, y: 0 }, { x: 4, y: 4 }, "upright")).toEqual({
      kind: "path",
      steps: [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
        { x: 3, y: 3 },
        { x: 4, y: 4 },
      ],
    });
  });

  it("routes around walls and reports blocked/out-of-bounds destinations", () => {
    const arena = arenaWith([
      ["open", "open", "wall", "open", "open"],
      ["open", "open", "wall", "open", "open"],
      ["open", "open", "wall", "open", "open"],
      ["open", "open", "open", "open", "open"],
    ]);
    const route = findPath(arena, { x: 0, y: 0 }, { x: 4, y: 0 }, "upright");
    expect(route.kind).toBe("path");
    if (route.kind === "path") expect(route.steps).toContainEqual({ x: 2, y: 3 });
    expect(findPath(arena, { x: 0, y: 0 }, { x: 2, y: 0 }, "upright")).toEqual({
      kind: "error",
      reason: "blocked",
    });
    expect(findPath(arena, { x: 0, y: 0 }, { x: 5, y: 0 }, "upright")).toEqual({
      kind: "error",
      reason: "out-of-bounds",
    });
  });

  it("respects crouching traversal restrictions", () => {
    const arena = arenaWith([["open", "rough", "open"]]);
    expect(findPath(arena, { x: 0, y: 0 }, { x: 2, y: 0 }, "crouching")).toEqual({
      kind: "error",
      reason: "unreachable",
    });
  });

  it("prefers the lowest tick-cost route over an equally short slow route", () => {
    const arena = arenaWith(
      Array.from({ length: 7 }, (_, y) =>
        Array.from({ length: 5 }, (_, x) => (x === 2 && y > 0 && y < 6 ? "rough" : "open")),
      ),
    );
    const route = findPath(arena, { x: 2, y: 6 }, { x: 2, y: 0 }, "upright");
    expect(route.kind).toBe("path");
    if (route.kind === "path") {
      expect(route.steps).toHaveLength(6);
      expect(
        route.steps.slice(0, -1).every((step) => arena.tiles[step.y]?.[step.x]?.terrain === "open"),
      ).toBe(true);
    }
  });
});
