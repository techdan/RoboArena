import { describe, expect, it } from "vitest";
import type { TargetingTilePreview } from "./firingHelpers";
import { tooltipLines } from "./overlayLabels";

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

describe("tooltipLines", () => {
  const estimate = {
    posture: "upright",
    coverClass: 4,
    score: 17,
    threshold: 208,
    chancePercent: 81,
    breakdown: {} as never,
    offTileBreakdown: null,
    damageRange: {
      rawMinimum: 10,
      rawMaximum: 17,
      coverAdjustment: 0,
      distanceAdjustment: 0,
      minimum: 10,
      maximum: 17,
      bulletsPerClick: 1,
    },
  } as const;

  it("leads with chance and distance, then on-hit damage", () => {
    expect(tooltipLines(preview({ chancePercent: 81, estimates: [estimate] }), 18)).toEqual([
      "81% hit · 5 tiles",
      "10–17 dmg",
    ]);
  });

  it("marks multi-bullet weapons", () => {
    const burst = {
      ...estimate,
      damageRange: { ...estimate.damageRange, minimum: 8, maximum: 23, bulletsPerClick: 3 },
    };
    expect(tooltipLines(preview({ weapon: "burst-gun", estimates: [burst] }), 18)).toContain(
      "8–23 dmg × 3 bullets",
    );
  });

  it("explains the cone-edge +2 acquisition distance in scan mode only", () => {
    const scanEdge = preview({ fireMode: "scan", onConeBoundary: true, estimates: [estimate] });
    expect(tooltipLines(scanEdge, 12).at(-1)).toBe("Cone edge — counts as 7 tiles for acquisition");
    const aimEdge = preview({ fireMode: "aim", onConeBoundary: true, estimates: [estimate] });
    expect(tooltipLines(aimEdge, 12).at(-1)).not.toMatch(/Cone edge/);
  });

  it("shows a single plain-language line for blocked tiles", () => {
    expect(tooltipLines(preview({ status: "out-of-range" }), 12)).toEqual([
      "Outside the 12-tile range",
    ]);
    expect(tooltipLines(preview({ status: "angle-blocked" }), 12)).toEqual([
      "Behind the scan cone — robots can’t fire backward",
    ]);
    expect(tooltipLines(preview({ status: "sight-blocked" }), 12)).toEqual([
      "A wall blocks line of sight",
    ]);
  });

  it("describes explosive coverage without a hit percentage", () => {
    expect(
      tooltipLines(
        preview({ weapon: "missile-launcher", resolution: "blast", chanceBand: null }),
        18,
      ),
    ).toEqual(["Blast impact · 5 tiles"]);
  });
});
