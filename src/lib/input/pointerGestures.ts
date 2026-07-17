export const LONG_PRESS_MS = 550;
export const GESTURE_MOVE_THRESHOLD_PX = 8;
export const MIN_ARENA_SCALE = 0.75;
export const MAX_ARENA_SCALE = 2;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export const pointDistance = (left: Point, right: Point): number =>
  Math.hypot(right.x - left.x, right.y - left.y);

export const movedBeyondGestureThreshold = (start: Point, current: Point): boolean =>
  pointDistance(start, current) > GESTURE_MOVE_THRESHOLD_PX;

export const clampArenaScale = (scale: number): number =>
  Math.max(MIN_ARENA_SCALE, Math.min(MAX_ARENA_SCALE, scale));

export const scaleForPinch = (
  initialScale: number,
  initialDistance: number,
  distance: number,
): number =>
  clampArenaScale(
    initialDistance <= 0 ? initialScale : initialScale * (distance / initialDistance),
  );
