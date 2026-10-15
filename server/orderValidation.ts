/**
 * Validate private programs using only the participant's robots and public map.
 * Implements docs/spec.md §2's authoritative order contract. Conditional fire
 * reserves finite ammo conservatively, matching the planner's legal prefixes.
 */
import { WEAPONS } from "../src/engine/catalog.js";
import { moveStepSize } from "../src/engine/commandInterpreter.js";
import { canTraverseTile, isFullSpeedTile } from "../src/engine/movement.js";
import type {
  Arena,
  GameConfig,
  HomeSlot,
  RobotCommandSegment,
  RobotState,
  TileCoord,
} from "../src/engine/types.js";

export const validatePrivateTimeline = (
  arena: Arena,
  homeSlot: HomeSlot,
  robot: RobotState,
  segments: readonly RobotCommandSegment[],
  config?: Pick<GameConfig, "rulesRevision" | "zapArmed">,
  teamRobots: readonly RobotState[] = [robot],
): string | null => {
  const formationRules = (config?.rulesRevision ?? 0) >= 3;
  let timeBombs = robot.timeBombs ?? 0;
  if (robot.hp <= 0 && segments.length > 0) return "Destroyed robots cannot receive commands.";
  let position = robot.position;
  let posture = robot.posture;
  const ammo = { ...robot.ammo };
  const inBounds = (tile: TileCoord): boolean =>
    Number.isInteger(tile.x) &&
    Number.isInteger(tile.y) &&
    tile.x >= 0 &&
    tile.y >= 0 &&
    tile.x < arena.width &&
    tile.y < arena.height;
  for (const segment of segments) {
    if (position === "dock" && segment.kind !== "deploy")
      return "A docked robot must deploy before executing other commands.";
    switch (segment.kind) {
      case "deploy":
        if (
          position !== "dock" ||
          !inBounds(segment.to) ||
          !arena.homeAreas[homeSlot]?.tiles.some(
            (tile) => tile.x === segment.to.x && tile.y === segment.to.y,
          )
        ) {
          return "Deploy requires a docked robot and a destination in its home area.";
        }
        position = segment.to;
        break;
      case "move":
        if (position === "dock" || segment.posture !== posture || segment.path.length === 0) {
          return "A move requires a non-empty path matching the robot's active posture.";
        }
        for (const step of segment.path) {
          const size = moveStepSize(position, step.to);
          if (
            size === null ||
            !inBounds(step.to) ||
            (size === 1 && step.via !== undefined) ||
            (size === 2 &&
              (step.via === undefined ||
                !inBounds(step.via) ||
                moveStepSize(position, step.via) !== 1 ||
                moveStepSize(step.via, step.to) !== 1))
          ) {
            return "Move path contains an invalid step.";
          }
          for (const entered of step.via === undefined ? [step.to] : [step.via, step.to]) {
            const tile = arena.tiles[entered.y]?.[entered.x];
            if (
              tile === undefined ||
              !canTraverseTile(posture, tile) ||
              (size === 2 && !isFullSpeedTile(tile))
            ) {
              return "Move path contains an untraversable or slow two-tile step.";
            }
          }
          position = step.to;
        }
        break;
      case "set-posture":
        if (!["upright", "ducking", "crouching"].includes(segment.posture))
          return "Posture value is invalid.";
        posture = segment.posture;
        break;
      case "set-scan-direction":
        if (!["N", "NE", "E", "SE", "S", "SW", "W", "NW"].includes(segment.heading))
          return "Scan heading is invalid.";
        break;
      case "aim-and-fire":
      case "scan-and-fire": {
        const weapon = WEAPONS[segment.weapon];
        if (
          weapon === undefined ||
          (!weapon.damageRoll && !weapon.blast) ||
          (robot.definition.primaryWeapon !== segment.weapon &&
            !robot.definition.secondaryWeapons?.includes(segment.weapon))
        ) {
          return "Fire commands require an owned, supported weapon.";
        }
        if (segment.kind === "aim-and-fire") {
          if (!inBounds(segment.target) || typeof segment.repeat !== "boolean")
            return "Aim target or repeat value is invalid.";
        } else if (
          !Number.isInteger(segment.maxDistance) ||
          segment.maxDistance < 1 ||
          segment.maxDistance > weapon.maxRange ||
          !Number.isInteger(segment.seconds) ||
          segment.seconds < 1 ||
          segment.seconds > 40
        ) {
          return "Scan distance must be within weapon range and duration must be 1-40 seconds.";
        }
        const remaining = ammo[segment.weapon];
        if (remaining !== "unlimited") {
          if (!Number.isInteger(remaining) || remaining <= 0)
            return "Fire commands require unreserved ammunition.";
          // Acquisitions and early exhaustion depend on hidden enemy actions.
          // No later command may rely on a Scan/repeat leaving finite ammo.
          ammo[segment.weapon] =
            segment.kind === "scan-and-fire" || segment.repeat ? 0 : remaining - 1;
        }
        break;
      }
      case "zap":
        if (!formationRules || config?.zapArmed !== true) return "Zap is not armed in this game.";
        if (!Number.isInteger(segment.seconds) || segment.seconds < 1 || segment.seconds > 40)
          return "Zap duration must be 1-40 seconds.";
        break;
      case "place-bomb":
        if (!formationRules || timeBombs <= 0) return "This robot carries no Time Bomb.";
        if (
          !Number.isInteger(segment.fuseSeconds) ||
          segment.fuseSeconds < 0 ||
          segment.fuseSeconds > 40
        )
          return "Bomb fuse must be 0-40 seconds.";
        timeBombs -= 1;
        break;
      case "self-destruct":
        // seg21:0x076C: offered only to a Team's last robot still standing.
        if (!formationRules || teamRobots.filter((member) => member.hp > 0).length !== 1)
          return "Only a Team's last robot can self-destruct.";
        break;
      default:
        return "Unsupported command.";
    }
  }
  return null;
};
