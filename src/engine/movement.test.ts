import { describe, expect, it } from "vitest";
import { secondsToTicks } from "./constants.js";
import { canTraverse, flipParity, moveStepCostTicks } from "./movement.js";

describe("moveStepCostTicks (alternation)", () => {
  it("single step parity 0 = 0.3 s, parity 1 = 0.7 s", () => {
    expect(moveStepCostTicks(1, 0)).toBe(secondsToTicks(0.3));
    expect(moveStepCostTicks(1, 1)).toBe(secondsToTicks(0.7));
  });

  it("double step parity 0 = 0.4 s, parity 1 = 0.8 s", () => {
    expect(moveStepCostTicks(2, 0)).toBe(secondsToTicks(0.4));
    expect(moveStepCostTicks(2, 1)).toBe(secondsToTicks(0.8));
  });

  it("alternation totals: parity-0 + parity-1 single-pair = 1.0 s", () => {
    const p0 = moveStepCostTicks(1, 0);
    const p1 = moveStepCostTicks(1, 1);
    expect(p0 + p1).toBe(secondsToTicks(1.0));
  });

  it("double-pair total = 1.2 s (matches DOS observation)", () => {
    const p0 = moveStepCostTicks(2, 0);
    const p1 = moveStepCostTicks(2, 1);
    expect(p0 + p1).toBe(secondsToTicks(1.2));
  });
});

describe("flipParity", () => {
  it("toggles 0↔1", () => {
    expect(flipParity(0)).toBe(1);
    expect(flipParity(1)).toBe(0);
  });
});

describe("canTraverse — terrain × posture rules", () => {
  it("walls and outer-walls are impassable for any posture", () => {
    expect(canTraverse("standing", "wall")).toBe(false);
    expect(canTraverse("crouching", "wall")).toBe(false);
    expect(canTraverse("standing", "outer-wall")).toBe(false);
    expect(canTraverse("crouching", "outer-wall")).toBe(false);
  });

  it("crevices are impassable for any posture", () => {
    expect(canTraverse("standing", "crevice")).toBe(false);
    expect(canTraverse("crouching", "crevice")).toBe(false);
  });

  it("standing can cross all non-wall terrain (rough/bush/low-wall confirmed)", () => {
    expect(canTraverse("standing", "open")).toBe(true);
    expect(canTraverse("standing", "rough")).toBe(true);
    expect(canTraverse("standing", "bush")).toBe(true);
    expect(canTraverse("standing", "low-wall")).toBe(true);
  });

  it("crouching can ONLY traverse open ground", () => {
    expect(canTraverse("crouching", "open")).toBe(true);
    expect(canTraverse("crouching", "rough")).toBe(false);
    expect(canTraverse("crouching", "bush")).toBe(false);
    expect(canTraverse("crouching", "low-wall")).toBe(false);
  });
});
