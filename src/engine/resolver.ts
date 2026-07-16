/**
 * Deterministic Phase 2/3 turn resolver.
 *
 * Implements the completion-driven boundary order in
 * `tasks/phase2-resolver-design.md` and `docs/spec.md` §8. Projectile cues are
 * presentation-only; Scan & Fire and visibility deliberately remain later phases.
 */

import { TICKS_PER_SECOND } from "./constants.js";
import { WEAPONS } from "./catalog.js";
import { resolveBlast } from "./blast.js";
import { commandDurationTicks, moveStepDurationTicks, moveStepSize } from "./commandInterpreter.js";
import { resolveCover } from "./cover.js";
import { floorEuclideanDistance, isWithinScanCone } from "./geometry.js";
import { canTraverseTile, isFullSpeedTile } from "./movement.js";
import { createRng } from "./rng.js";
import { resolveFire } from "./firing.js";
import { findScanAndFireTarget } from "./scanAndFire.js";
import { computeVisibility, visibilityTileKey } from "./visibility.js";
import type {
  Arena,
  CommandTimeline,
  LastKnownMarker,
  MatchState,
  MovementStep,
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
  readonly intendedTargetId: string | null;
  readonly nextScanAt: number | null;
}

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
    };

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

  const rng = createRng(input.seed);
  const events: ResolutionEvent[] = [];
  let seq = 0;
  const emit = (tick: number, payload: EventPayload): void => {
    events.push({ tick, seq: seq++, ...payload } as ResolutionEvent);
  };

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

  const startCommand = (actor: Actor, tick: number): MalformedOrders | null => {
    const robot = robots.get(actor.robotId);
    const cursor = cursors.get(actor.robotId);
    if (!robot || !cursor || robot.hp <= 0 || cursor.active || tick >= turnDuration) return null;
    const command = cursor.timeline.segments[cursor.nextIndex];
    if (!command) return null;
    const commandIndex = cursor.nextIndex;

    if (!COMMAND_KINDS.includes(command.kind)) {
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
    let intendedTargetId: string | null = null;
    let nextScanAt: number | null = null;
    if (command.kind === "move") {
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
      completesAt = tick + duration;
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
      completesAt = tick + duration;
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
      intendedTargetId = findTargetAt(actor, command.target);
    }

    cursor.active = {
      commandIndex,
      command,
      completesAt,
      moveIndex: 0,
      intendedTargetId,
      nextScanAt,
    };
    emit(tick, {
      kind: "command-start",
      robotId: robot.id,
      commandIndex,
      commandKind: command.kind,
    });
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
    readonly alignmentMagnitude?: number;
    readonly pendingDamage: PendingDamage[];
  }): number | "unlimited" => {
    const shooter = robots.get(input.actor.robotId);
    if (!shooter || shooter.hp <= 0 || !isTileCoord(shooter.position)) {
      return input.weapon.startingAmmo;
    }
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
        aimedTile: input.targetTile,
        targetTile: input.target.position,
        targetPosture: input.target.posture,
        weapon: input.weapon,
        arenaTileAt: (coord) => tileAt(state.arena, coord),
        rng,
        damageStaggered: shooter.damageStaggerActionsRemaining > 0,
        fireMode: input.fireMode,
        ...(input.alignmentMagnitude === undefined
          ? {}
          : { alignmentMagnitude: input.alignmentMagnitude }),
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
      if (!acquired) {
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
        alignmentMagnitude: acquired.alignmentMagnitude,
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

  const updateVisibility = (tick: number): void => {
    const snapshot = snapshotState();
    for (const team of state.teams) {
      const next = computeVisibility(snapshot, team.id);
      const previous = latestVisibility.get(team.id);
      const lastSeen = lastSeenByTeam.get(team.id) ?? new Map<string, TileCoord>();

      for (const enemyId of next.visibleEnemies) {
        const enemy = robots.get(enemyId);
        if (!enemy || !isTileCoord(enemy.position)) continue;
        lastSeen.set(enemyId, enemy.position);
        if (!previous?.visibleEnemies.has(enemyId)) {
          emit(tick, { kind: "enemy-spotted", teamId: team.id, enemyId, at: enemy.position });
        }
      }
      if (previous) {
        for (const enemyId of previous.visibleEnemies) {
          if (next.visibleEnemies.has(enemyId)) continue;
          const lastSeenAt = lastSeen.get(enemyId);
          if (lastSeenAt) {
            emit(tick, { kind: "enemy-lost", teamId: team.id, enemyId, lastSeenAt });
          }
        }
      }

      lastSeenByTeam.set(team.id, lastSeen);
      latestVisibility.set(team.id, next);
    }
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
  resolveScanOpportunities(0, initialScanDamage);
  applyPendingDamageAndDeaths(0, initialScanDamage);
  updateVisibility(0);
  for (const actor of actors) {
    const error = startAvailableCommand(actor, 0);
    if (error) return error;
  }

  for (let tick = 1; tick <= turnDuration; tick += 1) {
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
      emit(tick, { kind: "move-step", robotId: robot.id, to: step.to });

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
      if (active.command.kind === "set-posture") {
        robots.set(robot.id, { ...robot, posture: active.command.posture });
        emit(tick, {
          kind: "posture-changed",
          robotId: robot.id,
          posture: active.command.posture,
        });
      } else {
        robots.set(robot.id, { ...robot, scanHeading: active.command.heading });
        emit(tick, { kind: "scan-rotated", robotId: robot.id, heading: active.command.heading });
      }
      finishActive(cursor);
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
      const command = active.command;
      const cursor = cursors.get(actor.robotId);
      if (!cursor) continue;
      const weapon = WEAPONS[command.weapon];
      const intendedTarget = active.intendedTargetId
        ? robots.get(active.intendedTargetId)
        : undefined;
      const target =
        intendedTarget && isTileCoord(intendedTarget.position)
          ? { ...intendedTarget, position: intendedTarget.position }
          : undefined;
      const remainingAmmo = resolveFiringAction({
        actor,
        commandIndex: active.commandIndex,
        tick,
        weapon,
        targetTile: command.target,
        ...(target === undefined ? {} : { target }),
        fireMode: "aim",
        pendingDamage,
      });
      if (command.repeat && remainingAmmo === 0) cursor.nextIndex += 1;
      finishActive(cursor);
    }

    resolveScanOpportunities(tick, pendingDamage);

    for (const { actor, active } of due) {
      if (active.command.kind !== "scan-and-fire") continue;
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
      resolveScanOpportunities(tick, postStartScanDamage);
      applyPendingDamageAndDeaths(tick, postStartScanDamage);
      if (postStartScanDamage.length > 0) updateVisibility(tick);
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
      emit(turnDuration, { kind: "last-known-marker", teamId: team.id, enemyId, at });
    }
    nextLastKnownMarkers.set(team.id, [...markerByEnemy.values()]);
  }

  emit(turnDuration, { kind: "turn-end", turnNumber: state.turnNumber });
  const nextState: MatchState = {
    ...state,
    turnNumber: state.turnNumber + 1,
    teams: state.teams.map((team) => ({
      ...team,
      robots: team.robots.map((robot) => robots.get(robot.id) ?? robot),
    })),
    lastKnownMarkers: nextLastKnownMarkers,
  };
  return { outcome: "resolved", nextState, events };
};
