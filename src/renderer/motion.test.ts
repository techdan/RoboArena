/** Locked "mechanical stomp" hop profile and move-step presentation planning. */

import { describe, expect, it } from "vitest";
import { MOVE_DOUBLE_COST_TICKS, MOVE_SINGLE_COST_TICKS } from "../engine/constants";
import type { TileCoord } from "../engine/types";
import {
  movementDurationMs,
  planMovement,
  RESTING_POSE,
  sampleTrack,
  samplePlan,
  STOMP_TRACKS,
  type MotionTrack,
  type MovementPlan,
} from "./motion";

const at = (x: number, y: number): TileCoord => ({ x, y });

/** Evaluates a plan across a fine grid; hop keyframes sit on 0.02 boundaries. */
const scan = (plan: MovementPlan, steps = 500) =>
  Array.from({ length: steps + 1 }, (_, index) => {
    const u = index / steps;
    return { u, pose: samplePlan(plan, u) };
  });

const argMin = <T>(samples: readonly T[], of: (sample: T) => number): T => {
  const best = samples.reduce((low, sample) => (of(sample) < of(low) ? sample : low));
  return best;
};

describe("keyframe sampling", () => {
  const track: MotionTrack = [
    { at: 0, value: 0 },
    { at: 0.5, value: 10 },
    { at: 1, value: 4 },
  ];

  it("clamps outside the track instead of extrapolating", () => {
    expect(sampleTrack(track, -3)).toBe(0);
    expect(sampleTrack(track, 0)).toBe(0);
    expect(sampleTrack(track, 1)).toBe(4);
    expect(sampleTrack(track, 9)).toBe(4);
  });

  it("returns keyframe values exactly at their own positions", () => {
    expect(sampleTrack(track, 0.5)).toBe(10);
  });

  it("interpolates linearly when no ease is given", () => {
    expect(sampleTrack(track, 0.25)).toBeCloseTo(5, 10);
    expect(sampleTrack(track, 0.75)).toBeCloseTo(7, 10);
  });

  it("applies the ease that reaches a keyframe, not the one that leaves it", () => {
    const eased: MotionTrack = [
      { at: 0, value: 0 },
      { at: 1, value: 1, ease: "power2Out" },
    ];
    // power2Out is front-loaded: half way through time is well past half way
    // through the value.
    expect(sampleTrack(eased, 0.5)).toBeGreaterThan(0.8);
    expect(sampleTrack(eased, 1)).toBe(1);
  });
});

describe("movement duration", () => {
  it("spends the engine's own step budget rather than a cosmetic constant", () => {
    expect(movementDurationMs(MOVE_SINGLE_COST_TICKS, 1)).toBe(500);
    expect(movementDurationMs(MOVE_DOUBLE_COST_TICKS, 1)).toBeCloseTo(666.67, 1);
  });

  it("scales with playback speed so motion tracks the movie clock", () => {
    expect(movementDurationMs(MOVE_SINGLE_COST_TICKS, 2)).toBe(250);
    expect(movementDurationMs(MOVE_SINGLE_COST_TICKS, 4)).toBe(125);
    expect(movementDurationMs(MOVE_SINGLE_COST_TICKS, 0.5)).toBe(1000);
  });
});

describe("move-step planning", () => {
  it("hops once for an adjacent tile, on the single-step budget", () => {
    const plan = planMovement(at(4, 4), at(5, 4), 1);
    expect(plan).toMatchObject({
      kind: "single",
      ticks: MOVE_SINGLE_COST_TICKS,
      hops: 1,
      durationMs: 500,
    });
  });

  it("hops twice through the exact via tile for straight two-tile chunks", () => {
    for (const to of [at(6, 4), at(2, 4), at(4, 6), at(6, 6), at(2, 2)]) {
      expect(planMovement(at(4, 4), to, 1), `${to.x},${to.y}`).toMatchObject({
        kind: "double-straight",
        ticks: MOVE_DOUBLE_COST_TICKS,
        hops: 2,
      });
    }
  });

  it("leaps once for dogleg two-tile chunks whose via tile is unrecoverable", () => {
    // chunkMovementPath permits {to:+2,+1, via:+1,0} — the midpoint is not a
    // tile centre, so a two-hop reading would plant a foot off-grid.
    for (const to of [at(6, 5), at(5, 6), at(6, 3), at(3, 6)]) {
      expect(planMovement(at(4, 4), to, 1), `${to.x},${to.y}`).toMatchObject({
        kind: "double-dogleg",
        ticks: MOVE_DOUBLE_COST_TICKS,
        hops: 1,
      });
    }
  });

  it("snaps instead of animating when there is no movement to present", () => {
    expect(planMovement(at(4, 4), at(4, 4), 1)).toBeNull();
  });

  it("snaps scrub jumps rather than inventing motion the engine never resolved", () => {
    expect(planMovement(at(4, 4), at(7, 4), 1)).toBeNull();
    expect(planMovement(at(4, 4), at(0, 0), 1)).toBeNull();
  });

  it("mirrors the hull lean so travel always leads", () => {
    expect(planMovement(at(4, 4), at(5, 4), 1)?.leanSign).toBe(1);
    expect(planMovement(at(4, 4), at(3, 4), 1)?.leanSign).toBe(-1);
    expect(planMovement(at(4, 4), at(4, 3), 1)?.leanSign).toBe(-1);
    expect(planMovement(at(4, 4), at(4, 5), 1)?.leanSign).toBe(1);
  });
});

describe("stomp pose", () => {
  const single = planMovement(at(4, 4), at(5, 4), 1);
  if (single === null) throw new Error("An adjacent step must be planned.");

  it("starts and ends exactly at rest so repeated steps cannot drift", () => {
    expect(samplePlan(single, 0)).toEqual({ ...RESTING_POSE, progress: 0 });
    expect(samplePlan(single, 1)).toEqual(RESTING_POSE);
  });

  it("clamps outside the hop instead of extrapolating the settle", () => {
    expect(samplePlan(single, -1)).toEqual({ ...RESTING_POSE, progress: 0 });
    expect(samplePlan(single, 4)).toEqual(RESTING_POSE);
  });

  it("leaves the ground and returns, peaking at the locked apex height", () => {
    const apex = argMin(scan(single), (sample) => sample.pose.lift);
    expect(apex.pose.lift).toBeCloseTo(-0.23, 3);
    expect(apex.u).toBeCloseTo(0.3, 2);
  });

  it("pre-loads into a crouch before launching", () => {
    const preload = samplePlan(single, 0.1);
    expect(preload.lift).toBeGreaterThan(0); // still settling downward
    expect(preload.scaleY).toBeLessThan(1); // hull compresses
    expect(preload.scaleX).toBeGreaterThan(1);
    expect(preload.progress).toBe(0); // no ground covered yet
  });

  it("is back-loaded: the landing outweighs the launch", () => {
    const samples = scan(single);
    const apex = argMin(samples, (sample) => sample.pose.lift);
    const deepestSquash = argMin(samples, (sample) => sample.pose.scaleY);

    // This is the property that separates the approved stomp from the springy
    // hop, which puts its loudest beat at the apex instead.
    expect(deepestSquash.u).toBeGreaterThan(apex.u);
    expect(deepestSquash.u).toBeCloseTo(0.8, 2);
    expect(deepestSquash.pose.scaleY).toBeCloseTo(0.86, 3);
    expect(deepestSquash.pose.scaleY).toBeLessThan(samplePlan(single, 0.1).scaleY);
  });

  it("covers ground monotonically, with most of it spent by the apex", () => {
    const samples = scan(single);
    let previous = -1;
    for (const { pose } of samples) {
      expect(pose.progress).toBeGreaterThanOrEqual(previous);
      previous = pose.progress;
    }
    expect(samplePlan(single, 0.3).progress).toBeGreaterThan(0.4);
    expect(samplePlan(single, 0.72).progress).toBeCloseTo(1, 6);
  });

  it("lifts the shadow's read off the ground and snaps it back on impact", () => {
    const apex = samplePlan(single, 0.3);
    expect(apex.shadowScale).toBeCloseTo(0.7, 3);
    expect(apex.shadowAlpha).toBeCloseTo(0.52, 3);

    const landed = samplePlan(single, 0.72);
    expect(landed.shadowScale).toBeCloseTo(1, 3);
    expect(landed.shadowAlpha).toBeCloseTo(1, 3);
  });

  it("cants the hull into travel and releases it on impact", () => {
    expect(samplePlan(single, 0.4).leanDegrees).toBeCloseTo(5, 6);
    expect(samplePlan(single, 0.8).leanDegrees).toBeCloseTo(0, 6);

    const west = planMovement(at(4, 4), at(3, 4), 1);
    if (west === null) throw new Error("An adjacent step must be planned.");
    expect(samplePlan(west, 0.4).leanDegrees).toBeCloseTo(-5, 6);
  });

  it("plants a foot on the real via tile midway through a straight double", () => {
    const double = planMovement(at(4, 4), at(6, 4), 1);
    if (double === null) throw new Error("A straight double must be planned.");

    expect(samplePlan(double, 0.5).progress).toBeCloseTo(0.5, 10);
    expect(samplePlan(double, 0.5).lift).toBe(0); // grounded at the waypoint
    expect(samplePlan(double, 1).progress).toBe(1);

    // Two distinct arcs rather than one long float.
    expect(samplePlan(double, 0.15).lift).toBeCloseTo(-0.23, 3);
    expect(samplePlan(double, 0.65).lift).toBeCloseTo(-0.23, 3);
  });

  it("keeps a dogleg double as one leap", () => {
    const dogleg = planMovement(at(4, 4), at(6, 5), 1);
    if (dogleg === null) throw new Error("A dogleg double must be planned.");
    expect(samplePlan(dogleg, 0.5).lift).toBeLessThan(0); // still airborne
  });
});

describe("stomp track source lock", () => {
  it("keeps every track anchored at both ends of the hop", () => {
    for (const [name, track] of Object.entries(STOMP_TRACKS)) {
      expect(track[0]?.at, name).toBe(0);
      expect(track[track.length - 1]?.at, name).toBe(1);
    }
  });
});
