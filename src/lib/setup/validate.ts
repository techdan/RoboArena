/** Shared v1 room/setup validation. Server remains authoritative. */

import { z } from "zod";
import type { HomeSlot } from "../../engine/types";
import { ARENA_NAMES, type ArenaName } from "../arenas/catalog";

export const PLAYER_COLORS = ["red", "blue", "green", "yellow"] as const;
export const playerColorSchema = z.enum(PLAYER_COLORS);
export type PlayerColor = z.infer<typeof playerColorSchema>;

/** Home slots are the four fixed Team boxes; v1 lets each player pick a corner. */
export const HOME_SLOTS = [0, 1, 2, 3] as const;
export const homeSlotSchema: z.ZodType<HomeSlot> = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
export type { HomeSlot };

/** Corner labels match the engine arena home-area order (NW/NE/SE/SW). */
export const HOME_CORNER_LABELS: Readonly<Record<HomeSlot, string>> = {
  0: "NW",
  1: "NE",
  2: "SE",
  3: "SW",
};

export const playerNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a team name.")
  .max(24, "Team names are limited to 24 characters.")
  .regex(
    /^[\p{L}\p{N} ._'-]+$/u,
    "Use letters, numbers, spaces, apostrophes, dots, dashes, or underscores.",
  );

export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NP-Z2-9]{6}$/, "Room codes contain six letters or numbers.");

/** Presentation-only arena looks for the 3D movie; the host picks one per room. */
export const ARENA_THEME_IDS = ["coliseum", "factory", "neon", "scrapyard"] as const;
export const arenaThemeSchema = z.enum(ARENA_THEME_IDS);
export type ArenaThemeName = z.infer<typeof arenaThemeSchema>;
export const DEFAULT_ARENA_THEME_ID: ArenaThemeName = "coliseum";

export const roomConfigSchema = z
  .object({
    gameLength: z.enum(["melee", "battle"]),
    arenaName: z.enum(ARENA_NAMES),
    formation: z.enum(["beginner", "standard"]),
    turnLengthSeconds: z.number().int().min(1).max(40),
    // Optional so rooms saved before arena looks existed still load.
    arenaTheme: arenaThemeSchema.optional(),
  })
  .strict();

export type RoomConfig = z.infer<typeof roomConfigSchema>;

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  gameLength: "melee",
  arenaName: "rubble-two",
  formation: "standard",
  turnLengthSeconds: 15,
  arenaTheme: DEFAULT_ARENA_THEME_ID,
};

/** Any of the 24 original maps can host either game length; this is the classic pairing. */
export const DEFAULT_ARENA_FOR_LENGTH: Readonly<Record<RoomConfig["gameLength"], ArenaName>> = {
  melee: "rubble-two",
  battle: "rubble-three",
};

export const configForLength = (gameLength: RoomConfig["gameLength"]): RoomConfig => ({
  ...DEFAULT_ROOM_CONFIG,
  gameLength,
  arenaName: DEFAULT_ARENA_FOR_LENGTH[gameLength],
});
