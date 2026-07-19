import { describe, expect, it } from "vitest";

import { makeMatch, makeRobot, makeTeam } from "./__fixtures__/match.js";
import { resolveTurn, type TurnResult } from "./resolver.js";
import type {
  CommandTimeline,
  MatchState,
  ResolutionEvent,
  RobotState,
  TurnOrders,
} from "./types.js";

const ordersFor = (state: MatchState, timelines: readonly CommandTimeline[]): TurnOrders => ({
  turnNumber: state.turnNumber,
  timelines,
});

const requireResolved = (result: ReturnType<typeof resolveTurn>): TurnResult => {
  if (result.outcome !== "resolved") throw new Error(result.message);
  return result;
};

const eventsOf = <Kind extends ResolutionEvent["kind"]>(
  events: readonly ResolutionEvent[],
  kind: Kind,
): Extract<ResolutionEvent, { readonly kind: Kind }>[] =>
  events.filter(
    (event): event is Extract<ResolutionEvent, { readonly kind: Kind }> => event.kind === kind,
  );

const deepFreeze = <Value>(value: Value): Value => {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach((entry) => deepFreeze(entry));
  }
  return value;
};

const missileOrders = (state: MatchState, shooterId: string, target = { x: 3, y: 1 }) =>
  ordersFor(state, [
    {
      robotId: shooterId,
      segments: [
        {
          kind: "aim-and-fire" as const,
          target,
          weapon: "missile-launcher" as const,
          repeat: false,
        },
      ],
    },
  ]);

describe("Phase 3 projectile and blast semantics", () => {
  it("emits deterministic launch/impact cues without delaying fire-boundary state", () => {
    const shooter = makeRobot("m1", "team-1", "missile", { x: 1, y: 1 });
    const target = makeRobot("r2", "team-2", "rifle", { x: 3, y: 1 });
    const state = makeMatch({ teamOneRobots: [shooter], teamTwoRobots: [target] });
    const orders = missileOrders(state, shooter.id);
    const first = requireResolved(resolveTurn({ state, orders, seed: "projectile-cues" }));
    const second = requireResolved(resolveTurn({ state, orders, seed: "projectile-cues" }));

    expect(first).toEqual(second);
    expect(eventsOf(first.events, "projectile-launched")).toEqual([
      expect.objectContaining({
        tick: 30,
        projectileId: "1:m1:0:30:0",
        shooterId: "m1",
        weapon: "missile-launcher",
        from: { x: 1, y: 1 },
        target: { x: 3, y: 1 },
      }),
    ]);
    expect(eventsOf(first.events, "projectile-impacted")).toEqual([
      expect.objectContaining({
        tick: 30,
        projectileId: "1:m1:0:30:0",
        outcome: "blast",
      }),
    ]);
    expect(eventsOf(first.events, "damaged").every((event) => event.tick === 30)).toBe(true);
    expect(first.nextState.teams[0]?.robots[0]?.ammo["missile-launcher"]).toBe(2);
  });

  it("carries finite missile ammo into the next turn without regeneration", () => {
    const shooter = makeRobot("m1", "team-1", "missile", { x: 1, y: 1 });
    const target = makeRobot("r2", "team-2", "rifle", { x: 3, y: 1 });
    const state = makeMatch({ teamOneRobots: [shooter], teamTwoRobots: [target] });
    const first = requireResolved(
      resolveTurn({ state, orders: missileOrders(state, shooter.id), seed: "ammo-turn-1" }),
    );
    const second = requireResolved(
      resolveTurn({
        state: first.nextState,
        orders: missileOrders(first.nextState, shooter.id),
        seed: "ammo-turn-2",
      }),
    );

    expect(first.nextState.teams[0]?.robots[0]?.ammo["missile-launcher"]).toBe(2);
    expect(second.nextState.teams[0]?.robots[0]?.ammo["missile-launcher"]).toBe(1);
  });

  it("keeps a fire-time result after the target moves during later presentation", () => {
    const shooter = makeRobot("r1", "team-1", "rifle", { x: 1, y: 1 });
    const target = makeRobot("r2", "team-2", "rifle", { x: 2, y: 1 });
    const state = makeMatch({ teamOneRobots: [shooter], teamTwoRobots: [target] });
    const orders = ordersFor(state, [
      {
        robotId: shooter.id,
        segments: [
          { kind: "aim-and-fire", target: { x: 2, y: 1 }, weapon: "rifle", repeat: false },
        ],
      },
      {
        robotId: target.id,
        segments: [
          { kind: "set-posture", posture: "ducking" },
          { kind: "move", posture: "ducking", path: [{ to: { x: 3, y: 1 } }] },
        ],
      },
    ]);

    let result: TurnResult | undefined;
    for (let seed = 0; seed < 100 && !result; seed += 1) {
      const candidate = requireResolved(resolveTurn({ state, orders, seed: `locked-${seed}` }));
      if (eventsOf(candidate.events, "damaged").some((event) => event.sourceId === shooter.id)) {
        result = candidate;
      }
    }
    expect(result).toBeDefined();
    expect(eventsOf(result?.events ?? [], "damaged")[0]?.tick).toBe(30);
    expect(eventsOf(result?.events ?? [], "move-step")[0]?.tick).toBe(40);
    expect(result?.nextState.teams[1]?.robots[0]?.position).toEqual({ x: 3, y: 1 });
  });

  it("does not cancel a launched projectile when its shooter dies at the same boundary", () => {
    const shooter = makeRobot("m1", "team-1", "missile", { x: 1, y: 1 }, { hp: 1 });
    const target = makeRobot("r2", "team-2", "rifle", { x: 4, y: 1 }, { scanHeading: "W" });
    const state = makeMatch({ teamOneRobots: [shooter], teamTwoRobots: [target] });
    const orders = ordersFor(state, [
      {
        robotId: shooter.id,
        segments: [
          {
            kind: "aim-and-fire",
            target: { x: 4, y: 1 },
            weapon: "missile-launcher",
            repeat: false,
          },
        ],
      },
      {
        robotId: target.id,
        segments: [
          { kind: "aim-and-fire", target: { x: 1, y: 1 }, weapon: "rifle", repeat: false },
        ],
      },
    ]);

    let result: TurnResult | undefined;
    for (let seed = 0; seed < 100 && !result; seed += 1) {
      const candidate = requireResolved(
        resolveTurn({ state, orders, seed: `shooter-dies-${seed}` }),
      );
      if (eventsOf(candidate.events, "destroyed").some((event) => event.robotId === shooter.id)) {
        result = candidate;
      }
    }
    expect(result).toBeDefined();
    expect(eventsOf(result?.events ?? [], "projectile-impacted")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ projectileId: "1:m1:0:30:0", outcome: "blast" }),
      ]),
    );
    expect(
      eventsOf(result?.events ?? [], "damaged").some(
        (event) => event.damageKind === "blast" && event.sourceId === shooter.id,
      ),
    ).toBe(true);
  });

  it("dispatches missiles to category 1 and damages same-Side allies", () => {
    const shooter = makeRobot("m1", "team-1", "missile", { x: 1, y: 1 });
    const ally = makeRobot("a1", "team-1", "rifle", { x: 4, y: 1 });
    const target = makeRobot("r2", "team-2", "rifle", { x: 3, y: 1 });
    const state = makeMatch({ teamOneRobots: [shooter, ally], teamTwoRobots: [target] });
    const result = requireResolved(
      resolveTurn({ state, orders: missileOrders(state, shooter.id), seed: "named-missile" }),
    );
    const blastDamage = eventsOf(result.events, "damaged").filter(
      (event) => event.damageKind === "blast",
    );
    const center = blastDamage.find((event) => event.targetId === target.id);
    const friendly = blastDamage.find((event) => event.targetId === ally.id);

    expect(center).toMatchObject({ radius: 0, damageKind: "blast" });
    expect(center?.damage).toBeGreaterThanOrEqual(60);
    expect(center?.damage).toBeLessThanOrEqual(91);
    expect(friendly).toMatchObject({ radius: 1, damageKind: "blast" });
    expect(friendly?.damage).toBeGreaterThanOrEqual(40);
    expect(friendly?.damage).toBeLessThanOrEqual(55);
  });

  it("dispatches a granted grenade to category 0", () => {
    const baseShooter = makeRobot("g1", "team-1", "missile", { x: 1, y: 1 });
    const shooter: RobotState = {
      ...baseShooter,
      definition: {
        ...baseShooter.definition,
        secondaryWeapons: [...(baseShooter.definition.secondaryWeapons ?? []), "grenade-launcher"],
      },
      ammo: { ...baseShooter.ammo, "grenade-launcher": 1 },
    };
    const target = makeRobot("r2", "team-2", "rifle", { x: 3, y: 1 });
    const state = makeMatch({ teamOneRobots: [shooter], teamTwoRobots: [target] });
    const result = requireResolved(
      resolveTurn({
        state,
        seed: "named-grenade",
        orders: ordersFor(state, [
          {
            robotId: shooter.id,
            segments: [
              {
                kind: "aim-and-fire",
                target: { x: 3, y: 1 },
                weapon: "grenade-launcher",
                repeat: false,
              },
            ],
          },
        ]),
      }),
    );
    const center = eventsOf(result.events, "damaged").find(
      (event) => event.damageKind === "blast" && event.targetId === target.id,
    );

    expect(center).toMatchObject({ radius: 0, damageKind: "blast" });
    expect(center?.damage).toBeGreaterThanOrEqual(45);
    expect(center?.damage).toBeLessThanOrEqual(76);
    expect(result.nextState.teams[0]?.robots[0]?.ammo["grenade-launcher"]).toBe(0);
  });

  it("batches simultaneous missiles in canonical actor order", () => {
    const first = makeRobot("m1", "team-1", "missile", { x: 1, y: 1 });
    const second = makeRobot("m2", "team-2", "missile", { x: 3, y: 1 }, { scanHeading: "W" });
    const base = makeMatch();
    const state: MatchState = {
      ...base,
      teams: [makeTeam("team-1", 1, [first], 0), makeTeam("team-2", 2, [second], 2)],
    };
    const result = requireResolved(
      resolveTurn({
        state,
        seed: "simultaneous-missiles",
        orders: ordersFor(state, [
          {
            robotId: first.id,
            segments: [
              {
                kind: "aim-and-fire",
                target: { x: 3, y: 1 },
                weapon: "missile-launcher",
                repeat: false,
              },
            ],
          },
          {
            robotId: second.id,
            segments: [
              {
                kind: "aim-and-fire",
                target: { x: 1, y: 1 },
                weapon: "missile-launcher",
                repeat: false,
              },
            ],
          },
        ]),
      }),
    );

    expect(eventsOf(result.events, "projectile-launched").map((event) => event.shooterId)).toEqual([
      "m1",
      "m2",
    ]);
    expect(eventsOf(result.events, "damaged").map((event) => event.sourceId)).toEqual([
      "m1",
      "m1",
      "m2",
      "m2",
    ]);
  });

  it("stops repeat fire when explosive ammo reaches zero", () => {
    const shooter = makeRobot("m1", "team-1", "missile", { x: 1, y: 1 });
    const target = makeRobot("r2", "team-2", "rifle", { x: 6, y: 1 });
    const state = makeMatch({ teamOneRobots: [shooter], teamTwoRobots: [target] });
    const result = requireResolved(
      resolveTurn({
        state,
        seed: "finite-ammo",
        orders: ordersFor(state, [
          {
            robotId: shooter.id,
            segments: [
              {
                kind: "aim-and-fire",
                target: { x: 6, y: 1 },
                weapon: "missile-launcher",
                repeat: true,
              },
            ],
          },
        ]),
      }),
    );

    expect(eventsOf(result.events, "fired").map((event) => event.tick)).toEqual([30, 60, 90]);
    expect(result.nextState.teams[0]?.robots[0]?.ammo["missile-launcher"]).toBe(0);
  });

  it("rejects an explosive shot with no ammo and preserves frozen inputs", () => {
    const baseShooter = makeRobot("m1", "team-1", "missile", { x: 1, y: 1 });
    const shooter: RobotState = {
      ...baseShooter,
      ammo: { ...baseShooter.ammo, "missile-launcher": 0 },
    };
    const target = makeRobot("r2", "team-2", "rifle", { x: 3, y: 1 });
    const state = deepFreeze(makeMatch({ teamOneRobots: [shooter], teamTwoRobots: [target] }));
    const orders = deepFreeze(missileOrders(state, shooter.id));
    const beforeState = JSON.stringify(state);
    const beforeOrders = JSON.stringify(orders);
    const result = resolveTurn({ state, orders, seed: "empty-launcher" });

    expect(result).toMatchObject({ outcome: "malformed-orders", code: "illegal-command" });
    expect(JSON.stringify(state)).toBe(beforeState);
    expect(JSON.stringify(orders)).toBe(beforeOrders);
  });
});
