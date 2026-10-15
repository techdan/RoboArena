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

const LINEUP_CLASSES = ["rifle", "burst", "auto", "missile"] as const;

/**
 * Model-sheet lineup for art review: one robot of each class standing in a
 * cleared strip of the showcase arena, facing the south camera, with no events.
 */
export function createLineupMovie(): ShowcaseMovie {
  const base = createShowcaseMovie().initialState;
  const allRobots = base.teams.flatMap((team) => team.robots);
  const tiles = base.arena.tiles.map((row, y) =>
    row.map((tile, x) =>
      y >= 10 && y <= 20 && x >= 4 && x <= 19 ? { ...tile, terrain: "open" as const } : tile,
    ),
  );
  const teams = base.teams.map((team, index) => {
    const robotClass = LINEUP_CLASSES[index % LINEUP_CLASSES.length];
    const robot = allRobots.find((candidate) => candidate.definition.class === robotClass);
    return {
      ...team,
      robots:
        robot === undefined
          ? []
          : [
              {
                ...robot,
                id: `${team.id}-lineup`,
                teamId: team.id,
                position: { x: 8 + index * 2, y: 12 },
                posture: "upright" as const,
                scanHeading: "S" as const,
              },
            ],
    };
  });
  return {
    initialState: { ...base, arena: { ...base.arena, tiles }, teams },
    events: [],
    turnNumber: 0,
    arenaName: base.arena.sizeName,
    destroyed: 0,
    hits: 0,
  };
}
