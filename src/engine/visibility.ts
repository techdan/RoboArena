/**
 * Ordinary per-Team visibility for the four main-game combat classes.
 *
 * Implements `docs/spec.md` §7. Under rules revision 2 the enemies a Team sees
 * come from the carried spotting state (`spotting.ts`); visible tiles stay the
 * geometric cone, line-of-sight and range view.
 */

import { WEAPON_MAX_RANGE } from "./constants.js";
import { floorEuclideanDistance, isWithinScanCone, scanSightStrength } from "./geometry.js";
import type { Arena, MatchState, RobotState, TileCoord, VisibilityState } from "./types.js";

/** Enemy ids a Team carries as spotted in rules-revision-2 state. */
export const spottedEnemyIds = (state: MatchState, teamId: string): ReadonlySet<string> =>
  new Set(state.spottedEnemies?.find((entry) => entry.teamId === teamId)?.enemyIds ?? []);

export const visibilityTileKey = (tile: TileCoord): string => `${tile.x},${tile.y}`;

const isOnArena = (position: RobotState["position"]): position is TileCoord => position !== "dock";

export { scanSightStrength };

export const hasVisibilityLineOfSight = (arena: Arena, from: TileCoord, to: TileCoord): boolean =>
  scanSightStrength(arena, from, to) > 0;

export const robotCanSeeTile = (arena: Arena, observer: RobotState, tile: TileCoord): boolean =>
  isOnArena(observer.position) &&
  floorEuclideanDistance(observer.position, tile) <= WEAPON_MAX_RANGE &&
  isWithinScanCone(observer.position, observer.scanHeading, tile) &&
  hasVisibilityLineOfSight(arena, observer.position, tile);

export const computeVisibility = (state: MatchState, observingTeamId: string): VisibilityState => {
  const observingTeam = state.teams.find((team) => team.id === observingTeamId);
  if (!observingTeam) throw new Error(`Unknown observing Team ${observingTeamId}.`);

  const visibleTiles = new Set<string>();
  for (const observer of observingTeam.robots) {
    if (observer.hp <= 0 || !isOnArena(observer.position)) continue;
    for (let y = 0; y < state.arena.height; y += 1) {
      for (let x = 0; x < state.arena.width; x += 1) {
        const tile = { x, y };
        if (robotCanSeeTile(state.arena, observer, tile)) {
          visibleTiles.add(visibilityTileKey(tile));
        }
      }
    }
  }

  const spotted = state.config.rulesRevision === 2 ? spottedEnemyIds(state, observingTeamId) : null;
  const visibleEnemies = new Set<string>();
  for (const team of state.teams) {
    for (const robot of team.robots) {
      if (robot.hp <= 0 || !isOnArena(robot.position)) continue;
      if (team.side === observingTeam.side) {
        visibleTiles.add(visibilityTileKey(robot.position));
      } else if (
        spotted === null
          ? visibleTiles.has(visibilityTileKey(robot.position))
          : spotted.has(robot.id)
      ) {
        visibleEnemies.add(robot.id);
      }
    }
  }

  return {
    visibleTiles,
    visibleEnemies,
    lastKnownMarkers: (state.lastKnownMarkers.get(observingTeamId) ?? []).map(
      (marker) => marker.at,
    ),
  };
};
