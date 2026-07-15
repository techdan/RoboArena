import { describe, expect, it } from "vitest";
import { canTraverse, flipParity, moveStepCostTicks } from "./movement.js";

describe("movement timing", () => {
  it("uses the provisional 18/42 single-step costs", () => {
    expect(moveStepCostTicks(1, 0)).toBe(18);
    expect(moveStepCostTicks(1, 1)).toBe(42);
  });

  it("uses the provisional 24/48 double-step costs", () => {
    expect(moveStepCostTicks(2, 0)).toBe(24);
    expect(moveStepCostTicks(2, 1)).toBe(48);
  });

  it("flips stride parity", () => {
    expect(flipParity(0)).toBe(1);
    expect(flipParity(1)).toBe(0);
  });
});

describe("terrain traversal", () => {
  it.each(["open", "rough", "low-wall", "bush"] as const)("allows Upright onto %s", (terrain) =>
    expect(canTraverse("upright", terrain)).toBe(true),
  );

  it.each(["open", "rough", "low-wall", "bush"] as const)("allows Ducking onto %s", (terrain) =>
    expect(canTraverse("ducking", terrain)).toBe(true),
  );

  it("allows Crouching only on open ground", () => {
    expect(canTraverse("crouching", "open")).toBe(true);
    expect(canTraverse("crouching", "rough")).toBe(false);
    expect(canTraverse("crouching", "low-wall")).toBe(false);
    expect(canTraverse("crouching", "bush")).toBe(false);
  });

  it.each(["wall", "crevice", "outer-wall"] as const)("blocks every posture on %s", (terrain) => {
    expect(canTraverse("upright", terrain)).toBe(false);
    expect(canTraverse("ducking", terrain)).toBe(false);
    expect(canTraverse("crouching", terrain)).toBe(false);
  });
});
