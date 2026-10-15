/** Room storage on a Cloudflare Durable Object's built-in SQLite (`ctx.storage.sql`). */

import { createHmac, randomBytes } from "node:crypto";
import type { ServerMessage } from "../src/lib/net/protocol.js";
import type { RoomRecord } from "./rooms.js";
import {
  ROOM_SCHEMA_SQL,
  decodeStored,
  encodeStored,
  withoutIssuedToken,
  type LockOrdersInput,
  type RoomStore,
} from "./store.js";

type SqlValue = string | number | null;

/** The subset of the Durable Object `SqlStorage` API this adapter uses. */
export interface SqlExecutor {
  exec(
    query: string,
    ...bindings: SqlValue[]
  ): {
    toArray(): Record<string, SqlValue>[];
    readonly rowsWritten: number;
  };
}

export class SqlRoomStorage implements RoomStore {
  readonly #sql: SqlExecutor;
  readonly #idempotencySecret: string;

  constructor(sql: SqlExecutor) {
    this.#sql = sql;
    this.#sql.exec(ROOM_SCHEMA_SQL);
    const secretRow = this.#sql
      .exec("SELECT value FROM service_metadata WHERE key = 'idempotency_secret'")
      .toArray()[0];
    if (secretRow === undefined) {
      this.#idempotencySecret = randomBytes(32).toString("hex");
      this.#sql.exec(
        "INSERT INTO service_metadata (key, value) VALUES ('idempotency_secret', ?)",
        this.#idempotencySecret,
      );
    } else {
      this.#idempotencySecret = String(secretRow["value"]);
    }
  }

  loadRoom(code: string): RoomRecord | undefined {
    const row = this.#sql.exec("SELECT data_json FROM rooms WHERE code = ?", code).toArray()[0];
    return row === undefined ? undefined : decodeStored<RoomRecord>(String(row["data_json"]));
  }

  saveRoom(room: RoomRecord): void {
    this.#sql.exec(
      `INSERT INTO rooms (code, data_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`,
      room.code,
      encodeStored(room),
      new Date().toISOString(),
    );
  }

  getRequestResult(principal: string, requestId: string): ServerMessage | undefined {
    const row = this.#sql
      .exec(
        "SELECT response_json FROM request_results WHERE principal = ? AND request_id = ?",
        principal,
        requestId,
      )
      .toArray()[0];
    return row === undefined
      ? undefined
      : decodeStored<ServerMessage>(String(row["response_json"]));
  }

  saveRequestResult(principal: string, requestId: string, response: ServerMessage): void {
    this.#sql.exec(
      "INSERT OR IGNORE INTO request_results (principal, request_id, response_json) VALUES (?, ?, ?)",
      principal,
      requestId,
      encodeStored(withoutIssuedToken(response)),
    );
  }

  participantTokenForRequest(fingerprint: string): string {
    return createHmac("sha256", Buffer.from(this.#idempotencySecret, "hex"))
      .update(fingerprint)
      .digest("base64url");
  }

  lockOrders(input: LockOrdersInput): boolean {
    const result = this.#sql.exec(
      `INSERT OR IGNORE INTO locked_orders
       (room_code, turn_number, player_id, orders_json, resolution_nonce) VALUES (?, ?, ?, ?, ?)`,
      input.roomCode,
      input.turnNumber,
      input.playerId,
      encodeStored(input.orders),
      input.resolutionNonce,
    );
    return result.rowsWritten > 0;
  }

  loadLockedOrders(roomCode: string, turnNumber: number): readonly unknown[] {
    return this.#sql
      .exec(
        "SELECT orders_json FROM locked_orders WHERE room_code = ? AND turn_number = ? ORDER BY player_id",
        roomCode,
        turnNumber,
      )
      .toArray()
      .map((row) => decodeStored<unknown>(String(row["orders_json"])));
  }
}
