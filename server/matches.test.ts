/** Phase 11 authoritative turn lifecycle and participant projection tests. */

import { describe, expect, it } from "vitest";
import { makeMatch, makeRobot } from "../src/engine/__fixtures__/match";
import { verifyReplay } from "../src/engine/replay";
import type { ResolutionEvent } from "../src/engine/types";
import {
  acknowledgeTurn,
  canonicalReplay,
  createAuthoritativeMatch,
  emptyOrders,
  lockParticipantOrders,
  participantStatus,
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
      nextState: state,
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
