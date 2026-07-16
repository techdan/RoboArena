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
    expect(postureChangeCostTicks("upright", "ducking")).toBe(10);
    expect(postureChangeCostTicks("ducking", "crouching")).toBe(10);
  });

  it("sets any different posture with one absolute command", () => {
    expect(postureChangeCostTicks("upright", "crouching")).toBe(10);
    expect(postureChangeCostTicks("upright", "upright")).toBe(0);
  });

  it("sets any different scan heading with one absolute command", () => {
    expect(scanRotationCostTicks("N", "W")).toBe(5);
    expect(scanRotationCostTicks("N", "NW")).toBe(5);
    expect(scanRotationCostTicks("N", "N")).toBe(0);
  });

  it("derives fixed single and double move durations", () => {
    expect(moveStepDurationTicks({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(30);
    expect(moveStepDurationTicks({ x: 0, y: 0 }, { x: 2, y: 0 })).toBe(40);
  });

  it("rejects a zero-length or oversized move step", () => {
    expect(moveStepDurationTicks({ x: 0, y: 0 }, { x: 0, y: 0 })).toBeNull();
    expect(moveStepDurationTicks({ x: 0, y: 0 }, { x: 3, y: 0 })).toBeNull();
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
