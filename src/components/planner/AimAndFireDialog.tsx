"use client";

import { ArrowLeft, Crosshair, ShieldAlert, Target, X } from "lucide-react";
import { useMemo } from "react";
import type { Arena, Posture, RobotState, TileCoord, WeaponId } from "../../engine/types";
import { previewAim, WEAPON_LABELS, type AuthorizedContact } from "../../planner/firingHelpers";
import { usePlannerDialogFocus } from "./usePlannerDialogFocus";

export interface AimAndFireDialogProps {
  readonly arena: Arena;
  readonly shooter: RobotState;
  readonly target: TileCoord;
  readonly weapon: WeaponId;
  readonly shots: number;
  readonly fireSeconds: number;
  readonly assumedPosture: Posture;
  readonly authorizedContacts: readonly AuthorizedContact[];
  readonly onConfirm: () => void;
  readonly onBack: () => void;
}

const STATUS_COPY = {
  "shooter-docked": "Deploy this robot before programming fire.",
  "out-of-range": "Out of range — choose a target within the weapon’s range.",
  "angle-blocked": "Angle blocked — rotate the scan heading toward this tile first.",
  "sight-blocked": "Sight blocked — a wall interrupts the center line.",
} as const;

const COVER_LABELS = {
  1: "strong cover",
  2: "good cover",
  3: "partial cover",
  4: "exposed",
} as const;

const signed = (value: number): string => (value >= 0 ? `+${value}` : `−${Math.abs(value)}`);

export function AimAndFireDialog({
  arena,
  shooter,
  target,
  weapon,
  shots,
  fireSeconds,
  assumedPosture,
  authorizedContacts,
  onConfirm,
  onBack,
}: AimAndFireDialogProps) {
  const dialogRef = usePlannerDialogFocus<HTMLElement>(onBack);
  const preview = useMemo(
    () => previewAim({ arena, shooter, target, weapon, authorizedContacts }),
    [arena, authorizedContacts, shooter, target, weapon],
  );
  return (
    <div className="aim-review-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="planner-dialog aim-review-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aim-review-title"
        tabIndex={-1}
      >
        <header>
          <div>
            <p className="eyebrow">Confirm programmed shot</p>
            <h2 id="aim-review-title">Review Aim &amp; Fire</h2>
          </div>
          <button type="button" onClick={onBack} aria-label="Back to target selection">
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="fire-target-summary">
          <Target size={17} aria-hidden="true" />
          <span>
            Target{" "}
            <strong>
              {target.x},{target.y}
            </strong>
          </span>
          <span>
            Distance <strong>{preview.distance}</strong>
          </span>
          <span>
            Weapon <strong>{WEAPON_LABELS[weapon]}</strong>
          </span>
          <span>
            Fire time <strong>{fireSeconds.toFixed(2)}s</strong>
          </span>
          <span>
            Shots <strong>{shots}</strong>
          </span>
        </div>
        {preview.status === "eligible" && preview.resolution === "direct-hit-roll" ? (
          <div className="fire-preview">
            <div className="fire-preview-heading">
              <Crosshair size={16} aria-hidden="true" />
              <span>
                {preview.authorizedContact === null
                  ? "Hypothetical target posture estimates"
                  : `Observed contact: ${preview.authorizedContact.label}`}
              </span>
            </div>
            <div className="fire-estimates">
              {preview.estimates.map((entry) => (
                <div key={entry.posture} data-assumed={entry.posture === assumedPosture}>
                  <span>{entry.posture}</span>
                  <strong>{entry.chancePercent}% estimate</strong>
                  <small>
                    {COVER_LABELS[entry.coverClass]} {signed(entry.breakdown.coverAdjustment)} ·
                    range {signed(entry.breakdown.distanceAccuracyAdjustment)} · terrain{" "}
                    {signed(entry.breakdown.weaponTerrainAdjustment)}
                  </small>
                  {entry.offTileBreakdown === null ? null : (
                    <small>If target leaves tile: {entry.offTileBreakdown.chancePercent}%</small>
                  )}
                </div>
              ))}
            </div>
            <p>No RNG result is previewed. The server rolls only when the command resolves.</p>
          </div>
        ) : preview.status === "eligible" ? (
          <div className="fire-preview">
            <div className="fire-preview-heading">
              <Crosshair size={16} aria-hidden="true" />
              <span>Deterministic blast trajectory</span>
            </div>
            <p>
              This explosive impacts the programmed tile and resolves blast damage by radius and
              cover. Damage RNG remains server-authoritative.
            </p>
          </div>
        ) : (
          <div className="fire-blocked" role="status">
            <ShieldAlert size={17} aria-hidden="true" />
            <span>{STATUS_COPY[preview.status]}</span>
          </div>
        )}
        <footer>
          <button type="button" className="secondary-action" onClick={onBack}>
            <ArrowLeft size={15} aria-hidden="true" /> Back
          </button>
          <button
            type="button"
            className="primary-action"
            data-dialog-initial-focus
            disabled={preview.status !== "eligible"}
            onClick={onConfirm}
          >
            Add {shots} Shot{shots === 1 ? "" : "s"}
          </button>
        </footer>
      </section>
    </div>
  );
}
