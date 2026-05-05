import { describe, expect, it } from "vitest";
import { WEAPONS } from "./catalog.js";
import { resolveFire, type FireContext } from "./firing.js";
import { createRng } from "./rng.js";
import type { ArenaTile, TileCoord } from "./types.js";

const openTile: ArenaTile = { terrain: "open" };
const wallTile: ArenaTile = { terrain: "wall" };
const lowWallTile: ArenaTile = { terrain: "low-wall" };
const bushTile: ArenaTile = { terrain: "bush" };
const roughTile: ArenaTile = { terrain: "rough" };

/** Build a `arenaTileAt` function that returns a specific terrain on a single tile and `open` everywhere else. */
const tileWithOverride = (
  override: TileCoord,
  terrain: ArenaTile,
): ((t: TileCoord) => ArenaTile) => {
  return (t) => (t.x === override.x && t.y === override.y ? terrain : openTile);
};

const baseCtx = (overrides: Partial<FireContext> = {}): FireContext => ({
  shooterTile: { x: 0, y: 5 },
  shooterHeading: "N",
  targetTile: { x: 0, y: 0 },
  targetPosture: "standing",
  weapon: WEAPONS.rifle,
  arenaTileAt: () => openTile,
  rng: createRng("test-base"),
  ...overrides,
});

describe("resolveFire — angle and range gates", () => {
  it("target behind shooter → angle-blocked", () => {
    const ctx = baseCtx({
      shooterHeading: "N",
      targetTile: { x: 0, y: 10 }, // due south
    });
    expect(resolveFire(ctx).outcome).toBe("angle-blocked");
  });

  it("target beyond max range → angle-blocked", () => {
    const ctx = baseCtx({
      shooterTile: { x: 0, y: 0 },
      targetTile: { x: 0, y: -19 }, // distance 19, beyond 18
    });
    // Heading N, target north; angle is fine but range fails.
    expect(resolveFire(ctx).outcome).toBe("angle-blocked");
  });
});

describe("resolveFire — wall blocking", () => {
  it("wall in path → wall-blocked, returns the wall tile", () => {
    const ctx = baseCtx({
      shooterTile: { x: 0, y: 5 },
      targetTile: { x: 0, y: 0 },
      arenaTileAt: tileWithOverride({ x: 0, y: 3 }, wallTile),
    });
    const result = resolveFire(ctx);
    expect(result.outcome).toBe("wall-blocked");
    if (result.outcome === "wall-blocked") {
      expect(result.stoppedAt).toEqual({ x: 0, y: 3 });
    }
  });

  it("crevice in path does NOT block (sight passes through)", () => {
    const ctx = baseCtx({
      shooterTile: { x: 0, y: 5 },
      targetTile: { x: 0, y: 0 },
      arenaTileAt: tileWithOverride({ x: 0, y: 3 }, { terrain: "crevice" }),
      rng: createRng("crevice-pass"),
    });
    expect(resolveFire(ctx).outcome).toBe("hit");
  });
});

describe("resolveFire — scan-zone hit chance", () => {
  it("BLACK zone target hits 100% (locked)", () => {
    // Standing target dead-center, no cover → always hits
    let hits = 0;
    for (let i = 0; i < 50; i++) {
      const ctx = baseCtx({ rng: createRng(`black-${i}`) });
      if (resolveFire(ctx).outcome === "hit") hits++;
    }
    expect(hits).toBe(50);
  });

  it("GREY zone hit rate ≈ 0.2 over many samples", () => {
    // Place target on the cone edge: shooter facing N at (5, 5); target due east at (15, 5).
    // Distance 10, bearing 90°, exactly at grey boundary.
    let hits = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) {
      const ctx = baseCtx({
        shooterTile: { x: 5, y: 5 },
        shooterHeading: "N",
        targetTile: { x: 15, y: 5 },
        rng: createRng(`grey-${i}`),
      });
      if (resolveFire(ctx).outcome === "hit") hits++;
    }
    const rate = hits / N;
    expect(Math.abs(rate - 0.2)).toBeLessThan(0.03);
  });
});

describe("resolveFire — cover (only applies to crouching targets)", () => {
  it("standing target on bush → no cover effect (Match 6 confirmed)", () => {
    let hits = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      const ctx = baseCtx({
        targetPosture: "standing",
        arenaTileAt: tileWithOverride({ x: 0, y: 0 }, bushTile),
        rng: createRng(`stand-bush-${i}`),
      });
      if (resolveFire(ctx).outcome === "hit") hits++;
    }
    expect(hits).toBe(N); // 100% — bush ignored for standing
  });

  it("crouching target on bush → ~30% miss rate", () => {
    let misses = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) {
      const ctx = baseCtx({
        targetPosture: "crouching",
        arenaTileAt: tileWithOverride({ x: 0, y: 0 }, bushTile),
        rng: createRng(`crouch-bush-${i}`),
      });
      const r = resolveFire(ctx);
      if (r.outcome === "miss") misses++;
    }
    const missRate = misses / N;
    expect(Math.abs(missRate - 0.3)).toBeLessThan(0.03);
  });

  it("crouching target with low wall in path → ~90% miss rate (in-transit cover)", () => {
    let misses = 0;
    const N = 3000;
    for (let i = 0; i < N; i++) {
      const ctx = baseCtx({
        targetPosture: "crouching",
        arenaTileAt: tileWithOverride({ x: 0, y: 3 }, lowWallTile),
        rng: createRng(`crouch-behind-lw-${i}`),
      });
      const r = resolveFire(ctx);
      if (r.outcome === "miss") misses++;
    }
    const missRate = misses / N;
    expect(Math.abs(missRate - 0.9)).toBeLessThan(0.03);
  });

  it("crouching on low wall + low wall in path → MAX (90%), not stacked", () => {
    let misses = 0;
    const N = 3000;
    for (let i = 0; i < N; i++) {
      const ctx = baseCtx({
        targetPosture: "crouching",
        // Target tile is low-wall AND there's also a low-wall in path
        arenaTileAt: (t) => {
          if (t.x === 0 && t.y === 0) return lowWallTile; // target tile
          if (t.x === 0 && t.y === 3) return lowWallTile; // in path
          return openTile;
        },
        rng: createRng(`crouch-stacked-${i}`),
      });
      const r = resolveFire(ctx);
      if (r.outcome === "miss") misses++;
    }
    expect(Math.abs(misses / N - 0.9)).toBeLessThan(0.03); // 90% not 100%
  });

  it("standing target with low wall in path → no cover effect", () => {
    let hits = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      const ctx = baseCtx({
        targetPosture: "standing",
        arenaTileAt: tileWithOverride({ x: 0, y: 3 }, lowWallTile),
        rng: createRng(`stand-behind-lw-${i}`),
      });
      if (resolveFire(ctx).outcome === "hit") hits++;
    }
    expect(hits).toBe(N); // 100% — standing ignores cover
  });
});

describe("resolveFire — damage rolls", () => {
  it("Rifle at d=1 standing → mostly full bracket (18-25)", () => {
    let fullCount = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) {
      const ctx = baseCtx({
        shooterTile: { x: 0, y: 1 },
        targetTile: { x: 0, y: 0 },
        rng: createRng(`d1-${i}`),
      });
      const r = resolveFire(ctx);
      if (r.outcome === "hit" && r.bracket === "full") fullCount++;
    }
    // P(full) at d=1 = 1 - 1/17 ≈ 0.94
    expect(fullCount / N).toBeGreaterThan(0.9);
  });

  it("Rifle at d=17 standing → mostly partial bracket (10-17)", () => {
    let partialCount = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) {
      const ctx = baseCtx({
        shooterTile: { x: 0, y: 17 },
        targetTile: { x: 0, y: 0 },
        rng: createRng(`d17-${i}`),
      });
      const r = resolveFire(ctx);
      if (r.outcome === "hit" && r.bracket === "partial") partialCount++;
    }
    // P(full) at d=17 = 0 → always partial
    expect(partialCount / N).toBeGreaterThan(0.99);
  });

  it("crouching target takes lower damage than standing at same distance", () => {
    const N = 3000;
    let standSum = 0;
    let standHits = 0;
    let crouchSum = 0;
    let crouchHits = 0;

    for (let i = 0; i < N; i++) {
      const standCtx = baseCtx({
        shooterTile: { x: 0, y: 5 },
        targetTile: { x: 0, y: 0 },
        targetPosture: "standing",
        rng: createRng(`stand-dmg-${i}`),
      });
      const r1 = resolveFire(standCtx);
      if (r1.outcome === "hit") {
        standSum += r1.damage;
        standHits++;
      }

      const crouchCtx = baseCtx({
        shooterTile: { x: 0, y: 5 },
        targetTile: { x: 0, y: 0 },
        targetPosture: "crouching",
        // Target on open ground (no cover effect — pure posture damage shift)
        rng: createRng(`crouch-dmg-${i}`),
      });
      const r2 = resolveFire(crouchCtx);
      if (r2.outcome === "hit") {
        crouchSum += r2.damage;
        crouchHits++;
      }
    }

    expect(standHits).toBeGreaterThan(0);
    expect(crouchHits).toBeGreaterThan(0);
    const standAvg = standSum / standHits;
    const crouchAvg = crouchSum / crouchHits;
    expect(crouchAvg).toBeLessThan(standAvg); // posture damage shift confirmed
  });

  it("rough ground multiplies damage by ~1.2", () => {
    const N = 4000;
    let openSum = 0;
    let openHits = 0;
    let roughSum = 0;
    let roughHits = 0;

    for (let i = 0; i < N; i++) {
      const openCtx = baseCtx({
        shooterTile: { x: 0, y: 5 },
        targetTile: { x: 0, y: 0 },
        rng: createRng(`open-${i}`),
      });
      const r1 = resolveFire(openCtx);
      if (r1.outcome === "hit") {
        openSum += r1.damage;
        openHits++;
      }

      const roughCtx = baseCtx({
        shooterTile: { x: 0, y: 5 },
        targetTile: { x: 0, y: 0 },
        arenaTileAt: tileWithOverride({ x: 0, y: 0 }, roughTile),
        rng: createRng(`rough-${i}`),
      });
      const r2 = resolveFire(roughCtx);
      if (r2.outcome === "hit") {
        roughSum += r2.damage;
        roughHits++;
      }
    }

    const openAvg = openSum / openHits;
    const roughAvg = roughSum / roughHits;
    const ratio = roughAvg / openAvg;
    expect(Math.abs(ratio - 1.2)).toBeLessThan(0.05);
  });
});

describe("resolveFire — replay determinism", () => {
  it("same RNG seed → identical resolution", () => {
    const ctx1 = baseCtx({ rng: createRng("replay-seed") });
    const ctx2 = baseCtx({ rng: createRng("replay-seed") });
    const r1 = resolveFire(ctx1);
    const r2 = resolveFire(ctx2);
    expect(r1).toEqual(r2);
  });
});
