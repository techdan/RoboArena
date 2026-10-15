/** Rules revision 4: original combat timing (re-map/commands.md §9, docs/spec.md §4-5). */

import { describe, expect, it } from "vitest";

import { makeMatch, makeOpenArena, makeRobot } from "./__fixtures__/match.js";
import {
  explosiveFlightTicks,
  explosiveLanding,
  explosivePathAttempt,
  explosivePathTiles,
  scatterGrenade,
  scatterMissile,
} from "./originalTiming.js";
import { createReplayLog, verifyReplay } from "./replay.js";
import { resolveTurn, type TurnResult } from "./resolver.js";
import type {
  Arena,
  GameConfig,
  MatchState,
  ResolutionEvent,
  RobotState,
  Terrain,
  TurnOrders,
  WeaponId,
} from "./types.js";

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

/** A scripted RNG stream that fails the test when more draws are taken. */
const script = (...values: number[]) => {
  let index = 0;
  const draw = (): number => {
    const value = values[index];
    if (value === undefined) throw new Error(`unexpected draw ${index}`);
    index += 1;
    return value;
  };
  return Object.assign(draw, { used: () => index });
};

const withTerrain = (
  arena: Arena,
  tiles: readonly (readonly [number, number, Terrain])[],
): Arena => ({
  ...arena,
  tiles: arena.tiles.map((row, y) =>
    row.map((tile, x) => {
      const match = tiles.find(([tx, ty]) => tx === x && ty === y);
      return match ? { terrain: match[2] } : tile;
    }),
  ),
});

/** Formation grenades: every robot carries them as a secondary weapon (re-map/setup.md §5.1). */
const armed = (robot: RobotState, weapon: WeaponId, ammo: number): RobotState => ({
  ...robot,
  definition: {
    ...robot.definition,
    secondaryWeapons: [...(robot.definition.secondaryWeapons ?? []), weapon],
  },
  ammo: { ...robot.ammo, [weapon]: ammo },
});

describe("explosive scatter (seg6:0x39C7, seg6:0x3BA6)", () => {
  const origin = { x: 0, y: 0 };

  it("throws a grenade exactly within 4 tiles in the front arc, with no draws", () => {
    const draw = script();
    expect(scatterGrenade({ shooter: origin, heading: "E", target: { x: 4, y: 0 }, draw })).toEqual(
      { x: 4, y: 0 },
    );
    expect(draw.used()).toBe(0);
  });

  it("jitters a grenade by T[r&3] up to 8 tiles in the front arc", () => {
    const draw = script(1, 3);
    expect(scatterGrenade({ shooter: origin, heading: "E", target: { x: 6, y: 0 }, draw })).toEqual(
      { x: 6, y: 1 },
    );
  });

  it("scales a long grenade throw by ((r&7)+(r&3)+10)/16, truncating toward zero", () => {
    // f = 3 + 1 + 10 = 14; 13·14·16/256 = 11.375 → 11; jitter T[4] = -2, T[5] = -1.
    const draw = script(3, 1, 4, 5);
    expect(
      scatterGrenade({ shooter: origin, heading: "E", target: { x: 13, y: 0 }, draw }),
    ).toEqual({ x: 9, y: -1 });
  });

  it("uses T[r&3] outside the front arc up to 12 tiles", () => {
    // f = 13 + 7 = 20; −5·20·16/256 = −6.25 → −6; jitter T[3] = 1, T[0] = −1.
    const draw = script(7, 3, 0);
    expect(
      scatterGrenade({ shooter: { x: 5, y: 5 }, heading: "E", target: { x: 0, y: 5 }, draw }),
    ).toEqual({ x: 0, y: 4 });
    expect(draw.used()).toBe(3);
  });

  it("keeps a missile on target within 12 tiles in the front arc", () => {
    const draw = script();
    expect(
      scatterMissile({ shooter: origin, heading: "E", target: { x: 12, y: 0 }, draw }),
    ).toEqual({ x: 12, y: 0 });
  });

  it("jitters a missile by T[r&3] near and T[r&7] far outside the arc", () => {
    expect(
      scatterMissile({
        shooter: { x: 10, y: 0 },
        heading: "E",
        target: { x: 2, y: 0 },
        draw: script(3, 2),
      }),
    ).toEqual({ x: 3, y: 0 });
    expect(
      scatterMissile({
        shooter: { x: 10, y: 0 },
        heading: "E",
        target: { x: 1, y: 0 },
        draw: script(7, 4),
      }),
    ).toEqual({ x: 3, y: -2 });
  });
});

describe("explosive path stop (seg87:0x2B36, seg87:0x2B77, seg56:0x0509)", () => {
  const open = makeOpenArena(12, 12);

  it("walks a tile Bresenham that excludes the start and includes the end", () => {
    expect(explosivePathTiles({ x: 0, y: 0 }, { x: 3, y: 1 })).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ]);
    // Ties are y-major.
    expect(explosivePathTiles({ x: 0, y: 0 }, { x: 2, y: 2 })).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
  });

  it("lands on the tile before a Wall", () => {
    const arena = withTerrain(open, [[4, 0, "wall"]]);
    expect(
      explosivePathAttempt({ arena, from: { x: 0, y: 0 }, to: { x: 8, y: 0 }, draw: script() }),
    ).toEqual({ ok: true, landing: { x: 3, y: 0 } });
  });

  it("rolls once per Low Wall, stopping on (r & 0xFF) >= the path threshold", () => {
    // Index 1 passes at 256 (still one draw); index 3 stops at 248 or more.
    const arena = withTerrain(open, [
      [2, 0, "low-wall"],
      [4, 0, "low-wall"],
    ]);
    const draw = script(255, 248);
    expect(explosivePathAttempt({ arena, from: { x: 0, y: 0 }, to: { x: 8, y: 0 }, draw })).toEqual(
      { ok: true, landing: { x: 3, y: 0 } },
    );
    expect(draw.used()).toBe(2);
  });

  it("fails an attempt that passes under 2 tiles, or under 4 beyond 10", () => {
    expect(
      explosivePathAttempt({
        arena: open,
        from: { x: 0, y: 0 },
        to: { x: 1, y: 0 },
        draw: script(),
      }).ok,
    ).toBe(false);
    const walled = withTerrain(open, [[4, 0, "wall"]]);
    expect(
      explosivePathAttempt({
        arena: walled,
        from: { x: 0, y: 0 },
        to: { x: 11, y: 0 },
        draw: script(),
      }),
    ).toEqual({ ok: false, landing: { x: 3, y: 0 } });
  });

  it("throws again at the exact aim point when the scattered attempt fails", () => {
    expect(
      explosiveLanding({
        arena: open,
        from: { x: 0, y: 0 },
        scattered: { x: 1, y: 0 },
        aim: { x: 5, y: 0 },
        draw: script(),
      }),
    ).toEqual({ x: 5, y: 0 });
    // Off-arena points are clamped first.
    expect(
      explosivePathAttempt({
        arena: open,
        from: { x: 9, y: 0 },
        to: { x: 14, y: 0 },
        draw: script(),
      }),
    ).toEqual({ ok: true, landing: { x: 11, y: 0 } });
  });

  it("flies 5·d + 20 ticks for a grenade and 5·(d >> 1) + 10 for a missile", () => {
    expect(explosiveFlightTicks("grenade-launcher", { x: 0, y: 0 }, { x: 4, y: 3 })).toBe(45);
    expect(explosiveFlightTicks("missile-launcher", { x: 0, y: 0 }, { x: 4, y: 3 })).toBe(20);
    expect(explosiveFlightTicks("missile-launcher", { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(10);
  });
});

describe("explosive flight in the resolver (seg6:0x218D, seg6:0x266F, seg6:0x556F)", () => {
  const range = (input: { shooterHeading?: "E" | "W"; arena?: Arena; targetHp?: number } = {}) =>
    revision4(
      makeMatch({
        arena: input.arena ?? makeOpenArena(14, 12),
        teamOneRobots: [
          armed(
            makeRobot(
              "m",
              "team-1",
              "missile",
              { x: 2, y: 5 },
              {
                scanHeading: input.shooterHeading ?? "E",
              },
            ),
            "grenade-launcher",
            3,
          ),
        ],
        teamTwoRobots: [
          makeRobot("t", "team-2", "rifle", { x: 8, y: 5 }, { hp: input.targetHp ?? 400 }),
        ],
      }),
    );

  it("lands a missile 5·(d >> 1) + 10 ticks after it fires and blasts then", () => {
    const orders: TurnOrders = {
      turnNumber: 1,
      timelines: [{ robotId: "m", segments: [aim({ x: 8, y: 5 }, "missile-launcher")] }],
    };
    const events = resolved(range(), orders).events;
    expect(
      ofKind(events, "projectile-launched").map((event) => [event.tick, event.target]),
    ).toEqual([[0, { x: 8, y: 5 }]]);
    expect(
      ofKind(events, "projectile-impacted").map((event) => [event.tick, event.outcome]),
    ).toEqual([[25, "blast"]]);
    expect(ofKind(events, "damaged").map((event) => [event.tick, event.targetId])).toEqual([
      [25, "t"],
    ]);
  });

  it("rolls the blast against where robots are when it lands (seg6:0x5D73)", () => {
    const orders: TurnOrders = {
      turnNumber: 1,
      timelines: [
        { robotId: "m", segments: [aim({ x: 8, y: 5 }, "missile-launcher")] },
        {
          robotId: "t",
          segments: [{ kind: "move", posture: "upright", path: [{ to: { x: 8, y: 4 } }] }],
        },
      ],
    };
    const events = resolved(range(), orders).events;
    const damaged = ofKind(events, "damaged");
    expect(damaged.map((event) => event.tick)).toEqual([25]);
    expect(damaged[0]).toMatchObject({ targetId: "t", damageKind: "blast", radius: 1 });
  });

  it("lands a grenade 5·d + 20 ticks after it fires (seg6:0x230C)", () => {
    const orders: TurnOrders = {
      turnNumber: 1,
      timelines: [{ robotId: "m", segments: [aim({ x: 6, y: 5 }, "grenade-launcher")] }],
    };
    const events = resolved(range(), orders).events;
    expect(
      ofKind(events, "projectile-impacted").map((event) => [event.tick, event.target]),
    ).toEqual([[40, { x: 6, y: 5 }]]);
  });

  it("stops a grenade before a Wall instead of missing", () => {
    const arena = withTerrain(
      makeOpenArena(14, 12),
      Array.from({ length: 12 }, (_, y) => [5, y, "wall"] as const),
    );
    const orders: TurnOrders = {
      turnNumber: 1,
      timelines: [{ robotId: "m", segments: [aim({ x: 7, y: 5 }, "grenade-launcher")] }],
    };
    const events = resolved(range({ arena }), orders).events;
    const [impact] = ofKind(events, "projectile-impacted");
    expect(impact).toMatchObject({ tick: 30, outcome: "blast", target: { x: 4 } });
    expect(ofKind(events, "shot-missed")).toEqual([]);
  });

  it("launches outside the scan cone with no range or sight check", () => {
    const orders: TurnOrders = {
      turnNumber: 1,
      timelines: [{ robotId: "m", segments: [aim({ x: 6, y: 5 }, "grenade-launcher")] }],
    };
    const events = resolved(range({ shooterHeading: "W" }), orders).events;
    expect(ofKind(events, "projectile-impacted").map((event) => event.outcome)).toEqual(["blast"]);
    expect(ofKind(events, "shot-missed")).toEqual([]);
  });

  it("holds grenade Scan & Fire while the target is closer than 2 (seg6:0x24FA)", () => {
    const close = (rulesRevision: 3 | 4) => {
      const base = revision4(
        makeMatch({
          arena: makeOpenArena(12, 12),
          teamOneRobots: [
            armed(makeRobot("g", "team-1", "rifle", { x: 2, y: 5 }), "grenade-launcher", 3),
          ],
          teamTwoRobots: [makeRobot("t", "team-2", "rifle", { x: 3, y: 5 })],
        }),
      );
      return { ...base, config: { ...base.config, rulesRevision } };
    };
    const orders: TurnOrders = {
      turnNumber: 1,
      timelines: [
        {
          robotId: "g",
          segments: [
            { kind: "scan-and-fire", weapon: "grenade-launcher", maxDistance: 18, seconds: 2 },
          ],
        },
      ],
    };
    expect(ofKind(resolved(close(4), orders).events, "fired")).toEqual([]);
    expect(ofKind(resolved(close(3), orders).events, "fired").length).toBeGreaterThan(0);
  });

  it("verifies in a replay", () => {
    const arena = withTerrain(makeOpenArena(14, 12), [
      [4, 5, "low-wall"],
      [6, 4, "wall"],
    ]);
    const orders: TurnOrders = {
      turnNumber: 1,
      timelines: [
        {
          robotId: "m",
          segments: [
            aim({ x: 12, y: 3 }, "grenade-launcher"),
            aim({ x: 8, y: 5 }, "missile-launcher"),
          ],
        },
        {
          robotId: "t",
          segments: [{ kind: "move", posture: "upright", path: [{ to: { x: 9, y: 5 } }] }],
        },
      ],
    };
    const replay = createReplayLog({
      initialState: range({ arena }),
      turns: [{ seed: "c", orders }],
    });
    expect(verifyReplay(replay)).toEqual({ ok: true });
  });
});

describe("the movie tail after turn length (seg6:0x47DE, seg6:0x4A60, seg6:0x6330)", () => {
  // One-second turns: turn length is 60 ticks.
  const shortTurn = (rulesRevision: 3 | 4 = 4) => {
    const base = revision4(
      makeMatch({
        arena: makeOpenArena(14, 12),
        turnLengthSeconds: 1,
        teamOneRobots: [makeRobot("m", "team-1", "missile", { x: 1, y: 5 })],
        teamTwoRobots: [makeRobot("t", "team-2", "rifle", { x: 12, y: 5 }, { hp: 400 })],
      }),
    );
    return { ...base, config: { ...base.config, rulesRevision } };
  };
  const longMove: TurnOrders = {
    turnNumber: 1,
    timelines: [
      {
        robotId: "m",
        segments: [
          {
            kind: "move",
            posture: "upright",
            path: [
              { via: { x: 2, y: 5 }, to: { x: 3, y: 5 } },
              { via: { x: 4, y: 5 }, to: { x: 5, y: 5 } },
              { to: { x: 6, y: 5 } },
            ],
          },
        ],
      },
    ],
  };
  const turnEnd = (events: readonly ResolutionEvent[]) => ofKind(events, "turn-end")[0]!.tick;

  it("lands a missile in flight after turn length and ends the movie on that step", () => {
    const orders: TurnOrders = {
      turnNumber: 1,
      timelines: [
        {
          robotId: "m",
          segments: [
            { kind: "move", posture: "upright", path: [{ to: { x: 2, y: 5 } }] },
            aim({ x: 12, y: 5 }, "missile-launcher"),
          ],
        },
      ],
    };
    const events = resolved(shortTurn(), orders).events;
    // Fired at 30 from (2,5), d = 10: 30 + 5·5 + 10 = 65.
    expect(ofKind(events, "fired").map((event) => event.tick)).toEqual([30]);
    expect(ofKind(events, "damaged").map((event) => event.tick)).toEqual([65]);
    expect(turnEnd(events)).toBe(65);
    expect(events.at(-1)!.kind).toBe("turn-end");
  });

  it("finishes the move step that crosses turn length and drops the rest", () => {
    const result = resolved(shortTurn(), longMove);
    const events = result.events;
    // The second step starts at 40 < 60 and ends at 80; the third would start at 80.
    expect(ofKind(events, "move-step").map((event) => [event.tick, event.to.x])).toEqual([
      [15, 2],
      [25, 3],
      [55, 4],
      [65, 5],
    ]);
    expect(result.nextState.teams[0]!.robots[0]!.position).toEqual({ x: 5, y: 5 });
    expect(turnEnd(events)).toBe(80);
    const ticks = events.map((event) => event.tick);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
  });

  it("starts nothing and fires nothing at or after turn length", () => {
    const orders: TurnOrders = {
      turnNumber: 1,
      timelines: [
        {
          robotId: "m",
          segments: [
            {
              kind: "move",
              posture: "upright",
              path: [{ to: { x: 2, y: 5 } }, { to: { x: 3, y: 5 } }],
            },
            aim({ x: 12, y: 5 }, "missile-launcher"),
          ],
        },
      ],
    };
    const events = resolved(shortTurn(), orders).events;
    expect(ofKind(events, "fired")).toEqual([]);
    expect(turnEnd(events)).toBe(60);
  });

  it("keeps revision 3 stopping at turn length", () => {
    const result = resolved(shortTurn(3), longMove);
    expect(result.nextState.teams[0]!.robots[0]!.position).toEqual({ x: 3, y: 5 });
    expect(turnEnd(result.events)).toBe(60);
  });

  it("verifies in a replay", () => {
    const replay = createReplayLog({
      initialState: shortTurn(),
      turns: [{ seed: "d", orders: longMove }],
    });
    expect(verifyReplay(replay)).toEqual({ ok: true });
  });
});

describe("Scan & Fire seven-shot pause and shared cooldown (seg6:0x3D79, seg6:0x3E33)", () => {
  const gunner = (robotClass: "auto" | "rifle" | "missile") =>
    revision4(
      makeMatch({
        arena: makeOpenArena(12, 12),
        turnLengthSeconds: 8,
        teamOneRobots: [makeRobot("g", "team-1", robotClass, { x: 2, y: 5 })],
        // Enough armor in range to soak a dozen hits.
        teamTwoRobots: [
          { x: 6, y: 5 },
          { x: 6, y: 4 },
          { x: 6, y: 6 },
          { x: 7, y: 5 },
          { x: 8, y: 5 },
        ].map((at, index) => makeRobot(`t${index}`, "team-2", "rifle", at)),
      }),
    );
  const scan = (weapon: WeaponId, seconds: number) =>
    ({ kind: "scan-and-fire", weapon, maxDistance: 18, seconds }) as const;
  const fireTicks = (events: readonly ResolutionEvent[], weapon?: WeaponId) =>
    ofKind(events, "fired")
      .filter((event) => weapon === undefined || event.weapon === weapon)
      .map((event) => event.tick);
  const gaps = (ticks: readonly number[]) => ticks.slice(1).map((tick, i) => tick - ticks[i]!);

  it("pauses an Auto Rifle 30 + 5·(r&3) extra after the seventh shot", () => {
    const orders: TurnOrders = {
      turnNumber: 1,
      timelines: [{ robotId: "g", segments: [scan("auto-rifle", 4)] }],
    };
    const ticks = fireTicks(resolved(gunner("auto"), orders).events);
    const steps = gaps(ticks);
    expect(steps.slice(0, 6)).toEqual([10, 10, 10, 10, 10, 10]);
    expect([40, 45, 50, 55]).toContain(steps[6]);
  });

  it("pauses a Rifle 50 + 5·(r&7) extra after the seventh shot", () => {
    const orders: TurnOrders = {
      turnNumber: 1,
      timelines: [{ robotId: "g", segments: [scan("rifle", 7)] }],
    };
    const steps = gaps(fireTicks(resolved(gunner("rifle"), orders).events));
    expect(steps.slice(0, 6)).toEqual([30, 30, 30, 30, 30, 30]);
    expect(steps[6]).toBeGreaterThanOrEqual(80);
    expect(steps[6]).toBeLessThanOrEqual(115);
  });

  it("carries the cooldown into the next command (shared +1A)", () => {
    const orders: TurnOrders = {
      turnNumber: 1,
      timelines: [{ robotId: "g", segments: [scan("missile-launcher", 1), scan("rifle", 1)] }],
    };
    const events = resolved(gunner("missile"), orders).events;
    const [missile] = fireTicks(events, "missile-launcher");
    const [rifle] = fireTicks(events, "rifle");
    // The missile's 30 + 40 cooldown outlasts its 60-tick command.
    expect(rifle).toBe(missile! + 70);
    expect(rifle).toBeGreaterThan(60);
  });

  it("keeps revision 3 firing at the Aim interval with no pause", () => {
    const base = gunner("auto");
    const state = { ...base, config: { ...base.config, rulesRevision: 3 as const } };
    const orders: TurnOrders = {
      turnNumber: 1,
      timelines: [{ robotId: "g", segments: [scan("auto-rifle", 2)] }],
    };
    expect(new Set(gaps(fireTicks(resolved(state, orders).events)))).toEqual(new Set([10]));
  });

  it("verifies in a replay", () => {
    const orders: TurnOrders = {
      turnNumber: 1,
      timelines: [{ robotId: "g", segments: [scan("auto-rifle", 3), scan("auto-rifle", 2)] }],
    };
    const replay = createReplayLog({
      initialState: gunner("auto"),
      turns: [{ seed: "e", orders }],
    });
    expect(verifyReplay(replay)).toEqual({ ok: true });
  });
});

describe("spotting refresh and activity flags (seg6:0x4091, seg6:0x4F34, seg96:0x0366)", () => {
  const ofTeam = (events: readonly ResolutionEvent[], teamId: string, enemyId: string) =>
    ofKind(events, "enemy-spotted")
      .filter((event) => event.teamId === teamId && event.enemyId === enemyId)
      .map((event) => event.tick);
  const withRevision = (state: MatchState, rulesRevision: 3 | 4): MatchState => ({
    ...state,
    config: { ...state.config, rulesRevision },
  });

  it("lets idle robots keep rolling on their periodic refresh", () => {
    // b crouches on a Low Wall 4 tiles in front of a: index 2 (16/256) a roll.
    const idle = (rulesRevision: 3 | 4) =>
      withRevision(
        revision4(
          makeMatch({
            arena: withTerrain(makeOpenArena(12, 12), [[6, 5, "low-wall"]]),
            turnLengthSeconds: 40,
            teamOneRobots: [makeRobot("a", "team-1", "rifle", { x: 2, y: 5 })],
            teamTwoRobots: [
              makeRobot("b", "team-2", "rifle", { x: 6, y: 5 }, { posture: "crouching" }),
            ],
          }),
        ),
        rulesRevision,
      );
    const orders: TurnOrders = { turnNumber: 1, timelines: [] };
    // Revision 3 rolls once, at turn start; revision 4 keeps rolling.
    expect(ofTeam(resolved(idle(3), orders, "a").events, "team-1", "b")).toEqual([]);
    const [spottedAt] = ofTeam(resolved(idle(4), orders, "a").events, "team-1", "b");
    expect(spottedAt).toBeGreaterThan(0);
  });

  describe("only a scan shot reveals the shooter outright (seg6:0x20B6)", () => {
    // a can never spot b by roll: index 0 at distance 28 behind a Low Wall.
    // c stands in front of b, facing away from it.
    const sniper = (rulesRevision: 3 | 4) =>
      withRevision(
        revision4(
          makeMatch({
            arena: withTerrain(makeOpenArena(32, 12), [[29, 5, "low-wall"]]),
            teamOneRobots: [
              makeRobot("a", "team-1", "rifle", { x: 1, y: 5 }),
              makeRobot("c", "team-1", "rifle", { x: 27, y: 5 }, { scanHeading: "W" }),
            ],
            teamTwoRobots: [
              makeRobot(
                "b",
                "team-2",
                "rifle",
                { x: 29, y: 5 },
                {
                  posture: "crouching",
                  scanHeading: "W",
                },
              ),
            ],
          }),
        ),
        rulesRevision,
      );
    const aimOrders: TurnOrders = {
      turnNumber: 1,
      timelines: [{ robotId: "b", segments: [aim({ x: 27, y: 5 })] }],
    };

    it("Aim & Fire writes no activity 3, so b stays hidden", () => {
      const events = resolved(sniper(4), aimOrders).events;
      expect(ofKind(events, "fired").map((event) => event.tick)).toEqual([0]);
      expect(ofTeam(events, "team-1", "b")).toEqual([]);
    });

    it("Scan & Fire reveals b on the step it fires", () => {
      const orders: TurnOrders = {
        turnNumber: 1,
        timelines: [
          {
            robotId: "b",
            segments: [{ kind: "scan-and-fire", weapon: "rifle", maxDistance: 18, seconds: 2 }],
          },
        ],
      };
      const events = resolved(sniper(4), orders).events;
      const [firstShot] = ofKind(events, "fired").map((event) => event.tick);
      expect(ofTeam(events, "team-1", "b")[0]).toBe(firstShot);
    });

    it("keeps revision 3 revealing an Aim & Fire shot", () => {
      expect(ofTeam(resolved(sniper(3), aimOrders).events, "team-1", "b")).toEqual([0]);
    });
  });

  it("verifies in a replay", () => {
    const state = revision4(
      makeMatch({
        arena: withTerrain(makeOpenArena(12, 12), [[6, 5, "low-wall"]]),
        turnLengthSeconds: 10,
        teamOneRobots: [
          makeRobot("a", "team-1", "rifle", { x: 2, y: 5 }),
          makeRobot("z", "team-1", "rifle", { x: 2, y: 8 }),
        ],
        teamTwoRobots: [
          makeRobot("b", "team-2", "rifle", { x: 6, y: 5 }, { posture: "crouching" }),
        ],
      }),
    );
    const orders: TurnOrders = {
      turnNumber: 1,
      timelines: [
        {
          robotId: "z",
          segments: [
            { kind: "move", posture: "upright", path: [{ to: { x: 3, y: 8 } }] },
            { kind: "scan-and-fire", weapon: "rifle", maxDistance: 18, seconds: 3 },
          ],
        },
      ],
    };
    const replay = createReplayLog({ initialState: state, turns: [{ seed: "f", orders }] });
    expect(verifyReplay(replay)).toEqual({ ok: true });
  });
});
