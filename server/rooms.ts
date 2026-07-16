/** Authoritative Phase 8 room lifecycle and participant ownership. */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { DEFAULT_ROSTER_BY_LENGTH, ROBOT_DEFINITIONS, WEAPONS } from "../src/engine/catalog.js";
import type {
  MatchState,
  RobotClass,
  RobotState,
  TeamState,
  WeaponId,
} from "../src/engine/types.js";
import type { PublicPlayer, PublicRoom, ProtocolErrorCode } from "../src/lib/net/protocol.js";
import {
  DEFAULT_ROOM_CONFIG,
  type PlayerColor,
  type RoomConfig,
} from "../src/lib/setup/validate.js";
import { loadArena } from "../src/lib/arenas/index.js";
import type { RoomStorage } from "./storage.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ID_ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];

export interface PlayerRecord {
  readonly id: string;
  readonly tokenHash: string;
  name: string;
  color: PlayerColor;
  ready: boolean;
  side?: 1 | 2 | 3 | 4;
  homeSlot?: 0 | 1 | 2 | 3;
}

export interface RoomRecord {
  readonly code: string;
  readonly hostPlayerId: string;
  phase: "setup" | "active";
  config: RoomConfig;
  readonly players: PlayerRecord[];
  matchId?: string;
  matchState?: MatchState;
}

export class RoomError extends Error {
  constructor(
    readonly code: ProtocolErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface RoomAccess {
  readonly room: PublicRoom;
  readonly selfPlayerId: string;
  readonly participantToken?: string;
}

const randomId = (length: number, alphabet: string): string => {
  const bytes = randomBytes(length);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
};

export const hashParticipantToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

const hashesMatch = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

export class RoomService {
  readonly #connected = new Map<string, number>();
  readonly #locks = new Map<string, Promise<void>>();

  constructor(readonly storage: RoomStorage) {}

  createRoom(name: string, color: PlayerColor): RoomAccess {
    let code = randomId(6, CODE_ALPHABET);
    while (this.storage.loadRoom(code) !== undefined) code = randomId(6, CODE_ALPHABET);
    const token = randomBytes(32).toString("base64url");
    const player: PlayerRecord = {
      id: randomId(10, ID_ALPHABET),
      tokenHash: hashParticipantToken(token),
      name,
      color,
      ready: false,
    };
    const room: RoomRecord = {
      code,
      hostPlayerId: player.id,
      phase: "setup",
      config: DEFAULT_ROOM_CONFIG,
      players: [player],
    };
    this.storage.saveRoom(room);
    return { room: this.publicRoom(room), selfPlayerId: player.id, participantToken: token };
  }

  async joinRoom(code: string, name: string, color: PlayerColor): Promise<RoomAccess> {
    return this.#withLock(code, () => {
      const room = this.#requireRoom(code);
      if (room.phase !== "setup")
        throw new RoomError("ROOM_STARTED", "This match has already started.");
      if (room.players.length >= 4)
        throw new RoomError("ROOM_FULL", "This room already has four players.");
      this.#assertUniqueIdentity(room, name, color);
      const token = randomBytes(32).toString("base64url");
      const player: PlayerRecord = {
        id: randomId(10, ID_ALPHABET),
        tokenHash: hashParticipantToken(token),
        name,
        color,
        ready: false,
      };
      room.players.push(player);
      this.storage.saveRoom(room);
      return { room: this.publicRoom(room), selfPlayerId: player.id, participantToken: token };
    });
  }

  resumeRoom(code: string, token: string): RoomAccess {
    const room = this.#requireRoom(code);
    const player = this.#authenticate(room, token);
    return { room: this.publicRoom(room), selfPlayerId: player.id };
  }

  async updatePlayer(
    code: string,
    token: string,
    name: string,
    color: PlayerColor,
  ): Promise<RoomAccess> {
    return this.#withLock(code, () => {
      const room = this.#requireSetupRoom(code);
      const player = this.#authenticate(room, token);
      this.#assertUniqueIdentity(room, name, color, player.id);
      player.name = name;
      player.color = color;
      player.ready = false;
      this.storage.saveRoom(room);
      return { room: this.publicRoom(room), selfPlayerId: player.id };
    });
  }

  async updateConfig(code: string, token: string, config: RoomConfig): Promise<RoomAccess> {
    return this.#withLock(code, () => {
      const room = this.#requireSetupRoom(code);
      const player = this.#authenticate(room, token);
      this.#assertHost(room, player);
      room.config = config;
      for (const participant of room.players) participant.ready = false;
      this.storage.saveRoom(room);
      return { room: this.publicRoom(room), selfPlayerId: player.id };
    });
  }

  async setReady(code: string, token: string, ready: boolean): Promise<RoomAccess> {
    return this.#withLock(code, () => {
      const room = this.#requireSetupRoom(code);
      const player = this.#authenticate(room, token);
      player.ready = ready;
      this.storage.saveRoom(room);
      return { room: this.publicRoom(room), selfPlayerId: player.id };
    });
  }

  async startMatch(code: string, token: string): Promise<RoomAccess> {
    return this.#withLock(code, async () => {
      const room = this.#requireSetupRoom(code);
      const player = this.#authenticate(room, token);
      this.#assertHost(room, player);
      if (room.players.length < 2 || room.players.some((participant) => !participant.ready)) {
        throw new RoomError("NOT_READY", "At least two players must all be ready.");
      }
      room.players.forEach((participant, index) => {
        participant.side = (index + 1) as 1 | 2 | 3 | 4;
        participant.homeSlot = index as 0 | 1 | 2 | 3;
      });
      room.matchId = randomId(10, ID_ALPHABET);
      room.matchState = await this.#createMatchState(room);
      room.phase = "active";
      this.storage.saveRoom(room);
      return { room: this.publicRoom(room), selfPlayerId: player.id };
    });
  }

  getMatchState(code: string, token: string): MatchState {
    const room = this.#requireRoom(code);
    this.#authenticate(room, token);
    if (room.matchState === undefined)
      throw new RoomError("ROOM_STARTED", "The match has not started.");
    return room.matchState;
  }

  markConnected(playerId: string): void {
    this.#connected.set(playerId, (this.#connected.get(playerId) ?? 0) + 1);
  }

  markDisconnected(playerId: string): void {
    const next = (this.#connected.get(playerId) ?? 1) - 1;
    if (next <= 0) this.#connected.delete(playerId);
    else this.#connected.set(playerId, next);
  }

  publicRoom(roomOrCode: RoomRecord | string): PublicRoom {
    const room = typeof roomOrCode === "string" ? this.#requireRoom(roomOrCode) : roomOrCode;
    return {
      code: room.code,
      phase: room.phase,
      hostPlayerId: room.hostPlayerId,
      config: room.config,
      players: room.players.map((player): PublicPlayer => ({
        id: player.id,
        name: player.name,
        color: player.color,
        ready: player.ready,
        connected: this.#connected.has(player.id),
        isHost: player.id === room.hostPlayerId,
        ...(player.side === undefined ? {} : { side: player.side }),
        ...(player.homeSlot === undefined ? {} : { homeSlot: player.homeSlot }),
      })),
      ...(room.matchId === undefined ? {} : { matchId: room.matchId }),
    };
  }

  #requireRoom(code: string): RoomRecord {
    const room = this.storage.loadRoom(code);
    if (room === undefined) throw new RoomError("ROOM_NOT_FOUND", "Room not found.");
    return room;
  }

  #requireSetupRoom(code: string): RoomRecord {
    const room = this.#requireRoom(code);
    if (room.phase !== "setup") throw new RoomError("ROOM_STARTED", "Room setup is frozen.");
    return room;
  }

  #authenticate(room: RoomRecord, token: string): PlayerRecord {
    const hash = hashParticipantToken(token);
    const player = room.players.find((candidate) => hashesMatch(candidate.tokenHash, hash));
    if (player === undefined)
      throw new RoomError("UNAUTHORIZED", "That rejoin token does not own a seat.");
    return player;
  }

  #assertHost(room: RoomRecord, player: PlayerRecord): void {
    if (player.id !== room.hostPlayerId)
      throw new RoomError("HOST_ONLY", "Only the host can do that.");
  }

  #assertUniqueIdentity(
    room: RoomRecord,
    name: string,
    color: PlayerColor,
    exceptId?: string,
  ): void {
    const otherPlayers = room.players.filter((player) => player.id !== exceptId);
    if (
      otherPlayers.some((player) => player.name.toLocaleLowerCase() === name.toLocaleLowerCase())
    ) {
      throw new RoomError("DUPLICATE_NAME", "Team names must be unique.");
    }
    if (otherPlayers.some((player) => player.color === color)) {
      throw new RoomError("DUPLICATE_COLOR", "Team colors must be unique.");
    }
  }

  async #createMatchState(room: RoomRecord): Promise<MatchState> {
    const arena = await loadArena(room.config.arenaName);
    const roster = DEFAULT_ROSTER_BY_LENGTH[room.config.gameLength];
    const teams: TeamState[] = room.players.map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      side: player.side!,
      homeSlot: player.homeSlot!,
      brain: "human",
      robots: roster.map((robotClass, index) => this.#createRobot(player.id, robotClass, index)),
      score: 0,
    }));
    return {
      config: {
        sportType: "survival",
        formation: room.config.formation,
        length: room.config.gameLength,
        arenaType: "rubble",
        arenaSizeName: arena.sizeName,
        turnLengthSeconds: room.config.turnLengthSeconds,
      },
      turnNumber: 1,
      teams,
      arena,
      lastKnownMarkers: new Map(),
    };
  }

  #createRobot(teamId: string, robotClass: RobotClass, index: number): RobotState {
    const definition = ROBOT_DEFINITIONS[robotClass];
    return {
      id: `${teamId}-r${index + 1}`,
      teamId,
      definition,
      position: "dock",
      hp: definition.armor,
      posture: "upright",
      scanHeading: "E",
      damageStaggerActionsRemaining: 0,
      ammo: Object.fromEntries(
        WEAPON_IDS.map((weaponId) => [weaponId, WEAPONS[weaponId].startingAmmo]),
      ) as Readonly<Record<WeaponId, number | "unlimited">>,
    };
  }

  async #withLock<T>(code: string, action: () => T | Promise<T>): Promise<T> {
    const previous = this.#locks.get(code) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.catch(() => undefined).then(() => gate);
    this.#locks.set(code, chain);
    await previous.catch(() => undefined);
    try {
      return await action();
    } finally {
      release();
      if (this.#locks.get(code) === chain) this.#locks.delete(code);
    }
  }
}
