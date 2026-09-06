/** Local scenario authoring and assertions over the production engine (spec §8/§10). */
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { createHomeAreas } from "../engine/arena.js";
import { ROBOT_DEFINITIONS, WEAPONS } from "../engine/catalog.js";
import { canTraverseTile } from "../engine/movement.js";
import { createReplayLog, serializeReplay, verifyReplay } from "../engine/replay.js";
import { resolveTurn } from "../engine/resolver.js";
import type { MatchState, ResolutionEvent, TeamState, WeaponId } from "../engine/types.js";
import { turnOrdersSchema } from "../lib/net/protocol.js";

const id = z.string().min(1).max(80);
const integer = z.number().int().nonnegative();
const coord = z.object({ x: integer, y: integer }).strict();
const posture = z.enum(["upright", "ducking", "crouching"]);
const heading = z.enum(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);
const ammo = z
  .object({
    rifle: z.union([integer, z.literal("unlimited")]).optional(),
    "burst-gun": z.union([integer, z.literal("unlimited")]).optional(),
    "auto-rifle": z.union([integer, z.literal("unlimited")]).optional(),
    "missile-launcher": integer.optional(),
    "grenade-launcher": integer.optional(),
  })
  .strict();
const robotFields = {
  position: z.union([coord, z.literal("dock")]),
  hp: integer,
  posture,
  scanHeading: heading,
  damageStaggerActionsRemaining: integer,
  ammo,
};
const eventKinds = [
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
] as const satisfies readonly ResolutionEvent["kind"][];
// Validate field/event combinations so an accidental robotId on a damaged event
// cannot make a zero-count assertion silently pass (that event uses targetId).
const eventFilterFields: {
  [Kind in ResolutionEvent["kind"]]: readonly (keyof Extract<ResolutionEvent, { kind: Kind }>)[];
} = {
  "turn-start": [],
  "command-start": ["robotId"],
  deployed: ["robotId"],
  "move-step": ["robotId"],
  "posture-changed": ["robotId"],
  "scan-rotated": ["robotId"],
  "enemy-spotted": ["teamId", "enemyId"],
  "enemy-lost": ["teamId", "enemyId"],
  "scan-target-acquired": ["shooterId", "targetId"],
  fired: ["shooterId"],
  "projectile-launched": ["shooterId"],
  "projectile-impacted": [],
  "shot-missed": ["shooterId", "reason"],
  damaged: ["sourceId", "targetId", "damageKind"],
  destroyed: ["robotId"],
  "last-known-marker": ["teamId", "enemyId"],
  "command-aborted": ["robotId", "reason"],
  "turn-end": [],
};
const eventFilter = z
  .object({
    kind: z.enum(eventKinds),
    tick: integer.optional(),
    robotId: id.optional(),
    shooterId: id.optional(),
    sourceId: id.optional(),
    targetId: id.optional(),
    teamId: id.optional(),
    enemyId: id.optional(),
    damageKind: z.enum(["direct", "blast"]).optional(),
    reason: z
      .enum([
        "out-of-range",
        "angle-blocked",
        "sight-blocked",
        "hit-roll",
        "no-target",
        "destroyed",
      ])
      .optional(),
  })
  .strict()
  .superRefine((filter, context) => {
    const allowed: readonly string[] = ["kind", "tick", ...eventFilterFields[filter.kind]];
    for (const field of Object.keys(filter)) {
      if (!allowed.includes(field))
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${filter.kind} events do not have a ${field} filter.`,
        });
    }
    if (
      filter.reason !== undefined &&
      (filter.kind === "command-aborted") !== (filter.reason === "destroyed")
    ) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: `Unsupported reason for ${filter.kind}.`,
      });
    }
  });

export const scenarioSchema = z
  .object({
    formatVersion: z.literal(1),
    name: z.string().min(1),
    description: z.string().optional(),
    arena: z
      .object({
        width: z.number().int().min(6).max(128),
        height: z.number().int().min(6).max(128),
        terrain: z
          .array(
            z
              .object({
                at: coord,
                terrain: z.enum([
                  "open",
                  "rough",
                  "low-wall",
                  "wall",
                  "bush",
                  "crevice",
                  "outer-wall",
                ]),
              })
              .strict(),
          )
          .default([]),
      })
      .strict(),
    turnLengthSeconds: z.number().int().min(1).max(40).default(15),
    teams: z
      .array(
        z
          .object({
            id,
            robots: z
              .array(
                z
                  .object({
                    id,
                    class: z.enum(["rifle", "burst", "auto", "missile"]),
                    ...robotFields,
                    hp: integer.optional(),
                    posture: posture.default("upright"),
                    scanHeading: heading.default("E"),
                    damageStaggerActionsRemaining: integer.default(0),
                    ammo: ammo.default({}),
                  })
                  .strict(),
              )
              .min(1)
              .max(16),
          })
          .strict(),
      )
      .min(2)
      .max(4),
    turns: z
      .array(
        z
          .object({
            seed: z.string().min(1),
            orders: turnOrdersSchema,
          })
          .strict(),
      )
      .min(1)
      .max(100),
    assertions: z
      .array(
        z.discriminatedUnion("kind", [
          z
            .object({
              kind: z.literal("robot"),
              turn: z.number().int().min(1),
              robotId: id,
              equals: z
                .object(robotFields)
                .partial()
                .strict()
                .refine(
                  (value) =>
                    Object.keys(value).length > 0 &&
                    (value.ammo === undefined || Object.keys(value.ammo).length > 0),
                  "Specify at least one expected robot field (ammo must not be empty).",
                ),
            })
            .strict(),
          z
            .object({
              kind: z.literal("event-count"),
              turn: z.number().int().min(1),
              where: eventFilter,
              count: integer,
            })
            .strict(),
        ]),
      )
      .default([]),
  })
  .strict();

export type Scenario = z.infer<typeof scenarioSchema>;

/** Object subsets recurse; scalars and arrays compare exactly. No expressions or eval. */
const matches = (actual: unknown, expected: unknown): boolean => {
  if (expected !== null && typeof expected === "object" && !Array.isArray(expected)) {
    if (actual === null || typeof actual !== "object") return false;
    return Object.entries(expected).every(
      ([key, value]) =>
        Object.hasOwn(actual, key) && matches((actual as Record<string, unknown>)[key], value),
    );
  }
  return isDeepStrictEqual(actual, expected);
};

function buildState(scenario: Scenario): MatchState {
  const { width, height } = scenario.arena;
  const tiles = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({
      terrain: "open" as MatchState["arena"]["tiles"][number][number]["terrain"],
    })),
  );
  const terrainKeys = new Set<string>();
  for (const entry of scenario.arena.terrain) {
    const key = `${entry.at.x},${entry.at.y}`;
    if (entry.at.x >= width || entry.at.y >= height)
      throw new Error(`Terrain ${key} is outside arena.`);
    if (terrainKeys.has(key)) throw new Error(`Duplicate terrain override at ${key}.`);
    terrainKeys.add(key);
    tiles[entry.at.y]![entry.at.x] = { terrain: entry.terrain };
  }
  const teamIds = new Set<string>();
  const robotIds = new Set<string>();
  const colors = ["red", "blue", "green", "yellow"] as const;
  const teams: TeamState[] = scenario.teams.map((team, index) => {
    if (teamIds.has(team.id)) throw new Error(`Duplicate team id: ${team.id}.`);
    teamIds.add(team.id);
    return {
      id: team.id,
      name: team.id,
      color: colors[index]!,
      side: (index + 1) as TeamState["side"],
      homeSlot: index as TeamState["homeSlot"],
      brain: "human",
      score: 0,
      robots: team.robots.map((robot) => {
        if (robotIds.has(robot.id)) throw new Error(`Duplicate robot id: ${robot.id}.`);
        robotIds.add(robot.id);
        const definition = ROBOT_DEFINITIONS[robot.class];
        if (robot.hp !== undefined && robot.hp > definition.armor) {
          throw new Error(`Robot ${robot.id}: HP exceeds ${definition.armor} armor.`);
        }
        if (robot.position !== "dock") {
          const tile = tiles[robot.position.y]?.[robot.position.x];
          if (tile === undefined || !canTraverseTile(robot.posture, tile)) {
            throw new Error(
              `Robot ${robot.id}: position is outside arena or impassable for its posture.`,
            );
          }
        }
        const startingAmmo = Object.fromEntries(
          (Object.keys(WEAPONS) as WeaponId[]).map((weapon) => [
            weapon,
            WEAPONS[weapon].startingAmmo,
          ]),
        ) as Record<WeaponId, number | "unlimited">;
        for (const weapon of Object.keys(WEAPONS) as WeaponId[]) {
          const override = robot.ammo[weapon];
          if (override !== undefined) startingAmmo[weapon] = override;
        }
        return {
          id: robot.id,
          teamId: team.id,
          definition,
          position: robot.position,
          hp: robot.hp ?? definition.armor,
          posture: robot.posture,
          scanHeading: robot.scanHeading,
          damageStaggerActionsRemaining: robot.damageStaggerActionsRemaining,
          ammo: startingAmmo,
        };
      }),
    };
  });
  for (const assertion of scenario.assertions) {
    if (assertion.turn > scenario.turns.length)
      throw new Error(`Assertion turn ${assertion.turn} does not exist.`);
    if (assertion.kind === "robot" && !robotIds.has(assertion.robotId)) {
      throw new Error(`Assertion references unknown robot ${assertion.robotId}.`);
    }
    if (assertion.kind === "event-count") {
      for (const key of ["robotId", "shooterId", "sourceId", "targetId", "enemyId"] as const) {
        const value = assertion.where[key];
        if (value !== undefined && !robotIds.has(value))
          throw new Error(`Event filter references unknown robot ${value}.`);
      }
      if (assertion.where.teamId !== undefined && !teamIds.has(assertion.where.teamId)) {
        throw new Error(`Event filter references unknown team ${assertion.where.teamId}.`);
      }
    }
  }
  return {
    config: {
      sportType: "survival",
      formation: "beginner",
      length: "melee",
      arenaType: "rubble",
      arenaSizeName: scenario.name,
      turnLengthSeconds: scenario.turnLengthSeconds,
    },
    turnNumber: 1,
    teams,
    arena: {
      type: "rubble",
      sizeName: scenario.name,
      width,
      height,
      tiles,
      homeAreas: createHomeAreas(width, height),
    },
    lastKnownMarkers: new Map(),
  };
}

/** Preserve the canonical replay codec's Map representation in all state exports. */
function jsonState(state: MatchState): unknown {
  const encoded = serializeReplay({ formatVersion: 1, initialState: state, turns: [] });
  return (JSON.parse(encoded) as { initialState: unknown }).initialState;
}

export function runScenario(input: unknown, seedOverride?: string) {
  const scenario = scenarioSchema.parse(input);
  const initialState = buildState(scenario);
  const turns = scenario.turns.map((turn, index) => ({
    ...turn,
    // Preserve exact --seed for turn 1; give subsequent turns stable distinct seeds.
    seed:
      seedOverride === undefined
        ? turn.seed
        : index === 0
          ? seedOverride
          : `${seedOverride}:${index + 1}`,
  }));
  const replay = createReplayLog({ initialState, turns });
  let state = initialState;
  const states = turns.map((turn) => {
    const result = resolveTurn({ state, ...turn });
    if (result.outcome !== "resolved") throw new Error(result.message);
    state = result.nextState;
    return state;
  });
  const checks = scenario.assertions.map((assertion, index) => {
    const turnState = states[assertion.turn - 1]!;
    const actual =
      assertion.kind === "robot"
        ? turnState.teams
            .flatMap((team) => team.robots)
            .find((robot) => robot.id === assertion.robotId)
        : replay.turns[assertion.turn - 1]!.events.filter((event) =>
            matches(event, assertion.where),
          ).length;
    const expected = assertion.kind === "robot" ? assertion.equals : assertion.count;
    return { index: index + 1, assertion, passed: matches(actual, expected), actual };
  });
  const verification = verifyReplay(replay);
  return {
    report: {
      formatVersion: 1,
      name: scenario.name,
      passed: verification.ok && checks.every((check) => check.passed),
      replayVerification: verification,
      checks,
      turns: replay.turns.map((turn, index) => ({
        turnNumber: turn.orders.turnNumber,
        seed: turn.seed,
        eventCount: turn.events.length,
        eventDigest: turn.eventDigest,
        nextStateDigest: turn.nextStateDigest,
        state: jsonState(states[index]!),
      })),
      finalState: jsonState(state),
    },
    replay,
  };
}
