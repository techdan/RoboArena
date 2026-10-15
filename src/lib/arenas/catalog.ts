/**
 * Lightweight catalog of the 24 original RoboSport arenas (8 maps in each of
 * the Rubble Town, Suburbs and Computer Town files). Safe to import from the
 * browser: the terrain itself lives in `original-arenas.json` and is loaded by
 * `./index.ts`. A test keeps this list in step with the generated data.
 */

import type { ArenaType } from "../../engine/types";

export interface ArenaCatalogEntry {
  readonly slug: string;
  readonly name: string;
  readonly town: ArenaType;
  readonly width: number;
  readonly height: number;
}

export const ARENA_CATALOG = [
  { slug: "rubble-one", name: "Rubble One", town: "rubble", width: 16, height: 16 },
  { slug: "rubble-two", name: "Rubble Two", town: "rubble", width: 24, height: 24 },
  { slug: "rubble-three", name: "Rubble Three", town: "rubble", width: 32, height: 32 },
  { slug: "rubble-four", name: "Rubble Four", town: "rubble", width: 40, height: 40 },
  { slug: "rubble-five", name: "Rubble Five", town: "rubble", width: 48, height: 48 },
  { slug: "rubble-six", name: "Rubble Six", town: "rubble", width: 44, height: 44 },
  { slug: "rubble-seven", name: "Rubble Seven", town: "rubble", width: 40, height: 20 },
  { slug: "rubble-eight", name: "Rubble Eight", town: "rubble", width: 32, height: 32 },
  { slug: "suburb-one", name: "Suburb One", town: "suburbs", width: 16, height: 16 },
  { slug: "suburb-two", name: "Suburb Two", town: "suburbs", width: 24, height: 24 },
  { slug: "suburb-three", name: "Suburb Three", town: "suburbs", width: 32, height: 32 },
  { slug: "suburb-four", name: "Suburb Four", town: "suburbs", width: 44, height: 44 },
  { slug: "suburb-five", name: "Suburb Five", town: "suburbs", width: 52, height: 20 },
  { slug: "suburb-six", name: "Suburb Six", town: "suburbs", width: 36, height: 36 },
  { slug: "suburb-seven", name: "Suburb Seven", town: "suburbs", width: 20, height: 48 },
  { slug: "suburb-eight", name: "Suburb Eight", town: "suburbs", width: 52, height: 44 },
  { slug: "computer-one", name: "Computer One", town: "computer", width: 16, height: 16 },
  { slug: "computer-two", name: "Computer Two", town: "computer", width: 24, height: 24 },
  { slug: "computer-three", name: "Computer Three", town: "computer", width: 32, height: 32 },
  { slug: "computer-four", name: "Computer Four", town: "computer", width: 44, height: 44 },
  { slug: "computer-five", name: "Computer Five", town: "computer", width: 20, height: 40 },
  { slug: "computer-six", name: "Computer Six", town: "computer", width: 28, height: 28 },
  { slug: "computer-seven", name: "Computer Seven", town: "computer", width: 36, height: 24 },
  { slug: "computer-eight", name: "Computer Eight", town: "computer", width: 40, height: 20 },
] as const satisfies readonly ArenaCatalogEntry[];

export type ArenaName = (typeof ARENA_CATALOG)[number]["slug"];

export const ARENA_NAMES = ARENA_CATALOG.map((entry) => entry.slug) as unknown as readonly [
  ArenaName,
  ...ArenaName[],
];

export const ARENA_TOWNS: readonly { readonly town: ArenaType; readonly label: string }[] = [
  { town: "rubble", label: "Rubble Town" },
  { town: "suburbs", label: "Suburbs" },
  { town: "computer", label: "Computer Town" },
];

export const arenaCatalogEntry = (name: ArenaName): ArenaCatalogEntry => {
  const entry = ARENA_CATALOG.find((candidate) => candidate.slug === name);
  if (entry === undefined) throw new Error(`Unknown arena ${name}.`);
  return entry;
};
