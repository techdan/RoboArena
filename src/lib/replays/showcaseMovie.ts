/** Showcase movie for the debug movie route: one turn of a real, seeded
 *  four-team autoplay match (see scripts/generate-showcase.ts). Unlike the
 *  hand-written canned movie it exercises every robot class, missiles, mass
 *  casualties and simultaneous fire. Non-authoritative; nothing here touches a room.
 */

import type { MatchState, ResolutionEvent } from "../../engine/types";
import { deserializeMatchState, type SerializedMatchState } from "../net/protocol";
import showcase from "./showcase.json";

export interface ShowcaseMovie {
  readonly initialState: MatchState;
  readonly events: readonly ResolutionEvent[];
  readonly turnNumber: number;
  readonly arenaName: string;
  readonly destroyed: number;
  readonly hits: number;
}

export function createShowcaseMovie(): ShowcaseMovie {
  const events = showcase.events as unknown as readonly ResolutionEvent[];
  const initialState = deserializeMatchState(
    showcase.initialState as unknown as SerializedMatchState,
  );
  return {
    initialState,
    events,
    turnNumber: showcase.source.turn,
    arenaName: initialState.arena.sizeName,
    destroyed: events.filter((event) => event.kind === "destroyed").length,
    hits: events.filter((event) => event.kind === "damaged").length,
  };
}
