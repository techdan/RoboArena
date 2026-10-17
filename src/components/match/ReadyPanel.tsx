import type { MatchState } from "../../engine/types";

/**
 * One status light per team for the current turn. Only locked / planning is
 * shared; orders stay private.
 */
export function ReadyPanel({
  match,
  lockedPlayerIds,
  requiredPlayerIds,
  selfPlayerId,
}: {
  readonly match: MatchState;
  readonly lockedPlayerIds: readonly string[];
  readonly requiredPlayerIds: readonly string[];
  readonly selfPlayerId: string;
}) {
  const locked = new Set(lockedPlayerIds);
  const required = new Set(requiredPlayerIds);
  return (
    <ul className="site-lights" aria-label={`Turn ${match.turnNumber} readiness`}>
      {match.teams.map((team) => {
        const state = !required.has(team.id) ? "out" : locked.has(team.id) ? "locked" : "planning";
        return (
          <li key={team.id} className="site-light" data-team={team.color} data-state={state}>
            <span className="site-light-lamp" aria-hidden="true" />
            <strong>
              <span className="site-lamp" aria-hidden="true" />
              {team.name}
            </strong>
            <span>
              {state === "out" ? "Not required" : state === "locked" ? "Locked" : "Planning…"}
              {team.id === selfPlayerId ? " · you" : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
