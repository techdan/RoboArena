/**
 * Pure movement motion for the Phase 7 movie hop rig.
 *
 * Two sources constrain everything here:
 *
 *  - `docs/implementation-plan.md` §5 "Animation timings" requires a move step's
 *    presentation to fill the selector budget the engine already spent — 0.50 s
 *    single / 0.67 s double — rather than a fixed cosmetic duration. The prior
 *    renderer tweened every step over 0.18 s and stood still for the remaining
 *    ~0.32 s, which is what read as sliding.
 *  - The locked Foundry Plate art direction (`docs/asset-manifest.md`) specifies
 *    movement as a transform-only two-frame hop — no drawn frames — pivoting on
 *    the rig's ground anchor at body-space (64, 93).
 *
 * The approved profile is "mechanical stomp": back-loaded, so the landing is the
 * loudest beat and weight lives in the recovery. Keyframes were reviewed against
 * springy/skitter alternatives on a side-by-side motion bench before locking.
 *
 * Everything in this module is pure and frame-rate independent. Callers drive a
 * normalized clock `u` from 0 to 1 and read back a pose; there is no Pixi, no
 * GSAP, and no notion of wall-clock time.
 */

import {
  MOVE_DOUBLE_COST_TICKS,
  MOVE_SINGLE_COST_TICKS,
  TICKS_PER_SECOND,
} from "../engine/constants";
import type { TileCoord } from "../engine/types";

type Ease = "linear" | "power1Out" | "power2In" | "power2Out" | "power3Out" | "backOut";

/** `backOut` overshoot, matching GSAP's default `back` configuration closely
 *  enough that hand-tuned keyframes read the same either side of the boundary. */
const BACK_OVERSHOOT = 1.9;

const EASINGS: Readonly<Record<Ease, (t: number) => number>> = {
  linear: (t) => t,
  power1Out: (t) => 1 - (1 - t) ** 2,
  power2In: (t) => t ** 3,
  power2Out: (t) => 1 - (1 - t) ** 3,
  power3Out: (t) => 1 - (1 - t) ** 4,
  backOut: (t) => 1 + (BACK_OVERSHOOT + 1) * (t - 1) ** 3 + BACK_OVERSHOOT * (t - 1) ** 2,
};

export interface Keyframe {
  /** Normalized position within the hop, 0 to 1. */
  readonly at: number;
  readonly value: number;
  /** Ease used to *reach* this keyframe from the previous one. */
  readonly ease?: Ease;
}

/** Non-empty by construction so the first keyframe is always addressable. */
export type MotionTrack = readonly [Keyframe, ...Keyframe[]];

/** Reads a keyframe track at normalized hop position `u`, clamping at both ends. */
export const sampleTrack = (track: MotionTrack, u: number): number => {
  const first = track[0];
  if (u <= first.at) return first.value;
  for (let index = 1; index < track.length; index += 1) {
    const previous = track[index - 1];
    const next = track[index];
    if (previous === undefined || next === undefined) break;
    if (u > next.at) continue;
    const span = next.at - previous.at;
    const t = span <= 0 ? 1 : (u - previous.at) / span;
    const eased = EASINGS[next.ease ?? "linear"](t);
    return previous.value + (next.value - previous.value) * eased;
  }
  return track[track.length - 1]?.value ?? first.value;
};

/**
 * The locked "mechanical stomp" profile, one hop, normalized to 0..1.
 *
 * `progress` is ground travel across the hop's own tile. `lift` is a fraction of
 * tile size where negative is airborne. `scaleX`/`scaleY` pivot on the ground
 * anchor — scaling about the sprite centre would read as inflating rather than
 * compressing under load. `shadowAlpha` multiplies the rig's base shadow alpha.
 *
 * Structure: pre-load crouch to t 0.10, launch and apex at t 0.30, gravity fall
 * landing at t 0.72, impact squash peaking at t 0.80, settle by t 1.
 */
export const STOMP_TRACKS = {
  progress: [
    { at: 0, value: 0 },
    { at: 0.1, value: 0 },
    { at: 0.42, value: 0.72, ease: "power2Out" },
    { at: 0.72, value: 1, ease: "power1Out" },
    { at: 1, value: 1 },
  ],
  lift: [
    { at: 0, value: 0 },
    { at: 0.1, value: 0.02, ease: "power1Out" },
    { at: 0.3, value: -0.23, ease: "power3Out" },
    { at: 0.72, value: 0, ease: "power2In" },
    { at: 1, value: 0 },
  ],
  scaleX: [
    { at: 0, value: 1 },
    { at: 0.1, value: 1.05 },
    { at: 0.3, value: 0.97, ease: "power2Out" },
    { at: 0.72, value: 1 },
    { at: 0.8, value: 1.12, ease: "power2Out" },
    { at: 1, value: 1, ease: "backOut" },
  ],
  scaleY: [
    { at: 0, value: 1 },
    { at: 0.1, value: 0.93 },
    { at: 0.3, value: 1.05, ease: "power2Out" },
    { at: 0.72, value: 1 },
    { at: 0.8, value: 0.86, ease: "power2Out" },
    { at: 1, value: 1, ease: "backOut" },
  ],
  lean: [
    { at: 0, value: 0 },
    { at: 0.12, value: 5, ease: "power2Out" },
    { at: 0.7, value: 5 },
    { at: 0.8, value: 0, ease: "power2Out" },
    { at: 1, value: 0 },
  ],
  shadowScale: [
    { at: 0, value: 1 },
    { at: 0.1, value: 1.06 },
    { at: 0.3, value: 0.7, ease: "power2Out" },
    { at: 0.72, value: 1, ease: "power2In" },
    { at: 0.8, value: 1.1 },
    { at: 1, value: 1, ease: "backOut" },
  ],
  shadowAlpha: [
    { at: 0, value: 1 },
    { at: 0.3, value: 0.52, ease: "power2Out" },
    { at: 0.72, value: 1, ease: "power2In" },
    { at: 1, value: 1 },
  ],
} as const satisfies Readonly<Record<string, MotionTrack>>;

/**
 * How a single `move-step` event is presented.
 *
 * The event carries only `to`, so a two-tile chunk's intermediate `via` tile is
 * not recoverable from the movie stream (`chunkMovementPath` permits doglegs
 * such as +2,+1). Straight two-tile chunks have an exact integral midpoint and
 * get two hops through it; doglegs get one longer leap rather than inventing a
 * waypoint that may cut a corner through a wall.
 */
export type MovementStepKind = "single" | "double-straight" | "double-dogleg";

export interface MovementPlan {
  readonly kind: MovementStepKind;
  /** Engine cost of the step; the presentation is sized from this, not guessed. */
  readonly ticks: number;
  /** Hops performed across the step: 2 only for straight two-tile chunks. */
  readonly hops: 1 | 2;
  readonly durationMs: number;
  /** Direction the hull cants into; mirrors so travel always leads. */
  readonly leanSign: -1 | 0 | 1;
}

export interface MovementPose {
  /** 0 at `from`, 1 at `to`. */
  readonly progress: number;
  /** Tile fractions; negative is airborne. */
  readonly lift: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly leanDegrees: number;
  readonly shadowScale: number;
  /** Multiplier on the rig's base shadow alpha. */
  readonly shadowAlpha: number;
}

/** Neutral standing pose; also the exact pose a completed hop settles into. */
export const RESTING_POSE: MovementPose = {
  progress: 1,
  lift: 0,
  scaleX: 1,
  scaleY: 1,
  leanDegrees: 0,
  shadowScale: 1,
  shadowAlpha: 1,
};

/**
 * Wall-clock length of a step at a given playback speed.
 *
 * `presentationDelayMs` advances the movie by whole presentation frames, so a
 * 30-tick step occupies 500 ms at 1x; deriving the tween from the same tick cost
 * keeps motion and the clock that drives it in agreement at every speed.
 */
export const movementDurationMs = (ticks: number, speed: number): number =>
  ((ticks / TICKS_PER_SECOND) * 1000) / Math.max(speed, 0.01);

const chebyshev = (from: TileCoord, to: TileCoord): number =>
  Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));

/**
 * Plans the presentation of one move step, or returns `null` when the sprite
 * should simply snap.
 *
 * Snapping covers standing still and any jump beyond two tiles — the latter is
 * a scrub or a resumed movie rather than movement, and hopping it would invent
 * motion the engine never resolved.
 */
export const planMovement = (
  from: TileCoord,
  to: TileCoord,
  speed: number,
): MovementPlan | null => {
  const distance = chebyshev(from, to);
  if (distance === 0 || distance > 2) return null;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const leanSign = (dx !== 0 ? Math.sign(dx) : Math.sign(dy)) as -1 | 0 | 1;

  if (distance === 1) {
    return {
      kind: "single",
      ticks: MOVE_SINGLE_COST_TICKS,
      hops: 1,
      durationMs: movementDurationMs(MOVE_SINGLE_COST_TICKS, speed),
      leanSign,
    };
  }

  const straight = (dx === 0 || Math.abs(dx) === 2) && (dy === 0 || Math.abs(dy) === 2);
  return {
    kind: straight ? "double-straight" : "double-dogleg",
    ticks: MOVE_DOUBLE_COST_TICKS,
    hops: straight ? 2 : 1,
    durationMs: movementDurationMs(MOVE_DOUBLE_COST_TICKS, speed),
    leanSign,
  };
};

/**
 * Samples a planned step at normalized position `u` across the whole step.
 *
 * Two-hop plans run the profile twice, so `progress` reaches exactly 0.5 — the
 * real `via` tile — at the hop boundary, and the robot plants a foot there.
 */
export const samplePlan = (plan: MovementPlan, u: number): MovementPose => {
  const clamped = Math.min(1, Math.max(0, u));
  const hopIndex = Math.min(plan.hops - 1, Math.floor(clamped * plan.hops));
  const hopU = Math.min(1, clamped * plan.hops - hopIndex);
  return {
    progress: (hopIndex + sampleTrack(STOMP_TRACKS.progress, hopU)) / plan.hops,
    lift: sampleTrack(STOMP_TRACKS.lift, hopU),
    scaleX: sampleTrack(STOMP_TRACKS.scaleX, hopU),
    scaleY: sampleTrack(STOMP_TRACKS.scaleY, hopU),
    leanDegrees: sampleTrack(STOMP_TRACKS.lean, hopU) * plan.leanSign,
    shadowScale: sampleTrack(STOMP_TRACKS.shadowScale, hopU),
    shadowAlpha: sampleTrack(STOMP_TRACKS.shadowAlpha, hopU),
  };
};
