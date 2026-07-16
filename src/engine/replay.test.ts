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
  return createReplayLog({ initialState: state, seed: "phase5-golden", turnOrders: [orders] });
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
      seed: base.seed,
      turnOrders: base.turns.map((turn) => turn.orders),
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
    const corrupted: ReplayLog = { ...replay, seed: "phase5-corrupted" };
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
    const replay = createReplayLog({
      initialState: first.initialState,
      seed: first.seed,
      turnOrders: [firstOrders, { turnNumber: 2, timelines: [] }],
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
  });

  it("rejects invalid JSON, malformed payloads, and unknown versions", () => {
    expect(() => deserializeReplay("not-json")).toThrow("not valid JSON");
    expect(() => deserializeReplay('{"formatVersion":1}')).toThrow("seed");
    expect(() =>
      deserializeReplay(
        serializeReplay(firingReplay()).replace('"formatVersion":1', '"formatVersion":2'),
      ),
    ).toThrow("Unsupported replay format version: 2");
  });

  it("rejects malformed orders when creating a canonical replay", () => {
    const state = makeMatch();
    expect(() =>
      createReplayLog({
        initialState: state,
        seed: "bad-orders",
        turnOrders: [{ turnNumber: 2, timelines: [] }],
      }),
    ).toThrow("turn-number");
  });
});
