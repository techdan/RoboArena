import { Eye, Shield } from "lucide-react";
import type { MatchState } from "../../engine/types";

export function TeamDataPanel({
  match,
  selfPlayerId,
}: {
  readonly match: MatchState;
  readonly selfPlayerId: string;
}) {
  return (
    <section className="match-panel team-data-panel">
      <p className="eyebrow">Authorized Team Data</p>
      <h2>Known status</h2>
      {match.teams.map((team) => {
        const own = team.id === selfPlayerId;
        return (
          <div className="team-data-row" key={team.id}>
            <div>
              {own ? <Shield size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
              <strong>{team.name}</strong>
            </div>
            <span>
              {own
                ? `${team.robots.filter((robot) => robot.hp > 0).length} robots · ${team.robots.reduce((total, robot) => total + robot.hp, 0)} HP`
                : `${team.robots.length} visible contact${team.robots.length === 1 ? "" : "s"}`}
            </span>
          </div>
        );
      })}
    </section>
  );
}
