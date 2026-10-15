/**
 * Engine constants for the deterministic RoboArena simulation.
 *
 * Binary-derived values cite `docs/reverse-engineering.md` (RE). Values that
 * still depend on an unresolved selector or command mapping are explicitly
 * marked PROVISIONAL with their RE §20 item.
 */

import type { WeaponId } from "./types.js";

// ──────────────────────────────────────────────────────────────────────────
// Time

/** RoboSport's internal time unit is one sixtieth of a second (RE §19). */
export const TICKS_PER_SECOND = 60;

/** Original movie-rate choices derived from 60 Hz frame divisors (RE §19). */
export const MOVIE_FPS_OPTIONS = [20, 15, 12, 10, 6, 5, 4, 3] as const;

/** Original default (choice index 2); independent from engine simulation ticks. */
export const MOVIE_FPS = 12;

/**
 * Aim duration and Scan & Fire re-fire delay (RE §19). After a Scan & Fire
 * shot the next shot waits the weapon's Aim duration (seg6:0x3D79), or 30+40
 * for missiles (0x3FA4) and 30+50 for grenades (0x3F43); the descriptor's
 * scan column is not the re-fire delay.
 */
export const WEAPON_TIMING: Readonly<
  Record<
    WeaponId,
    { readonly firingIntervalTicks: number; readonly scanFiringIntervalTicks: number }
  >
> = {
  rifle: { firingIntervalTicks: 30, scanFiringIntervalTicks: 30 },
  "burst-gun": { firingIntervalTicks: 15, scanFiringIntervalTicks: 15 },
  "auto-rifle": { firingIntervalTicks: 10, scanFiringIntervalTicks: 10 },
  "missile-launcher": { firingIntervalTicks: 30, scanFiringIntervalTicks: 70 },
  "grenade-launcher": { firingIntervalTicks: 30, scanFiringIntervalTicks: 80 },
};

/** Missile Scan & Fire holds fire while its acquired target is closer than this (seg6:0x29CF). */
export const MISSILE_SCAN_MIN_DISTANCE = 2;

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

/**
 * One posture-setting record, selectors 70..72 (RE §19). Under original-rules
 * matches the planner emits one record per posture level, so Upright↔Crouching
 * passes through Ducking and costs two records (seg80:0x0352, re-map/commands.md §9).
 */
export const POSTURE_CHANGE_COST_TICKS = 10;

/**
 * One scan-heading record, selectors 24..31 (RE §19). Under original-rules
 * matches a turn emits one record per octant, the shortest way round
 * (seg80:0x0422, re-map/commands.md §9).
 */
export const SCAN_DIRECTION_COST_TICKS = 5;

// ──────────────────────────────────────────────────────────────────────────
// Rules revisions

/**
 * Rules revision 2 adds the original per-tick spotting roll and per-step turn
 * and posture costs. Matches without a revision keep the earlier rules so that
 * their stored replays still verify.
 */
export const ORIGINAL_SPOTTING_RULES_REVISION = 2;

/**
 * Rules revision 3 keeps revision 2 and adds the original formation setups
 * (Zap, Time Bomb, grenades, Show Enemy Positions) and runs the spotting pass
 * on the original 5-tick simulation step instead of every tick: the movie loop
 * advances `now` by 5 per iteration and calls the pass once (seg6:0x4832,
 * seg6:0x483E).
 */
export const ORIGINAL_FORMATIONS_RULES_REVISION = 3;

/**
 * Rules revision 4 keeps revision 3 and adds the original combat timing:
 * robots occupy their next tile partway through a move (seg6:0x2D59,
 * seg6:0x2E04) and the remaining timing rules in docs/spec.md §4.
 */
export const ORIGINAL_TIMING_RULES_REVISION = 4;

/**
 * A 1-tile move occupies its destination 15 ticks in; a 2-tile move occupies
 * the floored midpoint at 15 and the destination at 25 (seg6:0x2D8E,
 * seg6:0x2E41..0x2EA9).
 */
export const MOVE_TILE_SWITCH_TICKS = 15;
export const MOVE_DOUBLE_DESTINATION_SWITCH_TICKS = 25;

/** The original simulation advances in 5-tick steps (seg6:0x4838..0x483E). */
export const SIMULATION_STEP_TICKS = 5;

/**
 * Revision 4: a bullet (projectile type 4) is created with impact time
 * `now + 5` (seg6:0x3D2B..0x3D32) and lands in the queue pass of a later step
 * (seg6:0x556F, bullet branch seg6:0x56CD).
 */
export const BULLET_IMPACT_DELAY_TICKS = 5;

/**
 * Revision 4 movie tail. The movie runs to turn length + 150 (seg6:0x4790),
 * and an impact due within 150 ticks of the end pushes the end out by another
 * 150 (seg6:0x6330). No record starts and nothing fires at or after turn
 * length, but projectiles land, moves finish their current step and spotting
 * keeps running.
 */
export const MOVIE_TAIL_TICKS = 150;

/**
 * Revision 4 Scan & Fire pause, seg6:0x3E33. Each direct-fire Scan & Fire
 * shot counts on the robot's program (`+1C`); the seventh in a row adds a
 * pause of `base + 5·(rand & mask)` ticks to the cooldown, then the counter
 * restarts at `rand & resetMask` (pause drawn first). DGROUP 0x14BA, the
 * negotiated protocol level, is 2 in any same-version game, so the
 * per-weapon rows apply.
 */
export interface ScanFirePause {
  readonly base: number;
  readonly mask: number;
  readonly resetMask: number;
}
export const SCAN_FIRE_PAUSES: Readonly<
  Record<"rifle" | "burst-gun" | "auto-rifle", ScanFirePause>
> = {
  "auto-rifle": { base: 30, mask: 3, resetMask: 1 },
  "burst-gun": { base: 40, mask: 3, resetMask: 3 },
  rifle: { base: 50, mask: 7, resetMask: 3 },
};

/** The pause comes when the shot counter passes 6, on the seventh shot (seg6:0x3E33). */
export const SCAN_FIRE_PAUSE_AFTER_SHOTS = 6;

/**
 * seg6:0x3EE6: a direct-fire Scan & Fire step with no target, 20 or more
 * ticks after the cooldown ran out, takes one off the shot counter.
 */
export const SCAN_FIRE_DECAY_IDLE_TICKS = 20;

/**
 * Revision 4 explosive flight. A grenade lands `now + 5·d + 20` ticks after it
 * fires (seg6:0x230C..0x2317) and a missile `now + 5·(d >> 1) + 10`
 * (seg6:0x27DB..0x27EC), where d is the floored Euclidean distance from the
 * shooter's tile to the tile the shell lands on.
 */
export const GRENADE_FLIGHT = { ticksPerTile: 5, baseTicks: 20 } as const;
export const MISSILE_FLIGHT = { ticksPerTwoTiles: 5, baseTicks: 10 } as const;

/** Revision 4 explosive scatter jitter, DGROUP 0x15CE (seg6:0x39C7, seg6:0x3BA6). */
export const EXPLOSIVE_SCATTER_JITTER = [-1, 0, 0, 1, -2, -1, 1, 2] as const;

/**
 * Revision 4 grenade and missile Scan & Fire both hold fire while the acquired
 * target is closer than this (seg6:0x24FA grenade, seg6:0x29CF missile).
 */
export const EXPLOSIVE_SCAN_MIN_DISTANCE = 2;

/**
 * Revision 4 explosive path stop, seg87:0x2B77: each Low Wall on the path lets
 * the shell pass when `(rand & 0xFF)` is below a threshold that falls with the
 * tile's index k on the path (si = 2k compared with 4, 8 and 20).
 */
export const EXPLOSIVE_LOW_WALL_PASS_THRESHOLDS = [
  { maxPathIndex: 2, threshold: 256 },
  { maxPathIndex: 4, threshold: 248 },
  { maxPathIndex: 10, threshold: 224 },
  { maxPathIndex: Number.POSITIVE_INFINITY, threshold: 192 },
] as const;

/**
 * A path-stop attempt succeeds only when the shell passed at least this many
 * tiles, and at least `longMinimum` when the target is farther than
 * `longDistance` (seg87:0x2B77 return value).
 */
export const EXPLOSIVE_PATH_MINIMUM = { tiles: 2, longDistance: 10, longMinimum: 4 } as const;

// ──────────────────────────────────────────────────────────────────────────
// Spotting (re-map/stealth-fence-ceremony-ai-formats.md §1)

/** Spotting probabilities out of 256 by index 0..13, DGROUP 0x213A. */
export const SPOTTING_THRESHOLDS = [
  0, 8, 16, 24, 32, 40, 48, 56, 64, 96, 128, 160, 208, 255,
] as const;

/** Base spotting index by the target's cover class, jump table seg96:0x0AA4. */
export const SPOTTING_COVER_BASE: Readonly<Record<1 | 2 | 3 | 4, number>> = {
  1: 2,
  2: 4,
  3: 6,
  4: 10,
};

// ──────────────────────────────────────────────────────────────────────────
// Zap and Time Bomb (re-map/commands.md §3-4)

/** A zap's projectile (type 5) lands 5 ticks after it is created (seg6:0x1A08). */
export const ZAP_IMPACT_DELAY_TICKS = 5;

/** At most one zap per 60 ticks while the command lasts (seg6:0x4005). */
export const ZAP_COOLDOWN_TICKS = 60;

/** Zap damage 60 + (rand & 63), no cover, posture or distance terms (seg6:0x60EE). */
export const ZAP_DAMAGE_ROLL = { base: 60, mask: 63 } as const;

/** Place Bomb command record duration, descriptor row 23. */
export const PLACE_BOMB_COST_TICKS = 60;

/**
 * Self Destruct, selector 78: a 20-tick command record whose blast lands 10
 * ticks after the command starts (seg6:0x3541, impact `now + 10`).
 */
export const SELF_DESTRUCT_COST_TICKS = 20;
export const SELF_DESTRUCT_IMPACT_DELAY_TICKS = 10;

/** Zap and fuse dialogs accept 1..40 and 0..40 seconds (seg26:0x178C, seg26:0x18B2). */
export const ZAP_MAX_SECONDS = 40;
export const BOMB_MAX_FUSE_SECONDS = 40;

/**
 * Time Bomb and Self Destruct blast, category 2 at DGROUP 0x1606/0x1610:
 * radius 0..4, the same blast loop as missiles (seg6:0x5D73), hitting every
 * Side. Self Destruct reaches it as a type-3 projectile (seg6:0x5675).
 */
export const TIME_BOMB_BLAST = {
  radius: 4,
  damageAtRadius: [
    { base: 120, mask: 31 },
    { base: 80, mask: 31 },
    { base: 40, mask: 31 },
    { base: 20, mask: 15 },
    { base: 10, mask: 7 },
  ],
} as const;

/**
 * An armed bomb that has not gone off by turn end carries over with its time
 * reduced by the turn length, never below 5 (seg28:0x0C1A).
 */
export const BOMB_CARRY_MINIMUM_TICKS = 5;

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

/**
 * Fire-control accuracy add, DGROUP 0x1596 (19 words), indexed by the command's
 * first parameter (RE §7b). Aim & Fire passes 0; Scan & Fire passes its
 * Maximum Distance, so a tighter engagement radius aims better. AI-brain teams
 * use a fixed add instead, which RoboArena does not need.
 */
export const FIRE_CONTROL_ACCURACY_ADDS = [
  4, 7, 6, 5, 4, 3, 2, 1, 0, 0, -1, -1, -2, -2, -3, -3, -4, -5, -6,
] as const;

/**
 * Human-team fire-control add (seg6:0x3790): Aim & Fire passes parameter 0
 * (+4); Scan & Fire passes its Maximum Distance. Weapon and target terrain do
 * not enter this term.
 */
export const fireControlAccuracyAdjustment = (
  fireMode: "aim" | "scan",
  scanMaxDistance?: number,
): number => {
  if (fireMode === "aim") return FIRE_CONTROL_ACCURACY_ADDS[0];
  const index = Math.max(0, Math.min(FIRE_CONTROL_ACCURACY_ADDS.length - 1, scanMaxDistance ?? 18));
  return FIRE_CONTROL_ACCURACY_ADDS[index] ?? 0;
};

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
