/**
 * In-process authoritative server flow driven by autoplay bots: create a room,
 * join, ready, start, then each participant plans from its own private
 * MatchSnapshot, locks orders, watches/acknowledges the movie, until the
 * Survival match finishes.
 */

import { describe, expect, it } from "vitest";
import { verifyReplay } from "../engine/replay";
import { resolveSurvivalOutcome, survivalCeremonyScores } from "../engine/survival";
import { deserializeMatchState, type MatchSnapshotMessage } from "../lib/net/protocol";
import { configForLength } from "../lib/setup/validate";
import { canonicalReplay } from "../../server/matches";
import { RoomService } from "../../server/rooms";
import { RoomStorage } from "../../server/storage";
import { planTeamOrders } from "./autoplay";

const requireToken = (token: string | undefined): string => {
  if (token === undefined) throw new Error("Expected a participant token.");
  return token;
};

const runRoom = async (gameLength: "melee" | "battle", seed: string, maxTurns: number) => {
  const storage = new RoomStorage(":memory:");
  const service = new RoomService(storage);
  try {
    const host = service.createRoom("Red Bot", "red");
    const code = host.room.code;
    const guest = await service.joinRoom(code, "Blue Bot", "blue");
    const players = [
      { id: host.selfPlayerId, token: requireToken(host.participantToken) },
      { id: guest.selfPlayerId, token: requireToken(guest.participantToken) },
    ];
    await service.updateConfig(code, players[0]!.token, configForLength(gameLength));
    // Nonadjacent corners exercise the non-compacting Home-slot mapping.
    await service.setHomeSlot(code, players[1]!.token, 2);
    for (const player of players) await service.setReady(code, player.token, true);
    const started = await service.startMatch(code, players[0]!.token);
    const matchId = started.room.matchId!;

    let request = 0;
    const nextRequest = () => `req-${(request += 1)}`;
    const snapshots: MatchSnapshotMessage[] = players.map((player) =>
      service.getMatchSnapshot(code, player.token, nextRequest()),
    );
    let turns = 0;
    let droppedSegments = 0;
    const leaks: string[] = [];
    while (snapshots.every((snapshot) => snapshot.status !== "finished") && turns < maxTurns) {
      for (const [index, player] of players.entries()) {
        const snapshot = snapshots[index]!;
        expect(snapshot.status).toBe("planning");
        // The participant's private projection must be enough to plan legal
        // orders. The bots then play from the authoritative state (QA harness
        // knowledge) so the match ends quickly.
        const view = deserializeMatchState(snapshot.match);
        const viewPlan = planTeamOrders(view, player.id, seed);
        droppedSegments += viewPlan.diagnostics.droppedSegments;
        const plan = planTeamOrders(service.getMatchState(code, player.token), player.id, seed);
        droppedSegments += plan.diagnostics.droppedSegments;
        snapshots[index] = await service.lockOrders(
          code,
          player.token,
          matchId,
          plan.orders,
          nextRequest(),
        );
      }
      turns += 1;
      const room = storage.loadRoom(code)!;
      const resolved = room.match!.turns.at(-1)!;
      expect(resolved.turnNumber).toBe(turns);
      for (const [index, player] of players.entries()) {
        const snapshot = service.getMatchSnapshot(code, player.token, nextRequest());
        expect(snapshot.status === "turn-ready" || snapshot.status === "finished").toBe(true);
        const movie = snapshot.unseenTurns.find((turn) => turn.turnNumber === turns);
        expect(movie).toBeDefined();
        const opponent = players[1 - index]!;
        // Enemy robot ids may appear only if visible at turn start or spotted.
        const allowed = new Set([
          ...movie!.initialState.teams.flatMap((team) => team.robots.map((robot) => robot.id)),
          ...movie!.events.flatMap((event) =>
            event.kind === "enemy-spotted" ? [event.enemyId] : [],
          ),
          ...(resolved.initialState.lastKnownMarkers.get(player.id) ?? []).map(
            (marker) => marker.enemyId,
          ),
        ]);
        const json = JSON.stringify(movie);
        for (const robot of resolved.initialState.teams.find((team) => team.id === opponent.id)!
          .robots) {
          if (!allowed.has(robot.id) && json.includes(`"${robot.id}"`)) {
            leaks.push(`turn ${turns}: ${player.id} sees hidden ${robot.id}`);
          }
        }
        expect(json).not.toContain(resolved.seed);
        snapshots[index] = await service.acknowledgeTurnResult(
          code,
          player.token,
          matchId,
          turns,
          nextRequest(),
        );
      }
    }

    const room = storage.loadRoom(code)!;
    const match = room.match!;
    return { snapshots, match, turns, droppedSegments, leaks, players };
  } finally {
    storage.close();
  }
};

describe("autoplay server flow", () => {
  it("plays a two-player melee room to completion through rooms/matches/view", async () => {
    const { snapshots, match, turns, droppedSegments, leaks, players } = await runRoom(
      "melee",
      "server-flow-melee",
      40,
    );
    expect(droppedSegments).toBe(0);
    expect(leaks).toEqual([]);
    expect(turns).toBeGreaterThan(0);
    expect(verifyReplay(canonicalReplay(match))).toEqual({ ok: true });
    const outcome = resolveSurvivalOutcome(match.state.teams);
    expect(match.phase).toBe("finished");
    expect(outcome.status).not.toBe("ongoing");
    const ceremony = survivalCeremonyScores(match.state.teams);
    for (const snapshot of snapshots) {
      expect(snapshot.status).toBe("finished");
      expect(snapshot.outcome).toBe(outcome.status);
      expect(snapshot.ceremonyScores).toEqual(
        players.map((player) => ({ teamId: player.id, score: ceremony.get(player.id) })),
      );
    }
  }, 60_000);
});
