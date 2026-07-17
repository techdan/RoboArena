/** Durable authoritative match phase machine for the private online turn loop. */

import { createReplayLog, verifyReplay } from "../src/engine/replay.js";
import { resolveTurn } from "../src/engine/resolver.js";
import {
  resolveSurvivalOutcome,
  survivalCeremonyScores,
  type SurvivalOutcome,
} from "../src/engine/survival.js";
import type {
  MatchState,
  ReplayLog,
  ReplayTurn,
  ResolutionEvent,
  TurnOrders,
} from "../src/engine/types.js";
import type { ProtocolErrorCode } from "../src/lib/net/protocol.js";

export interface CanonicalTurnRecord {
  readonly turnNumber: number;
  readonly seed: string;
  readonly resolutionNonce: string;
  readonly orders: TurnOrders;
  readonly participantOrders: Readonly<Record<string, TurnOrders>>;
  readonly initialState: MatchState;
  readonly nextState: MatchState;
  readonly events: readonly ResolutionEvent[];
  readonly eventDigest: string;
  readonly nextStateDigest: string;
}

export interface PendingResolution {
  readonly turnNumber: number;
  readonly seed: string;
  readonly resolutionNonce: string;
  readonly orders: TurnOrders;
}

export interface AuthoritativeMatchRecord {
  readonly initialState: MatchState;
  state: MatchState;
  phase: "planning" | "resolving" | "finished";
  revision: number;
  readonly playerIds: readonly string[];
  drafts: Record<string, TurnOrders>;
  lockedPlayerIds: string[];
  acknowledgedThrough: Record<string, number>;
  playbackPositions: Record<string, { readonly turnNumber: number; readonly tick: number }>;
  turns: CanonicalTurnRecord[];
  pendingResolution?: PendingResolution;
  outcome: SurvivalOutcome;
}

export class MatchLifecycleError extends Error {
  constructor(
    readonly code: ProtocolErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const emptyOrders = (turnNumber: number): TurnOrders => ({ turnNumber, timelines: [] });

export const createAuthoritativeMatch = (
  state: MatchState,
  playerIds: readonly string[],
): AuthoritativeMatchRecord => ({
  initialState: state,
  state,
  phase: "planning",
  revision: 1,
  playerIds: [...playerIds],
  drafts: {},
  lockedPlayerIds: [],
  acknowledgedThrough: Object.fromEntries(playerIds.map((playerId) => [playerId, 0])),
  playbackPositions: {},
  turns: [],
  outcome: { status: "ongoing" },
});

const requireCurrentPlanningTurn = (
  match: AuthoritativeMatchRecord,
  playerId: string,
  orders: TurnOrders,
): void => {
  if (match.phase !== "planning") {
    throw new MatchLifecycleError("WRONG_PHASE", "This match is not accepting orders.");
  }
  if (orders.turnNumber !== match.state.turnNumber) {
    throw new MatchLifecycleError(
      "STALE_TURN",
      `Orders for turn ${orders.turnNumber} cannot replace turn ${match.state.turnNumber}.`,
    );
  }
  if ((match.acknowledgedThrough[playerId] ?? 0) < match.state.turnNumber - 1) {
    throw new MatchLifecycleError(
      "WRONG_PHASE",
      "Watch and acknowledge the previous turn before programming the next one.",
    );
  }
  if (match.lockedPlayerIds.includes(playerId)) {
    throw new MatchLifecycleError("ORDERS_LOCKED", "Locked orders are immutable.");
  }
};

export const validateParticipantOrders = (
  match: AuthoritativeMatchRecord,
  playerId: string,
  orders: TurnOrders,
): void => {
  requireCurrentPlanningTurn(match, playerId, orders);
  const team = match.state.teams.find((candidate) => candidate.id === playerId);
  if (team === undefined) {
    throw new MatchLifecycleError("UNAUTHORIZED", "That participant does not own a Team.");
  }
  const ownedRobotIds = new Set(team.robots.map((robot) => robot.id));
  const timelineIds = new Set<string>();
  for (const timeline of orders.timelines) {
    if (!ownedRobotIds.has(timeline.robotId)) {
      throw new MatchLifecycleError(
        "INVALID_ORDERS",
        `Robot ${timeline.robotId} is not owned by this participant.`,
      );
    }
    if (timelineIds.has(timeline.robotId)) {
      throw new MatchLifecycleError(
        "INVALID_ORDERS",
        `Robot ${timeline.robotId} has more than one timeline.`,
      );
    }
    timelineIds.add(timeline.robotId);
  }
  const validation = resolveTurn({ state: match.state, orders, seed: "order-validation" });
  if (validation.outcome !== "resolved") {
    throw new MatchLifecycleError("INVALID_ORDERS", validation.message);
  }
};

export const submitParticipantOrders = (
  match: AuthoritativeMatchRecord,
  playerId: string,
  orders: TurnOrders,
): void => {
  if (JSON.stringify(match.drafts[playerId]) === JSON.stringify(orders)) return;
  validateParticipantOrders(match, playerId, orders);
  match.drafts[playerId] = structuredClone(orders);
  match.revision += 1;
};

const combineLockedOrders = (match: AuthoritativeMatchRecord): TurnOrders => {
  const timelineByRobot = new Map(
    Object.values(match.drafts).flatMap((orders) =>
      orders.timelines.map((timeline) => [timeline.robotId, timeline] as const),
    ),
  );
  return {
    turnNumber: match.state.turnNumber,
    timelines: match.state.teams.flatMap((team) =>
      team.robots.flatMap((robot) => {
        const timeline = timelineByRobot.get(robot.id);
        return timeline === undefined ? [] : [timeline];
      }),
    ),
  };
};

export const lockParticipantOrders = (
  match: AuthoritativeMatchRecord,
  playerId: string,
  orders: TurnOrders,
  seed: string,
  resolutionNonce: string,
): void => {
  if (orders.turnNumber < match.state.turnNumber) {
    const resolved = match.turns.find((turn) => turn.turnNumber === orders.turnNumber);
    const recorded = resolved?.participantOrders[playerId];
    if (recorded !== undefined && JSON.stringify(recorded) === JSON.stringify(orders)) return;
  }
  if (match.lockedPlayerIds.includes(playerId)) {
    if (JSON.stringify(match.drafts[playerId]) === JSON.stringify(orders)) return;
    throw new MatchLifecycleError("ORDERS_LOCKED", "Locked orders are immutable.");
  }
  submitParticipantOrders(match, playerId, orders);
  match.lockedPlayerIds.push(playerId);
  match.revision += 1;
  if (match.lockedPlayerIds.length !== match.playerIds.length) return;
  match.pendingResolution = {
    turnNumber: match.state.turnNumber,
    seed,
    resolutionNonce,
    orders: combineLockedOrders(match),
  };
  match.phase = "resolving";
  match.revision += 1;
};

export const resolvePendingTurn = (match: AuthoritativeMatchRecord): boolean => {
  const pending = match.pendingResolution;
  if (match.phase !== "resolving" || pending === undefined) return false;
  const initialState = match.state;
  const result = resolveTurn({ state: initialState, orders: pending.orders, seed: pending.seed });
  if (result.outcome !== "resolved") {
    throw new MatchLifecycleError("INVALID_ORDERS", result.message);
  }
  const replay = createReplayLog({
    initialState: match.initialState,
    turns: [
      ...match.turns.map((turn) => ({ seed: turn.seed, orders: turn.orders })),
      { seed: pending.seed, orders: pending.orders },
    ],
  });
  const replayTurn = replay.turns.at(-1)!;
  const candidateReplay: ReplayLog = {
    formatVersion: 1,
    initialState: match.initialState,
    turns: [
      ...match.turns.map((turn): ReplayTurn => ({
        seed: turn.seed,
        orders: turn.orders,
        events: turn.events,
        eventDigest: turn.eventDigest,
        nextStateDigest: turn.nextStateDigest,
      })),
      {
        seed: pending.seed,
        orders: pending.orders,
        events: result.events,
        eventDigest: replayTurn.eventDigest,
        nextStateDigest: replayTurn.nextStateDigest,
      },
    ],
  };
  const verification = verifyReplay(candidateReplay);
  if (!verification.ok) {
    throw new MatchLifecycleError(
      "INTERNAL_ERROR",
      `Canonical replay verification failed at tick ${verification.firstDivergenceTick}.`,
    );
  }
  match.turns.push({
    turnNumber: pending.turnNumber,
    seed: pending.seed,
    resolutionNonce: pending.resolutionNonce,
    orders: pending.orders,
    participantOrders: structuredClone(match.drafts),
    initialState,
    nextState: result.nextState,
    events: result.events,
    eventDigest: replayTurn.eventDigest,
    nextStateDigest: replayTurn.nextStateDigest,
  });
  match.state = result.nextState;
  match.outcome = resolveSurvivalOutcome(result.nextState.teams);
  match.phase = match.outcome.status === "ongoing" ? "planning" : "finished";
  match.drafts = {};
  match.lockedPlayerIds = [];
  delete match.pendingResolution;
  match.revision += 1;
  return true;
};

export const acknowledgeTurn = (
  match: AuthoritativeMatchRecord,
  playerId: string,
  turnNumber: number,
): void => {
  if (!match.turns.some((turn) => turn.turnNumber === turnNumber)) {
    throw new MatchLifecycleError("STALE_TURN", "That turn result is not available.");
  }
  const current = match.acknowledgedThrough[playerId] ?? 0;
  const acknowledgedThrough = Math.max(current, turnNumber);
  if (acknowledgedThrough === current) return;
  match.acknowledgedThrough[playerId] = acknowledgedThrough;
  match.revision += 1;
};

export const setPlaybackPosition = (
  match: AuthoritativeMatchRecord,
  playerId: string,
  turnNumber: number,
  tick: number,
): void => {
  const turn = match.turns.find((candidate) => candidate.turnNumber === turnNumber);
  if (turn === undefined) {
    throw new MatchLifecycleError("STALE_TURN", "That turn result is not available.");
  }
  const maximumTick = turn.initialState.config.turnLengthSeconds * 60;
  match.playbackPositions[playerId] = {
    turnNumber,
    tick: Math.max(0, Math.min(maximumTick, tick)),
  };
};

export const participantStatus = (
  match: AuthoritativeMatchRecord,
  playerId: string,
): "planning" | "waiting" | "turn-ready" | "finished" => {
  if ((match.acknowledgedThrough[playerId] ?? 0) < match.state.turnNumber - 1) return "turn-ready";
  if (match.phase === "finished") return "finished";
  return match.lockedPlayerIds.includes(playerId) ? "waiting" : "planning";
};

export const canonicalReplay = (match: AuthoritativeMatchRecord): ReplayLog => ({
  formatVersion: 1,
  initialState: match.initialState,
  turns: match.turns.map((turn): ReplayTurn => ({
    seed: turn.seed,
    orders: turn.orders,
    events: turn.events,
    eventDigest: turn.eventDigest,
    nextStateDigest: turn.nextStateDigest,
  })),
});

export const ceremonyScores = (
  match: AuthoritativeMatchRecord,
): readonly { readonly teamId: string; readonly score: number }[] =>
  [...survivalCeremonyScores(match.state.teams)].map(([teamId, score]) => ({ teamId, score }));
