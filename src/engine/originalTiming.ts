/**
 * Pure helpers for rules revision 4, the original combat timing
 * (docs/re-map/timing.md, docs/spec.md §8).
 *
 * The resolver owns the 5-tick movie loop; this module holds the pieces that
 * do not need its state: the projectile queue order and the explosive scatter,
 * path stop and flight time.
 */

import {
  EXPLOSIVE_LOW_WALL_PASS_THRESHOLDS,
  EXPLOSIVE_PATH_MINIMUM,
  EXPLOSIVE_SCATTER_JITTER,
  GRENADE_FLIGHT,
  MISSILE_FLIGHT,
} from "./constants.js";
import { floorEuclideanDistance, isWithinFrontArc } from "./geometry.js";
import type { Arena, Heading, TileCoord } from "./types.js";

/** One draw from the game RNG stream; only the low bits are used. */
export type DrawRandom = () => number;

/** Anything with an impact time that waits in the projectile queue. */
export interface QueuedImpact {
  readonly impactsAt: number;
}

/**
 * Queue insert, seg6:0x1AD3: records are kept sorted by impact time and a new
 * record goes before existing records with the same time (the walk at
 * seg6:0x1B31 only continues while `old < new`), so equal times land newest
 * first. Mutates and returns `queue`.
 */
export const insertImpact = <Impact extends QueuedImpact>(
  queue: Impact[],
  impact: Impact,
): Impact[] => {
  let index = 0;
  while (index < queue.length && queue[index]!.impactsAt < impact.impactsAt) index += 1;
  queue.splice(index, 0, impact);
  return queue;
};

/**
 * Removes and returns every queued impact due at `tick`, in queue order
 * (seg6:0x556F pops while the head's time is `<= now`, seg6:0x1CF6).
 */
export const takeDueImpacts = <Impact extends QueuedImpact>(
  queue: Impact[],
  tick: number,
): Impact[] => {
  let count = 0;
  while (count < queue.length && queue[count]!.impactsAt <= tick) count += 1;
  return queue.splice(0, count);
};

const jitter = (index: number): number => EXPLOSIVE_SCATTER_JITTER[index]!;

/** Shared scatter inputs: the shooter, its heading and the point it throws at. */
export interface ScatterInput {
  readonly shooter: TileCoord;
  readonly heading: Heading;
  /** The aim tile (Aim & Fire) or the acquired robot's occupied tile (Scan & Fire). */
  readonly target: TileCoord;
  readonly draw: DrawRandom;
}

/**
 * Grenade scatter, seg6:0x39C7, with the RNG draws in the original order. The
 * stagger argument is always 0 because command dispatch clears it before the
 * fire handler runs (seg6:0x4CDA), so only the front-arc test (seg21:0x0F0A)
 * picks the branch. The range factor f/16 over- or undershoots the throw and
 * the jitter moves the point by up to 2 tiles; the division truncates toward
 * zero like the original `idiv`.
 */
export const scatterGrenade = ({ shooter, heading, target, draw }: ScatterInput): TileCoord => {
  const d = floorEuclideanDistance(shooter, target);
  const inArc = isWithinFrontArc(shooter, heading, target);
  let factor = 16;
  let ox = 0;
  let oy = 0;
  if (inArc && d <= 4) {
    // No draws: the shell goes exactly where it was aimed.
  } else if (inArc && d <= 8) {
    ox = jitter(draw() & 3);
    oy = jitter(draw() & 3);
  } else if (d <= 12) {
    factor = 13 + (draw() & 7);
    const mask = inArc ? 7 : 3;
    ox = jitter(draw() & mask);
    oy = jitter(draw() & mask);
  } else {
    const first = draw() & 7;
    factor = first + (draw() & 3) + 10;
    ox = jitter(draw() & 7);
    oy = jitter(draw() & 7);
  }
  const scale = (delta: number): number => Math.trunc((delta * factor * 16) / 256);
  return {
    x: shooter.x + scale(target.x - shooter.x) + ox,
    y: shooter.y + scale(target.y - shooter.y) + oy,
  };
};

/** Missile scatter, seg6:0x3BA6: a jitter around the target point, no range factor. */
export const scatterMissile = ({ shooter, heading, target, draw }: ScatterInput): TileCoord => {
  const d = floorEuclideanDistance(shooter, target);
  const inArc = isWithinFrontArc(shooter, heading, target);
  if (inArc && d <= 12) return target;
  const mask = inArc || d <= 8 ? 3 : 7;
  const ox = jitter(draw() & mask);
  const oy = jitter(draw() & mask);
  return { x: target.x + ox, y: target.y + oy };
};

/**
 * Tile Bresenham, seg56:0x0509: the start is excluded and the end included,
 * max(|dx|, |dy|) tiles, x-major only when |dx| > |dy|.
 */
export const explosivePathTiles = (from: TileCoord, to: TileCoord): TileCoord[] => {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const sx = Math.sign(to.x - from.x);
  const sy = Math.sign(to.y - from.y);
  const xMajor = dx > dy;
  const major = xMajor ? dx : dy;
  const minor = xMajor ? dy : dx;
  let err = 2 * minor - major;
  let x = from.x;
  let y = from.y;
  const tiles: TileCoord[] = [];
  for (let count = major; count > 0; count -= 1) {
    if (xMajor) x += sx;
    else y += sy;
    if (err < 0) {
      err += 2 * minor;
    } else {
      if (xMajor) y += sy;
      else x += sx;
      err += 2 * (minor - major);
    }
    tiles.push({ x, y });
  }
  return tiles;
};

const lowWallPassThreshold = (pathIndex: number): number =>
  EXPLOSIVE_LOW_WALL_PASS_THRESHOLDS.find((row) => pathIndex <= row.maxPathIndex)!.threshold;

/**
 * One path-stop attempt, seg87:0x2B77. The target is clamped into the arena,
 * the path is cut before its first Wall (seg87:0x2901 mode 2), and each Low
 * Wall on it draws one roll that can stop the shell on the tile before it
 * (seg87:0x29A7). Returns where the shell stops and whether the attempt counts.
 */
export const explosivePathAttempt = (input: {
  readonly arena: Arena;
  readonly from: TileCoord;
  readonly to: TileCoord;
  readonly draw: DrawRandom;
}): { readonly ok: boolean; readonly landing: TileCoord } => {
  const { arena, from, draw } = input;
  const to = {
    x: Math.max(0, Math.min(arena.width - 1, input.to.x)),
    y: Math.max(0, Math.min(arena.height - 1, input.to.y)),
  };
  const distance = floorEuclideanDistance(from, to);
  let landing = from;
  let passed = 0;
  for (const [index, tile] of explosivePathTiles(from, to).entries()) {
    const terrain = arena.tiles[tile.y]?.[tile.x]?.terrain;
    if (terrain === undefined || terrain === "wall" || terrain === "outer-wall") break;
    if (terrain === "low-wall" && (draw() & 0xff) >= lowWallPassThreshold(index)) break;
    landing = tile;
    passed += 1;
  }
  const ok =
    passed >= EXPLOSIVE_PATH_MINIMUM.tiles &&
    !(
      passed < EXPLOSIVE_PATH_MINIMUM.longMinimum && distance > EXPLOSIVE_PATH_MINIMUM.longDistance
    );
  return { ok, landing };
};

/**
 * Path stop, seg87:0x2B36: try the scattered point; if that attempt fails,
 * throw again at the exact aim point and keep wherever that one stops.
 */
export const explosiveLanding = (input: {
  readonly arena: Arena;
  readonly from: TileCoord;
  readonly scattered: TileCoord;
  readonly aim: TileCoord;
  readonly draw: DrawRandom;
}): TileCoord => {
  const first = explosivePathAttempt({ ...input, to: input.scattered });
  if (first.ok) return first.landing;
  return explosivePathAttempt({ ...input, to: input.aim }).landing;
};

/** Flight ticks from the shooter's tile to the landing tile (seg6:0x230C, seg6:0x27DB). */
export const explosiveFlightTicks = (
  weapon: "grenade-launcher" | "missile-launcher",
  from: TileCoord,
  landing: TileCoord,
): number => {
  const d = floorEuclideanDistance(from, landing);
  return weapon === "grenade-launcher"
    ? GRENADE_FLIGHT.ticksPerTile * d + GRENADE_FLIGHT.baseTicks
    : MISSILE_FLIGHT.ticksPerTwoTiles * (d >> 1) + MISSILE_FLIGHT.baseTicks;
};
