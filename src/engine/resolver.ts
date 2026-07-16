/**
 * Deterministic Phase 2 turn resolver.
 *
 * Implements the completion-driven boundary order in
 * `tasks/phase2-resolver-design.md`. Projectile travel, Scan & Fire, and
 * visibility deliberately remain later phases.
 */

import { TICKS_PER_SECOND } from "./constants.js";
import { WEAPONS } from "./catalog.js";
import { commandDurationTicks, moveStepDurationTicks, moveStepSize } from "./commandInterpreter.js";
import { canTraverseTile, isFullSpeedTile } from "./movement.js";
import { createRng } from "./rng.js";
import { resolveFire } from "./firing.js";
import type {
  Arena,
  CommandTimeline,
  MatchState,
  MovementStep,
  ResolutionEvent,
  RobotCommandSegment,
  RobotState,
  TeamState,
  TileCoord,
  TurnOrders,
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
}

interface Cursor {
  readonly timeline: CommandTimeline;
  nextIndex: number;
  active: ActiveCommand | null;
}

interface PendingDamage {
  readonly sourceId: string;
  readonly shotIndex: number;
  readonly targetId: string;
  readonly damage: number;
  readonly score: number;
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

    if (command.kind === "scan-and-fire") {
      return malformed(
        "unsupported-command",
        "Scan & Fire is intentionally deferred to Phase 4.",
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
      if (!weapon || !robotOwnsWeapon(robot, weapon) || !weapon.damageRoll) {
        return malformed(
          "unsupported-command",
          "Phase 2 Aim & Fire accepts only an owned direct-fire weapon.",
          robot.id,
          commandIndex,
        );
      }
      completesAt = tick + (commandDurationTicks(command, robot, weapon.firingIntervalTicks) ?? 0);
      intendedTargetId = findTargetAt(actor, command.target);
    }

    cursor.active = { commandIndex, command, completesAt, moveIndex: 0, intendedTargetId };
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

    const pendingDamage: PendingDamage[] = [];
    for (const { actor, active } of due) {
      if (active.command.kind !== "aim-and-fire") continue;
      const shooter = robots.get(actor.robotId);
      const cursor = cursors.get(actor.robotId);
      if (!shooter || !cursor || shooter.hp <= 0 || !isTileCoord(shooter.position)) continue;
      const weapon = WEAPONS[active.command.weapon];
      emit(tick, {
        kind: "fired",
        shooterId: shooter.id,
        commandIndex: active.commandIndex,
        weapon: weapon.id,
        target: active.command.target,
      });
      const target = active.intendedTargetId ? robots.get(active.intendedTargetId) : undefined;
      for (let shotIndex = 0; shotIndex < weapon.bulletsPerClick; shotIndex += 1) {
        if (!target || target.hp <= 0 || !isTileCoord(target.position)) {
          emit(tick, {
            kind: "shot-missed",
            shooterId: shooter.id,
            shotIndex,
            target: active.command.target,
            reason: "no-target",
          });
          continue;
        }
        const result = resolveFire({
          shooterTile: shooter.position,
          shooterHeading: shooter.scanHeading,
          shooterAccuracy: shooter.definition.accuracy,
          aimedTile: active.command.target,
          targetTile: target.position,
          targetPosture: target.posture,
          weapon,
          arenaTileAt: (coord) => tileAt(state.arena, coord),
          rng,
          damageStaggered: shooter.damageStaggerActionsRemaining > 0,
        });
        if (result.outcome === "hit") {
          pendingDamage.push({
            sourceId: shooter.id,
            shotIndex,
            targetId: target.id,
            damage: result.damage,
            score: result.score,
          });
        } else {
          const reason = result.outcome === "miss" ? "hit-roll" : result.outcome;
          emit(tick, {
            kind: "shot-missed",
            shooterId: shooter.id,
            shotIndex,
            target: active.command.target,
            reason,
            ...(result.outcome === "miss" ? { score: result.score } : {}),
          });
        }
      }
      if (shooter.damageStaggerActionsRemaining > 0) {
        robots.set(shooter.id, {
          ...shooter,
          damageStaggerActionsRemaining: shooter.damageStaggerActionsRemaining - 1,
        });
      }
      finishActive(cursor);
    }

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

    if (tick < turnDuration) {
      for (const actor of actors) {
        const error = startAvailableCommand(actor, tick);
        if (error) return error;
      }
    }
  }

  emit(turnDuration, { kind: "turn-end", turnNumber: state.turnNumber });
  const nextState: MatchState = {
    ...state,
    turnNumber: state.turnNumber + 1,
    teams: state.teams.map((team) => ({
      ...team,
      robots: team.robots.map((robot) => robots.get(robot.id) ?? robot),
    })),
  };
  return { outcome: "resolved", nextState, events };
};
