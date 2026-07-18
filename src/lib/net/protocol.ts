/** Versioned runtime-validated room protocol shared by browsers and server. */

import { z } from "zod";
import type {
  Heading,
  LastKnownMarker,
  MatchState,
  Posture,
  ResolutionEvent,
  RobotClass,
  TileCoord,
  TurnOrders,
} from "../../engine/types";
import {
  homeSlotSchema,
  playerColorSchema,
  playerNameSchema,
  roomCodeSchema,
  roomConfigSchema,
  type HomeSlot,
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

const tileCoordSchema = z.object({ x: z.number().int(), y: z.number().int() }).strict();
const weaponIdSchema = z.enum([
  "rifle",
  "burst-gun",
  "auto-rifle",
  "missile-launcher",
  "grenade-launcher",
]);
const postureSchema = z.enum(["upright", "ducking", "crouching"]);
const headingSchema = z.enum(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);
const commandSegmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("deploy"), to: tileCoordSchema }).strict(),
  z
    .object({
      kind: z.literal("move"),
      posture: postureSchema,
      path: z
        .array(
          z
            .object({
              to: tileCoordSchema,
              via: tileCoordSchema.optional(),
            })
            .strict(),
        )
        .min(1)
        .max(128),
    })
    .strict(),
  z.object({ kind: z.literal("set-posture"), posture: postureSchema }).strict(),
  z.object({ kind: z.literal("set-scan-direction"), heading: headingSchema }).strict(),
  z
    .object({
      kind: z.literal("aim-and-fire"),
      target: tileCoordSchema,
      weapon: weaponIdSchema,
      repeat: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("scan-and-fire"),
      weapon: weaponIdSchema,
      maxDistance: z.number().int().min(1).max(18),
      seconds: z.number().int().min(1).max(40),
    })
    .strict(),
]);
export const turnOrdersSchema = z
  .object({
    turnNumber: z.number().int().min(1),
    timelines: z
      .array(
        z
          .object({
            robotId: z.string().min(1).max(80),
            segments: z.array(commandSegmentSchema).max(256),
          })
          .strict(),
      )
      .max(64),
  })
  .strict();

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
      kind: z.literal("SetHomeSlot"),
      code: roomCodeSchema,
      token: tokenSchema,
      homeSlot: homeSlotSchema,
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
  z
    .object({
      ...envelope,
      kind: z.literal("GetMatchState"),
      code: roomCodeSchema,
      token: tokenSchema,
    })
    .strict(),
  z
    .object({
      ...envelope,
      kind: z.literal("SubmitOrders"),
      code: roomCodeSchema,
      token: tokenSchema,
      matchId: z.string().min(1).max(80),
      orders: turnOrdersSchema,
    })
    .strict(),
  z
    .object({
      ...envelope,
      kind: z.literal("LockOrders"),
      code: roomCodeSchema,
      token: tokenSchema,
      matchId: z.string().min(1).max(80),
      orders: turnOrdersSchema,
    })
    .strict(),
  z
    .object({
      ...envelope,
      kind: z.literal("TurnResultAcknowledged"),
      code: roomCodeSchema,
      token: tokenSchema,
      matchId: z.string().min(1).max(80),
      turnNumber: z.number().int().min(1),
    })
    .strict(),
  z
    .object({
      ...envelope,
      kind: z.literal("SetPlaybackPosition"),
      code: roomCodeSchema,
      token: tokenSchema,
      matchId: z.string().min(1).max(80),
      turnNumber: z.number().int().min(1),
      tick: z.number().int().min(0).max(144_000),
    })
    .strict(),
]);

type ParsedClientMessage = z.infer<typeof clientMessageSchema>;
type WithEngineOrders<Message> = Message extends { readonly orders: unknown }
  ? Omit<Message, "orders"> & { readonly orders: TurnOrders }
  : Message;
export type ClientMessage = WithEngineOrders<ParsedClientMessage>;

export interface PublicPlayer {
  readonly id: string;
  readonly name: string;
  readonly color: PlayerColor;
  readonly ready: boolean;
  readonly connected: boolean;
  readonly isHost: boolean;
  readonly side?: 1 | 2 | 3 | 4;
  readonly homeSlot?: HomeSlot;
}

export interface PublicRoom {
  readonly code: string;
  readonly phase: "setup" | "active";
  readonly hostPlayerId: string;
  readonly config: RoomConfig;
  readonly players: readonly PublicPlayer[];
  readonly matchId?: string;
}

export interface ParticipantRoomStatus {
  readonly status: "planning" | "waiting" | "turn-ready" | "finished";
  readonly turnNumber: number;
  readonly waitingForPlayers: number;
}

export interface RoomSnapshotMessage {
  readonly version: typeof PROTOCOL_VERSION;
  readonly requestId: string;
  readonly kind: "RoomSnapshot";
  readonly room: PublicRoom;
  readonly selfPlayerId: string;
  readonly matchStatus?: ParticipantRoomStatus;
  /** Issued only by CreateRoom/JoinRoom; never broadcast to other players. */
  readonly participantToken?: string;
}

export type SerializedMatchState = Omit<MatchState, "lastKnownMarkers"> & {
  readonly lastKnownMarkers: readonly {
    readonly teamId: string;
    readonly markers: readonly LastKnownMarker[];
  }[];
};

export interface MatchSnapshotMessage {
  readonly version: typeof PROTOCOL_VERSION;
  readonly requestId: string;
  readonly kind: "MatchSnapshot";
  readonly roomCode: string;
  readonly matchId: string;
  readonly selfPlayerId: string;
  readonly match: SerializedMatchState;
  readonly status: "planning" | "waiting" | "turn-ready" | "finished";
  readonly revision: string;
  readonly ownOrders: TurnOrders;
  readonly locked: boolean;
  readonly lockedPlayerIds: readonly string[];
  readonly unseenTurns: readonly ParticipantTurnResult[];
  readonly outcome?: "won" | "draw";
  readonly winningSide?: 1 | 2 | 3 | 4;
  readonly ceremonyScores?: readonly {
    readonly teamId: string;
    readonly score: number;
  }[];
}

/** Observable robot fields needed to introduce a contact during a private turn movie. */
export interface ParticipantRobotContact {
  readonly id: string;
  readonly teamId: string;
  readonly teamColor: string;
  readonly robotClass: RobotClass;
  readonly position: TileCoord;
  readonly hp: number;
  readonly armor: number;
  readonly posture: Posture;
  readonly scanHeading: Heading;
  readonly destroyed: boolean;
}

type ParticipantEnemySpottedEvent = Extract<ResolutionEvent, { readonly kind: "enemy-spotted" }> & {
  /** Present on participant projections; optional so canonical replay events remain renderer-compatible. */
  readonly contact?: ParticipantRobotContact;
};

export interface ParticipantDamageEvent {
  readonly tick: number;
  readonly seq: number;
  readonly kind: "damaged";
  readonly damageKind: "direct" | "blast";
  readonly targetId: string;
  readonly damage: number;
  /** Source details are present only when that source is authorized for this participant. */
  readonly sourceId?: string;
  readonly shotIndex?: number;
  readonly score?: number;
  readonly radius?: number;
}

/** Canonical events with participant-only contact data and redaction-safe observed damage. */
export type ParticipantResolutionEvent =
  | Exclude<ResolutionEvent, { readonly kind: "enemy-spotted" | "damaged" }>
  | ParticipantEnemySpottedEvent
  | ParticipantDamageEvent;

export interface ParticipantTurnResult {
  readonly turnNumber: number;
  readonly initialState: SerializedMatchState;
  readonly events: readonly ParticipantResolutionEvent[];
  readonly playbackTick: number;
}

export type ProtocolErrorCode =
  | "INVALID_MESSAGE"
  | "RATE_LIMITED"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "ROOM_STARTED"
  | "UNAUTHORIZED"
  | "HOST_ONLY"
  | "NOT_READY"
  | "DUPLICATE_NAME"
  | "DUPLICATE_COLOR"
  | "HOME_SLOT_TAKEN"
  | "INVALID_CONFIG"
  | "MATCH_NOT_FOUND"
  | "WRONG_PHASE"
  | "STALE_TURN"
  | "ORDERS_LOCKED"
  | "INVALID_ORDERS"
  | "INTERNAL_ERROR";

export interface ProtocolErrorMessage {
  readonly version: typeof PROTOCOL_VERSION;
  readonly requestId: string;
  readonly kind: "ProtocolError";
  readonly code: ProtocolErrorCode;
  readonly message: string;
}

export type ServerMessage = RoomSnapshotMessage | MatchSnapshotMessage | ProtocolErrorMessage;

export const serializeMatchState = (match: MatchState): SerializedMatchState => ({
  ...match,
  lastKnownMarkers: [...match.lastKnownMarkers].map(([teamId, markers]) => ({ teamId, markers })),
});

export const deserializeMatchState = (value: SerializedMatchState): MatchState => ({
  ...value,
  lastKnownMarkers: new Map(value.lastKnownMarkers.map((entry) => [entry.teamId, entry.markers])),
});

export const parseClientMessage = (value: unknown): ClientMessage =>
  clientMessageSchema.parse(value) as unknown as ClientMessage;

export const parseClientMessageJson = (json: string): ClientMessage => {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("Message must be valid JSON.");
  }
  return parseClientMessage(value);
};
