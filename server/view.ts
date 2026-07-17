/** Participant-specific state and event projection. Hidden enemy state never crosses this boundary. */

import { computeVisibility } from "../src/engine/visibility.js";
import type { MatchState, ResolutionEvent } from "../src/engine/types.js";
import {
  serializeMatchState,
  type MatchSnapshotMessage,
  type ParticipantTurnResult,
} from "../src/lib/net/protocol.js";
import {
  ceremonyScores,
  emptyOrders,
  participantStatus,
  type AuthoritativeMatchRecord,
  type CanonicalTurnRecord,
} from "./matches.js";

export const projectMatchState = (state: MatchState, playerId: string): MatchState => {
  const observer = state.teams.find((team) => team.id === playerId);
  if (observer === undefined) throw new Error("Participant Team is missing from match state.");
  const visibility = computeVisibility(state, playerId);
  const ownMarkers = state.lastKnownMarkers.get(playerId) ?? [];
  return {
    ...state,
    teams: state.teams.map((team) => ({
      ...team,
      robots:
        team.side === observer.side
          ? team.robots
          : team.robots.filter((robot) => visibility.visibleEnemies.has(robot.id)),
    })),
    lastKnownMarkers: new Map(ownMarkers.length === 0 ? [] : [[playerId, ownMarkers]]),
  };
};

const eventIsAuthorized = (
  event: ResolutionEvent,
  playerId: string,
  authorizedRobotIds: ReadonlySet<string>,
  authorizedProjectileIds: Set<string>,
): boolean => {
  switch (event.kind) {
    case "turn-start":
    case "turn-end":
      return true;
    case "enemy-spotted":
    case "enemy-lost":
    case "last-known-marker":
      return event.teamId === playerId;
    case "command-start":
    case "deployed":
    case "move-step":
    case "posture-changed":
    case "scan-rotated":
    case "destroyed":
    case "command-aborted":
      return authorizedRobotIds.has(event.robotId);
    case "scan-target-acquired":
      return authorizedRobotIds.has(event.shooterId) || authorizedRobotIds.has(event.targetId);
    case "fired":
    case "shot-missed":
      return authorizedRobotIds.has(event.shooterId);
    case "projectile-launched":
      if (!authorizedRobotIds.has(event.shooterId)) return false;
      authorizedProjectileIds.add(event.projectileId);
      return true;
    case "projectile-impacted":
      return authorizedProjectileIds.has(event.projectileId);
    case "damaged":
      return authorizedRobotIds.has(event.sourceId) && authorizedRobotIds.has(event.targetId);
  }
};

export const projectTurnResult = (
  turn: CanonicalTurnRecord,
  playerId: string,
  playbackTick = 0,
): ParticipantTurnResult => {
  const initialView = projectMatchState(turn.initialState, playerId);
  const authorizedRobotIds = new Set(
    initialView.teams.flatMap((team) => team.robots.map((robot) => robot.id)),
  );
  const authorizedProjectileIds = new Set<string>();
  const events: ResolutionEvent[] = [];
  for (const event of turn.events) {
    if (event.kind === "enemy-spotted" && event.teamId === playerId) {
      authorizedRobotIds.add(event.enemyId);
    }
    if (eventIsAuthorized(event, playerId, authorizedRobotIds, authorizedProjectileIds)) {
      events.push(event);
    }
    if (event.kind === "enemy-lost" && event.teamId === playerId) {
      authorizedRobotIds.delete(event.enemyId);
    }
  }
  return {
    turnNumber: turn.turnNumber,
    initialState: serializeMatchState(initialView),
    events,
    playbackTick,
  };
};

export const participantMatchSnapshot = (input: {
  readonly requestId: string;
  readonly roomCode: string;
  readonly matchId: string;
  readonly playerId: string;
  readonly match: AuthoritativeMatchRecord;
}): MatchSnapshotMessage => {
  const acknowledged = input.match.acknowledgedThrough[input.playerId] ?? 0;
  const status = participantStatus(input.match, input.playerId);
  const outcome = input.match.outcome;
  return {
    version: 1,
    requestId: input.requestId,
    kind: "MatchSnapshot",
    roomCode: input.roomCode,
    matchId: input.matchId,
    selfPlayerId: input.playerId,
    match: serializeMatchState(projectMatchState(input.match.state, input.playerId)),
    status,
    revision: `${input.match.state.turnNumber}:${input.match.revision}`,
    ownOrders: input.match.drafts[input.playerId] ?? emptyOrders(input.match.state.turnNumber),
    locked: input.match.lockedPlayerIds.includes(input.playerId),
    lockedPlayerIds: [...input.match.lockedPlayerIds],
    unseenTurns: input.match.turns
      .filter((turn) => turn.turnNumber > acknowledged)
      .map((turn) =>
        projectTurnResult(
          turn,
          input.playerId,
          input.match.playbackPositions[input.playerId]?.turnNumber === turn.turnNumber
            ? input.match.playbackPositions[input.playerId]!.tick
            : 0,
        ),
      ),
    ...(status !== "finished" || outcome.status === "ongoing"
      ? {}
      : {
          outcome: outcome.status,
          ...(outcome.status === "won" ? { winningSide: outcome.side } : {}),
          ceremonyScores: ceremonyScores(input.match),
        }),
  };
};
