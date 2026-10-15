import { describe, expect, it } from "vitest";

import { makeOpenArena } from "../../engine/__fixtures__/match";
import { createSurvivalMatchState, formationRoster } from "./matchState";

const build = (formation: "beginner" | "standard") =>
  createSurvivalMatchState({
    arena: makeOpenArena(),
    formation,
    length: "battle",
    turnLengthSeconds: 15,
    teams: [
      {
        id: "a",
        name: "A",
        color: "red",
        side: 1,
        homeSlot: 0,
        roster: formationRoster(formation, "battle"),
      },
    ],
  });

describe("createSurvivalMatchState formations", () => {
  it("arms Standard with grenades, Zap and one Time Bomb on the first robot", () => {
    const state = build("standard");
    expect(state.config).toMatchObject({ rulesRevision: 3, zapArmed: true });
    expect(state.config.showEnemyPositions).toBeUndefined();
    const robots = state.teams[0]!.robots;
    expect(robots.map((robot) => robot.definition.class)).toEqual([
      "rifle",
      "rifle",
      "burst",
      "auto",
      "auto",
      "missile",
    ]);
    expect(robots.map((robot) => robot.timeBombs ?? 0)).toEqual([1, 0, 0, 0, 0, 0]);
    for (const robot of robots) {
      expect(robot.definition.secondaryWeapons).toContain("grenade-launcher");
      expect(robot.ammo["grenade-launcher"]).toBe(3);
    }
    expect(robots.at(-1)!.definition.secondaryWeapons).toEqual(["rifle", "grenade-launcher"]);
  });

  it("gives Beginner no grenades, Zap or bombs and shows enemy positions", () => {
    const state = build("beginner");
    expect(state.config).toMatchObject({ rulesRevision: 3, showEnemyPositions: true });
    expect(state.config.zapArmed).toBeUndefined();
    for (const robot of state.teams[0]!.robots) {
      expect(robot.definition.secondaryWeapons ?? []).not.toContain("grenade-launcher");
      expect(robot.ammo["grenade-launcher"]).toBe(0);
      expect(robot.timeBombs).toBeUndefined();
    }
  });
});
