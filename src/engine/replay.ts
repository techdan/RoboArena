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
  TileCoord,
  TurnOrders,
} from "./types.js";

export const REPLAY_FORMAT_VERSION = 1 as const;

export interface CreateReplayTurnInput {
  readonly seed: string;
  readonly orders: TurnOrders;
}

export interface CreateReplayInput {
  readonly initialState: MatchState;
  readonly turns: readonly CreateReplayTurnInput[];
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

const HEADINGS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
const TERRAINS = ["open", "rough", "low-wall", "wall", "bush", "crevice", "outer-wall"] as const;
const POSTURES = ["upright", "ducking", "crouching"] as const;
const WEAPON_IDS = [
  "rifle",
  "burst-gun",
  "auto-rifle",
  "missile-launcher",
  "grenade-launcher",
] as const;
const ROBOT_CLASSES = ["rifle", "burst", "auto", "missile", "stealth"] as const;
const COMMAND_KINDS = [
  "deploy",
  "move",
  "set-posture",
  "set-scan-direction",
  "aim-and-fire",
  "scan-and-fire",
] as const;
const SPORT_TYPES = [
  "survival",
  "treasure-hunt",
  "capture-the-flag",
  "hostage",
  "baseball",
] as const;
const FORMATIONS = [
  "beginner",
  "standard",
  "fire-fight",
  "missile-fest",
  "beat-the-clock",
] as const;
const GAME_LENGTHS = ["skirmish", "melee", "battle", "campaign"] as const;
const ARENA_TYPES = ["rubble", "suburbs", "computer"] as const;
const HOME_CORNERS = ["NW", "NE", "SE", "SW"] as const;

function assertRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") throw new Error(`${path} must be a string.`);
}

function assertBoolean(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean.`);
}

function assertInteger(
  value: unknown,
  path: string,
  limits: { readonly min?: number; readonly max?: number } = {},
): asserts value is number {
  if (
    !Number.isSafeInteger(value) ||
    (limits.min !== undefined && (value as number) < limits.min) ||
    (limits.max !== undefined && (value as number) > limits.max)
  ) {
    throw new Error(`${path} must be a valid integer.`);
  }
}

const assertOneOf = (value: unknown, allowed: readonly unknown[], path: string): void => {
  if (!allowed.includes(value)) throw new Error(`${path} has an unsupported value.`);
};

function assertTileCoord(value: unknown, path: string): asserts value is TileCoord {
  assertRecord(value, path);
  assertInteger(value.x, `${path}.x`);
  assertInteger(value.y, `${path}.y`);
}

const assertRobotDefinition = (value: unknown, path: string): number => {
  assertRecord(value, path);
  assertOneOf(value.class, ROBOT_CLASSES, `${path}.class`);
  assertOneOf(value.accuracy, [0, 1, 2], `${path}.accuracy`);
  assertInteger(value.armor, `${path}.armor`, { min: 1 });
  assertInteger(value.rating, `${path}.rating`, { min: 0 });
  assertOneOf(value.primaryWeapon, WEAPON_IDS, `${path}.primaryWeapon`);
  if (value.secondaryWeapons !== undefined) {
    if (!Array.isArray(value.secondaryWeapons)) {
      throw new Error(`${path}.secondaryWeapons must be an array.`);
    }
    value.secondaryWeapons.forEach((weapon, index) =>
      assertOneOf(weapon, WEAPON_IDS, `${path}.secondaryWeapons[${index}]`),
    );
  }
  if (value.stealthVisibility !== undefined && value.stealthVisibility !== "stealth") {
    throw new Error(`${path}.stealthVisibility has an unsupported value.`);
  }
  return value.armor;
};

const assertRobot = (value: unknown, path: string, teamId: string): string => {
  assertRecord(value, path);
  assertString(value.id, `${path}.id`);
  assertString(value.teamId, `${path}.teamId`);
  if (value.teamId !== teamId) throw new Error(`${path}.teamId does not match its Team.`);
  const armor = assertRobotDefinition(value.definition, `${path}.definition`);
  if (value.position !== "dock") assertTileCoord(value.position, `${path}.position`);
  assertInteger(value.hp, `${path}.hp`, { min: 0 });
  if (value.hp > armor) throw new Error(`${path}.hp cannot exceed armor.`);
  assertOneOf(value.posture, POSTURES, `${path}.posture`);
  assertOneOf(value.scanHeading, HEADINGS, `${path}.scanHeading`);
  assertInteger(value.damageStaggerActionsRemaining, `${path}.damageStaggerActionsRemaining`, {
    min: 0,
  });
  assertRecord(value.ammo, `${path}.ammo`);
  for (const weapon of WEAPON_IDS) {
    const ammo = value.ammo[weapon];
    if (ammo !== "unlimited") assertInteger(ammo, `${path}.ammo.${weapon}`, { min: 0 });
  }
  return value.id;
};

const assertConfig = (value: unknown, path: string): void => {
  assertRecord(value, path);
  assertOneOf(value.sportType, SPORT_TYPES, `${path}.sportType`);
  assertOneOf(value.formation, FORMATIONS, `${path}.formation`);
  assertOneOf(value.length, GAME_LENGTHS, `${path}.length`);
  assertOneOf(value.arenaType, ARENA_TYPES, `${path}.arenaType`);
  assertString(value.arenaSizeName, `${path}.arenaSizeName`);
  assertInteger(value.turnLengthSeconds, `${path}.turnLengthSeconds`, { min: 1, max: 40 });
};

const assertArena = (value: unknown, path: string): void => {
  assertRecord(value, path);
  assertOneOf(value.type, ARENA_TYPES, `${path}.type`);
  assertString(value.sizeName, `${path}.sizeName`);
  assertInteger(value.width, `${path}.width`, { min: 1 });
  assertInteger(value.height, `${path}.height`, { min: 1 });
  const width = value.width;
  const height = value.height;
  if (!Array.isArray(value.tiles) || value.tiles.length !== height) {
    throw new Error(`${path}.tiles must match the declared height.`);
  }
  value.tiles.forEach((row, y) => {
    if (!Array.isArray(row) || row.length !== width) {
      throw new Error(`${path}.tiles[${y}] must match the declared width.`);
    }
    row.forEach((tile, x) => {
      assertRecord(tile, `${path}.tiles[${y}][${x}]`);
      assertOneOf(tile.terrain, TERRAINS, `${path}.tiles[${y}][${x}].terrain`);
    });
  });
  if (!Array.isArray(value.homeAreas)) throw new Error(`${path}.homeAreas must be an array.`);
  value.homeAreas.forEach((home, index) => {
    const homePath = `${path}.homeAreas[${index}]`;
    assertRecord(home, homePath);
    assertOneOf(home.corner, HOME_CORNERS, `${homePath}.corner`);
    if (!Array.isArray(home.tiles)) throw new Error(`${homePath}.tiles must be an array.`);
    home.tiles.forEach((tile, tileIndex) => {
      assertTileCoord(tile, `${homePath}.tiles[${tileIndex}]`);
      if (tile.x < 0 || tile.x >= width || tile.y < 0 || tile.y >= height) {
        throw new Error(`${homePath}.tiles[${tileIndex}] is outside the arena.`);
      }
    });
  });
};

const assertTeam = (value: unknown, path: string, robotIds: Set<string>): string => {
  assertRecord(value, path);
  assertString(value.id, `${path}.id`);
  assertString(value.name, `${path}.name`);
  assertString(value.color, `${path}.color`);
  assertOneOf(value.side, [1, 2, 3, 4], `${path}.side`);
  assertOneOf(value.homeSlot, [0, 1, 2, 3], `${path}.homeSlot`);
  assertOneOf(value.brain, ["human", "stupid"], `${path}.brain`);
  assertInteger(value.score, `${path}.score`);
  if (!Array.isArray(value.robots)) throw new Error(`${path}.robots must be an array.`);
  value.robots.forEach((robot, index) => {
    const robotId = assertRobot(robot, `${path}.robots[${index}]`, value.id as string);
    if (robotIds.has(robotId)) throw new Error(`Replay robot id ${robotId} is duplicated.`);
    robotIds.add(robotId);
  });
  return value.id;
};

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
  assertRecord(value, "Replay initialState");
  assertInteger(value.turnNumber, "Replay initialState.turnNumber", { min: 1 });
  assertConfig(value.config, "Replay initialState.config");
  assertArena(value.arena, "Replay initialState.arena");
  if (!Array.isArray(value.teams)) throw new Error("Replay initialState.teams must be an array.");
  const teamIds = new Set<string>();
  const robotIds = new Set<string>();
  value.teams.forEach((team, index) => {
    const teamId = assertTeam(team, `Replay initialState.teams[${index}]`, robotIds);
    if (teamIds.has(teamId)) throw new Error(`Replay Team id ${teamId} is duplicated.`);
    teamIds.add(teamId);
  });

  if (!Array.isArray(value.lastKnownMarkers)) {
    throw new Error("Replay initialState.lastKnownMarkers must be an array.");
  }
  const markerTeamIds = new Set<string>();
  value.lastKnownMarkers.forEach((entry, entryIndex) => {
    const path = `Replay initialState.lastKnownMarkers[${entryIndex}]`;
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new Error(`${path} must be a [teamId, markers] entry.`);
    }
    assertString(entry[0], `${path}[0]`);
    if (!teamIds.has(entry[0])) throw new Error(`${path}[0] references an unknown Team.`);
    if (markerTeamIds.has(entry[0])) throw new Error(`${path}[0] is duplicated.`);
    markerTeamIds.add(entry[0]);
    if (!Array.isArray(entry[1])) throw new Error(`${path}[1] must be a marker array.`);
    entry[1].forEach((marker, markerIndex) => {
      const markerPath = `${path}[1][${markerIndex}]`;
      assertRecord(marker, markerPath);
      assertString(marker.enemyId, `${markerPath}.enemyId`);
      if (!robotIds.has(marker.enemyId)) {
        throw new Error(`${markerPath}.enemyId references an unknown robot.`);
      }
      assertTileCoord(marker.at, `${markerPath}.at`);
    });
  });
}

const deserializeState = (value: SerializedMatchState): MatchState => ({
  ...value,
  lastKnownMarkers: new Map(value.lastKnownMarkers),
});

const assertMovementStep = (value: unknown, path: string): void => {
  assertRecord(value, path);
  assertTileCoord(value.to, `${path}.to`);
  if (value.via !== undefined) assertTileCoord(value.via, `${path}.via`);
};

const assertCommandSegment = (value: unknown, path: string): void => {
  assertRecord(value, path);
  assertOneOf(value.kind, COMMAND_KINDS, `${path}.kind`);
  switch (value.kind) {
    case "deploy":
      assertTileCoord(value.to, `${path}.to`);
      return;
    case "move":
      assertOneOf(value.posture, POSTURES, `${path}.posture`);
      if (!Array.isArray(value.path)) throw new Error(`${path}.path must be an array.`);
      value.path.forEach((step, index) => assertMovementStep(step, `${path}.path[${index}]`));
      return;
    case "set-posture":
      assertOneOf(value.posture, POSTURES, `${path}.posture`);
      return;
    case "set-scan-direction":
      assertOneOf(value.heading, HEADINGS, `${path}.heading`);
      return;
    case "aim-and-fire":
      assertTileCoord(value.target, `${path}.target`);
      assertOneOf(value.weapon, WEAPON_IDS, `${path}.weapon`);
      assertBoolean(value.repeat, `${path}.repeat`);
      return;
    case "scan-and-fire":
      assertOneOf(value.weapon, WEAPON_IDS, `${path}.weapon`);
      assertInteger(value.maxDistance, `${path}.maxDistance`, { min: 0 });
      assertInteger(value.seconds, `${path}.seconds`, { min: 1 });
      return;
    default:
      throw new Error(`${path}.kind has an unsupported value.`);
  }
};

function assertTurnOrders(value: unknown, path: string): asserts value is TurnOrders {
  assertRecord(value, path);
  assertInteger(value.turnNumber, `${path}.turnNumber`, { min: 1 });
  if (!Array.isArray(value.timelines)) throw new Error(`${path}.timelines must be an array.`);
  value.timelines.forEach((timeline, timelineIndex) => {
    const timelinePath = `${path}.timelines[${timelineIndex}]`;
    assertRecord(timeline, timelinePath);
    assertString(timeline.robotId, `${timelinePath}.robotId`);
    if (!Array.isArray(timeline.segments)) {
      throw new Error(`${timelinePath}.segments must be an array.`);
    }
    timeline.segments.forEach((segment, segmentIndex) =>
      assertCommandSegment(segment, `${timelinePath}.segments[${segmentIndex}]`),
    );
  });
}

const assertEventEnvelope = (value: Record<string, unknown>, path: string): void => {
  assertInteger(value.tick, `${path}.tick`, { min: 0 });
  assertInteger(value.seq, `${path}.seq`, { min: 0 });
  assertString(value.kind, `${path}.kind`);
};

const assertStringField = (value: Record<string, unknown>, field: string, path: string): void =>
  assertString(value[field], `${path}.${field}`);

const assertIntegerField = (value: Record<string, unknown>, field: string, path: string): void =>
  assertInteger(value[field], `${path}.${field}`, { min: 0 });

function assertResolutionEvent(value: unknown, path: string): asserts value is ResolutionEvent {
  assertRecord(value, path);
  assertEventEnvelope(value, path);
  switch (value.kind) {
    case "turn-start":
    case "turn-end":
      assertInteger(value.turnNumber, `${path}.turnNumber`, { min: 1 });
      return;
    case "command-start":
      assertStringField(value, "robotId", path);
      assertIntegerField(value, "commandIndex", path);
      assertOneOf(value.commandKind, COMMAND_KINDS, `${path}.commandKind`);
      return;
    case "deployed":
    case "move-step":
      assertStringField(value, "robotId", path);
      assertTileCoord(value.to, `${path}.to`);
      return;
    case "posture-changed":
      assertStringField(value, "robotId", path);
      assertOneOf(value.posture, POSTURES, `${path}.posture`);
      return;
    case "scan-rotated":
      assertStringField(value, "robotId", path);
      assertOneOf(value.heading, HEADINGS, `${path}.heading`);
      return;
    case "enemy-spotted":
      assertStringField(value, "teamId", path);
      assertStringField(value, "enemyId", path);
      assertTileCoord(value.at, `${path}.at`);
      return;
    case "enemy-lost":
      assertStringField(value, "teamId", path);
      assertStringField(value, "enemyId", path);
      assertTileCoord(value.lastSeenAt, `${path}.lastSeenAt`);
      return;
    case "scan-target-acquired":
      assertStringField(value, "shooterId", path);
      assertStringField(value, "targetId", path);
      assertIntegerField(value, "distance", path);
      return;
    case "fired":
      assertStringField(value, "shooterId", path);
      assertIntegerField(value, "commandIndex", path);
      assertOneOf(value.weapon, WEAPON_IDS, `${path}.weapon`);
      assertTileCoord(value.target, `${path}.target`);
      assertOneOf(value.fireMode, ["aim", "scan"], `${path}.fireMode`);
      return;
    case "projectile-launched":
      assertStringField(value, "projectileId", path);
      assertStringField(value, "shooterId", path);
      assertIntegerField(value, "shotIndex", path);
      assertOneOf(value.weapon, WEAPON_IDS, `${path}.weapon`);
      assertTileCoord(value.from, `${path}.from`);
      assertTileCoord(value.target, `${path}.target`);
      return;
    case "projectile-impacted":
      assertStringField(value, "projectileId", path);
      assertOneOf(value.weapon, WEAPON_IDS, `${path}.weapon`);
      assertTileCoord(value.target, `${path}.target`);
      assertOneOf(value.outcome, ["hit", "miss", "blast"], `${path}.outcome`);
      return;
    case "shot-missed":
      assertStringField(value, "shooterId", path);
      assertIntegerField(value, "shotIndex", path);
      assertTileCoord(value.target, `${path}.target`);
      assertOneOf(
        value.reason,
        ["out-of-range", "angle-blocked", "sight-blocked", "hit-roll", "no-target"],
        `${path}.reason`,
      );
      if (value.score !== undefined) assertIntegerField(value, "score", path);
      return;
    case "damaged":
      assertOneOf(value.damageKind, ["direct", "blast"], `${path}.damageKind`);
      assertStringField(value, "sourceId", path);
      assertIntegerField(value, "shotIndex", path);
      assertStringField(value, "targetId", path);
      assertIntegerField(value, "damage", path);
      if (value.damageKind === "direct") assertIntegerField(value, "score", path);
      else assertIntegerField(value, "radius", path);
      return;
    case "destroyed":
      assertStringField(value, "robotId", path);
      return;
    case "last-known-marker":
      assertStringField(value, "teamId", path);
      assertStringField(value, "enemyId", path);
      assertTileCoord(value.at, `${path}.at`);
      return;
    case "command-aborted":
      assertStringField(value, "robotId", path);
      assertIntegerField(value, "commandIndex", path);
      assertOneOf(value.reason, ["destroyed"], `${path}.reason`);
      return;
    default:
      throw new Error(`${path}.kind has an unsupported value.`);
  }
}

function assertReplayTurn(value: unknown): asserts value is ReplayTurn {
  assertRecord(value, "Replay turn");
  assertString(value.seed, "Replay turn.seed");
  assertTurnOrders(value.orders, "Replay turn.orders");
  if (!Array.isArray(value.events)) throw new Error("Replay turn.events must be an array.");
  value.events.forEach((event, index) =>
    assertResolutionEvent(event, `Replay turn.events[${index}]`),
  );
  for (const field of ["eventDigest", "nextStateDigest"] as const) {
    assertString(value[field], `Replay turn.${field}`);
    if (!/^[0-9a-f]{8}$/.test(value[field])) {
      throw new Error(`Replay turn.${field} must be an eight-digit hexadecimal digest.`);
    }
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

  for (const turn of input.turns) {
    const result = resolveTurn({ state, orders: turn.orders, seed: turn.seed });
    if (result.outcome !== "resolved") {
      throw new Error(
        `Cannot record replay turn ${turn.orders.turnNumber}: ${result.code}: ${result.message}`,
      );
    }
    turns.push({
      seed: turn.seed,
      orders: turn.orders,
      events: result.events,
      eventDigest: digest(result.events),
      nextStateDigest: digestState(result.nextState),
    });
    state = result.nextState;
  }

  return {
    formatVersion: REPLAY_FORMAT_VERSION,
    initialState: input.initialState,
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
  assertSerializedState(parsed.initialState);
  if (!Array.isArray(parsed.turns)) throw new Error("Replay turns must be an array.");
  parsed.turns.forEach(assertReplayTurn);

  return {
    formatVersion: REPLAY_FORMAT_VERSION,
    initialState: deserializeState(parsed.initialState),
    turns: parsed.turns,
  };
};

export const verifyReplay = (log: ReplayLog): ReplayVerification => {
  try {
    let state = log.initialState;
    let replayTickOffset = 0;

    for (const turn of log.turns) {
      try {
        const turnEndTick = state.config.turnLengthSeconds * TICKS_PER_SECOND;
        const result = resolveTurn({ state, orders: turn.orders, seed: turn.seed });
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
      } catch {
        return { ok: false, firstDivergenceTick: replayTickOffset };
      }
    }

    return { ok: true };
  } catch {
    return { ok: false, firstDivergenceTick: 0 };
  }
};
