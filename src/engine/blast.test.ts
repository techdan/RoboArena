import { describe, expect, it } from "vitest";
import { resolveBlast, type BlastTarget } from "./blast.js";
import { WEAPONS } from "./catalog.js";
import { createRng } from "./rng.js";
import type { TileCoord } from "./types.js";

const at = (x: number, y: number): TileCoord => ({ x, y });

const targetsInLine = (impact: TileCoord, count: number): BlastTarget[] =>
  Array.from({ length: count }, (_, i) => ({
    robotId: `r${i}`,
    tile: { x: impact.x + i, y: impact.y },
  }));

describe("resolveBlast — Missile (radius 2, falloff 70/50/15/0)", () => {
  it("rolls one damage entry per target inside radius", () => {
    const impact = at(10, 10);
    const targets = targetsInLine(impact, 5); // radii 0,1,2,3,4
    const rolls = resolveBlast({
      impact,
      weapon: WEAPONS["missile-launcher"],
      potentialTargets: targets,
      rng: createRng("blast-line"),
    });
    // Only radii 0,1,2 are inside; radii 3 and 4 are excluded
    const ids = rolls.map((r) => r.robotId);
    expect(ids).toEqual(["r0", "r1", "r2"]);
  });

  it("damage at radius 0 ≈ 55-80 (Match 2 confirmed)", () => {
    const impact = at(10, 10);
    const N = 4000;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < N; i++) {
      const rolls = resolveBlast({
        impact,
        weapon: WEAPONS["missile-launcher"],
        potentialTargets: [{ robotId: "r0", tile: impact }],
        rng: createRng(`r0-${i}`),
      });
      const d = rolls[0]!.damage;
      sum += d;
      if (d < min) min = d;
      if (d > max) max = d;
    }
    expect(min).toBeGreaterThanOrEqual(55);
    expect(max).toBeLessThanOrEqual(80);
    const avg = sum / N;
    expect(Math.abs(avg - 67.5)).toBeLessThan(2); // midpoint of 55-80 = 67.5
  });

  it("damage at radius 1 ≈ 40-60 (avg ~50)", () => {
    const impact = at(10, 10);
    const N = 3000;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const rolls = resolveBlast({
        impact,
        weapon: WEAPONS["missile-launcher"],
        potentialTargets: [{ robotId: "r0", tile: at(11, 10) }],
        rng: createRng(`r1-${i}`),
      });
      sum += rolls[0]!.damage;
    }
    expect(Math.abs(sum / N - 50)).toBeLessThan(2);
  });

  it("damage at radius 2 ≈ 13-17 (steep edge falloff)", () => {
    const impact = at(10, 10);
    const N = 3000;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const rolls = resolveBlast({
        impact,
        weapon: WEAPONS["missile-launcher"],
        potentialTargets: [{ robotId: "r0", tile: at(12, 10) }],
        rng: createRng(`r2-${i}`),
      });
      sum += rolls[0]!.damage;
    }
    expect(Math.abs(sum / N - 15)).toBeLessThan(1);
  });

  it("targets at radius ≥ 3 are excluded entirely (no zero-damage rolls)", () => {
    const impact = at(10, 10);
    const targets: BlastTarget[] = [
      { robotId: "far", tile: at(13, 10) }, // radius 3
      { robotId: "farther", tile: at(15, 10) }, // radius 5
    ];
    const rolls = resolveBlast({
      impact,
      weapon: WEAPONS["missile-launcher"],
      potentialTargets: targets,
      rng: createRng("far"),
    });
    expect(rolls).toEqual([]);
  });

  it("blast uses Chebyshev distance (king-move): diagonal-1 = same as cardinal-1", () => {
    const impact = at(10, 10);
    const targets: BlastTarget[] = [
      { robotId: "cardinal", tile: at(11, 10) }, // r=1
      { robotId: "diagonal", tile: at(11, 11) }, // r=1 chebyshev
    ];
    const rolls = resolveBlast({
      impact,
      weapon: WEAPONS["missile-launcher"],
      potentialTargets: targets,
      rng: createRng("symm"),
    });
    expect(rolls.length).toBe(2);
    expect(rolls[0]!.radius).toBe(1);
    expect(rolls[1]!.radius).toBe(1);
  });
});

describe("resolveBlast — determinism", () => {
  it("same seed + same inputs → identical rolls", () => {
    const impact = at(5, 5);
    const targets = targetsInLine(impact, 3);
    const a = resolveBlast({
      impact,
      weapon: WEAPONS["missile-launcher"],
      potentialTargets: targets,
      rng: createRng("seed-x"),
    });
    const b = resolveBlast({
      impact,
      weapon: WEAPONS["missile-launcher"],
      potentialTargets: targets,
      rng: createRng("seed-x"),
    });
    expect(a).toEqual(b);
  });
});

describe("resolveBlast — guards", () => {
  it("throws if called for a non-explosive weapon", () => {
    expect(() =>
      resolveBlast({
        impact: at(0, 0),
        weapon: WEAPONS.rifle,
        potentialTargets: [{ robotId: "x", tile: at(0, 0) }],
        rng: createRng("guard"),
      }),
    ).toThrow();
  });
});
