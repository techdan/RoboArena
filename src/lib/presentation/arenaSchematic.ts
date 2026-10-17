import { homeAreaSpan } from "../../engine/arena";
import type { Arena, HomeArea, Terrain } from "../../engine/types";

/**
 * Geometry for the 2D arena schematic used by the lobby and the atlas. The
 * painter lives in components/site/ArenaSchematic.tsx; everything here is
 * pure so the shape rules can be tested without a canvas.
 */

export type Corner = HomeArea["corner"];

export interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Terrains drawn as raised blocks that merge with neighbours of the same group. */
export type BlockGroup = "wall" | "low-wall";

export const blockGroup = (terrain: Terrain | undefined): BlockGroup | null => {
  if (terrain === "wall" || terrain === "outer-wall") return "wall";
  if (terrain === "low-wall") return "low-wall";
  return null;
};

export const terrainAt = (arena: Arena, x: number, y: number): Terrain | undefined =>
  arena.tiles[y]?.[x]?.terrain;

/**
 * Which corners of a block tile are outside corners, as [top-left, top-right,
 * bottom-right, bottom-left]. A corner is rounded only when neither side it
 * touches continues into the same block group, so runs of wall read as one
 * slab instead of a row of squares.
 */
export const outsideCorners = (
  arena: Arena,
  x: number,
  y: number,
): readonly [boolean, boolean, boolean, boolean] => {
  const group = blockGroup(terrainAt(arena, x, y));
  const same = (dx: number, dy: number) =>
    group !== null && blockGroup(terrainAt(arena, x + dx, y + dy)) === group;
  const up = same(0, -1);
  const down = same(0, 1);
  const left = same(-1, 0);
  const right = same(1, 0);
  return [!up && !left, !up && !right, !down && !right, !down && !left];
};

/** Whether a block's south face is visible (no block of the same group below it). */
export const showsSouthFace = (arena: Arena, x: number, y: number): boolean => {
  const group = blockGroup(terrainAt(arena, x, y));
  return group !== null && blockGroup(terrainAt(arena, x, y + 1)) !== group;
};

/** Home-corner rectangles in tile units, matching engine/arena.ts createHomeAreas. */
export const homeRects = (width: number, height: number): Readonly<Record<Corner, TileRect>> => {
  const w = homeAreaSpan(width);
  const h = homeAreaSpan(height);
  return {
    NW: { x: 0, y: 0, width: w, height: h },
    NE: { x: width - w, y: 0, width: w, height: h },
    SE: { x: width - w, y: height - h, width: w, height: h },
    SW: { x: 0, y: height - h, width: w, height: h },
  };
};

/** The home corner containing a tile, if any. Overlapping corners resolve in NW, NE, SE, SW order. */
export const cornerAtTile = (
  width: number,
  height: number,
  x: number,
  y: number,
): Corner | null => {
  const rects = homeRects(width, height);
  for (const corner of ["NW", "NE", "SE", "SW"] as const) {
    const rect = rects[corner];
    if (x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height)
      return corner;
  }
  return null;
};

/** Stable per-tile pseudo-random value in [0, 1) for decoration jitter. */
export const tileNoise = (x: number, y: number, salt = 0): number => {
  let h = Math.imul(x + 374_761_393, 668_265_263) ^ Math.imul(y + 1_274_126_177, 2_246_822_519);
  h = Math.imul(h ^ (h >>> 13), 3_266_489_917) ^ salt;
  h ^= h >>> 16;
  return (h >>> 0) / 4_294_967_296;
};

export interface TerrainCounts {
  readonly walls: number;
  readonly lowWalls: number;
  readonly bushes: number;
  readonly rough: number;
  readonly crevices: number;
}

/** Interior terrain counts for map summaries (outer walls excluded). */
export const terrainCounts = (arena: Arena): TerrainCounts => {
  const counts = { walls: 0, lowWalls: 0, bushes: 0, rough: 0, crevices: 0 };
  for (const row of arena.tiles) {
    for (const tile of row) {
      if (tile.terrain === "wall") counts.walls += 1;
      else if (tile.terrain === "low-wall") counts.lowWalls += 1;
      else if (tile.terrain === "bush") counts.bushes += 1;
      else if (tile.terrain === "rough") counts.rough += 1;
      else if (tile.terrain === "crevice") counts.crevices += 1;
    }
  }
  return counts;
};
