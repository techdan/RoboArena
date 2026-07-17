/** Browser WebSocket client and local anonymous room identity persistence. */

import type {
  ClientMessage,
  ProtocolErrorCode,
  RoomSnapshotMessage,
  ServerMessage,
} from "./protocol";

const DEFAULT_ROOM_SERVER = "ws://localhost:3001";
const ROOM_TOKEN_PREFIX = "roboarena.room-token.";
const RECENT_ROOMS_KEY = "roboarena.recent-rooms";
const MATCH_ROOM_PREFIX = "roboarena.match-room.";

export const roomServerUrl = (): string =>
  process.env.NEXT_PUBLIC_ROOM_WS_URL ?? DEFAULT_ROOM_SERVER;

export const requestId = (): string => crypto.randomUUID();

export const roomToken = (code: string): string | null =>
  window.localStorage.getItem(`${ROOM_TOKEN_PREFIX}${code}`);

export const rememberRoom = (code: string, token: string): void => {
  window.localStorage.setItem(`${ROOM_TOKEN_PREFIX}${code}`, token);
  const current = recentRooms().filter((remembered) => remembered !== code);
  window.localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify([code, ...current].slice(0, 8)));
};

export const forgetRoom = (code: string): void => {
  window.localStorage.removeItem(`${ROOM_TOKEN_PREFIX}${code}`);
  window.localStorage.setItem(
    RECENT_ROOMS_KEY,
    JSON.stringify(recentRooms().filter((remembered) => remembered !== code)),
  );
};

export const rememberMatch = (matchId: string, roomCode: string): void => {
  window.localStorage.setItem(`${MATCH_ROOM_PREFIX}${matchId}`, roomCode);
};

export const roomForMatch = (matchId: string): string | null =>
  window.localStorage.getItem(`${MATCH_ROOM_PREFIX}${matchId}`);

export const recentRooms = (): readonly string[] => {
  try {
    const value = JSON.parse(window.localStorage.getItem(RECENT_ROOMS_KEY) ?? "[]") as unknown;
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
};

export class RoomRequestError extends Error {
  constructor(
    readonly code: ProtocolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RoomRequestError";
  }
}

export class RoomSocket {
  #socket: WebSocket | undefined;
  #openPromise: Promise<void> | undefined;
  #listeners = new Set<(message: ServerMessage) => void>();
  #connectionListeners = new Set<(connected: boolean) => void>();

  #emitConnection(connected: boolean): void {
    for (const listener of this.#connectionListeners) listener(connected);
  }

  connect(): Promise<void> {
    if (this.#socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.#openPromise !== undefined) return this.#openPromise;
    this.#openPromise = new Promise((resolve, reject) => {
      const socket = new WebSocket(roomServerUrl());
      this.#socket = socket;
      let opened = false;
      socket.addEventListener("open", () => {
        opened = true;
        this.#openPromise = undefined;
        this.#emitConnection(true);
        resolve();
      });
      socket.addEventListener("error", () => {
        if (opened) return;
        this.#openPromise = undefined;
        reject(new Error("Could not connect to the room service."));
      });
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        for (const listener of this.#listeners) listener(message);
      });
      socket.addEventListener("close", () => {
        this.#socket = undefined;
        this.#openPromise = undefined;
        this.#emitConnection(false);
      });
    });
    return this.#openPromise;
  }

  async send(message: ClientMessage): Promise<void> {
    await this.connect();
    this.#socket?.send(JSON.stringify(message));
  }

  subscribe(listener: (message: ServerMessage) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  subscribeConnection(listener: (connected: boolean) => void): () => void {
    this.#connectionListeners.add(listener);
    return () => this.#connectionListeners.delete(listener);
  }

  close(): void {
    this.#socket?.close();
  }
}

export const requestOnce = async (message: ClientMessage): Promise<RoomSnapshotMessage> => {
  const socket = new RoomSocket();
  try {
    return await new Promise<RoomSnapshotMessage>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        unsubscribe();
        callback();
      };
      const unsubscribe = socket.subscribe((response) => {
        if (response.requestId !== message.requestId) return;
        if (response.kind === "ProtocolError")
          finish(() => reject(new RoomRequestError(response.code, response.message)));
        else finish(() => resolve(response));
      });
      const timeout = setTimeout(
        () => finish(() => reject(new Error("The room service did not respond in time."))),
        10_000,
      );
      void socket.send(message).catch((error: unknown) => finish(() => reject(error)));
    });
  } finally {
    socket.close();
  }
};
