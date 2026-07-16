/** SQLite WAL persistence for v1 rooms, idempotency, and locked orders. */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ServerMessage } from "../src/lib/net/protocol.js";
import type { RoomRecord } from "./rooms.js";

const encode = (value: unknown): string =>
  JSON.stringify(value, (_key, nested: unknown) =>
    nested instanceof Map ? { __roboArenaMap: [...nested.entries()] } : nested,
  );

const decode = <T>(value: string): T =>
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

export class RoomStorage {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#database = new DatabaseSync(path);
    this.#database.exec(
      "PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;",
    );
    this.#database.exec(`
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
      CREATE TABLE IF NOT EXISTS locked_orders (
        room_code TEXT NOT NULL,
        turn_number INTEGER NOT NULL,
        player_id TEXT NOT NULL,
        orders_json TEXT NOT NULL,
        resolution_nonce TEXT NOT NULL,
        PRIMARY KEY (room_code, turn_number, player_id),
        FOREIGN KEY (room_code) REFERENCES rooms(code) ON DELETE CASCADE
      );
      PRAGMA user_version = 1;
    `);
  }

  loadRoom(code: string): RoomRecord | undefined {
    const row = this.#database.prepare("SELECT data_json FROM rooms WHERE code = ?").get(code) as
      { readonly data_json: string } | undefined;
    return row === undefined ? undefined : decode<RoomRecord>(row.data_json);
  }

  saveRoom(room: RoomRecord): void {
    this.#transaction(() => {
      this.#database
        .prepare(
          `INSERT INTO rooms (code, data_json, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(code) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`,
        )
        .run(room.code, encode(room), new Date().toISOString());
    });
  }

  getRequestResult(principal: string, requestId: string): ServerMessage | undefined {
    const row = this.#database
      .prepare("SELECT response_json FROM request_results WHERE principal = ? AND request_id = ?")
      .get(principal, requestId) as { readonly response_json: string } | undefined;
    return row === undefined ? undefined : decode<ServerMessage>(row.response_json);
  }

  saveRequestResult(principal: string, requestId: string, response: ServerMessage): void {
    this.#database
      .prepare(
        "INSERT OR IGNORE INTO request_results (principal, request_id, response_json) VALUES (?, ?, ?)",
      )
      .run(principal, requestId, encode(response));
  }

  lockOrders(input: {
    readonly roomCode: string;
    readonly turnNumber: number;
    readonly playerId: string;
    readonly orders: unknown;
    readonly resolutionNonce: string;
  }): boolean {
    const result = this.#database
      .prepare(
        `INSERT OR IGNORE INTO locked_orders
         (room_code, turn_number, player_id, orders_json, resolution_nonce) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.roomCode,
        input.turnNumber,
        input.playerId,
        encode(input.orders),
        input.resolutionNonce,
      );
    return result.changes === 1;
  }

  loadLockedOrders(roomCode: string, turnNumber: number): readonly unknown[] {
    const rows = this.#database
      .prepare(
        "SELECT orders_json FROM locked_orders WHERE room_code = ? AND turn_number = ? ORDER BY player_id",
      )
      .all(roomCode, turnNumber) as unknown as readonly { readonly orders_json: string }[];
    return rows.map((row) => decode<unknown>(row.orders_json));
  }

  close(): void {
    this.#database.close();
  }

  #transaction(action: () => void): void {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      action();
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }
}
