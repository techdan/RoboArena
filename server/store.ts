/** Storage contract shared by the local SQLite file and the Cloudflare Durable Object adapters. */

import type { ServerMessage } from "../src/lib/net/protocol.js";
import type { RoomRecord } from "./rooms.js";

export interface LockOrdersInput {
  readonly roomCode: string;
  readonly turnNumber: number;
  readonly playerId: string;
  readonly orders: unknown;
  readonly resolutionNonce: string;
}

/** Durable room state, idempotent request results, and locked orders. */
export interface RoomStore {
  loadRoom(code: string): RoomRecord | undefined;
  saveRoom(room: RoomRecord): void;
  getRequestResult(principal: string, requestId: string): ServerMessage | undefined;
  saveRequestResult(principal: string, requestId: string, response: ServerMessage): void;
  participantTokenForRequest(fingerprint: string): string;
  lockOrders(input: LockOrdersInput): boolean;
  loadLockedOrders(roomCode: string, turnNumber: number): readonly unknown[];
}

/** Table layout both adapters create; one Durable Object holds a single room's rows. */
export const ROOM_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS rooms (
    code TEXT PRIMARY KEY,
    data_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS request_results (
    principal TEXT NOT NULL,
    request_id TEXT NOT NULL,
    response_json TEXT NOT NULL,
    PRIMARY KEY (principal, request_id)
  );
  CREATE TABLE IF NOT EXISTS service_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS locked_orders (
    room_code TEXT NOT NULL,
    turn_number INTEGER NOT NULL,
    player_id TEXT NOT NULL,
    orders_json TEXT NOT NULL,
    resolution_nonce TEXT NOT NULL,
    PRIMARY KEY (room_code, turn_number, player_id),
    FOREIGN KEY (room_code) REFERENCES rooms(code) ON DELETE CASCADE
  );
`;

export const encodeStored = (value: unknown): string =>
  JSON.stringify(value, (_key, nested: unknown) =>
    nested instanceof Map ? { __roboArenaMap: [...nested.entries()] } : nested,
  );

export const decodeStored = <T>(value: string): T =>
  JSON.parse(value, (_key, nested: unknown) => {
    if (
      typeof nested === "object" &&
      nested !== null &&
      "__roboArenaMap" in nested &&
      Array.isArray((nested as { __roboArenaMap: unknown }).__roboArenaMap)
    ) {
      return new Map((nested as { __roboArenaMap: readonly [unknown, unknown][] }).__roboArenaMap);
    }
    return nested;
  }) as T;

/** A replayed create/join must never hand the bearer token back out of storage. */
export const withoutIssuedToken = (response: ServerMessage): ServerMessage =>
  response.kind === "RoomSnapshot" && response.participantToken !== undefined
    ? {
        version: response.version,
        requestId: response.requestId,
        kind: response.kind,
        room: response.room,
        selfPlayerId: response.selfPlayerId,
      }
    : response;
