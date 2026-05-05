import { describe, expect, it } from "vitest";
import { createRng } from "./rng.js";

describe("createRng (mulberry32, seedable)", () => {
  it("same seed → same sequence (determinism contract)", () => {
    const a = createRng("seed-1");
    const b = createRng("seed-1");
    const seqA = Array.from({ length: 32 }, () => a.next());
    const seqB = Array.from({ length: 32 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("different seeds → different sequences", () => {
    const a = createRng("seed-1");
    const b = createRng("seed-2");
    const seqA = Array.from({ length: 8 }, () => a.next());
    const seqB = Array.from({ length: 8 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it("next() values are in [0, 1)", () => {
    const rng = createRng("range-check");
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("intInRange is uniform across the inclusive range", () => {
    const rng = createRng("uniform-test");
    const counts = new Map<number, number>();
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      const v = rng.intInRange(1, 6);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    // All six bins should be hit; chi-square sanity (each bin within ±20% of N/6)
    expect(counts.size).toBe(6);
    for (const [, count] of counts) {
      expect(count).toBeGreaterThan(N / 6 - N / 30);
      expect(count).toBeLessThan(N / 6 + N / 30);
    }
  });

  it("chance(p) approximates the requested probability", () => {
    const rng = createRng("chance-test");
    let trues = 0;
    const N = 20_000;
    for (let i = 0; i < N; i++) if (rng.chance(0.3)) trues++;
    expect(Math.abs(trues / N - 0.3)).toBeLessThan(0.01);
  });

  it("chance(0) is always false; chance(1) is always true", () => {
    const rng = createRng("edge");
    for (let i = 0; i < 100; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  it("snapshot/restore reproduces sequence", () => {
    const rng = createRng("snap-test");
    rng.next();
    rng.next();
    const checkpoint = rng.snapshot();
    const expected = Array.from({ length: 5 }, () => rng.next());
    rng.restore(checkpoint);
    const replayed = Array.from({ length: 5 }, () => rng.next());
    expect(replayed).toEqual(expected);
  });

  it("intInRange throws on inverted range", () => {
    const rng = createRng("invalid");
    expect(() => rng.intInRange(5, 1)).toThrow();
  });
});
