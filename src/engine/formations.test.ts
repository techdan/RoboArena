/** Rules revision 3: Zap, Time Bomb, Show Enemy Positions and 5-tick spotting (re-map §3-4, setup §1.3). */

import { describe, expect, it } from "vitest";

import { makeMatch, makeOpenArena, makeRobot } from "./__fixtures__/match.js";
import { FORMATION_SETUPS } from "./formations.js";
import { createReplayLog, verifyReplay } from "./replay.js";
import { resolveTurn, type TurnResult } from "./resolver.js";
import { computeVisibility } from "./visibility.js";
import type { GameConfig, MatchState, ResolutionEvent, RobotState, TurnOrders } from "./types.js";

const revision3 = (state: MatchState, config: Partial<GameConfig> = {}): MatchState => ({
  ...state,
  config: { ...state.config, formation: "standard", rulesRevision: 3, zapArmed: true, ...config },
});

const resolved = (state: MatchState, orders: TurnOrders, seed = "formations"): TurnResult => {
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

const withBomb = (robot: RobotState): RobotState => ({ ...robot, timeBombs: 1 });

describe("formation setups (DGROUP 0x162A, seg61:0x02A7)", () => {
  it("matches the original Beginner and Standard tables", () => {
    expect(FORMATION_SETUPS.beginner).toMatchObject({
      grenades: 0,
      missiles: 3,
      zapArmed: false,
      timeBomb: false,
      showEnemyPositions: true,
    });
    expect(FORMATION_SETUPS.standard).toMatchObject({
      grenades: 3,
      missiles: 3,
      zapArmed: true,
      timeBomb: true,
      showEnemyPositions: false,
    });
    expect(FORMATION_SETUPS.beginner.rosters.battle).toEqual([
      "rifle",
      "rifle",
      "burst",
      "burst",
      "auto",
      "missile",
    ]);
    expect(FORMATION_SETUPS.standard.rosters.battle).toEqual([
      "rifle",
      "rifle",
      "burst",
      "auto",
      "auto",
      "missile",
    ]);
    expect(FORMATION_SETUPS.standard.rosters.campaign).toHaveLength(8);
  });
});

describe("Zap (seg6:0x2BD9, seg6:0x602B)", () => {
  const sharedTile = { x: 3, y: 3 };
  const zapOrders = (seconds: number): TurnOrders => ({
    turnNumber: 1,
    timelines: [{ robotId: "z", segments: [{ kind: "zap", seconds }] }],
  });

  it("hits an enemy on the zapper's tile every 60 ticks, landing 5 ticks later", () => {
    const state = revision3(
      makeMatch({
        teamOneRobots: [makeRobot("z", "team-1", "rifle", sharedTile)],
        teamTwoRobots: [makeRobot("e", "team-2", "rifle", sharedTile)],
      }),
    );
    const result = resolved(state, zapOrders(2));
    expect(ofKind(result.events, "zapped").map((event) => event.tick)).toEqual([0, 60]);
    const hits = ofKind(result.events, "damaged");
    expect(hits.map((event) => [event.tick, event.damageKind, event.targetId])).toEqual([
      [5, "zap", "e"],
      [65, "zap", "e"],
    ]);
    for (const hit of hits) {
      expect(hit.damage).toBeGreaterThanOrEqual(60);
      expect(hit.damage).toBeLessThanOrEqual(123);
    }
  });

  it("ignores enemies on other tiles and allies on its own", () => {
    const state = revision3(
      makeMatch({
        teamOneRobots: [
          makeRobot("z", "team-1", "rifle", sharedTile),
          makeRobot("ally", "team-1", "rifle", sharedTile),
        ],
        teamTwoRobots: [makeRobot("e", "team-2", "rifle", { x: 4, y: 3 })],
      }),
    );
    const result = resolved(state, zapOrders(3));
    expect(ofKind(result.events, "zapped")).toEqual([]);
    expect(ofKind(result.events, "damaged")).toEqual([]);
  });

  it("is refused unless the formation arms it", () => {
    const base = makeMatch({ teamOneRobots: [makeRobot("z", "team-1", "rifle", sharedTile)] });
    expect(
      resolveTurn({
        state: { ...base, config: { ...base.config, rulesRevision: 3 } },
        orders: zapOrders(1),
        seed: "x",
      }),
    ).toMatchObject({ outcome: "malformed-orders", code: "illegal-command" });
    expect(
      resolveTurn({
        state: { ...base, config: { ...base.config, rulesRevision: 2 } },
        orders: zapOrders(1),
        seed: "x",
      }),
    ).toMatchObject({ outcome: "malformed-orders", code: "unsupported-command" });
  });
});

describe("Time Bomb (seg6:0x2B08, seg6:0x542E, seg28:0x0C1A)", () => {
  const bombOrders = (fuseSeconds: number): TurnOrders => ({
    turnNumber: 1,
    timelines: [{ robotId: "b", segments: [{ kind: "place-bomb", fuseSeconds }] }],
  });

  it("goes off fuse × 60 + 60 ticks after placement and hits every Side", () => {
    const state = revision3(
      makeMatch({
        arena: makeOpenArena(12, 12),
        teamOneRobots: [
          withBomb(makeRobot("b", "team-1", "rifle", { x: 5, y: 5 })),
          makeRobot("ally", "team-1", "rifle", { x: 6, y: 5 }),
        ],
        teamTwoRobots: [
          makeRobot("near", "team-2", "rifle", { x: 5, y: 8 }),
          makeRobot("far", "team-2", "rifle", { x: 11, y: 11 }),
        ],
      }),
    );
    const result = resolved(state, bombOrders(2));
    expect(ofKind(result.events, "bomb-placed")).toMatchObject([
      { tick: 0, robotId: "b", at: { x: 5, y: 5 }, detonatesAt: 180 },
    ]);
    expect(ofKind(result.events, "bomb-exploded")).toMatchObject([
      { tick: 180, ownerId: "b", at: { x: 5, y: 5 } },
    ]);
    const hits = ofKind(result.events, "damaged");
    expect(new Set(hits.map((hit) => hit.targetId))).toEqual(new Set(["b", "ally", "near"]));
    const radii = Object.fromEntries(
      hits.flatMap((hit) => (hit.damageKind === "blast" ? [[hit.targetId, hit.radius]] : [])),
    );
    expect(radii).toEqual({ b: 0, ally: 1, near: 3 });
    expect(result.nextState.armedBombs).toEqual([]);
    const bomber = result.nextState.teams[0]!.robots.find((robot) => robot.id === "b")!;
    expect(bomber.timeBombs).toBe(0);
  });

  it("carries a long fuse into the next turn, rebased by the turn length", () => {
    const state = revision3(
      makeMatch({ teamOneRobots: [withBomb(makeRobot("b", "team-1", "rifle", { x: 5, y: 5 }))] }),
    );
    const first = resolved(state, bombOrders(20));
    expect(ofKind(first.events, "bomb-exploded")).toEqual([]);
    expect(first.nextState.armedBombs).toMatchObject([{ at: { x: 5, y: 5 }, detonatesAt: 360 }]);
    const second = resolved(first.nextState, { turnNumber: 2, timelines: [] });
    expect(ofKind(second.events, "bomb-exploded").map((event) => event.tick)).toEqual([360]);
    expect(second.nextState.armedBombs).toEqual([]);
  });

  it("needs a carried bomb", () => {
    const state = revision3(
      makeMatch({ teamOneRobots: [makeRobot("b", "team-1", "rifle", { x: 5, y: 5 })] }),
    );
    expect(resolveTurn({ state, orders: bombOrders(1), seed: "x" })).toMatchObject({
      outcome: "malformed-orders",
      code: "illegal-command",
    });
  });

  it("verifies in a replay", () => {
    const state = revision3(
      makeMatch({ teamOneRobots: [withBomb(makeRobot("b", "team-1", "rifle", { x: 5, y: 5 }))] }),
    );
    const replay = createReplayLog({
      initialState: state,
      turns: [
        { seed: "a", orders: bombOrders(20) },
        { seed: "b", orders: { turnNumber: 2, timelines: [] } },
      ],
    });
    expect(verifyReplay(replay)).toEqual({ ok: true });
  });
});

describe("spotting under revision 3", () => {
  const duel = (config: Partial<GameConfig> = {}) =>
    revision3(
      makeMatch({
        arena: makeOpenArena(12, 12),
        teamOneRobots: [makeRobot("r1", "team-1", "rifle", { x: 1, y: 5 }, { scanHeading: "W" })],
        teamTwoRobots: [makeRobot("r2", "team-2", "rifle", { x: 9, y: 5 }, { scanHeading: "E" })],
      }),
      config,
    );
  const walk: TurnOrders = {
    turnNumber: 1,
    timelines: [
      {
        robotId: "r1",
        segments: [
          { kind: "set-scan-direction", heading: "E" },
          {
            kind: "move",
            posture: "upright",
            path: [{ to: { x: 2, y: 5 } }, { to: { x: 3, y: 5 } }, { to: { x: 4, y: 5 } }],
          },
        ],
      },
    ],
  };

  it("runs the pass only on 5-tick simulation steps (seg6:0x4832)", () => {
    for (const seed of ["s1", "s2", "s3", "s4"]) {
      const result = resolved(duel(), walk, seed);
      for (const event of [
        ...ofKind(result.events, "enemy-spotted"),
        ...ofKind(result.events, "enemy-lost"),
      ]) {
        expect(event.tick % 5).toBe(0);
      }
    }
  });

  it("shows every enemy with Show Enemy Positions (Beginner)", () => {
    const config: GameConfig = {
      ...duel().config,
      formation: "beginner",
      showEnemyPositions: true,
    };
    delete (config as { zapArmed?: true }).zapArmed;
    const state: MatchState = { ...duel(), config };
    expect(computeVisibility(state, "team-1").visibleEnemies).toEqual(new Set(["r2"]));
    const result = resolved(state, { turnNumber: 1, timelines: [] });
    expect(ofKind(result.events, "enemy-spotted")).toMatchObject([
      { tick: 0, teamId: "team-1", enemyId: "r2" },
      { tick: 0, teamId: "team-2", enemyId: "r1" },
    ]);
    expect(computeVisibility(result.nextState, "team-2").visibleEnemies).toEqual(new Set(["r1"]));
  });
});

describe("Self Destruct (seg21:0x076C, seg6:0x3541)", () => {
  const selfDestruct: TurnOrders = {
    turnNumber: 1,
    timelines: [{ robotId: "last", segments: [{ kind: "self-destruct" }] }],
  };
  const lastStanding = (extra: RobotState[] = []) =>
    revision3(
      makeMatch({
        arena: makeOpenArena(12, 12),
        teamOneRobots: [
          makeRobot("last", "team-1", "rifle", { x: 5, y: 5 }),
          { ...makeRobot("gone", "team-1", "rifle", { x: 1, y: 1 }), hp: 0 },
          ...extra,
        ],
        teamTwoRobots: [
          makeRobot("near", "team-2", "rifle", { x: 6, y: 5 }),
          makeRobot("far", "team-2", "rifle", { x: 11, y: 11 }),
        ],
      }),
    );

  it("blasts the robot's own tile 10 ticks after it starts, hitting every Side", () => {
    const result = resolved(lastStanding(), selfDestruct);
    expect(ofKind(result.events, "self-destructed")).toMatchObject([
      { tick: 10, robotId: "last", at: { x: 5, y: 5 } },
    ]);
    const hits = ofKind(result.events, "damaged");
    expect(hits.map((hit) => [hit.tick, hit.targetId])).toEqual([
      [10, "last"],
      [10, "near"],
    ]);
    for (const hit of hits) {
      if (hit.damageKind !== "blast") throw new Error("expected blast damage");
      expect(hit.sourceId).toBe("last");
      expect(hit.damage).toBeGreaterThanOrEqual(hit.radius === 0 ? 120 : 80);
    }
    expect(ofKind(result.events, "destroyed").map((event) => event.robotId)).toContain("last");
  });

  it("is refused while the Team has more than one robot standing", () => {
    const state = lastStanding([makeRobot("buddy", "team-1", "rifle", { x: 2, y: 2 })]);
    expect(resolveTurn({ state, orders: selfDestruct, seed: "x" })).toMatchObject({
      outcome: "malformed-orders",
      code: "illegal-command",
    });
  });

  it("is unknown to rules revisions before 3", () => {
    const base = lastStanding();
    const state = { ...base, config: { ...base.config, rulesRevision: 2 as const } };
    expect(resolveTurn({ state, orders: selfDestruct, seed: "x" })).toMatchObject({
      outcome: "malformed-orders",
      code: "unsupported-command",
    });
  });

  it("still lands when started just before turn end, extending the movie", () => {
    const state = lastStanding();
    const turnTicks = state.config.turnLengthSeconds * 60;
    const orders: TurnOrders = {
      turnNumber: 1,
      timelines: [
        {
          robotId: "last",
          segments: [
            // 840 + 5 × 10 + 5 = 895 ticks, then the blast lands at 905.
            { kind: "zap", seconds: state.config.turnLengthSeconds - 1 },
            { kind: "set-posture", posture: "ducking" },
            { kind: "set-posture", posture: "upright" },
            { kind: "set-posture", posture: "ducking" },
            { kind: "set-posture", posture: "upright" },
            { kind: "set-posture", posture: "ducking" },
            { kind: "set-scan-direction", heading: "NE" },
            { kind: "self-destruct" },
          ],
        },
      ],
    };
    const result = resolved(state, orders);
    const blast = ofKind(result.events, "self-destructed")[0]!;
    expect(blast.tick).toBe(turnTicks + 5);
    expect(ofKind(result.events, "turn-end")[0]!.tick).toBe(blast.tick);
    const ticks = result.events.map((event) => event.tick);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
  });

  it("verifies in a replay", () => {
    const replay = createReplayLog({
      initialState: lastStanding(),
      turns: [{ seed: "a", orders: selfDestruct }],
    });
    expect(verifyReplay(replay)).toEqual({ ok: true });
  });
});
