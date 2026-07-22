import { Home, Trophy } from "lucide-react";
import Link from "next/link";
import { ceremonyPresentation, type AuthorizedTeamSummary } from "../../lib/presentation/matchFlow";

export function FinalCeremony({
  teams,
  scores,
  outcome,
  winningSide,
}: {
  readonly teams: readonly AuthorizedTeamSummary[];
  readonly scores: readonly { readonly teamId: string; readonly score: number }[];
  readonly outcome?: "won" | "draw";
  readonly winningSide?: 1 | 2 | 3 | 4;
}) {
  const presentation = ceremonyPresentation({
    teams,
    scores,
    ...(outcome === undefined ? {} : { outcome }),
    ...(winningSide === undefined ? {} : { winningSide }),
  });
  return (
    <section className="final-ceremony" aria-labelledby="final-ceremony-heading">
      <Trophy size={34} aria-hidden="true" />
      <p className="eyebrow">Final Ceremony</p>
      <h1 id="final-ceremony-heading">{presentation.heading}</h1>
      {presentation.winningTeam === undefined ? null : (
        <div className="ceremony-winner-identity">
          <span
            className={`team-swatch team-swatch-${presentation.winningTeam.color}`}
            aria-hidden="true"
          />
          <strong>{presentation.winningTeam.name}</strong>
          <span>Winning Team</span>
        </div>
      )}
      <p className="ceremony-summary">{presentation.summary}</p>
      {presentation.kind === "complete" ? null : (
        <>
          <h2>Final Team scores</h2>
          <ol aria-label="Final Team scores">
            {presentation.rows.map((team) => (
              <li key={team.id}>
                <span className="ceremony-team-identity">
                  <span className={`team-swatch team-swatch-${team.color}`} aria-hidden="true" />
                  <span>
                    <strong>{team.name}</strong>
                    <small>Team · Side {team.side}</small>
                  </span>
                </span>
                <strong aria-label={`${team.name} score ${team.score}`}>{team.score}</strong>
              </li>
            ))}
          </ol>
        </>
      )}
      <p className="match-privacy-note">
        The room service retained and verified the canonical replay. Private opponent orders are not
        included in participant downloads.
      </p>
      <div className="match-flow-actions final-ceremony-actions">
        <Link href="/" className="primary-action">
          <Home size={16} aria-hidden="true" /> Return home
        </Link>
      </div>
    </section>
  );
}
