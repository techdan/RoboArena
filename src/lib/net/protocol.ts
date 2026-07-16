/** Versioned runtime-validated room protocol shared by browsers and server. */

import { z } from "zod";
import {
  playerColorSchema,
  playerNameSchema,
  roomCodeSchema,
  roomConfigSchema,
  type PlayerColor,
  type RoomConfig,
} from "../setup/validate";

export const PROTOCOL_VERSION = 1 as const;
const requestIdSchema = z.string().min(1).max(64);
const tokenSchema = z.string().min(32).max(128);

const envelope = {
  version: z.literal(PROTOCOL_VERSION),
  requestId: requestIdSchema,
};

const identity = {
  name: playerNameSchema,
  color: playerColorSchema,
};

export const clientMessageSchema = z.discriminatedUnion("kind", [
  z.object({ ...envelope, kind: z.literal("CreateRoom"), ...identity }).strict(),
  z
    .object({ ...envelope, kind: z.literal("JoinRoom"), code: roomCodeSchema, ...identity })
    .strict(),
  z
    .object({
      ...envelope,
      kind: z.literal("ResumeRoom"),
      code: roomCodeSchema,
      token: tokenSchema,
    })
    .strict(),
  z
    .object({
      ...envelope,
      kind: z.literal("UpdatePlayer"),
      code: roomCodeSchema,
      token: tokenSchema,
      ...identity,
    })
    .strict(),
  z
    .object({
      ...envelope,
      kind: z.literal("UpdateConfig"),
      code: roomCodeSchema,
      token: tokenSchema,
      config: roomConfigSchema,
    })
    .strict(),
  z
    .object({
      ...envelope,
      kind: z.literal("SetReady"),
      code: roomCodeSchema,
      token: tokenSchema,
      ready: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      kind: z.literal("StartMatch"),
      code: roomCodeSchema,
      token: tokenSchema,
    })
    .strict(),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export interface PublicPlayer {
  readonly id: string;
  readonly name: string;
  readonly color: PlayerColor;
  readonly ready: boolean;
  readonly connected: boolean;
  readonly isHost: boolean;
  readonly side?: 1 | 2 | 3 | 4;
  readonly homeSlot?: 0 | 1 | 2 | 3;
}

export interface PublicRoom {
  readonly code: string;
  readonly phase: "setup" | "active";
  readonly hostPlayerId: string;
  readonly config: RoomConfig;
  readonly players: readonly PublicPlayer[];
  readonly matchId?: string;
}

export interface RoomSnapshotMessage {
  readonly version: typeof PROTOCOL_VERSION;
  readonly requestId: string;
  readonly kind: "RoomSnapshot";
  readonly room: PublicRoom;
  readonly selfPlayerId: string;
  /** Issued only by CreateRoom/JoinRoom; never broadcast to other players. */
  readonly participantToken?: string;
}

export type ProtocolErrorCode =
  | "INVALID_MESSAGE"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "ROOM_STARTED"
  | "UNAUTHORIZED"
  | "HOST_ONLY"
  | "NOT_READY"
  | "DUPLICATE_NAME"
  | "DUPLICATE_COLOR"
  | "INVALID_CONFIG"
  | "INTERNAL_ERROR";

export interface ProtocolErrorMessage {
  readonly version: typeof PROTOCOL_VERSION;
  readonly requestId: string;
  readonly kind: "ProtocolError";
  readonly code: ProtocolErrorCode;
  readonly message: string;
}

export type ServerMessage = RoomSnapshotMessage | ProtocolErrorMessage;

export const parseClientMessage = (value: unknown): ClientMessage =>
  clientMessageSchema.parse(value);

export const parseClientMessageJson = (json: string): ClientMessage => {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("Message must be valid JSON.");
  }
  return parseClientMessage(value);
};
