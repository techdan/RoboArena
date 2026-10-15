import { Check, Clock3 } from "lucide-react";
import type { MatchState } from "../../engine/types";

export function ReadyPanel({
  match,
  lockedPlayerIds,
  requiredPlayerIds,
}: {
  readonly match: MatchState;
  readonly lockedPlayerIds: readonly string[];
  readonly requiredPlayerIds: readonly string[];
}) {
  const locked = new Set(lockedPlayerIds);
  const required = new Set(requiredPlayerIds);
  return (
    <section className="match-panel">
      <p className="eyebrow">Turn {match.turnNumber} readiness</p>
      <h2>Waiting for {requiredPlayerIds.filter((id) => !locked.has(id)).length}</h2>
      <ul className="ready-list">
        {match.teams.map((team) => (
          <li key={team.id}>
            <span
              className="team-color-dot"
              style={{ backgroundColor: team.color }}
              aria-hidden="true"
            />
            <span>{team.name}</span>
            <span data-ready={!required.has(team.id) || locked.has(team.id)}>
              {!required.has(team.id) || locked.has(team.id) ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <Clock3 size={14} aria-hidden="true" />
              )}
              {!required.has(team.id)
                ? "Not required"
                : locked.has(team.id)
                  ? "Locked"
                  : "Planning"}
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
