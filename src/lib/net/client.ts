/** Browser WebSocket client and local anonymous room identity persistence. */

import type { ClientMessage, RoomSnapshotMessage, ServerMessage } from "./protocol";

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

export class RoomSocket {
  #socket: WebSocket | undefined;
  #openPromise: Promise<void> | undefined;
  #listeners = new Set<(message: ServerMessage) => void>();

  connect(): Promise<void> {
    if (this.#socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.#openPromise !== undefined) return this.#openPromise;
    this.#openPromise = new Promise((resolve, reject) => {
      const socket = new WebSocket(roomServerUrl());
      this.#socket = socket;
      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", () =>
        reject(new Error("Could not connect to the room service.")),
      );
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        for (const listener of this.#listeners) listener(message);
      });
      socket.addEventListener("close", () => {
        this.#socket = undefined;
        this.#openPromise = undefined;
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

  close(): void {
    this.#socket?.close();
  }
}

export const requestOnce = async (message: ClientMessage): Promise<RoomSnapshotMessage> => {
  const socket = new RoomSocket();
  try {
    return await new Promise<RoomSnapshotMessage>((resolve, reject) => {
      const unsubscribe = socket.subscribe((response) => {
        if (response.requestId !== message.requestId) return;
        unsubscribe();
        if (response.kind === "ProtocolError") reject(new Error(response.message));
        else resolve(response);
      });
      void socket.send(message).catch(reject);
    });
  } finally {
    socket.close();
  }
};
