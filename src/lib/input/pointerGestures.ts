export const LONG_PRESS_MS = 550;
export const GESTURE_MOVE_THRESHOLD_PX = 8;
export const MIN_ARENA_SCALE = 0.75;
export const MAX_ARENA_SCALE = 2;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface ArenaTransform {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
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
  clampScale: (scale: number) => number = clampArenaScale,
): number =>
  clampScale(initialDistance <= 0 ? initialScale : initialScale * (distance / initialDistance));

export const transformForPinch = ({
  initialTransform,
  initialMidpoint,
  currentMidpoint,
  initialDistance,
  currentDistance,
  clampScale = clampArenaScale,
}: {
  readonly initialTransform: ArenaTransform;
  readonly initialMidpoint: Point;
  readonly currentMidpoint: Point;
  readonly initialDistance: number;
  readonly currentDistance: number;
  readonly clampScale?: (scale: number) => number;
}): ArenaTransform => {
  const scale = scaleForPinch(initialTransform.scale, initialDistance, currentDistance, clampScale);
  const scaleRatio = scale / initialTransform.scale;
  return {
    x: currentMidpoint.x - (initialMidpoint.x - initialTransform.x) * scaleRatio,
    y: currentMidpoint.y - (initialMidpoint.y - initialTransform.y) * scaleRatio,
    scale,
  };
};

type GesturePhase = "idle" | "pending-tap" | "dragging" | "pinching" | "long-pressed";

/**
 * Owns the mutually-exclusive touch outcomes that browsers otherwise expose as
 * overlapping pointer/click sequences. Geometry and rendering remain in the
 * caller; this adapter decides whether releasing the primary pointer is a tap.
 */
export class TouchGestureArbitrator {
  #phase: GesturePhase = "idle";
  #primaryPointerId: number | null = null;
  #suppressSyntheticClick = false;

  beginPrimary(pointerId: number): void {
    this.#primaryPointerId = pointerId;
    this.#phase = "pending-tap";
    this.#suppressSyntheticClick = false;
  }

  markMoved(pointerId: number, start: Point, current: Point): boolean {
    if (pointerId !== this.#primaryPointerId) return false;
    if (this.#phase === "dragging") return true;
    if (this.#phase !== "pending-tap" || !movedBeyondGestureThreshold(start, current)) return false;
    this.#phase = "dragging";
    return true;
  }

  beginPinch(): void {
    if (this.#phase !== "idle") this.#phase = "pinching";
  }

  markLongPressed(pointerId: number): boolean {
    if (pointerId !== this.#primaryPointerId || this.#phase !== "pending-tap") return false;
    this.#phase = "long-pressed";
    return true;
  }

  end(pointerId: number): boolean {
    if (pointerId !== this.#primaryPointerId) return false;
    const activateTap = this.#phase === "pending-tap";
    this.#phase = "idle";
    this.#primaryPointerId = null;
    this.#suppressSyntheticClick = true;
    return activateTap;
  }

  cancel(): void {
    this.#phase = "idle";
    this.#primaryPointerId = null;
    this.#suppressSyntheticClick = true;
  }

  consumeSyntheticClick(): boolean {
    if (!this.#suppressSyntheticClick) return false;
    this.#suppressSyntheticClick = false;
    return true;
  }

  clearSyntheticClickSuppression(): void {
    this.#suppressSyntheticClick = false;
  }
}
