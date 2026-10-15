/** Transport-independent room protocol handling shared by the Node and Cloudflare servers. */

import { randomBytes } from "node:crypto";
import { ZodError } from "zod";
import {
  PROTOCOL_VERSION,
  parseClientMessageJson,
  parseServerMessage,
  type ClientMessage,
  type MatchSnapshotMessage,
  type ProtocolErrorMessage,
  type RoomSnapshotMessage,
  type ServerMessage,
} from "../src/lib/net/protocol.js";
import { MatchLifecycleError } from "./matches.js";
import { RoomError, RoomService, hashParticipantToken, type RoomAccess } from "./rooms.js";
import type { RoomStore } from "./store.js";

export interface ConnectionState {
  roomCode?: string;
  playerId?: string;
  messageTimes: number[];
}

/** How the handler reaches the sockets of one server; state must survive between messages. */
export interface RoomTransport<S> {
  /** Deliver one serialized message if the socket is still open. */
  send(socket: S, payload: string): void;
  state(socket: S): ConnectionState | undefined;
  setState(socket: S, state: ConnectionState): void;
  sockets(): Iterable<S>;
}

export interface RoomHandlerOptions {
  /**
   * Set when this handler owns exactly one room (a Durable Object): messages for
   * any other code are rejected and CreateRoom takes this code.
   */
  readonly roomCode?: string;
}

export const MAX_CLIENT_MESSAGE_BYTES = 256 * 1024;
export const MESSAGE_RATE_WINDOW_MS = 10_000;
export const MESSAGE_RATE_LIMIT = 60;

export const errorMessage = (requestId: string, error: unknown): ProtocolErrorMessage => {
  if (
    (error instanceof RoomError || error instanceof MatchLifecycleError) &&
    error.code !== "INTERNAL_ERROR"
  ) {
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
  const supportId = randomBytes(4).toString("hex").toUpperCase();
  console.error(`[${supportId}] Room request ${requestId} failed:`, error);
  return {
    version: PROTOCOL_VERSION,
    requestId,
    kind: "ProtocolError",
    code: "INTERNAL_ERROR",
    message: `The room service could not complete that request. Support id: ${supportId}.`,
    supportId,
  };
};

export interface RoomMessageHandler<S> {
  handleMessage(socket: S, raw: string): Promise<void>;
  handleClose(socket: S): void;
}

export function createRoomMessageHandler<S>(
  service: RoomService,
  storage: RoomStore,
  transport: RoomTransport<S>,
  options: RoomHandlerOptions = {},
): RoomMessageHandler<S> {
  const send = (socket: S, message: ServerMessage) => {
    transport.send(socket, JSON.stringify(parseServerMessage(message)));
  };

  const subscribe = (socket: S, access: RoomAccess) => {
    const state = transport.state(socket) ?? { messageTimes: [] };
    if (state.playerId !== undefined && state.playerId !== access.selfPlayerId) {
      service.markDisconnected(state.playerId);
    }
    if (state.playerId !== access.selfPlayerId) service.markConnected(access.selfPlayerId);
    state.roomCode = access.room.code;
    state.playerId = access.selfPlayerId;
    transport.setState(socket, state);
  };

  const broadcast = (code: string) => {
    const room = service.publicRoom(code);
    for (const socket of transport.sockets()) {
      const state = transport.state(socket);
      if (state === undefined) continue;
      if (state.roomCode !== code || state.playerId === undefined) continue;
      const matchStatus = service.participantRoomStatus(code, state.playerId);
      send(socket, {
        version: PROTOCOL_VERSION,
        requestId: "broadcast",
        kind: "RoomSnapshot",
        room,
        selfPlayerId: state.playerId,
        ...(matchStatus === undefined ? {} : { matchStatus }),
      });
    }
  };

  const broadcastMatch = (code: string) => {
    for (const socket of transport.sockets()) {
      const state = transport.state(socket);
      if (state === undefined) continue;
      if (state.roomCode !== code || state.playerId === undefined) continue;
      try {
        send(socket, service.getMatchSnapshotForPlayer(code, state.playerId, "broadcast"));
      } catch (error) {
        // A setup-only subscriber does not have a match snapshot yet. Anything
        // else would silently starve this participant of updates — log it.
        if (!(error instanceof RoomError && error.code === "MATCH_NOT_FOUND")) {
          console.error(`Match broadcast to ${state.playerId} in ${code} failed:`, error);
        }
      }
    }
  };

  const dispatch = async (
    message: ClientMessage,
    issuedParticipantToken?: string,
  ): Promise<RoomAccess> => {
    switch (message.kind) {
      case "CreateRoom":
        return service.createRoom(
          message.name,
          message.color,
          issuedParticipantToken,
          options.roomCode,
        );
      case "JoinRoom":
        return service.joinRoom(message.code, message.name, message.color, issuedParticipantToken);
      case "ResumeRoom":
        return service.resumeRoom(message.code, message.token);
      case "UpdatePlayer":
        return service.updatePlayer(message.code, message.token, message.name, message.color);
      case "UpdateConfig":
        return service.updateConfig(message.code, message.token, message.config);
      case "SetHomeSlot":
        return service.setHomeSlot(message.code, message.token, message.homeSlot);
      case "SetReady":
        return service.setReady(message.code, message.token, message.ready);
      case "StartMatch":
        return service.startMatch(message.code, message.token);
      case "GetMatchState":
      case "SubmitOrders":
      case "LockOrders":
      case "ResignMatch":
      case "TurnResultAcknowledged":
      case "SetPlaybackPosition":
        throw new Error("Match snapshots use the authenticated snapshot path.");
    }
  };

  const handleMessage = async (socket: S, raw: string): Promise<void> => {
    let requestId = "invalid";
    try {
      try {
        const candidate = JSON.parse(raw) as { readonly requestId?: unknown };
        if (typeof candidate.requestId === "string") requestId = candidate.requestId.slice(0, 64);
      } catch {
        // The strict parser below produces the public validation response.
      }
      const connection = transport.state(socket) ?? { messageTimes: [] };
      const now = Date.now();
      connection.messageTimes = connection.messageTimes.filter(
        (receivedAt) => now - receivedAt < MESSAGE_RATE_WINDOW_MS,
      );
      if (connection.messageTimes.length >= MESSAGE_RATE_LIMIT) {
        send(socket, {
          version: PROTOCOL_VERSION,
          requestId,
          kind: "ProtocolError",
          code: "RATE_LIMITED",
          message: "Too many room-service messages. Wait a moment and try again.",
        });
        return;
      }
      connection.messageTimes.push(now);
      transport.setState(socket, connection);
      const message = parseClientMessageJson(raw);
      requestId = message.requestId;
      if (
        options.roomCode !== undefined &&
        "code" in message &&
        message.code !== options.roomCode
      ) {
        throw new RoomError("ROOM_NOT_FOUND", "Room not found.");
      }
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
          const matchStatus = service.participantRoomStatus(cached.room.code, cached.selfPlayerId);
          const freshResponse: RoomSnapshotMessage = {
            ...cached,
            room: service.publicRoom(cached.room.code),
            ...(matchStatus === undefined ? {} : { matchStatus }),
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
          send(socket, service.getMatchSnapshot(cached.roomCode, message.token, message.requestId));
          return;
        }
        send(socket, cached);
        return;
      }
      if (message.kind === "GetMatchState") {
        const access = service.resumeRoom(message.code, message.token);
        subscribe(socket, access);
        const response = service.getMatchSnapshot(message.code, message.token, requestId);
        // Reads have no mutation to deduplicate. Persisting every poll
        // duplicates the complete snapshot indefinitely in request_results.
        send(socket, response);
        return;
      }
      if (
        message.kind === "SubmitOrders" ||
        message.kind === "LockOrders" ||
        message.kind === "ResignMatch" ||
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
              : message.kind === "ResignMatch"
                ? await service.resignMatch(message.code, message.token, message.matchId, requestId)
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
      const matchStatus = service.participantRoomStatus(access.room.code, access.selfPlayerId);
      const response: RoomSnapshotMessage = {
        version: PROTOCOL_VERSION,
        requestId,
        kind: "RoomSnapshot",
        room: service.publicRoom(access.room.code),
        selfPlayerId: access.selfPlayerId,
        ...(matchStatus === undefined ? {} : { matchStatus }),
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
  };

  const handleClose = (socket: S): void => {
    const state = transport.state(socket);
    if (state?.playerId !== undefined) service.markDisconnected(state.playerId);
    if (state?.roomCode !== undefined) broadcast(state.roomCode);
  };

  return { handleMessage, handleClose };
}
