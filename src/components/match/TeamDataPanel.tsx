import type { MatchState } from "../../engine/types";

/** What this participant is allowed to know about each team, one quiet line each. */
export function TeamDataPanel({
  match,
  selfPlayerId,
}: {
  readonly match: MatchState;
  readonly selfPlayerId: string;
}) {
  return (
    <dl className="site-known" aria-label="Known team status">
      {match.teams.map((team) => {
        const own = team.id === selfPlayerId;
        const alive = team.robots.filter((robot) => robot.hp > 0).length;
        const hp = team.robots.reduce((total, robot) => total + robot.hp, 0);
        return (
          <div key={team.id} data-team={team.color}>
            <dt>
              <span className="site-lamp" aria-hidden="true" />
              {team.name}
              {own ? " (you)" : ""}
            </dt>
            <dd>
              {own
                ? `${alive} robot${alive === 1 ? "" : "s"} · ${hp} HP`
                : `${team.robots.length} visible contact${team.robots.length === 1 ? "" : "s"}`}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
