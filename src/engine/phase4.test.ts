import { describe, expect, it } from "vitest";

import { makeMatch, makeOpenArena, makeRobot } from "./__fixtures__/match.js";
import { resolveTurn, type TurnResult } from "./resolver.js";
import type { CommandTimeline, MatchState, ResolutionEvent, TurnOrders } from "./types.js";

const ordersFor = (state: MatchState, timelines: readonly CommandTimeline[]): TurnOrders => ({
  turnNumber: state.turnNumber,
  timelines,
});

const requireResolved = (result: ReturnType<typeof resolveTurn>): TurnResult => {
  if (result.outcome !== "resolved") throw new Error(result.message);
  return result;
};

const eventsOf = <Kind extends ResolutionEvent["kind"]>(
  events: readonly ResolutionEvent[],
  kind: Kind,
): Extract<ResolutionEvent, { readonly kind: Kind }>[] =>
  events.filter(
    (event): event is Extract<ResolutionEvent, { readonly kind: Kind }> => event.kind === kind,
  );

describe("Phase 4 resolver integration", () => {
  it("acquires a runner on its settled tile when it enters the cone at tick 80", () => {
    const scanner = makeRobot("s1", "team-1", "rifle", { x: 4, y: 3 });
    const runner = makeRobot("r2", "team-2", "rifle", { x: 1, y: 3 });
    const state = makeMatch({
      arena: makeOpenArena(12, 8),
      teamOneRobots: [scanner],
      teamTwoRobots: [runner],
    });
    const result = requireResolved(
      resolveTurn({
        state,
        seed: "runner-enters",
        orders: ordersFor(state, [
          {
            robotId: scanner.id,
            segments: [{ kind: "scan-and-fire", weapon: "rifle", maxDistance: 10, seconds: 3 }],
          },
          {
            robotId: runner.id,
            segments: [
              {
                kind: "move",
                posture: "upright",
                path: [
                  { to: { x: 3, y: 3 }, via: { x: 2, y: 3 } },
                  { to: { x: 5, y: 3 }, via: { x: 4, y: 3 } },
                ],
              },
            ],
          },
        ]),
      }),
    );

    expect(eventsOf(result.events, "move-step").map((event) => event.tick)).toEqual([40, 80]);
    expect(eventsOf(result.events, "scan-target-acquired")[0]).toMatchObject({
      tick: 80,
      shooterId: scanner.id,
      targetId: runner.id,
      distance: 1,
    });
    expect(eventsOf(result.events, "fired")[0]).toMatchObject({
      tick: 80,
      fireMode: "scan",
      target: { x: 5, y: 3 },
    });
  });

  it("uses the named Scan repeat interval and reacquires at each opportunity", () => {
    const scanner = makeRobot("s1", "team-1", "burst", { x: 1, y: 3 });
    const target = makeRobot("r2", "team-2", "rifle", { x: 11, y: 3 });
    const state = makeMatch({
      arena: makeOpenArena(16, 8),
      turnLengthSeconds: 1,
      teamOneRobots: [scanner],
      teamTwoRobots: [target],
    });
    const result = requireResolved(
      resolveTurn({
        state,
        seed: "burst-scan-cadence",
        orders: ordersFor(state, [
          {
            robotId: scanner.id,
            segments: [{ kind: "scan-and-fire", weapon: "burst-gun", maxDistance: 12, seconds: 1 }],
          },
        ]),
      }),
    );

    expect(eventsOf(result.events, "fired").map((event) => event.tick)).toEqual([0, 20, 40]);
    expect(eventsOf(result.events, "scan-target-acquired").map((event) => event.targetId)).toEqual([
      target.id,
      target.id,
      target.id,
    ]);
  });

  it("passes terrain sight strength into the live-fire score", () => {
    const baseArena = makeOpenArena(18, 8);
    const arena = {
      ...baseArena,
      tiles: baseArena.tiles.map((row, y) =>
        row.map((tile, x) => {
          if (y !== 3) return tile;
          if (x === 14) return { terrain: "low-wall" as const };
          if (x === 4 || x === 7 || x === 10) return { terrain: "bush" as const };
          return tile;
        }),
      ),
    };
    const scanner = makeRobot("s1", "team-1", "rifle", { x: 1, y: 3 });
    const target = {
      ...makeRobot("r2", "team-2", "rifle", { x: 14, y: 3 }),
      posture: "crouching" as const,
    };
    const state = makeMatch({ arena, teamOneRobots: [scanner], teamTwoRobots: [target] });
    const result = requireResolved(
      resolveTurn({
        state,
        seed: "scan-sight-score",
        orders: ordersFor(state, [
          {
            robotId: scanner.id,
            segments: [{ kind: "scan-and-fire", weapon: "rifle", maxDistance: 18, seconds: 1 }],
          },
        ]),
      }),
    );

    expect(eventsOf(result.events, "scan-target-acquired")).toHaveLength(2);
    expect(eventsOf(result.events, "shot-missed")[0]).toMatchObject({
      reason: "hit-roll",
      score: 0,
    });
  });

  it("decrements explosive ammo at Scan fire time and stops at zero", () => {
    const scanner = makeRobot("m1", "team-1", "missile", { x: 1, y: 3 });
    const targets = [
      makeRobot("r1", "team-2", "rifle", { x: 5, y: 3 }),
      makeRobot("r2", "team-2", "rifle", { x: 10, y: 3 }),
      makeRobot("r3", "team-2", "rifle", { x: 15, y: 3 }),
    ];
    const state = makeMatch({
      arena: makeOpenArena(20, 8),
      teamOneRobots: [scanner],
      teamTwoRobots: targets,
    });
    const result = requireResolved(
      resolveTurn({
        state,
        seed: "scan-missile-ammo",
        orders: ordersFor(state, [
          {
            robotId: scanner.id,
            segments: [
              {
                kind: "scan-and-fire",
                weapon: "missile-launcher",
                maxDistance: 18,
                seconds: 3,
              },
              { kind: "set-posture", posture: "ducking" },
            ],
          },
        ]),
      }),
    );

    expect(eventsOf(result.events, "fired").map((event) => event.tick)).toEqual([0, 20, 40]);
    expect(result.nextState.teams[0]?.robots[0]?.ammo["missile-launcher"]).toBe(0);
    expect(eventsOf(result.events, "command-start")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tick: 40, robotId: scanner.id, commandIndex: 1 }),
      ]),
    );
  });

  it("terminates at seconds × 60 without firing and starts the next command", () => {
    const scanner = makeRobot("s1", "team-1", "rifle", { x: 4, y: 3 });
    const hidden = makeRobot("r2", "team-2", "rifle", { x: 2, y: 3 });
    const state = makeMatch({
      arena: makeOpenArena(10, 8),
      teamOneRobots: [scanner],
      teamTwoRobots: [hidden],
    });
    const result = requireResolved(
      resolveTurn({
        state,
        seed: "scan-expires",
        orders: ordersFor(state, [
          {
            robotId: scanner.id,
            segments: [
              { kind: "scan-and-fire", weapon: "rifle", maxDistance: 10, seconds: 1 },
              { kind: "set-posture", posture: "ducking" },
            ],
          },
        ]),
      }),
    );

    expect(eventsOf(result.events, "fired")).toEqual([]);
    expect(eventsOf(result.events, "command-start")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tick: 60, robotId: scanner.id, commandIndex: 1 }),
      ]),
    );
    expect(eventsOf(result.events, "posture-changed")[0]?.tick).toBe(70);
  });

  it("checks immediately when Scan & Fire starts after another command", () => {
    const scanner = makeRobot("s1", "team-1", "rifle", { x: 1, y: 3 });
    const target = makeRobot("r2", "team-2", "rifle", { x: 5, y: 3 });
    const state = makeMatch({
      arena: makeOpenArena(10, 8),
      teamOneRobots: [scanner],
      teamTwoRobots: [target],
    });
    const result = requireResolved(
      resolveTurn({
        state,
        seed: "scheduled-start",
        orders: ordersFor(state, [
          {
            robotId: scanner.id,
            segments: [
              { kind: "set-posture", posture: "ducking" },
              { kind: "scan-and-fire", weapon: "rifle", maxDistance: 10, seconds: 1 },
            ],
          },
        ]),
      }),
    );

    expect(eventsOf(result.events, "command-start")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tick: 10, robotId: scanner.id, commandIndex: 1 }),
      ]),
    );
    expect(eventsOf(result.events, "fired")[0]?.tick).toBe(10);
  });

  it("emits visibility transitions and records the last visible enemy tile", () => {
    const observer = makeRobot("o1", "team-1", "rifle", { x: 4, y: 3 });
    const runner = makeRobot("r2", "team-2", "rifle", { x: 5, y: 3 });
    const state = makeMatch({
      arena: makeOpenArena(10, 8),
      teamOneRobots: [observer],
      teamTwoRobots: [runner],
    });
    const result = requireResolved(
      resolveTurn({
        state,
        seed: "visibility-transition",
        orders: ordersFor(state, [
          {
            robotId: runner.id,
            segments: [
              {
                kind: "move",
                posture: "upright",
                path: [{ to: { x: 3, y: 3 }, via: { x: 4, y: 3 } }],
              },
            ],
          },
        ]),
      }),
    );

    expect(eventsOf(result.events, "enemy-spotted")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tick: 0, teamId: "team-1", enemyId: runner.id }),
      ]),
    );
    expect(eventsOf(result.events, "enemy-lost")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tick: 40, teamId: "team-1", lastSeenAt: { x: 5, y: 3 } }),
      ]),
    );
    expect(eventsOf(result.events, "last-known-marker")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ teamId: "team-1", enemyId: runner.id, at: { x: 5, y: 3 } }),
      ]),
    );
    expect(result.nextState.lastKnownMarkers.get("team-1")).toContainEqual({
      enemyId: runner.id,
      at: { x: 5, y: 3 },
    });
  });

  it("clears a stale marker when that enemy is visible at a new tile", () => {
    const observer = makeRobot("o1", "team-1", "rifle", { x: 1, y: 3 });
    const enemy = makeRobot("r2", "team-2", "rifle", { x: 5, y: 3 });
    const base = makeMatch({
      arena: makeOpenArena(10, 8),
      teamOneRobots: [observer],
      teamTwoRobots: [enemy],
    });
    const state: MatchState = {
      ...base,
      lastKnownMarkers: new Map([["team-1", [{ enemyId: enemy.id, at: { x: 8, y: 7 } }]]]),
    };
    const result = requireResolved(
      resolveTurn({ state, orders: ordersFor(state, []), seed: "marker-cleared" }),
    );

    expect(result.nextState.lastKnownMarkers.get("team-1")).toEqual([]);
  });

  it("rejects malformed Scan & Fire limits without mutating state", () => {
    const state = makeMatch();
    const before = JSON.stringify(state);
    const result = resolveTurn({
      state,
      seed: "bad-scan",
      orders: ordersFor(state, [
        {
          robotId: "r1",
          segments: [{ kind: "scan-and-fire", weapon: "rifle", maxDistance: 19, seconds: 0 }],
        },
      ]),
    });

    expect(result).toMatchObject({ outcome: "malformed-orders", code: "illegal-command" });
    expect(JSON.stringify(state)).toBe(before);
  });

  it("is deterministic for the same Phase 4 input and seed", () => {
    const scanner = makeRobot("s1", "team-1", "rifle", { x: 1, y: 3 });
    const target = makeRobot("r2", "team-2", "rifle", { x: 6, y: 3 });
    const state = makeMatch({
      arena: makeOpenArena(10, 8),
      turnLengthSeconds: 1,
      teamOneRobots: [scanner],
      teamTwoRobots: [target],
    });
    const orders = ordersFor(state, [
      {
        robotId: scanner.id,
        segments: [
          { kind: "scan-and-fire" as const, weapon: "rifle" as const, maxDistance: 10, seconds: 1 },
        ],
      },
    ]);
    const first = requireResolved(resolveTurn({ state, orders, seed: "phase4-same" }));
    const second = requireResolved(resolveTurn({ state, orders, seed: "phase4-same" }));

    expect(first).toEqual(second);
    expect(JSON.stringify(first.events)).toBe(JSON.stringify(second.events));
  });
});
