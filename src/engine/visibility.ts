/**
 * Ordinary per-Team visibility for the four main-game combat classes.
 *
 * Implements `docs/spec.md` §7. Stealth is deliberately excluded.
 */

import { WEAPON_MAX_RANGE } from "./constants.js";
import { floorEuclideanDistance, isWithinScanCone, tilesAlongLineExclusive } from "./geometry.js";
import type { Arena, MatchState, RobotState, TileCoord, VisibilityState } from "./types.js";

export const visibilityTileKey = (tile: TileCoord): string => `${tile.x},${tile.y}`;

const isOnArena = (position: RobotState["position"]): position is TileCoord => position !== "dock";

const tileAt = (arena: Arena, tile: TileCoord) => arena.tiles[tile.y]?.[tile.x];

/**
 * Exact scan-grid sight value from `seg87:0x19E3`.
 *
 * Clear sight starts at 16. Every Low Wall or Bush sample removes 3; Walls and
 * Outer Walls immediately return 0. Crevices and ordinary ground do not cut
 * the value. The original path includes both endpoints.
 */
export const scanSightStrength = (arena: Arena, from: TileCoord, to: TileCoord): number => {
  if (from.x === to.x && from.y === to.y) return 16;

  let strength = 16;
  for (const tile of [from, ...tilesAlongLineExclusive(from, to), to]) {
    const terrain = tileAt(arena, tile)?.terrain;
    if (terrain === undefined || terrain === "wall" || terrain === "outer-wall") return 0;
    if (terrain === "low-wall" || terrain === "bush") {
      strength = Math.max(0, strength - 3);
    }
  }
  return strength;
};

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

  const visibleEnemies = new Set<string>();
  for (const team of state.teams) {
    for (const robot of team.robots) {
      if (robot.hp <= 0 || !isOnArena(robot.position)) continue;
      if (team.side === observingTeam.side) {
        visibleTiles.add(visibilityTileKey(robot.position));
      } else if (visibleTiles.has(visibilityTileKey(robot.position))) {
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
