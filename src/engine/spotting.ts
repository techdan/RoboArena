/**
 * The original per-tick spotting roll (rules revision 2).
 *
 * Implements re-map/stealth-fence-ceremony-ai-formats.md §1. Each movie tick
 * the original walks every pair of Teams on different Sides where either Team
 * did something (seg6:0x5898 → seg96:0x03E0). For each pair of live robots it
 * needs scan-grid sight and cover on both ends (seg96:0x060D); then, for each
 * robot whose scan cone holds the other, the other robot is seen outright when
 * it fired this tick and otherwise by a roll against DGROUP 0x213A
 * (seg96:0x09AF). A robot already seen stays seen while it is inside any
 * enemy cone with sight and cover; one outside every such cone is dropped
 * (seg96:0x0AAC). When neither robot of a pair moved or acted, no new
 * sighting happens but cone retention still applies.
 */

import { SPOTTING_COVER_BASE, SPOTTING_THRESHOLDS } from "./constants.js";
import { resolveCover } from "./cover.js";
import { floorEuclideanDistance, isWithinScanCone, scanSightStrength } from "./geometry.js";
import type { Arena, CoverClass, RobotState, TileCoord } from "./types.js";

/** Per-tick activity code, robot slot `ctx+0x29C` (seg96:0x0366). */
export type SpottingActivity = 0 | 1 | 3;

export interface SpottingRobot {
  readonly robot: RobotState & { readonly position: TileCoord };
  /** Moved flag `ctx+0x27C`: set every tick of a move or deploy, and for all robots at turn start. */
  readonly moved: boolean;
  /** 1 while running any command except Scan & Fire; 3 on a tick it fires. */
  readonly activity: SpottingActivity;
}

export interface SpottingTeam {
  readonly id: string;
  readonly side: number;
  /** Every robot id on the Team, live or not; the removal mask starts from all of them. */
  readonly robotIds: readonly string[];
  /** Live robots on the arena, in roster order. */
  readonly robots: readonly SpottingRobot[];
  /** Team flag `ctx+0x2CC`: any robot moved or had activity written this tick. */
  readonly dirty: boolean;
}

/**
 * Spotting index for one observation, seg96:0x09AF. Returns `null` when the
 * target cannot be spotted by roll (a Stealth robot that neither moved nor
 * stands within distance 1).
 */
export const spottingIndex = (input: {
  readonly coverClass: CoverClass;
  readonly sight: number;
  readonly distance: number;
  readonly moved: boolean;
  readonly activity: SpottingActivity;
  readonly stealth: boolean;
}): number | null => {
  let index = SPOTTING_COVER_BASE[input.coverClass];
  index -= 4 - (input.sight >> 2);
  if (input.moved) index += 4;
  else if (input.activity === 1) index += 2;
  index -= (input.distance >> 2) - 2;
  index = Math.min(13, Math.max(0, index));
  if (input.stealth) {
    if (!input.moved && input.distance > 1) return null;
    index = index > 4 ? index - 4 : 0;
  }
  return index;
};

/** Probability out of 256 that one roll spots the target. */
export const spottingThreshold = (index: number): number => SPOTTING_THRESHOLDS[index] ?? 0;

const coverClassOf = (arena: Arena, from: TileCoord, target: SpottingRobot): CoverClass | 0 => {
  const cover = resolveCover({
    from,
    to: target.robot.position,
    targetPosture: target.robot.posture,
    arenaTileAt: (tile) => arena.tiles[tile.y]?.[tile.x],
  });
  return cover.outcome === "cover" ? cover.coverClass : 0;
};

/**
 * One spotting pass. `spotted` maps each Team id to the enemy robot ids it
 * currently sees; the result is the next map. `rollByte` returns the low byte
 * of the authoritative RNG and is only called for an actual roll.
 */
export const updateSpotting = (input: {
  readonly arena: Arena;
  readonly teams: readonly SpottingTeam[];
  readonly spotted: ReadonlyMap<string, ReadonlySet<string>>;
  readonly rollByte: () => number;
}): Map<string, Set<string>> => {
  const { arena, teams, rollByte } = input;
  const next = new Map<string, Set<string>>();
  for (const team of teams) next.set(team.id, new Set(input.spotted.get(team.id) ?? []));

  const observe = (
    observer: SpottingRobot,
    target: SpottingRobot,
    targetCover: CoverClass,
    distance: number,
    sight: number,
    newlySeen: Set<string>,
    toRemove: Set<string>,
  ): void => {
    if (
      !isWithinScanCone(observer.robot.position, observer.robot.scanHeading, target.robot.position)
    ) {
      return;
    }
    if (target.activity === 3) {
      newlySeen.add(target.robot.id);
    } else {
      const index = spottingIndex({
        coverClass: targetCover,
        sight,
        distance,
        moved: target.moved,
        activity: target.activity,
        stealth: target.robot.definition.stealthVisibility === "stealth",
      });
      if (index !== null && (rollByte() & 0xff) < spottingThreshold(index)) {
        newlySeen.add(target.robot.id);
      }
    }
    toRemove.delete(target.robot.id);
  };

  for (let first = 0; first < teams.length; first += 1) {
    for (let second = first + 1; second < teams.length; second += 1) {
      const teamA = teams[first]!;
      const teamB = teams[second]!;
      if (teamA.side === teamB.side || (!teamA.dirty && !teamB.dirty)) continue;

      const seenByA = new Set<string>();
      const seenByB = new Set<string>();
      const removeFromA = new Set(teamB.robotIds);
      const removeFromB = new Set(teamA.robotIds);

      for (const a of teamA.robots) {
        for (const b of teamB.robots) {
          const sight = scanSightStrength(arena, a.robot.position, b.robot.position);
          if (sight === 0) continue;
          const coverA = coverClassOf(arena, b.robot.position, a);
          const coverB = coverClassOf(arena, a.robot.position, b);
          if (coverA === 0 || coverB === 0) continue;

          if (!a.moved && !b.moved && a.activity === 0 && b.activity === 0) {
            // seg96:0x088F: nothing happened, so only cone retention applies.
            if (isWithinScanCone(a.robot.position, a.robot.scanHeading, b.robot.position)) {
              removeFromA.delete(b.robot.id);
            }
            if (isWithinScanCone(b.robot.position, b.robot.scanHeading, a.robot.position)) {
              removeFromB.delete(a.robot.id);
            }
            continue;
          }

          const distance = floorEuclideanDistance(a.robot.position, b.robot.position);
          observe(a, b, coverB, distance, sight, seenByA, removeFromA);
          observe(b, a, coverA, distance, sight, seenByB, removeFromB);
        }
      }

      const nextA = next.get(teamA.id)!;
      for (const id of removeFromA) nextA.delete(id);
      for (const id of seenByA) nextA.add(id);
      const nextB = next.get(teamB.id)!;
      for (const id of removeFromB) nextB.delete(id);
      for (const id of seenByB) nextB.add(id);
    }
  }
  return next;
};
