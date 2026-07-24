/** Pure geometry and colour math behind the movie's robot reactions. */

import { describe, expect, it } from "vitest";
import type { TileCoord } from "../engine/types";
import { directionBetween, flinchOffset, mixTint, recoilOffset } from "./reactions";

const at = (x: number, y: number): TileCoord => ({ x, y });
const TILE = 28;

describe("directionBetween", () => {
  it("is a unit vector along the axis of travel", () => {
    expect(directionBetween(at(4, 4), at(9, 4))).toEqual({ x: 1, y: 0 });
    expect(directionBetween(at(4, 4), at(4, 1))).toEqual({ x: 0, y: -1 });
  });

  it("normalizes diagonals rather than letting them run long", () => {
    const diagonal = directionBetween(at(0, 0), at(3, 3));
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1, 10);
    expect(diagonal.x).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it("is zero for coincident tiles instead of NaN", () => {
    expect(directionBetween(at(4, 4), at(4, 4))).toEqual({ x: 0, y: 0 });
  });
});

describe("recoilOffset", () => {
  it("kicks the turret opposite the shot", () => {
    const kick = recoilOffset(at(4, 4), at(9, 4), TILE);
    expect(kick.x).toBeLessThan(0);
    expect(kick.y).toBe(0);
  });

  it("mirrors exactly for opposing shots", () => {
    const east = recoilOffset(at(4, 4), at(9, 4), TILE);
    const west = recoilOffset(at(4, 4), at(0, 4), TILE);
    expect(east.x).toBeCloseTo(-west.x, 10);
  });

  it("stays a fixed fraction of a tile regardless of range", () => {
    const near = recoilOffset(at(4, 4), at(5, 4), TILE);
    const far = recoilOffset(at(4, 4), at(20, 4), TILE);
    expect(Math.hypot(near.x, near.y)).toBeCloseTo(Math.hypot(far.x, far.y), 10);
    expect(Math.hypot(near.x, near.y)).toBeLessThan(TILE / 2);
  });

  it("does not move a turret with no shot direction", () => {
    expect(recoilOffset(at(4, 4), at(4, 4), TILE)).toEqual({ x: 0, y: 0 });
  });
});

describe("flinchOffset", () => {
  it("shoves the target away from the shooter", () => {
    const shove = flinchOffset(at(4, 4), at(9, 4), TILE);
    expect(shove.x).toBeGreaterThan(0);
    expect(shove.y).toBe(0);
  });

  it("jolts upward when the shooter is unknown", () => {
    // An unseen shooter is redacted out of a participant's event stream, so
    // there is no direction to shove along — but the hit must still read.
    const shove = flinchOffset(undefined, at(9, 4), TILE);
    expect(shove.x).toBe(0);
    expect(shove.y).toBeLessThan(0);
  });

  it("jolts upward for a blast centred on the target itself", () => {
    const shove = flinchOffset(at(9, 4), at(9, 4), TILE);
    expect(shove.x).toBe(0);
    expect(shove.y).toBeLessThan(0);
  });

  it("stays within a fraction of a tile so the robot never leaves its cell", () => {
    const shove = flinchOffset(at(0, 0), at(9, 4), TILE);
    expect(Math.hypot(shove.x, shove.y)).toBeLessThan(TILE / 2);
  });
});

describe("mixTint", () => {
  it("returns the endpoints exactly", () => {
    expect(mixTint(0xff6a5a, 0xffffff, 0)).toBe(0xff6a5a);
    expect(mixTint(0xff6a5a, 0xffffff, 1)).toBe(0xffffff);
  });

  it("blends each channel independently", () => {
    expect(mixTint(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(mixTint(0xff0000, 0x00ff00, 0.5)).toBe(0x808000);
  });

  it("clamps rather than producing out-of-range channels", () => {
    expect(mixTint(0x000000, 0xffffff, -4)).toBe(0x000000);
    expect(mixTint(0x000000, 0xffffff, 4)).toBe(0xffffff);
  });

  it("stays a legal 24-bit colour across the whole fade", () => {
    for (let step = 0; step <= 20; step += 1) {
      const tint = mixTint(0xff6a5a, 0xffffff, step / 20);
      expect(tint).toBeGreaterThanOrEqual(0);
      expect(tint).toBeLessThanOrEqual(0xffffff);
    }
  });
});
