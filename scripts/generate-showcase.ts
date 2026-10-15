/** Regenerates src/lib/replays/showcase.json: one featured turn of a seeded
 *  four-team autoplay match, resolved by the production engine.
 *
 *    npx tsx scripts/generate-showcase.ts
 *
 *  The app cannot bundle the resolver (engine modules use NodeNext `.js`
 *  specifiers), so the movie ships as data, like a stored replay would.
 */

import { writeFileSync } from "node:fs";
import type { RobotClass } from "../src/engine/types";
import { loadArena } from "../src/lib/arenas";
import { serializeMatchState } from "../src/lib/net/protocol";
import { runAutoplayMatch, type AutoplayOptions } from "../src/sim/autoplay";

const ROSTERS: readonly (readonly RobotClass[])[] = [
  ["rifle", "missile", "auto", "burst"],
  ["missile", "auto", "rifle", "burst"],
  ["burst", "rifle", "missile", "auto"],
  ["auto", "burst", "missile", "rifle"],
];

/** Picked by scanning seeds for a turn with heavy, varied combat. */
const OPTIONS: AutoplayOptions = {
  seed: "show-2",
  arena: "rubble-two",
  teams: ["red", "blue", "green", "yellow"].map((color, index) => ({
    id: `team-${color}`,
    color,
    robots: [...(ROSTERS[index] ?? [])],
  })),
};
const FEATURED_TURN = 2;

const arena = await loadArena(OPTIONS.arena);
const match = runAutoplayMatch(OPTIONS, arena);
const index = match.turns.findIndex((turn) => turn.turnNumber === FEATURED_TURN);
const turn = match.turns[index];
if (turn === undefined) throw new Error("Showcase match ended before its featured turn.");
const before = index === 0 ? match.initialState : match.turns[index - 1]!.stateAfter;
// The showcase is an omniscient spectator view. Per-team sight events would
// make the movie add and remove robots as each team spots or loses them.
const SIGHT_EVENTS = new Set(["enemy-spotted", "enemy-lost", "last-known-marker"]);
const events = turn.events.filter((event) => !SIGHT_EVENTS.has(event.kind));
const out = new URL("../src/lib/replays/showcase.json", import.meta.url);
writeFileSync(
  out,
  `${JSON.stringify({
    source: { ...OPTIONS, turn: FEATURED_TURN },
    initialState: serializeMatchState(before),
    events,
  })}\n`,
);
console.log(`wrote ${out.pathname} (${events.length} events)`);
