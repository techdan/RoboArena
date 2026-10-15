/** Rules revision 2: the original spotting roll and stepped turns (re-map §1, commands §9). */

import { describe, expect, it } from "vitest";

import { makeMatch, makeOpenArena, makeRobot } from "./__fixtures__/match.js";
import { scanRotationCostTicks, postureChangeCostTicks } from "./commandInterpreter.js";
import { headingTurnSteps, postureChangeSteps } from "./orientation.js";
import { createReplayLog, deserializeReplay, serializeReplay, verifyReplay } from "./replay.js";
import { resolveTurn, type TurnResult } from "./resolver.js";
import { spottingIndex, spottingThreshold, updateSpotting, type SpottingTeam } from "./spotting.js";
import { computeVisibility } from "./visibility.js";
import type { MatchState, ResolutionEvent, RobotState, TileCoord, TurnOrders } from "./types.js";

const original = (state: MatchState): MatchState => ({
  ...state,
  config: { ...state.config, rulesRevision: 2 },
});

const resolved = (state: MatchState, orders: TurnOrders, seed = "spotting"): TurnResult => {
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

const onArena = (robot: RobotState): RobotState & { readonly position: TileCoord } => {
  if (robot.position === "dock") throw new Error("robot must be on the arena");
  return { ...robot, position: robot.position };
};

describe("stepped heading and posture changes (seg80:0x0422, seg80:0x0352)", () => {
  it("turns one octant at a time the shortest way, half turns clockwise", () => {
    expect(headingTurnSteps("N", "S")).toEqual(["NE", "E", "SE", "S"]);
    expect(headingTurnSteps("S", "N")).toEqual(["SW", "W", "NW", "N"]);
    expect(headingTurnSteps("N", "NW")).toEqual(["NW"]);
    expect(headingTurnSteps("E", "N")).toEqual(["NE", "N"]);
    expect(headingTurnSteps("W", "W")).toEqual([]);
  });

  it("routes Upright to Crouching through Ducking", () => {
    expect(postureChangeSteps("upright", "crouching")).toEqual(["ducking", "crouching"]);
    expect(postureChangeSteps("crouching", "upright")).toEqual(["ducking", "upright"]);
    expect(postureChangeSteps("ducking", "upright")).toEqual(["upright"]);
  });

  it("charges 5 ticks per octant and 10 per posture level only when stepped", () => {
    expect(scanRotationCostTicks("N", "S", true)).toBe(20);
    expect(scanRotationCostTicks("N", "S")).toBe(5);
    expect(postureChangeCostTicks("upright", "crouching", true)).toBe(20);
    expect(postureChangeCostTicks("upright", "crouching")).toBe(10);
  });

  it("applies each intermediate heading and posture in the resolver", () => {
    const state = original(
      makeMatch({
        teamOneRobots: [makeRobot("r1", "team-1", "rifle", { x: 1, y: 1 }, { scanHeading: "N" })],
      }),
    );
    const result = resolved(state, {
      turnNumber: 1,
      timelines: [
        {
          robotId: "r1",
          segments: [
            { kind: "set-scan-direction", heading: "S" },
            { kind: "set-posture", posture: "crouching" },
          ],
        },
      ],
    });
    expect(
      ofKind(result.events, "scan-rotated").map((event) => [event.tick, event.heading]),
    ).toEqual([
      [5, "NE"],
      [10, "E"],
      [15, "SE"],
      [20, "S"],
    ]);
    expect(
      ofKind(result.events, "posture-changed").map((event) => [event.tick, event.posture]),
    ).toEqual([
      [30, "ducking"],
      [40, "crouching"],
    ]);
  });

  it("keeps the single-record costs for matches without the rules revision", () => {
    const state = makeMatch({
      teamOneRobots: [makeRobot("r1", "team-1", "rifle", { x: 1, y: 1 }, { scanHeading: "N" })],
    });
    const result = resolved(state, {
      turnNumber: 1,
      timelines: [{ robotId: "r1", segments: [{ kind: "set-scan-direction", heading: "S" }] }],
    });
    expect(ofKind(result.events, "scan-rotated").map((event) => event.tick)).toEqual([5]);
  });
});

describe("spotting index (seg96:0x09AF)", () => {
  it("starts from the cover class and adjusts for sight, motion and distance", () => {
    // Exposed (10), clear sight (16 → −0), moved (+4), distance 3 (−(0−2) = +2) → clamp 13.
    expect(
      spottingIndex({
        coverClass: 4,
        sight: 16,
        distance: 3,
        moved: true,
        activity: 0,
        stealth: false,
      }),
    ).toBe(13);
    // Behind a low wall crouched (1 → 2), sight 10 (−2), still (+0), distance 12 (−1) → 0... clamp.
    expect(
      spottingIndex({
        coverClass: 1,
        sight: 10,
        distance: 12,
        moved: false,
        activity: 0,
        stealth: false,
      }),
    ).toBe(0);
    // Acting but not moving adds 2: exposed 10, distance 8 → 10 + 2 − 0 = 12.
    expect(
      spottingIndex({
        coverClass: 4,
        sight: 16,
        distance: 8,
        moved: false,
        activity: 1,
        stealth: false,
      }),
    ).toBe(12);
    expect(spottingThreshold(13)).toBe(255);
    expect(spottingThreshold(9)).toBe(96);
  });

  it("hides a still Stealth robot beyond distance 1 and penalizes it by 4 otherwise", () => {
    const base = { coverClass: 4, sight: 16, activity: 0, stealth: true } as const;
    expect(spottingIndex({ ...base, distance: 2, moved: false })).toBeNull();
    expect(spottingIndex({ ...base, distance: 1, moved: false })).toBe(8);
    expect(spottingIndex({ ...base, distance: 6, moved: true })).toBe(9);
  });
});

describe("spotting pass (seg96:0x0484 / 0x060D / 0x0AAC)", () => {
  const arena = makeOpenArena(12, 12);
  const team = (
    id: string,
    side: number,
    robots: SpottingTeam["robots"],
    dirty = true,
  ): SpottingTeam => ({
    id,
    side,
    robotIds: robots.map((entry) => entry.robot.id),
    robots,
    dirty,
  });
  const watcher = onArena(makeRobot("a", "A", "rifle", { x: 2, y: 5 }, { scanHeading: "E" }));
  const walker = onArena(makeRobot("b", "B", "rifle", { x: 8, y: 5 }, { scanHeading: "E" }));

  it("spots on a successful roll and not on a failed one", () => {
    const teams = [
      team("A", 1, [{ robot: watcher, moved: false, activity: 1 }]),
      team("B", 2, [{ robot: walker, moved: true, activity: 1 }]),
    ];
    const spotted = new Map<string, Set<string>>();
    expect(updateSpotting({ arena, teams, spotted, rollByte: () => 0 }).get("A")).toEqual(
      new Set(["b"]),
    );
    expect(updateSpotting({ arena, teams, spotted, rollByte: () => 255 }).get("A")).toEqual(
      new Set(),
    );
  });

  it("reveals a robot that fired this tick without a roll", () => {
    const rolls: number[] = [];
    const next = updateSpotting({
      arena,
      teams: [
        team("A", 1, [{ robot: watcher, moved: false, activity: 0 }]),
        team("B", 2, [{ robot: walker, moved: false, activity: 3 }]),
      ],
      spotted: new Map(),
      rollByte: () => {
        rolls.push(255);
        return 255;
      },
    });
    expect(next.get("A")).toEqual(new Set(["b"]));
    // The walker faces east, away from A: no roll at all.
    expect(rolls).toEqual([]);
  });

  it("keeps a seen robot while it stays in a cone and drops it once it leaves every cone", () => {
    const still = [
      team("A", 1, [{ robot: watcher, moved: false, activity: 0 }]),
      team("B", 2, [{ robot: walker, moved: false, activity: 0 }], true),
    ];
    const seen = new Map([["A", new Set(["b"])]]);
    expect(
      updateSpotting({ arena, teams: still, spotted: seen, rollByte: () => 255 }).get("A"),
    ).toEqual(new Set(["b"]));
    const behind = onArena({ ...walker, position: { x: 0, y: 5 } });
    const left = [
      team("A", 1, [{ robot: watcher, moved: false, activity: 0 }]),
      team("B", 2, [{ robot: behind, moved: true, activity: 1 }]),
    ];
    expect(
      updateSpotting({ arena, teams: left, spotted: seen, rollByte: () => 0 }).get("A"),
    ).toEqual(new Set());
  });

  it("skips a pair of Teams where nothing happened", () => {
    const behind = onArena({ ...walker, position: { x: 0, y: 5 } });
    const next = updateSpotting({
      arena,
      teams: [
        team("A", 1, [{ robot: watcher, moved: false, activity: 0 }], false),
        team("B", 2, [{ robot: behind, moved: false, activity: 0 }], false),
      ],
      spotted: new Map([["A", new Set(["b"])]]),
      rollByte: () => 0,
    });
    expect(next.get("A")).toEqual(new Set(["b"]));
  });
});

describe("resolver with rules revision 2", () => {
  const duel = () =>
    original(
      makeMatch({
        teamOneRobots: [makeRobot("r1", "team-1", "rifle", { x: 1, y: 4 }, { scanHeading: "E" })],
        teamTwoRobots: [makeRobot("r2", "team-2", "rifle", { x: 6, y: 4 }, { scanHeading: "E" })],
      }),
    );
  const orders: TurnOrders = {
    turnNumber: 1,
    timelines: [
      {
        robotId: "r2",
        segments: [{ kind: "move", posture: "upright", path: [{ to: { x: 6, y: 5 } }] }],
      },
    ],
  };

  it("spots a moving exposed enemy in the cone and carries the mask to the next turn", () => {
    const result = resolved(duel(), orders);
    expect(ofKind(result.events, "enemy-spotted")).toMatchObject([
      { teamId: "team-1", enemyId: "r2" },
    ]);
    expect(result.nextState.spottedEnemies).toEqual([
      { teamId: "team-1", enemyIds: ["r2"] },
      { teamId: "team-2", enemyIds: [] },
    ]);
    expect(computeVisibility(result.nextState, "team-1").visibleEnemies).toEqual(new Set(["r2"]));
    expect(computeVisibility(result.nextState, "team-2").visibleEnemies).toEqual(new Set());
  });

  it("verifies and round-trips a revision 2 replay", () => {
    const replay = createReplayLog({ initialState: duel(), turns: [{ seed: "rt", orders }] });
    expect(verifyReplay(deserializeReplay(serializeReplay(replay)))).toEqual({ ok: true });
  });

  it("is deterministic for the same seed", () => {
    const first = resolved(duel(), orders, "same");
    const second = resolved(duel(), orders, "same");
    expect(second.events).toEqual(first.events);
    expect(second.nextState).toEqual(first.nextState);
  });
});
