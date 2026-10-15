/**
 * Deterministic Phase 2-4 turn resolver.
 *
 * Implements the completion-driven boundary order in
 * `tasks/phase2-resolver-design.md` and `docs/spec.md` §8. Projectile cues are
 * presentation-only; ordinary visibility and Scan & Fire resolve as engine state.
 */

import {
  BOMB_CARRY_MINIMUM_TICKS,
  BOMB_MAX_FUSE_SECONDS,
  MISSILE_SCAN_MIN_DISTANCE,
  ORIGINAL_FORMATIONS_RULES_REVISION,
  ORIGINAL_TIMING_RULES_REVISION,
  MOVE_TILE_SWITCH_TICKS,
  MOVE_DOUBLE_DESTINATION_SWITCH_TICKS,
  PLACE_BOMB_COST_TICKS,
  SELF_DESTRUCT_COST_TICKS,
  SELF_DESTRUCT_IMPACT_DELAY_TICKS,
  POSTURE_CHANGE_COST_TICKS,
  SCAN_DIRECTION_COST_TICKS,
  SIMULATION_STEP_TICKS,
  TICKS_PER_SECOND,
  TIME_BOMB_BLAST,
  ZAP_COOLDOWN_TICKS,
  ZAP_DAMAGE_ROLL,
  ZAP_IMPACT_DELAY_TICKS,
  ZAP_MAX_SECONDS,
} from "./constants.js";
import { WEAPONS } from "./catalog.js";
import { resolveBlast, resolveBlastProfile } from "./blast.js";
import { commandDurationTicks, moveStepDurationTicks, moveStepSize } from "./commandInterpreter.js";
import { resolveCover } from "./cover.js";
import { floorEuclideanDistance, isWithinScanCone } from "./geometry.js";
import { canTraverseTile, isFullSpeedTile } from "./movement.js";
import { headingTurnSteps, postureChangeSteps } from "./orientation.js";
import { createRng } from "./rng.js";
import { resolveFire } from "./firing.js";
import { findScanAndFireTarget } from "./scanAndFire.js";
import { updateSpotting, type SpottingActivity, type SpottingTeam } from "./spotting.js";
import { computeVisibility, spottedEnemyIds, visibilityTileKey } from "./visibility.js";
import type {
  Arena,
  ArmedBomb,
  CommandTimeline,
  Heading,
  LastKnownMarker,
  MatchState,
  MovementStep,
  Posture,
  ResolutionEvent,
  RobotCommandSegment,
  RobotState,
  TeamState,
  TileCoord,
  TurnOrders,
  VisibilityState,
  WeaponDefinition,
} from "./types.js";

const COMMAND_KINDS: readonly RobotCommandSegment["kind"][] = [
  "deploy",
  "move",
  "set-posture",
  "set-scan-direction",
  "aim-and-fire",
  "scan-and-fire",
  "zap",
  "place-bomb",
  "self-destruct",
];
const POSTURES: readonly RobotState["posture"][] = ["upright", "ducking", "crouching"];
const HEADINGS: readonly RobotState["scanHeading"][] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export interface TurnResult {
  readonly outcome: "resolved";
  readonly nextState: MatchState;
  readonly events: readonly ResolutionEvent[];
}

export interface MalformedOrders {
  readonly outcome: "malformed-orders";
  readonly code:
    | "turn-number"
    | "duplicate-timeline"
    | "unknown-robot"
    | "illegal-command"
    | "unsupported-command";
  readonly message: string;
  readonly robotId?: string;
  readonly commandIndex?: number;
}

export type ResolveTurnResult = TurnResult | MalformedOrders;

export interface ResolveTurnInput {
  readonly state: MatchState;
  readonly orders: TurnOrders;
  readonly seed: string;
}

interface Actor {
  readonly robotId: string;
  readonly teamIndex: number;
  readonly rosterIndex: number;
  readonly side: number;
  readonly homeSlot: TeamState["homeSlot"];
}

interface ActiveCommand {
  readonly commandIndex: number;
  readonly command: RobotCommandSegment;
  readonly completesAt: number;
  readonly moveIndex: number;
  /**
   * Rules revision 2: the intermediate records of a stepped turn or posture
   * change; `moveIndex` counts the ones applied (re-map/commands.md §9).
   */
  readonly orientationSteps?: readonly Posture[] | readonly Heading[];
  /** Aim & Fire shoots on the command's first tick (seg6:0x4C7F dispatch). */
  readonly aimPending: boolean;
  readonly nextScanAt: number | null;
  /** Zap cooldown, program `+0x1A` (seg6:0x4005). */
  readonly nextZapAt?: number;
  /** Zap's periodic spotting refresh, program `+0x18` (seg6:0x4091). */
  readonly nextRefreshAt?: number;
  /** Revision 4: occupied-tile changes still due in the current move step. */
  readonly tileSwitches?: readonly TileSwitch[];
}

interface TileSwitch {
  readonly at: number;
  readonly to: TileCoord;
}

/**
 * Revision 4 occupied-tile switches for one move step starting at `start`
 * (seg6:0x2D59 single, seg6:0x2E04 double; `sar` floors the midpoint).
 */
const moveTileSwitches = (from: TileCoord, to: TileCoord, start: number): TileSwitch[] =>
  Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) === 2
    ? [
        {
          at: start + MOVE_TILE_SWITCH_TICKS,
          to: { x: Math.floor((from.x + to.x) / 2), y: Math.floor((from.y + to.y) / 2) },
        },
        { at: start + MOVE_DOUBLE_DESTINATION_SWITCH_TICKS, to },
      ]
    : [{ at: start + MOVE_TILE_SWITCH_TICKS, to }];

interface Cursor {
  readonly timeline: CommandTimeline;
  nextIndex: number;
  active: ActiveCommand | null;
}

type PendingDamage =
  | {
      readonly damageKind: "direct";
      readonly sourceId: string;
      readonly shotIndex: number;
      readonly targetId: string;
      readonly damage: number;
      readonly score: number;
    }
  | {
      readonly damageKind: "blast";
      readonly sourceId: string;
      readonly shotIndex: number;
      readonly targetId: string;
      readonly damage: number;
      readonly radius: number;
    }
  | {
      readonly damageKind: "zap";
      readonly sourceId: string;
      readonly targetId: string;
      readonly damage: number;
    };

/** A Self Destruct blast (projectile type 3) waiting to land (seg6:0x3541). */
interface PendingSelfDestruct {
  readonly robotId: string;
  readonly at: TileCoord;
  readonly impactsAt: number;
}

/** A zap projectile (type 5) waiting to land (seg6:0x57CF). */
interface PendingZap {
  readonly shooterId: string;
  readonly side: number;
  readonly at: TileCoord;
  readonly impactsAt: number;
}

type EventPayload = ResolutionEvent extends infer Event
  ? Event extends ResolutionEvent
    ? Omit<Event, "tick" | "seq">
    : never
  : never;

const sameTile = (a: TileCoord, b: TileCoord): boolean => a.x === b.x && a.y === b.y;

const isTileCoord = (position: RobotState["position"]): position is TileCoord =>
  position !== "dock";

const tileAt = (arena: Arena, coord: TileCoord) => arena.tiles[coord.y]?.[coord.x];

const isTileCoordValue = (coord: unknown): coord is TileCoord =>
  typeof coord === "object" &&
  coord !== null &&
  "x" in coord &&
  "y" in coord &&
  typeof coord.x === "number" &&
  typeof coord.y === "number" &&
  Number.isInteger(coord.x) &&
  Number.isInteger(coord.y);

const isInBounds = (arena: Arena, coord: unknown): coord is TileCoord =>
  isTileCoordValue(coord) &&
  coord.x >= 0 &&
  coord.y >= 0 &&
  coord.x < arena.width &&
  coord.y < arena.height;

const isMovementStepValue = (step: unknown): step is MovementStep =>
  typeof step === "object" &&
  step !== null &&
  "to" in step &&
  isTileCoordValue(step.to) &&
  (!("via" in step) || step.via === undefined || isTileCoordValue(step.via));

const malformed = (
  code: MalformedOrders["code"],
  message: string,
  robotId?: string,
  commandIndex?: number,
): MalformedOrders => ({
  outcome: "malformed-orders",
  code,
  message,
  ...(robotId === undefined ? {} : { robotId }),
  ...(commandIndex === undefined ? {} : { commandIndex }),
});

const robotOwnsWeapon = (robot: RobotState, weapon: WeaponDefinition): boolean =>
  robot.definition.primaryWeapon === weapon.id ||
  (robot.definition.secondaryWeapons?.includes(weapon.id) ?? false);

const movementDestinationIsLegal = (
  arena: Arena,
  from: TileCoord,
  step: unknown,
  robot: RobotState,
): boolean => {
  if (!isMovementStepValue(step) || !isInBounds(arena, step.to)) return false;
  const stepSize = moveStepSize(from, step.to);
  if (stepSize === null) return false;
  if (stepSize === 1 && step.via !== undefined) return false;
  if (
    stepSize === 2 &&
    (step.via === undefined ||
      !isInBounds(arena, step.via) ||
      moveStepSize(from, step.via) !== 1 ||
      moveStepSize(step.via, step.to) !== 1)
  ) {
    return false;
  }
  const enteredCoords = step.via === undefined ? [step.to] : [step.via, step.to];
  const enteredTiles = enteredCoords.map((coord) => tileAt(arena, coord));
  if (enteredTiles.some((tile) => tile === undefined || !canTraverseTile(robot.posture, tile))) {
    return false;
  }
  // Original TIL movement property 2 is required for every tile entered by a
  // two-tile selector. Slow property-1 terrain must be encoded as singles.
  return (
    stepSize === 1 || enteredTiles.every((tile) => tile !== undefined && isFullSpeedTile(tile))
  );
};

export const resolveTurn = (input: ResolveTurnInput): ResolveTurnResult => {
  const { state, orders } = input;
  if (orders.turnNumber !== state.turnNumber) {
    return malformed(
      "turn-number",
      `Orders for turn ${orders.turnNumber} cannot resolve state turn ${state.turnNumber}.`,
    );
  }

  const actors: Actor[] = [];
  const actorById = new Map<string, Actor>();
  const robots = new Map<string, RobotState>();
  state.teams.forEach((team, teamIndex) => {
    team.robots.forEach((robot, rosterIndex) => {
      const actor = {
        robotId: robot.id,
        teamIndex,
        rosterIndex,
        side: team.side,
        homeSlot: team.homeSlot,
      };
      actors.push(actor);
      actorById.set(robot.id, actor);
      robots.set(robot.id, {
        ...robot,
        hp: Math.max(0, Math.min(robot.definition.armor, robot.hp)),
      });
    });
  });
  // Original global Team order follows the non-compacting Team Name boxes.
  actors.sort((a, b) => a.homeSlot - b.homeSlot || a.rosterIndex - b.rosterIndex);

  const timelines = new Map<string, CommandTimeline>();
  for (const timeline of orders.timelines) {
    if (!actorById.has(timeline.robotId)) {
      return malformed("unknown-robot", `Unknown robot ${timeline.robotId}.`, timeline.robotId);
    }
    if (timelines.has(timeline.robotId)) {
      return malformed(
        "duplicate-timeline",
        `Robot ${timeline.robotId} has more than one timeline.`,
        timeline.robotId,
      );
    }
    timelines.set(timeline.robotId, timeline);
  }

  const cursors = new Map<string, Cursor>();
  for (const actor of actors) {
    cursors.set(actor.robotId, {
      timeline: timelines.get(actor.robotId) ?? { robotId: actor.robotId, segments: [] },
      nextIndex: 0,
      active: null,
    });
  }

  const revision = state.config.rulesRevision ?? 0;
  const originalRules = revision >= 2;
  /** Revision 3: formation weapons, Show Enemy Positions and 5-tick spotting steps. */
  const formationRules = revision >= ORIGINAL_FORMATIONS_RULES_REVISION;
  /** Revision 4: the original combat timing (mid-move tile switch and the rest). */
  const timingRules = revision >= ORIGINAL_TIMING_RULES_REVISION;
  const showAllEnemies = formationRules && state.config.showEnemyPositions === true;
  const isStepTick = (tick: number): boolean => tick % SIMULATION_STEP_TICKS === 0;
  const rng = createRng(input.seed);
  const events: ResolutionEvent[] = [];
  let seq = 0;
  const emit = (tick: number, payload: EventPayload): void => {
    events.push({ tick, seq: seq++, ...payload } as ResolutionEvent);
  };

  /** Robots that fired on the tick being resolved (activity code 3, seg6:0x20B6). */
  const firedThisTick = new Set<string>();
  /** Zappers given activity code 2 by the periodic refresh (seg6:0x40F5). */
  const refreshedThisStep = new Set<string>();

  const findTargetAt = (shooter: Actor, target: TileCoord): string | null => {
    for (const candidate of actors) {
      if (candidate.side === shooter.side) continue;
      const robot = robots.get(candidate.robotId);
      if (
        robot &&
        robot.hp > 0 &&
        isTileCoord(robot.position) &&
        sameTile(robot.position, target)
      ) {
        return robot.id;
      }
    }
    return null;
  };

  /** Armed Time Bombs, in placement order (item slots 12..15, seg28:0x0D13). */
  let armedBombs: ArmedBomb[] = [...(state.armedBombs ?? [])];
  const pendingZaps: PendingZap[] = [];
  const pendingSelfDestructs: PendingSelfDestruct[] = [];
  /**
   * seg21:0x076C enables Self Destruct only while a Team has exactly one robot
   * whose damage has not reached its armor; judged from the planned position.
   */
  const lastStandingTeams = new Set(
    state.teams
      .filter((team) => team.robots.filter((robot) => robot.hp > 0).length === 1)
      .map((team) => team.id),
  );

  /**
   * Place Bomb (seg6:0x2B08 → seg28:0x0D13): arms the carried bomb on the
   * robot's tile to go off `fuse × 60 + 60` ticks after the command starts.
   */
  const placeBomb = (
    robot: RobotState,
    at: TileCoord,
    commandIndex: number,
    tick: number,
    fuseSeconds: number,
  ): void => {
    const bombId = `${state.turnNumber}:${robot.id}:${commandIndex}`;
    const detonatesAt = tick + fuseSeconds * TICKS_PER_SECOND + PLACE_BOMB_COST_TICKS;
    robots.set(robot.id, { ...robot, timeBombs: (robot.timeBombs ?? 0) - 1 });
    armedBombs.push({ id: bombId, ownerId: robot.id, teamId: robot.teamId, at, detonatesAt });
    emit(tick, { kind: "bomb-placed", robotId: robot.id, bombId, at, detonatesAt });
  };

  const startCommand = (actor: Actor, tick: number): MalformedOrders | null => {
    const robot = robots.get(actor.robotId);
    const cursor = cursors.get(actor.robotId);
    if (!robot || !cursor || robot.hp <= 0 || cursor.active || tick >= turnDuration) return null;
    const command = cursor.timeline.segments[cursor.nextIndex];
    if (!command) return null;
    const commandIndex = cursor.nextIndex;

    if (
      !COMMAND_KINDS.includes(command.kind) ||
      ((command.kind === "zap" ||
        command.kind === "place-bomb" ||
        command.kind === "self-destruct") &&
        !formationRules)
    ) {
      return malformed(
        "unsupported-command",
        `Unknown command kind ${String(command.kind)}.`,
        robot.id,
        commandIndex,
      );
    }

    if (robot.position === "dock" && command.kind !== "deploy") {
      return malformed(
        "illegal-command",
        "A docked robot must deploy before executing other commands.",
        robot.id,
        commandIndex,
      );
    }
    if (robot.position !== "dock" && command.kind === "deploy") {
      return malformed(
        "illegal-command",
        "Only a docked robot can deploy.",
        robot.id,
        commandIndex,
      );
    }

    let completesAt: number;
    let aimPending = false;
    let nextScanAt: number | null = null;
    let orientationSteps: readonly Posture[] | readonly Heading[] | undefined;
    let nextZapAt: number | undefined;
    let tileSwitches: TileSwitch[] | undefined;
    if (command.kind === "zap") {
      if (state.config.zapArmed !== true) {
        return malformed(
          "illegal-command",
          "Zap is not armed in this formation.",
          robot.id,
          commandIndex,
        );
      }
      if (
        !Number.isInteger(command.seconds) ||
        command.seconds < 1 ||
        command.seconds > ZAP_MAX_SECONDS
      ) {
        return malformed(
          "illegal-command",
          "Zap duration must be 1-40 seconds.",
          robot.id,
          commandIndex,
        );
      }
      completesAt = tick + command.seconds * TICKS_PER_SECOND;
      nextZapAt = tick;
    } else if (command.kind === "place-bomb") {
      if (
        !Number.isInteger(command.fuseSeconds) ||
        command.fuseSeconds < 0 ||
        command.fuseSeconds > BOMB_MAX_FUSE_SECONDS
      ) {
        return malformed(
          "illegal-command",
          "Bomb fuse must be 0-40 seconds.",
          robot.id,
          commandIndex,
        );
      }
      if ((robot.timeBombs ?? 0) <= 0 || !isTileCoord(robot.position)) {
        return malformed(
          "illegal-command",
          "Only a robot carrying a Time Bomb can place one.",
          robot.id,
          commandIndex,
        );
      }
      completesAt = tick + PLACE_BOMB_COST_TICKS;
    } else if (command.kind === "self-destruct") {
      if (!isTileCoord(robot.position) || !lastStandingTeams.has(robot.teamId)) {
        return malformed(
          "illegal-command",
          "Only a Team's last robot can self-destruct.",
          robot.id,
          commandIndex,
        );
      }
      completesAt = tick + SELF_DESTRUCT_COST_TICKS;
    } else if (command.kind === "move") {
      if (
        !Array.isArray(command.path) ||
        command.path.length === 0 ||
        !POSTURES.includes(command.posture) ||
        command.posture !== robot.posture ||
        !isTileCoord(robot.position)
      ) {
        return malformed(
          "illegal-command",
          "A move requires a non-empty path matching the robot's active posture.",
          robot.id,
          commandIndex,
        );
      }
      const first = command.path[0];
      if (!first || !movementDestinationIsLegal(state.arena, robot.position, first, robot)) {
        return malformed(
          "illegal-command",
          "Move path contains an out-of-bounds, non-adjacent, or untraversable step.",
          robot.id,
          commandIndex,
        );
      }
      const duration = moveStepDurationTicks(robot.position, first.to);
      if (duration === null) {
        return malformed("illegal-command", "Move step size is invalid.", robot.id, commandIndex);
      }
      completesAt = tick + duration;
      if (timingRules) tileSwitches = moveTileSwitches(robot.position, first.to, tick);
    } else if (command.kind === "deploy") {
      const home = state.arena.homeAreas[actor.homeSlot];
      if (
        !isInBounds(state.arena, command.to) ||
        !home?.tiles.some((tile) => sameTile(tile, command.to))
      ) {
        return malformed(
          "illegal-command",
          "Deploy destination must be inside the team's home area.",
          robot.id,
          commandIndex,
        );
      }
      // Home rectangles are derived from arena size and can contain Walls and
      // Crevices; the planner already refuses those, so the authority must too.
      const destinationTile = tileAt(state.arena, command.to);
      if (destinationTile === undefined || !canTraverseTile(robot.posture, destinationTile)) {
        return malformed(
          "illegal-command",
          "Deploy destination must be traversable terrain.",
          robot.id,
          commandIndex,
        );
      }
      completesAt = tick + (commandDurationTicks(command, robot) ?? 0);
    } else if (command.kind === "set-posture") {
      if (!POSTURES.includes(command.posture)) {
        return malformed("illegal-command", "Posture value is invalid.", robot.id, commandIndex);
      }
      const duration = commandDurationTicks(command, robot);
      if (duration === null) {
        return malformed(
          "illegal-command",
          "Posture command duration is invalid.",
          robot.id,
          commandIndex,
        );
      }
      if (duration === 0) {
        cursor.nextIndex += 1;
        return null;
      }
      if (originalRules) {
        orientationSteps = postureChangeSteps(robot.posture, command.posture);
        completesAt = tick + POSTURE_CHANGE_COST_TICKS;
      } else {
        completesAt = tick + duration;
      }
    } else if (command.kind === "set-scan-direction") {
      if (!HEADINGS.includes(command.heading)) {
        return malformed("illegal-command", "Scan heading is invalid.", robot.id, commandIndex);
      }
      const duration = commandDurationTicks(command, robot);
      if (duration === null) {
        return malformed(
          "illegal-command",
          "Scan command duration is invalid.",
          robot.id,
          commandIndex,
        );
      }
      if (duration === 0) {
        cursor.nextIndex += 1;
        return null;
      }
      if (originalRules) {
        orientationSteps = headingTurnSteps(robot.scanHeading, command.heading);
        completesAt = tick + SCAN_DIRECTION_COST_TICKS;
      } else {
        completesAt = tick + duration;
      }
    } else if (command.kind === "scan-and-fire") {
      const weapon = (WEAPONS as Partial<Record<string, WeaponDefinition>>)[command.weapon];
      if (!weapon || !robotOwnsWeapon(robot, weapon) || (!weapon.damageRoll && !weapon.blast)) {
        return malformed(
          "unsupported-command",
          "Scan & Fire requires an owned, supported weapon.",
          robot.id,
          commandIndex,
        );
      }
      if (
        !Number.isInteger(command.maxDistance) ||
        command.maxDistance < 1 ||
        command.maxDistance > weapon.maxRange ||
        !Number.isInteger(command.seconds) ||
        command.seconds < 1 ||
        command.seconds > 40
      ) {
        return malformed(
          "illegal-command",
          "Scan & Fire distance must be within weapon range and duration must be 1-40 seconds.",
          robot.id,
          commandIndex,
        );
      }
      const ammo = robot.ammo[weapon.id];
      if (ammo === undefined || (ammo !== "unlimited" && (!Number.isInteger(ammo) || ammo <= 0))) {
        return malformed(
          "illegal-command",
          "Scan & Fire requires available ammo.",
          robot.id,
          commandIndex,
        );
      }
      completesAt = tick + command.seconds * TICKS_PER_SECOND;
      nextScanAt = tick;
    } else {
      if (!isInBounds(state.arena, command.target)) {
        return malformed(
          "illegal-command",
          "Aim target is outside the arena.",
          robot.id,
          commandIndex,
        );
      }
      if (typeof command.repeat !== "boolean") {
        return malformed(
          "illegal-command",
          "Aim & Fire repeat must be a boolean.",
          robot.id,
          commandIndex,
        );
      }
      const weapon = (WEAPONS as Partial<Record<string, WeaponDefinition>>)[command.weapon];
      if (!weapon || !robotOwnsWeapon(robot, weapon) || (!weapon.damageRoll && !weapon.blast)) {
        return malformed(
          "unsupported-command",
          "Aim & Fire requires an owned, supported weapon.",
          robot.id,
          commandIndex,
        );
      }
      const ammo = robot.ammo[weapon.id];
      if (ammo === undefined || (ammo !== "unlimited" && (!Number.isInteger(ammo) || ammo <= 0))) {
        return malformed(
          "illegal-command",
          "Aim & Fire requires available ammo.",
          robot.id,
          commandIndex,
        );
      }
      completesAt = tick + (commandDurationTicks(command, robot, weapon.firingIntervalTicks) ?? 0);
      aimPending = true;
    }

    cursor.active = {
      commandIndex,
      command,
      completesAt,
      moveIndex: 0,
      ...(orientationSteps === undefined ? {} : { orientationSteps }),
      aimPending,
      nextScanAt,
      ...(nextZapAt === undefined ? {} : { nextZapAt, nextRefreshAt: nextZapAt }),
      ...(tileSwitches === undefined ? {} : { tileSwitches }),
    };
    emit(tick, {
      kind: "command-start",
      robotId: robot.id,
      commandIndex,
      commandKind: command.kind,
    });
    if (command.kind === "place-bomb" && isTileCoord(robot.position)) {
      placeBomb(robot, robot.position, commandIndex, tick, command.fuseSeconds);
    }
    if (command.kind === "self-destruct" && isTileCoord(robot.position)) {
      pendingSelfDestructs.push({
        robotId: robot.id,
        at: robot.position,
        impactsAt: tick + SELF_DESTRUCT_IMPACT_DELAY_TICKS,
      });
    }
    return null;
  };

  const startAvailableCommand = (actor: Actor, tick: number): MalformedOrders | null => {
    const cursor = cursors.get(actor.robotId);
    while (cursor && !cursor.active) {
      const previousIndex = cursor.nextIndex;
      const error = startCommand(actor, tick);
      if (error || cursor.active || cursor.nextIndex === previousIndex) return error;
    }
    return null;
  };

  const resolveFiringAction = (input: {
    readonly actor: Actor;
    readonly commandIndex: number;
    readonly tick: number;
    readonly weapon: WeaponDefinition;
    readonly targetTile: TileCoord;
    readonly target?: RobotState & { readonly position: TileCoord };
    readonly fireMode: "aim" | "scan";
    readonly scanStrength?: number;
    readonly scanMaxDistance?: number;
    readonly pendingDamage: PendingDamage[];
  }): number | "unlimited" => {
    const shooter = robots.get(input.actor.robotId);
    if (!shooter || shooter.hp <= 0 || !isTileCoord(shooter.position)) {
      return input.weapon.startingAmmo;
    }
    firedThisTick.add(shooter.id);
    emit(input.tick, {
      kind: "fired",
      shooterId: shooter.id,
      commandIndex: input.commandIndex,
      weapon: input.weapon.id,
      target: input.targetTile,
      fireMode: input.fireMode,
    });

    let updatedShooter = shooter;
    const currentAmmo = shooter.ammo[input.weapon.id];
    if (currentAmmo !== "unlimited") {
      updatedShooter = {
        ...updatedShooter,
        ammo: { ...updatedShooter.ammo, [input.weapon.id]: Math.max(0, currentAmmo - 1) },
      };
    }

    for (let shotIndex = 0; shotIndex < input.weapon.bulletsPerClick; shotIndex += 1) {
      const projectileId = `${state.turnNumber}:${shooter.id}:${input.commandIndex}:${input.tick}:${shotIndex}`;
      emit(input.tick, {
        kind: "projectile-launched",
        projectileId,
        shooterId: shooter.id,
        shotIndex,
        weapon: input.weapon.id,
        from: shooter.position,
        target: input.targetTile,
      });

      if (input.weapon.blast) {
        const distance = floorEuclideanDistance(shooter.position, input.targetTile);
        const trajectoryFailure =
          distance > input.weapon.maxRange
            ? "out-of-range"
            : !isWithinScanCone(shooter.position, shooter.scanHeading, input.targetTile)
              ? "angle-blocked"
              : resolveCover({
                    from: shooter.position,
                    to: input.targetTile,
                    targetPosture: "upright",
                    arenaTileAt: (coord) => tileAt(state.arena, coord),
                  }).outcome === "blocked"
                ? "sight-blocked"
                : null;
        if (trajectoryFailure) {
          emit(input.tick, {
            kind: "projectile-impacted",
            projectileId,
            weapon: input.weapon.id,
            target: input.targetTile,
            outcome: "miss",
          });
          emit(input.tick, {
            kind: "shot-missed",
            shooterId: shooter.id,
            shotIndex,
            target: input.targetTile,
            reason: trajectoryFailure,
          });
          continue;
        }
        const potentialTargets = actors.flatMap((candidate) => {
          const robot = robots.get(candidate.robotId);
          if (!robot || robot.hp <= 0 || !isTileCoord(robot.position)) return [];
          const cover = resolveCover({
            from: input.targetTile,
            to: robot.position,
            targetPosture: robot.posture,
            arenaTileAt: (coord) => tileAt(state.arena, coord),
          });
          if (cover.outcome === "blocked") return [];
          return [{ robotId: robot.id, tile: robot.position, coverClass: cover.coverClass }];
        });
        const blastRolls = resolveBlast({
          impact: input.targetTile,
          weapon: input.weapon,
          potentialTargets,
          rng,
        });
        for (const roll of blastRolls) {
          input.pendingDamage.push({
            damageKind: "blast",
            sourceId: shooter.id,
            shotIndex,
            targetId: roll.robotId,
            damage: roll.damage,
            radius: roll.radius,
          });
        }
        emit(input.tick, {
          kind: "projectile-impacted",
          projectileId,
          weapon: input.weapon.id,
          target: input.targetTile,
          outcome: "blast",
        });
        continue;
      }

      if (!input.target || input.target.hp <= 0) {
        emit(input.tick, {
          kind: "projectile-impacted",
          projectileId,
          weapon: input.weapon.id,
          target: input.targetTile,
          outcome: "miss",
        });
        emit(input.tick, {
          kind: "shot-missed",
          shooterId: shooter.id,
          shotIndex,
          target: input.targetTile,
          reason: "no-target",
        });
        continue;
      }

      const result = resolveFire({
        shooterTile: shooter.position,
        shooterHeading: shooter.scanHeading,
        shooterAccuracy: shooter.definition.accuracy,
        targetTile: input.target.position,
        targetPosture: input.target.posture,
        weapon: input.weapon,
        arenaTileAt: (coord) => tileAt(state.arena, coord),
        rng,
        // The original stores the stagger count on the program object and
        // clears it at every command dispatch (seg6:0x4CDA) before any fire
        // handler reads it, so it never halves a shot (RE §15).
        damageStaggered: false,
        fireMode: input.fireMode,
        ...(input.scanStrength === undefined ? {} : { scanStrength: input.scanStrength }),
        ...(input.scanMaxDistance === undefined ? {} : { scanMaxDistance: input.scanMaxDistance }),
      });
      if (result.outcome === "hit") {
        input.pendingDamage.push({
          damageKind: "direct",
          sourceId: shooter.id,
          shotIndex,
          targetId: input.target.id,
          damage: result.damage,
          score: result.score,
        });
        emit(input.tick, {
          kind: "projectile-impacted",
          projectileId,
          weapon: input.weapon.id,
          target: input.targetTile,
          outcome: "hit",
        });
      } else {
        const reason = result.outcome === "miss" ? "hit-roll" : result.outcome;
        emit(input.tick, {
          kind: "projectile-impacted",
          projectileId,
          weapon: input.weapon.id,
          target: input.targetTile,
          outcome: "miss",
        });
        emit(input.tick, {
          kind: "shot-missed",
          shooterId: shooter.id,
          shotIndex,
          target: input.targetTile,
          reason,
          ...(result.outcome === "miss" ? { score: result.score } : {}),
        });
      }
    }

    if (shooter.damageStaggerActionsRemaining > 0) {
      updatedShooter = {
        ...updatedShooter,
        damageStaggerActionsRemaining: shooter.damageStaggerActionsRemaining - 1,
      };
    }
    robots.set(shooter.id, updatedShooter);
    return updatedShooter.ammo[input.weapon.id];
  };

  /**
   * Aim & Fire shoots on the first tick of its command, then the selector's
   * duration elapses (seg6:0x49F8..0x4AE2 → 0x4C7F → 0x1DCE). The shot
   * resolves against whichever enemy robot occupies the aimed tile at that
   * moment (seg18:0x03C0); with none there, the shot is wasted.
   */
  const resolveAimStarts = (tick: number, pendingDamage: PendingDamage[]): void => {
    for (const actor of actors) {
      const cursor = cursors.get(actor.robotId);
      const active = cursor?.active;
      if (!cursor || !active || !active.aimPending || active.command.kind !== "aim-and-fire") {
        continue;
      }
      cursor.active = { ...active, aimPending: false };
      const command = active.command;
      const targetId = findTargetAt(actor, command.target);
      const targetRobot = targetId ? robots.get(targetId) : undefined;
      const target =
        targetRobot && isTileCoord(targetRobot.position)
          ? { ...targetRobot, position: targetRobot.position }
          : undefined;
      resolveFiringAction({
        actor,
        commandIndex: active.commandIndex,
        tick,
        weapon: WEAPONS[command.weapon],
        targetTile: command.target,
        ...(target === undefined ? {} : { target }),
        fireMode: "aim",
        pendingDamage,
      });
    }
  };

  const resolveScanOpportunities = (tick: number, pendingDamage: PendingDamage[]): void => {
    for (const actor of actors) {
      const cursor = cursors.get(actor.robotId);
      const active = cursor?.active;
      if (
        !cursor ||
        !active ||
        active.command.kind !== "scan-and-fire" ||
        active.nextScanAt === null ||
        tick < active.nextScanAt ||
        tick >= active.completesAt
      ) {
        continue;
      }
      const shooter = robots.get(actor.robotId);
      if (!shooter || shooter.hp <= 0 || !isTileCoord(shooter.position)) continue;
      const weapon = WEAPONS[active.command.weapon];
      const acquired = findScanAndFireTarget({
        arena: state.arena,
        shooter: { ...shooter, position: shooter.position },
        shooterSide: actor.side,
        candidates: actors.flatMap((candidate) => {
          const robot = robots.get(candidate.robotId);
          return robot ? [{ side: candidate.side, robot }] : [];
        }),
        maxDistance: Math.min(active.command.maxDistance, weapon.maxRange),
      });
      // Missile Scan & Fire holds fire while its best target is too close.
      if (
        !acquired ||
        (weapon.id === "missile-launcher" && acquired.distance < MISSILE_SCAN_MIN_DISTANCE)
      ) {
        cursor.active = { ...active, nextScanAt: tick + 1 };
        continue;
      }
      emit(tick, {
        kind: "scan-target-acquired",
        shooterId: shooter.id,
        targetId: acquired.robot.id,
        distance: acquired.distance,
      });
      const remainingAmmo = resolveFiringAction({
        actor,
        commandIndex: active.commandIndex,
        tick,
        weapon,
        targetTile: acquired.robot.position,
        target: acquired.robot,
        fireMode: "scan",
        scanStrength: acquired.scanStrength,
        scanMaxDistance: active.command.maxDistance,
        pendingDamage,
      });
      if (remainingAmmo === 0) {
        cursor.nextIndex += 1;
        cursor.active = null;
      } else {
        cursor.active = {
          ...active,
          nextScanAt: tick + weapon.scanFiringIntervalTicks,
        };
      }
    }
  };

  /**
   * Zap (seg6:0x2BD9): on each simulation step while the command lasts and the
   * cooldown has passed, a live enemy-Side robot on the zapper's own tile
   * (seg18:0x05F3) triggers a type 5 projectile that lands 5 ticks later.
   */
  const resolveZapChecks = (tick: number): void => {
    if (!isStepTick(tick)) return;
    for (const actor of actors) {
      const cursor = cursors.get(actor.robotId);
      const active = cursor?.active;
      if (
        !cursor ||
        !active ||
        active.command.kind !== "zap" ||
        active.nextZapAt === undefined ||
        tick < active.nextZapAt ||
        tick >= active.completesAt
      ) {
        continue;
      }
      const zapper = robots.get(actor.robotId);
      if (!zapper || zapper.hp <= 0 || !isTileCoord(zapper.position)) continue;
      // seg6:0x4091: every 30 + 5·(rand & 15) ticks the zapper counts as active
      // (activity 2) for the spotting pass.
      if (tick >= (active.nextRefreshAt ?? tick)) {
        refreshedThisStep.add(zapper.id);
        cursor.active = {
          ...active,
          nextRefreshAt: tick + 30 + SIMULATION_STEP_TICKS * (rng.nextUint32() & 15),
        };
      }
      if (findTargetAt(actor, zapper.position) === null) continue;
      pendingZaps.push({
        shooterId: zapper.id,
        side: actor.side,
        at: zapper.position,
        impactsAt: tick + ZAP_IMPACT_DELAY_TICKS,
      });
      firedThisTick.add(zapper.id);
      emit(tick, { kind: "zapped", shooterId: zapper.id, at: zapper.position });
      cursor.active = { ...cursor.active!, nextZapAt: tick + ZAP_COOLDOWN_TICKS };
    }
  };

  /**
   * Zap impact (seg6:0x57CF → seg6:0x602B): every live enemy-Side robot on the
   * tile takes 60 + (rand & 63) with no cover or posture cut.
   */
  const resolveZapImpacts = (tick: number, pendingDamage: PendingDamage[]): void => {
    for (let index = 0; index < pendingZaps.length;) {
      const zap = pendingZaps[index]!;
      if (zap.impactsAt > tick) {
        index += 1;
        continue;
      }
      pendingZaps.splice(index, 1);
      for (const candidate of actors) {
        if (candidate.side === zap.side) continue;
        const robot = robots.get(candidate.robotId);
        if (!robot || robot.hp <= 0 || !isTileCoord(robot.position)) continue;
        if (!sameTile(robot.position, zap.at)) continue;
        pendingDamage.push({
          damageKind: "zap",
          sourceId: zap.shooterId,
          targetId: robot.id,
          damage: ZAP_DAMAGE_ROLL.base + (rng.nextUint32() & ZAP_DAMAGE_ROLL.mask),
        });
      }
    }
  };

  /** Category 2 blast (seg6:0x5D73) shared by Time Bomb and Self Destruct; hits every Side. */
  const resolveCategoryTwoBlast = (
    at: TileCoord,
    sourceId: string,
    pendingDamage: PendingDamage[],
  ): void => {
    const potentialTargets = actors.flatMap((candidate) => {
      const robot = robots.get(candidate.robotId);
      if (!robot || robot.hp <= 0 || !isTileCoord(robot.position)) return [];
      const cover = resolveCover({
        from: at,
        to: robot.position,
        targetPosture: robot.posture,
        arenaTileAt: (coord) => tileAt(state.arena, coord),
      });
      if (cover.outcome === "blocked") return [];
      return [{ robotId: robot.id, tile: robot.position, coverClass: cover.coverClass }];
    });
    for (const roll of resolveBlastProfile({
      impact: at,
      blast: TIME_BOMB_BLAST,
      potentialTargets,
      rng,
    })) {
      pendingDamage.push({
        damageKind: "blast",
        sourceId,
        shotIndex: 0,
        targetId: roll.robotId,
        damage: roll.damage,
        radius: roll.radius,
      });
    }
  };

  /**
   * Self Destruct impact (seg6:0x3541 → seg6:0x5675): the type-3 projectile
   * lands on the robot's tile 10 ticks after the command starts.
   */
  const resolveSelfDestructs = (tick: number, pendingDamage: PendingDamage[]): void => {
    for (let index = 0; index < pendingSelfDestructs.length;) {
      const blast = pendingSelfDestructs[index]!;
      if (blast.impactsAt > tick) {
        index += 1;
        continue;
      }
      pendingSelfDestructs.splice(index, 1);
      emit(tick, { kind: "self-destructed", robotId: blast.robotId, at: blast.at });
      resolveCategoryTwoBlast(blast.at, blast.robotId, pendingDamage);
    }
  };

  /**
   * Time Bomb detonation scan (seg6:0x542E): a bomb whose time has come and is
   * still before turn end explodes through the shared blast loop, category 2,
   * hitting every Side; the carrier is credited (seg6:0x5D34).
   */
  const resolveBombDetonations = (tick: number, pendingDamage: PendingDamage[]): void => {
    if (!isStepTick(tick)) return;
    const remaining: ArmedBomb[] = [];
    for (const bomb of armedBombs) {
      if (bomb.detonatesAt > tick || bomb.detonatesAt >= turnDuration) {
        remaining.push(bomb);
        continue;
      }
      emit(tick, { kind: "bomb-exploded", bombId: bomb.id, ownerId: bomb.ownerId, at: bomb.at });
      resolveCategoryTwoBlast(bomb.at, bomb.ownerId, pendingDamage);
    }
    armedBombs = remaining;
  };

  const applyPendingDamageAndDeaths = (tick: number, pendingDamage: PendingDamage[]): void => {
    const damagedIds = new Set<string>();
    for (const damage of pendingDamage) {
      const target = robots.get(damage.targetId);
      if (!target) continue;
      robots.set(target.id, {
        ...target,
        hp: Math.max(0, target.hp - damage.damage),
        damageStaggerActionsRemaining: (rng.nextUint32() & 3) + 1,
      });
      damagedIds.add(target.id);
      emit(tick, { kind: "damaged", ...damage });
    }

    for (const actor of actors) {
      if (!damagedIds.has(actor.robotId)) continue;
      const robot = robots.get(actor.robotId);
      if (!robot || robot.hp > 0) continue;
      robots.set(robot.id, { ...robot, hp: 0, position: "dock" });
      emit(tick, { kind: "destroyed", robotId: robot.id });
      const cursor = cursors.get(robot.id);
      if (cursor) {
        const abortedIndex = cursor.active?.commandIndex ?? cursor.nextIndex;
        if (cursor.active || cursor.timeline.segments[abortedIndex]) {
          emit(tick, {
            kind: "command-aborted",
            robotId: robot.id,
            commandIndex: abortedIndex,
            reason: "destroyed",
          });
        }
        cursor.active = null;
        cursor.nextIndex = cursor.timeline.segments.length;
      }
    }
  };

  const latestVisibility = new Map<string, VisibilityState>();
  const lastSeenByTeam = new Map<string, Map<string, TileCoord>>();

  const snapshotState = (): MatchState => ({
    ...state,
    teams: state.teams.map((team) => ({
      ...team,
      robots: team.robots.map((robot) => robots.get(robot.id) ?? robot),
    })),
  });

  const latestEnemies = new Map<string, ReadonlySet<string>>();

  const applyVisibleEnemies = (tick: number, teamId: string, next: ReadonlySet<string>): void => {
    const previous = latestEnemies.get(teamId);
    const lastSeen = lastSeenByTeam.get(teamId) ?? new Map<string, TileCoord>();
    for (const enemyId of next) {
      const enemy = robots.get(enemyId);
      if (!enemy || !isTileCoord(enemy.position)) continue;
      lastSeen.set(enemyId, enemy.position);
      if (!previous?.has(enemyId)) {
        emit(tick, { kind: "enemy-spotted", teamId, enemyId, at: enemy.position });
      }
    }
    if (previous) {
      for (const enemyId of previous) {
        if (next.has(enemyId)) continue;
        const lastSeenAt = lastSeen.get(enemyId);
        if (lastSeenAt) emit(tick, { kind: "enemy-lost", teamId, enemyId, lastSeenAt });
      }
    }
    lastSeenByTeam.set(teamId, lastSeen);
    latestEnemies.set(teamId, next);
  };

  const updateVisibility = (tick: number): void => {
    // Rules revision 2 changes visibility only in the per-tick spotting pass.
    if (originalRules) return;
    const snapshot = snapshotState();
    for (const team of state.teams) {
      const next = computeVisibility(snapshot, team.id);
      applyVisibleEnemies(tick, team.id, next.visibleEnemies);
      latestVisibility.set(team.id, next);
    }
  };

  /** Carried spotting masks (seg95:0x0A51 restores them at turn start). */
  let spotted = new Map<string, Set<string>>(
    state.teams.map((team) => [team.id, new Set(spottedEnemyIds(state, team.id))]),
  );

  /** Show Enemy Positions: every robot on another Side (seg5:0x082F sets the mask to 0x0F). */
  const allEnemiesOf = (team: TeamState): Set<string> =>
    new Set(
      state.teams
        .filter((other) => other.side !== team.side)
        .flatMap((other) => other.robots.map((robot) => robot.id)),
    );

  /** Enemies a Team sees: spotted, alive and on the arena. */
  const liveSpotted = (teamId: string): Set<string> =>
    new Set(
      [...(spotted.get(teamId) ?? [])].filter((id) => {
        const robot = robots.get(id);
        return robot !== undefined && robot.hp > 0 && isTileCoord(robot.position);
      }),
    );

  /**
   * One per-tick spotting pass (seg6:0x5898). `dueKinds` holds the commands that
   * completed this tick, which were in effect for it alongside any active one.
   */
  const runSpotting = (
    tick: number,
    turnStart: boolean,
    dueKinds: ReadonlyMap<string, RobotCommandSegment["kind"]>,
  ): void => {
    const teams: SpottingTeam[] = state.teams.map((team) => {
      let dirty = turnStart;
      const live: SpottingTeam["robots"][number][] = [];
      for (const { id } of team.robots) {
        const robot = robots.get(id);
        const kinds = [dueKinds.get(id), cursors.get(id)?.active?.command.kind].filter(
          (kind): kind is RobotCommandSegment["kind"] => kind !== undefined,
        );
        // Per-tick table seg6:0x4F34: moves and deploys set the moved flag;
        // every command except Scan & Fire and Zap sets activity 1; Zap's
        // refresh sets 2 (seg6:0x40F5) and firing or zapping sets 3.
        const moved = turnStart || kinds.some((kind) => kind === "move" || kind === "deploy");
        const activity: SpottingActivity = firedThisTick.has(id)
          ? 3
          : kinds.some((kind) => kind !== "scan-and-fire" && kind !== "zap")
            ? 1
            : refreshedThisStep.has(id)
              ? 2
              : 0;
        if (moved || activity !== 0) dirty = true;
        if (robot && robot.hp > 0 && isTileCoord(robot.position)) {
          live.push({ robot: { ...robot, position: robot.position }, moved, activity });
        }
      }
      return {
        id: team.id,
        side: team.side,
        robotIds: team.robots.map((robot) => robot.id),
        robots: live,
        dirty,
      };
    });
    spotted = showAllEnemies
      ? new Map(state.teams.map((team) => [team.id, allEnemiesOf(team)]))
      : updateSpotting({
          arena: state.arena,
          teams,
          spotted,
          rollByte: () => rng.nextUint32() & 0xff,
        });
    for (const team of state.teams) applyVisibleEnemies(tick, team.id, liveSpotted(team.id));
    firedThisTick.clear();
    refreshedThisStep.clear();
  };

  const finishActive = (cursor: Cursor): void => {
    const active = cursor.active;
    if (!active) return;
    if (active.command.kind !== "aim-and-fire" || !active.command.repeat) cursor.nextIndex += 1;
    cursor.active = null;
  };

  const turnDuration = Math.round(state.config.turnLengthSeconds * TICKS_PER_SECOND);
  emit(0, { kind: "turn-start", turnNumber: state.turnNumber });

  for (const actor of actors) {
    const error = startAvailableCommand(actor, 0);
    if (error) return error;
  }

  updateVisibility(0);
  const initialScanDamage: PendingDamage[] = [];
  resolveAimStarts(0, initialScanDamage);
  resolveScanOpportunities(0, initialScanDamage);
  applyPendingDamageAndDeaths(0, initialScanDamage);
  updateVisibility(0);
  for (const actor of actors) {
    const error = startAvailableCommand(actor, 0);
    if (error) return error;
  }
  const lateStartDamage: PendingDamage[] = [];
  resolveAimStarts(0, lateStartDamage);
  resolveZapChecks(0);
  resolveBombDetonations(0, lateStartDamage);
  applyPendingDamageAndDeaths(0, lateStartDamage);
  if (lateStartDamage.length > 0) updateVisibility(0);
  if (originalRules) runSpotting(0, true, new Map());

  for (let tick = 1; tick <= turnDuration; tick += 1) {
    // Revision 4: a moving robot occupies its next tile partway through the step.
    let switchedTiles = false;
    for (const actor of actors) {
      const cursor = cursors.get(actor.robotId);
      const active = cursor?.active;
      const next = active?.tileSwitches?.[0];
      if (!cursor || !active || next?.at !== tick) continue;
      cursor.active = { ...active, tileSwitches: active.tileSwitches!.slice(1) };
      const robot = robots.get(actor.robotId);
      if (!robot || robot.hp <= 0) continue;
      robots.set(robot.id, { ...robot, position: next.to });
      emit(tick, { kind: "move-step", robotId: robot.id, to: next.to });
      switchedTiles = true;
    }
    if (switchedTiles) updateVisibility(tick);

    const due = actors.flatMap((actor) => {
      const active = cursors.get(actor.robotId)?.active;
      return active?.completesAt === tick ? [{ actor, active }] : [];
    });

    for (const { actor, active } of due) {
      if (active.command.kind !== "deploy" && active.command.kind !== "move") continue;
      const robot = robots.get(actor.robotId);
      const cursor = cursors.get(actor.robotId);
      if (!robot || !cursor || robot.hp <= 0) continue;

      if (active.command.kind === "deploy") {
        robots.set(robot.id, { ...robot, position: active.command.to });
        emit(tick, { kind: "deployed", robotId: robot.id, to: active.command.to });
        finishActive(cursor);
        continue;
      }

      const step = active.command.path[active.moveIndex];
      if (!step || !isTileCoord(robot.position)) {
        return malformed(
          "illegal-command",
          "Move cursor is invalid.",
          robot.id,
          active.commandIndex,
        );
      }
      const moved: RobotState = {
        ...robot,
        position: step.to,
      };
      robots.set(robot.id, moved);
      // Revision 4 already moved the robot into `step.to` partway through.
      if (!timingRules) emit(tick, { kind: "move-step", robotId: robot.id, to: step.to });

      const nextMoveIndex = active.moveIndex + 1;
      const nextStep = active.command.path[nextMoveIndex];
      if (!nextStep) {
        finishActive(cursor);
      } else {
        if (!movementDestinationIsLegal(state.arena, step.to, nextStep, moved)) {
          return malformed(
            "illegal-command",
            "Move path contains an out-of-bounds, non-adjacent, or untraversable step.",
            robot.id,
            active.commandIndex,
          );
        }
        const duration = moveStepDurationTicks(step.to, nextStep.to);
        if (duration === null) {
          return malformed(
            "illegal-command",
            "Move step size is invalid.",
            robot.id,
            active.commandIndex,
          );
        }
        cursor.active = {
          ...active,
          moveIndex: nextMoveIndex,
          completesAt: tick + duration,
          ...(timingRules ? { tileSwitches: moveTileSwitches(step.to, nextStep.to, tick) } : {}),
        };
      }
    }

    for (const { actor, active } of due) {
      if (active.command.kind !== "set-posture" && active.command.kind !== "set-scan-direction") {
        continue;
      }
      const robot = robots.get(actor.robotId);
      const cursor = cursors.get(actor.robotId);
      if (!robot || !cursor || robot.hp <= 0) continue;
      const steps = active.orientationSteps;
      if (active.command.kind === "set-posture") {
        const posture =
          (steps?.[active.moveIndex] as Posture | undefined) ?? active.command.posture;
        robots.set(robot.id, { ...robot, posture });
        emit(tick, { kind: "posture-changed", robotId: robot.id, posture });
      } else {
        const heading =
          (steps?.[active.moveIndex] as Heading | undefined) ?? active.command.heading;
        robots.set(robot.id, { ...robot, scanHeading: heading });
        emit(tick, { kind: "scan-rotated", robotId: robot.id, heading });
      }
      if (steps !== undefined && active.moveIndex + 1 < steps.length) {
        cursor.active = {
          ...active,
          moveIndex: active.moveIndex + 1,
          completesAt:
            tick +
            (active.command.kind === "set-posture"
              ? POSTURE_CHANGE_COST_TICKS
              : SCAN_DIRECTION_COST_TICKS),
        };
      } else {
        finishActive(cursor);
      }
    }

    if (
      due.some(({ active }) =>
        ["deploy", "move", "set-posture", "set-scan-direction"].includes(active.command.kind),
      )
    ) {
      updateVisibility(tick);
    }
    const pendingDamage: PendingDamage[] = [];
    for (const { actor, active } of due) {
      if (active.command.kind !== "aim-and-fire") continue;
      const cursor = cursors.get(actor.robotId);
      if (cursor?.active !== active) continue;
      const ammo = robots.get(actor.robotId)?.ammo[active.command.weapon];
      if (active.command.repeat && ammo === 0) cursor.nextIndex += 1;
      finishActive(cursor);
    }

    resolveScanOpportunities(tick, pendingDamage);
    resolveZapImpacts(tick, pendingDamage);
    resolveBombDetonations(tick, pendingDamage);
    resolveSelfDestructs(tick, pendingDamage);

    for (const { actor, active } of due) {
      if (
        active.command.kind !== "scan-and-fire" &&
        active.command.kind !== "zap" &&
        active.command.kind !== "place-bomb" &&
        active.command.kind !== "self-destruct"
      ) {
        continue;
      }
      const cursor = cursors.get(actor.robotId);
      if (cursor?.active === active) finishActive(cursor);
    }

    applyPendingDamageAndDeaths(tick, pendingDamage);
    if (pendingDamage.length > 0) updateVisibility(tick);

    if (tick < turnDuration) {
      for (const actor of actors) {
        const error = startAvailableCommand(actor, tick);
        if (error) return error;
      }
      const postStartScanDamage: PendingDamage[] = [];
      resolveAimStarts(tick, postStartScanDamage);
      resolveScanOpportunities(tick, postStartScanDamage);
      resolveZapChecks(tick);
      applyPendingDamageAndDeaths(tick, postStartScanDamage);
      if (postStartScanDamage.length > 0) updateVisibility(tick);
    }
    if (originalRules && (!formationRules || isStepTick(tick))) {
      runSpotting(
        tick,
        false,
        new Map(due.map(({ actor, active }) => [actor.robotId, active.command.kind] as const)),
      );
    }
  }

  // seg6:0x6330 extends the movie so a blast launched near turn end still lands.
  let endTick = turnDuration;
  for (const blast of [...pendingSelfDestructs].sort((a, b) => a.impactsAt - b.impactsAt)) {
    if (!pendingSelfDestructs.includes(blast)) continue;
    const pendingDamage: PendingDamage[] = [];
    resolveSelfDestructs(blast.impactsAt, pendingDamage);
    applyPendingDamageAndDeaths(blast.impactsAt, pendingDamage);
    if (pendingDamage.length > 0) updateVisibility(blast.impactsAt);
    endTick = blast.impactsAt;
  }

  const finalTeams = state.teams.map((team) => ({
    ...team,
    robots: team.robots.map((robot) => robots.get(robot.id) ?? robot),
  }));
  const spottedEnemies = originalRules
    ? state.teams.map((team) => ({
        teamId: team.id,
        enemyIds: [...liveSpotted(team.id)].sort(),
      }))
    : undefined;
  if (originalRules) {
    const finalSnapshot: MatchState = {
      ...state,
      teams: finalTeams,
      spottedEnemies: spottedEnemies ?? [],
    };
    for (const team of state.teams) {
      latestVisibility.set(team.id, computeVisibility(finalSnapshot, team.id));
    }
  }

  const nextLastKnownMarkers = new Map<string, readonly LastKnownMarker[]>();
  for (const team of state.teams) {
    const visibility = latestVisibility.get(team.id);
    const markerByEnemy = new Map<string, LastKnownMarker>();
    for (const marker of state.lastKnownMarkers.get(team.id) ?? []) {
      if (
        !visibility?.visibleEnemies.has(marker.enemyId) &&
        !visibility?.visibleTiles.has(visibilityTileKey(marker.at))
      ) {
        markerByEnemy.set(marker.enemyId, marker);
      }
    }
    for (const [enemyId, at] of lastSeenByTeam.get(team.id) ?? []) {
      const enemy = robots.get(enemyId);
      if (!enemy || enemy.hp <= 0 || visibility?.visibleEnemies.has(enemyId)) continue;
      markerByEnemy.set(enemyId, { enemyId, at });
      emit(endTick, { kind: "last-known-marker", teamId: team.id, enemyId, at });
    }
    nextLastKnownMarkers.set(team.id, [...markerByEnemy.values()]);
  }

  emit(endTick, { kind: "turn-end", turnNumber: state.turnNumber });
  // seg28:0x0C1A rebases bombs still armed onto the next turn's clock.
  const carriedBombs = armedBombs.map((bomb) => ({
    ...bomb,
    detonatesAt: Math.max(BOMB_CARRY_MINIMUM_TICKS, bomb.detonatesAt - turnDuration),
  }));
  const nextState: MatchState = {
    ...state,
    turnNumber: state.turnNumber + 1,
    teams: finalTeams,
    lastKnownMarkers: nextLastKnownMarkers,
    ...(spottedEnemies === undefined ? {} : { spottedEnemies }),
    ...(formationRules ? { armedBombs: carriedBombs } : {}),
  };
  return { outcome: "resolved", nextState, events };
};
