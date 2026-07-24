/**
 * Robot reactions to resolution events: weapon recoil, damage flinch, death
 * collapse, and the deploy drop-in.
 *
 * `effects.ts` draws what happens *at a tile* — flashes, tracers, explosions.
 * This module makes the robots themselves acknowledge those events, which is
 * what turns an explosion sprite into a hit that landed.
 *
 * Every reaction writes to `RobotVisual.react` or `RobotVisual.recoil`. Both
 * are owned exclusively here: the movement profile rewrites `container` and
 * `lift` on every snapshot, so a reaction parked on those layers would be
 * erased by the next redraw of an unrelated robot.
 *
 * Durations scale with playback speed for the same reason effect lifetimes do —
 * beats shrink at 2x and 4x, and a reaction outliving its beat reads as lag.
 */

import { gsap } from "gsap";
import type { TileCoord } from "../engine/types";
import type { ParticipantResolutionEvent } from "../lib/net/protocol";
import type { RobotVisual } from "./RobotSprite";

/** Weapon kick, as a fraction of tile size. */
const RECOIL_DISTANCE = 0.16;
/** Shove away from the damage source, as a fraction of tile size. */
const FLINCH_DISTANCE = 0.18;
/** Multiply-blend red; the body is steel and paint, so this reads as a hit. */
const DAMAGE_TINT = 0xff6a5a;
const NEUTRAL_TINT = 0xffffff;
/** Height a deploying robot falls from, as a fraction of tile size. */
const DEPLOY_DROP_HEIGHT = 1.6;

export interface Vector {
  readonly x: number;
  readonly y: number;
}

const ZERO: Vector = { x: 0, y: 0 };

/** Channel-wise blend between two 0xRRGGBB tints; `t` 0 is `from`, 1 is `to`. */
export const mixTint = (from: number, to: number, t: number): number => {
  const amount = Math.min(1, Math.max(0, t));
  const channel = (shift: number) => {
    const start = (from >> shift) & 0xff;
    const end = (to >> shift) & 0xff;
    return Math.round(start + (end - start) * amount) << shift;
  };
  return channel(16) | channel(8) | channel(0);
};

/** Per-visual tint driver, kept off `RobotVisual` but still killable. */
const tintDrivers = new WeakMap<RobotVisual, { value: number }>();

const tintDriverFor = (visual: RobotVisual): { value: number } => {
  const existing = tintDrivers.get(visual);
  if (existing !== undefined) return existing;
  const created = { value: 1 };
  tintDrivers.set(visual, created);
  return created;
};

/** Unit vector from one tile toward another; zero when they coincide. */
export const directionBetween = (from: TileCoord, to: TileCoord): Vector => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return length === 0 ? ZERO : { x: dx / length, y: dy / length };
};

/** Kick opposes the shot, so a robot firing east is pushed west.
 *  The `+ 0` normalizes IEEE negative zero, keeping offsets comparable. */
export const recoilOffset = (from: TileCoord, to: TileCoord, tileSize: number): Vector => {
  const direction = directionBetween(from, to);
  return {
    x: -direction.x * tileSize * RECOIL_DISTANCE + 0,
    y: -direction.y * tileSize * RECOIL_DISTANCE + 0,
  };
};

/**
 * Shove away from whatever dealt the damage.
 *
 * The source is often unknown — an unseen shooter is redacted out of a
 * participant's event stream — so an absent or co-located source falls back to
 * a straight upward jolt, which still reads as taking a hit.
 */
export const flinchOffset = (
  source: TileCoord | undefined,
  target: TileCoord,
  tileSize: number,
): Vector => {
  const direction = source === undefined ? ZERO : directionBetween(source, target);
  if (direction.x === 0 && direction.y === 0) return { x: 0, y: -tileSize * FLINCH_DISTANCE };
  return {
    x: direction.x * tileSize * FLINCH_DISTANCE,
    y: direction.y * tileSize * FLINCH_DISTANCE,
  };
};

export interface ReactionOptions {
  readonly reducedMotion: boolean;
  readonly speed: number;
}

const restReact = (visual: RobotVisual) => {
  gsap.killTweensOf([visual.react, visual.react.position, visual.react.scale]);
  gsap.killTweensOf([visual.recoil.position, tintDriverFor(visual)]);
  visual.react.position.set(0, visual.groundY);
  visual.react.scale.set(1);
  visual.react.rotation = 0;
  visual.react.alpha = 1;
  visual.recoil.position.set(0, 0);
  visual.body.tint = NEUTRAL_TINT;
};

/** Puts every reacting layer back to neutral; used on seeks and reduced motion. */
export const resetRobotReactions = (visuals: Iterable<RobotVisual>) => {
  for (const visual of visuals) restReact(visual);
};

const fire = (visual: RobotVisual, from: TileCoord, target: TileCoord, secs: number) => {
  const kick = recoilOffset(from, target, visual.tileSize);
  gsap.killTweensOf(visual.recoil.position);
  gsap
    .timeline()
    .to(visual.recoil.position, { x: kick.x, y: kick.y, duration: secs * 0.35, ease: "power3.out" })
    .to(visual.recoil.position, { x: 0, y: 0, duration: secs * 0.65, ease: "power2.out" });
};

const flinch = (
  visual: RobotVisual,
  source: TileCoord | undefined,
  target: TileCoord,
  secs: number,
) => {
  const shove = flinchOffset(source, target, visual.tileSize);
  gsap.killTweensOf(visual.react.position);
  gsap
    .timeline()
    .to(visual.react.position, {
      x: shove.x,
      y: visual.groundY + shove.y,
      duration: secs * 0.3,
      ease: "power3.out",
    })
    .to(visual.react.position, {
      x: 0,
      y: visual.groundY,
      duration: secs * 0.7,
      ease: "elastic.out(1, 0.6)",
    });

  // Pixi tints multiply, so the flash washes the hull red and fades back out.
  const driver = tintDriverFor(visual);
  gsap.killTweensOf(driver);
  driver.value = 0;
  visual.body.tint = DAMAGE_TINT;
  gsap.to(driver, {
    value: 1,
    duration: secs,
    ease: "power2.out",
    onUpdate: () => {
      visual.body.tint = mixTint(DAMAGE_TINT, NEUTRAL_TINT, driver.value);
    },
    onComplete: () => {
      visual.body.tint = NEUTRAL_TINT;
    },
  });
};

const collapse = (visual: RobotVisual, secs: number) => {
  gsap.killTweensOf([visual.react, visual.react.position, visual.react.scale]);
  // Folds onto the ground anchor: a hull losing its legs, not a shrinking sprite.
  gsap
    .timeline()
    .to(visual.react, { rotation: 0.22, duration: secs * 0.25, ease: "power3.out" })
    .to(visual.react.scale, { x: 1.14, y: 0.72, duration: secs * 0.45, ease: "power2.in" }, 0)
    .to(visual.react, { rotation: 0.12, duration: secs * 0.75, ease: "power2.out" });
};

const deploy = (visual: RobotVisual, secs: number) => {
  gsap.killTweensOf([visual.react, visual.react.position, visual.react.scale]);
  visual.react.position.set(0, visual.groundY - visual.tileSize * DEPLOY_DROP_HEIGHT);
  visual.react.alpha = 0;
  gsap.to(visual.react, { alpha: 1, duration: secs * 0.35 });
  gsap
    .timeline()
    .to(visual.react.position, {
      y: visual.groundY,
      duration: secs * 0.62,
      ease: "power2.in",
    })
    .to(visual.react.scale, { x: 1.16, y: 0.82, duration: secs * 0.12, ease: "power2.out" })
    .to(visual.react.scale, { x: 1, y: 1, duration: secs * 0.26, ease: "back.out(2)" });
};

export interface ReactionContext {
  readonly visualOf: (robotId: string) => RobotVisual | undefined;
  readonly tileOf: (robotId: string) => TileCoord | undefined;
}

/**
 * Applies one snapshot's worth of robot reactions.
 *
 * Events arrive in resolution order, so a robot damaged and destroyed in the
 * same tick collapses last and wins the layer — which is the reading we want.
 */
export const applyRobotReactions = (
  events: readonly ParticipantResolutionEvent[],
  context: ReactionContext,
  options: ReactionOptions,
) => {
  if (options.reducedMotion) return;
  const speed = Math.max(options.speed, 0.01);

  for (const event of events) {
    if (event.kind === "fired") {
      const visual = context.visualOf(event.shooterId);
      const from = context.tileOf(event.shooterId);
      if (visual !== undefined && from !== undefined)
        fire(visual, from, event.target, 0.22 / speed);
    }
    if (event.kind === "damaged") {
      const visual = context.visualOf(event.targetId);
      const target = context.tileOf(event.targetId);
      if (visual !== undefined && target !== undefined) {
        // An unseen shooter is redacted out of this participant's stream, so
        // the source tile may be unknown; flinchOffset falls back to a jolt.
        const source = event.sourceId === undefined ? undefined : context.tileOf(event.sourceId);
        flinch(visual, source, target, 0.34 / speed);
      }
    }
    if (event.kind === "destroyed") {
      const visual = context.visualOf(event.robotId);
      if (visual !== undefined) collapse(visual, 0.5 / speed);
    }
    if (event.kind === "deployed") {
      const visual = context.visualOf(event.robotId);
      if (visual !== undefined) deploy(visual, 0.42 / speed);
    }
  }
};
