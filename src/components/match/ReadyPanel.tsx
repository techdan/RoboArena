import { Check, Clock3 } from "lucide-react";
import type { MatchState } from "../../engine/types";

export function ReadyPanel({
  match,
  lockedPlayerIds,
}: {
  readonly match: MatchState;
  readonly lockedPlayerIds: readonly string[];
}) {
  const locked = new Set(lockedPlayerIds);
  return (
    <section className="match-panel">
      <p className="eyebrow">Turn {match.turnNumber} readiness</p>
      <h2>Waiting for {match.teams.length - locked.size}</h2>
      <ul className="ready-list">
        {match.teams.map((team) => (
          <li key={team.id}>
            <span className="team-color-dot" style={{ backgroundColor: team.color }} />
            <span>{team.name}</span>
            <span data-ready={locked.has(team.id)}>
              {locked.has(team.id) ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <Clock3 size={14} aria-hidden="true" />
              )}
              {locked.has(team.id) ? "Locked" : "Planning"}
            </span>
          </li>
        ))}
      </ul>
      <p className="match-privacy-note">
        Only ready/not-ready status is shared. Orders remain private.
      </p>
    </section>
  );
}
