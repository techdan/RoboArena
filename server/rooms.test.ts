/** Phase 8 authoritative room and durable-storage integration tests. */

import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type MatchSnapshotMessage,
  type RoomSnapshotMessage,
  type ServerMessage,
} from "../src/lib/net/protocol";
import { configForLength, type PlayerColor } from "../src/lib/setup/validate";
import { createRoomServer } from "./index";
import { RoomError, RoomService } from "./rooms";
import { RoomStorage } from "./storage";

const requireToken = (token: string | undefined): string => {
  if (token === undefined)
    throw new Error("Expected the room service to issue a participant token.");
  return token;
};

describe("authoritative rooms", () => {
  it("assigns four unique Sides/Home slots and rejects a fifth player", async () => {
    const storage = new RoomStorage(":memory:");
    const service = new RoomService(storage);
    const host = service.createRoom("Red One", "red");
    const players = [
      host,
      await service.joinRoom(host.room.code, "Blue Two", "blue"),
      await service.joinRoom(host.room.code, "Green Three", "green"),
      await service.joinRoom(host.room.code, "Yellow Four", "yellow"),
    ];
    await expect(service.joinRoom(host.room.code, "Fifth", "red")).rejects.toMatchObject({
      code: "ROOM_FULL",
    });
    for (const player of players)
      await service.setReady(host.room.code, requireToken(player.participantToken), true);
    const started = await service.startMatch(host.room.code, requireToken(host.participantToken));
    expect(started.room.players.map((player) => player.side)).toEqual([1, 2, 3, 4]);
    expect(started.room.players.map((player) => player.homeSlot)).toEqual([0, 1, 2, 3]);
    expect(new Set(started.room.players.map((player) => player.color)).size).toBe(4);
    expect(
      service.getMatchState(host.room.code, requireToken(host.participantToken)).teams,
    ).toHaveLength(4);
    storage.close();
  });

  it("enforces host authority, unique identity, readiness, and token ownership", async () => {
    const storage = new RoomStorage(":memory:");
    const service = new RoomService(storage);
    const host = service.createRoom("Host", "red");
    const guest = await service.joinRoom(host.room.code, "Guest", "blue");
    await expect(service.joinRoom(host.room.code, "Guest", "green")).rejects.toMatchObject({
      code: "DUPLICATE_NAME",
    });
    await expect(service.joinRoom(host.room.code, "Third", "blue")).rejects.toMatchObject({
      code: "DUPLICATE_COLOR",
    });
    await expect(
      service.updateConfig(
        host.room.code,
        requireToken(guest.participantToken),
        configForLength("battle"),
      ),
    ).rejects.toMatchObject({ code: "HOST_ONLY" });
    await expect(
      service.startMatch(host.room.code, requireToken(host.participantToken)),
    ).rejects.toMatchObject({ code: "NOT_READY" });
    await expect(
      service.startMatch(host.room.code, requireToken(guest.participantToken)),
    ).rejects.toMatchObject({ code: "HOST_ONLY" });
    expect(() => service.resumeRoom(host.room.code, "x".repeat(43))).toThrow(RoomError);
    expect(
      service.resumeRoom(host.room.code, requireToken(guest.participantToken)).selfPlayerId,
    ).toBe(guest.selfPlayerId);
    storage.close();
  });

  it("recovers seats, config, locked orders, and idempotency after restart", async () => {
    const path = resolve(`test-results/phase8-restart-${crypto.randomUUID()}.sqlite`);
    const firstStorage = new RoomStorage(path);
    const firstService = new RoomService(firstStorage);
    const host = firstService.createRoom("Durable Host", "red");
    const guest = await firstService.joinRoom(host.room.code, "Durable Guest", "blue");
    await firstService.updateConfig(
      host.room.code,
      requireToken(host.participantToken),
      configForLength("battle"),
    );
    expect(
      firstStorage.lockOrders({
        roomCode: host.room.code,
        turnNumber: 1,
        playerId: guest.selfPlayerId,
        orders: { timelines: [] },
        resolutionNonce: "nonce-1",
      }),
    ).toBe(true);
    firstStorage.close();

    const secondStorage = new RoomStorage(path);
    const secondService = new RoomService(secondStorage);
    const resumed = secondService.resumeRoom(host.room.code, requireToken(guest.participantToken));
    expect(resumed.selfPlayerId).toBe(guest.selfPlayerId);
    expect(resumed.room.config).toEqual(configForLength("battle"));
    expect(secondStorage.loadLockedOrders(host.room.code, 1)).toEqual([{ timelines: [] }]);
    expect(
      secondStorage.lockOrders({
        roomCode: host.room.code,
        turnNumber: 1,
        playerId: guest.selfPlayerId,
        orders: { timelines: ["duplicate"] },
        resolutionNonce: "nonce-2",
      }),
    ).toBe(false);
    secondStorage.close();
  });

  it("recovers a partial lock, resolves once, and preserves independent acknowledgement", async () => {
    const path = resolve(`test-results/phase11-turn-restart-${crypto.randomUUID()}.sqlite`);
    const firstStorage = new RoomStorage(path);
    const firstService = new RoomService(firstStorage);
    const host = firstService.createRoom("Turn Host", "red");
    const guest = await firstService.joinRoom(host.room.code, "Turn Guest", "blue");
    const hostToken = requireToken(host.participantToken);
    const guestToken = requireToken(guest.participantToken);
    await firstService.setReady(host.room.code, hostToken, true);
    await firstService.setReady(host.room.code, guestToken, true);
    const started = await firstService.startMatch(host.room.code, hostToken);
    const matchId = started.room.matchId!;
    await firstService.lockOrders(
      host.room.code,
      hostToken,
      matchId,
      { turnNumber: 1, timelines: [] },
      "host-lock",
    );
    firstStorage.close();

    const secondStorage = new RoomStorage(path);
    const secondService = new RoomService(secondStorage);
    const resolved = await secondService.lockOrders(
      host.room.code,
      guestToken,
      matchId,
      { turnNumber: 1, timelines: [] },
      "guest-lock",
    );
    expect(resolved).toMatchObject({ status: "turn-ready", unseenTurns: [{ turnNumber: 1 }] });
    await expect(
      secondService.lockOrders(
        host.room.code,
        guestToken,
        matchId,
        { turnNumber: 1, timelines: [] },
        "guest-lock-retry-after-commit",
      ),
    ).resolves.toMatchObject({ status: "turn-ready" });
    await secondService.updatePlaybackPosition(
      host.room.code,
      hostToken,
      matchId,
      1,
      120,
      "movie-position",
    );
    expect(secondStorage.loadRoom(host.room.code)?.match?.turns).toHaveLength(1);
    secondStorage.close();

    const thirdStorage = new RoomStorage(path);
    const thirdService = new RoomService(thirdStorage);
    expect(thirdService.getMatchSnapshot(host.room.code, hostToken, "resume").unseenTurns).toEqual([
      expect.objectContaining({ turnNumber: 1, playbackTick: 120 }),
    ]);
    const acknowledged = await thirdService.acknowledgeTurnResult(
      host.room.code,
      hostToken,
      matchId,
      1,
      "ack",
    );
    expect(acknowledged.status).toBe("planning");
    expect(thirdService.getMatchSnapshot(host.room.code, guestToken, "guest").status).toBe(
      "turn-ready",
    );
    expect(thirdStorage.loadRoom(host.room.code)?.match?.turns).toHaveLength(1);
    thirdStorage.close();
  });

  it("never stores a participant token in the idempotency response cache", () => {
    const storage = new RoomStorage(":memory:");
    const response: RoomSnapshotMessage = {
      version: PROTOCOL_VERSION,
      requestId: "request-1",
      kind: "RoomSnapshot",
      room: {
        code: "ABC234",
        phase: "setup",
        hostPlayerId: "host",
        config: configForLength("melee"),
        players: [],
      },
      selfPlayerId: "host",
      participantToken: "sensitive-participant-token".padEnd(32, "x"),
    };
    storage.saveRequestResult("principal", response.requestId, response);
    expect(storage.getRequestResult("principal", response.requestId)).not.toHaveProperty(
      "participantToken",
    );
    storage.close();
  });
});

describe("WebSocket room integration", () => {
  it("keeps four connected clients on one public snapshot", async () => {
    const server = createRoomServer(":memory:");
    const { port } = await server.listen(0, "127.0.0.1");
    const sockets = await Promise.all(
      Array.from({ length: 4 }, () => openSocket(`ws://127.0.0.1:${port}`)),
    );
    try {
      const createMessage = {
        version: PROTOCOL_VERSION,
        requestId: "create",
        kind: "CreateRoom",
        name: "Alpha",
        color: "red",
      } as const;
      const host = await sendRequest(sockets[0]!, createMessage);
      const retriedHost = await sendRequest(sockets[0]!, createMessage);
      expect(retriedHost.room.code).toBe(host.room.code);
      expect(retriedHost.participantToken).toBe(host.participantToken);
      const colors: readonly PlayerColor[] = ["blue", "green", "yellow"];
      const joined = await Promise.all(
        sockets.slice(1).map((socket, index) =>
          sendRequest(socket, {
            version: PROTOCOL_VERSION,
            requestId: `join-${index}`,
            kind: "JoinRoom",
            code: host.room.code,
            name: `Team ${index + 2}`,
            color: colors[index]!,
          }),
        ),
      );
      const freshRetry = await sendRequest(sockets[0]!, createMessage);
      expect(freshRetry.room.players).toHaveLength(4);
      expect(freshRetry.participantToken).toBe(host.participantToken);
      const accesses = [host, ...joined];
      const resumed = await Promise.all(
        accesses.map((access, index) =>
          sendRequest(sockets[index]!, {
            version: PROTOCOL_VERSION,
            requestId: `resume-${index}`,
            kind: "ResumeRoom",
            code: host.room.code,
            token: requireToken(access.participantToken),
          }),
        ),
      );
      expect(
        resumed.every((access) => JSON.stringify(access.room) === JSON.stringify(resumed[0]!.room)),
      ).toBe(true);
      expect(resumed[0]!.room.players).toHaveLength(4);
      await Promise.all(
        accesses.map((access, index) =>
          sendRequest(sockets[index]!, {
            version: PROTOCOL_VERSION,
            requestId: `ready-${index}`,
            kind: "SetReady",
            code: host.room.code,
            token: requireToken(access.participantToken),
            ready: true,
          }),
        ),
      );
      const started = await sendRequest(sockets[0]!, {
        version: PROTOCOL_VERSION,
        requestId: "start",
        kind: "StartMatch",
        code: host.room.code,
        token: requireToken(host.participantToken),
      });
      const snapshot = await sendMatchRequest(sockets[0]!, {
        version: PROTOCOL_VERSION,
        requestId: "planner-state",
        kind: "GetMatchState",
        code: host.room.code,
        token: requireToken(host.participantToken),
      });
      expect(snapshot.matchId).toBe(started.room.matchId);
      expect(snapshot.match.teams).toHaveLength(4);
      expect(snapshot.match.lastKnownMarkers).toEqual([]);
    } finally {
      for (const socket of sockets) socket.close();
      await server.close();
    }
  });

  it("does not share an anonymous idempotency result across different requests", async () => {
    const server = createRoomServer(":memory:");
    const { port } = await server.listen(0, "127.0.0.1");
    const socket = await openSocket(`ws://127.0.0.1:${port}`);
    try {
      const first = await sendRequest(socket, {
        version: PROTOCOL_VERSION,
        requestId: "same-caller-id",
        kind: "CreateRoom",
        name: "First Team",
        color: "red",
      });
      const second = await sendRequest(socket, {
        version: PROTOCOL_VERSION,
        requestId: "same-caller-id",
        kind: "CreateRoom",
        name: "Second Team",
        color: "blue",
      });
      expect(second.room.code).not.toBe(first.room.code);
      expect(second.participantToken).not.toBe(first.participantToken);
    } finally {
      socket.close();
      await server.close();
    }
  });

  it("replays a create request with the same seat token after a clean restart", async () => {
    const path = resolve(`test-results/phase8-request-restart-${crypto.randomUUID()}.sqlite`);
    const message = {
      version: PROTOCOL_VERSION,
      requestId: "durable-create-request",
      kind: "CreateRoom",
      name: "Restart Team",
      color: "green",
    } as const;
    const firstServer = createRoomServer(path);
    const firstAddress = await firstServer.listen(0, "127.0.0.1");
    const firstSocket = await openSocket(`ws://127.0.0.1:${firstAddress.port}`);
    const created = await sendRequest(firstSocket, message);
    firstSocket.close();
    await firstServer.close();

    const secondServer = createRoomServer(path);
    const secondAddress = await secondServer.listen(0, "127.0.0.1");
    const secondSocket = await openSocket(`ws://127.0.0.1:${secondAddress.port}`);
    try {
      const retried = await sendRequest(secondSocket, message);
      expect(retried.room.code).toBe(created.room.code);
      expect(retried.selfPlayerId).toBe(created.selfPlayerId);
      expect(retried.participantToken).toBe(created.participantToken);
    } finally {
      secondSocket.close();
      await secondServer.close();
    }
  });
});

const openSocket = (url: string): Promise<WebSocket> =>
  new Promise((resolveOpen, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => resolveOpen(socket));
    socket.once("error", reject);
  });

const sendRequest = <Message extends ClientMessage>(
  socket: WebSocket,
  message: Message,
): Promise<Extract<ServerMessage, { readonly kind: "RoomSnapshot" }>> =>
  new Promise((resolveResponse, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      const response = JSON.parse(data.toString()) as ServerMessage;
      if (response.requestId !== message.requestId) return;
      socket.off("message", onMessage);
      if (response.kind === "ProtocolError")
        reject(new Error(`${response.code}: ${response.message}`));
      else if (response.kind === "RoomSnapshot") resolveResponse(response);
      else reject(new Error(`Unexpected ${response.kind} response.`));
    };
    socket.on("message", onMessage);
    socket.send(JSON.stringify(message));
  });

const sendMatchRequest = (
  socket: WebSocket,
  message: Extract<ClientMessage, { readonly kind: "GetMatchState" }>,
): Promise<MatchSnapshotMessage> =>
  new Promise((resolveResponse, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      const response = JSON.parse(data.toString()) as ServerMessage;
      if (response.requestId !== message.requestId) return;
      socket.off("message", onMessage);
      if (response.kind === "ProtocolError")
        reject(new Error(`${response.code}: ${response.message}`));
      else if (response.kind === "MatchSnapshot") resolveResponse(response);
      else reject(new Error(`Unexpected ${response.kind} response.`));
    };
    socket.on("message", onMessage);
    socket.send(JSON.stringify(message));
  });
