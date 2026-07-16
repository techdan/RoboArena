/** Validated, source-locked v1 arena library (`docs/spec.md` §9). */

import { createHomeAreas } from "../../engine/arena";
import type { Arena, ArenaTile, ArenaType, GameLength, Terrain } from "../../engine/types";
import rubbleThree from "./rubble-three.json";
import rubbleTwo from "./rubble-two.json";

export const ARENA_NAMES = ["rubble-two", "rubble-three"] as const;
export type ArenaName = (typeof ARENA_NAMES)[number];

interface ArenaData {
  readonly name: string;
  readonly type: ArenaType;
  readonly size: GameLength;
  readonly width: number;
  readonly height: number;
  readonly tiles: ReadonlyArray<ReadonlyArray<ArenaTile>>;
  readonly metadata: {
    readonly source: string;
    readonly mapId: number;
    readonly unknownTiles: readonly { readonly x: number; readonly y: number }[];
    readonly sourceSha256: string;
  };
}

const TERRAIN = new Set<Terrain>([
  "open",
  "rough",
  "low-wall",
  "wall",
  "bush",
  "crevice",
  "outer-wall",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isArenaTile = (value: unknown): value is ArenaTile =>
  isRecord(value) && typeof value.terrain === "string" && TERRAIN.has(value.terrain as Terrain);

export function validateArenaData(value: unknown): asserts value is ArenaData {
  if (!isRecord(value)) throw new Error("Arena data must be an object.");
  if (typeof value.name !== "string" || value.type !== "rubble") {
    throw new Error("Arena identity is invalid.");
  }
  if (value.size !== "melee" && value.size !== "battle") {
    throw new Error(`Arena ${value.name} has an unsupported main-game size.`);
  }
  if (!Number.isInteger(value.width) || !Number.isInteger(value.height)) {
    throw new Error(`Arena ${value.name} dimensions must be integers.`);
  }
  const width = value.width as number;
  const height = value.height as number;
  if (width <= 0 || height <= 0 || !Array.isArray(value.tiles) || value.tiles.length !== height) {
    throw new Error(`Arena ${value.name} row count does not match its height.`);
  }
  for (const [rowIndex, row] of value.tiles.entries()) {
    if (!Array.isArray(row) || row.length !== width || !row.every(isArenaTile)) {
      throw new Error(`Arena ${value.name} row ${rowIndex} is invalid.`);
    }
  }
  if (!isRecord(value.metadata)) throw new Error(`Arena ${value.name} metadata is missing.`);
  if (
    typeof value.metadata.source !== "string" ||
    typeof value.metadata.mapId !== "number" ||
    !Array.isArray(value.metadata.unknownTiles) ||
    value.metadata.unknownTiles.length !== 0 ||
    typeof value.metadata.sourceSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.metadata.sourceSha256)
  ) {
    throw new Error(`Arena ${value.name} provenance metadata is invalid.`);
  }
}

const RAW_ARENAS: Readonly<Record<ArenaName, unknown>> = {
  "rubble-two": rubbleTwo,
  "rubble-three": rubbleThree,
};

export const loadArena = async (name: ArenaName): Promise<Arena> => {
  const data = RAW_ARENAS[name];
  validateArenaData(data);
  return {
    type: data.type,
    sizeName: data.name,
    width: data.width,
    height: data.height,
    tiles: data.tiles,
    homeAreas: createHomeAreas(data.width, data.height),
  };
};

export const arenaProvenance = (name: ArenaName): ArenaData["metadata"] => {
  const data = RAW_ARENAS[name];
  validateArenaData(data);
  return data.metadata;
};
