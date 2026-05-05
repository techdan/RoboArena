/**
 * Seedable deterministic RNG for the engine.
 *
 * Hard rule: the engine MUST NOT use `Math.random()` or any non-seeded source.
 * Replay determinism (initial state + seed + commands → identical timeline)
 * depends on every probabilistic decision going through this RNG.
 *
 * Algorithm: mulberry32 — 32-bit state, fast, deterministic, non-cryptographic.
 * Plenty good for game RNG; we don't need cryptographic strength.
 */

export interface Rng {
  /** Returns a uniform float in [0, 1). */
  next(): number;
  /** Returns a uniform integer in [min, max] (inclusive both ends). */
  intInRange(min: number, max: number): number;
  /** Returns true with the given probability (0..1). */
  chance(p: number): boolean;
  /** Snapshot the internal state — used to reproduce replays. */
  snapshot(): number;
  /** Restore from a snapshot. */
  restore(state: number): void;
}

/** Hash a string seed into a uint32 deterministically. */
const hashSeed = (seed: string): number => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
};

export const createRng = (seed: string): Rng => {
  let state = hashSeed(seed) || 1; // never let state be 0

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    intInRange(min, max) {
      if (max < min) throw new Error(`intInRange: max (${max}) < min (${min})`);
      return min + Math.floor(next() * (max - min + 1));
    },
    chance(p) {
      if (p <= 0) return false;
      if (p >= 1) return true;
      return next() < p;
    },
    snapshot() {
      return state;
    },
    restore(s) {
      state = s >>> 0 || 1;
    },
  };
};
