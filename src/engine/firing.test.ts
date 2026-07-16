import { describe, expect, it } from "vitest";
import { WEAPONS } from "./catalog.js";
import { calculateLiveFireScore, distanceScoreAdjustment, resolveFire } from "./firing.js";
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
  aimedTile: { x: 10, y: 0 },
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
        targetTerrain: "open",
        weapon: WEAPONS.rifle,
        targetOnAimedTile: true,
      }),
    ).toBe(19);
  });

  it("uses exact terrain additions", () => {
    const common = {
      accuracy: 0 as const,
      distance: 10,
      coverClass: 1 as const,
      weapon: WEAPONS.rifle,
      targetOnAimedTile: true,
    };
    expect(calculateLiveFireScore({ ...common, targetTerrain: "rough" })).toBe(8);
    expect(calculateLiveFireScore({ ...common, targetTerrain: "bush" })).toBe(5);
    expect(calculateLiveFireScore({ ...common, targetTerrain: "low-wall" })).toBe(3);
  });

  it("halves the score when the target left the aimed tile", () => {
    expect(
      calculateLiveFireScore({
        accuracy: 2,
        distance: 10,
        coverClass: 4,
        targetTerrain: "open",
        weapon: WEAPONS.rifle,
        targetOnAimedTile: false,
      }),
    ).toBe(9);
  });

  it("halves the score while damage stagger is active", () => {
    expect(
      calculateLiveFireScore({
        accuracy: 2,
        distance: 10,
        coverClass: 4,
        targetTerrain: "open",
        weapon: WEAPONS.rifle,
        targetOnAimedTile: true,
        damageStaggered: true,
      }),
    ).toBe(9);
  });

  it("uses the named Scan & Fire accuracy add and sight-strength bands", () => {
    const common = {
      accuracy: 0 as const,
      distance: 13,
      coverClass: 1 as const,
      targetTerrain: "open" as const,
      weapon: WEAPONS.rifle,
      targetOnAimedTile: true,
      fireMode: "scan" as const,
    };
    expect(calculateLiveFireScore({ ...common, scanStrength: 16 })).toBe(9);
    expect(calculateLiveFireScore({ ...common, scanStrength: 8 })).toBe(7);
    expect(calculateLiveFireScore({ ...common, scanStrength: 4 })).toBe(5);
  });
});

describe("resolveFire", () => {
  it("rejects Euclidean out-of-range diagonals", () => {
    expect(
      resolveFire({
        ...baseContext,
        aimedTile: { x: 18, y: 18 },
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
        aimedTile: { x: 13, y: 13 },
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
