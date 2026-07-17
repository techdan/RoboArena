/** Long-lived HTTP/WebSocket room service for Phase 8. */

import { createServer, type Server as HttpServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { ZodError } from "zod";
import {
  PROTOCOL_VERSION,
  parseClientMessageJson,
  type ClientMessage,
  type MatchSnapshotMessage,
  type ProtocolErrorMessage,
  type RoomSnapshotMessage,
  type ServerMessage,
} from "../src/lib/net/protocol.js";
import { RoomError, RoomService, hashParticipantToken, type RoomAccess } from "./rooms.js";
import { RoomStorage } from "./storage.js";
import { MatchLifecycleError } from "./matches.js";

interface ConnectionState {
  roomCode?: string;
  playerId?: string;
}

const errorMessage = (requestId: string, error: unknown): ProtocolErrorMessage => {
  if (error instanceof RoomError || error instanceof MatchLifecycleError) {
    return {
      version: PROTOCOL_VERSION,
      requestId,
      kind: "ProtocolError",
      code: error.code,
      message: error.message,
    };
  }
  if (
    error instanceof ZodError ||
    (error instanceof Error && error.message === "Message must be valid JSON.")
  ) {
    return {
      version: PROTOCOL_VERSION,
      requestId,
      kind: "ProtocolError",
      code: "INVALID_MESSAGE",
      message: "The message does not match room protocol version 1.",
    };
  }
  return {
    version: PROTOCOL_VERSION,
    requestId,
    kind: "ProtocolError",
    code: "INTERNAL_ERROR",
    message: "The room service could not complete that request.",
  };
};

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
  const sockets = new WebSocketServer({ server: http });
  const connections = new Map<WebSocket, ConnectionState>();

  const send = (socket: WebSocket, message: ServerMessage) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  const subscribe = (socket: WebSocket, access: RoomAccess) => {
    const state = connections.get(socket) ?? {};
    if (state.playerId !== undefined && state.playerId !== access.selfPlayerId) {
      service.markDisconnected(state.playerId);
    }
    if (state.playerId !== access.selfPlayerId) service.markConnected(access.selfPlayerId);
    state.roomCode = access.room.code;
    state.playerId = access.selfPlayerId;
    connections.set(socket, state);
  };

  const broadcast = (code: string) => {
    const room = service.publicRoom(code);
    for (const [socket, state] of connections) {
      if (state.roomCode !== code || state.playerId === undefined) continue;
      send(socket, {
        version: PROTOCOL_VERSION,
        requestId: "broadcast",
        kind: "RoomSnapshot",
        room,
        selfPlayerId: state.playerId,
      });
    }
  };

  const broadcastMatch = (code: string) => {
    for (const [socket, state] of connections) {
      if (state.roomCode !== code || state.playerId === undefined) continue;
      try {
        send(socket, service.getMatchSnapshotForPlayer(code, state.playerId, "broadcast"));
      } catch {
        // A setup-only subscriber does not have a match snapshot yet.
      }
    }
  };

  const dispatch = async (
    message: ClientMessage,
    issuedParticipantToken?: string,
  ): Promise<RoomAccess> => {
    switch (message.kind) {
      case "CreateRoom":
        return service.createRoom(message.name, message.color, issuedParticipantToken);
      case "JoinRoom":
        return service.joinRoom(message.code, message.name, message.color, issuedParticipantToken);
      case "ResumeRoom":
        return service.resumeRoom(message.code, message.token);
      case "UpdatePlayer":
        return service.updatePlayer(message.code, message.token, message.name, message.color);
      case "UpdateConfig":
        return service.updateConfig(message.code, message.token, message.config);
      case "SetReady":
        return service.setReady(message.code, message.token, message.ready);
      case "StartMatch":
        return service.startMatch(message.code, message.token);
      case "GetMatchState":
      case "SubmitOrders":
      case "LockOrders":
      case "TurnResultAcknowledged":
      case "SetPlaybackPosition":
        throw new Error("Match snapshots use the authenticated snapshot path.");
    }
  };

  sockets.on("connection", (socket) => {
    connections.set(socket, {});
    socket.on("message", (data) => {
      void (async () => {
        let requestId = "invalid";
        try {
          const raw = data.toString();
          try {
            const candidate = JSON.parse(raw) as { readonly requestId?: unknown };
            if (typeof candidate.requestId === "string")
              requestId = candidate.requestId.slice(0, 64);
          } catch {
            // The strict parser below produces the public validation response.
          }
          const message = parseClientMessageJson(raw);
          requestId = message.requestId;
          const token = "token" in message ? message.token : undefined;
          const fingerprint = hashParticipantToken(JSON.stringify(message));
          const principal =
            token === undefined
              ? `anonymous:${message.kind}:${fingerprint}`
              : `${hashParticipantToken(token)}:${fingerprint}`;
          const issuedParticipantToken =
            token === undefined && (message.kind === "CreateRoom" || message.kind === "JoinRoom")
              ? storage.participantTokenForRequest(fingerprint)
              : undefined;
          const cached = storage.getRequestResult(principal, requestId);
          if (cached !== undefined) {
            if (cached.kind === "RoomSnapshot") {
              const freshResponse: RoomSnapshotMessage = {
                ...cached,
                room: service.publicRoom(cached.room.code),
                ...(issuedParticipantToken === undefined
                  ? {}
                  : { participantToken: issuedParticipantToken }),
              };
              subscribe(socket, {
                room: freshResponse.room,
                selfPlayerId: freshResponse.selfPlayerId,
              });
              send(socket, freshResponse);
              broadcast(freshResponse.room.code);
              return;
            }
            if (cached.kind === "MatchSnapshot" && "token" in message) {
              const access = service.resumeRoom(cached.roomCode, message.token);
              subscribe(socket, access);
              send(
                socket,
                service.getMatchSnapshot(cached.roomCode, message.token, message.requestId),
              );
              return;
            }
            send(socket, cached);
            return;
          }
          if (message.kind === "GetMatchState") {
            const access = service.resumeRoom(message.code, message.token);
            subscribe(socket, access);
            const response = service.getMatchSnapshot(message.code, message.token, requestId);
            storage.saveRequestResult(principal, requestId, response);
            send(socket, response);
            return;
          }
          if (
            message.kind === "SubmitOrders" ||
            message.kind === "LockOrders" ||
            message.kind === "TurnResultAcknowledged" ||
            message.kind === "SetPlaybackPosition"
          ) {
            const access = service.resumeRoom(message.code, message.token);
            subscribe(socket, access);
            const response: MatchSnapshotMessage =
              message.kind === "SubmitOrders"
                ? await service.submitOrders(
                    message.code,
                    message.token,
                    message.matchId,
                    message.orders,
                    requestId,
                  )
                : message.kind === "LockOrders"
                  ? await service.lockOrders(
                      message.code,
                      message.token,
                      message.matchId,
                      message.orders,
                      requestId,
                    )
                  : message.kind === "TurnResultAcknowledged"
                    ? await service.acknowledgeTurnResult(
                        message.code,
                        message.token,
                        message.matchId,
                        message.turnNumber,
                        requestId,
                      )
                    : await service.updatePlaybackPosition(
                        message.code,
                        message.token,
                        message.matchId,
                        message.turnNumber,
                        message.tick,
                        requestId,
                      );
            if (message.kind !== "SetPlaybackPosition") {
              storage.saveRequestResult(principal, requestId, response);
            }
            send(socket, response);
            if (message.kind !== "SetPlaybackPosition") {
              broadcast(message.code);
              broadcastMatch(message.code);
            }
            return;
          }
          const access = await dispatch(message, issuedParticipantToken);
          subscribe(socket, access);
          const response: RoomSnapshotMessage = {
            version: PROTOCOL_VERSION,
            requestId,
            kind: "RoomSnapshot",
            room: service.publicRoom(access.room.code),
            selfPlayerId: access.selfPlayerId,
            ...(access.participantToken === undefined
              ? {}
              : { participantToken: access.participantToken }),
          };
          storage.saveRequestResult(principal, requestId, response);
          send(socket, response);
          broadcast(access.room.code);
        } catch (error) {
          send(socket, errorMessage(requestId, error));
        }
      })();
    });
    socket.on("close", () => {
      const state = connections.get(socket);
      if (state?.playerId !== undefined) service.markDisconnected(state.playerId);
      connections.delete(socket);
      if (state?.roomCode !== undefined) broadcast(state.roomCode);
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
