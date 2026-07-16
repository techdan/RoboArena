import { describe, expect, it } from "vitest";

import { makeMatch, makeOpenArena, makeRobot, makeTeam } from "./__fixtures__/match.js";
import { computeVisibility, hasVisibilityLineOfSight, visibilityTileKey } from "./visibility.js";
import type { Arena, MatchState, Terrain } from "./types.js";

const withTerrain = (arena: Arena, x: number, y: number, terrain: Terrain): Arena => ({
  ...arena,
  tiles: arena.tiles.map((row, rowIndex) =>
    row.map((tile, columnIndex) => (rowIndex === y && columnIndex === x ? { terrain } : tile)),
  ),
});

describe("ordinary Team visibility", () => {
  it("sees an upright enemy at distance 10 inside the cone with clear LoS", () => {
    const observer = makeRobot("o1", "team-1", "rifle", { x: 1, y: 2 });
    const enemy = makeRobot("e1", "team-2", "rifle", { x: 11, y: 2 });
    const state = makeMatch({
      arena: makeOpenArena(16, 8),
      teamOneRobots: [observer],
      teamTwoRobots: [enemy],
    });

    const visibility = computeVisibility(state, "team-1");
    expect(visibility.visibleTiles.has("11,2")).toBe(true);
    expect(visibility.visibleEnemies.has(enemy.id)).toBe(true);
  });

  it("walls block visibility while low walls and crevices do not", () => {
    const base = makeOpenArena(12, 8);
    const wall = withTerrain(base, 4, 2, "wall");
    const lowWall = withTerrain(base, 4, 2, "low-wall");
    const crevice = withTerrain(base, 4, 2, "crevice");

    expect(hasVisibilityLineOfSight(wall, { x: 1, y: 2 }, { x: 7, y: 2 })).toBe(false);
    expect(hasVisibilityLineOfSight(lowWall, { x: 1, y: 2 }, { x: 7, y: 2 })).toBe(true);
    expect(hasVisibilityLineOfSight(crevice, { x: 1, y: 2 }, { x: 7, y: 2 })).toBe(true);
  });

  it("a bush blocks its tile and tiles behind it", () => {
    const arena = withTerrain(makeOpenArena(12, 8), 4, 2, "bush");
    const observer = makeRobot("o1", "team-1", "rifle", { x: 1, y: 2 });
    const onBush = makeRobot("e1", "team-2", "rifle", { x: 4, y: 2 });
    const behindBush = makeRobot("e2", "team-2", "rifle", { x: 7, y: 2 });
    const state = makeMatch({
      arena,
      teamOneRobots: [observer],
      teamTwoRobots: [onBush, behindBush],
    });

    const visibility = computeVisibility(state, "team-1");
    expect(visibility.visibleEnemies).toEqual(new Set());
    expect(
      visibility.visibleTiles.has(visibilityTileKey(onBush.position as { x: number; y: number })),
    ).toBe(false);
  });

  it("always exposes same-Side robots without pooling their enemy contacts", () => {
    const arena = makeOpenArena(16, 8);
    const observer = makeRobot("o1", "team-a", "rifle", { x: 1, y: 1 }, { scanHeading: "W" });
    const ally = makeRobot("a1", "team-b", "rifle", { x: 8, y: 1 });
    const enemy = makeRobot("e1", "team-c", "rifle", { x: 10, y: 1 });
    const base = makeMatch({ arena });
    const state: MatchState = {
      ...base,
      teams: [
        makeTeam("team-a", 1, [observer], 0),
        makeTeam("team-b", 1, [ally], 1),
        makeTeam("team-c", 2, [enemy], 2),
      ],
    };

    const visibility = computeVisibility(state, "team-a");
    expect(visibility.visibleTiles.has("8,1")).toBe(true);
    expect(visibility.visibleEnemies.has(enemy.id)).toBe(false);
  });

  it("returns the observing Team's existing last-known markers", () => {
    const marker = { x: 5, y: 4 };
    const base = makeMatch();
    const state: MatchState = {
      ...base,
      lastKnownMarkers: new Map([["team-1", [{ enemyId: "e1", at: marker }]]]),
    };
    expect(computeVisibility(state, "team-1").lastKnownMarkers).toEqual([marker]);
  });

  it("rejects an unknown observing Team", () => {
    expect(() => computeVisibility(makeMatch(), "missing")).toThrow(/Unknown observing Team/);
  });
});
