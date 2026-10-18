import { describe, expect, it } from "vitest";
import { placeOrdersRing } from "./ordersRingPlacement";

// 1024×768 board with header 80px, squad rail 250px, timeline 270px covered.
const FREE = { left: 250, top: 80, right: 1024, bottom: 498 };
// Camera buttons floating in the upper-right corner.
const CAMERA = { left: 810, top: 84, right: 1008, bottom: 172 };

describe("orders ring placement", () => {
  it("follows its robot when nothing is in the way", () => {
    expect(placeOrdersRing({ x: 600, y: 300 }, FREE, [CAMERA])).toEqual({ x: 600, y: 300 });
  });

  it("keeps the edge clamp for robots near the free area's border", () => {
    expect(placeOrdersRing({ x: 100, y: 20 }, FREE)).toEqual({ x: 410, y: 195 });
  });

  it("steps clear of the camera controls in the upper-right corner", () => {
    // Blue home corner, where the 1024×768 audit saw the overlap.
    const placed = placeOrdersRing({ x: 990, y: 110 }, FREE, [CAMERA]);
    expect(placed.x + 160 <= CAMERA.left - 8 || placed.y - 115 >= CAMERA.bottom + 8).toBe(true);
    expect(placed.y + 115).toBeLessThanOrEqual(FREE.bottom);
    expect(placed.x - 160).toBeGreaterThanOrEqual(FREE.left);
  });

  it("chooses the smaller move: a robot just below the controls drops down", () => {
    const placed = placeOrdersRing({ x: 900, y: 280 }, FREE, [CAMERA]);
    expect(placed).toEqual({ x: 864, y: 295 });
  });
});
