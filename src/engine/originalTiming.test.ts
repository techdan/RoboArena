/** Rules revision 4: original combat timing (re-map/commands.md §9, docs/spec.md §4-5). */

import { describe, expect, it } from "vitest";

import { makeMatch, makeOpenArena, makeRobot } from "./__fixtures__/match.js";
import { createReplayLog, verifyReplay } from "./replay.js";
import { resolveTurn, type TurnResult } from "./resolver.js";
import type { GameConfig, MatchState, ResolutionEvent, TurnOrders, WeaponId } from "./types.js";

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

const aim = (target: { x: number; y: number }, weapon: WeaponId = "rifle") =>
  ({ kind: "aim-and-fire", target, weapon, repeat: false }) as const;

describe("delayed bullet impact (seg6:0x3CAE, seg6:0x556F)", () => {
  const duel = (targetHp = 140) =>
    revision4(
      makeMatch({
        arena: makeOpenArena(12, 12),
        teamOneRobots: [
          makeRobot("a", "team-1", "rifle", { x: 2, y: 5 }),
          makeRobot("b", "team-1", "rifle", { x: 2, y: 6 }),
        ],
        teamTwoRobots: [
          makeRobot("t", "team-2", "rifle", { x: 4, y: 5 }, { hp: targetHp, scanHeading: "W" }),
        ],
      }),
    );

  it("rolls at fire time and lands 5 ticks later (seg6:0x3D2B)", () => {
    const orders: TurnOrders = {
      turnNumber: 1,
      timelines: [{ robotId: "a", segments: [aim({ x: 4, y: 5 })] }],
    };
    const events = resolved(duel(), orders).events;
    expect(ofKind(events, "fired").map((event) => event.tick)).toEqual([0]);
    expect(ofKind(events, "projectile-launched").map((event) => event.tick)).toEqual([0]);
    expect(
      ofKind(events, "projectile-impacted").map((event) => [event.tick, event.outcome]),
    ).toEqual([[5, "hit"]]);
    expect(ofKind(events, "damaged").map((event) => event.tick)).toEqual([5]);
  });

  it("lands on the locked robot after it has switched tiles (seg6:0x56CD)", () => {
    const orders: TurnOrders = {
      turnNumber: 1,
      timelines: [
        // A 10-tick posture record delays the shot to tick 10.
        {
          robotId: "a",
          segments: [{ kind: "set-posture", posture: "ducking" }, aim({ x: 4, y: 5 })],
        },
        {
          robotId: "t",
          segments: [{ kind: "move", posture: "upright", path: [{ to: { x: 4, y: 4 } }] }],
        },
      ],
    };
    const events = resolved(duel(), orders).events;
    expect(ofKind(events, "fired").map((event) => [event.tick, event.target])).toEqual([
      [10, { x: 4, y: 5 }],
    ]);
    // The target occupies (4,4) at tick 15, before the queue pass of that step.
    expect(ofKind(events, "move-step").map((event) => event.tick)).toEqual([15]);
    expect(
      ofKind(events, "projectile-impacted").map((event) => [event.tick, event.target]),
    ).toEqual([[15, { x: 4, y: 4 }]]);
    expect(ofKind(events, "damaged").map((event) => [event.tick, event.targetId])).toEqual([
      [15, "t"],
    ]);
  });

  it("lands newest first and cuts damage to the armor left (seg6:0x1B31, seg6:0x5B09)", () => {
    const orders: TurnOrders = {
      turnNumber: 1,
      timelines: [
        { robotId: "a", segments: [aim({ x: 4, y: 5 })] },
        { robotId: "b", segments: [aim({ x: 4, y: 5 })] },
      ],
    };
    const events = resolved(duel(10), orders).events;
    expect(ofKind(events, "projectile-impacted").map((event) => event.projectileId)).toEqual([
      "1:b:0:0:0",
      "1:a:0:0:0",
    ]);
    expect(ofKind(events, "damaged").map((event) => [event.sourceId, event.damage])).toEqual([
      ["b", 10],
    ]);
    expect(ofKind(events, "destroyed").map((event) => event.tick)).toEqual([5]);
  });

  it("lets every robot act before the step's impacts land (seg6:0x4802..0x4824)", () => {
    const orders: TurnOrders = {
      turnNumber: 1,
      timelines: [
        { robotId: "a", segments: [aim({ x: 4, y: 5 })] },
        {
          robotId: "t",
          segments: [{ kind: "set-scan-direction", heading: "NW" }, aim({ x: 2, y: 5 })],
        },
      ],
    };
    const events = resolved(duel(1), orders).events;
    expect(ofKind(events, "fired").map((event) => [event.tick, event.shooterId])).toEqual([
      [0, "a"],
      [5, "t"],
    ]);
    expect(ofKind(events, "destroyed").map((event) => [event.tick, event.robotId])).toEqual([
      [5, "t"],
    ]);
    // The dead robot's bullet is already in flight and still lands.
    expect(
      ofKind(events, "projectile-impacted").map((event) => [event.tick, event.projectileId]),
    ).toEqual([
      [5, "1:a:0:0:0"],
      [10, "1:t:1:5:0"],
    ]);
  });

  it("keeps revision 3 damage on the fire tick", () => {
    const base = duel();
    const state = { ...base, config: { ...base.config, rulesRevision: 3 as const } };
    const orders: TurnOrders = {
      turnNumber: 1,
      timelines: [{ robotId: "a", segments: [aim({ x: 4, y: 5 })] }],
    };
    expect(ofKind(resolved(state, orders).events, "damaged").map((event) => event.tick)).toEqual([
      0,
    ]);
  });

  it("verifies in a replay", () => {
    const orders: TurnOrders = {
      turnNumber: 1,
      timelines: [
        { robotId: "a", segments: [aim({ x: 4, y: 5 }), aim({ x: 4, y: 5 })] },
        { robotId: "b", segments: [aim({ x: 4, y: 5 })] },
        { robotId: "t", segments: [aim({ x: 2, y: 5 })] },
      ],
    };
    const replay = createReplayLog({ initialState: duel(30), turns: [{ seed: "b", orders }] });
    expect(verifyReplay(replay)).toEqual({ ok: true });
  });
});
