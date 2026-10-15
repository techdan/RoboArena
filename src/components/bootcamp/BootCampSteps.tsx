import {
  Bomb,
  Clapperboard,
  Crosshair,
  LockKeyhole,
  PenLine,
  Radar,
  ShieldHalf,
  TriangleAlert,
  Zap,
} from "lucide-react";
import type { CSSProperties } from "react";
import {
  POSTURE_CHANGE_COST_TICKS,
  SCAN_DIRECTION_COST_TICKS,
  SURVIVAL_ROBOT_BONUS,
  SURVIVAL_TEAM_BONUS,
  TURN_DURATION_TICKS_DEFAULT,
  WEAPON_MAX_RANGE,
} from "../../engine/constants";
import { canTraverse, isFullSpeedTerrain } from "../../engine/traversal";
import type { Terrain } from "../../engine/types";
import { hitChanceBand } from "../../planner/firingHelpers";
import { TARGETING_PALETTE } from "../../planner/targetingPalette";
import { TERRAIN_ASSETS } from "../../renderer/assets";
import {
  bulletDistanceBands,
  CLASS_LABEL,
  COVER_EXAMPLE,
  COVER_SPOTS,
  coverClassFor,
  coverClassEffects,
  coverMatrix,
  exampleOpeningProgram,
  fireModeComparison,
  formatRange,
  formatSeconds,
  LENGTH_ROSTERS,
  missileBlastRings,
  POSTURE_LABEL,
  POSTURES,
  SQUAD_STATS,
  ticksToSeconds,
} from "../../lib/help/bootCamp";
import { FORMATION_HELP, helpTopic, TERRAIN_HELP } from "../../lib/help/content";
import { RobotPortrait } from "../help/RobotPortrait";
import { SquadComparison } from "../help/SquadComparison";

// ──────────────────────────────────────────────────────────────────────────
// Shared bits

function ChanceChip({ percent }: { readonly percent: number }) {
  const band = hitChanceBand(percent);
  const style: CSSProperties = { background: TARGETING_PALETTE[band].css };
  return (
    <span className="chance-chip" data-band={band} style={style}>
      {percent}%
    </span>
  );
}

const signed = (value: number): string => (value > 0 ? `+${value}` : `${value}`);

// ──────────────────────────────────────────────────────────────────────────
// Step 1 — how a turn works

const PHASES = [
  {
    icon: PenLine,
    title: "Program privately",
    body: "Pick each robot and line up moves, posture, scan direction, and fire orders on its timeline. Nobody else can see your plan.",
  },
  {
    icon: LockKeyhole,
    title: "Lock orders",
    body: "When you're happy, lock. Opponents only see that you're ready, never what you planned.",
  },
  {
    icon: Clapperboard,
    title: "Watch the movie",
    body: "Once everyone locks, every robot's orders play out at the same moment as one short movie of that turn.",
  },
] as const;

export function TurnStep() {
  const program = exampleOpeningProgram();
  const total = TURN_DURATION_TICKS_DEFAULT;
  return (
    <div className="bc-stack">
      <ol className="bc-phases">
        {PHASES.map(({ icon: Icon, title, body }, index) => (
          <li key={title}>
            <span className="bc-phase-index">{index + 1}</span>
            <Icon className="bc-phase-icon" aria-hidden="true" />
            <h3>{title}</h3>
            <p>{body}</p>
          </li>
        ))}
      </ol>

      <section className="bc-panel" aria-labelledby="bc-turn-clock">
        <div className="bc-panel-head">
          <h3 id="bc-turn-clock">Every order costs time</h3>
          <p>
            A turn is {formatSeconds(total)} of game time. Orders run left to right; anything past
            the end waits in your draft for next turn.
          </p>
        </div>
        <div className="bc-program" role="list" aria-label="Example opening program">
          {program.map((segment) => (
            <div
              key={segment.id}
              role="listitem"
              className="bc-program-segment"
              data-tone={segment.tone}
              style={{ flexGrow: segment.ticks, flexBasis: 0 }}
              aria-label={`${segment.label}, ${formatSeconds(segment.ticks)}`}
            >
              <strong>{segment.label}</strong>
              <span>{formatSeconds(segment.ticks)}</span>
            </div>
          ))}
        </div>
        <div className="bc-program-scale" aria-hidden="true">
          <span>0s</span>
          <span>{formatSeconds(total / 2)}</span>
          <span>{formatSeconds(total)}</span>
        </div>
        <ul className="bc-program-legend" aria-hidden="true">
          {program.map((segment) => (
            <li key={segment.id}>
              <i data-tone={segment.tone} />
              {segment.label} <b>{formatSeconds(segment.ticks)}</b>
            </li>
          ))}
        </ul>
        <p className="bc-footnote">
          Example opening. Turning costs only {formatSeconds(SCAN_DIRECTION_COST_TICKS)} per eighth
          of a turn and a posture change {formatSeconds(POSTURE_CHANGE_COST_TICKS)} per level, so
          cheap set-up orders leave most of the turn for an ambush.
        </p>
      </section>

      <p className="bc-callout">
        <strong>How you win:</strong> Survival — be the last team with a robot standing. At the
        Final Ceremony each survivor adds {SURVIVAL_ROBOT_BONUS} points and any surviving team adds{" "}
        {SURVIVAL_TEAM_BONUS}.
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Step 2 — squad

export function SquadStep() {
  return (
    <div className="bc-stack">
      <SquadComparison variant="full" />
      <section className="bc-rosters" aria-labelledby="bc-rosters-title">
        <h3 id="bc-rosters-title">You don&apos;t pick classes — the game length does</h3>
        <ul>
          {LENGTH_ROSTERS.map((roster) => (
            <li key={roster.length}>
              <div>
                <strong>{roster.label}</strong>
                <span>
                  {roster.robots} robots · {roster.arena.width}×{roster.arena.height} arena
                </span>
              </div>
              <ul className="bc-roster-slots" aria-label={`${roster.label} roster`}>
                {roster.slots.map((slot) => (
                  <li key={slot.robotClass}>
                    <RobotPortrait robotClass={slot.robotClass} size={34} />
                    <span>
                      {slot.count}× {CLASS_LABEL[slot.robotClass as keyof typeof CLASS_LABEL]}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <p className="bc-footnote">
          The host picks the game length in room setup. Bars compare the four classes; peak output
          assumes every shot hits.
        </p>
      </section>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Step 3 — weapons and damage

const FIRE_COMPARE_DISTANCE = 8;
const FIRE_COMPARE_COVER = coverClassFor("ducking", "low-wall");

export function WeaponsStep() {
  const rings = missileBlastRings();
  const bands = bulletDistanceBands();
  const effects = coverClassEffects();
  const modes = fireModeComparison(FIRE_COMPARE_DISTANCE, FIRE_COMPARE_COVER);
  const missile = SQUAD_STATS.find((entry) => entry.kind === "explosive");
  const outerRadius = rings.at(-1)?.radius ?? 0;
  return (
    <div className="bc-two-col">
      <div className="bc-stack">
        <section className="bc-panel" aria-labelledby="bc-bullets">
          <div className="bc-panel-head">
            <h3 id="bc-bullets">
              <Crosshair aria-hidden="true" /> Bullets roll twice
            </h3>
            <p>
              Each bullet rolls to <em>hit</em>, then rolls <em>damage</em>. Every gun reaches{" "}
              {WEAPON_MAX_RANGE} tiles, but range changes damage per bullet:
            </p>
          </div>
          <ul className="bc-bands">
            {bands.map((band) => (
              <li key={band.from} data-sign={Math.sign(band.adjustment)}>
                <strong>{signed(band.adjustment)}</strong>
                <span>{band.from === band.to ? band.from : `${band.from}–${band.to}`} tiles</span>
              </li>
            ))}
          </ul>
          <p className="bc-footnote">
            Bullets pass through friendly robots harmlessly — only blasts cause friendly fire.
          </p>
        </section>

        <section className="bc-panel" aria-labelledby="bc-modes">
          <div className="bc-panel-head">
            <h3 id="bc-modes">
              <Radar aria-hidden="true" /> Aim & Fire vs Scan & Fire
            </h3>
            <p>
              <strong>Aim</strong> fires at a tile the moment its command starts; if nobody is
              there, the shot is wasted. <strong>Scan</strong> waits and fires at the nearest enemy
              that enters your scan arc, and a shorter Maximum Distance aims better. Chance to hit a
              ducking robot behind a low wall, {FIRE_COMPARE_DISTANCE} tiles away (Scan with its
              Maximum Distance set to {FIRE_COMPARE_DISTANCE}):
            </p>
          </div>
          <table className="bc-table">
            <thead>
              <tr>
                <th scope="col">Shooter</th>
                <th scope="col">Aim</th>
                <th scope="col">Scan</th>
              </tr>
            </thead>
            <tbody>
              {modes.map((row) => (
                <tr key={row.robotClass}>
                  <th scope="row">
                    {CLASS_LABEL[row.robotClass]}
                    {row.robotClass === "missile" ? <small> (rifle)</small> : null}
                  </th>
                  <td>
                    <ChanceChip percent={row.aim} />
                  </td>
                  <td>
                    <ChanceChip percent={row.scan} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="bc-panel" aria-labelledby="bc-formations">
          <div className="bc-panel-head">
            <h3 id="bc-formations">
              <Zap aria-hidden="true" /> Formations and extra tools
            </h3>
            <p>
              {FORMATION_HELP.map((topic) => `${topic.title}: ${topic.summary}`).join(" ")} The host
              picks the formation in room setup.
            </p>
          </div>
          <ul className="bc-bands bc-extras">
            {(["action:zap", "action:place-bomb"] as const).map((id) => {
              const topic = helpTopic(id);
              return (
                <li key={id}>
                  <strong>{topic.title}</strong>
                  <span>
                    {topic.summary}{" "}
                    {topic.facts.map((fact) => `${fact.label}: ${fact.value}.`).join(" ")}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <div className="bc-stack">
        <section className="bc-panel" aria-labelledby="bc-blast">
          <div className="bc-panel-head">
            <h3 id="bc-blast">
              <Bomb aria-hidden="true" /> Missiles blast an area
            </h3>
            <p>
              No hit roll: a missile always explodes on the aimed tile if it is in range, inside
              your scan arc, and not behind a wall. Damage falls off with distance from the blast.
            </p>
          </div>
          <div className="bc-blast">
            <svg viewBox="0 0 120 120" aria-hidden="true">
              {[...rings].reverse().map((ring) => {
                const r = ((ring.radius + 0.5) / (outerRadius + 0.5)) * 56;
                return (
                  <circle
                    key={ring.radius}
                    cx="60"
                    cy="60"
                    r={r}
                    className="bc-blast-ring"
                    data-radius={ring.radius}
                  />
                );
              })}
              <circle cx="60" cy="60" r="3" className="bc-blast-core" />
            </svg>
            <ul>
              {rings.map((ring) => (
                <li key={ring.radius} data-radius={ring.radius}>
                  <span>
                    {ring.radius === 0
                      ? "Direct hit"
                      : `${ring.radius} tile${ring.radius === 1 ? "" : "s"} away`}
                  </span>
                  <strong>{formatRange(ring.damage)}</strong>
                </li>
              ))}
              <li data-radius="none">
                <span>{outerRadius + 1}+ tiles</span>
                <strong>0</strong>
              </li>
            </ul>
          </div>
          <p className="bc-warning">
            <TriangleAlert aria-hidden="true" />
            <span>
              Blasts hit <em>every</em> robot in range — yours too, even the shooter. Only{" "}
              {String(missile?.ammo ?? 0)} missiles per match, and they never refill.
            </span>
          </p>
        </section>

        <section className="bc-panel" aria-labelledby="bc-cover-class">
          <div className="bc-panel-head">
            <h3 id="bc-cover-class">
              <ShieldHalf aria-hidden="true" /> What cover does
            </h3>
            <p>Cover is judged at the target, from the shooter&apos;s direction.</p>
          </div>
          <table className="bc-table">
            <thead>
              <tr>
                <th scope="col">Target is…</th>
                <th scope="col">Bullet damage</th>
                <th scope="col">Blast damage</th>
              </tr>
            </thead>
            <tbody>
              {effects.map((effect) => (
                <tr key={effect.coverClass}>
                  <th scope="row">{COVER_NAME[effect.coverClass]}</th>
                  <td>
                    {effect.bulletDamageAdjust === 0 ? "±0" : signed(effect.bulletDamageAdjust)}
                  </td>
                  <td>{Math.round(effect.blastFraction * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="bc-footnote">Better cover also lowers the chance to be hit at all.</p>
        </section>
      </div>
    </div>
  );
}

const COVER_NAME: Readonly<Record<1 | 2 | 3 | 4, string>> = {
  4: "Exposed",
  3: "Light cover",
  2: "Good cover",
  1: "Heavy cover",
};

// ──────────────────────────────────────────────────────────────────────────
// Step 4 — terrain and posture

const POSTURE_COPY = {
  upright: "Full speed over any passable ground. Easiest to hit.",
  ducking: "Same movement as upright, but bushes and low walls protect you better.",
  crouching: "Hardest to hit, but can only move on open ground.",
} as const;

const TERRAIN_ORDER = [
  "open",
  "rough",
  "bush",
  "low-wall",
  "crevice",
  "wall",
] as const satisfies readonly Terrain[];

/** Plain-language one-liners; traversal chips below come from engine/traversal. */
const TERRAIN_BLURB: Readonly<Record<(typeof TERRAIN_ORDER)[number], string>> = {
  open: "Fastest ground — the only place you can take 2-tile strides.",
  rough: "Slows you to one tile per step. No extra cover.",
  bush: "Slow, but hides you — best while ducking.",
  "low-wall": "Slow to cross. Best cover when it's between you and the shooter.",
  crevice: "Can't be crossed, but shots fly over it.",
  wall: "Blocks movement and line of sight completely.",
};

export function TerrainStep() {
  const matrix = coverMatrix();
  return (
    <div className="bc-stack">
      <div className="bc-two-col bc-two-col-wide-right">
        <ul className="bc-postures" aria-label="Postures">
          {POSTURES.map((posture) => (
            <li key={posture}>
              <RobotPortrait robotClass="rifle" posture={posture} size={64} />
              <div>
                <h3>{POSTURE_LABEL[posture]}</h3>
                <p>{POSTURE_COPY[posture]}</p>
              </div>
            </li>
          ))}
        </ul>

        <section className="bc-panel" aria-labelledby="bc-cover-matrix">
          <div className="bc-panel-head">
            <h3 id="bc-cover-matrix">Posture × cover: chance a Rifle hits you</h3>
            <p>
              Rifle Aim & Fire. Each cell shows the chance from <em>{COVER_EXAMPLE.near} tiles</em>{" "}
              then from <em>{COVER_EXAMPLE.far} tiles</em>. Low walls protect you when they sit
              between you and the shooter.
            </p>
          </div>
          <table className="bc-table bc-matrix">
            <thead>
              <tr>
                <th scope="col">Posture</th>
                {COVER_SPOTS.map((spot) => (
                  <th key={spot.id} scope="col">
                    {spot.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={row.posture}>
                  <th scope="row">{POSTURE_LABEL[row.posture]}</th>
                  {row.cells.map((cell) => (
                    <td key={cell.spot}>
                      <span className="bc-pair">
                        <ChanceChip percent={cell.nearChance} />
                        <ChanceChip percent={cell.farChance} />
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="bc-footnote">
            Crouching can&apos;t walk into bushes or low walls — crouch on open ground right behind
            them. Each posture level costs {formatSeconds(POSTURE_CHANGE_COST_TICKS)}; Upright to
            Crouching goes through Ducking, so it costs twice that.
          </p>
        </section>
      </div>

      <ul className="bc-terrain" aria-label="Terrain types">
        {TERRAIN_ORDER.map((terrain) => {
          const topic = TERRAIN_HELP.find((entry) => entry.id === `terrain:${terrain}`);
          const blurb = TERRAIN_BLURB[terrain];
          return (
            <li key={terrain}>
              <img src={TERRAIN_ASSETS[terrain]} alt="" width={44} height={44} />
              <div>
                <h3>{topic?.title ?? terrain}</h3>
                <p>{blurb}</p>
                <div className="bc-traverse">
                  {POSTURES.map((posture) => {
                    const ok = canTraverse(posture, terrain);
                    return (
                      <span key={posture} data-ok={ok}>
                        {POSTURE_LABEL[posture]} {ok ? "✓" : "✕"}
                      </span>
                    );
                  })}
                  {isFullSpeedTerrain(terrain) ? <span data-ok="fast">2-tile moves</span> : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Step 5 — first turn checklist

export interface ChecklistItem {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

export const firstTurnChecklist = (): readonly ChecklistItem[] => {
  const missile = SQUAD_STATS.find((entry) => entry.kind === "explosive");
  const turnSeconds = ticksToSeconds(TURN_DURATION_TICKS_DEFAULT);
  return [
    {
      id: "cover",
      title: "Deploy toward cover",
      body: "Move each robot next to a low wall or bush, then duck — or crouch on open ground behind the wall.",
    },
    {
      id: "scan",
      title: "Face the enemy",
      body: `Set scan direction toward where enemies will come from. You can only shoot inside that half-circle, and turning costs ${formatSeconds(SCAN_DIRECTION_COST_TICKS)} per eighth of a turn.`,
    },
    {
      id: "ambush",
      title: "Ambush with Scan & Fire",
      body: "End each robot's program with Scan & Fire so it shoots anything that walks into view — Rifles are the best ambushers.",
    },
    {
      id: "missiles",
      title: "Save missiles for clusters",
      body: `You only get ${String(missile?.ammo ?? 0)}. Fire one where two or more enemies stand close, and keep your own robots out of the blast.`,
    },
    {
      id: "clock",
      title: `Fit it in ${turnSeconds} seconds`,
      body: "Watch the timeline: orders past the end don't run this turn. Lock when every robot has a plan.",
    },
  ];
};
