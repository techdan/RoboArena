/**
 * Versioned deterministic replay recording, JSON transport, and verification.
 *
 * Implements `docs/spec.md` §10 and Phase 5 of
 * `docs/implementation-plan.md`. Replay inputs remain authoritative; recorded
 * events and digests are derived verification/playback data.
 */

import { TICKS_PER_SECOND } from "./constants.js";
import { resolveTurn } from "./resolver.js";
import type {
  LastKnownMarker,
  MatchState,
  ReplayLog,
  ReplayTurn,
  ResolutionEvent,
  TurnOrders,
} from "./types.js";

export const REPLAY_FORMAT_VERSION = 1 as const;

export interface CreateReplayInput {
  readonly initialState: MatchState;
  readonly seed: string;
  readonly turnOrders: readonly TurnOrders[];
}

export type ReplayVerification =
  { readonly ok: true } | { readonly ok: false; readonly firstDivergenceTick: number };

interface SerializedMatchState extends Omit<MatchState, "lastKnownMarkers"> {
  readonly lastKnownMarkers: readonly (readonly [string, readonly LastKnownMarker[]])[];
}

interface SerializedReplayLog extends Omit<ReplayLog, "initialState"> {
  readonly initialState: SerializedMatchState;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalize(value[key])]),
  );
};

const canonicalJson = (value: unknown): string => JSON.stringify(canonicalize(value));

/** Stable FNV-1a digest for regression detection; not a security primitive. */
const digest = (value: unknown): string => {
  const text = canonicalJson(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const serializeState = (state: MatchState): SerializedMatchState => ({
  ...state,
  lastKnownMarkers: [...state.lastKnownMarkers.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([teamId, markers]) => [teamId, markers] as const),
});

const digestState = (state: MatchState): string => digest(serializeState(state));

function assertSerializedState(value: unknown): asserts value is SerializedMatchState {
  if (!isRecord(value)) throw new Error("Replay initialState must be an object.");
  if (
    !Number.isInteger(value.turnNumber) ||
    !Array.isArray(value.teams) ||
    !isRecord(value.arena)
  ) {
    throw new Error("Replay initialState is malformed.");
  }
  if (!isRecord(value.config) || !Array.isArray(value.lastKnownMarkers)) {
    throw new Error("Replay initialState is malformed.");
  }

  for (const entry of value.lastKnownMarkers) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") {
      throw new Error("Replay lastKnownMarkers must contain [teamId, markers] entries.");
    }
    if (!Array.isArray(entry[1])) {
      throw new Error("Replay lastKnownMarkers entry must contain a marker array.");
    }
  }
}

const deserializeState = (value: SerializedMatchState): MatchState => ({
  ...value,
  lastKnownMarkers: new Map(value.lastKnownMarkers),
});

function assertReplayTurn(value: unknown): asserts value is ReplayTurn {
  if (!isRecord(value) || !isRecord(value.orders)) throw new Error("Replay turn is malformed.");
  if (!Number.isInteger(value.orders.turnNumber) || !Array.isArray(value.orders.timelines)) {
    throw new Error("Replay turn orders are malformed.");
  }
  if (!Array.isArray(value.events)) throw new Error("Replay turn events must be an array.");
  if (typeof value.eventDigest !== "string" || typeof value.nextStateDigest !== "string") {
    throw new Error("Replay turn digests are malformed.");
  }
}

const firstEventDivergenceTick = (
  expected: readonly ResolutionEvent[],
  actual: readonly ResolutionEvent[],
  turnEndTick: number,
): number | null => {
  const sharedLength = Math.min(expected.length, actual.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const expectedEvent = expected[index];
    const actualEvent = actual[index];
    if (
      expectedEvent !== undefined &&
      actualEvent !== undefined &&
      canonicalJson(expectedEvent) !== canonicalJson(actualEvent)
    ) {
      return Math.min(expectedEvent.tick, actualEvent.tick);
    }
  }
  if (expected.length === actual.length) return null;
  return expected[sharedLength]?.tick ?? actual[sharedLength]?.tick ?? turnEndTick;
};

export const createReplayLog = (input: CreateReplayInput): ReplayLog => {
  let state = input.initialState;
  const turns: ReplayTurn[] = [];

  for (const orders of input.turnOrders) {
    const result = resolveTurn({ state, orders, seed: input.seed });
    if (result.outcome !== "resolved") {
      throw new Error(
        `Cannot record replay turn ${orders.turnNumber}: ${result.code}: ${result.message}`,
      );
    }
    turns.push({
      orders,
      events: result.events,
      eventDigest: digest(result.events),
      nextStateDigest: digestState(result.nextState),
    });
    state = result.nextState;
  }

  return {
    formatVersion: REPLAY_FORMAT_VERSION,
    initialState: input.initialState,
    seed: input.seed,
    turns,
  };
};

export const serializeReplay = (log: ReplayLog): string => {
  if (log.formatVersion !== REPLAY_FORMAT_VERSION) {
    throw new Error(`Unsupported replay format version: ${String(log.formatVersion)}.`);
  }
  const serialized: SerializedReplayLog = {
    ...log,
    initialState: serializeState(log.initialState),
  };
  return JSON.stringify(serialized);
};

export const deserializeReplay = (json: string): ReplayLog => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    throw new Error("Replay is not valid JSON.");
  }

  if (!isRecord(parsed)) throw new Error("Replay root must be an object.");
  if (parsed.formatVersion !== REPLAY_FORMAT_VERSION) {
    throw new Error(`Unsupported replay format version: ${String(parsed.formatVersion)}.`);
  }
  if (typeof parsed.seed !== "string") throw new Error("Replay seed must be a string.");
  assertSerializedState(parsed.initialState);
  if (!Array.isArray(parsed.turns)) throw new Error("Replay turns must be an array.");
  parsed.turns.forEach(assertReplayTurn);

  return {
    formatVersion: REPLAY_FORMAT_VERSION,
    initialState: deserializeState(parsed.initialState),
    seed: parsed.seed,
    turns: parsed.turns,
  };
};

export const verifyReplay = (log: ReplayLog): ReplayVerification => {
  let state = log.initialState;
  let replayTickOffset = 0;

  for (const turn of log.turns) {
    const turnEndTick = state.config.turnLengthSeconds * TICKS_PER_SECOND;
    const result = resolveTurn({ state, orders: turn.orders, seed: log.seed });
    if (result.outcome !== "resolved") {
      return { ok: false, firstDivergenceTick: replayTickOffset };
    }

    const localDivergence = firstEventDivergenceTick(turn.events, result.events, turnEndTick);
    if (
      localDivergence !== null ||
      turn.eventDigest !== digest(turn.events) ||
      turn.eventDigest !== digest(result.events)
    ) {
      return {
        ok: false,
        firstDivergenceTick: replayTickOffset + (localDivergence ?? turn.events[0]?.tick ?? 0),
      };
    }
    if (turn.nextStateDigest !== digestState(result.nextState)) {
      return { ok: false, firstDivergenceTick: replayTickOffset + turnEndTick };
    }

    state = result.nextState;
    replayTickOffset += turnEndTick;
  }

  return { ok: true };
};
