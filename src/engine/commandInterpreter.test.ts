import { describe, expect, it } from "vitest";

import {
  commandDurationTicks,
  moveStepDurationTicks,
  postureChangeCostTicks,
  scanRotationCostTicks,
} from "./commandInterpreter.js";
import { makeRobot } from "./__fixtures__/match.js";

describe("command interpreter timing", () => {
  it("charges one posture step for adjacent postures", () => {
    expect(postureChangeCostTicks("upright", "ducking")).toBe(6);
    expect(postureChangeCostTicks("ducking", "crouching")).toBe(6);
  });

  it("charges two posture steps from upright to crouching", () => {
    expect(postureChangeCostTicks("upright", "crouching")).toBe(12);
  });

  it("uses the shortest scan rotation and wraps around north", () => {
    expect(scanRotationCostTicks("N", "W")).toBe(12);
    expect(scanRotationCostTicks("N", "NW")).toBe(6);
  });

  it("derives alternating single and double move durations", () => {
    expect(moveStepDurationTicks({ x: 0, y: 0 }, { x: 1, y: 0 }, 0)).toBe(18);
    expect(moveStepDurationTicks({ x: 0, y: 0 }, { x: 1, y: 0 }, 1)).toBe(42);
    expect(moveStepDurationTicks({ x: 0, y: 0 }, { x: 2, y: 0 }, 0)).toBe(24);
    expect(moveStepDurationTicks({ x: 0, y: 0 }, { x: 2, y: 0 }, 1)).toBe(48);
  });

  it("rejects a zero-length or oversized move step", () => {
    expect(moveStepDurationTicks({ x: 0, y: 0 }, { x: 0, y: 0 }, 0)).toBeNull();
    expect(moveStepDurationTicks({ x: 0, y: 0 }, { x: 3, y: 0 }, 0)).toBeNull();
  });

  it("derives direct-fire duration from the catalog rather than the order", () => {
    const robot = makeRobot("r1", "team-1", "rifle", { x: 1, y: 1 });
    expect(
      commandDurationTicks(
        { kind: "aim-and-fire", target: { x: 2, y: 1 }, weapon: "rifle", repeat: false },
        robot,
        30,
      ),
    ).toBe(30);
  });
});
