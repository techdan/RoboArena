import { describe, expect, it } from "vitest";
import type { TargetingTilePreview } from "./firingHelpers.js";
import { labelAlpha, tileLabel } from "./overlayLabels.js";

const ORIGIN = { x: 2, y: 2 };

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
  chancePercent: 72,
  chanceBand: "good",
  ...overrides,
});

describe("tileLabel", () => {
  it("labels eligible direct-fire tiles with their percentage", () => {
    expect(tileLabel(preview({}), ORIGIN)).toBe("72%");
  });

  it("labels zero-chance tiles 0% instead of hiding them", () => {
    expect(tileLabel(preview({ chancePercent: 0, chanceBand: "zero" }), ORIGIN)).toBe("0%");
  });

  it("does not label blocked or out-of-range tiles", () => {
    for (const status of [
      "out-of-range",
      "angle-blocked",
      "sight-blocked",
      "shooter-docked",
    ] as const) {
      expect(tileLabel(preview({ status }), ORIGIN)).toBeNull();
    }
  });

  it("does not label explosive coverage tiles", () => {
    expect(
      tileLabel(
        preview({ weapon: "missile-launcher", resolution: "blast", chanceBand: null }),
        ORIGIN,
      ),
    ).toBeNull();
  });

  it("does not label the shooter's own tile", () => {
    expect(tileLabel(preview({ tile: { x: 2, y: 2 } }), ORIGIN)).toBeNull();
  });

  it("does not label tiles without a computed percentage", () => {
    expect(tileLabel(preview({ chancePercent: null }), ORIGIN)).toBeNull();
  });
});

describe("labelAlpha", () => {
  it("hides labels below 17px effective tile size", () => {
    expect(labelAlpha(16)).toBe(0);
    expect(labelAlpha(17)).toBe(0);
  });

  it("fades linearly between 17px and 23px", () => {
    expect(labelAlpha(20)).toBeCloseTo(0.5);
  });

  it("is fully opaque from 23px up", () => {
    expect(labelAlpha(23)).toBe(1);
    expect(labelAlpha(30)).toBe(1);
  });
});
