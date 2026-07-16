/** Survival victory and Final Ceremony rules from `docs/spec.md` §9. */

import { SURVIVAL_ROBOT_BONUS, SURVIVAL_TEAM_BONUS } from "./constants.js";
import type { TeamState } from "./types.js";

export type SurvivalOutcome =
  | { readonly status: "ongoing" }
  | { readonly status: "won"; readonly side: TeamState["side"] }
  | { readonly status: "draw" };

export const countSurvivingRobots = (team: TeamState): number =>
  team.robots.filter((robot) => robot.hp > 0).length;

/** One Team's contribution before the original aggregates by Side. */
export const survivalTeamContribution = (team: TeamState): number => {
  const survivors = countSurvivingRobots(team);
  return team.score + survivors * SURVIVAL_ROBOT_BONUS + (survivors > 0 ? SURVIVAL_TEAM_BONUS : 0);
};

/** Original Final Ceremony total shared by every Team on one Side. */
export const survivalSideScore = (teams: readonly TeamState[], side: TeamState["side"]): number =>
  teams
    .filter((team) => team.side === side)
    .reduce((total, team) => total + survivalTeamContribution(team), 0);

/** Per-Team ceremony rows; allied rows receive the same aggregated Side total. */
export const survivalCeremonyScores = (
  teams: readonly TeamState[],
): ReadonlyMap<string, number> => {
  const totalsBySide = new Map<TeamState["side"], number>();
  for (const team of teams) {
    if (!totalsBySide.has(team.side)) {
      totalsBySide.set(team.side, survivalSideScore(teams, team.side));
    }
  }
  return new Map(teams.map((team) => [team.id, totalsBySide.get(team.side) ?? 0]));
};

/** A shared side remains alive while any allied team has a surviving robot. */
export const resolveSurvivalOutcome = (teams: readonly TeamState[]): SurvivalOutcome => {
  const livingSides = new Set(
    teams.filter((team) => countSurvivingRobots(team) > 0).map((team) => team.side),
  );
  if (livingSides.size > 1) return { status: "ongoing" };
  const [side] = livingSides;
  return side === undefined ? { status: "draw" } : { status: "won", side };
};
