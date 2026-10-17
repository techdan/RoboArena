import { describe, expect, it } from "vitest";
import { graphicsPixelRatio, isGraphicsQuality } from "./quality";

describe("explicit graphics quality", () => {
  it("keeps native full resolution and the existing DPR cap in Cinematic", () => {
    expect(graphicsPixelRatio("cinematic", 1968, 1404, 1)).toBe(1);
    expect(graphicsPixelRatio("cinematic", 1024, 768, 3)).toBe(2);
  });
  it("preserves small-canvas native pixels but bounds large-canvas GPU work", () => {
    expect(graphicsPixelRatio("performance", 898, 561, 1)).toBe(1);
    for (const [quality, budget] of [
      ["balanced", 1_500_000],
      ["performance", 900_000],
    ] as const) {
      const ratio = graphicsPixelRatio(quality, 1968, 1404, 2);
      expect(1968 * 1404 * ratio * ratio).toBeCloseTo(budget);
    }
  });
  it("rejects invalid stored preferences", () => {
    expect(isGraphicsQuality("performance")).toBe(true);
    expect(isGraphicsQuality("unknown")).toBe(false);
    expect(isGraphicsQuality(null)).toBe(false);
  });
});
