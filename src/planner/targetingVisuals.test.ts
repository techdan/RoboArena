import { describe, expect, it } from "vitest";
import type { TargetingTilePreview } from "./firingHelpers.js";
import { targetingTileVisual } from "./targetingVisuals.js";

const preview = (overrides: Partial<TargetingTilePreview>): TargetingTilePreview => ({
  status: "eligible",
  distance: 5,
  target: { x: 4, y: 4 },
  tile: { x: 4, y: 4 },
  weapon: "rifle",
  authorizedContact: null,
  resolution: "direct-hit-roll",
  fireMode: "aim",
  scanStrength: 16,
  onConeBoundary: false,
  estimates: [],
  chancePercent: 50,
  chanceBand: "good",
  ...overrides,
});

describe("targeting heatmap visuals", () => {
  it("uses distinct high-contrast categories for every probability band", () => {
    const visuals = (["excellent", "good", "risky", "poor", "zero"] as const).map((band) =>
      targetingTileVisual(preview({ chanceBand: band })),
    );
    expect(new Set(visuals.map((visual) => visual.color))).toHaveLength(5);
    expect(visuals.every((visual) => visual.alpha >= 0.45)).toBe(true);
    expect(visuals.at(-1)?.pattern).toBe("hatch");
  });

  it("does not conflate blocked, out-of-range, and zero-chance tiles", () => {
    const blocked = targetingTileVisual(preview({ status: "sight-blocked" }));
    const range = targetingTileVisual(preview({ status: "out-of-range" }));
    const zero = targetingTileVisual(preview({ chancePercent: 0, chanceBand: "zero" }));
    expect([blocked.category, range.category, zero.category]).toEqual([
      "sight-blocked",
      "out-of-range",
      "zero",
    ]);
    expect(blocked.pattern).toBe("hatch");
    expect(range.pattern).toBe("none");
  });

  it("uses coverage rather than a fictitious chance for explosives", () => {
    expect(
      targetingTileVisual(
        preview({ weapon: "missile-launcher", resolution: "blast", chanceBand: null }),
      ).category,
    ).toBe("blast");
  });
});
