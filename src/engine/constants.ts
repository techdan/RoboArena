/**
 * Engine constants for the deterministic RoboArena simulation.
 *
 * Binary-derived values cite `docs/reverse-engineering.md` (RE). Values that
 * still depend on an unresolved selector or command mapping are explicitly
 * marked PROVISIONAL with their RE §20 item.
 */

// ──────────────────────────────────────────────────────────────────────────
// Time

/** RoboSport's internal time unit is one sixtieth of a second (RE §19). */
export const TICKS_PER_SECOND = 60;

/** Original movie-rate choices derived from 60 Hz frame divisors (RE §19). */
export const MOVIE_FPS_OPTIONS = [20, 15, 12, 10, 6, 5, 4, 3] as const;

/** Original default (choice index 2); independent from engine simulation ticks. */
export const MOVIE_FPS = 12;

export const TURN_DURATION_SECONDS_DEFAULT = 15;
export const TURN_DURATION_TICKS_DEFAULT = TURN_DURATION_SECONDS_DEFAULT * TICKS_PER_SECOND;

/** Convert seconds to integer engine ticks. */
export const secondsToTicks = (seconds: number): number => Math.round(seconds * TICKS_PER_SECOND);

// ──────────────────────────────────────────────────────────────────────────
// Movement and command timing

/** One-tile movement command, selectors 41..48 (RE §19). */
export const MOVE_SINGLE_COST_TICKS = 30;

/** Two-tile movement command, selectors 49..64 (RE §19). */
export const MOVE_DOUBLE_COST_TICKS = 40;

/** Deploy command, selector 74 (RE §19). */
export const DEPLOY_COST_TICKS = 120;

/** Any absolute posture-setting command, selectors 70..72 (RE §19). */
export const POSTURE_CHANGE_COST_TICKS = 10;

/** Any absolute scan-heading command, selectors 24..31 (RE §19). */
export const SCAN_DIRECTION_COST_TICKS = 5;

// ──────────────────────────────────────────────────────────────────────────
// Survival ceremony

/** Final Ceremony points for each surviving robot (RE §16). */
export const SURVIVAL_ROBOT_BONUS = 150;

/** Final Ceremony points when the team has at least one survivor (RE §16). */
export const SURVIVAL_TEAM_BONUS = 400;

// ──────────────────────────────────────────────────────────────────────────
// Combat

/** Uniform maximum range, confirmed in code and UI strings (RE §4/§6). */
export const WEAPON_MAX_RANGE = 18;

/** The hard scan gate includes both perpendicular boundary rays (RE §18). */
export const SCAN_CONE_HALF_WIDTH_DEGREES = 90;

/** Live-fire score thresholds out of 256, DGROUP 0x156E (RE §7b). */
export const LIVE_FIRE_HIT_THRESHOLDS = [
  0, 4, 8, 16, 24, 32, 40, 48, 64, 80, 96, 112, 128, 144, 160, 176, 192, 208, 224, 240,
] as const;

export const COVER_CLASS_HIT_SCORE: Readonly<Record<1 | 2 | 3 | 4, number>> = {
  1: 4,
  2: 8,
  3: 12,
  4: 18,
};

export const COVER_CLASS_BULLET_DAMAGE_ADJUST: Readonly<Record<1 | 2 | 3 | 4, number>> = {
  1: -4,
  2: 0,
  3: 0,
  4: 4,
};

/** Weapon-property accuracy-add table at DGROUP 0x1596 (RE §7b). */
export const WEAPON_ACCURACY_ADDS = [4, 7, 6, 5, 4, 3, 2, 1] as const;

// ──────────────────────────────────────────────────────────────────────────
// Arena

export const ARENA_DIMENSIONS = {
  skirmish: { width: 16, height: 16 },
  melee: { width: 24, height: 24 },
  battle: { width: 32, height: 32 },
  campaign: { width: 40, height: 40 },
} as const;

export const ROBOTS_PER_TEAM_BY_LENGTH = {
  skirmish: 2,
  melee: 4,
  battle: 6,
  campaign: 8,
} as const;
