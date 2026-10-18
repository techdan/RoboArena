/**
 * Where the orders ring sits on screen. It follows its robot, but is clamped
 * inside the board area left free by the header, squad rail and timeline, and
 * steps off any floating control (the camera buttons) it would cover.
 */

export interface ScreenRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Half the ring's footprint, buttons and labels included. */
export const ORDERS_RING_HALF_WIDTH = 160;
export const ORDERS_RING_HALF_HEIGHT = 115;
const AVOID_GAP = 8;

export const placeOrdersRing = (
  point: { readonly x: number; readonly y: number },
  free: ScreenRect,
  avoid: readonly ScreenRect[] = [],
): { readonly x: number; readonly y: number } => {
  const left = free.left + ORDERS_RING_HALF_WIDTH;
  const right = Math.max(left, free.right - ORDERS_RING_HALF_WIDTH);
  const top = free.top + ORDERS_RING_HALF_HEIGHT;
  const bottom = Math.max(top, free.bottom - ORDERS_RING_HALF_HEIGHT);
  let x = Math.max(left, Math.min(right, point.x));
  let y = Math.max(top, Math.min(bottom, point.y));
  for (const rect of avoid) {
    const overlaps =
      x + ORDERS_RING_HALF_WIDTH > rect.left - AVOID_GAP &&
      x - ORDERS_RING_HALF_WIDTH < rect.right + AVOID_GAP &&
      y + ORDERS_RING_HALF_HEIGHT > rect.top - AVOID_GAP &&
      y - ORDERS_RING_HALF_HEIGHT < rect.bottom + AVOID_GAP;
    if (!overlaps) continue;
    // Move along whichever axis disturbs the ring least; the free-area clamp
    // still wins so no button is pushed under the timeline or rail.
    const toLeft = Math.max(left, rect.left - AVOID_GAP - ORDERS_RING_HALF_WIDTH);
    const below = Math.min(bottom, rect.bottom + AVOID_GAP + ORDERS_RING_HALF_HEIGHT);
    if (x - toLeft <= below - y) x = toLeft;
    else y = below;
  }
  return { x, y };
};
