/** Pure math for the 3D movie: board-to-world mapping, two-bone leg IK, gait
 *  scheduling and damped springs. Kept free of Three.js so it stays unit-testable.
 *
 *  World frame: 1 unit = 1 tile, +Y up, tile (x, y) centred at (x + 0.5, 0, y + 0.5).
 *  Engine North is -y, so it maps to world -Z. Robot models face +Z at yaw 0.
 */

import type { Heading, TileCoord } from "../engine/types";

export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

export const tileCenter = (tile: TileCoord): Vec2 => ({ x: tile.x + 0.5, z: tile.y + 0.5 });

const HEADING_VECTORS: Readonly<Record<Heading, readonly [number, number]>> = {
  N: [0, -1],
  NE: [1, -1],
  E: [1, 0],
  SE: [1, 1],
  S: [0, 1],
  SW: [-1, 1],
  W: [-1, 0],
  NW: [-1, -1],
};

/** Three.js `rotation.y` that turns a +Z-facing model toward world vector (dx, dz). */
export const yawToward = (dx: number, dz: number): number => Math.atan2(dx, dz);

export const headingYaw = (heading: Heading): number => {
  const [dx, dz] = HEADING_VECTORS[heading];
  return yawToward(dx, dz);
};

/** Wraps an angle into [-PI, PI). */
export const wrapAngle = (angle: number): number => {
  const tau = Math.PI * 2;
  let a = (angle + Math.PI) % tau;
  if (a < 0) a += tau;
  return a - Math.PI;
};

/** Moves `current` toward `target` along the shortest arc by at most `maxStep`. */
export const approachAngle = (current: number, target: number, maxStep: number): number => {
  const delta = wrapAngle(target - current);
  if (Math.abs(delta) <= maxStep) return target;
  return current + Math.sign(delta) * maxStep;
};

export interface LegSolution {
  /** Elevation of the upper segment above the hip's horizontal plane. */
  readonly hipPitch: number;
  /** Knee rotation relative to the upper segment (negative bends down). */
  readonly kneePitch: number;
  /** Absolute angle of the lower segment; the foot counter-rotates by it. */
  readonly footPitch: number;
  /** Whether the target was out of reach and the leg is fully stretched. */
  readonly clamped: boolean;
}

/**
 * Planar two-bone IK with the knee bending upward (spider stance).
 *
 * `reach` is the horizontal distance from hip to foot, `drop` the vertical
 * offset (negative when the foot is below the hip). Unreachable targets are
 * clamped to the nearest reachable distance, so the leg points straight at
 * the target instead of producing NaNs.
 */
export const solveLeg = (
  reach: number,
  drop: number,
  upper: number,
  lower: number,
): LegSolution => {
  const rawDistance = Math.hypot(reach, drop);
  const minDistance = Math.abs(upper - lower) + 1e-4;
  const maxDistance = upper + lower - 1e-4;
  const distance = Math.min(maxDistance, Math.max(minDistance, rawDistance));
  const toTarget = Math.atan2(drop, reach);
  const cosHip = (upper * upper + distance * distance - lower * lower) / (2 * upper * distance);
  const hipInterior = Math.acos(Math.min(1, Math.max(-1, cosHip)));
  const hipPitch = toTarget + hipInterior;
  const kneeX = Math.cos(hipPitch) * upper;
  const kneeY = Math.sin(hipPitch) * upper;
  const footX = Math.cos(toTarget) * distance;
  const footY = Math.sin(toTarget) * distance;
  const lowerAngle = Math.atan2(footY - kneeY, footX - kneeX);
  return {
    hipPitch,
    kneePitch: lowerAngle - hipPitch,
    footPitch: -lowerAngle,
    clamped: rawDistance !== distance,
  };
};

/**
 * Gait groups: legs in the same group step together. Quadrupeds use diagonal
 * pairs (trot); hexapods use alternating tripods. Leg order follows the model's
 * hip sockets: front-left, front-right, then pairs toward the rear.
 */
export const gaitGroups = (legCount: number): readonly (0 | 1)[] =>
  Array.from({ length: legCount }, (_, index) => {
    const row = Math.floor(index / 2);
    const side = index % 2;
    return ((row + side) % 2) as 0 | 1;
  });

/**
 * Which gait group may lift its feet this frame, given each resting leg's drift
 * from its target (`null` for a leg already mid-step). The group that has
 * fallen furthest behind goes first, so a fast stride cannot let the first
 * group step over and over while the other foot stays planted and the leg
 * stretches out behind the hull.
 */
export const pickStepGroup = (
  drifts: readonly (number | null)[],
  groups: readonly (0 | 1)[],
  threshold: number,
): 0 | 1 | null => {
  const worst = [-1, -1];
  drifts.forEach((drift, index) => {
    const group = groups[index] ?? 0;
    if (drift === null) worst[group] = Infinity;
    else worst[group] = Math.max(worst[group] ?? -1, drift);
  });
  // A group still mid-step holds the other one down; its stragglers may join it.
  if (worst[0] === Infinity) return 0;
  if (worst[1] === Infinity) return 1;
  const pick: 0 | 1 = (worst[1] ?? -1) > (worst[0] ?? -1) ? 1 : 0;
  return (worst[pick] ?? -1) > threshold ? pick : null;
};

/** Height of a stepping foot along its swing, a smooth arch peaking mid-step. */
export const swingHeight = (u: number, peak: number): number => {
  const t = Math.min(1, Math.max(0, u));
  return Math.sin(Math.PI * t) * peak;
};

/** Skitter ease: quick launch, glide, then a firm settle without overshoot. */
export const skitterEase = (u: number): number => {
  const t = Math.min(1, Math.max(0, u));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

/** Stride ease: a walker's even sine in-out pace from tile to tile. */
export const strideEase = (u: number): number => {
  const t = Math.min(1, Math.max(0, u));
  return (1 - Math.cos(Math.PI * t)) / 2;
};

/** Ballistic hop profile: 0 at take-off and landing, 1 at apex. */
export const hopArc = (u: number): number => {
  const t = Math.min(1, Math.max(0, u));
  return 4 * t * (1 - t);
};

/** Critically-damped-ish spring for presentation-only secondary motion. */
export class Spring {
  value: number;
  velocity = 0;
  target: number;

  constructor(
    initial: number,
    private readonly stiffness = 170,
    private readonly damping = 18,
  ) {
    this.value = initial;
    this.target = initial;
  }

  /** Adds an instantaneous velocity kick (recoil, flinch, landing). */
  kick(impulse: number): void {
    this.velocity += impulse;
  }

  snap(value: number): void {
    this.value = value;
    this.target = value;
    this.velocity = 0;
  }

  step(dt: number): number {
    // Sub-step so long frames (tab switches, slow GPUs) cannot explode the spring.
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i += 1) {
      const accel = this.stiffness * (this.target - this.value) - this.damping * this.velocity;
      this.velocity += accel * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
}

/** Seconds a bullet tracer takes to cross `tiles`; fast but readable. */
export const tracerFlightSeconds = (tiles: number): number => Math.min(0.32, 0.06 + tiles * 0.018);

/** Seconds a missile takes to reach its target; long enough to follow its trail. */
export const missileFlightSeconds = (tiles: number): number => Math.min(1.1, 0.35 + tiles * 0.045);

/** Seconds a lobbed grenade spends in the air. */
export const grenadeFlightSeconds = (tiles: number): number => Math.min(1.0, 0.4 + tiles * 0.05);

/** Deterministic hash → [0, 1) so presentation variety is stable across replays. */
export const hash01 = (seed: string, salt = 0): number => {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};
