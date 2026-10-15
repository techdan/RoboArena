import { TriangleAlert, Plus } from "lucide-react";
import {
  CLASS_BRIEFING,
  formatRange,
  formatSeconds,
  SQUAD_STATS,
  squadStatBars,
  type ClassStats,
} from "../../lib/help/bootCamp";
import { RobotPortrait } from "./RobotPortrait";

const BARS = squadStatBars();

const ammoLabel = (stats: ClassStats): string =>
  stats.ammo === "unlimited" ? "Unlimited" : `${stats.ammo} per match`;

/**
 * Side-by-side v1 class comparison. Every number comes from the engine
 * catalog through `lib/help/bootCamp`; bars are normalized across classes.
 * Used by Boot Camp (full) and the Field Guide Robots tab (compact).
 */
export function SquadComparison({
  variant = "full",
  headingLevel = 3,
}: {
  readonly variant?: "full" | "compact";
  readonly headingLevel?: 3 | 4;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h4";
  return (
    <div className="squad-grid" data-variant={variant}>
      {SQUAD_STATS.map((stats) => {
        const briefing = CLASS_BRIEFING[stats.robotClass];
        const bars = BARS.get(stats.robotClass) ?? [];
        return (
          <article
            key={stats.robotClass}
            className="squad-card"
            data-class={stats.robotClass}
            aria-labelledby={`squad-${variant}-${stats.robotClass}`}
          >
            <header>
              <RobotPortrait robotClass={stats.robotClass} size={variant === "full" ? 84 : 60} />
              <div>
                <Heading id={`squad-${variant}-${stats.robotClass}`}>{stats.label}</Heading>
                <p className="squad-role">{briefing.role}</p>
                <p className="squad-weapon">
                  {stats.weaponName}
                  {stats.secondaryWeaponNames.length > 0
                    ? ` + ${stats.secondaryWeaponNames.join(", ")}`
                    : ""}
                </p>
              </div>
            </header>
            <ul className="squad-bars" aria-label={`${stats.label} stats compared with the squad`}>
              {bars.map((bar) => (
                <li key={bar.id}>
                  <span className="squad-bar-label">{bar.label}</span>
                  <span className="squad-bar-track" aria-hidden="true">
                    <span style={{ width: `${Math.round(bar.fill * 100)}%` }} />
                  </span>
                  <strong>{bar.value}</strong>
                </li>
              ))}
            </ul>
            <dl className="squad-facts">
              <div>
                <dt>Per hit</dt>
                <dd>
                  {formatRange(stats.damagePerHit)}
                  {stats.kind === "explosive" ? " blast" : ""}
                </dd>
              </div>
              <div>
                <dt>Per trigger</dt>
                <dd>
                  {stats.shotsPerTrigger} {stats.kind === "explosive" ? "missile" : "bullet"}
                  {stats.shotsPerTrigger === 1 ? "" : "s"}
                </dd>
              </div>
              <div>
                <dt>Interval</dt>
                <dd>
                  {formatSeconds(stats.aimIntervalTicks)} aim ·{" "}
                  {formatSeconds(stats.scanIntervalTicks)} scan
                </dd>
              </div>
              <div>
                <dt>Range · ammo</dt>
                <dd>
                  {stats.range} tiles · {ammoLabel(stats)}
                </dd>
              </div>
            </dl>
            <div className="squad-notes">
              <ul aria-label="Best at">
                {briefing.bestAt.map((line) => (
                  <li key={line} data-tone="good">
                    <Plus size={13} aria-hidden="true" />
                    {line}
                  </li>
                ))}
              </ul>
              <ul aria-label="Watch out for">
                {briefing.watchOut.map((line) => (
                  <li key={line} data-tone="warn">
                    <TriangleAlert size={13} aria-hidden="true" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </article>
        );
      })}
    </div>
  );
}
