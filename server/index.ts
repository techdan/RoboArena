/** Long-lived HTTP/WebSocket room service for Phase 8. */

import { createServer, type Server as HttpServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { PROTOCOL_VERSION } from "../src/lib/net/protocol.js";
import {
  MAX_CLIENT_MESSAGE_BYTES,
  createRoomMessageHandler,
  type ConnectionState,
} from "./handler.js";
import { RoomService } from "./rooms.js";
import { RoomStorage } from "./storage.js";

export {
  MAX_CLIENT_MESSAGE_BYTES,
  MESSAGE_RATE_LIMIT,
  MESSAGE_RATE_WINDOW_MS,
  errorMessage,
} from "./handler.js";

export interface RoomServer {
  readonly service: RoomService;
  readonly storage: RoomStorage;
  listen(port?: number, host?: string): Promise<{ readonly port: number }>;
  close(): Promise<void>;
}

export function createRoomServer(databasePath = resolve("data/roboarena.sqlite")): RoomServer {
  const storage = new RoomStorage(databasePath);
  const service = new RoomService(storage);
  const http: HttpServer = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, protocolVersion: PROTOCOL_VERSION }));
      return;
    }
    response.writeHead(404).end();
  });
  const sockets = new WebSocketServer({ server: http, maxPayload: MAX_CLIENT_MESSAGE_BYTES });
  const connections = new Map<WebSocket, ConnectionState>();
  const handler = createRoomMessageHandler(service, storage, {
    send: (socket: WebSocket, payload) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    },
    state: (socket) => connections.get(socket),
    setState: (socket, state) => connections.set(socket, state),
    sockets: () => connections.keys(),
  });

  sockets.on("connection", (socket) => {
    connections.set(socket, { messageTimes: [] });
    socket.on("error", () => {
      // Protocol/size failures close the socket; the close handler performs cleanup.
    });
    socket.on("message", (data) => {
      void handler.handleMessage(socket, data.toString());
    });
    socket.on("close", () => {
      handler.handleClose(socket);
      connections.delete(socket);
    });
  });

  return {
    service,
    storage,
    listen: (port = 3001, host = "0.0.0.0") =>
      new Promise((resolveListen, reject) => {
        http.once("error", reject);
        http.listen(port, host, () => {
          http.off("error", reject);
          const address = http.address();
          if (address === null || typeof address === "string")
            reject(new Error("Room server has no TCP address."));
          else resolveListen({ port: address.port });
        });
      }),
    close: () =>
      new Promise((resolveClose, reject) => {
        for (const socket of connections.keys()) socket.terminate();
        sockets.close(() => {
          http.close((error) => {
            storage.close();
            if (error !== undefined) reject(error);
            else resolveClose();
          });
        });
      }),
  };
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  const port = Number(process.env.PORT ?? 3001);
  const databasePath = process.env.ROOM_DATABASE_PATH ?? resolve("data/roboarena.sqlite");
  const server = createRoomServer(databasePath);
  void server.listen(port).then(({ port: listeningPort }) => {
    console.log(`RoboArena room service listening on ws://localhost:${listeningPort}`);
  });
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void server.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
