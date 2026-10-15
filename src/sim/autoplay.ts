/**
 * Deterministic autoplay: seeded bot order generation plus a full Survival
 * match runner used by the QA fuzz suite and the in-process server flow test.
 *
 * Bots are intentionally aggressive so matches end. They read the full
 * authoritative state (they are a QA harness, not a v1 AI opponent), but every
 * timeline they produce is built with the real planner helpers (`planMovement`,
 * `previewAim`, `availableWeapons`, `timelineTiming`) and then passed through
 * the client's `validatedTimelinePrefix`, so the orders are exactly what a
 * legal client could submit. No `Math.random`: every choice comes from the
 * engine `createRng` seeded by a string.
 */

import type { ArenaName } from "../lib/arenas/catalog";
import { TICKS_PER_SECOND } from "../engine/constants";
import { floorEuclideanDistance } from "../engine/geometry";
import { resolveTurn } from "../engine/resolver";
import { createRng, type Rng } from "../engine/rng";
import { resolveSurvivalOutcome } from "../engine/survival";
import { canTraverse } from "../engine/traversal";
import type {
  Arena,
  CommandTimeline,
  Heading,
  HomeSlot,
  MatchState,
  Posture,
  ResolutionEvent,
  RobotClass,
  RobotCommandSegment,
  RobotState,
  TeamState,
  TileCoord,
  TurnOrders,
  WeaponId,
} from "../engine/types";
import { createSurvivalMatchState } from "../lib/setup/matchState";
import {
  availableWeapons,
  PLANNER_WEAPON_RANGE,
  previewAim,
  projectedWeaponAmmo,
} from "../planner/firingHelpers";
import { findPath, tileAt } from "../planner/pathfind";
import {
  planMovement,
  projectRobotAtTick,
  timelineTiming,
  validatedTimelinePrefix,
} from "../planner/segments";

export interface AutoplayOptions {
  seed: string;
  arena: ArenaName;
  teams: { id: string; color: string; robots: RobotClass[] }[];
  maxTurns?: number;
  turnLengthSeconds?: number;
}

export interface AutoplayTurn {
  turnNumber: number;
  seed: string;
  orders: TurnOrders;
  events: readonly ResolutionEvent[];
  stateAfter: MatchState;
  /** Bot segments the client planner's prefix validation dropped (expected 0). */
  droppedSegments?: number;
}

export interface AutoplayMatch {
  initialState: MatchState;
  turns: AutoplayTurn[];
  winnerTeamId: string | null;
}

/** Thrown when the engine rejects bot orders that the client planner accepted. */
export class AutoplayMalformedOrdersError extends Error {
  constructor(
    message: string,
    readonly turnNumber: number,
    readonly orders: TurnOrders,
    readonly state: MatchState,
  ) {
    super(message);
  }
}

export const DEFAULT_AUTOPLAY_MAX_TURNS = 40;

const HOME_SLOT_ORDER: readonly HomeSlot[] = [0, 1, 2, 3];

/** Per-seed Home-corner permutation so two-team matches also use nonadjacent corners. */
const autoplayHomeSlots = (seed: string, teamCount: number): readonly HomeSlot[] => {
  const rng = createRng(`${seed}:home-slots`);
  const slots = [...HOME_SLOT_ORDER];
  for (let index = slots.length - 1; index > 0; index -= 1) {
    const swap = rng.intInRange(0, index);
    [slots[index], slots[swap]] = [slots[swap]!, slots[index]!];
  }
  return slots.slice(0, teamCount);
};

export function buildAutoplayState(options: AutoplayOptions, arena: Arena): MatchState {
  if (options.teams.length < 2 || options.teams.length > 4) {
    throw new Error("Autoplay needs two to four teams.");
  }
  const homeSlots = autoplayHomeSlots(options.seed, options.teams.length);
  return createSurvivalMatchState({
    arena,
    formation: "beginner",
    length: options.arena === "rubble-two" ? "melee" : "battle",
    turnLengthSeconds: options.turnLengthSeconds ?? 15,
    teams: options.teams.map((team, index) => ({
      id: team.id,
      name: team.id,
      color: team.color,
      side: (index + 1) as TeamState["side"],
      homeSlot: homeSlots[index]!,
      roster: team.robots,
    })),
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Bot planning

const pick = <T>(rng: Rng, values: readonly T[]): T =>
  values[rng.intInRange(0, values.length - 1)]!;

const onArena = (robot: RobotState): robot is RobotState & { readonly position: TileCoord } =>
  robot.hp > 0 && robot.position !== "dock";

/** Integer eight-way bearing (y grows southward). */
export const headingToward = (from: TileCoord, to: TileCoord): Heading => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax === 0 && ay === 0) return "E";
  // tan(22.5°) ≈ 0.4142; 12/29 ≈ 0.4138 keeps this exact in integers.
  if (29 * ay <= 12 * ax) return dx > 0 ? "E" : "W";
  if (29 * ax <= 12 * ay) return dy > 0 ? "S" : "N";
  if (dx > 0) return dy > 0 ? "SE" : "NE";
  return dy > 0 ? "SW" : "NW";
};

interface Projection {
  readonly position: TileCoord | "dock";
  readonly posture: Posture;
  readonly scanHeading: Heading;
  readonly tick: number;
}

const projection = (
  robot: RobotState,
  segments: readonly RobotCommandSegment[],
  budgetTicks: number,
): Projection => {
  const end = projectRobotAtTick(robot, segments);
  const timing = timelineTiming(robot, segments, budgetTicks);
  return { ...end, tick: timing.at(-1)?.endTick ?? 0 };
};

const homeAreaCenter = (arena: Arena, homeSlot: HomeSlot): TileCoord => {
  const tiles = arena.homeAreas[homeSlot]?.tiles ?? [];
  const sum = tiles.reduce((acc, tile) => ({ x: acc.x + tile.x, y: acc.y + tile.y }), {
    x: 0,
    y: 0,
  });
  return tiles.length === 0
    ? { x: Math.floor(arena.width / 2), y: Math.floor(arena.height / 2) }
    : { x: Math.floor(sum.x / tiles.length), y: Math.floor(sum.y / tiles.length) };
};

/** Nearest traversable tile (by Chebyshev ring) to `goal` for the posture. */
const nearestTraversable = (arena: Arena, goal: TileCoord, posture: Posture): TileCoord | null => {
  for (let radius = 0; radius < Math.max(arena.width, arena.height); radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const tile = { x: goal.x + dx, y: goal.y + dy };
        const terrain = tileAt(arena, tile)?.terrain;
        if (terrain !== undefined && canTraverse(posture, terrain)) return tile;
      }
    }
  }
  return null;
};

interface BotContext {
  readonly state: MatchState;
  readonly team: TeamState;
  readonly rng: Rng;
  readonly budgetTicks: number;
  readonly enemies: readonly (RobotState & { readonly position: TileCoord })[];
}

const nearestEnemy = (
  context: BotContext,
  from: TileCoord,
): (RobotState & { readonly position: TileCoord }) | null => {
  let best: (RobotState & { readonly position: TileCoord }) | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const enemy of context.enemies) {
    const distance = floorEuclideanDistance(from, enemy.position);
    if (distance < bestDistance) {
      best = enemy;
      bestDistance = distance;
    }
  }
  return best;
};

const shooterAt = (robot: RobotState, projected: Projection): RobotState => ({
  ...robot,
  position: projected.position,
  posture: projected.posture,
  scanHeading: projected.scanHeading,
});

/** Choose a deploy tile inside the Team's own Home Area. */
const deploySegment = (context: BotContext, robot: RobotState): RobotCommandSegment | null => {
  const home = context.state.arena.homeAreas[context.team.homeSlot];
  const candidates = (home?.tiles ?? []).filter((tile) => {
    const terrain = tileAt(context.state.arena, tile)?.terrain;
    return terrain !== undefined && canTraverse(robot.posture, terrain);
  });
  if (candidates.length === 0) return null;
  return { kind: "deploy", to: pick(context.rng, candidates) };
};

/** A move segment of up to `maxSteps` unit steps toward `goal`, or null. */
const moveToward = (
  context: BotContext,
  from: TileCoord,
  goal: TileCoord,
  posture: Posture,
  maxSteps: number,
): RobotCommandSegment | null => {
  const arena = context.state.arena;
  const target = nearestTraversable(arena, goal, posture);
  if (target === null) return null;
  const route = findPath(arena, from, target, posture);
  if (route.kind === "error" || route.steps.length === 0) return null;
  const destination = route.steps[Math.min(maxSteps, route.steps.length) - 1]!;
  const plan = planMovement(arena, from, destination, posture);
  return plan.kind === "move" ? plan.segment : null;
};

const fireSegments = (
  context: BotContext,
  robot: RobotState,
  segments: readonly RobotCommandSegment[],
  projected: Projection & { readonly position: TileCoord },
  enemy: RobotState & { readonly position: TileCoord },
): readonly RobotCommandSegment[] => {
  const { rng } = context;
  const weapons = availableWeapons(robot, segments);
  if (weapons.length === 0) return [];
  const distance = floorEuclideanDistance(projected.position, enemy.position);
  const explosive = weapons.filter(
    (weapon) => weapon === "missile-launcher" || weapon === "grenade-launcher",
  );
  // Missiles at point-blank range hurt the shooter too; usually avoid that.
  const preferExplosive =
    explosive.length > 0 && (distance > 2 ? rng.chance(0.6) : rng.chance(0.1));
  const weapon: WeaponId = preferExplosive ? pick(rng, explosive) : pick(rng, weapons);
  const remainingSeconds = Math.floor(Math.max(0, context.budgetTicks - projected.tick) / 60);
  const roll = rng.next();
  if (roll < 0.3 || remainingSeconds < 1) {
    // Aim & Fire: a lead shot, sometimes at an adjacent tile to exercise
    // off-tile score halving and blast radius falloff.
    const offset = rng.chance(0.2) ? pick(rng, [-1, 1]) : 0;
    const offTile = {
      x: Math.max(0, Math.min(context.state.arena.width - 1, enemy.position.x + offset)),
      y: enemy.position.y,
    };
    const offTileLegal =
      previewAim({
        arena: context.state.arena,
        shooter: shooterAt(robot, projected),
        target: offTile,
        weapon,
        authorizedContacts: [],
      }).status === "eligible";
    const target = offTileLegal ? offTile : enemy.position;
    const ammo = projectedWeaponAmmo(robot, segments, weapon);
    const shots = Math.min(rng.intInRange(1, 3), ammo === "unlimited" ? 3 : ammo);
    return Array.from({ length: shots }, (): RobotCommandSegment => ({
      kind: "aim-and-fire",
      target,
      weapon,
      repeat: false,
    }));
  }
  if (roll < 0.4) {
    return [{ kind: "aim-and-fire", target: enemy.position, weapon, repeat: true }];
  }
  return [
    {
      kind: "scan-and-fire",
      weapon,
      maxDistance: rng.intInRange(Math.min(distance + 1, 18), PLANNER_WEAPON_RANGE[weapon]),
      seconds: rng.intInRange(1, Math.max(1, Math.min(remainingSeconds, 6))),
    },
  ];
};

/** Plan one robot's timeline. Returns raw segments before client validation. */
const planRobot = (context: BotContext, robot: RobotState): readonly RobotCommandSegment[] => {
  const { rng, state, budgetTicks } = context;
  const arena = state.arena;
  const segments: RobotCommandSegment[] = [];
  if (robot.position === "dock") {
    const deploy = deploySegment(context, robot);
    if (deploy === null) return [];
    segments.push(deploy);
  }

  // Occasionally program past the budget to exercise greyed-out commands.
  const horizon = budgetTicks + (rng.chance(0.15) ? 240 : 0);
  for (let guard = 0; guard < 12; guard += 1) {
    const projected = projection(robot, segments, budgetTicks);
    if (projected.tick >= horizon || projected.position === "dock") break;
    const position = projected.position;
    const enemy = nearestEnemy(context, position);
    const goal =
      enemy?.position ??
      homeAreaCenter(
        arena,
        pick(
          rng,
          state.teams
            .filter((team) => team.side !== context.team.side)
            .map((team) => team.homeSlot),
        ),
      );

    // Posture variety: sometimes duck/crouch, but crouching blocks non-open terrain.
    if (rng.chance(0.12)) {
      const posture = pick(rng, ["upright", "ducking", "crouching"] as const);
      if (posture !== projected.posture) {
        segments.push({ kind: "set-posture", posture });
        continue;
      }
    }

    const heading = headingToward(position, goal);
    if (heading !== projected.scanHeading && rng.chance(0.9)) {
      segments.push({ kind: "set-scan-direction", heading });
      continue;
    }

    if (enemy !== null) {
      const preview = previewAim({
        arena,
        shooter: shooterAt(robot, projected),
        target: enemy.position,
        weapon: robot.definition.primaryWeapon,
        authorizedContacts: [],
      });
      const distance = floorEuclideanDistance(position, enemy.position);
      const closeIn = distance > 9 && rng.chance(0.5);
      if (preview.status === "eligible" && !closeIn) {
        const fire = fireSegments(context, robot, segments, { ...projected, position }, enemy);
        if (fire.length > 0) {
          segments.push(...fire);
          const last = fire.at(-1)!;
          // The planner never lets anything follow a repeat-fire command.
          if (last.kind === "aim-and-fire" && last.repeat) break;
          continue;
        }
      }
    }

    let move = moveToward(context, position, goal, projected.posture, rng.intInRange(2, 8));
    if (move === null && projected.posture !== "upright") {
      segments.push({ kind: "set-posture", posture: "upright" });
      continue;
    }
    if (move === null) {
      // Wander: any reachable tile a few steps away.
      const wander = {
        x: position.x + rng.intInRange(-4, 4),
        y: position.y + rng.intInRange(-4, 4),
      };
      move = moveToward(context, position, wander, projected.posture, 4);
    }
    if (move === null) {
      const weapon = pick(rng, availableWeapons(robot, segments));
      const remaining = Math.floor(Math.max(0, budgetTicks - projected.tick) / 60);
      segments.push({
        kind: "scan-and-fire",
        weapon,
        maxDistance: PLANNER_WEAPON_RANGE[weapon],
        seconds: Math.max(1, Math.min(remaining, 40)),
      });
      break;
    }
    segments.push(move);
  }
  return segments;
};

export interface TeamPlanDiagnostics {
  /** Segments the bot proposed that the client planner's prefix validation dropped. */
  readonly droppedSegments: number;
  /** First dropped segment per robot, with the raw timeline, for debugging. */
  readonly drops: readonly {
    readonly robotId: string;
    readonly raw: readonly RobotCommandSegment[];
    readonly keptCount: number;
  }[];
}

/**
 * Plan one Team's private orders for the current turn. Uses only the Team's
 * own robots for timelines; bots know enemy positions (QA harness).
 */
export const planTeamOrders = (
  state: MatchState,
  teamId: string,
  seed: string,
): { readonly orders: TurnOrders; readonly diagnostics: TeamPlanDiagnostics } => {
  const team = state.teams.find((candidate) => candidate.id === teamId);
  if (team === undefined) throw new Error(`Unknown team ${teamId}.`);
  const rng = createRng(`${seed}:plan:${state.turnNumber}:${teamId}`);
  const context: BotContext = {
    state,
    team,
    rng,
    budgetTicks: Math.round(state.config.turnLengthSeconds * TICKS_PER_SECOND),
    enemies: state.teams
      .filter((candidate) => candidate.side !== team.side)
      .flatMap((candidate) => candidate.robots.filter(onArena)),
  };
  const timelines: CommandTimeline[] = [];
  let droppedSegments = 0;
  const drops: { robotId: string; raw: readonly RobotCommandSegment[]; keptCount: number }[] = [];
  for (const robot of team.robots) {
    if (robot.hp <= 0) continue;
    // Some robots occasionally idle for a turn (or stay docked).
    if (rng.chance(0.05)) continue;
    const raw = planRobot(context, robot);
    const validated = validatedTimelinePrefix(state.arena, robot, team.homeSlot, raw);
    droppedSegments += validated.droppedCount;
    if (validated.droppedCount > 0) {
      drops.push({ robotId: robot.id, raw, keptCount: validated.segments.length });
    }
    if (validated.segments.length > 0) {
      timelines.push({ robotId: robot.id, segments: validated.segments });
    }
  }
  return {
    orders: { turnNumber: state.turnNumber, timelines },
    diagnostics: { droppedSegments, drops },
  };
};

/** Combine every Team's private orders in canonical Team/roster order, as the server does. */
export const combineTeamOrders = (
  state: MatchState,
  perTeam: readonly TurnOrders[],
): TurnOrders => {
  const byRobot = new Map(
    perTeam.flatMap((orders) => orders.timelines.map((timeline) => [timeline.robotId, timeline])),
  );
  return {
    turnNumber: state.turnNumber,
    timelines: state.teams.flatMap((team) =>
      team.robots.flatMap((robot) => {
        const timeline = byRobot.get(robot.id);
        return timeline === undefined ? [] : [timeline];
      }),
    ),
  };
};

export const winnerTeamIdFor = (state: MatchState): string | null => {
  const outcome = resolveSurvivalOutcome(state.teams);
  if (outcome.status !== "won") return null;
  const winners = state.teams.filter((team) => team.side === outcome.side);
  return winners.length === 1 ? winners[0]!.id : null;
};

export function runAutoplayMatch(options: AutoplayOptions, arena: Arena): AutoplayMatch {
  const initialState = buildAutoplayState(options, arena);
  const maxTurns = options.maxTurns ?? DEFAULT_AUTOPLAY_MAX_TURNS;
  const turns: AutoplayTurn[] = [];
  let state = initialState;
  while (turns.length < maxTurns && resolveSurvivalOutcome(state.teams).status === "ongoing") {
    const plans = state.teams.map((team) => planTeamOrders(state, team.id, options.seed));
    const orders = combineTeamOrders(
      state,
      plans.map((plan) => plan.orders),
    );
    const seed = `${options.seed}:turn:${state.turnNumber}`;
    const result = resolveTurn({ state, orders, seed });
    if (result.outcome !== "resolved") {
      throw new AutoplayMalformedOrdersError(
        `Seed ${options.seed} turn ${state.turnNumber}: ${result.code}: ${result.message} ` +
          `(robot ${result.robotId ?? "?"}, command ${String(result.commandIndex ?? "?")})`,
        state.turnNumber,
        orders,
        state,
      );
    }
    turns.push({
      turnNumber: state.turnNumber,
      seed,
      orders,
      events: result.events,
      stateAfter: result.nextState,
      droppedSegments: plans.reduce((total, plan) => total + plan.diagnostics.droppedSegments, 0),
    });
    state = result.nextState;
  }
  return { initialState, turns, winnerTeamId: winnerTeamIdFor(state) };
}
