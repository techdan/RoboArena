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
});
