/** Orders must be validated independently of hidden combat and random damage. */
import { describe, expect, it } from "vitest";
import { makeMatch, makeOpenArena, makeRobot } from "../src/engine/__fixtures__/match.js";
import type { RobotCommandSegment, TurnOrders } from "../src/engine/types.js";
import { createAuthoritativeMatch, validateParticipantOrders } from "./matches.js";
import { validatePrivateTimeline } from "./orderValidation.js";

describe("private order validation", () => {
  const missile = makeRobot("m", "team-1", "missile", { x: 1, y: 1 });
  const arena = makeOpenArena(10, 8);

  it.each(["scan", "repeat"])(
    "reserves finite ammo after %s regardless of hidden targets",
    (mode) => {
      const conditional: RobotCommandSegment =
        mode === "scan"
          ? { kind: "scan-and-fire", weapon: "missile-launcher", maxDistance: 5, seconds: 1 }
          : {
              kind: "aim-and-fire",
              weapon: "missile-launcher",
              target: { x: 8, y: 1 },
              repeat: true,
            };
      const orders: TurnOrders = {
        turnNumber: 1,
        timelines: [
          {
            robotId: "m",
            segments: [
              conditional,
              {
                kind: "aim-and-fire",
                weapon: "missile-launcher",
                target: { x: 8, y: 1 },
                repeat: false,
              },
            ],
          },
        ],
      };
      for (const position of [{ x: 4, y: 1 }, { x: 7, y: 1 }, "dock"] as const) {
        const state = makeMatch({
          arena,
          teamOneRobots: [missile],
          teamTwoRobots: [makeRobot("t", "team-2", "rifle", position)],
        });
        expect(() =>
          validateParticipantOrders(
            createAuthoritativeMatch(state, ["team-1", "team-2"]),
            "team-1",
            orders,
          ),
        ).toThrow("unreserved ammunition");
      }
    },
  );

  it("checks every path step and command even beyond the current turn", () => {
    expect(
      validatePrivateTimeline(arena, 0, missile, [
        {
          kind: "move",
          posture: "upright",
          path: [{ to: { x: 2, y: 1 } }, { to: { x: 9, y: 7 } }],
        },
      ]),
    ).toContain("invalid step");
    expect(
      validatePrivateTimeline(arena, 0, missile, [
        { kind: "scan-and-fire", weapon: "rifle", maxDistance: 18, seconds: 40 },
        { kind: "deploy", to: { x: 0, y: 0 } },
      ]),
    ).toContain("docked robot");
  });

  it("accepts ordinary finite shots and rejects a fourth missile", () => {
    const shot = {
      kind: "aim-and-fire",
      weapon: "missile-launcher",
      target: { x: 8, y: 1 },
      repeat: false,
    } as const;
    expect(validatePrivateTimeline(arena, 0, missile, [shot, shot, shot])).toBeNull();
    expect(validatePrivateTimeline(arena, 0, missile, [shot, shot, shot, shot])).toContain(
      "unreserved ammunition",
    );
  });

  it("allows Zap only when armed and one bomb placement per carried bomb", () => {
    const standard = { rulesRevision: 3, zapArmed: true } as const;
    const zap: RobotCommandSegment = { kind: "zap", seconds: 5 };
    const bomb: RobotCommandSegment = { kind: "place-bomb", fuseSeconds: 3 };
    const carrier = { ...missile, timeBombs: 1 };
    expect(validatePrivateTimeline(arena, 0, missile, [zap], standard)).toBeNull();
    expect(validatePrivateTimeline(arena, 0, missile, [zap], { rulesRevision: 3 })).toContain(
      "not armed",
    );
    expect(validatePrivateTimeline(arena, 0, carrier, [bomb], standard)).toBeNull();
    expect(validatePrivateTimeline(arena, 0, carrier, [bomb, bomb], standard)).toContain(
      "no Time Bomb",
    );
    expect(validatePrivateTimeline(arena, 0, missile, [bomb], standard)).toContain("no Time Bomb");
  });

  it("allows Self Destruct only for a Team's last robot standing", () => {
    const standard = { rulesRevision: 3, zapArmed: true } as const;
    const boom: RobotCommandSegment = { kind: "self-destruct" };
    const fallen = { ...missile, id: "fallen", hp: 0 };
    const buddy = { ...missile, id: "buddy" };
    expect(
      validatePrivateTimeline(arena, 0, missile, [boom], standard, [missile, fallen]),
    ).toBeNull();
    expect(
      validatePrivateTimeline(arena, 0, missile, [boom], standard, [missile, buddy]),
    ).toContain("last robot");
    expect(
      validatePrivateTimeline(arena, 0, missile, [boom], { rulesRevision: 2 }, [missile]),
    ).toContain("last robot");
  });
});
