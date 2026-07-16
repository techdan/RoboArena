/** Phase 5 replay format and deterministic verification tests. */

import { describe, expect, it } from "vitest";
import goldenReplayV1 from "./__golden__/phase5-replay-v1.json";
import { makeMatch, makeRobot } from "./__fixtures__/match.js";
import { createReplayLog, deserializeReplay, serializeReplay, verifyReplay } from "./replay.js";
import type { MatchState, ReplayLog, TurnOrders } from "./types.js";

const firingReplay = () => {
  const state = makeMatch({
    teamOneRobots: [makeRobot("r1", "team-1", "rifle", { x: 1, y: 1 })],
    teamTwoRobots: [makeRobot("r2", "team-2", "rifle", { x: 4, y: 1 })],
  });
  const orders: TurnOrders = {
    turnNumber: 1,
    timelines: [
      {
        robotId: "r1",
        segments: [
          {
            kind: "aim-and-fire",
            target: { x: 4, y: 1 },
            weapon: "rifle",
            repeat: false,
          },
        ],
      },
    ],
  };
  return createReplayLog({
    initialState: state,
    turns: [{ seed: "phase5-golden", orders }],
  });
};

describe("Phase 5 replay format", () => {
  it("round-trips through JSON byte-identically and restores marker Maps", () => {
    const base = firingReplay();
    const initialState: MatchState = {
      ...base.initialState,
      lastKnownMarkers: new Map([["team-1", [{ enemyId: "r2", at: { x: 4, y: 1 } }]]]),
    };
    const replay = createReplayLog({
      initialState,
      turns: base.turns.map((turn) => ({ seed: turn.seed, orders: turn.orders })),
    });

    const serialized = serializeReplay(replay);
    const restored = deserializeReplay(serialized);

    expect(serializeReplay(restored)).toBe(serialized);
    expect(restored).toEqual(replay);
    expect(restored.initialState.lastKnownMarkers).toBeInstanceOf(Map);
  });

  it("re-runs recorded events and complete next state without divergence", () => {
    expect(verifyReplay(firingReplay())).toEqual({ ok: true });
  });

  it("keeps the checked-in version 1 golden replay byte-stable", () => {
    const goldenJson = JSON.stringify(goldenReplayV1);
    const replay = deserializeReplay(goldenJson);

    expect(serializeReplay(replay)).toBe(goldenJson);
    expect(verifyReplay(replay)).toEqual({ ok: true });
  });

  it("reports the first divergent replay tick after seed corruption", () => {
    const replay = firingReplay();
    const [turn] = replay.turns;
    if (turn === undefined) throw new Error("Expected replay turn.");
    const corrupted: ReplayLog = {
      ...replay,
      turns: [{ ...turn, seed: "phase5-corrupted" }],
    };
    expect(verifyReplay(corrupted)).toEqual({ ok: false, firstDivergenceTick: 30 });
  });

  it("detects recorded event and state-digest corruption", () => {
    const replay = firingReplay();
    const [turn] = replay.turns;
    if (turn === undefined) throw new Error("Expected replay turn.");

    expect(
      verifyReplay({
        ...replay,
        turns: [{ ...turn, events: turn.events.slice(1) }],
      }),
    ).toMatchObject({ ok: false });
    expect(
      verifyReplay({
        ...replay,
        turns: [{ ...turn, nextStateDigest: "00000000" }],
      }),
    ).toMatchObject({ ok: false });
  });

  it("chains state across turns and reports an absolute replay tick", () => {
    const first = firingReplay();
    const firstOrders = first.turns[0]?.orders;
    if (firstOrders === undefined) throw new Error("Expected first replay turn.");
    const secondOrders: TurnOrders = {
      ...firstOrders,
      turnNumber: 2,
    };
    const replay = createReplayLog({
      initialState: first.initialState,
      turns: [
        { seed: "phase5-first-turn", orders: firstOrders },
        { seed: "phase5-second-turn", orders: secondOrders },
      ],
    });
    const recordedFirstTurn = replay.turns[0];
    const secondTurn = replay.turns[1];
    if (recordedFirstTurn === undefined || secondTurn === undefined) {
      throw new Error("Expected two replay turns.");
    }

    expect(verifyReplay(replay)).toEqual({ ok: true });
    expect(
      verifyReplay({
        ...replay,
        turns: [recordedFirstTurn, { ...secondTurn, events: secondTurn.events.slice(1) }],
      }),
    ).toEqual({ ok: false, firstDivergenceTick: 900 });
    expect(
      verifyReplay({
        ...replay,
        turns: [recordedFirstTurn, { ...secondTurn, seed: "phase5-corrupted-second-turn" }],
      }),
    ).toEqual({ ok: false, firstDivergenceTick: 930 });
  });

  it("rejects invalid JSON, malformed payloads, and unknown versions", () => {
    expect(() => deserializeReplay("not-json")).toThrow("not valid JSON");
    expect(() => deserializeReplay('{"formatVersion":1}')).toThrow("initialState");
    expect(() =>
      deserializeReplay(
        serializeReplay(firingReplay()).replace('"formatVersion":1', '"formatVersion":2'),
      ),
    ).toThrow("Unsupported replay format version: 2");
  });

  it("rejects malformed nested state, orders, markers, and events", () => {
    interface MutableReplayProbe {
      initialState: {
        arena: { tiles: unknown[][] };
        lastKnownMarkers: unknown;
      };
      turns: {
        seed: unknown;
        orders: { timelines: { segments: unknown[] }[] };
        events: unknown[];
      }[];
    }
    const mutate = (change: (payload: MutableReplayProbe) => void): string => {
      const payload = JSON.parse(serializeReplay(firingReplay())) as MutableReplayProbe;
      change(payload);
      return JSON.stringify(payload);
    };

    expect(() =>
      deserializeReplay(mutate((payload) => (payload.initialState.arena.tiles[0]![0] = null))),
    ).toThrow("tiles[0][0]");
    expect(() =>
      deserializeReplay(
        mutate((payload) => (payload.turns[0]!.orders.timelines[0]!.segments[0] = null)),
      ),
    ).toThrow("segments[0]");
    expect(() =>
      deserializeReplay(
        mutate((payload) => (payload.initialState.lastKnownMarkers = [["team-1", [null]]])),
      ),
    ).toThrow("lastKnownMarkers");
    expect(() =>
      deserializeReplay(mutate((payload) => (payload.turns[0]!.events[0] = null))),
    ).toThrow("events[0]");
    expect(() => deserializeReplay(mutate((payload) => (payload.turns[0]!.seed = 42)))).toThrow(
      "turn.seed",
    );
  });

  it("returns a divergence instead of throwing for an invalid typed input", () => {
    const replay = firingReplay();
    const malformed = {
      ...replay,
      turns: [{ ...replay.turns[0], events: [null] }],
    } as unknown as ReplayLog;

    expect(() => verifyReplay(malformed)).not.toThrow();
    expect(verifyReplay(malformed)).toEqual({ ok: false, firstDivergenceTick: 0 });
  });

  it("rejects malformed orders when creating a canonical replay", () => {
    const state = makeMatch();
    expect(() =>
      createReplayLog({
        initialState: state,
        turns: [{ seed: "bad-orders", orders: { turnNumber: 2, timelines: [] } }],
      }),
    ).toThrow("turn-number");
  });
});
