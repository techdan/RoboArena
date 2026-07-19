import { describe, expect, it } from "vitest";
import {
  GESTURE_MOVE_THRESHOLD_PX,
  MAX_ARENA_SCALE,
  MIN_ARENA_SCALE,
  TouchGestureArbitrator,
  movedBeyondGestureThreshold,
  scaleForPinch,
  transformForPinch,
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

  it("honors a caller-supplied clamp so the movie can use its own zoom bounds", () => {
    const clampMovie = (scale: number): number => Math.min(3, Math.max(0.5, scale));
    // Beyond the planner's 2x ceiling but within the movie's 3x ceiling.
    expect(scaleForPinch(1, 100, 250, clampMovie)).toBe(2.5);
    expect(scaleForPinch(1, 100, 1000, clampMovie)).toBe(3);
    expect(scaleForPinch(1, 100, 1, clampMovie)).toBe(0.5);
    const transformed = transformForPinch({
      initialTransform: { x: 0, y: 0, scale: 1 },
      initialMidpoint: { x: 100, y: 100 },
      currentMidpoint: { x: 100, y: 100 },
      initialDistance: 100,
      currentDistance: 250,
      clampScale: clampMovie,
    });
    expect(transformed.scale).toBe(2.5);
  });

  it("keeps the original world point under the moving pinch midpoint", () => {
    const transformed = transformForPinch({
      initialTransform: { x: 20, y: -10, scale: 1 },
      initialMidpoint: { x: 120, y: 90 },
      currentMidpoint: { x: 130, y: 100 },
      initialDistance: 100,
      currentDistance: 150,
    });
    expect(transformed).toEqual({ x: -20, y: -50, scale: 1.5 });
    expect((130 - transformed.x) / transformed.scale).toBe((120 - 20) / 1);
    expect((100 - transformed.y) / transformed.scale).toBe((90 - -10) / 1);
  });

  it("cancels long press and tap after a drag", () => {
    const gesture = new TouchGestureArbitrator();
    gesture.beginPrimary(1);
    expect(gesture.markMoved(1, { x: 0, y: 0 }, { x: 9, y: 0 })).toBe(true);
    expect(gesture.markMoved(1, { x: 0, y: 0 }, { x: 20, y: 0 })).toBe(true);
    expect(gesture.markLongPressed(1)).toBe(false);
    expect(gesture.end(1)).toBe(false);
  });

  it("cancels the pending tap when a second pointer starts a pinch", () => {
    const gesture = new TouchGestureArbitrator();
    gesture.beginPrimary(1);
    gesture.beginPinch();
    expect(gesture.markLongPressed(1)).toBe(false);
    expect(gesture.end(1)).toBe(false);
  });

  it("does not activate after pointer cancellation", () => {
    const gesture = new TouchGestureArbitrator();
    gesture.beginPrimary(1);
    gesture.cancel();
    expect(gesture.end(1)).toBe(false);
  });

  it("activates a tap once and consumes its compatibility click", () => {
    const gesture = new TouchGestureArbitrator();
    gesture.beginPrimary(1);
    expect(gesture.end(1)).toBe(true);
    expect(gesture.consumeSyntheticClick()).toBe(true);
    expect(gesture.consumeSyntheticClick()).toBe(false);
  });
});
