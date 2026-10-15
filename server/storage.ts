/** SQLite WAL persistence for v1 rooms, idempotency, and locked orders. */

import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ServerMessage } from "../src/lib/net/protocol.js";
import type { RoomRecord } from "./rooms.js";
import {
  ROOM_SCHEMA_SQL,
  decodeStored as decode,
  encodeStored as encode,
  withoutIssuedToken,
  type LockOrdersInput,
  type RoomStore,
} from "./store.js";

export class RoomStorage implements RoomStore {
  readonly #database: DatabaseSync;
  readonly #idempotencySecret: string;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#database = new DatabaseSync(path);
    this.#database.exec(
      "PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;",
    );
    this.#database.exec(`${ROOM_SCHEMA_SQL} PRAGMA user_version = 1;`);
    const secretRow = this.#database
      .prepare("SELECT value FROM service_metadata WHERE key = 'idempotency_secret'")
      .get() as { readonly value: string } | undefined;
    this.#idempotencySecret = secretRow?.value ?? randomBytes(32).toString("hex");
    if (secretRow === undefined) {
      this.#database
        .prepare("INSERT INTO service_metadata (key, value) VALUES ('idempotency_secret', ?)")
        .run(this.#idempotencySecret);
    }
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
    const storedResponse = withoutIssuedToken(response);
    this.#database
      .prepare(
        "INSERT OR IGNORE INTO request_results (principal, request_id, response_json) VALUES (?, ?, ?)",
      )
      .run(principal, requestId, encode(storedResponse));
  }

  participantTokenForRequest(fingerprint: string): string {
    return createHmac("sha256", Buffer.from(this.#idempotencySecret, "hex"))
      .update(fingerprint)
      .digest("base64url");
  }

  lockOrders(input: LockOrdersInput): boolean {
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
