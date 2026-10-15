/** Rules revision 4: original combat timing (re-map/commands.md §9, docs/spec.md §4-5). */

import { describe, expect, it } from "vitest";

import { makeMatch, makeOpenArena, makeRobot } from "./__fixtures__/match.js";
import { createReplayLog, verifyReplay } from "./replay.js";
import { resolveTurn, type TurnResult } from "./resolver.js";
import type { GameConfig, MatchState, ResolutionEvent, TurnOrders } from "./types.js";

const revision4 = (state: MatchState, config: Partial<GameConfig> = {}): MatchState => ({
  ...state,
  config: { ...state.config, formation: "standard", rulesRevision: 4, zapArmed: true, ...config },
});

const resolved = (state: MatchState, orders: TurnOrders, seed = "timing"): TurnResult => {
  const result = resolveTurn({ state, orders, seed });
  if (result.outcome !== "resolved") throw new Error(result.message);
  return result;
};

const ofKind = <Kind extends ResolutionEvent["kind"]>(
  events: readonly ResolutionEvent[],
  kind: Kind,
): Extract<ResolutionEvent, { readonly kind: Kind }>[] =>
  events.filter(
    (event): event is Extract<ResolutionEvent, { readonly kind: Kind }> => event.kind === kind,
  );

describe("mid-move tile switch (seg6:0x2D59, seg6:0x2E04)", () => {
  const walker = () =>
    revision4(
      makeMatch({
        arena: makeOpenArena(12, 12),
        teamOneRobots: [makeRobot("w", "team-1", "rifle", { x: 5, y: 5 })],
      }),
    );

  it("occupies the next tile 15 ticks into each 1-tile step", () => {
    const orders: TurnOrders = {
      turnNumber: 1,
      timelines: [
        {
          robotId: "w",
          segments: [
            {
              kind: "move",
              posture: "upright",
              path: [{ to: { x: 6, y: 5 } }, { to: { x: 7, y: 5 } }],
            },
          ],
        },
      ],
    };
    const steps = ofKind(resolved(walker(), orders).events, "move-step");
    expect(steps.map((event) => [event.tick, event.to])).toEqual([
      [15, { x: 6, y: 5 }],
      [45, { x: 7, y: 5 }],
    ]);
  });

  it("occupies the floored midpoint at 15 and the destination at 25 in a 2-tile step", () => {
    const orders: TurnOrders = {
      turnNumber: 1,
      timelines: [
        {
          robotId: "w",
          segments: [
            {
              kind: "move",
              posture: "upright",
              path: [{ via: { x: 6, y: 5 }, to: { x: 7, y: 4 } }],
            },
          ],
        },
      ],
    };
    const result = resolved(walker(), orders);
    expect(ofKind(result.events, "move-step").map((event) => [event.tick, event.to])).toEqual([
      [15, { x: 6, y: 4 }],
      [25, { x: 7, y: 4 }],
    ]);
    const robot = result.nextState.teams[0]!.robots[0]!;
    expect(robot.position).toEqual({ x: 7, y: 4 });
  });

  it("keeps earlier revisions moving at step completion", () => {
    const base = walker();
    const state = { ...base, config: { ...base.config, rulesRevision: 3 as const } };
    const orders: TurnOrders = {
      turnNumber: 1,
      timelines: [
        {
          robotId: "w",
          segments: [{ kind: "move", posture: "upright", path: [{ to: { x: 6, y: 5 } }] }],
        },
      ],
    };
    expect(ofKind(resolved(state, orders).events, "move-step").map((event) => event.tick)).toEqual([
      30,
    ]);
  });

  it("verifies in a replay", () => {
    const orders: TurnOrders = {
      turnNumber: 1,
      timelines: [
        {
          robotId: "w",
          segments: [
            {
              kind: "move",
              posture: "upright",
              path: [{ to: { x: 6, y: 5 } }, { via: { x: 7, y: 5 }, to: { x: 8, y: 5 } }],
            },
          ],
        },
      ],
    };
    const replay = createReplayLog({ initialState: walker(), turns: [{ seed: "a", orders }] });
    expect(verifyReplay(replay)).toEqual({ ok: true });
  });
});
