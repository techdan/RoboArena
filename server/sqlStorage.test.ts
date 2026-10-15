/** Durable Object SQLite adapter run against node:sqlite through the same `exec` shape. */

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type ServerMessage } from "../src/lib/net/protocol";
import { DEFAULT_ROOM_CONFIG } from "../src/lib/setup/validate";
import { createRoomMessageHandler, type ConnectionState } from "./handler";
import { RoomService } from "./rooms";
import { SqlRoomStorage, type SqlExecutor } from "./sqlStorage";

/** Mirrors `ctx.storage.sql.exec`: multi-statement scripts, bindings, `rowsWritten`. */
const nodeSqlExecutor = (database: DatabaseSync): SqlExecutor => ({
  exec(query, ...bindings) {
    if (bindings.length === 0 && query.trim().replace(/;\s*$/, "").includes(";")) {
      database.exec(query);
      return { toArray: () => [], rowsWritten: 0 };
    }
    const statement = database.prepare(query);
    if (/^\s*SELECT/i.test(query)) {
      const rows = statement.all(...bindings) as Record<string, string | number | null>[];
      return { toArray: () => rows, rowsWritten: 0 };
    }
    const result = statement.run(...bindings);
    return { toArray: () => [], rowsWritten: Number(result.changes) };
  },
});

const requireToken = (token: string | undefined): string => {
  if (token === undefined) throw new Error("Expected a participant token.");
  return token;
};

describe("Durable Object room storage", () => {
  it("resolves a turn exactly once and survives a restart of the object", async () => {
    const database = new DatabaseSync(":memory:");
    const firstService = new RoomService(new SqlRoomStorage(nodeSqlExecutor(database)));
    const host = firstService.createRoom("Turn Host", "red", undefined, "ABC234");
    expect(host.room.code).toBe("ABC234");
    const guest = await firstService.joinRoom("ABC234", "Turn Guest", "blue");
    const hostToken = requireToken(host.participantToken);
    const guestToken = requireToken(guest.participantToken);
    await firstService.setReady("ABC234", hostToken, true);
    await firstService.setReady("ABC234", guestToken, true);
    const started = await firstService.startMatch("ABC234", hostToken);
    const matchId = started.room.matchId!;
    await firstService.lockOrders(
      "ABC234",
      hostToken,
      matchId,
      { turnNumber: 1, timelines: [] },
      "host-lock",
    );

    // A hibernated or evicted object rebuilds from the same SQLite rows.
    const storage = new SqlRoomStorage(nodeSqlExecutor(database));
    const secondService = new RoomService(storage);
    await expect(
      secondService.lockOrders(
        "ABC234",
        guestToken,
        matchId,
        { turnNumber: 1, timelines: [] },
        "guest-lock",
      ),
    ).resolves.toMatchObject({ status: "turn-ready", unseenTurns: [{ turnNumber: 1 }] });
    expect(storage.loadRoom("ABC234")?.match?.turns).toHaveLength(1);
    expect(() => secondService.createRoom("Again", "green", undefined, "ABC234")).toThrow(
      /already in use/,
    );
  });

  it("keeps the idempotency secret and locked-order uniqueness across restarts", () => {
    const database = new DatabaseSync(":memory:");
    const first = new SqlRoomStorage(nodeSqlExecutor(database));
    const second = new SqlRoomStorage(nodeSqlExecutor(database));
    expect(second.participantTokenForRequest("fingerprint")).toBe(
      first.participantTokenForRequest("fingerprint"),
    );
    first.saveRoom({
      code: "ABC234",
      hostPlayerId: "host",
      phase: "setup",
      config: DEFAULT_ROOM_CONFIG,
      players: [],
    });
    const lock = { roomCode: "ABC234", turnNumber: 1, playerId: "p", resolutionNonce: "n" };
    expect(first.lockOrders({ ...lock, orders: { timelines: [] } })).toBe(true);
    expect(second.lockOrders({ ...lock, orders: { timelines: ["again"] } })).toBe(false);
    expect(second.loadLockedOrders("ABC234", 1)).toEqual([{ timelines: [] }]);
  });

  it("binds a handler to one room code and replays a retried CreateRoom", async () => {
    const storage = new SqlRoomStorage(nodeSqlExecutor(new DatabaseSync(":memory:")));
    const service = new RoomService(storage);
    const sent: ServerMessage[] = [];
    const states = new Map<string, ConnectionState>();
    const handler = createRoomMessageHandler(
      service,
      storage,
      {
        send: (_socket: string, payload) => sent.push(JSON.parse(payload) as ServerMessage),
        state: (socket) => states.get(socket),
        setState: (socket, state) => states.set(socket, state),
        sockets: () => states.keys(),
      },
      { roomCode: "ZZZ234" },
    );
    const create = JSON.stringify({
      version: PROTOCOL_VERSION,
      requestId: "create-1",
      kind: "CreateRoom",
      name: "Host",
      color: "red",
    });
    await handler.handleMessage("a", create);
    await handler.handleMessage("b", create);
    const created = sent.filter((message) => message.requestId === "create-1");
    expect(created).toHaveLength(2);
    expect(created.every((message) => message.kind === "RoomSnapshot")).toBe(true);
    const [first, retry] = created as Extract<ServerMessage, { kind: "RoomSnapshot" }>[];
    expect(first!.room.code).toBe("ZZZ234");
    expect(retry!.room.code).toBe("ZZZ234");
    expect(retry!.participantToken).toBe(first!.participantToken);

    await handler.handleMessage(
      "c",
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: "join-elsewhere",
        kind: "JoinRoom",
        code: "QQQ234",
        name: "Guest",
        color: "blue",
      }),
    );
    expect(sent.find((message) => message.requestId === "join-elsewhere")).toMatchObject({
      kind: "ProtocolError",
      code: "ROOM_NOT_FOUND",
    });
  });
});
