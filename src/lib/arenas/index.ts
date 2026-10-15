/** Validated, source-locked arena library: all 24 original maps (`docs/spec.md` §9). */

import { createHomeAreas } from "../../engine/arena";
import type { Arena, ArenaTile, ArenaType, Terrain } from "../../engine/types";
import { ARENA_NAMES, type ArenaName } from "./catalog";
import originalArenas from "./original-arenas.json";

export { ARENA_CATALOG, ARENA_NAMES, ARENA_TOWNS, arenaCatalogEntry } from "./catalog";
export type { ArenaCatalogEntry, ArenaName } from "./catalog";

/** One character per MAP cell, as written by `tools/re/export_data.py`. */
const TERRAIN_BY_CHAR: Readonly<Record<string, Terrain>> = {
  ".": "open",
  R: "rough",
  B: "bush",
  L: "low-wall",
  W: "wall",
  C: "crevice",
  O: "outer-wall",
};

interface CompactArena {
  readonly slug: string;
  readonly name: string;
  readonly town: ArenaType;
  readonly mapId: number;
  readonly width: number;
  readonly height: number;
  readonly rows: readonly string[];
}

export interface ArenaProvenance {
  readonly source: string;
  readonly mapId: number;
  readonly sourceSha256: string;
}

const TOWNS = new Set<string>(["rubble", "suburbs", "computer"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function validateCompactArena(value: unknown): asserts value is CompactArena {
  if (!isRecord(value)) throw new Error("Arena data must be an object.");
  if (typeof value.slug !== "string" || typeof value.name !== "string") {
    throw new Error("Arena identity is invalid.");
  }
  if (typeof value.town !== "string" || !TOWNS.has(value.town)) {
    throw new Error(`Arena ${value.name} has an unknown town.`);
  }
  if (typeof value.mapId !== "number" || !Number.isInteger(value.mapId)) {
    throw new Error(`Arena ${value.name} map id is invalid.`);
  }
  if (!Number.isInteger(value.width) || !Number.isInteger(value.height)) {
    throw new Error(`Arena ${value.name} dimensions must be integers.`);
  }
  const width = value.width as number;
  const height = value.height as number;
  if (width <= 0 || height <= 0 || !Array.isArray(value.rows) || value.rows.length !== height) {
    throw new Error(`Arena ${value.name} row count does not match its height.`);
  }
  for (const [rowIndex, row] of value.rows.entries()) {
    if (
      typeof row !== "string" ||
      row.length !== width ||
      ![...row].every((char) => char in TERRAIN_BY_CHAR)
    ) {
      throw new Error(`Arena ${value.name} row ${rowIndex} is invalid.`);
    }
  }
}

const arenaData = (name: ArenaName): CompactArena => {
  const data: unknown = originalArenas.arenas.find((arena) => arena.slug === name);
  if (data === undefined) throw new Error(`Unknown arena ${name}.`);
  validateCompactArena(data);
  return data;
};

const expandRows = (rows: readonly string[]): ArenaTile[][] =>
  rows.map((row) => [...row].map((char) => ({ terrain: TERRAIN_BY_CHAR[char] as Terrain })));

export const isArenaName = (value: unknown): value is ArenaName =>
  typeof value === "string" && (ARENA_NAMES as readonly string[]).includes(value);

export const loadArena = async (name: ArenaName): Promise<Arena> => {
  const data = arenaData(name);
  return {
    type: data.town,
    sizeName: data.name,
    width: data.width,
    height: data.height,
    tiles: expandRows(data.rows),
    homeAreas: createHomeAreas(data.width, data.height),
  };
};

export const arenaProvenance = (name: ArenaName): ArenaProvenance => {
  const data = arenaData(name);
  const town = originalArenas.towns[data.town];
  return {
    source: `version-locked ${town.file} MAP export`,
    mapId: data.mapId,
    sourceSha256: town.sha256,
  };
};
