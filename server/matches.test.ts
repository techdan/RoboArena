/** Phase 11 authoritative turn lifecycle and participant projection tests. */

import { describe, expect, it } from "vitest";
import { makeFfaMatch, makeMatch, makeRobot } from "../src/engine/__fixtures__/match";
import { verifyReplay } from "../src/engine/replay";
import type { ResolutionEvent } from "../src/engine/types";
import {
  acknowledgeTurn,
  activePlayerIds,
  canonicalReplay,
  ceremonyScores,
  createAuthoritativeMatch,
  emptyOrders,
  lockParticipantOrders,
  participantStatus,
  resignParticipant,
  resolvePendingTurn,
  submitParticipantOrders,
  type CanonicalTurnRecord,
} from "./matches";
import { participantMatchSnapshot, projectMatchState, projectTurnResult } from "./view";

describe("authoritative match lifecycle", () => {
  it("keeps drafts private, resolves one persisted seed once, and acknowledges independently", () => {
    const state = makeMatch({
      teamOneRobots: [makeRobot("r1", "team-1", "rifle", { x: 1, y: 1 }, { scanHeading: "N" })],
    });
    const match = createAuthoritativeMatch(state, ["team-1", "team-2"]);
    const teamOne = emptyOrders(1);
    const teamTwo = {
      turnNumber: 1,
      timelines: [
        {
          robotId: "r2",
          segments: [{ kind: "set-posture", posture: "ducking" } as const],
        },
      ],
    };
    submitParticipantOrders(match, "team-2", teamTwo);
    const submittedRevision = match.revision;
    submitParticipantOrders(match, "team-2", teamTwo);
    expect(match.revision).toBe(submittedRevision);
    const privateView = participantMatchSnapshot({
      requestId: "private",
      roomCode: "ABC234",
      matchId: "match-1",
      playerId: "team-1",
      match,
    });
    expect(privateView.ownOrders).toEqual(teamOne);
    expect(JSON.stringify(privateView)).not.toContain("set-posture");

    lockParticipantOrders(match, "team-1", teamOne, "seed-1", "nonce-1");
    expect(match.phase).toBe("planning");
    lockParticipantOrders(match, "team-2", teamTwo, "seed-1", "nonce-1");
    expect(match).toMatchObject({ phase: "resolving", pendingResolution: { seed: "seed-1" } });
    expect(resolvePendingTurn(match)).toBe(true);
    expect(resolvePendingTurn(match)).toBe(false);
    expect(match.turns).toHaveLength(1);
    expect(match.state.turnNumber).toBe(2);
    expect(participantStatus(match, "team-1")).toBe("turn-ready");
    expect(participantStatus(match, "team-2")).toBe("turn-ready");
    expect(verifyReplay(canonicalReplay(match))).toEqual({ ok: true });
    const resultView = participantMatchSnapshot({
      requestId: "resolved",
      roomCode: "ABC234",
      matchId: "match-1",
      playerId: "team-1",
      match,
    });
    expect(JSON.stringify(resultView)).not.toContain("seed-1");
    expect(JSON.stringify(resultView)).not.toContain("nonce-1");

    acknowledgeTurn(match, "team-1", 1);
    const acknowledgedRevision = match.revision;
    acknowledgeTurn(match, "team-1", 1);
    expect(match.revision).toBe(acknowledgedRevision);
    expect(participantStatus(match, "team-1")).toBe("planning");
    expect(participantStatus(match, "team-2")).toBe("turn-ready");
  });

  it("projects visibility boundaries without leaking movement and preserves observed damage", () => {
    const state = makeMatch({
      teamOneRobots: [makeRobot("r1", "team-1", "rifle", { x: 1, y: 1 }, { scanHeading: "N" })],
      teamTwoRobots: [makeRobot("r2", "team-2", "rifle", "dock")],
    });
    const events: readonly ResolutionEvent[] = [
      { tick: 10, seq: 0, kind: "move-step", robotId: "r2", to: { x: 1, y: 0 } },
      {
        tick: 10,
        seq: 1,
        kind: "enemy-spotted",
        teamId: "team-1",
        enemyId: "r2",
        at: { x: 1, y: 0 },
      },
      { tick: 20, seq: 2, kind: "move-step", robotId: "r2", to: { x: 2, y: 1 } },
      {
        tick: 20,
        seq: 3,
        kind: "enemy-lost",
        teamId: "team-1",
        enemyId: "r2",
        lastSeenAt: { x: 1, y: 0 },
      },
      {
        tick: 30,
        seq: 4,
        kind: "damaged",
        damageKind: "direct",
        sourceId: "r2",
        shotIndex: 0,
        targetId: "r1",
        damage: 17,
        score: 12,
      },
    ];
    const turn: CanonicalTurnRecord = {
      turnNumber: 1,
      seed: "projection-seed",
      resolutionNonce: "projection-nonce",
      orders: emptyOrders(1),
      participantOrders: {},
      initialState: state,
      events,
      eventDigest: "unused",
      nextStateDigest: "unused",
    };

    const projected = projectTurnResult(turn, "team-1");
    expect(projected.events.map((event) => event.kind)).toEqual([
      "enemy-spotted",
      "enemy-lost",
      "damaged",
    ]);
    expect(projected.events[0]).toMatchObject({
      kind: "enemy-spotted",
      contact: { id: "r2", position: { x: 1, y: 0 }, robotClass: "rifle" },
    });
    expect(projected.events[2]).toEqual({
      tick: 30,
      seq: 4,
      kind: "damaged",
      damageKind: "direct",
      targetId: "r1",
      damage: 17,
    });
    expect(JSON.stringify(projected.events)).not.toContain('"x":2');
  });

  it("never reveals an unseen scanner to its target", () => {
    const state = makeMatch({
      teamOneRobots: [makeRobot("r1", "team-1", "rifle", { x: 1, y: 1 }, { scanHeading: "N" })],
      teamTwoRobots: [makeRobot("r2", "team-2", "rifle", "dock")],
    });
    const events: readonly ResolutionEvent[] = [
      {
        tick: 10,
        seq: 0,
        kind: "scan-target-acquired",
        shooterId: "r2",
        targetId: "r1",
        distance: 6,
      },
      {
        tick: 20,
        seq: 1,
        kind: "enemy-spotted",
        teamId: "team-1",
        enemyId: "r2",
        at: { x: 1, y: 0 },
      },
      {
        tick: 30,
        seq: 2,
        kind: "scan-target-acquired",
        shooterId: "r2",
        targetId: "r1",
        distance: 5,
      },
    ];
    const turn: CanonicalTurnRecord = {
      turnNumber: 1,
      seed: "scan-privacy-seed",
      resolutionNonce: "scan-privacy-nonce",
      orders: emptyOrders(1),
      participantOrders: {},
      initialState: state,
      events,
      eventDigest: "unused",
      nextStateDigest: "unused",
    };

    const projected = projectTurnResult(turn, "team-1");
    // The pre-spotting acquisition would leak the hidden scanner's id and exact
    // range; only the acquisition made while r2 is visible may be delivered.
    expect(projected.events.map((event) => event.kind)).toEqual([
      "enemy-spotted",
      "scan-target-acquired",
    ]);
    expect(projected.events[1]).toMatchObject({ tick: 30, shooterId: "r2" });
  });

  it("rejects a divergent stored replay before appending another turn", () => {
    const state = makeMatch();
    const match = createAuthoritativeMatch(state, ["team-1", "team-2"]);
    lockParticipantOrders(match, "team-1", emptyOrders(1), "seed-1", "nonce-1");
    lockParticipantOrders(match, "team-2", emptyOrders(1), "seed-1", "nonce-1");
    resolvePendingTurn(match);
    const first = match.turns[0]!;
    match.turns[0] = { ...first, events: [] };
    acknowledgeTurn(match, "team-1", 1);
    acknowledgeTurn(match, "team-2", 1);
    lockParticipantOrders(match, "team-1", emptyOrders(2), "seed-2", "nonce-2");
    lockParticipantOrders(match, "team-2", emptyOrders(2), "seed-2", "nonce-2");

    expect(() => resolvePendingTurn(match)).toThrow(/Canonical replay verification failed/);
    expect(match.turns).toHaveLength(1);
    expect(match.phase).toBe("resolving");
  });

  it("removes unseen enemies and their unobservable event details", () => {
    const state = makeMatch({
      teamOneRobots: [makeRobot("r1", "team-1", "rifle", { x: 1, y: 1 }, { scanHeading: "N" })],
    });
    const projected = projectMatchState(state, "team-1");
    expect(projected.teams.find((team) => team.id === "team-2")?.robots).toEqual([]);

    const match = createAuthoritativeMatch(state, ["team-1", "team-2"]);
    const hiddenOrders = {
      turnNumber: 1,
      timelines: [
        {
          robotId: "r2",
          segments: [{ kind: "set-posture", posture: "ducking" } as const],
        },
      ],
    };
    lockParticipantOrders(match, "team-1", emptyOrders(1), "seed", "nonce");
    lockParticipantOrders(match, "team-2", hiddenOrders, "seed", "nonce");
    resolvePendingTurn(match);
    const snapshot = participantMatchSnapshot({
      requestId: "result",
      roomCode: "ABC234",
      matchId: "match-1",
      playerId: "team-1",
      match,
    });
    expect(JSON.stringify(snapshot)).not.toContain("set-posture");
    expect(
      snapshot.unseenTurns[0]?.events.some((event) => JSON.stringify(event).includes("r2")),
    ).toBe(false);
  });

  it("publishes exact Final Ceremony scores only after the final movie is acknowledged", () => {
    const state = makeMatch({
      teamTwoRobots: [makeRobot("r2", "team-2", "rifle", { x: 6, y: 6 }, { hp: 0 })],
    });
    const match = createAuthoritativeMatch(state, ["team-1", "team-2"]);
    lockParticipantOrders(match, "team-1", emptyOrders(1), "final-seed", "final-nonce");
    lockParticipantOrders(match, "team-2", emptyOrders(1), "final-seed", "final-nonce");
    resolvePendingTurn(match);
    expect(participantStatus(match, "team-1")).toBe("turn-ready");
    acknowledgeTurn(match, "team-1", 1);
    const result = participantMatchSnapshot({
      requestId: "ceremony",
      roomCode: "ABC234",
      matchId: "match-1",
      playerId: "team-1",
      match,
    });
    expect(result).toMatchObject({
      status: "finished",
      outcome: "won",
      winningSide: 1,
      ceremonyScores: [
        { teamId: "team-1", score: 550 },
        { teamId: "team-2", score: 0 },
      ],
    });
  });
});

describe("multi-player free-for-all lifecycle", () => {
  const FIELD_POSITIONS = [
    { x: 1, y: 1 },
    { x: 6, y: 1 },
    { x: 6, y: 6 },
    { x: 1, y: 6 },
  ] as const;

  const ffaIds = (count: number): string[] =>
    Array.from({ length: count }, (_, index) => `team-${index + 1}`);

  for (const count of [3, 4] as const) {
    it(`resolves a private, staggered ${count}-player turn once with a byte-identical replay`, () => {
      const players = ffaIds(count);
      const state = makeFfaMatch(
        players.map((id, index) => ({
          id,
          robots: [makeRobot(`${id}-r1`, id, "rifle", FIELD_POSITIONS[index]!)],
        })),
      );
      const match = createAuthoritativeMatch(state, players);

      // One player's private draft never leaks into another player's snapshot.
      const secretDraft = {
        turnNumber: 1,
        timelines: [
          {
            robotId: `${players[0]!}-r1`,
            segments: [{ kind: "set-posture", posture: "ducking" } as const],
          },
        ],
      };
      submitParticipantOrders(match, players[0]!, secretDraft);
      const opponentView = participantMatchSnapshot({
        requestId: "peek",
        roomCode: "ABC234",
        matchId: "match-1",
        playerId: players[1]!,
        match,
      });
      expect(JSON.stringify(opponentView)).not.toContain("set-posture");
      expect(opponentView.ownOrders).toEqual(emptyOrders(1));

      // Staggered locks: resolution fires only once the final player commits.
      players.forEach((id, index) => {
        lockParticipantOrders(
          match,
          id,
          id === players[0]! ? secretDraft : emptyOrders(1),
          "ffa",
          "n",
        );
        expect(match.phase).toBe(index === players.length - 1 ? "resolving" : "planning");
      });
      expect(resolvePendingTurn(match)).toBe(true);
      expect(resolvePendingTurn(match)).toBe(false);
      expect(match.turns).toHaveLength(1);
      expect(match.state.turnNumber).toBe(2);

      // Independent acknowledgement: one player advancing does not move the rest.
      expect(players.every((id) => participantStatus(match, id) === "turn-ready")).toBe(true);
      acknowledgeTurn(match, players[0]!, 1);
      expect(participantStatus(match, players[0]!)).toBe("planning");
      expect(players.slice(1).every((id) => participantStatus(match, id) === "turn-ready")).toBe(
        true,
      );

      // Deterministic byte-identical replay for the whole configuration.
      expect(verifyReplay(canonicalReplay(match))).toEqual({ ok: true });
    });
  }

  it("aggregates a four-player last-Side-standing ceremony by Side", () => {
    const players = ffaIds(4);
    const survivorIndex = 2; // team-3 is the lone survivor.
    const state = makeFfaMatch(
      players.map((id, index) => ({
        id,
        robots: [
          makeRobot(`${id}-r1`, id, "rifle", index === survivorIndex ? { x: 6, y: 6 } : "dock", {
            hp: index === survivorIndex ? 140 : 0,
          }),
        ],
      })),
    );
    const match = createAuthoritativeMatch(state, players);
    for (const id of players) lockParticipantOrders(match, id, emptyOrders(1), "seed", "nonce");
    resolvePendingTurn(match);
    for (const id of players) acknowledgeTurn(match, id, 1);
    const result = participantMatchSnapshot({
      requestId: "ceremony",
      roomCode: "ABC234",
      matchId: "match-1",
      playerId: "team-3",
      match,
    });
    expect(result).toMatchObject({ status: "finished", outcome: "won", winningSide: 3 });
    const scores = Object.fromEntries(
      (result.ceremonyScores ?? []).map((row) => [row.teamId, row.score]),
    );
    expect(scores["team-3"]).toBe(550); // 1 survivor: 150 robot + 400 team bonus.
    expect(scores["team-1"]).toBe(0);
  });

  it("resolves a simultaneous four-player wipeout as a draw", () => {
    const players = ffaIds(4);
    const state = makeFfaMatch(
      players.map((id) => ({
        id,
        robots: [makeRobot(`${id}-r1`, id, "rifle", "dock", { hp: 0 })],
      })),
    );
    const match = createAuthoritativeMatch(state, players);
    for (const id of players) lockParticipantOrders(match, id, emptyOrders(1), "seed", "nonce");
    resolvePendingTurn(match);
    for (const id of players) acknowledgeTurn(match, id, 1);
    const result = participantMatchSnapshot({
      requestId: "draw",
      roomCode: "ABC234",
      matchId: "match-1",
      playerId: "team-1",
      match,
    });
    expect(result).toMatchObject({ status: "finished", outcome: "draw" });
    expect(result).not.toHaveProperty("winningSide");
  });
});

describe("resignation", () => {
  const POSITIONS = [
    { x: 1, y: 1 },
    { x: 6, y: 1 },
    { x: 6, y: 6 },
    { x: 1, y: 6 },
  ] as const;

  const ffaState = (count: number) =>
    makeFfaMatch(
      Array.from({ length: count }, (_, index) => `team-${index + 1}`).map((id, index) => ({
        id,
        robots: [makeRobot(`${id}-r1`, id, "rifle", POSITIONS[index]!)],
      })),
    );

  it("ends a two-player match the moment one side resigns", () => {
    const match = createAuthoritativeMatch(ffaState(2), ["team-1", "team-2"]);
    resignParticipant(match, "team-2", "seed", "nonce");
    expect(match.phase).toBe("finished");
    expect(match.outcome).toEqual({ status: "won", side: 1 });
    expect(activePlayerIds(match)).toEqual(["team-1"]);
    expect(participantStatus(match, "team-2")).toBe("finished");
    expect(match.turns).toHaveLength(0);
  });

  it("removes a resigned side from three-player play while others resolve, with a byte-identical replay", () => {
    const match = createAuthoritativeMatch(ffaState(3), ["team-1", "team-2", "team-3"]);
    resignParticipant(match, "team-3", "seed", "nonce");
    expect(match.phase).toBe("planning");
    expect(match.outcome).toEqual({ status: "ongoing" });
    expect(activePlayerIds(match)).toEqual(["team-1", "team-2"]);

    // A resigned player can no longer submit or lock orders.
    expect(() => submitParticipantOrders(match, "team-3", emptyOrders(1))).toThrow(/resigned/);
    expect(() => lockParticipantOrders(match, "team-3", emptyOrders(1), "x", "y")).toThrow(
      /resigned/,
    );

    // The two active players resolve without ever waiting on the resigner.
    lockParticipantOrders(match, "team-1", emptyOrders(1), "turn-seed", "turn-nonce");
    expect(match.phase).toBe("planning");
    lockParticipantOrders(match, "team-2", emptyOrders(1), "turn-seed", "turn-nonce");
    expect(match.phase).toBe("resolving");
    expect(resolvePendingTurn(match)).toBe(true);
    expect(match.turns).toHaveLength(1);
    expect(verifyReplay(canonicalReplay(match))).toEqual({ ok: true });
  });

  it("resolves immediately when a resignation was the last thing a turn awaited", () => {
    const match = createAuthoritativeMatch(ffaState(3), ["team-1", "team-2", "team-3"]);
    lockParticipantOrders(match, "team-1", emptyOrders(1), "turn-seed", "turn-nonce");
    lockParticipantOrders(match, "team-2", emptyOrders(1), "turn-seed", "turn-nonce");
    expect(match.phase).toBe("planning"); // still waiting on team-3
    resignParticipant(match, "team-3", "resign-seed", "resign-nonce");
    expect(match.phase).toBe("resolving");
    expect(resolvePendingTurn(match)).toBe(true);
    expect(match.pendingResolution).toBeUndefined();
    expect(match.turns).toHaveLength(1);
  });

  it("awards the win and full ceremony credit to the last un-resigned side", () => {
    const match = createAuthoritativeMatch(ffaState(3), ["team-1", "team-2", "team-3"]);
    resignParticipant(match, "team-1", "s", "n");
    expect(match.outcome).toEqual({ status: "ongoing" });
    resignParticipant(match, "team-2", "s", "n");
    expect(match.phase).toBe("finished");
    expect(match.outcome).toEqual({ status: "won", side: 3 });
    const scores = Object.fromEntries(ceremonyScores(match).map((row) => [row.teamId, row.score]));
    expect(scores).toEqual({ "team-1": 0, "team-2": 0, "team-3": 550 });
  });

  it("treats a repeat or post-finish resignation as a no-op", () => {
    const match = createAuthoritativeMatch(ffaState(2), ["team-1", "team-2"]);
    resignParticipant(match, "team-2", "s", "n");
    const revision = match.revision;
    resignParticipant(match, "team-2", "s", "n"); // already resigned
    resignParticipant(match, "team-1", "s", "n"); // match already finished
    expect(match.revision).toBe(revision);
    expect(match.resignedPlayerIds).toEqual(["team-2"]);
  });
});
