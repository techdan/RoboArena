import { describe, expect, it } from "vitest";
import {
  GESTURE_MOVE_THRESHOLD_PX,
  MAX_ARENA_SCALE,
  MIN_ARENA_SCALE,
  movedBeyondGestureThreshold,
  scaleForPinch,
} from "./pointerGestures.js";

describe("pointer gesture arbitration", () => {
  it("keeps small finger jitter eligible for a tap or long press", () => {
    expect(
      movedBeyondGestureThreshold({ x: 0, y: 0 }, { x: GESTURE_MOVE_THRESHOLD_PX, y: 0 }),
    ).toBe(false);
    expect(
      movedBeyondGestureThreshold({ x: 0, y: 0 }, { x: GESTURE_MOVE_THRESHOLD_PX + 1, y: 0 }),
    ).toBe(true);
  });

  it("scales relative to the initial two-pointer distance and clamps extremes", () => {
    expect(scaleForPinch(1, 100, 150)).toBe(1.5);
    expect(scaleForPinch(1, 100, 1000)).toBe(MAX_ARENA_SCALE);
    expect(scaleForPinch(1, 100, 1)).toBe(MIN_ARENA_SCALE);
  });
});
