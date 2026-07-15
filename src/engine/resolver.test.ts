import { describe, expect, it } from "vitest";

import { makeMatch, makeOpenArena, makeRobot } from "./__fixtures__/match.js";
import { resolveTurn, type ResolveTurnResult, type TurnResult } from "./resolver.js";
import type { CommandTimeline, MatchState, ResolutionEvent, TurnOrders } from "./types.js";

const ordersFor = (state: MatchState, timelines: readonly CommandTimeline[]): TurnOrders => ({
  turnNumber: state.turnNumber,
  timelines,
});

const requireResolved = (result: ResolveTurnResult): TurnResult => {
  expect(result.outcome).toBe("resolved");
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

const deepFreeze = <Value>(value: Value): Value => {
  if (value && typeof value === "object" && !(value instanceof Map)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

describe("resolveTurn", () => {
  it("emits alternating open-path arrivals at exact completion boundaries", () => {
    const state = makeMatch();
    const result = requireResolved(
      resolveTurn({
        state,
        seed: "move",
        orders: ordersFor(state, [
          {
            robotId: "r1",
            segments: [
              {
                kind: "move",
                posture: "upright",
                path: [
                  { x: 2, y: 1 },
                  { x: 3, y: 1 },
                  { x: 4, y: 1 },
                ],
              },
            ],
          },
        ]),
      }),
    );

    expect(eventsOf(result.events, "move-step").map(({ tick, to }) => ({ tick, to }))).toEqual([
      { tick: 18, to: { x: 2, y: 1 } },
      { tick: 60, to: { x: 3, y: 1 } },
      { tick: 78, to: { x: 4, y: 1 } },
    ]);
    expect(result.nextState.teams[0]?.robots[0]?.strideParity).toBe(1);
  });

  it("allows two robots to complete onto and remain on the same tile", () => {
    const a = makeRobot("a", "team-1", "rifle", { x: 1, y: 2 });
    const b = makeRobot("b", "team-1", "rifle", { x: 3, y: 2 });
    const state = makeMatch({ teamOneRobots: [a, b] });
    const result = requireResolved(
      resolveTurn({
        state,
        seed: "stack",
        orders: ordersFor(state, [
          {
            robotId: "a",
            segments: [{ kind: "move", posture: "upright", path: [{ x: 2, y: 2 }] }],
          },
          {
            robotId: "b",
            segments: [{ kind: "move", posture: "upright", path: [{ x: 2, y: 2 }] }],
          },
        ]),
      }),
    );

    expect(result.nextState.teams[0]?.robots.map((robot) => robot.position)).toEqual([
      { x: 2, y: 2 },
      { x: 2, y: 2 },
    ]);
  });

  it("completes adjacent posture changes at 6 ticks", () => {
    const state = makeMatch();
    const result = requireResolved(
      resolveTurn({
        state,
        seed: "posture",
        orders: ordersFor(state, [
          { robotId: "r1", segments: [{ kind: "set-posture", posture: "ducking" }] },
        ]),
      }),
    );
    expect(eventsOf(result.events, "posture-changed")).toMatchObject([
      { tick: 6, robotId: "r1", posture: "ducking" },
    ]);
  });

  it("completes scan rotation on its derived boundary", () => {
    const robot = makeRobot("r1", "team-1", "rifle", { x: 1, y: 1 }, { scanHeading: "N" });
    const state = makeMatch({ teamOneRobots: [robot] });
    const result = requireResolved(
      resolveTurn({
        state,
        seed: "scan",
        orders: ordersFor(state, [
          { robotId: "r1", segments: [{ kind: "set-scan-direction", heading: "W" }] },
        ]),
      }),
    );
    expect(eventsOf(result.events, "scan-rotated")).toMatchObject([
      { tick: 12, robotId: "r1", heading: "W" },
    ]);
  });

  it("deploys a docked robot into its home area after 120 ticks", () => {
    const robot = makeRobot("r1", "team-1", "rifle", "dock", { strideParity: 1 });
    const state = makeMatch({ teamOneRobots: [robot] });
    const result = requireResolved(
      resolveTurn({
        state,
        seed: "deploy",
        orders: ordersFor(state, [
          { robotId: "r1", segments: [{ kind: "deploy", to: { x: 0, y: 0 } }] },
        ]),
      }),
    );
    expect(eventsOf(result.events, "deployed")).toMatchObject([
      { tick: 120, robotId: "r1", to: { x: 0, y: 0 } },
    ]);
    expect(result.nextState.teams[0]?.robots[0]).toMatchObject({
      position: { x: 0, y: 0 },
      strideParity: 0,
    });
  });

  it("returns MalformedOrders for crouching traversal onto a bush", () => {
    const arena = makeOpenArena();
    const tiles = arena.tiles.map((row) => row.slice());
    const row = tiles[1]?.slice();
    if (!row) throw new Error("fixture row missing");
    row[2] = { terrain: "bush" };
    tiles[1] = row;
    const robot = makeRobot("r1", "team-1", "rifle", { x: 1, y: 1 }, { posture: "crouching" });
    const state = makeMatch({ teamOneRobots: [robot], arena: { ...arena, tiles } });
    const result = resolveTurn({
      state,
      seed: "bad-path",
      orders: ordersFor(state, [
        {
          robotId: "r1",
          segments: [{ kind: "move", posture: "crouching", path: [{ x: 2, y: 1 }] }],
        },
      ]),
    });
    expect(result).toMatchObject({
      outcome: "malformed-orders",
      code: "illegal-command",
      robotId: "r1",
      commandIndex: 0,
    });
  });

  it("rejects duplicate and unknown robot timelines", () => {
    const state = makeMatch();
    const duplicate = resolveTurn({
      state,
      seed: "duplicate",
      orders: ordersFor(state, [
        { robotId: "r1", segments: [] },
        { robotId: "r1", segments: [] },
      ]),
    });
    const unknown = resolveTurn({
      state,
      seed: "unknown",
      orders: ordersFor(state, [{ robotId: "missing", segments: [] }]),
    });
    expect(duplicate).toMatchObject({ outcome: "malformed-orders", code: "duplicate-timeline" });
    expect(unknown).toMatchObject({ outcome: "malformed-orders", code: "unknown-robot" });
  });

  it("explicitly rejects Scan & Fire until Phase 4", () => {
    const state = makeMatch();
    const result = resolveTurn({
      state,
      seed: "scan-fire",
      orders: ordersFor(state, [
        {
          robotId: "r1",
          segments: [{ kind: "scan-and-fire", weapon: "rifle", maxDistance: 10, seconds: 2 }],
        },
      ]),
    });
    expect(result).toMatchObject({ outcome: "malformed-orders", code: "unsupported-command" });
  });

  it("returns MalformedOrders for unknown imported commands and weapons", () => {
    const state = makeMatch();
    const unknownCommand = {
      turnNumber: state.turnNumber,
      timelines: [{ robotId: "r1", segments: [{ kind: "teleport", to: { x: 4, y: 4 } }] }],
    } as unknown as TurnOrders;
    const unknownWeapon = {
      turnNumber: state.turnNumber,
      timelines: [
        {
          robotId: "r1",
          segments: [
            { kind: "aim-and-fire", target: { x: 2, y: 1 }, weapon: "laser", repeat: false },
          ],
        },
      ],
    } as unknown as TurnOrders;

    expect(() => resolveTurn({ state, orders: unknownCommand, seed: "bad-kind" })).not.toThrow();
    expect(resolveTurn({ state, orders: unknownCommand, seed: "bad-kind" })).toMatchObject({
      outcome: "malformed-orders",
      code: "unsupported-command",
    });
    expect(resolveTurn({ state, orders: unknownWeapon, seed: "bad-weapon" })).toMatchObject({
      outcome: "malformed-orders",
      code: "unsupported-command",
    });
  });

  it("resolves stationary Aim & Fire at the catalog interval", () => {
    const target = makeRobot("r2", "team-2", "rifle", { x: 2, y: 1 }, { scanHeading: "W" });
    const state = makeMatch({ teamTwoRobots: [target] });
    const result = requireResolved(
      resolveTurn({
        state,
        seed: "stationary-fire",
        orders: ordersFor(state, [
          {
            robotId: "r1",
            segments: [
              { kind: "aim-and-fire", target: { x: 2, y: 1 }, weapon: "rifle", repeat: false },
            ],
          },
        ]),
      }),
    );
    expect(eventsOf(result.events, "fired")).toMatchObject([
      { tick: 30, shooterId: "r1", weapon: "rifle", target: { x: 2, y: 1 } },
    ]);
    expect(
      eventsOf(result.events, "damaged").length + eventsOf(result.events, "shot-missed").length,
    ).toBe(1);
  });

  it("settles same-boundary movement before applying the off-aimed-tile score halving", () => {
    const target = makeRobot("r2", "team-2", "rifle", { x: 2, y: 1 }, { scanHeading: "W" });
    const state = makeMatch({ teamTwoRobots: [target] });
    const result = requireResolved(
      resolveTurn({
        state,
        seed: "moving-target",
        orders: ordersFor(state, [
          {
            robotId: "r1",
            segments: [
              { kind: "aim-and-fire", target: { x: 2, y: 1 }, weapon: "rifle", repeat: false },
            ],
          },
          {
            robotId: "r2",
            segments: [
              { kind: "set-posture", posture: "crouching" },
              { kind: "move", posture: "crouching", path: [{ x: 3, y: 1 }] },
            ],
          },
        ]),
      }),
    );
    expect(eventsOf(result.events, "move-step")[0]?.tick).toBe(30);
    const combatEvent =
      eventsOf(result.events, "damaged")[0] ?? eventsOf(result.events, "shot-missed")[0];
    expect(combatEvent && "score" in combatEvent ? combatEvent.score : undefined).toBe(9);
  });

  it("batches same-boundary lethal fire so both robots are destroyed", () => {
    const first = makeRobot("r1", "team-1", "rifle", { x: 1, y: 1 }, { hp: 1, scanHeading: "E" });
    const second = makeRobot("r2", "team-2", "rifle", { x: 2, y: 1 }, { hp: 1, scanHeading: "W" });
    const state = makeMatch({ teamOneRobots: [first], teamTwoRobots: [second] });
    const orders = ordersFor(state, [
      {
        robotId: "r1",
        segments: [
          { kind: "aim-and-fire", target: { x: 2, y: 1 }, weapon: "rifle", repeat: false },
          { kind: "move", posture: "upright", path: [{ x: 2, y: 1 }] },
        ],
      },
      {
        robotId: "r2",
        segments: [
          { kind: "aim-and-fire", target: { x: 1, y: 1 }, weapon: "rifle", repeat: false },
          { kind: "move", posture: "upright", path: [{ x: 1, y: 1 }] },
        ],
      },
    ]);

    let result: TurnResult | undefined;
    for (let seed = 0; seed < 100 && !result; seed += 1) {
      const candidate = requireResolved(resolveTurn({ state, orders, seed: `mutual-${seed}` }));
      if (eventsOf(candidate.events, "destroyed").length === 2) result = candidate;
    }
    expect(result).toBeDefined();
    expect(eventsOf(result?.events ?? [], "destroyed").map((event) => event.robotId)).toEqual([
      "r1",
      "r2",
    ]);
    expect(
      eventsOf(result?.events ?? [], "command-start").filter((event) => event.commandIndex === 1),
    ).toEqual([]);
    expect(eventsOf(result?.events ?? [], "command-aborted")).toHaveLength(2);
  });

  it("executes a repeat shot completing exactly at tick 900 and starts nothing there", () => {
    const state = makeMatch();
    const result = requireResolved(
      resolveTurn({
        state,
        seed: "boundary",
        orders: ordersFor(state, [
          {
            robotId: "r1",
            segments: [
              { kind: "aim-and-fire", target: { x: 2, y: 1 }, weapon: "rifle", repeat: true },
            ],
          },
        ]),
      }),
    );
    expect(eventsOf(result.events, "fired")).toHaveLength(30);
    expect(eventsOf(result.events, "fired").at(-1)?.tick).toBe(900);
    expect(eventsOf(result.events, "command-start").at(-1)?.tick).toBe(870);
    expect(eventsOf(result.events, "turn-end")[0]?.tick).toBe(900);
  });

  it("returns byte-equivalent state and events for the same input and seed", () => {
    const state = makeMatch();
    const orders = ordersFor(state, [
      {
        robotId: "r1",
        segments: [
          { kind: "move", posture: "upright", path: [{ x: 2, y: 1 }] },
          { kind: "aim-and-fire", target: { x: 6, y: 6 }, weapon: "rifle", repeat: true },
        ],
      },
    ]);
    const first = requireResolved(resolveTurn({ state, orders, seed: "same" }));
    const second = requireResolved(resolveTurn({ state, orders, seed: "same" }));
    expect(first).toEqual(second);
    expect(JSON.stringify(first.events)).toBe(JSON.stringify(second.events));
  });

  it("does not mutate deeply frozen state or orders", () => {
    const state = deepFreeze(makeMatch());
    const orders = deepFreeze(
      ordersFor(state, [
        {
          robotId: "r1",
          segments: [{ kind: "move", posture: "upright", path: [{ x: 2, y: 1 }] }],
        },
      ]),
    );
    const beforeState = JSON.stringify(state);
    const beforeOrders = JSON.stringify(orders);
    expect(() => requireResolved(resolveTurn({ state, orders, seed: "frozen" }))).not.toThrow();
    expect(JSON.stringify(state)).toBe(beforeState);
    expect(JSON.stringify(orders)).toBe(beforeOrders);
  });

  it("clamps robot HP to its armor invariant", () => {
    const robot = makeRobot("r1", "team-1", "rifle", { x: 1, y: 1 }, { hp: 999 });
    const state = makeMatch({ teamOneRobots: [robot] });
    const result = requireResolved(
      resolveTurn({ state, orders: ordersFor(state, []), seed: "clamp" }),
    );
    expect(result.nextState.teams[0]?.robots[0]?.hp).toBe(robot.definition.armor);
  });

  it("assigns stable, gap-free event sequence numbers", () => {
    const state = makeMatch();
    const result = requireResolved(
      resolveTurn({ state, orders: ordersFor(state, []), seed: "seq" }),
    );
    expect(result.events.map((event) => event.seq)).toEqual([0, 1]);
    expect(result.events.map((event) => event.kind)).toEqual(["turn-start", "turn-end"]);
  });
});
