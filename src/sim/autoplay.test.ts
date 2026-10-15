/**
 * Deterministic autoplay fuzz suite: seeded bot matches through the real
 * planner and resolver, with per-turn engine, replay, scoring, and
 * participant-projection invariants.
 *
 * Set AUTOPLAY_FUZZ_MATCHES=<n> to run an additional heavier randomized loop.
 */

import { describe, expect, it } from "vitest";
import { WEAPONS } from "../engine/catalog";
import { SURVIVAL_ROBOT_BONUS, SURVIVAL_TEAM_BONUS, TICKS_PER_SECOND } from "../engine/constants";
import {
  createReplayLog,
  deserializeReplay,
  serializeReplay,
  verifyReplay,
} from "../engine/replay";
import { resolveSurvivalOutcome, survivalCeremonyScores } from "../engine/survival";
import { canTraverse } from "../engine/traversal";
import { computeVisibility } from "../engine/visibility";
import type {
  Arena,
  MatchState,
  ResolutionEvent,
  RobotClass,
  RobotState,
  TileCoord,
} from "../engine/types";
import { ARENA_NAMES, loadArena } from "../lib/arenas";
import { projectMatchState, projectTurnResult } from "../../server/view";
import type { CanonicalTurnRecord } from "../../server/matches";
import {
  buildAutoplayState,
  runAutoplayMatch,
  type AutoplayMatch,
  type AutoplayOptions,
  type AutoplayTurn,
} from "./autoplay";

const COLORS = ["red", "blue", "green", "yellow"] as const;

const ROSTERS: readonly (readonly RobotClass[])[] = [
  ["rifle", "burst", "auto", "missile"],
  ["rifle", "rifle", "burst", "burst", "auto", "missile"],
  ["missile", "missile", "auto"],
  ["burst", "auto"],
  ["rifle", "missile"],
  ["auto", "auto", "auto", "missile"],
];

const arenaCache = new Map<string, Arena>();
const arenaFor = async (name: AutoplayOptions["arena"]): Promise<Arena> => {
  const cached = arenaCache.get(name);
  if (cached !== undefined) return cached;
  const arena = await loadArena(name);
  arenaCache.set(name, arena);
  return arena;
};

const fuzzOptions = (index: number, prefix = "fuzz"): AutoplayOptions => {
  const teamCount = 2 + (index % 3);
  const arena: AutoplayOptions["arena"] =
    Math.floor(index / 3) % 2 === 0 ? "rubble-two" : "rubble-three";
  return {
    seed: `${prefix}-${index}`,
    arena,
    maxTurns: 30,
    turnLengthSeconds: [15, 15, 8, 25, 40, 3][index % 6]!,
    teams: Array.from({ length: teamCount }, (_, team) => ({
      id: `t${team + 1}`,
      color: COLORS[team]!,
      robots: [...ROSTERS[(index + team * 2) % ROSTERS.length]!],
    })),
  };
};

// ──────────────────────────────────────────────────────────────────────────
// Invariant helpers

const allRobots = (state: MatchState): RobotState[] => state.teams.flatMap((team) => team.robots);

const robotMap = (state: MatchState): Map<string, RobotState> =>
  new Map(allRobots(state).map((robot) => [robot.id, robot]));

const sideOf = (state: MatchState): Map<string, number> =>
  new Map(state.teams.flatMap((team) => team.robots.map((robot) => [robot.id, team.side])));

const actorIds = (event: ResolutionEvent): string[] => {
  switch (event.kind) {
    case "command-start":
    case "deployed":
    case "move-step":
    case "posture-changed":
    case "scan-rotated":
      return [event.robotId];
    case "scan-target-acquired":
    case "fired":
    case "projectile-launched":
    case "shot-missed":
      return [event.shooterId];
    case "damaged":
      return [event.sourceId];
    default:
      return [];
  }
};

/** Every robot id an event mentions, for leak checks. */
const mentionedIds = (event: Record<string, unknown>): string[] =>
  ["robotId", "shooterId", "sourceId", "targetId", "enemyId"].flatMap((key) =>
    typeof event[key] === "string" ? [event[key]] : [],
  );

const key = (tile: TileCoord): string => `${tile.x},${tile.y}`;

interface TurnCheck {
  readonly label: string;
  readonly before: MatchState;
  readonly turn: AutoplayTurn;
  readonly deadBefore: ReadonlySet<string>;
}

const checkTurn = ({ label, before, turn, deadBefore }: TurnCheck): string[] => {
  const problems: string[] = [];
  const fail = (message: string) => problems.push(`${label} turn ${turn.turnNumber}: ${message}`);
  const turnTicks = Math.round(before.config.turnLengthSeconds * TICKS_PER_SECOND);
  const sides = sideOf(before);
  const events = turn.events;
  // Rules revision 4: shots land after they fire, robots occupy a 2-tile move's
  // floored midpoint (which may be any terrain), and the movie runs past turn
  // length into the 150-tick tail (docs/spec.md, revision 4).
  const timing = (before.config.rulesRevision ?? 0) >= 4;
  const lastTick = timing ? turnTicks + 150 + 200 : turnTicks;
  const intermediateSteps = new Set<number>();
  if (timing) {
    events.forEach((event, index) => {
      if (event.kind !== "move-step") return;
      const next = events
        .slice(index + 1)
        .find((later) => later.kind === "move-step" && later.robotId === event.robotId);
      if (next !== undefined && next.tick - event.tick === 10) intermediateSteps.add(index);
    });
  }

  if ((turn.droppedSegments ?? 0) !== 0) {
    fail(`client planner dropped ${turn.droppedSegments} bot segments`);
  }
  if (events[0]?.kind !== "turn-start") fail("first event is not turn-start");
  if (events.at(-1)?.kind !== "turn-end") fail("last event is not turn-end");

  // Event-sourced robot state, tracked independently of the resolver.
  const robots = robotMap(before);
  const destroyedAt = new Map<string, number>();
  const launched = new Map<string, { tick: number; impacts: number }>();
  const ammoSpent = new Map<string, number>();
  const firedThisTick: { tick: number; shooters: Set<string> } = { tick: -1, shooters: new Set() };
  let previousTick = 0;

  events.forEach((event, index) => {
    if (event.seq !== index) fail(`seq ${event.seq} at index ${index} is not gap-free`);
    if (!Number.isInteger(event.tick) || event.tick < 0 || event.tick > lastTick) {
      fail(`event ${event.kind} tick ${event.tick} outside 0..${lastTick}`);
    }
    if (event.tick < previousTick) fail(`tick decreased ${previousTick} -> ${event.tick}`);
    previousTick = event.tick;

    for (const actor of actorIds(event)) {
      if (deadBefore.has(actor))
        fail(`robot ${actor} destroyed in an earlier turn acted: ${event.kind}`);
      const diedAt = destroyedAt.get(actor);
      const inFlight = timing && (event.kind === "damaged" || event.kind === "shot-missed");
      if (diedAt !== undefined && !inFlight) {
        fail(`robot ${actor} acted (${event.kind}) after destruction`);
      }
    }
    if (event.kind === "command-aborted") {
      if (destroyedAt.get(event.robotId) !== event.tick) {
        fail(`command-aborted for ${event.robotId} without same-tick destruction`);
      }
    }

    if (event.tick !== firedThisTick.tick) {
      firedThisTick.tick = event.tick;
      firedThisTick.shooters = new Set();
    }

    switch (event.kind) {
      case "deployed": {
        const robot = robots.get(event.robotId);
        if (robot === undefined) {
          fail(`deployed unknown robot ${event.robotId}`);
          break;
        }
        if (robot.position !== "dock") fail(`${robot.id} deployed while on the arena`);
        const team = before.teams.find((candidate) => candidate.id === robot.teamId)!;
        const home = before.arena.homeAreas[team.homeSlot]!;
        if (!home.tiles.some((tile) => tile.x === event.to.x && tile.y === event.to.y)) {
          fail(`${robot.id} deployed outside its home area at ${key(event.to)}`);
        }
        const terrain = before.arena.tiles[event.to.y]?.[event.to.x]?.terrain;
        if (terrain === undefined || !canTraverse(robot.posture, terrain)) {
          fail(`${robot.id} deployed onto ${terrain ?? "nothing"} while ${robot.posture}`);
        }
        robots.set(robot.id, { ...robot, position: event.to });
        break;
      }
      case "move-step": {
        const robot = robots.get(event.robotId)!;
        if (robot.position === "dock") fail(`${robot.id} moved while docked`);
        else if (
          Math.max(
            Math.abs(robot.position.x - event.to.x),
            Math.abs(robot.position.y - event.to.y),
          ) > 2
        ) {
          fail(`${robot.id} jumped from ${key(robot.position)} to ${key(event.to)}`);
        }
        const terrain = before.arena.tiles[event.to.y]?.[event.to.x]?.terrain;
        if (
          !intermediateSteps.has(index) &&
          (terrain === undefined || !canTraverse(robot.posture, terrain))
        ) {
          fail(`${robot.id} moved onto ${terrain ?? "out of bounds"} while ${robot.posture}`);
        }
        robots.set(robot.id, { ...robot, position: event.to });
        break;
      }
      case "posture-changed": {
        const robot = robots.get(event.robotId)!;
        robots.set(robot.id, { ...robot, posture: event.posture });
        break;
      }
      case "scan-rotated": {
        const robot = robots.get(event.robotId)!;
        robots.set(robot.id, { ...robot, scanHeading: event.heading });
        break;
      }
      case "fired": {
        const robot = robots.get(event.shooterId)!;
        const owned = [
          robot.definition.primaryWeapon,
          ...(robot.definition.secondaryWeapons ?? []),
        ];
        if (!owned.includes(event.weapon)) fail(`${robot.id} fired unowned ${event.weapon}`);
        if (robot.position === "dock") fail(`${robot.id} fired from the dock`);
        if (WEAPONS[event.weapon].startingAmmo !== "unlimited") {
          const ammoKey = `${robot.id}:${event.weapon}`;
          ammoSpent.set(ammoKey, (ammoSpent.get(ammoKey) ?? 0) + 1);
        }
        firedThisTick.shooters.add(robot.id);
        break;
      }
      case "projectile-launched":
        if (launched.has(event.projectileId)) fail(`duplicate projectile ${event.projectileId}`);
        launched.set(event.projectileId, { tick: event.tick, impacts: 0 });
        if (!firedThisTick.shooters.has(event.shooterId)) {
          fail(`projectile ${event.projectileId} launched without a same-tick fired event`);
        }
        break;
      case "projectile-impacted": {
        const projectile = launched.get(event.projectileId);
        if (projectile === undefined) fail(`impact for unknown projectile ${event.projectileId}`);
        else {
          projectile.impacts += 1;
          if (timing ? event.tick < projectile.tick : projectile.tick !== event.tick)
            fail(`projectile ${event.projectileId} impacted on a different tick`);
        }
        break;
      }
      case "damaged": {
        const source = robots.get(event.sourceId);
        const target = robots.get(event.targetId);
        if (source === undefined || target === undefined) {
          fail(`damaged references unknown robot ${event.sourceId} -> ${event.targetId}`);
          break;
        }
        if (!Number.isInteger(event.damage) || event.damage < 0) fail(`bad damage ${event.damage}`);
        if (!timing && !firedThisTick.shooters.has(source.id)) {
          fail(`damage from ${source.id} without a same-tick fired event`);
        }
        if (event.damageKind === "direct" && sides.get(source.id) === sides.get(target.id)) {
          fail(`direct damage between same-Side robots ${source.id} -> ${target.id}`);
        }
        if (target.position === "dock" && !destroyedAt.has(target.id)) {
          fail(`docked robot ${target.id} took damage`);
        }
        if (destroyedAt.has(target.id) && destroyedAt.get(target.id)! < event.tick) {
          fail(`robot ${target.id} damaged after its destruction tick`);
        }
        robots.set(target.id, { ...target, hp: Math.max(0, target.hp - event.damage) });
        break;
      }
      case "destroyed": {
        const robot = robots.get(event.robotId)!;
        if (robot.hp !== 0) fail(`${robot.id} destroyed with tracked hp ${robot.hp}`);
        if (destroyedAt.has(robot.id)) fail(`${robot.id} destroyed twice`);
        destroyedAt.set(robot.id, event.tick);
        robots.set(robot.id, { ...robot, position: "dock" });
        break;
      }
      default:
        break;
    }
  });

  for (const [id, projectile] of launched) {
    if (projectile.impacts !== 1) fail(`projectile ${id} has ${projectile.impacts} impacts`);
  }
  // Any robot reaching 0 hp must be destroyed exactly once.
  for (const robot of robots.values()) {
    if (robot.hp === 0 && !deadBefore.has(robot.id) && !destroyedAt.has(robot.id)) {
      fail(`${robot.id} reached 0 hp without a destroyed event`);
    }
  }

  // Compare event-sourced state with the resolver's next state.
  const after = robotMap(turn.stateAfter);
  for (const [id, tracked] of robots) {
    const actual = after.get(id)!;
    const original = robotMap(before).get(id)!;
    if (actual.hp < 0 || actual.hp > actual.definition.armor || !Number.isInteger(actual.hp)) {
      fail(`${id} hp ${actual.hp} outside 0..${actual.definition.armor}`);
    }
    if (actual.hp !== tracked.hp) fail(`${id} hp ${actual.hp} but events imply ${tracked.hp}`);
    if (JSON.stringify(actual.position) !== JSON.stringify(tracked.position)) {
      fail(
        `${id} position ${JSON.stringify(actual.position)} but events imply ${JSON.stringify(tracked.position)}`,
      );
    }
    if (actual.posture !== tracked.posture) fail(`${id} posture mismatch with events`);
    if (actual.scanHeading !== tracked.scanHeading) fail(`${id} heading mismatch with events`);
    if (actual.hp === 0 && actual.position !== "dock") fail(`${id} dead but on the arena`);
    if (actual.position !== "dock") {
      const terrain = before.arena.tiles[actual.position.y]?.[actual.position.x]?.terrain;
      if (
        terrain === undefined ||
        terrain === "wall" ||
        terrain === "outer-wall" ||
        terrain === "crevice"
      ) {
        fail(`${id} ends on impassable ${terrain ?? "out of bounds"}`);
      }
    }
    for (const weapon of Object.keys(actual.ammo) as (keyof typeof actual.ammo)[]) {
      const now = actual.ammo[weapon];
      const was = original.ammo[weapon];
      if (now === "unlimited" || was === "unlimited") {
        if (now !== was) fail(`${id} ${weapon} ammo changed kind ${String(was)} -> ${String(now)}`);
        continue;
      }
      if (now < 0 || !Number.isInteger(now)) fail(`${id} ${weapon} ammo ${now}`);
      const spent = ammoSpent.get(`${id}:${weapon}`) ?? 0;
      if (was - now !== spent) fail(`${id} ${weapon} ammo ${was} -> ${now} but ${spent} fired`);
    }
    if (deadBefore.has(id) && (actual.hp !== 0 || actual.position !== "dock")) {
      fail(`${id} came back from destruction`);
    }
  }
  return problems;
};

/**
 * Participant projection leak check. An enemy id may reach a participant only
 * when that enemy was visible to them at the start of the turn or was spotted
 * (by that Team) at some boundary during the turn. Damage source ids for any
 * other enemy must be redacted.
 */
const checkProjection = (label: string, before: MatchState, turn: AutoplayTurn): string[] => {
  const problems: string[] = [];
  const record: CanonicalTurnRecord = {
    turnNumber: turn.turnNumber,
    seed: turn.seed,
    resolutionNonce: "n/a",
    orders: turn.orders,
    participantOrders: {},
    initialState: before,
    events: turn.events,
    eventDigest: "n/a",
    nextStateDigest: "n/a",
  };
  const sides = sideOf(before);
  for (const team of before.teams) {
    const fail = (message: string) =>
      problems.push(`${label} turn ${turn.turnNumber} team ${team.id}: ${message}`);
    // Own last-known markers from earlier turns are legitimately known ids.
    const seen = new Set<string>([
      ...computeVisibility(before, team.id).visibleEnemies,
      ...(before.lastKnownMarkers.get(team.id) ?? []).map((marker) => marker.enemyId),
    ]);
    for (const event of turn.events) {
      if (event.kind === "enemy-spotted" && event.teamId === team.id) seen.add(event.enemyId);
    }
    const allowed = (id: string) => sides.get(id) === team.side || seen.has(id);
    const projected = projectTurnResult(record, team.id);
    for (const robot of projected.initialState.teams.flatMap((candidate) => candidate.robots)) {
      if (!allowed(robot.id)) fail(`initial state leaks hidden enemy ${robot.id}`);
    }
    for (const event of projected.events) {
      const fields = event as unknown as Record<string, unknown>;
      if (
        typeof fields.teamId === "string" &&
        fields.teamId !== team.id &&
        event.kind !== "damaged"
      ) {
        fail(`receives another team's ${event.kind}`);
      }
      for (const id of mentionedIds(fields)) {
        if (!allowed(id)) fail(`${event.kind} leaks hidden enemy ${id} at tick ${event.tick}`);
      }
      const contact = fields.contact as { id: string } | undefined;
      if (contact !== undefined && !allowed(contact.id)) fail(`contact leaks ${contact.id}`);
    }
    const serialized = JSON.stringify(projected);
    for (const robot of allRobots(before)) {
      if (!allowed(robot.id) && serialized.includes(`"${robot.id}"`)) {
        fail(`serialized projection contains hidden enemy id ${robot.id}`);
      }
    }
    if (serialized.includes(turn.seed)) fail("projection contains the turn seed");
    // The next planning snapshot shows only currently visible enemies.
    const nextVisible = computeVisibility(turn.stateAfter, team.id).visibleEnemies;
    for (const robot of projectMatchState(turn.stateAfter, team.id).teams.flatMap(
      (candidate) => candidate.robots,
    )) {
      if (sides.get(robot.id) !== team.side && !nextVisible.has(robot.id)) {
        fail(`planning snapshot leaks hidden enemy ${robot.id}`);
      }
    }
  }
  return problems;
};

const checkMatch = (
  label: string,
  options: AutoplayOptions,
  match: AutoplayMatch,
  projectionTurns: (turnNumber: number) => boolean,
): string[] => {
  const problems: string[] = [];
  const maxTurns = options.maxTurns ?? 40;
  let before = match.initialState;
  const deadBefore = new Set<string>();
  for (const turn of match.turns) {
    if (turn.turnNumber !== before.turnNumber) problems.push(`${label}: turn number skew`);
    problems.push(...checkTurn({ label, before, turn, deadBefore }));
    if (projectionTurns(turn.turnNumber)) problems.push(...checkProjection(label, before, turn));
    for (const robot of allRobots(turn.stateAfter)) if (robot.hp === 0) deadBefore.add(robot.id);
    before = turn.stateAfter;
  }

  // Termination and Survival outcome/ceremony consistency.
  const outcome = resolveSurvivalOutcome(before.teams);
  if (outcome.status === "ongoing" && match.turns.length !== maxTurns) {
    problems.push(`${label}: stopped after ${match.turns.length} turns while ongoing`);
  }
  const livingTeams = before.teams.filter((team) => team.robots.some((robot) => robot.hp > 0));
  if (outcome.status === "won") {
    if (livingTeams.length !== 1 || match.winnerTeamId !== livingTeams[0]!.id) {
      problems.push(`${label}: winner ${match.winnerTeamId} disagrees with survivors`);
    }
  } else if (match.winnerTeamId !== null) {
    problems.push(`${label}: winner reported for ${outcome.status}`);
  }
  const ceremony = survivalCeremonyScores(before.teams);
  for (const team of before.teams) {
    const survivors = team.robots.filter((robot) => robot.hp > 0).length;
    const expected =
      team.score + survivors * SURVIVAL_ROBOT_BONUS + (survivors > 0 ? SURVIVAL_TEAM_BONUS : 0);
    if (team.score !== 0) problems.push(`${label}: Survival team score drifted to ${team.score}`);
    if (ceremony.get(team.id) !== expected) {
      problems.push(`${label}: ceremony ${team.id} ${ceremony.get(team.id)} expected ${expected}`);
    }
  }

  // Replay: recording reproduces the events byte-for-byte and verifies.
  const replay = createReplayLog({
    initialState: match.initialState,
    turns: match.turns.map((turn) => ({ seed: turn.seed, orders: turn.orders })),
  });
  match.turns.forEach((turn, index) => {
    if (JSON.stringify(replay.turns[index]!.events) !== JSON.stringify(turn.events)) {
      problems.push(`${label}: replay events diverge at turn ${turn.turnNumber}`);
    }
  });
  // Verifying the JSON round trip also verifies the in-memory log it equals.
  const json = serializeReplay(replay);
  const roundTrip = deserializeReplay(json);
  if (serializeReplay(roundTrip) !== json)
    problems.push(`${label}: replay JSON round trip differs`);
  const roundTripVerification = verifyReplay(roundTrip);
  if (!roundTripVerification.ok) {
    problems.push(`${label}: deserialized replay fails ${JSON.stringify(roundTripVerification)}`);
  }
  return problems;
};

const runAndCheck = async (
  options: AutoplayOptions,
  projectionTurns: (turnNumber: number) => boolean,
) => {
  const arena = await arenaFor(options.arena);
  const initialJson = JSON.stringify(buildAutoplayState(options, arena), (_k, v: unknown) =>
    v instanceof Map ? [...v] : v,
  );
  const match = runAutoplayMatch(options, arena);
  const problems = checkMatch(options.seed, options, match, projectionTurns);
  const afterJson = JSON.stringify(match.initialState, (_k, v: unknown) =>
    v instanceof Map ? [...v] : v,
  );
  if (afterJson !== initialJson) problems.push(`${options.seed}: initial state was mutated`);
  return { match, problems };
};

const eventCounts = (match: AutoplayMatch): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const turn of match.turns)
    for (const event of turn.events) counts[event.kind] = (counts[event.kind] ?? 0) + 1;
  return counts;
};

describe("autoplay fuzz", () => {
  it("plays seeded 2-4 team matches on both arenas without invariant violations", async () => {
    const totals: Record<string, number> = {};
    const problems: string[] = [];
    let turns = 0;
    let decided = 0;
    const matches = 9;
    for (let index = 0; index < matches; index += 1) {
      const options = fuzzOptions(index);
      const result = await runAndCheck(options, (turnNumber) => turnNumber <= 3);
      problems.push(...result.problems);
      turns += result.match.turns.length;
      if (
        resolveSurvivalOutcome(result.match.turns.at(-1)!.stateAfter.teams).status !== "ongoing"
      ) {
        decided += 1;
      }
      for (const [kind, count] of Object.entries(eventCounts(result.match))) {
        totals[kind] = (totals[kind] ?? 0) + count;
      }
    }
    expect(problems).toEqual([]);
    expect(turns).toBeGreaterThan(matches);
    expect(decided).toBeGreaterThan(matches / 2);
    // Every resolver event kind is exercised.
    for (const kind of [
      "turn-start",
      "command-start",
      "deployed",
      "move-step",
      "posture-changed",
      "scan-rotated",
      "enemy-spotted",
      "enemy-lost",
      "scan-target-acquired",
      "fired",
      "projectile-launched",
      "projectile-impacted",
      "shot-missed",
      "damaged",
      "destroyed",
      "last-known-marker",
      "command-aborted",
      "turn-end",
    ]) {
      expect(totals[kind] ?? 0, kind).toBeGreaterThan(0);
    }
  }, 60_000);

  it("plays a short match on every original arena without invariant violations", async () => {
    const problems: string[] = [];
    for (const [index, arena] of ARENA_NAMES.entries()) {
      const options: AutoplayOptions = {
        ...fuzzOptions(index * 3, `arena-${arena}`),
        arena,
        maxTurns: 2,
      };
      const result = await runAndCheck(options, (turnNumber) => turnNumber === 1);
      problems.push(...result.problems.map((problem) => `${arena}: ${problem}`));
      expect(result.match.turns.length, arena).toBeGreaterThan(0);
    }
    expect(problems).toEqual([]);
  }, 120_000);

  it("re-running a seed yields byte-identical replays", async () => {
    const options = fuzzOptions(4, "determinism");
    const arena = await arenaFor(options.arena);
    const first = runAutoplayMatch(options, arena);
    const second = runAutoplayMatch(options, arena);
    const digest = (match: AutoplayMatch) =>
      serializeReplay(
        createReplayLog({
          initialState: match.initialState,
          turns: match.turns.map((turn) => ({ seed: turn.seed, orders: turn.orders })),
        }),
      );
    expect(digest(second)).toBe(digest(first));
    expect(second.winnerTeamId).toBe(first.winnerTeamId);
    const otherSeed = runAutoplayMatch({ ...options, seed: "determinism-other" }, arena);
    expect(digest(otherSeed)).not.toBe(digest(first));
  }, 30_000);

  it("checks participant projections on every turn of a four-team match", async () => {
    const options = fuzzOptions(5, "projection");
    const { problems, match } = await runAndCheck(options, () => true);
    expect(problems).toEqual([]);
    expect(match.turns.length).toBeGreaterThan(0);
  }, 30_000);

  const heavy = Number(process.env.AUTOPLAY_FUZZ_MATCHES ?? 0);
  it.runIf(heavy > 0)(
    `runs ${heavy} additional fuzz matches (AUTOPLAY_FUZZ_MATCHES)`,
    async () => {
      const problems: string[] = [];
      let turns = 0;
      let events = 0;
      let capped = 0;
      for (let index = 0; index < heavy; index += 1) {
        const options = fuzzOptions(index, "heavy");
        try {
          const result = await runAndCheck(options, (turnNumber) => turnNumber % 2 === 1);
          problems.push(...result.problems);
          turns += result.match.turns.length;
          events += result.match.turns.reduce((sum, turn) => sum + turn.events.length, 0);
          if (result.match.winnerTeamId === null) capped += 1;
        } catch (error) {
          problems.push(`${options.seed}: ${(error as Error).message}`);
        }
      }
      console.info(
        `autoplay heavy: ${heavy} matches, ${turns} turns, ${events} events, ${capped} without a winner`,
      );
      expect(problems.slice(0, 50)).toEqual([]);
    },
    3_600_000,
  );
});
