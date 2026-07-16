import { describe, expect, it } from "vitest";

import { makeRobot } from "./__fixtures__/match.js";
import {
  resolveSurvivalOutcome,
  survivalCeremonyScores,
  survivalSideScore,
  survivalTeamContribution,
} from "./survival.js";
import type { TeamState } from "./types.js";

const team = (
  id: string,
  side: TeamState["side"],
  hitPoints: readonly number[],
  score = 0,
  homeSlot: TeamState["homeSlot"] = 0,
): TeamState => ({
  id,
  name: id,
  color: id,
  side,
  homeSlot,
  brain: "human",
  score,
  robots: hitPoints.map((hp, index) =>
    makeRobot(`${id}-${index}`, id, "rifle", hp > 0 ? { x: index, y: 0 } : "dock", { hp }),
  ),
});

describe("Survival completion and ceremony", () => {
  it("adds base score, 150 per survivor, and 400 for a surviving team", () => {
    expect(survivalTeamContribution(team("a", 1, [140, 1, 0], 25))).toBe(725);
    expect(survivalTeamContribution(team("b", 2, [0, 0], 25))).toBe(25);
  });

  it("aggregates allied Team contributions into one Side total for every ceremony row", () => {
    const teams = [
      team("a1", 1, [140, 0], 25, 0),
      team("a2", 1, [140, 140], 50, 1),
      team("b1", 2, [140], 0, 2),
      team("b2", 2, [0], 30, 3),
    ];
    expect(survivalSideScore(teams, 1)).toBe(1_325);
    expect(Object.fromEntries(survivalCeremonyScores(teams))).toEqual({
      a1: 1_325,
      a2: 1_325,
      b1: 580,
      b2: 580,
    });
  });

  it("treats teams sharing a side as allies", () => {
    expect(resolveSurvivalOutcome([team("a", 1, [1]), team("b", 1, [1])])).toEqual({
      status: "won",
      side: 1,
    });
    expect(resolveSurvivalOutcome([team("a", 1, [1]), team("b", 2, [1])])).toEqual({
      status: "ongoing",
    });
    expect(resolveSurvivalOutcome([team("a", 1, [0]), team("b", 2, [0])])).toEqual({
      status: "draw",
    });
  });

  it("resolves four-Team free-for-all and 2v2 matches by living Sides", () => {
    expect(
      resolveSurvivalOutcome([
        team("a1", 1, [1], 0, 0),
        team("a2", 1, [0], 0, 1),
        team("b1", 2, [0], 0, 2),
        team("b2", 2, [0], 0, 3),
      ]),
    ).toEqual({ status: "won", side: 1 });
    expect(
      resolveSurvivalOutcome([
        team("a", 1, [0], 0, 0),
        team("b", 2, [0], 0, 1),
        team("c", 3, [1], 0, 2),
        team("d", 4, [0], 0, 3),
      ]),
    ).toEqual({ status: "won", side: 3 });
  });
});
