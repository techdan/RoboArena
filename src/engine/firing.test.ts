import { describe, expect, it } from "vitest";
import { WEAPONS } from "./catalog.js";
import { LIVE_FIRE_HIT_THRESHOLDS } from "./constants.js";
import {
  calculateDirectDamageRange,
  calculateLiveFireScore,
  calculateLiveFireScoreBreakdown,
  distanceScoreAdjustment,
  fireControlAccuracyAdjustment,
  resolveFire,
} from "./firing.js";
import type { Rng } from "./rng.js";
import type { ArenaTile, TileCoord } from "./types.js";

const sequenceRng = (...values: number[]): Rng => {
  let index = 0;
  let state = 0;
  const nextUint32 = () => {
    const value = values[index++] ?? 0;
    state = index;
    return value >>> 0;
  };
  return {
    nextUint32,
    next: () => nextUint32() / 4294967296,
    intInRange: (min, max) => min + (nextUint32() % (max - min + 1)),
    chance: (p) => nextUint32() / 4294967296 < p,
    snapshot: () => state,
    restore: (nextState) => {
      index = nextState;
      state = nextState;
    },
  };
};

const arena =
  (overrides: Readonly<Record<string, ArenaTile["terrain"]>> = {}) =>
  (tile: TileCoord): ArenaTile => ({ terrain: overrides[`${tile.x},${tile.y}`] ?? "open" });

const baseContext = {
  shooterTile: { x: 0, y: 0 },
  shooterHeading: "E" as const,
  shooterAccuracy: 2 as const,
  targetTile: { x: 10, y: 0 },
  targetPosture: "upright" as const,
  weapon: WEAPONS.rifle,
  arenaTileAt: arena(),
};

describe("live-fire score", () => {
  it("uses the exact distance ladder", () => {
    expect(distanceScoreAdjustment(13, 6)).toBe(-1);
    expect(distanceScoreAdjustment(10, 6)).toBe(4);
    expect(distanceScoreAdjustment(5, 6)).toBe(4);
    expect(distanceScoreAdjustment(2, 6)).toBe(10);
  });

  it("clamps an exposed open target to score 19", () => {
    expect(
      calculateLiveFireScore({
        accuracy: 2,
        distance: 10,
        coverClass: 4,
        targetInFrontArc: true,
      }),
    ).toBe(19);
  });

  it("adds the fire-control term from the firing mode, not weapon or terrain", () => {
    const common = {
      accuracy: 0 as const,
      distance: 10,
      coverClass: 1 as const,
      targetInFrontArc: true,
    };
    expect(fireControlAccuracyAdjustment("aim")).toBe(4);
    expect(fireControlAccuracyAdjustment("scan", 0)).toBe(4);
    expect(fireControlAccuracyAdjustment("scan", 6)).toBe(2);
    expect(fireControlAccuracyAdjustment("scan", 10)).toBe(-1);
    expect(fireControlAccuracyAdjustment("scan", 18)).toBe(-6);
    expect(fireControlAccuracyAdjustment("scan")).toBe(-6);
    expect(calculateLiveFireScore(common)).toBe(10);
    expect(
      calculateLiveFireScore({
        ...common,
        fireMode: "scan",
        scanStrength: 16,
        scanMaxDistance: 10,
      }),
    ).toBe(5);
  });

  it("halves the score when the target is outside the front arc", () => {
    expect(
      calculateLiveFireScore({
        accuracy: 2,
        distance: 10,
        coverClass: 4,
        targetInFrontArc: false,
      }),
    ).toBe(9);
  });

  it("halves the score while damage stagger is active", () => {
    expect(
      calculateLiveFireScore({
        accuracy: 2,
        distance: 10,
        coverClass: 4,
        targetInFrontArc: true,
        damageStaggered: true,
      }),
    ).toBe(9);
  });

  it("applies the Scan & Fire sight-strength bands", () => {
    const common = {
      accuracy: 0 as const,
      distance: 13,
      coverClass: 1 as const,
      targetInFrontArc: true,
      fireMode: "scan" as const,
      scanMaxDistance: 6,
    };
    expect(calculateLiveFireScore({ ...common, scanStrength: 16 })).toBe(4);
    expect(calculateLiveFireScore({ ...common, scanStrength: 8 })).toBe(2);
    expect(calculateLiveFireScore({ ...common, scanStrength: 4 })).toBe(0);
  });

  it("reconciles a Burst Scan explanation", () => {
    const breakdown = calculateLiveFireScoreBreakdown({
      accuracy: 1,
      distance: 9,
      coverClass: 3,
      targetInFrontArc: true,
      fireMode: "scan",
      scanStrength: 7,
      scanMaxDistance: 9,
    });
    expect(breakdown).toMatchObject({
      coverAdjustment: 12,
      distanceAccuracyAdjustment: 3,
      fireControlAdjustment: 0,
      scanPenalty: 2,
      preClampSubtotal: 13,
      clampedScore: 13,
      finalScore: 13,
      threshold: 144,
      chancePercent: 56,
    });
    expect(
      breakdown.coverAdjustment +
        breakdown.distanceAccuracyAdjustment +
        breakdown.fireControlAdjustment -
        breakdown.scanPenalty,
    ).toBe(breakdown.preClampSubtotal);
  });

  it("keeps every explanation path identical to the authoritative score", () => {
    const accuracies = [0, 1, 2] as const;
    const distances = [2, 3, 6, 7, 12, 13] as const;
    const coverClasses = [1, 2, 3, 4] as const;
    const maxDistances = [0, 9, 18] as const;
    const modes = ["aim", "scan"] as const;
    const scanStrengths = [4, 8, 9, 16] as const;

    for (const accuracy of accuracies)
      for (const distance of distances)
        for (const coverClass of coverClasses)
          for (const scanMaxDistance of maxDistances)
            for (const fireMode of modes)
              for (const scanStrength of scanStrengths)
                for (const damageStaggered of [false, true])
                  for (const targetInFrontArc of [false, true]) {
                    const input = {
                      accuracy,
                      distance,
                      coverClass,
                      scanMaxDistance,
                      fireMode,
                      scanStrength,
                      damageStaggered,
                      targetInFrontArc,
                    } as const;
                    const breakdown = calculateLiveFireScoreBreakdown(input);
                    expect(breakdown.finalScore).toBe(calculateLiveFireScore(input));
                    expect(
                      breakdown.coverAdjustment +
                        breakdown.distanceAccuracyAdjustment +
                        breakdown.fireControlAdjustment -
                        breakdown.scanPenalty,
                    ).toBe(breakdown.preClampSubtotal);
                    expect(breakdown.threshold).toBe(
                      LIVE_FIRE_HIT_THRESHOLDS[breakdown.finalScore],
                    );
                  }
  }, 15_000);

  it("shows clamp and integer-halving stages in resolver order", () => {
    const breakdown = calculateLiveFireScoreBreakdown({
      accuracy: 2,
      distance: 2,
      coverClass: 4,
      targetInFrontArc: false,
      damageStaggered: true,
    });
    expect(breakdown.preClampSubtotal).toBeGreaterThan(19);
    expect(breakdown).toMatchObject({
      clampedScore: 19,
      scoreAfterDamageStagger: 9,
      finalScore: 4,
      threshold: 24,
      chancePercent: 9,
    });
    expect(
      calculateLiveFireScore({
        accuracy: 2,
        distance: 2,
        coverClass: 4,
        targetInFrontArc: false,
        damageStaggered: true,
      }),
    ).toBe(breakdown.finalScore);
  });

  it("reports post-adjustment direct damage ranges without rolling", () => {
    expect(
      calculateDirectDamageRange({ weapon: WEAPONS.rifle, coverClass: 1, distance: 13 }),
    ).toMatchObject({
      rawMinimum: 10,
      rawMaximum: 17,
      coverAdjustment: -4,
      distanceAdjustment: -4,
      minimum: 2,
      maximum: 9,
      bulletsPerClick: 1,
    });
    expect(
      calculateDirectDamageRange({
        weapon: WEAPONS["missile-launcher"],
        coverClass: 4,
        distance: 2,
      }),
    ).toBeNull();
  });
});

describe("resolveFire", () => {
  it("rejects Euclidean out-of-range diagonals", () => {
    expect(
      resolveFire({
        ...baseContext,
        targetTile: { x: 18, y: 18 },
        rng: sequenceRng(0),
      }),
    ).toEqual({ outcome: "out-of-range", distance: 25 });
  });

  it("accepts the RE 13,13 diagonal at range 18", () => {
    expect(
      resolveFire({
        ...baseContext,
        shooterHeading: "SE",
        targetTile: { x: 13, y: 13 },
        rng: sequenceRng(0, 0),
      }).outcome,
    ).toBe("hit");
  });

  it("enforces the scan gate", () => {
    expect(resolveFire({ ...baseContext, shooterHeading: "W", rng: sequenceRng(0) })).toEqual({
      outcome: "angle-blocked",
    });
  });

  it("reports a blocking wall", () => {
    expect(
      resolveFire({
        ...baseContext,
        arenaTileAt: arena({ "5,0": "wall" }),
        rng: sequenceRng(0),
      }),
    ).toEqual({ outcome: "sight-blocked", stoppedAt: { x: 5, y: 0 } });
  });

  it("uses threshold 240 at score 19", () => {
    const result = resolveFire({ ...baseContext, rng: sequenceRng(239, 0) });
    expect(result.outcome).toBe("hit");
    if (result.outcome === "hit") expect(result.threshold).toBe(240);
  });

  it("misses when the byte roll equals the threshold", () => {
    const result = resolveFire({ ...baseContext, rng: sequenceRng(240) });
    expect(result).toMatchObject({ outcome: "miss", score: 19, threshold: 240 });
  });

  it("applies the exact direct damage adjustments", () => {
    const result = resolveFire({ ...baseContext, rng: sequenceRng(0, 7) });
    expect(result).toMatchObject({ outcome: "hit", damage: 21, coverClass: 4 });
  });

  it("reduces open-ground Crouching to cover class 3", () => {
    const result = resolveFire({
      ...baseContext,
      targetPosture: "crouching",
      rng: sequenceRng(0, 7),
    });
    expect(result).toMatchObject({ outcome: "hit", damage: 17, coverClass: 3 });
  });

  it("is deterministic for the same byte sequence", () => {
    const first = resolveFire({ ...baseContext, rng: sequenceRng(12, 5) });
    const second = resolveFire({ ...baseContext, rng: sequenceRng(12, 5) });
    expect(first).toEqual(second);
  });
});
