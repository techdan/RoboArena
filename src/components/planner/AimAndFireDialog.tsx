"use client";

import { Crosshair, ShieldAlert, Target, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { Arena, RobotState, TileCoord, WeaponId } from "../../engine/types";
import { previewAim, WEAPON_LABELS, type AuthorizedContact } from "../../planner/firingHelpers";
import { usePlannerDialogFocus } from "./usePlannerDialogFocus";

export interface AimAndFireDialogProps {
  readonly arena: Arena;
  readonly shooter: RobotState;
  readonly target: TileCoord;
  readonly weapons: readonly WeaponId[];
  readonly initialWeapon: WeaponId;
  readonly initialRepeat: boolean;
  readonly authorizedContacts: readonly AuthorizedContact[];
  readonly onConfirm: (weapon: WeaponId, repeat: boolean) => void;
  readonly onCancel: () => void;
}

const STATUS_COPY = {
  "shooter-docked": "Deploy this robot before programming fire.",
  "out-of-range": "Out of range — choose a target within the weapon’s 18-tile range.",
  "angle-blocked": "Angle blocked — rotate the scan heading toward this tile first.",
  "sight-blocked": "Sight blocked — a wall interrupts the center line.",
} as const;

export function AimAndFireDialog({
  arena,
  shooter,
  target,
  weapons,
  initialWeapon,
  initialRepeat,
  authorizedContacts,
  onConfirm,
  onCancel,
}: AimAndFireDialogProps) {
  const [weapon, setWeapon] = useState(initialWeapon);
  const [repeat, setRepeat] = useState(initialRepeat);
  const dialogRef = usePlannerDialogFocus<HTMLElement>(onCancel);
  const preview = useMemo(
    () => previewAim({ arena, shooter, target, weapon, authorizedContacts }),
    [arena, authorizedContacts, shooter, target, weapon],
  );
  return (
    <div
      className="planner-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="planner-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aim-dialog-title"
        tabIndex={-1}
      >
        <header>
          <div>
            <p className="eyebrow">Tile target</p>
            <h2 id="aim-dialog-title">Aim &amp; Fire</h2>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close Aim and Fire dialog">
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
        </div>
        <label className="setup-label">
          Weapon
          <select
            className="setup-input"
            name="aim-weapon"
            autoComplete="off"
            data-dialog-initial-focus
            value={weapon}
            onChange={(event) => setWeapon(event.currentTarget.value as WeaponId)}
          >
            {weapons.map((id) => (
              <option key={id} value={id}>
                {WEAPON_LABELS[id]}
              </option>
            ))}
          </select>
        </label>
        <label className="repeat-choice">
          <input
            name="repeat-fire"
            type="checkbox"
            checked={repeat}
            onChange={(event) => setRepeat(event.currentTarget.checked)}
          />
          <span>
            <strong>Repeat fire</strong>
            <small>Keep firing at this tile through the remaining program horizon.</small>
          </span>
        </label>
        {preview.status === "eligible" && preview.resolution === "direct-hit-roll" ? (
          <div className="fire-preview">
            <div className="fire-preview-heading">
              <Crosshair size={16} aria-hidden="true" />
              <span>
                {preview.authorizedContact === null
                  ? "Hypothetical target posture estimates"
                  : `Authorized contact: ${preview.authorizedContact.label}`}
              </span>
            </div>
            <div className="fire-estimates">
              {preview.estimates.map((entry) => (
                <div key={entry.posture}>
                  <span>{entry.posture}</span>
                  <strong>{entry.chancePercent}% estimate</strong>
                  <small>
                    score {entry.score}/19 · cover {entry.coverClass} · threshold {entry.threshold}
                    /256
                  </small>
                </div>
              ))}
            </div>
            <p>No RNG result is previewed. The server rolls only when this command resolves.</p>
          </div>
        ) : preview.status === "eligible" ? (
          <div className="fire-preview">
            <div className="fire-preview-heading">
              <Crosshair size={16} aria-hidden="true" />
              <span>Deterministic blast trajectory</span>
            </div>
            <p>
              This explosive impacts the programmed tile and resolves blast damage by radius and
              cover. It does not use the direct-fire hit-score table; damage RNG remains
              server-authoritative.
            </p>
          </div>
        ) : (
          <div className="fire-blocked" role="status">
            <ShieldAlert size={17} aria-hidden="true" />
            <span>{STATUS_COPY[preview.status]}</span>
          </div>
        )}
        <footer>
          <button type="button" className="secondary-action" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-action"
            disabled={preview.status !== "eligible"}
            onClick={() => onConfirm(weapon, repeat)}
          >
            Add Aim &amp; Fire
          </button>
        </footer>
      </section>
    </div>
  );
}
