import { describe, expect, it } from "vitest";
import { LIVE_FIRE_HIT_THRESHOLDS } from "../engine/constants";
import { calculateLiveFireBreakdownFromFactors } from "../engine/liveFireMath";
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
  scanRankPenalized: false,
  estimates: [],
  chancePercent: 72,
  chanceBand: "good",
  ...overrides,
});

describe("tooltipLines", () => {
  const estimate = {
    posture: "upright",
    coverClass: 4,
    coverSource: "none",
    targetTerrain: "open",
    score: 17,
    threshold: 208,
    chancePercent: 81,
    breakdown: calculateLiveFireBreakdownFromFactors({
      fireMode: "aim",
      coverAdjustment: 18,
      distanceAccuracyAdjustment: -5,
      fireControlAdjustment: 4,
      scanStrength: 16,
      damageStaggered: false,
      targetInFrontArc: true,
      hitThresholds: LIVE_FIRE_HIT_THRESHOLDS,
    }),
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

  it("explains chance, damage, posture, cover, fire control, and Aim cover scope", () => {
    expect(tooltipLines(preview({ chancePercent: 81, estimates: [estimate] }), 18)).toEqual([
      "81% hit · 5 tiles",
      "10–17 dmg",
      "Cover: exposed (score 18) · upright assumed",
      "Fire control +4 · range −5",
      "Aim: only target and adjacent cover count",
    ]);
  });

  it("makes an adjacent obstacle and score cap visible", () => {
    const capped = {
      ...estimate,
      coverClass: 3 as const,
      coverSource: "adjacent-low-wall" as const,
      breakdown: calculateLiveFireBreakdownFromFactors({
        fireMode: "aim",
        coverAdjustment: 12,
        distanceAccuracyAdjustment: 5,
        fireControlAdjustment: 4,
        scanStrength: 16,
        damageStaggered: false,
        targetInFrontArc: true,
        hitThresholds: LIVE_FIRE_HIT_THRESHOLDS,
      }),
    };
    expect(tooltipLines(preview({ chancePercent: 94, estimates: [capped] }), 18)).toContain(
      "Cover: partial cover (score 12) · adjacent low wall · upright assumed",
    );
    expect(tooltipLines(preview({ chancePercent: 94, estimates: [capped] }), 18)).toContain(
      "Score 21 → 19 cap · 94% max",
    );
  });

  it("shows cumulative Scan sight strength and its score band", () => {
    const scan = {
      ...estimate,
      coverSource: "adjacent-bush" as const,
      breakdown: calculateLiveFireBreakdownFromFactors({
        fireMode: "scan",
        coverAdjustment: 18,
        distanceAccuracyAdjustment: -5,
        fireControlAdjustment: 2,
        scanStrength: 7,
        damageStaggered: false,
        targetInFrontArc: true,
        hitThresholds: LIVE_FIRE_HIT_THRESHOLDS,
      }),
    };
    const lines = tooltipLines(
      preview({
        fireMode: "scan",
        scanStrength: 7,
        authorizedContact: {
          id: "enemy",
          label: "Enemy",
          tile: { x: 4, y: 4 },
          posture: "upright",
        },
        estimates: [scan],
      }),
      18,
    );
    expect(lines).toContain("Cover: exposed (score 18) · adjacent bush · upright observed");
    expect(lines).toContain("Fire control +2 · range −5");
    expect(lines).toContain("Scan sight 7/16 · −2 score");
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

  it("explains the outside-front-arc +2 Scan ranking distance in scan mode only", () => {
    const scanEdge = preview({ fireMode: "scan", scanRankPenalized: true, estimates: [estimate] });
    expect(tooltipLines(scanEdge, 12).at(-1)).toBe(
      "Outside front arc — ranked as 7 tiles when picking a Scan target",
    );
    const aimEdge = preview({ fireMode: "aim", scanRankPenalized: true, estimates: [estimate] });
    expect(tooltipLines(aimEdge, 12).at(-1)).not.toMatch(/front arc/);
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
