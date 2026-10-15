import { describe, expect, it } from "vitest";
import {
  approachAngle,
  gaitGroups,
  hash01,
  headingYaw,
  hopArc,
  solveLeg,
  Spring,
  tileCenter,
  wrapAngle,
} from "./kinematics";

describe("board to world mapping", () => {
  it("centres tiles and points North at -Z", () => {
    expect(tileCenter({ x: 3, y: 7 })).toEqual({ x: 3.5, z: 7.5 });
    // rotation.y = θ turns +Z into (sin θ, cos θ): North must become (0, -1).
    const yaw = headingYaw("N");
    expect(Math.sin(yaw)).toBeCloseTo(0);
    expect(Math.cos(yaw)).toBeCloseTo(-1);
    const east = headingYaw("E");
    expect(Math.sin(east)).toBeCloseTo(1);
    expect(Math.cos(east)).toBeCloseTo(0);
  });

  it("turns along the shortest arc", () => {
    expect(Math.abs(wrapAngle(3 * Math.PI))).toBeCloseTo(Math.PI);
    const next = approachAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.05);
    expect(next).toBeCloseTo(Math.PI - 0.05);
  });
});

describe("two-bone leg IK", () => {
  const forward = (upper: number, lower: number, reach: number, drop: number) => {
    const s = solveLeg(reach, drop, upper, lower);
    const kx = Math.cos(s.hipPitch) * upper;
    const ky = Math.sin(s.hipPitch) * upper;
    const lowerAbs = s.hipPitch + s.kneePitch;
    return {
      s,
      foot: { x: kx + Math.cos(lowerAbs) * lower, y: ky + Math.sin(lowerAbs) * lower },
      knee: { x: kx, y: ky },
    };
  };

  it("places the foot exactly on a reachable target with the knee raised", () => {
    const { s, foot, knee } = forward(0.34, 0.44, 0.45, -0.42);
    expect(s.clamped).toBe(false);
    expect(foot.x).toBeCloseTo(0.45, 5);
    expect(foot.y).toBeCloseTo(-0.42, 5);
    // Spider stance: knee above the straight hip-to-foot line.
    const lineY = (-0.42 / 0.45) * knee.x;
    expect(knee.y).toBeGreaterThan(lineY);
    expect(s.footPitch).toBeCloseTo(-(s.hipPitch + s.kneePitch));
  });

  it("clamps unreachable targets without NaN", () => {
    const far = solveLeg(5, -0.4, 0.3, 0.4);
    expect(far.clamped).toBe(true);
    expect(Number.isFinite(far.hipPitch)).toBe(true);
    const near = solveLeg(0, 0, 0.3, 0.4);
    expect(Number.isFinite(near.kneePitch)).toBe(true);
  });
});

describe("gait and motion helpers", () => {
  it("alternates diagonal pairs and tripods", () => {
    expect(gaitGroups(4)).toEqual([0, 1, 1, 0]);
    expect(gaitGroups(6)).toEqual([0, 1, 1, 0, 0, 1]);
  });

  it("hops peak at the midpoint", () => {
    expect(hopArc(0)).toBe(0);
    expect(hopArc(0.5)).toBe(1);
    expect(hopArc(1)).toBe(0);
  });

  it("springs settle on their target and survive long frames", () => {
    const spring = new Spring(0);
    spring.target = 1;
    for (let i = 0; i < 120; i += 1) spring.step(1 / 60);
    expect(spring.value).toBeCloseTo(1, 2);
    spring.kick(50);
    spring.step(2);
    expect(Number.isFinite(spring.value)).toBe(true);
  });

  it("hashes deterministically", () => {
    expect(hash01("robot-a")).toBe(hash01("robot-a"));
    expect(hash01("robot-a")).not.toBe(hash01("robot-b"));
    expect(hash01("x", 3)).toBeGreaterThanOrEqual(0);
    expect(hash01("x", 3)).toBeLessThan(1);
  });
});
