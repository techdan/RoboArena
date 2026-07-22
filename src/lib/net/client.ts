/** Browser WebSocket client and local anonymous room identity persistence. */

import type {
  ClientMessage,
  MatchSnapshotMessage,
  ProtocolErrorCode,
  RoomSnapshotMessage,
  ServerMessage,
} from "./protocol";
import { parseClientMessage, parseServerMessageJson } from "./protocol";

const DEFAULT_ROOM_SERVER = "ws://localhost:3001";
const ROOM_TOKEN_PREFIX = "roboarena.room-token.";
const RECENT_ROOMS_KEY = "roboarena.recent-rooms";
const MATCH_ROOM_PREFIX = "roboarena.match-room.";
const PLANNER_DRAFT_PREFIX = "roboarena.planner-draft";

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

/** Clear only room identity, match routing, and planner drafts owned by RoboArena. */
export const resetLocalGameData = (): number => {
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (
        key !== null &&
        (key.startsWith(ROOM_TOKEN_PREFIX) ||
          key === RECENT_ROOMS_KEY ||
          key.startsWith(MATCH_ROOM_PREFIX) ||
          key.startsWith(PLANNER_DRAFT_PREFIX))
      ) {
        keys.push(key);
      }
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
    return keys.length;
  } catch {
    return 0;
  }
};

export class RoomRequestError extends Error {
  constructor(
    readonly code: ProtocolErrorCode,
    message: string,
    readonly supportId?: string,
  ) {
    super(message);
    this.name = "RoomRequestError";
  }
}

export class ServerProtocolError extends Error {
  constructor() {
    super("The room service returned an incompatible protocol response.");
    this.name = "ServerProtocolError";
  }
}

export class RoomSocket {
  #socket: WebSocket | undefined;
  #openPromise: Promise<void> | undefined;
  #listeners = new Set<(message: ServerMessage) => void>();
  #connectionListeners = new Set<(connected: boolean) => void>();
  #protocolErrorListeners = new Set<(error: ServerProtocolError) => void>();

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
        try {
          const message = parseServerMessageJson(String(event.data));
          for (const listener of this.#listeners) listener(message);
        } catch {
          const error = new ServerProtocolError();
          for (const listener of this.#protocolErrorListeners) listener(error);
          socket.close(1002, "Incompatible room protocol");
        }
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
    this.#socket?.send(JSON.stringify(parseClientMessage(message)));
  }

  subscribe(listener: (message: ServerMessage) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  subscribeConnection(listener: (connected: boolean) => void): () => void {
    this.#connectionListeners.add(listener);
    return () => this.#connectionListeners.delete(listener);
  }

  subscribeProtocolError(listener: (error: ServerProtocolError) => void): () => void {
    this.#protocolErrorListeners.add(listener);
    return () => this.#protocolErrorListeners.delete(listener);
  }

  close(): void {
    this.#socket?.close();
  }
}

/** Message kinds answered with a MatchSnapshot; every other kind gets a RoomSnapshot. */
const MATCH_MESSAGE_KINDS = [
  "GetMatchState",
  "SubmitOrders",
  "LockOrders",
  "ResignMatch",
  "TurnResultAcknowledged",
  "SetPlaybackPosition",
] as const;

type MatchClientMessage = Extract<
  ClientMessage,
  { readonly kind: (typeof MATCH_MESSAGE_KINDS)[number] }
>;

const isMatchMessage = (message: ClientMessage): message is MatchClientMessage =>
  (MATCH_MESSAGE_KINDS as readonly string[]).includes(message.kind);

export function requestOnce(message: MatchClientMessage): Promise<MatchSnapshotMessage>;
export function requestOnce(
  message: Exclude<ClientMessage, MatchClientMessage>,
): Promise<RoomSnapshotMessage>;
export async function requestOnce(
  message: ClientMessage,
): Promise<RoomSnapshotMessage | MatchSnapshotMessage> {
  const socket = new RoomSocket();
  const expectsMatchSnapshot = isMatchMessage(message);
  try {
    return await new Promise<RoomSnapshotMessage | MatchSnapshotMessage>((resolve, reject) => {
      let settled = false;
      let unsubscribe: () => void = () => undefined;
      let unsubscribeProtocolError: () => void = () => undefined;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        unsubscribe();
        unsubscribeProtocolError();
        callback();
      };
      unsubscribe = socket.subscribe((response) => {
        if (response.requestId !== message.requestId) return;
        if (response.kind === "ProtocolError")
          finish(() =>
            reject(new RoomRequestError(response.code, response.message, response.supportId)),
          );
        else if (expectsMatchSnapshot && response.kind === "MatchSnapshot") {
          finish(() => resolve(response));
        } else if (!expectsMatchSnapshot && response.kind === "RoomSnapshot") {
          finish(() => resolve(response));
        } else {
          finish(() => reject(new ServerProtocolError()));
        }
      });
      unsubscribeProtocolError = socket.subscribeProtocolError((error) =>
        finish(() => reject(error)),
      );
      const timeout = setTimeout(
        () => finish(() => reject(new Error("The room service did not respond in time."))),
        10_000,
      );
      void socket.send(message).catch((error: unknown) => finish(() => reject(error)));
    });
  } finally {
    socket.close();
  }
}
