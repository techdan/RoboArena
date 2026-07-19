"use client";

import { Crosshair, Pin, PinOff, Radar, ShieldX } from "lucide-react";
import type { CSSProperties } from "react";
import type { Posture, WeaponId } from "../../engine/types";
import { WEAPON_CATALOG_DATA } from "../../engine/catalogData";
import { formatGameTime } from "../../lib/formatTime";
import {
  WEAPON_LABELS,
  type HitChanceBand,
  type TargetingTilePreview,
} from "../../planner/firingHelpers";
import { TARGETING_PALETTE, type TargetingCategory } from "../../planner/targetingPalette";
import styles from "./TargetingAnalysis.module.css";

/** Legend/indicator swatch backgrounds derived from the shared palette. */
export const targetingSwatchStyle = (category: TargetingCategory): CSSProperties => {
  const { css, pattern } = TARGETING_PALETTE[category];
  if (pattern === "hatch")
    return { background: `repeating-linear-gradient(135deg, ${css} 0 3px, #0b0b0b 3px 6px)` };
  if (pattern === "reverse-hatch")
    return { background: `repeating-linear-gradient(45deg, ${css} 0 3px, #0b0b0b 3px 6px)` };
  return { background: css };
};

const POSTURES: readonly Posture[] = ["upright", "ducking", "crouching"];

const BAND_LABELS: Readonly<Record<HitChanceBand, string>> = {
  excellent: "Excellent · 75–94%",
  good: "Good · 50–74%",
  risky: "Risky · 25–49%",
  poor: "Poor · 1–24%",
  zero: "No chance · 0%",
};

const STATUS_LABELS: Readonly<Record<TargetingTilePreview["status"], string>> = {
  eligible: "Eligible",
  "shooter-docked": "Deploy the robot before firing",
  "out-of-range": "Outside selected range",
  "angle-blocked": "Behind the firing arc",
  "sight-blocked": "Line of sight blocked",
};

const coverLabel = (coverClass: 1 | 2 | 3 | 4): string =>
  ({ 1: "Strong cover", 2: "Good cover", 3: "Partial cover", 4: "Exposed" })[coverClass];

const scanClarityLabel = (strength: number): string => {
  if (strength > 8) return "Clear";
  if (strength > 4) return "Obscured";
  if (strength > 0) return "Weak";
  return "Blocked";
};

const signed = (value: number): string => (value >= 0 ? `+${value}` : `−${Math.abs(value)}`);

export interface TargetingAnalysisProps {
  readonly mode: "aim" | "scan";
  readonly weapon: WeaponId;
  readonly maxDistance: number;
  readonly seconds: number | null;
  readonly opportunityTicks: number;
  readonly assumedPosture: Posture;
  readonly preview: TargetingTilePreview | null;
  readonly pinned: boolean;
  readonly onAssumedPosture: (posture: Posture) => void;
  readonly onTogglePinned: () => void;
}

export function TargetingAnalysis({
  mode,
  weapon,
  maxDistance,
  seconds,
  opportunityTicks,
  assumedPosture,
  preview,
  pinned,
  onAssumedPosture,
  onTogglePinned,
}: TargetingAnalysisProps) {
  const weaponDefinition = WEAPON_CATALOG_DATA[weapon];
  const estimate = preview?.estimates[0] ?? null;
  const observedContact = preview?.authorizedContact ?? null;
  const timing =
    mode === "scan"
      ? `Checks now, then every ${formatGameTime(opportunityTicks)}${seconds === null ? "" : ` for ${seconds}s`}`
      : `Fixed-tile shot · fires in ${formatGameTime(opportunityTicks)}`;

  return (
    <section
      className={styles.panel}
      aria-labelledby="targeting-analysis-title"
      data-targeting-analysis="true"
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>
            {mode === "aim" ? "Fixed tile" : "Automatic acquisition"}
          </p>
          <h3 id="targeting-analysis-title">
            {mode === "aim" ? (
              <Crosshair size={17} aria-hidden="true" />
            ) : (
              <Radar size={17} aria-hidden="true" />
            )}
            {WEAPON_LABELS[weapon]} Shot Analysis
          </h3>
          <p className={styles.modeSummary}>
            {timing} · {maxDistance}-tile limit
          </p>
        </div>
        <button
          type="button"
          className={styles.pinButton}
          disabled={preview === null}
          aria-pressed={pinned}
          onClick={onTogglePinned}
        >
          {pinned ? <PinOff size={15} aria-hidden="true" /> : <Pin size={15} aria-hidden="true" />}
          {pinned ? "Use Hover" : "Pin Tile"}
        </button>
      </header>

      <div className={styles.controlsAndLegend}>
        <fieldset className={styles.postureFieldset}>
          <legend>Assume target posture</legend>
          <div className={styles.postureButtons}>
            {POSTURES.map((posture) => (
              <button
                type="button"
                key={posture}
                aria-pressed={posture === assumedPosture}
                onClick={() => onAssumedPosture(posture)}
              >
                {posture}
              </button>
            ))}
          </div>
          <small>Visible contacts use their observed posture instead.</small>
        </fieldset>

        {weaponDefinition.damageRoll === undefined ? (
          <div className={styles.blastLegend}>
            <strong>Explosive coverage</strong>
            <span>Impact and blast damage replace the hit-chance heatmap.</span>
          </div>
        ) : (
          <div className={styles.legend} aria-label="Estimated hit chance bands">
            {(Object.keys(BAND_LABELS) as HitChanceBand[]).map((band) => (
              <span key={band}>
                <i data-band={band} style={targetingSwatchStyle(band)} /> {BAND_LABELS[band]}
              </span>
            ))}
          </div>
        )}
      </div>

      {preview === null ? (
        <div className={styles.emptyState}>
          Hover or keyboard-focus a tile to explain its range, cover, accuracy, and damage.
        </div>
      ) : preview.status !== "eligible" ? (
        <div className={styles.blockedState} data-status={preview.status}>
          <ShieldX size={18} aria-hidden="true" />
          <div>
            <strong>
              Tile {preview.tile.x},{preview.tile.y} · {STATUS_LABELS[preview.status]}
            </strong>
            <span>
              Range {preview.distance}/{maxDistance}
              {preview.stoppedAt === undefined
                ? ""
                : ` · blocked at ${preview.stoppedAt.x},${preview.stoppedAt.y}`}
            </span>
          </div>
        </div>
      ) : weaponDefinition.damageRoll === undefined ? (
        <div className={styles.analysisBody}>
          <div className={styles.headlineRow}>
            <div>
              <span>
                Tile {preview.tile.x},{preview.tile.y}
              </span>
              <strong>Legal explosive impact</strong>
            </div>
            <div>
              <span>Range</span>
              <strong>
                {preview.distance}/{maxDistance}
              </strong>
            </div>
          </div>
          <div className={styles.blastRanges}>
            {weaponDefinition.blast?.damageAtRadius.map((roll, radius) => (
              <span key={radius}>
                <small>{radius === 0 ? "Impact tile" : `Radius ${radius}`}</small>
                <strong>
                  {roll.base}–{roll.base + roll.mask} damage
                </strong>
              </span>
            ))}
          </div>
          <p className={styles.disclaimer}>
            Cover can reduce blast damage. The server rolls damage.
          </p>
        </div>
      ) : estimate === null ? null : (
        <div className={styles.analysisBody}>
          <div className={styles.headlineRow}>
            <div>
              <span>
                Tile {preview.tile.x},{preview.tile.y} · Range {preview.distance}/{maxDistance}
              </span>
              <strong data-band={preview.chanceBand ?? "zero"}>
                <i
                  className={styles.bandDot}
                  style={targetingSwatchStyle(preview.chanceBand ?? "zero")}
                  aria-hidden="true"
                />
                {estimate.chancePercent}% estimated hit chance
              </strong>
            </div>
            <div className={styles.basis}>
              <span>{observedContact === null ? "Hypothetical target" : "Observed contact"}</span>
              <strong>{observedContact?.label ?? `${estimate.posture} posture`}</strong>
            </div>
          </div>

          <dl className={styles.factorSummary}>
            <div>
              <dt>Cover</dt>
              <dd>
                {coverLabel(estimate.coverClass)} · {signed(estimate.breakdown.coverAdjustment)}
              </dd>
            </div>
            <div>
              <dt>Accuracy at this range</dt>
              <dd>{signed(estimate.breakdown.distanceAccuracyAdjustment)}</dd>
            </div>
            <div>
              <dt>Weapon / target terrain</dt>
              <dd>{signed(estimate.breakdown.weaponTerrainAdjustment)}</dd>
            </div>
            {mode === "scan" ? (
              <div>
                <dt>Scan clarity</dt>
                <dd>
                  {scanClarityLabel(preview.scanStrength)} · {preview.scanStrength}/16 ·
                  {estimate.breakdown.scanPenalty === 0
                    ? " no penalty"
                    : ` −${estimate.breakdown.scanPenalty}`}
                </dd>
              </div>
            ) : null}
          </dl>

          <div className={styles.consequences}>
            {estimate.damageRange === null ? null : (
              <span>
                <small>Damage if hit</small>
                <strong>
                  {estimate.damageRange.minimum}–{estimate.damageRange.maximum}
                  {estimate.damageRange.bulletsPerClick > 1
                    ? ` per bullet × ${estimate.damageRange.bulletsPerClick}`
                    : ""}
                </strong>
              </span>
            )}
            {estimate.offTileBreakdown === null ? null : (
              <span>
                <small>If the target leaves this tile</small>
                <strong>{estimate.offTileBreakdown.chancePercent}% estimated hit chance</strong>
              </span>
            )}
            {mode === "scan" && preview.onConeBoundary ? (
              <span>
                <small>Acquisition priority at cone edge</small>
                <strong>
                  Counts as distance {preview.distance + 2} instead of {preview.distance}
                </strong>
              </span>
            ) : null}
          </div>

          <details className={styles.calculation}>
            <summary>Show Calculation</summary>
            <dl>
              <div>
                <dt>{coverLabel(estimate.coverClass)}</dt>
                <dd>{signed(estimate.breakdown.coverAdjustment)}</dd>
              </div>
              <div>
                <dt>Robot accuracy at {preview.distance} tiles</dt>
                <dd>{signed(estimate.breakdown.distanceAccuracyAdjustment)}</dd>
              </div>
              <div>
                <dt>
                  {mode === "scan" ? "Scan weapon / target terrain" : "Weapon / target terrain"}
                </dt>
                <dd>{signed(estimate.breakdown.weaponTerrainAdjustment)}</dd>
              </div>
              {mode === "scan" ? (
                <div>
                  <dt>Scan penalty</dt>
                  <dd>−{estimate.breakdown.scanPenalty}</dd>
                </div>
              ) : null}
              <div>
                <dt>Pre-clamp subtotal</dt>
                <dd>{estimate.breakdown.preClampSubtotal}</dd>
              </div>
              <div>
                <dt>Clamped hit-table tier</dt>
                <dd>{estimate.breakdown.clampedScore}/19</dd>
              </div>
              {estimate.breakdown.damageStaggered ? (
                <div>
                  <dt>Damage stagger halves tier</dt>
                  <dd>{estimate.breakdown.scoreAfterDamageStagger}/19</dd>
                </div>
              ) : null}
              <div>
                <dt>Threshold lookup</dt>
                <dd>
                  {estimate.breakdown.threshold}/256 = {estimate.breakdown.chancePercent}%
                </dd>
              </div>
            </dl>
            <p>The tier is a lookup-table index, not hits out of 19.</p>
          </details>
          <p className={styles.disclaimer}>
            Future movement and the server’s RNG roll are not previewed.
          </p>
        </div>
      )}
    </section>
  );
}
