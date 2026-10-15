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
  arenaThemeSchema,
  type ArenaThemeName,
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
const terrainSchema = z.enum([
  "open",
  "rough",
  "low-wall",
  "wall",
  "bush",
  "crevice",
  "outer-wall",
]);
const robotClassSchema = z.enum(["rifle", "burst", "auto", "missile", "stealth"]);
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
  z.object({ kind: z.literal("zap"), seconds: z.number().int().min(1).max(40) }).strict(),
  z
    .object({ kind: z.literal("place-bomb"), fuseSeconds: z.number().int().min(0).max(40) })
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
      kind: z.literal("ResignMatch"),
      code: roomCodeSchema,
      token: tokenSchema,
      matchId: z.string().min(1).max(80),
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
  /** Public participation/readiness; never derived from visibility-filtered robots. */
  readonly requiredPlayerIds?: readonly string[];
  readonly needsOrderReview?: boolean;
  readonly unseenTurns: readonly ParticipantTurnResult[];
  /** The host's arena look for the 3D movie; absent for rooms made before looks existed. */
  readonly arenaTheme?: ArenaThemeName;
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
  readonly damageKind: "direct" | "blast" | "zap";
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
  /** Opaque correlation id for unexpected server failures; contains no hidden game data. */
  readonly supportId?: string;
}

export type ServerMessage = RoomSnapshotMessage | MatchSnapshotMessage | ProtocolErrorMessage;

const publicPlayerSchema = z
  .object({
    id: z.string().min(1),
    name: playerNameSchema,
    color: playerColorSchema,
    ready: z.boolean(),
    connected: z.boolean(),
    isHost: z.boolean(),
    side: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
    homeSlot: homeSlotSchema.optional(),
  })
  .strict();
const publicRoomSchema = z
  .object({
    code: roomCodeSchema,
    phase: z.enum(["setup", "active"]),
    hostPlayerId: z.string().min(1),
    config: roomConfigSchema,
    players: z.array(publicPlayerSchema).min(1).max(4),
    matchId: z.string().min(1).max(80).optional(),
  })
  .strict();
const participantRoomStatusSchema = z
  .object({
    status: z.enum(["planning", "waiting", "turn-ready", "finished"]),
    turnNumber: z.number().int().min(1),
    waitingForPlayers: z.number().int().min(0).max(4),
  })
  .strict();

const robotDefinitionSchema = z
  .object({
    class: robotClassSchema,
    accuracy: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    armor: z.number().int().positive(),
    rating: z.number().int().nonnegative(),
    primaryWeapon: weaponIdSchema,
    secondaryWeapons: z.array(weaponIdSchema).optional(),
    stealthVisibility: z.literal("stealth").optional(),
  })
  .strict();
const ammoSchema = z
  .object({
    rifle: z.union([z.number().int().nonnegative(), z.literal("unlimited")]),
    "burst-gun": z.union([z.number().int().nonnegative(), z.literal("unlimited")]),
    "auto-rifle": z.union([z.number().int().nonnegative(), z.literal("unlimited")]),
    "missile-launcher": z.union([z.number().int().nonnegative(), z.literal("unlimited")]),
    "grenade-launcher": z.union([z.number().int().nonnegative(), z.literal("unlimited")]),
  })
  .strict();
const robotStateSchema = z
  .object({
    id: z.string().min(1),
    teamId: z.string().min(1),
    definition: robotDefinitionSchema,
    position: z.union([tileCoordSchema, z.literal("dock")]),
    hp: z.number().int().nonnegative(),
    posture: postureSchema,
    scanHeading: headingSchema,
    damageStaggerActionsRemaining: z.number().int().nonnegative(),
    ammo: ammoSchema,
    timeBombs: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((robot) => robot.hp <= robot.definition.armor, "Robot HP cannot exceed armor.");
const teamStateSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    color: z.string().min(1),
    side: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    homeSlot: homeSlotSchema,
    brain: z.enum(["human", "stupid"]),
    robots: z.array(robotStateSchema),
    score: z.number().int(),
  })
  .strict();
const serializedMatchStateSchema = z
  .object({
    config: z
      .object({
        sportType: z.enum(["survival", "treasure-hunt", "capture-the-flag", "hostage", "baseball"]),
        formation: z.enum(["beginner", "standard", "fire-fight", "missile-fest", "beat-the-clock"]),
        length: z.enum(["skirmish", "melee", "battle", "campaign"]),
        arenaType: z.enum(["rubble", "suburbs", "computer"]),
        arenaSizeName: z.string().min(1),
        turnLengthSeconds: z.number().int().min(1).max(40),
        rulesRevision: z.union([z.literal(2), z.literal(3)]).optional(),
        showEnemyPositions: z.literal(true).optional(),
        zapArmed: z.literal(true).optional(),
      })
      .strict(),
    turnNumber: z.number().int().min(1),
    teams: z.array(teamStateSchema).min(1).max(4),
    arena: z
      .object({
        type: z.enum(["rubble", "suburbs", "computer"]),
        sizeName: z.string().min(1),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        tiles: z.array(z.array(z.object({ terrain: terrainSchema }).strict())),
        homeAreas: z.array(
          z
            .object({ corner: z.enum(["NW", "NE", "SE", "SW"]), tiles: z.array(tileCoordSchema) })
            .strict(),
        ),
      })
      .strict()
      .refine(
        (arena) =>
          arena.tiles.length === arena.height &&
          arena.tiles.every((row) => row.length === arena.width),
        "Arena dimensions do not match its tile grid.",
      ),
    lastKnownMarkers: z.array(
      z
        .object({
          teamId: z.string().min(1),
          markers: z.array(z.object({ enemyId: z.string().min(1), at: tileCoordSchema }).strict()),
        })
        .strict(),
    ),
    armedBombs: z
      .array(
        z
          .object({
            id: z.string().min(1),
            ownerId: z.string().min(1),
            teamId: z.string().min(1),
            at: tileCoordSchema,
            detonatesAt: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(16)
      .optional(),
  })
  .strict();

const eventEnvelope = { tick: z.number().int().nonnegative(), seq: z.number().int().nonnegative() };
const participantContactSchema = z
  .object({
    id: z.string().min(1),
    teamId: z.string().min(1),
    teamColor: z.string().min(1),
    robotClass: robotClassSchema,
    position: tileCoordSchema,
    hp: z.number().int().nonnegative(),
    armor: z.number().int().positive(),
    posture: postureSchema,
    scanHeading: headingSchema,
    destroyed: z.boolean(),
  })
  .strict();
const participantEventSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...eventEnvelope,
      kind: z.literal("turn-start"),
      turnNumber: z.number().int().min(1),
    })
    .strict(),
  z
    .object({ ...eventEnvelope, kind: z.literal("turn-end"), turnNumber: z.number().int().min(1) })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      kind: z.literal("command-start"),
      robotId: z.string().min(1),
      commandIndex: z.number().int().nonnegative(),
      commandKind: z.enum([
        "deploy",
        "move",
        "set-posture",
        "set-scan-direction",
        "aim-and-fire",
        "scan-and-fire",
        "zap",
        "place-bomb",
      ]),
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      kind: z.literal("deployed"),
      robotId: z.string().min(1),
      to: tileCoordSchema,
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      kind: z.literal("move-step"),
      robotId: z.string().min(1),
      to: tileCoordSchema,
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      kind: z.literal("posture-changed"),
      robotId: z.string().min(1),
      posture: postureSchema,
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      kind: z.literal("scan-rotated"),
      robotId: z.string().min(1),
      heading: headingSchema,
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      kind: z.literal("enemy-spotted"),
      teamId: z.string().min(1),
      enemyId: z.string().min(1),
      at: tileCoordSchema,
      contact: participantContactSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      kind: z.literal("enemy-lost"),
      teamId: z.string().min(1),
      enemyId: z.string().min(1),
      lastSeenAt: tileCoordSchema,
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      kind: z.literal("scan-target-acquired"),
      shooterId: z.string().min(1),
      targetId: z.string().min(1),
      distance: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      kind: z.literal("fired"),
      shooterId: z.string().min(1),
      commandIndex: z.number().int().nonnegative(),
      weapon: weaponIdSchema,
      target: tileCoordSchema,
      fireMode: z.enum(["aim", "scan"]),
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      kind: z.literal("projectile-launched"),
      projectileId: z.string().min(1),
      shooterId: z.string().min(1),
      shotIndex: z.number().int().nonnegative(),
      weapon: weaponIdSchema,
      from: tileCoordSchema,
      target: tileCoordSchema,
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      kind: z.literal("projectile-impacted"),
      projectileId: z.string().min(1),
      weapon: weaponIdSchema,
      target: tileCoordSchema,
      outcome: z.enum(["hit", "miss", "blast"]),
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      kind: z.literal("shot-missed"),
      shooterId: z.string().min(1),
      shotIndex: z.number().int().nonnegative(),
      target: tileCoordSchema,
      reason: z.enum(["out-of-range", "angle-blocked", "sight-blocked", "hit-roll", "no-target"]),
      score: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      kind: z.literal("damaged"),
      damageKind: z.enum(["direct", "blast", "zap"]),
      targetId: z.string().min(1),
      damage: z.number().int().nonnegative(),
      sourceId: z.string().min(1).optional(),
      shotIndex: z.number().int().nonnegative().optional(),
      score: z.number().int().nonnegative().optional(),
      radius: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z.object({ ...eventEnvelope, kind: z.literal("destroyed"), robotId: z.string().min(1) }).strict(),
  z
    .object({
      ...eventEnvelope,
      kind: z.literal("zapped"),
      shooterId: z.string().min(1),
      at: tileCoordSchema,
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      kind: z.literal("bomb-placed"),
      robotId: z.string().min(1),
      bombId: z.string().min(1),
      at: tileCoordSchema,
      detonatesAt: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      kind: z.literal("bomb-exploded"),
      bombId: z.string().min(1),
      ownerId: z.string().min(1),
      at: tileCoordSchema,
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      kind: z.literal("last-known-marker"),
      teamId: z.string().min(1),
      enemyId: z.string().min(1),
      at: tileCoordSchema,
    })
    .strict(),
  z
    .object({
      ...eventEnvelope,
      kind: z.literal("command-aborted"),
      robotId: z.string().min(1),
      commandIndex: z.number().int().nonnegative(),
      reason: z.literal("destroyed"),
    })
    .strict(),
]);

const roomSnapshotSchema = z
  .object({
    version: z.literal(PROTOCOL_VERSION),
    requestId: requestIdSchema,
    kind: z.literal("RoomSnapshot"),
    room: publicRoomSchema,
    selfPlayerId: z.string().min(1),
    matchStatus: participantRoomStatusSchema.optional(),
    participantToken: tokenSchema.optional(),
  })
  .strict();
const matchSnapshotSchema = z
  .object({
    version: z.literal(PROTOCOL_VERSION),
    requestId: requestIdSchema,
    kind: z.literal("MatchSnapshot"),
    roomCode: roomCodeSchema,
    matchId: z.string().min(1).max(80),
    selfPlayerId: z.string().min(1),
    match: serializedMatchStateSchema,
    status: z.enum(["planning", "waiting", "turn-ready", "finished"]),
    revision: z.string().min(1),
    ownOrders: turnOrdersSchema,
    locked: z.boolean(),
    lockedPlayerIds: z.array(z.string().min(1)).max(4),
    requiredPlayerIds: z.array(z.string().min(1)).max(4).optional(),
    needsOrderReview: z.boolean().optional(),
    unseenTurns: z.array(
      z
        .object({
          turnNumber: z.number().int().min(1),
          initialState: serializedMatchStateSchema,
          events: z.array(participantEventSchema),
          playbackTick: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    arenaTheme: arenaThemeSchema.optional(),
    outcome: z.enum(["won", "draw"]).optional(),
    winningSide: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
    ceremonyScores: z
      .array(z.object({ teamId: z.string().min(1), score: z.number().int() }).strict())
      .optional(),
  })
  .strict();
const protocolErrorSchema = z
  .object({
    version: z.literal(PROTOCOL_VERSION),
    requestId: requestIdSchema,
    kind: z.literal("ProtocolError"),
    code: z.enum([
      "INVALID_MESSAGE",
      "RATE_LIMITED",
      "ROOM_NOT_FOUND",
      "ROOM_FULL",
      "ROOM_STARTED",
      "UNAUTHORIZED",
      "HOST_ONLY",
      "NOT_READY",
      "DUPLICATE_NAME",
      "DUPLICATE_COLOR",
      "INVALID_CONFIG",
      "MATCH_NOT_FOUND",
      "WRONG_PHASE",
      "STALE_TURN",
      "ORDERS_LOCKED",
      "INVALID_ORDERS",
      "INTERNAL_ERROR",
    ]),
    message: z.string().min(1).max(500),
    supportId: z
      .string()
      .regex(/^[A-Z0-9]{8}$/)
      .optional(),
  })
  .strict();

export const serverMessageSchema = z.discriminatedUnion("kind", [
  roomSnapshotSchema,
  matchSnapshotSchema,
  protocolErrorSchema,
]);

export const parseServerMessage = (value: unknown): ServerMessage =>
  serverMessageSchema.parse(value) as ServerMessage;

export const parseServerMessageJson = (json: string): ServerMessage => {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    throw new Error("Server response must be valid JSON.");
  }
  return parseServerMessage(value);
};

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
