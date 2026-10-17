import { Home } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ceremonyPresentation, type AuthorizedTeamSummary } from "../../lib/presentation/matchFlow";

/**
 * The results screen: the winning team owns the headline and lights the
 * backdrop in its colour, then every team is ranked by its canonical score.
 */
export function FinalCeremony({
  teams,
  scores,
  outcome,
  winningSide,
  selfTeamId,
  children,
}: {
  readonly teams: readonly AuthorizedTeamSummary[];
  readonly scores: readonly { readonly teamId: string; readonly score: number }[];
  readonly outcome?: "won" | "draw";
  readonly winningSide?: 1 | 2 | 3 | 4;
  readonly selfTeamId?: string;
  /** Extra actions beside Return home, such as the rewatch reel. */
  readonly children?: ReactNode;
}) {
  const presentation = ceremonyPresentation({
    teams,
    scores,
    ...(outcome === undefined ? {} : { outcome }),
    ...(winningSide === undefined ? {} : { winningSide }),
  });
  const ranked = [...presentation.rows].sort((a, b) => b.score - a.score);
  const best = Math.max(1, ...ranked.map((team) => team.score));
  const winner = presentation.winningTeam;
  return (
    <section
      className="site-ceremony"
      aria-labelledby="final-ceremony-heading"
      {...(winner === undefined ? {} : { "data-team": winner.color })}
    >
      <div className="site-hero site-ceremony-backdrop" aria-hidden="true">
        <div className="site-hero-image" />
      </div>
      <div className="site-ceremony-body">
        <p className="site-label" data-tone="flood">
          Final Ceremony
        </p>
        <h1 id="final-ceremony-heading" className="site-display site-ceremony-title">
          {presentation.heading}
        </h1>
        {winner === undefined ? (
          <p className="site-ceremony-summary">{presentation.summary}</p>
        ) : (
          <span className="site-pill site-ceremony-winner" data-team={winner.color}>
            <span className="site-lamp" aria-hidden="true" />
            {presentation.summary}
          </span>
        )}
        {presentation.kind === "complete" ? null : (
          <ol className="site-scoreboard" aria-label="Final team scores">
            {ranked.map((team, index) => (
              <li
                key={team.id}
                data-team={team.color}
                data-first={winner?.id === team.id ? "true" : "false"}
              >
                <span className="site-scoreboard-rank" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="site-scoreboard-team">
                  <span className="site-lamp" aria-hidden="true" />
                  <strong>{team.name}</strong>
                  <small>
                    Team · Side {team.side}
                    {team.id === selfTeamId ? " · you" : ""}
                  </small>
                </span>
                <span className="site-scoreboard-bar" aria-hidden="true">
                  <span
                    style={{ width: `${Math.round((Math.max(0, team.score) / best) * 100)}%` }}
                  />
                </span>
                <strong
                  className="site-scoreboard-score"
                  aria-label={`${team.name} score ${team.score}`}
                >
                  {team.score.toLocaleString("en-US")}
                </strong>
              </li>
            ))}
          </ol>
        )}
        <div className="site-ceremony-actions">
          {children}
          <Link href="/" className="site-button" data-variant="go" data-size="lg">
            <Home size={16} aria-hidden="true" /> Return home
          </Link>
        </div>
        <p className="site-fine">
          The server kept and verified the full replay. Downloads never include other players’
          private orders.
        </p>
      </div>
    </section>
  );
}
