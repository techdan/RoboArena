/** Shared v1 room/setup validation. Server remains authoritative. */

import { z } from "zod";

export const PLAYER_COLORS = ["red", "blue", "green", "yellow"] as const;
export const playerColorSchema = z.enum(PLAYER_COLORS);
export type PlayerColor = z.infer<typeof playerColorSchema>;

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

export const roomConfigSchema = z
  .object({
    gameLength: z.enum(["melee", "battle"]),
    arenaName: z.enum(["rubble-two", "rubble-three"]),
    formation: z.literal("beginner"),
    turnLengthSeconds: z.number().int().min(1).max(40),
  })
  .strict()
  .superRefine((config, context) => {
    const expectedArena = config.gameLength === "melee" ? "rubble-two" : "rubble-three";
    if (config.arenaName !== expectedArena) {
      context.addIssue({
        code: "custom",
        path: ["arenaName"],
        message: `${config.gameLength} uses the verified ${expectedArena} arena.`,
      });
    }
  });

export type RoomConfig = z.infer<typeof roomConfigSchema>;

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  gameLength: "melee",
  arenaName: "rubble-two",
  formation: "beginner",
  turnLengthSeconds: 15,
};

export const configForLength = (gameLength: RoomConfig["gameLength"]): RoomConfig => ({
  ...DEFAULT_ROOM_CONFIG,
  gameLength,
  arenaName: gameLength === "melee" ? "rubble-two" : "rubble-three",
});
