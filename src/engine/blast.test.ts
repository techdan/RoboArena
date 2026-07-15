import { describe, expect, it } from "vitest";
import { WEAPONS } from "./catalog.js";
import { applyExplosiveCoverCut, resolveBlast } from "./blast.js";
import type { Rng } from "./rng.js";

const constantRng = (raw: number): Rng => ({
  nextUint32: () => raw >>> 0,
  next: () => (raw >>> 0) / 4294967296,
  intInRange: (min, max) => min + ((raw >>> 0) % (max - min + 1)),
  chance: (p) => (raw >>> 0) / 4294967296 < p,
  snapshot: () => 0,
  restore: () => {},
});

describe("explosive cover cuts", () => {
  it("applies the exact integer reductions", () => {
    expect(applyExplosiveCoverCut(80, 1)).toBe(40);
    expect(applyExplosiveCoverCut(80, 2)).toBe(60);
    expect(applyExplosiveCoverCut(80, 3)).toBe(70);
    expect(applyExplosiveCoverCut(80, 4)).toBe(80);
  });

  it("uses shift/truncation semantics", () => {
    expect(applyExplosiveCoverCut(61, 1)).toBe(30);
    expect(applyExplosiveCoverCut(61, 2)).toBe(46);
    expect(applyExplosiveCoverCut(61, 3)).toBe(54);
  });
});

describe("resolveBlast", () => {
  const targets = [
    { robotId: "r0", tile: { x: 10, y: 10 }, coverClass: 4 as const },
    { robotId: "r1", tile: { x: 11, y: 10 }, coverClass: 4 as const },
    { robotId: "r2", tile: { x: 12, y: 10 }, coverClass: 4 as const },
    { robotId: "outside", tile: { x: 13, y: 10 }, coverClass: 4 as const },
  ];

  it("uses exact missile minima", () => {
    expect(
      resolveBlast({
        impact: { x: 10, y: 10 },
        weapon: WEAPONS["missile-launcher"],
        potentialTargets: targets,
        rng: constantRng(0),
      }),
    ).toEqual([
      { robotId: "r0", radius: 0, damage: 60 },
      { robotId: "r1", radius: 1, damage: 40 },
      { robotId: "r2", radius: 2, damage: 10 },
    ]);
  });

  it("uses exact missile maxima", () => {
    expect(
      resolveBlast({
        impact: { x: 10, y: 10 },
        weapon: WEAPONS["missile-launcher"],
        potentialTargets: targets,
        rng: constantRng(0xffff),
      }).map((roll) => roll.damage),
    ).toEqual([91, 55, 17]);
  });

  it("uses exact grenade minima", () => {
    expect(
      resolveBlast({
        impact: { x: 10, y: 10 },
        weapon: WEAPONS["grenade-launcher"],
        potentialTargets: targets,
        rng: constantRng(0),
      }).map((roll) => roll.damage),
    ).toEqual([45, 25, 5]);
  });

  it("uses floored Euclidean radius", () => {
    const result = resolveBlast({
      impact: { x: 0, y: 0 },
      weapon: WEAPONS["missile-launcher"],
      potentialTargets: [{ robotId: "diag", tile: { x: 2, y: 2 }, coverClass: 4 }],
      rng: constantRng(0),
    });
    expect(result).toEqual([{ robotId: "diag", radius: 2, damage: 10 }]);
  });

  it("applies each target's cover class", () => {
    const result = resolveBlast({
      impact: { x: 0, y: 0 },
      weapon: WEAPONS["missile-launcher"],
      potentialTargets: [
        { robotId: "heavy", tile: { x: 0, y: 0 }, coverClass: 1 },
        { robotId: "exposed", tile: { x: 0, y: 0 }, coverClass: 4 },
      ],
      rng: constantRng(0),
    });
    expect(result.map((roll) => roll.damage)).toEqual([30, 60]);
  });

  it("rejects non-explosive weapons", () => {
    expect(() =>
      resolveBlast({
        impact: { x: 0, y: 0 },
        weapon: WEAPONS.rifle,
        potentialTargets: [],
        rng: constantRng(0),
      }),
    ).toThrow(/explosive weapon/);
  });
});
