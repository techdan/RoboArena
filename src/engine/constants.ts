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

/** Renderer presentation default; independent from the engine RNG/tick rate. */
export const MOVIE_FPS = 12; // PROVISIONAL RE §20 #28

export const TURN_DURATION_SECONDS_DEFAULT = 15;
export const TURN_DURATION_TICKS_DEFAULT = TURN_DURATION_SECONDS_DEFAULT * TICKS_PER_SECOND;

/** Convert seconds to integer engine ticks. */
export const secondsToTicks = (seconds: number): number => Math.round(seconds * TICKS_PER_SECOND);

// ──────────────────────────────────────────────────────────────────────────
// Movement and command timing

/** PROVISIONAL RE §20 #11: playtest-derived; move alternation still untraced. */
export const MOVE_SINGLE_COST_TICKS = [18, 42] as const;

/** PROVISIONAL RE §20 #11: playtest-derived; move alternation still untraced. */
export const MOVE_DOUBLE_COST_TICKS = [24, 48] as const;

/** PROVISIONAL RE §20 #12/#27. */
export const DEPLOY_COST_TICKS = 120;

/** PROVISIONAL RE §20 #12. */
export const POSTURE_STEP_COST_TICKS = 6;

/** PROVISIONAL RE §20 #12. */
export const SCAN_ROTATION_COST_TICKS = 3;

// ──────────────────────────────────────────────────────────────────────────
// Combat

/** Uniform maximum range, confirmed in code and UI strings (RE §4/§6). */
export const WEAPON_MAX_RANGE = 18;

/** PROVISIONAL RE §20 #22: hard scan gate not yet decoded. */
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
