/**
 * Engine constants — single source of truth for every locked numerical value.
 *
 * Sourced from `docs/initial-plan.md` §"Engine constants — v1 canonical stats".
 * If a number changes here, also update the plan; if the plan changes, update here.
 */

// ──────────────────────────────────────────────────────────────────────────
// Time

/** Internal simulation tick rate. Smallest observable cost (scan rotation = 0.05 s) is exactly 1 tick. */
export const TICKS_PER_SECOND = 20;

/** Movie playback frame rate (decimated from sim ticks for the renderer). */
export const MOVIE_FPS = 12;

/** Beginner default turn budget. Configurable 1–40 s in other formations via Turn Length dialog. */
export const TURN_DURATION_SECONDS_DEFAULT = 15.0;

/** Convert seconds to engine ticks (integer). */
export const secondsToTicks = (s: number): number =>
  Math.round(s * TICKS_PER_SECOND);

// ──────────────────────────────────────────────────────────────────────────
// Movement

/** Single-tile move costs (alternating, persists across non-move commands). */
export const MOVE_SINGLE_COST_TICKS = [
  secondsToTicks(0.3), // parity 0
  secondsToTicks(0.7), // parity 1
] as const;

/** Double-tile move costs (path-chunked into pairs by the planner). */
export const MOVE_DOUBLE_COST_TICKS = [
  secondsToTicks(0.4), // parity 0
  secondsToTicks(0.8), // parity 1
] as const;

/** Deployment from Dock into Home Area (one-time per robot per match). */
export const DEPLOY_COST_TICKS = secondsToTicks(2.0);

/** Posture change per height step (standing↔crouching costs 2 of these in v1's 2-posture model). */
export const POSTURE_STEP_COST_TICKS = secondsToTicks(0.1);

/** Scan rotation per directional unit (8 directions; rotates through intermediates). */
export const SCAN_ROTATION_COST_TICKS = secondsToTicks(0.05);

// ──────────────────────────────────────────────────────────────────────────
// Combat — scan cone

/** Firing arc half-width: ±90° from scan heading = 180° forward semicircle. Targets outside = "angle blocked". */
export const SCAN_CONE_HALF_WIDTH_DEGREES = 90;

/** Black/optimum zone half-width: ±45° from scan heading = inner 90° of the cone. */
export const SCAN_BLACK_ZONE_HALF_WIDTH_DEGREES = 45;

/** Hit chance for a stationary target inside the BLACK (optimum) zone. Match 5: 5/5 hits. */
export const HIT_CHANCE_BLACK = 1.0;

/** Hit chance for a stationary target inside the GREY (peripheral) zone. Match 5 + prior: 2/11 ≈ 18% → 0.2. */
export const HIT_CHANCE_GREY = 0.2;

// ──────────────────────────────────────────────────────────────────────────
// Combat — damage

/** Maximum range for all weapons (Aim & Fire). Confirmed via DOS cursor probe. */
export const WEAPON_MAX_RANGE = 18;

/**
 * P(full damage bracket) by distance: linear from ~1.0 at d=1 to 0.0 at d=17.
 * Above d=17, target is essentially out of full-bracket reach.
 */
export const fullBracketProbability = (distance: number): number => {
  return Math.max(0, Math.min(1, 1 - distance / 17));
};

// ──────────────────────────────────────────────────────────────────────────
// Combat — cover (only applies to crouching targets)

/** Target tile is a bush, target is crouching → miss chance. Match 6 confirmed ~30%. */
export const COVER_BUSH_MISS_CHANCE = 0.3;

/** Target tile is a low wall, target is crouching → miss chance. Match 7: 4/8 missed → ~50%. */
export const COVER_LOW_WALL_ON_TILE_MISS_CHANCE = 0.5;

/** Low wall in bullet path with a crouching target behind → miss chance. Match 7: 1/10 hit → ~90%. */
export const COVER_LOW_WALL_IN_PATH_MISS_CHANCE = 0.9;

/** Damage multiplier applied when target is on Rough Ground (vulnerable, all postures). */
export const ROUGH_GROUND_DAMAGE_MULTIPLIER = 1.2;

// ──────────────────────────────────────────────────────────────────────────
// Arena

/** Confirmed arena dimensions per Game Length. */
export const ARENA_DIMENSIONS = {
  skirmish: { width: 16, height: 16 }, // PROPOSED — not yet measured in DOS
  melee: { width: 25, height: 25 }, // CONFIRMED: Rubble Two
  battle: { width: 32, height: 32 }, // CONFIRMED: Rubble Three
  campaign: { width: 40, height: 40 }, // PROPOSED — not yet measured
} as const;

/** Robots per team by Game Length. */
export const ROBOTS_PER_TEAM_BY_LENGTH = {
  skirmish: 2,
  melee: 4,
  battle: 6,
  campaign: 8,
} as const;
