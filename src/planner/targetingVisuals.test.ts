import { describe, expect, it } from "vitest";
import type { TargetingTilePreview } from "./firingHelpers";
import {
  hexToCss,
  relativeLuminance,
  TARGETING_BAND_ORDER,
  TARGETING_PALETTE,
} from "./targetingPalette";
import { targetingTileVisual } from "./targetingVisuals";

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

describe("targeting palette", () => {
  it("defines every category with a css string derived from its hex", () => {
    for (const swatch of Object.values(TARGETING_PALETTE)) {
      expect(swatch.css).toBe(hexToCss(swatch.hex));
      expect(swatch.css).toMatch(/^#[0-9a-f]{6}$/);
      expect(swatch.alpha).toBeGreaterThan(0);
      expect(swatch.alpha).toBeLessThanOrEqual(1);
    }
  });

  it("keeps probability bands strictly luminance-ordered (grayscale safe)", () => {
    const luminances = TARGETING_BAND_ORDER.map((band) =>
      relativeLuminance(TARGETING_PALETTE[band].hex),
    );
    for (let index = 1; index < luminances.length; index += 1) {
      expect(luminances[index]!).toBeLessThan(luminances[index - 1]!);
    }
  });

  it("gives every blocked status a non-color pattern treatment", () => {
    expect(TARGETING_PALETTE["sight-blocked"].pattern).toBe("hatch");
    expect(TARGETING_PALETTE["angle-blocked"].pattern).toBe("reverse-hatch");
    expect(TARGETING_PALETTE["out-of-range"].pattern).toBe("dim");
    expect(TARGETING_PALETTE.zero.pattern).toBe("hatch");
  });
});

describe("targeting heatmap visuals", () => {
  it("uses distinct high-contrast categories for every probability band", () => {
    const visuals = TARGETING_BAND_ORDER.map((band) =>
      targetingTileVisual(preview({ chanceBand: band })),
    );
    expect(new Set(visuals.map((visual) => visual.color))).toHaveLength(5);
    expect(visuals.every((visual) => visual.alpha >= 0.45)).toBe(true);
    expect(visuals.at(-1)?.pattern).toBe("hatch");
  });

  it("does not conflate blocked, out-of-range, and zero-chance tiles", () => {
    const blocked = targetingTileVisual(preview({ status: "sight-blocked" }));
    const range = targetingTileVisual(preview({ status: "out-of-range" }));
    const angle = targetingTileVisual(preview({ status: "angle-blocked" }));
    const zero = targetingTileVisual(preview({ chancePercent: 0, chanceBand: "zero" }));
    expect([blocked.category, range.category, angle.category, zero.category]).toEqual([
      "sight-blocked",
      "out-of-range",
      "angle-blocked",
      "zero",
    ]);
    expect(new Set([blocked.pattern, range.pattern, angle.pattern])).toHaveLength(3);
  });

  it("renders every visual straight from the shared palette", () => {
    const eligible = targetingTileVisual(preview({}));
    expect(eligible.color).toBe(TARGETING_PALETTE.good.hex);
    expect(eligible.alpha).toBe(TARGETING_PALETTE.good.alpha);
    const docked = targetingTileVisual(preview({ status: "shooter-docked" }));
    expect(docked.category).toBe("angle-blocked");
  });

  it("uses coverage rather than a fictitious chance for explosives", () => {
    expect(
      targetingTileVisual(
        preview({ weapon: "missile-launcher", resolution: "blast", chanceBand: null }),
      ).category,
    ).toBe("blast");
  });
});
