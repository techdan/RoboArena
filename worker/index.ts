/** Cloudflare room service: one SQLite-backed Durable Object per room, hibernatable WebSockets. */

import { DurableObject } from "cloudflare:workers";
import { PROTOCOL_VERSION } from "../src/lib/net/protocol.js";
import {
  MAX_CLIENT_MESSAGE_BYTES,
  createRoomMessageHandler,
  type ConnectionState,
  type RoomMessageHandler,
} from "../server/handler.js";
import { RoomService } from "../server/rooms.js";
import { SqlRoomStorage } from "../server/sqlStorage.js";
import { parseRoomRoute, roomCodeForRequest } from "./routing.js";

export interface Env {
  readonly ROOMS: DurableObjectNamespace<RoomObject>;
}

const ROOM_HEADER = "x-roboarena-room";

export class RoomObject extends DurableObject<Env> {
  readonly #storage: SqlRoomStorage;
  readonly #service: RoomService;
  #handler: RoomMessageHandler<WebSocket> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#storage = new SqlRoomStorage(ctx.storage.sql);
    this.#service = new RoomService(this.#storage);
    // Waking from hibernation loses in-memory presence; rebuild it from the
    // sockets Cloudflare kept open for us.
    for (const socket of ctx.getWebSockets()) {
      const state = socket.deserializeAttachment() as ConnectionState | null;
      if (state?.playerId !== undefined) this.#service.markConnected(state.playerId);
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const code = request.headers.get(ROOM_HEADER);
    if (code === null) return new Response("Missing room.", { status: 400 });
    this.#rememberCode(code);
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ messageTimes: [] } satisfies ConnectionState);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string" || message.length > MAX_CLIENT_MESSAGE_BYTES) {
      socket.close(1009, "Message too large or not text.");
      return;
    }
    await this.#roomHandler().handleMessage(socket, message);
  }

  override async webSocketClose(socket: WebSocket) {
    this.#roomHandler().handleClose(socket);
  }

  override async webSocketError(socket: WebSocket) {
    this.#roomHandler().handleClose(socket);
  }

  #rememberCode(code: string): void {
    const stored = this.#storedCode();
    if (stored === undefined) {
      this.ctx.storage.sql.exec(
        "INSERT INTO service_metadata (key, value) VALUES ('room_code', ?)",
        code,
      );
    }
  }

  #storedCode(): string | undefined {
    const row = this.ctx.storage.sql
      .exec("SELECT value FROM service_metadata WHERE key = 'room_code'")
      .toArray()[0];
    return row === undefined ? undefined : String(row["value"]);
  }

  #roomHandler(): RoomMessageHandler<WebSocket> {
    if (this.#handler !== undefined) return this.#handler;
    const roomCode = this.#storedCode();
    this.#handler = createRoomMessageHandler<WebSocket>(
      this.#service,
      this.#storage,
      {
        send: (socket, payload) => {
          try {
            socket.send(payload);
          } catch {
            // The socket closed between broadcast selection and send.
          }
        },
        state: (socket) => (socket.deserializeAttachment() as ConnectionState | null) ?? undefined,
        setState: (socket, state) => socket.serializeAttachment(state),
        sockets: () => this.ctx.getWebSockets(),
      },
      roomCode === undefined ? {} : { roomCode },
    );
    return this.#handler;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, protocolVersion: PROTOCOL_VERSION });
    }
    const route = parseRoomRoute(url.pathname);
    if (route === undefined) return new Response("Not found.", { status: 404 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade.", { status: 426 });
    }
    const code = route.kind === "room" ? route.code : await roomCodeForRequest(route.requestId);
    const headers = new Headers(request.headers);
    headers.set(ROOM_HEADER, code);
    const room = env.ROOMS.get(env.ROOMS.idFromName(code));
    return room.fetch(new Request(request, { headers }));
  },
} satisfies ExportedHandler<Env>;
